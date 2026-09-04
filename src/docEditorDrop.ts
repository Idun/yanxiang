import { reactive } from "vue";

/**
 * 文档界面专用的「AI 回复拖入编辑区」机制。
 *
 * 与写作界面「拖 AI 回复到画布生成文本卡片」完全解耦：卡片拖拽走 cardEvents +
 * registerCardDropZone（拖拽一开始 App.vue 还会把主界面切到写作画布），这里
 * 只管文档编辑区自身的落点，不共享任何卡片拖拽状态 / 落点注册，也不会切换
 * 主标签页。两套机制互不联通、互不影响。
 */

export interface DocEditorDropTarget {
  /** 可接收落点的文档编辑区 textarea（隐藏 / 卸载时返回 null）。 */
  element: () => HTMLTextAreaElement | null;
  /** 把 content 插入到 (x, y) 处最近的光标位置；插入成功返回 true。 */
  drop: (content: string, x: number, y: number) => boolean;
  /** 可选：所在文档的 id（供块拖拽跨分栏定位目标编辑区）。 */
  docId?: () => string | null;
  /** 可选：把一整块内容插入到指定行。用于块拖拽 / 块引用的落点。 */
  dropBlock?: (content: string, lineIndex: number) => boolean;
}

/** 文档界面拖拽的独立状态：拖拽中 / 实时指针位置（供编辑区悬浮高亮用）。 */
export const docEditorDrag = reactive({
  isDragging: false,
  pointer: null as { x: number; y: number } | null,
});

/* ---------------- 块拖拽与块引用机制 ---------------- */

export interface DocBlockPayload {
  sourceDocId: string;
  sourceDocTitle: string;
  blockIndex: number;
  blockText: string;
}

export const docBlockDrag = reactive({
  isDragging: false,
  payload: null as DocBlockPayload | null,
  targetDocId: null as string | null,
  targetLineIndex: -1 as number,
  targetTopPx: 0 as number,
  pointerX: 0 as number,
  pointerY: 0 as number,
});

export function startBlockDrag(payload: DocBlockPayload, startX: number, startY: number) {
  docBlockDrag.isDragging = true;
  docBlockDrag.payload = payload;
  docBlockDrag.pointerX = startX;
  docBlockDrag.pointerY = startY;
  docBlockDrag.targetDocId = null;
  docBlockDrag.targetLineIndex = -1;
  docBlockDrag.targetTopPx = 0;
}

export function endBlockDrag() {
  docBlockDrag.isDragging = false;
  docBlockDrag.payload = null;
  docBlockDrag.targetDocId = null;
  docBlockDrag.targetLineIndex = -1;
  docBlockDrag.targetTopPx = 0;
}

const targets = new Set<DocEditorDropTarget>();

export function registerDocEditorTarget(target: DocEditorDropTarget): void {
  targets.add(target);
}

export function unregisterDocEditorTarget(target: DocEditorDropTarget): void {
  targets.delete(target);
}

function hitTest(el: HTMLTextAreaElement, x: number, y: number): boolean {
  const rect = el.getBoundingClientRect();
  /* 隐藏（非当前标签页）或被滚动出可视区时宽度/高度为 0，直接判定为未命中。 */
  if (rect.width === 0 || rect.height === 0) return false;
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** 返回视口坐标 (x, y) 所在的那一个文档编辑区；不在任何编辑区上时为 null。 */
export function docEditorTargetAt(x: number, y: number): DocEditorDropTarget | null {
  for (const target of targets) {
    const el = target.element();
    if (el && hitTest(el, x, y)) return target;
  }
  return null;
}

/** 按文档 id 查落点（供块拖拽跨分栏把块引用落到另一个面板的正文里）。 */
export function findDocEditorTargetByDocId(docId: string): DocEditorDropTarget | null {
  for (const target of targets) {
    if (target.docId && target.docId() === docId) return target;
  }
  return null;
}

/** 把 content 在与 (x, y) 最近的编辑区光标处插入；没有落在编辑区上返回 false。 */
export function commitDocEditorDrop(x: number, y: number, content: string): boolean {
  const target = docEditorTargetAt(x, y);
  if (!target) return false;
  return target.drop(content, x, y);
}