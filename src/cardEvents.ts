import { reactive } from "vue";

interface CardRequest {
  title: string;
  content: string;
}

export interface DragCardPayload {
  title: string;
  content: string;
}

export const cardEvents = reactive({
  pending: null as CardRequest | null,
  newChatRequest: 0 as number,
  /** Increment to ask the writing canvas to open the story-map overlay. */
  openMapRequest: 0 as number,
  /** Increment to close the story-map overlay (e.g. when leaving the library tab). */
  closeMapRequest: 0 as number,
  /** True while an AI reply is being long-press dragged towards the canvas. */
  isDraggingMessage: false,
  dragPayload: null as DragCardPayload | null,
  /** Live cursor position during a long-press drag, so drop zones can highlight. */
  dragPointer: null as { x: number; y: number } | null,
});

export function requestCreateCard(title: string, content: string) {
  cardEvents.pending = { title, content };
}

export function requestNewChat() {
  cardEvents.newChatRequest++;
}

/** Ask the writing canvas to open the story-map overlay (e.g. home 地图地点). */
export function requestOpenMap() {
  cardEvents.openMapRequest++;
}

/** Ask the writing canvas to close the story-map overlay (e.g. leaving library tab). */
export function requestCloseMap() {
  cardEvents.closeMapRequest++;
}

/* ---------------- canvas drop zone registry ---------------- */

export interface CardDropZone {
  /** The element the pointer must be over for the drop to count. */
  element: () => HTMLElement | null;
  /** Create the card. Receives viewport coordinates. */
  drop: (payload: DragCardPayload, x: number, y: number) => void;
}

let dropZone: CardDropZone | null = null;

export function registerCardDropZone(zone: CardDropZone) {
  dropZone = zone;
}

export function unregisterCardDropZone(zone: CardDropZone) {
  if (dropZone === zone) dropZone = null;
}

function hitTest(x: number, y: number): boolean {
  const el = dropZone?.element();
  if (!el) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** Is the pointer currently over the registered canvas? */
export function isOverCardDropZone(x: number, y: number): boolean {
  return hitTest(x, y);
}

/** Commit the drag payload at (x, y). Returns true when a card was created. */
export function commitCardDrop(x: number, y: number): boolean {
  if (!cardEvents.dragPayload || !dropZone || !hitTest(x, y)) return false;
  dropZone.drop(cardEvents.dragPayload, x, y);
  return true;
}
