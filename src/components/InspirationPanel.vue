<script setup lang="ts">
/**
 * 灵感速记面板（主页左侧栏）。
 *
 * 一个「发布框 + 时间流」的组合：上方是编辑器（支持 Markdown、贴图、#标签、
 * 列表与表格快捷插入），Enter 或点「发送」发布，下方按微博式卡片倒序罗列。
 * 每条速记逐条写入 `inspiration_notes` 表，关掉应用也不会丢。
 *
 * 卡片高度统一封顶为五行正文，超出部分折叠，避免长文把整条流撑散。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileText,
  Hash,
  ImagePlus,
  Import,
  Layers,
  List,
  ListOrdered,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Search,
  Table,
  Trash2,
  X,
} from "lucide-vue-next";
import { renderMarkdown } from "../markdown";
import { relativeTime, showToast } from "../insightStore";
import { homeStore, setInspirationWidth } from "../homeStore";
import { createDocFile } from "../documentFilesStore";
import { libraryStore } from "../libraryStore";
import {
  MAX_IMAGE_BYTES,
  addInspiration,
  inspirationStore,
  loadInspiration,
  parseTags,
  readImageAsDataUrl,
  removeInspiration,
  setActiveTag,
  tagCounts,
  toggleInspirationPinned,
  updateInspiration,
  visibleInspirations,
  type InspirationNote,
} from "../inspirationStore";

const emit = defineEmits<{
  /** 应用到「文档」界面后请求父级切过去并选中该文档。 */
  (e: "openDoc", fileId: string): void;
  /** 应用到「写作」画布后请求父级切过去。 */
  (e: "navigate", tab: "docs" | "library" | "refine" | "insight"): void;
}>();

/* ---------------- 编辑器状态 ---------------- */

/** Windows/Linux 显示 "Ctrl"，macOS 显示 command 符号。 */
const modKey =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
    ? "\u2318"
    : "Ctrl";

const draft = ref("");
const draftImages = ref<string[]>([]);
const composerEl = ref<HTMLTextAreaElement | null>(null);
const fileInputEl = ref<HTMLInputElement | null>(null);
const dropActive = ref(false);

/** 草稿里已经打好的标签，实时回显。 */
const draftTags = computed(() => parseTags(draft.value));

const canPublish = computed(() => draft.value.trim().length > 0 || draftImages.value.length > 0);

function publish() {
  if (!canPublish.value) return;
  const note = addInspiration(draft.value, draftImages.value);
  if (!note) return;
  draft.value = "";
  draftImages.value = [];
  tagPickerOpen.value = false;
  showToast("已记下灵感", note.tags.length ? `标签：${note.tags.join("、")}` : "已保存到本地", "habit");
  nextTick(() => composerEl.value?.focus());
}

/** Ctrl/Cmd+Enter 发送，Enter 换行 —— 速记里也常写多行 Markdown。 */
function onComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.isComposing) return;
  if (!(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  publish();
}

/* ---------------- 编辑框写入工具 ---------------- */

/** 在光标处插入文本，并把光标移到插入内容之后。 */
function insertAtCursor(text: string, selectOffset?: { start: number; end: number }) {
  const el = composerEl.value;
  if (!el) {
    draft.value += text;
    return;
  }
  const start = el.selectionStart ?? draft.value.length;
  const end = el.selectionEnd ?? start;
  draft.value = draft.value.slice(0, start) + text + draft.value.slice(end);

  nextTick(() => {
    el.focus();
    const base = start + text.length;
    if (selectOffset) {
      el.setSelectionRange(start + selectOffset.start, start + selectOffset.end);
    } else {
      el.setSelectionRange(base, base);
    }
  });
}

/** 光标是否已经位于行首；否则先补一个换行，保证列表/表格语法生效。 */
function lineLead(): string {
  const el = composerEl.value;
  const pos = el?.selectionStart ?? draft.value.length;
  if (pos === 0) return "";
  return draft.value[pos - 1] === "\n" ? "" : "\n";
}

function insertList(kind: "bullet" | "ordered") {
  const lead = lineLead();
  const body =
    kind === "bullet" ? "- 第一项\n- 第二项\n- 第三项\n" : "1. 第一项\n2. 第二项\n3. 第三项\n";
  /* 选中第一项的占位文字，方便直接改写 */
  const markerLen = kind === "bullet" ? 2 : 3;
  insertAtCursor(lead + body, {
    start: lead.length + markerLen,
    end: lead.length + markerLen + 3,
  });
  listMenuOpen.value = false;
}

function insertTable() {
  const lead = lineLead();
  const body = "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n";
  insertAtCursor(lead + body, { start: lead.length + 2, end: lead.length + 5 });
}

function insertTag(tag: string) {
  const el = composerEl.value;
  const pos = el?.selectionStart ?? draft.value.length;
  /* `#标签` 需要前置空白才会被解析，光标紧贴文字时自动补一个空格 */
  const prev = pos > 0 ? draft.value[pos - 1] : "";
  const lead = prev && !/\s/.test(prev) ? " " : "";
  insertAtCursor(`${lead}#${tag} `);
  tagPickerOpen.value = false;
}

/* ---------------- 工具条弹层 ---------------- */

const tagPickerOpen = ref(false);
const listMenuOpen = ref(false);
const composerRootEl = ref<HTMLDivElement | null>(null);

/** 标签面板里展示全部已有标签（不像标签云那样截断）。 */
const allTags = computed(() => {
  void inspirationStore.notes.length;
  return tagCounts();
});

function toggleTagPicker() {
  tagPickerOpen.value = !tagPickerOpen.value;
  listMenuOpen.value = false;
}

function toggleListMenu() {
  listMenuOpen.value = !listMenuOpen.value;
  tagPickerOpen.value = false;
}

function onDocumentPointerDown(event: MouseEvent) {
  const target = event.target as Node;

  /* 卡片上的「应用」下拉：点到别处就收起 */
  if (applyMenuId.value !== null) {
    const inMenu = (target as HTMLElement | null)?.closest?.(".apply-wrap");
    if (!inMenu) applyMenuId.value = null;
  }

  if (!tagPickerOpen.value && !listMenuOpen.value) return;
  const root = composerRootEl.value;
  if (root && !root.contains(target)) {
    tagPickerOpen.value = false;
    listMenuOpen.value = false;
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  tagPickerOpen.value = false;
  listMenuOpen.value = false;
  applyMenuId.value = null;
  lightbox.value = null;
}

/* ---------------- 图片 ---------------- */

async function ingestFiles(files: FileList | File[]) {
  const list = Array.from(files).filter((f) => f.type.startsWith("image/"));
  if (list.length === 0) return;

  let rejected = 0;
  for (const file of list) {
    const url = await readImageAsDataUrl(file);
    if (url) draftImages.value.push(url);
    else rejected++;
  }
  if (rejected > 0) {
    showToast(
      "部分图片未添加",
      `单张图片需小于 ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)}MB`,
      "edit",
    );
  }
}

function pickImages() {
  fileInputEl.value?.click();
}

function onFilePicked(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files) void ingestFiles(input.files);
  input.value = "";
}

/** 直接把截图粘进编辑框。 */
function onComposerPaste(event: ClipboardEvent) {
  const files = event.clipboardData?.files;
  if (files && files.length > 0 && Array.from(files).some((f) => f.type.startsWith("image/"))) {
    event.preventDefault();
    void ingestFiles(files);
  }
}

function onDrop(event: DragEvent) {
  dropActive.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    event.preventDefault();
    void ingestFiles(files);
  }
}

function removeDraftImage(index: number) {
  draftImages.value.splice(index, 1);
}

/* ---------------- 列表 ---------------- */

const notes = computed(() => {
  void inspirationStore.notes.length;
  void inspirationStore.activeTag;
  void inspirationStore.query;
  return visibleInspirations();
});

const pageSize = 15;
const currentPage = ref(1);

const totalPages = computed(() => Math.max(1, Math.ceil(notes.value.length / pageSize)));

const pagedNotes = computed(() => {
  const page = Math.min(Math.max(1, currentPage.value), totalPages.value);
  const start = (page - 1) * pageSize;
  return notes.value.slice(start, start + pageSize);
});

watch([() => notes.value.length, () => inspirationStore.activeTag, () => inspirationStore.query], () => {
  currentPage.value = 1;
});

const tags = computed(() => {
  void inspirationStore.notes.length;
  return tagCounts().slice(0, 12);
});

/**
 * 渲染正文：先把 `#标签` 包成高亮 span，再交给 Markdown 渲染。
 * 代码围栏内的内容原样保留，避免把示例代码里的 `#` 当成标签。
 */
function renderNote(content: string): string {
  const segments = content.split(/(```[\s\S]*?```)/g);
  const decorated = segments
    .map((seg) =>
      seg.startsWith("```")
        ? seg
        : seg.replace(
            /(^|\s)#([\p{L}\p{N}_-]+)/gu,
            (_m, lead: string, tag: string) => `${lead}<span class="insp-tag">#${tag}</span>`,
          ),
    )
    .join("");
  return renderMarkdown(decorated);
}

/** 绝对时间：当天只显示时刻，跨天补日期，跨年补年份。 */
function absoluteTime(at: number): string {
  const d = new Date(at);
  const now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const md = `${d.getMonth() + 1}/${d.getDate()}`;
  if (d.getFullYear() === now.getFullYear()) return `${md} ${hm}`;
  return `${d.getFullYear()}/${md} ${hm}`;
}

/* ---- 卡片高度封顶：超过五行正文的卡片可展开 / 收起 ---- */

const expandedIds = ref<Set<string>>(new Set());
/** 记录哪些卡片确实溢出了，只有溢出的才显示「展开」。 */
const overflowIds = ref<Set<string>>(new Set());
const clampRefs = ref<Record<string, HTMLElement | null>>({});

function isExpanded(id: string): boolean {
  return expandedIds.value.has(id);
}

function toggleExpanded(id: string) {
  const next = new Set(expandedIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedIds.value = next;
}

function setClampRef(id: string, el: unknown) {
  clampRefs.value[id] = (el as HTMLElement | null) ?? null;
}

/** 逐个量一下内容高度，判断是否超出五行封顶。 */
function measureOverflow() {
  const next = new Set<string>();
  for (const [id, el] of Object.entries(clampRefs.value)) {
    if (!el) continue;
    if (el.scrollHeight - el.clientHeight > 2) next.add(id);
  }
  overflowIds.value = next;
}

function scheduleMeasure() {
  nextTick(() => {
    measureOverflow();
    /* 图片解码完成后高度会变，再补一次 */
    window.setTimeout(measureOverflow, 220);
  });
}

/* ---- 行内编辑 ---- */

const editingId = ref<string | null>(null);
const editDraft = ref("");

function startEdit(id: string, content: string) {
  editingId.value = id;
  editDraft.value = content;
}

function commitEdit() {
  if (!editingId.value) return;
  updateInspiration(editingId.value, editDraft.value);
  editingId.value = null;
  editDraft.value = "";
  scheduleMeasure();
}

function cancelEdit() {
  editingId.value = null;
  editDraft.value = "";
}

/* ---- 复制正文 ---- */

async function copyNote(content: string) {
  const text = content.trim();
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 剪贴板不可用时退回 execCommand */
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
  showToast("已复制正文", `${text.length} 字`, "habit");
}

/* ---- 应用：转成文档条目 / 画布文本卡片 ---- */

const applyMenuId = ref<string | null>(null);

function toggleApplyMenu(id: string) {
  applyMenuId.value = applyMenuId.value === id ? null : id;
  pendingDeleteId.value = null;
}

/** 用正文首行做标题，过长则截断。 */
function titleFromContent(content: string): string {
  const firstLine = content
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .find((l) => l.length > 0);
  return (firstLine ?? "灵感速记").slice(0, 40);
}

/** 应用到「文档」：新建一个文档条目并跳过去。 */
function applyToDoc(note: InspirationNote) {
  const title = titleFromContent(note.content);
  const file = createDocFile(null, title);
  file.content = note.content;
  applyMenuId.value = null;
  showToast("已应用到文档", `新建文档「${title}」`, "habit");
  emit("openDoc", file.id);
}

/** 应用到「写作」画布：新建一张文本卡片并跳过去。 */
function applyToCanvas(note: InspirationNote) {
  const title = titleFromContent(note.content);
  /* 画布位置留空，由 LibraryView 的 getCardPos 按索引自动排布。 */
  libraryStore.cards.push({
    id: Date.now(),
    title,
    content: note.content,
  });
  applyMenuId.value = null;
  showToast("已应用到画布", `新建文本卡片「${title}」`, "habit");
  emit("navigate", "library");
}

/* ---- 删除（二次确认，避免误删攒下的灵感） ---- */

const pendingDeleteId = ref<string | null>(null);

function requestDelete(id: string) {
  pendingDeleteId.value = pendingDeleteId.value === id ? null : id;
  applyMenuId.value = null;
}

function confirmDelete(id: string) {
  removeInspiration(id);
  pendingDeleteId.value = null;
}

/* ---------------- 宽度拖拽 ---------------- */

const resizing = ref(false);

/**
 * 拖拽右边缘调整面板宽度。面板贴在窗口左侧，所以宽度 = 光标 X - 窗口左边界。
 * 右侧主体是 `flex: 1`，会自动吃掉剩余空间，无需另行计算。
 */
function startResize(event: MouseEvent) {
  event.preventDefault();
  resizing.value = true;
  /* 拖拽期间禁用选中和光标闪烁，避免误选正文 */
  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";

  const move = (e: MouseEvent) => {
    setInspirationWidth(e.clientX);
  };
  const up = () => {
    resizing.value = false;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    /* 宽度变化会改变换行，重新判断哪些卡片溢出 */
    scheduleMeasure();
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

/** 双击分隔线恢复默认宽度。 */
function resetWidth() {
  setInspirationWidth(340);
  scheduleMeasure();
}

/** 窗口变窄时把面板宽度收回合法区间，避免左侧主体被挤没。 */
function clampWidthToViewport() {
  setInspirationWidth(homeStore.inspirationWidth);
}

/* ---------------- 预览大图 ---------------- */

const lightbox = ref<string | null>(null);

onMounted(() => {
  void loadInspiration().then(scheduleMeasure);
  document.addEventListener("mousedown", onDocumentPointerDown);
  document.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("resize", measureOverflow);
  window.addEventListener("resize", clampWidthToViewport);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentPointerDown);
  document.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("resize", measureOverflow);
  window.removeEventListener("resize", clampWidthToViewport);
});
</script>

<template>
  <!-- 折叠态：只留一条竖向拉手 -->
  <button
    v-if="homeStore.inspirationCollapsed"
    class="insp-rail"
    title="展开灵感速记"
    @click="homeStore.inspirationCollapsed = false"
  >
    <Hash :size="15" :stroke-width="1.9" />
    <span class="insp-rail-label">灵感速记</span>
    <span v-if="inspirationStore.notes.length > 0" class="insp-rail-count num-tabular">
      {{ inspirationStore.notes.length }}
    </span>
  </button>

  <aside
    v-else
    class="insp-panel"
    :style="{ width: homeStore.inspirationWidth + 'px', minWidth: homeStore.inspirationWidth + 'px' }"
  >
    <!-- 右边缘拖拽把手：调整面板宽度，双击复位 -->
    <div
      class="insp-resizer"
      :class="{ dragging: resizing }"
      title="拖动调整宽度（双击复位）"
      @mousedown="startResize"
      @dblclick="resetWidth"
    ></div>

    <header class="insp-header">
      <button
        class="insp-collapse"
        title="折叠灵感速记面板"
        @click="homeStore.inspirationCollapsed = true"
      >
        <PanelLeftClose :size="15" :stroke-width="1.8" />
      </button>
      <h2 class="insp-title">灵感速记</h2>
      <span class="insp-count num-tabular">{{ inspirationStore.notes.length }}</span>
    </header>

    <!-- ============ 发布框 ============ -->
    <div
      ref="composerRootEl"
      class="composer"
      :class="{ 'drop-active': dropActive }"
      @dragover.prevent="dropActive = true"
      @dragleave="dropActive = false"
      @drop="onDrop"
    >
      <textarea
        ref="composerEl"
        v-model="draft"
        v-auto-pair
        class="composer-input"
        rows="3"
        placeholder="记下这一刻的灵感… 支持 Markdown、拖入/粘贴图片、用 #标签 归类"
        @keydown="onComposerKeydown"
        @paste="onComposerPaste"
      ></textarea>
      <span class="composer-outline" aria-hidden="true">
        <span class="composer-line top"></span>
        <span class="composer-line right"></span>
        <span class="composer-line bottom"></span>
        <span class="composer-line left"></span>
      </span>

      <!-- 待发布的图片 -->
      <div v-if="draftImages.length > 0" class="draft-images">
        <div v-for="(img, i) in draftImages" :key="i" class="draft-image">
          <img :src="img" alt="待发布图片" />
          <button class="draft-image-del" title="移除" @click="removeDraftImage(i)">
            <X :size="11" :stroke-width="2.2" />
          </button>
        </div>
      </div>

      <!-- 草稿标签回显 -->
      <div v-if="draftTags.length > 0" class="draft-tags">
        <span v-for="tag in draftTags" :key="tag" class="tag-chip">#{{ tag }}</span>
      </div>

      <div class="composer-foot">
        <!-- # 标签：打开已有标签列表 -->
        <button
          class="composer-tool"
          :class="{ active: tagPickerOpen }"
          title="插入已有标签"
          @click="toggleTagPicker"
        >
          <Hash :size="15" :stroke-width="1.9" />
        </button>

        <button class="composer-tool" title="添加图片（也可拖入或粘贴）" @click="pickImages">
          <ImagePlus :size="15" :stroke-width="1.8" />
        </button>

        <!-- 列表：有序 / 无序可选 -->
        <button
          class="composer-tool"
          :class="{ active: listMenuOpen }"
          title="插入列表"
          @click="toggleListMenu"
        >
          <List :size="15" :stroke-width="1.8" />
        </button>

        <button class="composer-tool" title="插入表格" @click="insertTable">
          <Table :size="15" :stroke-width="1.8" />
        </button>

        <span class="composer-hint">{{ modKey }}+Enter 发送 · Enter 换行</span>

        <button class="publish-btn" :disabled="!canPublish" @click="publish">发送</button>

        <!-- 标签列表面板 -->
        <div v-if="tagPickerOpen" class="composer-pop tag-pop" @click.stop>
          <div class="pop-title">已有标签</div>
          <div v-if="allTags.length === 0" class="pop-empty">
            还没有标签。在正文里写 #关键词 即可创建。
          </div>
          <div v-else class="pop-tags">
            <button
              v-for="item in allTags"
              :key="item.tag"
              class="tag-chip clickable"
              @click="insertTag(item.tag)"
            >
              #{{ item.tag }}
              <span class="tag-count num-tabular">{{ item.count }}</span>
            </button>
          </div>
        </div>

        <!-- 列表类型菜单 -->
        <div v-if="listMenuOpen" class="composer-pop list-pop" @click.stop>
          <button class="pop-item" @click="insertList('bullet')">
            <List :size="14" :stroke-width="1.8" />
            无序列表
          </button>
          <button class="pop-item" @click="insertList('ordered')">
            <ListOrdered :size="14" :stroke-width="1.8" />
            有序列表
          </button>
        </div>
      </div>

      <input
        ref="fileInputEl"
        type="file"
        accept="image/*"
        multiple
        class="file-input"
        @change="onFilePicked"
      />
    </div>

    <!-- ============ 筛选 ============ -->
    <div class="insp-filters">
      <div class="insp-search">
        <Search :size="13" :stroke-width="1.8" />
        <input v-model="inspirationStore.query" class="insp-search-input" placeholder="搜索速记…" />
      </div>
      <div v-if="tags.length > 0" class="tag-cloud">
        <button
          v-for="item in tags"
          :key="item.tag"
          class="tag-chip clickable"
          :class="{ active: inspirationStore.activeTag === item.tag }"
          :title="`筛选 #${item.tag}`"
          @click="setActiveTag(item.tag)"
        >
          #{{ item.tag }}
          <span class="tag-count num-tabular">{{ item.count }}</span>
        </button>
      </div>
    </div>

    <!-- ============ 速记流 ============ -->
    <div class="insp-stream">
      <div v-if="notes.length === 0" class="insp-empty">
        <template v-if="inspirationStore.notes.length === 0">
          还没有速记。想到什么就写在上面，回车即存。
        </template>
        <template v-else>没有符合筛选条件的速记。</template>
      </div>

      <article v-for="note in pagedNotes" :key="note.id" class="note-card" :class="{ pinned: note.pinned }">
        <div class="note-head">
          <!-- 置顶按钮左侧：发送 / 编辑时间 -->
          <span class="note-date" :title="`发送于 ${new Date(note.createdAt).toLocaleString('zh-CN')}`">
            {{ absoluteTime(note.updatedAt - note.createdAt > 1000 ? note.updatedAt : note.createdAt) }}
          </span>
          <span v-if="note.updatedAt - note.createdAt > 1000" class="note-edited">已编辑</span>
          <span class="note-relative">{{ relativeTime(note.createdAt) }}</span>

          <div class="note-actions">
            <button
              class="note-btn"
              :class="{ on: note.pinned }"
              :title="note.pinned ? '取消置顶' : '置顶'"
              @click="toggleInspirationPinned(note.id)"
            >
              <component :is="note.pinned ? PinOff : Pin" :size="12" :stroke-width="1.9" />
            </button>

            <button class="note-btn" title="复制正文" @click="copyNote(note.content)">
              <Copy :size="12" :stroke-width="1.9" />
            </button>

            <!-- 应用：转成文档条目 / 画布文本卡片 -->
            <div class="apply-wrap">
              <button
                class="note-btn"
                :class="{ on: applyMenuId === note.id }"
                title="应用到文档 / 画布"
                @click="toggleApplyMenu(note.id)"
              >
                <Import :size="12" :stroke-width="1.9" />
              </button>
              <div v-if="applyMenuId === note.id" class="apply-menu" @click.stop>
                <button class="apply-item" @click="applyToDoc(note)">
                  <FileText :size="13" :stroke-width="1.8" />
                  应用到文档
                </button>
                <button class="apply-item" @click="applyToCanvas(note)">
                  <Layers :size="13" :stroke-width="1.8" />
                  应用到画布
                </button>
              </div>
            </div>

            <button class="note-btn" title="编辑" @click="startEdit(note.id, note.content)">
              <Pencil :size="12" :stroke-width="1.9" />
            </button>
            <button
              class="note-btn danger"
              :class="{ on: pendingDeleteId === note.id }"
              :title="pendingDeleteId === note.id ? '再次点击确认删除' : '删除'"
              @click="requestDelete(note.id)"
            >
              <Trash2 :size="12" :stroke-width="1.9" />
            </button>
          </div>
        </div>

        <!-- 删除确认条 -->
        <div v-if="pendingDeleteId === note.id" class="note-confirm">
          <span>删除这条速记？</span>
          <button class="confirm-yes" @click="confirmDelete(note.id)">删除</button>
          <button class="confirm-no" @click="pendingDeleteId = null">取消</button>
        </div>

        <!-- 行内编辑 -->
        <template v-if="editingId === note.id">
          <textarea v-model="editDraft" v-auto-pair class="note-edit-input" rows="4"></textarea>
          <div class="note-edit-foot">
            <button class="edit-save" @click="commitEdit">
              <Check :size="12" :stroke-width="2.2" />
              保存
            </button>
            <button class="edit-cancel" @click="cancelEdit">取消</button>
          </div>
        </template>

        <template v-else>
          <!-- 内容区高度封顶为五行正文；溢出时给出展开入口 -->
          <div
            :ref="(el) => setClampRef(note.id, el)"
            class="note-clamp"
            :class="{ expanded: isExpanded(note.id) }"
          >
            <!-- eslint-disable-next-line vue/no-v-html -- 本地单机数据，与文档预览同一渲染路径 -->
            <div v-if="note.content" class="note-body markdown-body" v-html="renderNote(note.content)"></div>

            <div
              v-if="note.images.length > 0"
              class="note-images"
              :class="`count-${Math.min(note.images.length, 3)}`"
            >
              <img
                v-for="(img, i) in note.images"
                :key="i"
                :src="img"
                class="note-image"
                alt="灵感图片"
                @load="scheduleMeasure"
                @click="lightbox = img"
              />
            </div>

            <div v-if="note.tags.length > 0" class="note-tags">
              <button
                v-for="tag in note.tags"
                :key="tag"
                class="tag-chip clickable"
                :class="{ active: inspirationStore.activeTag === tag }"
                @click="setActiveTag(tag)"
              >
                #{{ tag }}
              </button>
            </div>

            <!-- 收起态底部渐隐，提示还有内容 -->
            <div v-if="overflowIds.has(note.id) && !isExpanded(note.id)" class="note-fade"></div>
          </div>

          <button
            v-if="overflowIds.has(note.id)"
            class="note-more"
            @click="toggleExpanded(note.id)"
          >
            <component :is="isExpanded(note.id) ? ChevronUp : ChevronDown" :size="12" :stroke-width="2" />
            {{ isExpanded(note.id) ? "收起" : "展开全部" }}
          </button>
        </template>
      </article>

      <!-- 自动分页整合机制（每页15张卡片） -->
      <div v-if="totalPages > 1" class="insp-pagination">
        <button class="page-btn" :disabled="currentPage <= 1" @click="currentPage--">上一页</button>
        <span class="page-info num-tabular">第 {{ currentPage }} / {{ totalPages }} 页</span>
        <button class="page-btn" :disabled="currentPage >= totalPages" @click="currentPage++">下一页</button>
      </div>
    </div>

    <!-- 图片大图预览 -->
    <Teleport to="body">
      <div v-if="lightbox" class="lightbox" @click="lightbox = null">
        <img :src="lightbox" alt="灵感图片预览" />
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
/* 宽度由内联 style 驱动（用户拖拽结果），这里只定基线值。面板贴窗口左侧。 */
.insp-panel {
  position: relative;
  width: 340px;
  min-width: 340px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border-right: 1px solid var(--outline-variant);
}

/* ---------------- 宽度拖拽把手 ---------------- */

.insp-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  right: -3px;
  width: 7px;
  z-index: 10;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
}

.insp-resizer::after {
  /* 可见的一条细线，仅在悬停 / 拖拽时显现 */
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  right: 3px;
  width: 1px;
  background: transparent;
  transition: background 0.15s ease;
}

.insp-resizer:hover::after,
.insp-resizer.dragging::after {
  background: var(--primary);
  box-shadow: 0 0 0 1px rgb(var(--primary-rgb) / 0.3);
}

/* ---------------- 折叠拉手 ---------------- */

.insp-rail {
  flex-shrink: 0;
  width: 34px;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 12px 0;
  background: var(--surface-bright);
  border-right: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
}

.insp-rail:hover {
  background: var(--surface-container);
  color: var(--primary);
}

.insp-rail-label {
  writing-mode: vertical-rl;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.insp-rail-count {
  font-size: 10px;
  font-weight: 600;
  padding: 2px 5px;
  border-radius: 999px;
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.12);
}

/* ---------------- 头部 ---------------- */

.insp-header {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px 10px;
  border-bottom: 1px solid var(--outline-variant);
}

.insp-collapse {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 7px;
  color: var(--on-surface-variant);
}

.insp-collapse:hover {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.insp-title {
  flex: 1;
  min-width: 0;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.insp-count {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.12);
}

/* ---------------- 发布框 ---------------- */

.composer {
  position: relative;
  flex-shrink: 0;
  margin: 12px;
  padding: 10px;
  border-radius: 12px;
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  transition: border-color 0.18s ease;
}

/* 参考 outlined-input 动效（配色改用项目主题色）：聚焦时四条主色边框线
   从中心向外展开，像描边一样勾勒输入框四周。
   外层 .composer-outline 用 clip-path 按输入框同等的圆角裁切，
   让描边也呈现圆角化，跟随输入框的形状。 */
.composer-outline {
  position: absolute;
  inset: 0;
  clip-path: inset(0 round 12px);
  pointer-events: none;
  z-index: 2;
}

.composer-line {
  position: absolute;
  background: var(--primary);
  box-shadow: 0 0 6px rgb(var(--primary-rgb) / 0.4);
  transform-origin: center;
  transition: transform 0.5s ease;
  pointer-events: none;
}

.composer-line.top,
.composer-line.bottom {
  height: 2px;
  left: 0;
  right: 0;
  transform: scaleX(0);
}

.composer-line.left,
.composer-line.right {
  width: 2px;
  top: 0;
  bottom: 0;
  transform: scaleY(0);
}

.composer-line.top {
  top: 0;
}

.composer-line.bottom {
  bottom: 0;
}

.composer-line.left {
  left: 0;
}

.composer-line.right {
  right: 0;
}

.composer:focus-within {
  border-color: transparent;
}

.composer:focus-within .composer-line.top,
.composer:focus-within .composer-line.bottom {
  transform: scaleX(1);
}

.composer:focus-within .composer-line.left,
.composer:focus-within .composer-line.right {
  transform: scaleY(1);
}

.composer.drop-active {
  border-color: var(--primary);
  border-style: dashed;
  background: rgb(var(--primary-rgb) / 0.06);
}

.composer-input {
  width: 100%;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 62px;
  background: transparent;
  color: var(--on-surface);
  font-size: 13px;
  line-height: 1.65;
}

.composer-input::placeholder {
  color: var(--on-surface-variant);
}

.draft-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.draft-image {
  position: relative;
  width: 58px;
  height: 58px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--outline-variant);
}

.draft-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.draft-image-del {
  position: absolute;
  top: 2px;
  right: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  color: #fff;
  background: rgb(15 23 42 / 0.65);
}

.draft-image-del:hover {
  background: var(--error);
}

.draft-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.composer-foot {
  position: relative;
  display: flex;
  align-items: center;
  gap: 3px;
  margin-top: 8px;
}

.composer-tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border-radius: 7px;
  color: var(--on-surface-variant);
}

.composer-tool:hover {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.composer-tool.active {
  background: rgb(var(--primary-rgb) / 0.14);
  color: var(--primary);
}

.composer-hint {
  flex: 1;
  min-width: 0;
  margin-left: 4px;
  font-size: 10.5px;
  color: var(--on-surface-variant);
  opacity: 0.85;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-btn {
  flex-shrink: 0;
  padding: 5px 14px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--on-primary-container);
  background: var(--primary);
}

.publish-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.publish-btn:not(:disabled):hover {
  background: var(--primary-container);
}

.file-input {
  display: none;
}

/* ---- 工具条弹层 ---- */

.composer-pop {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  z-index: 30;
  padding: 8px;
  border-radius: 10px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: var(--shadow-lg);
}

.tag-pop {
  right: 0;
  max-height: 190px;
  overflow-y: auto;
}

.list-pop {
  min-width: 132px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.pop-title {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--on-surface-variant);
  margin-bottom: 6px;
}

.pop-empty {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--on-surface-variant);
}

.pop-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.pop-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--on-surface);
  text-align: left;
}

.pop-item:hover {
  background: var(--surface-container-high);
}

.pop-item svg {
  color: var(--on-surface-variant);
}

/* ---------------- 筛选 ---------------- */

.insp-filters {
  flex-shrink: 0;
  padding: 0 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.insp-search {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 9px;
  border-radius: 8px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
}

.insp-search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 12px;
  color: var(--on-surface);
}

.tag-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.1);
  border: 1px solid transparent;
}

.tag-chip.clickable {
  cursor: pointer;
}

.tag-chip.clickable:hover {
  background: rgb(var(--primary-rgb) / 0.18);
}

.tag-chip.active {
  background: var(--primary);
  color: var(--on-primary-container);
  border-color: var(--primary);
}

.tag-count {
  font-size: 10px;
  opacity: 0.75;
}

/* ---------------- 速记流 ---------------- */

.insp-stream {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 0 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.insp-empty {
  padding: 20px 14px;
  border-radius: 12px;
  border: 1px dashed var(--outline-variant);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--on-surface-variant);
  text-align: center;
}

.note-card {
  padding: 11px 12px;
  border-radius: 12px;
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.note-card:hover {
  border-color: var(--outline-variant);
  box-shadow: var(--shadow);
}

.note-card.pinned {
  border-left: 3px solid var(--primary);
}

.note-head {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

/* 置顶按钮左侧的发送 / 编辑日期 */
.note-date {
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
  font-variant-numeric: tabular-nums;
}

.note-edited {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 999px;
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.1);
}

.note-relative {
  font-size: 10px;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.note-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.note-card:hover .note-actions {
  opacity: 1;
}

.note-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 21px;
  height: 21px;
  border-radius: 6px;
  color: var(--on-surface-variant);
}

.note-btn:hover {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.note-btn.on {
  opacity: 1;
  color: var(--primary);
}

.note-btn.danger:hover,
.note-btn.danger.on {
  background: var(--error-container);
  color: var(--error);
}

/* ---- 应用下拉 ---- */

.apply-wrap {
  position: relative;
  display: inline-flex;
}

.apply-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 30;
  min-width: 124px;
  padding: 5px;
  border-radius: 9px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.apply-item {
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--on-surface);
  text-align: left;
  white-space: nowrap;
}

.apply-item:hover {
  background: var(--surface-container-high);
}

.apply-item svg {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.note-confirm {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 9px;
  border-radius: 8px;
  background: var(--error-container);
  font-size: 11.5px;
  color: var(--error);
}

.confirm-yes,
.confirm-no {
  font-size: 11.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 6px;
}

.confirm-yes {
  color: #fff;
  background: var(--error);
}

.confirm-no {
  color: var(--on-surface-variant);
  background: var(--surface-container-high);
}

/* ---- 五行封顶 ----
   卡片高度固定为五行正文（line-height 1.7 × 12.5px ≈ 21.25px/行），
   与内容多少无关；宽度不受影响。展开后解除限制。 */
.note-clamp {
  position: relative;
  max-height: calc(12.5px * 1.7 * 5);
  overflow: hidden;
}

.note-clamp.expanded {
  max-height: none;
  overflow: visible;
}

.note-fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 26px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--surface-container-lowest));
}

.note-more {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-top: 6px;
  padding: 2px 7px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
}

.note-more:hover {
  background: rgb(var(--primary-rgb) / 0.1);
}

.note-body {
  font-size: 12.5px;
  line-height: 1.7;
  word-break: break-word;
}

.note-body :deep(p) {
  margin: 0.35em 0;
}

.note-body :deep(p:first-child) {
  margin-top: 0;
}

.note-body :deep(h1),
.note-body :deep(h2),
.note-body :deep(h3) {
  font-size: 14px;
  margin: 0.5em 0 0.3em;
}

.note-body :deep(pre) {
  margin: 0.5em 0;
  font-size: 11px;
}

.note-body :deep(table) {
  font-size: 11.5px;
  margin: 0.5em 0;
}

.note-body :deep(th),
.note-body :deep(td) {
  padding: 3px 6px;
}

.note-body :deep(img) {
  border-radius: 8px;
}

/* 正文里的 #标签 */
.note-body :deep(.insp-tag) {
  color: var(--primary);
  font-weight: 600;
}

.note-images {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}

.note-images.count-1 {
  grid-template-columns: 1fr;
}

.note-images.count-2 {
  grid-template-columns: repeat(2, 1fr);
}

.note-images.count-3 {
  grid-template-columns: repeat(3, 1fr);
}

.note-image {
  width: 100%;
  max-height: 180px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  cursor: zoom-in;
  display: block;
}

.note-images.count-1 .note-image {
  max-height: 240px;
  object-fit: contain;
  background: var(--surface-container-low);
}

.note-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

/* ---- 行内编辑 ---- */

.note-edit-input {
  width: 100%;
  padding: 7px 9px;
  border-radius: 8px;
  border: 1px solid var(--primary);
  outline: none;
  resize: vertical;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 12.5px;
  line-height: 1.65;
}

.note-edit-foot {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 6px;
}

.edit-save {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--on-primary-container);
  background: var(--primary);
}

.edit-cancel {
  padding: 4px 10px;
  border-radius: 7px;
  font-size: 11.5px;
  color: var(--on-surface-variant);
  background: var(--surface-container-high);
}

/* ---- 大图预览 ---- */

.lightbox {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
  background: rgb(15 23 42 / 0.72);
  cursor: zoom-out;
}

.lightbox img {
  max-width: 100%;
  max-height: 100%;
  border-radius: 12px;
  box-shadow: var(--shadow-lg);
}

.insp-pagination {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px 0 4px;
  margin-top: auto;
}

.page-btn {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface);
  cursor: pointer;
}

.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.page-btn:not(:disabled):hover {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
  border-color: var(--primary);
}

.page-info {
  font-size: 11.5px;
  color: var(--on-surface-variant);
}
</style>
