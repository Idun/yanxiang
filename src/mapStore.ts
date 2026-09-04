import { reactive } from "vue";

/**
 * Story map state.
 *
 * A map is a set of hand-drawn *paths* (polylines rendered as smooth curves).
 * Along each path sit *places* — pinned markers that carry a label, an icon and
 * any number of attached writing cards. Paths can be filed into collapsible
 * *groups*, mirroring how cards are grouped on the writing canvas.
 *
 * Everything here is plain data + pure geometry helpers so the view layer stays
 * thin and this module can be unit-probed on its own.
 */

/* ---------------- types ---------------- */

export interface MapPoint {
  x: number;
  y: number;
}

export type PlaceIcon = "pin" | "letter" | "flag" | "star" | "home" | "tree" | "mountain" | "anchor";

export const PLACE_ICON_COLORS: Record<PlaceIcon, { color: string; bg: string }> = {
  pin: { color: "#ef4444", bg: "#fef2f2" },
  letter: { color: "#3b82f6", bg: "#eff6ff" },
  flag: { color: "#f59e0b", bg: "#fffbeb" },
  star: { color: "#8b5cf6", bg: "#f5f3ff" },
  home: { color: "#10b981", bg: "#ecfdf5" },
  tree: { color: "#15803d", bg: "#f0fdf4" },
  mountain: { color: "#b45309", bg: "#fffbeb" },
  anchor: { color: "#0891b2", bg: "#ecfeff" },
};

export const PLACE_ICONS: { id: PlaceIcon; label: string }[] = [
  { id: "pin", label: "地点" },
  { id: "letter", label: "信件" },
  { id: "flag", label: "旗标" },
  { id: "star", label: "要点" },
  { id: "home", label: "居所" },
  { id: "tree", label: "野外" },
  { id: "mountain", label: "山地" },
  { id: "anchor", label: "港口" },
];

export interface MapPlace {
  id: string;
  pathId: string;
  /** Normalised position along the path, 0 = start, 1 = end. */
  t: number;
  /**
   * When set, the place is *bolted to* that vertex instead of floating at `t`.
   *
   * Anchored places follow the vertex when the path is reshaped, which a bare
   * `t` cannot do — reshaping changes arc lengths and would slide the marker off
   * the node it was pinned to.
   */
  anchorIndex?: number;
  label: string;
  icon: PlaceIcon;
  /** Writing-card ids pinned to this place. */
  cardIds: number[];
  note?: string;
}

export interface MapPath {
  id: string;
  name: string;
  color: string;
  width: number;
  points: MapPoint[];
  groupId: string | null;
  visible: boolean;
}

/** Stroke width bounds exposed by the UI slider. */
export const PATH_WIDTH_MIN = 2;
export const PATH_WIDTH_MAX = 18;
export const PATH_WIDTH_DEFAULT = 7;

/** Pointer distance (px) within which a dragged place snaps onto a vertex. */
export const VERTEX_SNAP_RADIUS = 18;

export interface MapGroup {
  id: string;
  title: string;
  collapsed: boolean;
}

export type MapTool = "select" | "draw" | "place" | "erase" | "marquee";

/** Path colours — soft ink tones in the spirit of a hand-drawn travel map. */
export const PATH_COLORS = [
  "#F0649C",
  "#E8833A",
  "#5AA9E6",
  "#5BBFA0",
  "#9B7FE0",
  "#D9A93B",
];

/* ---------------- state ---------------- */

export interface MapState {
  paths: MapPath[];
  places: MapPlace[];
  groups: MapGroup[];
  tool: MapTool;
  /** Path currently being drawn / edited. */
  activePathId: string | null;
  /** Multi-selection for group / bulk operations. */
  selectedPathIds: string[];
  selectedPlaceId: string | null;
  /** Points collected so far in the in-progress stroke. */
  draft: MapPoint[];
  showGrid: boolean;
  zoom: number;
}

export const mapStore = reactive<MapState>({
  paths: [],
  places: [],
  groups: [],
  tool: "select",
  activePathId: null,
  selectedPathIds: [],
  selectedPlaceId: null,
  draft: [],
  showGrid: true,
  zoom: 1,
});

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/* ---------------- geometry ---------------- */

/**
 * Catmull-Rom spline through `points`, emitted as an SVG cubic-bezier path.
 * Gives the relaxed, hand-drawn curve of the reference map instead of the
 * hard corners a raw polyline would produce.
 */
export function buildPathD(points: MapPoint[], tension = 0.5): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    const p = points[0];
    return `M ${p.x} ${p.y}`;
  }
  if (points.length === 2) {
    return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
  }

  const d: string[] = [`M ${points[0].x} ${points[0].y}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const c1x = p1.x + ((p2.x - p0.x) / 6) * tension * 2;
    const c1y = p1.y + ((p2.y - p0.y) / 6) * tension * 2;
    const c2x = p2.x - ((p3.x - p1.x) / 6) * tension * 2;
    const c2y = p2.y - ((p3.y - p1.y) / 6) * tension * 2;

    d.push(`C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`);
  }
  return d.join(" ");
}

function distance(a: MapPoint, b: MapPoint): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/** Cumulative segment lengths of the polyline through `points`. */
function cumulativeLengths(points: MapPoint[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    out.push(out[i - 1] + distance(points[i - 1], points[i]));
  }
  return out;
}

/** Normalised position of vertex `index` along its polyline. */
export function tOfVertex(points: MapPoint[], index: number): number {
  if (points.length < 2) return 0;
  const clamped = Math.max(0, Math.min(points.length - 1, index));
  const lens = cumulativeLengths(points);
  const total = lens[lens.length - 1];
  return total === 0 ? 0 : lens[clamped] / total;
}

/** Index of the vertex nearest `target`, plus its pixel distance. */
export function nearestVertex(
  points: MapPoint[],
  target: MapPoint,
): { index: number; dist: number } | null {
  if (points.length === 0) return null;
  let best = { index: 0, dist: Number.POSITIVE_INFINITY };
  for (let i = 0; i < points.length; i++) {
    const d = distance(points[i], target);
    if (d < best.dist) best = { index: i, dist: d };
  }
  return best;
}

/**
 * Point at normalised position `t` along the polyline.
 * Uses arc-length parameterisation so evenly spaced `t` values look evenly
 * spaced on screen, which naive segment indexing would not achieve.
 */
export function pointAtT(points: MapPoint[], t: number): MapPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return { ...points[0] };

  const clamped = Math.max(0, Math.min(1, t));
  const lens = cumulativeLengths(points);
  const total = lens[lens.length - 1];
  if (total === 0) return { ...points[0] };

  const target = clamped * total;
  for (let i = 1; i < lens.length; i++) {
    if (lens[i] >= target) {
      const segLen = lens[i] - lens[i - 1];
      const ratio = segLen === 0 ? 0 : (target - lens[i - 1]) / segLen;
      const a = points[i - 1];
      const b = points[i];
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
  }
  return { ...points[points.length - 1] };
}

/** Nearest position along the polyline to an arbitrary point, as `t`. */
export function closestT(points: MapPoint[], target: MapPoint): number {
  if (points.length < 2) return 0;
  const lens = cumulativeLengths(points);
  const total = lens[lens.length - 1];
  if (total === 0) return 0;

  let best = { dist: Number.POSITIVE_INFINITY, t: 0 };

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const segLenSq = dx * dx + dy * dy;

    let u = segLenSq === 0 ? 0 : ((target.x - a.x) * dx + (target.y - a.y) * dy) / segLenSq;
    u = Math.max(0, Math.min(1, u));

    const px = a.x + dx * u;
    const py = a.y + dy * u;
    const dist = Math.hypot(target.x - px, target.y - py);

    if (dist < best.dist) {
      const along = lens[i - 1] + Math.hypot(px - a.x, py - a.y);
      best = { dist, t: along / total };
    }
  }
  return best.t;
}

/* ---------------- paths ---------------- */

export function nextPathName(): string {
  return `路径 ${mapStore.paths.length + 1}`;
}

export function createPath(points: MapPoint[] = [], options?: Partial<MapPath>): MapPath {
  const path: MapPath = {
    id: uid("path"),
    name: options?.name ?? nextPathName(),
    color: options?.color ?? PATH_COLORS[mapStore.paths.length % PATH_COLORS.length],
    width: clampPathWidth(options?.width ?? PATH_WIDTH_DEFAULT),
    points: points.map((p) => ({ ...p })),
    groupId: options?.groupId ?? null,
    visible: options?.visible ?? true,
  };
  mapStore.paths.push(path);
  mapStore.activePathId = path.id;
  return path;
}

export function findPath(pathId: string | null): MapPath | undefined {
  if (!pathId) return undefined;
  return mapStore.paths.find((p) => p.id === pathId);
}

export function deletePath(pathId: string): boolean {
  const index = mapStore.paths.findIndex((p) => p.id === pathId);
  if (index === -1) return false;
  mapStore.paths.splice(index, 1);
  /* Places only exist on a path, so they go with it. */
  mapStore.places = mapStore.places.filter((pl) => pl.pathId !== pathId);
  mapStore.selectedPathIds = mapStore.selectedPathIds.filter((id) => id !== pathId);
  if (mapStore.activePathId === pathId) {
    mapStore.activePathId = mapStore.paths[0]?.id ?? null;
  }
  return true;
}

export function renamePath(pathId: string, name: string): void {
  const path = findPath(pathId);
  if (path && name.trim()) path.name = name.trim();
}

export function setPathColor(pathId: string, color: string): void {
  const path = findPath(pathId);
  if (path) path.color = color;
}

export function togglePathVisible(pathId: string): void {
  const path = findPath(pathId);
  if (path) path.visible = !path.visible;
}

/** Append a vertex to a path (used while drawing). */
export function addPointToPath(pathId: string, point: MapPoint): void {
  const path = findPath(pathId);
  if (!path) return;
  path.points.push({ ...point });
  syncAnchoredPlaces(pathId);
}

/** Remove the last vertex; drops the path entirely if fewer than 2 remain. */
export function removeLastPoint(pathId: string): void {
  const path = findPath(pathId);
  if (!path) return;
  path.points.pop();
  if (path.points.length < 2) {
    deletePath(pathId);
    return;
  }
  remapAnchors(pathId, path.points.length);
  syncAnchoredPlaces(pathId);
}

export function movePathPoint(pathId: string, index: number, point: MapPoint): void {
  const path = findPath(pathId);
  if (!path || index < 0 || index >= path.points.length) return;
  path.points[index] = { ...point };
  /* Anchored markers must travel with the vertex they are bolted to. */
  syncAnchoredPlaces(pathId);
}

/** Clamp/release anchors that point past the end of a shortened path. */
function remapAnchors(pathId: string, length: number): void {
  for (const place of mapStore.places) {
    if (place.pathId !== pathId || place.anchorIndex === undefined) continue;
    if (place.anchorIndex >= length) delete place.anchorIndex;
  }
}

/** Delete a single vertex, keeping the path if it stays valid. */
export function deletePathPoint(pathId: string, index: number): void {
  const path = findPath(pathId);
  if (!path) return;
  if (path.points.length <= 2) {
    deletePath(pathId);
    return;
  }
  path.points.splice(index, 1);

  /* Shift anchors that sat after the removed vertex; release the one on it. */
  for (const place of mapStore.places) {
    if (place.pathId !== pathId || place.anchorIndex === undefined) continue;
    if (place.anchorIndex === index) delete place.anchorIndex;
    else if (place.anchorIndex > index) place.anchorIndex -= 1;
  }
  syncAnchoredPlaces(pathId);
}

/** Insert a vertex at the polyline position nearest to `point`. */
export function insertPointNear(pathId: string, point: MapPoint): number | null {
  const path = findPath(pathId);
  if (!path || path.points.length < 2) return null;

  const t = closestT(path.points, point);
  const lens = cumulativeLengths(path.points);
  const total = lens[lens.length - 1];
  const target = t * total;

  let insertAt = path.points.length - 1;
  for (let i = 1; i < lens.length; i++) {
    if (lens[i] >= target) {
      insertAt = i;
      break;
    }
  }
  path.points.splice(insertAt, 0, { ...point });

  /* Everything at or after the insertion point shifts down by one. */
  for (const place of mapStore.places) {
    if (place.pathId !== pathId || place.anchorIndex === undefined) continue;
    if (place.anchorIndex >= insertAt) place.anchorIndex += 1;
  }
  syncAnchoredPlaces(pathId);
  return insertAt;
}

/** Clamp a stroke width into the slider's range. */
export function clampPathWidth(width: number): number {
  if (!Number.isFinite(width)) return PATH_WIDTH_DEFAULT;
  return Math.max(PATH_WIDTH_MIN, Math.min(PATH_WIDTH_MAX, Math.round(width)));
}

export function setPathWidth(pathId: string, width: number): void {
  const path = findPath(pathId);
  if (path) path.width = clampPathWidth(width);
}

/* ---------------- random generation ---------------- */

/**
 * Generate a meandering path inside `width` x `height`.
 *
 * Walks a wandering heading with a bias back towards the canvas centre so the
 * result stays on-screen while still looking organic rather than geometric.
 */
export function randomPathPoints(
  width: number,
  height: number,
  segments = 5,
  rand: () => number = Math.random,
): MapPoint[] {
  const margin = Math.min(width, height) * 0.12;
  const usableW = Math.max(40, width - margin * 2);
  const usableH = Math.max(40, height - margin * 2);

  const points: MapPoint[] = [];
  let x = margin + rand() * usableW;
  let y = margin + rand() * usableH;
  let heading = rand() * Math.PI * 2;
  const step = Math.min(usableW, usableH) / Math.max(2, segments * 0.65);

  points.push({ x, y });

  for (let i = 0; i < segments; i++) {
    /* Turn by up to ~65°, then nudge back toward the centre. */
    heading += (rand() - 0.5) * 2.2;

    const cx = margin + usableW / 2;
    const cy = margin + usableH / 2;
    const toCentre = Math.atan2(cy - y, cx - x);
    const pull = 0.35;
    heading = Math.atan2(
      Math.sin(heading) * (1 - pull) + Math.sin(toCentre) * pull,
      Math.cos(heading) * (1 - pull) + Math.cos(toCentre) * pull,
    );

    const len = step * (0.7 + rand() * 0.6);
    x = Math.max(margin, Math.min(margin + usableW, x + Math.cos(heading) * len));
    y = Math.max(margin, Math.min(margin + usableH, y + Math.sin(heading) * len));
    points.push({ x, y });
  }

  return points;
}

/** Create a random path plus a few labelled stops along it. */
export function generateRandomPath(
  width: number,
  height: number,
  options?: { segments?: number; places?: number; rand?: () => number },
): MapPath {
  const rand = options?.rand ?? Math.random;
  const segments = options?.segments ?? 4 + Math.floor(rand() * 3);
  const path = createPath(randomPathPoints(width, height, segments, rand), {});

  const placeCount = options?.places ?? 2 + Math.floor(rand() * 2);
  for (let i = 0; i < placeCount; i++) {
    /* Spread stops evenly, then jitter so they don't look mechanical. */
    const base = (i + 1) / (placeCount + 1);
    const t = Math.max(0.04, Math.min(0.96, base + (rand() - 0.5) * 0.12));
    addPlace(path.id, t, {
      /* Unnamed by default — the user names the stops that matter. */
      icon: PLACE_ICONS[Math.floor(rand() * PLACE_ICONS.length)].id,
    });
  }
  return path;
}

/* ---------------- places ---------------- */

export function addPlace(pathId: string, t: number, options?: Partial<MapPlace>): MapPlace | null {
  const path = findPath(pathId);
  if (!path) return null;

  const place: MapPlace = {
    id: uid("place"),
    pathId,
    t: Math.max(0, Math.min(1, t)),
    /* Empty by default — no placeholder digits. The label plate only renders
       once the user actually names the place. */
    label: options?.label ?? "",
    icon: options?.icon ?? "pin",
    cardIds: options?.cardIds ? [...options.cardIds] : [],
    note: options?.note,
  };
  if (options?.anchorIndex !== undefined) place.anchorIndex = options.anchorIndex;
  mapStore.places.push(place);
  return place;
}

export function placesOfPath(pathId: string): MapPlace[] {
  return mapStore.places.filter((pl) => pl.pathId === pathId).sort((a, b) => a.t - b.t);
}

export function findPlace(placeId: string | null): MapPlace | undefined {
  if (!placeId) return undefined;
  return mapStore.places.find((pl) => pl.id === placeId);
}

export function deletePlace(placeId: string): boolean {
  const index = mapStore.places.findIndex((pl) => pl.id === placeId);
  if (index === -1) return false;
  mapStore.places.splice(index, 1);
  if (mapStore.selectedPlaceId === placeId) mapStore.selectedPlaceId = null;
  return true;
}

/**
 * Drag a place to an arbitrary point on its path, snapping onto a vertex when
 * the pointer comes within `VERTEX_SNAP_RADIUS`.
 *
 * Snapping sets `anchorIndex`, which is what keeps the marker glued to the node
 * even after the path is reshaped. Dragging away clears it.
 */
export function dragPlaceTo(
  placeId: string,
  target: MapPoint,
  snapRadius = VERTEX_SNAP_RADIUS,
): { snapped: boolean; index?: number } {
  const place = findPlace(placeId);
  if (!place) return { snapped: false };
  const path = findPath(place.pathId);
  if (!path || path.points.length === 0) return { snapped: false };

  const near = nearestVertex(path.points, target);
  if (near && near.dist <= snapRadius) {
    place.anchorIndex = near.index;
    place.t = tOfVertex(path.points, near.index);
    return { snapped: true, index: near.index };
  }

  delete place.anchorIndex;
  place.t = closestT(path.points, target);
  return { snapped: false };
}

/** Bind a place to a specific vertex (used by the "吸附到最近节点" action). */
export function anchorPlaceToVertex(placeId: string, index: number): boolean {
  const place = findPlace(placeId);
  if (!place) return false;
  const path = findPath(place.pathId);
  if (!path || index < 0 || index >= path.points.length) return false;
  place.anchorIndex = index;
  place.t = tOfVertex(path.points, index);
  return true;
}

export function releasePlaceAnchor(placeId: string): void {
  const place = findPlace(placeId);
  if (place) delete place.anchorIndex;
}

/**
 * Resolve a place's on-screen position.
 *
 * Anchored places read straight from the vertex, so reshaping the path carries
 * them along; free places are interpolated by arc length.
 */
export function placePoint(place: MapPlace): MapPoint {
  const path = findPath(place.pathId);
  if (!path || path.points.length === 0) return { x: 0, y: 0 };
  if (place.anchorIndex !== undefined) {
    const pt = path.points[place.anchorIndex];
    if (pt) return pt;
  }
  return pointAtT(path.points, place.t);
}

/** Re-sync the cached `t` of every anchored place on a path after a reshape. */
export function syncAnchoredPlaces(pathId: string): void {
  const path = findPath(pathId);
  if (!path) return;
  for (const place of mapStore.places) {
    if (place.pathId !== pathId || place.anchorIndex === undefined) continue;
    if (place.anchorIndex >= path.points.length) {
      /* The vertex is gone — fall back to a free position. */
      delete place.anchorIndex;
      continue;
    }
    place.t = tOfVertex(path.points, place.anchorIndex);
  }
}

export function updatePlace(placeId: string, patch: Partial<Pick<MapPlace, "label" | "icon" | "note">>): void {
  const place = findPlace(placeId);
  if (!place) return;
  if (patch.label !== undefined) place.label = patch.label;
  if (patch.icon !== undefined) place.icon = patch.icon;
  if (patch.note !== undefined) place.note = patch.note;
}

/* ---------------- card attachment ---------------- */

/** Pin a writing card to a place. A card can only live at one place at a time. */
export function attachCard(placeId: string, cardId: number): boolean {
  const place = findPlace(placeId);
  if (!place) return false;

  /* Detach from wherever it was, so the map stays a clean 1:N mapping. */
  for (const other of mapStore.places) {
    if (other.id === placeId) continue;
    const i = other.cardIds.indexOf(cardId);
    if (i !== -1) other.cardIds.splice(i, 1);
  }

  if (!place.cardIds.includes(cardId)) place.cardIds.push(cardId);
  return true;
}

export function detachCard(placeId: string, cardId: number): boolean {
  const place = findPlace(placeId);
  if (!place) return false;
  const i = place.cardIds.indexOf(cardId);
  if (i === -1) return false;
  place.cardIds.splice(i, 1);
  return true;
}

export function placeOfCard(cardId: number): MapPlace | undefined {
  return mapStore.places.find((pl) => pl.cardIds.includes(cardId));
}

/** Drop references to cards that no longer exist. */
export function pruneMissingCards(existingIds: Set<number>): number {
  let removed = 0;
  for (const place of mapStore.places) {
    for (let i = place.cardIds.length - 1; i >= 0; i--) {
      if (!existingIds.has(place.cardIds[i])) {
        place.cardIds.splice(i, 1);
        removed++;
      }
    }
  }
  return removed;
}

/* ---------------- groups ---------------- */

export function createGroup(title?: string): MapGroup {
  const group: MapGroup = {
    id: uid("mgroup"),
    title: title?.trim() || `路径组 ${mapStore.groups.length + 1}`,
    collapsed: false,
  };
  mapStore.groups.push(group);
  return group;
}

export function renameGroup(groupId: string, title: string): void {
  const group = mapStore.groups.find((g) => g.id === groupId);
  if (group && title.trim()) group.title = title.trim();
}

export function toggleGroupCollapsed(groupId: string): void {
  const group = mapStore.groups.find((g) => g.id === groupId);
  if (group) group.collapsed = !group.collapsed;
}

/** Dissolving a group releases its paths back to the ungrouped list. */
export function deleteGroup(groupId: string): void {
  mapStore.groups = mapStore.groups.filter((g) => g.id !== groupId);
  for (const path of mapStore.paths) {
    if (path.groupId === groupId) path.groupId = null;
  }
}

export function assignPathToGroup(pathId: string, groupId: string | null): void {
  const path = findPath(pathId);
  if (path) path.groupId = groupId;
}

/** Group the given paths together, creating the group if needed. */
export function groupPaths(pathIds: string[], title?: string): MapGroup | null {
  if (pathIds.length === 0) return null;
  const group = createGroup(title);
  for (const id of pathIds) assignPathToGroup(id, group.id);
  return group;
}

export function pathsOfGroup(groupId: string | null): MapPath[] {
  return mapStore.paths.filter((p) => p.groupId === groupId);
}

/* ---------------- multi-selection ---------------- */

export interface MapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Normalise a drag between two corners into a positive-size rect. */
export function rectFromPoints(a: MapPoint, b: MapPoint): MapRect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function pointInRect(p: MapPoint, r: MapRect): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/**
 * Paths whose geometry intersects `rect`.
 *
 * A vertex inside the rect counts, and so does a segment crossing it — a long
 * path can span the box without any of its vertices falling inside.
 */
export function pathsInRect(rect: MapRect): MapPath[] {
  return mapStore.paths.filter((path) => {
    if (isPathHidden(path)) return false;
    if (path.points.some((p) => pointInRect(p, rect))) return true;

    /* Sample each segment; cheap and accurate enough for hit-testing. */
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1];
      const b = path.points[i];
      const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
      for (let s = 1; s < steps; s++) {
        const u = s / steps;
        if (pointInRect({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }, rect)) return true;
      }
    }
    return false;
  });
}

export function setSelectedPaths(ids: string[]): void {
  const known = new Set(mapStore.paths.map((p) => p.id));
  mapStore.selectedPathIds = [...new Set(ids.filter((id) => known.has(id)))];
  if (mapStore.selectedPathIds.length > 0) {
    mapStore.activePathId = mapStore.selectedPathIds[0];
  }
}

export function togglePathSelected(pathId: string): void {
  const next = new Set(mapStore.selectedPathIds);
  if (next.has(pathId)) next.delete(pathId);
  else next.add(pathId);
  setSelectedPaths([...next]);
}

export function clearPathSelection(): void {
  mapStore.selectedPathIds = [];
}

export function isPathSelected(pathId: string): boolean {
  return mapStore.selectedPathIds.includes(pathId);
}

/** Group everything currently box-selected. */
export function groupSelectedPaths(title?: string): MapGroup | null {
  if (mapStore.selectedPathIds.length < 1) return null;
  const group = groupPaths([...mapStore.selectedPathIds], title);
  clearPathSelection();
  return group;
}

export function deleteSelectedPaths(): number {
  const ids = [...mapStore.selectedPathIds];
  let removed = 0;
  for (const id of ids) {
    if (deletePath(id)) removed++;
  }
  clearPathSelection();
  return removed;
}

export function setSelectedPathsWidth(width: number): void {
  for (const id of mapStore.selectedPathIds) setPathWidth(id, width);
}

export function setSelectedPathsColor(color: string): void {
  for (const id of mapStore.selectedPathIds) setPathColor(id, color);
}

export function isPathHidden(path: MapPath): boolean {
  if (!path.visible) return true;
  if (!path.groupId) return false;
  const group = mapStore.groups.find((g) => g.id === path.groupId);
  return !!group?.collapsed;
}

/* ---------------- serialisation ---------------- */

export interface MapSnapshot {
  paths: MapPath[];
  places: MapPlace[];
  groups: MapGroup[];
  showGrid: boolean;
}

export function exportMap(): MapSnapshot {
  return {
    paths: mapStore.paths.map((p) => ({ ...p, points: p.points.map((pt) => ({ ...pt })) })),
    places: mapStore.places.map((pl) => ({ ...pl, cardIds: [...pl.cardIds] })),
    groups: mapStore.groups.map((g) => ({ ...g })),
    showGrid: mapStore.showGrid,
  };
}

/** Load a snapshot, tolerating partial / legacy payloads. */
export function importMap(snapshot: unknown): boolean {
  if (!snapshot || typeof snapshot !== "object") return false;
  const s = snapshot as Partial<MapSnapshot>;

  if (Array.isArray(s.paths)) {
    mapStore.paths = s.paths
      .filter((p) => p && Array.isArray(p.points) && p.points.length >= 2)
      .map((p) => ({
        id: p.id ?? uid("path"),
        name: p.name ?? "路径",
        color: p.color ?? PATH_COLORS[0],
        width: clampPathWidth(typeof p.width === "number" ? p.width : PATH_WIDTH_DEFAULT),
        points: p.points.map((pt) => ({ x: Number(pt.x) || 0, y: Number(pt.y) || 0 })),
        groupId: p.groupId ?? null,
        visible: p.visible !== false,
      }));
  }
  if (Array.isArray(s.groups)) {
    mapStore.groups = s.groups
      .filter((g) => g && typeof g.id === "string")
      .map((g) => ({ id: g.id, title: g.title ?? "路径组", collapsed: !!g.collapsed }));
  }
  if (Array.isArray(s.places)) {
    const pathIds = new Set(mapStore.paths.map((p) => p.id));
    mapStore.places = s.places
      .filter((pl) => pl && typeof pl.pathId === "string" && pathIds.has(pl.pathId))
      .map((pl) => ({
        id: pl.id ?? uid("place"),
        pathId: pl.pathId,
        t: Math.max(0, Math.min(1, Number(pl.t) || 0)),
        label: pl.label ?? "地点",
        icon: (pl.icon ?? "pin") as PlaceIcon,
        cardIds: Array.isArray(pl.cardIds) ? pl.cardIds.filter((n) => typeof n === "number") : [],
        note: pl.note,
        ...(typeof pl.anchorIndex === "number" ? { anchorIndex: pl.anchorIndex } : {}),
      }));
  }
  if (typeof s.showGrid === "boolean") mapStore.showGrid = s.showGrid;

  mapStore.activePathId = mapStore.paths[0]?.id ?? null;
  mapStore.selectedPathIds = [];
  mapStore.selectedPlaceId = null;
  mapStore.draft = [];
  /* Anchors may be stale relative to the restored geometry. */
  for (const path of mapStore.paths) syncAnchoredPlaces(path.id);
  return true;
}

export function clearMap(): void {
  mapStore.paths = [];
  mapStore.places = [];
  mapStore.groups = [];
  mapStore.activePathId = null;
  mapStore.selectedPathIds = [];
  mapStore.selectedPlaceId = null;
  mapStore.draft = [];
}
