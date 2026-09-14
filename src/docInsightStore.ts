/**
 * 文档界面 WYSIWYG 阅读辅助侧栏的 AI 提取结果缓存。
 *
 * 「人物星图」与「本章地图地点」由后端 AI 一次性从我正文提取，成功后落库：
 * - 以文档条目 id 为键，各自记忆「提取时所在的章号 + 正文哈希」；
 * - 再次打开 / 重启后正文没变（hash 未变）就直接呈现缓存，不再重复请求 AI；
 * - 正文变化（编辑过 / 切到别的章）后缓存失效，侧栏会重新提示用户点一次提取。
 *
 * 跨会话由 persistenceBootstrap 以 settings 里的 docInsightExtractions 落库。
 */

import { reactive } from "vue";

export interface DocInsightExtraction {
  /** 提取时所在章号（null = 全文未分章）。 */
  chapterNum: number | null;
  /** 提取时对应正文的快照哈希，用于判断内容是否已变化。 */
  contentHash: string;
  /** 出场人物名字。 */
  characters: string[];
  /** 点名出现的地点名称。 */
  places: string[];
  updatedAt: number;
}

export const docInsightStore = reactive({
  data: {} as Record<string, DocInsightExtraction>,
});

/** 记忆条目上限：超出后丢弃最久未更新的，避免 settings 无限膨胀。 */
const MAX_ENTRIES = 200;

export function getDocInsight(fileId: string): DocInsightExtraction | undefined {
  return docInsightStore.data[fileId];
}

export function setDocInsight(fileId: string, ex: DocInsightExtraction): void {
  if (!fileId) return;
  docInsightStore.data[fileId] = {
    ...ex,
    characters: (ex.characters || []).map((s) => String(s).trim()).filter(Boolean),
    places: (ex.places || []).map((s) => String(s).trim()).filter(Boolean),
    updatedAt: Date.now(),
  };
  pruneEntries();
}

/** 删除已不存在文档留下的提取缓存。 */
export function pruneDocInsights(validFileIds: Iterable<string>): void {
  const valid = new Set(validFileIds);
  for (const id of Object.keys(docInsightStore.data)) {
    if (!valid.has(id)) delete docInsightStore.data[id];
  }
}

/** 简单稳定字符串哈希，用于判断章节正文是否还是提取时的版本。 */
export function hashText(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    h1 ^= text.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 0x85ebca6b) >>> 0;
  }
  return (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16);
}

function pruneEntries(): void {
  const keys = Object.keys(docInsightStore.data);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .sort(
      (a, b) => docInsightStore.data[a].updatedAt - docInsightStore.data[b].updatedAt,
    )
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((id) => delete docInsightStore.data[id]);
}

export function exportDocInsights(): Record<string, DocInsightExtraction> {
  const out: Record<string, DocInsightExtraction> = {};
  for (const [id, ex] of Object.entries(docInsightStore.data)) {
    out[id] = { ...ex, characters: [...ex.characters], places: [...ex.places] };
  }
  return out;
}

export function importDocInsights(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const next: Record<string, DocInsightExtraction> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    next[id] = {
      chapterNum: typeof v.chapterNum === "number" ? v.chapterNum : null,
      contentHash: typeof v.contentHash === "string" ? v.contentHash : "",
      characters: Array.isArray(v.characters)
        ? v.characters.filter((x): x is string => typeof x === "string")
        : [],
      places: Array.isArray(v.places) ? v.places.filter((x): x is string => typeof x === "string") : [],
      updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : Date.now(),
    };
  }
  docInsightStore.data = next;
}