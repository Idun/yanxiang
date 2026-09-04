import { reactive, watch } from "vue";
import { documentFilesStore } from "./documentFilesStore";
import { loadSettings, saveSettings } from "./persistence";

/**
 * 「修订与批注」图层。
 *
 * 借绘画软件的图层叠加做文稿修订：正文（file.content）永远是原文，修订内容
 * 单独存成一条条图层，挂在左侧文档面板对应文档条目的下方作为二级目录。
 *
 *   · 小眼睛开 → 预览正文里这一段按修订内容合成显示（原文不动）
 *   · 小眼睛关 → 预览正文照原文显示
 *   · 「应用」 → 修订内容真正替换掉原文，并把该图层从文档条目中清除
 *
 * 本文件与配套组件（RevisionAnnotation.vue / RevisionLayerList.vue）自成一体：
 * 数据、合成、落库都在这里，宿主只需要挂载组件与在预览处改用 composeContent()。
 */

export interface RevisionItem {
  id: string;
  /** 所属文档条目。 */
  fileId: string;
  /** 选中的原文（应用 / 合成时按它定位）。 */
  original: string;
  /** 修订内容。留空表示这是一条纯批注，不改动正文。 */
  revised: string;
  /** 批注文字，可与修订内容并存。 */
  comment: string;
  /** 小眼睛：true 时预览正文合成修订内容。 */
  visible: boolean;
  /** 创建时原文在正文中的起点，作为定位的首选锚点。 */
  anchor: number;
  createdAt: number;
}

export const revisionStore = reactive({
  items: [] as RevisionItem[],
  /** 二级目录的折叠状态，按 fileId 记。 */
  collapsed: {} as Record<string, boolean>,
  /**
   * 待重新编辑的图层 id（双击图层条目时写入）。
   *
   * 表单组件挂在 DocumentViewer 里、图层列表挂在 DocumentSidebar 里，两者没有
   * 父子关系；用这个「一次性信号」把双击意图递过去，表单接手时立刻清空，
   * 分栏时两个 pane 也就不会各弹一个表单。
   */
  editingId: null as string | null,
  /**
   * 请求序号。watch 盯的是它而不是 editingId：连续双击同一条图层时 id 不变，
   * 只盯 id 的话第二次就不会触发（Vue 的 watch 按批次比较前后值）。
   */
  editSeq: 0,
  /** 待定位的图层 id（点「定位」时写入），与 editingId 同一套递送机制。 */
  locateId: null as string | null,
  locateSeq: 0,
});

/** 请求重新编辑某条图层。 */
export function requestEditRevision(id: string): void {
  revisionStore.editingId = id;
  revisionStore.editSeq++;
}

/** 表单接手 / 放弃后清掉信号。 */
export function clearRevisionEdit(): void {
  revisionStore.editingId = null;
}

/** 请求把正文（编辑区 + 预览区）滚到这条图层的原文处。 */
export function requestLocateRevision(id: string): void {
  revisionStore.locateId = id;
  revisionStore.locateSeq++;
}

export function clearRevisionLocate(): void {
  revisionStore.locateId = null;
}

/* ---------------- 查询 ---------------- */

/** 某个文档条目下的全部修订与批注，按创建时间正序（先提的排在上面）。 */
export function revisionsForFile(fileId: string | null | undefined): RevisionItem[] {
  if (!fileId) return [];
  return revisionStore.items
    .filter((r) => r.fileId === fileId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

export function revisionCount(fileId: string | null | undefined): number {
  if (!fileId) return 0;
  return revisionStore.items.reduce((n, r) => (r.fileId === fileId ? n + 1 : n), 0);
}

export function isRevisionListCollapsed(fileId: string): boolean {
  return revisionStore.collapsed[fileId] === true;
}

export function toggleRevisionList(fileId: string): void {
  revisionStore.collapsed[fileId] = !revisionStore.collapsed[fileId];
}

/* ---------------- 增删改 ---------------- */

export function createRevision(input: {
  fileId: string;
  original: string;
  revised: string;
  comment: string;
  anchor: number;
}): RevisionItem | undefined {
  const original = input.original;
  if (!original.trim()) return undefined;
  const revised = input.revised.trim();
  const comment = input.comment.trim();
  /* 既没修订也没批注 → 不产生空图层。 */
  if (!revised && !comment) return undefined;

  const item: RevisionItem = {
    id: `rev_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    fileId: input.fileId,
    original,
    revised,
    comment,
    visible: true,
    anchor: Math.max(0, input.anchor),
    createdAt: Date.now(),
  };
  revisionStore.items.push(item);
  /* 新建即展开，免得图层刚建好就藏在折叠里。 */
  revisionStore.collapsed[input.fileId] = false;
  return item;
}

export function updateRevision(
  id: string,
  patch: Partial<Pick<RevisionItem, "revised" | "comment">>,
): void {
  const item = revisionStore.items.find((r) => r.id === id);
  if (!item) return;
  if (patch.revised !== undefined) item.revised = patch.revised.trim();
  if (patch.comment !== undefined) item.comment = patch.comment.trim();
}

export function toggleRevisionVisible(id: string): void {
  const item = revisionStore.items.find((r) => r.id === id);
  if (item) item.visible = !item.visible;
}

export function deleteRevision(id: string): void {
  revisionStore.items = revisionStore.items.filter((r) => r.id !== id);
}

/* ---------------- 定位与合成 ---------------- */

/**
 * 在正文中定位这条修订的原文。
 *
 * 先按创建时记下的 anchor 校验（正文没动过就一定命中），不命中再退回全文查找
 * ——用户在别处编辑导致偏移时仍能对上。都找不到返回 -1。
 */
function locate(content: string, item: RevisionItem): number {
  const { anchor, original } = item;
  if (content.slice(anchor, anchor + original.length) === original) return anchor;
  const found = content.indexOf(original);
  return found;
}

/**
 * 把「小眼睛开着」的修订内容合成进正文，用于预览渲染。原文本身不受影响。
 *
 * 按定位结果从后往前替换，前面的偏移就不会被前一次替换推移。
 */
export function composeContent(fileId: string | null | undefined, content: string): string {
  if (!fileId) return content;
  const active = revisionStore.items.filter(
    (r) => r.fileId === fileId && r.visible && r.revised.trim(),
  );
  if (active.length === 0) return content;

  const hits: { at: number; item: RevisionItem }[] = [];
  for (const item of active) {
    const at = locate(content, item);
    if (at >= 0) hits.push({ at, item });
  }
  if (hits.length === 0) return content;

  hits.sort((a, b) => b.at - a.at);
  let out = content;
  let lastStart = Infinity;
  for (const hit of hits) {
    const end = hit.at + hit.item.original.length;
    /* 两条修订指向重叠区间时只认靠后的那条，避免拼出错乱的文本。 */
    if (end > lastStart) continue;
    out = out.slice(0, hit.at) + hit.item.revised + out.slice(end);
    lastStart = hit.at;
  }
  return out;
}

/** 图层里是否有正在生效（会改变预览正文）的修订。 */
export function hasVisibleRevision(fileId: string | null | undefined): boolean {
  if (!fileId) return false;
  return revisionStore.items.some((r) => r.fileId === fileId && r.visible && r.revised.trim());
}

/** 一条图层在正文中占据的区间，供编辑区高亮覆盖层使用。 */
export interface RevisionRange {
  start: number;
  end: number;
  item: RevisionItem;
}

/**
 * 定位某个文档下全部图层的原文区间，按起点正序返回，并剔除相互重叠的部分
 * （只保留先出现的那条）——覆盖层需要一组互不相交的区间才能逐字对齐。
 */
export function revisionRangesIn(
  fileId: string | null | undefined,
  content: string,
): RevisionRange[] {
  if (!fileId) return [];
  const hits: RevisionRange[] = [];
  for (const item of revisionStore.items) {
    if (item.fileId !== fileId) continue;
    const at = locate(content, item);
    if (at < 0) continue;
    hits.push({ start: at, end: at + item.original.length, item });
  }
  hits.sort((a, b) => a.start - b.start || b.end - a.end);

  const out: RevisionRange[] = [];
  let lastEnd = -1;
  for (const hit of hits) {
    if (hit.start < lastEnd) continue;
    out.push(hit);
    lastEnd = hit.end;
  }
  return out;
}

/**
 * 单条图层在正文中的区间，供「定位」使用。
 *
 * 与 revisionRangesIn 不同：这里不剔除重叠，用户点哪条就定位哪条。
 * 找不到（正文已被改到认不出原文）返回 null。
 */
export function revisionRangeOf(
  id: string,
): { fileId: string; start: number; end: number; item: RevisionItem } | null {
  const item = revisionStore.items.find((r) => r.id === id);
  if (!item) return null;
  const file = documentFilesStore.files.find((f) => f.id === item.fileId);
  if (!file) return null;
  const at = locate(file.content, item);
  if (at < 0) return null;
  return { fileId: item.fileId, start: at, end: at + item.original.length, item };
}

export type ApplyResult = "applied" | "comment-only" | "not-found" | "missing";

/**
 * 应用一条修订：修订内容直接替换掉原文写回文档条目，随后清除该图层。
 * 纯批注没有正文可改，直接销账。
 */
export function applyRevision(id: string): ApplyResult {
  const item = revisionStore.items.find((r) => r.id === id);
  if (!item) return "missing";

  const file = documentFilesStore.files.find((f) => f.id === item.fileId);
  if (!file) return "missing";

  const revised = item.revised.trim();
  if (!revised) {
    deleteRevision(id);
    return "comment-only";
  }

  const at = locate(file.content, item);
  if (at < 0) return "not-found";

  file.content =
    file.content.slice(0, at) + item.revised + file.content.slice(at + item.original.length);

  /* 同一文档里排在后面的图层锚点整体平移，后续定位不至于全部退化成全文查找。 */
  const delta = item.revised.length - item.original.length;
  if (delta !== 0) {
    for (const other of revisionStore.items) {
      if (other.fileId === item.fileId && other.id !== id && other.anchor > at) {
        other.anchor += delta;
      }
    }
  }

  deleteRevision(id);
  return "applied";
}

export interface BatchResult {
  /** 成功落笔（含纯批注归档）的条数。 */
  done: number;
  /** 因正文里找不到原文而保留下来的条数。 */
  failed: number;
}

/**
 * 全部应用：逐条落笔。
 *
 * 从正文里靠后的图层开始处理，前面图层的定位就不会被前一次替换推移；
 * 定位失败的那条原样留在图层里，不静默丢弃。
 */
export function applyAllRevisions(fileId: string): BatchResult {
  const file = documentFilesStore.files.find((f) => f.id === fileId);
  if (!file) return { done: 0, failed: 0 };

  const ordered = revisionRangesIn(fileId, file.content)
    .slice()
    .sort((a, b) => b.start - a.start)
    .map((r) => r.item.id);

  /* revisionRangesIn 已剔除重叠区间，落在其外的（纯批注、定位不到的）单独收尾。 */
  const rest = revisionStore.items
    .filter((r) => r.fileId === fileId && !ordered.includes(r.id))
    .map((r) => r.id);

  let done = 0;
  let failed = 0;
  for (const id of [...ordered, ...rest]) {
    const result = applyRevision(id);
    if (result === "applied" || result === "comment-only") done++;
    else failed++;
  }
  return { done, failed };
}

/** 全部拒绝：清掉该文档的所有图层，正文分毫不动。 */
export function rejectAllRevisions(fileId: string): number {
  const before = revisionStore.items.length;
  revisionStore.items = revisionStore.items.filter((r) => r.fileId !== fileId);
  return before - revisionStore.items.length;
}

/* ---------------- 落库 ---------------- */

const STORE_KEY = "docRevisionLayers";

interface RevisionPayload {
  items: RevisionItem[];
  collapsed: Record<string, boolean>;
}

function sanitize(raw: unknown): RevisionItem[] {
  if (!Array.isArray(raw)) return [];
  const out: RevisionItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Partial<RevisionItem>;
    if (typeof r.id !== "string" || typeof r.fileId !== "string") continue;
    if (typeof r.original !== "string" || !r.original) continue;
    out.push({
      id: r.id,
      fileId: r.fileId,
      original: r.original,
      revised: typeof r.revised === "string" ? r.revised : "",
      comment: typeof r.comment === "string" ? r.comment : "",
      visible: r.visible !== false,
      anchor: typeof r.anchor === "number" && r.anchor >= 0 ? r.anchor : 0,
      createdAt: typeof r.createdAt === "number" ? r.createdAt : Date.now(),
    });
  }
  return out;
}

let booted = false;

/**
 * 首次使用时恢复图层，并在恢复完成后才挂上自动落库的监听——否则空数组会在
 * 读取回来之前把已存的数据覆盖掉。
 */
export async function bootRevisionStore(): Promise<void> {
  if (booted) return;
  booted = true;

  try {
    const settings = await loadSettings();
    const raw = settings[STORE_KEY];
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RevisionPayload>;
      revisionStore.items = sanitize(parsed.items);
      if (parsed.collapsed && typeof parsed.collapsed === "object") {
        revisionStore.collapsed = { ...parsed.collapsed };
      }
    }
  } catch {
    /* 读不出来就从空图层开始，不影响正文。 */
  }

  watch(
    () => [revisionStore.items, revisionStore.collapsed],
    () => {
      try {
        const payload: RevisionPayload = {
          items: revisionStore.items,
          collapsed: revisionStore.collapsed,
        };
        void saveSettings([{ key: STORE_KEY, value: JSON.stringify(payload) }]);
      } catch {
        /* ignore */
      }
    },
    { deep: true },
  );

  /* 文档被删掉后清理孤立图层：文档树是 reactive 的，这里跟着它收尾。 */
  watch(
    () => documentFilesStore.files.map((f) => f.id).join(","),
    () => {
      const alive = new Set(documentFilesStore.files.map((f) => f.id));
      const next = revisionStore.items.filter((r) => alive.has(r.fileId));
      if (next.length !== revisionStore.items.length) revisionStore.items = next;
    },
  );
}
