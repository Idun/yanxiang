import { aiSettings, type KnowledgeFile } from "./settings";

/**
 * Knowledge items as *readable files*, not as pre-injected context.
 *
 * Previously every knowledge item was concatenated into the system prompt on
 * every request, which burned tokens and drowned the actual instructions. Now
 * the agent gets a short manifest plus three tools and reads only what it
 * needs — the same way a coding agent reads source files.
 */

export type KnowledgeScope = "chat" | "writer" | "auditor";

export function knowledgeList(scope: KnowledgeScope): KnowledgeFile[] {
  if (scope === "chat") return aiSettings.chatKnowledge;
  if (scope === "writer") return aiSettings.writerKnowledge;
  return aiSettings.auditorKnowledge;
}

const DEFAULT_READ_LIMIT = 240;
const MAX_READ_LIMIT = 1200;
const MAX_SEARCH_RESULTS = 60;

/* ---------------- lookup ---------------- */

function normalize(value: string): string {
  return value.toLowerCase().replace(/\.(md|markdown|txt)$/i, "").trim();
}

/** Resolve a model-supplied identifier (id, exact name, or fuzzy name). */
function resolveFile(scope: KnowledgeScope, ref: string): KnowledgeFile | undefined {
  const list = knowledgeList(scope);
  if (!ref) return undefined;

  const exact = list.find((f) => f.id === ref || f.name === ref);
  if (exact) return exact;

  const target = normalize(ref);
  const byNormalized = list.find((f) => normalize(f.name) === target);
  if (byNormalized) return byNormalized;

  const bySuffix = list.find((f) => normalize(f.name).endsWith(target) || target.endsWith(normalize(f.name)));
  if (bySuffix) return bySuffix;

  return list.find((f) => normalize(f.name).includes(target));
}

function lines(file: KnowledgeFile): string[] {
  return file.content.replace(/\r\n/g, "\n").split("\n");
}

/** Markdown headings, used as a cheap table of contents in the manifest. */
function outline(file: KnowledgeFile, max = 8): string[] {
  const heads: string[] = [];
  for (const line of lines(file)) {
    const m = /^(#{1,4})\s+(.+?)\s*$/.exec(line);
    if (m) {
      heads.push(`${"  ".repeat(m[1].length - 1)}${m[2]}`);
      if (heads.length >= max) break;
    }
  }
  return heads;
}

/* ---------------- manifest for the system prompt ---------------- */

const SCOPE_LABEL: Record<KnowledgeScope, string> = {
  chat: "对话",
  writer: "AI写作",
  auditor: "审核意见",
};

/**
 * Short catalogue appended to the system prompt. It intentionally contains no
 * file *content* — only names, sizes and headings, so the model can decide what
 * is worth reading.
 */
export function knowledgeManifest(scope: KnowledgeScope): string {
  const list = knowledgeList(scope);
  if (list.length === 0) return "";

  const entries = list
    .map((file, index) => {
      const total = lines(file).length;
      const chars = file.content.length;
      const heads = outline(file);
      const toc = heads.length > 0 ? `\n     纲要: ${heads.join(" / ")}` : "";
      return `  ${index + 1}. ${file.name}  (${total} 行 / ${chars} 字符)${toc}`;
    })
    .join("\n");

  return [
    `【${SCOPE_LABEL[scope]}知识库 · 共 ${list.length} 个知识项】`,
    "以下只是知识项目录，内容尚未加载。你拥有三个工具可以按需阅读它们：",
    "  · list_knowledge —— 列出全部知识项及其纲要",
    "  · read_knowledge —— 按文件名读取某个知识项的正文（带行号，可分页）",
    "  · search_knowledge —— 在知识项中做关键词/正则检索，返回命中行",
    "",
    "工作要求：",
    "  1. 仅在「上下文尚未包含所需知识项内容」时，才使用 search_knowledge / read_knowledge 读取相关段落；",
    "  2. 大语言模型具备上下文记忆：若本次会话之前的对话里已经通过工具读取过某个知识项，其内容已留在上下文中，后续轮次应直接沿用记忆作答，禁止重复调用工具反复阅读同一知识项；",
    "  3. 除非用户明确要求「重新查阅/更新/换一个说法再查」某份知识项，否则不要重复发起知识项工具调用；",
    "  4. 不要凭目录名猜测内容，确需引用时必须真实读取后再引用；",
    "  5. 不要向用户复述知识项原文，把结论落到写作/审核产出里。",
    "",
    "目录：",
    entries,
  ].join("\n");
}

/* ---------------- tool schemas ---------------- */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export function knowledgeToolDefinitions(scope: KnowledgeScope): ToolDefinition[] {
  const names = knowledgeList(scope).map((f) => f.name);
  const nameHint = names.length > 0 ? `可选值示例: ${names.slice(0, 6).join(" | ")}` : "";

  return [
    {
      name: "list_knowledge",
      description:
        "列出当前可用的全部知识项（文件名、行数、字符数、Markdown 纲要）。不返回正文。在不确定该读哪个知识项时先调用它。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "read_knowledge",
      description:
        "读取某个知识项的正文，返回带行号的内容，可通过 offset/limit 分页读取长文件。等同于打开文件阅读。",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: `要读取的知识项文件名（支持省略扩展名的模糊匹配）。${nameHint}`,
          },
          offset: {
            type: "integer",
            description: "起始行号，从 1 开始，默认 1。",
          },
          limit: {
            type: "integer",
            description: `最多返回的行数，默认 ${DEFAULT_READ_LIMIT}，上限 ${MAX_READ_LIMIT}。`,
          },
        },
        required: ["name"],
      },
    },
    {
      name: "search_knowledge",
      description:
        "在知识项中按关键词或正则检索，返回 文件名:行号: 内容 形式的命中列表。用于在长知识项里快速定位相关段落。",
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "关键词或 JavaScript 正则表达式（不区分大小写）。",
          },
          name: {
            type: "string",
            description: "可选，限定只在某个知识项内检索；省略则检索全部知识项。",
          },
          context_lines: {
            type: "integer",
            description: "可选，每条命中额外返回的上下文行数，默认 0，上限 4。",
          },
        },
        required: ["pattern"],
      },
    },
  ];
}

/* ---------------- execution ---------------- */

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function availableNames(scope: KnowledgeScope): string {
  const list = knowledgeList(scope);
  if (list.length === 0) return "(当前没有任何知识项)";
  return list.map((f) => `- ${f.name}`).join("\n");
}

function runList(scope: KnowledgeScope): string {
  const list = knowledgeList(scope);
  if (list.length === 0) return "当前没有配置任何知识项。";

  return list
    .map((file, index) => {
      const total = lines(file).length;
      const heads = outline(file, 12);
      const toc = heads.length > 0 ? `\n   纲要:\n${heads.map((h) => `     - ${h}`).join("\n")}` : "";
      return `${index + 1}. ${file.name}\n   规模: ${total} 行 / ${file.content.length} 字符${toc}`;
    })
    .join("\n\n");
}

function runRead(scope: KnowledgeScope, args: Record<string, unknown>): string {
  const ref = String(args.name ?? args.file ?? args.path ?? args.id ?? "").trim();
  if (!ref) {
    return `缺少参数 name。可用知识项：\n${availableNames(scope)}`;
  }

  const file = resolveFile(scope, ref);
  if (!file) {
    return `未找到知识项 "${ref}"。可用知识项：\n${availableNames(scope)}`;
  }

  const all = lines(file);
  const offset = clampInt(args.offset, 1, 1, Math.max(1, all.length));
  const limit = clampInt(args.limit, DEFAULT_READ_LIMIT, 1, MAX_READ_LIMIT);
  const slice = all.slice(offset - 1, offset - 1 + limit);
  const end = offset - 1 + slice.length;

  const body = slice.map((line, i) => `${offset + i}: ${line}`).join("\n");
  const header = `知识项: ${file.name}  (共 ${all.length} 行，本次 ${offset}-${end})`;
  const footer =
    end < all.length
      ? `\n\n[还有 ${all.length - end} 行未读取，可用 read_knowledge 继续: offset=${end + 1}]`
      : "";

  return `${header}\n---\n${body}${footer}`;
}

function buildRegex(pattern: string): RegExp {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  }
}

function runSearch(scope: KnowledgeScope, args: Record<string, unknown>): string {
  const pattern = String(args.pattern ?? args.query ?? args.keyword ?? "").trim();
  if (!pattern) return "缺少参数 pattern。";

  const ref = String(args.name ?? args.file ?? "").trim();
  const contextLines = clampInt(args.context_lines, 0, 0, 4);

  let targets = knowledgeList(scope);
  if (ref) {
    const file = resolveFile(scope, ref);
    if (!file) return `未找到知识项 "${ref}"。可用知识项：\n${availableNames(scope)}`;
    targets = [file];
  }
  if (targets.length === 0) return "当前没有配置任何知识项。";

  const regex = buildRegex(pattern);
  const hits: string[] = [];
  let truncated = false;

  for (const file of targets) {
    const all = lines(file);
    for (let i = 0; i < all.length; i++) {
      if (!regex.test(all[i])) continue;
      if (hits.length >= MAX_SEARCH_RESULTS) {
        truncated = true;
        break;
      }
      if (contextLines === 0) {
        hits.push(`${file.name}:${i + 1}: ${all[i].trim()}`);
      } else {
        const from = Math.max(0, i - contextLines);
        const to = Math.min(all.length, i + contextLines + 1);
        const block = all
          .slice(from, to)
          .map((line, k) => `${from + k + 1}${from + k === i ? ">" : ":"} ${line}`)
          .join("\n");
        hits.push(`${file.name}:${i + 1}\n${block}`);
      }
    }
    if (truncated) break;
  }

  if (hits.length === 0) {
    return `在${ref ? ` "${ref}" ` : "全部知识项"}中未匹配到 "${pattern}"。可先用 list_knowledge 查看纲要，或换更宽的关键词。`;
  }

  const note = truncated ? `\n\n[命中过多，仅显示前 ${MAX_SEARCH_RESULTS} 条，请缩小关键词范围]` : "";
  return `检索 "${pattern}" 命中 ${hits.length} 处：\n${hits.join(contextLines === 0 ? "\n" : "\n\n")}${note}`;
}

/** Dispatch a knowledge tool call. Never throws — errors come back as text. */
export function runKnowledgeTool(
  scope: KnowledgeScope,
  name: string,
  args: Record<string, unknown>,
): string {
  try {
    if (name === "list_knowledge") return runList(scope);
    if (name === "read_knowledge") return runRead(scope, args);
    if (name === "search_knowledge") return runSearch(scope, args);
    return `未知工具: ${name}`;
  } catch (error) {
    return `工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Human-readable one-liner for the "agent is reading…" UI badge. */
export function describeKnowledgeToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "list_knowledge") return "浏览知识项目录";
  if (name === "read_knowledge") {
    const ref = String(args.name ?? args.file ?? "").trim();
    const offset = args.offset ? ` 第 ${args.offset} 行起` : "";
    return `阅读知识项「${ref || "?"}」${offset}`;
  }
  if (name === "search_knowledge") {
    const pattern = String(args.pattern ?? args.query ?? "").trim();
    const ref = String(args.name ?? "").trim();
    return `检索知识项${ref ? `「${ref}」` : ""}：${pattern}`;
  }
  return `调用工具 ${name}`;
}
