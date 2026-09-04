import {
  activeDocFile,
  createDocFile,
  documentFilesStore,
  selectDocFile,
  type DocFileItem,
} from "./documentFilesStore";
import { docStore } from "./docStore";
import { pulseAiDocEdit } from "./aiDocActivity";
import type { ToolDefinition } from "./knowledgeTools";

/**
 * 「文档」界面的编辑区工具。
 *
 * 与 cardTools（写作画布的文本卡片）是并列且互斥的两套：对话面板按当前所在的
 * 主界面只挂其中一套，谁的界面就只碰谁的编辑区。
 *
 * 之前所有界面都只挂了卡片工具，于是在文档界面让 AI「分析一下这篇文档正文」，
 * 它手上唯一能读的东西就是画布卡片，只能跑去读卡片 —— 跨区错读的根因就在这。
 */

export const DOC_TOOL_NAMES = [
  "list_documents",
  "read_document",
  "create_document",
  "update_document",
  "append_document",
] as const;
export type DocToolName = (typeof DOC_TOOL_NAMES)[number];

export function isDocTool(name: string): name is DocToolName {
  return (DOC_TOOL_NAMES as readonly string[]).includes(name);
}

const DEFAULT_READ_LIMIT = 400;
const MAX_READ_LIMIT = 2000;

function normalize(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "").replace(/\.(md|markdown|txt)$/i, "");
}

function folderName(file: DocFileItem): string {
  if (!file.folderId) return "";
  const folder = documentFilesStore.folders.find((f) => f.id === file.folderId);
  return folder ? folder.title : "";
}

/**
 * 解析模型给的文档引用。
 *
 * 省略 / 传「当前文档」之类的说法时一律落到当前打开的那一篇 —— 用户说
 * 「这篇文档」时指的就是他正看着的那篇。
 */
function resolveDoc(ref?: string): DocFileItem | undefined {
  const raw = String(ref ?? "").trim();
  if (!raw || /^(当前|current|active|this|本文档|当前文档|这篇|这份)/i.test(raw)) {
    return activeDocFile() ?? documentFilesStore.files[0];
  }

  const byId = documentFilesStore.files.find((f) => f.id === raw);
  if (byId) return byId;

  const target = normalize(raw);
  if (!target) return activeDocFile();

  const exact = documentFilesStore.files.find((f) => normalize(f.title) === target);
  if (exact) return exact;
  return documentFilesStore.files.find((f) => normalize(f.title).includes(target));
}

function lines(text: string): string[] {
  return text.replace(/\r\n/g, "\n").split("\n");
}

function chars(text: string): number {
  return text.replace(/\s+/g, "").length;
}

/**
 * 解析模型给的文件夹引用。
 *
 * 找不到同名文件夹时返回 null（= 放在根目录），而不是替用户新建一个文件夹 ——
 * 文件夹是用户自己组织的结构，AI 不该擅自往里加层级。
 */
function resolveFolderId(ref?: string): string | null {
  const raw = String(ref ?? "").trim();
  if (!raw || /^(根目录|root|无|none|null)$/i.test(raw)) return null;

  const byId = documentFilesStore.folders.find((f) => f.id === raw);
  if (byId) return byId.id;

  const target = normalize(raw);
  if (!target) return null;

  const exact = documentFilesStore.folders.find((f) => normalize(f.title) === target);
  if (exact) return exact.id;

  const fuzzy = documentFilesStore.folders.find((f) => normalize(f.title).includes(target));
  return fuzzy ? fuzzy.id : null;
}

/** 标题去重：同名时追加 (2)、(3)…，避免出现两篇一模一样的标题。 */
function uniqueTitle(desired: string): string {
  const base = desired.trim() || "未命名文档";
  const taken = new Set(documentFilesStore.files.map((f) => normalize(f.title)));
  if (!taken.has(normalize(base))) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base} (${n})`;
    if (!taken.has(normalize(candidate))) return candidate;
  }
  return `${base} (${Date.now()})`;
}

/** 改完正文后把它同步回编辑区当前打开的那一篇。 */
function syncActive(file: DocFileItem) {
  if (documentFilesStore.activeFileId === file.id) {
    docStore.markdown = file.content;
  }
  pulseAiDocEdit(file.id);
}

/* ---------------- 工具声明 ---------------- */

export function docToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_documents",
      description:
        "列出「文档」界面里的全部文档条目（标题、所在文件夹、字数），并标出用户当前正打开的那一篇。不返回正文。不确定该读哪篇时先调用它。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "read_document",
      description:
        "读取某篇文档的正文（带行号，可分页）。省略 title 即读用户当前正打开的那一篇——用户说「这篇文档 / 当前文档 / 选中的文档」时就省略 title。要分析、总结、审阅文档正文，必须先用它把正文读进来。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "文档标题（支持模糊匹配）。省略或填「当前文档」即为当前打开的那一篇。",
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
        required: [],
      },
    },
    {
      name: "create_document",
      description:
        "在「文档」界面新建一篇文档并写入正文。仅在用户明确要求「新建 / 创建 / 另存为一篇新文档 / 把这些内容单独存成一篇文档」时调用。它只会新增条目，绝不会改动任何已有文档——要改已有文档请用 update_document / append_document。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "新文档的标题。省略时用正文首行自动生成。",
          },
          content: {
            type: "string",
            description: "新文档的正文内容。允许留空，表示先建一篇空白文档。",
          },
          folder: {
            type: "string",
            description:
              "可选：放入哪个已有文件夹（名称或 id，模糊匹配）。省略或找不到同名文件夹时放在根目录，不会新建文件夹。",
          },
          open: {
            type: "boolean",
            description: "可选：是否把新文档设为用户当前打开的那一篇，默认 true。",
          },
        },
        required: [],
      },
    },
    {
      name: "update_document",
      description:
        "整篇替换某个**已存在**文档的正文。仅在用户明确要求「改写 / 重写 / 替换 / 润色这篇文档」时调用；未明确指示不得擅自改动。省略 title 即为当前打开的那一篇。本工具不会新建文档，要新建请用 create_document。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "目标文档标题（模糊匹配）。省略即为当前打开的那一篇。",
          },
          content: {
            type: "string",
            description: "替换后的完整正文",
          },
        },
        required: ["content"],
      },
    },
    {
      name: "append_document",
      description:
        "在某个文档正文末尾追加一段内容（不动原有正文）。仅在用户明确要求「续写 / 追加 / 补在文末」时调用。省略 title 即为当前打开的那一篇。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "目标文档标题（模糊匹配）。省略即为当前打开的那一篇。",
          },
          content: {
            type: "string",
            description: "要追加的内容",
          },
        },
        required: ["content"],
      },
    },
  ];
}

/* ---------------- 执行 ---------------- */

function availableDocs(): string {
  if (documentFilesStore.files.length === 0) return "（文档界面里还没有任何文档条目）";
  return documentFilesStore.files.map((f) => `- ${f.title}`).join("\n");
}

function runList(): string {
  if (documentFilesStore.files.length === 0) return "文档界面里还没有任何文档条目。";
  const activeId = documentFilesStore.activeFileId;
  return documentFilesStore.files
    .map((f, i) => {
      const folder = folderName(f);
      const where = folder ? ` · 文件夹「${folder}」` : "";
      const mark = f.id === activeId ? "  ← 用户当前打开" : "";
      return `${i + 1}. ${f.title}${where} · ${chars(f.content)} 字 / ${lines(f.content).length} 行${mark}`;
    })
    .join("\n");
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function runRead(args: Record<string, unknown>): string {
  const ref = String(args.title ?? args.name ?? args.document ?? "").trim();
  const file = resolveDoc(ref);
  if (!file) {
    return `未找到文档${ref ? ` "${ref}"` : ""}。当前可用文档：\n${availableDocs()}`;
  }
  if (!file.content.trim()) {
    return `文档「${file.title}」目前是空的，没有正文可读。`;
  }

  const all = lines(file.content);
  const offset = clampInt(args.offset, 1, 1, Math.max(1, all.length));
  const limit = clampInt(args.limit, DEFAULT_READ_LIMIT, 1, MAX_READ_LIMIT);
  const slice = all.slice(offset - 1, offset - 1 + limit);
  const end = offset - 1 + slice.length;

  const body = slice.map((line, i) => `${offset + i}: ${line}`).join("\n");
  const header = `文档「${file.title}」（共 ${all.length} 行 / ${chars(file.content)} 字，本次 ${offset}-${end}）`;
  const footer =
    end < all.length
      ? `\n\n[还有 ${all.length - end} 行未读取，可用 read_document 继续: offset=${end + 1}]`
      : "";
  return `${header}\n---\n${body}${footer}`;
}

/**
 * 新建一篇文档。
 *
 * 与 update/append 完全隔离：这里只走 createDocFile 往列表里追加条目，
 * 一行都不会碰到已有文档的 content，因此原有的更新机制不受影响。
 */
function runCreate(args: Record<string, unknown>): string {
  const content = String(args.content ?? args.body ?? args.text ?? "");
  const rawTitle = String(args.title ?? args.name ?? "").trim();

  /* 没给标题就拿正文首行顶上——与「粘贴自动建档」的既有行为保持一致。 */
  const derived = content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0);
  const title = uniqueTitle(rawTitle || derived?.slice(0, 40) || "未命名文档");

  const folderRef = String(args.folder ?? args.folder_id ?? args.folderName ?? "").trim();
  const folderId = resolveFolderId(folderRef);

  const file = createDocFile(folderId, title);
  file.content = content;

  /* 默认切到新文档：用户让 AI 建一篇文档，紧接着的动作几乎一定是看它。 */
  const shouldOpen = args.open === undefined ? true : args.open !== false;
  if (shouldOpen) {
    selectDocFile(file.id);
    docStore.markdown = file.content;
  }
  pulseAiDocEdit(file.id);

  const where = folderId ? `文件夹「${folderName(file)}」` : "根目录";
  const missedFolder =
    folderRef && !folderId ? `（未找到文件夹「${folderRef}」，已放在根目录，未新建文件夹）` : "";
  return `已在${where}新建文档「${file.title}」，写入 ${chars(content)} 字${
    shouldOpen ? "，并切换为当前打开的文档" : ""
  }。${missedFolder}`;
}

function runUpdate(args: Record<string, unknown>): string {
  const ref = String(args.title ?? args.name ?? args.target ?? "").trim();
  const content = String(args.content ?? "");
  if (!content.trim()) return "参数 content 为空，未做改动。";

  const file = resolveDoc(ref);
  if (!file) return `未找到文档${ref ? ` "${ref}"` : ""}。当前可用文档：\n${availableDocs()}`;

  const before = chars(file.content);
  file.content = content;
  syncActive(file);
  return `已替换文档「${file.title}」的正文（${before} 字 → ${chars(content)} 字）。`;
}

function runAppend(args: Record<string, unknown>): string {
  const ref = String(args.title ?? args.name ?? args.target ?? "").trim();
  const content = String(args.content ?? "");
  if (!content.trim()) return "参数 content 为空，未做改动。";

  const file = resolveDoc(ref);
  if (!file) return `未找到文档${ref ? ` "${ref}"` : ""}。当前可用文档：\n${availableDocs()}`;

  const separator = file.content.trim() ? (file.content.endsWith("\n") ? "" : "\n\n") : "";
  file.content = `${file.content}${separator}${content}`;
  syncActive(file);
  return `已在文档「${file.title}」末尾追加 ${chars(content)} 字，现共 ${chars(file.content)} 字。`;
}

/** 执行一次文档工具调用。永不抛错，问题以文本返回。 */
export function runDocTool(name: string, args: Record<string, unknown>): string {
  try {
    if (name === "list_documents") return runList();
    if (name === "read_document") return runRead(args);
    if (name === "create_document") return runCreate(args);
    if (name === "update_document") return runUpdate(args);
    if (name === "append_document") return runAppend(args);
    return `未知工具: ${name}`;
  } catch (error) {
    return `工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** 「AI 正在阅读…」那条状态徽标的一句话描述。 */
export function describeDocToolCall(name: string, args: Record<string, unknown>): string {
  const ref = String(args.title ?? args.name ?? args.target ?? "").trim();
  const who = ref || "当前文档";
  if (name === "list_documents") return "浏览文档目录";
  if (name === "read_document") {
    const offset = args.offset ? ` 第 ${args.offset} 行起` : "";
    return `阅读文档「${who}」${offset}`;
  }
  if (name === "create_document") {
    const title = String(args.title ?? args.name ?? "").trim();
    return `新建文档「${title || "未命名文档"}」`;
  }
  if (name === "update_document") return `改写文档「${who}」`;
  if (name === "append_document") return `续写文档「${who}」`;
  return `调用工具 ${name}`;
}
