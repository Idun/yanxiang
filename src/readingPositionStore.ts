/**
 * 文档阅读停留位置的记忆。
 *
 * 以「文档条目 id」为键各记一份：编辑区与预览区的滚动位置分别存，
 * 下次打开（切回该文档 / 重启应用）时回到上次读到的正文位置，
 * 而不是每次都从头开始。
 *
 * 同时存绝对像素与比例两份：
 * - 正文长度没变（只是切走又切回、或重启）→ 用绝对像素，逐像素回到原处；
 * - 正文长度变了（在别处编辑过、字号 / 窗宽变化导致重排）→ 退回按比例定位，
 *   不至于跳到文末或文首。
 *
 * 跨会话由 persistenceBootstrap 以 settings 里的 docReadingPositions 落库。
 */

import { reactive } from "vue";

export interface DocReadingPosition {
  /** 编辑区 scrollTop（px）。 */
  editorTop: number;
  /** 编辑区滚动比例 0~1，重排后的兜底。 */
  editorRatio: number;
  /** 预览区 scrollTop（px）。 */
  previewTop: number;
  /** 预览区滚动比例 0~1。 */
  previewRatio: number;
  /** 记录时的正文字符数，用来判断能否直接用绝对像素。 */
  length: number;
  updatedAt: number;
}

/** 记忆条目上限：超出后丢弃最久未访问的，避免 settings 无限膨胀。 */
const MAX_ENTRIES = 300;

export const readingPositionStore = reactive({
  positions: {} as Record<string, DocReadingPosition>,
});

function num(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function getReadingPosition(fileId: string): DocReadingPosition | undefined {
  return readingPositionStore.positions[fileId];
}

/** 记一次阅读位置。两个窗格分别调用，未传的一侧沿用旧值。 */
export function setReadingPosition(
  fileId: string,
  patch: Partial<Omit<DocReadingPosition, "updatedAt">>,
): void {
  if (!fileId) return;
  const prev = readingPositionStore.positions[fileId];
  const next: DocReadingPosition = {
    editorTop: num(patch.editorTop, prev?.editorTop ?? 0),
    editorRatio: clamp01(num(patch.editorRatio, prev?.editorRatio ?? 0)),
    previewTop: num(patch.previewTop, prev?.previewTop ?? 0),
    previewRatio: clamp01(num(patch.previewRatio, prev?.previewRatio ?? 0)),
    length: num(patch.length, prev?.length ?? 0),
    updatedAt: Date.now(),
  };

  /* 文首（0）不值得记：既省条目，也让「从没滚动过的新文档」保持默认行为。 */
  if (
    next.editorTop <= 0 &&
    next.previewTop <= 0 &&
    next.editorRatio <= 0 &&
    next.previewRatio <= 0
  ) {
    if (prev) delete readingPositionStore.positions[fileId];
    return;
  }

  readingPositionStore.positions[fileId] = next;
  pruneEntries();
}

export function dropReadingPosition(fileId: string): void {
  delete readingPositionStore.positions[fileId];
}

/** 删掉已不存在的文档留下的记忆（文档被删除后清账）。 */
export function pruneReadingPositions(validFileIds: Iterable<string>): void {
  const valid = new Set(validFileIds);
  for (const id of Object.keys(readingPositionStore.positions)) {
    if (!valid.has(id)) delete readingPositionStore.positions[id];
  }
}

function pruneEntries(): void {
  const keys = Object.keys(readingPositionStore.positions);
  if (keys.length <= MAX_ENTRIES) return;
  keys
    .sort(
      (a, b) =>
        readingPositionStore.positions[a].updatedAt -
        readingPositionStore.positions[b].updatedAt,
    )
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((id) => delete readingPositionStore.positions[id]);
}

/**
 * 依据记忆算出应当滚到的像素位置。
 *
 * @param max 当前滚动余量（scrollHeight - clientHeight）
 * @param currentLength 当前正文字符数
 */
export function resolveScrollTop(
  saved: DocReadingPosition | undefined,
  pane: "editor" | "preview",
  max: number,
  currentLength: number,
): number {
  if (!saved || max <= 0) return 0;
  const top = pane === "editor" ? saved.editorTop : saved.previewTop;
  const ratio = pane === "editor" ? saved.editorRatio : saved.previewRatio;
  /* 正文没变过 → 绝对像素最准；变过 → 按比例落点。 */
  const raw = saved.length === currentLength ? top : ratio * max;
  return Math.min(max, Math.max(0, Math.round(raw)));
}

export function exportReadingPositions(): Record<string, DocReadingPosition> {
  const out: Record<string, DocReadingPosition> = {};
  for (const [id, pos] of Object.entries(readingPositionStore.positions)) {
    out[id] = { ...pos };
  }
  return out;
}

export function importReadingPositions(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const next: Record<string, DocReadingPosition> = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    next[id] = {
      editorTop: num(v.editorTop),
      editorRatio: clamp01(num(v.editorRatio)),
      previewTop: num(v.previewTop),
      previewRatio: clamp01(num(v.previewRatio)),
      length: num(v.length),
      updatedAt: num(v.updatedAt, Date.now()),
    };
  }
  readingPositionStore.positions = next;
}
