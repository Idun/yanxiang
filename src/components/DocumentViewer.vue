<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component } from "vue";
import {
  Bold,
  ChevronDown,
  Copy,
  Eye,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Quote,
  Redo2,
  SquareCode,
  Trash2,
  Undo2,
  Sparkles,
  ArrowRight,
  Lightbulb,
  Check,
  X,
  FileCode,
  Palette,
  PanelLeftOpen,
  Search,
  WrapText,
  MoreVertical,
  ArrowLeft,
  ArrowRightLeft,
  Layers,
  RotateCcw,
  Type,
  GripVertical,
  Indent,
  CaseSensitive,
} from "lucide-vue-next";
import { renderForReading } from "../markdown";
import {
  applyContentColoring,
  contentColorCssVars,
  contentColoringOn,
} from "../contentColoring";
import { docStore } from "../docStore";
import {
  aiSettings,
  applyFont,
  clampEditorFontSize,
  clampEditorLineHeight,
  clampEditorMarginX,
  clampEditorMarginY,
  DEFAULT_APP_FONT,
  DEFAULT_EDITOR_FONT_SIZE,
  DEFAULT_EDITOR_LINE_HEIGHT,
  DEFAULT_EDITOR_MARGIN_X,
  DEFAULT_EDITOR_MARGIN_Y,
  EDITOR_FONT_SIZES,
  fontOptions,
} from "../settings";
import { ensureLocalFonts, fontState } from "../fonts";
import { runAgent } from "../agentRunner";
import { recordTokens } from "../tokenStore";
import { WRITER_AGENT_PROMPT } from "../prompts/writerAgent";
import {
  insightStore,
  showToast,
  dismissToast,
  dismissSuggestion,
  buildInsightContext,
  refreshInsights,
  trackModification,
} from "../insightStore";
import {
  documentFilesStore,
  createDocFile,
  selectDocFile2,
} from "../documentFilesStore";
import DocumentSidebar from "./DocumentSidebar.vue";
import ReadingProgressRing from "./ReadingProgressRing.vue";
import InlineAiEdit from "./InlineAiEdit.vue";
import RevisionAnnotation from "./RevisionAnnotation.vue";
import {
  clearRevisionLocate,
  composeContent,
  hasVisibleRevision,
  revisionRangeOf,
  revisionRangesIn,
  revisionStore,
} from "../revisionStore";
import { beginAiDocEdit, endAiDocEdit, pulseAiDocEdit } from "../aiDocActivity";
import { measureTextareaTops } from "../readingOutline";
import {
  docEditorDrag,
  docEditorTargetAt,
  registerDocEditorTarget,
  unregisterDocEditorTarget,
  findDocEditorTargetByDocId,
  docBlockDrag,
  startBlockDrag,
  endBlockDrag,
  type DocBlockPayload,
  type DocEditorDropTarget,
} from "../docEditorDrop";
import { RING_SIZE_MAX } from "../readingRingStore";
import {
  getReadingPosition,
  resolveScrollTop,
  setReadingPosition,
} from "../readingPositionStore";
import {
  contentScrollMax,
  mapScrollTop,
  scrollSpanOf,
  typewriterRunwayPx,
  typewriterTargetTop,
} from "../typewriterScroll";

const props = withDefaults(
  defineProps<{
    embedded?: boolean;
    singleEditor?: boolean;
    /** Renders in the secondary (分栏) pane, bound to `activeFileId2`. */
    secondary?: boolean;
    /** 阅读圆环位置记忆的槽位前缀；嵌入式用法（画布卡片 / 拼接弹窗）各传一份。 */
    ringSlot?: string;
    zenMode?: "markdown" | "preview" | "off";
  }>(),
  { embedded: false, singleEditor: false, secondary: false, ringSlot: "", zenMode: "off" },
);

const emit = defineEmits<{
  (e: "toggleZen", mode: "markdown" | "preview" | "off"): void;
}>();

/* 圆环槽位：主文档界面区分 主/副 分栏，嵌入式由调用方指定。 */
const ringSlotBase = computed(
  () => props.ringSlot || (props.secondary ? "doc2" : "doc"),
);
/* 嵌入式小编辑框（画布卡片 / 拼接弹窗）里圆环收得更小，不抢正文的地方。 */
const ringMaxSize = computed(() => (props.embedded ? 34 : RING_SIZE_MAX));

const showEditor = ref(true);
const showPreview = ref(!props.singleEditor);

const effectiveShowEditor = computed(() => {
  if (props.zenMode === "markdown") return true;
  if (props.zenMode === "preview") return false;
  return showEditor.value;
});

const effectiveShowPreview = computed(() => {
  if (props.zenMode === "preview") return true;
  if (props.zenMode === "markdown") return false;
  return showPreview.value;
});

/* 折叠左侧文档面板（由父级控制，分栏时左折叠 / 右展开）。 */
const sidebarCollapsed = defineModel<boolean>("sidebarCollapsed", { default: false });

function toggleEditor() {
  if (showEditor.value && !showPreview.value) return;
  showEditor.value = !showEditor.value;
}

function togglePreview() {
  if (showPreview.value && !showEditor.value) return;
  showPreview.value = !showPreview.value;
}

const isSplit = computed(() => effectiveShowEditor.value && effectiveShowPreview.value);
const markdown = defineModel<string>({ default: () => docStore.markdown || "" });

function handleToggleZen(mode: "markdown" | "preview" | "off") {
  emit("toggleZen", mode);
}

const spotlightEnabled = ref(false);
function handleToggleSpotlight(active: boolean) {
  spotlightEnabled.value = active;
}

const caretPos = ref(0);
function updateCaretPos() {
  if (editorRef.value) {
    caretPos.value = editorRef.value.selectionStart;
  }
  syncTopSelection();
}

const hoveredPreviewBlock = ref<Element | null>(null);
function onPreviewMouseMove(e: MouseEvent) {
  if (!spotlightEnabled.value || !previewRef.value) return;
  const target = document.elementFromPoint(e.clientX, e.clientY);
  if (target && previewRef.value.contains(target)) {
    const block = target.closest(".reading-view > *");
    if (block && block !== hoveredPreviewBlock.value) {
      if (hoveredPreviewBlock.value) {
        hoveredPreviewBlock.value.classList.remove("spotlight-target");
      }
      block.classList.add("spotlight-target");
      hoveredPreviewBlock.value = block;
    }
  }
}

/* The file slot this pane reads from / writes to. */
const fileIdForSlot = computed(() =>
  props.secondary ? documentFilesStore.activeFileId2 : documentFilesStore.activeFileId,
);
function fileForSlot() {
  return documentFilesStore.files.find((f) => f.id === fileIdForSlot.value);
}

/* When the active document file changes, load its content into the editor. */
watch(
  fileIdForSlot,
  (id) => {
    if (props.embedded) return;
    const file = documentFilesStore.files.find((f) => f.id === id);
    if (file && markdown.value !== file.content) {
      markdown.value = file.content;
    }
  },
  { immediate: true },
);

/* Persist any edit back into the active document file. */
watch(
  markdown,
  (val) => {
    if (props.embedded) return;
    const active = fileForSlot();
    if (active && active.content !== val) {
      active.content = val;
    }
  },
);

/* 反向同步：正文被本组件之外改写时（例如「修订与批注」点了应用、把修订内容
   替换回原文），编辑区要跟着刷新。用户自己打字时这条 watch 会因为两侧已经
   相等而空转，不会形成回路。 */
watch(
  () => fileForSlot()?.content,
  (val) => {
    if (props.embedded) return;
    if (typeof val === "string" && val !== markdown.value) {
      markdown.value = val;
    }
  },
);

/* 粘贴文本：只有当文档界面中没有任何文档时，才把粘贴内容保存进自动新建的
   文档条目；已有文档时走正常粘贴（插入到当前编辑器），不再自动新建。 */
function onEditorPaste(event: ClipboardEvent) {
  if (props.embedded) return;
  const text = event.clipboardData?.getData("text/plain");
  if (!text || !text.trim()) return;

  /* 已有文档 → 正常粘贴，插入当前编辑器。 */
  if (documentFilesStore.files.length > 0) return;

  /* 没有任何文档 → 自动新建一条文档来保存粘贴内容。 */
  event.preventDefault();
  const firstLine = text.trim().split("\n")[0].slice(0, 40).trim();
  const file = createDocFile(null, firstLine || "粘贴的文档");
  file.content = text;
  if (props.secondary) documentFilesStore.activeFileId2 = file.id;
  else documentFilesStore.activeFileId = file.id;
  markdown.value = text;
  showToast("已新建文档", `内容已保存到「${file.title}」`, "habit");
}

/* The sidebar already wrote into the right slot; nothing cross-pane here. */
function onSelectSidebarFile(fileId: string) {
  if (props.secondary) selectDocFile2(fileId);
  else documentFilesStore.activeFileId = fileId;
}
const editorRef = ref<HTMLTextAreaElement | null>(null);
const previewRef = ref<HTMLDivElement | null>(null);
const scrollSyncMode = ref<"separate" | "sync">("separate");
let scrollSyncing = false;
/** 目录跳转期间的比例同步抑制计时器（下限兜底，scrollend 是主释放途径）。 */
let ringJumpTimer: number | null = null;

/* ---- 阅读进度条（0~1）---- */
const editorProgress = ref(0);
const previewProgress = ref(0);

/* ---- 打字机滚动：末尾跑道 ----
   编辑区与预览区各自在底部补一段空白跑道，正文最后一行也能被滚到面板中部：
   编辑区是为了「写字时不贴底」，预览区一是同款观感（读到末尾也停在中部），
   二是同步滚动的前提 —— 两侧都有跑道，比例映射才对得上（见 scrollSpanOf /
   mapScrollTop：正文段映正文段、跑道段映跑道段）。
   进度百分比按「正文余量」算，所以 100% 仍然表示「正文最后一行贴到底边」，
   跑道不掺进百分比。 */
const editorRunwayPx = ref(0);
const previewRunwayPx = ref(0);

function refreshEditorRunway() {
  editorRunwayPx.value = typewriterRunwayPx(editorRef.value);
}

function refreshPreviewRunway() {
  const el = previewRef.value;
  if (!el) {
    previewRunwayPx.value = 0;
    return;
  }
  /* 预览的行高写在内层 .markdown-body 上（readingViewStyle 的 lineHeight），
     滚动容器 .preview-scroll 自己取到的是继承值，量不准，这里显式换算。 */
  const lh = editorFontSize.value * editorLineHeight.value;
  /* 纸面本来就有固定留白（上 marginY+18、下 96）。跑道叠在下留白上，两者相加
     若超过可视高度，min-height:100% 的纸面会被撑高，空文档也凭空多出滚动条。
     先把固定留白扣掉再取跑道，短窗格里最多只吃掉剩余的那点空间。 */
  const room = Math.max(0, el.clientHeight - (editorMarginY.value + 18 + 96));
  previewRunwayPx.value = Math.min(typewriterRunwayPx(el, lh), room);
}

/** 两侧跑道一起重量。可视高度 / 行高 / 字号变化后都要调。 */
function refreshRunways() {
  refreshEditorRunway();
  refreshPreviewRunway();
}

/** 编辑区可滚区间（正文段 + 跑道段），供比例同步用。 */
function editorSpan() {
  return scrollSpanOf(editorRef.value, editorRunwayPx.value);
}

/** 预览区可滚区间。 */
function previewSpan() {
  return scrollSpanOf(previewRef.value, previewRunwayPx.value);
}

function updateEditorProgress() {
  const el = editorRef.value;
  if (!el) {
    editorProgress.value = 0;
    return;
  }
  const max = contentScrollMax(el, editorRunwayPx.value);
  editorProgress.value = max <= 0 ? 0 : Math.min(1, el.scrollTop / max);
}

function updatePreviewProgress() {
  const el = previewRef.value;
  if (!el) {
    previewProgress.value = 0;
    return;
  }
  const max = contentScrollMax(el, previewRunwayPx.value);
  previewProgress.value = max <= 0 ? 0 : Math.min(1, el.scrollTop / max);
}

/* 文档切换 / 内容变化后重算进度，避免进度条停留在旧文档的数值上。 */
watch(markdown, () => {
  nextTick(() => {
    refreshRunways();
    updateEditorProgress();
    updatePreviewProgress();
  });
});

/* ---------------- 阅读停留位置记忆 ----------------

   每个文档条目各记一份滚动位置（编辑区 / 预览区分开），切走再切回、
   甚至关掉应用再打开，都回到上次读到的正文位置而不是文首。
   嵌入式用法（画布卡片 / 拼接弹窗）不参与：那里的编辑框是临时视图。 */

/** 恢复过程中不记账，否则「先归零再落位」的中间态会把记忆冲掉。 */
let restoringPosition = false;
let positionSaveTimer: number | null = null;
const rootRef = ref<HTMLDivElement | null>(null);
let visibilityObserver: ResizeObserver | null = null;
/** 上一次观察到的可见性，用于识别「隐藏 → 重新可见」这一跳。 */
let wasVisible = false;

function positionKey(): string | null {
  if (props.embedded) return null;
  return fileIdForSlot.value || null;
}

/**
 * 本组件当前是否真的有布局。
 *
 * 文档页在 App 里是 v-show 切换的：隐藏时 display:none，scrollTop 一律读成 0、
 * clientHeight 也是 0。此时既不能记账（会把记忆冲成文首），也没法恢复
 * （算不出滚动余量）。
 */
function hasLayout(): boolean {
  const root = rootRef.value;
  if (root && root.clientHeight > 0) return true;
  const editor = editorRef.value;
  const preview = previewRef.value;
  return (editor?.clientHeight ?? 0) > 0 || (preview?.clientHeight ?? 0) > 0;
}

/** 该文档自己的正文长度。切换文档时 markdown 已经换成新文档了，不能拿它当基准。 */
function contentLengthOf(fileId: string): number {
  const file = documentFilesStore.files.find((f) => f.id === fileId);
  return file ? file.content.length : markdown.value.length;
}

/** 立即把当前两个窗格的滚动位置记进 store。 */
function flushReadingPosition(fileId = positionKey()) {
  if (!fileId || restoringPosition || !hasLayout()) return;
  const editor = editorRef.value;
  const preview = previewRef.value;
  if (!editor && !preview) return;

  const patch: Parameters<typeof setReadingPosition>[1] = {
    length: contentLengthOf(fileId),
  };
  if (editor) {
    const max = contentScrollMax(editor, editorRunwayPx.value);
    patch.editorTop = editor.scrollTop;
    patch.editorRatio = max > 0 ? Math.min(1, editor.scrollTop / max) : 0;
  }
  if (preview) {
    const max = contentScrollMax(preview, previewRunwayPx.value);
    patch.previewTop = preview.scrollTop;
    patch.previewRatio = max > 0 ? Math.min(1, preview.scrollTop / max) : 0;
  }
  setReadingPosition(fileId, patch);
}

/** 滚动是高频事件：合并到停手后再落库。 */
function scheduleReadingPositionSave() {
  if (restoringPosition || !positionKey()) return;
  if (positionSaveTimer !== null) window.clearTimeout(positionSaveTimer);
  positionSaveTimer = window.setTimeout(() => {
    positionSaveTimer = null;
    flushReadingPosition();
  }, 320);
}

/**
 * 把两个窗格滚到记忆位置；没有记忆（从未读过）则回到文首。
 *
 * 必须做两轮：上面那条「内容变化后保持原滚动位置」的 post watch 会在本轮
 * nextTick 里把 scrollTop 设回切换前的偏移，第二轮（rAF）才是最终落点，
 * 同时也吃掉预览区字体 / 图片重排带来的位移。两轮都在绘制前完成，不会闪。
 */
function restoreReadingPosition(fileId: string | null = positionKey()) {
  if (!fileId) return;
  const saved = getReadingPosition(fileId);

  restoringPosition = true;
  const apply = () => {
    const editor = editorRef.value;
    const preview = previewRef.value;
    const length = contentLengthOf(fileId);
    refreshRunways();
    if (editor) {
      const max = contentScrollMax(editor, editorRunwayPx.value);
      editor.scrollTop = resolveScrollTop(saved, "editor", max, length);
    }
    if (preview) {
      const max = contentScrollMax(preview, previewRunwayPx.value);
      preview.scrollTop = resolveScrollTop(saved, "preview", max, length);
    }
    updateEditorProgress();
    updatePreviewProgress();
    const el = editorRef.value;
    const hl = highlightRef.value;
    if (el && hl) {
      hl.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    }
  };

  void nextTick(() => {
    apply();
    requestAnimationFrame(() => {
      apply();
      restoringPosition = false;
    });
  });
}

/* 文档页由 v-show 控制：隐藏时 display:none，scrollTop 一律读成 0、
   clientHeight 也是 0，既没法记账也算不出滚动余量。这里盯根容器尺寸，
   在「隐藏 → 重新可见」的那一跳补一次恢复（应用启动时首页在前，
   以及来回切换主标签页，都走这条路）。 */
function attachVisibilityObserver() {
  if (props.embedded || typeof ResizeObserver === "undefined") return;
  const root = rootRef.value;
  if (!root || visibilityObserver) return;
  wasVisible = hasLayout();
  visibilityObserver = new ResizeObserver(() => {
    const visible = hasLayout();
    if (visible && !wasVisible) restoreReadingPosition();
    wasVisible = visible;
  });
  visibilityObserver.observe(root);
}

/* 切换文档：离开前把旧文档的位置落定，切换后恢复新文档的位置。
   flush 默认 pre，回调运行时 DOM 仍是旧文档，能读到正确的 scrollTop。 */
watch(fileIdForSlot, (id, prevId) => {
  if (props.embedded) return;
  if (positionSaveTimer !== null) {
    window.clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  if (prevId) flushReadingPosition(prevId);
  restoreReadingPosition(id ?? null);
});

const splitRatio = ref(50);
const splitDragging = ref(false);
const panesRef = ref<HTMLDivElement | null>(null);
/* 字号收进 aiSettings，所有编辑区（文档 / 画布卡片 / 拼文预览 / 拼文对比）共用
   同一个值并随设置一起落库，避免各处字号各自为政。 */
const editorFontSize = computed({
  get: () => aiSettings.editorFontSize,
  set: (size: number) => {
    aiSettings.editorFontSize = clampEditorFontSize(size);
  },
});
const fontSizes = EDITOR_FONT_SIZES;

const editorLineHeight = computed({
  get: () => aiSettings.editorLineHeight,
  set: (lh: number) => {
    aiSettings.editorLineHeight = clampEditorLineHeight(lh);
  },
});

const editorMarginX = computed({
  get: () => aiSettings.editorMarginX,
  set: (mx: number) => {
    aiSettings.editorMarginX = clampEditorMarginX(mx);
  },
});

const editorMarginY = computed({
  get: () => aiSettings.editorMarginY,
  set: (my: number) => {
    aiSettings.editorMarginY = clampEditorMarginY(my);
  },
});

const editorGridLine = computed({
  get: () => aiSettings.editorGridLine,
  set: (val) => {
    aiSettings.editorGridLine = val;
  },
});

function resetTypographyDefaults() {
  editorFont.value = DEFAULT_APP_FONT;
  editorFontSize.value = DEFAULT_EDITOR_FONT_SIZE;
  editorLineHeight.value = DEFAULT_EDITOR_LINE_HEIGHT;
  editorMarginX.value = DEFAULT_EDITOR_MARGIN_X;
  editorMarginY.value = DEFAULT_EDITOR_MARGIN_Y;
  editorGridLine.value = "none";
}

let lastEditorScrollPos = { top: 0, left: 0 };

watch(
  markdown,
  () => {
    const el = editorRef.value;
    if (!el) return;
    lastEditorScrollPos = { top: el.scrollTop, left: el.scrollLeft };
    nextTick(() => {
      if (!el) return;
      const maxTop = el.scrollHeight - el.clientHeight;
      const maxLeft = el.scrollWidth - el.clientWidth;
      el.scrollTop = Math.min(lastEditorScrollPos.top, Math.max(0, maxTop));
      el.scrollLeft = Math.min(lastEditorScrollPos.left, Math.max(0, maxLeft));
    });
  },
  { flush: "post" },
);

/* ---------------- 撤销 / 重做：自建历史栈 ----------------

   原实现走的是 document.execCommand("undo")，它只认浏览器替 textarea 维护的
   那份原生输入历史 —— 而工具栏的加粗 / 标题 / 列表 / 引用 / 代码块 / 链接、
   查找替换、一键排版、AI 润色续写、行内 AI 编辑、智能引号空格等，全都是
   `markdown.value = …` 这样的程序化赋值，一条都进不了原生栈。于是「工具栏加进去
   的 markdown 语法按 Ctrl+Z 撤不掉」。

   这里改为自己维护快照栈：无论改动来自键盘还是程序，都会被 watch 捕获记账，
   Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y 与工具栏按钮统一走这一份历史。 */

interface HistorySnap {
  text: string;
  selStart: number;
  selEnd: number;
}

/** 栈深上限：超出后丢弃最早的一条。 */
const HISTORY_LIMIT = 300;
/** 连续键入的合并窗口（ms）：窗口内的逐字输入并进同一条，避免一字一撤销。 */
const TYPING_MERGE_MS = 450;
/** 单次改动不超过这个字数才允许并进上一条（粘贴 / 大段替换一律独立成条）。 */
const TYPING_MERGE_MAX_DELTA = 8;

/* 快照栈用 shallowRef：整条替换才需要响应式（驱动按钮禁用态），
   合并写入栈顶那一条不必惊动渲染，也省掉给几百条长文本套代理的开销。 */
const history = shallowRef<HistorySnap[]>([{ text: markdown.value, selStart: 0, selEnd: 0 }]);
const historyIndex = ref(0);
/** 正在回放的历史文本：watch 认出它就跳过记账，避免撤销动作本身又进栈。 */
let restoringText: string | null = null;
/** 下一条改动强制独立成条（撤销后继续编辑、离散动作之后）。 */
let historyBreak = true;
/** 最近一次 textarea 原生输入（beforeinput）的时刻，用来区分「键入」与「程序化改写」。
    用时间戳而不是布尔量：某些输入被浏览器吞掉（如行首按退格）时不会有后续改动，
    布尔量会一直挂着，把下一次程序化改动误判成键入。 */
let lastNativeInputAt = 0;
/** 原生输入与随之而来的记账同处一个事件循环，几十毫秒的窗口足够且不会误伤。 */
const NATIVE_INPUT_WINDOW_MS = 60;
let lastRecordAt = 0;

const canUndo = computed(() => historyIndex.value > 0);
const canRedo = computed(() => historyIndex.value < history.value.length - 1);

/** 把历史清空并以 text 作为唯一基准点（切换文档时用，避免撤销串到别的文档）。 */
function resetHistory(text: string) {
  history.value = [{ text, selStart: 0, selEnd: 0 }];
  historyIndex.value = 0;
  restoringText = null;
  historyBreak = true;
  lastNativeInputAt = 0;
  lastRecordAt = 0;
}

function onEditorBeforeInput() {
  lastNativeInputAt = Date.now();
}

/**
 * 记一条历史。
 *
 * 只有「原生逐字输入 + 距上条很近 + 改动很小」这三条同时成立时才并进上一条；
 * 工具栏与 AI 之类的程序化改动一律独立成条，按一次 Ctrl+Z 精确回退一步。
 */
function recordHistory(text: string) {
  const now = Date.now();
  const native = now - lastNativeInputAt <= NATIVE_INPUT_WINDOW_MS;
  lastNativeInputAt = 0;

  if (restoringText !== null) {
    if (text === restoringText) {
      restoringText = null;
      return;
    }
    restoringText = null;
  }

  const stack = history.value;
  const idx = historyIndex.value;
  const cur = stack[idx];
  if (cur && cur.text === text) return;

  const prev = cur ? cur.text : "";
  const added = text.length - prev.length;
  const sel = currentSelection();
  /* 刚敲下的是回车 → 段落边界，另起一条，撤销粒度按段落走。 */
  const typedNewline =
    added > 0 && text.slice(Math.max(0, sel.selStart - added), sel.selStart).includes("\n");
  const mergeable =
    native &&
    !historyBreak &&
    !typedNewline &&
    idx > 0 &&
    idx === stack.length - 1 &&
    now - lastRecordAt < TYPING_MERGE_MS &&
    Math.abs(added) <= TYPING_MERGE_MAX_DELTA;

  const snap: HistorySnap = { text, selStart: sel.selStart, selEnd: sel.selEnd };

  if (mergeable) {
    stack[idx] = snap;
  } else {
    const next = stack.slice(0, idx + 1);
    next.push(snap);
    while (next.length > HISTORY_LIMIT) next.shift();
    history.value = next;
    historyIndex.value = next.length - 1;
  }

  /* 程序化改动（工具栏 / AI / 替换）之后必须另起一条：否则紧接着敲的字会被并进
     那条动作里，一次 Ctrl+Z 把两步一起撤掉。刚敲下回车同理，让下一段独立成条。 */
  historyBreak = !native || typedNewline;
  lastRecordAt = now;
}

function currentSelection(): { selStart: number; selEnd: number } {
  const el = editorRef.value;
  if (!el) return { selStart: 0, selEnd: 0 };
  return { selStart: el.selectionStart ?? 0, selEnd: el.selectionEnd ?? 0 };
}

/** 光标移动时顺手刷新栈顶快照的选区，撤销回来时光标能落回离开时的位置。 */
function syncTopSelection() {
  const snap = history.value[historyIndex.value];
  const el = editorRef.value;
  if (!snap || !el || snap.text !== markdown.value) return;
  snap.selStart = el.selectionStart ?? 0;
  snap.selEnd = el.selectionEnd ?? 0;
}

/* 所有正文改动的唯一记账入口。放在 flush: "sync" 上，保证工具栏那种
   「改正文 → nextTick 里重设选区」的两段式动作也能按发生顺序被记下。 */
watch(markdown, (val) => recordHistory(val), { flush: "sync" });

/* 换了文档就把撤销历史归零：否则 Ctrl+Z 会把上一篇的正文塞进这一篇。
   必须排在上面「载入文档内容」的 watch 之后注册，才能拿到切换后的正文。 */
watch(fileIdForSlot, () => {
  if (props.embedded) return;
  resetHistory(markdown.value);
});

function applySnapshot(snap: HistorySnap) {
  if (snap.text !== markdown.value) {
    restoringText = snap.text;
    markdown.value = snap.text;
  }
  nextTick(() => {
    const el = editorRef.value;
    if (!el) return;
    el.focus();
    const max = el.value.length;
    el.setSelectionRange(Math.min(snap.selStart, max), Math.min(snap.selEnd, max));
    caretPos.value = el.selectionStart;
  });
}

function undo() {
  if (!canUndo.value) {
    if (editorRef.value) editorRef.value.focus();
    return;
  }
  syncTopSelection();
  historyIndex.value -= 1;
  historyBreak = true;
  applySnapshot(history.value[historyIndex.value]);
}

function redo() {
  if (!canRedo.value) {
    if (editorRef.value) editorRef.value.focus();
    return;
  }
  historyIndex.value += 1;
  historyBreak = true;
  applySnapshot(history.value[historyIndex.value]);
}

function onEditorKeydown(event: KeyboardEvent) {
  /* 工具栏下拉菜单开着时 Escape 先收菜单，不要顺带退出禅定模式。 */
  if (event.key === "Escape" && (headingMenuOpen.value || listMenuOpen.value)) {
    event.preventDefault();
    event.stopPropagation();
    closeToolMenus();
    return;
  }
  const mod = event.ctrlKey || event.metaKey;
  if (mod) {
    const key = event.key.toLowerCase();

    // Ctrl+B: 粗体
    if (!event.altKey && !event.shiftKey && key === "b") {
      event.preventDefault();
      wrapSelection("**", "**", "加粗文本");
      return;
    }
    // Ctrl+I: 斜体
    if (!event.altKey && !event.shiftKey && key === "i") {
      event.preventDefault();
      wrapSelection("*", "*", "斜体文本");
      return;
    }
    // Ctrl+1 ~ 5: 标题 H1 ~ H5
    if (!event.altKey && !event.shiftKey && ["1", "2", "3", "4", "5"].includes(key)) {
      event.preventDefault();
      applyLineStyle(`h${key}` as LineStyle);
      return;
    }
    // Ctrl+Shift+O 或 Ctrl+Alt+O: 序号 (有序列表)
    if (key === "o" && (event.shiftKey || event.altKey)) {
      event.preventDefault();
      applyLineStyle("ordered");
      return;
    }
    // Ctrl+Shift+C 或 Ctrl+Alt+C: 代码块
    if (key === "c" && event.shiftKey) {
      event.preventDefault();
      insertCodeBlock();
      return;
    }
    // Ctrl+L: 链接
    if (!event.altKey && !event.shiftKey && key === "l") {
      event.preventDefault();
      insertLink();
      return;
    }
    // Ctrl+Shift+Q: 引用
    if (key === "q" && (event.shiftKey || event.altKey)) {
      event.preventDefault();
      applyLineStyle("quote");
      return;
    }
    // Ctrl+Shift+F: 一键排版（清除多余空行）
    if (key === "f" && event.shiftKey) {
      event.preventDefault();
      reformatWhitespace();
      return;
    }
    // Ctrl+F / Ctrl+H: 查找与替换
    if (!event.altKey && !event.shiftKey && (key === "f" || key === "h")) {
      event.preventDefault();
      openFind();
      return;
    }

    if (!event.altKey && key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo();
      } else {
        undo();
      }
      return;
    }
    if (!event.altKey && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
  }
}

async function copyAll() {
  try {
    await navigator.clipboard.writeText(markdown.value);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = markdown.value;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

/* 一键排版：保留原文换行机制，只清除“无意义”的空行，让内容紧凑。 */
function reformatWhitespace() {
  if (!markdown.value) return;
  const cleaned = markdown.value
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+|\n+$/g, "");
  if (cleaned !== markdown.value) {
    markdown.value = cleaned;
    /* 焦点交回编辑区，紧接着按 Ctrl+Z 就能撤掉这次排版。 */
    nextTick(() => editorRef.value?.focus());
    showToast("已重新排版", "已清除多余空行，内容更紧凑", "habit");
  } else {
    showToast("无需调整", "当前内容没有多余空行", "habit");
  }
}

const showClearConfirm = ref(false);

function clearDoc() {
  if (!markdown.value) return;
  showClearConfirm.value = true;
}

function confirmClearDoc() {
  markdown.value = "";
  showClearConfirm.value = false;
  /* 同上：清空也是一条可撤销的历史，焦点回到编辑区才能按 Ctrl+Z 找回来。 */
  nextTick(() => editorRef.value?.focus());
  showToast("已清空文档", "文档内容已全部清空", "habit");
}

function setFontSize(size: number) {
  editorFontSize.value = size;
  nextTick(() => {
    const el = editorRef.value;
    if (el) {
      lastEditorScrollPos = { top: el.scrollTop, left: el.scrollLeft };
      el.scrollTop = Math.min(lastEditorScrollPos.top, Math.max(0, el.scrollHeight - el.clientHeight));
    }
  });
}

/* ---- Font family picker ----
   The main pane keeps syncing with 设置 → 配置 → 字体; the 分栏 pane holds its own
   local value so changing it never reaches across into the other pane. */

const secondaryFont = ref(aiSettings.appFont);

const editorFont = computed({
  get: () => (props.secondary ? secondaryFont.value : aiSettings.appFont),
  set: (font: string) => {
    if (props.secondary) secondaryFont.value = font;
    else applyFont(font);
  },
});

/** Preset + detected local fonts, de-duplicated, so both pickers stay in sync. */
const localOnlyFonts = computed(() => {
  const presets = new Set(fontOptions);
  return fontState.localFonts.filter((f) => !presets.has(f));
});

const editorFontStack = computed(() => `"${editorFont.value}", var(--app-font)`);

/* 预览纸面样式：字号 / 字体之外，把「内容上色」配色方案以 CSS 变量挂上来，
   zj-* 着色类按需取色，颜色值只维护在 contentColoring.ts 一份。
   行首缩进 / 首字下沉由 style.css 里的子代选择器按「顶层正文段落」生效，
   不再依赖整篇文档是否纯文本，这里不需要再挂行内兜底。 */
const readingViewStyle = computed(() => ({
  fontSize: editorFontSize.value + "px",
  fontFamily: editorFontStack.value,
  lineHeight: editorLineHeight.value,
  ...contentColorCssVars(),
}));

/* 编辑区排版变量。--ed-runway 是打字机滚动的末尾跑道：写进 textarea 的
   padding-bottom，让正文最后一行也能被滚到编辑区中部。clientHeight 本身
   已含 padding，加跑道不会改变可视高度，所以不会与跑道的计算相互喂食。 */
const editorWrapStyle = computed(() => {
  const fontSize = editorFontSize.value;
  const lineHeight = editorLineHeight.value;
  const lineH = Number((fontSize * lineHeight).toFixed(2));
  /* 文本基线相对于行框顶部的精准像素偏移：
     halfLeading = (lineHeight - 1) / 2
     fontBaselineRatio ≈ 0.84 (中英文主流字体的基线比例) */
  const baselineOffset = Number((fontSize * ((lineHeight - 1) / 2 + 0.84)).toFixed(2));
  const padY = editorMarginY.value;

  return {
    "--ed-font-size": fontSize + "px",
    "--ed-line-height": lineHeight,
    "--ed-line-height-px": lineH + "px",
    "--ed-line-baseline-px": baselineOffset + "px",
    "--ed-pad-y": padY + "px",
    "--ed-pad-x": `max(${editorMarginX.value}px, calc((100% - var(--reading-measure)) / 2))`,
    "--ed-runway": editorRunwayPx.value + "px",
  };
});

/* 预览纸面内边距。底部除固定留白外再叠一段 --pv-runway（打字机跑道）：
   读到最后一段时它也能停在面板中部，与编辑区同款观感；同时这段跑道是
   两侧同步滚动能对齐的前提（见 syncFromEditor 的分段映射）。 */
const paperCardStyle = computed(() => {
  const lineH = Number((editorFontSize.value * editorLineHeight.value).toFixed(2));
  return {
    "--ed-font-size": editorFontSize.value + "px",
    "--ed-line-height": editorLineHeight.value,
    "--ed-line-height-px": lineH + "px",
    "--ed-pad-y": editorMarginY.value + "px",
    padding: `${editorMarginY.value + 18}px ${Math.max(24, editorMarginX.value + 16)}px calc(96px + ${previewRunwayPx.value}px)`,
  };
});

/* ---------------- 工具栏横向拖拽滚动（分栏/窄栏时查看被遮挡的工具） ---------------- */

const formatToolsRef = ref<HTMLElement | null>(null);
const toolbarPanning = ref(false);
const toolbarSuppressClick = ref(false);
const toolbarDragState = ref<{
  pointerId: number;
  startX: number;
  startScroll: number;
  active: boolean;
} | null>(null);

function onToolbarPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const el = formatToolsRef.value;
  if (!el) return;
  toolbarDragState.value = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startScroll: el.scrollLeft,
    active: false,
  };
  toolbarPanning.value = false;
  toolbarSuppressClick.value = false;
  window.addEventListener("pointermove", onToolbarWindowMove);
  window.addEventListener("pointerup", onToolbarWindowUp);
  window.addEventListener("pointercancel", onToolbarWindowUp);
}

function onToolbarWindowMove(event: PointerEvent) {
  const st = toolbarDragState.value;
  if (!st || event.pointerId !== st.pointerId) return;
  const el = formatToolsRef.value;
  if (!el) return;
  if (!st.active) {
    /* 移动超过阈值后才进入“拖拽定位”模式，避免影响普通点击。 */
    if (Math.abs(event.clientX - st.startX) > 4) {
      st.active = true;
      toolbarPanning.value = true;
      toolbarSuppressClick.value = true;
    } else {
      return;
    }
  }
  event.preventDefault();
  el.scrollLeft = st.startScroll - (event.clientX - st.startX);
}

function detachToolbarWindowListeners() {
  window.removeEventListener("pointermove", onToolbarWindowMove);
  window.removeEventListener("pointerup", onToolbarWindowUp);
  window.removeEventListener("pointercancel", onToolbarWindowUp);
}

function onToolbarWindowUp(event: PointerEvent) {
  const st = toolbarDragState.value;
  detachToolbarWindowListeners();
  if (!st || event.pointerId !== st.pointerId) {
    toolbarPanning.value = false;
    return;
  }
  const wasActive = st.active;
  toolbarDragState.value = null;
  toolbarPanning.value = false;
  if (wasActive) {
    /* 拖拽滚动后吞掉随之而来的 click，避免误触工具栏按钮。 */
    window.setTimeout(() => {
      toolbarSuppressClick.value = false;
    }, 0);
  } else {
    toolbarSuppressClick.value = false;
  }
}

function onToolbarClickCapture(event: Event) {
  if (toolbarSuppressClick.value) {
    event.preventDefault();
    event.stopPropagation();
  }
}

/* ---------------- 查找 / 替换 ---------------- */

const findOpen = ref(false);
const findText = ref("");
const replaceText = ref("");
const findCaseSensitive = ref(false);
const findIndex = ref(0);
const findInputRef = ref<HTMLInputElement | null>(null);

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 所有命中位置（起始下标），供计数与跳转使用。 */
const findMatches = computed<number[]>(() => {
  const term = findText.value;
  if (!term) return [];
  const hay = findCaseSensitive.value ? markdown.value : markdown.value.toLowerCase();
  const needle = findCaseSensitive.value ? term : term.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    out.push(at);
    from = at + Math.max(1, needle.length);
  }
  return out;
});

function getSelectedText(): string {
  let selected = "";
  if (editorRef.value) {
    const start = editorRef.value.selectionStart;
    const end = editorRef.value.selectionEnd;
    if (start !== undefined && end !== undefined && start < end) {
      selected = editorRef.value.value.substring(start, end);
    }
  }
  if (!selected) {
    const sel = window.getSelection();
    if (sel) {
      selected = sel.toString();
    }
  }
  if (selected) {
    const firstLine = selected.split(/\r?\n/)[0].trim();
    return firstLine;
  }
  return "";
}

function openFind() {
  const selected = getSelectedText();
  if (selected) {
    findText.value = selected;
  }
  findOpen.value = true;
  nextTick(() => {
    findInputRef.value?.focus();
    findInputRef.value?.select();
  });
}

function toggleFind() {
  if (!findOpen.value) {
    openFind();
  } else {
    const selected = getSelectedText();
    if (selected && selected !== findText.value) {
      findText.value = selected;
      nextTick(() => {
        findInputRef.value?.focus();
        findInputRef.value?.select();
      });
    } else {
      closeFind();
    }
  }
}

/** 定位第 n 个命中：滚动到可见处，并靠编辑区覆盖层高亮当前命中（不抢走查找框焦点，
    这样在查找/替换输入框内连续按回车只会不断跳转下一个命中）。 */
function focusMatch(n: number) {
  const total = findMatches.value.length;
  if (total === 0) return;
  const idx = ((n % total) + total) % total;
  findIndex.value = idx;
  const start = findMatches.value[idx];
  const el = editorRef.value;
  if (!el) return;
  if (!showEditor.value) showEditor.value = true;
  nextTick(() => {
    /* 不调用 el.focus()，避免焦点跑到正文编辑区，导致后续回车变成换行。 */
    el.setSelectionRange(start, start + findText.value.length);
    /* 粗略滚动定位：按命中前的换行数估算行号。 */
    const line = markdown.value.slice(0, start).split("\n").length - 1;
    el.scrollTop = Math.max(0, line * editorFontSize.value * 1.6 - el.clientHeight / 2);
  });
}

function findNext() {
  focusMatch(findIndex.value + 1);
}

function findPrev() {
  focusMatch(findIndex.value - 1);
}

/** 替换当前选中的命中；未选中则先定位第一个。 */
function replaceCurrent() {
  if (findMatches.value.length === 0) return;
  const idx = Math.min(findIndex.value, findMatches.value.length - 1);
  const start = findMatches.value[idx];
  markdown.value =
    markdown.value.slice(0, start) + replaceText.value + markdown.value.slice(start + findText.value.length);
  nextTick(() => focusMatch(idx));
}

function replaceAll() {
  const term = findText.value;
  if (!term) return;
  const re = new RegExp(escapeRegExp(term), findCaseSensitive.value ? "g" : "gi");
  const count = findMatches.value.length;
  markdown.value = markdown.value.replace(re, replaceText.value);
  findIndex.value = 0;
  if (count > 0) showToast("已全部替换", `共替换 ${count} 处`, "edit");
}

function closeFind() {
  findOpen.value = false;
  findText.value = "";
  replaceText.value = "";
  findIndex.value = 0;
}

function startSplitDrag(event: MouseEvent) {
  event.preventDefault();
  splitDragging.value = true;
  const move = (e: MouseEvent) => {
    const panes = panesRef.value;
    if (!panes) return;
    const rect = panes.getBoundingClientRect();
    const ratio = ((e.clientX - rect.left) / rect.width) * 100;
    splitRatio.value = Math.min(80, Math.max(20, ratio));
  };
  const up = () => {
    splitDragging.value = false;
    document.removeEventListener("mousemove", move);
    document.removeEventListener("mouseup", up);
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("mouseup", up);
}

const previewTimestamp = computed(() => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

/** 预览区渲染；查找时把命中的关键词包上 <mark> 高亮（只处理标签之间的文本），
     当前命中使用不同视觉（双色边框），其余命中为浅色底。
     渲染前先叠加「修订与批注」图层：小眼睛开着的修订内容会替换掉对应原文，
     正文（file.content）本身不动，所以关掉小眼睛即刻回到原文。
     「定位」期间还会给目标那段套一层强调标记，让预览区也看得出改的是哪儿。
     最后再整体过一遍「内容上色」：markdown 与纯文本统一着色，打开该开关时生效。 */
const rendered = computed(() => {
  const source = revisionEnabled.value
    ? composeContent(fileIdForSlot.value, markdown.value)
    : markdown.value;
  /* 纯文本文档用阅读渲染：章节标题行在预览层提升为真标题，不参与行首缩进，
     标题下方的正文自动独立成段缩进，内容上色也按标题上下文上色。 */
  let html = renderForReading(source);

  if (locatedPreviewText.value) {
    html = injectPreviewLocateMark(html, locatedPreviewText.value);
  }

  const term = findText.value;
  if (findOpen.value && term) {
    const re = new RegExp(escapeRegExp(term), findCaseSensitive.value ? "g" : "gi");
    let hitCount = -1;
    html = html.replace(/>([^<]+)</g, (_m, text: string) => {
      return `>${text.replace(re, (hit) => {
        hitCount++;
        const cls = hitCount === findIndex.value ? "find-hit find-hit-current" : "find-hit";
        return `<mark class="${cls}">${hit}</mark>`;
      })}<`;
    });
  }

  /* 纯文本章节标题已在 renderForReading 里提升为标题，这里无需再打标记。 */

  if (contentColoringOn.value) {
    html = applyContentColoring(html);
  }
  return html;
});

/* ---- 编辑区命中高亮（透明覆盖层，跟随 textarea 滚动） ---- */

const highlightRef = ref<HTMLDivElement | null>(null);

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** 覆盖层里的一段着色区间。 */
interface EditorMark {
  start: number;
  end: number;
  cls: string;
}

/**
 * 「修订与批注」在编辑区的着色区间。
 *
 * 编辑区永远显示原文，所以这里只做视觉落差：被纳入图层的那段原文带上底色，
 * 用户一眼能看出哪几段已经提过修订 / 批注。小眼睛关掉的图层用更淡的底色。
 */
const revisionMarks = computed<EditorMark[]>(() => {
  if (!revisionEnabled.value) return [];
  return revisionRangesIn(fileIdForSlot.value, markdown.value).map((r) => ({
    start: r.start,
    end: r.end,
    cls: [
      "rev-mark",
      r.item.visible ? "" : "rev-mark-hidden",
      r.item.revised.trim() ? "" : "rev-mark-comment",
      r.item.id === locatedRevisionId.value ? "rev-mark-located" : "",
    ]
      .filter(Boolean)
      .join(" "),
  }));
});

/** 查找命中的着色区间。 */
const findMarks = computed<EditorMark[]>(() => {
  const term = findText.value;
  if (!findOpen.value || !term) return [];
  return findMatches.value.map((start, i) => ({
    start,
    end: start + term.length,
    cls: i === findIndex.value ? "find-hit find-hit-current" : "find-hit",
  }));
});

/** 覆盖层需不需要渲染：有修订着色或查找命中时才铺开。 */
const editorOverlayActive = computed(
  () => spotlightEnabled.value || findMarks.value.length > 0 || revisionMarks.value.length > 0,
);

/**
 * 把若干可能相互重叠的区间渲染成与 textarea 逐字对齐的 HTML。
 *
 * 在每条区间的端点处切段，同一段落上叠加的多个 class 一并挂上——查找命中正好
 * 落在修订区间里时两种底色能同时呈现，而不是相互覆盖。
 */
function renderEditorMarks(text: string, marks: EditorMark[], currentLine: number | null): string {
  const lines = text.split("\n");
  let out = "";
  let g = 0;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const lineStart = g;
    const lineEnd = g + line.length;

    /* 本行内的切点：行首行尾 + 落在行内的区间端点。 */
    const points = new Set<number>([lineStart, lineEnd]);
    for (const m of marks) {
      if (m.end <= lineStart || m.start >= lineEnd) continue;
      points.add(Math.max(lineStart, m.start));
      points.add(Math.min(lineEnd, m.end));
    }
    const cuts = [...points].sort((a, b) => a - b);

    let lineOut = "";
    for (let i = 0; i + 1 < cuts.length; i++) {
      const s = cuts[i];
      const e = cuts[i + 1];
      if (e <= s) continue;
      const chunk = escapeHtml(line.slice(s - lineStart, e - lineStart));
      const classes = marks.filter((m) => m.start <= s && m.end >= e).map((m) => m.cls);
      lineOut += classes.length > 0 ? `<mark class="${classes.join(" ")}">${chunk}</mark>` : chunk;
    }

    if (currentLine === li) {
      lineOut = `<span class="find-line-current">${lineOut}</span>`;
    }

    if (li > 0) out += "\n";
    out += lineOut;
    g = lineEnd + 1;
  }
  return out;
}

/** 当前命中所在的行号，用于整行浅色底。 */
function lineIndexOf(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** 与 textarea 内容逐字对齐的命中 / 修订 / 聚光 HTML */
const highlightedEditorHtml = computed(() => {
  const text = markdown.value;

  if (spotlightEnabled.value && (!findOpen.value || !findText.value)) {
    const lines = text.split("\n");
    let g = 0;
    const curPos = caretPos.value;

    let activeLineIdx = 0;
    for (let i = 0; i < lines.length; i++) {
      const lineLen = lines[i].length;
      if (curPos >= g && curPos <= g + lineLen) {
        activeLineIdx = i;
        break;
      }
      g += lineLen + 1;
    }

    return lines
      .map((line, idx) => {
        const escaped = escapeHtml(line);
        if (idx === activeLineIdx) {
          return `<span class="spotlight-active-line">${escaped || "&nbsp;"}</span>`;
        }
        return `<span class="spotlight-dim-line">${escaped || "&nbsp;"}</span>`;
      })
      .join("\n");
  }

  const marks = [...revisionMarks.value, ...findMarks.value];
  if (marks.length === 0) return escapeHtml(text);

  const current = findMarks.value[findIndex.value];
  return renderEditorMarks(text, marks, current ? lineIndexOf(text, current.start) : null);
});

/** textarea 滚动时同步偏移高亮层；同时兼顾预览同步与阅读进度。 */
function onEditorScroll() {
  updateEditorProgress();
  syncFromEditor();
  scheduleReadingPositionSave();
  const el = editorRef.value;
  const hl = highlightRef.value;
  if (el && hl) {
    hl.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
  }
  /* 选中工具栏显示期间滚动，保持其跟随选中文字（重新以当前滚动位置定位）。
     滚动后光标位置不再有意义，锚点回退为跟随选中文字本身。 */
  if (showSelectionToolbar.value) {
    anchorByMouse = false;
    selectionMousePos.value = null;
    selectionMenuOpen.value = false;
    positionSelectionBar();
  }
}

/**
 * 打字机滚动：写字时把光标那一行保持在编辑区中部。
 *
 * 只挂在 input（内容真的改了）上，不挂光标移动 —— 点击 / 方向键 / 选中都不该
 * 把画面拽走。落到中部靠两件事配合：末尾跑道（editorRunwayPx，写进内边距）
 * 让最后一行也能滚到中部，舒适带判定（typewriterTargetTop）只在光标越过
 * 「锚点 + 一行」时才滚，因此翻回前文改字时画面完全不动。
 */
async function applyTypewriterScroll() {
  const el = editorRef.value;
  if (!el) return;
  /* 内容变了 → 跑道要按新的可视高度 / 行高重算（字号、分栏宽度都可能变）。
     跑道是通过 --ed-runway 写进 padding-bottom 的，值有变化时必须等它落到 DOM
     再量：否则这一轮拿到的还是「没有跑道」的 scrollHeight，正文末尾那几行
     推不到中部。 */
  const before = editorRunwayPx.value;
  refreshEditorRunway();
  if (editorRunwayPx.value !== before) await nextTick();

  const next = typewriterTargetTop(el);
  if (next === null) return;
  el.scrollTop = next;
  /* 「内容变化后保持原滚动位置」那条 post watch 会在同一批 nextTick 里把
     scrollTop 复位到它记下的旧值，把本次滚动抹掉。这里同步更新它的基准，
     那次复位便成了空操作 —— 两个机制各司其职：它防重排跳动，这里做打字机跟随。 */
  lastEditorScrollPos = { top: next, left: el.scrollLeft };
  /* scrollTop 的程序化赋值同样派发 scroll，进度 / 覆盖层 / 预览同步都会跟上；
     这里不重复调用，避免同一帧做两次同样的工作。 */
}

/** 输入事件：先记光标，再按需做打字机滚动（等 DOM 完成本次输入的重排）。 */
function onEditorInput() {
  updateCaretPos();
  void nextTick(applyTypewriterScroll);
}

/** Real signal counts behind the 洞察 profile — no padding. */
const habitBadgeCount = computed(
  () =>
    insightStore.habits.phrasing.length +
    insightStore.habits.paragraph.length +
    insightStore.habits.editing.length,
);

const habitBadgeTitle = computed(() => {
  const a = insightStore.analysis;
  if (habitBadgeCount.value === 0) return "尚未提炼出写作习惯（前往「洞察」重新分析）";
  return `已提炼 ${habitBadgeCount.value} 条写作习惯 · 基于 ${a.sentenceCount} 句 / ${a.sampleCount} 份文本`;
});

const splitRatioStyle = computed(() => {
  if (!showEditor.value || !showPreview.value) return {};
  return {
    "--split-ratio": splitRatio.value + "%",
  };
});

function wrapSelection(before: string, after = before, placeholder = "文本") {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = markdown.value.slice(start, end) || placeholder;
  const replacement = before + selected + after;
  markdown.value =
    markdown.value.slice(0, start) + replacement + markdown.value.slice(end);
  nextTick(() => {
    el.focus();
    el.setSelectionRange(start + before.length, start + before.length + selected.length);
  });
}

/* ---------------- 行级 markdown 语法：标题 / 列表 / 引用 ----------------

   原实现是 prefixLine("## ")：不认已有标记、不认多行选区，连点两次就变成
   `## ## 标题`，标题也只能是 H2、列表也只能是无序。这里换成「先剥离旧标记、
   再套上新标记」的整块处理：
   - 标题 H1–H5、无序列表、有序列表、引用共用同一套流程；
   - 选区跨多行时逐行处理，有序列表自动重排序号；
   - 整块已经是同一档标记时再点一次即取消（与主流编辑器一致）。 */

type LineStyle = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bullet" | "ordered" | "quote";

const HEADING_RE = /^(#{1,6})[ \t]+/;
const BULLET_RE = /^([-*+])[ \t]+/;
const ORDERED_RE = /^(\d{1,9})([.)])[ \t]+/;
const QUOTE_RE = /^>[ \t]?/;

/** 该行当前挂的是哪一档行级标记（没有则 null）。 */
function lineStyleOf(line: string): LineStyle | null {
  const body = line.replace(/^[ \t]*/, "");
  const heading = HEADING_RE.exec(body);
  if (heading) return `h${Math.min(6, heading[1].length)}` as LineStyle;
  if (ORDERED_RE.test(body)) return "ordered";
  if (BULLET_RE.test(body)) return "bullet";
  if (QUOTE_RE.test(body)) return "quote";
  return null;
}

/** 拆出缩进与「剥掉行级标记后」的正文。 */
function stripLineStyle(line: string): { indent: string; body: string } {
  const indent = /^[ \t]*/.exec(line)?.[0] ?? "";
  let body = line.slice(indent.length);
  /* 引用可以套在别的标记外面（`> - item`），先剥掉这一层。 */
  body = body.replace(QUOTE_RE, "");
  /* 标题 / 有序 / 无序三者互斥，只剥一个 —— 多剥会把 `## 1. 引言` 的 "1. " 也吃掉。 */
  if (HEADING_RE.test(body)) body = body.replace(HEADING_RE, "");
  else if (ORDERED_RE.test(body)) body = body.replace(ORDERED_RE, "");
  else if (BULLET_RE.test(body)) body = body.replace(BULLET_RE, "");
  return { indent, body };
}

function lineStylePrefix(style: LineStyle, ordinal: number): string {
  if (style === "bullet") return "- ";
  if (style === "ordered") return `${ordinal}. `;
  if (style === "quote") return "> ";
  return "#".repeat(Number(style.slice(1))) + " ";
}

function applyLineStyle(style: LineStyle) {
  const el = editorRef.value;
  if (!el) return;

  const text = markdown.value;
  const selStart = el.selectionStart ?? 0;
  const selEnd = el.selectionEnd ?? selStart;
  const multi = selEnd > selStart;

  /* 把选区撑到它覆盖的完整行范围。选区正好停在行首（连尾部换行一起选中）时
     不把下一行算进来，与主流编辑器的行选行为一致。 */
  const scanEnd = multi && text[selEnd - 1] === "\n" ? selEnd - 1 : selEnd;
  const blockStart = text.lastIndexOf("\n", selStart - 1) + 1;
  const nextBreak = text.indexOf("\n", scanEnd);
  const blockEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(blockStart, blockEnd).split("\n");

  /* 有内容的行是否已经全是这一档 → 是则本次点击表示「取消」。 */
  const filled = lines.filter((line) => line.trim().length > 0);
  const toggleOff =
    filled.length > 0 && filled.every((line) => lineStyleOf(line) === style);

  let ordinal = 1;
  const out = lines.map((line) => {
    const blank = line.trim().length === 0;
    /* 多行选区里的空行原样留着，别给空行也挂上标记。 */
    if (blank && lines.length > 1) return line;
    const { indent, body } = stripLineStyle(line);
    if (toggleOff) return indent + body;
    return indent + lineStylePrefix(style, ordinal++) + body;
  });

  const replaced = out.join("\n");
  if (replaced === text.slice(blockStart, blockEnd)) return;

  markdown.value = text.slice(0, blockStart) + replaced + text.slice(blockEnd);

  /* 光标态：跟着首行标记的长度变化平移；选中态：整块保持选中。 */
  const firstDelta = out[0].length - lines[0].length;
  const nextStart = multi ? blockStart : Math.max(blockStart, selStart + firstDelta);
  const nextEnd = multi ? blockStart + replaced.length : nextStart;
  nextTick(() => {
    el.focus();
    const max = el.value.length;
    el.setSelectionRange(Math.min(nextStart, max), Math.min(nextEnd, max));
    updateCaretPos();
  });
}

/* ---------------- 工具栏下拉菜单（标题档位 / 列表类型） ----------------
   工具栏本身是横向滚动容器（overflow 裁剪），菜单挂在容器内会被切掉，
   因此 Teleport 到 body 用视口坐标定位，与「选中浮现工具栏」同一套做法。 */

const headingMenuOpen = ref(false);
const listMenuOpen = ref(false);
const typographyPanelOpen = ref(false);
const toolMenuPos = ref({ top: 0, left: 0 });
const typographyMenuPos = ref({ top: 0, left: 0 });
const headingBtnRef = ref<HTMLElement | null>(null);
const listBtnRef = ref<HTMLElement | null>(null);
const typographyBtnRef = ref<HTMLElement | null>(null);
const toolMenuRef = ref<HTMLElement | null>(null);
const typographyPanelRef = ref<HTMLElement | null>(null);

const HEADING_LEVELS: { style: LineStyle; label: string; icon: Component }[] = [
  { style: "h1", label: "标题 1", icon: Heading1 },
  { style: "h2", label: "标题 2", icon: Heading2 },
  { style: "h3", label: "标题 3", icon: Heading3 },
  { style: "h4", label: "标题 4", icon: Heading4 },
  { style: "h5", label: "标题 5", icon: Heading5 },
];

/** 光标所在行当前的行级标记，用于给菜单项打勾。 */
const currentLineStyle = computed<LineStyle | null>(() => {
  const text = markdown.value;
  const at = Math.min(caretPos.value, text.length);
  const from = text.lastIndexOf("\n", at - 1) + 1;
  const to = text.indexOf("\n", from);
  return lineStyleOf(text.slice(from, to === -1 ? text.length : to));
});

function closeToolMenus() {
  headingMenuOpen.value = false;
  listMenuOpen.value = false;
  typographyPanelOpen.value = false;
}

/** 菜单贴在按钮正下方；触到视口边缘时内收，保证整块完整可见。 */
function clampToolMenu() {
  const menu = toolMenuRef.value;
  if (!menu) return;
  const margin = 8;
  const w = menu.offsetWidth || 150;
  const h = menu.offsetHeight || 180;
  let { top, left } = toolMenuPos.value;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  if (top + h > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - h - margin);
  }
  toolMenuPos.value = { top, left };
}

function clampTypographyPanel() {
  const panel = typographyPanelRef.value;
  if (!panel) return;
  const margin = 8;
  const w = panel.offsetWidth || 250;
  const h = panel.offsetHeight || 260;
  let { top, left } = typographyMenuPos.value;
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
  if (top + h > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - h - margin);
  }
  typographyMenuPos.value = { top, left };
}

function toggleTypographyPanel() {
  const wasOpen = typographyPanelOpen.value;
  closeToolMenus();
  if (wasOpen) return;
  const btn = typographyBtnRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  typographyMenuPos.value = { top: rect.bottom + 6, left: rect.left };
  typographyPanelOpen.value = true;
  nextTick(clampTypographyPanel);
}

function toggleToolMenu(which: "heading" | "list") {
  const wasOpen = which === "heading" ? headingMenuOpen.value : listMenuOpen.value;
  closeToolMenus();
  if (wasOpen) return;
  const btn = which === "heading" ? headingBtnRef.value : listBtnRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  toolMenuPos.value = { top: rect.bottom + 6, left: rect.left };
  if (which === "heading") headingMenuOpen.value = true;
  else listMenuOpen.value = true;
  nextTick(clampToolMenu);
}

/** 菜单项落地：先关菜单再改正文，一次点击对应一条撤销历史。 */
function pickLineStyle(style: LineStyle) {
  closeToolMenus();
  applyLineStyle(style);
}

function insertCodeBlock() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = markdown.value.slice(start, end);
  const snippet = selected
    ? `\`\`\`\n${selected}\n\`\`\``
    : "```ts\n// write code here\n```";
  markdown.value =
    markdown.value.slice(0, start) + snippet + markdown.value.slice(end);
  nextTick(() => {
    el.focus();
    el.setSelectionRange(start + 3, start + 3);
  });
}

function insertLink() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  const selected = markdown.value.slice(start, end);
  const snippet = selected ? `[${selected}](https://)` : "[链接文字](https://)";
  markdown.value =
    markdown.value.slice(0, start) + snippet + markdown.value.slice(end);
  nextTick(() => {
    el.focus();
    el.setSelectionRange(start + 1, start + 1 + (selected || "链接文字").length);
  });
}

/**
 * 编辑区 → 预览区的滚动同步。
 *
 * 两侧都带末尾跑道，所以要分段映射：正文段映到正文段、跑道段映到跑道段
 * （见 typewriterScroll.mapScrollTop）。只按总余量或只按正文余量算都会错位 ——
 * 前者让两侧正文位置整体偏开（跑道占比不同），后者让编辑区滚进跑道后预览卡在
 * 正文末尾不动，正是「写到最后一行时两边对不上」的成因。
 */
function syncFromEditor() {
  if (scrollSyncMode.value !== "sync") return;
  const editor = editorRef.value;
  const preview = previewRef.value;
  if (!editor || !preview || scrollSyncing) return;
  scrollSyncing = true;
  preview.scrollTop = mapScrollTop(editor.scrollTop, editorSpan(), previewSpan());
  scrollSyncing = false;
}

/** 预览滚动：更新阅读进度，并按需同步编辑器。 */
function onPreviewScroll() {
  updatePreviewProgress();
  syncFromPreview();
  scheduleReadingPositionSave();
}

function syncFromPreview() {
  if (scrollSyncMode.value !== "sync") return;
  const editor = editorRef.value;
  const preview = previewRef.value;
  if (!editor || !preview || scrollSyncing) return;
  scrollSyncing = true;
  editor.scrollTop = mapScrollTop(preview.scrollTop, previewSpan(), editorSpan());
  scrollSyncing = false;
}

/**
 * 阅读圆环目录跳转的统一协调。
 *
 * 「同步滚动」开启时，圆环会把本窗格平滑滚到目标标题，随后父级这里需要：
 *  1. 把另一侧窗格直接落到「同一比例」的最终位置（与比例同步的静止态一致）；
 *  2. 在目标窗格的平滑滚动结束前持续抑制反向比例同步。
 * 否则目标窗格每滚动一帧，反向同步就把它的 scrollTop 设回当前比例位置，
 * 直接中止浏览器正在进行的平滑滚动 —— 表现就是“点目录根本不跳转”。
 */
function onRingJump(source: "editor" | "preview", payload: { index: number; top: number }) {
  if (scrollSyncMode.value !== "sync") return;
  const editor = editorRef.value;
  const preview = previewRef.value;
  if (!editor || !preview) return;

  const sourceEl = source === "editor" ? editor : preview;
  const otherEl = source === "editor" ? preview : editor;
  /* 两侧都扣掉各自的末尾跑道并分段映射，与静止态的比例同步同一把尺子。 */
  const fromSpan = source === "editor" ? editorSpan() : previewSpan();
  const toSpan = source === "editor" ? previewSpan() : editorSpan();
  if (fromSpan.contentMax + fromSpan.runway <= 0) return;
  if (toSpan.contentMax + toSpan.runway <= 0) return;

  scrollSyncing = true;
  otherEl.scrollTop = mapScrollTop(payload.top, fromSpan, toSpan);

  const release = () => {
    if (ringJumpTimer !== null) {
      window.clearTimeout(ringJumpTimer);
      ringJumpTimer = null;
    }
    scrollSyncing = false;
  };
  /* scrollend 在平滑动画真正结束时触发（宽松浏览器不支持则走超时兜底）。 */
  sourceEl.addEventListener("scrollend", release, { once: true });
  ringJumpTimer = window.setTimeout(release, 600);
}

/* ---- AI 写作辅助（真实调用，不再插入示例文本） ---- */

const aiBusy = ref(false);

/**
 * AI 动作期间给左侧文档条目挂上「正在被 AI 改动」标记（边框循环动效）。
 * 记下开始时的文档 id，中途切换文档也能正确销账。
 */
async function withAiDocMark<T>(run: () => Promise<T>): Promise<T> {
  const markedId = props.embedded ? null : fileIdForSlot.value;
  beginAiDocEdit(markedId);
  try {
    return await run();
  } finally {
    endAiDocEdit(markedId);
  }
}

function requireApiKey(): boolean {
  if (aiSettings.apiKey.trim()) return true;
  showToast("未配置 API", "请先在「设置 → AI接口设置」中填写 API key", "edit");
  return false;
}

/** Shared single-shot call that carries the user's real habit profile. */
async function callWritingAgent(systemExtra: string, userContent: string): Promise<string | null> {
  if (!requireApiKey()) return null;

  const habitCtx = buildInsightContext();
  const systemPrompt = [
    aiSettings.writerPrompt.trim() || WRITER_AGENT_PROMPT,
    systemExtra,
    habitCtx,
  ]
    .filter(Boolean)
    .join("\n\n");

  aiBusy.value = true;
  try {
    /* 请求全程给左侧文档条目挂上「AI 正在改这一篇」的循环边框。 */
    const result = await withAiDocMark(() =>
      runAgent({
        provider: aiSettings.provider,
        apiType: aiSettings.apiType,
        apiKey: aiSettings.apiKey,
        url: aiSettings.url,
        model: aiSettings.model,
        systemPrompt,
        messages: [{ role: "user", content: userContent }],
        stream: false,
        maxRounds: 1,
        temperature: 0.8,
      }),
    );
    /* 编辑器内的润色 / 续写 / 依习惯生成都归到 editor 桶。 */
    recordTokens("editor", result.tokens);
    const text = result.text.trim();
    return text || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showToast("AI 调用失败", message.slice(0, 120), "edit");
    return null;
  } finally {
    aiBusy.value = false;
  }
}

async function polishSelection() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === end) {
    showToast("请先选中要润色的文本", "在编辑器中选中一段文字后再点击润色", "edit");
    return;
  }

  const selected = markdown.value.slice(start, end);
  showToast("正在润色…", "已按你的写作习惯发起请求", "habit");

  const polished = await callWritingAgent(
    [
      "本次任务：润色选段。",
      "机制约束：",
      "1. 仅润色用户提供的片段，保持原意与长度量级（不大幅扩写或缩写）。",
      "2. 结合用户的写作习惯画像与个人语气偏好进行精修，使其更生动凝练。",
      "3. 只输出润色后的正文，不要添加任何解释或说明。",
    ].join("\n"),
    selected,
  );
  if (!polished) return;

  markdown.value = markdown.value.slice(0, start) + polished + markdown.value.slice(end);
  /* Real before/after pair — this is what 修改记忆 is built from. */
  trackModification(selected, polished, undefined, { source: "ai" });
  showToast("润色完成", "已写入编辑器，并记入修改记忆", "edit");
}

async function continueWriting() {
  const tail = markdown.value.slice(-1200);
  if (!tail.trim()) {
    showToast("文档为空", "先写下开头，AI 才能依据你的习惯续写", "edit");
    return;
  }

  const activeToggles = insightStore.habits.toggles.filter((t) => t.on).map((t) => t.label);
  showToast("正在续写…", activeToggles.length > 0 ? `依据：${activeToggles.join("、")}` : "已发起请求", "habit");

  const continuation = await callWritingAgent(
    [
      "本次任务：紧接已有正文续写下一段。",
      "机制约束：",
      "1. 必须无缝衔接上文的情节发展、人物语气和叙事视角。",
      "2. 字数严格控制在 250~450 字以内，拒绝冗长和水文。",
      "3. 充分应用用户的写作习惯画像（遣词、修辞与句式偏好）。",
      "4. 只输出续写内容本身，不要复述原文，不要任何解释说明。",
    ].join("\n"),
    `已有正文（末尾片段）：\n\n${tail}`,
  );
  if (!continuation) return;

  markdown.value += (markdown.value.endsWith("\n") ? "" : "\n\n") + continuation;
  showToast("续写完成", "已按你的写作习惯生成下一段", "habit");
}

function acceptSuggestion(id: string) {
  dismissSuggestion(id);
  showToast("已采纳建议", "该习惯已记录到你的风格画像中", "habit");
}

function rejectSuggestion(id: string) {
  dismissSuggestion(id);
}

/* ---- 右键菜单 ---- */
const ctxMenu = ref<{ x: number; y: number; show: boolean }>({ x: 0, y: 0, show: false });

function onEditorContextMenu(event: MouseEvent) {
  event.preventDefault();
  /* 右键菜单与选中浮现工具栏不能同时在场：两块浮层叠在一起会让用户不知道该点哪个。
     浮现工具栏立刻退场，右键菜单接手。 */
  showSelectionToolbar.value = false;
  selectionMenuOpen.value = false;
  clearSelectionTimer();
  ctxMenu.value = { x: event.clientX, y: event.clientY, show: true };
}

function closeContextMenu() {
  ctxMenu.value = { ...ctxMenu.value, show: false };
}

function ctxMenuAction(action: string) {
  closeContextMenu();
  /* 修订与批注是纯本地操作，不受 AI 忙碌状态影响。 */
  if (action === "revise") {
    revisionFormRef.value?.open();
    return;
  }  if (aiBusy.value) {
    showToast("AI 正在处理", "请等待当前请求完成", "edit");
    return;
  }
  if (action === "polish") void polishSelection();
  else if (action === "continue") void continueWriting();
  else if (action === "habit-gen") void generateFromHabits();
}

/* ---- 修订与批注（组件 RevisionAnnotation 自带表单与 Ctrl+Shift+M） ---- */

const revisionFormRef = ref<{ open: () => void; close: () => void } | null>(null);

/** 全局开关：关掉后右键菜单、快捷键、编辑区着色与预览合成一并停用。 */
const revisionEnabled = computed(() => !props.embedded && aiSettings.revisionAnnotationEnabled);

/** 表单呼出期间收起选中浮动工具栏，避免压在弹窗上。 */
function onRevisionOpened() {
  showSelectionToolbar.value = false;
  selectionMenuOpen.value = false;
  clearSelectionTimer();
}

/** 预览区是否正显示合成后的修订内容（用于给预览标题加一枚提示）。 */
const revisionActive = computed(
  () => revisionEnabled.value && hasVisibleRevision(fileIdForSlot.value),
);

/* ---- 定位：把编辑区与预览区一起滚到某条图层的原文处 ---- */

/** 刚被定位的图层 id，用于给它的着色区间加一段短暂的强调。 */
const locatedRevisionId = ref<string | null>(null);
let locateFlashTimer: number | null = null;

function flashLocated(id: string) {
  locatedRevisionId.value = id;
  if (locateFlashTimer !== null) window.clearTimeout(locateFlashTimer);
  locateFlashTimer = window.setTimeout(() => {
    locateFlashTimer = null;
    locatedRevisionId.value = null;
  }, 2600);
}

/**
 * 预览区要高亮的那段文字。
 *
 * 预览显示的是合成结果：小眼睛开着且有修订内容时看到的是修订后的文字，
 * 否则仍是原文 —— 高亮必须跟着实际显示的那一份走。
 */
const locatedPreviewText = computed(() => {
  const id = locatedRevisionId.value;
  if (!id || !revisionEnabled.value) return "";
  const item = revisionStore.items.find((r) => r.id === id);
  if (!item) return "";
  const revised = item.revised.trim();
  return item.visible && revised ? item.revised : item.original;
});

/**
 * 从一段文字里取出用于反查预览 DOM 的「探针」。
 *
 * 渲染后行内标记（`**`、`` ` ``、链接语法等）已经变成标签，原文里的这些字符
 * 在 HTML 文本节点中并不存在；因此取首行中最长的一段「不含行内标记」的连续
 * 文本 —— 这一段在渲染结果里必定原样落在某个文本节点内。
 */
function previewProbeOf(text: string): string {
  const firstLine = text.split("\n").find((line) => line.trim().length > 0) ?? "";
  if (!firstLine.trim()) return "";
  const runs = firstLine
    .split(/[*_`~[\]()#>|!\\]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (runs.length === 0) return "";
  const longest = runs.reduce((a, b) => (b.length > a.length ? b : a));
  return longest.slice(0, 80);
}

/**
 * 给预览 HTML 里的目标文字套上高亮标记。
 *
 * 只处理标签之间的纯文本（与查找高亮同一套做法），命中首个探针即停。
 * 探针跨标签或被行内标记打断时不做处理，定位退回按滚动比例同步。
 */
function injectPreviewLocateMark(html: string, target: string): string {
  const probe = escapeHtml(previewProbeOf(target));
  if (!probe) return html;

  let done = false;
  return html.replace(/>([^<]+)</g, (whole, text: string) => {
    if (done) return whole;
    const at = text.indexOf(probe);
    if (at < 0) return whole;
    done = true;
    const head = text.slice(0, at);
    const tail = text.slice(at + probe.length);
    return `>${head}<mark class="rev-preview-located">${probe}</mark>${tail}<`;
  });
}

/**
 * 把预览区滚到高亮标记处。返回是否命中。
 *
 * 用 getBoundingClientRect 的差值算滚动量：标记的 offsetParent 是纸面卡片而不是
 * 滚动容器，直接用 offsetTop 会漏掉卡片自身的上留白。
 */
function scrollPreviewToLocateMark(): boolean {
  const preview = previewRef.value;
  if (!preview) return false;
  const hit = preview.querySelector<HTMLElement>("mark.rev-preview-located");
  if (!hit) return false;
  const pr = preview.getBoundingClientRect();
  const hr = hit.getBoundingClientRect();
  preview.scrollTop += hr.top - pr.top - preview.clientHeight / 3;
  updatePreviewProgress();
  return true;
}

/**
 * 定位到某条图层的原文。
 *
 * 编辑区：量出该偏移所在行的像素顶部，滚到视区上三分之一处并选中原文。
 * 预览区：优先按注入的高亮标记精确滚动并让那段文字亮起来；探针没能命中时
 * 退回按编辑区滚动比例同步。两侧都做，所以无论当前是 markdown / 预览 /
 * 双栏，看到的都是同一处。
 */
function locateRevision(id: string) {
  const hit = revisionRangeOf(id);
  if (!hit) {
    showToast("未能定位原文", "正文中已找不到这段原文，请核对后重新修订", "edit");
    return;
  }
  if (hit.fileId !== fileIdForSlot.value) return;

  /* markdown 编辑区被折叠时先展开，否则用户看不到定位结果。 */
  if (props.zenMode === "off" && !showEditor.value) showEditor.value = true;

  /* 先点亮：预览高亮标记是随 locatedPreviewText 注入的，得等这一帧渲染完
     才能在 DOM 里查到它。 */
  flashLocated(id);

  nextTick(() => {
    const el = editorRef.value;
    if (el) {
      const [top] = measureTextareaTops(el, [hit.start]);
      const target = Math.max(0, top - el.clientHeight / 3);
      el.scrollTop = Math.min(target, Math.max(0, el.scrollHeight - el.clientHeight));
      el.focus();
      el.setSelectionRange(hit.start, hit.end);
      updateEditorProgress();
      /* 覆盖层是手动同步偏移的，这里补一次，否则高亮会停在旧的滚动位置。 */
      const hl = highlightRef.value;
      if (hl) hl.style.transform = `translate(${-el.scrollLeft}px, ${-el.scrollTop}px)`;
    }
    /* 再等一帧：v-html 的更新与本次 DOM 查询不在同一批次。 */
    nextTick(() => {
      if (!scrollPreviewToLocateMark()) syncPreviewToEditor();
    });
  });
}

/**
 * 把预览区滚到与编辑区相同的相对位置。
 *
 * 「同步滚动」关闭时 syncFromEditor 会直接返回，但定位是用户的明确指令，
 * 两边都应该跟上，所以这里单独做一次换算（同样走分段映射，含末尾跑道）。
 */
function syncPreviewToEditor() {
  const editor = editorRef.value;
  const preview = previewRef.value;
  if (!editor || !preview) return;
  preview.scrollTop = mapScrollTop(editor.scrollTop, editorSpan(), previewSpan());
  updatePreviewProgress();
}

/**
 * 依习惯生成: asks the model to write a fresh paragraph purely from the
 * statistically-derived habit profile. Refuses when no profile exists yet.
 */
async function generateFromHabits() {
  if (!insightStore.analysis.hasData) {
    showToast("尚无写作习惯数据", "请先在「洞察」中生成风格画像（需要一定量的真实文本）", "edit");
    return;
  }
  const tail = markdown.value.slice(-800);
  showToast("正在依习惯生成…", `样本量 ${insightStore.analysis.sentenceCount} 句`, "habit");

  const text = await callWritingAgent(
    [
      "本次任务：依习惯生成。",
      "机制约束：",
      "1. 必须紧密结合上文的上下文语境、角色与情节，自然顺畅地续写/生成下一段正文。",
      "2. 字数严格控制在 250~450 字以内，切勿过度扩写或冗长罗嗦。",
      "3. 深度融入用户的写作习惯画像（句式节奏、修辞与结构偏好），像用户本人一样写作。",
      "4. 绝不输出任何统计分析、大纲或说明文字，只输出纯正文内容。",
    ].join("\n"),
    tail.trim() ? `已有正文（末尾片段，请在此基础上依习惯无缝续写）：\n\n${tail}` : "请自由起一段符合该习惯画像的开头。",
  );
  if (!text) return;

  markdown.value += (markdown.value ? "\n\n" : "") + text;
  showToast("已依习惯生成", "内容已追加到文档末尾", "habit");
}

/* ---------------- 选中段落/文字浮现工具栏 (剪切、复制、粘贴、全选、删除) ---------------- */

const showSelectionToolbar = ref(false);
const selectionBarRef = ref<HTMLDivElement | null>(null);
const editorWrapRef = ref<HTMLDivElement | null>(null);
const selectionBarPos = ref({ top: 12, left: 100 });
/* 编辑器过窄时切换为紧凑模式，保持横向单排、文字完整呈现。 */
const selectionBarCompact = ref(false);
/* 选中时鼠标所在的视口坐标，用于让工具栏跟随光标出现在选中文字上方。 */
const selectionMousePos = ref<{ x: number; y: number } | null>(null);
/* 为 true 时按鼠标位置锚定（鼠标选中），否则（键盘选区/滚动后）按选中文字锚定。 */
let anchorByMouse = false;
/* 本次按下是否从编辑区发起（保证只在编辑区拖拽结束时才采集光标位置，
   避免点击工具栏按钮等其他 mouseup 误刷新锚点）。 */
let selectionDragFromEditor = false;
let selectionTimer: number | null = null;
/* 最近一次写入过 lastSelStart/End 的选区范围。用于识别「真正的新选区」：
   点击浮动工具栏/菜单的按钮时，浏览器会对文本域额外派发一次 select 事件，
   但其选区范围与当前完全一致（并非新选区）。若不区分，该事件会把刚打开的
   「更多」菜单立即关闭，表现为点击后闪现。 */
let lastSelStart = -1;
let lastSelEnd = -1;

function clearSelectionTimer() {
  if (selectionTimer !== null) {
    window.clearTimeout(selectionTimer);
    selectionTimer = null;
  }
}

function resetSelectionTimer() {
  clearSelectionTimer();
  selectionTimer = window.setTimeout(() => {
    showSelectionToolbar.value = false;
    selectionMenuOpen.value = false;
  }, 4000);
}

/**
 * 使用「镜像 div」精确测量 textarea 中某个光标位置所在行的像素坐标，
 * 让它能真实反映“选中文字的起始行顶部”，从而把工具栏定位在该行上方。
 */
function getCaretCoords(el: HTMLTextAreaElement, position: number): { top: number; left: number } | null {
  if (typeof el.selectionStart !== "number") return null;

  const styles = window.getComputedStyle(el);
  const div = document.createElement("div");
  /* 必须写 kebab-case：getPropertyValue 按规范只认 CSS 属性名，传 camelCase
     一律返回空串——镜像就会用浏览器默认字体去量，换行点逐行错开、长文里误差
     一路累积，工具栏被锚到完全不相干的位置。 */
  const copyProps: string[] = [
    "font-family", "font-size", "font-weight", "font-style", "font-variant",
    "font-stretch", "letter-spacing", "word-spacing", "text-indent",
    "text-transform", "text-rendering", "tab-size", "white-space",
    "word-break", "overflow-wrap", "word-wrap", "line-break", "hyphens",
    "direction", "writing-mode",
  ];
  for (const p of copyProps) {
    const v = styles.getPropertyValue(p);
    if (v) div.style.setProperty(p, v);
  }
  const fontSize = parseFloat(styles.fontSize) || 16;
  div.style.lineHeight = styles.lineHeight === "normal" ? `${fontSize * 1.6}px` : styles.lineHeight;
  if (!div.style.whiteSpace) div.style.whiteSpace = "pre-wrap";

  const paddingTop = parseFloat(styles.paddingTop) || 0;
  const paddingRight = parseFloat(styles.paddingRight) || 0;
  const paddingBottom = parseFloat(styles.paddingBottom) || 0;
  const paddingLeft = parseFloat(styles.paddingLeft) || 0;

  /* 关键修正：el.clientWidth 已不含垂直滚动条，直接以它作为镜像 div 的
     border-box 宽度即可让内容宽与真实文本区完全一致。若再减一次「滚动条宽」
     （offsetWidth - clientWidth）就重复扣减，会让镜像比真实文本区更窄，
     换行点逐行偏移、offsetTop 累积漂移——长文选中中部/底部时工具栏被
     错误锚定到顶部。 */
  div.style.width = `${Math.max(100, el.clientWidth)}px`;

  div.style.position = "absolute";
  div.style.visibility = "hidden";
  div.style.pointerEvents = "none";
  div.style.boxSizing = "border-box";
  div.style.overflow = "hidden";
  div.style.padding = `${paddingTop}px ${paddingRight}px ${paddingBottom}px ${paddingLeft}px`;
  div.style.border = "0 solid transparent";
  div.style.top = "0";
  div.style.left = "0";

  div.textContent = el.value.slice(0, position);

  const span = document.createElement("span");
  /* 零宽占位符保证 offsetTop/offsetLeft 反映“插入点”所在行。 */
  span.textContent = "\u200b";
  div.appendChild(span);
  /* 尾部补上剩余正文：只量前半段时最后一行可能因缺少后文而少算换行，
     补全后镜像的行结构与真实文本区完全一致。 */
  div.appendChild(document.createTextNode(`${el.value.slice(position)}\u200b`));

  document.body.appendChild(div);
  /* span.offsetTop/offsetLeft 已含镜像 div 的 padding，这里返回的是相对
     textarea 内容原点的坐标（未计入滚动），换算到视口时再减 scrollTop/Left。 */
  let top = span.offsetTop;
  const left = span.offsetLeft;
  /* 与 measureTextareaTops 同源的整篇标定：镜像总高应等于真实可滚动总高，
     不等就按比例把这一行的位置缩放回去，避免字体回退等残差被行数放大。
     只在真的溢出时才做：没溢出时 scrollHeight 等于盒高而非内容高。 */
  const overflowing = el.scrollHeight - el.clientHeight > 1;
  const mirrorBody = div.offsetHeight - paddingTop - paddingBottom;
  const realBody = el.scrollHeight - paddingTop - paddingBottom;
  document.body.removeChild(div);
  if (overflowing && mirrorBody > 1 && realBody > 1) {
    const ratio = realBody / mirrorBody;
    if (Math.abs(ratio - 1) > 0.005 && ratio > 0.5 && ratio < 2) {
      top = paddingTop + (top - paddingTop) * ratio;
    }
  }
  return { top, left };
}

/**
 * 由文本区内的视口坐标估算「最近的光标插入点」。行方向借助 getCaretCoords 的
 * top 做二分（top 随字符序号单调不减），列方向在命中行内按 left 做二分。
 * 供「AI 回复拖入编辑区」使用：松开的位置落在哪，内容就插在哪。
 */
function textOffsetFromPoint(el: HTMLTextAreaElement, x: number, y: number): number {
  const total = el.value.length;
  const rect = el.getBoundingClientRect();
  const contentX = x - rect.left + el.scrollLeft;
  const contentY = y - rect.top + el.scrollTop;

  const coords = (pos: number) => getCaretCoords(el, Math.max(0, Math.min(total, pos)));
  const topAt = (pos: number) => coords(pos)?.top ?? 0;
  const leftAt = (pos: number) => coords(pos)?.left ?? 0;

  /* 命中行尾部：最后一个「top 不高于 contentY」的字符位。 */
  let lo = 0;
  let hi = total;
  if (topAt(0) > contentY) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (topAt(mid) <= contentY) lo = mid;
    else hi = mid - 1;
  }
  const rowTail = lo;

  /* 命中行起点：第一个回到该行顶的字符位（排除自动换行的前几行）。 */
  const rowTop = topAt(rowTail);
  let rLo = 0;
  let rHi = rowTail;
  while (rLo < rHi) {
    const mid = (rLo + rHi) >> 1;
    if (topAt(mid) < rowTop - 0.5) rLo = mid + 1;
    else rHi = mid;
  }
  const rowStart = rLo;

  /* 行内列位置：找第一个 left 不低于 contentX 的字符位，再与它前一位比距离。 */
  let cLo = rowStart;
  let cHi = rowTail;
  if (leftAt(cHi) <= contentX) return cHi;
  while (cLo < cHi) {
    const mid = (cLo + cHi) >> 1;
    if (leftAt(mid) < contentX) cLo = mid + 1;
    else cHi = mid;
  }
  const after = cLo;
  const dAfter = Math.abs(leftAt(after) - contentX);
  const dBefore = after > rowStart ? Math.abs(leftAt(after - 1) - contentX) : dAfter;
  return dBefore < dAfter ? after - 1 : after;
}

/* ---- 文档界面：AI 回复拖入编辑区（与写作画布的卡片拖拽完全解耦） ----
   只在真正的文档界面注册落点；嵌入式（画布卡片 / 拼接弹窗）不参与。 */

const docDropTarget: DocEditorDropTarget | null = {
  element: () => editorRef.value,
  drop: (content, x, y) => insertAtDocDropPoint(content, x, y),
  docId: () => fileIdForSlot.value,
  /* 块拖拽 / 跨分栏块引用的落点：把整块内容插入到指定行。 */
  dropBlock: (content, lineIndex) => {
    const lines = markdown.value.split("\n");
    const idx = Math.max(0, Math.min(lines.length, lineIndex));
    lines.splice(idx, 0, content);
    markdown.value = lines.join("\n");
    pulseAiDocEdit(fileIdForSlot.value);
    return true;
  },
};

/** 把拖入的内容插到松开位置附近的光标处，并把焦点 / 光标归位。 */
function insertAtDocDropPoint(content: string, x: number, y: number): boolean {
  const el = editorRef.value;
  if (!el) return false;
  const offset = textOffsetFromPoint(el, x, y);
  markdown.value =
    markdown.value.slice(0, offset) + content + markdown.value.slice(offset);
  nextTick(() => {
    if (!el) return;
    el.focus();
    const caret = Math.min(offset + content.length, el.value.length);
    el.setSelectionRange(caret, caret);
    caretPos.value = caret;
  });
  pulseAiDocEdit(fileIdForSlot.value);
  return true;
}

/** 拖拽悬浮到本编辑区上时的高亮（松开即原地插入）。 */
const docDragHover = ref(false);
watch(
  () => [docEditorDrag.isDragging, docEditorDrag.pointer] as const,
  () => {
    const pointer = docEditorDrag.pointer;
    docDragHover.value =
      !props.embedded &&
      docEditorDrag.isDragging &&
      pointer !== null &&
      docEditorTargetAt(pointer.x, pointer.y) === docDropTarget;
  },
  { immediate: true },
);

/** 依据“选中文字 + 鼠标位置”在视口中定位工具栏：跟随光标水平位置、停在选中文字
    上方；撞到上/下边框自动翻转方向，撞到左/右边框向内收拢，始终完整单排显示、
    绝不被截断或竖排换行。工具栏随 <Teleport> 渲染到 body，故用视口坐标。 */
function positionSelectionBar() {
  const el = editorRef.value;
  const bar = selectionBarRef.value;
  if (!el || !bar) return;

  const start = Math.min(el.selectionStart, el.selectionEnd);
  const end = Math.max(el.selectionStart, el.selectionEnd);
  const elRect = el.getBoundingClientRect();
  const coordsStart = getCaretCoords(el, start);
  const coordsEnd = coordsStart && end === start ? coordsStart : getCaretCoords(el, end);

  /* 选中文字首尾两行顶部在视口中的位置（跟随滚动）。 */
  const caretTop = coordsStart ? elRect.top + coordsStart.top - el.scrollTop : elRect.top;
  const caretBottom = coordsEnd ? elRect.top + coordsEnd.top - el.scrollTop : caretTop;
  const caretLeft = coordsStart
    ? elRect.left + coordsStart.left - el.scrollLeft
    : elRect.left + el.clientWidth / 2;

  /* 锚点：鼠标选中时跟随光标（水平与垂直都取最终松开位置），让工具栏
     出现在用户视线所在的中间/底部，而不是被钳到整段选中的起始行上方——
     之前的 min(mouseY, caretTop) 会把中部/底部的选区错误钉回顶部。
     键盘选区/滚动后回退为跟随选中文字顶部。 */
  let anchorX = caretLeft;
  let anchorY = Math.min(caretTop, caretBottom);
  if (anchorByMouse && selectionMousePos.value) {
    anchorX = selectionMousePos.value.x;
    anchorY = selectionMousePos.value.y;
  }

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const barW = bar.offsetWidth || 320;
  const barH = bar.offsetHeight || 44;
  const gap = 8;
  const margin = 6;

  /* 垂直：优先“上方”，空间不足则翻转到“下方”，仍不足时贴边内收。 */
  let top: number;
  const above = anchorY - barH - gap;
  if (above >= margin) {
    top = above;
  } else {
    const below = Math.max(anchorY + gap, margin);
    top = below + barH <= vh - margin ? below : Math.max(margin, vh - barH - margin);
  }

  /* 水平：以光标为中心，左右越界时向内收拢，保证整条完整可见。 */
  const half = barW / 2;
  let left: number;
  if (barW + margin * 2 > vw) {
    /* 视口极窄放不下整条时：居中并切紧凑模式，仍保持单排。 */
    selectionBarCompact.value = true;
    left = vw / 2;
  } else {
    selectionBarCompact.value = false;
    left = Math.min(Math.max(anchorX, half + margin), vw - half - margin);
  }

  selectionBarPos.value = { top, left };
}

function checkTextareaSelection() {
  const el = editorRef.value;
  const start = el ? el.selectionStart : null;
  const end = el ? el.selectionEnd : null;
  /* 选区范围是否与上次一致（点击浮动工具栏/菜单按钮时，浏览器会对文本域
     额外派发一次选区未变的 select 事件）。这种情况下不能关闭刚打开的「更多」
     菜单，否则表现为点击后闪现。真正的“新选区”总是改动范围，不受影响。 */
  const unchangedSel =
    typeof start === "number" && typeof end === "number" &&
    start === lastSelStart && end === lastSelEnd;
  lastSelStart = typeof start === "number" ? start : -1;
  lastSelEnd = typeof end === "number" ? end : -1;
  /* 选区变化后收起浮层菜单，避免旧菜单随新选区复现。 */
  if (!unchangedSel) {
    selectionMenuOpen.value = false;
  }
  /* 设置面板「配置 → 选中文字浮现工具栏」关闭时不再浮现（用户可选）。
     行内 AI 浮层在场时同样不浮现，避免遮挡 Ctrl+K 输入框。
     右键菜单在场时也不浮现：右键之后 textarea 仍会派发 mouseup / select，
     走到这里就会把刚被右键收起的工具栏又弹回来，与右键菜单叠在一起。 */
  if (!aiSettings.selectionToolbarEnabled || inlineAiActive.value || ctxMenu.value.show) {
    showSelectionToolbar.value = false;
    clearSelectionTimer();
    return;
  }
  if (!el) return;
  if (start !== null && end !== null && end > start) {
    showSelectionToolbar.value = true;
    resetSelectionTimer();
    nextTick(() => positionSelectionBar());
  } else {
    showSelectionToolbar.value = false;
    clearSelectionTimer();
  }
}

/* ---- Ctrl+K 行内 AI 编辑（组件 InlineAiEdit 自带浮层与快捷键） ---- */

/**
 * 行内 AI 浮层是否在场。呼出后必须抑制选中浮现工具栏：Ctrl+K 之后 textarea 还会
 * 派发 keyup（选区未变），走 onTextareaKeyUp → checkTextareaSelection 就会把刚被
 * 收起的工具栏重新弹出来，压在输入框上。
 */
const inlineAiActive = ref(false);

/** 浮层呼出：立即清退选中浮动工具栏与「更多」菜单，并在浮层存续期间不再复现。 */
function onInlineAiOpened() {
  inlineAiActive.value = true;
  showSelectionToolbar.value = false;
  selectionMenuOpen.value = false;
  clearSelectionTimer();
  /* 行内 AI 会话期间标记该文档条目：呼出即点亮，接受 / 拒绝 / 取消后熄灭。
     记下呼出时的文档 id，中途切换文档也能正确销账。 */
  if (!props.embedded) {
    inlineAiMarkedId = fileIdForSlot.value;
    beginAiDocEdit(inlineAiMarkedId);
  }
}

/** 浮层收起：解除抑制。此时不主动复现工具栏，等用户下一次真的选中文字。 */
function onInlineAiClosed() {
  inlineAiActive.value = false;
  if (inlineAiMarkedId !== null) {
    endAiDocEdit(inlineAiMarkedId);
    inlineAiMarkedId = null;
  }
}

/** 行内 AI 会话点亮的文档 id，null 表示当前没有会话在标记。 */
let inlineAiMarkedId: string | null = null;

/** 接受 AI 输出后刷新习惯画像（修改记忆已在组件内记过一笔）。 */
function onInlineAiApplied() {
  refreshInsights(true);
}

/** 鼠标按下（编辑区）：标记本次拖拽选区的起点。 */
function onTextareaMouseDown(event: MouseEvent) {
  /* 右键只用于呼出菜单，不参与选区拖拽的锚点采集：否则随后的 mouseup 会把
     刚被右键收起的浮现工具栏又弹回来，与右键菜单叠在一起。 */
  if (event.button !== 0) return;
  selectionDragFromEditor = true;
  /* 新拖拽开始时不沿用旧的光标锚点，避免上次（可能在顶部）的鼠标位置残留。 */
  anchorByMouse = false;
  selectionMousePos.value = null;
  /* 开始新的选择即关闭浮层菜单。 */
  selectionMenuOpen.value = false;
}

/**
 * 全局 mouseup：拖拽选区的松开点经常落在编辑区之外（底部/预览区/滚动条），
 * textarea 自身的 @mouseup 采集不到，导致工具栏无法跟随到中间/底部。
 * 只要本次拖拽从编辑区发起且有实际选区，就在这里记录最终的鼠标视口坐标。
 */
function onDocumentMouseUp(event: MouseEvent) {
  if (!selectionDragFromEditor) return;
  selectionDragFromEditor = false;
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start !== null && end !== null && end > start) {
    selectionMousePos.value = { x: event.clientX, y: event.clientY };
    anchorByMouse = true;
    checkTextareaSelection();
  }
}

/** 键盘选区（Shift+方向键等）：无鼠标位置，锚点回退为跟随选中文字。 */
function onTextareaKeyUp() {
  anchorByMouse = false;
  selectionMousePos.value = null;
  selectionMenuOpen.value = false;
  checkTextareaSelection();
}

function onWindowResize() {
  if (showSelectionToolbar.value) {
    positionSelectionBar();
  }
  if (selectionMenuOpen.value) {
    placeSelectionMenu();
  }
  /* 工具栏按钮位置随窗口变化，浮层跟不上就直接收起，避免菜单悬在错位处。 */
  closeToolMenus();
  /* 可视高度变了，两侧末尾跑道与进度百分比都要跟着重算。 */
  refreshRunways();
  updateEditorProgress();
  updatePreviewProgress();
}

/* 字号 / 行距 / 边距改动会改变行高与可视行数，两侧跑道随之重算。 */
watch(
  () => [editorFontSize.value, editorLineHeight.value, editorMarginY.value],
  () => {
    nextTick(() => {
      refreshRunways();
      updateEditorProgress();
      updatePreviewProgress();
    });
  },
);

/* 单栏 / 双栏切换会改变两侧的可视高度与是否存在，跑道跟着重量一次。 */
watch([showEditor, showPreview], () => {
  nextTick(() => {
    refreshRunways();
    updateEditorProgress();
    updatePreviewProgress();
  });
});

/* ---------------- 块拖拽与跨分栏块引用机制 ---------------- */

const hoveredLineIndex = ref<number>(-1);
const hoveredLineTopPx = ref<number>(0);
/* 悬浮行的行高：句柄以「一整行行高」为自身高度并内部居中，图标便落在
   该行文字的视觉中线上（字号 / 行距怎么调都跟着走，不用写死偏移量）。 */
const hoveredLineHeightPx = ref<number>(0);

const currentDocTitle = computed(() => {
  return documentFilesStore.files.find((f) => f.id === fileIdForSlot.value)?.title || "未命名文档";
});

/** 当前文档的正文拆分为行块 */
const docLines = computed(() => {
  return markdown.value.split("\n");
});

/* ---- 行级定位：镜像测量物理行顶部，兼容自动换行 ----
   文本域里一个物理行（\n 划分）可能被软换行拆成好几条视觉行，旧的
   relativeY / lineHeight 换算在遇到换行段时逐段累积偏移，拖拽落点会
   隔好几行。这里用 measureTextareaTops 一次性量出每个物理行的首行顶部，
   再按指针坐标二分定位，视觉行与物理行一一对上。
   测量结果带缓存：拖拽 / 悬浮期间文档内容不变就不重复建镜像。 */

let blockLineCacheEl: HTMLTextAreaElement | null = null;
let blockLineCacheKey = "";
let blockLineCacheTops: number[] = [];
let blockLineCacheBottom = 0;

function lineHeightPxOf(el: HTMLTextAreaElement): number {
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 15;
  return cs.lineHeight === "normal" ? fontSize * 1.6 : parseFloat(cs.lineHeight) || fontSize * 1.6;
}

/** 量出每个物理行的「首条视觉行顶部」像素位置；bottom 为全文内容的下缘，
   totalLines 为物理行数。缓存按 (元素, 内容长度, 换行数) 命中。 */
function measureBlockLineTops(el: HTMLTextAreaElement): { tops: number[]; bottom: number; totalLines: number } {
  const value = el.value;
  let newlineCount = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) newlineCount++;
  }
  const key = `${value.length}:${newlineCount}`;
  if (blockLineCacheEl === el && blockLineCacheKey === key && blockLineCacheTops.length > 0) {
    return { tops: blockLineCacheTops, bottom: blockLineCacheBottom, totalLines: newlineCount + 1 };
  }

  const topCount = newlineCount + 1;
  const offsets = new Array<number>(topCount + 1);
  let idx = 0;
  let cur = 0;
  for (let i = 0; i < value.length; i++) {
    if (value.charCodeAt(i) === 10) {
      offsets[idx++] = cur;
      cur = i + 1;
    }
  }
  offsets[idx] = cur;                    // 最后一个物理行的起点
  offsets[idx + 1] = value.length;       // 哨兵：全文末尾，用于量最后一行高度

  const measured = measureTextareaTops(el, offsets);
  const lh = lineHeightPxOf(el);
  const tops = measured.slice(0, topCount);
  const bottom = measured[topCount] + lh;

  blockLineCacheEl = el;
  blockLineCacheKey = key;
  blockLineCacheTops = tops;
  blockLineCacheBottom = bottom;
  return { tops, bottom, totalLines: newlineCount + 1 };
}

/** 内容坐标 y 命中的物理行号（倒数第几个 \n 块）。 */
function blockLineFromY(tops: number[], contentY: number, totalLines: number): number {
  if (totalLines <= 1) return 0;
  let lo = 0;
  let hi = totalLines - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= contentY) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** 鼠标在编辑区上悬浮时计算当前命中那一行 */
function onEditorMouseMove(e: MouseEvent) {
  if (docBlockDrag.isDragging) return;

  const el = editorRef.value;
  const wrap = editorWrapRef.value;
  if (!el || !wrap) return;

  const rect = el.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const contentY = e.clientY - rect.top + el.scrollTop;
  const { tops, totalLines } = measureBlockLineTops(el);
  const lineIdx = blockLineFromY(tops, contentY, totalLines);

  const topPx = Math.max(0, tops[lineIdx] - el.scrollTop + (rect.top - wrapRect.top));

  hoveredLineIndex.value = lineIdx;
  hoveredLineTopPx.value = topPx;
  /* 句柄撑满一整行行高并在内部垂直居中，图标即与该行文字同一条中线。 */
  hoveredLineHeightPx.value = lineHeightPxOf(el);
}

function onEditorMouseLeave() {
  if (!docBlockDrag.isDragging) {
    hoveredLineIndex.value = -1;
  }
}

/** 点击/拖拽行首块句柄 */
function onBlockHandleMouseDown(e: MouseEvent) {
  if (hoveredLineIndex.value < 0) return;

  const blockText = docLines.value[hoveredLineIndex.value] || "";
  const payload: DocBlockPayload = {
    sourceDocId: fileIdForSlot.value || "main-doc",
    sourceDocTitle: currentDocTitle.value,
    blockIndex: hoveredLineIndex.value,
    blockText,
  };

  startBlockDrag(payload, e.clientX, e.clientY);

  window.addEventListener("mousemove", onGlobalBlockMouseMove, true);
  window.addEventListener("mouseup", onGlobalBlockMouseUp, true);
}

/** 全局 Drag 移动事件：判断落在哪个编辑区、哪一行 */
function onGlobalBlockMouseMove(e: MouseEvent) {
  if (!docBlockDrag.isDragging) return;

  docBlockDrag.pointerX = e.clientX;
  docBlockDrag.pointerY = e.clientY;

  // 找鼠标 (x, y) 落在哪个 DocumentViewer 容器里
  const wrapElements = document.querySelectorAll(".editor-wrap");
  let foundWrap: HTMLElement | null = null;
  let targetTa: HTMLTextAreaElement | null = null;

  wrapElements.forEach((wrap) => {
    const r = wrap.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      foundWrap = wrap as HTMLElement;
      targetTa = wrap.querySelector(".editor-textarea") as HTMLTextAreaElement;
    }
  });

  if (foundWrap && targetTa) {
    const wrapRect = (foundWrap as HTMLElement).getBoundingClientRect();
    const taRect = (targetTa as HTMLTextAreaElement).getBoundingClientRect();
    const contentY = e.clientY - taRect.top + (targetTa as HTMLTextAreaElement).scrollTop;

    const { tops, bottom, totalLines } = measureBlockLineTops(targetTa as HTMLTextAreaElement);
    const lineIdx = blockLineFromY(tops, contentY, totalLines);

    const lineTop = tops[lineIdx];
    const nextTop = lineIdx + 1 < totalLines ? tops[lineIdx + 1] : bottom;
    /* 以该物理行整个视觉跨度（含自动换行展开的行）的中点为界判断插到行前 / 行后。 */
    const inLowerHalf = contentY >= (lineTop + nextTop) / 2;
    const targetLineIndex = Math.max(0, Math.min(totalLines, inLowerHalf ? lineIdx + 1 : lineIdx));

    // 提示线落在目标行的真实顶部（相对于 foundWrap），兼容自动换行后的行高
    const refTop = targetLineIndex < totalLines ? tops[targetLineIndex] : bottom;
    const lineTopPx = refTop - (targetTa as HTMLTextAreaElement).scrollTop + (taRect.top - wrapRect.top);

    const targetDocId = (foundWrap as HTMLElement).getAttribute("data-doc-id") || fileIdForSlot.value;

    docBlockDrag.targetDocId = targetDocId;
    docBlockDrag.targetLineIndex = targetLineIndex;
    docBlockDrag.targetTopPx = Math.max(0, lineTopPx);
  } else {
    docBlockDrag.targetDocId = null;
    docBlockDrag.targetLineIndex = -1;
  }
}

/** 全局 Drag 松手事件：执行对换或跨分栏块引用 */
function onGlobalBlockMouseUp() {
  window.removeEventListener("mousemove", onGlobalBlockMouseMove, true);
  window.removeEventListener("mouseup", onGlobalBlockMouseUp, true);

  if (!docBlockDrag.isDragging || !docBlockDrag.payload) {
    endBlockDrag();
    return;
  }

  const { sourceDocId, sourceDocTitle, blockIndex, blockText } = docBlockDrag.payload;
  const targetDocId = docBlockDrag.targetDocId;
  const targetLineIndex = docBlockDrag.targetLineIndex;

  /** 把源块整理成对齐的块引用文本：每一行都带 > 前缀（空行留一条 >）。 */
  const buildBlockRef = () => {
    const cleanText = blockText.trim();
    const refLines = [`> 💬 块引用《${sourceDocTitle}》：`];
    const bodyLines = cleanText ? cleanText.split("\n") : ["（空文本块）"];
    for (const ln of bodyLines) {
      if (ln.trim().length === 0) refLines.push(">");
      else refLines.push(`> ${ln}`);
    }
    return refLines.join("\n");
  };

  const isThisDoc = targetDocId === fileIdForSlot.value;
  const isValidDrop = targetDocId && targetLineIndex >= 0;

  if (isValidDrop && isThisDoc) {
    if (sourceDocId === fileIdForSlot.value) {
      // 同一文档内的块位置对换
      const lines = [...docLines.value];
      const srcIdx = blockIndex;
      let tgtIdx = targetLineIndex;

      if (srcIdx >= 0 && srcIdx < lines.length) {
        const [removed] = lines.splice(srcIdx, 1);
        if (tgtIdx > srcIdx) tgtIdx -= 1;
        lines.splice(tgtIdx, 0, removed);
        markdown.value = lines.join("\n");
        showToast("位置已调整", "段落/句子顺序对换成功", "edit");
      }
    } else {
      // 从另一个面板拖块进来：本面板直接插入块引用
      const lines = [...docLines.value];
      const tgtIdx = Math.max(0, Math.min(lines.length, targetLineIndex));
      lines.splice(tgtIdx, 0, buildBlockRef());
      markdown.value = lines.join("\n");
      showToast("块引用已插入", `已从《${sourceDocTitle}》引用块内容`, "edit");
    }
  } else if (isValidDrop && !isThisDoc) {
    // 拖到另一个分栏面板：落到目标面板自己的正文里
    const target = findDocEditorTargetByDocId(targetDocId);
    if (target && target.dropBlock) {
      target.dropBlock(buildBlockRef(), targetLineIndex);
    }
  }

  endBlockDrag();
  hoveredLineIndex.value = -1;
}

function handleGlobalMouseDown(e: MouseEvent) {
  const target = e.target as Node | null;
  if (!target) return;
  /* 工具栏下拉菜单：点菜单本身或它的触发按钮都不收起（按钮自己负责切换）。 */
  const inTypographyPanel =
    (typographyPanelRef.value?.contains(target) ?? false) ||
    (typographyBtnRef.value?.contains(target) ?? false);
  const inToolMenu =
    (toolMenuRef.value?.contains(target) ?? false) ||
    (headingBtnRef.value?.contains(target) ?? false) ||
    (listBtnRef.value?.contains(target) ?? false) ||
    inTypographyPanel;
  if (!inToolMenu) closeToolMenus();
  /* 点击浮层菜单本身不收起；点击编辑区只收起菜单。 */
  if (selectionMenuRef.value && selectionMenuRef.value.contains(target)) return;
  const inBar = selectionBarRef.value ? selectionBarRef.value.contains(target) : false;
  const inEditor = editorRef.value ? editorRef.value.contains(target) : false;
  if (selectionMenuOpen.value && !inBar && !inEditor) {
    selectionMenuOpen.value = false;
  }
  if (!inBar && !inEditor) {
    showSelectionToolbar.value = false;
    clearSelectionTimer();
  }
}

/* 浏览器在「末尾空白处点击」时对 textarea 的选区并不总是派发 select 事件，
   但一定会派发 selectionchange。此处统一用 selectionchange 兜底：一旦选区
   塌缩为光标（点击了选中文字以外的空白处），立即收起浮动工具栏与菜单。
   仅当焦点仍在编辑区时才处理，避免误伤页面其他选框。 */
function onEditorSelectionChange() {
  const el = editorRef.value;
  if (!el) return;
  if (document.activeElement !== el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null) return;
  /* 顺手把栈顶快照的选区对齐当前选区：工具栏动作是「先改正文、再于 nextTick
     里重设选区」的两段式，记账那一刻拿到的还是旧光标，这里补上。 */
  syncTopSelection();
  if (start === end) {
    if (showSelectionToolbar.value || selectionMenuOpen.value) {
      selectionMenuOpen.value = false;
      showSelectionToolbar.value = false;
      clearSelectionTimer();
    }
  }
}

async function doCut() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null || start === end) return;
  const selected = el.value.slice(start, end);
  try {
    await navigator.clipboard.writeText(selected);
  } catch {
    /* fallback */
  }
  const val = el.value;
  markdown.value = val.slice(0, start) + val.slice(end);
  nextTick(() => {
    if (el) {
      el.focus();
      el.setSelectionRange(start, start);
    }
  });
  showSelectionToolbar.value = false;
  clearSelectionTimer();
}

async function doCopy() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null || start === end) return;
  const selected = el.value.slice(start, end);
  try {
    await navigator.clipboard.writeText(selected);
  } catch {
    /* fallback */
  }
  showSelectionToolbar.value = false;
  clearSelectionTimer();
}

async function doPaste() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? 0;
  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      const val = el.value;
      markdown.value = val.slice(0, start) + text + val.slice(end);
      nextTick(() => {
        if (el) {
          el.focus();
          el.setSelectionRange(start + text.length, start + text.length);
        }
      });
    }
  } catch {
    /* fallback */
  }
  showSelectionToolbar.value = false;
  clearSelectionTimer();
}

function doSelectAll() {
  const el = editorRef.value;
  if (!el) return;
  el.focus();
  el.select();
  checkTextareaSelection();
}

function doDelete() {
  const el = editorRef.value;
  if (!el) return;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (start === null || end === null || start === end) return;
  const val = el.value;
  markdown.value = val.slice(0, start) + val.slice(end);
  nextTick(() => {
    if (el) {
      el.focus();
      el.setSelectionRange(start, start);
    }
  });
  showSelectionToolbar.value = false;
  clearSelectionTimer();
}

/* ---------------- 选中文字浮层更多菜单：智能文本处理 ---------------- */

const selectionMenuOpen = ref(false);
const selectionMenuRef = ref<HTMLDivElement | null>(null);
const selectionMenuPos = ref({ top: 0, left: 0 });
/* 打开菜单瞬间的快照选区。点击菜单按钮时，某些 WebView（如 Tauri 内置 WebView）
   会把 textarea 的实时选区收起来；若智能操作依赖实时选区就会被误判为
   「无可转换内容」。用打开瞬间的快照兜底，仍以实时选区为准。 */
let menuSelStart = -1;
let menuSelEnd = -1;

function toggleSelectionMenu() {
  selectionMenuOpen.value = !selectionMenuOpen.value;
  if (selectionMenuOpen.value) {
    const el = editorRef.value;
    if (el && typeof el.selectionStart === "number") {
      menuSelStart = el.selectionStart;
      menuSelEnd = el.selectionEnd;
    }
    resetSelectionTimer();
    nextTick(() => placeSelectionMenu());
  }
}

function closeSelectionMenu() {
  selectionMenuOpen.value = false;
  menuSelStart = -1;
  menuSelEnd = -1;
}

/** 菜单面板定位：打开时浮现工具栏暂时隐藏，菜单面板顶对齐接替它的位置，
    空间不足时贴边内收。 */
function placeSelectionMenu() {
  const menu = selectionMenuRef.value;
  if (!menu) return;
  const menuH = menu.offsetHeight || 210;
  const margin = 6;
  const vh = window.innerHeight;
  const barTop = selectionBarPos.value.top;
  const top = barTop + menuH <= vh - margin ? barTop : Math.max(margin, vh - menuH - margin);
  selectionMenuPos.value = { top, left: selectionBarPos.value.left };
}

/** 将选中文字经 transform 转换后写回编辑器，并保持新选区。 */
function transformSelection(transform: (sel: string) => string): boolean {
  const el = editorRef.value;
  if (!el) return false;
  let start = el.selectionStart;
  let end = el.selectionEnd;
  /* 点击菜单按钮后某些浏览器会把 textarea 实时选区折叠为 start===end。
     此时回退到「打开菜单瞬间」快照的选区，保证智能操作能作用于刚才选中的文字。 */
  if ((start === null || end === null || start === end) && menuSelStart >= 0) {
    start = Math.min(menuSelStart, el.value.length);
    end = Math.min(menuSelEnd, el.value.length);
  }
  if (start === null || end === null || start === end) return false;
  const selected = el.value.slice(start, end);
  const out = transform(selected);
  if (out === selected) return false;
  const val = el.value;
  markdown.value = val.slice(0, start) + out + val.slice(end);
  nextTick(() => {
    if (el) {
      el.focus();
      el.setSelectionRange(start, start + out.length);
    }
  });
  return true;
}

function runSelectionAction(action: () => boolean) {
  const done = action();
  selectionMenuOpen.value = false;
  resetSelectionTimer();
  if (!done) showToast("无可转换内容", "请保持选中的文字后重试", "edit");
}

/* 智能交换：把选中文字按「单个汉字/中文、英文单词、数字、标点」切成块，相邻两类
   两两互换位置，空格原位保留。中文汉字逐字作为独立块，支持汉字之间位置智能交换。 */
function swapSelection() {
  return transformSelection((sel) => {
    const toks: string[] = [];
    const kinds: string[] = [];
    let i = 0;
    while (i < sel.length) {
      const ch = sel[i];
      let k: string;
      if (/\s/.test(ch)) k = "s";
      else if (/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch)) k = "cjk";
      else if (/[A-Za-z]/.test(ch)) k = "lat";
      else if (/[0-9]/.test(ch)) k = "num";
      else k = "p";
      let j = i + 1;
      if (k === "lat") while (j < sel.length && /[A-Za-z''-]/.test(sel[j])) j++;
      else if (k === "s") while (j < sel.length && /\s/.test(sel[j])) j++;
      else if (k === "cjk") {
        /* 每个中文汉字作为独立块，支持汉字之间位置两两交换 */
        j = i + 1;
      }
      else if (k === "num") while (j < sel.length && /[0-9]/.test(sel[j])) j++;
      else while (j < sel.length && !/\s/.test(sel[j]) && !/[A-Za-z0-9\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(sel[j])) j++;
      toks.push(sel.slice(i, j));
      kinds.push(k);
      i = j;
    }
    const idx: number[] = [];
    toks.forEach((_, t) => {
      if (kinds[t] !== "s") idx.push(t);
    });
    for (let t = 0; t + 1 < idx.length; t += 2) {
      const a = idx[t];
      const b = idx[t + 1];
      const tmp = toks[a];
      toks[a] = toks[b];
      toks[b] = tmp;
    }
    return toks.join("");
  });
}

/* 英文大小写整体切换：全大写 ⇄ 小写（仅作用于英文字母）。 */
function swapEnglishCase() {
  return transformSelection((sel) => {
    const letters = sel.match(/[A-Za-z]/g) ?? [];
    if (letters.length === 0) return sel;
    const allUpper = letters.every((c) => c === c.toUpperCase());
    return sel.replace(/[A-Za-z]+/g, (w) => (allUpper ? w.toLowerCase() : w.toUpperCase()));
  });
}

/* 英文单词首字母大小写切换：大写 ⇄ 小写，其余字母不动。 */
function swapWordCapitals() {
  return transformSelection((sel) => {
    const words = sel.match(/[A-Za-z]+/g) ?? [];
    if (words.length === 0) return sel;
    const allCapped = words.every((w) => /[A-Z]/.test(w[0]));
    return sel.replace(/[A-Za-z]+/g, (w) =>
      allCapped ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1),
    );
  });
}

/* 智能引号：把半角直引号替换为成对弯引号（开闭按前后语境判定）；
   若选中文字中没有直引号，则自动在选中文字两侧加上智能双引号 “…” 。 */
function smartQuotesSelection() {
  return transformSelection((sel) => {
    let hasStraight = false;
    for (const ch of sel) {
      if (ch === '"' || ch === "'") {
        hasStraight = true;
        break;
      }
    }
    if (!hasStraight) {
      return `“${sel}”`;
    }
    let out = "";
    for (let i = 0; i < sel.length; i++) {
      const ch = sel[i];
      if (ch === '"' || ch === "'") {
        const prev = sel[i - 1] ?? "";
        const opening = !prev || /[\s([{<（【.《'"“]/.test(prev);
        if (ch === '"') out += opening ? "“" : "”";
        else out += opening ? "‘" : "’";
      } else {
        out += ch;
      }
    }
    return out;
  });
}

/* 智能空格：中文句子、段落中的英文单词或字母与左右两侧的中文汉字之间自动补空格，
   标点符号、数字及其他符号不需要空格处理。 */
function smartSpacesSelection() {
  return transformSelection((sel) => {
    if (!/[A-Za-z]/.test(sel)) return sel;
    const isChinese = (ch?: string) => ch ? /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/.test(ch) : false;
    let out = "";
    let i = 0;
    while (i < sel.length) {
      const ch = sel[i];
      if (/[A-Za-z]/.test(ch)) {
        let j = i + 1;
        while (j < sel.length && /[A-Za-z''-]/.test(sel[j])) j++;
        const prev = sel[i - 1];
        const next = sel[j];
        if (isChinese(prev) && !/\s/.test(prev)) out += " ";
        out += sel.slice(i, j);
        if (isChinese(next) && !/\s/.test(next)) out += " ";
        i = j;
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  });
}

/* 设置中关闭「选中文字浮现工具栏」时，立刻隐藏已显示的工具条与菜单。 */
watch(
  () => aiSettings.selectionToolbarEnabled,
  (enabled) => {
    if (!enabled) {
      showSelectionToolbar.value = false;
      selectionMenuOpen.value = false;
      clearSelectionTimer();
    }
  },
);

/* 左侧面板点「定位」→ 接手信号并立刻清空，分栏时只有持有该文档的 pane 响应。
   盯 locateSeq 而不是 locateId：连点同一条时 id 不变，只盯 id 第二次不会触发。 */
watch(
  () => revisionStore.locateSeq,
  () => {
    const id = revisionStore.locateId;
    if (!id || !revisionEnabled.value) return;
    const hit = revisionRangeOf(id);
    if (!hit || hit.fileId !== fileIdForSlot.value) return;
    clearRevisionLocate();
    locateRevision(id);
  },
);

function onDocClick() {
  if (ctxMenu.value.show) closeContextMenu();
}

onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("mousedown", handleGlobalMouseDown);
  document.addEventListener("mouseup", onDocumentMouseUp);
  document.addEventListener("selectionchange", onEditorSelectionChange);
  window.addEventListener("resize", onWindowResize);
  window.addEventListener("beforeunload", onBeforeUnload);
  ensureLocalFonts();
  refreshInsights();
  /* 首次进入（含应用重启）恢复上次的阅读位置；文档页此刻可能还被 v-show
     隐藏着，那就交给尺寸观察器在真正可见的第一帧再补一次。 */
  attachVisibilityObserver();
  restoreReadingPosition();
  /* 首帧量一次两侧末尾跑道（依赖各自的真实高度与行高）。 */
  void nextTick(() => {
    refreshRunways();
    updateEditorProgress();
    updatePreviewProgress();
  });
  /* 文档界面：登记 AI 回复拖入编辑区的落点（嵌入式渲染不参与）。 */
  if (!props.embedded) registerDocEditorTarget(docDropTarget);
});

/** 关窗 / 刷新前把最后一次滚动位置落定，不靠 debounce 的尾巴。 */
function onBeforeUnload() {
  if (positionSaveTimer !== null) {
    window.clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  flushReadingPosition();
}

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("mousedown", handleGlobalMouseDown);
  document.removeEventListener("mouseup", onDocumentMouseUp);
  document.removeEventListener("selectionchange", onEditorSelectionChange);
  window.removeEventListener("resize", onWindowResize);
  window.removeEventListener("beforeunload", onBeforeUnload);
  /* 组件卸载（切标签页 / 关分栏）也算一次「离开文档」，位置要留住。 */
  if (positionSaveTimer !== null) {
    window.clearTimeout(positionSaveTimer);
    positionSaveTimer = null;
  }
  flushReadingPosition();
  visibilityObserver?.disconnect();
  visibilityObserver = null;
  clearSelectionTimer();
  if (ringJumpTimer !== null) {
    window.clearTimeout(ringJumpTimer);
    ringJumpTimer = null;
  }
  if (locateFlashTimer !== null) {
    window.clearTimeout(locateFlashTimer);
    locateFlashTimer = null;
  }
  /* 组件被卸载时（例如关闭分栏）行内 AI 浮层不会再发 closed，这里补一次销账，
     否则该文档条目的边框动效会一直亮着。 */
  if (inlineAiMarkedId !== null) {
    endAiDocEdit(inlineAiMarkedId);
    inlineAiMarkedId = null;
  }
  /* 编辑区卸载后不再接收拖入。 */
  if (!props.embedded) unregisterDocEditorTarget(docDropTarget);
});
</script>

<template>
  <div ref="rootRef" class="document-viewer" :class="{ embedded }">
    <DocumentSidebar
      v-if="!embedded && !sidebarCollapsed"
      :target="secondary ? 'secondary' : 'primary'"
      @selectFile="onSelectSidebarFile"
      @collapse="sidebarCollapsed = true"
    />
    <button
      v-if="!embedded && sidebarCollapsed"
      class="doc-sidebar-rail"
      title="展开文档面板"
      @click="sidebarCollapsed = false"
    >
      <PanelLeftOpen :size="16" :stroke-width="1.8" />
    </button>

    <div class="doc-main">
    <!-- Document toolbar -->
    <div class="doc-toolbar">
      <div class="toolbar-left">
        <div class="view-switch">
          <button
            class="view-btn"
            :class="{ active: showEditor }"
            :disabled="showEditor && !showPreview"
            title="Markdown 编辑"
            @click="toggleEditor"
          >
            <FileCode :size="14" :stroke-width="1.8" />
            markdown
          </button>
          <button
            class="view-btn"
            :class="{ active: showPreview }"
            :disabled="showPreview && !showEditor"
            title="预览"
            @click="togglePreview"
          >
            <Eye :size="14" :stroke-width="1.8" />
            预览
          </button>
        </div>
      </div>

      <div
        ref="formatToolsRef"
        class="format-tools"
        :class="{ panning: toolbarPanning }"
        @pointerdown.capture="onToolbarPointerDown"
        @click.capture="onToolbarClickCapture"
        @scroll="closeToolMenus"
      >
        <!-- Host for context-specific controls (e.g. the card colour picker in
             the writing-card editor) placed ahead of the font controls. -->
        <slot name="toolbar-lead" />
        <button
          class="format-btn"
          :class="{ active: findOpen }"
          title="查找 / 替换"
          @click="toggleFind"
        >
          <Search :size="15" :stroke-width="1.8" />
        </button>
        <span class="toolbar-divider" />
        <button class="format-btn" title="撤销 (Ctrl+Z)" :disabled="!canUndo" @click="undo">
          <Undo2 :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="重做 (Ctrl+Shift+Z / Ctrl+Y)" :disabled="!canRedo" @click="redo">
          <Redo2 :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="复制全部内容" @click="copyAll">
          <Copy :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="一键排版：清除多余空行，让内容更紧凑 (Ctrl+Shift+F)" @click="reformatWhitespace">
          <WrapText :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="清空文档" @click="clearDoc">
          <Trash2 :size="15" :stroke-width="1.8" />
        </button>
        <span class="toolbar-divider" />
        <button class="format-btn" title="加粗 (Ctrl+B)" @click="wrapSelection('**', '**', '加粗文本')">
          <Bold :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="斜体 (Ctrl+I)" @click="wrapSelection('*', '*', '斜体文本')">
          <Italic :size="15" :stroke-width="1.8" />
        </button>
        <button
          ref="headingBtnRef"
          class="format-btn has-menu"
          :class="{ active: headingMenuOpen }"
          title="标题：H1 – H5 (Ctrl+1~5) 可选（再点同一档即取消）"
          @mousedown.prevent
          @click="toggleToolMenu('heading')"
        >
          <Heading :size="15" :stroke-width="1.8" />
          <ChevronDown class="menu-caret" :size="9" :stroke-width="2.6" />
        </button>
        <button
          ref="listBtnRef"
          class="format-btn has-menu"
          :class="{ active: listMenuOpen }"
          title="列表：无序 / 有序(序号 Ctrl+Shift+O) 可选（再点同一档即取消）"
          @mousedown.prevent
          @click="toggleToolMenu('list')"
        >
          <List :size="15" :stroke-width="1.8" />
          <ChevronDown class="menu-caret" :size="9" :stroke-width="2.6" />
        </button>
        <button class="format-btn" title="引用 (Ctrl+Shift+Q)" @click="applyLineStyle('quote')">
          <Quote :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="代码块 (Ctrl+Shift+C)" @click="insertCodeBlock()">
          <SquareCode :size="15" :stroke-width="1.8" />
        </button>
        <button class="format-btn" title="链接 (Ctrl+L)" @click="insertLink()">
          <LinkIcon :size="15" :stroke-width="1.8" />
        </button>
        <span class="toolbar-divider" />
        <button
          ref="typographyBtnRef"
          class="format-btn has-menu typography-btn"
          :class="{ active: typographyPanelOpen }"
          title="排版与字体表单"
          @mousedown.prevent
          @click="toggleTypographyPanel()"
        >
          <Type :size="15" :stroke-width="1.8" />
          <ChevronDown class="menu-caret" :size="9" :stroke-width="2.6" />
        </button>
      </div>
    </div>

    <!-- 工具栏下拉菜单与排版表单面板：Teleport 到 body，视口坐标定位，
         不被横向滚动的工具栏裁掉。@mousedown.prevent 保住编辑区焦点与选区。 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="headingMenuOpen || listMenuOpen"
          ref="toolMenuRef"
          class="toolbar-menu"
          :style="{ top: toolMenuPos.top + 'px', left: toolMenuPos.left + 'px' }"
          @mousedown.prevent.stop
        >
          <template v-if="headingMenuOpen">
            <button
              v-for="lv in HEADING_LEVELS"
              :key="lv.style"
              class="toolbar-menu-item"
              :class="{ on: currentLineStyle === lv.style }"
              @click="pickLineStyle(lv.style)"
            >
              <component :is="lv.icon" :size="14" :stroke-width="1.8" />
              <span>{{ lv.label }}</span>
              <span class="toolbar-menu-syntax">{{ '#'.repeat(Number(lv.style.slice(1))) }}</span>
            </button>
          </template>
          <template v-else>
            <button
              class="toolbar-menu-item"
              :class="{ on: currentLineStyle === 'bullet' }"
              @click="pickLineStyle('bullet')"
            >
              <List :size="14" :stroke-width="1.8" />
              <span>无序列表</span>
              <span class="toolbar-menu-syntax">-</span>
            </button>
            <button
              class="toolbar-menu-item"
              :class="{ on: currentLineStyle === 'ordered' }"
              @click="pickLineStyle('ordered')"
            >
              <ListOrdered :size="14" :stroke-width="1.8" />
              <span>有序列表</span>
              <span class="toolbar-menu-syntax">1.</span>
            </button>
          </template>
        </div>
      </Transition>
    </Teleport>

    <!-- 排版与字体悬浮表单面板 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="typographyPanelOpen"
          ref="typographyPanelRef"
          class="typography-panel"
          :style="{ top: typographyMenuPos.top + 'px', left: typographyMenuPos.left + 'px' }"
          @mousedown.stop
        >
          <div class="typo-panel-header">
            <span class="typo-panel-title">排版与字体</span>
            <button
              class="typo-reset-btn"
              title="恢复默认设置"
              @click="resetTypographyDefaults"
            >
              <RotateCcw :size="12" :stroke-width="1.8" />
              <span>恢复默认</span>
            </button>
          </div>

          <div class="typo-panel-form">
            <!-- 1. 字体 -->
            <div class="typo-field-row">
              <label class="typo-field-label">字体</label>
              <select
                v-model="editorFont"
                class="typo-select"
                title="字体（与设置面板同步）"
              >
                <optgroup label="预设字体">
                  <option v-for="f in fontOptions" :key="f" :value="f">{{ f }}</option>
                </optgroup>
                <optgroup v-if="localOnlyFonts.length > 0" label="本地字体">
                  <option v-for="f in localOnlyFonts" :key="f" :value="f">{{ f }}</option>
                </optgroup>
              </select>
            </div>

            <!-- 2. 字号 -->
            <div class="typo-field-row">
              <label class="typo-field-label">字号</label>
              <select
                v-model="editorFontSize"
                class="typo-select"
                title="字号大小"
                @change="setFontSize(Number(editorFontSize))"
              >
                <option v-for="size in fontSizes" :key="size" :value="size">{{ size }}px</option>
              </select>
            </div>

            <!-- 3. 行间距 -->
            <div class="typo-field-row">
              <label class="typo-field-label">行间距</label>
              <input
                v-model.number="editorLineHeight"
                type="number"
                step="0.05"
                min="1"
                max="3"
                class="typo-input"
                title="行间距（1.0 ~ 3.0）"
              />
            </div>

            <!-- 4. 水平边距 -->
            <div class="typo-field-row">
              <label class="typo-field-label">水平边距</label>
              <div class="typo-input-wrap">
                <input
                  v-model.number="editorMarginX"
                  type="number"
                  step="1"
                  min="0"
                  max="200"
                  class="typo-input"
                  title="水平边距（px）"
                />
                <span class="typo-unit">px</span>
              </div>
            </div>

            <!-- 5. 垂直边距 -->
            <div class="typo-field-row">
              <label class="typo-field-label">垂直边距</label>
              <div class="typo-input-wrap">
                <input
                  v-model.number="editorMarginY"
                  type="number"
                  step="1"
                  min="0"
                  max="200"
                  class="typo-input"
                  title="垂直边距（px）"
                />
                <span class="typo-unit">px</span>
              </div>
            </div>

            <!-- 6. 网格线 -->
            <div class="typo-field-row">
              <label class="typo-field-label">网格线</label>
              <select
                v-model="editorGridLine"
                class="typo-select"
                title="背景网格线"
              >
                <option value="none">无（默认）</option>
                <option value="solid">横向实线</option>
                <option value="dashed">横向虚线</option>
                <option value="dotted">横向点线</option>
              </select>
            </div>

            <!-- 7. 段首样式：行首缩进 / 首字下沉（与「设置 → 配置」中的开关同步） -->
            <div class="typo-field-row">
              <label class="typo-field-label">段首样式</label>
              <div class="typo-toggle-group" role="group" aria-label="段首样式">
                <button
                  type="button"
                  class="typo-toggle-btn"
                  :class="{ active: aiSettings.firstLineIndent }"
                  :aria-pressed="aiSettings.firstLineIndent"
                  title="行首缩进：正文段落首行缩进 2 字符（与首字下沉互斥，同步「设置 → 配置」开关）"
                  @click="aiSettings.firstLineIndent = !aiSettings.firstLineIndent"
                >
                  <Indent :size="13" :stroke-width="1.8" />
                  <span>缩进</span>
                </button>
                <button
                  type="button"
                  class="typo-toggle-btn"
                  :class="{ active: aiSettings.dropCap }"
                  :aria-pressed="aiSettings.dropCap"
                  title="首字下沉：正文段落首字放大下沉显示（与行首缩进互斥，同步「设置 → 配置」开关）"
                  @click="aiSettings.dropCap = !aiSettings.dropCap"
                >
                  <CaseSensitive :size="13" :stroke-width="1.8" />
                  <span>首字</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 查找 / 替换 -->
    <div v-if="findOpen" class="find-bar">
      <div class="find-field">
        <Search :size="13" :stroke-width="2" class="find-icon" />
        <input
          ref="findInputRef"
          v-model="findText"
          class="find-input"
          placeholder="查找…"
          @keydown.enter.prevent="findNext"
          @keydown.esc.prevent="closeFind"
        />
        <span class="find-count">{{ findMatches.length > 0 ? `${findIndex + 1}/${findMatches.length}` : "0/0" }}</span>
      </div>
      <button class="find-btn" title="上一个" :disabled="findMatches.length === 0" @click="findPrev">上一个</button>
      <button class="find-btn" title="下一个" :disabled="findMatches.length === 0" @click="findNext">下一个</button>
      <button
        class="find-btn toggle"
        :class="{ on: findCaseSensitive }"
        title="区分大小写"
        @click="findCaseSensitive = !findCaseSensitive"
      >
        Aa
      </button>
      <div class="find-field">
        <input
          v-model="replaceText"
          class="find-input"
          placeholder="替换为…"
          @keydown.enter.prevent="replaceCurrent"
          @keydown.esc.prevent="closeFind"
        />
      </div>
      <button class="find-btn" :disabled="findMatches.length === 0" @click="replaceCurrent">替换</button>
      <button class="find-btn primary" :disabled="findMatches.length === 0" @click="replaceAll">全部替换</button>
      <button class="find-btn icon" title="关闭" @click="closeFind">
        <X :size="14" :stroke-width="1.9" />
      </button>
    </div>

    <!-- 内联建议 -->
    <div v-if="insightStore.suggestions.length > 0" class="suggestion-bar">
      <div
        v-for="sug in insightStore.suggestions"
        :key="sug.id"
        class="suggestion-card"
        :class="{ accepted: sug.accepted, dismissed: sug.dismissed }"
      >
        <div class="suggestion-header">
          <span class="suggestion-label">
            <Lightbulb :size="12" :stroke-width="1.8" />
            依据你的写作习惯：{{ sug.habitLabel }}
          </span>
          <div class="suggestion-actions">
            <button class="sug-btn accept" title="采纳" @click="acceptSuggestion(sug.id)">
              <Check :size="12" />
            </button>
            <button class="sug-btn reject" title="忽略" @click="rejectSuggestion(sug.id)">
              <X :size="12" />
            </button>
          </div>
        </div>
        <div class="suggestion-body">{{ sug.suggestion }}</div>
        <div class="suggestion-footer">
          <span class="suggestion-habit">{{ sug.habitDesc }}</span>
          <span class="suggestion-strength">
            习惯强度
            <span class="strength-bar">
              <span class="strength-fill" :style="{ width: sug.habitStrength + '%' }"></span>
            </span>
          </span>
        </div>
      </div>
    </div>

    <!-- Editor / Preview -->
    <div class="doc-scroll" :class="['grid-line-' + editorGridLine]">
      <div ref="panesRef" class="panes" :class="{ split: isSplit, 'editor-only': effectiveShowEditor && !effectiveShowPreview, 'preview-only': !effectiveShowEditor && effectiveShowPreview }" :style="splitRatioStyle">
        <div v-if="effectiveShowEditor" class="editor-pane">
          <div v-if="props.zenMode === 'off'" class="read-progress" aria-hidden="true">
            <span
              class="read-progress-fill"
              :style="{ width: editorProgress * 100 + '%' }"
            ></span>
          </div>
          <div v-if="props.zenMode === 'off'" class="editor-meta">
            <span class="editor-meta-left">
              <div class="sync-control">
                <select v-model="scrollSyncMode" class="sync-select" title="滚动同步">
                  <option value="separate">不同步滚动</option>
                  <option value="sync">同步滚动</option>
                </select>
              </div>
            </span>
            <span class="editor-meta-right">
              <span class="habit-badge" :title="habitBadgeTitle">
                <Sparkles :size="11" :stroke-width="1.8" />
                {{ habitBadgeCount }}
              </span>
              <span>{{ markdown.length }} 字符</span>
            </span>
          </div>
          <div
            ref="editorWrapRef"
            class="editor-wrap"
            :data-doc-id="fileIdForSlot"
            :class="{ 'spotlight-on': spotlightEnabled, 'doc-drag-hover': docDragHover }"
            :style="editorWrapStyle"
            @mousemove="onEditorMouseMove"
            @mouseleave="onEditorMouseLeave"
          >
            <!-- 块拖拽句柄（鼠标悬浮行侧边）：高度取该行真实行高，图标在行框内居中，
                 与这一行文字的视觉中线严格对齐（字号 / 行距变化时自动跟随）。 -->
            <button
              v-if="hoveredLineIndex >= 0 && !docBlockDrag.isDragging"
              class="block-drag-handle"
              :style="{ top: hoveredLineTopPx + 'px', height: (hoveredLineHeightPx || 16) + 'px' }"
              title="按住拖拽以对换块位置，或拖到另一分栏插入块引用"
              @mousedown.stop.prevent="onBlockHandleMouseDown"
            >
              <GripVertical :size="13" :stroke-width="1.8" />
            </button>

            <!-- 块拖拽插入提示线 -->
            <div
              v-if="docBlockDrag.isDragging && docBlockDrag.targetDocId === fileIdForSlot"
              class="block-insertion-line"
              :style="{ top: docBlockDrag.targetTopPx + 'px' }"
            >
              <span class="insertion-dot left"></span>
              <span class="insertion-line-bar"></span>
              <span class="insertion-dot right"></span>
            </div>
            <div
              ref="highlightRef"
              class="editor-highlights"
              v-show="editorOverlayActive"
              :style="{ fontSize: editorFontSize + 'px', fontFamily: editorFontStack }"
              v-html="highlightedEditorHtml"
            ></div>
            <textarea
              ref="editorRef"
              v-model="markdown"
              v-auto-pair
              class="editor-textarea"
              spellcheck="false"
              :style="{ fontSize: editorFontSize + 'px', fontFamily: editorFontStack }"
              @scroll="onEditorScroll"
              @contextmenu="onEditorContextMenu"
              @paste="onEditorPaste"
              @select="checkTextareaSelection(); updateCaretPos()"
              @mousedown="onTextareaMouseDown"
              @mouseup="checkTextareaSelection(); updateCaretPos()"
              @keyup="onTextareaKeyUp(); updateCaretPos()"
              @keydown="onEditorKeydown"
              @beforeinput="onEditorBeforeInput"
              @click="updateCaretPos"
              @input="onEditorInput"
            ></textarea>
            <!-- 悬浮阅读进度圆环：默认贴编辑框内部右上角，长按环心可拖到任意位置。 -->
            <ReadingProgressRing
              :progress="editorProgress"
              :source="markdown"
              :target="editorRef"
              :slot-key="ringSlotBase + ':editor'"
              kind="editor"
              :inset-top="10"
              :inset-right="14"
              :inset-bottom="10"
              :inset-left="14"
              :max-size="ringMaxSize"
              :zen-mode="props.zenMode"
              :spotlight-active="spotlightEnabled"
              :doc-title="documentFilesStore.files.find(f => f.id === fileIdForSlot)?.title || '未命名文档'"
              :zen-disabled="props.embedded || !!props.ringSlot"
              @toggleZen="handleToggleZen"
              @toggleSpotlight="handleToggleSpotlight"
              @jump="onRingJump('editor', $event)"
              @update:source="markdown = $event"
              @save="showToast('已保存', '正文已更新并保存', 'edit')"
            />
            <!-- 退出禅定模式悬浮胶囊 -->
            <button
              v-if="props.zenMode !== 'off'"
              class="zen-exit-pill"
              title="退出禅定专注模式 (或按 ESC)"
              @click="emit('toggleZen', 'off')"
            >
              <X :size="12" :stroke-width="2" />
              <span>退出禅定 (ESC)</span>
            </button>
            <!-- Ctrl+K 行内 AI 编辑：独立组件，自行接管快捷键与浮层，
                 编辑器既有逻辑保持不变。 -->
            <InlineAiEdit
              v-model="markdown"
              :target="editorRef"
              @opened="onInlineAiOpened"
              @closed="onInlineAiClosed"
              @applied="onInlineAiApplied"
            />
            <!-- 修订与批注：独立组件，只读选区、不动正文，图层数据落在 revisionStore。 -->
            <RevisionAnnotation
              v-if="revisionEnabled"
              ref="revisionFormRef"
              :target="editorRef"
              :file-id="fileIdForSlot"
              @opened="onRevisionOpened"
            />
            <!-- 浮动工具栏 Teleport 到 body，用视口坐标定位，保证整条完整单排显示，
                 不受编辑区 overflow 裁剪，也不会在窄栏里竖排换行。 -->
            <Teleport to="body">
              <Transition name="fade">
                <div
                  v-if="showSelectionToolbar && !selectionMenuOpen"
                  ref="selectionBarRef"
                  class="floating-selection-bar"
                  :class="{ compact: selectionBarCompact }"
                  :style="{ top: selectionBarPos.top + 'px', left: selectionBarPos.left + 'px' }"
                  @mousedown.prevent.stop
                >
                <button class="selection-bar-btn" title="剪切" @click="doCut">
                  <span>剪切</span>
                </button>
                <button class="selection-bar-btn" title="复制" @click="doCopy">
                  <span>复制</span>
                </button>
                <button class="selection-bar-btn" title="粘贴" @click="doPaste">
                  <span>粘贴</span>
                </button>
                <button class="selection-bar-btn" title="全选" @click="doSelectAll">
                  <span>全选</span>
                </button>
                <button class="selection-bar-btn danger" title="删除" @click="doDelete">
                  <span>删除</span>
                </button>
                <button class="selection-bar-btn menu" title="更多文本处理" @click.stop="toggleSelectionMenu">
                  <MoreVertical :size="14" :stroke-width="1.9" />
                </button>
              </div>
            </Transition>
            </Teleport>
            <!-- 更多文本处理菜单：默认贴在工具条下方，底部返回箭头回到工具条。 -->
            <Teleport to="body">
              <Transition name="fade">
                <div
                  v-if="showSelectionToolbar && selectionMenuOpen"
                  ref="selectionMenuRef"
                  class="selection-more-menu"
                  :style="{ top: selectionMenuPos.top + 'px', left: selectionMenuPos.left + 'px' }"
                  @mousedown.prevent.stop
                >
                  <button
                    class="selection-more-item"
                    title="智能交换选中文字中：中文、英文（整词或字母）与标点的彼此位置"
                    @click="runSelectionAction(swapSelection)"
                  >
                    <ArrowRightLeft :size="14" :stroke-width="1.8" />
                    <span>智能交换</span>
                  </button>
                  <button
                    class="selection-more-item"
                    title="英文大小写整体切换（全大写 ⇄ 小写）"
                    @click="runSelectionAction(swapEnglishCase)"
                  >
                    <span class="menu-case-glyph caps">Aa</span>
                    <span>英文大小写</span>
                  </button>
                  <button
                    class="selection-more-item"
                    title="英文单词首字母大小写切换（首字母大写 ⇄ 小写）"
                    @click="runSelectionAction(swapWordCapitals)"
                  >
                    <span class="menu-case-glyph">Aa</span>
                    <span>首字母大小写</span>
                  </button>
                  <button
                    class="selection-more-item"
                    title="智能引号替换：把半角直引号替换为成对弯引号（中文/英文双引号）"
                    @click="runSelectionAction(smartQuotesSelection)"
                  >
                    <Quote :size="14" :stroke-width="1.8" />
                    <span>智能引号</span>
                  </button>
                  <button
                    class="selection-more-item"
                    title="智能空格：英文单词与相邻文字之间自动补空格，让中英文混排自然留白"
                    @click="runSelectionAction(smartSpacesSelection)"
                  >
                    <span class="menu-space-glyph">&nbsp;空&nbsp;</span>
                    <span>智能空格</span>
                  </button>
                  <button class="selection-more-back" title="返回浮现工具栏" @click="closeSelectionMenu">
                    <ArrowLeft :size="14" :stroke-width="1.8" />
                    <span>返回</span>
                  </button>
                </div>
              </Transition>
            </Teleport>
          </div>
        </div>

        <div
          v-if="isSplit"
          class="split-divider"
          :class="{ dragging: splitDragging }"
          title="拖动调整宽度"
          @mousedown.stop="startSplitDrag"
        ></div>

        <div v-if="effectiveShowPreview" class="preview-pane" :class="{ 'spotlight-on': spotlightEnabled }">
          <div v-if="props.zenMode === 'off'" class="read-progress" aria-hidden="true">
            <span
              class="read-progress-fill"
              :style="{ width: previewProgress * 100 + '%' }"
            ></span>
          </div>
          <div v-if="props.zenMode === 'off'" class="preview-meta">
            <span class="preview-meta-label">预览</span>
            <span class="preview-timestamp">{{ previewTimestamp }}</span>
            <span class="preview-meta-right">
              <button
                class="color-toggle"
                :class="{ active: contentColoringOn }"
                title="开启后按 标题 / 粗体 / 引用块 / 引号 / 括号 / 标点 / 特殊标记 / 字母 / 数字 给正文配色，只改文字颜色、不影响背景"
                @click="contentColoringOn = !contentColoringOn"
              >
                <Palette :size="11" :stroke-width="1.9" />
                内容上色
              </button>
              <span
                v-if="revisionActive"
                class="revision-badge"
                title="预览正文中已叠加小眼睛开启的修订内容；关掉小眼睛即回到原文"
              >
                <Layers :size="10" :stroke-width="1.9" />
                修订生效中
              </span>
              <span class="habit-badge" :title="habitBadgeTitle">
                <Sparkles :size="11" :stroke-width="1.8" />
                {{ habitBadgeCount }}
              </span>
            </span>
          </div>
          <div ref="previewRef" class="preview-scroll" @scroll="onPreviewScroll" @mousemove="onPreviewMouseMove">
            <div class="paper-card" :style="paperCardStyle">
              <div
                class="markdown-body reading-view"
                :class="{
                  'content-colored': contentColoringOn,
                  'first-line-indent': aiSettings.firstLineIndent,
                  'drop-cap': aiSettings.dropCap,
                }"
                v-html="rendered"
                :style="readingViewStyle"
              ></div>
            </div>
          </div>
          <!-- 预览区同款圆环：进度与本区顶部进度条同源，目录跳转到渲染后的标题。 -->
          <ReadingProgressRing
            :progress="previewProgress"
            :source="markdown"
            :target="previewRef"
            :slot-key="ringSlotBase + ':preview'"
            kind="preview"
            :inset-top="props.zenMode !== 'off' ? 10 : 43"
            :inset-right="14"
            :inset-bottom="10"
            :inset-left="14"
            :max-size="ringMaxSize"
            :zen-mode="props.zenMode"
            :spotlight-active="spotlightEnabled"
            :doc-title="documentFilesStore.files.find(f => f.id === fileIdForSlot)?.title || '未命名文档'"
            :zen-disabled="props.embedded || !!props.ringSlot"
            @toggleZen="handleToggleZen"
            @toggleSpotlight="handleToggleSpotlight"
            @jump="onRingJump('preview', $event)"
            @update:source="markdown = $event"
            @save="showToast('已保存', '正文已更新并保存', 'edit')"
          />
          <!-- 退出禅定模式悬浮胶囊 -->
          <button
            v-if="props.zenMode !== 'off'"
            class="zen-exit-pill"
            title="退出禅定专注模式 (或按 ESC)"
            @click="emit('toggleZen', 'off')"
          >
            <X :size="12" :stroke-width="2" />
            <span>退出禅定 (ESC)</span>
          </button>
        </div>
      </div>
    </div>
    </div>

    <!-- 右键菜单 -->
    <Teleport to="body">
      <div v-if="ctxMenu.show" class="ctx-menu" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @click.stop>
        <div v-if="revisionEnabled" class="ctx-item" @click="ctxMenuAction('revise')">
          <Layers :size="14" :stroke-width="1.8" />
          <span>修订与批注</span>
          <span class="ctx-shortcut">Ctrl+Shift+M</span>
        </div>
        <div v-if="revisionEnabled" class="ctx-divider"></div>
        <div class="ctx-item" @click="ctxMenuAction('polish')">
          <Lightbulb :size="14" :stroke-width="1.8" />
          <span>润色选段</span>
        </div>
        <div class="ctx-item" @click="ctxMenuAction('continue')">
          <ArrowRight :size="14" :stroke-width="1.8" />
          <span>续写</span>
        </div>
        <div class="ctx-divider"></div>
        <div class="ctx-item" @click="ctxMenuAction('habit-gen')">
          <Sparkles :size="14" :stroke-width="1.8" />
          <span>依习惯生成</span>
        </div>
      </div>
    </Teleport>

    <!-- 习惯学习提示 Toast
         Teleported so it stays visible even when the 文档 tab is hidden
         (e.g. Ctrl+S feedback while the 写作 tab is active). -->
    <Teleport to="body">
      <Transition name="toast">
        <div v-if="!embedded && insightStore.toast.visible" class="learning-toast" @click="dismissToast">
          <div class="toast-icon" :class="insightStore.toast.icon">
            <Sparkles v-if="insightStore.toast.icon === 'habit'" :size="16" :stroke-width="1.8" />
            <Lightbulb v-else-if="insightStore.toast.icon === 'edit'" :size="16" :stroke-width="1.8" />
            <Check v-else :size="16" :stroke-width="1.8" />
          </div>
          <div class="toast-text">
            <span class="toast-title">{{ insightStore.toast.title }}</span>
            <span class="toast-desc">{{ insightStore.toast.desc }}</span>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 块拖拽跟随指针的贴片 -->
    <Teleport to="body">
      <div
        v-if="docBlockDrag.isDragging && docBlockDrag.payload"
        class="block-drag-ghost"
        :style="{ left: docBlockDrag.pointerX + 'px', top: docBlockDrag.pointerY + 'px' }"
      >
        <span class="block-drag-ghost-dot"></span>
        <span class="block-drag-ghost-text">{{ docBlockDrag.payload.blockText }}</span>
      </div>
    </Teleport>

    <!-- 项目主题的清空文档确认弹窗 -->
    <Teleport to="body">
      <div v-if="showClearConfirm" class="confirm-modal-mask" @click.self="showClearConfirm = false">
        <div class="confirm-modal-shell">
          <div class="confirm-modal-header">
            <span class="confirm-title">清空文档确认</span>
            <button class="confirm-close-btn" @click="showClearConfirm = false"><X :size="16" /></button>
          </div>
          <div class="confirm-modal-body">
            确定清空当前文档的全部内容吗？此操作无法撤销。
          </div>
          <div class="confirm-modal-footer">
            <button class="confirm-btn cancel" @click="showClearConfirm = false">取消</button>
            <button class="confirm-btn danger" @click="confirmClearDoc">确定清空</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.document-viewer {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: row;
  background: var(--surface-container-low);
  overflow: hidden;
  flex: 1;
}

.doc-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 阅读进度条：贴合编辑 / 预览区域顶部边框，主题色实色填充，无阴影 */
.read-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: transparent;
  pointer-events: none;
  z-index: 6;
}

.read-progress-fill {
  display: block;
  height: 100%;
  width: 0;
  background: var(--primary);
  transition: width 0.06s linear;
  border-radius: 0 2px 2px 0;
}

/* 折叠后的细窄导轨，用于重新展开左侧文档面板 */
.doc-sidebar-rail {
  flex-shrink: 0;
  width: 26px;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12px;
  background: var(--surface-container-low);
  border-right: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.doc-sidebar-rail:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.doc-toolbar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
  min-height: 48px;
  z-index: 5;
  overflow: hidden;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

/* markdown / 预览 切换：实心底沿的「可按压」按钮。
   悬停填主题色、按下整体下沉并收薄底沿，形成实体按键的手感。
   配色取项目主题变量，不引入新色。 */
.view-switch {
  display: inline-flex;
  align-items: flex-start;
  background: var(--surface-container);
  border-radius: 8px;
  /* 底部多留 3px 给按钮的实心底沿，按下时不被容器裁掉。 */
  padding: 3px 3px 6px;
  gap: 4px;
}

.view-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--surface-container-low);
  color: var(--on-surface-variant);
  box-shadow: 0 3px 0 var(--surface-dim);
  transition: background 0.18s ease, color 0.18s ease, box-shadow 0.12s ease,
    transform 0.12s ease, text-shadow 0.18s ease;
}

.view-btn:hover:not(:disabled) {
  background: var(--primary);
  color: var(--on-primary-container);
  text-shadow: 0 1px 0 var(--primary-container);
}

/* 覆盖全局的 button:active{scale(.97)}：这里要的是「下沉」而不是「缩小」。 */
.view-btn:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 var(--surface-dim);
  background: var(--primary);
  color: var(--on-primary-container);
}

/* 当前选中的视图：主题色描边感 + 更亮的纸面，底沿换成主题浅色。 */
.view-btn.active {
  background: var(--surface-bright);
  color: var(--primary);
  box-shadow: 0 3px 0 var(--primary-fixed-dim);
}

.view-btn.active:hover:not(:disabled) {
  background: var(--primary);
  color: var(--on-primary-container);
}

.view-btn.active:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: 0 1px 0 var(--primary-fixed-dim);
}

.view-btn:disabled {
  cursor: default;
  color: var(--reading-text-faint);
  box-shadow: 0 3px 0 var(--surface-dim);
}

@media (prefers-reduced-motion: reduce) {
  .view-btn {
    transition-duration: 0.01ms;
  }

  .view-btn:active:not(:disabled),
  .view-btn.active:active:not(:disabled) {
    transform: none;
  }
}

.format-tools {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 0;
  flex-wrap: nowrap;
  justify-content: flex-end;
  /* 分栏后单栏变窄时改为横向滚动，避免按钮被挤压/截断 */
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-x;
}

.format-tools.panning {
  cursor: grabbing;
}

.format-tools.panning > * {
  pointer-events: none;
}

.format-tools::-webkit-scrollbar {
  height: 4px;
}

.format-tools::-webkit-scrollbar-thumb {
  background: var(--outline-variant);
  border-radius: 999px;
}

.format-tools > * {
  flex-shrink: 0;
}

/* ---- 查找 / 替换 ---- */

.find-bar {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
  flex-wrap: nowrap;
  overflow-x: auto;
}

.find-field {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 220px;
  min-width: 120px;
  padding: 0 8px;
  height: 28px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
}

.find-icon {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.find-input {
  flex: 1;
  min-width: 0;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--on-surface);
  outline: none;
}

.find-count {
  flex-shrink: 0;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 10px;
  color: var(--on-surface-variant);
}

.find-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.find-btn:hover:not(:disabled) {
  background: var(--surface-container-high);
  border-color: var(--outline);
}

.find-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.find-btn.toggle {
  min-width: 32px;
  padding: 0 6px;
  font-weight: 700;
}

.find-btn.toggle.on {
  background: rgba(var(--primary-rgb) / 0.14);
  border-color: var(--primary);
  color: var(--primary);
}

.find-btn.primary {
  background: var(--primary);
  border-color: var(--primary);
  color: #fff;
}

.find-btn.primary:hover:not(:disabled) {
  background: var(--primary-container);
  border-color: var(--primary-container);
}

.find-btn.icon {
  width: 28px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

/* 预览区命中关键词高亮（v-html 内容需 :deep()） */
.markdown-body :deep(mark.find-hit) {
  background: rgb(var(--primary-rgb) / 0.26);
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}

/* 预览区当前命中：高对比底色 + 双色边框 */
.markdown-body :deep(mark.find-hit-current) {
  background: #fdba2d;
  box-shadow: 0 0 0 2px var(--on-surface), inset 0 0 0 1px #fff;
  color: var(--on-surface);
  font-weight: 700;
}

/* 命中词可能落在斜体里，荧光底会盖掉命中色，这里让命中优先。 */
.markdown-body :deep(em mark.find-hit) {
  background: rgb(var(--primary-rgb) / 0.34);
}

/* ---- 预览区「定位」强调 ----
   与编辑区的框选形成同一档视觉：主题色底 + 描边 + 两次脉冲，随后自行褪去。
   只在定位后短暂出现，不参与常态排版。 */
.markdown-body :deep(mark.rev-preview-located) {
  background: rgb(var(--primary-rgb) / 0.26);
  box-shadow: 0 0 0 2px var(--primary);
  border-radius: 3px;
  padding: 0 2px;
  color: inherit;
  animation: revPreviewPulse 0.9s ease-in-out 2;
}

@keyframes revPreviewPulse {
  0%,
  100% {
    background: rgb(var(--primary-rgb) / 0.26);
  }
  50% {
    background: rgb(var(--primary-rgb) / 0.08);
  }
}

@media (prefers-reduced-motion: reduce) {
  .markdown-body :deep(mark.rev-preview-located) {
    animation: none;
  }
}

.format-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  border-radius: 5px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease, color 0.2s ease;
}

.format-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.format-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.format-btn:disabled:hover {
  background: transparent;
  color: var(--on-surface-variant);
}

.format-btn.active {
  background: rgb(var(--primary-rgb) / 0.14);
  color: var(--primary);
}

/* 带下拉菜单的按钮：主图标 + 一枚很小的角标，宽度只多让出角标的位置。 */
.format-btn.has-menu {
  gap: 1px;
  min-width: 34px;
  padding: 0 3px;
}

.menu-caret {
  flex-shrink: 0;
  opacity: 0.62;
}

/* ---- 工具栏下拉菜单（Teleport 到 body，视口定位） ---- */
.toolbar-menu {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 148px;
  padding: 4px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px -2px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  /* 与「选中浮现工具栏」同层，压得住画布卡片编辑面板（z-index ≈ 1000）。 */
  z-index: 3000;
  user-select: none;
}

.toolbar-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.toolbar-menu-item > span:first-of-type {
  flex: 1;
  min-width: 0;
}

.toolbar-menu-item:hover {
  background: var(--surface-container-high);
}

.toolbar-menu-item.on {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.toolbar-menu-syntax {
  flex-shrink: 0;
  font-family: var(--code-font);
  font-size: 10px;
  color: var(--on-surface-variant);
}

.toolbar-menu-item.on .toolbar-menu-syntax {
  color: var(--primary);
}

/* ---- 排版与字体悬浮表单面板（Teleport 到 body，视口定位） ---- */
.typography-panel {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 250px;
  padding: 12px 14px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.2), 0 3px 8px rgba(0, 0, 0, 0.08);
  z-index: 3000;
  user-select: none;
}

.typo-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--outline-variant);
}

.typo-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.typo-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.08);
  border: 1px solid rgb(var(--primary-rgb) / 0.2);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.typo-reset-btn:hover {
  background: rgb(var(--primary-rgb) / 0.16);
  border-color: var(--primary);
}

.typo-panel-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.typo-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.typo-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface-variant, #666);
  white-space: nowrap;
}

.typo-select,
.typo-input {
  box-sizing: border-box;
  height: 28px;
  padding: 0 8px;
  font-size: 12px;
  color: var(--on-surface);
  background: var(--surface-container-low, #f5f5f5);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.typo-select {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.typo-select:focus,
.typo-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgb(var(--primary-rgb) / 0.15);
}

.typo-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100px;
}

.typo-input-wrap .typo-input {
  width: 100%;
  flex: 1;
  min-width: 0;
  text-align: right;
}

.typo-input[type="number"] {
  width: 100px;
  text-align: right;
}

.typo-unit {
  font-size: 11px;
  color: var(--on-surface-variant, #888);
}

.typo-toggle-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.typo-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--on-surface-variant);
  background: var(--surface-container-low, #f5f5f5);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
  user-select: none;
}

.typo-toggle-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.typo-toggle-btn.active {
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.1);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgb(var(--primary-rgb) / 0.12);
}

.toolbar-divider {
  width: 1px;
  height: 18px;
  background: var(--outline-variant);
  margin: 0 4px;
}

/* 内联建议条 */
.suggestion-bar {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 16px;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
  max-height: 200px;
  overflow-y: auto;
  z-index: 3;
}

.suggestion-card {
  background: var(--surface-bright);
  border: 1px solid var(--primary-fixed-dim);
  border-left: 3px solid var(--primary);
  border-radius: 8px;
  padding: 10px 12px;
  animation: slideDown 0.25s ease;
}

@keyframes slideDown {
  from { opacity: 0; transform: translateY(-8px); }
  to { opacity: 1; transform: translateY(0); }
}

.suggestion-card.accepted {
  border-left-color: #065f46;
  background: #f0fdf4;
}

.suggestion-card.dismissed {
  opacity: 0.4;
}

.suggestion-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.suggestion-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  display: flex;
  align-items: center;
  gap: 4px;
}

.suggestion-actions {
  display: flex;
  gap: 4px;
}

.sug-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
}

.sug-btn.accept {
  background: #d1fae5;
  color: #065f46;
}

.sug-btn.accept:hover {
  background: #065f46;
  color: #fff;
}

.sug-btn.reject {
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.sug-btn.reject:hover {
  background: var(--error-container);
  color: var(--error);
}

.suggestion-body {
  font-size: 13px;
  line-height: 1.7;
  color: var(--on-surface);
  margin-bottom: 6px;
}

.suggestion-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 10px;
  color: var(--on-surface-variant);
}

.suggestion-habit {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.suggestion-strength {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.strength-bar {
  width: 40px;
  height: 3px;
  border-radius: 2px;
  background: var(--surface-container);
  overflow: hidden;
}

.strength-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--primary);
}

/* ---------- 原有编辑器样式 ---------- */
.doc-scroll {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
}

.panes {
  display: flex;
  gap: 0;
  align-items: stretch;
  height: 100%;
  min-height: 0;
}

.panes.split .editor-pane,
.panes.split .preview-pane {
  min-width: 0;
}

.panes.split .editor-pane {
  flex: 0 0 calc(var(--split-ratio, 50%));
  width: calc(var(--split-ratio, 50%));
}

.panes.split .preview-pane {
  flex: 1 1 auto;
  min-width: 0;
}

.panes.preview-only .preview-pane {
  width: 100%;
  max-width: none;
}

.panes.editor-only .editor-pane {
  flex: 1 1 100%;
  width: 100%;
}

.split-divider {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 3;
  transition: background 0.2s ease;
}

/* 编辑 / 预览之间的分隔条：与阅读面同一档边框色。 */
.split-divider::after {
  content: "";
  position: absolute;
  left: 2px;
  top: 0;
  bottom: 0;
  width: 2px;
  background: var(--reading-border);
  border-radius: 1px;
}

.split-divider:hover::after,
.split-divider.dragging::after {
  background: var(--primary);
}

.editor-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  /* 与预览区同一档纸面色，编辑 / 预览来回切换时底色不跳。 */
  background: var(--reading-surface);
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.editor-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--reading-border);
  font-family: var(--code-font);
  font-size: 11px;
  color: var(--on-surface-variant);
  background: var(--reading-surface);
  flex-shrink: 0;
  /* 字符统计所在的窄面板整体压到 90% 不透明度，让它比正文更后退一层。 */
  opacity: 0.9;
}

.editor-meta-left {
  display: flex;
  align-items: center;
}

.editor-meta-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.habit-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  color: var(--primary);
  font-weight: 600;
}

/* Markdown 源码区：等宽字 + 更松的行距与更安静的纸面，长时间写作不累。
   左右留白让行长收在阅读宽度内（度量见 .editor-wrap 的变量）。
   底部额外叠一段 --ed-runway（打字机滚动的末尾跑道）：正文写到最后一行时，
   仍有余量把这一行滚到编辑区中部，不必贴着底边写字。 */
.editor-textarea {
  flex: 1;
  width: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: var(--ed-pad-y) var(--ed-pad-x) calc(var(--ed-pad-y) + var(--ed-runway, 0px));
  background: transparent;
  color: var(--reading-text);
  caret-color: var(--primary);
  font-family: var(--code-font);
  line-height: var(--ed-line-height-px, calc(var(--ed-font-size, 16px) * var(--ed-line-height, 1.75)));
  letter-spacing: -0.004em;
  tab-size: 2;
  /* 编辑区唯一的滚动条。父级 .editor-wrap 必须 overflow: hidden，否则会多出
     一条由高亮覆盖层撑开的容器滚动条。 */
  overflow-y: auto;
  overflow-x: hidden;
  position: relative;
  z-index: 2;
}

.editor-textarea::selection {
  background: rgb(var(--primary-rgb) / 0.16);
}

/* 编辑区容器：滚动一律交给 textarea 自己，本容器必须 overflow: hidden。
   高亮覆盖层是 absolute 定位、高度等于全文内容，若容器可滚动，它就会把容器
   自身的滚动条也撑出来 —— 表现为编辑区里并排两条长短不一的滚动条（覆盖层与
   textarea 的可滚动高度并不相同）。覆盖层的位置由 onEditorScroll 里手动
   translate 同步，容器一旦自己滚动反而会双重偏移。
   排版度量收在这一组变量里，textarea 与覆盖层共用，避免两边各自改动后错位。 */
.editor-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
  --ed-line-height: 1.75;
  --ed-line-height-px: 28px;
  --ed-pad-y: 26px;
  /* 行长收在阅读宽度内并居中；窄栏时退回固定边距。 */
  --ed-pad-x: max(22px, calc((100% - var(--reading-measure)) / 2));
}

/* 文档界面拖入 AI 回复时，编辑区随指针悬停高亮：清晰提示松开即可原地插入。 */
.editor-wrap.doc-drag-hover {
  box-shadow: inset 0 0 0 2px rgb(var(--primary-rgb) / 0.7);
  background: rgb(var(--primary-rgb) / 0.04);
  transition: box-shadow 0.12s ease, background 0.12s ease;
}

/* ---------------- 块拖拽：行句柄 + 插入提示线 + 跟随贴片 ---------------- */

.block-drag-handle {
  position: absolute;
  left: 2px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  /* 高度由脚本按该行真实行高设定（内联 style），图标在行框内垂直居中，
     因此句柄始终落在悬浮那一行文字的中线上，而不是贴在行顶。
     这里的 16px 只是行高还没量出来时的兜底。 */
  height: 16px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  opacity: 0.9;
  cursor: grab;
  padding: 0;
  transition: color 0.12s ease, opacity 0.12s ease;
}

.block-drag-handle:hover {
  color: var(--primary);
  opacity: 1;
}

.block-drag-handle:active {
  cursor: grabbing;
}

.block-insertion-line {
  position: absolute;
  left: var(--ed-pad-x, 22px);
  right: var(--ed-pad-x, 22px);
  z-index: 7;
  height: 0;
  display: flex;
  align-items: center;
  pointer-events: none;
}

.insertion-line-bar {
  flex: 1;
  height: 2px;
  background: var(--primary);
  box-shadow: 0 0 6px rgb(var(--primary-rgb) / 0.55);
  border-radius: 2px;
}

.insertion-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
  box-shadow: 0 0 5px rgb(var(--primary-rgb) / 0.6);
}

.block-drag-ghost {
  position: fixed;
  z-index: 9999;
  transform: translate(12px, -50%);
  max-width: 320px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--surface-bright, #fff);
  box-shadow: 0 10px 26px -6px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.block-drag-ghost-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
}

.block-drag-ghost-text {
  font-size: 12px;
  color: var(--on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 选中文字浮现工具栏：Teleport 到 body，position: fixed 视口定位，
   跟随光标出现在选中文字上方，四边框自适应方向并始终完整单排显示。 */
.floating-selection-bar {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 1px;
  padding: 3px 4px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px -2px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  /* 层级需高于「写作画布卡片编辑面板」等 Teleport 层（z-index ≈ 1000），
     否则在文本卡片编辑区选中的浮现工具栏会被面板压住无法呈现。 */
  z-index: 3000;
  user-select: none;
  backdrop-filter: blur(8px);
}

.selection-bar-btn {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  flex: 0 0 auto;
  white-space: nowrap;
}

/* 视口过窄/编辑区窄时进一步收紧间距与字号，保持横向单排、文字显示完整；
   极窄时允许横向滚动（仍不换行竖排）。 */
.floating-selection-bar.compact {
  padding: 2px 3px;
  gap: 0;
  max-width: calc(100vw - 12px);
  overflow-x: auto;
  scrollbar-width: none;
}

.floating-selection-bar.compact::-webkit-scrollbar {
  display: none;
}

.floating-selection-bar.compact .selection-bar-btn {
  padding: 2px 6px;
  font-size: 11px;
}

.selection-bar-btn:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.selection-bar-btn.danger:hover {
  background: var(--error-container);
  color: var(--error);
}

.selection-bar-btn.menu {
  padding: 3px 6px;
  color: var(--on-surface-variant);
}
.selection-bar-btn.menu:hover {
  color: var(--primary);
}

/* 更多文本处理菜单面板：与浮现工具栏同样式，Teleport 到 body、置于其下方。 */
.selection-more-menu {
  position: fixed;
  top: 0;
  left: 0;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  min-width: 168px;
  padding: 4px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 8px 24px -2px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  z-index: 3000;
  user-select: none;
  backdrop-filter: blur(8px);
}

.selection-more-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}
.selection-more-item:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}
.selection-more-item .lucide {
  flex: 0 0 auto;
}

.menu-case-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: -0.5px;
}
.menu-case-glyph.caps {
  text-transform: uppercase;
}
.menu-space-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  padding: 0 2px;
  height: 16px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 10px;
  font-weight: 600;
  background: var(--surface-container);
  border-radius: 3px;
  color: var(--on-surface-variant);
}

.selection-more-back {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  padding: 7px 10px;
  border: none;
  border-top: 1px solid var(--outline-variant);
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
  transition: color 0.15s ease;
}
.selection-more-back:hover {
  color: var(--primary);
}

/* 退出禅定模式悬浮胶囊：居中置顶，绝不遮挡右上角的阅读进度圆环 */
.zen-exit-pill {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright, #ffffff);
  color: var(--on-surface-variant);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
  transition: all 0.2s ease;
  backdrop-filter: blur(8px);
}

.zen-exit-pill:hover {
  background: var(--surface-container-high);
  color: var(--primary);
  border-color: var(--primary);
}

/* ---------------- 段落聚光灯 (Spotlight) ---------------- */
.editor-wrap.spotlight-on .editor-textarea {
  color: transparent !important;
  caret-color: var(--primary) !important;
}

.editor-highlights :deep(.spotlight-active-line) {
  color: var(--reading-text) !important;
  opacity: 1 !important;
  filter: none !important;
  font-weight: 500;
  text-shadow: 0 0 1px rgba(0, 0, 0, 0.12);
  transition: opacity 0.2s ease, filter 0.2s ease;
}

.editor-highlights :deep(.spotlight-dim-line) {
  color: var(--reading-text) !important;
  opacity: calc(v-bind('aiSettings.spotlightOpacity') / 100) !important;
  filter: blur(calc(v-bind('aiSettings.spotlightBlur') * 1px)) grayscale(0.2) !important;
  transition: opacity 0.2s ease, filter 0.2s ease;
  user-select: none;
}

/* 预览区聚光灯：默认除当前段落外，其他直接子元素蒙罩虚化 */
.preview-pane.spotlight-on :deep(.reading-view > *) {
  opacity: calc(v-bind('aiSettings.spotlightOpacity') / 100) !important;
  filter: blur(calc(v-bind('aiSettings.spotlightBlur') * 1px)) grayscale(0.2) !important;
  transition: opacity 0.22s ease, filter 0.22s ease, transform 0.22s ease;
  user-select: none;
}

.preview-pane.spotlight-on :deep(.reading-view > *:hover),
.preview-pane.spotlight-on :deep(.reading-view > *.spotlight-target) {
  opacity: 1 !important;
  filter: none !important;
  transform: scale(1.008);
  color: var(--reading-text) !important;
  user-select: text;
}

/* ---------------- 内容上色（抓阄配色） ----------------
   着色规则已上移到 style.css 全局，供文档预览与手机模拟预览共用；
   颜色值经 contentColorCssVars() 以 --zj-* 变量挂在这棵子树上。 */

/* 嵌入式小编辑框（画布卡片 / 拼接弹窗）：面板本身就窄，留白收紧一档，
   否则可写区域会被居中留白吃掉太多。 */
.document-viewer.embedded .editor-wrap {
  --ed-pad-y: 18px;
  --ed-pad-x: 18px;
}

.editor-highlights {
  position: absolute;
  top: 0;
  left: 0;
  padding: var(--ed-pad-y) var(--ed-pad-x);
  min-width: 100%;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-wrap: break-word;
  overflow-wrap: break-word;
  line-height: var(--ed-line-height-px, calc(var(--ed-font-size, 16px) * var(--ed-line-height, 1.75)));
  tab-size: 2;
  color: transparent;
  pointer-events: none;
  will-change: transform;
  z-index: 1;
}

/* v-html 注入的内容不带 scoped 属性，必须用 :deep() 才能命中 */
.editor-highlights :deep(mark.find-hit) {
  background: rgb(var(--primary-rgb) / 0.28);
  border-radius: 2px;
  color: transparent;
}

/* 当前命中：高对比底色 + 双色边框，明显区别于其余命中 */
.editor-highlights :deep(mark.find-hit-current) {
  background: #fdba2d;
  box-shadow: 0 0 0 2px var(--on-surface), inset 0 0 0 1px #fff;
  border-radius: 2px;
  color: transparent;
}

/* 当前命中所在行：整行浅色底 + 左侧色条 */
.editor-highlights :deep(.find-line-current) {
  background: rgb(var(--primary-rgb) / 0.1);
  box-shadow: inset 2px 0 0 var(--primary);
}

/* ---- 修订与批注在编辑区的视觉落差 ----
   编辑区始终显示原文，被纳入图层的那段原文带上底色与下划线，一眼能看出
   哪几段已经提过修订 / 批注。文字本身透明（真正的字由下方 textarea 呈现），
   所以这里只调底色，不动字色。 */
.editor-highlights :deep(mark.rev-mark) {
  background: rgb(var(--primary-rgb) / 0.16);
  box-shadow: inset 0 -2px 0 rgb(var(--primary-rgb) / 0.55);
  border-radius: 2px;
  color: transparent;
}

/* 纯批注（没改字）：换成次要色，与「已提修订」区分开。 */
.editor-highlights :deep(mark.rev-mark-comment) {
  background: rgb(79 70 229 / 0.13);
  box-shadow: inset 0 -2px 0 rgb(79 70 229 / 0.5);
}

/* 小眼睛关掉的图层：底色淡下去，表示它当前不影响预览正文。 */
.editor-highlights :deep(mark.rev-mark-hidden) {
  background: rgb(var(--primary-rgb) / 0.07);
  box-shadow: inset 0 -1px 0 rgb(var(--primary-rgb) / 0.28);
}

/* 查找命中落在修订区间里时，命中色要压住修订底色。 */
.editor-highlights :deep(mark.rev-mark.find-hit) {
  background: rgb(var(--primary-rgb) / 0.36);
}

/* 刚被「定位」按钮跳到的那段：短暂加一道描边强调，2 秒后自行褪去。 */
.editor-highlights :deep(mark.rev-mark-located) {
  background: rgb(var(--primary-rgb) / 0.3);
  box-shadow: inset 0 0 0 1.5px var(--primary);
  animation: revLocatePulse 0.9s ease-in-out 2;
}

@keyframes revLocatePulse {
  0%,
  100% {
    background: rgb(var(--primary-rgb) / 0.3);
  }
  50% {
    background: rgb(var(--primary-rgb) / 0.12);
  }
}

@media (prefers-reduced-motion: reduce) {
  .editor-highlights :deep(mark.rev-mark-located) {
    animation: none;
  }
}

.editor-highlights:empty {
  display: none;
}

.font-size-select,
.font-family-select {
  appearance: auto;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 12px;
  padding: 2px 4px;
  outline: none;
  cursor: pointer;
  margin: 0 2px;
}

.font-family-select {
  max-width: 132px;
  font-family: inherit;
}

.font-size-select:hover,
.font-family-select:hover {
  background: var(--surface-container-high);
}

.preview-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.preview-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--reading-border);
  font-family: var(--code-font);
  font-size: 11px;
  color: var(--on-surface-variant);
  background: var(--reading-surface);
  flex-shrink: 0;
  /* 与 markdown 侧的窄面板同一档：整体 90% 不透明度。 */
  opacity: 0.9;
}

.preview-meta-label {
  font-weight: 600;
  color: var(--primary);
}

.preview-timestamp {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-meta-right {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

/* 「内容上色」切换按钮：默认取主题色，开启时点亮主题色、按下有实体感。 */
.color-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--reading-border);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-family: var(--code-font);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.color-toggle:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.color-toggle.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-fixed);
}

.sync-select {
  appearance: auto;
  border: 1px solid var(--reading-border);
  border-radius: 4px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-family: var(--code-font);
  font-size: 11px;
  padding: 2px 6px;
  outline: none;
  cursor: pointer;
}

.preview-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 纸面略暗于纯白（Obsidian 阅读配色的做法），长时间阅读更省眼；
     正文卡片本身仍是亮面，两者叠出一层浅浅的纸感。 */
  background: var(--reading-surface);
}

/* 阅读纸面：正文宽度收在 --reading-measure 内并居中，行长过长会显著拖慢阅读。
   上下留白给足，让最后一段也能滚到视线舒服的位置。 */
.paper-card {
  background: transparent;
  width: 100%;
  max-width: var(--reading-measure);
  min-height: 100%;
  box-sizing: border-box;
  padding: 26px 40px 96px;
  border: none;
  border-radius: 0;
  margin: 0 auto;
}

/* 窄栏 / 分栏时收紧左右留白，避免正文被挤成一条。 */
@media (max-width: 900px) {
  .paper-card {
    padding: 30px 22px 72px;
  }
}

/* 右键菜单 */
.ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 160px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  padding: 4px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  font-size: 13px;
  color: var(--on-surface);
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.ctx-item:hover {
  background: var(--surface-container-high);
}

/* 右键菜单里的快捷键提示，靠右对齐、不抢主标签。 */
.ctx-shortcut {
  margin-left: auto;
  padding-left: 10px;
  font-family: var(--code-font);
  font-size: 10.5px;
  color: var(--reading-text-faint);
  white-space: nowrap;
}

/* 预览区标题旁的「修订生效中」提示。 */
.revision-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-size: 10.5px;
  font-weight: 600;
}

.ctx-divider {
  height: 1px;
  background: var(--outline-variant);
  margin: 4px 8px;
}

/* Toast 通知 */
.learning-toast {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--surface-bright);
  border: 1px solid var(--primary);
  border-radius: 12px;
  padding: 12px 20px;
  display: flex;
  align-items: center;
  gap: 10px;
  box-shadow: 0 8px 32px rgb(var(--primary-rgb) / 0.15);
  z-index: 200;
  font-size: 13px;
  color: var(--on-surface);
  cursor: pointer;
  max-width: 480px;
}

.toast-icon {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.toast-icon.habit {
  background: var(--primary-fixed-dim);
  color: var(--primary);
}

.toast-icon.edit {
  background: var(--error-container);
  color: var(--error);
}

.toast-icon.style {
  background: #d1fae5;
  color: #065f46;
}

.toast-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.toast-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
}

.confirm-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.confirm-modal-shell {
  width: 380px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.confirm-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--outline-variant);
}

.confirm-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
}

.confirm-close-btn {
  background: transparent;
  border: none;
  color: var(--on-surface-variant);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-close-btn:hover {
  background: var(--surface-container-high);
}

.confirm-modal-body {
  padding: 16px;
  font-size: 13px;
  line-height: 20px;
  color: var(--on-surface-variant);
}

.confirm-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  background: var(--surface-container-lowest);
  border-top: 1px solid var(--outline-variant);
}

.confirm-btn {
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s ease;
}

.confirm-btn.cancel {
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.confirm-btn.cancel:hover {
  background: var(--surface-container-high);
}

.confirm-btn.danger {
  background: var(--error, #dc2626);
  color: #ffffff;
}

.confirm-btn.danger:hover {
  opacity: 0.9;
}

.toast-desc {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.35s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(16px);
}

/* ---- 背景网格线（仅对编辑区生效：.editor-textarea 与 .editor-layer） ---- */
.grid-line-solid .editor-textarea,
.grid-line-solid .editor-layer {
  background-image: linear-gradient(
    to bottom,
    transparent calc(100% - 1px),
    var(--grid-line-color, rgba(140, 140, 140, 0.35)) 1px
  );
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 var(--ed-pad-y, 26px);
  background-attachment: local;
  background-repeat: repeat-y;
}

.grid-line-dashed .editor-textarea,
.grid-line-dashed .editor-layer {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' overflow='visible'%3E%3Cline x1='0' y1='calc(100%25 - 0.5px)' x2='100%25' y2='calc(100%25 - 0.5px)' stroke='rgba(120, 120, 120, 0.55)' stroke-width='1' stroke-dasharray='6 3' shape-rendering='crispEdges'/%3E%3C/svg%3E");
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 var(--ed-pad-y, 26px);
  background-attachment: local;
  background-repeat: repeat-y;
}

.grid-line-dotted .editor-textarea,
.grid-line-dotted .editor-layer {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' overflow='visible'%3E%3Cline x1='0' y1='calc(100%25 - 0.5px)' x2='100%25' y2='calc(100%25 - 0.5px)' stroke='rgba(110, 110, 110, 0.65)' stroke-width='1.2' stroke-dasharray='2 3' shape-rendering='crispEdges'/%3E%3C/svg%3E");
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 var(--ed-pad-y, 26px);
  background-attachment: local;
  background-repeat: repeat-y;
}
</style>