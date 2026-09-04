<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Anchor,
  BoxSelect,
  Check,
  ChevronDown,
  ChevronRight,
  Eraser,
  Eye,
  EyeOff,
  Flag,
  Grid3x3,
  Home,
  Layers,
  Link2,
  Magnet,
  Minus,
  Move,
  MapPin,
  Mail,
  Mountain,
  MousePointer2,
  Pencil,
  Pin,
  Plus,
  Shuffle,
  Star,
  Trash2,
  TreePine,
  Undo2,
  Unlink,
  X,
} from "lucide-vue-next";
import {
  PATH_COLORS,
  PATH_WIDTH_DEFAULT,
  PATH_WIDTH_MAX,
  PATH_WIDTH_MIN,
  PLACE_ICONS,
  PLACE_ICON_COLORS,
  VERTEX_SNAP_RADIUS,
  addPlace,
  anchorPlaceToVertex,
  clampPathWidth,
  clearPathSelection,
  deleteSelectedPaths,
  dragPlaceTo,
  groupSelectedPaths,
  isPathSelected,
  nearestVertex,
  pathsInRect,
  placePoint,
  rectFromPoints,
  releasePlaceAnchor,
  setPathWidth,
  setSelectedPaths,
  setSelectedPathsColor,
  setSelectedPathsWidth,
  syncAnchoredPlaces,
  tOfVertex,
  togglePathSelected,
  addPointToPath,
  assignPathToGroup,
  attachCard,
  buildPathD,
  clearMap,
  closestT,
  createGroup,
  createPath,
  deleteGroup,
  deletePath,
  deletePathPoint,
  deletePlace,
  detachCard,
  findPath,
  findPlace,
  generateRandomPath,
  groupPaths,
  insertPointNear,
  isPathHidden,
  mapStore,
  movePathPoint,
  pathsOfGroup,
  placeOfCard,
  pointAtT,
  placesOfPath,
  pruneMissingCards,
  removeLastPoint,
  renameGroup,
  renamePath,
  setPathColor,
  toggleGroupCollapsed,
  togglePathVisible,
  updatePlace,
  type MapPath,
  type MapPlace,
  type MapPoint,
  type PlaceIcon,
} from "../mapStore";
import { CARD_ACCENTS, libraryStore, resolveCardAccent, type WritingCard } from "../libraryStore";
import DocumentViewer from "./DocumentViewer.vue";
import { showToast } from "../insightStore";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "focusCard", cardId: number): void;
}>();

const ICON_COMPONENTS: Record<PlaceIcon, unknown> = {
  pin: MapPin,
  letter: Mail,
  flag: Flag,
  star: Star,
  home: Home,
  tree: TreePine,
  mountain: Mountain,
  anchor: Anchor,
};

function iconComponent(icon: PlaceIcon) {
  return ICON_COMPONENTS[icon] ?? MapPin;
}

/* ---------------- canvas geometry ---------------- */

const stageRef = ref<SVGSVGElement | null>(null);
const stageSize = ref({ width: 1200, height: 800 });

/** Canvas pan, applied to both the SVG content and the HTML marker layer. */
const panOffset = ref({ x: 0, y: 0 });
/** Canvas zoom factor (scroll wheel), applied to SVG content and markers. */
const canvasZoom = ref(1);
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3;

const isPanning = ref(false);
const spacePressed = ref(false);
let panStart = { x: 0, y: 0 };
let panStartOffset = { x: 0, y: 0 };

/** Space held (or the pan tool picked) puts the canvas into grab mode. */
function isPanActive(): boolean {
  return spacePressed.value;
}

function measureStage() {
  const el = stageRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) {
    stageSize.value = { width: rect.width, height: rect.height };
  }
}

let observer: ResizeObserver | null = null;

onMounted(() => {
  measureStage();
  if (typeof ResizeObserver !== "undefined" && stageRef.value) {
    observer = new ResizeObserver(measureStage);
    observer.observe(stageRef.value);
  }
  window.addEventListener("keydown", onKeydown);
  window.addEventListener("keyup", onKeyup);
  window.addEventListener("blur", releaseSpace);
  document.addEventListener("mousedown", onMapEditorMouseDown);
  /* Cards may have been deleted on the canvas while the map was closed. */
  const removed = pruneMissingCards(new Set(libraryStore.cards.map((c) => c.id)));
  if (removed > 0) {
    showToast("地图已同步", `移除了 ${removed} 个已删除卡片的附着`, "edit");
  }
});

onBeforeUnmount(() => {
  observer?.disconnect();
  observer = null;
  window.removeEventListener("keydown", onKeydown);
  window.removeEventListener("keyup", onKeyup);
  window.removeEventListener("blur", releaseSpace);
  document.removeEventListener("mousedown", onMapEditorMouseDown);
  endPan();
});

/**
 * Translate a pointer event into map coordinates.
 *
 * The pan offset has to be removed here, otherwise every click, snap test and
 * new vertex would land at the wrong place once the canvas has been dragged.
 */
function toStagePoint(event: MouseEvent): MapPoint {
  const el = stageRef.value;
  if (!el) return { x: 0, y: 0 };
  const rect = el.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left - panOffset.value.x) / canvasZoom.value,
    y: (event.clientY - rect.top - panOffset.value.y) / canvasZoom.value,
  };
}

/* ---------------- panning (space + left drag) ---------------- */

function startPan(event: MouseEvent) {
  event.preventDefault();
  isPanning.value = true;
  panStart = { x: event.clientX, y: event.clientY };
  panStartOffset = { ...panOffset.value };

  window.addEventListener("pointermove", onPanMove);
  window.addEventListener("pointerup", endPan);
  window.addEventListener("pointercancel", endPan);
}

function onPanMove(event: PointerEvent) {
  if (!isPanning.value) return;
  panOffset.value = {
    x: panStartOffset.x + (event.clientX - panStart.x),
    y: panStartOffset.y + (event.clientY - panStart.y),
  };
}

function endPan() {
  if (!isPanning.value) return;
  isPanning.value = false;
  window.removeEventListener("pointermove", onPanMove);
  window.removeEventListener("pointerup", endPan);
  window.removeEventListener("pointercancel", endPan);
}

function releaseSpace() {
  spacePressed.value = false;
  endPan();
}

function resetPan() {
  panOffset.value = { x: 0, y: 0 };
  canvasZoom.value = 1;
}

/* Scroll wheel zooms the canvas, keeping the point under the cursor fixed. */
function onMapWheel(event: WheelEvent) {
  event.preventDefault();
  const zoomFactor = event.deltaY < 0 ? 1.1 : 0.9;
  const oldZoom = canvasZoom.value;
  let newZoom = Math.min(Math.max(ZOOM_MIN, Math.round((oldZoom * zoomFactor) * 100) / 100), ZOOM_MAX);
  if (newZoom === oldZoom) return;

  const wrap = stageRef.value?.parentElement;
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const mx = event.clientX - rect.left;
  const my = event.clientY - rect.top;

  panOffset.value = {
    x: mx - (mx - panOffset.value.x) * (newZoom / oldZoom),
    y: my - (my - panOffset.value.y) * (newZoom / oldZoom),
  };
  canvasZoom.value = newZoom;
}

/* ---------------- drawing ---------------- */

/** Path being drawn right now; null when not drawing. */
const drawingPathId = ref<string | null>(null);
const cursorPoint = ref<MapPoint | null>(null);

const visiblePaths = computed(() => mapStore.paths.filter((p) => !isPathHidden(p)));

function setTool(tool: typeof mapStore.tool) {
  if (mapStore.tool === "draw" && tool !== "draw") finishDrawing();
  mapStore.tool = tool;
}

function onStageClick(event: MouseEvent) {
  /* A pan gesture must not also drop a vertex / place. */
  if (isPanActive() || isPanning.value) return;

  const point = toStagePoint(event);

  if (mapStore.tool === "draw") {
    if (!drawingPathId.value) {
      const path = createPath([point]);
      drawingPathId.value = path.id;
    } else {
      addPointToPath(drawingPathId.value, point);
    }
    return;
  }

  if (mapStore.tool === "place") {
    /* Snap the new marker onto the nearest visible path, preferring a vertex. */
    const hit = nearestPath(point);
    if (!hit) {
      showToast("请先画一条路径", "地点需要附着在路径上", "edit");
      return;
    }
    const vertex = nearestVertex(hit.path.points, point);
    const snap = vertex && vertex.dist <= VERTEX_SNAP_RADIUS;
    const place = addPlace(hit.path.id, snap ? tOfVertex(hit.path.points, vertex!.index) : hit.t, {
      ...(snap ? { anchorIndex: vertex!.index } : {}),
    });
    if (place) {
      mapStore.selectedPlaceId = place.id;
      mapStore.activePathId = hit.path.id;
      if (snap) showToast("已吸附到节点", `地点已锁定在第 ${vertex!.index + 1} 个节点`, "habit");
    }
    return;
  }

  /* select tool: clicking empty space clears the selection */
  mapStore.selectedPlaceId = null;
  clearPathSelection();
}

function onStageMove(event: MouseEvent) {
  cursorPoint.value = toStagePoint(event);
}

function onStageLeave() {
  cursorPoint.value = null;
}

/* ---------------- marquee (box) selection ---------------- */

const marquee = ref<{ from: MapPoint; to: MapPoint } | null>(null);

const marqueeRect = computed(() =>
  marquee.value ? rectFromPoints(marquee.value.from, marquee.value.to) : null,
);

/**
 * Drag on empty canvas to box-select paths.
 *
 * Active with the 框选 tool, and also with the 选择 tool while Shift is held so
 * the common case needs no tool switch.
 */
function onStageMouseDown(event: MouseEvent) {
  if (event.button !== 0) return;

  /* Space + left drag pans, whichever tool is active. */
  if (isPanActive()) {
    startPan(event);
    return;
  }

  const marqueeMode = mapStore.tool === "marquee" || (mapStore.tool === "select" && event.shiftKey);
  if (!marqueeMode) return;

  const start = toStagePoint(event);
  marquee.value = { from: start, to: start };
  const additive = event.shiftKey && mapStore.tool === "marquee";
  const previous = additive ? [...mapStore.selectedPathIds] : [];

  const move = (e: MouseEvent) => {
    if (!marquee.value) return;
    marquee.value = { from: marquee.value.from, to: toStagePoint(e) };
    const rect = rectFromPoints(marquee.value.from, marquee.value.to);
    const hits = pathsInRect(rect).map((p) => p.id);
    setSelectedPaths([...previous, ...hits]);
  };

  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    const rect = marqueeRect.value;
    marquee.value = null;
    /* A click without a drag just clears the selection. */
    if (rect && rect.width < 4 && rect.height < 4 && !additive) clearPathSelection();
    else if (mapStore.selectedPathIds.length > 0) {
      showToast("已框选路径", `选中 ${mapStore.selectedPathIds.length} 条路径`, "habit");
    }
  };

  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/** Double-click / Enter ends the stroke. */
function finishDrawing() {
  const id = drawingPathId.value;
  drawingPathId.value = null;
  if (!id) return;
  const path = findPath(id);
  if (path && path.points.length < 2) deletePath(id);
}

/** Preview segment from the last committed vertex to the cursor. */
const draftPreviewD = computed(() => {
  if (!drawingPathId.value || !cursorPoint.value) return "";
  const path = findPath(drawingPathId.value);
  if (!path || path.points.length === 0) return "";
  return buildPathD([...path.points, cursorPoint.value]);
});

function nearestPath(point: MapPoint): { path: MapPath; t: number; dist: number } | null {
  let best: { path: MapPath; t: number; dist: number } | null = null;
  for (const path of visiblePaths.value) {
    if (path.points.length < 2) continue;
    const t = closestT(path.points, point);
    const at = pointAtT(path.points, t);
    const dist = Math.hypot(at.x - point.x, at.y - point.y);
    if (!best || dist < best.dist) best = { path, t, dist };
  }
  return best;
}

function onKeydown(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

  /* Space arms canvas panning; preventDefault stops the page from scrolling. */
  if (event.code === "Space" || event.key === " ") {
    event.preventDefault();
    spacePressed.value = true;
    return;
  }

  if (event.key === "Escape") {
    if (drawingPathId.value) finishDrawing();
    else emit("close");
    return;
  }
  if (event.key === "Enter" && drawingPathId.value) {
    finishDrawing();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && drawingPathId.value) {
    event.preventDefault();
    removeLastPoint(drawingPathId.value);
    if (!findPath(drawingPathId.value)) drawingPathId.value = null;
    return;
  }
  if ((event.key === "Delete" || event.key === "Backspace") && mapStore.selectedPlaceId) {
    event.preventDefault();
    deletePlace(mapStore.selectedPlaceId);
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
    event.preventDefault();
    onGroupAllUngrouped();
    return;
  }
  if (event.key === "v") setTool("select");
  if (event.key === "p") setTool("draw");
  if (event.key === "m") setTool("place");
  if (event.key === "e") setTool("erase");
  if (event.key === "b") setTool("marquee");
  if (event.key === "0") resetPan();
}

function onKeyup(event: KeyboardEvent) {
  if (event.code === "Space" || event.key === " ") releaseSpace();
}

/* ---------------- vertex editing ---------------- */

const draggingVertex = ref<{ pathId: string; index: number } | null>(null);

function onVertexMouseDown(event: MouseEvent, path: MapPath, index: number) {
  /* While panning, the canvas owns the gesture. */
  if (isPanActive()) return;
  event.stopPropagation();

  if (mapStore.tool === "erase") {
    deletePathPoint(path.id, index);
    return;
  }

  draggingVertex.value = { pathId: path.id, index };
  mapStore.activePathId = path.id;

  const move = (e: MouseEvent) => {
    if (!draggingVertex.value) return;
    movePathPoint(draggingVertex.value.pathId, draggingVertex.value.index, toStagePoint(e));
  };
  const up = () => {
    draggingVertex.value = null;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function onPathClick(event: MouseEvent, path: MapPath) {
  if (isPanActive() || isPanning.value) return;
  event.stopPropagation();

  if (mapStore.tool === "select" && (event.ctrlKey || event.metaKey)) {
    /* Ctrl-click builds up a multi-selection without the marquee. */
    togglePathSelected(path.id);
    return;
  }

  mapStore.activePathId = path.id;
  setSelectedPaths([path.id]);

  if (mapStore.tool === "place") {
    const point = toStagePoint(event);
    const vertex = nearestVertex(path.points, point);
    const snap = vertex && vertex.dist <= VERTEX_SNAP_RADIUS;
    const place = addPlace(path.id, snap ? tOfVertex(path.points, vertex!.index) : closestT(path.points, point), {
      ...(snap ? { anchorIndex: vertex!.index } : {}),
    });
    if (place) mapStore.selectedPlaceId = place.id;
    return;
  }
  if (mapStore.tool === "draw") {
    /* Clicking an existing path inserts a vertex at that position. */
    insertPointNear(path.id, toStagePoint(event));
  }
}

/* ---------------- place markers ---------------- */

/** Anchored places read from their vertex so reshaping carries them along. */
function placePosition(place: MapPlace): MapPoint {
  return placePoint(place);
}

const visiblePlaces = computed(() => {
  const ids = new Set(visiblePaths.value.map((p) => p.id));
  return mapStore.places.filter((pl) => ids.has(pl.pathId));
});

function pathColorOf(place: MapPlace): string {
  return findPath(place.pathId)?.color ?? PATH_COLORS[0];
}

/** Vertex the pointer would snap to while dragging, for the magnet highlight. */
const snapHintVertex = ref<{ pathId: string; index: number } | null>(null);

function onPlaceMouseDown(event: MouseEvent, place: MapPlace) {
  if (isPanActive()) return;
  event.stopPropagation();

  if (mapStore.tool === "erase") {
    deletePlace(place.id);
    return;
  }

  mapStore.selectedPlaceId = place.id;
  mapStore.activePathId = place.pathId;
  inspectorOpen.value = true;

  const path = findPath(place.pathId);
  if (!path) return;

  /* Moving place position requires holding Ctrl (or Cmd on Mac) to prevent accidental dragging. */
  if (!(event.ctrlKey || event.metaKey)) return;

  const move = (e: MouseEvent) => {
    const point = toStagePoint(e);
    const result = dragPlaceTo(place.id, point);
    snapHintVertex.value =
      result.snapped && result.index !== undefined
        ? { pathId: place.pathId, index: result.index }
        : null;
  };
  const up = () => {
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/* ---------------- inspector ---------------- */

const inspectorOpen = ref(true);
const selectedPlace = computed(() => findPlace(mapStore.selectedPlaceId));

const attachedCards = computed<WritingCard[]>(() => {
  const place = selectedPlace.value;
  if (!place) return [];
  return place.cardIds
    .map((id) => libraryStore.cards.find((c) => c.id === id))
    .filter((c): c is WritingCard => !!c);
});

const attachableCards = computed<WritingCard[]>(() => {
  const place = selectedPlace.value;
  if (!place) return [];
  return libraryStore.cards.filter((c) => !place.cardIds.includes(c.id));
});

const cardPickerOpen = ref(false);

function onAttachCard(cardId: number) {
  const place = selectedPlace.value;
  if (!place) return;
  const previous = placeOfCard(cardId);
  attachCard(place.id, cardId);
  cardPickerOpen.value = false;
  showToast(
    "已附着卡片",
    previous && previous.id !== place.id
      ? `已从「${previous.label}」移动到「${place.label}」`
      : `已挂到地点「${place.label}」`,
    "habit",
  );
}

function onDetachCard(cardId: number) {
  const place = selectedPlace.value;
  if (place) detachCard(place.id, cardId);
}

function onPlaceIconChange(icon: PlaceIcon) {
  if (mapStore.selectedPlaceId) updatePlace(mapStore.selectedPlaceId, { icon });
}

/** Bolt the selected place onto whichever vertex it currently sits closest to. */
function onSnapToNearestVertex() {
  const place = selectedPlace.value;
  if (!place) return;
  const path = findPath(place.pathId);
  if (!path) return;
  const near = nearestVertex(path.points, placePoint(place));
  if (!near) return;
  anchorPlaceToVertex(place.id, near.index);
  showToast("已吸附到节点", `锁定在第 ${near.index + 1} 个节点`, "habit");
}

/** Display name for a place; falls back to the icon's role when unnamed. */
function placeName(place: MapPlace): string {
  return place.label.trim() || PLACE_ICONS.find((o) => o.id === place.icon)?.label || "地点";
}

/* ---------------- hover preview of attached cards ---------------- */

const hoveredPlaceId = ref<string | null>(null);
let hoverTimer: number | null = null;
let leaveTimer: number | null = null;

function onPlaceEnter(place: MapPlace) {
  if (leaveTimer !== null) {
    window.clearTimeout(leaveTimer);
    leaveTimer = null;
  }
  if (hoverTimer !== null) window.clearTimeout(hoverTimer);
  hoverTimer = window.setTimeout(() => {
    hoverTimer = null;
    hoveredPlaceId.value = place.id;
  }, 100);
}

function onPlaceLeave() {
  if (hoverTimer !== null) {
    window.clearTimeout(hoverTimer);
    hoverTimer = null;
  }
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  /* Persistent delay so users can scroll, inspect & click cards without losing the panel. */
  leaveTimer = window.setTimeout(() => {
    leaveTimer = null;
    hoveredPlaceId.value = null;
  }, 2500);
}

function onPopoverEnter() {
  if (leaveTimer !== null) {
    window.clearTimeout(leaveTimer);
    leaveTimer = null;
  }
}

function onPopoverLeave() {
  if (leaveTimer !== null) window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    leaveTimer = null;
    hoveredPlaceId.value = null;
  }, 2500);
}

/* ---------------- in-map card editing ---------------- */

const editingCard = ref<WritingCard | null>(null);
const panelRect = ref({ x: 0, y: 0, w: 820, h: 640 });

function openCardEditor(cardId: number) {
  const card = libraryStore.cards.find((c) => c.id === cardId);
  if (card) {
    editingCard.value = card;
    panelRect.value = {
      x: Math.round(window.innerWidth / 2 - 410),
      y: Math.max(24, Math.round(window.innerHeight / 2 - 320)),
      w: Math.min(820, window.innerWidth - 60),
      h: Math.min(640, window.innerHeight - 60),
    };
  }
}

function closeCardEditor() {
  editingCard.value = null;
}

function setEditingAccent(hex: string | null) {
  if (!editingCard.value) return;
  if (hex) editingCard.value.accent = hex;
  else delete editingCard.value.accent;
}

/** Toggle whether the editing card is pinned. A pinned panel survives outside clicks. */
function setEditingPinned() {
  if (!editingCard.value) return;
  editingCard.value.pinned = !editingCard.value.pinned;
}

/* ---- draggable / resizable panel ---- */

function startPanelDrag(event: MouseEvent) {
  if ((event.target as HTMLElement).closest("button, input, select")) return;
  event.preventDefault();
  const start = { x: event.clientX, y: event.clientY, ox: panelRect.value.x, oy: panelRect.value.y };
  const move = (e: PointerEvent) => {
    panelRect.value = {
      ...panelRect.value,
      x: start.ox + (e.clientX - start.x),
      y: Math.max(0, start.oy + (e.clientY - start.y)),
    };
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function startPanelResize(event: MouseEvent) {
  event.preventDefault();
  event.stopPropagation();
  const start = { x: event.clientX, y: event.clientY, ow: panelRect.value.w, oh: panelRect.value.h };
  const move = (e: PointerEvent) => {
    panelRect.value = {
      ...panelRect.value,
      w: Math.max(420, Math.min(window.innerWidth - 40, start.ow + (e.clientX - start.x))),
      h: Math.max(300, Math.min(window.innerHeight - 40, start.oh + (e.clientY - start.y))),
    };
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/* 非置顶面板：点击空白处自动关闭；置顶面板保留。 */
function onMapEditorMouseDown(event: MouseEvent) {
  if (!editingCard.value || editingCard.value.pinned) return;
  const target = event.target as HTMLElement | null;
  if (target && target.closest(".map-card-modal-shell")) return;
  /* Ctrl+K 行内 AI 浮层、手机高保真模拟预览都 Teleport 到 body，在面板之外，
     点它们（切夜间、改字号、翻章节等）不应把宿主卡片编辑面板一起关掉。 */
  if (target && target.closest(".iae-root")) return;
  if (target && target.closest(".mobile-preview-mask")) return;
  editingCard.value = null;
}

const hoveredPlace = computed(() => findPlace(hoveredPlaceId.value));

const hoveredCards = computed<WritingCard[]>(() => {
  const place = hoveredPlace.value;
  if (!place) return [];
  return place.cardIds
    .map((id) => libraryStore.cards.find((c) => c.id === id))
    .filter((c): c is WritingCard => !!c);
});

/** Plain-text excerpt for the hover panel. */
function cardExcerpt(card: WritingCard, limit = 150): string {
  const text = card.content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_~[\]()!-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text || "（空卡片）";
}

/* ---------------- path & group panel ---------------- */

const ungroupedPaths = computed(() => pathsOfGroup(null));
const renamingPathId = ref<string | null>(null);
const renamingGroupId = ref<string | null>(null);
const renameDraft = ref("");

function startRenamePath(path: MapPath) {
  renamingPathId.value = path.id;
  renameDraft.value = path.name;
}

function commitRenamePath() {
  if (renamingPathId.value) renamePath(renamingPathId.value, renameDraft.value);
  renamingPathId.value = null;
}

function startRenameGroup(groupId: string, title: string) {
  renamingGroupId.value = groupId;
  renameDraft.value = title;
}

function commitRenameGroup() {
  if (renamingGroupId.value) renameGroup(renamingGroupId.value, renameDraft.value);
  renamingGroupId.value = null;
}

function onRandomPath() {
  const { width, height } = stageSize.value;
  const path = generateRandomPath(width, height);
  /* Generation works in 0..size space; shift it into whatever region the user
     has panned into so the new path appears on screen, not off in the margin. */
  if (panOffset.value.x !== 0 || panOffset.value.y !== 0) {
    const z = canvasZoom.value;
    for (const pt of path.points) {
      pt.x -= panOffset.value.x / z;
      pt.y -= panOffset.value.y / z;
    }
    syncAnchoredPlaces(path.id);
  }
  mapStore.activePathId = path.id;
  setSelectedPaths([path.id]);
  showToast("已生成随机路径", `${path.name} · ${path.points.length} 个节点`, "habit");
}

function onNewPath() {
  setTool("draw");
  showToast("绘制模式", "在画布上依次点击添加节点，双击或回车结束", "edit");
}

function onGroupAllUngrouped() {
  /* Prefer an explicit box-selection when there is one. */
  if (mapStore.selectedPathIds.length >= 1) {
    const count = mapStore.selectedPathIds.length;
    const group = groupSelectedPaths();
    if (group) showToast("已打组", `${count} 条选中路径收纳进「${group.title}」`, "habit");
    return;
  }

  const ids = ungroupedPaths.value.map((p) => p.id);
  if (ids.length < 2) {
    showToast("请先框选路径", "用「框选」工具或 Shift+拖拽选中多条路径后再打组", "edit");
    return;
  }
  const group = groupPaths(ids);
  if (group) showToast("已打组", `${ids.length} 条路径收纳进「${group.title}」`, "habit");
}

function onDeleteSelected() {
  const removed = deleteSelectedPaths();
  if (removed > 0) showToast("已删除", `${removed} 条路径已移除`, "edit");
}

function onClearMap() {
  if (mapStore.paths.length === 0) return;
  clearMap();
  drawingPathId.value = null;
  showToast("地图已清空", "所有路径与地点已移除", "edit");
}

/** Move a path into a group (or out to the ungrouped list). */
function onAssignGroup(pathId: string, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  assignPathToGroup(pathId, value || null);
}

/* ---------------- stroke width ---------------- */

const activePath = computed(() => findPath(mapStore.activePathId));

/** Slider drives the whole selection when several paths are picked. */
const widthModel = computed({
  get: () => activePath.value?.width ?? PATH_WIDTH_DEFAULT,
  set: (value: number) => {
    const width = clampPathWidth(value);
    if (mapStore.selectedPathIds.length > 1) setSelectedPathsWidth(width);
    else if (mapStore.activePathId) setPathWidth(mapStore.activePathId, width);
  },
});

function onWidthInput(event: Event) {
  widthModel.value = Number((event.target as HTMLInputElement).value);
}

function onPickColor(color: string) {
  if (mapStore.selectedPathIds.length > 1) setSelectedPathsColor(color);
  else if (mapStore.activePathId) setPathColor(mapStore.activePathId, color);
}

const totalPlaces = computed(() => mapStore.places.length);
const totalAttached = computed(() =>
  mapStore.places.reduce((sum, pl) => sum + pl.cardIds.length, 0),
);

/* Keep the inspector honest if the selection disappears. */
watch(
  () => mapStore.selectedPlaceId,
  (id) => {
    if (id) inspectorOpen.value = true;
  },
);

const stageCursor = computed(() => {
  if (isPanning.value) return "grabbing";
  if (isPanActive()) return "grab";
  if (mapStore.tool === "draw") return "crosshair";
  if (mapStore.tool === "place") return "copy";
  if (mapStore.tool === "erase") return "not-allowed";
  if (mapStore.tool === "marquee") return "crosshair";
  return "default";
});

const widthMin = PATH_WIDTH_MIN;
const widthMax = PATH_WIDTH_MAX;
</script>

<template>
  <div class="map-view">
    <!-- ======== 顶部工具条 ======== -->
    <header class="map-toolbar">
      <div class="map-tool-group">
        <button
          class="map-tool"
          :class="{ active: mapStore.tool === 'select' }"
          title="选择 / 拖动节点与地点 (V)"
          @click="setTool('select')"
        >
          <MousePointer2 :size="16" :stroke-width="1.8" />
        </button>
        <button
          class="map-tool"
          :class="{ active: mapStore.tool === 'draw' }"
          title="绘制路径：依次点击添加节点，双击或回车结束 (P)"
          @click="setTool('draw')"
        >
          <Pencil :size="16" :stroke-width="1.8" />
        </button>
        <button
          class="map-tool"
          :class="{ active: mapStore.tool === 'place' }"
          title="放置地点：点击路径上任意位置 (M)，靠近节点会自动吸附"
          @click="setTool('place')"
        >
          <MapPin :size="16" :stroke-width="1.8" />
        </button>
        <button
          class="map-tool"
          :class="{ active: mapStore.tool === 'marquee' }"
          title="框选多条路径 (B)；选择工具下按住 Shift 拖拽同样可框选"
          @click="setTool('marquee')"
        >
          <BoxSelect :size="16" :stroke-width="1.8" />
        </button>
        <button
          class="map-tool"
          :class="{ active: mapStore.tool === 'erase' }"
          title="擦除：点击节点或地点删除 (E)"
          @click="setTool('erase')"
        >
          <Eraser :size="16" :stroke-width="1.8" />
        </button>
      </div>

      <span class="map-divider"></span>

      <button class="map-btn" title="新建路径" @click="onNewPath">
        <Plus :size="15" :stroke-width="2" />
        新建路径
      </button>
      <button class="map-btn" title="随机生成一条带地点的路径" @click="onRandomPath">
        <Shuffle :size="15" :stroke-width="1.9" />
        随机路径
      </button>
      <button class="map-btn" title="把选中路径（或全部未分组路径）收纳成一组 (Ctrl+G)" @click="onGroupAllUngrouped">
        <Layers :size="15" :stroke-width="1.9" />
        打组收纳
      </button>

      <span class="map-divider"></span>

      <!-- 路径粗细 -->
      <div class="map-width-control" :class="{ disabled: !activePath }" :title="`路径粗细 ${widthModel}px`">
        <Minus :size="13" :stroke-width="2.2" />
        <input
          type="range"
          class="map-width-slider"
          :min="widthMin"
          :max="widthMax"
          step="1"
          :value="widthModel"
          :disabled="!activePath"
          @input="onWidthInput"
        />
        <span class="map-width-value">{{ widthModel }}</span>
      </div>

      <span class="map-divider"></span>

      <button
        class="map-tool"
        :class="{ active: mapStore.showGrid }"
        title="网格底纹"
        @click="mapStore.showGrid = !mapStore.showGrid"
      >
        <Grid3x3 :size="16" :stroke-width="1.8" />
      </button>
      <button
        class="map-tool"
        :class="{ active: isPanActive() }"
        title="按住空格 + 左键拖拽可自由移动画布；滚轮缩放，按 0 复位"
        @click="resetPan"
      >
        <Move :size="16" :stroke-width="1.8" />
      </button>
      <span class="map-zoom-readout" :class="{ off: canvasZoom === 1 }">
        {{ Math.round(canvasZoom * 100) }}%
      </span>
      <button
        v-if="drawingPathId"
        class="map-btn subtle"
        title="撤销上一个节点 (Ctrl+Z)"
        @click="removeLastPoint(drawingPathId!)"
      >
        <Undo2 :size="15" :stroke-width="1.9" />
        撤销节点
      </button>
      <button v-if="drawingPathId" class="map-btn primary" title="结束绘制 (Enter)" @click="finishDrawing">
        <Check :size="15" :stroke-width="2.2" />
        完成绘制
      </button>
      <button
        v-if="mapStore.selectedPathIds.length > 0"
        class="map-btn subtle"
        :title="`删除选中的 ${mapStore.selectedPathIds.length} 条路径`"
        @click="onDeleteSelected"
      >
        <Trash2 :size="15" :stroke-width="1.9" />
        删除选中
      </button>

      <div class="map-toolbar-spacer"></div>

      <span v-if="mapStore.selectedPathIds.length > 0" class="map-selection-chip">
        已选 {{ mapStore.selectedPathIds.length }} 条
      </span>
      <span class="map-stats">
        {{ mapStore.paths.length }} 条路径 · {{ totalPlaces }} 个地点 · {{ totalAttached }} 张卡片
      </span>
      <button class="map-tool danger" title="清空地图" @click="onClearMap">
        <Trash2 :size="16" :stroke-width="1.8" />
      </button>
      <button class="map-tool" title="关闭地图 (Esc)" @click="emit('close')">
        <X :size="16" :stroke-width="1.9" />
      </button>
    </header>

    <div class="map-body">
      <!-- ======== 路径 / 分组侧栏 ======== -->
      <aside class="map-side">
        <div class="map-side-head">
          <span>路径列表</span>
          <button class="map-mini-btn" title="新建路径组" @click="createGroup()">
            <Plus :size="13" :stroke-width="2.2" />
          </button>
        </div>

        <div class="map-side-scroll">
          <div v-if="mapStore.paths.length === 0 && mapStore.groups.length === 0" class="map-side-empty">
            还没有路径。点「新建路径」手绘，或「随机路径」快速生成。
          </div>

          <!-- 分组（可折叠收纳） -->
          <div v-for="group in mapStore.groups" :key="group.id" class="map-group">
            <div class="map-group-head" @click="toggleGroupCollapsed(group.id)">
              <ChevronDown v-if="!group.collapsed" :size="13" :stroke-width="2.2" />
              <ChevronRight v-else :size="13" :stroke-width="2.2" />

              <input
                v-if="renamingGroupId === group.id"
                v-model="renameDraft"
                class="map-inline-input"
                @click.stop
                @keydown.enter="commitRenameGroup"
                @blur="commitRenameGroup"
              />
              <span v-else class="map-group-title" @dblclick.stop="startRenameGroup(group.id, group.title)">
                {{ group.title }}
              </span>

              <span class="map-group-count">{{ pathsOfGroup(group.id).length }}</span>
              <button class="map-mini-btn danger" title="解散分组" @click.stop="deleteGroup(group.id)">
                <Unlink :size="12" :stroke-width="1.9" />
              </button>
            </div>

            <div v-if="!group.collapsed" class="map-group-body">
              <div
                v-for="path in pathsOfGroup(group.id)"
                :key="path.id"
                class="map-path-row"
                :class="{ active: mapStore.activePathId === path.id }"
                @click="mapStore.activePathId = path.id"
              >
                <span class="map-path-swatch" :style="{ background: path.color }"></span>
                <input
                  v-if="renamingPathId === path.id"
                  v-model="renameDraft"
                  class="map-inline-input"
                  @click.stop
                  @keydown.enter="commitRenamePath"
                  @blur="commitRenamePath"
                />
                <span v-else class="map-path-name" @dblclick.stop="startRenamePath(path)">{{ path.name }}</span>
                <span class="map-path-meta">{{ placesOfPath(path.id).length }}</span>
                <button class="map-mini-btn" :title="path.visible ? '隐藏' : '显示'" @click.stop="togglePathVisible(path.id)">
                  <Eye v-if="path.visible" :size="12" :stroke-width="1.9" />
                  <EyeOff v-else :size="12" :stroke-width="1.9" />
                </button>
                <button class="map-mini-btn danger" title="删除路径" @click.stop="deletePath(path.id)">
                  <Trash2 :size="12" :stroke-width="1.9" />
                </button>
              </div>
              <div v-if="pathsOfGroup(group.id).length === 0" class="map-side-empty small">组内暂无路径</div>
            </div>
          </div>

          <!-- 未分组路径 -->
          <div v-if="ungroupedPaths.length > 0" class="map-side-caption">未分组</div>
          <div
            v-for="path in ungroupedPaths"
            :key="path.id"
            class="map-path-row"
            :class="{ active: mapStore.activePathId === path.id }"
            @click="mapStore.activePathId = path.id"
          >
            <span class="map-path-swatch" :style="{ background: path.color }"></span>
            <input
              v-if="renamingPathId === path.id"
              v-model="renameDraft"
              class="map-inline-input"
              @click.stop
              @keydown.enter="commitRenamePath"
              @blur="commitRenamePath"
            />
            <span v-else class="map-path-name" @dblclick.stop="startRenamePath(path)">{{ path.name }}</span>
            <span class="map-path-meta">{{ placesOfPath(path.id).length }}</span>
            <button class="map-mini-btn" :title="path.visible ? '隐藏' : '显示'" @click.stop="togglePathVisible(path.id)">
              <Eye v-if="path.visible" :size="12" :stroke-width="1.9" />
              <EyeOff v-else :size="12" :stroke-width="1.9" />
            </button>
            <button class="map-mini-btn danger" title="删除路径" @click.stop="deletePath(path.id)">
              <Trash2 :size="12" :stroke-width="1.9" />
            </button>
          </div>

          <!-- 选中路径的配色与归组 -->
          <div v-if="activePath" class="map-path-config">
            <div class="map-config-label">
              路径配色
              <span v-if="mapStore.selectedPathIds.length > 1" class="map-config-note">
                作用于 {{ mapStore.selectedPathIds.length }} 条
              </span>
            </div>
            <div class="map-color-row">
              <button
                v-for="c in PATH_COLORS"
                :key="c"
                class="map-color-dot"
                :class="{ active: activePath.color === c }"
                :style="{ background: c }"
                @click="onPickColor(c)"
              ></button>
            </div>

            <div class="map-config-label">路径粗细 · {{ widthModel }}px</div>
            <input
              type="range"
              class="map-width-slider full"
              :min="widthMin"
              :max="widthMax"
              step="1"
              :value="widthModel"
              @input="onWidthInput"
            />

            <div class="map-config-label">归入分组</div>
            <select
              class="map-select"
              :value="activePath.groupId ?? ''"
              @change="onAssignGroup(activePath.id, $event)"
            >
              <option value="">（未分组）</option>
              <option v-for="g in mapStore.groups" :key="g.id" :value="g.id">{{ g.title }}</option>
            </select>
          </div>
        </div>
      </aside>

      <!-- ======== 画布 ======== -->
      <div class="map-stage-wrap" @wheel="onMapWheel">
        <svg
          ref="stageRef"
          class="map-stage"
          :class="{ grid: mapStore.showGrid }"
          :style="{ cursor: stageCursor }"
          @click="onStageClick"
          @mousedown="onStageMouseDown"
          @mousemove="onStageMove"
          @mouseleave="onStageLeave"
          @dblclick="finishDrawing"
        >
          <defs>
            <pattern id="mapGrid" width="26" height="26" patternUnits="userSpaceOnUse">
              <circle cx="1.5" cy="1.5" r="1.1" fill="rgb(var(--primary-rgb) / 0.18)" />
            </pattern>
          </defs>

          <!-- 所有地图内容随平移与缩放一起变化 -->
          <g :transform="`translate(${panOffset.x} ${panOffset.y}) scale(${canvasZoom})`">
          <!-- Grid lives inside the pan group so it scrolls with the paper.
               Oversized well past the viewport so panning never exposes an edge. -->
          <rect
            v-if="mapStore.showGrid"
            x="-3000"
            y="-3000"
            width="6000"
            height="6000"
            fill="url(#mapGrid)"
          />

          <!-- 路径 -->
          <g v-for="path in visiblePaths" :key="path.id">
            <!-- 加宽的透明描边，便于点击命中 -->
            <path
              :d="buildPathD(path.points)"
              class="map-hit"
              :stroke-width="Math.max(18, path.width + 14)"
              @click="onPathClick($event, path)"
            />
            <!-- 框选高亮：在主描边下方画一圈更粗的光环 -->
            <path
              v-if="isPathSelected(path.id)"
              :d="buildPathD(path.points)"
              class="map-line-halo"
              :stroke-width="path.width + 9"
            />
            <path
              :d="buildPathD(path.points)"
              class="map-line"
              :class="{ active: mapStore.activePathId === path.id }"
              :stroke="path.color"
              :stroke-width="path.width"
            />
            <!-- 端点圆点，呼应参考图的路径两端 -->
            <circle
              v-if="path.points.length > 0"
              :cx="path.points[0].x"
              :cy="path.points[0].y"
              :r="path.width * 0.78"
              :fill="path.color"
              class="map-endcap"
            />
            <circle
              v-if="path.points.length > 1"
              :cx="path.points[path.points.length - 1].x"
              :cy="path.points[path.points.length - 1].y"
              :r="path.width * 0.78"
              :fill="path.color"
              class="map-endcap"
            />

            <!-- 节点手柄（选中路径时显示） -->
            <template v-if="mapStore.activePathId === path.id && mapStore.tool !== 'place'">
              <circle
                v-for="(pt, i) in path.points"
                :key="i"
                :cx="pt.x"
                :cy="pt.y"
                r="5.5"
                class="map-vertex"
                :class="{ erasing: mapStore.tool === 'erase' }"
                @mousedown="onVertexMouseDown($event, path, i)"
              />
            </template>

            <!-- 磁吸提示：拖动地点靠近节点时的吸附环 -->
            <circle
              v-if="snapHintVertex?.pathId === path.id && path.points[snapHintVertex.index]"
              :cx="path.points[snapHintVertex.index].x"
              :cy="path.points[snapHintVertex.index].y"
              :r="VERTEX_SNAP_RADIUS * 0.7"
              class="map-snap-ring"
            />
          </g>

          <!-- 绘制中的预览线 -->
          <path v-if="draftPreviewD" :d="draftPreviewD" class="map-draft" />

          <!-- 框选矩形 -->
          <rect
            v-if="marqueeRect"
            class="map-marquee"
            :x="marqueeRect.x"
            :y="marqueeRect.y"
            :width="marqueeRect.width"
            :height="marqueeRect.height"
          />
          </g>
        </svg>

        <!-- 地点标记（HTML 层，便于承载图标与标签） -->
        <div
          class="map-markers"
          :style="{ transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${canvasZoom})`, transformOrigin: '0 0' }"
        >
          <div
            v-for="place in visiblePlaces"
            :key="place.id"
            class="map-marker"
            :class="{
              selected: mapStore.selectedPlaceId === place.id,
              anchored: place.anchorIndex !== undefined,
              hovered: hoveredPlaceId === place.id,
            }"
            :style="{
              left: placePosition(place).x + 'px',
              top: placePosition(place).y + 'px',
              '--marker-color': pathColorOf(place),
            }"
            @mousedown="onPlaceMouseDown($event, place)"
            @mouseenter="onPlaceEnter(place)"
            @mouseleave="onPlaceLeave"
          >
            <span
              class="map-marker-pin"
              :style="{ '--marker-color': pathColorOf(place), '--icon-color': PLACE_ICON_COLORS[place.icon].color }"
              :title="place.anchorIndex !== undefined ? 'Ctrl + 左键拖拽可移动地点位置（已吸附在节点上）' : 'Ctrl + 左键拖拽可移动地点位置'"
            >
              <component :is="iconComponent(place.icon)" :size="15" :stroke-width="1.9" :style="{ color: PLACE_ICON_COLORS[place.icon].color }" />
            </span>
            <!-- 标签仅在用户命名或挂了卡片时出现，不显示占位数字 -->
            <span v-if="place.label.trim() || place.cardIds.length > 0" class="map-marker-label">
              <span v-if="place.label.trim()">{{ place.label }}</span>
              <span v-if="place.cardIds.length > 0" class="map-marker-badge">{{ place.cardIds.length }}</span>
            </span>

            <!-- 悬浮时展示已附着的文本卡片（带平滑延迟与直接编辑能力） -->
            <div
              v-if="hoveredPlaceId === place.id && hoveredCards.length > 0"
              class="map-card-hover"
              @mousedown.stop
              @mouseenter="onPopoverEnter"
              @mouseleave="onPopoverLeave"
            >
              <div class="map-card-hover-head">
                <component
                  :is="iconComponent(place.icon)"
                  :size="13"
                  :stroke-width="2"
                  :style="{ color: PLACE_ICON_COLORS[place.icon].color }"
                />
                <span class="map-card-hover-title">{{ placeName(place) }}</span>
                <span class="map-card-hover-count">{{ hoveredCards.length }} 张卡片</span>
              </div>
              <article
                v-for="card in hoveredCards"
                :key="card.id"
                class="map-card-hover-item"
                :style="{ '--card-accent': resolveCardAccent(card) }"
                @click.stop="openCardEditor(card.id)"
              >
                <header class="map-card-hover-accent">{{ card.title }}</header>
                <p class="map-card-hover-body">{{ cardExcerpt(card) }}</p>
                <div class="map-card-hover-actions">
                  <button class="map-card-hover-open" @click.stop="openCardEditor(card.id)">
                    编辑卡片
                  </button>
                  <button class="map-card-hover-open secondary" @click.stop="emit('focusCard', card.id)">
                    画布定位
                  </button>
                </div>
              </article>
            </div>
          </div>
        </div>

        <div v-if="mapStore.paths.length === 0" class="map-stage-empty">
          <MapPin :size="26" :stroke-width="1.6" />
          <p>用「新建路径」手绘故事动线，或「随机路径」先生成一条</p>
          <p class="hint">路径画好后切到「放置地点」，点路径即可标注地点，再把文本卡片附着上去</p>
          <p class="hint">空格 + 左键拖拽移动画布 · Shift + 拖拽框选路径</p>
        </div>
      </div>

      <!-- ======== 地点检查器 ======== -->
      <aside v-if="selectedPlace && inspectorOpen" class="map-inspector">
        <div class="map-side-head">
          <span>地点设置</span>
          <button class="map-mini-btn" title="收起" @click="inspectorOpen = false">
            <X :size="13" :stroke-width="2" />
          </button>
        </div>

        <div class="map-side-scroll">
          <label class="map-config-label">名称</label>
          <input
            class="map-input"
            placeholder="未命名（留空则不显示标签）"
            :value="selectedPlace.label"
            @input="updatePlace(selectedPlace.id, { label: ($event.target as HTMLInputElement).value })"
          />

          <label class="map-config-label">节点吸附</label>
          <div class="map-anchor-row">
            <span class="map-anchor-state" :class="{ on: selectedPlace.anchorIndex !== undefined }">
              <Magnet :size="12" :stroke-width="2" />
              {{
                selectedPlace.anchorIndex !== undefined
                  ? `已锁定第 ${selectedPlace.anchorIndex + 1} 个节点`
                  : "沿路径自由定位"
              }}
            </span>
            <button
              v-if="selectedPlace.anchorIndex === undefined"
              class="map-small-btn"
              title="吸附到最近的节点"
              @click="onSnapToNearestVertex"
            >
              吸附
            </button>
            <button
              v-else
              class="map-small-btn"
              title="解除吸附，可沿路径自由移动"
              @click="releasePlaceAnchor(selectedPlace.id)"
            >
              解除
            </button>
          </div>
          <p class="map-anchor-hint">
            锁定在节点上的地点会跟着节点一起移动，改变路径形状也不会脱离。
          </p>

          <label class="map-config-label">图标画板</label>
          <div class="map-icon-grid">
            <button
              v-for="opt in PLACE_ICONS"
              :key="opt.id"
              class="map-icon-btn"
              :class="{ active: selectedPlace.icon === opt.id }"
              :style="selectedPlace.icon === opt.id
                ? { background: PLACE_ICON_COLORS[opt.id].color, borderColor: PLACE_ICON_COLORS[opt.id].color, color: '#ffffff' }
                : { color: PLACE_ICON_COLORS[opt.id].color, background: PLACE_ICON_COLORS[opt.id].bg, borderColor: 'rgba(0,0,0,0.08)' }"
              :title="opt.label"
              @click="onPlaceIconChange(opt.id)"
            >
              <component :is="iconComponent(opt.id)" :size="16" :stroke-width="2" />
            </button>
          </div>

          <label class="map-config-label">备注</label>
          <textarea
            v-auto-pair
            class="map-textarea"
            rows="3"
            placeholder="这个地点发生了什么…"
            :value="selectedPlace.note ?? ''"
            @input="updatePlace(selectedPlace.id, { note: ($event.target as HTMLTextAreaElement).value })"
          ></textarea>

          <div class="map-config-label with-action">
            <span>附着的文本卡片（{{ attachedCards.length }}）</span>
            <button class="map-mini-btn" title="附着卡片" @click="cardPickerOpen = !cardPickerOpen">
              <Link2 :size="13" :stroke-width="2" />
            </button>
          </div>

          <div v-if="cardPickerOpen" class="map-card-picker">
            <div v-if="attachableCards.length === 0" class="map-side-empty small">没有可附着的卡片</div>
            <button
              v-for="card in attachableCards"
              :key="card.id"
              class="map-card-option"
              :style="{ '--card-accent': resolveCardAccent(card) }"
              @click="onAttachCard(card.id)"
            >
              <span class="map-card-strip"></span>
              <span class="map-card-name">{{ card.title }}</span>
            </button>
          </div>

          <div v-if="attachedCards.length === 0" class="map-side-empty small">
            尚未附着卡片。点上方链接图标，把写作卡片挂到这个地点。
          </div>
          <div
            v-for="card in attachedCards"
            :key="card.id"
            class="map-attached"
            :style="{ '--card-accent': resolveCardAccent(card) }"
          >
            <span class="map-card-strip"></span>
            <span class="map-card-name" :title="card.title">{{ card.title }}</span>
            <button class="map-mini-btn" title="在画布中定位" @click="emit('focusCard', card.id)">
              <MousePointer2 :size="12" :stroke-width="1.9" />
            </button>
            <button class="map-mini-btn danger" title="取消附着" @click="onDetachCard(card.id)">
              <Unlink :size="12" :stroke-width="1.9" />
            </button>
          </div>

          <button class="map-danger-btn" @click="deletePlace(selectedPlace.id)">
            <Trash2 :size="13" :stroke-width="1.9" />
            删除该地点
          </button>
        </div>
      </aside>
    </div>

    <!-- 地图直接编辑卡片弹窗 -->
    <Teleport to="body">
      <div v-if="editingCard" class="map-card-modal-mask">
        <div
          class="map-card-modal-shell"
          :style="{ left: panelRect.x + 'px', top: panelRect.y + 'px', width: panelRect.w + 'px', height: panelRect.h + 'px' }"
        >
          <div class="map-card-modal-header" @mousedown.stop="startPanelDrag">
            <div class="map-card-modal-header-main">
              <span class="label-caps">地图关联卡片编辑</span>
              <div class="map-card-modal-title-row">
                <input
                  v-model="editingCard.title"
                  v-auto-pair
                  class="map-card-title-input"
                  placeholder="卡片标题"
                />
                <div class="map-card-accent-dots" title="卡片顶部色条颜色">
                  <button
                    v-for="c in CARD_ACCENTS"
                    :key="c"
                    class="accent-dot"
                    :class="{ active: editingCard.accent === c }"
                    :style="{ background: c }"
                    @click="setEditingAccent(c)"
                  ></button>
                  <button
                    class="accent-dot accent-dot-auto"
                    :class="{ active: !editingCard.accent }"
                    :style="{ background: resolveCardAccent({ id: editingCard.id }) }"
                    title="自动"
                    @click="setEditingAccent(null)"
                  >
                    <Shuffle :size="12" :stroke-width="2.6" />
                  </button>
                </div>
                <button
                  class="pin-card-btn"
                  :class="{ on: editingCard.pinned }"
                  :title="editingCard.pinned ? '取消置顶与空白保护' : '置顶此卡片（点击空白不再关闭）'"
                  @click="setEditingPinned"
                >
                  <Pin :size="14" :stroke-width="1.9" :fill="editingCard.pinned ? 'currentColor' : 'none'" />
                </button>
                <span class="map-title-row-spacer"></span>
              </div>
            </div>
            <button class="map-card-modal-close" title="关闭" @click="closeCardEditor">
              <X :size="18" :stroke-width="1.8" />
            </button>
          </div>
          <div class="map-card-modal-editor">
            <DocumentViewer v-model="editingCard.content" embedded single-editor ring-slot="mapCard" />
          </div>
          <div class="map-card-modal-footer">
            <button class="map-card-done-btn" @click="closeCardEditor">保存并关闭</button>
          </div>
          <div class="map-resize-handle" title="拖拽右下角调整大小" @mousedown.stop="startPanelResize"></div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.map-view {
  position: absolute;
  inset: 0;
  z-index: 24;
  display: flex;
  flex-direction: column;
  background: var(--surface-container-lowest);
}

/* ---------------- toolbar ---------------- */

.map-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
}

.map-tool-group {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: var(--surface-container);
}

.map-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.map-tool:hover {
  background: var(--surface-container-high);
}

.map-tool.active {
  background: var(--primary);
  color: #fff;
}

.map-tool.danger:hover {
  color: var(--error);
}

.map-divider {
  width: 1px;
  height: 18px;
  background: var(--outline-variant);
  margin: 0 2px;
}

.map-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.map-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.map-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
  font-weight: 600;
}

.map-btn.primary:hover {
  background: var(--primary-container);
  color: #fff;
}

.map-btn.subtle {
  background: transparent;
}

.map-toolbar-spacer {
  flex: 1;
}

.map-selection-chip {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--primary);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

/* ---- stroke width ---- */

.map-width-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  padding: 0 8px;
  height: 28px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.map-width-control.disabled {
  opacity: 0.5;
}

.map-width-slider {
  width: 92px;
  accent-color: var(--primary);
  cursor: pointer;
}

.map-width-slider.full {
  width: 100%;
}

.map-width-value {
  min-width: 18px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  text-align: right;
}

.map-stats {
  font-size: 11px;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.map-zoom-readout {
  min-width: 40px;
  padding: 3px 6px;
  border-radius: 6px;
  background: var(--surface-container);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  text-align: center;
  color: var(--on-surface-variant);
  font-variant-numeric: tabular-nums;
}

.map-zoom-readout.off {
  background: transparent;
  color: var(--on-surface-variant);
  opacity: 0.55;
}

/* ---------------- layout ---------------- */

.map-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.map-side,
.map-inspector {
  flex-shrink: 0;
  width: 216px;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border-right: 1px solid var(--outline-variant);
}

.map-inspector {
  width: 238px;
  border-right: none;
  border-left: 1px solid var(--outline-variant);
}

.map-side-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 10px;
  border-bottom: 1px solid var(--outline-variant);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--on-surface-variant);
  text-transform: uppercase;
}

.map-side-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.map-side-empty {
  padding: 12px 10px;
  border: 1px dashed var(--outline-variant);
  border-radius: 8px;
  font-size: 11px;
  line-height: 1.65;
  color: var(--on-surface-variant);
}

.map-side-empty.small {
  padding: 8px;
  border: none;
  text-align: center;
}

.map-side-caption {
  margin: 8px 2px 4px;
  font-size: 10px;
  letter-spacing: 0.05em;
  color: var(--on-surface-variant);
  text-transform: uppercase;
}

.map-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
}

.map-mini-btn:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.map-mini-btn.danger:hover {
  color: var(--error);
}

/* ---------------- path list ---------------- */

.map-group {
  margin-bottom: 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  overflow: hidden;
}

.map-group-head {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 7px;
  background: var(--surface-container-low);
  cursor: pointer;
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.map-group-head:hover {
  background: var(--surface-container);
}

.map-group-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-group-count {
  padding: 0 6px;
  border-radius: 999px;
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-size: 10px;
  font-weight: 700;
}

.map-group-body {
  padding: 4px;
}

.map-path-row {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--on-surface-variant);
}

.map-path-row:hover {
  background: var(--surface-container);
}

.map-path-row.active {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-weight: 600;
}

.map-path-swatch {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.15);
}

.map-path-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-path-meta {
  flex-shrink: 0;
  font-size: 10px;
  opacity: 0.75;
}

.map-inline-input {
  flex: 1;
  min-width: 0;
  padding: 2px 5px;
  border: 1px solid var(--primary);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.map-path-config {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px solid var(--outline-variant);
}

.map-config-label {
  display: block;
  margin: 8px 0 5px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--on-surface-variant);
  text-transform: uppercase;
}

.map-config-label.with-action {
  display: flex;
  align-items: center;
  justify-content: space-between;
  text-transform: none;
  letter-spacing: 0;
  font-size: 11px;
}

.map-config-note {
  margin-left: 6px;
  text-transform: none;
  letter-spacing: 0;
  font-weight: 500;
  color: var(--primary);
}

/* ---- anchor row ---- */

.map-anchor-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.map-anchor-state {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex: 1;
  min-width: 0;
  padding: 5px 7px;
  border-radius: 6px;
  background: var(--surface-container);
  font-size: 11px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-anchor-state.on {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-weight: 600;
}

.map-small-btn {
  flex-shrink: 0;
  padding: 5px 9px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 11px;
  cursor: pointer;
}

.map-small-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.map-anchor-hint {
  margin: 6px 0 0;
  font-size: 10.5px;
  line-height: 1.6;
  color: var(--on-surface-variant);
}

.map-color-row {
  display: flex;
  gap: 5px;
}

.map-color-dot {
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.15);
  transition: transform 0.13s ease;
}

.map-color-dot:hover {
  transform: scale(1.18);
}

.map-color-dot.active {
  box-shadow: 0 0 0 2px var(--on-surface);
}

.map-select,
.map-input,
.map-textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 12px;
  outline: none;
}

.map-textarea {
  resize: vertical;
  line-height: 1.55;
}

.map-select:focus,
.map-input:focus,
.map-textarea:focus {
  border-color: var(--primary);
}

/* ---------------- stage ---------------- */

.map-stage-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  background:
    linear-gradient(135deg, rgb(var(--primary-rgb) / 0.04), transparent 60%),
    var(--surface-container-lowest);
}

.map-stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.map-line {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Slight softness so the stroke reads as ink rather than a vector line. */
  filter: drop-shadow(0 1px 1px rgb(15 23 42 / 0.12));
  transition: opacity 0.15s ease;
  pointer-events: none;
}

.map-line.active {
  filter: drop-shadow(0 2px 3px rgb(15 23 42 / 0.2));
}

.map-hit {
  fill: none;
  stroke: transparent;
  stroke-linecap: round;
  cursor: pointer;
}

.map-endcap {
  pointer-events: none;
  filter: drop-shadow(0 1px 1px rgb(15 23 42 / 0.14));
}

.map-vertex {
  fill: #fff;
  stroke: var(--primary);
  stroke-width: 2;
  cursor: grab;
}

.map-vertex:hover {
  fill: var(--primary-fixed-dim, #dfe3ef);
}

.map-vertex.erasing {
  stroke: var(--error);
  cursor: not-allowed;
}

.map-draft {
  fill: none;
  stroke: var(--primary);
  stroke-width: 2;
  stroke-dasharray: 6 5;
  opacity: 0.7;
  pointer-events: none;
}

/* ---- selection + snapping affordances ---- */

.map-line-halo {
  fill: none;
  stroke: var(--primary);
  stroke-opacity: 0.28;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}

.map-marquee {
  fill: rgb(var(--primary-rgb) / 0.1);
  stroke: var(--primary);
  stroke-width: 1;
  stroke-dasharray: 5 4;
  pointer-events: none;
}

.map-snap-ring {
  fill: rgb(var(--primary-rgb) / 0.12);
  stroke: var(--primary);
  stroke-width: 2;
  stroke-dasharray: 3 3;
  pointer-events: none;
  animation: mapSnapPulse 0.9s ease-in-out infinite;
}

@keyframes mapSnapPulse {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 1; }
}

.map-stage-empty {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  pointer-events: none;
  color: var(--on-surface-variant);
  text-align: center;
  padding: 0 40px;
}

.map-stage-empty p {
  margin: 0;
  font-size: 13px;
}

.map-stage-empty .hint {
  font-size: 11px;
  opacity: 0.8;
}

/* ---------------- markers ---------------- */

.map-markers {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.map-marker {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  /* Anchor the pin tip on the path point. */
  transform: translate(-50%, -100%);
  pointer-events: auto;
  cursor: grab;
  user-select: none;
  /*
   * The transform above makes each marker its own stacking context, so a
   * child's z-index can never lift it above a sibling marker. Markers must
   * therefore be ordered against each other here: the hovered one goes on top
   * so its card panel is not occluded by neighbouring pins.
   */
  z-index: 1;
}

.map-marker.selected {
  z-index: 2;
}

.map-marker.hovered {
  z-index: 40;
}

.map-marker-pin {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50% 50% 50% 4px;
  transform: rotate(-45deg);
  background: var(--marker-color, var(--primary));
  color: #fff;
  box-shadow: 0 3px 8px rgb(15 23 42 / 0.24);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.map-marker-pin > * {
  transform: rotate(45deg);
}

.map-marker:hover .map-marker-pin {
  transform: rotate(-45deg) scale(1.1);
}

.map-marker.selected .map-marker-pin {
  box-shadow: 0 0 0 3px #fff, 0 0 0 5px var(--marker-color, var(--primary));
}

/* A magnet-anchored place gets a small ring so the binding is visible. */
.map-marker.anchored .map-marker-pin {
  outline: 2px solid #fff;
  outline-offset: 1px;
}

/* ---- hover preview of attached cards ---- */

.map-card-hover {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  width: 244px;
  max-height: 300px;
  overflow-y: auto;
  padding: 8px;
  border-radius: 10px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: 0 14px 32px rgb(15 23 42 / 0.24);
  cursor: default;
  text-align: left;
}

.map-card-hover-head {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 7px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--outline-variant);
  font-size: 11px;
  font-weight: 700;
  color: var(--on-surface);
}

.map-card-hover-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-card-hover-count {
  flex-shrink: 0;
  font-weight: 500;
  color: var(--on-surface-variant);
}

.map-card-hover-item {
  margin-bottom: 7px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  overflow: hidden;
  background: var(--surface-container-lowest);
}

.map-card-hover-item:last-child {
  margin-bottom: 0;
}

/* Mirrors the card's own coloured header strip. */
.map-card-hover-accent {
  padding: 5px 8px;
  background: var(--card-accent, var(--primary-fixed-dim, #dfe3ef));
  box-shadow: inset 0 -1px 0 rgb(15 23 42 / 0.07);
  font-size: 11.5px;
  font-weight: 700;
  color: #1f2937;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-card-hover-body {
  margin: 0;
  padding: 6px 8px;
  font-size: 11px;
  line-height: 1.65;
  color: var(--on-surface-variant);
}

.map-card-hover-open {
  display: block;
  width: 100%;
  padding: 5px;
  border: none;
  border-top: 1px solid var(--outline-variant);
  background: transparent;
  color: var(--primary);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
}

.map-card-hover-open:hover {
  background: var(--primary-fixed-dim, #dfe3ef);
}

/* Label plate, echoing the reference map's little ticket tags. */
.map-marker-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 5px;
  background: #fffdf6;
  border: 1px solid rgb(15 23 42 / 0.12);
  box-shadow: 0 2px 5px rgb(15 23 42 / 0.14);
  font-size: 11px;
  font-weight: 700;
  color: #33405c;
  white-space: nowrap;
}

.map-marker-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 999px;
  background: var(--marker-color, var(--primary));
  color: #fff;
  font-size: 9px;
}

/* ---------------- inspector cards ---------------- */

.map-icon-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 4px;
}

.map-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
}

.map-icon-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.map-icon-btn.active {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.map-card-picker {
  max-height: 168px;
  overflow-y: auto;
  margin-bottom: 6px;
  padding: 4px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container-low);
}

.map-card-option,
.map-attached {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 6px;
  margin-bottom: 4px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  font-family: inherit;
  font-size: 12px;
  color: var(--on-surface);
  text-align: left;
}

.map-card-option {
  cursor: pointer;
}

.map-card-option:hover {
  border-color: var(--primary);
  background: var(--surface-bright);
}

.map-card-strip {
  flex-shrink: 0;
  width: 4px;
  height: 16px;
  border-radius: 2px;
  background: var(--card-accent, var(--outline-variant));
}

.map-card-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.map-danger-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  margin-top: 12px;
  padding: 7px;
  border: 1px solid var(--error);
  border-radius: 7px;
  background: transparent;
  color: var(--error);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.map-danger-btn:hover {
  background: var(--error-container);
}

.map-card-hover-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.map-card-hover-open.secondary {
  background: transparent;
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
}

.map-card-hover-open.secondary:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

/* Modal for editing attached text card directly inside Map View */
.map-card-modal-mask {
  position: fixed;
  inset: 0;
  z-index: 200;
  /* 无灰色遮罩，且不拦截点击，地图仍可继续操作。 */
  pointer-events: none;
}

.map-card-modal-shell {
  position: absolute;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  pointer-events: auto;
}

.map-card-modal-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
  cursor: move;
  user-select: none;
  -webkit-user-select: none;
}

.map-resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 5;
}

.map-card-modal-header-main {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.map-card-modal-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.map-card-title-input {
  flex: 0 1 280px;
  min-width: 120px;
  font-size: 18px;
  font-weight: 600;
  border: none;
  background: transparent;
  color: var(--on-surface);
  outline: none;
}

.map-title-row-spacer {
  flex: 1;
}

/* 置顶按钮：悬停时从上下各喷一簇彩色气泡（与画布卡片编辑面板同款）。
   图标与按钮自身配色保持原样，动效只由两个伪元素承担。 */
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

/* 气泡层。z-index 不能用负值：.map-card-modal-shell 是层叠上下文，负层级会把
   气泡压到面板背景之下完全看不见。外扩收到 55%，避开面板的 overflow: hidden。 */
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

.map-card-accent-dots {
  display: flex;
  align-items: center;
  gap: 6px;
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

.map-card-modal-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  color: var(--on-surface-variant);
  cursor: pointer;
}

.map-card-modal-close:hover {
  background: var(--surface-container-high);
}

.map-card-modal-editor {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.map-card-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 12px 20px;
  background: var(--surface-container-low);
  border-top: 1px solid var(--outline-variant);
}

.map-card-done-btn {
  padding: 7px 18px;
  border-radius: 8px;
  background: var(--primary);
  color: #ffffff;
  font-weight: 600;
  font-size: 13px;
  cursor: pointer;
}

.map-card-done-btn:hover {
  background: var(--primary-container);
}
</style>
