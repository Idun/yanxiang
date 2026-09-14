/**
 * 自动（AutoView）界面中间区阅读停留位置的记忆。
 *
 * 与文档界面 readingPositionStore 同一套思路，但只记一份（自动界面是单一
 * 纵向滚动的大正文流）：
 * - 绝对像素优先：正文内容没变（只是切走又切回、或重启）→ 逐像素回到原处；
 * - 内容长度变了（新增 AI 产出 / 删除 / 流式续写导致重排）→ 退回按比例定位，
 *   不至于跳回文首或文末。
 *
 * 跨会话由 persistenceBootstrap 以 settings 里的 autoReadingPosition 落库。
 */

import { reactive } from "vue";

export interface AutoReadingPosition {
  /** 中间区 scrollTop（px）。 */
  scrollTop: number;
  /** 滚动比例 0~1，内容重排后的兜底。 */
  ratio: number;
  /** 记录时的内容签名，用来判断能否直接用绝对像素。 */
  signature: string;
  updatedAt: number;
}

export const autoReadingPositionStore = reactive({
  main: null as AutoReadingPosition | null,
});

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

/** 记一次自动界面中间区的阅读位置；滚回文首（0）时不值得记。 */
export function setAutoReadingPosition(p: {
  scrollTop: number;
  ratio: number;
  signature: string;
}): void {
  const top = typeof p.scrollTop === "number" && Number.isFinite(p.scrollTop) ? Math.max(0, Math.round(p.scrollTop)) : 0;
  const ratio = clamp01(typeof p.ratio === "number" && Number.isFinite(p.ratio) ? p.ratio : 0);
  if (top <= 0) {
    autoReadingPositionStore.main = null;
    return;
  }
  autoReadingPositionStore.main = {
    scrollTop: top,
    ratio,
    signature: String(p.signature ?? ""),
    updatedAt: Date.now(),
  };
}

export function getAutoReadingPosition(): AutoReadingPosition | undefined {
  return autoReadingPositionStore.main ?? undefined;
}

/** 依据记忆算出应当滚到的像素位置。 */
export function resolveAutoScrollTop(max: number, signature: string): number {
  const saved = autoReadingPositionStore.main;
  if (!saved || max <= 0) return 0;
  /* 内容没变过 → 绝对像素最准；变过 → 按比例落点。 */
  const raw = saved.signature === signature ? saved.scrollTop : saved.ratio * max;
  return Math.min(max, Math.max(0, Math.round(raw)));
}

export function exportAutoReadingPosition(): AutoReadingPosition | null {
  const p = autoReadingPositionStore.main;
  return p ? { ...p } : null;
}

export function importAutoReadingPosition(raw: unknown): void {
  if (!raw || typeof raw !== "object") {
    autoReadingPositionStore.main = null;
    return;
  }
  const v = raw as Record<string, unknown>;
  autoReadingPositionStore.main = {
    scrollTop: typeof v.scrollTop === "number" ? Math.max(0, Math.round(v.scrollTop)) : 0,
    ratio: clamp01(typeof v.ratio === "number" ? v.ratio : 0),
    signature: typeof v.signature === "string" ? v.signature : "",
    updatedAt: typeof v.updatedAt === "number" ? v.updatedAt : Date.now(),
  };
}