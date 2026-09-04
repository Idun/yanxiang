import { reactive } from "vue";
import {
  deleteInspirationNote,
  loadInspirationNotes,
  saveInspirationNote,
  type InspirationNotePayload,
} from "./persistence";

/**
 * 灵感速记（Inspiration）。
 *
 * 主页右侧的速记流：随手写一条、贴张图、打个 #标签，回车即存。数据逐条落库
 * （`inspiration_notes` 表），不做整批替换，所以任何一次写入失败都不会波及
 * 已经攒下的其他条目。
 */

export interface InspirationNote {
  id: string;
  /** 原始 Markdown 正文（含 #标签 字面量）。 */
  content: string;
  /** 从正文里解析出的标签，去重后按出现顺序排列。 */
  tags: string[];
  /** 图片以 data URL 内联保存，保证离线可用、不依赖外部路径。 */
  images: string[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export const inspirationStore = reactive({
  notes: [] as InspirationNote[],
  /** 当前筛选的标签；null 表示不筛选。 */
  activeTag: null as string | null,
  /** 关键词筛选。 */
  query: "",
  loaded: false,
});

/* ---------------- 标签解析 ---------------- */

/**
 * 解析 `#标签`。
 *
 * 允许中文、字母、数字、下划线、连字符；`#` 必须位于行首或空白之后，这样
 * Markdown 标题（`# 标题`，井号后带空格）和 URL 里的 `#fragment` 都不会被
 * 误判成标签。
 */
const TAG_PATTERN = /(?:^|\s)#([\p{L}\p{N}_-]+)/gu;

export function parseTags(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(TAG_PATTERN)) {
    const tag = match[1];
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** 全部标签及其出现次数，按次数倒序。 */
export function tagCounts(): { tag: string; count: number }[] {
  const buckets = new Map<string, number>();
  for (const note of inspirationStore.notes) {
    for (const tag of note.tags) {
      buckets.set(tag, (buckets.get(tag) ?? 0) + 1);
    }
  }
  return [...buckets.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ---------------- 序列化 ---------------- */

function toPayload(note: InspirationNote): InspirationNotePayload {
  return {
    id: note.id,
    content: note.content,
    tags: JSON.stringify(note.tags),
    images: JSON.stringify(note.images),
    pinned: note.pinned,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  };
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function fromPayload(row: InspirationNotePayload): InspirationNote {
  return {
    id: row.id,
    content: row.content,
    tags: parseJsonArray(row.tags),
    images: parseJsonArray(row.images),
    pinned: !!row.pinned,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** 置顶优先，其次按创建时间倒序。 */
function sortNotes() {
  inspirationStore.notes.sort(
    (a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt,
  );
}

/* ---------------- 读写 ---------------- */

export async function loadInspiration(): Promise<void> {
  if (inspirationStore.loaded) return;
  try {
    const rows = await loadInspirationNotes();
    inspirationStore.notes = rows.map(fromPayload);
    sortNotes();
  } catch {
    /* 读取失败时保持空列表，编辑框仍可使用 */
  }
  inspirationStore.loaded = true;
}

/** 发布一条速记。空内容且无图片时不创建。返回新建的条目。 */
export function addInspiration(content: string, images: string[] = []): InspirationNote | null {
  const text = content.trim();
  if (!text && images.length === 0) return null;

  const now = Date.now();
  const note: InspirationNote = {
    id: `insp_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    content: text,
    tags: parseTags(text),
    images: images.slice(),
    pinned: false,
    createdAt: now,
    updatedAt: now,
  };

  inspirationStore.notes.unshift(note);
  sortNotes();
  void saveInspirationNote(toPayload(note)).catch((err) =>
    console.error("saveInspirationNote failed:", err),
  );
  return note;
}

export function updateInspiration(id: string, content: string, images?: string[]): void {
  const note = inspirationStore.notes.find((n) => n.id === id);
  if (!note) return;

  const text = content.trim();
  if (!text && (images ?? note.images).length === 0) {
    /* 内容被清空视为删除，避免留下空卡片 */
    removeInspiration(id);
    return;
  }

  note.content = text;
  note.tags = parseTags(text);
  if (images) note.images = images.slice();
  note.updatedAt = Date.now();

  void saveInspirationNote(toPayload(note)).catch((err) =>
    console.error("saveInspirationNote failed:", err),
  );
}

export function toggleInspirationPinned(id: string): void {
  const note = inspirationStore.notes.find((n) => n.id === id);
  if (!note) return;
  note.pinned = !note.pinned;
  note.updatedAt = Date.now();
  sortNotes();
  void saveInspirationNote(toPayload(note)).catch((err) =>
    console.error("saveInspirationNote failed:", err),
  );
}

export function removeInspiration(id: string): void {
  inspirationStore.notes = inspirationStore.notes.filter((n) => n.id !== id);
  void deleteInspirationNote(id).catch((err) =>
    console.error("deleteInspirationNote failed:", err),
  );
}

/* ---------------- 查询 ---------------- */

/** 按标签与关键词过滤后的列表。 */
export function visibleInspirations(): InspirationNote[] {
  const tag = inspirationStore.activeTag;
  const q = inspirationStore.query.trim().toLowerCase();

  return inspirationStore.notes.filter((note) => {
    if (tag && !note.tags.includes(tag)) return false;
    if (q && !note.content.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function setActiveTag(tag: string | null): void {
  inspirationStore.activeTag = inspirationStore.activeTag === tag ? null : tag;
}

/* ---------------- 图片 ---------------- */

/** 单张图片的体积上限。超过就拒绝，避免把数据库撑爆。 */
export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

/** 读取图片文件为 data URL。超限或非图片时返回 null。 */
export async function readImageAsDataUrl(file: File): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size > MAX_IMAGE_BYTES) return null;

  return await new Promise<string | null>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}
