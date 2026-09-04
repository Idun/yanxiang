<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  cardEvents,
  isOverCardDropZone,
  registerCardDropZone,
  requestNewChat,
  unregisterCardDropZone,
  type CardDropZone,
  type DragCardPayload,
} from "../cardEvents";
import { addCardAttachment } from "../attachments";
import { CARD_ACCENTS, libraryStore, resolveCardAccent, type WritingCard, type CardGroup } from "../libraryStore";
import { saveCardGroups, saveWritingCards } from "../persistence";
import { showToast } from "../insightStore";
import { createDocFile, documentFilesStore } from "../documentFilesStore";
import { docStore } from "../docStore";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FilePlus,
  Folder,
  FolderOpen,
  Hand,
  Layers,
  LayoutGrid,
  List,
  Map as MapIcon,
  MapPin,
  Maximize2,
  Minimize2,
  MousePointer2,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Trash2,
  Unlink,
  X,
  ZoomIn,
  ZoomOut,
  BookOpen,
  GitCompare,
} from "lucide-vue-next";
import DocumentViewer from "./DocumentViewer.vue";
import MapView from "./MapView.vue";
import CardStitchModal from "./CardStitchModal.vue";
import {
  attachCard,
  detachCard,
  findPlace,
  findPath,
  mapStore,
  placeOfCard,
} from "../mapStore";

const props = defineProps<{
  /** Current right-panel state, so the map can restore it on close. */
  sidebarOpen?: boolean;
}>();

const cards = computed(() => libraryStore.cards);

/* Internal clipboard cache to avoid permission prompt on paste */
let internalClipboardText = "";
/** Cards whose editor panels are currently open (multiple allowed). */
interface OpenEditor {
  card: WritingCard;
  x: number;
  y: number;
  w: number;
  h: number;
}
const openEditors = ref<OpenEditor[]>([]);
let editorCascade = 0;
/* 被拖拽/点击的面板提到最上层，确保其顶栏跟随自身而非压在下方。 */
const editorFrontId = ref<number | null>(null);
const libraryRootEl = ref<HTMLElement | null>(null);
const canvasZoom = ref(1);
const panOffset = ref({ x: 0, y: 0 });
const isDraggingOver = ref(false);

/* --- Card Absolute Position & Dragging --- */
function getCardPos(card: WritingCard, index: number): { x: number; y: number } {
  if (typeof card.x === "number" && typeof card.y === "number") {
    return { x: card.x, y: card.y };
  }
  const col = index % 3;
  const row = Math.floor(index / 3);
  const x = 60 + col * 300;
  const y = 60 + row * 282;
  card.x = x;
  card.y = y;
  return { x, y };
}

const isDraggingCard = ref(false);
const dragStartPos = ref({ x: 0, y: 0 });
const initialCardPosMap = ref<Map<number, { x: number; y: number }>>(new Map());

function startCardDrag(cardId: number, event: MouseEvent) {
  if (event.button !== 0) return;
  if (isPanActive()) {
    startPan(event);
    return;
  }
  toggleCardSelection(cardId, event);

  isDraggingCard.value = true;
  dragStartPos.value = { x: event.clientX, y: event.clientY };

  const initialMap = new Map<number, { x: number; y: number }>();
  cards.value.forEach((c, idx) => {
    if (selectedIds.value.has(c.id)) {
      initialMap.set(c.id, getCardPos(c, idx));
    }
  });
  initialCardPosMap.value = initialMap;

  window.addEventListener("pointermove", windowCardDragMove);
  window.addEventListener("pointerup", windowCardDragEnd);
  window.addEventListener("pointercancel", windowCardDragEnd);
}

function windowCardDragMove(event: PointerEvent) {
  if (!isDraggingCard.value) return;
  const dx = (event.clientX - dragStartPos.value.x) / canvasZoom.value;
  const dy = (event.clientY - dragStartPos.value.y) / canvasZoom.value;

  cards.value.forEach((c) => {
    const initial = initialCardPosMap.value.get(c.id);
    if (initial) {
      c.x = Math.round(initial.x + dx);
      c.y = Math.round(initial.y + dy);
    }
  });
}

function windowCardDragEnd() {
  isDraggingCard.value = false;
  window.removeEventListener("pointermove", windowCardDragMove);
  window.removeEventListener("pointerup", windowCardDragEnd);
  window.removeEventListener("pointercancel", windowCardDragEnd);
}

/* --- Card Grouping Mechanism --- */

/** 立即持久化组定义（打组框）。仅依赖 watch 存在重启后组框丢失的风险，
    故在每次分组/解散/删除后显式落库，并把错误打出来而不是静默吞掉。 */
function persistCardGroupsNow() {
  saveCardGroups(
    libraryStore.groups.map((g) => ({
      id: g.id,
      title: g.title,
      color: g.color,
      folded: g.folded,
      collapsed: g.collapsed,
    })),
  ).catch((err) => console.error("saveCardGroups failed:", err));
}

/** 立即持久化卡片（含 groupId），保证打组后 group_id 一定落库。 */
function persistCardsNow() {
  saveWritingCards(
    libraryStore.cards.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      x: c.x,
      y: c.y,
      groupId: c.groupId,
    })),
  ).catch((err) => console.error("saveWritingCards failed:", err));
}

function groupSelectedCards() {
  const selected = getSelectedCards();
  if (selected.length === 0) return;

  const groupNumber = libraryStore.groups.length + 1;
  const newGroup: CardGroup = {
    id: `group_${Date.now()}`,
    title: `分组 ${groupNumber}`,
  };
  /* 整体替换数组引用，确保 groups 监听必然触发（push 偶发不触发监听）。 */
  libraryStore.groups = [...libraryStore.groups, newGroup];

  selected.forEach((card) => {
    card.groupId = newGroup.id;
  });
  persistCardGroupsNow();
  persistCardsNow();
  showToast("已打组", `已将 ${selected.length} 张卡片合成打组`, "habit");
}

function ungroupSelectedCards() {
  const selected = getSelectedCards();
  if (selected.length === 0) return;

  selected.forEach((card) => {
    card.groupId = undefined;
  });
  cleanupEmptyGroups();
  persistCardGroupsNow();
  persistCardsNow();
  showToast("已解散分组", `已取消 ${selected.length} 张卡片的分组`, "habit");
}

function cleanupEmptyGroups() {
  const usedGroupIds = new Set(cards.value.map((c) => c.groupId).filter(Boolean));
  libraryStore.groups = libraryStore.groups.filter((g) => usedGroupIds.has(g.id));
}

function deleteGroup(groupId: string) {
  cards.value.forEach((c) => {
    if (c.groupId === groupId) c.groupId = undefined;
  });
  libraryStore.groups = libraryStore.groups.filter((g) => g.id !== groupId);
  persistCardGroupsNow();
  persistCardsNow();
}

const canvasFoldedGroups = ref<Set<string>>(new Set());
/* 打组框锁：锁定后整组不可被拖动，等待解除恢复。 */
const lockedGroupIds = ref<Set<string>>(new Set());

function toggleGroupLock(groupId: string) {
  const next = new Set(lockedGroupIds.value);
  if (next.has(groupId)) next.delete(groupId);
  else next.add(groupId);
  lockedGroupIds.value = next;
}

function toggleCanvasGroupFold(groupId: string) {
  const next = new Set(canvasFoldedGroups.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  canvasFoldedGroups.value = next;
  /* 折叠/展开随组定义落库，重启后恢复原状。 */
  const group = libraryStore.groups.find((g) => g.id === groupId);
  if (group) {
    group.folded = next.has(groupId);
    persistCardGroupsNow();
  }
}

const allCanvasGroupsFolded = computed(() => {
  if (libraryStore.groups.length === 0) return false;
  return libraryStore.groups.every((g) => canvasFoldedGroups.value.has(g.id));
});

function toggleAllCanvasGroups() {
  if (libraryStore.groups.length === 0) return;
  const allFolded = allCanvasGroupsFolded.value;
  const next = new Set<string>();
  if (!allFolded) {
    for (const g of libraryStore.groups) {
      next.add(g.id);
      g.folded = true;
    }
    showToast("已折叠所有打组", `共折叠 ${libraryStore.groups.length} 个打组`, "habit");
  } else {
    for (const g of libraryStore.groups) {
      g.folded = false;
    }
    showToast("已展开所有打组", `共展开 ${libraryStore.groups.length} 个打组`, "habit");
  }
  canvasFoldedGroups.value = next;
  persistCardGroupsNow();
}

function isCardVisibleOnCanvas(card: WritingCard): boolean {
  if (card.groupId && canvasFoldedGroups.value.has(card.groupId)) {
    return false;
  }
  return true;
}

interface GroupBounds {
  group: CardGroup;
  minX: number;
  minY: number;
  width: number;
  height: number;
  cards: WritingCard[];
}

const computedGroupBounds = computed<GroupBounds[]>(() => {
  const result: GroupBounds[] = [];
  libraryStore.groups.forEach((group) => {
    const groupCards = cards.value.filter((c) => c.groupId === group.id);
    if (groupCards.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    groupCards.forEach((c) => {
      const idx = cards.value.indexOf(c);
      const pos = getCardPos(c, idx);
      minX = Math.min(minX, pos.x);
      minY = Math.min(minY, pos.y);
      maxX = Math.max(maxX, pos.x + 280);
      maxY = Math.max(maxY, pos.y + 258);
    });

    const paddingX = 20;
    const paddingYTop = 46;
    const paddingYBottom = 20;

    result.push({
      group,
      minX: minX - paddingX,
      minY: minY - paddingYTop,
      width: Math.max(340, maxX - minX + paddingX * 2),
      height: Math.max(260, maxY - minY + paddingYTop + paddingYBottom),
      cards: groupCards,
    });
  });
  return result;
});

function startGroupDrag(groupId: string, event: MouseEvent) {
  if (event.button !== 0) return;
  event.stopPropagation();
  /* 打组框已锁定：不可移动。 */
  if (lockedGroupIds.value.has(groupId)) return;
  const groupCards = cards.value.filter((c) => c.groupId === groupId);
  if (groupCards.length === 0) return;

  selectedIds.value = new Set(groupCards.map((c) => c.id));

  isDraggingCard.value = true;
  dragStartPos.value = { x: event.clientX, y: event.clientY };

  const initialMap = new Map<number, { x: number; y: number }>();
  groupCards.forEach((c) => {
    initialMap.set(c.id, getCardPos(c, cards.value.indexOf(c)));
  });
  initialCardPosMap.value = initialMap;

  window.addEventListener("pointermove", windowCardDragMove);
  window.addEventListener("pointerup", windowCardDragEnd);
  window.addEventListener("pointercancel", windowCardDragEnd);
}

/* --- Tool mode: select | pan --- */
type CanvasTool = "select" | "pan";
const activeTool = ref<CanvasTool>("select");
const isPanning = ref(false);
const panStart = ref({ x: 0, y: 0 });
const panStartOffset = ref({ x: 0, y: 0 });
const spacePressed = ref(false);

function isPanActive() {
  return activeTool.value === "pan" || spacePressed.value;
}

function startPan(event: MouseEvent) {
  event.preventDefault();
  isPanning.value = true;
  panStart.value = { x: event.clientX, y: event.clientY };
  panStartOffset.value = { x: panOffset.value.x, y: panOffset.value.y };

  window.addEventListener("pointermove", windowPanMove);
  window.addEventListener("pointerup", windowPanEnd);
  window.addEventListener("pointercancel", windowPanEnd);
}

function windowPanMove(event: PointerEvent) {
  if (!isPanning.value) return;
  const dx = event.clientX - panStart.value.x;
  const dy = event.clientY - panStart.value.y;
  panOffset.value = {
    x: panStartOffset.value.x + dx,
    y: panStartOffset.value.y + dy,
  };
}

function windowPanEnd() {
  isPanning.value = false;
  window.removeEventListener("pointermove", windowPanMove);
  window.removeEventListener("pointerup", windowPanEnd);
  window.removeEventListener("pointercancel", windowPanEnd);
}

function endPan() {
  windowPanEnd();
}

/* --- Box selection --- */
const selectedIds = ref<Set<number>>(new Set());
const isSelecting = ref(false);
const selectionStart = ref({ x: 0, y: 0 });
const selectionEnd = ref({ x: 0, y: 0 });
const canvasScrollRef = ref<HTMLDivElement | null>(null);
const cardElRefs = ref<Map<number, HTMLElement>>(new Map());

/* --- Context menu --- */
interface CtxMenu {
  x: number;
  y: number;
  show: boolean;
  submenu: "agent" | "place" | null;
  onEmpty: boolean;
}
const ctxMenu = ref<CtxMenu>({ x: 0, y: 0, show: false, submenu: null, onEmpty: false });

function getSelectedCards(): WritingCard[] {
  return cards.value.filter((c) => selectedIds.value.has(c.id));
}

/** A collapsed folder counts as selected when any card it holds is selected. */
function isFolderSelected(groupCards: WritingCard[]): boolean {
  return groupCards.some((c) => selectedIds.value.has(c.id));
}

function toggleCardSelection(id: number, event?: MouseEvent) {
  if (event && event.button !== 0) {
    // Right click (button === 2) - keep existing selection if card is already selected
    if (!selectedIds.value.has(id)) {
      selectedIds.value = new Set([id]);
    }
    return;
  }

  if (event?.ctrlKey || event?.metaKey) {
    const next = new Set(selectedIds.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedIds.value = next;
  } else {
    selectedIds.value = new Set([id]);
  }
}

function ctxMenuToggleSub(which: "agent" | "place" = "agent") {
  ctxMenu.value = { ...ctxMenu.value, submenu: ctxMenu.value.submenu === which ? null : which };
}

function clearSelection() {
  selectedIds.value = new Set();
}

function onCanvasMouseDown(event: MouseEvent) {
  if (event.button !== 0) {
    if (isPanActive()) {
      startPan(event);
    }
    return;
  }
  if (isPanActive()) {
    startPan(event);
    return;
  }
  const target = event.target as HTMLElement;
  if (target.closest(".card") || target.closest(".floating-tools") || target.closest(".canvas-toolbar")) return;
  clearSelection();
  isSelecting.value = true;
  selectionStart.value = { x: event.clientX, y: event.clientY };
  selectionEnd.value = { x: event.clientX, y: event.clientY };
}

function onCanvasMouseMove(event: MouseEvent) {
  if (isPanning.value) return;
  if (!isSelecting.value) return;
  selectionEnd.value = { x: event.clientX, y: event.clientY };

  const sel = new Set<number>();
  const sr = normalizeRectVp(selectionStart.value, selectionEnd.value);
  cardElRefs.value.forEach((el, id) => {
    const cr = el.getBoundingClientRect();
    if (rectsIntersectVp(sr, { x: cr.x, y: cr.y, w: cr.width, h: cr.height })) sel.add(id);
  });
  selectedIds.value = sel;
}

function onCanvasMouseUp() {
  isSelecting.value = false;
  endPan();
}

function normalizeRectVp(a: { x: number; y: number }, b: { x: number; y: number }) {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

function rectsIntersectVp(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function selectionVpToCanvas() {
  const rect = canvasScrollRef.value?.getBoundingClientRect();
  if (!rect) return { left: 0, top: 0, width: 0, height: 0 };
  const sx = Math.min(selectionStart.value.x, selectionEnd.value.x);
  const sy = Math.min(selectionStart.value.y, selectionEnd.value.y);
  const ex = Math.max(selectionStart.value.x, selectionEnd.value.x);
  const ey = Math.max(selectionStart.value.y, selectionEnd.value.y);
  return {
    left: sx - rect.left,
    top: sy - rect.top,
    width: ex - sx,
    height: ey - sy,
  };
}

function setCardRef(id: number, el: HTMLElement | null) {
  if (el) cardElRefs.value.set(id, el); else cardElRefs.value.delete(id);
}

/* --- Context menu --- */
function onCanvasContextMenu(event: MouseEvent) {
  event.preventDefault();
  const target = event.target as HTMLElement;
  const cardEl = target.closest(".card") as HTMLElement | null;

  if (!cardEl) {
    ctxMenu.value = { x: event.clientX, y: event.clientY, show: true, submenu: null, onEmpty: true };
    return;
  }

  const cardId = Number(cardEl.dataset.cardId);
  if (!selectedIds.value.has(cardId)) {
    selectedIds.value = new Set([cardId]);
  }

  ctxMenu.value = { x: event.clientX, y: event.clientY, show: true, submenu: null, onEmpty: false };
}

function closeContextMenu() {
  ctxMenu.value = { ...ctxMenu.value, show: false, submenu: null };
}

function ctxMenuAction(action: string) {
  if (action === "paste") {
    if (internalClipboardText) {
      libraryStore.cards.push({
        id: Date.now(),
        title: `粘贴的文本 ${libraryStore.cards.length + 1}`,
        content: internalClipboardText,
      });
    } else {
      navigator.clipboard.readText().then((text) => {
        if (text) {
          libraryStore.cards.push({
            id: Date.now(),
            title: `粘贴的文本 ${libraryStore.cards.length + 1}`,
            content: text,
          });
        }
      }).catch(() => {});
    }
    closeContextMenu();
    return;
  }

  const selected = getSelectedCards();
  if (selected.length === 0) return;

  switch (action) {
    case "group":
      groupSelectedCards();
      break;
    case "ungroup":
      ungroupSelectedCards();
      break;
    case "add-to-input":
      selected.forEach((c) => addCardAttachment(c.title, c.content));
      break;
    case "new-chat":
      requestNewChat();
      break;
    case "copy":
      const copyText = selected.map((c) => c.content).join("\n\n---\n\n");
      internalClipboardText = copyText;
      navigator.clipboard.writeText(copyText).catch(() => {});
      break;
    case "delete":
      const ids = new Set(selected.map((c) => c.id));
      libraryStore.cards = libraryStore.cards.filter((c) => !ids.has(c.id));
      clearSelection();
      cleanupEmptyGroups();
      break;
    case "analyze":
      showToast("已加入洞察分析", `已将 ${selected.length} 张卡片纳入写作风格分析`, "habit");
      closeContextMenu();
      return;
    case "detach-place": {
      let count = 0;
      for (const card of selected) {
        const place = placeOfCard(card.id);
        if (place && detachCard(place.id, card.id)) count++;
      }
      showToast("已取消附着", `${count} 张卡片已从地图地点上取下`, "edit");
      closeContextMenu();
      return;
    }
    case "stitch-preview":
      if (selected.length === 0) {
        showToast("请先选择卡片", "请至少选中一张卡片进行拼文预览", "edit");
        closeContextMenu();
        return;
      }
      stitchModal.value = {
        show: true,
        mode: "preview",
        cards: selected,
      };
      closeContextMenu();
      return;
    case "stitch-compare":
      if (selected.length === 0) {
        showToast("请先选择卡片", "请至少选中卡片进行拼文对比", "edit");
        closeContextMenu();
        return;
      }
      stitchModal.value = {
        show: true,
        mode: "compare",
        cards: selected,
      };
      closeContextMenu();
      return;
  }
  closeContextMenu();
}

/** Pin the current selection onto a map place from the canvas context menu. */
function attachSelectedToPlace(placeId: string) {
  const selected = getSelectedCards();
  const place = findPlace(placeId);
  if (!place || selected.length === 0) return;
  for (const card of selected) attachCard(placeId, card.id);
  showToast("已附着到地图", `${selected.length} 张卡片挂到地点「${place.label}」`, "habit");
  closeContextMenu();
}

/** Places available as attach targets, labelled with their path. */
const mapPlaceOptions = computed(() =>
  mapStore.places.map((pl) => ({
    id: pl.id,
    label: pl.label,
    pathName: findPath(pl.pathId)?.name ?? "路径",
  })),
);

const selectionHasPlace = computed(() =>
  getSelectedCards().some((c) => !!placeOfCard(c.id)),
);

/* --- 卡片列表浮动面板 & 文件夹分类 --- */
const cardListOpen = ref(false);

const emit = defineEmits<{
  (e: "requestSidebar", open: boolean): void;
}>();

/* ---- 地图组件 ---- */
const mapOpen = ref(false);
const stitchModal = ref<{
  show: boolean;
  mode: "preview" | "compare";
  cards: WritingCard[];
}>({
  show: false,
  mode: "preview",
  cards: [],
});

function onStitchSave(_updatedCards: WritingCard[]) {
  persistCardsNow();
}
/** Sidebar state to restore when the map closes. */
let sidebarWasOpen: boolean | null = null;

function toggleMap() {
  setMapOpen(!mapOpen.value);
}

/**
 * The map needs the full width, so opening it collapses the right chat panel
 * and closing it puts the panel back the way the user had it.
 */
function setMapOpen(open: boolean) {
  if (open === mapOpen.value) return;
  mapOpen.value = open;
  if (open) {
    cardListOpen.value = false;
    sidebarWasOpen = props.sidebarOpen ?? null;
    emit("requestSidebar", false);
  } else if (sidebarWasOpen !== null) {
    emit("requestSidebar", sidebarWasOpen);
    sidebarWasOpen = null;
  }
}

/* 主页等入口请求直接打开故事地图（例如「地图地点」项）。 */
watch(
  () => cardEvents.openMapRequest,
  () => {
    if (cardEvents.openMapRequest > 0) setMapOpen(true);
  },
);

/* 离开写作画布等场合请求收起故事地图，避免地图状态滞留造成界面耦合。 */
watch(
  () => cardEvents.closeMapRequest,
  () => {
    if (cardEvents.closeMapRequest > 0) setMapOpen(false);
  },
);

/** 计算让画布坐标 (cx, cy) 居中于可视区域的平移动量。
    画布既有 transform(panOffset) 平移、又被滚动容器滚动（scrollTop/Left）驱动，
    还带容器内边距——这三个量都会影响“框中心”的最终视口位置，必须全部折算。 */
function panCanvasTo(cx: number, cy: number) {
  const scroller = canvasScrollRef.value;
  if (!scroller) return;
  const rect = scroller.getBoundingClientRect();
  const cs = window.getComputedStyle(scroller);
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const padTop = parseFloat(cs.paddingTop) || 0;
  const z = canvasZoom.value;
  /* 内容原点视口坐标 = 容器边框原点 + padding - 当前滚动偏移；
     让 (cx,cy) 经 zoom 缩放后落在容器视觉中心，反推 panOffset。 */
  panOffset.value = {
    x: rect.width / 2 - cx * z + scroller.scrollLeft - padLeft,
    y: rect.height / 2 - cy * z + scroller.scrollTop - padTop,
  };
}

/** 画布平移到以卡片为中心并选中它（供卡片列表快速定位 / 地图跳转复用）。 */
function focusCardOnCanvas(cardId: number) {
  const card = libraryStore.cards.find((c) => c.id === cardId);
  if (!card) return;
  selectedIds.value = new Set([cardId]);
  const pos = getCardPos(card, libraryStore.cards.indexOf(card));
  panCanvasTo(pos.x + 140, pos.y + 129);
}

/** 画布平移到以打组框为中心（供卡片列表选择文件夹 / 快速定位）。 */
function focusGroupOnCanvas(groupId: string) {
  const bounds = computedGroupBounds.value.find((gb) => gb.group.id === groupId);
  if (!bounds) return;
  panCanvasTo(bounds.minX + bounds.width / 2, bounds.minY + bounds.height / 2);
}

/** Jump from a map place to the card it is pinned to, on the canvas. */
function onFocusCardFromMap(cardId: number) {
  const card = libraryStore.cards.find((c) => c.id === cardId);
  if (!card) return;
  setMapOpen(false);
  focusCardOnCanvas(cardId);
  showToast("已定位卡片", card.title, "habit");
}

/* 卡片列表点击卡片：若其所在组处于画布折叠态先展开，再选中并平移画布定位，
   解决卡片被移到屏幕外后难以快速找回的问题。 */
function onListCardClick(cardId: number) {
  const card = libraryStore.cards.find((c) => c.id === cardId);
  if (card && card.groupId && canvasFoldedGroups.value.has(card.groupId)) {
    toggleCanvasGroupFold(card.groupId);
  }
  toggleCardSelection(cardId);
  focusCardOnCanvas(cardId);
}

/* 卡片列表点击文件夹：切换列表折叠 + 画布平移到该打组位置。 */
function onFolderHeaderClick(groupId: string) {
  toggleGroupCollapse(groupId);
  focusGroupOnCanvas(groupId);
}

/** Display name of the map place a card is pinned to. */
function placeLabelOfCard(cardId: number): string {
  const place = placeOfCard(cardId);
  if (!place) return "";
  if (place.label.trim()) return place.label.trim();
  /* Unnamed places fall back to the path name so the chip still means something. */
  return findPath(place.pathId)?.name ?? "地图地点";
}

/** Open the map focused on the place this card is attached to. */
function openMapAtCard(cardId: number) {
  const place = placeOfCard(cardId);
  if (!place) return;
  mapStore.selectedPlaceId = place.id;
  mapStore.activePathId = place.pathId;
  setMapOpen(true);
}
const renamingCardId = ref<number | null>(null);
const renameInput = ref("");
const collapsedGroups = ref<Set<string>>(new Set());

function toggleGroupCollapse(groupId: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  collapsedGroups.value = next;
  /* 折叠/展开随组定义落库，重启后恢复原状。 */
  const group = libraryStore.groups.find((g) => g.id === groupId);
  if (group) {
    group.collapsed = next.has(groupId);
    persistCardGroupsNow();
  }
}

/* 启动/数据恢复后，用落库的 folded/collapsed 初始化画布与侧栏的折叠状态，
   保证重启后打组保持用户离开时的折叠/展开形态。 */
function syncGroupUiState() {
  const folded = new Set<string>();
  const collapsed = new Set<string>();
  for (const g of libraryStore.groups) {
    if (g.folded) folded.add(g.id);
    if (g.collapsed) collapsed.add(g.id);
  }
  canvasFoldedGroups.value = folded;
  collapsedGroups.value = collapsed;
}

watch(
  () => libraryStore.groups,
  () => syncGroupUiState(),
  { immediate: true },
);

/** Pinned cards float to the top, preserving relative order. */
function pinnedFirst(list: WritingCard[]): WritingCard[] {
  return list.slice().sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned));
}

const allCardsPinnedFirst = computed(() => pinnedFirst(cards.value));
const cardsInGroup = (groupId: string) => pinnedFirst(cards.value.filter((c) => c.groupId === groupId));
const ungroupedCards = computed(() => pinnedFirst(cards.value.filter((c) => !c.groupId)));

interface ListCtxMenu {
  x: number;
  y: number;
  show: boolean;
  cardId: number | null;
}
const listCtxMenu = ref<ListCtxMenu>({ x: 0, y: 0, show: false, cardId: null });

function toggleCardList() {
  cardListOpen.value = !cardListOpen.value;
  listCtxMenu.value.show = false;
}

function onListContextMenu(event: MouseEvent, cardId: number) {
  event.preventDefault();
  listCtxMenu.value = { x: event.clientX, y: event.clientY, show: true, cardId };
}

function closeListCtxMenu() {
  listCtxMenu.value = { ...listCtxMenu.value, show: false };
}

function listAction(action: string) {
  const id = listCtxMenu.value.cardId;
  if (id === null) { closeListCtxMenu(); return; }
  const card = libraryStore.cards.find(c => c.id === id);
  if (!card) { closeListCtxMenu(); return; }

  switch (action) {
    case "rename":
      renamingCardId.value = id;
      renameInput.value = card.title;
      closeListCtxMenu();
      return;
    case "copy":
      internalClipboardText = card.content;
      navigator.clipboard.writeText(card.content).catch(() => {});
      break;
    case "paste":
      if (internalClipboardText) {
        libraryStore.cards.push({
          id: Date.now(),
          title: `粘贴的文本 ${libraryStore.cards.length + 1}`,
          content: internalClipboardText,
        });
      }
      break;
    case "delete":
      libraryStore.cards = libraryStore.cards.filter(c => c.id !== id);
      selectedIds.value.delete(id);
      break;
  }
  closeListCtxMenu();
}

function confirmRename() {
  if (renamingCardId.value !== null && renameInput.value.trim()) {
    const card = libraryStore.cards.find(c => c.id === renamingCardId.value);
    if (card) card.title = renameInput.value.trim();
  }
  renamingCardId.value = null;
  renameInput.value = "";
}

/* --- Original functions --- */
/** 在画布可视区域内给新面板取一个居中的初始位置。 */
function centeredPanelRect() {
  const rect = libraryRootEl.value?.getBoundingClientRect();
  const cw = rect?.width || window.innerWidth;
  const ch = rect?.height || window.innerHeight;
  const cx = (rect?.left ?? 0) + cw / 2;
  const cy = (rect?.top ?? 0) + ch / 2;
  return {
    x: Math.round(cx - Math.min(430, cw / 2 - 20) + editorCascade * 26),
    y: Math.round(cy - Math.min(330, ch / 2 - 20) + editorCascade * 22),
    w: Math.min(860, cw - 40),
    h: Math.min(640, ch - 40),
  };
}

/** Open a card's editor. Several panels can stay open side by side. */
function openEditor(card: WritingCard) {
  if (openEditors.value.some((e) => e.card.id === card.id)) return;
  openEditors.value.push({ card, ...centeredPanelRect() });
  editorFrontId.value = card.id;
  editorCascade++;
}

/* 点击/拖拽某个面板时把它提到最上层，并关闭其它未置顶的面板。 */
function raiseEditor(ed: OpenEditor) {
  editorFrontId.value = ed.card.id;
  const next = openEditors.value.filter((e) => e.card.id === ed.card.id || e.card.pinned);
  if (next.length !== openEditors.value.length) openEditors.value = next;
}

/** 该卡片的编辑面板是否已打开（画布上的卡片始终保留，不做消失态）。 */
function isCardEditing(cardId: number): boolean {
  return openEditors.value.some((e) => e.card.id === cardId);
}

function closeEditor(card: WritingCard) {
  openEditors.value = openEditors.value.filter((e) => e.card.id !== card.id);
  if (editorFrontId.value === card.id) {
    const last = openEditors.value[openEditors.value.length - 1];
    editorFrontId.value = last ? last.card.id : null;
  }
}

/** `null` clears the override and falls back to the id-derived colour. */
function setEditingAccent(card: WritingCard, hex: string | null) {
  if (hex) card.accent = hex;
  else delete card.accent;
}

/** Toggle whether the card is pinned. A pinned panel also survives outside clicks. */
function setEditingPinned(card: WritingCard) {
  card.pinned = !card.pinned;
}

/* ---- draggable / resizable panels ---- */

function startPanelDrag(event: MouseEvent, ed: OpenEditor) {
  /* 先提层：即便按在标题输入框/按钮上也要把该面板带到最前。 */
  raiseEditor(ed);
  if ((event.target as HTMLElement).closest("button, input, select")) return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY, ox: ed.x, oy: ed.y };
  const move = (e: PointerEvent) => {
    ed.x = start.ox + (e.clientX - start.x);
    ed.y = Math.max(0, start.oy + (e.clientY - start.y));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startPanelResize(event: MouseEvent, ed: OpenEditor) {
  event.preventDefault();
  event.stopPropagation();
  const start = { x: event.clientX, y: event.clientY, ow: ed.w, oh: ed.h };
  const move = (e: PointerEvent) => {
    ed.w = Math.max(420, Math.min(window.innerWidth - 40, start.ow + (e.clientX - start.x)));
    ed.h = Math.max(300, Math.min(window.innerHeight - 40, start.oh + (e.clientY - start.y)));
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* 非置顶面板：点击空白处自动关闭；置顶面板保留。 */
function onEditorLayerMouseDown(event: MouseEvent) {
  if (openEditors.value.length === 0) return;
  const target = event.target as HTMLElement | null;
  if (target && target.closest(".modal-shell")) return;
  /* Ctrl+K 行内 AI 浮层、手机高保真模拟预览都 Teleport 到 body，在面板之外，
     点它们（切夜间、改字号、翻章节等）不应把宿主编辑面板一起关掉。 */
  if (target && target.closest(".iae-root")) return;
  if (target && target.closest(".mobile-preview-mask")) return;
  openEditors.value = openEditors.value.filter((e) => e.card.pinned);
}

function addCard() {
  const draftCard: WritingCard = {
    id: Date.now(),
    title: `文本卡片 ${libraryStore.cards.length + 1}`,
    content: "",
  };
  /* 先只打开编辑器；只有点击「完成」后才会真正创建到画布。 */
  openEditor(draftCard);
}

function finishEditor(card: WritingCard) {
  if (!libraryStore.cards.some((c) => c.id === card.id)) {
    libraryStore.cards.push(card);
  }
  closeEditor(card);
}

function deleteCard(id: number) {
  libraryStore.cards = libraryStore.cards.filter((card) => card.id !== id);
}

async function copyCard(card: WritingCard) {
  internalClipboardText = card.content;
  try {
    await navigator.clipboard.writeText(card.content);
  } catch {
    // Clipboard may be unavailable in some WebView environments.
  }
}

/** 把卡片正文作为一条新文档条目加入文档界面（不影响卡片本身）。 */
function addCardToDocument(card: WritingCard) {
  const content = card.content.trim();
  if (!content) {
    showToast("加入失败", "该卡片没有可加入文档的内容", "edit");
    return;
  }
  const title =
    card.title?.trim() ||
    content
      .split("\n")[0]
      .replace(/[#>*`_~[\]]/g, "")
      .trim()
      .slice(0, 24) ||
    "未命名文档";
  const file = createDocFile(null, title);
  file.content = content;
  documentFilesStore.activeFileId = file.id;
  /* 同步到主文档编辑区，用户可立即在「文档」中看到并继续编辑。 */
  docStore.markdown = content;
  showToast("已加入文档", `「${file.title}」已成为文档条目`, "habit");
}

function onDragOver(event: DragEvent) {
  event.preventDefault();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  isDraggingOver.value = true;
}

function onDrop(event: DragEvent) {
  event.preventDefault();
  isDraggingOver.value = false;

  let title = "拖入的文本卡片";
  let content = "";

  if (cardEvents.dragPayload) {
    title = cardEvents.dragPayload.title || title;
    content = cardEvents.dragPayload.content || "";
  }

  if (!content) {
    const raw =
      event.dataTransfer?.getData("application/x-docintel-card") ||
      event.dataTransfer?.getData("text/plain");
    if (raw) {
      content = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.content === "string") {
          title = parsed.title || title;
          content = parsed.content;
        }
      } catch {
        // Plain text
      }
    }
  }

  if (!content) return;

  createCardAtViewportPoint({ title, content }, event.clientX, event.clientY);
}

/** Convert viewport coordinates into canvas space and drop a new card there. */
function createCardAtViewportPoint(payload: DragCardPayload, clientX: number, clientY: number) {
  const rect = canvasScrollRef.value?.getBoundingClientRect();
  let x = 60;
  let y = 60;
  if (rect) {
    x = Math.max(20, Math.round((clientX - rect.left - panOffset.value.x) / canvasZoom.value));
    y = Math.max(20, Math.round((clientY - rect.top - panOffset.value.y) / canvasZoom.value));
  }

  libraryStore.cards.push({
    id: Date.now(),
    title: payload.title || "拖入的文本卡片",
    content: payload.content,
    x,
    y,
  });

  showToast("生成文本卡片", "已将 AI 回复放入画布", "habit");
}

/* The chat sidebar drives a pointer-based long-press drag rather than HTML5
   drag-and-drop, so the canvas registers itself as a hit-testable drop zone. */
const cardDropZone: CardDropZone = {
  element: () => canvasScrollRef.value,
  drop: (payload, x, y) => createCardAtViewportPoint(payload, x, y),
};

/* Highlight the canvas while a reply hovers over it. */
watch(
  () => cardEvents.dragPointer,
  (pointer) => {
    if (!pointer || !cardEvents.isDraggingMessage) {
      if (!cardEvents.isDraggingMessage) isDraggingOver.value = false;
      return;
    }
    isDraggingOver.value = isOverCardDropZone(pointer.x, pointer.y);
  },
);

watch(
  () => cardEvents.isDraggingMessage,
  (dragging) => {
    if (!dragging) isDraggingOver.value = false;
  },
);

onMounted(() => registerCardDropZone(cardDropZone));
onBeforeUnmount(() => unregisterCardDropZone(cardDropZone));

function arrangeCards() {
  if (cards.value.length === 0) return;

  const cols = cards.value.length > 8 ? 4 : 3;
  const cardWidth = 300;
  const cardHeight = 282;
  const startX = 60;
  const startY = 60;

  const groupMap = new Map<string, WritingCard[]>();
  const ungrouped: WritingCard[] = [];

  cards.value.forEach((card) => {
    if (card.groupId) {
      if (!groupMap.has(card.groupId)) {
        groupMap.set(card.groupId, []);
      }
      groupMap.get(card.groupId)!.push(card);
    } else {
      ungrouped.push(card);
    }
  });

  let currentCardIndex = 0;

  groupMap.forEach((groupCards) => {
    groupCards.forEach((c) => {
      const col = currentCardIndex % cols;
      const row = Math.floor(currentCardIndex / cols);
      c.x = startX + col * cardWidth;
      c.y = startY + row * cardHeight;
      currentCardIndex++;
    });
  });

  ungrouped.forEach((c) => {
    const col = currentCardIndex % cols;
    const row = Math.floor(currentCardIndex / cols);
    c.x = startX + col * cardWidth;
    c.y = startY + row * cardHeight;
    currentCardIndex++;
  });

  showToast("一键对齐整理", `已将 ${cards.value.length} 张文本卡片整齐排列布局`, "habit");
}

function resetZoom() {
  canvasZoom.value = 1;
  panOffset.value = { x: 0, y: 0 };
}

function onCanvasWheel(e: WheelEvent) {
  if (!e.altKey) {
    return; // Allow standard scroll behavior when Alt is not pressed
  }
  e.preventDefault();

  const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
  const oldZoom = canvasZoom.value;
  let newZoom = Math.min(Math.max(0.3, oldZoom * zoomFactor), 2.5);
  newZoom = Math.round(newZoom * 100) / 100;
  if (newZoom === oldZoom) return;

  const rect = canvasScrollRef.value?.getBoundingClientRect();
  if (!rect) return;

  let centerX = e.clientX;
  let centerY = e.clientY;

  if (selectedIds.value.size > 0) {
    let minLeft = Infinity;
    let minTop = Infinity;
    let maxRight = -Infinity;
    let maxBottom = -Infinity;
    let count = 0;

    selectedIds.value.forEach((id) => {
      const el = cardElRefs.value.get(id);
      if (el) {
        const cr = el.getBoundingClientRect();
        minLeft = Math.min(minLeft, cr.left);
        minTop = Math.min(minTop, cr.top);
        maxRight = Math.max(maxRight, cr.right);
        maxBottom = Math.max(maxBottom, cr.bottom);
        count++;
      }
    });

    if (count > 0) {
      centerX = (minLeft + maxRight) / 2;
      centerY = (minTop + maxBottom) / 2;
    }
  }

  const mx = centerX - rect.left;
  const my = centerY - rect.top;

  panOffset.value = {
    x: mx - (mx - panOffset.value.x) * (newZoom / oldZoom),
    y: my - (my - panOffset.value.y) * (newZoom / oldZoom),
  };
  canvasZoom.value = newZoom;
}

function plainSnippet(content: string): string {
  return content
    .replace(/[#>*`_~[\]()!-]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

watch(
  () => cardEvents.pending,
  (pending) => {
    if (pending) {
      const card = {
        id: Date.now(),
        title: pending.title,
        content: pending.content,
      };
      libraryStore.cards.push(card);
      cardEvents.pending = null;
    }
  },
);

/* Close context menu and floating card list on outside click */
function onDocClick(e: MouseEvent) {
  if (ctxMenu.value.show) closeContextMenu();
  if (listCtxMenu.value.show) closeListCtxMenu();
  if (cardListOpen.value) {
    const target = e.target as HTMLElement | null;
    if (target && !target.closest(".card-list-panel") && !target.closest(".card-list-toggle-btn")) {
      cardListOpen.value = false;
    }
  }
}

function handleGlobalPaste(e: ClipboardEvent) {
  // If modal editor or an input element is open/focused, let native paste handle it
  const activeEl = document.activeElement as HTMLElement | null;
  if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
    return;
  }
  const text = e.clipboardData?.getData("text/plain");
  if (text) {
    e.preventDefault();
    internalClipboardText = text;
    libraryStore.cards.push({
      id: Date.now(),
      title: `粘贴的文本 ${libraryStore.cards.length + 1}`,
      content: text,
    });
  }
}

function handleCanvasKeyDown(e: KeyboardEvent) {
  if ((e.code === "KeyP" || e.code === "KeyC") && (e.ctrlKey || e.metaKey) && e.shiftKey) {
    const activeEl = document.activeElement as HTMLElement | null;
    const typing =
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.isContentEditable);
    if (!typing) {
      e.preventDefault();
      const selected = getSelectedCards();
      const targetCards = selected.length > 0 ? selected : cards.value;
      if (targetCards.length === 0) return;
      stitchModal.value = {
        show: true,
        mode: e.code === "KeyP" ? "preview" : "compare",
        cards: targetCards,
      };
      return;
    }
  }

  if (e.code === "KeyG" && (e.ctrlKey || e.metaKey)) {
    const activeEl = document.activeElement as HTMLElement | null;
    const typing =
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.isContentEditable);
    if (!typing) {
      e.preventDefault();
      if (e.shiftKey) {
        ungroupSelectedCards();
      } else {
        groupSelectedCards();
      }
      return;
    }
  }

  if (e.code === "Space") {
    const activeEl = document.activeElement as HTMLElement | null;
    const typing =
      activeEl &&
      (activeEl.tagName === "INPUT" ||
        activeEl.tagName === "TEXTAREA" ||
        activeEl.isContentEditable);
    if (!typing) {
      e.preventDefault();
      spacePressed.value = true;
    }
  }
}

function handleCanvasKeyUp(e: KeyboardEvent) {
  if (e.code === "Space") {
    spacePressed.value = false;
    endPan();
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", onDocClick);
  document.addEventListener("mousedown", onEditorLayerMouseDown);
  document.addEventListener("paste", handleGlobalPaste);
  document.addEventListener("keydown", handleCanvasKeyDown);
  document.addEventListener("keyup", handleCanvasKeyUp);
}
</script>

<template>
  <div ref="libraryRootEl" class="library-view">
    <div class="library-toolbar">
      <div class="toolbar-left">
        <span class="canvas-hint">文本卡片并排存放，框选卡片后右键菜单操作</span>
      </div>
      <div class="toolbar-right" style="display: flex; align-items: center; gap: 8px;">
        <button
          class="collapse-all-btn"
          :title="allCanvasGroupsFolded ? '一键展开所有打组' : '一键折叠所有打组'"
          @click="toggleAllCanvasGroups"
        >
          <component :is="allCanvasGroupsFolded ? Maximize2 : Minimize2" :size="14" :stroke-width="1.8" />
          <span>{{ allCanvasGroupsFolded ? '全部展开' : '全部折叠' }}</span>
        </button>
        <button class="add-card-btn" title="新建文本卡片" @click="addCard">
          <Plus :size="15" :stroke-width="1.8" />
          新建卡片
        </button>
      </div>
    </div>

    <div class="floating-tools">
        <button
          class="floating-btn"
          :class="{ active: activeTool === 'select' }"
          title="选择"
          @click="activeTool = 'select'"
        >
          <MousePointer2 :size="18" :stroke-width="1.8" />
        </button>
        <button
          class="floating-btn"
          :class="{ active: activeTool === 'pan' }"
          title="移动画布"
          @click="activeTool = 'pan'"
        >
          <Hand :size="18" :stroke-width="1.8" />
        </button>
        <button
          class="floating-btn card-list-toggle-btn"
          :class="{ active: cardListOpen }"
          title="卡片列表"
          @click="toggleCardList"
        >
          <List :size="18" :stroke-width="1.8" />
        </button>
        <span class="floating-divider"></span>
        <button
          class="floating-btn"
          :class="{ active: mapOpen }"
          title="地图：绘制路径、标注地点、附着卡片"
          @click="toggleMap"
        >
          <MapIcon :size="18" :stroke-width="1.8" />
        </button>
      </div>

      <!-- 地图组件（独立文件 MapView.vue） -->
      <MapView v-if="mapOpen" @close="setMapOpen(false)" @focusCard="onFocusCardFromMap" />

      <!-- 卡片列表浮动面板 -->
      <Transition name="panel-slide">
        <div v-if="cardListOpen" class="card-list-panel" @click.stop>
          <div class="card-list-header">
            <span class="card-list-title">文本卡片 ({{ cards.length }})</span>
            <button class="card-list-close" @click="cardListOpen = false"><X :size="14" /></button>
          </div>
          <div class="card-list-scroll">
            <!-- 打组卡片（文件夹分类） -->
            <div v-for="group in libraryStore.groups" :key="group.id" class="card-list-group">
              <div class="card-list-folder-header" @click="onFolderHeaderClick(group.id)">
                <component :is="collapsedGroups.has(group.id) ? ChevronRight : ChevronDown" :size="14" class="folder-arrow" />
                <component :is="collapsedGroups.has(group.id) ? Folder : FolderOpen" :size="15" class="folder-icon" />
                <span class="folder-title">{{ group.title }}</span>
                <span class="folder-count">{{ cardsInGroup(group.id).length }}</span>
              </div>

              <div v-if="!collapsedGroups.has(group.id)" class="card-list-folder-body">
                <div
                  v-for="card in cardsInGroup(group.id)"
                  :key="card.id"
                  class="card-list-item"
:class="{ selected: selectedIds.has(card.id), editing: isCardEditing(card.id) }"
                  :style="{ '--card-accent': resolveCardAccent(card) }"
                  @click="onListCardClick(card.id)"
                  @contextmenu="onListContextMenu($event, card.id)"
                >
                  <template v-if="renamingCardId === card.id">
                    <input
                      v-model="renameInput"
                      class="rename-input"
                      autofocus
                      @keydown.enter="confirmRename"
                      @keydown.escape="renamingCardId = null"
                      @blur="confirmRename"
                      @click.stop
                    />
                  </template>
                  <template v-else>
                    <span v-if="card.pinned" class="card-list-pin" title="已置顶"><Pin :size="10" :stroke-width="2.2" :fill="'currentColor'" /></span>
                    <span class="card-list-name">{{ card.title }}</span>
                    <span class="card-list-preview">{{ plainSnippet(card.content) }}</span>
                    <button
                      v-if="placeOfCard(card.id)"
                      class="card-list-map-link"
                      :title="`已附着于地图地点「${placeLabelOfCard(card.id)}」· 点击前往地图`"
                      @click.stop="openMapAtCard(card.id)"
                    >
                      <MapIcon :size="11" :stroke-width="2" />
                      {{ placeLabelOfCard(card.id) }}
                    </button>
                  </template>
                </div>
                <div v-if="cardsInGroup(group.id).length === 0" class="card-list-empty-folder">暂无卡片</div>
              </div>
            </div>

            <!-- 未分组卡片 -->
            <div v-if="libraryStore.groups.length > 0 && ungroupedCards.length > 0" class="card-list-section-title">
              未分组卡片
            </div>
            <div
              v-for="card in (libraryStore.groups.length > 0 ? ungroupedCards : allCardsPinnedFirst)"
              :key="card.id"
              class="card-list-item"
              :class="{ selected: selectedIds.has(card.id) }"
              :style="{ '--card-accent': resolveCardAccent(card) }"
              @click="onListCardClick(card.id)"
              @contextmenu="onListContextMenu($event, card.id)"
            >
              <template v-if="renamingCardId === card.id">
                <input
                  v-model="renameInput"
                  class="rename-input"
                  autofocus
                  @keydown.enter="confirmRename"
                  @keydown.escape="renamingCardId = null"
                  @blur="confirmRename"
                  @click.stop
                />
              </template>
              <template v-else>
                <span v-if="card.pinned" class="card-list-pin" title="已置顶"><Pin :size="10" :stroke-width="2.2" :fill="'currentColor'" /></span>
                <span class="card-list-name">{{ card.title }}</span>
                <span class="card-list-preview">{{ plainSnippet(card.content) }}</span>
                <button
                  v-if="placeOfCard(card.id)"
                  class="card-list-map-link"
                  :title="`已附着于地图地点「${placeLabelOfCard(card.id)}」· 点击前往地图`"
                  @click.stop="openMapAtCard(card.id)"
                >
                  <MapIcon :size="11" :stroke-width="2" />
                  {{ placeLabelOfCard(card.id) }}
                </button>
              </template>
            </div>

            <div v-if="cards.length === 0" class="card-list-empty">暂无卡片</div>
          </div>
        </div>
      </Transition>

      <div
        ref="canvasScrollRef"
        class="canvas-scroll"
        :class="{
          'drag-over': isDraggingOver,
          selecting: isSelecting,
          'pan-mode': isPanActive(),
          panning: isPanning,
        }"
        @dragover="onDragOver"
        @dragleave="isDraggingOver = false"
        @drop.prevent="onDrop"
        @wheel="onCanvasWheel"
        @mousedown="onCanvasMouseDown"
        @mousemove="onCanvasMouseMove"
        @mouseup="onCanvasMouseUp"
        @mouseleave="onCanvasMouseUp"
        @contextmenu="onCanvasContextMenu"
      >
        <div class="canvas-content" :style="{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${canvasZoom})`, transformOrigin: '0 0' }">
          <!-- 组面板/框 (折叠时为文件夹外观，展开时为半透明面板) -->
          <template v-for="gb in computedGroupBounds" :key="gb.group.id">
            <!-- 1. 折叠状态：文件夹外观卡片 -->
            <div
              v-if="canvasFoldedGroups.has(gb.group.id)"
              class="canvas-folder-card"
              :class="{ selected: isFolderSelected(gb.cards) }"
              :style="{
                left: gb.minX + 'px',
                top: gb.minY + 'px',
              }"
              @mousedown.stop="startGroupDrag(gb.group.id, $event)"
              @dblclick.stop="toggleCanvasGroupFold(gb.group.id)"
            >
              <!-- 背后露出的纸张（视觉层，无交互） -->
              <span class="folder-sheet sheet-back" aria-hidden="true"></span>
              <span class="folder-sheet sheet-mid" aria-hidden="true"></span>

              <!-- 文件夹主体：::before 绘制左上角标签形成文件夹轮廓 -->
              <div class="folder-shape">
                <div class="folder-card-top">
                  <div class="folder-card-info">
                    <FolderOpen :size="17" class="folder-card-icon" />
                    <input
                      v-model="gb.group.title"
                      class="group-title-input"
                      @click.stop
                      @mousedown.stop
                      @change="persistCardGroupsNow()"
                    />
                    <span class="folder-card-count">{{ gb.cards.length }}</span>
                  </div>
                  <div class="folder-card-actions">
                    <button
                      class="pin-card-btn"
                      :class="{ on: lockedGroupIds.has(gb.group.id) }"
                      :title="lockedGroupIds.has(gb.group.id) ? '解除锁定（恢复可移动）' : '锁定位置（不可移动）'"
                      @click.stop="toggleGroupLock(gb.group.id)"
                    >
                      <Pin :size="14" :stroke-width="1.9" :fill="lockedGroupIds.has(gb.group.id) ? 'currentColor' : 'none'" />
                    </button>
                    <button class="folder-btn" title="展开为面板" @click.stop="toggleCanvasGroupFold(gb.group.id)">
                      <Maximize2 :size="14" />
                    </button>
                    <button class="group-close-btn" title="解散分组" @click.stop="deleteGroup(gb.group.id)">
                      <X :size="14" />
                    </button>
                  </div>
                </div>

                <!-- 收纳的卡片以纸张条目形式露出 -->
                <div class="folder-stack">
                  <div
                    v-for="c in gb.cards.slice(0, 3)"
                    :key="c.id"
                    class="folder-stack-item"
                    :title="c.title"
                  >
                    {{ c.title }}
                  </div>
                  <div v-if="gb.cards.length > 3" class="folder-stack-more">
                    还有 {{ gb.cards.length - 3 }} 张…
                  </div>
                </div>
              </div>
            </div>

            <!-- 2. 展开状态：半透明面板 (Group Frame) -->
            <div
              v-else
              class="group-frame"
              :style="{
                left: gb.minX + 'px',
                top: gb.minY + 'px',
                width: gb.width + 'px',
                height: gb.height + 'px',
              }"
            >
              <div class="group-header" @mousedown="startGroupDrag(gb.group.id, $event)">
                <div class="group-title-wrap">
                  <Layers :size="14" class="group-icon" />
                  <input
                    v-model="gb.group.title"
                    class="group-title-input"
                    @click.stop
                    @change="persistCardGroupsNow()"
                  />
                  <span class="group-count">({{ gb.cards.length }})</span>
                </div>
                <div class="group-actions">
                  <button
                    class="pin-card-btn"
                    :class="{ on: lockedGroupIds.has(gb.group.id) }"
                    :title="lockedGroupIds.has(gb.group.id) ? '解除锁定（恢复可移动）' : '锁定位置（不可移动）'"
                    @click.stop="toggleGroupLock(gb.group.id)"
                  >
                    <Pin :size="14" :stroke-width="1.9" :fill="lockedGroupIds.has(gb.group.id) ? 'currentColor' : 'none'" />
                  </button>
                  <button class="folder-btn" title="折叠为文件夹" @click.stop="toggleCanvasGroupFold(gb.group.id)">
                    <Minimize2 :size="14" />
                  </button>
                  <button class="group-close-btn" title="解散分组" @click.stop="deleteGroup(gb.group.id)">
                    <X :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </template>

          <!-- 文本卡片 (非折叠状态下才显示) -->
          <template v-for="(card, index) in cards" :key="card.id">
            <article
              v-if="isCardVisibleOnCanvas(card)"
              :ref="(el) => setCardRef(card.id, el as HTMLElement | null)"
              :data-card-id="card.id"
              class="card"
              :class="{ selected: selectedIds.has(card.id) }"
              :style="{
                left: getCardPos(card, index).x + 'px',
                top: getCardPos(card, index).y + 'px',
                '--card-accent': resolveCardAccent(card),
                /* 拖拽中的卡片提到最上层，保证其顶栏不会被置顶卡片盖住。 */
                zIndex: isDraggingCard && selectedIds.has(card.id) ? 60 : card.pinned ? 3 : 2,
              }"
              @mousedown.stop="startCardDrag(card.id, $event)"
              @dblclick.stop="openEditor(card)"
              @copy.prevent
            >
              <!-- 顶部色条：按卡片 id 稳定取色，用于快速区分卡片 -->
              <header class="card-accent">
                <div class="card-title">{{ card.title }}</div>
              </header>

              <div class="card-body">
                <div class="card-preview">{{ plainSnippet(card.content) }}</div>
                <div class="card-actions">
                  <!-- 附着在地图地点上时，左侧出现直达地图的入口 -->
                  <button
                    v-if="placeOfCard(card.id)"
                    class="card-action map-link"
                    :title="`已附着于地图地点「${placeLabelOfCard(card.id)}」· 点击前往地图`"
                    @click.stop="openMapAtCard(card.id)"
                  >
                    <MapIcon :size="14" :stroke-width="1.8" />
                    <span class="card-action-label">{{ placeLabelOfCard(card.id) }}</span>
                  </button>
                  <span class="card-actions-spacer"></span>
                  <button class="card-action" title="加入文档" @click.stop="addCardToDocument(card)">
                    <FilePlus :size="14" :stroke-width="1.8" />
                  </button>
                  <button class="card-action" title="复制文本" @click.stop="copyCard(card)">
                    <Copy :size="14" :stroke-width="1.8" />
                  </button>
                  <button class="card-action" title="编辑文本卡片" @click.stop="openEditor(card)">
                    <Pencil :size="14" :stroke-width="1.8" />
                  </button>
                  <button class="card-action danger" title="删除卡片" @click.stop="deleteCard(card.id)">
                    <Trash2 :size="14" :stroke-width="1.8" />
                  </button>
                </div>
              </div>
            </article>
          </template>
        </div>

        <div
          v-if="isSelecting"
          class="selection-rect"
          :style="{
            left: selectionVpToCanvas().left + 'px',
            top: selectionVpToCanvas().top + 'px',
            width: selectionVpToCanvas().width + 'px',
            height: selectionVpToCanvas().height + 'px',
          }"
        ></div>

        <div v-if="cards.length === 0" class="empty-state">
          暂无文本卡片，点击右上角"新建卡片"创建，或将 AI 回复拖拽到画布中。
        </div>
      </div>

      <div class="canvas-toolbar">
        <button class="zoom-btn" title="缩小画布" @click="canvasZoom = Math.max(0.6, canvasZoom - 0.1)">
          <ZoomOut :size="18" :stroke-width="1.8" />
        </button>
        <span class="zoom-label">{{ Math.round(canvasZoom * 100) }}%</span>
        <button class="zoom-btn" title="放大画布" @click="canvasZoom = Math.min(1.6, canvasZoom + 0.1)">
          <ZoomIn :size="18" :stroke-width="1.8" />
        </button>
        <button class="zoom-btn" title="重置默认" @click="resetZoom">
          <RotateCcw :size="18" :stroke-width="1.8" />
        </button>
        <div class="toolbar-divider"></div>
        <button class="zoom-btn arrange-btn" title="整理对齐所有卡片" @click="arrangeCards">
          <LayoutGrid :size="18" :stroke-width="1.8" />
          <span class="arrange-label">整理卡片</span>
        </button>
      </div>

    <Teleport to="body">
      <CardStitchModal
        v-if="stitchModal.show"
        :cards="stitchModal.cards"
        :initial-mode="stitchModal.mode"
        @close="stitchModal.show = false"
        @save="onStitchSave"
      />
      <div v-if="openEditors.length > 0" class="editor-layer">
        <div
          v-for="ed in openEditors"
          :key="ed.card.id"
          class="modal-shell"
          :class="{ front: editorFrontId === ed.card.id }"
          :style="{ left: ed.x + 'px', top: ed.y + 'px', width: ed.w + 'px', height: ed.h + 'px' }"
          @mousedown.stop="raiseEditor(ed)"
        >
          <div class="modal-header" @mousedown.stop="startPanelDrag($event, ed)">
            <div class="modal-header-main">
              <span class="label-caps">文本卡片编辑</span>
              <div class="modal-title-row">
                <div class="title-input-grow">
                  <input
                    v-model="ed.card.title"
                    v-auto-pair
                    class="title-input"
                    placeholder="卡片标题"
                  />
                  <span class="title-input-border" aria-hidden="true"></span>
                </div>
              </div>
            </div>
            <!-- 颜色圆点 + 置顶 + 关闭 集中排在右侧 -->
            <div class="modal-header-side">
              <div class="accent-dots" title="卡片顶部色条颜色">
                <button
                  v-for="c in CARD_ACCENTS"
                  :key="c"
                  class="accent-dot"
                  :class="{ active: ed.card.accent === c }"
                  :style="{ background: c }"
                  :title="`使用 ${c}`"
                  @click="setEditingAccent(ed.card, c)"
                ></button>
                <span class="accent-divider"></span>
                <button
                  class="accent-dot accent-dot-auto"
                  :class="{ active: !ed.card.accent }"
                  :style="{ background: resolveCardAccent({ id: ed.card.id }) }"
                  title="自动（按卡片随机分配）"
                  @click="setEditingAccent(ed.card, null)"
                >
                  <Shuffle :size="12" :stroke-width="2.6" />
                </button>
              </div>
              <button
                class="pin-card-btn"
                :class="{ on: ed.card.pinned }"
                :title="ed.card.pinned ? '取消置顶与空白保护' : '置顶此卡片（点击空白不再关闭）'"
                @click="setEditingPinned(ed.card)"
              >
                <Pin :size="14" :stroke-width="1.9" :fill="ed.card.pinned ? 'currentColor' : 'none'" />
              </button>
              <button class="modal-close" title="关闭" @click="closeEditor(ed.card)">
                <X :size="18" :stroke-width="1.8" />
              </button>
            </div>
          </div>
          <div class="modal-editor">
            <DocumentViewer v-model="ed.card.content" embedded single-editor ring-slot="canvasCard" />
          </div>
          <div class="modal-footer">
            <button class="done-btn" @click="finishEditor(ed.card)">完成</button>
          </div>
          <div class="panel-resize-handle" title="拖拽右下角调整大小" @mousedown.stop="startPanelResize($event, ed)"></div>
        </div>
      </div>

      <div v-if="listCtxMenu.show" class="ctx-menu" :style="{ left: listCtxMenu.x + 'px', top: listCtxMenu.y + 'px' }" @click.stop>
        <div class="ctx-item" @click="listAction('rename')">重命名</div>
        <div class="ctx-item" @click="listAction('copy')">复制</div>
        <div class="ctx-item" @click="listAction('paste')">粘贴</div>
        <div class="ctx-divider"></div>
        <div class="ctx-item danger" @click="listAction('delete')">删除</div>
      </div>

      <div v-if="ctxMenu.show" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <template v-if="ctxMenu.onEmpty">
          <div class="ctx-item" @click="ctxMenuAction('paste')">粘贴</div>
        </template>
        <template v-else>
          <div class="ctx-item" @click="ctxMenuAction('group')">
            <Layers :size="14" :stroke-width="1.8" />
            <span>打组 (Ctrl+G)</span>
          </div>
          <div v-if="getSelectedCards().some(c => c.groupId)" class="ctx-item" @click="ctxMenuAction('ungroup')">
            <Unlink :size="14" :stroke-width="1.8" />
            <span>取消打组 (Ctrl+Shift+G)</span>
          </div>
          <div class="ctx-divider"></div>
          <div class="ctx-item has-sub" @click.stop="ctxMenuToggleSub('agent')">
            <span>智能体</span>
            <ChevronRight :size="14" />
            <div v-if="ctxMenu.submenu === 'agent'" class="ctx-submenu" @click.stop>
              <div class="ctx-item" @click="ctxMenuAction('add-to-input')">添加到输入框</div>
              <div class="ctx-item" @click="ctxMenuAction('new-chat')">新建对话</div>
            </div>
          </div>

          <!-- 附着到地图地点 -->
          <div class="ctx-item has-sub" @click.stop="ctxMenuToggleSub('place')">
            <MapPin :size="14" :stroke-width="1.8" />
            <span>附着到地图地点</span>
            <ChevronRight :size="14" />
            <div v-if="ctxMenu.submenu === 'place'" class="ctx-submenu" @click.stop>
              <div v-if="mapPlaceOptions.length === 0" class="ctx-item disabled">
                请先在地图中标注地点
              </div>
              <div
                v-for="opt in mapPlaceOptions"
                :key="opt.id"
                class="ctx-item"
                @click="attachSelectedToPlace(opt.id)"
              >
                {{ opt.pathName }} · {{ opt.label }}
              </div>
            </div>
          </div>
          <div v-if="selectionHasPlace" class="ctx-item" @click="ctxMenuAction('detach-place')">
            <Unlink :size="14" :stroke-width="1.8" />
            <span>取消地图附着</span>
          </div>

          <div class="ctx-divider"></div>
          <div class="ctx-item" @click="ctxMenuAction('stitch-preview')">
            <BookOpen :size="14" :stroke-width="1.8" />
            <span>拼文预览 (Ctrl+Shift+P)</span>
          </div>
          <div class="ctx-item" @click="ctxMenuAction('stitch-compare')">
            <GitCompare :size="14" :stroke-width="1.8" />
            <span>拼文对比 (Ctrl+Shift+C)</span>
          </div>
          <div class="ctx-divider"></div>
          <div class="ctx-item" @click="ctxMenuAction('copy')">复制</div>
          <div class="ctx-item" @click="ctxMenuAction('paste')">粘贴</div>
          <div class="ctx-divider"></div>
          <div class="ctx-item" @click="ctxMenuAction('analyze')">
            <Sparkles :size="14" :stroke-width="1.8" />
            <span>加入洞察分析</span>
          </div>
          <div class="ctx-item danger" @click="ctxMenuAction('delete')">删除</div>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.library-view {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-container-low);
  overflow: hidden;
  position: relative;
}

.floating-tools {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  gap: 4px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 999px;
  padding: 4px;
  box-shadow: var(--shadow);
  z-index: 10;
}

.floating-divider {
  height: 1px;
  margin: 2px 6px;
  background: var(--outline-variant);
}

.floating-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 999px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease, color 0.2s ease;
}

.floating-btn:hover {
  background: var(--surface-container);
}

.floating-btn.active {
  background: var(--primary);
  color: var(--on-primary, #fff);
}

.canvas-scroll.pan-mode {
  cursor: grab;
}

.canvas-scroll.panning {
  cursor: grabbing;
}

.canvas-toolbar {
  position: absolute;
  bottom: 12px;
  right: 16px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 999px;
  padding: 4px;
  box-shadow: var(--shadow);
  z-index: 10;
}

.zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 999px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease;
}

.zoom-btn:hover {
  background: var(--surface-container);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--outline-variant);
  margin: 0 4px;
}

.arrange-btn {
  width: auto;
  padding: 0 10px;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--primary);
}

.arrange-label {
  font-size: 13px;
  font-weight: 500;
}

.zoom-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  padding: 0 6px;
  min-width: 44px;
  text-align: center;
}

.library-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 16px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
  min-height: 48px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.canvas-hint {
  font-size: 12px;
  color: var(--on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.collapse-all-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--surface-container-high, #e2e8f0);
  color: var(--on-surface, #1e293b);
  font-size: 13px;
  font-weight: 500;
  border: 1px solid var(--outline-variant, #cbd5e1);
  cursor: pointer;
  transition: background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
  flex-shrink: 0;
}

.collapse-all-btn:hover {
  background: var(--surface-container-highest, #cbd5e1);
  box-shadow: var(--shadow);
}

.add-card-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  background: var(--primary);
  color: var(--on-primary, #fff);
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: background 0.2s ease, box-shadow 0.2s ease;
  flex-shrink: 0;
}

.add-card-btn:hover {
  background: var(--primary-container);
  box-shadow: var(--shadow);
}

.canvas-scroll {
  flex: 1;
  overflow: auto;
  padding: 24px;
  background-image: radial-gradient(var(--outline-variant) 1px, transparent 1px);
  background-size: 20px 20px;
  transition: box-shadow 0.2s ease, background-color 0.2s ease;
  position: relative;
}

.canvas-scroll.pan-mode {
  cursor: grab;
}

.canvas-scroll.panning {
  cursor: grabbing;
}

.canvas-scroll.drag-over {
  background-color: rgb(var(--primary-rgb) / 0.06);
  box-shadow: inset 0 0 0 2px var(--primary);
}

.canvas-scroll.selecting {
  cursor: crosshair;
}

.canvas-content {
  position: relative;
  min-width: 4000px;
  min-height: 3000px;
  transform-origin: 0 0;
  pointer-events: auto;
}

.group-frame {
  position: absolute;
  border: 2px dashed var(--primary-container);
  border-radius: 12px;
  background: rgb(var(--primary-rgb) / 0.04);
  backdrop-filter: blur(2px);
  z-index: 1;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.05);
  transition: border-color 0.2s;
}

/* ---------------- collapsed group = folder with peeking sheets ----------------
   Shape/depth language referenced from the provided folder illustration; the
   palette stays on the app's own theme tokens. */

.canvas-folder-card {
  position: absolute;
  width: 286px;
  /* Room above the body for the tab and the sheets that peek out. */
  padding-top: 20px;
  z-index: 3;
  cursor: grab;
  user-select: none;
  /* Flat at rest so hovering/selecting produces a real sense of lift.
     drop-shadow (not box-shadow) is used because it follows the composed
     silhouette of tab + body + sheets. */
  filter: none;
  transition: transform 0.18s ease, filter 0.18s ease;
}

.canvas-folder-card:hover,
.canvas-folder-card.selected {
  transform: translateY(-3px);
  filter: drop-shadow(0 16px 26px rgb(15 23 42 / 0.2)) drop-shadow(0 3px 6px rgb(15 23 42 / 0.1));
}

.canvas-folder-card:active {
  cursor: grabbing;
  transform: translateY(-1px);
  filter: drop-shadow(0 8px 14px rgb(15 23 42 / 0.18));
}

/* Sheets sticking out behind the folder, progressively paler towards the back. */
.folder-sheet {
  position: absolute;
  border-radius: 9px 9px 4px 4px;
  pointer-events: none;
  z-index: 0;
}

.folder-sheet.sheet-back {
  top: 0;
  right: 8px;
  width: 58%;
  height: 62px;
  background: var(--primary-fixed-dim, #dfe3ef);
  opacity: 0.72;
}

.folder-sheet.sheet-mid {
  top: 9px;
  right: 17px;
  width: 66%;
  height: 60px;
  background: var(--primary-container);
  opacity: 0.5;
}

/* The folder body. Its ::before draws the raised tab on the left, giving the
   classic folder outline without any clipping of the content. */
.folder-shape {
  position: relative;
  z-index: 1;
  padding: 11px 13px 12px;
  border-radius: 4px 14px 14px 14px;
  background: linear-gradient(
    158deg,
    var(--primary-fixed-dim, #dfe3ef) 0%,
    var(--surface-bright) 55%,
    var(--surface-container-low) 100%
  );
  /* Hairline ring only — no offset, so the resting state stays flat. */
  box-shadow: inset 0 0 0 1px rgb(var(--primary-rgb) / 0.18);
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.folder-shape::before {
  content: "";
  position: absolute;
  left: 0;
  /* Overlaps the body by 2px so tab and body read as one silhouette. */
  top: -18px;
  height: 20px;
  width: 54%;
  background: var(--primary-fixed-dim, #dfe3ef);
  border-radius: 8px 10px 0 0;
  /* Diagonal rise from the body edge up into the tab. */
  clip-path: polygon(0 0, calc(100% - 15px) 0, 100% 100%, 0 100%);
}

.folder-card-top {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.folder-card-info {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.folder-card-icon {
  color: var(--primary);
  flex-shrink: 0;
}

/* The shared group title input is fixed-width; let it flex inside the folder. */
.folder-card-info .group-title-input {
  flex: 1;
  min-width: 0;
  width: auto;
  font-size: 12.5px;
}

.folder-card-info .group-title-input:hover,
.folder-card-info .group-title-input:focus {
  background: rgb(255 255 255 / 0.8);
}

.folder-card-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: var(--primary);
  border-radius: 999px;
  white-space: nowrap;
  flex-shrink: 0;
}

.folder-card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.folder-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: var(--on-surface-variant);
  transition: background 0.15s, color 0.15s;
}

.folder-btn:hover {
  background: rgb(255 255 255 / 0.75);
  color: var(--primary);
}

/* 锁定/置顶组框的激活态 */
.folder-btn.on {
  background: rgba(var(--primary-rgb) / 0.16);
  color: var(--primary);
}

/* Contained cards shown as a shallow stack of sheets inside the folder. */
.folder-stack {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.folder-stack-item {
  padding: 4px 8px;
  border-radius: 5px;
  background: rgb(255 255 255 / 0.86);
  /* Flat hairline instead of a drop shadow, matching the resting state. */
  box-shadow: inset 0 0 0 1px rgb(var(--primary-rgb) / 0.12);
  font-size: 11px;
  line-height: 15px;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Each deeper sheet is inset a little, echoing a physical stack. */
.folder-stack-item:nth-child(2) {
  margin-left: 5px;
  opacity: 0.88;
}

.folder-stack-item:nth-child(3) {
  margin-left: 10px;
  opacity: 0.76;
}

.folder-stack-more {
  padding-left: 10px;
  font-size: 10px;
  color: var(--on-surface-variant);
}

.group-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.group-frame:hover {
  border-color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.06);
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
  border-top-left-radius: 10px;
  border-top-right-radius: 10px;
  cursor: grab;
  user-select: none;
}

.group-header:active {
  cursor: grabbing;
}

.group-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  flex: 1;
}

.group-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.group-title-input {
  border: none;
  background: transparent;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  outline: none;
  padding: 2px 4px;
  border-radius: 4px;
  width: 140px;
  transition: background 0.15s;
}

.group-title-input:hover,
.group-title-input:focus {
  background: var(--surface-container-low);
}

.group-count {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.group-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  color: var(--on-surface-variant);
  transition: background 0.15s, color 0.15s;
}

.group-close-btn:hover {
  background: var(--error-container);
  color: var(--error);
}

.card {
  position: absolute;
  width: 280px;
  min-height: 204px;
  max-height: 258px;
  display: flex;
  flex-direction: column;
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  /* Content is padded per-section so the accent strip can bleed edge to edge. */
  padding: 0;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  transition: box-shadow 0.2s ease, border-color 0.2s ease;
  cursor: grab;
  user-select: none !important;
  -webkit-user-select: none !important;
  -moz-user-select: none !important;
  -ms-user-select: none !important;
  z-index: 2;
}

.card:active {
  cursor: grabbing;
}

.card:hover {
  box-shadow: 0 8px 24px -4px rgba(0, 0, 0, 0.18);
  border-color: var(--primary);
}

.card.selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgb(var(--primary-rgb) / 0.25), 0 8px 24px -4px rgba(0, 0, 0, 0.18);
}

/* 编辑面板打开期间，画布上的卡片保持可见并标注编辑中。 */
.card.editing {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgb(var(--primary-rgb) / 0.35), 0 8px 24px -4px rgba(0, 0, 0, 0.2);
}

/* Coloured header strip; --card-accent is set inline per card. */
.card-accent {
  flex-shrink: 0;
  padding: 9px 14px;
  background: var(--card-accent, var(--primary-fixed-dim, #dfe3ef));
}

.card-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 12px 14px;
}

.card-title {
  font-size: 13.5px;
  font-weight: 700;
  letter-spacing: 0.01em;
  text-align: left;
  /* Dark ink keeps contrast on every colour in the pastel palette. */
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none !important;
  -webkit-user-select: none !important;
}

.card-preview {
  flex: 1;
  font-size: 13px;
  line-height: 20px;
  color: var(--on-surface-variant);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 5;
  -webkit-box-orient: vertical;
  user-select: none !important;
  -webkit-user-select: none !important;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  margin-top: 6px;
  justify-content: flex-end;
  min-height: 24px;
}

.card-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 5px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease, color 0.2s ease;
}

.card-action:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.card-action.danger:hover {
  color: var(--error);
}

/* ---- map link chip on the card footer ---- */

.card-actions-spacer {
  flex: 1;
}

.card-action.map-link {
  width: auto;
  max-width: 132px;
  gap: 4px;
  padding: 0 8px;
  border-radius: 999px;
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-size: 11px;
  font-weight: 600;
}

.card-action.map-link:hover {
  background: var(--primary);
  color: #fff;
}

.card-action-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.selection-rect {
  position: absolute;
  background: rgb(var(--primary-rgb) / 0.08);
  border: 1px solid var(--primary);
  pointer-events: none;
  z-index: 5;
}

.empty-state {
  padding: 40px;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 13px;
}

.card-list-panel {
  position: absolute;
  left: 56px;
  top: 48px;
  bottom: 48px;
  width: 280px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 4px 0 20px -8px rgba(0, 0, 0, 0.15);
  z-index: 15;
  display: flex;
  flex-direction: column;
  animation: panelSlideIn 0.2s ease;
  overflow: hidden;
}

@keyframes panelSlideIn {
  from { opacity: 0; transform: translateX(-12px); }
  to { opacity: 1; transform: translateX(0); }
}

.card-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--outline-variant);
  flex-shrink: 0;
}

.card-list-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  letter-spacing: 0.02em;
}

.card-list-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  color: var(--on-surface-variant);
  transition: background 0.15s;
}

.card-list-close:hover {
  background: var(--surface-container-high);
}

.card-list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  background: var(--surface-container-low);
}

.card-list-group {
  margin-bottom: 8px;
}

.card-list-folder-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  cursor: pointer;
  user-select: none;
  transition: background 0.15s, border-color 0.15s;
  margin-bottom: 4px;
}

.card-list-folder-header:hover {
  background: var(--surface-container-high);
  border-color: var(--primary);
}

.folder-arrow {
  color: var(--on-surface-variant);
}

.folder-icon {
  color: var(--primary);
}

.folder-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.folder-count {
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-fixed-dim);
  padding: 1px 6px;
  border-radius: 999px;
}

.card-list-folder-body {
  padding-left: 10px;
  border-left: 2px solid var(--outline-variant);
  margin-left: 10px;
  margin-top: 4px;
}

.card-list-section-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin: 10px 4px 6px;
  letter-spacing: 0.02em;
}

.card-list-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  /* Matching accent stripe on the leading edge of the list row. */
  border-left: 4px solid var(--card-accent, var(--outline-variant));
  border-radius: 8px;
  background: var(--surface-bright);
  border-top: 1px solid var(--outline-variant);
  border-right: 1px solid var(--outline-variant);
  border-bottom: 1px solid var(--outline-variant);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  margin-bottom: 6px;
}

.card-list-item:hover {
  background: var(--surface-container-lowest);
  border-top-color: var(--primary);
  border-right-color: var(--primary);
  border-bottom-color: var(--primary);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.card-list-item.selected {
  background: var(--primary-fixed-dim);
  border-top-color: var(--primary);
  border-right-color: var(--primary);
  border-bottom-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.card-list-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: var(--primary);
}

.card-list-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-list-preview {
  font-size: 11px;
  line-height: 1.4;
  color: var(--on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.card-list-map-link {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  align-self: flex-start;
  max-width: 100%;
  margin-top: 3px;
  padding: 1px 7px;
  border: none;
  border-radius: 999px;
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-family: inherit;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-list-map-link:hover {
  background: var(--primary);
  color: #fff;
}

.card-list-empty-folder {
  padding: 8px;
  font-size: 11px;
  color: var(--on-surface-variant);
  font-style: italic;
}

.card-list-empty {
  padding: 24px 10px;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.rename-input {
  width: 100%;
  padding: 2px 4px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
  background: var(--surface-container-lowest);
  outline: none;
  font-family: inherit;
}

.panel-slide-enter-active,
.panel-slide-leave-active {
  transition: all 0.2s ease;
}

.panel-slide-enter-from,
.panel-slide-leave-to {
  opacity: 0;
  transform: translateX(-12px);
}

.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 180px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 4px;
}

.ctx-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 7px 12px;
  font-size: 13px;
  color: var(--on-surface);
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s ease;
  position: relative;
}

.ctx-item:hover {
  background: var(--surface-container-high);
}

.ctx-item.danger {
  color: var(--error);
}

.ctx-item.disabled {
  color: var(--on-surface-variant);
  opacity: 0.7;
  pointer-events: none;
}

.ctx-item.danger:hover {
  background: var(--error-container);
}

.ctx-item.has-sub {
  position: relative;
}

.ctx-submenu {
  position: absolute;
  left: 100%;
  top: -4px;
  min-width: 150px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 4px;
}

.ctx-divider {
  height: 1px;
  background: var(--outline-variant);
  margin: 4px 8px;
}

/* 编辑面板容器：不再有灰色遮罩，也不拦截点击，
   因此画布仍可继续点开更多卡片，多个面板可同时存在。 */
.editor-layer {
  position: fixed;
  inset: 0;
  z-index: 1000;
  pointer-events: none;
}

.modal-shell {
  position: absolute;
  display: flex;
  flex-direction: column;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  /* 只有面板本身可交互，遮罩区域保持穿透。 */
  pointer-events: auto;
  z-index: 10;
}

/* 当前被点击/拖拽的面板置顶，保证其顶部工具栏跟随自身。 */
.modal-shell.front {
  z-index: 40;
}

.modal-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
  cursor: move;
  user-select: none;
  -webkit-user-select: none;
}

/* 右下角缩放柄 */
.panel-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 5;
}

.modal-header-main {
  flex: 1;
  min-width: 0;
}

/* 颜色圆点 + 置顶 + 关闭 的右侧按钮簇 */
.modal-header-side {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.modal-title-row {
  display: flex;
  align-items: center;
  gap: 14px;
}

/* 标题输入框容器：独立定位，承载下面会“生长”的动画下划线 */
.title-input-grow {
  position: relative;
  display: inline-flex;
  flex: 0 1 260px;
  min-width: 120px;
}

.title-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 600;
  color: var(--on-surface);
  outline: none;
  padding: 4px 0;
  border-bottom: 1px solid var(--outline-variant);
}

/* 参考 adamgiebl 的下划线展开动效：聚焦时从左侧生长到满宽，
   使用项目主题色（primary → primary-container 渐变，替代参考代码的三色渐变） */
.title-input-border {
  position: absolute;
  bottom: 0;
  left: 0;
  height: 2px;
  width: 0%;
  background: linear-gradient(90deg, var(--primary) 0%, var(--primary-container) 100%);
  box-shadow: 0 1px 6px rgb(var(--primary-rgb) / 0.45);
  transition: width 0.4s cubic-bezier(0.42, 0, 0.58, 1);
  pointer-events: none;
}

.title-input:focus {
  outline: none;
}

.title-input:focus + .title-input-border {
  width: 100%;
}

/* 置顶按钮：悬停时从上下各喷一簇彩色气泡（配色取自参考实现）。
   图标与按钮自身的配色保持原样不动，动效只由两个伪元素承担。 */
.pin-card-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container-low);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, transform 0.1s ease;
}

/* 图标压在气泡之上，喷发过程中始终清晰可见。 */
.pin-card-btn svg {
  position: relative;
  z-index: 1;
}

/* 气泡层。相对参考实现有两处必要改动：
   1) z-index 不能用 -1000——.modal-shell 是层叠上下文，负层级会把气泡压到面板
      背景之下完全看不见；这里用 0，盖在按钮底色上、仍在图标之下。
   2) 上下外扩由 70% 收到 55%（约 16px）。.modal-shell 带 overflow: hidden，
      按钮到表头上下边缘余量有限，收一档能让喷发的主要行程都落在可见区内。 */
.pin-card-btn::before,
.pin-card-btn::after {
  position: absolute;
  content: "";
  width: 260%;
  left: 50%;
  height: 100%;
  transform: translateX(-50%);
  z-index: 0;
  pointer-events: none;
  background-repeat: no-repeat;
}

.pin-card-btn:hover::before {
  top: -55%;
  background-image: radial-gradient(circle, #a89215 20%, transparent 20%),
    radial-gradient(circle, transparent 20%, #13a5be 20%, transparent 30%),
    radial-gradient(circle, #a3b82d 20%, transparent 20%),
    radial-gradient(circle, #590cbe 20%, transparent 20%),
    radial-gradient(circle, transparent 10%, #bd1717 15%, transparent 20%),
    radial-gradient(circle, #2a7ce8 20%, transparent 20%),
    radial-gradient(circle, #30e82a 20%, transparent 20%),
    radial-gradient(circle, #e92c75 20%, transparent 20%),
    radial-gradient(circle, #914fe7 20%, transparent 20%);
  background-size: 10% 10%, 20% 20%, 15% 15%, 20% 20%, 18% 18%, 10% 10%, 15% 15%,
    10% 10%, 18% 18%;
  background-position: 50% 120%;
  animation: pinTopBubbles 0.6s ease;
}

@keyframes pinTopBubbles {
  0% {
    background-position: 5% 90%, 10% 90%, 10% 90%, 15% 90%, 25% 90%, 25% 90%,
      40% 90%, 55% 90%, 70% 90%;
  }

  50% {
    background-position: 0% 80%, 0% 20%, 10% 40%, 20% 0%, 30% 30%, 22% 50%,
      50% 50%, 65% 20%, 90% 30%;
  }

  100% {
    background-position: 0% 70%, 0% 10%, 10% 30%, 20% -10%, 30% 20%, 22% 40%,
      50% 40%, 65% 10%, 90% 20%;
    background-size: 0% 0%, 0% 0%, 0% 0%, 0% 0%, 0% 0%, 0% 0%;
  }
}

.pin-card-btn:hover::after {
  bottom: -55%;
  background-image: radial-gradient(circle, #ff93db 20%, transparent 20%),
    radial-gradient(circle, #2ae8df 20%, transparent 20%),
    radial-gradient(circle, transparent 10%, #71ffbd 15%, transparent 20%),
    radial-gradient(circle, #2a9ce8 20%, transparent 20%),
    radial-gradient(circle, #7814fc 20%, transparent 20%),
    radial-gradient(circle, #73e4f8 20%, transparent 20%),
    radial-gradient(circle, #f8d3a9 20%, transparent 20%);
  background-size: 15% 15%, 20% 20%, 18% 18%, 20% 20%, 15% 15%, 20% 20%, 18% 18%;
  background-position: 50% 0%;
  animation: pinBottomBubbles 0.6s ease;
}

@keyframes pinBottomBubbles {
  0% {
    background-position: 10% -10%, 30% 10%, 55% -10%, 70% -10%, 85% -10%,
      70% -10%, 70% 0%;
  }

  50% {
    background-position: 0% 80%, 20% 80%, 45% 60%, 60% 100%, 75% 70%, 95% 60%,
      105% 0%;
  }

  100% {
    background-position: 0% 90%, 20% 90%, 45% 70%, 60% 110%, 75% 80%, 95% 70%,
      110% 10%;
    background-size: 0% 0%, 0% 0%, 0% 0%, 0% 0%, 0% 0%, 0% 0%;
  }
}

.pin-card-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.pin-card-btn:active {
  transform: scale(0.96);
}

.pin-card-btn.on {
  background: rgba(var(--primary-rgb) / 0.14);
  border-color: rgba(var(--primary-rgb) / 0.4);
  color: var(--primary);
}

@media (prefers-reduced-motion: reduce) {
  .pin-card-btn:hover::before,
  .pin-card-btn:hover::after {
    animation: none;
    background-image: none;
  }
}

.modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease;
}

.modal-close:hover {
  background: var(--surface-container-high);
}

.modal-editor {
  flex: 1;
  min-height: 0;
}

/* ---- card accent dots (top-right of the editor title row) ---- */

.accent-dots {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
}

.accent-dot {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.18);
  transition: transform 0.13s ease, box-shadow 0.13s ease;
}

.accent-dot:hover {
  transform: scale(1.18);
}

.accent-dot.active {
  box-shadow: 0 0 0 2.5px var(--primary), inset 0 0 0 1px rgb(255 255 255 / 0.7);
}

.accent-dot-auto {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #334155;
}

.accent-divider {
  width: 1px;
  height: 18px;
  background: var(--outline-variant);
}

.modal-footer {
  flex-shrink: 0;
  display: flex;
  justify-content: flex-end;
  padding: 10px 16px;
  background: var(--surface-bright);
  border-top: 1px solid var(--outline-variant);
}

.done-btn {
  padding: 7px 18px;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  border: none;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.done-btn:hover {
  background: var(--primary-container);
}
</style>