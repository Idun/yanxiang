/**
 * 阅读进度圆环的摆放位置。
 *
 * 位置以「归一化坐标」记录：nx / ny ∈ [0, 1] 表示圆环在可摆放矩形内的相对位置
 * （0 = 贴左 / 贴顶，1 = 贴右 / 贴底）。这样分栏宽度、窗口大小、圆环直径变化后，
 * 圆环仍停在用户放的那个「角落 / 边」上，而不是被裁到面板外面。
 *
 * 初始状态 { nx: 1, ny: 0 } 即右上角。
 *
 * slot 是「界面位点」而非单条文档：文档编辑区 / 文档预览区 / 分栏副编辑区 /
 * 画布卡片编辑框 / 拼接弹窗各记一份，跨会话由 persistenceBootstrap 落库。
 */

import { reactive } from "vue";

export interface RingPosition {
  nx: number;
  ny: number;
}

/** 初始位置：编辑框内部右上角。 */
export const DEFAULT_RING_POSITION: Readonly<RingPosition> = { nx: 1, ny: 0 };

/** 直径可调区间：44px 为上限（最初设计值），28px 为下限（三位数百分比仍清晰）。 */
export const RING_SIZE_MAX = 44;
export const RING_SIZE_MIN = 28;
export const RING_SIZE_DEFAULT = 34;

/** 不透明度（%）：100 = 当前设计值（环体 0.66 / 目录 0.62 的白玻璃），30 为下限。 */
export const RING_OPACITY_MAX = 100;
export const RING_OPACITY_MIN = 30;
export const RING_OPACITY_DEFAULT = 100;

export const readingRingStore = reactive({
  positions: {} as Record<string, RingPosition>,
});

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export function clampRingSize(n: number): number {
  if (!Number.isFinite(n)) return RING_SIZE_DEFAULT;
  return Math.min(RING_SIZE_MAX, Math.max(RING_SIZE_MIN, Math.round(n)));
}

export function clampRingOpacity(n: number): number {
  if (!Number.isFinite(n)) return RING_OPACITY_DEFAULT;
  return Math.min(RING_OPACITY_MAX, Math.max(RING_OPACITY_MIN, Math.round(n)));
}

export function getRingPosition(slot: string): RingPosition {
  return readingRingStore.positions[slot] ?? { ...DEFAULT_RING_POSITION };
}

export function setRingPosition(slot: string, pos: RingPosition): void {
  readingRingStore.positions[slot] = { nx: clamp01(pos.nx), ny: clamp01(pos.ny) };
}

export function exportRingPositions(): Record<string, RingPosition> {
  const out: Record<string, RingPosition> = {};
  for (const [slot, pos] of Object.entries(readingRingStore.positions)) {
    out[slot] = { nx: pos.nx, ny: pos.ny };
  }
  return out;
}

export function importRingPositions(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const next: Record<string, RingPosition> = {};
  for (const [slot, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const { nx, ny } = value as { nx?: unknown; ny?: unknown };
    if (typeof nx !== "number" || typeof ny !== "number") continue;
    next[slot] = { nx: clamp01(nx), ny: clamp01(ny) };
  }
  readingRingStore.positions = next;
}
