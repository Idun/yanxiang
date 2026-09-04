import { libraryStore } from "./libraryStore";
import type { ToolDefinition } from "./knowledgeTools";

/**
 * Agent tools for the 写作画布 text-card library.
 *
 * The model may (only when the user explicitly asks) read cards from the
 * canvas, or create/edit text cards. Without an explicit command it must NOT
 * touch the card store — these tools merely give the LLM "点哪打哪" abilities
 * so commands like "创建卡片到画布 / 阅读某张卡片 / 改写某张卡片" work reliably.
 */

export const CARD_TOOL_NAMES = ["list_cards", "read_card", "create_card", "update_card"] as const;
export type CardToolName = (typeof CARD_TOOL_NAMES)[number];

export function isCardTool(name: string): name is CardToolName {
  return (CARD_TOOL_NAMES as readonly string[]).includes(name);
}

function snippet(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function normalize(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, "");
}

/** Resolve a card by exact title, then fuzzy (suffix/contains) match. */
function resolveCard(title: string) {
  const target = normalize(title);
  if (!target) return undefined;
  const exact = libraryStore.cards.find((c) => normalize(c.title) === target);
  if (exact) return exact;
  const row = libraryStore.cards.find((c) => normalize(c.title).includes(target));
  return row;
}

export function cardToolDefinitions(): ToolDefinition[] {
  return [
    {
      name: "list_cards",
      description:
        "列出写作画布中现有全部文本卡片的标题与内容摘要。当用户提到「卡片／画布」或要求从画布里寻找内容时，先调用它查看有哪些卡片。",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      name: "read_card",
      description:
        "按卡片标题（支持模糊匹配）读取某张文本卡片的完整正文。不确定标题时先调用 list_cards 拿到标题。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "要读取的文本卡片标题",
          },
        },
        required: ["title"],
      },
    },
    {
      name: "create_card",
      description:
        "在写作画布中**新建**一张文本卡片（含标题 title 与正文 content）。仅在用户明确要求「创建/生成/放入画布」某内容为卡片时调用。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "卡片标题，简洁明确",
          },
          content: {
            type: "string",
            description: "卡片正文内容",
          },
        },
        required: ["title", "content"],
      },
    },
    {
      name: "update_card",
      description:
        "修改画布中某张已有文本卡片的标题或正文。仅在用户明确要求「修改/更新/改写/重写某张卡片」时调用，未指示时不得擅自改动。",
      parameters: {
        type: "object",
        properties: {
          target: {
            type: "string",
            description: "目标卡片标题（模糊匹配）",
          },
          title: {
            type: "string",
            description: "可选：新的卡片标题",
          },
          content: {
            type: "string",
            description: "可选：新的卡片正文",
          },
        },
        required: ["target"],
      },
    },
  ];
}

function listCards(): string {
  if (libraryStore.cards.length === 0) return "当前写作画布中没有任何文本卡片。";
  return libraryStore.cards
    .map((c, i) => `${i + 1}. ${c.title}${c.pinned ? " [置顶]" : ""}\n   摘要：${snippet(c.content)}`)
    .join("\n\n");
}

function readCard(title: string): string {
  const ref = String(title ?? "").trim();
  if (!ref) return "缺少参数 title。可用卡片：\n" + listCards();
  const card = resolveCard(ref);
  if (!card) return `未在画布中找到卡片「${ref}」。可用卡片：\n${listCards()}`;
  return `卡片「${card.title}」内容：\n${card.content}`;
}

function createCard(title: string, content: string): string {
  const t = String(title ?? "").trim() || `文本卡片 ${libraryStore.cards.length + 1}`;
  const c = String(content ?? "").trim();
  if (!c) return "卡片正文 content 为空，创建失败；请提供要写入卡片的正文内容。";
  libraryStore.cards.push({ id: Date.now(), title: t, content: c });
  return `已在写作画布创建文本卡片「${t}」(${c.length} 字)：\n${c.slice(0, 120)}${c.length > 120 ? "…" : ""}`;
}

function updateCard(target: string, title?: string, content?: string): string {
  const ref = String(target ?? "").trim();
  if (!ref) return "缺少参数 target（要修改的卡片标题）。";
  const card = resolveCard(ref);
  if (!card) return `未在画布中找到卡片「${ref}」。可用卡片：\n${listCards()}`;

  const applied: string[] = [];
  const newTitle = String(title ?? "").trim();
  const newContent = String(content ?? "").trim();
  if (newTitle) {
    card.title = newTitle;
    applied.push(`标题已改为「${card.title}」`);
  }
  if (newContent) {
    card.content = newContent;
    applied.push(`正文已更新（${newContent.length} 字）`);
  }
  if (applied.length === 0) return `未提供新的标题或内容，卡片「${card.title}」保持不变。`;
  return `已更新卡片「${card.title}」：${applied.join("；")}。`;
}

/** Execute a card tool call. Never throws — errors come back as readable text. */
export function runCardTool(name: string, args: Record<string, unknown>): string {
  try {
    if (name === "list_cards") return listCards();
    if (name === "read_card") return readCard(String(args.title ?? ""));
    if (name === "create_card") return createCard(String(args.title ?? ""), String(args.content ?? ""));
    if (name === "update_card") {
      return updateCard(String(args.target ?? ""), String(args.title ?? ""), String(args.content ?? ""));
    }
    return `未知工具: ${name}`;
  } catch (error) {
    return `工具执行失败: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/** Human-readable one-liner for the trace/状态 badge. */
export function describeCardToolCall(name: string, args: Record<string, unknown>): string {
  if (name === "list_cards") return "查看画布文本卡片";
  if (name === "read_card") return `读取卡片「${String(args.title ?? "").trim() || "?"}」`;
  if (name === "create_card") return `创建卡片「${String(args.title ?? "").trim() || "?"}」`;
  if (name === "update_card") return `更新卡片「${String(args.target ?? "").trim() || "?"}」`;
  return `调用工具 ${name}`;
}