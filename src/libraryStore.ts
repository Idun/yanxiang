import { reactive } from "vue";

export interface CardGroup {
  id: string;
  title: string;
  color?: string;
  /** 画布上该组折叠为文件夹（true）还是展开为面板（false）。持久化。 */
  folded?: boolean;
  /** 卡片列表侧栏该组的折叠状态。持久化。 */
  collapsed?: boolean;
}

export interface WritingCard {
  id: number;
  title: string;
  content: string;
  x?: number;
  y?: number;
  groupId?: string;
  /** Explicit top-strip colour. When absent the palette is derived from `id`. */
  accent?: string;
  /** When true the card is pinned to the top of its list. */
  pinned?: boolean;
}

/** Palette offered for the card top strip. */
export const CARD_ACCENTS = ["#FFFADD", "#F2F9F1", "#8CB5F7", "#C9E9B7", "#D3E3FA", "#FBF0EA"];

/**
 * Resolve a card's strip colour.
 *
 * An explicit `accent` always wins. Otherwise the colour is derived from the
 * card id with FNV-1a: the spread looks random but is stable across re-renders
 * and restarts, so a card never changes colour on its own.
 */
export function resolveCardAccent(card: Pick<WritingCard, "id" | "accent">): string {
  if (card.accent) return card.accent;
  let hash = 2166136261;
  const key = String(card.id);
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return CARD_ACCENTS[Math.abs(hash) % CARD_ACCENTS.length];
}

export const libraryStore = reactive({
  cards: [] as WritingCard[],
  groups: [] as CardGroup[],
});