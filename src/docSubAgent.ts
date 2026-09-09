import { runAgent, type AgentTurn } from "./agentRunner";
import { docToolDefinitions, isDocTool, resolveDocByRef, runDocTool } from "./docTools";
import { activeDocFile, type DocFileItem } from "./documentFilesStore";
import type { ToolDefinition } from "./knowledgeTools";
import type { ApiType } from "./settings";

/**
 * 「文档处理子代理」工具（run_document_task）。
 *
 * 背景：模型直接对多篇文档逐篇调用 read_document / update_document 时，
 * 每轮工具结果都会原样回注到对话历史，正文一多上下文就爆，下一轮请求
 * 直接被 API 以超长错误打回 —— 这是「处理多文档时中断 API」的主要根因。
 *
 * 子代理的思路与 AI 编程里让子代理去读 / 改一堆源码文件一致：把一整个
 * 「跨多篇文档」的任务打包成一次工具调用，由内置的独立回合去阅读、分析、
 * 改写、追加、新建，只把一段简短汇报交回给父上下文。父上下文不会因此
 * 膨胀，多轮工具循环被压缩成单轮，天然避免超长中断。
 */

export const DOC_SUBAGENT_TOOL_NAME = "run_document_task" as const;

/** 派生子代理所需的后端配置（来自当前标签页正在使用的接口）。 */
export interface DocumentSubAgentConfig {
  provider: string;
  apiType: ApiType;
  apiKey: string;
  url: string;
  model: string;
  signal?: AbortSignal;
  maxRounds?: number;
  maxTokens?: number;
}

export function isDocumentSubAgentTool(name: string): boolean {
  return name === DOC_SUBAGENT_TOOL_NAME;
}

/** 子代理一次汇报的字数上限，防止回报本身把父上下文撑爆。 */
const REPORT_CHAR_LIMIT = 6000;

export function documentSubAgentToolDefinition(): ToolDefinition {
  return {
    name: DOC_SUBAGENT_TOOL_NAME,
    description:
      "把一整个「跨多篇文档」的任务派发给内置子代理一次完成：子代理会在自己的独立回合里阅读多篇文档，必要时改写 / 追加 / 新建，最后只回报一段简短结论或变更摘要，而不会把大量正文塞回给你的上下文。" +
      "适用场景：用户要求「把这些文档汇总 / 对比 / 整合 / 统稿」「同时改写或续写多篇文档」「把若干文档合并成一篇新文档」等需要反复读多篇、再统一动手的复杂任务。" +
      "不适用：只读单篇并给出看法（用 read_document / read_documents）；只需一次精确的单篇改写（用 update_document）。" +
      "task 必须写清楚目标和约束；titles 给出目标文档（可省略，省略时处理用户当前打开的那一篇）。",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description:
            "交给子代理完成的自然语言任务描述，要包含明确目标与约束（例如：把这几篇章节按时间线合并成一章、人物名保持一致、完成后生成一篇新文档；或逐篇指出各自的写作问题并按统一的风格重写）。",
        },
        titles: {
          type: "array",
          items: { type: "string" },
          description: "目标文档标题数组（支持模糊匹配）。省略时处理用户当前打开的那一篇。",
        },
        mode: {
          type: "string",
          enum: ["auto", "read", "write"],
          description: "可选：任务的倾向。read=只读分析（禁止改文档）；write=允许改文档；auto=由子代理按任务措辞自行判断（默认）。",
        },
        output: {
          type: "string",
          enum: ["summary", "full"],
          description: "可选：回报形式。summary=只回报简要结论 / 变更摘要（默认）；full=在摘要后附上任务要求的关键产出内容。",
        },
      },
      required: ["task"],
    },
  };
}

/** 中文里常见的「动手写」词，用来在 auto 模式下判定是否允许子代理改文档。 */
const WRITE_HINT =
  /改写|替换|重写|修改|更新|追加|续写|新建|创建|保存|生成|合并|整理|润色|扩写|缩写|翻译|润稿|写进|存为|生成到|写到|补齐|补全/;

function describeSubAgentCall(args: Record<string, unknown>): string {
  const task = String(args.task ?? "").trim().slice(0, 24);
  const titles = Array.isArray(args.titles) ? args.titles.map((t) => String(t).trim()).filter(Boolean) : [];
  const scope = titles.length > 0 ? `（${titles.length} 篇）` : "（当前文档）";
  return `子代理 ${scope}：${task}${task.length >= 24 ? "…" : ""}`;
}

/** 「AI 正在阅读…」那条状态徽标的一句话描述。 */
export function describeDocumentSubAgentCall(name: string, args: Record<string, unknown>): string {
  void name;
  return describeSubAgentCall(args);
}

function buildSubAgentSystemPrompt(writeAllowed: boolean, outputMode: string): string {
  const lines = [
    "你是「文档处理子代理」，由主智能体派发，专门在一篇或多篇文档上完成指定任务。做完立即回报，绝不闲聊。",
    "",
    "你拥有文档工具：list_documents / read_document / read_documents / create_document / update_document / update_documents / append_document / append_documents。",
    "工作守则：",
    "  1. 先明确目标文档再动手。任务没指明具体文档时，用 list_documents 核对，并以用户当前打开的那一篇为准。",
    "  2. 阅读文档：短篇整篇读；长篇先 read_documents 批量读开头，需要更多内容再按 read_document 分页读全，绝不只凭标题猜测内容。",
    writeAllowed
      ? "  3. 本次任务允许改动文档：只在任务明确要求改写 / 替换 / 追加 / 新建时才调用写工具；读工具永远可用。"
      : "  3. 本次任务只读：只允许调用 list / read 类工具，严禁调用任何写工具，做完分析直接回报。",
    "  4. 新建文档时一律把 open 设为 false（不得夺走用户当前打开的文档）。",
    `  5. 汇报：${outputMode === "full" ? "先给一段简要结论 / 变更摘要，再把任务要求的完整产出正文附在后面。" : "只输出一段 ≤300 字的结论 / 变更摘要：做了哪些事、各文档改动要点、新建了哪些文档。"}`,
    "  6. 不要在汇报里复述原始文档内容，不要输出思考过程，不要出现「好的 / 我来处理」这类废话。",
  ];
  return lines.join("\n");
}

/**
 * 制造子代理的执行器。返回一个异步函数，签名与普通工具执行器一致：
 * 接收父代理的工具参数，返回一段文本交回父上下文。永不抛错。
 */
export function makeDocumentSubAgentExecutor(config: DocumentSubAgentConfig) {
  return async (rawArgs: Record<string, unknown>): Promise<string> => {
    const args = { ...rawArgs };
    const task = String(args.task ?? args.instruction ?? args.prompt ?? "").trim();
    if (!task) return "run_document_task 缺少参数 task（任务描述）。";

    const mode = String(args.mode ?? "auto").trim();
    const outputMode = String(args.output ?? "summary").trim() === "full" ? "full" : "summary";
    const writeAllowed =
      mode === "write" || (mode !== "read" && WRITE_HINT.test(task));

    /* 解析目标文档：认 titles 数组，也兼容单值 / 逗号分隔。 */
    const rawTitles = Array.isArray(args.titles)
      ? args.titles.map((t) => String(t).trim()).filter(Boolean)
      : typeof args.titles === "string"
      ? args.titles.split(/[,，;；]/).map((t) => t.trim()).filter(Boolean)
      : [];
    const resolved: DocFileItem[] = [];
    const missing: string[] = [];
    for (const title of rawTitles) {
      const file = resolveDocByRef(title);
      if (file) resolved.push(file);
      else missing.push(title);
    }
    const current = activeDocFile();

    const scopeText =
      resolved.length > 0
        ? resolved.map((f) => `- ${f.title}`).join("\n")
        : `（未指定具体文档${current ? `，用户当前打开的是「${current.title}」` : ""}；先用 list_documents 核对后处理目标文档）`;
    const missingNote = missing.length > 0 ? `\n\n注意：以下标题未能匹配到现有文档，不要创建同名文件，改用 list_documents 核对：${missing.join("、")}` : "";

    const innerSystem = buildSubAgentSystemPrompt(writeAllowed, outputMode);
    const innerMessages: AgentTurn[] = [
      {
        role: "user",
        content: [
          `任务：${task}`,
          "",
          "目标文档：",
          scopeText,
          missingNote,
          "",
          `汇报要求：${outputMode === "full" ? "先给简要结论，再附上任务要求的完整产出正文" : "只输出 ≤300 字的结论 / 变更摘要"}`,
        ].join("\n"),
      },
    ];

    try {
      const result = await runAgent({
        provider: config.provider,
        apiType: config.apiType,
        apiKey: config.apiKey,
        url: config.url,
        model: config.model,
        systemPrompt: innerSystem,
        messages: innerMessages,
        tools: docToolDefinitions(),
        executeTool: (name, innerArgs) => {
          if (!isDocTool(name)) return `未知工具: ${name}`;
          /* 子代理新建文档一律不抢焦点（open 强制 false），
             不打断用户当前正打开的那一篇。 */
          if (name === "create_document") {
            innerArgs = { ...innerArgs, open: false };
          }
          return runDocTool(name, innerArgs);
        },
        stream: false,
        maxRounds: config.maxRounds ?? 8,
        /* summary 模式只需简短汇报；full 模式要让子代理把完整产出交回来，
           给足额度避免中途被长度上限截断。 */
        maxTokens: config.maxTokens ?? (outputMode === "full" ? 4000 : 1200),
        temperature: 0.4,
        signal: config.signal,
      });

      const raw = result.text?.trim() || "（子代理未返回任何内容）";
      const body = raw.length > REPORT_CHAR_LIMIT ? `${raw.slice(0, REPORT_CHAR_LIMIT)}\n…（汇报过长，已截断）` : raw;
      const modeNote = writeAllowed ? "本次为可写任务，子代理可以改动文档。" : "本次为只读任务，未改动任何文档。";
      return `【子代理执行完毕】${describeSubAgentCall(args)}。${modeNote}\n---\n${body}`;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && error.name === "AbortError") {
        return "子代理执行被用户中止。";
      }
      return `子代理执行失败：${message}`;
    }
  };
}
