<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch, type ComponentPublicInstance, type Ref } from "vue";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRightLeft,
  ArrowUp,
  BookOpen,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  Coins,
  Copy,
  Dices,
  Eraser,
  FilePlus,
  FileText,
  FastForward,
  Folder,
  FolderPlus,
  CaseSensitive,
  Globe,
  GripVertical,
  History,
  Indent,
  MessageSquare,
  Palette,
  Pencil,
  Plus,
  Quote,
  RefreshCw,
  RotateCcw,
  Scissors,
  Sparkles,
  Square,
  CheckSquare,
  Shield,
  Trash2,
  Type,
  UserRound,
  Wand2,
  WrapText,
  X,
} from "lucide-vue-next";
import {
  activateProviderProfile,
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
  providerLabel,
  type EditorGridLine,
} from "../settings";
import { ensureLocalFonts, fontState } from "../fonts";
import { materialStore, toggleMaterial } from "../materialStore";
import { CHARACTER_ARCHETYPES, STORY_PLOTS } from "../storyStore";
import {
  NARRATIVE_ENDINGS,
  NARRATIVE_STRUCTURES,
  NARRATIVE_TECHNIQUES,
} from "../narrativeStore";
import { looksUnfinished, runAgent, type AgentTurn } from "../agentRunner";
import {
  describeKnowledgeToolCall,
  inlineKnowledgeFallback,
  isToolUnsupportedError,
  knowledgeList,
  knowledgeManifest,
  knowledgeToolDefinitions,
  runKnowledgeTool,
  type KnowledgeScope,
  type ToolDefinition,
} from "../knowledgeTools";
import {
  describeWebSearchToolCall,
  isWebSearchTool,
  runWebSearch,
  webSearchToolDefinitions,
} from "../webSearch";
import {
  autoStore,
  bootAutoStore,
  type AiTurn,
  type AutoSessionArchive,
  type AutoSetupState,
  type DraftFolder,
  type ToolTrace,
} from "../autoStore";
import {
  resolveAutoScrollTop,
  setAutoReadingPosition,
} from "../autoReadingPosition";
import {
  MERGE_MAX_LIMIT,
  MERGE_MIN_LIMIT,
  randomizeLayout,
  SHORT_LINE_MAX_LIMIT,
  SHORT_LINE_MIN_LIMIT,
} from "../randomLayout";
import {
  cleanParticles,
  PARTICLES,
  type CleanupMode,
  type Particle,
} from "../particleCleanup";
import { WRITER_AGENT_PROMPT } from "../prompts/writerAgent";
import { CHAPTER_OUTLINE_AGENT_PROMPT } from "../prompts/chapterOutlineAgent";
import { AUDITOR_AGENT_PROMPT } from "../prompts/auditorAgent";
import { READER_AGENT_PROMPT } from "../prompts/readerAgent";
import { CHAT_AGENT_PROMPT } from "../prompts/chatAgent";
import { REFINE_AGENT_PROMPT } from "../prompts/refineAgent";
import { showToast } from "../insightStore";
import { recordTokens } from "../tokenStore";
import { renderForReading } from "../markdown";
import {
  applyContentColoring,
  contentColorCssVars,
  contentColoringOn,
} from "../contentColoring";
import { docStore } from "../docStore";
import { createDocFile, documentFilesStore } from "../documentFilesStore";
import { pulseAiDocEdit } from "../aiDocActivity";
import { startLongPressDrag } from "../longPressDrag";
import ReaderResultInline from "./ReaderResultInline.vue";
import AutoBlankDoc from "./auto-view/AutoBlankDoc.vue";
import AutoWorkflowBar, { type WorkflowStepId } from "./auto-view/AutoWorkflowBar.vue";
import AutoStoryStateTracker from "./auto-view/AutoStoryStateTracker.vue";
import { storyStateStore } from "./auto-view/storyStateStore";
import {
  liveHtmlToMarkdown,
  liveNodeToMarkdown,
  markdownToLiveHtml,
  serializeLiveBlock,
} from "./MarkdownWysiwyg.vue";

/* Form state synced with persistent autoStore */
const topicContent = toRef(autoStore, "topicContent");
const writingMode = toRef(autoStore, "writingMode");
const targetWordCount = toRef(autoStore, "targetWordCount");
const outputTargetType = toRef(autoStore, "outputTargetType");
const articleLength = toRef(autoStore, "articleLength");
const newSourceText = ref("");

/* ---------------- 左右面板宽度：默认左 230px / 右 390px，支持拖拽与持久化 ---------------- */
const DEFAULT_LEFT_WIDTH = 230;
const DEFAULT_RIGHT_WIDTH = 390;
const LEFT_MIN = 180;
const LEFT_MAX = 400;
const RIGHT_MIN = 320;
const RIGHT_MAX = 560;

const STORAGE_KEY_LEFT_WIDTH = "auto_panel_left_width_v2";
const STORAGE_KEY_RIGHT_WIDTH = "auto_panel_right_width_v2";

function loadSavedPanelWidth(key: string, fallback: number, min: number, max: number): number {
  try {
    const val = localStorage.getItem(key);
    if (!val) return fallback;
    const parsed = parseInt(val, 10);
    if (isNaN(parsed)) return fallback;
    return clampWidth(parsed, min, max);
  } catch {
    return fallback;
  }
}

const leftWidth = ref(loadSavedPanelWidth(STORAGE_KEY_LEFT_WIDTH, DEFAULT_LEFT_WIDTH, LEFT_MIN, LEFT_MAX));
const rightWidth = ref(loadSavedPanelWidth(STORAGE_KEY_RIGHT_WIDTH, DEFAULT_RIGHT_WIDTH, RIGHT_MIN, RIGHT_MAX));
const resizingSide = ref<"left" | "right" | null>(null);

const isRightPanelCollapsed = ref(false);

function toggleRightPanel() {
  isRightPanelCollapsed.value = !isRightPanelCollapsed.value;
}

function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)));
}

function startPanelResize(side: "left" | "right", event: MouseEvent) {
  event.preventDefault();
  resizingSide.value = side;

  const startX = event.clientX;
  const startLeft = leftWidth.value;
  const startRight = rightWidth.value;

  const onMove = (e: MouseEvent) => {
    const delta = e.clientX - startX;
    if (side === "left") {
      leftWidth.value = clampWidth(startLeft + delta, LEFT_MIN, LEFT_MAX);
      try {
        localStorage.setItem(STORAGE_KEY_LEFT_WIDTH, String(leftWidth.value));
      } catch {
        // ignore
      }
    } else {
      /* 右栏分隔线往左拖 = 变宽，所以取反。*/
      rightWidth.value = clampWidth(startRight - delta, RIGHT_MIN, RIGHT_MAX);
      try {
        localStorage.setItem(STORAGE_KEY_RIGHT_WIDTH, String(rightWidth.value));
      } catch {
        // ignore
      }
    }
  };

  const onUp = () => {
    resizingSide.value = null;
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/** 双击分隔线复位到默认宽度。*/
function resetPanelWidth(side: "left" | "right") {
  if (side === "left") {
    leftWidth.value = DEFAULT_LEFT_WIDTH;
    try {
      localStorage.setItem(STORAGE_KEY_LEFT_WIDTH, String(DEFAULT_LEFT_WIDTH));
    } catch {
      // ignore
    }
  } else {
    rightWidth.value = DEFAULT_RIGHT_WIDTH;
    try {
      localStorage.setItem(STORAGE_KEY_RIGHT_WIDTH, String(DEFAULT_RIGHT_WIDTH));
    } catch {
      // ignore
    }
  }
}

/* ---------------- 中间区创作设定表单（无正文时呈现） ----------------
   出现逻辑：中间区没有任何输出（!hasOutput && !isGenerating）时呈现；
   点击「开始处理」后随输出接管而自动消退，让位给思考链与正文；
   清空正文（clearOutput）后重新出现，用户可再次调整设定。*/
interface SetupOption {
  id: string;
  label: string;
}

const GENRE_OPTIONS: SetupOption[] = [
  { id: "genre_fantasy", label: "玄幻" },
  { id: "genre_xianxia", label: "仙侠" },
  { id: "genre_urban", label: "都市" },
  { id: "genre_scifi", label: "科幻" },
  { id: "genre_suspense", label: "悬疑" },
  { id: "genre_history", label: "历史" },
  { id: "genre_game", label: "游戏竞技" },
  { id: "genre_romance", label: "言情" },
  { id: "genre_infinite", label: "无限流" },
  { id: "genre_realistic", label: "现实" },
];

const CHANNEL_OPTIONS: SetupOption[] = [
  { id: "channel_male", label: "男频" },
  { id: "channel_female", label: "女频" },
  { id: "channel_general", label: "不限" },
];

const PERSON_OPTIONS: SetupOption[] = [
  { id: "person_first", label: "第一人称" },
  { id: "person_third_limited", label: "第三人称限知" },
  { id: "person_third_omniscient", label: "第三人称全知" },
  { id: "person_second", label: "第二人称" },
];

const TENSE_OPTIONS: SetupOption[] = [
  { id: "tense_past", label: "过去时" },
  { id: "tense_present", label: "现在时" },
];

const TONE_OPTIONS: SetupOption[] = [
  { id: "tone_cold", label: "冷峻克制" },
  { id: "tone_warm", label: "温情治愈" },
  { id: "tone_humor", label: "幽默轻快" },
  { id: "tone_epic", label: "宏大史诗" },
  { id: "tone_dark", label: "阴郁压抑" },
  { id: "tone_sensual", label: "细腻感性" },
];

const PACE_OPTIONS: SetupOption[] = [
  { id: "pace_fast", label: "快节奏爽文" },
  { id: "pace_medium", label: "张弛有度" },
  { id: "pace_slow", label: "慢热沉浸" },
];

const CONFLICT_OPTIONS: SetupOption[] = [
  { id: "conflict_extreme", label: "极端绝境压迫" },
  { id: "conflict_dilemma", label: "两难道德撕裂" },
  { id: "conflict_undercurrent", label: "暗流心理博弈" },
  { id: "conflict_reversal", label: "反差失衡冲击" },
  { id: "conflict_fate", label: "宿命因果对决" },
];

const FOCUS_OPTIONS: SetupOption[] = [
  { id: "focus_plot", label: "事件驱动·悬念反转" },
  { id: "focus_character", label: "人物弧光·心理潜流" },
  { id: "focus_dialogue", label: "言语交锋·潜台词" },
  { id: "focus_atmosphere", label: "意境描摹·沉浸通感" },
  { id: "focus_world", label: "世界演化·法则推演" },
];

const setupGenre = computed({
  get: () => autoStore.setup.genre,
  set: (val) => (autoStore.setup.genre = val),
});
const setupChannel = computed({
  get: () => autoStore.setup.channel,
  set: (val) => (autoStore.setup.channel = val),
});
const setupPerson = computed({
  get: () => autoStore.setup.person,
  set: (val) => (autoStore.setup.person = val),
});
const setupTense = computed({
  get: () => autoStore.setup.tense,
  set: (val) => (autoStore.setup.tense = val),
});
const setupTone = computed({
  get: () => autoStore.setup.tone,
  set: (val) => (autoStore.setup.tone = val),
});
const setupPace = computed({
  get: () => autoStore.setup.pace,
  set: (val) => (autoStore.setup.pace = val),
});
const setupConflict = computed({
  get: () => autoStore.setup.conflict,
  set: (val) => (autoStore.setup.conflict = val),
});
const setupFocus = computed({
  get: () => autoStore.setup.focus,
  set: (val) => (autoStore.setup.focus = val),
});

/* 题材 / 整体基调 / 核心冲突 / 侧重重心 / 叙事节奏 的自定义表单项状态 */
const customSetupActive = ref<Record<string, boolean>>({
  genre: false,
  tone: false,
  conflict: false,
  focus: false,
  pace: false,
});

const customSetupValues = ref<Record<string, string>>({
  genre: "",
  tone: "",
  conflict: "",
  focus: "",
  pace: "",
});

function isSetupPreset(options: SetupOption[], val: string): boolean {
  return options.some((o) => o.id === val);
}

function initCustomSetupFromStore() {
  if (setupGenre.value && !isSetupPreset(GENRE_OPTIONS, setupGenre.value)) {
    customSetupActive.value.genre = true;
    customSetupValues.value.genre = setupGenre.value;
  }
  if (setupTone.value && !isSetupPreset(TONE_OPTIONS, setupTone.value)) {
    customSetupActive.value.tone = true;
    customSetupValues.value.tone = setupTone.value;
  }
  if (setupConflict.value && !isSetupPreset(CONFLICT_OPTIONS, setupConflict.value)) {
    customSetupActive.value.conflict = true;
    customSetupValues.value.conflict = setupConflict.value;
  }
  if (setupFocus.value && !isSetupPreset(FOCUS_OPTIONS, setupFocus.value)) {
    customSetupActive.value.focus = true;
    customSetupValues.value.focus = setupFocus.value;
  }
  if (setupPace.value && !isSetupPreset(PACE_OPTIONS, setupPace.value)) {
    customSetupActive.value.pace = true;
    customSetupValues.value.pace = setupPace.value;
  }
}

type SetupKey =
  | "genre"
  | "channel"
  | "person"
  | "tense"
  | "tone"
  | "pace"
  | "conflict"
  | "focus";

/** 单选式设定项：再次点击同一项即取消选择。
    模板里 ref 会被自动解包，因此这里按 key 寻址而不是直接传 ref。*/
function pickSetup(key: SetupKey, id: string) {
  const current = autoStore.setup[key];
  autoStore.setup[key] = current === id ? "" : id;
}

function pickSetupPreset(key: SetupKey, id: string) {
  if (customSetupActive.value[key]) {
    customSetupActive.value[key] = false;
    customSetupValues.value[key] = "";
  }
  pickSetup(key, id);
}

function toggleCustomSetup(key: "genre" | "tone" | "conflict" | "focus" | "pace") {
  customSetupActive.value[key] = !customSetupActive.value[key];
  if (customSetupActive.value[key]) {
    autoStore.setup[key] = customSetupValues.value[key].trim();
  } else {
    autoStore.setup[key] = "";
    customSetupValues.value[key] = "";
  }
}

function onCustomSetupInput(key: "genre" | "tone" | "conflict" | "focus" | "pace") {
  autoStore.setup[key] = customSetupValues.value[key].trim();
}

function labelOf(options: SetupOption[], id: string): string {
  if (!id) return "";
  const found = options.find((o) => o.id === id);
  return found ? found.label : id;
}

/** 已选设定项的数量，用于顶部计数提示。*/
const setupSelectedCount = computed(
  () =>
    [
      setupGenre.value,
      setupChannel.value,
      setupPerson.value,
      setupTense.value,
      setupTone.value,
      setupPace.value,
      setupConflict.value,
      setupFocus.value,
    ].filter(Boolean).length
);

function resetSetup() {
  setupGenre.value = "";
  setupChannel.value = "";
  setupPerson.value = "";
  setupTense.value = "";
  setupTone.value = "";
  setupPace.value = "";
  setupConflict.value = "";
  setupFocus.value = "";
  for (const k of Object.keys(customSetupActive.value)) {
    customSetupActive.value[k] = false;
    customSetupValues.value[k] = "";
  }
  showToast("已重置", "创作设定已全部清空", "edit");
}

/** 把创作设定拼成注入提示词的段落；一项都没选时返回空串。*/
function buildSetupDirective(): string {
  const rows: string[] = [];
  const push = (name: string, options: SetupOption[], id: string) => {
    const label = labelOf(options, id);
    if (label) rows.push(`- ${name}：${label}`);
  };
  push("题材", GENRE_OPTIONS, setupGenre.value);
  push("频道定位", CHANNEL_OPTIONS, setupChannel.value);
  push("叙事人称", PERSON_OPTIONS, setupPerson.value);
  push("叙事时态", TENSE_OPTIONS, setupTense.value);
  push("核心冲突", CONFLICT_OPTIONS, setupConflict.value);
  push("侧重重心", FOCUS_OPTIONS, setupFocus.value);
  push("整体基调", TONE_OPTIONS, setupTone.value);
  push("叙事节奏", PACE_OPTIONS, setupPace.value);
  if (rows.length === 0) return "";
  return "【创作设定】\n" + rows.join("\n");
}

/* ---------------- Left Panel: Tabs for Source Material and Drafts ----------------
   左侧面板当前激活的标签页（素材来源 / 文稿 / 状态表）与文件夹折叠状态都要跨会话持久化，
   重启后保持用户上次的选择（由 autoStore 统一落库）。 */
const leftTabState = ref<"source" | "drafts" | "state">(
  (autoStore.leftPanelTab as any) || "source"
);
const leftActiveTab = computed<"source" | "drafts" | "state">({
  get: () => leftTabState.value,
  set: (val) => {
    leftTabState.value = val;
    if (val === "source" || val === "drafts") {
      autoStore.leftPanelTab = val;
    }
  },
});

/* ---------------- Left Panel: Session-only Temporary Source Material Input (解耦) ---------------- */
const sessionSources = toRef(autoStore, "sessionSources");

function addSourceMaterial() {
  const text = newSourceText.value.trim();
  if (!text) {
    showToast("提示", "请先输入素材内容", "edit");
    return;
  }
  const titleText = text.length > 14 ? text.slice(0, 14) + "…" : text;
  sessionSources.value.push({
    id: `session_mat_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    title: titleText,
    content: text,
    selected: true,
  });
  newSourceText.value = "";
  showToast("已添加临时素材", `「${titleText}」仅用于当前会话`, "habit");
}

function toggleSessionSource(id: string) {
  const item = sessionSources.value.find((s) => s.id === id);
  if (item) item.selected = !item.selected;
}

function removeSessionSource(id: string) {
  sessionSources.value = sessionSources.value.filter((s) => s.id !== id);
}

const selectedSessionSources = computed(() =>
  sessionSources.value.filter((s) => s.selected)
);

/* ---------------- Categorized Option Groups & Pagination with (x/y) counters ---------------- */

/* 每组固定呈现 3 项，支持上一组 / 下一组 / 换一换 三种翻页方式。
   offset 始终对齐到 3 的倍数，保证 (x/y) 页码与实际呈现一致。 */
const PAGE_SIZE = 3;

/** 按页取出当前应呈现的 3 项（不足 3 项时原样返回）。 */
function pageSlice<T>(all: readonly T[], offset: number): T[] {
  if (all.length === 0) return [];
  if (all.length <= PAGE_SIZE) return [...all];
  const list: T[] = [];
  for (let i = 0; i < PAGE_SIZE; i++) {
    list.push(all[(offset + i) % all.length]);
  }
  return list;
}

/** 总页数。 */
function pageCount(total: number): number {
  return Math.ceil(total / PAGE_SIZE) || 1;
}

/** 当前页码（1 起）。 */
function pageIndex(offset: number): number {
  return Math.floor(offset / PAGE_SIZE) + 1;
}

/** 翻到下一组；到末页回卷到第一页。 */
function pageNext(offset: Ref<number>, total: number) {
  if (total <= PAGE_SIZE) return;
  const last = (pageCount(total) - 1) * PAGE_SIZE;
  offset.value = offset.value >= last ? 0 : offset.value + PAGE_SIZE;
}

/** 翻到上一组；到首页回卷到最后一页。 */
function pagePrev(offset: Ref<number>, total: number) {
  if (total <= PAGE_SIZE) return;
  const last = (pageCount(total) - 1) * PAGE_SIZE;
  offset.value = offset.value <= 0 ? last : offset.value - PAGE_SIZE;
}

/* 1. 素材库 */
const materialOffset = ref(0);
const visibleMaterials = computed(() =>
  pageSlice(materialStore.items, materialOffset.value)
);
const materialTotalPages = computed(() => pageCount(materialStore.items.length));
const materialCurrentPage = computed(() => pageIndex(materialOffset.value));

function cycleMaterials() {
  pageNext(materialOffset, materialStore.items.length);
}
function prevMaterials() {
  pagePrev(materialOffset, materialStore.items.length);
}

/* 2. 故事定制 (子分类: 角色原型 / 情节) */
const selectedStoryIds = computed<Set<string>>(() => new Set(autoStore.selectedStoryIds));

/* 2a. 角色原型 */
const archetypeOffset = ref(0);
const visibleArchetypes = computed(() =>
  pageSlice(CHARACTER_ARCHETYPES, archetypeOffset.value)
);
const archetypeTotalPages = computed(() => pageCount(CHARACTER_ARCHETYPES.length));
const archetypeCurrentPage = computed(() => pageIndex(archetypeOffset.value));

function cycleArchetypes() {
  pageNext(archetypeOffset, CHARACTER_ARCHETYPES.length);
}
function prevArchetypes() {
  pagePrev(archetypeOffset, CHARACTER_ARCHETYPES.length);
}

/* 2b. 情节 */
const plotOffset = ref(0);
const visiblePlots = computed(() => pageSlice(STORY_PLOTS, plotOffset.value));
const plotTotalPages = computed(() => pageCount(STORY_PLOTS.length));
const plotCurrentPage = computed(() => pageIndex(plotOffset.value));

function cyclePlots() {
  pageNext(plotOffset, STORY_PLOTS.length);
}
function prevPlots() {
  pagePrev(plotOffset, STORY_PLOTS.length);
}

function toggleStory(id: string) {
  const next = new Set(autoStore.selectedStoryIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  autoStore.selectedStoryIds = Array.from(next);
}

/* 3. 叙事定制 (子分类: 结构 / 手法 / 结局) */
const selectedNarrativeIds = computed<Set<string>>(() => new Set(autoStore.selectedNarrativeIds));

/* 3a. 叙事结构 */
const structureOffset = ref(0);
const visibleStructures = computed(() =>
  pageSlice(NARRATIVE_STRUCTURES, structureOffset.value)
);
const structureTotalPages = computed(() => pageCount(NARRATIVE_STRUCTURES.length));
const structureCurrentPage = computed(() => pageIndex(structureOffset.value));

function cycleStructures() {
  pageNext(structureOffset, NARRATIVE_STRUCTURES.length);
}
function prevStructures() {
  pagePrev(structureOffset, NARRATIVE_STRUCTURES.length);
}

/* 3b. 叙事手法 */
const techniqueOffset = ref(0);
const visibleTechniques = computed(() =>
  pageSlice(NARRATIVE_TECHNIQUES, techniqueOffset.value)
);
const techniqueTotalPages = computed(() => pageCount(NARRATIVE_TECHNIQUES.length));
const techniqueCurrentPage = computed(() => pageIndex(techniqueOffset.value));

function cycleTechniques() {
  pageNext(techniqueOffset, NARRATIVE_TECHNIQUES.length);
}
function prevTechniques() {
  pagePrev(techniqueOffset, NARRATIVE_TECHNIQUES.length);
}

/* 3c. 结局结尾 */
const endingOffset = ref(0);
const visibleEndings = computed(() =>
  pageSlice(NARRATIVE_ENDINGS, endingOffset.value)
);
const endingTotalPages = computed(() => pageCount(NARRATIVE_ENDINGS.length));
const endingCurrentPage = computed(() => pageIndex(endingOffset.value));

function cycleEndings() {
  pageNext(endingOffset, NARRATIVE_ENDINGS.length);
}
function prevEndings() {
  pagePrev(endingOffset, NARRATIVE_ENDINGS.length);
}

/** 悬浮提示文案：原生 title 超长会被 Chromium/WebView 静默丢弃
    （如「韩式思维」正文 1479 字就完全不弹），统一截断到安全长度。 */
function tagTooltip(text: string, head?: string): string {
  const body = (text || "").trim();
  const MAX = 260;
  const clipped = body.length > MAX ? body.slice(0, MAX) + "…" : body;
  return head ? `${head}\n\n${clipped}` : clipped;
}

function toggleNarrative(id: string) {
  const next = new Set(autoStore.selectedNarrativeIds);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  autoStore.selectedNarrativeIds = Array.from(next);
}

/* 各选择项已选数量纯数字统计（供“上一组”按钮左侧展示） */
const selectedMaterialCount = computed(
  () => materialStore.items.filter((m) => m.selected).length
);
const selectedArchetypeCount = computed(
  () => CHARACTER_ARCHETYPES.filter((a) => selectedStoryIds.value.has(a.id)).length
);
const selectedPlotCount = computed(
  () => STORY_PLOTS.filter((p) => selectedStoryIds.value.has(p.id)).length
);
const selectedStructureCount = computed(
  () => NARRATIVE_STRUCTURES.filter((s) => selectedNarrativeIds.value.has(s.id)).length
);
const selectedTechniqueCount = computed(
  () => NARRATIVE_TECHNIQUES.filter((t) => selectedNarrativeIds.value.has(t.id)).length
);
const selectedEndingCount = computed(
  () => NARRATIVE_ENDINGS.filter((e) => selectedNarrativeIds.value.has(e.id)).length
);

/* 取消选择按钮：重置素材库、故事定制与叙事定制的选择 */
function cancelSelections() {
  materialStore.items.forEach((m) => (m.selected = false));
  autoStore.selectedStoryIds = [];
  autoStore.selectedNarrativeIds = [];
  showToast("已取消选择", "已清空素材库、故事定制与叙事定制的勾选项", "habit");
}

/* 审核意见 / 读者 两种模式不需要任何素材表单：只保留开始处理与取消按钮 */
const showWritingForm = computed(
  () => writingMode.value === "chat" || writingMode.value === "writer"
);

/* 当前写作模式对应的智能体模型：直接复用系统设置里各智能体已配置的模型，
   与「对话 / AI写作 / 审核意见 / 读者」四个已有智能体一一对齐。 */
const activeAgentModel = computed(() => {
  if (writingMode.value === "auditor") {
    return aiSettings.auditorModel || aiSettings.model;
  }
  if (writingMode.value === "reader") {
    return aiSettings.readerModel || aiSettings.model;
  }
  return aiSettings.model;
});

/** 当前写作模式对应的 Token 归类桶，与已有智能体一致。 */
const activeTokenCategory = computed<"chat" | "writer" | "auditor" | "reader">(
  () => writingMode.value
);

/* ---------------- AI Output / Dialogue Turn State ---------------- */
const aiTurns = toRef(autoStore, "aiTurns");

const isGenerating = ref(false);
type GeneratingAction = "normal" | "chapter_outline" | "dialogue_only" | null;
const activeGeneratingAction = ref<GeneratingAction>(null);
/** 思考链展开/折叠：绑定 autoStore.thinkingExpanded，重启后仍记住用户的选择。 */
const reasoningExpanded = computed({
  get: () => autoStore.thinkingExpanded,
  set: (val) => {
    autoStore.thinkingExpanded = val;
  },
});

/* ---------------- 思考链按步分段 ────────────────
   AI 的推理过程是连续文本。这里按常见的步骤标记（第一步 / 步骤 N / Step N /
   阶段 N、或「1. 2. 3.」编号）把长文本切成一段段带名称的步骤卡片，
   让用户清楚看到思考推进到哪一步；没有标记时整体归为「思考过程」单步展示。 */

interface ReasoningStep {
  name: string;
  content: string;
}

function splitReasoningSteps(text: string | undefined): ReasoningStep[] {
  if (!text || !text.trim()) return [];
  const rawLines = text.replace(/\r/g, "").split("\n");
  const meaningful = rawLines.map((l) => l.trim()).filter((l) => l.length > 0);
  if (meaningful.length === 0) return [];

  const headingRe =
    /^(?:\*\*?\s*)?(?:#{1,6}\s+)?(?:第\s*([0-9一二三四五六七八九十百]+)\s*步|步骤\s*([0-9一二三四五六七八九十百]+)|Step\s*([0-9]+)\s*[：:.\-]|阶段\s*([0-9一二三四五六七八九十百]+)|【第\s*([0-9一二三四五六七八九十百]+)\s*步】|【步骤\s*([0-9一二三四五六七八九十百]+)】)\s*[：:\-–—.)、\*]?\s*(.*)$/i;
  const numRe = /^([0-9]{1,3})\s*[、.．)）]\s*(.+)$/;

  /* 判断思考文本用的是哪一种步骤体例：标题式（第 N 步）还是编号式（1. 2.） */
  let headingCount = 0;
  let numCount = 0;
  let numSequenceOk = true;
  let lastNum = 0;
  for (const l of meaningful) {
    if (headingRe.exec(l)) {
      headingCount++;
    } else {
      const nm = numRe.exec(l);
      if (nm) {
        const v = parseInt(nm[1], 10);
        if (v === 1 || v === lastNum + 1) {
          numCount++;
          lastNum = v;
        } else if (v > lastNum + 1) {
          numSequenceOk = false;
        }
      }
    }
  }
  const useHeadings = headingCount >= 2;
  const useNums = !useHeadings && numSequenceOk && numCount >= 2;

  const blocks: { name: string; buf: string[] }[] = [];
  let cur: { name: string; buf: string[] } | null = null;

  for (const rawLine of rawLines) {
    const l = rawLine.trim();

    if (useHeadings) {
      const m = headingRe.exec(l);
      if (m) {
        const num = m[1] || m[2] || m[3] || m[4] || m[5] || m[6];
        const numDisp = chapterTokenToInt(num) ?? num;
        const part = (m[7] || "").replace(/^[,，、:：.\-—_]\s*/, "").replace(/\s*\*+\s*$/, "").trim();
        const titleFirstClause = part ? part.split(/[\n，。；：;:!！?？]/)[0].trim() || part : "";
        const cleanTitlePart = titleFirstClause.length > 16 ? titleFirstClause.slice(0, 16) + "…" : titleFirstClause;
        cur = {
          name: cleanTitlePart ? `第 ${numDisp} 步 · ${cleanTitlePart}` : `第 ${numDisp} 步`,
          buf: [],
        };
        blocks.push(cur);
        /* 完整保留标题行中包含的全部正文叙述，绝不丢弃任何文字 */
        if (part) {
          cur.buf.push(part);
        }
        continue;
      }
      if (!cur) {
        if (l) {
          cur = { name: "思考规划", buf: [l] };
          blocks.push(cur);
        }
      } else {
        if (l || cur.buf.length > 0) {
          cur.buf.push(l);
        }
      }
    } else if (useNums) {
      const m = numRe.exec(l);
      if (m) {
        const part = (m[2] || "").trim();
        const titleFirstClause = part ? part.split(/[\n，。；：;:!！?？]/)[0].trim() || part : "";
        const cleanTitlePart = titleFirstClause.length > 16 ? titleFirstClause.slice(0, 16) + "…" : titleFirstClause;
        cur = {
          name: cleanTitlePart ? `第 ${m[1]} 步 · ${cleanTitlePart}` : `第 ${m[1]} 步`,
          buf: [],
        };
        blocks.push(cur);
        /* 原行内容完整归入正文 buf，绝不截断丢弃 */
        if (part) {
          cur.buf.push(part);
        }
        continue;
      }
      if (!cur) {
        if (l) {
          cur = { name: "思考规划", buf: [l] };
          blocks.push(cur);
        }
      } else {
        if (l || cur.buf.length > 0) {
          cur.buf.push(l);
        }
      }
    } else {
      if (!cur) {
        cur = { name: "思考过程", buf: [] };
        blocks.push(cur);
      }
      if (l || cur.buf.length > 0) {
        cur.buf.push(l);
      }
    }
  }

  const result: ReasoningStep[] = [];
  for (const b of blocks) {
    while (b.buf.length > 0 && !b.buf[b.buf.length - 1]) {
      b.buf.pop();
    }
    const content = b.buf.join("\n").trim();
    if (content || b.name) {
      result.push({
        name: b.name,
        content: content || b.name,
      });
    }
  }

  return result.length > 0 ? result : [{ name: "思考过程", content: text.trim() }];
}

/** 思考链步骤的轻量缓存：流式输出时每次 onReasoning 都以长度做 key，重复解析近乎免费。 */
const reasoningStepCache = new Map<string, ReasoningStep[]>();
function reasoningStepsFor(turn: AiTurn): ReasoningStep[] {
  const text = turn.reasoning || "";
  const key = `${turn.id}:${text.length}`;
  const hit = reasoningStepCache.get(key);
  if (hit) return hit;
  const steps = splitReasoningSteps(text);
  if (reasoningStepCache.size > 160) reasoningStepCache.clear();
  reasoningStepCache.set(key, steps);
  return steps;
}

/** 单个步骤的独立折叠/展开状态：key 为「产出 id:步骤序号」。
    思考链除了整体能折叠展开，每一段步骤也能各自收起与展开。 */
const collapsedThinkSteps = ref<Set<string>>(new Set());

function thinkStepKey(turn: AiTurn, index: number): string {
  return `${turn.id}:${index}`;
}

function isThinkStepCollapsed(key: string): boolean {
  return collapsedThinkSteps.value.has(key);
}

function toggleThinkStep(key: string) {
  const next = new Set(collapsedThinkSteps.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsedThinkSteps.value = next;
}

/** 当前（最新）一条 AI 产出；没有任何产出时返回空占位对象。 */
const aiMessage = computed<AiTurn>(() => {
  const last = aiTurns.value[aiTurns.value.length - 1];
  return last ?? {
    id: 0,
    title: "",
    content: "",
    reasoning: "",
    tokens: 0,
    timestamp: "",
    incomplete: false,
    continued: 0,
  };
});

const hasOutput = computed(() => aiTurns.value.length > 0);

let currentAbortController: AbortController | null = null;

function formatCurrentTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/* ---------------- 正文标题与渲染 ----------------
   文稿条目、历史条目都以「正文自己的标题」为名（本轮动作名只作兜底）：
   用户找的是那一篇稿子，而不是当时点了哪个按钮。 */

/** 从正文里取标题：优先正文的「一级标题」（# 行，全文扫描），
    找不到一级标题时退回收第一行非空文本（Markdown 标题优先于纯文本）。 */
function deriveBodyTitle(content: string): string {
  const lines = (content || "").split("\n");

  for (const raw of lines) {
    const line = raw.trim();
    /* 读者评估的 ```json 数据块不是正文章节标题，取标题时跳过。 */
    if (line.startsWith("```")) continue;
    const h1 = /^#\s+(.+)$/.exec(line);
    if (h1) {
      const text = cleanTitleText(h1[1]);
      if (text) return clampTitle(text);
    }
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("```")) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    const text = (heading ? cleanTitleText(heading[1]) : cleanTitleText(line)) || "";
    if (!text) continue;
    return clampTitle(text);
  }
  return "";
}

function cleanTitleText(text: string): string {
  return text.replace(/[*_`>~]/g, "").replace(/^#+\s*/, "").trim();
}

function clampTitle(text: string): string {
  return text.length > 20 ? text.slice(0, 20) + "…" : text;
}

/**
 * 读者评估报告内容拆分：
 * 将正文拆分为「建议前正文」与「面向作者的具体建议及之后内容」，
 * 使得读者雷达图卡片可以精准置于「面向作者的具体建议」正上方。
 */
interface ReaderAdviceSplit {
  beforeAdvice: string;
  afterAdvice: string;
  hasAdvice: boolean;
}

function splitReaderAdviceSections(content: string): ReaderAdviceSplit {
  if (!content) {
    return { beforeAdvice: "", afterAdvice: "", hasAdvice: false };
  }
  const regex = /(?:^|\n)(?=(?:#{1,6}\s+|\*{1,2}\s*)?(?:[0-9一二三四五六七八九十]+[、.．\s]+)?(?:针对|面向)?作者(?:的)?(?:具体)?(?:建议|改进建议))/i;
  const match = regex.exec(content);
  if (!match) {
    return { beforeAdvice: content, afterAdvice: "", hasAdvice: false };
  }
  const idx = match.index;
  return {
    beforeAdvice: content.slice(0, idx).trim(),
    afterAdvice: content.slice(idx).trim(),
    hasAdvice: true,
  };
}

function hasReaderReportJson(content: string): boolean {
  return /```json[\s\S]*?```/i.test(content || "");
}

/** 条目展示标题：
    固定标题逻辑，完全独立于当前全局 writingMode：
    - 审核意见 / 读者评估报告 / 对话回复 / 章节细纲 / 故事大纲 等专属固定名称，
      任何时候切换模式都不会被改变，也不会误提取正文第一句话；
    - AI 写作产出：正文标题优先（正文一级标题 h1 或标题行），正文未就绪时回退动作名，
      切换到其他模式也不会变为“重新生成”。 */
function turnLabel(turn: AiTurn): string {
  if (!turn) return "AI写作";

  // 0. 空白独立文稿类：优先提取正文一级标题，无标题时固定为“空白文稿”
  if (turn.isBlankDoc || turn.variant === "blank" || turn.title === "空白文稿") {
    const bodyTitle = deriveBodyTitle(turn.content);
    if (bodyTitle) {
      return bodyTitle;
    }
    if (
      turn.title &&
      turn.title !== "重新生成" &&
      turn.title !== "换个手法" &&
      turn.title !== "换结构" &&
      turn.title !== "换结尾" &&
      turn.title !== "重写篇章"
    ) {
      return turn.title;
    }
    return "空白文稿";
  }

  // 1. 审核意见类回复：标题永久固定为“审核意见”
  if (
    turn.mode === "auditor" ||
    turn.title === "审核意见" ||
    turn.summary === "审核意见"
  ) {
    return "审核意见";
  }

  // 2. 读者评估报告类回复：标题永久固定为“读者评估报告”
  if (
    turn.mode === "reader" ||
    turn.title === "读者评估报告" ||
    turn.summary === "读者评估报告" ||
    (turn.content && /```json[\s\S]*?```/i.test(turn.content) && /面向作者/.test(turn.content))
  ) {
    return "读者评估报告";
  }

  // 3. 对话回复类：标题固定为对话回复
  if (
    turn.mode === "chat" ||
    turn.title === "对话回复" ||
    turn.summary === "对话回复"
  ) {
    if (
      turn.title &&
      turn.title !== "重新生成" &&
      turn.title !== "换个手法" &&
      turn.title !== "换结构" &&
      turn.title !== "换结尾" &&
      turn.title !== "重写篇章" &&
      turn.title !== "空白文稿"
    ) {
      return turn.title;
    }
    return "对话回复";
  }

  // 4. 专属创作结构动作：章节细纲、故事大纲、对话框架、续写下章
  if (
    turn.title === "章节细纲" ||
    turn.title === "故事大纲" ||
    turn.title === "对话框架" ||
    turn.title === "续写下章"
  ) {
    return turn.title;
  }

  // 5. AI 写作模式产出：无论当前切换到什么模式，均正常取正文一级标题 h1 为回复名称
  const bodyTitle = deriveBodyTitle(turn.content);
  if (bodyTitle) {
    return bodyTitle;
  }

  // 正文若尚未输出标题，则使用其动作名；若是变体动作名（重新生成/换个手法/换结构/换结尾/重写篇章/空白文稿）兜底为“AI写作”
  if (
    turn.title &&
    turn.title !== "重新生成" &&
    turn.title !== "换个手法" &&
    turn.title !== "换结构" &&
    turn.title !== "换结尾" &&
    turn.title !== "重写篇章" &&
    turn.title !== "空白文稿"
  ) {
    return turn.title;
  }
  return "AI写作";
}

/** 判断是否属于审核意见或读者评估类回复（非创作/对话正文） */
function isAuditOrReaderTurn(turn: AiTurn): boolean {
  if (!turn) return false;
  if (turn.mode === "auditor" || turn.mode === "reader") return true;
  if (turn.title === "审核意见" || turn.title === "读者评估报告") return true;
  if (turn.summary === "审核意见" || turn.summary === "读者评估报告") return true;
  if (
    turn.content &&
    /```json[\s\S]*?```/i.test(turn.content) &&
    /面向作者/.test(turn.content)
  ) {
    return true;
  }
  return false;
}

/** 仅对话与AI写作的回复正文支持底部信息栏的变体操作与下一章按钮，审核意见与读者模式不展示 */
function canShowVariantActions(turn: AiTurn): boolean {
  if (!turn) return false;
  if (isAuditOrReaderTurn(turn)) return false;
  if (turn.isBlankDoc || turn.variant === "blank") return true;
  if (!turn.content) return false;
  if (turn.mode === "chat" || turn.mode === "writer") return true;
  return !turn.mode && (writingMode.value === "chat" || writingMode.value === "writer");
}

/** 分页组结构：同一面板位置的多版本集合 */
interface TurnGroup {
  groupId: string;
  turns: AiTurn[];
}

/** 记录每个分页组当前被激活展示的页码索引 (0-based) */
const groupActiveIndexMap = ref<Record<string, number>>({});

/** 根据 pageGroupId 将所有 aiTurns 聚合到各自面板位置（变体输出在同一卡片分页展示） */
const turnGroups = computed<TurnGroup[]>(() => {
  const groups: TurnGroup[] = [];
  const map = new Map<string, TurnGroup>();

  for (const turn of aiTurns.value) {
    let gId = turn.pageGroupId;
    if (!gId) {
      if (turn.parentId && map.has(String(turn.parentId))) {
        gId = String(turn.parentId);
      } else {
        gId = String(turn.id);
      }
      turn.pageGroupId = gId;
    }

    let grp = map.get(gId);
    if (!grp) {
      grp = { groupId: gId, turns: [] };
      map.set(gId, grp);
      groups.push(grp);
    }
    grp.turns.push(turn);
  }

  return groups;
});

function getGroupActiveIndex(group: TurnGroup): number {
  if (!group || group.turns.length === 0) return 0;
  const saved = groupActiveIndexMap.value[group.groupId];
  if (typeof saved === "number" && saved >= 0 && saved < group.turns.length) {
    return saved;
  }
  // 默认定位到最新的一版
  return group.turns.length - 1;
}

function activeTurnOf(group: TurnGroup): AiTurn {
  if (!group || group.turns.length === 0) return aiMessage.value;
  const idx = getGroupActiveIndex(group);
  return group.turns[idx] || group.turns[group.turns.length - 1];
}

function setGroupActiveIndex(groupId: string, index: number) {
  groupActiveIndexMap.value[groupId] = index;
}

function switchGroupPage(group: TurnGroup, newIndex: number) {
  if (!group || newIndex < 0 || newIndex >= group.turns.length) return;
  setGroupActiveIndex(group.groupId, newIndex);
  const targetTurn = group.turns[newIndex];
  if (targetTurn) {
    selectedHistoryId.value = targetTurn.id;
  }
}

function setActiveTurn(turn: AiTurn) {
  if (!turn) return;
  for (const group of turnGroups.value) {
    const idx = group.turns.findIndex((t) => t.id === turn.id);
    if (idx !== -1) {
      setGroupActiveIndex(group.groupId, idx);
      break;
    }
  }
}

/* ---------------- 对话布局切换：线性接续 vs 左右翻页 ----------------
   - linear: 线性布局，AI 回复一直都在下方接续呈现（默认）
   - paged: 左右翻页布局，AI 一轮的回复对话是左右翻页呈现，
     用户点击上一页、下一页按钮切换呈现每一轮对话。
*/
const chatLayoutMode = ref<"linear" | "paged">(
  (localStorage.getItem("ais_auto_chat_layout_mode") as "linear" | "paged") || "linear"
);

function toggleChatLayoutMode() {
  chatLayoutMode.value = chatLayoutMode.value === "linear" ? "paged" : "linear";
  try {
    localStorage.setItem("ais_auto_chat_layout_mode", chatLayoutMode.value);
  } catch {}
  showToast(
    chatLayoutMode.value === "paged" ? "已切换至翻页布局" : "已切换至线性布局",
    chatLayoutMode.value === "paged"
      ? "AI 对话按轮次左右翻页浏览 (支持 Alt+← / Alt+→ 翻页)"
      : "AI 对话恢复下方接续滚动呈现",
    "habit"
  );
  if (chatLayoutMode.value === "paged") {
    // 切换到翻页模式时，优先定位到当前选中的历史条目所在轮次，或最新一轮
    if (selectedHistoryId.value !== null) {
      const idx = turnGroups.value.findIndex((g) =>
        g.turns.some((t) => t.id === selectedHistoryId.value)
      );
      if (idx !== -1) {
        activeRoundIndex.value = idx;
        return;
      }
    }
    activeRoundIndex.value = Math.max(0, turnGroups.value.length - 1);
  }
}

/** 当前翻页模式下呈现的轮次索引 (0-based) */
const activeRoundIndex = ref(0);

/** 总轮次数 */
const totalRounds = computed(() => turnGroups.value.length);

/** 当前活动的轮次对象 (TurnGroup) */
const currentPagedGroup = computed<TurnGroup | null>(() => {
  if (turnGroups.value.length === 0) return null;
  const idx = Math.min(Math.max(0, activeRoundIndex.value), turnGroups.value.length - 1);
  return turnGroups.value[idx] || null;
});

/** 视图中真正渲染的轮次列表：线性模式下渲染全部 turnGroups；翻页模式下仅渲染当前轮 currentPagedGroup */
const renderedTurnGroups = computed<TurnGroup[]>(() => {
  if (chatLayoutMode.value === "paged") {
    return currentPagedGroup.value ? [currentPagedGroup.value] : [];
  }
  return turnGroups.value;
});

function pagedGoPrev() {
  if (activeRoundIndex.value > 0) {
    activeRoundIndex.value--;
    onPagedRoundChanged();
  }
}

function pagedGoNext() {
  if (activeRoundIndex.value < turnGroups.value.length - 1) {
    activeRoundIndex.value++;
    onPagedRoundChanged();
  }
}

function pagedGoTo(index: number) {
  if (index >= 0 && index < turnGroups.value.length) {
    activeRoundIndex.value = index;
    onPagedRoundChanged();
  }
}

function onPagedRoundChanged() {
  const grp = currentPagedGroup.value;
  if (grp) {
    const t = activeTurnOf(grp);
    if (t) {
      selectedHistoryId.value = t.id;
    }
  }
  nextTick(() => {
    if (middleEditorRef.value) {
      middleEditorRef.value.scrollTo({ top: 0, behavior: "smooth" });
    }
  });
}

// 监听轮次数量变化：产生新一轮对话时，翻页模式自动跟随定位至最新一轮
watch(
  () => turnGroups.value.length,
  (newLen, oldLen) => {
    if (newLen > (oldLen || 0) && chatLayoutMode.value === "paged") {
      activeRoundIndex.value = newLen - 1;
    }
  }
);

/* ---------------- 撤销 / 重做 (Undo / Redo) ---------------- */
interface ContentSnapshot {
  turnId: number;
  content: string;
  timestamp: number;
}

const undoStack = ref<ContentSnapshot[]>([]);
const redoStack = ref<ContentSnapshot[]>([]);
const lastSnapshotMap = new Map<number, string>();
let inputDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/** 记录撤销快照（排版、清理、精修应用、替换、输入防抖） */
function recordUndoSnapshot(turn: AiTurn, immediate = false) {
  if (!turn || isAuditOrReaderTurn(turn)) return;
  const current = turn.content || "";
  const last = lastSnapshotMap.get(turn.id);
  if (last === current) return;

  if (immediate) {
    if (last !== undefined) {
      undoStack.value.push({
        turnId: turn.id,
        content: last,
        timestamp: Date.now(),
      });
      if (undoStack.value.length > 60) undoStack.value.shift();
      redoStack.value = [];
    }
    lastSnapshotMap.set(turn.id, current);
  } else {
    if (!lastSnapshotMap.has(turn.id)) {
      lastSnapshotMap.set(turn.id, current);
    }
    if (inputDebounceTimer) clearTimeout(inputDebounceTimer);
    inputDebounceTimer = setTimeout(() => {
      const prev = lastSnapshotMap.get(turn.id);
      if (prev !== undefined && prev !== turn.content) {
        undoStack.value.push({
          turnId: turn.id,
          content: prev,
          timestamp: Date.now(),
        });
        if (undoStack.value.length > 60) undoStack.value.shift();
        redoStack.value = [];
        lastSnapshotMap.set(turn.id, turn.content);
      }
    }, 450);
  }
}

/** 获取当前处于编辑或激活焦点的目标回复 */
function getTargetTurnForEdit(): AiTurn | null {
  // 1. 光标或焦点在某条正文编辑区内
  const activeEl = document.activeElement;
  if (activeEl && activeEl.classList.contains("auto-wysiwyg-body")) {
    for (const [tId, el] of bodyEditors.entries()) {
      if (el === activeEl) return aiTurns.value.find((t) => t.id === tId) || null;
    }
  }
  // 2. 选区锚点所在编辑区
  const sel = window.getSelection();
  if (sel && sel.anchorNode) {
    let node: Node | null = sel.anchorNode;
    while (node && node !== document.body) {
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as HTMLElement).classList.contains("auto-wysiwyg-body")
      ) {
        for (const [tId, el] of bodyEditors.entries()) {
          if (el === node) return aiTurns.value.find((t) => t.id === tId) || null;
        }
      }
      node = node.parentNode;
    }
  }
  // 3. 翻页模式下当前轮次对应的活跃回复
  if (chatLayoutMode.value === "paged" && currentPagedGroup.value) {
    return activeTurnOf(currentPagedGroup.value);
  }
  // 4. 用户在文稿或目录中选中的历史条目
  if (selectedHistoryId.value !== null) {
    const t = aiTurns.value.find((x) => x.id === selectedHistoryId.value);
    if (t) return t;
  }
  // 5. 栈顶最近被修改过的回复
  if (undoStack.value.length > 0) {
    const lastSnap = undoStack.value[undoStack.value.length - 1];
    const t = aiTurns.value.find((x) => x.id === lastSnap.turnId);
    if (t) return t;
  }
  // 6. 最新一条回复
  return aiMessage.value && aiMessage.value.id ? aiMessage.value : null;
}

function triggerUndo() {
  if (undoStack.value.length === 0) {
    showToast("提示", "当前无操作可撤销", "edit");
    return;
  }
  const snap = undoStack.value.pop()!;
  const target = aiTurns.value.find((t) => t.id === snap.turnId);
  if (!target) return;

  // 将当前内容压入重做栈
  redoStack.value.push({
    turnId: target.id,
    content: target.content,
    timestamp: Date.now(),
  });
  target.content = snap.content;
  lastSnapshotMap.set(target.id, snap.content);
  lastSyncedFor.delete(target.id);
  syncBodyEditor(target);
  showToast("已撤销", "已恢复上一状态 (Ctrl+Z)", "edit");
}

function triggerRedo() {
  if (redoStack.value.length === 0) {
    showToast("提示", "当前无操作可重做", "edit");
    return;
  }
  const snap = redoStack.value.pop()!;
  const target = aiTurns.value.find((t) => t.id === snap.turnId);
  if (!target) return;

  // 将当前内容压入撤销栈
  undoStack.value.push({
    turnId: target.id,
    content: target.content,
    timestamp: Date.now(),
  });
  target.content = snap.content;
  lastSnapshotMap.set(target.id, snap.content);
  lastSyncedFor.delete(target.id);
  syncBodyEditor(target);
  showToast("已重做", "已恢复重做状态 (Ctrl+Y)", "edit");
}

/* ---------------- 查找 / 替换 (Find / Replace) ---------------- */
const findPanelOpen = ref(false);
const findShowReplace = ref(false);
const findQuery = ref("");
const replaceQuery = ref("");
const findCaseSensitive = ref(false);
const findMatchWholeWord = ref(false);
const findMatchIndex = ref(0);
const findMatches = ref<{ turnId: number; index: number; length: number }[]>([]);
const findInputRef = ref<HTMLInputElement | null>(null);
const replaceInputRef = ref<HTMLInputElement | null>(null);

function openFindPanel(withReplace = false) {
  findPanelOpen.value = true;
  findShowReplace.value = withReplace;

  // 如果页面上有划选文字，优先填入查找框
  const selText = window.getSelection()?.toString().trim();
  if (selText && selText.length < 80) {
    findQuery.value = selText;
  }
  nextTick(() => {
    if (withReplace && findQuery.value) {
      replaceInputRef.value?.focus();
      replaceInputRef.value?.select();
    } else {
      findInputRef.value?.focus();
      findInputRef.value?.select();
    }
    updateFindMatches();
  });
}

function closeFindPanel() {
  findPanelOpen.value = false;
  findMatches.value = [];
  findMatchIndex.value = 0;
  window.getSelection()?.removeAllRanges();
}

function toggleFindReplaceRow() {
  findShowReplace.value = !findShowReplace.value;
  if (findShowReplace.value) {
    nextTick(() => replaceInputRef.value?.focus());
  }
}

function updateFindMatches() {
  if (!findQuery.value) {
    findMatches.value = [];
    findMatchIndex.value = 0;
    return;
  }
  const turn = getTargetTurnForEdit();
  if (!turn || !turn.content) {
    findMatches.value = [];
    findMatchIndex.value = 0;
    return;
  }
  const text = turn.content;
  const q = findQuery.value;
  const list: { turnId: number; index: number; length: number }[] = [];

  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = findMatchWholeWord.value ? `\\b${escaped}\\b` : escaped;
  const flags = findCaseSensitive.value ? "g" : "gi";
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, flags);
  } catch {
    return;
  }

  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    list.push({
      turnId: turn.id,
      index: match.index,
      length: match[0].length,
    });
    if (!regex.global) break;
  }

  findMatches.value = list;
  if (findMatches.value.length === 0) {
    findMatchIndex.value = 0;
  } else if (findMatchIndex.value >= findMatches.value.length) {
    findMatchIndex.value = 0;
  }
  highlightCurrentMatch();
}

function findNext() {
  if (findMatches.value.length === 0) return;
  findMatchIndex.value = (findMatchIndex.value + 1) % findMatches.value.length;
  highlightCurrentMatch();
}

function findPrev() {
  if (findMatches.value.length === 0) return;
  findMatchIndex.value =
    (findMatchIndex.value - 1 + findMatches.value.length) % findMatches.value.length;
  highlightCurrentMatch();
}

function highlightCurrentMatch() {
  if (findMatches.value.length === 0) return;
  const cur = findMatches.value[findMatchIndex.value];
  if (!cur) return;
  const targetEl = bodyEditors.get(cur.turnId);
  if (!targetEl) return;

  selectTextInEditor(targetEl, cur.index, cur.length);
}

/** 在 WYSIWYG 编辑区中按字符偏移范围进行选区高亮与平滑定位 */
function selectTextInEditor(editor: HTMLElement, startIndex: number, length: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const range = document.createRange();

  let charCount = 0;
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let n = walker.nextNode();
  while (n) {
    const nodeLen = n.textContent?.length || 0;
    if (!startNode && charCount + nodeLen >= startIndex) {
      startNode = n;
      startOffset = startIndex - charCount;
    }
    if (!endNode && charCount + nodeLen >= startIndex + length) {
      endNode = n;
      endOffset = startIndex + length - charCount;
      break;
    }
    charCount += nodeLen;
    n = walker.nextNode();
  }

  if (startNode && endNode) {
    try {
      range.setStart(startNode, Math.min(startOffset, startNode.textContent?.length || 0));
      range.setEnd(endNode, Math.min(endOffset, endNode.textContent?.length || 0));
      sel.removeAllRanges();
      sel.addRange(range);
      const parent = startNode.parentElement;
      if (parent) {
        parent.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    } catch {
      editor.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } else {
    editor.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function executeFindReplace() {
  if (findMatches.value.length === 0) return;
  const turn = getTargetTurnForEdit();
  if (!turn) return;

  const cur = findMatches.value[findMatchIndex.value];
  if (!cur) return;

  recordUndoSnapshot(turn, true);

  const before = turn.content.slice(0, cur.index);
  const after = turn.content.slice(cur.index + cur.length);
  turn.content = before + replaceQuery.value + after;

  lastSyncedFor.delete(turn.id);
  syncBodyEditor(turn);
  showToast("已替换", "已替换当前匹配项", "edit");

  nextTick(() => {
    updateFindMatches();
  });
}

function executeFindReplaceAll() {
  if (findMatches.value.length === 0) return;
  const turn = getTargetTurnForEdit();
  if (!turn) return;

  const count = findMatches.value.length;
  recordUndoSnapshot(turn, true);

  const escaped = findQuery.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = findMatchWholeWord.value ? `\\b${escaped}\\b` : escaped;
  const flags = findCaseSensitive.value ? "g" : "gi";
  const regex = new RegExp(pattern, flags);

  turn.content = turn.content.replace(regex, replaceQuery.value);
  lastSyncedFor.delete(turn.id);
  syncBodyEditor(turn);
  showToast("全部替换完成", `共替换 ${count} 处匹配内容`, "habit");

  nextTick(() => {
    updateFindMatches();
  });
}

/**
 * 正文渲染：与「文档」界面完全同一条管线 —— renderForReading 之后按
 * 「内容上色」开关叠加着色。zj-* 的配色规则写在全局 style.css 里，靠容器上的
 * .reading-view.content-colored 生效，所以两处界面共用一套观感与一个开关。
 */
function renderTurnBody(content: string): string {
  /* 读者评估的 ```json 数据块交给 ReaderResultInline 的雷达图卡片呈现，
     这里先把它从正文里剔掉，避免用户看到裸露的 JSON 语法。 */
  const cleaned = (content || "").replace(/```json[\s\S]*?```/g, "").trim();
  const html = renderForReading(cleaned);
  return contentColoringOn.value ? applyContentColoring(html) : html;
}

/** 挂在正文容器上的 --zj-* 配色变量（关掉上色时不挂）。 */
const autoReadingStyle = computed(() =>
  contentColoringOn.value ? contentColorCssVars() : {},
);

/* ---------------- 正文排版与字体：与文档界面 WYSIWYG 共用同一套设置 ----------------
   WYSIWYG 正文的字号 / 字体 / 行距 / 边距 / 网格线 / 段首样式全部直接读
   aiSettings 里同一批字段（字号 / 行距 / 边距各带 clamp），「排版与字体」
   面板改一处，自动界面与文档界面同步生效，观感保持一致。 */
const editorFontSize = computed({
  get: () => clampEditorFontSize(aiSettings.editorFontSize),
  set: (v: number) => {
    aiSettings.editorFontSize = clampEditorFontSize(v);
  },
});
const editorLineHeight = computed({
  get: () => clampEditorLineHeight(aiSettings.editorLineHeight),
  set: (v: number) => {
    aiSettings.editorLineHeight = clampEditorLineHeight(v);
  },
});
const editorMarginX = computed({
  get: () => clampEditorMarginX(aiSettings.editorMarginX),
  set: (v: number) => {
    aiSettings.editorMarginX = clampEditorMarginX(v);
  },
});
const editorMarginY = computed({
  get: () => clampEditorMarginY(aiSettings.editorMarginY),
  set: (v: number) => {
    aiSettings.editorMarginY = clampEditorMarginY(v);
  },
});
const editorGridLine = computed({
  get: () => aiSettings.editorGridLine,
  set: (val: EditorGridLine) => {
    aiSettings.editorGridLine = val;
  },
});
const editorFont = computed({
  get: () => aiSettings.appFont,
  set: (font: string) => applyFont(font),
});
/** 与文档界面同一套字体栈：中文引号字体兜底 + 选中字体 + 全局字体。 */
const editorFontStack = computed(
  () => `"ChineseQuotes", "${aiSettings.appFont}", var(--app-font)`,
);
/** 预设字体之外的本地字体（与文档界面字体下拉同源）。 */
const localOnlyFonts = computed(() => {
  const presets = new Set(fontOptions);
  return fontState.localFonts.filter((f) => !presets.has(f));
});

/** WYSIWYG 正文本体排版：字号 / 字体 / 行距 + 上色变量 + 空行块行高变量。 */
const autoWysiwygStyle = computed(() => {
  const fontSize = editorFontSize.value;
  const lineHeight = editorLineHeight.value;
  return {
    fontSize: fontSize + "px",
    fontFamily: editorFontStack.value,
    lineHeight,
    "--ed-line-height-px": (fontSize * lineHeight).toFixed(2) + "px",
    ...(contentColoringOn.value ? contentColorCssVars() : {}),
  };
});

/** WYSIWYG 正文本体的排版类：网格线 + 段首样式（与文档界面同一套 class）。 */
const autoWysiwygClass = computed(() => ({
  "content-colored": contentColoringOn.value,
  "first-line-indent": aiSettings.firstLineIndent,
  "drop-cap": aiSettings.dropCap,
  ["grid-line-" + aiSettings.editorGridLine]: aiSettings.editorGridLine !== "none",
}));

function toggleContentColoring() {
  contentColoringOn.value = !contentColoringOn.value;
  showToast(
    contentColoringOn.value ? "已开启内容上色" : "已取消内容上色",
    contentColoringOn.value
      ? "正文按标题 / 引号 / 括号 / 标点等分色渲染"
      : "正文已回到单色渲染",
    "habit",
  );
}

/* ---------------- 正文 WYSIWYG 原地编辑（自动保存） ----------------
   AI 回复正文不再走「阅读渲染 + 点编辑按钮切 textarea」的两段式流程，
   而是直接以所见即所得（与文档界面 WYSIWYG 同一套块级引擎）呈现，
   用户光标点进正文即可修改，输入 / 失焦时实时序列化回 Markdown 并写回
   autoStore（持久化由 autoStore 的深度 watcher 同步完成）。

   每条产出维护一份 DOM 编辑区（bodyEditors）与一次「最后同步的快照」
   （lastSyncedFor）：用户自己输入的变更不做 innerHTML 回写，避免光标跳动；
   来自外部的变更（流式输出 / 精修替换 / 版本切换）按内容对比后回写 DOM。 */
const bodyEditors = new Map<number, HTMLElement>();
const lastSyncedFor = new Map<number, string>();
const isComposingMap = new Map<number, boolean>();
const liveRenderTimers = new Map<number, any>();

/** 获取编辑区内光标相对于纯文本内容的字符偏移量 */
function getEditorCaretOffset(element: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  try {
    const range = sel.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(element);
    preCaretRange.setEnd(range.startContainer, range.startOffset);
    return preCaretRange.toString().length;
  } catch {
    return 0;
  }
}

/** 在编辑区内根据纯文本字符偏移量精准恢复光标位置 */
function restoreEditorCaretOffset(element: HTMLElement, targetOffset: number) {
  const sel = window.getSelection();
  if (!sel) return;

  let currentOffset = 0;
  let targetNode: Node | null = null;
  let targetNodeOffset = 0;

  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node = walker.nextNode();
  while (node) {
    const text = node.nodeValue || "";
    const len = text.length;
    if (currentOffset + len >= targetOffset) {
      targetNode = node;
      targetNodeOffset = targetOffset - currentOffset;
      break;
    }
    currentOffset += len;
    node = walker.nextNode();
  }

  if (targetNode) {
    try {
      const range = document.createRange();
      range.setStart(targetNode, Math.min(targetNodeOffset, (targetNode.nodeValue || "").length));
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // 容错兜底
    }
  } else {
    try {
      const range = document.createRange();
      range.selectNodeContents(element);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {
      // ignore
    }
  }
}

/** 与文档界面 WYSIWYG 同源：块级结构 + 内容上色（开启时按块重置引号状态）。 */
function compileBodyLiveHtml(md: string): string {
  const html = markdownToLiveHtml(md);
  return contentColoringOn.value ? applyContentColoring(html, { resetAtBlocks: true }) : html;
}

/** 实时重新编译并渲染 WYSIWYG 编辑区（保持光标与焦点） */
function recompileBodyEditorLive(turn: AiTurn, preserveCaret: boolean = true) {
  const el = bodyEditors.get(turn.id);
  if (!el) return;
  if (isComposingMap.get(turn.id)) return;

  const sel = window.getSelection();
  const isFocused =
    document.activeElement === el ||
    (sel && sel.anchorNode && el.contains(sel.anchorNode));

  let caretOffset = 0;
  if (isFocused && preserveCaret) {
    caretOffset = getEditorCaretOffset(el);
  }

  const md = liveHtmlToMarkdown(el);
  turn.content = md;

  const newHtml = compileBodyLiveHtml(md);
  if (el.innerHTML !== newHtml) {
    el.innerHTML = newHtml;
    lastSyncedFor.set(turn.id, md);

    if (isFocused && preserveCaret) {
      restoreEditorCaretOffset(el, caretOffset);
      onBodyFocusEvent();
    }
  } else {
    lastSyncedFor.set(turn.id, md);
  }
}

/** 判断某条产出正文是否允许原地编辑（审核意见 / 读者 / 流式输出中只读）。 */
function bodyEditable(turn: AiTurn): boolean {
  if (isAuditOrReaderTurn(turn)) return false;
  if (isGenerating.value && turn.id === aiMessage.value.id) return false;
  return true;
}

/** 按产出 id 缓存的「稳定」编辑区模板 ref 回调。
    若每次渲染都新建函数，Vue 会把它当成新 ref 反复回调 → 每次都强制重算
    innerHTML（挂载强制同步），一旦与正文序列化有细微差异（如 .is-focused
    等装饰类），就会在拖选文字时改写编辑区 DOM，把进行中的选区直接冲掉。 */
const bodyEditorRefFns = new Map<number, (el: Element | ComponentPublicInstance | null) => void>();

function bodyEditorRefFor(turnId: number): (el: Element | ComponentPublicInstance | null) => void {
  let fn = bodyEditorRefFns.get(turnId);
  if (fn) return fn;
  fn = (el) => {
    if (el) {
      bodyEditors.set(turnId, el as HTMLElement);
      const turn = aiTurns.value.find((t) => t.id === turnId);
      if (turn) {
        /* 只有真实挂载（元素被创建）才强制写入初始 HTML，避免打中旧快照导致新空编辑区留白。 */
        lastSyncedFor.delete(turnId);
        syncBodyEditor(turn);
      }
    } else {
      bodyEditors.delete(turnId);
    }
  };
  bodyEditorRefFns.set(turnId, fn);
  return fn;
}

/** 按需同步某条正文的 DOM：外部内容变化时回写，用户自己的输入原样放行。 */
function syncBodyEditor(turn: AiTurn) {
  const el = bodyEditors.get(turn.id);
  if (!el) return;
  if (lastSyncedFor.get(turn.id) === turn.content) return;

  /* 保护：当用户正聚焦在当前正文编辑区或选区在内部时，若内容与当前 DOM 序列化结果一致，不强制覆写 DOM 避免选区被冲掉 */
  const sel = window.getSelection();
  const isEditingThis =
    document.activeElement === el ||
    (sel && sel.anchorNode && el.contains(sel.anchorNode));
  if (isEditingThis && !isGenerating.value) {
    const currentMd = liveHtmlToMarkdown(el);
    if (currentMd === turn.content) {
      lastSyncedFor.set(turn.id, turn.content);
      return;
    }
    recompileBodyEditorLive(turn, true);
    return;
  }

  const html = compileBodyLiveHtml(turn.content);
  if (el.innerHTML !== html) el.innerHTML = html;
  lastSyncedFor.set(turn.id, turn.content);
}

function syncAllBodyEditors() {
  for (const t of aiTurns.value) {
    const el = bodyEditors.get(t.id);
    if (!el) continue;
    const sel = window.getSelection();
    const isEditingThis =
      document.activeElement === el ||
      (sel && sel.anchorNode && el.contains(sel.anchorNode));
    if (isEditingThis && !isGenerating.value) {
      recompileBodyEditorLive(t, true);
    } else {
      const html = compileBodyLiveHtml(t.content);
      if (el.innerHTML !== html) el.innerHTML = html;
      lastSyncedFor.set(t.id, t.content);
    }
  }
}

/** 把编辑区 DOM 序列化回 Markdown 并写回产出（自动保存）。返回是否确实有变更。 */
function persistBodyEdit(turn: AiTurn, el: HTMLElement): boolean {
  const md = liveHtmlToMarkdown(el);
  if (md === turn.content) return false;
  lastSyncedFor.set(turn.id, md);
  turn.content = md;
  return true;
}

function onBodyInput(turn: AiTurn, event: Event) {
  const el = bodyEditors.get(turn.id);
  if (!el) return;
  const inputEv = event as InputEvent;
  /* 中文输入法组合期不落库，compositionend 时会再序列化一次。 */
  if (inputEv.isComposing || isComposingMap.get(turn.id)) return;
  recordUndoSnapshot(turn, false);
  persistBodyEdit(turn, el);
  if (!activeRefineAction.value) {
    selectedText.value = "";
    refineSelectionRange.value = null;
    refinePanelPos.value = null;
  }

  // 防抖调度实时上色与渲染，让 markdown 语法和配色即时呈现，同时避免干扰连续打字
  const existingTimer = liveRenderTimers.get(turn.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    liveRenderTimers.delete(turn.id);
    recompileBodyEditorLive(turn, true);
  }, 260);
  liveRenderTimers.set(turn.id, timer);
}

function onBodyCompositionStart(turn: AiTurn) {
  isComposingMap.set(turn.id, true);
  const existingTimer = liveRenderTimers.get(turn.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    liveRenderTimers.delete(turn.id);
  }
}

function onBodyCompositionEnd(turn: AiTurn) {
  isComposingMap.set(turn.id, false);
  const el = bodyEditors.get(turn.id);
  if (el) {
    recordUndoSnapshot(turn, true);
    persistBodyEdit(turn, el);

    const existingTimer = liveRenderTimers.get(turn.id);
    if (existingTimer) clearTimeout(existingTimer);
    const timer = setTimeout(() => {
      liveRenderTimers.delete(turn.id);
      recompileBodyEditorLive(turn, true);
    }, 60);
    liveRenderTimers.set(turn.id, timer);
  }
}

function onBodyPaste(turn: AiTurn, event: ClipboardEvent) {
  const el = bodyEditors.get(turn.id);
  if (!el) return;

  const text = event.clipboardData?.getData("text/plain");
  if (text !== undefined) {
    event.preventDefault();
    recordUndoSnapshot(turn, true);

    const sel = window.getSelection();
    let insertStartOffset = 0;

    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      insertStartOffset = getEditorCaretOffset(el);
      const range = sel.getRangeAt(0);
      range.deleteContents();

      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
    } else {
      insertStartOffset = (turn.content || "").length;
      el.appendChild(document.createTextNode(text));
    }

    const md = liveHtmlToMarkdown(el);
    turn.content = md;
    const newHtml = compileBodyLiveHtml(md);
    el.innerHTML = newHtml;
    lastSyncedFor.set(turn.id, md);

    const targetCaret = insertStartOffset + text.length;
    restoreEditorCaretOffset(el, targetCaret);
    onBodyFocusEvent();
  }
}

function onBodyBlur(turn: AiTurn) {
  const existingTimer = liveRenderTimers.get(turn.id);
  if (existingTimer) {
    clearTimeout(existingTimer);
    liveRenderTimers.delete(turn.id);
  }
  const el = bodyEditors.get(turn.id);
  if (el) {
    persistBodyEdit(turn, el);
    recordUndoSnapshot(turn, true);
    recompileBodyEditorLive(turn, false);
  }
  clearBodyFocused();
}

/* 语法折叠 / 暴露：光标落入哪一段，那一行块与行内标记原地展开底层 Markdown 语法。
   与文档界面 WYSIWYG 同一套机制：由全局 selectionchange 事件驱动，而非只有点击。
   从选区锚点一路向祖先链找 .md-block / .md-inline（锚点通常是文本节点，
   必须无条件沿 parentNode 上溯，再把元素类型判断放在循环体里），
   命中就给对应节点挂 .is-focused，让 CSS 原地暴露语法标记。 */
let bodyFocusedBlock: HTMLElement | null = null;
let bodyFocusedInline: HTMLElement | null = null;

function clearBodyFocused() {
  if (bodyFocusedBlock) {
    bodyFocusedBlock.classList.remove("is-focused");
    bodyFocusedBlock = null;
  }
  if (bodyFocusedInline) {
    bodyFocusedInline.classList.remove("is-focused");
    bodyFocusedInline = null;
  }
}

function onBodyFocusEvent() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    clearBodyFocused();
    return;
  }

  /* 核心修复：当选区非塌缩（用户正在拖选或已选中有长度的文字）时，
     绝不可切换 .is-focused，因为 .md-syntax display 在 none 与 inline 间切换
     会引起 DOM 局部重排（Reflow），导致浏览器原生 Range 选区被破坏并立即闪退！ */
  if (!sel.isCollapsed) {
    return;
  }

  const anchor = sel.anchorNode;
  if (!anchor) {
    clearBodyFocused();
    return;
  }

  /* 1. 沿祖先链定位所属的 WYSIWYG 编辑区（.auto-wysiwyg-body）。 */
  let editor: HTMLElement | null = null;
  let node: Node | null = anchor;
  while (node) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList && el.classList.contains("auto-wysiwyg-body")) {
        editor = el;
        break;
      }
      if (el.tagName === "HTML") break;
    }
    node = node.parentNode;
  }
  if (!editor || !editor.contains(anchor)) {
    clearBodyFocused();
    return;
  }

  /* 2. 从锚点再走一遍祖先链，取出最近的 .md-inline 与 .md-block。 */
  let block: HTMLElement | null = null;
  let inline: HTMLElement | null = null;
  let n: Node | null = anchor;
  while (n && n !== editor) {
    if (n.nodeType === Node.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (!inline && el.classList.contains("md-inline")) inline = el;
      if (!block && el.classList.contains("md-block")) block = el;
    }
    n = n.parentNode;
  }
  if (bodyFocusedBlock !== block) {
    if (bodyFocusedBlock) bodyFocusedBlock.classList.remove("is-focused");
    if (block) block.classList.add("is-focused");
    bodyFocusedBlock = block;
  }
  if (bodyFocusedInline !== inline) {
    if (bodyFocusedInline) bodyFocusedInline.classList.remove("is-focused");
    if (inline) inline.classList.add("is-focused");
    bodyFocusedInline = inline;
  }
}

/* 外部变更（流式输出 / 精修 / 版本切换 / 上色开关）后同步所有正文编辑区。 */
watch(
  aiTurns,
  () => nextTick(syncAllBodyEditors),
  { deep: true },
);
watch(
  () => contentColoringOn.value,
  () => {
    lastSyncedFor.clear();
    nextTick(syncAllBodyEditors);
  },
);

/* ---------------- 用户消息结构化展示：明文正文 + 选项胶囊 ----------------
   每条产出留档的 prompt 是「发给 AI 的整段要求」。直接全文展开太长、视觉过重，
   这里按确定性格式（各 build*Prompt 的拼接结构）拆解：
   - 大纲 / 灵感 / 细纲 / 参考文档 → 明文正文（用户真正输入的文字）；
   - 创作设定 / 故事定制 / 叙事定制 / 素材 / 任务参数 → 分组胶囊。 */

interface AutoUserChip {
  label: string;
  desc?: string;
}

interface AutoUserGroup {
  title: string;
  chips: AutoUserChip[];
}

interface AutoUserParts {
  mainText: string;
  groups: AutoUserGroup[];
}

const parsedUserCache = new Map<string, AutoUserParts>();

function parseUserMessage(prompt: string): AutoUserParts {
  const hit = parsedUserCache.get(prompt);
  if (hit) return hit;

  const mainLines: string[] = [];
  const groups: AutoUserGroup[] = [];
  type ParseMode =
    | "idle"
    | "topic"
    | "setup"
    | "story"
    | "narrative"
    | "material";
  let mode: ParseMode = "idle";
  let lastMaterial: AutoUserChip | null = null;

  const groupOf = (title: string): AutoUserGroup => {
    let g = groups.find((x) => x.title === title);
    if (!g) {
      g = { title, chips: [] };
      groups.push(g);
    }
    return g;
  };
  const addTaskChip = (label: string, desc?: string) => {
    const g = groupOf("任务");
    g.chips.push({ label, desc });
  };

  const rawLines = (prompt || "").split("\n");
  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    const header = /^\s*【(.+?)】[:：]?\s*(.*)$/.exec(line);
    if (header) {
      const key = header[1].trim();
      const rest = header[2].trim();
      lastMaterial = null;

      if (
        key === "大纲或灵感" ||
        key === "大纲或构思灵感" ||
        key === "细纲或大纲构思内容" ||
        key === "参考文档内容" ||
        key === "参考正文" ||
        key === "待处理参考正文" ||
        key === "待修改正文" ||
        key === "待处理正文"
      ) {
        mode = "topic";
        if (rest) mainLines.push(rest);
        continue;
      }
      if (key === "创作设定") {
        mode = "setup";
        continue;
      }
      if (
        key === "临时参考素材" ||
        key === "临时参考素材 / 知识项" ||
        key === "项目素材库参考内容" ||
        key === "项目素材库 / 知识项参考文档"
      ) {
        mode = "material";
        continue;
      }
      if (key === "故事定制要求（角色原型 / 经典情节）") {
        mode = "story";
        continue;
      }
      if (
        key === "叙事定制要求（结构 / 手法 / 结局）" ||
        key === "已指定的写作/叙事手法要求"
      ) {
        mode = "narrative";
        continue;
      }
      if (
        key === "写作模式" ||
        key === "篇幅定位" ||
        key === "字数" ||
        key === "目标字数" ||
        key === "输出目标" ||
        key === "篇幅类型" ||
        key === "变体重写指令" ||
        key === "处理目标" ||
        key === "目标" ||
        key === "处理要求" ||
        key === "审核意见" ||
        key === "读者评估反馈"
      ) {
        if (rest) addTaskChip(`${key}：${clipForChip(rest)}`, rest);
        mode = "idle";
        continue;
      }
      /* 其余 【…】 均为拼装外壳文案，不参与结构化。 */
      mode = "idle";
      continue;
    }

    if (mode === "topic") {
      mainLines.push(line);
      continue;
    }
    if (mode === "setup") {
      const m = /^-\s*(.+?)[:：]\s*(.*)$/.exec(line);
      if (m) {
        const g = groupOf("创作设定");
        g.chips.push({ label: `${m[1]}：${clipForChip(m[2])}`, desc: m[2] });
      }
      continue;
    }
    if (mode === "story") {
      const m = /^-\s*(.+?)[:：]\s*(.*)$/.exec(line);
      if (m) {
        const g = groupOf("故事定制");
        g.chips.push({ label: clipForChip(m[1]), desc: m[2] });
      }
      continue;
    }
    if (mode === "narrative") {
      const m = /^-\s*(.+?)[:：]\s*(.*)$/.exec(line);
      if (m) {
        const g = groupOf("叙事定制");
        g.chips.push({ label: clipForChip(m[1]), desc: m[2] });
      }
      continue;
    }
    if (mode === "material") {
      const title = /^###\s+(.*)$/.exec(line);
      if (title) {
        const g = groupOf("素材");
        const c: AutoUserChip = { label: clipForChip(title[1].trim()) };
        g.chips.push(c);
        lastMaterial = c;
        continue;
      }
      if (lastMaterial) {
        const merged = lastMaterial.desc
          ? `${lastMaterial.desc}\n${line}`
          : line;
        lastMaterial.desc = merged.length > 200 ? merged.slice(0, 200) + "…" : merged;
      }
      continue;
    }

    /* 兜底模式（idle）：若遇到指令列表项，自动归入对应胶囊组 */
    if (mode === "idle") {
      const m = /^-\s*(.+?)[:：]\s*(.*)$/.exec(line);
      if (m) {
        const k = m[1].trim();
        const v = m[2].trim();
        if (k === "目标" || k === "模式" || k === "篇幅定位" || k === "处理目标") {
          addTaskChip(`${k}：${clipForChip(v)}`, v);
        } else if (k === "设定") {
          const g = groupOf("创作设定");
          g.chips.push({ label: `设定：${clipForChip(v)}`, desc: v });
        }
      }
    }
  }

  let finalMainText = mainLines.join("\n").trim();
  if (!finalMainText && prompt.trim() && groups.length > 0) {
    const cleanLines = rawLines
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("【") && !l.startsWith("- ") && !l.startsWith("请") && !l.startsWith("以下是"));
    if (cleanLines.length > 0) {
      finalMainText = cleanLines.join("\n");
    }
  }

  const parts: AutoUserParts = {
    mainText: finalMainText,
    groups: groups.filter((g) => g.chips.length > 0),
  };
  if (parsedUserCache.size > 60) parsedUserCache.clear();
  parsedUserCache.set(prompt, parts);
  return parts;
}

function clipForChip(text: string): string {
  const t = (text || "").trim();
  return t.length > 26 ? t.slice(0, 26) + "…" : t;
}

/** 取某条产出的结构化用户消息（按 turn.id 缓存，prompt 不变则结果不变）。 */
const parsedUserById = new Map<number, AutoUserParts>();

function userMessageFor(turn: AiTurn): AutoUserParts {
  let parts = parsedUserById.get(turn.id);
  if (!parts) {
    parts = parseUserMessage(turn.prompt ?? "");
    parsedUserById.set(turn.id, parts);
  }
  return parts;
}

/* ---------------- History Entries & Selection ----------------
   两份机制各司其职（同一份 aiTurns 数据、两种视图）：
   - 「文稿」（左栏）：只记录正文文本 —— 标题 + 时间 + 内容摘要，点击定位中间区；
   - 「历史」（中间区头部按钮）：翻页进入独立的历史页，承载全部上下文对话
     （每条产出的用户侧指令 prompt + 思考过程 + 知识项工具轨迹 + 完整正文 + Tokens）。*/
const selectedHistoryId = ref<number | null>(null);

/** 自动工作区视图：work = 日常三栏，history = 历史对话页。 */
const autoViewMode = ref<"work" | "history">("work");

function goToHistoryPage() {
  autoViewMode.value = "history";
  selectedHistoryId.value = null;
}

function leaveHistoryPage() {
  autoViewMode.value = "work";
}

/* 历史对话页是折叠条目：默认只有一行标题，展开才铺开完整上下文
   （本轮要求 + 工具轨迹 + 思考过程 + 完整正文）。 */
const expandedHistoryIds = ref<Set<number>>(new Set());

function isHistoryExpanded(id: number): boolean {
  return expandedHistoryIds.value.has(id);
}

function toggleHistoryEntry(id: number) {
  const next = new Set(expandedHistoryIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expandedHistoryIds.value = next;
}

/** 点击历史条目：回到对话界面并定位到该条产出。 */
function jumpToTurnFromHistory(turn: AiTurn) {
  autoViewMode.value = "work";
  restoreHistory(turn);
}

/** 定位到某条产出（中间区滚动到该条目并高亮）。 */
function restoreHistory(turn: AiTurn) {
  selectedHistoryId.value = turn.id;
  setActiveTurn(turn);
  if (chatLayoutMode.value === "paged") {
    const grpIdx = turnGroups.value.findIndex((g) => g.turns.some((t) => t.id === turn.id));
    if (grpIdx !== -1) {
      activeRoundIndex.value = grpIdx;
    }
  }
  nextTick(() => {
    document
      .getElementById(`auto-turn-${turn.id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  showToast("已定位", `已定位到「${turnLabel(turn)}」条目`, "habit");
}

function deleteHistory(turn: AiTurn) {
  aiTurns.value = aiTurns.value.filter((t) => t.id !== turn.id);
  if (selectedHistoryId.value === turn.id) {
    selectedHistoryId.value = null;
  }
  if (auditDocId.value === String(turn.id)) {
    auditDocId.value = "current";
  }
}

/* ---------------- 对话目录条：精简短横与悬停展开索引 ----------------
   用户消息与 AI 回复均在目录中呈现；默认展示短横，光标靠近悬停展开 */
interface TocEntry {
  id: string;
  turnId: number;
  targetId: string;
  type: "user" | "ai";
  title: string;
}

const activeTocId = ref<string>("");

const tocItems = computed<TocEntry[]>(() => {
  const list: TocEntry[] = [];
  for (const turn of aiTurns.value) {
    if (turn.prompt) {
      const u = userMessageFor(turn);
      const rawText = (u.mainText || turn.prompt || "").trim();
      const firstLine =
        rawText
          .split("\n")
          .map((l) => l.trim())
          .find((l) => l.length > 0) || rawText;
      const cleanText =
        firstLine
          .replace(/^【.*?】\s*/g, "")
          .replace(/[*_`#>~-]/g, "")
          .trim() || "用户要求";
      list.push({
        id: `user-${turn.id}`,
        turnId: turn.id,
        targetId: `auto-user-${turn.id}`,
        type: "user",
        title: cleanText,
      });
    }
    list.push({
      id: `ai-${turn.id}`,
      turnId: turn.id,
      targetId: `auto-turn-${turn.id}`,
      type: "ai",
      title: turnLabel(turn),
    });
  }
  return list;
});

function tocJump(item: TocEntry) {
  autoViewMode.value = "work";
  selectedHistoryId.value = item.turnId;
  activeTocId.value = item.id;
  const targetTurn = aiTurns.value.find((t) => t.id === item.turnId);
  if (targetTurn) {
    setActiveTurn(targetTurn);
  }
  if (chatLayoutMode.value === "paged") {
    const grpIdx = turnGroups.value.findIndex((g) => g.turns.some((t) => t.id === item.turnId));
    if (grpIdx !== -1) {
      activeRoundIndex.value = grpIdx;
    }
  }
  nextTick(() => {
    const el = document.getElementById(item.targetId);
    const container = middleEditorRef.value;
    if (!el || !container) return;
    const cRect = container.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    container.scrollTo({
      top: container.scrollTop + (eRect.top - cRect.top) - 16,
      behavior: "smooth",
    });
  });
}

/** 依据中区滚动位置，高亮当前处于视野内的目录条目（取最先越过锚点的）。 */
function updateActiveTocIndex() {
  const container = middleEditorRef.value;
  const items = tocItems.value;
  if (!container || items.length === 0) {
    activeTocId.value = "";
    return;
  }
  const cRect = container.getBoundingClientRect();
  const anchor = cRect.top + 90;
  let currentId = items[0].id;
  for (let i = 0; i < items.length; i++) {
    const el = document.getElementById(items[i].targetId);
    if (!el) continue;
    if (el.getBoundingClientRect().top <= anchor) {
      currentId = items[i].id;
    } else {
      break;
    }
  }
  activeTocId.value = currentId;
}

/* ---------------- 文稿分类文件夹（拖拽归类） ---------------- */
const renamingFolderId = ref<string | null>(null);
const draftFolderRename = ref("");
const folderRenameInputEl = ref<HTMLInputElement | null>(null);
/** 文件夹折叠状态：以 autoStore.collapsedFolderIds 为数据源，持久化到跨会话设置。 */
const collapsedFolders = computed<Set<string>>(
  () => new Set(autoStore.collapsedFolderIds)
);
const draggingTurnId = ref<number | null>(null);
const dragOverFolderId = ref<string | null>(null);
const draggingOverRoot = ref(false);

function createDraftFolder() {
  const folder: DraftFolder = {
    id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    name: "新建文件夹",
  };
  autoStore.draftFolders.push(folder);
  renamingFolderId.value = folder.id;
  draftFolderRename.value = folder.name;
  nextTick(() => folderRenameInputEl.value?.focus());
}

function startFolderRename(folder: DraftFolder) {
  renamingFolderId.value = folder.id;
  draftFolderRename.value = folder.name;
  nextTick(() => folderRenameInputEl.value?.focus());
}

function commitFolderRename(folderId: string) {
  const folder = autoStore.draftFolders.find((f) => f.id === folderId);
  if (folder && draftFolderRename.value.trim()) {
    folder.name = draftFolderRename.value.trim();
  }
  renamingFolderId.value = null;
  draftFolderRename.value = "";
}

function cancelFolderRename() {
  renamingFolderId.value = null;
  draftFolderRename.value = "";
}

function deleteDraftFolder(folderId: string) {
  autoStore.draftFolders = autoStore.draftFolders.filter((f) => f.id !== folderId);
  autoStore.aiTurns.forEach((t) => {
    if (t.folderId === folderId) t.folderId = undefined;
  });
  autoStore.collapsedFolderIds = autoStore.collapsedFolderIds.filter((id) => id !== folderId);
}

function toggleFolderCollapse(folderId: string) {
  const next = new Set(autoStore.collapsedFolderIds);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  autoStore.collapsedFolderIds = Array.from(next);
}

function isFolderCollapsed(folderId: string): boolean {
  return collapsedFolders.value.has(folderId);
}

function turnsInFolder(folderId: string | null): AiTurn[] {
  return aiTurns.value.filter((t) => (t.folderId ?? null) === folderId);
}

/* 文稿卡片的拖拽归类走「长按指针拖拽」，与文档左栏（DocumentSidebar）同一套
   手势：按住不动 200ms 才武装拖拽，直接按下移动仍是划选文字。
   之前用的是原生 HTML5 DnD，`draggable="true"` 的卡片在 WebView2 里
   起手就会被浏览器接管成「选中 + 拖文本」，dragstart 常常压根不触发，
   于是卡片怎么按都进不了文件夹。 */
function beginTurnDrag(event: MouseEvent, turn: AiTurn) {
  const target = event.target as HTMLElement | null;
  /* 卡片内的删除按钮保持自己的行为。 */
  if (target?.closest("button, input")) return;

  startLongPressDrag({
    event,
    ghostVariant: "row",
    ghostLabel: turnLabel(turn),
    onStart: () => {
      draggingTurnId.value = turn.id;
    },
    onMove: (x, y) => updateTurnDropTarget(x, y),
    onDrop: (x, y) => {
      /* 松手点重新解析一次：最后一次 mousemove 可能离松手位置差了几像素。 */
      updateTurnDropTarget(x, y);
      commitTurnDrop();
    },
    onEnd: endTurnDrag,
  });
}

/** 解析光标下的投放目标：文件夹块（头部行 + 内部卡片，整个块都算）、或未分类区。 */
function updateTurnDropTarget(x: number, y: number) {
  dragOverFolderId.value = null;
  draggingOverRoot.value = false;

  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return;

  /* 与文档左栏同款判定：整个文件夹块（data-folder-id 挂在块容器上）都可投放，
     而不是只有头上一行 —— 拖进该文件夹现有卡片区也能归类，不会误当未分类。 */
  const folderBlock = el.closest<HTMLElement>(`.draft-folder-block[data-folder-id]`);
  if (folderBlock?.dataset.folderId) {
    dragOverFolderId.value = folderBlock.dataset.folderId;
    return;
  }
  if (el.closest<HTMLElement>(".draft-root-section")) {
    draggingOverRoot.value = true;
  }
}

function commitTurnDrop() {
  if (draggingTurnId.value == null) return;
  const turn = autoStore.aiTurns.find((t) => t.id === draggingTurnId.value);
  if (!turn) return;

  if (dragOverFolderId.value) {
    /* 投进收起的文件夹时自动展开，让用户看到结果。 */
    autoStore.collapsedFolderIds = autoStore.collapsedFolderIds.filter(
      (id) => id !== dragOverFolderId.value
    );

    turn.folderId = dragOverFolderId.value;
    const folder = autoStore.draftFolders.find((f) => f.id === turn.folderId);
    showToast("已归类", `「${turnLabel(turn)}」已移入「${folder?.name ?? "文件夹"}」`, "habit");
    return;
  }
  if (draggingOverRoot.value) {
    turn.folderId = undefined;
    showToast("已移出文件夹", `「${turnLabel(turn)}」已回到未分类`, "habit");
  }
}

function endTurnDrag() {
  draggingTurnId.value = null;
  dragOverFolderId.value = null;
  draggingOverRoot.value = false;
}

/* ---------------- 新建创作：每轮创作独立归档且持久保存 ---------------- */
function formatArchiveTime(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function resetWorkState() {
  stopGeneration();
  autoStore.aiTurns = [];
  groupActiveIndexMap.value = {};
  bodyEditors.clear();
  lastSyncedFor.clear();
  bodyEditorRefFns.clear();
  autoStore.topicContent = "";
  autoStore.sessionSources = [];
  autoStore.selectedStoryIds = [];
  autoStore.selectedNarrativeIds = [];
  (Object.keys(autoStore.setup) as (keyof AutoSetupState)[]).forEach(
    (key) => (autoStore.setup[key] = ""),
  );
  selectedHistoryId.value = null;
  auditDocId.value = "current";
  cancelRefinePrompt();
  activeRoundIndex.value = 0;
  undoStack.value = [];
  redoStack.value = [];
  lastSnapshotMap.clear();
  closeFindPanel();
  autoViewMode.value = "work";
}

function startNewCreation() {
  const hasContent =
    aiTurns.value.length > 0 ||
    !!topicContent.value.trim() ||
    setupSelectedCount.value > 0 ||
    autoStore.selectedStoryIds.length > 0 ||
    autoStore.selectedNarrativeIds.length > 0 ||
    autoStore.sessionSources.length > 0;

  if (hasContent) {
    autoStore.autoSessions.unshift({
      id: `session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      title: `创作 · ${formatArchiveTime()}`,
      createdAt: Date.now(),
      turns: JSON.parse(JSON.stringify(aiTurns.value)),
      topicContent: topicContent.value,
      setup: JSON.parse(JSON.stringify(autoStore.setup)),
      articleLength: articleLength.value as "short" | "medium" | "long",
      targetWordCount: targetWordCount.value,
      outputTargetType: outputTargetType.value as "story" | "outline",
      selectedStoryIds: [...autoStore.selectedStoryIds],
      selectedNarrativeIds: [...autoStore.selectedNarrativeIds],
    });
  }

  resetWorkState();
  showToast(
    "已新建创作",
    hasContent ? "上一轮创作已归档，当前已进入新一轮" : "已开始新一轮创作编排",
    "habit",
  );
}

function createBlankDoc() {
  const turnId = Date.now();
  const targetGroupId = String(turnId);
  const newTurn: AiTurn = {
    id: turnId,
    pageGroupId: targetGroupId,
    mode: writingMode.value || "writer",
    variant: "blank",
    title: "空白文稿",
    content: "",
    reasoning: "",
    tokens: 0,
    timestamp: formatCurrentTime(),
    incomplete: false,
    continued: 0,
    isBlankDoc: true,
  };

  aiTurns.value.push(newTurn);
  setGroupActiveIndex(targetGroupId, 0);
  activeRoundIndex.value = Math.max(0, turnGroups.value.length - 1);
  autoViewMode.value = "work";

  nextTick(() => {
    followStreamingOutput(true);
    const editor = bodyEditors.get(turnId);
    if (editor) {
      editor.focus();
    }
  });

  showToast(
    "已新建空白",
    "已创建空白编辑区，可直接输入或粘贴文本内容，完成后自动保存并进入文稿列表",
    "habit",
  );
}

async function pasteToBlank(turnId: number) {
  const turn = aiTurns.value.find((t) => t.id === turnId);
  if (!turn) return;
  try {
    let text = "";
    if (navigator.clipboard && navigator.clipboard.readText) {
      text = await navigator.clipboard.readText();
    }
    if (!text) {
      showToast("提示", "请使用快捷键 Ctrl+V / Cmd+V 在编辑区中直接粘贴", "edit");
      return;
    }
    recordUndoSnapshot(turn, true);
    turn.content = (turn.content ? turn.content + "\n\n" : "") + text;
    lastSyncedFor.delete(turn.id);
    syncBodyEditor(turn);
    const editor = bodyEditors.get(turnId);
    if (editor) {
      editor.focus();
      restoreEditorCaretOffset(editor, turn.content.length);
    }
    showToast("已粘贴", "内容已成功粘贴并渲染到当前文稿", "habit");
  } catch {
    showToast("提示", "请使用快捷键 Ctrl+V / Cmd+V 在编辑区中直接粘贴", "edit");
  }
}

function clearBlank(turnId: number) {
  const turn = aiTurns.value.find((t) => t.id === turnId);
  if (!turn) return;
  recordUndoSnapshot(turn, true);
  turn.content = "";
  syncBodyEditor(turn);
  const editor = bodyEditors.get(turnId);
  if (editor) {
    editor.focus();
  }
  showToast("已清空", "空白文稿已重置为空白", "edit");
}

function restoreSession(archive: AutoSessionArchive) {
  autoStore.autoSessions = autoStore.autoSessions.filter(
    (a) => a.id !== archive.id,
  );
  resetWorkState();
  autoStore.aiTurns = JSON.parse(JSON.stringify(archive.turns));
  autoStore.topicContent = archive.topicContent;
  autoStore.setup = JSON.parse(JSON.stringify(archive.setup));
  articleLength.value = archive.articleLength as "short" | "medium" | "long";
  targetWordCount.value = archive.targetWordCount;
  outputTargetType.value = archive.outputTargetType as "story" | "outline";
  autoStore.selectedStoryIds = [...archive.selectedStoryIds];
  autoStore.selectedNarrativeIds = [...archive.selectedNarrativeIds];
  showToast("已载入创作", `已恢复「${archive.title}」的全部内容`, "habit");
}

function deleteSessionArchive(id: string) {
  autoStore.autoSessions = autoStore.autoSessions.filter((a) => a.id !== id);
}

/* ---------------- 审核意见 / 读者：待处理文档选择 ----------------
   让用户从「当前正文」与已归档的历史版本中挑一份作为审核 / 评估对象。 */
const auditDocId = ref<string>("current");

interface AuditDocOption {
  id: string;
  label: string;
  content: string;
}

const auditDocOptions = computed<AuditDocOption[]>(() => {
  const list: AuditDocOption[] = [];
  const latestBody = aiMessage.value.content.trim();
  if (latestBody) {
    list.push({
      id: "current",
      label: `最新产出：${turnLabel(aiMessage.value)}（${latestBody.length} 字）`,
      content: aiMessage.value.content,
    });
  }
  for (const t of [...aiTurns.value].reverse()) {
    const body = t.content.trim();
    if (!body || t.id === aiMessage.value.id) continue;
    list.push({
      id: String(t.id),
      label: `${turnLabel(t)}${t.timestamp ? ` · ${t.timestamp}` : ""}（${body.length} 字）`,
      content: t.content,
    });
  }
  return list;
});

/** 解析出当前选中的待审核 / 待评估正文内容。 */
function resolveAuditDocContent(): string {
  const opts = auditDocOptions.value;
  if (opts.length === 0) return "";
  const hit = opts.find((o) => o.id === auditDocId.value);
  return (hit ?? opts[0]).content;
}

/* ---------------- Paragraph Text Selection & Floating Refinement Toolbar ----------------
   用户在正文中划选文字后，精修功能栏不再固定在回复卡片顶部，而是作为悬浮面板
   跟随选中文字的视口位置，浮在选区上方（空间不足时自动翻到下方）。*/
const selectedText = ref("");
const activeRefineAction = ref<string | null>(null);
const refineUserInstruction = ref("");
const isRefiningParagraph = ref(false);
/** 当前选中的文字属于哪一条产出（多条目会话里定位改写对象）。 */
const refineTurnId = ref<number | null>(null);
/** 选中文字在 DOM 里的 Range 快照：既用于计算悬浮面板的落点坐标，
    也用于精修完成后在编辑区里原地替换选中的文字。 */
const refineSelectionRange = ref<Range | null>(null);
/** 悬浮精修面板的锚点坐标（position: fixed 相对视口）。 */
const refinePanelPos = ref<{ left: number; top?: number; bottom?: number } | null>(null);
const floatingRefinePanelEl = ref<HTMLElement | null>(null);

/** 跟踪鼠标按下状态，避免在鼠标拖选文字过程中触发 DOM 改动或 Vue 重渲染打断选区导致闪退。 */
let isMouseDownOnDoc = false;

function onDocMouseDown(e: MouseEvent) {
  const target = e.target as HTMLElement | null;
  if (!target || !target.closest(".floating-refine-panel")) {
    isMouseDownOnDoc = true;
  }
}

function onDocMouseUp() {
  isMouseDownOnDoc = false;
  /* 鼠标松开时触发一次选区同步，若划选了正文则稳定展示悬浮工具栏 */
  handleTextSelection();
}

function onSelectionChangeForRefine() {
  const sel = window.getSelection();
  /* 选区清空或单点光标落入时，即时清空非活动状态的精修面板 */
  if (!sel || sel.isCollapsed) {
    if (!activeRefineAction.value) {
      selectedText.value = "";
      refineTurnId.value = null;
      refineSelectionRange.value = null;
      refinePanelPos.value = null;
    }
    return;
  }
  /* 鼠标拖拽中不立即触发响应式渲染打断手势，等待 mouseup 时平滑展现 */
  if (isMouseDownOnDoc) {
    return;
  }
  handleTextSelection();
}

function handleTextSelection() {
  const sel = window.getSelection();
  const anchor = sel ? sel.anchorNode : null;
  const el =
    anchor && anchor.nodeType === Node.TEXT_NODE
      ? anchor.parentElement
      : (anchor as HTMLElement | null);

  /* 选区塌缩 / 无选区 / 不在中区正文渲染区之内（用户消息、思考链、侧栏、
   其他页面等）：收起精修面板。精修进行中保留面板，等用户点生成或取消。 */
  if (
    !sel ||
    sel.isCollapsed ||
    !el ||
    !el.closest(".middle-editor") ||
    !el.closest(".turn-rendered-content")
  ) {
    if (!activeRefineAction.value) {
      selectedText.value = "";
      refineTurnId.value = null;
      refineSelectionRange.value = null;
      refinePanelPos.value = null;
    }
    return;
  }
  /* 输入控件 / 精修面板 / 一键排版菜单 / 排版字体面板内部产生的选区不接管正文选中状态。 */
  if (el.closest("input, textarea, .floating-refine-panel, .auto-format-menu, .auto-typo-panel")) {
    return;
  }
  const text = sel.toString().trim();
  if (text.length === 0) return;
  selectedText.value = text;
  const card = el.closest<HTMLElement>("[data-turn-id]");
  refineTurnId.value = card ? Number(card.dataset.turnId) : null;
  if (sel.rangeCount > 0) {
    refineSelectionRange.value = sel.getRangeAt(0).cloneRange();
  }
  nextTick(layoutRefinePanel);
}

/** 计算悬浮精修面板的落点：默认浮在选区上方，上方空间不足时翻到下方，并夹取在视口内。
    安全排版：绝不使用无限制 nextTick 自递归，防止由于微任务死循环导致页面彻底冻结。 */
let isRefinePanelLayoutRetrying = false;

function layoutRefinePanel() {
  const range = refineSelectionRange.value;
  if (!range || !selectedText.value || customContextMenu.value.visible) {
    refinePanelPos.value = null;
    return;
  }
  // 若选区节点已从 DOM 断开连接，直接收起面板
  if (!range.startContainer || !range.startContainer.isConnected) {
    refinePanelPos.value = null;
    return;
  }
  const panel = floatingRefinePanelEl.value;
  if (!panel) {
    // 首次挂载时至多安全重试一次，绝不递归发起 nextTick
    if (!isRefinePanelLayoutRetrying) {
      isRefinePanelLayoutRetrying = true;
      nextTick(() => {
        isRefinePanelLayoutRetrying = false;
        if (
          floatingRefinePanelEl.value &&
          selectedText.value &&
          refineSelectionRange.value &&
          !customContextMenu.value.visible
        ) {
          layoutRefinePanelDirect();
        }
      });
    }
    return;
  }
  layoutRefinePanelDirect();
}

function layoutRefinePanelDirect() {
  const range = refineSelectionRange.value;
  if (!range || !selectedText.value || customContextMenu.value.visible) {
    refinePanelPos.value = null;
    return;
  }
  if (!range.startContainer || !range.startContainer.isConnected) {
    refinePanelPos.value = null;
    return;
  }
  const panel = floatingRefinePanelEl.value;
  if (!panel) return;

  let rect: DOMRect;
  try {
    rect = range.getBoundingClientRect();
  } catch {
    refinePanelPos.value = null;
    return;
  }
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    refinePanelPos.value = null;
    return;
  }
  /* 选中文字滚出视口时收起面板，避免悬浮条与正文脱节；滚回视野内时自动复现。 */
  if (rect.bottom < 0 || rect.top > window.innerHeight) {
    refinePanelPos.value = null;
    return;
  }

  const gap = 10;
  const panelW = panel.offsetWidth || 280;
  const panelH = panel.offsetHeight || 46;
  const centerX = rect.left + rect.width / 2;
  let left = centerX - panelW / 2;
  left = Math.max(6, Math.min(left, window.innerWidth - panelW - 6));

  const spaceAbove = rect.top - gap;
  const spaceBelow = window.innerHeight - rect.bottom - gap;

  if (spaceAbove >= panelH) {
    /* 上方放得下：面板贴住选区顶部向上展开（bottom 锚定，高度增长不影响贴合）。 */
    refinePanelPos.value = { left: Math.round(left), bottom: Math.round(window.innerHeight - rect.top + gap) };
  } else if (spaceBelow >= panelH) {
    /* 上方不足但下方有空间：翻到选区下方。 */
    refinePanelPos.value = { left: Math.round(left), top: Math.round(rect.bottom + gap) };
  } else {
    /* 上下都不足：优先上方并夹取，保证面板整体可见。 */
    const clampedBottom = Math.max(6, Math.min(window.innerHeight - rect.top + gap, window.innerHeight - panelH - 6));
    refinePanelPos.value = { left: Math.round(left), bottom: Math.round(clampedBottom) };
  }
}

const refinePanelStyle = computed(() => {
  const p = refinePanelPos.value;
  if (!p) return { left: "-9999px", top: "-9999px" };
  const s: Record<string, string> = { left: p.left + "px" };
  if (typeof p.top === "number") s.top = p.top + "px";
  else if (typeof p.bottom === "number") s.bottom = p.bottom + "px";
  return s;
});

function openRefinePrompt(actionKey: string) {
  if (!selectedText.value) {
    showToast("提示", "请先在正文中选中需要改写的段落", "edit");
    return;
  }
  activeRefineAction.value = actionKey;
  refineUserInstruction.value = "";
  nextTick(layoutRefinePanel);
}

function cancelRefinePrompt() {
  activeRefineAction.value = null;
  refineUserInstruction.value = "";
  selectedText.value = "";
  refineTurnId.value = null;
  refineSelectionRange.value = null;
  refinePanelPos.value = null;
  const sel = window.getSelection();
  if (sel) sel.removeAllRanges();
  clearBodyFocused();
}

/* 面板内容变化（展开输入卡片 / 生成中按钮文案变化）后重新排版落点。 */
watch([activeRefineAction, isRefiningParagraph], () => nextTick(layoutRefinePanel));

/** 精修结果优先在编辑区 DOM 里原地替换选中文字，再序列化回 markdown ——
    与 WYSIWYG 正文的选区 / 内容一一对应，避免直接对 markdown 字符串做
    replace 时因语法标记（#、** 等）找不到原片段而失效。 */
function applyRefinedTextInBody(newText: string, turn: AiTurn): boolean {
  const range = refineSelectionRange.value;
  const bodyEl = bodyEditors.get(turn.id);
  if (!bodyEl || !range || !range.startContainer || !range.startContainer.isConnected) {
    return false;
  }
  try {
    range.deleteContents();
    range.insertNode(document.createTextNode(newText));
    const md = liveHtmlToMarkdown(bodyEl);
    lastSyncedFor.set(turn.id, md);
    turn.content = md;
    return true;
  } catch {
    return false;
  }
}
void applyRefinedTextInBody;

function cleanRefinedProse(rawText: string, originalText: string): string {
  if (!rawText) return "";
  let text = rawText.trim();

  // 1. 去除包裹的 markdown / text 代码块标识
  text = text.replace(/^```(?:markdown|text)?\n([\s\S]*?)\n```$/i, "$1").trim();

  // 2. 去除 AI 常见的寒暄或前缀引言（如 "改写如下："、"优化后："、"润色结果：" 等）
  text = text.replace(/^(?:好的[，,。]?\s*)?(?:为你|为您)?(?:改写|修改|优化|精修|润色|重写)(?:如下|结果|内容|段落)?[：:\n\s]*/i, "");
  text = text.replace(/^(?:【(?:改写后|改写结果|优化结果|润色结果|正文|修改建议)】)[：:\n\s]*/i, "");
  text = text.replace(/^(?:方案[一二三四1234]|版本[一二三四1234]|建议[一二三四1234])[：:\n\s]*/i, "");

  // 3. 去除尾部的解释性说明与反思
  text = text.replace(/\n+(?:说明|解析|改写思路|优化重点|修改理由|主要改动)[：:][\s\S]*$/i, "").trim();

  // 4. 去除列表化序号（如 1. xxx / 1、xxx / - xxx），避免列举，直接输出连贯的正文段落
  const originalIsList = /^\s*(?:\d+[\.、\)]|[-*•])\s+/.test(originalText);
  if (!originalIsList) {
    const lines = text.split("\n");
    const cleanedLines = lines.map((line) => {
      return line.replace(/^\s*(?:\d+[\.、\)]|\(\d+\)|[-*•])\s+/, "").trim();
    }).filter((line) => line.length > 0);

    text = cleanedLines.join("\n\n");
  }

  return cleanWhitespaceFormatting(text);
}

interface RefineDiffSuggestion {
  turnId: number;
  action: string;
  originalText: string;
  refinedText: string;
  selectionRange?: Range | null;
  targetRect?: { left: number; top: number; bottom: number; width: number; height: number } | null;
  timestamp: number;
}

const activeRefineDiff = ref<RefineDiffSuggestion | null>(null);
const refineDiffPos = ref<{ left: number; top?: number; bottom?: number; width: number } | null>(null);
const refineDiffUserMoved = ref(false);
let isDraggingRefineDiff = false;
let refineDiffDragStartX = 0;
let refineDiffDragStartY = 0;
let refineDiffDragInitialLeft = 0;
let refineDiffDragInitialTop = 0;

function onRefineDiffDragStart(e: MouseEvent) {
  if ((e.target as HTMLElement)?.closest("button, input, textarea")) return;
  if (!refineDiffPos.value) return;

  isDraggingRefineDiff = true;
  refineDiffDragStartX = e.clientX;
  refineDiffDragStartY = e.clientY;

  const cardEl = document.querySelector(".floating-refine-diff-card") as HTMLElement | null;
  if (cardEl) {
    const rect = cardEl.getBoundingClientRect();
    refineDiffDragInitialLeft = rect.left;
    refineDiffDragInitialTop = rect.top;
  } else {
    refineDiffDragInitialLeft = refineDiffPos.value.left;
    refineDiffDragInitialTop = refineDiffPos.value.top ?? 80;
  }

  window.addEventListener("mousemove", onRefineDiffDragMove);
  window.addEventListener("mouseup", onRefineDiffDragEnd);
  e.preventDefault();
}

function onRefineDiffDragMove(e: MouseEvent) {
  if (!isDraggingRefineDiff || !refineDiffPos.value) return;
  const dx = e.clientX - refineDiffDragStartX;
  const dy = e.clientY - refineDiffDragStartY;

  const cardW = refineDiffPos.value.width || 680;
  const newLeft = Math.max(10, Math.min(window.innerWidth - cardW - 10, refineDiffDragInitialLeft + dx));
  const newTop = Math.max(10, Math.min(window.innerHeight - 80, refineDiffDragInitialTop + dy));

  refineDiffUserMoved.value = true;
  refineDiffPos.value = {
    left: Math.round(newLeft),
    top: Math.round(newTop),
    bottom: undefined,
    width: cardW,
  };
}

function onRefineDiffDragEnd() {
  isDraggingRefineDiff = false;
  window.removeEventListener("mousemove", onRefineDiffDragMove);
  window.removeEventListener("mouseup", onRefineDiffDragEnd);
}

function resetRefineDiffPosition() {
  refineDiffUserMoved.value = false;
  layoutRefineDiff();
}

/* ---------------- 自定义右键菜单 (仅剪切、复制、粘贴、删除、全选) ---------------- */
interface CustomContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  turnId: number | null;
  targetEditor: HTMLElement | null;
  hasSelection: boolean;
  canEdit: boolean;
}

const customContextMenu = ref<CustomContextMenuState>({
  visible: false,
  x: 0,
  y: 0,
  turnId: null,
  targetEditor: null,
  hasSelection: false,
  canEdit: false,
});

/* 「功能」二级菜单展开状态与定位（右键菜单同源样式）。 */
const contextMenuFnOpen = ref(false);
const contextMenuFnPos = ref({ x: 0, y: 0 });
const contextMenuFunctionBtnRef = ref<HTMLElement | null>(null);
/** 打开右键菜单瞬间的选区快照：点击菜单项后浏览器常常折叠选区，用它兜底。 */
const menuSelectionRange = ref<Range | null>(null);

function openCustomContextMenu(turn: AiTurn, e: MouseEvent) {
  e.preventDefault();
  e.stopPropagation();

  const targetEl = e.currentTarget as HTMLElement | null;
  const sel = window.getSelection();
  const selStr = sel ? sel.toString() : "";
  const hasSel = selStr.length > 0;
  const editable = bodyEditable(turn);

  /* 选中的文字必须落在当前正文编辑区内，才在菜单关闭后还能原地应用智能文本功能。 */
  let snapRange: Range | null = null;
  if (sel && sel.rangeCount > 0 && targetEl) {
    const r = sel.getRangeAt(0);
    if (!r.collapsed && targetEl.contains(r.commonAncestorContainer)) {
      snapRange = r.cloneRange();
    }
  }
  menuSelectionRange.value = snapRange;

  // 计算菜单落点，确保不出屏幕边缘
  const menuWidth = 176;
  const menuHeight = 280;
  let posX = e.clientX;
  let posY = e.clientY;
  if (posX + menuWidth > window.innerWidth - 12) {
    posX = window.innerWidth - menuWidth - 12;
  }
  if (posY + menuHeight > window.innerHeight - 12) {
    posY = window.innerHeight - menuHeight - 12;
  }

  customContextMenu.value = {
    visible: true,
    x: Math.max(8, posX),
    y: Math.max(8, posY),
    turnId: turn.id,
    targetEditor: targetEl,
    hasSelection: hasSel,
    canEdit: editable,
  };
  contextMenuFnOpen.value = false;

  /* 右键菜单打开时，「选中正文定位」悬浮精修面板要消失规避：清掉它的定位与状态，
     避免两块浮层同时压在正文上互相遮挡（选区本身仍由 menuSelectionRange 快照保留）。 */
  refinePanelPos.value = null;
  activeRefineAction.value = null;
  selectedText.value = "";
  refineSelectionRange.value = null;
  refineTurnId.value = null;
}

function closeCustomContextMenu() {
  customContextMenu.value.visible = false;
  contextMenuFnOpen.value = false;
  menuSelectionRange.value = null;
}

async function handleContextMenuCut() {
  const menu = customContextMenu.value;
  const editor = menu.targetEditor;
  const turnId = menu.turnId;
  closeCustomContextMenu();
  if (!menu.canEdit || !editor) return;

  // 清除精修面板残留状态，避免悬浮层留在已删除的文字上
  selectedText.value = "";
  refineSelectionRange.value = null;
  refinePanelPos.value = null;

  const sel = window.getSelection();
  const text = sel ? sel.toString() : "";
  if (!text) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      document.execCommand("copy");
    }
  } catch {
    try {
      document.execCommand("copy");
    } catch {}
  }

  if (sel && sel.rangeCount > 0) {
    try {
      const range = sel.getRangeAt(0);
      range.deleteContents();
    } catch (e) {
      console.warn("Cut deleteContents failed", e);
    }
  }

  if (turnId !== null) {
    const turn = aiTurns.value.find((t) => t.id === turnId);
    if (turn) {
      recordUndoSnapshot(turn, true);
      persistBodyEdit(turn, editor);
    }
  }
  showToast("已剪切", "所选文字已剪切至剪贴板", "edit");
}

async function handleContextMenuCopy() {
  closeCustomContextMenu();
  const sel = window.getSelection();
  const text = sel ? sel.toString() : "";
  if (!text) return;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      showToast("已复制", "所选文字已复制到剪贴板", "habit");
    } else {
      document.execCommand("copy");
      showToast("已复制", "所选文字已复制到剪贴板", "habit");
    }
  } catch {
    try {
      document.execCommand("copy");
      showToast("已复制", "所选文字已复制到剪贴板", "habit");
    } catch {
      showToast("复制提示", "请使用快捷键 Ctrl+C 复制所选文字", "edit");
    }
  }
}

async function handleContextMenuPaste() {
  const menu = customContextMenu.value;
  const editor = menu.targetEditor;
  const turnId = menu.turnId;
  closeCustomContextMenu();
  if (!menu.canEdit || !editor) return;

  let textToPaste = "";
  try {
    if (navigator.clipboard && navigator.clipboard.readText) {
      textToPaste = await navigator.clipboard.readText();
    }
  } catch {
    showToast("提示", "请使用快捷键 Ctrl+V / Cmd+V 粘贴", "edit");
    return;
  }

  if (!textToPaste) return;

  // 清空精修状态
  selectedText.value = "";
  refineSelectionRange.value = null;
  refinePanelPos.value = null;

  try {
    editor.focus();
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const node = document.createTextNode(textToPaste);
      range.insertNode(node);
      range.setStartAfter(node);
      range.setEndAfter(node);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(document.createTextNode(textToPaste));
    }
  } catch (e) {
    console.warn("Paste insertion failed", e);
    editor.appendChild(document.createTextNode(textToPaste));
  }

  if (turnId !== null) {
    const turn = aiTurns.value.find((t) => t.id === turnId);
    if (turn) {
      recordUndoSnapshot(turn, true);
      persistBodyEdit(turn, editor);
    }
  }
  showToast("已粘贴", "内容已插入至正文", "habit");
}

function handleContextMenuDelete() {
  const menu = customContextMenu.value;
  const editor = menu.targetEditor;
  const turnId = menu.turnId;
  closeCustomContextMenu();
  if (!menu.canEdit || !editor) return;

  // 清除精修面板残留状态
  selectedText.value = "";
  refineSelectionRange.value = null;
  refinePanelPos.value = null;

  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && sel.toString().length > 0) {
    try {
      const range = sel.getRangeAt(0);
      range.deleteContents();
    } catch (e) {
      console.warn("Delete range failed", e);
    }
    if (turnId !== null) {
      const turn = aiTurns.value.find((t) => t.id === turnId);
      if (turn) {
        recordUndoSnapshot(turn, true);
        persistBodyEdit(turn, editor);
      }
    }
    showToast("已删除", "已清除所选文字", "edit");
  }
}

function handleContextMenuSelectAll() {
  const menu = customContextMenu.value;
  const editor = menu.targetEditor;
  closeCustomContextMenu();
  if (!editor) return;

  try {
    editor.focus();
    const sel = window.getSelection();
    if (sel) {
      const range = document.createRange();
      range.selectNodeContents(editor);
      sel.removeAllRanges();
      sel.addRange(range);
      handleTextSelection();
    }
  } catch (e) {
    console.warn("Select all failed", e);
  }
}

/* ---------------- 右键菜单「功能」二级菜单：智能交换 / 英文大小写 / 首字母大小写 / 智能引号 / 智能空格 ----------------
   与文档界面「选中文字浮现工具栏」的文本处理能力同一组算法（功能保留不变），
   只是交互形态换成右键菜单的二级展开样式。 */

/** 打开 / 收起「功能」二级菜单：跟随「功能」按钮右侧展开，空间不足自动翻到左侧。 */
function toggleContextFunctionSubmenu() {
  if (contextMenuFnOpen.value) {
    contextMenuFnOpen.value = false;
    return;
  }
  const btn = contextMenuFunctionBtnRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const menuW = 176;
  const menuH = 224;
  let x = rect.right + 2;
  let y = rect.top - 2;
  if (x + menuW > window.innerWidth - 8) x = rect.left - menuW - 2;
  if (y + menuH > window.innerHeight - 8) y = Math.max(8, window.innerHeight - 8 - menuH);
  contextMenuFnPos.value = { x: Math.round(x), y: Math.round(y) };
  contextMenuFnOpen.value = true;
}

function closeContextFunctionSubmenu() {
  contextMenuFnOpen.value = false;
}

/** 智能文本功能执行前：把「编辑前正文」登记为可撤销基线。
    与输入防抖共用同一撤销栈；栈顶已是同一内容时跳过，避免重复项。 */
function pushSmartEditUndoBase(turn: AiTurn) {
  if (!turn || isAuditOrReaderTurn(turn)) return;
  const current = turn.content || "";
  const top = undoStack.value[undoStack.value.length - 1];
  if (!(top && top.turnId === turn.id && top.content === current)) {
    undoStack.value.push({ turnId: turn.id, content: current, timestamp: Date.now() });
    if (undoStack.value.length > 60) undoStack.value.shift();
  }
  redoStack.value = [];
  lastSnapshotMap.set(turn.id, current);
}

/** 计算某个 DOM 位置 (container, offset) 在编辑器 markdown 文本里的绝对偏移。
    与 MarkdownWysiwyg 的序列化结果对齐：每个 .md-block 一行，块间以 \n 连接。 */
function mdOffsetAtDom(editor: HTMLElement, container: Node, offset: number): number {
  const mdBlocks = Array.from(editor.querySelectorAll<HTMLElement>(":scope > .md-block"));
  if (mdBlocks.length === 0) return 0;

  let block: HTMLElement | null =
    container instanceof HTMLElement ? container : container.parentElement;
  while (block && !mdBlocks.includes(block)) block = block.parentElement;
  const owner = (block ?? mdBlocks[0]) as HTMLElement;

  let before = 0;
  for (const b of mdBlocks) {
    if (b === owner) break;
    before += serializeLiveBlock(b).length + 1;
  }
  return before + mdOffsetWithinBlock(owner, container, offset);
}

/** 某一位置在同一块内的 markdown 偏移（含隐藏语法字符，逐节点按序列化长度计量）。 */
function mdOffsetWithinBlock(block: HTMLElement, container: Node, offset: number): number {
  let acc = 0;
  function walk(n: Node): boolean {
    if (n === container) {
      if (n.nodeType === Node.TEXT_NODE) {
        acc += Math.max(0, offset);
        return true;
      }
      const children = Array.from(n.childNodes);
      for (let i = 0; i < Math.min(Math.max(0, offset), children.length); i++) {
        acc += liveNodeToMarkdown(children[i]).length;
      }
      return true;
    }
    if (n.nodeType === Node.TEXT_NODE) {
      acc += (n.textContent || "").length;
      return false;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    /* 子树不含目标位置：直接按序列化长度整片计量，不再下钻。 */
    if (!n.contains(container)) {
      acc += liveNodeToMarkdown(n).length;
      return false;
    }
    for (const c of Array.from(n.childNodes)) {
      if (walk(c)) return true;
    }
    return false;
  }
  walk(block);
  return acc;
}

/** 把选区文字经 transform 转换后写回正文（字符串级替换，不做 DOM 手术，
    避免直接在 WYSIWYG 编辑区里 Range 删除/插入导致界面失序卡死）。 */
function transformContextMenuSelection(
  turn: AiTurn,
  editor: HTMLElement,
  transform: (sel: string) => string
): boolean {
  /* 优先用打开菜单瞬间的快照 Range；被改写失效时回退到实时选区。 */
  let range: Range | null = null;
  const snap = menuSelectionRange.value;
  if (snap && snap.startContainer && snap.startContainer.isConnected) {
    range = snap;
  } else {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (!r.collapsed && editor.contains(r.commonAncestorContainer)) range = r;
    }
  }
  if (!range || range.collapsed) return false;

  const md = turn.content || "";
  if (!md) return false;

  let start = mdOffsetAtDom(editor, range.startContainer, range.startOffset);
  let end = mdOffsetAtDom(editor, range.endContainer, range.endOffset);
  start = Math.max(0, Math.min(md.length, start));
  end = Math.max(start, Math.min(md.length, end));
  if (end <= start) return false;

  const selected = md.slice(start, end);
  const out = transform(selected);
  if (out === selected) return false;

  /* 编辑前快照：保证 Ctrl+Z 能精确撤销本次智能功能改动。 */
  pushSmartEditUndoBase(turn);

  const next = md.slice(0, start) + out + md.slice(end);
  turn.content = next;
  /* 强制编辑区按新内容重建 DOM（destroy 旧选区由重渲染统一接管）。 */
  lastSyncedFor.delete(turn.id);
  syncBodyEditor(turn);
  lastSnapshotMap.set(turn.id, next);
  showToast("功能已应用", "已对选中文字执行文本功能", "habit");
  return true;
}

/** 文本功能动作的统一入口：完成后关闭右键菜单；无效果时给出轻提示。
    任何异常都不得把界面卡死：务必先收起右键菜单再向上冒泡。 */
function runContextFunction(transform: (sel: string) => string) {
  const menu = customContextMenu.value;
  const turnId = menu.turnId;
  if (turnId === null || !menu.targetEditor) {
    closeCustomContextMenu();
    return;
  }
  const turn = aiTurns.value.find((t) => t.id === turnId);
  if (!turn) {
    closeCustomContextMenu();
    return;
  }
  let done = false;
  try {
    done = transformContextMenuSelection(turn, menu.targetEditor, transform);
  } catch (err: any) {
    console.error("文本功能执行失败", err);
    showToast("文本功能执行失败", err?.message || "未知错误，请重试", "edit");
  } finally {
    closeCustomContextMenu();
  }
  if (!done) {
    showToast("无可转换内容", "请保持选中的文字后重试", "edit");
  }
}

/** 智能交换：把选中文字按「单个汉字/中文、英文单词、数字、标点」切成块，相邻两类
    两两互换位置，空格原位保留。中文汉字逐字作为独立块，支持汉字之间位置智能交换。 */
function smartSwapTransform(sel: string): string {
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
}

/** 英文大小写整体切换：全大写 ⇄ 小写（仅作用于英文字母）。 */
function smartEnglishCaseTransform(sel: string): string {
  const letters = sel.match(/[A-Za-z]/g) ?? [];
  if (letters.length === 0) return sel;
  const allUpper = letters.every((c) => c === c.toUpperCase());
  return sel.replace(/[A-Za-z]+/g, (w) => (allUpper ? w.toLowerCase() : w.toUpperCase()));
}

/** 英文单词首字母大小写切换：大写 ⇄ 小写，其余字母不动。 */
function smartWordCapitalsTransform(sel: string): string {
  const words = sel.match(/[A-Za-z]+/g) ?? [];
  if (words.length === 0) return sel;
  const allCapped = words.every((w) => /[A-Z]/.test(w[0]));
  return sel.replace(/[A-Za-z]+/g, (w) =>
    allCapped ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1),
  );
}

/** 智能引号：把半角直引号替换为成对弯引号（开闭按前后语境判定）；
    若选中文字中没有直引号，则自动在选中文字两侧加上智能双引号 “…” 。 */
function smartQuotesTransform(sel: string): string {
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
}

/** 智能空格：中文句子、段落中的英文单词或字母与左右两侧的中文汉字之间自动补空格，
    标点符号、数字及其他符号不需要空格处理。 */
function smartSpacesTransform(sel: string): string {
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
}

function layoutRefineDiff() {
  if (!activeRefineDiff.value) {
    refineDiffPos.value = null;
    return;
  }
  if (refineDiffUserMoved.value) {
    return;
  }
  const range = activeRefineDiff.value.selectionRange;
  let rect: DOMRect | null = null;
  if (range && range.startContainer && range.startContainer.isConnected) {
    try {
      rect = range.getBoundingClientRect();
    } catch {
      rect = null;
    }
  }

  if (!rect || (rect.width === 0 && rect.height === 0)) {
    if (activeRefineDiff.value.targetRect) {
      const tr = activeRefineDiff.value.targetRect;
      rect = {
        left: tr.left,
        top: tr.top,
        bottom: tr.bottom,
        right: tr.left + tr.width,
        width: tr.width,
        height: tr.height,
        x: tr.left,
        y: tr.top,
        toJSON: () => ({}),
      } as DOMRect;
    } else {
      const turnId = activeRefineDiff.value.turnId;
      const cardEl = document.querySelector(`[data-turn-id="${turnId}"] .auto-wysiwyg-body`) || document.querySelector(".middle-editor");
      if (cardEl) {
        rect = cardEl.getBoundingClientRect();
      }
    }
  }

  if (!rect) return;

  const gap = 10;
  const maxW = Math.min(680, window.innerWidth - 32);
  const centerX = rect.left + rect.width / 2;
  let left = centerX - maxW / 2;
  left = Math.max(16, Math.min(left, window.innerWidth - maxW - 16));

  const spaceBelow = window.innerHeight - rect.bottom - gap;
  const spaceAbove = rect.top - gap;

  if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
    // 渲染在选中段落下方
    refineDiffPos.value = {
      left: Math.round(left),
      top: Math.round(Math.max(10, rect.bottom + gap)),
      width: Math.round(maxW),
    };
  } else {
    // 空间不足时渲染在选中段落上方
    refineDiffPos.value = {
      left: Math.round(left),
      bottom: Math.round(Math.max(10, window.innerHeight - rect.top + gap)),
      width: Math.round(maxW),
    };
  }
}

const refineDiffStyle = computed(() => {
  const p = refineDiffPos.value;
  if (!p) return { display: "none" };
  const s: Record<string, string> = {
    left: p.left + "px",
    width: p.width + "px",
    position: "fixed",
    zIndex: "1005",
  };
  if (typeof p.top === "number") s.top = p.top + "px";
  else if (typeof p.bottom === "number") s.bottom = p.bottom + "px";
  return s;
});

function acceptCurrentRefineDiff() {
  if (!activeRefineDiff.value) return;
  const turnId = activeRefineDiff.value.turnId;
  const turn = aiTurns.value.find((t) => t.id === turnId) ?? aiMessage.value;
  acceptRefineDiff(turn);
}

function acceptRefineDiff(turn: AiTurn) {
  if (!activeRefineDiff.value) return;
  const { originalText, refinedText, selectionRange } = activeRefineDiff.value;

  recordUndoSnapshot(turn, true);
  let applied = false;
  const bodyEl = bodyEditors.get(turn.id);
  if (bodyEl && selectionRange && selectionRange.startContainer && selectionRange.startContainer.isConnected) {
    try {
      selectionRange.deleteContents();
      selectionRange.insertNode(document.createTextNode(refinedText));
      const md = liveHtmlToMarkdown(bodyEl);
      lastSyncedFor.set(turn.id, md);
      turn.content = md;
      applied = true;
    } catch {
      applied = false;
    }
  }

  if (!applied) {
    if (turn.content.includes(originalText)) {
      turn.content = turn.content.replace(originalText, refinedText);
    } else {
      const trimmed = originalText.trim();
      if (turn.content.includes(trimmed)) {
        turn.content = turn.content.replace(trimmed, refinedText);
      }
    }
    syncBodyEditor(turn);
  }

  showToast("已接受修改", "已将建议内容覆盖至原文", "habit");
  activeRefineDiff.value = null;
  refineDiffPos.value = null;
  refineDiffUserMoved.value = false;
}

function rejectRefineDiff() {
  activeRefineDiff.value = null;
  refineDiffPos.value = null;
  refineDiffUserMoved.value = false;
  showToast("已拒绝修改", "已保留原文内容", "edit");
}

async function executeParagraphRefinement() {
  if (!selectedText.value || !activeRefineAction.value) return;

  const action = activeRefineAction.value;
  const targetSnippet = selectedText.value;

  let actionGoal = "";
  if (action === "修订") {
    actionGoal = "对选中文本按自定义修改指令进行针对性重构与修订";
  } else if (action === "较短") {
    actionGoal = "压缩精简选中文本，删去冗余与冗长修饰，保留核心情节与关键信息";
  } else if (action === "少说破") {
    actionGoal = "少说破，以白描动作、神态与环境细节说话，去除直白的心理独白与解释性说明";
  } else if (action === "更自然") {
    actionGoal = "去掉翻译腔、书面套话与僵硬措辞，用地道流畅、生动自然的生活化人味儿语言重表达";
  } else if (action === "更具沉浸感") {
    actionGoal = "增强现场感与临场代入，丰富光影、声音、触感、动作微反应与氛围张力";
  }

  const userCustomPrompt = refineUserInstruction.value.trim();

  const promptMessage = `你是一位顶尖小说文学精修导师。请针对以下选中的正文段落进行定向润色重写：

【原段落内容】：
${targetSnippet}

【改写目标】：${actionGoal}
${userCustomPrompt ? `【补充自定义要求】：${userCustomPrompt}` : ""}

【输出格式严格约束】：
1. 绝对严禁使用任何数字序号（如 1. 2. 3. 或 1、2、）、无序列表符号（如 -、*、•）或列举式排版！
2. 绝对严禁提供多种方案或选项（不得输出方案一、方案二等），请直接输出唯一且最终的一段（或数段自然段）正文文字；
3. 直接输出连贯的文学小说自然段落，保持与原文相同的人称视角、叙事时态与上下文情节衔接；
4. 绝对严禁输出任何问候、前言说明（如“好的，改写如下：”）、后置解析、思路分析或多余附注。`;

  isRefiningParagraph.value = true;
  const abortCtrl = new AbortController();

  const targetTurn =
    aiTurns.value.find((t) => t.id === refineTurnId.value) ?? aiMessage.value;

  let targetRect: { left: number; top: number; bottom: number; width: number; height: number } | null = null;
  if (refineSelectionRange.value) {
    try {
      const r = refineSelectionRange.value.getBoundingClientRect();
      targetRect = { left: r.left, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    } catch {}
  }

  try {
    const result = await runAgent({
      provider: aiSettings.provider,
      url: aiSettings.url,
      apiKey: aiSettings.apiKey,
      model: aiSettings.model,
      apiType: aiSettings.apiType,
      systemPrompt: aiSettings.refinePrompt.trim() || REFINE_AGENT_PROMPT,
      messages: [{ role: "user", content: promptMessage }],
      stream: false,
      signal: abortCtrl.signal,
    });

    if (result.text && result.text.trim()) {
      const newText = cleanRefinedProse(result.text, targetSnippet);
      activeRefineDiff.value = {
        turnId: targetTurn.id,
        action,
        originalText: targetSnippet,
        refinedText: newText,
        selectionRange: refineSelectionRange.value ? refineSelectionRange.value.cloneRange() : null,
        targetRect,
        timestamp: Date.now(),
      };
      nextTick(() => {
        layoutRefineDiff();
      });
      showToast("建议已生成", `已在原文选区附近呈现「${action}」建议面板`, "habit");
    }
  } catch (err: any) {
    showToast("改写失败", err.message || "请检查模型接口", "edit");
  } finally {
    isRefiningParagraph.value = false;
    cancelRefinePrompt();
  }
}

/* ---------------- Model Picker Popover State & Provider Grouping ---------------- */
interface AutoModelGroup {
  id: string;
  label: string;
  provider: string;
  models: string[];
  isActive: boolean;
}

const activePopover = ref<"model" | "webSearch" | "thinking" | null>(null);

function togglePopover(pop: "model" | "webSearch" | "thinking") {
  if (activePopover.value === pop) {
    activePopover.value = null;
  } else {
    activePopover.value = pop;
    if (pop === "model") {
      modelFilter.value = "";
    }
  }
}

const currentModelLabel = computed(
  () => activeAgentModel.value || aiSettings.model || "选择模型"
);

const webSearchMode = computed({
  get: () => {
    if (!aiSettings.webSearchEnabled) return "off";
    return aiSettings.webSearchEngine;
  },
  set: (val: "off" | "bing" | "google") => {
    if (val === "off") {
      aiSettings.webSearchEnabled = false;
    } else {
      aiSettings.webSearchEnabled = true;
      aiSettings.webSearchEngine = val;
    }
  },
});

const webSearchLabel = computed(() => {
  if (!aiSettings.webSearchEnabled) return "关闭";
  return aiSettings.webSearchEngine === "google" ? "Google 结果优先" : "综合优先";
});

const thinkingLevelLabel = computed(() => {
  if (aiSettings.thinkingLevel === "off") return "关闭";
  if (aiSettings.thinkingLevel === "standard") return "标准";
  return "自动";
});

function handleArticleLengthChange() {
  if (outputTargetType.value === "story") {
    if (articleLength.value === "short") {
      targetWordCount.value = 2000;
    } else if (articleLength.value === "medium") {
      targetWordCount.value = 5000;
    } else if (articleLength.value === "long") {
      targetWordCount.value = 10000;
    }
  }
}

function handleOutputTargetTypeChange() {
  if (outputTargetType.value === "story") {
    handleArticleLengthChange();
  }
}

const modelFilter = ref("");
const expandedModelGroups = ref<Set<string>>(new Set());
const touchedGroups = ref(false);

const autoModelGroups = computed<AutoModelGroup[]>(() => {
  const groups: AutoModelGroup[] = [];
  const claimed = new Set<string>();

  for (const profile of aiSettings.providerProfiles) {
    const models =
      profile.models.length > 0
        ? [...profile.models]
        : [profile.model].filter(Boolean);
    if (models.length === 0) continue;
    const isActive = profile.id === aiSettings.activeProfileId;
    if (isActive) models.forEach((m) => claimed.add(m));
    groups.push({
      id: profile.id,
      label: profile.label,
      provider: profile.provider,
      models,
      isActive,
    });
  }

  const loose = aiSettings.models.filter((m) => !claimed.has(m));
  if (loose.length > 0) {
    groups.push({
      id: "__current__",
      label: `${providerLabel(aiSettings.provider, aiSettings.providerName)}（未保存）`,
      provider: aiSettings.provider,
      models: loose,
      isActive: aiSettings.providerProfiles.every(
        (p) => p.id !== aiSettings.activeProfileId
      ),
    });
  }

  groups.sort((a, b) => Number(b.isActive) - Number(a.isActive));
  return groups;
});

function isGroupOpen(group: AutoModelGroup): boolean {
  if (expandedModelGroups.value.has(group.id)) return true;
  if (modelFilter.value.trim()) return true;
  return !touchedGroups.value && group.models.includes(aiSettings.model);
}

function toggleGroup(group: AutoModelGroup) {
  touchedGroups.value = true;
  const next = new Set(expandedModelGroups.value);
  if (next.has(group.id)) next.delete(group.id);
  else next.add(group.id);
  expandedModelGroups.value = next;
}

function filteredModels(group: AutoModelGroup): string[] {
  const q = modelFilter.value.trim().toLowerCase();
  if (!q) return group.models;
  return group.models.filter((m) => m.toLowerCase().includes(q));
}

const visibleModelGroups = computed(() =>
  autoModelGroups.value.filter((g) => filteredModels(g).length > 0)
);

function selectModel(group: AutoModelGroup, model: string) {
  if (group.id !== "__current__" && group.id !== aiSettings.activeProfileId) {
    activateProviderProfile(group.id);
  }
  aiSettings.model = model;
  activePopover.value = null;
  showToast("切换模型", `已选择「${model}」`, "habit");
}

function handleDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest(".custom-context-menu") && !target.closest(".context-menu-submenu")) {
    closeCustomContextMenu();
  }
  if (!target.closest(".popover-wrapper")) {
    activePopover.value = null;
  }
  /* 点击「一键排版」菜单与触发按钮之外，收起菜单。 */
  if (!target.closest(".format-menu-trigger") && !target.closest(".auto-format-menu")) {
    formatMenuTurnId.value = null;
  }
  /* 点击「排版与字体」面板与触发按钮之外，收起面板。 */
  if (!target.closest(".typo-menu-trigger") && !target.closest(".auto-typo-panel")) {
    closeTypoPanel();
  }
}

function onWindowResize() {
  layoutRefinePanel();
  if (activeRefineDiff.value) layoutRefineDiff();
}

function onDocKeyDown(e: KeyboardEvent) {
  // 0. 右键自定义菜单激活时的 Esc 键关闭（先关二级菜单，再关主菜单）
  if (e.key === "Escape" && customContextMenu.value.visible) {
    e.preventDefault();
    if (contextMenuFnOpen.value) {
      closeContextFunctionSubmenu();
    } else {
      closeCustomContextMenu();
    }
    return;
  }

  // 1. 行内精修差异面板快捷键 (Esc / Ctrl+Enter)
  if (activeRefineDiff.value) {
    if (e.key === "Escape") {
      e.preventDefault();
      rejectRefineDiff();
      return;
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      acceptCurrentRefineDiff();
      return;
    }
  }

  const isCtrlOrCmd = e.ctrlKey || e.metaKey;
  const target = e.target as HTMLElement | null;
  const isInputOrTextarea =
    target &&
    (target.tagName === "INPUT" || target.tagName === "TEXTAREA") &&
    !target.classList.contains("find-replace-input");

  // 2. 查找快捷键 Ctrl+F / Cmd+F
  if (isCtrlOrCmd && (e.key === "f" || e.key === "F") && !e.shiftKey) {
    e.preventDefault();
    openFindPanel(false);
    return;
  }

  // 3. 替换快捷键 Ctrl+H / Cmd+H
  if (isCtrlOrCmd && (e.key === "h" || e.key === "H")) {
    e.preventDefault();
    openFindPanel(true);
    return;
  }

  // 4. 查找面板打开时的 Esc 键关闭
  if (e.key === "Escape" && findPanelOpen.value) {
    e.preventDefault();
    closeFindPanel();
    return;
  }

  // 5. 替换快捷键 (在查找面板激活时支持 Alt+R 替换当前，Alt+A 替换全部)
  if (findPanelOpen.value && e.altKey) {
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      executeFindReplace();
      return;
    } else if (e.key === "a" || e.key === "A") {
      e.preventDefault();
      executeFindReplaceAll();
      return;
    }
  }

  // 6. 翻页模式快捷键 Alt + ArrowLeft (上一页) / Alt + ArrowRight (下一页)
  if (chatLayoutMode.value === "paged" && e.altKey) {
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      pagedGoPrev();
      return;
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      pagedGoNext();
      return;
    }
  }

  // 7. 撤销快捷键 Ctrl+Z / Cmd+Z (针对正文编辑区或中区操作)
  if (isCtrlOrCmd && (e.key === "z" || e.key === "Z") && !e.shiftKey) {
    if (!isInputOrTextarea) {
      e.preventDefault();
      triggerUndo();
      return;
    }
  }

  // 8. 重做快捷键 Ctrl+Y / Cmd+Shift+Z / Ctrl+Shift+Z
  if (
    (isCtrlOrCmd && (e.key === "y" || e.key === "Y")) ||
    (isCtrlOrCmd && e.shiftKey && (e.key === "z" || e.key === "Z"))
  ) {
    if (!isInputOrTextarea) {
      e.preventDefault();
      triggerRedo();
      return;
    }
  }
}

/* 首次选中后局部重排护航：面板从无到有时，模板 ref 可能晚一拍到位，
   靠 mouseup + selectionchange 双路触发、再加一层 watcher 兜底重排。 */
watch(selectedText, (val) => {
  if (val) nextTick(layoutRefinePanel);
});

let middleContentObserver: ResizeObserver | null = null;

onMounted(async () => {
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("mousedown", onDocMouseDown);
  document.addEventListener("mouseup", onDocMouseUp);
  document.addEventListener("keydown", onDocKeyDown);
  /* 与文档界面 WYSIWYG 同一套语法暴露驱动：单点光标落入时刷新焦点样式（划选时不扰动 DOM）。 */
  document.addEventListener("selectionchange", onBodyFocusEvent);
  /* 选区变化时安全调度精修浮层，在鼠标拖选完成后平滑浮现 */
  document.addEventListener("selectionchange", onSelectionChangeForRefine);
  window.addEventListener("resize", onWindowResize);
  /* 预扫描本地字体，供「排版与字体」面板字体下拉展示（与文档界面同源）。 */
  ensureLocalFonts();
  await bootAutoStore();
  initCustomSetupFromStore();

  /* 首次选中后局部重排护航：面板从无到有时，模板 ref 可能晚一拍到位，
     这里在数据就绪后的下一轮再补一次重排。 */

  /* 监听中间区域尺寸变化（流式思考链与正文动态增高），在用户处于底部时持续自动钉底 */
  if (middleEditorRef.value) {
    middleContentObserver = new ResizeObserver(() => {
      if (isGenerating.value && !userScrolledUp.value && !isScrollingToBottom) {
        if (middleEditorRef.value) {
          middleEditorRef.value.scrollTop = middleEditorRef.value.scrollHeight;
        }
      }
    });
    middleContentObserver.observe(middleEditorRef.value);
  }

  /* 恢复 / 记忆中间区阅读停留位置（v-show 显隐跳变时补恢复）。 */
  attachAutoReadingVisibilityObserver();
});

onBeforeUnmount(() => {
  window.removeEventListener("mousemove", onRefineDiffDragMove);
  window.removeEventListener("mouseup", onRefineDiffDragEnd);
  document.removeEventListener("click", handleDocumentClick);
  document.removeEventListener("mousedown", onDocMouseDown);
  document.removeEventListener("mouseup", onDocMouseUp);
  document.removeEventListener("keydown", onDocKeyDown);
  document.removeEventListener("selectionchange", onBodyFocusEvent);
  document.removeEventListener("selectionchange", onSelectionChangeForRefine);
  window.removeEventListener("resize", onWindowResize);
  hideNextChapterTooltip();
  if (autoReadingPosTimer !== null) {
    window.clearTimeout(autoReadingPosTimer);
    autoReadingPosTimer = null;
  }
  if (autoReadingObserver) {
    autoReadingObserver.disconnect();
    autoReadingObserver = null;
  }
  if (middleContentObserver) {
    middleContentObserver.disconnect();
    middleContentObserver = null;
  }
});

/* ---------------- Start AI Generation in Background ---------------- */
function buildUserPrompt(sourceBody?: string): string {
  const contextParts: string[] = [];

  /* 0. 中间区创作设定（题材 / 频道 / 人称 / 时态 / 冲突 / 重心 / 基调 / 节奏） */
  const setupDirective = buildSetupDirective();
  if (setupDirective) {
    contextParts.push(setupDirective);
  }

  /* 1. 左侧临时补充素材 (用完即扔) */
  const sessionMats = selectedSessionSources.value;
  if (sessionMats.length > 0) {
    contextParts.push(
      "【临时参考素材】:\n" +
        sessionMats.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
    );
  }

  /* 2. 右侧素材库选中的条目 (项目素材库) */
  const projectMats = materialStore.items.filter((m) => m.selected);
  if (projectMats.length > 0) {
    contextParts.push(
      "【项目素材库参考内容】:\n" +
        projectMats.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
    );
  }

  /* 3. 选中的故事定制 (角色原型 / 情节) */
  const allStory = [...CHARACTER_ARCHETYPES, ...STORY_PLOTS];
  const stories = allStory.filter((s) => selectedStoryIds.value.has(s.id));
  if (stories.length > 0) {
    contextParts.push(
      "【故事定制要求（角色原型 / 经典情节）】:\n" +
        stories.map((s) => `- ${s.name}: ${s.desc}`).join("\n")
    );
  }

  /* 4. 选中的叙事定制 (结构 / 手法 / 结局) */
  const allNarrative = [
    ...NARRATIVE_STRUCTURES,
    ...NARRATIVE_TECHNIQUES,
    ...NARRATIVE_ENDINGS,
  ];
  const narratives = allNarrative.filter((n) =>
    selectedNarrativeIds.value.has(n.id)
  );
  if (narratives.length > 0) {
    contextParts.push(
      "【叙事定制要求（结构 / 手法 / 结局）】:\n" +
        narratives.map((n) => `- ${n.name}: ${n.desc}`).join("\n")
    );
  }

  const extraContext = contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : "";

  /* 审核意见 / 读者：复用系统设置里已配置的审核 / 读者智能体，
     这里只负责把待处理正文交过去，具体怎么审、怎么评一律由该智能体的
     系统提示词决定，不在此另起一套指令。 */
  if (!showWritingForm.value) {
    const body = (sourceBody ?? "").trim();
    if (!body) {
      return writingMode.value === "auditor"
        ? "当前没有可供审核的正文。请先在「对话」或「AI写作」模式下生成正文，或从下方文档下拉中选择一份历史版本。"
        : "当前没有可供评估的正文。请先在「对话」或「AI写作」模式下生成正文，或从下方文档下拉中选择一份历史版本。";
    }
    return `${body}${extraContext}`;
  }

  const lengthName =
    articleLength.value === "short"
      ? "短篇"
      : articleLength.value === "medium"
      ? "中篇"
      : "长篇";

  return `请根据以下大纲灵感与各项定制要求，深入起草故事正文：

【大纲或灵感】：${topicContent.value || "自由起草正文"}
【写作模式】：${
    writingMode.value === "chat" ? "对话探讨" : "AI深度写作"
  }
【篇幅定位】：${lengthName}
【目标字数】：约 ${targetWordCount.value || 2000} 字${extraContext}

请运用高沉浸感的情境描写、生动的感官细节以及扎实的人物弧光进行撰写。`;
}

/* ---------------- 章节细纲：形成为用户消息，提示词由设置面板「章纲」选项卡配置 ---------------- */
function buildChapterOutlinePrompt(): string {
  const contextParts: string[] = [];
  const setupDirective = buildSetupDirective();
  if (setupDirective) contextParts.push(setupDirective);

  const sessionMats = selectedSessionSources.value;
  if (sessionMats.length > 0) {
    contextParts.push(
      "【临时参考素材】:\n" +
        sessionMats.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
    );
  }

  const projectMats = materialStore.items.filter((m) => m.selected);
  if (projectMats.length > 0) {
    contextParts.push(
      "【项目素材库参考内容】:\n" +
        projectMats.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
    );
  }

  const allStory = [...CHARACTER_ARCHETYPES, ...STORY_PLOTS];
  const stories = allStory.filter((s) => selectedStoryIds.value.has(s.id));
  if (stories.length > 0) {
    contextParts.push(
      "【故事定制要求（角色原型 / 经典情节）】:\n" +
        stories.map((s) => `- ${s.name}: ${s.desc}`).join("\n")
    );
  }

  const allNarrative = [
    ...NARRATIVE_STRUCTURES,
    ...NARRATIVE_TECHNIQUES,
    ...NARRATIVE_ENDINGS,
  ];
  const narratives = allNarrative.filter((n) =>
    selectedNarrativeIds.value.has(n.id)
  );
  if (narratives.length > 0) {
    contextParts.push(
      "【叙事定制要求（结构 / 手法 / 结局）】:\n" +
        narratives.map((n) => `- ${n.name}: ${n.desc}`).join("\n")
    );
  }

  const extraContext = contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : "";

  return `【大纲或构思灵感】：${topicContent.value || "请依据设定自由构思关键章节"}${extraContext}`;
}

async function startChapterOutlineGeneration() {
  if (isGenerating.value) return;
  if (!topicContent.value.trim()) {
    showToast("提示", "请输入大纲或灵感后再构思章纲", "edit");
    return;
  }
  activeGeneratingAction.value = "chapter_outline";
  await startGenerationCore("chapter_outline");
}

function buildDialogueOnlyPrompt(baseBody?: string): string {
  const contextParts: string[] = [];
  const setupDirective = buildSetupDirective();
  if (setupDirective) contextParts.push(setupDirective);

  const sessionMats = selectedSessionSources.value;
  if (sessionMats.length > 0) {
    contextParts.push(
      "【临时参考素材 / 知识项】:\n" +
        sessionMats.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
    );
  }

  const projectMats = materialStore.items.filter((m) => m.selected);
  if (projectMats.length > 0) {
    contextParts.push(
      "【项目素材库 / 知识项参考文档】:\n" +
        projectMats.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
    );
  }

  const allStory = [...CHARACTER_ARCHETYPES, ...STORY_PLOTS];
  const stories = allStory.filter((s) => selectedStoryIds.value.has(s.id));
  if (stories.length > 0) {
    contextParts.push(
      "【故事定制要求（角色原型 / 经典情节）】:\n" +
        stories.map((s) => `- ${s.name}: ${s.desc}`).join("\n")
    );
  }

  const allNarrative = [
    ...NARRATIVE_STRUCTURES,
    ...NARRATIVE_TECHNIQUES,
    ...NARRATIVE_ENDINGS,
  ];
  const narratives = allNarrative.filter((n) =>
    selectedNarrativeIds.value.has(n.id)
  );
  if (narratives.length > 0) {
    contextParts.push(
      "【已指定的写作/叙事手法要求】:\n" +
        narratives.map((n) => `- ${n.name}: ${n.desc}`).join("\n")
    );
  }

  const extraContext =
    contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : "";

  const baseContent = topicContent.value.trim()
    ? `【细纲或大纲构思内容】：\n${topicContent.value}`
    : baseBody?.trim()
    ? `【参考文档内容】：\n${baseBody}`
    : "";

  return `请参考细纲或文档内容，只写对话框架（像话剧剧本）格式：XX说："..."，YY说："..."
转场时加简单环境描写
目标字数：600-1400字对话部分（实际字数要按剧情发展来，非硬性要求）
注意，避免与前一章节叙事手法上有所雷同，造成结构被判定AI味，要学会多种手法写作，比如倒叙、插叙、白描、蒙太奇等等，自行分配，同时注意运用了知识项文档来符合要求。如已有指定写作手法，优先使用指定的。无需输出任何说明

${baseContent}${extraContext}`;
}

function buildNextChapterPrompt(): string {
  const state = nextChapterState.value;
  const contextParts: string[] = [];
  const setupDirective = buildSetupDirective();
  if (setupDirective) contextParts.push(setupDirective);

  const sessionMats = selectedSessionSources.value;
  if (sessionMats.length > 0) {
    contextParts.push(
      "【临时参考素材】:\n" +
        sessionMats.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
    );
  }

  const projectMats = materialStore.items.filter((m) => m.selected);
  if (projectMats.length > 0) {
    contextParts.push(
      "【项目素材库参考内容】:\n" +
        projectMats.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
    );
  }

  // 读取状态追踪表，确保写新章前掌握等级、装备、伏笔与当前要点
  const stateLedgerPrompt = storyStateStore.formatStatePromptForChapter();
  if (stateLedgerPrompt) {
    contextParts.push(stateLedgerPrompt);
  }

  const extraContext = contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : "";
  const targetName = state.chapterTitle || (state.targetChapterNum ? `第 ${state.targetChapterNum} 章` : "下一章");

  return `请根据前文上下文中的完整大纲与章节细纲，紧密承接前序章节情节与人物状态，开始正式起草【${targetName}】正文。

【创作要求】：
1. 紧密结合章节细纲中所规划的核心事件、冲突矛盾与转折高潮；
2. 保持叙事视角与人物性格的一致性，注重动作、心理与环境细节描写；
3. 篇幅详实生动（目标约 ${targetWordCount.value || 2000} 字），结尾自然留下推进下一章的悬念钩子。${extraContext}`;
}

function buildNovelOutlinePrompt(): string {
  const contextParts: string[] = [];
  const setupDirective = buildSetupDirective();
  if (setupDirective) contextParts.push(setupDirective);

  const sessionMats = selectedSessionSources.value;
  if (sessionMats.length > 0) {
    contextParts.push(
      "【临时参考素材】:\n" +
        sessionMats.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
    );
  }

  const projectMats = materialStore.items.filter((m) => m.selected);
  if (projectMats.length > 0) {
    contextParts.push(
      "【项目素材库参考内容】:\n" +
        projectMats.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
    );
  }

  const allStory = [...CHARACTER_ARCHETYPES, ...STORY_PLOTS];
  const stories = allStory.filter((s) => selectedStoryIds.value.has(s.id));
  if (stories.length > 0) {
    contextParts.push(
      "【故事定制要求（角色原型 / 经典情节）】:\n" +
        stories.map((s) => `- ${s.name}: ${s.desc}`).join("\n")
    );
  }

  const allNarrative = [
    ...NARRATIVE_STRUCTURES,
    ...NARRATIVE_TECHNIQUES,
    ...NARRATIVE_ENDINGS,
  ];
  const narratives = allNarrative.filter((n) =>
    selectedNarrativeIds.value.has(n.id)
  );
  if (narratives.length > 0) {
    contextParts.push(
      "【叙事定制要求（结构 / 手法 / 结局）】:\n" +
        narratives.map((n) => `- ${n.name}: ${n.desc}`).join("\n")
    );
  }

  const extraContext =
    contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : "";

  const outlineTypeLabel =
    articleLength.value === "short"
      ? "短篇故事大纲（单主线推进，矛盾集中迅速激化与收束）"
      : articleLength.value === "medium"
      ? "中篇故事大纲（三幕起伏结构，主副线交织，多层次转折）"
      : "长篇故事大纲（宏大世界观建构，多卷多阶段主线，长线伏笔与阵营博弈）";

  return `请根据以下大纲灵感、创作设定与定制要求，编写故事大纲（直接输出大纲内容，无需编写正文章节）：

【大纲或灵感】：${topicContent.value || "自由构思故事大纲"}
【输出目标】：故事大纲
【篇幅类型】：${outlineTypeLabel}（表单规划体量项，无需受具体字数限制）${extraContext}

要求：
1. 篇幅类型为表单规划项，请根据【${articleLength.value === 'short' ? '短篇' : articleLength.value === 'medium' ? '中篇' : '长篇'}】的体量架构完整的故事骨干。
2. 梳理清晰的主线动力、核心冲突、关键情节点与终局走向。`;
}

/* ---------------- Middle Editor Scroll & Bottom Floating Button ---------------- */
const middleEditorRef = ref<HTMLElement | null>(null);
const showScrollBottomBtn = ref(false);
const userScrolledUp = ref(false);
let isScrollingToBottom = false;
let scrollBottomTimer: any = null;

/** 「最底部」悬浮小胶囊是否正压在文本文字上（压住文字时自动降低不透明度）。 */
const scrollBottomBtnSeeThrough = ref(false);

/** 返回 (x, y) 处的可见文本字符；不是文字或无文本时返回 null。 */
function charAtViewportPoint(x: number, y: number): string | null {
  const docWithRange = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const range = docWithRange.caretRangeFromPoint
    ? docWithRange.caretRangeFromPoint(x, y)
    : null;
  if (range && range.startContainer && range.startContainer.nodeType === Node.TEXT_NODE) {
    const char = (range.startContainer.textContent || "")[range.startOffset];
    if (char && char.trim()) return char;
    return null;
  }
  const pos = (document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  }).caretPositionFromPoint?.(x, y);
  if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
    const char = (pos.offsetNode.textContent || "")[pos.offset];
    if (char && char.trim()) return char;
  }
  return null;
}

/** 检测「最底部」按钮下面是否压着文字：压到文字 → 半透明；纯空白 → 保持实体。 */
function refreshScrollBottomBtnOverlap() {
  const btn = document.getElementById("middle-scroll-to-bottom-btn");
  if (!btn) {
    scrollBottomBtnSeeThrough.value = false;
    return;
  }
  const rect = btn.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    scrollBottomBtnSeeThrough.value = false;
    return;
  }
  /* 先让按钮退出命中测试（visibility:hidden 不参与 hit-test），才能量到它
     背后的文字；同步改回，不会闪屏。 */
  const prevVisibility = btn.style.visibility;
  btn.style.visibility = "hidden";
  let hit = false;
  try {
    const samples = [
      [rect.left + rect.width * 0.2, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.5, rect.top + rect.height * 0.5],
      [rect.left + rect.width * 0.8, rect.top + rect.height * 0.5],
    ] as const;
    for (const [x, y] of samples) {
      if (charAtViewportPoint(x, y)) {
        hit = true;
        break;
      }
    }
  } finally {
    btn.style.visibility = prevVisibility;
  }
  scrollBottomBtnSeeThrough.value = hit;
}

const isMiddleScrollingDown = ref(false);
let middleScrollDimTimer: ReturnType<typeof setTimeout> | null = null;

function updateToolbarDimOnScroll(scrollTop: number) {
  if (scrollTop > 8) {
    isMiddleScrollingDown.value = true;
  }
  if (middleScrollDimTimer !== null) {
    clearTimeout(middleScrollDimTimer);
  }
  middleScrollDimTimer = setTimeout(() => {
    isMiddleScrollingDown.value = false;
    middleScrollDimTimer = null;
  }, 220);
}

function onMiddleWheel(e: WheelEvent) {
  if (e.deltaY < -3) {
    userScrolledUp.value = true;
    showScrollBottomBtn.value = true;
  } else if (e.deltaY > 3) {
    if (middleEditorRef.value) {
      updateToolbarDimOnScroll(middleEditorRef.value.scrollTop);
      const { scrollHeight, scrollTop, clientHeight } = middleEditorRef.value;
      if (scrollHeight - scrollTop - clientHeight <= 60) {
        userScrolledUp.value = false;
        showScrollBottomBtn.value = false;
      }
    }
  }
}

let touchStartY = 0;
function onMiddleTouchStart(e: TouchEvent) {
  touchStartY = e.touches[0]?.clientY || 0;
}

function onMiddleTouchMove(e: TouchEvent) {
  const currentY = e.touches[0]?.clientY || 0;
  if (currentY - touchStartY > 8) {
    userScrolledUp.value = true;
    showScrollBottomBtn.value = true;
  } else if (touchStartY - currentY > 8) {
    if (middleEditorRef.value) {
      updateToolbarDimOnScroll(middleEditorRef.value.scrollTop);
      const { scrollHeight, scrollTop, clientHeight } = middleEditorRef.value;
      if (scrollHeight - scrollTop - clientHeight <= 60) {
        userScrolledUp.value = false;
        showScrollBottomBtn.value = false;
      }
    }
  }
}

function handleMiddleScroll(e: Event) {
  if (isScrollingToBottom) return;
  const el = e.target as HTMLElement;
  if (!el) return;
  const scrollHeight = el.scrollHeight;
  const scrollTop = el.scrollTop;
  const clientHeight = el.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  updateToolbarDimOnScroll(scrollTop);

  if (distanceFromBottom <= 50) {
    showScrollBottomBtn.value = false;
    userScrolledUp.value = false;
  } else if (scrollHeight > clientHeight + 60 && distanceFromBottom > 160) {
    showScrollBottomBtn.value = true;
    userScrolledUp.value = true;
  }

  /* 滚动时按钮底下的文字在变，实时刷新「压文降透明」。 */
  refreshScrollBottomBtnOverlap();

  /* 目录条跟随滚动高亮当前条目。 */
  requestAnimationFrame(updateActiveTocIndex);

  /* 滚动会改变「下一章」气泡的锚点，收起悬浮的说明气泡。 */
  hideNextChapterTooltip();

  /* 中区滚动会带动选中的文字位置变化，悬浮精修面板与建议卡片跟随重排。 */
  layoutRefinePanel();
  if (activeRefineDiff.value) layoutRefineDiff();

  /* 滚动位置记忆：停手后合并落库（与文档界面同一套低频写法）。 */
  scheduleAutoReadingPositionSave();
}

/* ---------------- 自动界面阅读停留位置记忆（参考文档界面的同套机制） ----------------
   记下中间区正文流的滚动位置：短距切走 / 重启回到原处；新增或删除了产出、
   内容长度变化时按比例定位，不会跳回文首或文末。 */
let autoReadingPosTimer: ReturnType<typeof setTimeout> | null = null;
let restoringAutoReadingPosition = false;
let autoReadingElWasVisible = false;

/** 中间区「内容签名」：产出数量 + 各条正文与思考链字符总数，用来判断内容是否重排过。 */
function autoScrollSignature(): string {
  let len = 0;
  for (const t of aiTurns.value) {
    len += (t.content || "").length + (t.reasoning || "").length;
  }
  return `${aiTurns.value.length}:${len}`;
}

/** 滚动是高频事件：合并到停手后再落库（320ms 防抖）。 */
function scheduleAutoReadingPositionSave() {
  if (restoringAutoReadingPosition) return;
  if (autoReadingPosTimer !== null) window.clearTimeout(autoReadingPosTimer);
  autoReadingPosTimer = window.setTimeout(() => {
    autoReadingPosTimer = null;
    const el = middleEditorRef.value;
    if (!el || el.clientHeight <= 0) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max <= 0) return;
    setAutoReadingPosition({
      scrollTop: el.scrollTop,
      ratio: Math.min(1, Math.max(0, el.scrollTop / max)),
      signature: autoScrollSignature(),
    });
  }, 320);
}

/** 把中间区滚到上次读到的地方（无记忆则停留在文首）。 */
function restoreAutoReadingPosition() {
  const el = middleEditorRef.value;
  if (!el || el.clientHeight <= 0) return;
  restoringAutoReadingPosition = true;
  const max = el.scrollHeight - el.clientHeight;
  el.scrollTop = resolveAutoScrollTop(max, autoScrollSignature());
  restoringAutoReadingPosition = false;
}

/** 自动界面由 v-show 控制显隐（隐藏时 display:none，scrollTop / clientHeight
    都归零），盯根容器尺寸在「隐藏 → 重新可见」那一跳补一次恢复。 */
let autoReadingObserver: ResizeObserver | null = null;
function attachAutoReadingVisibilityObserver() {
  const el = middleEditorRef.value;
  if (!el || typeof ResizeObserver === "undefined" || autoReadingObserver) return;
  autoReadingElWasVisible = el.clientHeight > 0;
  autoReadingObserver = new ResizeObserver(() => {
    const target = middleEditorRef.value;
    if (!target) return;
    const visible = target.clientHeight > 0;
    if (visible && !autoReadingElWasVisible) restoreAutoReadingPosition();
    autoReadingElWasVisible = visible;
  });
  autoReadingObserver.observe(el);
  if (autoReadingElWasVisible) restoreAutoReadingPosition();
}

/** 流式输出跟随：思考链展开 / 正文输出时持续钉在底部，保持最新内容可见。
    仅当用户没主动向上翻看时才跟随 —— 用户操作永远优先。 */
function followStreamingOutput(force = false) {
  if (force) {
    userScrolledUp.value = false;
    showScrollBottomBtn.value = false;
  }
  if (!middleEditorRef.value) return;
  if (userScrolledUp.value && !force) return;
  if (isScrollingToBottom) return;

  nextTick(() => {
    if (!middleEditorRef.value) return;
    if (userScrolledUp.value && !force) return;
    middleEditorRef.value.scrollTop = middleEditorRef.value.scrollHeight;
  });
}

/* 用户展开思考链时立即回到最新内容（若未主动上翻）；配合 onReasoning
   持续跟随推理过程增长的高度。 */
watch(
  reasoningExpanded,
  (expanded) => {
    if (expanded) {
      followStreamingOutput();
    }
  },
);

/* 内容流式增加 / 按钮显隐变化时，同步刷新「最底部」按钮的压文透明度。 */
watch(
  [showScrollBottomBtn, aiTurns],
  () => nextTick(refreshScrollBottomBtnOverlap),
  { deep: true },
);

/* 产出列表变化（新增 / 删除 / 定位）后，刷新目录条高亮。 */
watch(
  aiTurns,
  () => nextTick(updateActiveTocIndex),
  { deep: true },
);

function scrollToBottom() {
  if (!middleEditorRef.value) return;
  const el = middleEditorRef.value;
  showScrollBottomBtn.value = false;
  userScrolledUp.value = false;
  isScrollingToBottom = true;

  if (scrollBottomTimer) {
    clearTimeout(scrollBottomTimer);
  }

  el.scrollTo({
    top: el.scrollHeight,
    behavior: "smooth",
  });

  scrollBottomTimer = setTimeout(() => {
    if (middleEditorRef.value) {
      middleEditorRef.value.scrollTop = middleEditorRef.value.scrollHeight;
    }
    showScrollBottomBtn.value = false;
    userScrolledUp.value = false;
    isScrollingToBottom = false;
  }, 350);
}

async function startDialogueOnlyGeneration() {
  if (isGenerating.value) return;
  if (!topicContent.value.trim() && !aiMessage.value.content.trim()) {
    showToast("提示", "请输入细纲、大纲或灵感后再提取对话框架", "edit");
    return;
  }
  activeGeneratingAction.value = "dialogue_only";
  await startGenerationCore("dialogue_only");
}

async function startGeneration() {
  activeGeneratingAction.value = "normal";
  if (outputTargetType.value === "outline") {
    await startGenerationCore("outline");
  } else {
    await startGenerationCore("refresh");
  }
}

/** 根据当前写作模式解析知识项作用域（对话 / AI写作 / 审核意见 / 读者）。 */
function resolveKnowledgeScope(): KnowledgeScope | null {
  if (writingMode.value === "chat") return "chat";
  if (writingMode.value === "writer") return "writer";
  if (writingMode.value === "auditor") return "auditor";
  if (writingMode.value === "reader") return "reader";
  return null;
}

/** 把此前已经产出的各条 AI 回复串成会话历史，让下一条生成能接着上文走。
    每轮产出的用户侧完整要求（含当时的素材库 / 故事定制 / 叙事定制，
    AiTurn.prompt）会一并带回对话上下文 —— 这样即使选项已在首轮后被清空，
    后续章纲 / 对话话本 / 变体重写仍能读到这些素材与定制要求。 */
function buildConversationHistory(limit = 8): AgentTurn[] {
  const msgs: AgentTurn[] = [];
  const prior = aiTurns.value.slice(0, -1).slice(-limit);
  for (const t of prior) {
    const body = t.content.trim();
    if (!body) continue;
    const userReq = t.prompt?.trim();
    msgs.push({
      role: "user",
      content: userReq
        ? `（前序行动：${t.title || "AI产出"} · ${t.timestamp}）\n\n【该轮的完整要求（含当时的素材与定制选项）】\n${userReq}`
        : `（前序行动：${t.title || "AI产出"} · ${t.timestamp}）`,
    });
    msgs.push({ role: "assistant", content: body });
  }
  return msgs;
}

/** 首轮正文完整输出后，把已经注入上下文的素材 / 定制选项同步清空，
    避免章纲生成、对话话本、变体重写等后续行动再次重复发送同一批选项。
    原始内容已随首轮 prompt 保存在 AiTurn.prompt，并由对话历史带回。 */
function clearConsumedSelections() {
  if (!showWritingForm.value) return;
  materialStore.items.forEach((m) => (m.selected = false));
  autoStore.selectedStoryIds = [];
  autoStore.selectedNarrativeIds = [];
  autoStore.sessionSources = [];
}

async function startGenerationCore(
  variant: VariantMode,
  preset?: {
    initialReasoning?: string;
    sourceTurn?: AiTurn;
    /** 直接指定本轮的用户指令文本（绕过 buildUserPrompt 与默认变体指令拼接）。 */
    customPrompt?: string;
  }
) {
  if (isGenerating.value) return;

  const sourceTurn = preset?.sourceTurn;

  /* 只有 chat / writer 需要大纲或灵感；dialogue_only 允许大纲或上一条产出其一存在；
     next_chapter 基于上下文；follow_up 直接沿用「点选的选项」作为用户追问，都不再要求大纲。
     若携带 sourceTurn 进行变体/重写/下一章，允许以 sourceTurn.content 作为基准。 */
  if (
    showWritingForm.value &&
    variant !== "dialogue_only" &&
    variant !== "next_chapter" &&
    variant !== "follow_up" &&
    !topicContent.value.trim() &&
    !(sourceTurn && sourceTurn.content.trim())
  ) {
    showToast("提示", "请输入大纲或灵感后再开始处理", "edit");
    return;
  }
  if (
    showWritingForm.value &&
    variant === "dialogue_only" &&
    !topicContent.value.trim() &&
    !aiMessage.value.content.trim()
  ) {
    showToast("提示", "请输入细纲、大纲或参考正文后再提取对话框架", "edit");
    return;
  }

  /* 审核意见 / 读者：先确定要处理哪一份文档，没有就直接拦下来。
     follow_up 是用户在回复里点选的追问选项，不再要求重新选待审文档。 */
  const auditBody = showWritingForm.value ? "" : resolveAuditDocContent();
  if (
    !showWritingForm.value &&
    variant !== "follow_up" &&
    !auditBody.trim()
  ) {
    showToast(
      "提示",
      "暂无可处理的文档，请先生成正文或在下方选择一份历史版本",
      "edit"
    );
    return;
  }

  isGenerating.value = true;
  userScrolledUp.value = false;
  showScrollBottomBtn.value = false;
  currentAbortController = new AbortController();

  /* 在创建新条目前捕获上一条产出：变体重写 / 对话话本 / 审核 / 读者都要
     拿它当材料；比如生成完「故事大纲」后点「章纲生成」，就是把大纲作为对话
     上下文推进第二条回复。新回复以「新条目」追加，绝不覆盖上一条。 */
  const prevContent = sourceTurn ? sourceTurn.content : aiMessage.value.content;

  const turnId = Date.now();
  const currentMode = writingMode.value;
  const turnTitle = labelForVariant(variant);

  const isFooterAction = [
    "refresh",
    "structure",
    "technique",
    "ending",
    "rewrite",
    "next_chapter",
  ].includes(variant);

  let targetGroupId = "";
  if (sourceTurn) {
    targetGroupId = sourceTurn.pageGroupId || String(sourceTurn.id);
    sourceTurn.pageGroupId = targetGroupId;
  } else if (isFooterAction && aiTurns.value.length > 0) {
    const last = aiTurns.value[aiTurns.value.length - 1];
    targetGroupId = last.pageGroupId || String(last.id);
    last.pageGroupId = targetGroupId;
  } else {
    targetGroupId = String(turnId);
  }

  aiTurns.value.push({
    id: turnId,
    pageGroupId: targetGroupId,
    mode: currentMode,
    variant: variant,
    title: turnTitle,
    content: "",
    reasoning: preset?.initialReasoning ?? "",
    tokens: 0,
    timestamp: formatCurrentTime(),
    incomplete: false,
    continued: 0,
  });

  if (targetGroupId) {
    const grp = turnGroups.value.find((g) => g.groupId === targetGroupId);
    if (grp) {
      setGroupActiveIndex(targetGroupId, grp.turns.length - 1);
    }
  }

  /* 新一轮生成开启时，立即将视图平滑钉底并重置用户翻滚状态 */
  followStreamingOutput(true);

  const lastTurn = () => aiTurns.value.find((t) => t.id === turnId);
  /* 上一条已完成的产出作为对话上下文（新条目此刻为空，会被跳过）。 */
  const historyMsgs = buildConversationHistory();

  let systemPrompt = WRITER_AGENT_PROMPT;
  if (writingMode.value === "chat") {
    systemPrompt = aiSettings.chatPrompt.trim() || CHAT_AGENT_PROMPT;
  } else if (writingMode.value === "auditor") {
    systemPrompt = aiSettings.auditorPrompt.trim() || AUDITOR_AGENT_PROMPT;
  } else if (writingMode.value === "reader") {
    systemPrompt = aiSettings.readerPrompt.trim() || READER_AGENT_PROMPT;
  } else {
    systemPrompt = aiSettings.writerPrompt.trim() || WRITER_AGENT_PROMPT;
  }

  /* 章纲生成使用设置面板「章纲」选项卡配置的提示词；
     用户清空并填入新提示词即直接生效，留空则回落默认。 */
  if (variant === "chapter_outline") {
    systemPrompt =
      aiSettings.chapterOutlinePrompt.trim() || CHAPTER_OUTLINE_AGENT_PROMPT;
  }

  /* chat / writer 走大纲；auditor / reader 走下拉选中的文档正文；
     follow_up 直接把用户点选的选项文字作为本轮追问发给模型。 */
  let promptMessage = preset?.customPrompt ?? "";
  if (variant === "chapter_outline") {
    promptMessage = buildChapterOutlinePrompt();
  } else if (variant === "dialogue_only") {
    promptMessage = buildDialogueOnlyPrompt(prevContent);
  } else if (variant === "outline") {
    promptMessage = buildNovelOutlinePrompt();
  } else if (variant === "next_chapter") {
    promptMessage = buildNextChapterPrompt();
  } else if (variant === "follow_up") {
    promptMessage = pendingFollowUpText.value.trim() || "请继续基于上文继续说明";
  } else if (!promptMessage) {
    if (sourceTurn && sourceTurn.content.trim()) {
      const contextParts: string[] = [];
      const setupDirective = buildSetupDirective();
      if (setupDirective) {
        contextParts.push(setupDirective);
      }
      const sessionMats = selectedSessionSources.value;
      if (sessionMats.length > 0) {
        contextParts.push(
          "【临时参考素材】:\n" +
            sessionMats.map((s) => `### ${s.title}\n${s.content}`).join("\n\n")
        );
      }
      const projectMats = materialStore.items.filter((m) => m.selected);
      if (projectMats.length > 0) {
        contextParts.push(
          "【项目素材库参考内容】:\n" +
            projectMats.map((m) => `### ${m.title}\n${m.content}`).join("\n\n")
        );
      }
      const allStory = [...CHARACTER_ARCHETYPES, ...STORY_PLOTS];
      const stories = allStory.filter((s) => selectedStoryIds.value.has(s.id));
      if (stories.length > 0) {
        contextParts.push(
          "【故事定制要求（角色原型 / 经典情节）】:\n" +
            stories.map((s) => `- ${s.name}: ${s.desc}`).join("\n")
        );
      }
      const allNarrative = [
        ...NARRATIVE_STRUCTURES,
        ...NARRATIVE_TECHNIQUES,
        ...NARRATIVE_ENDINGS,
      ];
      const narratives = allNarrative.filter((n) =>
        selectedNarrativeIds.value.has(n.id)
      );
      if (narratives.length > 0) {
        contextParts.push(
          "【叙事定制要求（结构 / 手法 / 结局）】:\n" +
            narratives.map((n) => `- ${n.name}: ${n.desc}`).join("\n")
        );
      }
      const extraContext =
        contextParts.length > 0 ? "\n\n" + contextParts.join("\n\n") : "";
      const lengthName =
        articleLength.value === "short"
          ? "短篇"
          : articleLength.value === "medium"
          ? "中篇"
          : "长篇";
      promptMessage = `请根据以下参考正文与各项定制要求，深入进行优化撰写：

【参考正文】：
${sourceTurn.content}

【写作模式】：${writingMode.value === "chat" ? "对话探讨" : "AI深度写作"}
【篇幅定位】：${lengthName}
【目标字数】：约 ${targetWordCount.value || 2000} 字
【处理目标】：${variantGoal(variant)}${extraContext}

请运用高沉浸感的情境描写、生动的感官细节以及扎实的人物弧光输出完整优化后的正文。`;
    } else {
      promptMessage = buildUserPrompt(
        showWritingForm.value ? prevContent : auditBody
      );
      if (variant !== "refresh") {
        promptMessage += `\n\n【变体重写指令】：${variantGoal(variant)}`;
      }
    }
  }

  /* 把用户侧指令留档，供「历史」页还原完整对话（要求 + 回复）。 */
  const currentTurnEl = lastTurn();
  if (currentTurnEl) currentTurnEl.prompt = promptMessage;

  /* 知识项：以工具方式暴露，让模型先按需读取知识项再产出 —— 与写作画布
     右侧面板的 AI 写作机制同源（知识清单 + 三个读取工具）。模型不支持工具时
     自动回退为「知识内容直接携带」。 */
  const scope = resolveKnowledgeScope();
  const useKnowledgeTools = scope !== null && knowledgeList(scope).length > 0;
  if (useKnowledgeTools) {
    systemPrompt += `\n\n${knowledgeManifest(scope!)}`;
  }
  if (historyMsgs.length > 0 && useKnowledgeTools) {
    systemPrompt += `\n\n【上下文记忆提示】当前会话已有前文产出。若此前已经通过工具阅读过相关知识项，其内容已留在上下文中，请直接沿用记忆作答；除非确有需要，否则不要重复调用 read_knowledge / search_knowledge 反复阅读同一知识项。`;
  }

  const toolDefs: ToolDefinition[] = [];
  if (useKnowledgeTools) toolDefs.push(...knowledgeToolDefinitions(scope!));

  /* 联网搜索与思考等级组件联动 */
  if (aiSettings.webSearchEnabled) {
    systemPrompt += `\n\n【联网搜索: 已开启（${webSearchLabel.value}）】你拥有 web_search 实时网页搜索工具。当用户的问题涉及你可能不了解的最新事实、时效性数据、实时资讯或不确定的专业领域知识时，请先调用 web_search 工具检索网页获取真实资料，再基于检索结果作答；严禁凭记忆臆造不确定的信息。\n· 若工具明确告知本次检索失败或没有相关结果，就如实向用户说明「这次没能拿到联网资料」，不要假装检索成功，也不要把记忆里的旧信息当成检索结果。`;
    toolDefs.push(...webSearchToolDefinitions());
  }

  if (aiSettings.thinkingLevel) {
    const thinkLabel =
      aiSettings.thinkingLevel === "off"
        ? "关闭 (直接简洁输出结果，不展示思考过程)"
        : aiSettings.thinkingLevel === "standard"
        ? "标准 (逐步推演，条理清晰，严格按步骤思考)"
        : "自动 (根据问题复杂程度自适应调节思考深度)";
    systemPrompt += `\n\n【思考等级: ${thinkLabel}】`;
  }

  const useTools = toolDefs.length > 0;
  const traces: ToolTrace[] = [];

  const baseRun = {
    provider: aiSettings.provider,
    url: aiSettings.url,
    apiKey: aiSettings.apiKey,
    model: activeAgentModel.value,
    apiType: aiSettings.apiType,
    messages: [
      ...historyMsgs,
      { role: "user" as const, content: promptMessage },
    ],
    stream: true,
    signal: currentAbortController.signal,
    onReasoning: (reasoningText: string) => {
      const t = lastTurn();
      if (!t) return;
      t.reasoning = reasoningText;
      /* 思考链展开流式输出时跟随滚动，保持最新推理内容可见（用户上翻则让位） */
      followStreamingOutput();
    },
    onChunk: (fullText: string) => {
      const t = lastTurn();
      if (!t) return;
      t.content = fullText;
      /* 正文流式输出跟随滚动；用户往上滑动时取消跟随（用户操作优先级最高） */
      followStreamingOutput();
    },
  };

  try {
    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await runAgent({
        ...baseRun,
        systemPrompt,
        autoContinue: 2,
        needsContinuation: looksUnfinished,
        tools: useTools ? toolDefs : undefined,
        executeTool: useTools
          ? (name: string, args: Record<string, unknown>) => {
              if (isWebSearchTool(name)) {
                return runWebSearch(
                  String(args.query ?? args.q ?? args.keyword ?? ""),
                  currentAbortController?.signal,
                );
              }
              if (useKnowledgeTools && scope) {
                return runKnowledgeTool(scope, name, args);
              }
              return `未知工具: ${name}`;
            }
          : undefined,
        onToolCall: (call) => {
          const label = isWebSearchTool(call.name)
            ? describeWebSearchToolCall(call.name, call.args)
            : describeKnowledgeToolCall(call.name, call.args);
          traces.push({
            label,
            done: false,
          });
          const t = lastTurn();
          if (t) t.tools = [...traces];
        },
        onToolResult: (_call, output) => {
          const last = traces[traces.length - 1];
          if (last) {
            last.done = true;
            last.detail = output.split("\n")[0]?.slice(0, 60) ?? "";
          }
          const t = lastTurn();
          if (t) t.tools = [...traces];
        },
      });
    } catch (error: unknown) {
      /* 部分中转接口 / 老模型拒绝 tools 字段：回退为「知识内容直接携带」。 */
      if (!useKnowledgeTools || !isToolUnsupportedError(error)) throw error;
      traces.length = 0;
      result = await runAgent({
        ...baseRun,
        systemPrompt: `${systemPrompt}\n\n${inlineKnowledgeFallback(scope!)}`,
        autoContinue: 2,
        needsContinuation: looksUnfinished,
      });
    }

    const t = lastTurn();
    if (!t) return;
    if (result.text) {
      /* AI 输出完整正文结束时，后台自动执行一次「一键排版」，清除多余空格、全角空格与空行 */
      t.content = cleanWhitespaceFormatting(result.text);
    } else if (t.content) {
      t.content = cleanWhitespaceFormatting(t.content);
    }
    lastSyncedFor.delete(t.id);
    syncBodyEditor(t);
    if (result.reasoning) t.reasoning = result.reasoning;
    if (result.tokens) {
      t.tokens = result.tokens;
      recordTokens(activeTokenCategory.value, result.tokens);
    }
    t.incomplete = !!result.truncated;

    /* 正文/大纲完整输出即消费掉素材与定制勾选：本轮要求已被写进 AiTurn.prompt
       并留在对话上下文中，后续章纲/对话话本等无需再重复发送。 */
    if (!t.incomplete) {
      clearConsumedSelections();
      // 正文写完后，自动更新故事状态追踪表（等级突破、新获装备、埋下伏笔）
      if (
        variant === "next_chapter" ||
        (variant === "refresh" &&
          !isOutlineTurn(t) &&
          !isChapterOutlineTurn(t) &&
          !isAuditOrReaderTurn(t)) ||
        (variant === "rewrite" &&
          !isOutlineTurn(t) &&
          !isChapterOutlineTurn(t) &&
          !isAuditOrReaderTurn(t))
      ) {
        storyStateStore.autoUpdateStoryStateFromChapter(t.content, turnLabel(t));
      }
    }

    if (variant === "refresh") {
      showToast("处理完成", "AI 已生成完正文，可切回「自动」界面查看", "habit");
    } else if (variant === "outline") {
      showToast("大纲生成完成", "AI 已完成故事大纲编写", "habit");
    } else if (variant === "chapter_outline") {
      showToast("章纲生成完成", "AI 已按照章节细纲格式生成三幕章纲", "habit");
    } else if (variant === "dialogue_only") {
      showToast("对话框架生成完成", "AI 已生成剧本式对话框架", "habit");
    } else if (variant === "follow_up") {
      showToast("已回复", `已把选项作为新一轮追问发送给 AI`, "habit");
    } else {
      showToast("变体重写完成", `已按「${labelForVariant(variant)}」生成新正文`, "habit");
    }
  } catch (err: any) {
    const t = lastTurn();
    if (t) t.incomplete = true;
    if (err.name === "AbortError") {
      showToast("已中止处理", "已停止当前生成", "edit");
    } else {
      showToast("处理失败", err.message || "请检查模型接口配置", "edit");
    }
  } finally {
    isGenerating.value = false;
    activeGeneratingAction.value = null;
    currentAbortController = null;
    nextTick(() => {
      const t = lastTurn();
      if (t) {
        lastSyncedFor.delete(t.id);
        syncBodyEditor(t);
      }
    });
  }
}

async function continueUnfinished() {
  if (isGenerating.value) return;
  if (aiTurns.value.length === 0) return;
  isGenerating.value = true;
  userScrolledUp.value = false;
  showScrollBottomBtn.value = false;
  followStreamingOutput(true);
  currentAbortController = new AbortController();

  const turnId = aiMessage.value.id;
  const lastTurn = () => aiTurns.value.find((t) => t.id === turnId);

  let systemPrompt = WRITER_AGENT_PROMPT;
  if (writingMode.value === "chat") {
    systemPrompt = aiSettings.chatPrompt.trim() || CHAT_AGENT_PROMPT;
  } else if (writingMode.value === "auditor") {
    systemPrompt = aiSettings.auditorPrompt.trim() || AUDITOR_AGENT_PROMPT;
  } else if (writingMode.value === "reader") {
    systemPrompt = aiSettings.readerPrompt.trim() || READER_AGENT_PROMPT;
  }

  /* 续写同样接入知识项工具：runAgent 在续写回合会自动摘掉工具，不会反复读取。 */
  const scope = resolveKnowledgeScope();
  const useKnowledgeTools = scope !== null && knowledgeList(scope).length > 0;
  if (useKnowledgeTools) {
    systemPrompt += `\n\n${knowledgeManifest(scope!)}`;
  }
  const toolDefs: ToolDefinition[] = [];
  if (useKnowledgeTools) toolDefs.push(...knowledgeToolDefinitions(scope!));
  if (aiSettings.webSearchEnabled) {
    systemPrompt += `\n\n【联网搜索: 已开启（${webSearchLabel.value}）】你拥有 web_search 实时网页搜索工具。`;
    toolDefs.push(...webSearchToolDefinitions());
  }
  if (aiSettings.thinkingLevel) {
    const thinkLabel =
      aiSettings.thinkingLevel === "off"
        ? "关闭 (直接简洁输出结果，不展示思考过程)"
        : aiSettings.thinkingLevel === "standard"
        ? "标准 (逐步推演，条理清晰，严格按步骤思考)"
        : "自动 (根据问题复杂程度自适应调节思考深度)";
    systemPrompt += `\n\n【思考等级: ${thinkLabel}】`;
  }
  const useTools = toolDefs.length > 0;

  const existingContent = aiMessage.value.content;
  const promptMessage = buildUserPrompt(existingContent);

  const baseRun = {
    provider: aiSettings.provider,
    url: aiSettings.url,
    apiKey: aiSettings.apiKey,
    model: activeAgentModel.value,
    apiType: aiSettings.apiType,
    messages: [
      { role: "user" as const, content: promptMessage },
      { role: "assistant" as const, content: existingContent },
      {
        role: "user" as const,
        content: "请从断点处紧接着把正文写完，自然流畅地衔接，不要重复上文内容。",
      },
    ],
    stream: true,
    signal: currentAbortController.signal,
    onChunk: (chunkText: string) => {
      const t = lastTurn();
      if (t) t.content = existingContent + chunkText;
      followStreamingOutput();
    },
  };

  try {
    let result: Awaited<ReturnType<typeof runAgent>>;
    try {
      result = await runAgent({
        ...baseRun,
        systemPrompt,
        tools: useTools ? toolDefs : undefined,
        executeTool: useTools
          ? (name: string, args: Record<string, unknown>) => {
              if (isWebSearchTool(name)) {
                return runWebSearch(
                  String(args.query ?? args.q ?? args.keyword ?? ""),
                  currentAbortController?.signal,
                );
              }
              if (useKnowledgeTools && scope) {
                return runKnowledgeTool(scope, name, args);
              }
              return `未知工具: ${name}`;
            }
          : undefined,
      });
    } catch (error: unknown) {
      if (!useKnowledgeTools || !isToolUnsupportedError(error)) throw error;
      result = await runAgent({
        ...baseRun,
        systemPrompt: `${systemPrompt}\n\n${inlineKnowledgeFallback(scope!)}`,
      });
    }

    const t = lastTurn();
    if (!t) return;
    const finalContent = result.text ? existingContent + result.text : t.content;
    if (finalContent) {
      /* 续写接续完成时，后台自动执行一次「一键排版」清除多余空格与空行 */
      t.content = cleanWhitespaceFormatting(finalContent);
    }
    lastSyncedFor.delete(t.id);
    syncBodyEditor(t);
    if (result.tokens) t.tokens += result.tokens;
    t.continued += 1;
    t.incomplete = !!result.truncated;
    showToast("接续完成", "正文已继续补全", "habit");
  } catch (err: any) {
    if (err.name !== "AbortError") {
      showToast("续写失败", err.message || "请检查模型接口", "edit");
    }
  } finally {
    isGenerating.value = false;
    currentAbortController = null;
    nextTick(() => {
      const t = lastTurn();
      if (t) {
        lastSyncedFor.delete(t.id);
        syncBodyEditor(t);
      }
    });
  }
}

function stopGeneration() {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
  }
  isGenerating.value = false;
  if (aiTurns.value.length > 0) aiMessage.value.incomplete = true;
}

/* ---------------- Regeneration Actions (重新生成 / 换结构 / 换手法 / 换结尾 / 重写篇章 / 下一章) ---------------- */
type VariantMode =
  | "refresh"
  | "structure"
  | "technique"
  | "ending"
  | "rewrite"
  | "chapter_outline"
  | "dialogue_only"
  | "outline"
  | "next_chapter"
  | "follow_up";

interface NextChapterState {
  disabled: boolean;
  label: string;
  tooltip: string;
  actionType: "to_chapter_outline" | "chapter_step" | "dialogue_step" | "disabled_full_article";
  targetChapterNum?: number;
  chapterTitle?: string;
}

/* ---------------- "下一章" 上下文智能识别 ----------------
   按产品设计四类语境推进：
   1. 对话话本：识别到话本时，按细纲推进下一幕相同格式的话本；
   2. 大纲：上下文为大纲且无章节细纲时，推进生成章节细纲；
   3. 章节细纲：按细纲解析创作进度，自动推进下一章正文；
   4. 完整单篇正文：无大纲/细纲/话本作上下文时，按钮禁用并弹友好说明气泡。
   判定只基于「结构化产出类型」（标题 / 提示词标记），不靠正文里的字面词命中，
   避免把完整正文误判成可推进的章纲语境。 */

/** 中文数字「零一二三四五六七八九十百」转整数（支持到 999）。 */
function cnToNumber(s: string): number | null {
  if (!s) return null;
  const digit: Record<string, number> = {
    零: 0, 一: 1, 二: 2, 三: 3, 四: 4,
    五: 5, 六: 6, 七: 7, 八: 8, 九: 9,
  };
  const of = (ch: string): number =>
    Object.prototype.hasOwnProperty.call(digit, ch) ? digit[ch] : -1;
  if (/^[零一二三四五六七八九]$/.test(s)) return of(s);
  if (s === "十") return 10;
  const m100 = /^([一二三四五六七八九])?百([零一二三四五六七八九])?$/.exec(s);
  if (m100) {
    const hundreds = m100[1] ? of(m100[1]) : 1;
    const rem = m100[2] ? of(m100[2]) : 0;
    return hundreds >= 1 && rem >= 0 ? hundreds * 100 + rem : null;
  }
  const ti = s.indexOf("十");
  if (ti >= 0) {
    const tens = ti === 0 ? 1 : of(s[ti - 1]);
    const ones = ti + 1 < s.length ? of(s[s.length - 1]) : 0;
    return tens >= 1 && ones >= 0 ? tens * 10 + ones : null;
  }
  return null;
}

/** 章节号 / 幕号标记转整数（阿拉伯数字优先，否则中文数字）。 */
function chapterTokenToInt(s: string): number | null {
  const t = (s || "").trim();
  if (/^\d{1,4}$/.test(t)) {
    const n = parseInt(t, 10);
    return n > 0 ? n : null;
  }
  return cnToNumber(t);
}

/** 从文本解析第一个章节号（支持「第1章」「第一章」「第 1 章」「Chapter 3」）。 */
function chapterNumberIn(text: string): number | null {
  const m = /第\s*([0-9一二三四五六七八九十百]+)\s*章/.exec(text || "");
  if (m) return chapterTokenToInt(m[1]);
  const mc = /Chapter\s*([0-9]+)/i.exec(text || "");
  if (mc) {
    const n = parseInt(mc[1], 10);
    return n > 0 ? n : null;
  }
  return null;
}

/** 某条产出是否为「对话话本」（剧本式对话输出）。 */
function isDialogueTurn(turn: AiTurn): boolean {
  const title = turn.title || "";
  if (/话本|对话/.test(title)) return true;
  const content = turn.content || "";
  return /【对话话本】|【分幕剧本】|【对话框架】|【话本正文】/.test(content);
}

/** 某条产出是否为「章节细纲 / 章纲」规划文档。 */
function isChapterOutlineTurn(turn: AiTurn): boolean {
  const title = turn.title || "";
  if (/细纲|章纲/.test(title)) return true;
  const text = `${turn.content || ""}\n${turn.prompt || ""}`;
  return /【章节细纲】|【章纲规划】|【章纲内容】|【详细章纲】|【章节大纲】/.test(text);
}

/** 某条产出是否为「故事大纲」规划文档。 */
function isOutlineTurn(turn: AiTurn): boolean {
  const title = turn.title || "";
  if (/大纲/.test(title)) return true;
  return /【输出目标】[：:]\s*故事大纲/.test(turn.prompt || "");
}

/** 从一条产出的标题与正文里识别它已「写成」的章节号集合（正文形态的章节标记）。 */
function writtenChapterNumbers(turn: AiTurn): number[] {
  const out: number[] = [];
  const push = (n: number | null) => {
    if (n && !out.includes(n)) out.push(n);
  };
  push(chapterNumberIn(turn.title || ""));
  const content = turn.content || "";
  const re =
    /(?:^|\n)\s*#{0,6}\s*第\s*([0-9一二三四五六七八九十百]+)\s*章[：:\s]|【第\s*([0-9一二三四五六七八九十百]+)\s*章(?:正文)?】/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) push(chapterTokenToInt(m[1] || m[2]));
  return out;
}

/** 从全文（标题 + 正文 + 提示词）扫描「第 X 幕／场」的最大编号，用于话本推进下一幕。
    至少从第 2 幕起步（当前已有一幕在演）。 */
function maxSceneNumberIn(convText: string): number {
  let max = 0;
  for (const m of convText.matchAll(/第\s*([0-9一二三四五六七八九十百]+)\s*[场幕]/g)) {
    const n = chapterTokenToInt(m[1]);
    if (n) max = Math.max(max, n);
  }
  return max;
}

interface ChapterPlan {
  numbers: number[];
  titles: Map<number, string>;
}

/** 从一章章节细纲文档解析章节清单（兼容「——第[X]章——」「## 第X章」「第X章：xx」等写法）。 */
function parseChapterPlan(planTurn: AiTurn): ChapterPlan {
  const numbers: number[] = [];
  const titles = new Map<number, string>();
  for (const raw of (planTurn.content || "").split("\n")) {
    const line = raw.trim();
    const m =
      /^——\s*第\s*([0-9一二三四五六七八九十百]+)\s*章\s*——/.exec(line) ||
      /^#{0,6}\s*第\s*([0-9一二三四五六七八九十百]+)\s*章[：:\s\-—_]*([^\n]*)$/.exec(line);
    if (!m) continue;
    const n = chapterTokenToInt(m[1]);
    if (!n) continue;
    if (!numbers.includes(n)) {
      numbers.push(n);
      const rawTitle = (m[2] || "").replace(/[#*`~>]/g, "").trim();
      if (rawTitle) titles.set(n, rawTitle.slice(0, 12));
    }
  }
  numbers.sort((a, b) => a - b);
  return { numbers, titles };
}

/** 依据章节细纲规划「下一章」的推进结果；规划内章节已全部写完时返回 null。 */
function chapterStepResult(planTurn: AiTurn): NextChapterState | null {
  const plan = parseChapterPlan(planTurn);

  /* 已写成的章节号：标题带「第 X 章」，或正文以章节标题开头的产出。 */
  const written = new Set<number>();
  for (const t of aiTurns.value) {
    if (t.id === planTurn.id) continue;
    for (const n of writtenChapterNumbers(t)) written.add(n);
  }

  let nextNum = 0;
  if (plan.numbers.length > 0) {
    for (const n of plan.numbers) {
      if (!written.has(n)) {
        nextNum = n;
        break;
      }
    }
    if (nextNum === 0) return null;
  } else {
    nextNum = (written.size > 0 ? Math.max(...written) : 0) + 1;
  }

  const rawTitle = plan.titles.get(nextNum) ?? "";
  const chapterTitle = rawTitle ? `第 ${nextNum} 章 ${rawTitle}` : `第 ${nextNum} 章`;

  return {
    disabled: false,
    label: "下一章",
    tooltip: `依据章节细纲，推进生成【${chapterTitle}】正文`,
    actionType: "chapter_step",
    targetChapterNum: nextNum,
    chapterTitle,
  };
}

const nextChapterState = computed<NextChapterState>(() => {
  if (isGenerating.value) {
    return {
      disabled: true,
      label: "下一章",
      tooltip: "AI 正在生成中，请稍候",
      actionType: "disabled_full_article",
    };
  }

  const turns = aiTurns.value;
  if (turns.length === 0 || !aiMessage.value.content.trim()) {
    return {
      disabled: true,
      label: "下一章",
      tooltip: "当前尚无正文、大纲或章节细纲上下文",
      actionType: "disabled_full_article",
    };
  }

  const latest = turns[turns.length - 1];
  const prior = turns.slice(0, -1);
  const convText = turns
    .map((t) => `${t.title || ""}\n${t.content || ""}\n${t.prompt || ""}`)
    .join("\n\n");

  /* 1. 对话话本：识别到话本，推进下一幕同格式话本。 */
  if (isDialogueTurn(latest)) {
    const nextScene = Math.max(2, maxSceneNumberIn(convText) + 1);
    const chapterTitle = `第${nextScene}幕对话话本`;
    return {
      disabled: false,
      label: "下一章",
      tooltip: `推进生成【${chapterTitle}】`,
      actionType: "dialogue_step",
      targetChapterNum: nextScene,
      chapterTitle,
    };
  }

  /* 2. 章节细纲：按细纲推进下一章正文。 */
  if (isChapterOutlineTurn(latest)) {
    const state = chapterStepResult(latest);
    return state ?? {
      disabled: true,
      label: "下一章",
      tooltip: "该章节细纲内规划的章节已全部推进完毕",
      actionType: "disabled_full_article",
    };
  }

  /* 3. 故事大纲：尚无章节细纲时，推进生成章节细纲。 */
  if (isOutlineTurn(latest)) {
    return {
      disabled: false,
      label: "下一章",
      tooltip: "依据当前故事大纲，自动推进生成详细章节细纲",
      actionType: "to_chapter_outline",
      chapterTitle: "章节细纲",
    };
  }

  /* 4. 普通正文产出：以最近的规划产出作为推进上下文。 */
  for (const t of [...prior].reverse()) {
    if (isDialogueTurn(t)) {
      const nextScene = Math.max(2, maxSceneNumberIn(convText) + 1);
      const chapterTitle = `第${nextScene}幕对话话本`;
      return {
        disabled: false,
        label: "下一章",
        tooltip: `推进生成【${chapterTitle}】`,
        actionType: "dialogue_step",
        targetChapterNum: nextScene,
        chapterTitle,
      };
    }
    if (isChapterOutlineTurn(t)) {
      const state = chapterStepResult(t);
      return state ?? {
        disabled: true,
        label: "下一章",
        tooltip: "该章节细纲内规划的章节已全部推进完毕",
        actionType: "disabled_full_article",
      };
    }
    if (isOutlineTurn(t)) {
      return {
        disabled: false,
        label: "下一章",
        tooltip: "依据当前故事大纲，自动推进生成详细章节细纲",
        actionType: "to_chapter_outline",
        chapterTitle: "章节细纲",
      };
    }
  }

  /* 5. 完整单篇正文：没有大纲 / 细纲 / 话本作为上下文，禁用并给出友好说明。 */
  return {
    disabled: true,
    label: "下一章",
    tooltip: "当前为完整单篇正文，未检测到大纲、章节细纲或对话话本上下文，暂无法按章推进",
    actionType: "disabled_full_article",
  };
});

/* ---------------- "下一章" 禁用说明气泡 ----------------
   原生 title 在 disabled 按钮上不弹（浏览器限制），改用固定定位气泡：
   悬停在按钮上即显示友好说明，离开或滚动即消失。 */
const nextChapterBtnWrapEl = ref<HTMLElement | null>(null);
const ncTipVisible = ref(false);
const ncTipX = ref(0);
const ncTipY = ref(0);
const ncTipText = ref("");

function showNextChapterTooltip() {
  const state = nextChapterState.value;
  if (!state.disabled || !state.tooltip) return;
  const el = nextChapterBtnWrapEl.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const width = 260;
  const gap = 8;
  let x = rect.left + rect.width / 2;
  x = Math.max(8 + width / 2, Math.min(x, window.innerWidth - 8 - width / 2));
  ncTipX.value = Math.round(x);
  ncTipY.value = Math.round(rect.top - gap);
  ncTipText.value = state.tooltip;
  ncTipVisible.value = true;
}

function hideNextChapterTooltip() {
  if (!ncTipVisible.value) return;
  ncTipVisible.value = false;
}

/* 语境切换（从禁用变可点 / 生成状态变化等）时收起说明气泡。 */
watch(
  () => [nextChapterState.value.disabled, isGenerating.value],
  () => hideNextChapterTooltip(),
);

async function runNextChapter(sourceTurn?: AiTurn) {
  if (isGenerating.value) return;
  const state = nextChapterState.value;
  if (state.disabled) {
    showToast("提示", state.tooltip, "edit");
    return;
  }

  if (state.actionType === "to_chapter_outline") {
    activeGeneratingAction.value = "chapter_outline";
    await startGenerationCore("chapter_outline", {
      initialReasoning: "检测到上文故事大纲，正在自动推进生成详细章节细纲...",
      sourceTurn,
    });
  } else if (state.actionType === "dialogue_step") {
    activeGeneratingAction.value = "dialogue_only";
    await startGenerationCore("dialogue_only", {
      initialReasoning: `已锁定上文话本，正在推进生成【${state.chapterTitle || "下一幕话本"}】...`,
      sourceTurn,
    });
  } else if (state.actionType === "chapter_step") {
    activeGeneratingAction.value = "normal";
    await startGenerationCore("next_chapter", {
      initialReasoning: `已锁定细纲上下文，正在推进创作【${state.chapterTitle || `第 ${state.targetChapterNum} 章`}】正文...`,
      sourceTurn,
    });
  }
}

/* ---------------- 故事创作五步工作流编排状态与动作 ---------------- */
const hasNovelOutline = computed(() =>
  aiTurns.value.some((t) => isOutlineTurn(t))
);

const hasChapterOutline = computed(() =>
  aiTurns.value.some((t) => isChapterOutlineTurn(t))
);

const currentChapterDisplayTitle = computed(() => {
  if (nextChapterState.value.chapterTitle) {
    return nextChapterState.value.chapterTitle;
  }
  const latest = aiMessage.value;
  return latest?.title || (latest?.content ? turnLabel(latest) : "");
});

const totalDraftChapters = computed(
  () =>
    aiTurns.value.filter(
      (t) =>
        !isOutlineTurn(t) && !isChapterOutlineTurn(t) && !isAuditOrReaderTurn(t)
    ).length
);

const currentWorkflowStep = ref<WorkflowStepId>(
  totalDraftChapters.value > 0
    ? "drafting"
    : hasChapterOutline.value
    ? "drafting"
    : hasNovelOutline.value
    ? "chapter_outline"
    : "outline"
);

function isWorkflowStepAccessible(step: WorkflowStepId): boolean {
  if (step === "outline") return true;
  if (step === "chapter_outline") return hasNovelOutline.value;
  if (step === "drafting") return hasChapterOutline.value;
  if (step === "state_ledger") return totalDraftChapters.value > 0;
  if (step === "audit_review") return totalDraftChapters.value > 0;
  return false;
}

const isAuditOrReaderMode = computed(
  () => writingMode.value === "auditor" || writingMode.value === "reader"
);

function handleSelectWorkflowStep(step: WorkflowStepId) {
  if (!isWorkflowStepAccessible(step)) {
    if (step === "chapter_outline") {
      showToast("流程未解锁", "请先在步骤一构思并生成故事大纲", "warn");
    } else if (step === "drafting") {
      showToast("流程未解锁", "请先在步骤二规划并生成章节细纲", "warn");
    } else if (step === "state_ledger") {
      showToast("流程未解锁", "请先在步骤三起草正文后解锁状态追踪表", "warn");
    } else if (step === "audit_review") {
      showToast("流程未解锁", "请先在步骤三起草正文后再进行审评与重写", "warn");
    }
    return;
  }
  currentWorkflowStep.value = step;
  if (step === "outline") {
    writingMode.value = "writer";
    leftActiveTab.value = "source";
  } else if (step === "chapter_outline") {
    writingMode.value = "writer";
  } else if (step === "drafting") {
    writingMode.value = "writer";
    leftActiveTab.value = "drafts";
  } else if (step === "state_ledger") {
    leftActiveTab.value = "state";
  } else if (step === "audit_review") {
    writingMode.value = "auditor";
  }
}

async function handleWorkflowTriggerOutline() {
  currentWorkflowStep.value = "outline";
  writingMode.value = "writer";
  activeGeneratingAction.value = "normal";
  await startGenerationCore("outline");
}

async function handleWorkflowTriggerChapterOutline() {
  if (!hasNovelOutline.value) {
    showToast("提示", "请先完成第1步故事大纲，再生成章节细纲", "warn");
    return;
  }
  currentWorkflowStep.value = "chapter_outline";
  writingMode.value = "writer";
  await startChapterOutlineGeneration();
}

function handleWorkflowTriggerAudit() {
  if (totalDraftChapters.value === 0) {
    showToast("提示", "尚无起草正文，请先在步骤三起草正文", "warn");
    return;
  }
  currentWorkflowStep.value = "audit_review";
  writingMode.value = "auditor";
  startGeneration();
}

function handleWorkflowTriggerReader() {
  if (totalDraftChapters.value === 0) {
    showToast("提示", "尚无起草正文，请先在步骤三起草正文", "warn");
    return;
  }
  currentWorkflowStep.value = "audit_review";
  writingMode.value = "reader";
  startGeneration();
}

async function handleWorkflowTriggerRewrite() {
  if (totalDraftChapters.value === 0) {
    showToast("提示", "尚无起草正文，请先在步骤三起草正文", "warn");
    return;
  }
  const turn = aiMessage.value;
  const feedback = latestFeedbackContext(turn);
  if (!feedback) {
    showToast("提示", "请先在上方点击「审核意见」或「读者评估」出具审评意见", "edit");
    return;
  }
  await runVariantGeneration("rewrite", turn);
}

function handleWorkflowToggleStateLedger() {
  if (totalDraftChapters.value === 0) {
    showToast("提示", "需先在步骤三起草正文后解锁状态追踪表", "warn");
    return;
  }
  if (leftActiveTab.value === "state") {
    leftActiveTab.value = "drafts";
  } else {
    leftActiveTab.value = "state";
    currentWorkflowStep.value = "state_ledger";
  }
}

const usedStructureIds = ref<string[]>([]);
const usedTechniqueIds = ref<string[]>([]);
const usedEndingIds = ref<string[]>([]);

function pickUnused(allIds: string[], used: string[]): string {
  const fresh = allIds.filter((id) => !used.includes(id));
  const pool = fresh.length > 0 ? fresh : allIds;
  return pool[Math.floor(Math.random() * pool.length)];
}

/** 从对话上下文里找最近一份「审核意见」或「读者评估」反馈，供「重写篇章」按反馈修写。 */
function latestFeedbackContext(
  sourceTurn: AiTurn
): { kind: "auditor" | "reader"; turn: AiTurn } | null {
  for (let i = aiTurns.value.length - 1; i >= 0; i--) {
    const t = aiTurns.value[i];
    if (!isAuditOrReaderTurn(t) || t.id === sourceTurn.id) continue;
    const isAuditor =
      t.mode === "auditor" || t.title === "审核意见" || t.summary === "审核意见";
    return { kind: isAuditor ? "auditor" : "reader", turn: t };
  }
  return null;
}

/** 根据「审核意见 / 读者反馈」构造「重写篇章」的用户指令。 */
function buildRewriteWithFeedbackPrompt(
  sourceBody: string,
  feedback: { kind: "auditor" | "reader"; turn: AiTurn }
): string {
  const label =
    feedback.kind === "auditor" ? "审核意见" : "读者评估反馈";
  return `请根据以下参考正文与${label}，进行针对性修改重写：

【参考正文】：
${sourceBody}

【${label}】：
${feedback.turn.content}

【处理目标】：按${label}逐条修改前面的正文，保留整体结构、核心情节与人物弧光

请严格依据上述${label}输出修改后的完整正文。`;
}

async function runVariantGeneration(variant: VariantMode, sourceTurn?: AiTurn) {
  if (isGenerating.value) return;
  if (sourceTurn) {
    const el = bodyEditors.get(sourceTurn.id);
    if (el) {
      persistBodyEdit(sourceTurn, el);
    }
  }
  const contentToTest = sourceTurn?.content || aiMessage.value.content;
  if (!contentToTest.trim() && !topicContent.value.trim()) {
    showToast("提示", "请先在正文中输入或粘贴文本，或在右侧输入大纲灵感", "edit");
    return;
  }

  /* 上一版会作为同一面板的分页版本保留在中间区与历史里，因此这里只把「更换了哪一项」
     作为新条目的思考起点，不再单独归档。 */
  let initialReasoning = "";

  /* 「重写篇章」优先按上下文反馈修写：有审核意见按审核意见，有读者反馈按读者反馈，
     都没有时才退回通用「重写语言表达」的兜底。 */
  let customPrompt: string | undefined;
  if (variant === "rewrite" && sourceTurn) {
    const feedback = latestFeedbackContext(sourceTurn);
    if (feedback) {
      const label = feedback.kind === "auditor" ? "审核意见" : "读者反馈";
      customPrompt = buildRewriteWithFeedbackPrompt(sourceTurn.content, feedback);
      initialReasoning = `已锁定上文${label}，正在按反馈逐条修改前面的正文...`;
    }
  }

  /* 挑选一个未用过的结构 / 手法 / 结尾 */
  if (variant === "structure") {
    const id = pickUnused(
      NARRATIVE_STRUCTURES.map((n) => n.id),
      usedStructureIds.value
    );
    usedStructureIds.value.push(id);
    initialReasoning = `已更换叙事结构：${NARRATIVE_STRUCTURES.find((n) => n.id === id)?.name}`;
  } else if (variant === "technique") {
    const id = pickUnused(
      NARRATIVE_TECHNIQUES.map((n) => n.id),
      usedTechniqueIds.value
    );
    usedTechniqueIds.value.push(id);
    initialReasoning = `已更换叙事手法：${NARRATIVE_TECHNIQUES.find((n) => n.id === id)?.name}`;
  } else if (variant === "ending") {
    const id = pickUnused(
      NARRATIVE_ENDINGS.map((n) => n.id),
      usedEndingIds.value
    );
    usedEndingIds.value.push(id);
    initialReasoning = `已更换结局结尾：${NARRATIVE_ENDINGS.find((n) => n.id === id)?.name}`;
  }

  activeGeneratingAction.value = "normal";
  await startGenerationCore(variant, { initialReasoning, sourceTurn, customPrompt });
}

function labelForVariant(variant: VariantMode): string {
  /* 对话 / 审核意见 / 读者：产出标题直接用模式名，而不是写手的动作名。 */
  if (writingMode.value === "chat") return "对话回复";
  if (writingMode.value === "auditor") return "审核意见";
  if (writingMode.value === "reader") return "读者评估报告";
  if (variant === "refresh") return "重新生成";
  if (variant === "structure") return "换个结构";
  if (variant === "technique") return "换个手法";
  if (variant === "ending") return "换个结尾";
  if (variant === "rewrite") return "重写篇章";
  if (variant === "chapter_outline") return "章节细纲";
  if (variant === "dialogue_only") return "对话话本";
  if (variant === "outline") return "故事大纲";
  if (variant === "next_chapter") {
    return nextChapterState.value.chapterTitle ? `正文 · ${nextChapterState.value.chapterTitle}` : "下一章正文";
  }
  return "重新生成";
}

function variantGoal(variant: VariantMode): string {
  if (variant === "structure") {
    return "重新寻找切入某个故事结构（避开用过的结构），并据此重写一篇全新正文";
  }
  if (variant === "technique") {
    return "重新寻找切入某个叙事手法（避开用过的叙事手法），并据此重写一篇全新正文";
  }
  if (variant === "ending") {
    return "重新寻找切入某个故事结尾（避开用过的结局结尾），并据此重写一篇全新正文";
  }
  if (variant === "rewrite") {
    return "保留当前章节结构与核心意义，仅重写语言表达，使行文焕然一新";
  }
  return "根据大纲与各项定制要求，全新起草一篇正文";
}

/** 「重写篇章」按钮提示文案：有审核意见 / 读者反馈时提示按反馈修写，否则提示默认行为。 */
function rewriteVariantTitle(turn: AiTurn): string {
  const feedback = latestFeedbackContext(turn);
  if (feedback) {
    return feedback.kind === "auditor"
      ? "按上下文中的审核意见，逐条修改前面的正文"
      : "按上下文中的读者反馈，逐条修改前面的正文";
  }
  return "按既定设定重写篇章";
}

/* ---------------- Message Actions（逐条产出独立操作） ----------------
   三个动作都挂载在每条 AI 回复自己的标题栏右侧，作用于被点击的那一条产出，
   而不是笼统指向「最新一条」。 */

function copyMessageText(turn: AiTurn) {
  if (!turn.content) return;
  navigator.clipboard.writeText(turn.content);
  showToast("已复制", `「${turnLabel(turn)}」正文已复制到剪贴板`, "habit");
}

/**
 * 应用到文档编辑区：为指定 AI 产出新建一份文档并写入。
 *
 * 以前是「追加进活动文档」：活动文档不存在（documentFilesStore 里没有对应
 * 条目）时只改了 docStore.markdown，而文档界面是监听 file.content 把正文刷进
 * 编辑区的 —— 于是点了没反应，必须用户先手动新建文档。现在一律新建一份文档
 * 承载这次产出：标题取正文标题，建好即设为活动文档，编辑区立刻拿到内容。
 */
function applyToDoc(turn: AiTurn) {
  if (!turn.content) return;
  const body = turn.content;
  const file = createDocFile(null, deriveBodyTitle(body) || turn.title || "AI 产出");
  file.content = body;
  documentFilesStore.activeFileId = file.id;
  docStore.markdown = body;
  pulseAiDocEdit(file.id);
  showToast("已应用到文档", `已新建文档「${file.title}」并写入正文`, "habit");
}

/* ---------------- 自动界面存稿（Ctrl+S / 顶部「保存」按钮） ----------------
   保存面板由 App 统一驱动（与文档界面同一套「同步到本地文件」面板）。这里的职责
   只是交出「当前文稿」：先落库编辑区未提交的改动，再返回标题与正文给 App 弹出保存面板。 */
export interface AutoManuscriptSave {
  title: string;
  content: string;
}

const hoveredTurnId = ref<number | null>(null);

function onTurnCardMouseEnter(turnId: number) {
  hoveredTurnId.value = turnId;
}

function onTurnCardMouseLeave(turnId: number) {
  if (hoveredTurnId.value === turnId) hoveredTurnId.value = null;
}

/** 解析「当前文稿」：鼠标所在的正文卡片 > 光标所在正文编辑区 > 历史选中条目 > 最新产出。 */
function determineActiveTurn(): AiTurn | null {
  /* 1. 鼠标悬停的正文卡片 */
  if (hoveredTurnId.value !== null) {
    const t = aiTurns.value.find((x) => x.id === hoveredTurnId.value);
    if (t) return t;
  }
  /* 2. 光标 / 选区所在的正文编辑区 */
  const activeEl = document.activeElement;
  if (activeEl && activeEl.classList.contains("auto-wysiwyg-body")) {
    for (const [tId, el] of bodyEditors.entries()) {
      if (el === activeEl) return aiTurns.value.find((t) => t.id === tId) || null;
    }
  }
  /* 3. 用户在文稿或目录中选中的历史条目 */
  if (selectedHistoryId.value !== null) {
    const t = aiTurns.value.find((x) => x.id === selectedHistoryId.value);
    if (t) return t;
  }
  /* 4. 最新一条产出 */
  return aiMessage.value && aiMessage.value.id ? aiMessage.value : null;
}

/** 取出当前待保存的文稿：先把编辑区未落库的改动序列化回内容，再返回标题与正文。 */
function getActiveManuscript(): AutoManuscriptSave | null {
  const turn = determineActiveTurn();
  if (!turn) return null;
  /* 先把正在编辑的 DOM 改动同步回内容（数据库侧自动保存由 store 完成）。 */
  const el = bodyEditors.get(turn.id);
  if (el && bodyEditable(turn)) persistBodyEdit(turn, el);

  const content = turn.content?.trim();
  if (!content) return null;
  const title =
    deriveBodyTitle(content) || turnLabel(turn) || "AI 文稿";
  return { title, content: turn.content };
}

defineExpose({ getActiveManuscript });

/* ---------------- 「一键排版」面板（复刻文档顶部工具栏） ----------------
   把文档界面顶部工具栏的「文本清理」面板（WrapText 图标）复刻到每条 AI 回复
   标题栏原先「编辑正文」按钮的位置，功能机制与文档界面完全一致：
   - 一键排版 = 清除多余空行（Ctrl+Shift+F 同一套规则）；
   - 随机排版 = 吃短句换行并段（同一引擎 randomLayout、同一组滑块参数）；
   - 一键去了字 / 一键去的地得 = 同一套虚词规则引擎 cleanParticles。
   只是作用对象从全局文档换成被点击的那一条产出（turn.content），
   结果即时写回正文并自动保存。 */
const formatMenuTurnId = ref<number | null>(null);
const cleanupMode = ref<CleanupMode>("smart");
const DE_TOKENS: readonly Particle[] = PARTICLES.filter((p) => p !== "了");
const selectedDeTokens = ref<Particle[]>([...DE_TOKENS]);

function toggleFormatMenu(turn: AiTurn) {
  if (formatMenuTurnId.value === turn.id) {
    formatMenuTurnId.value = null;
    return;
  }
  closeTypoPanel();
  formatMenuTurnId.value = turn.id;
}

function closeFormatMenu() {
  formatMenuTurnId.value = null;
}

/* ---------------- 「排版与字体」面板（复刻文档顶部工具栏） ----------------
   全局唯一：作用于与文档界面同一套 aiSettings 排版字段（字号 / 字体 / 行距 /
   边距 / 网格线 / 段首样式），改一处两处 WYSIWYG 同步生效。面板挂载在被点击
   那条回复的标题栏下（与「一键排版」菜单同锚点），随卡片滚动。 */
const typoPanelOpen = ref(false);
const typoPanelTurnId = ref<number | null>(null);

function toggleTypoPanel(turn: AiTurn) {
  if (typoPanelOpen.value && typoPanelTurnId.value === turn.id) {
    closeTypoPanel();
    return;
  }
  formatMenuTurnId.value = null;
  typoPanelTurnId.value = turn.id;
  typoPanelOpen.value = true;
}

function closeTypoPanel() {
  typoPanelOpen.value = false;
  typoPanelTurnId.value = null;
}

function resetTypographyDefaults() {
  applyFont(DEFAULT_APP_FONT);
  aiSettings.editorFontSize = DEFAULT_EDITOR_FONT_SIZE;
  aiSettings.editorLineHeight = DEFAULT_EDITOR_LINE_HEIGHT;
  aiSettings.editorMarginX = DEFAULT_EDITOR_MARGIN_X;
  aiSettings.editorMarginY = DEFAULT_EDITOR_MARGIN_Y;
  aiSettings.editorGridLine = "none";
  showToast("已恢复默认", "排版与字体已恢复默认设置", "habit");
}

function setTypographyFontSize(size: number) {
  editorFontSize.value = size;
}

function toggleDeToken(token: Particle) {
  const list = selectedDeTokens.value;
  selectedDeTokens.value = list.includes(token)
    ? list.filter((t) => t !== token)
    : [...list, token].sort((a, b) => DE_TOKENS.indexOf(a) - DE_TOKENS.indexOf(b));
}

const formatCleanupModeTip = computed(() =>
  cleanupMode.value === "smart"
    ? "只删冗余，「了解」「他走了。」这类必要用法保留"
    : "匹配到就删，可能削断词语与句子，请核对后保存",
);

const formatDeTokenTip = computed(() => {
  if (cleanupMode.value === "all") return "当前为全部删除，选中的字会被逐个删光";
  if (selectedDeTokens.value.includes("得")) return "「得」是补语与动词标记，智能模式下全部保留";
  return "只删「的的不休」与可省定语，结构必需的保留";
});

/* 排版 / 清理结果直接写回产出：同步 watcher 会对比快照并回写编辑区 DOM。 */
function commitFormattedBody(turn: AiTurn, next: string) {
  if (next === turn.content) return;
  recordUndoSnapshot(turn, true);
  turn.content = next;
  clearBodyFocused();
  lastSyncedFor.delete(turn.id);
  syncBodyEditor(turn);
}

/** 一键排版算法：清除每行行尾无意义空格、全角空格以及多余空行，首尾除空，让排版清爽干净。 */
function cleanWhitespaceFormatting(text: string): string {
  if (!text) return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+$/, ""))
    .join("\n")
    .replace(/\n{2,}/g, "\n")
    .replace(/^\n+|\n+$/g, "");
}

/** 一键排版：保留原文换行机制，只清除「无意义」空格与空行（与文档界面同一套规则）。 */
function autoReformatWhitespace(turn: AiTurn) {
  closeFormatMenu();
  const src = turn.content || "";
  if (!src) {
    showToast("无法排版", "该条回复没有正文内容", "edit");
    return;
  }
  const cleaned = cleanWhitespaceFormatting(src);
  if (cleaned !== src) {
    commitFormattedBody(turn, cleaned);
    showToast("已重新排版", "已清除多余空格与空行，内容更紧凑", "habit");
  } else {
    showToast("无需调整", "当前内容排版整洁，没有多余空格与空行", "habit");
  }
}

/** 随机排版：与文档界面同一套随机合并引擎与滑块参数。 */
function autoRandomizeLayout(turn: AiTurn) {
  closeFormatMenu();
  if (!turn.content || !turn.content.trim()) {
    showToast("文档为空", "没有可排版的正文内容", "edit");
    return;
  }
  const result = randomizeLayout(turn.content, {
    shortLineMax: aiSettings.layoutShortLineMax,
    maxMergedLines: aiSettings.layoutMaxMergedLines,
  });
  if (result.merged === 0) {
    showToast(
      "无需排版",
      `没有找到 ${aiSettings.layoutShortLineMax} 字以内的连续短句，可把「短句上限」调大再试`,
      "habit",
    );
    return;
  }
  commitFormattedBody(turn, result.text);
  showToast(
    "已随机排版",
    `合并了 ${result.merged} 处短句换行，成 ${result.paragraphs} 段`,
    "habit",
  );
}

/** 虚词清理公共落地：与文档界面同一套规则引擎与提示口径。 */
function autoRunParticleCleanup(turn: AiTurn, targets: readonly Particle[], title: string) {
  closeFormatMenu();
  if (targets.length === 0) {
    showToast("未选择字", "请先勾选要清理的「的 / 地 / 得」", "edit");
    return;
  }
  if (!turn.content) {
    showToast("文档为空", "没有可清理的正文内容", "edit");
    return;
  }
  const label = targets.join("、");
  const result = cleanParticles(turn.content, targets, cleanupMode.value);
  if (result.removed === 0) {
    const detail =
      result.kept === 0
        ? `正文中没有「${label}」`
        : `${result.kept} 个「${label}」都是必要用法（词语内部、句末表变化、补语标记等），已全部保留`;
    showToast("无需清理", detail, "habit");
    return;
  }
  commitFormattedBody(turn, result.text);
  const detail =
    cleanupMode.value === "smart"
      ? `删除 ${result.removed} 个冗余的「${label}」，保留 ${result.kept} 个必要用法`
      : `共删除 ${result.removed} 个「${label}」`;
  showToast(title, detail, "habit");
}

function autoCleanLeToken(turn: AiTurn) {
  autoRunParticleCleanup(turn, ["了"], "已去“了”字");
}

function autoCleanDeTokens(turn: AiTurn) {
  autoRunParticleCleanup(turn, [...selectedDeTokens.value], "已去的地得");
}

/** 删除某一条 AI 回复：从当前会话里移除该产出（历史页同源数据一并更新）。 */
function deleteTurn(turn: AiTurn) {
  if (isGenerating.value && turn.id === aiMessage.value.id) return;
  const groupId = turn.pageGroupId || String(turn.id);
  const group = turnGroups.value.find((g) => g.groupId === groupId);
  if (group) {
    const curIdx = getGroupActiveIndex(group);
    if (curIdx >= group.turns.length - 1 && curIdx > 0) {
      setGroupActiveIndex(groupId, curIdx - 1);
    }
  }
  deleteHistory(turn);
  bodyEditors.delete(turn.id);
  lastSyncedFor.delete(turn.id);
  bodyEditorRefFns.delete(turn.id);
  const label = turnLabel(turn);
  showToast("已删除", `已删除「${label}」这条回复`, "habit");
}

/* ---------------- 审核意见 / 对话 / 读者：把 AI 问出的选项变成可点的追问 ----------------
   当 AI（尤其是反复审核同一份文档时）在末尾抛出一个问题并给出「1、2、3」这类
   文字选项，就把选项解析出来渲染成可点击胶囊；点一下即把该选项作为新的用户
   追问回发给 AI，替代「自己复制选项再手动粘贴」的繁琐动作。 */

/** 解析 AI 回复末尾的「问题 + 选项」清单：要求末尾是 2~6 条连续编号选项，
    且选项上一行是一个提问（带问号或 "什么 / 哪个 / 需要 / 选择" 等措辞），
    避免把普通审核清单误当成选项。 */
function parseChoiceOptions(content: string): string[] {
  const lines = (content || "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const markerRe =
    /^(?:([0-9]{1,2}|[一二三四五六七八九十]{1,3}|[a-hA-H]))\s*[、.．:：)）]\s*(.+)$/;
  const options: string[] = [];
  let idx = lines.length - 1;
  while (idx >= 0) {
    const m = markerRe.exec(lines[idx]);
    if (!m) break;
    options.unshift(m[2].trim());
    idx--;
  }
  if (options.length < 2 || options.length > 6) return [];
  const question = (lines[idx] ?? "").trim();
  if (!/[？?]/.test(question) && !/(什么|哪个|是否|需要|要我|怎么做|怎么办|选择)/.test(question)) {
    return [];
  }
  return options;
}

const pendingFollowUpText = ref("");

async function sendChoiceOption(optionText: string) {
  if (isGenerating.value) return;
  const text = (optionText || "").trim();
  if (!text) return;
  pendingFollowUpText.value = text;
  activeGeneratingAction.value = "normal";
  await startGenerationCore("follow_up");
}

function clearOutput() {
  stopGeneration();
  aiTurns.value = [];
  groupActiveIndexMap.value = {};
  bodyEditors.clear();
  lastSyncedFor.clear();
  bodyEditorRefFns.clear();
  selectedHistoryId.value = null;
  auditDocId.value = "current";
  cancelRefinePrompt();
  activeRoundIndex.value = 0;
  undoStack.value = [];
  redoStack.value = [];
  lastSnapshotMap.clear();
  closeFindPanel();
  showToast("已重置", "中间编辑区已还原为空白", "edit");
}
</script>

<template>
  <div class="auto-view-root">
    <!-- 历史对话页：承载全部上下文对话，卡片式呈现。 -->
    <div v-if="autoViewMode === 'history'" class="auto-history-page">
      <div class="history-page-head">
        <div class="history-page-title">
          <History :size="16" class="history-page-icon" />
          <span>历史对话 · 全部上下文对话</span>
          <span class="history-page-count">{{ aiTurns.length }} 条</span>
        </div>
        <button class="history-back-btn" type="button" @click="leaveHistoryPage">
          <ArrowLeft :size="14" />
          返回
        </button>
      </div>

      <div v-if="aiTurns.length === 0" class="history-page-empty">
        <History :size="28" class="opacity-30 mb-2" />
        <p class="text-xs opacity-60">
          暂无历史对话<br />
          每次 AI 产出后，完整上下文对话都会记录在这里
        </p>
      </div>

      <!-- 折叠条目列表：默认一行一条，点条目直接跳回对话界面并定位；
           要看这一轮的完整上下文再点右侧小箭头展开。 -->
      <div v-else class="history-page-list">
        <section
          v-for="turn in aiTurns"
          :key="turn.id"
          class="history-entry"
          :class="{ expanded: isHistoryExpanded(turn.id) }"
        >
          <div
            class="history-entry-row"
            role="button"
            tabindex="0"
            :title="`回到对话界面并定位到「${turnLabel(turn)}」`"
            @click="jumpToTurnFromHistory(turn)"
            @keydown.enter.prevent="jumpToTurnFromHistory(turn)"
            @keydown.space.prevent="jumpToTurnFromHistory(turn)"
          >
            <Sparkles :size="12" :stroke-width="2" class="history-entry-icon" />
            <span class="history-entry-title">{{ turnLabel(turn) }}</span>
            <span class="history-entry-chars">{{ turn.content.trim().length }} 字</span>
            <span class="history-entry-time">{{ turn.timestamp }}</span>
            <span v-if="turn.tokens" class="history-card-tokens">
              <Coins :size="11" :stroke-width="1.9" />
              {{ turn.tokens.toLocaleString() }}
            </span>
            <button
              class="history-entry-caret"
              type="button"
              :title="isHistoryExpanded(turn.id) ? '收起本轮上下文' : '展开本轮完整上下文'"
              @click.stop="toggleHistoryEntry(turn.id)"
            >
              <ChevronDown v-if="isHistoryExpanded(turn.id)" :size="13" :stroke-width="2.2" />
              <ChevronRight v-else :size="13" :stroke-width="2.2" />
            </button>
            <button
              class="history-card-del"
              title="删除此条目"
              type="button"
              @click.stop="deleteHistory(turn)"
            >
              <Trash2 :size="12" />
            </button>
          </div>

          <div v-if="isHistoryExpanded(turn.id)" class="history-entry-body">
            <!-- 用户侧指令（要求的原文） -->
            <details v-if="turn.prompt" class="history-prompt" open>
              <summary class="history-prompt-summary">
                <MessageSquare :size="12" :stroke-width="2" />
                本轮要求
              </summary>
              <pre class="history-prompt-body">{{ turn.prompt }}</pre>
            </details>

            <!-- 知识项工具活动轨迹 -->
            <div
              v-if="turn.tools && turn.tools.length > 0"
              class="tool-trace-list"
            >
              <span
                v-for="(tr, i) in turn.tools"
                :key="i"
                class="tool-trace-chip"
                :class="{ done: tr.done }"
                :title="tr.detail || tr.label"
              >
                <Check v-if="tr.done" :size="11" class="trace-check" />
                <RefreshCw v-else :size="11" class="trace-spin" />
                {{ tr.label }}
              </span>
            </div>

            <!-- 思考过程 -->
            <details v-if="turn.reasoning" class="history-reasoning">
              <summary class="history-reasoning-summary">
                <BrainCircuit :size="12" :stroke-width="2" />
                思考过程
              </summary>
              <pre class="history-reasoning-body">{{ turn.reasoning }}</pre>
            </details>

            <!-- 完整正文：与文档界面同一条渲染管线（含内容上色） -->
            <div
              class="markdown-body reading-view article-render history-card-body"
              :class="{ 'content-colored': contentColoringOn }"
              :style="autoReadingStyle"
              v-html="renderTurnBody(turn.content)"
            />
            <div v-if="turn.incomplete" class="history-incomplete">
              正文尚未写完（被输出长度上限截断或已中止）
            </div>
            <div v-if="turn.continued" class="history-continued">
              自动接续 {{ turn.continued }} 次
            </div>
          </div>
        </section>
      </div>
    </div>

    <!-- Main Workspace with Workflow Pipeline Bar -->
    <template v-else>
      <!-- 故事创作五步工作流流水线导航条 -->
      <AutoWorkflowBar
        :current-step="currentWorkflowStep"
        :has-outline="hasNovelOutline"
        :has-chapter-outline="hasChapterOutline"
        :current-chapter-title="currentChapterDisplayTitle"
        :total-chapters="totalDraftChapters"
        :is-generating="isGenerating"
        :is-audit-or-reader-mode="isAuditOrReaderMode"
        :can-next-chapter="!nextChapterState.disabled"
        :next-chapter-tooltip="nextChapterState.tooltip"
        @select-step="handleSelectWorkflowStep"
        @trigger-outline="handleWorkflowTriggerOutline"
        @trigger-chapter-outline="handleWorkflowTriggerChapterOutline"
        @trigger-next-chapter="runNextChapter(aiMessage)"
        @trigger-audit="handleWorkflowTriggerAudit"
        @trigger-reader="handleWorkflowTriggerReader"
        @trigger-rewrite-audit="handleWorkflowTriggerRewrite"
        @toggle-state-ledger="handleWorkflowToggleStateLedger"
      />

      <!-- Main Workspace 3-Column Seamless Layout -->
      <div class="auto-workspace">
        <!-- Left Panel: Tabs for Source Material, Drafts, and Story State Ledger (300px width) -->
        <aside class="left-panel" :style="{ width: leftWidth + 'px' }">
          <!-- Left Panel Horizontal Tab Bar -->
          <div class="left-panel-tabs">
            <button
              class="left-tab-btn"
              :class="{ active: leftActiveTab === 'source' }"
              type="button"
              @click="leftActiveTab = 'source'"
            >
              <Sparkles :size="14" />
              新素材
            </button>
            <button
              class="left-tab-btn"
              :class="{ active: leftActiveTab === 'drafts' }"
              type="button"
              @click="leftActiveTab = 'drafts'"
            >
              <FileText :size="14" />
              文稿
              <span v-if="aiTurns.length > 0" class="left-tab-badge">
                {{ aiTurns.length }}
              </span>
            </button>
            <button
              class="left-tab-btn"
              :class="{
                active: leftActiveTab === 'state',
                disabled: totalDraftChapters === 0,
              }"
              :disabled="totalDraftChapters === 0"
              type="button"
              :title="totalDraftChapters === 0 ? '未解锁：需先在步骤三起草正文' : '故事状态追踪表（等级、装备、伏笔与要点）'"
              @click="handleWorkflowToggleStateLedger"
            >
              <Shield :size="14" />
              状态表
              <span v-if="storyStateStore.ledger.characters.length > 0 && totalDraftChapters > 0" class="left-tab-badge">
                {{ storyStateStore.ledger.characters.length }}
              </span>
            </button>
          </div>

        <!-- Tab Content 1: 素材来源 -->
        <div v-show="leftActiveTab === 'source'" class="panel-inner space-y-6 pt-4">
          <!-- Source Status -->
          <section v-if="selectedSessionSources.length > 0" class="space-y-3">
            <div class="status-card">
              <div class="selected-tags">
                <span
                  v-for="mat in selectedSessionSources"
                  :key="mat.id"
                  class="mat-chip"
                  title="点击取消勾选"
                  @click="toggleSessionSource(mat.id)"
                >
                  <Check :size="12" class="mr-1 inline" />
                  {{ mat.title }}
                  <X
                    :size="11"
                    class="ml-1 inline hover:text-red-500"
                    @click.stop="removeSessionSource(mat.id)"
                  />
                </span>
              </div>
            </div>
          </section>

          <!-- Add Source Form (临时素材，用完即扔，解耦) -->
          <section class="space-y-3">
            <label class="block-label" for="add-source-input">添加素材</label>
            <div class="relative">
              <textarea
                id="add-source-input"
                v-model="newSourceText"
                class="form-textarea"
                placeholder="粘贴更多临时素材（故事、笔记、观点）..."
                rows="5"
              />
            </div>
          </section>

          <!-- Actions -->
          <section class="pt-1 flex items-center space-x-3">
            <button
              class="btn-primary flex items-center gap-1.5"
              type="button"
              @click="addSourceMaterial"
            >
              <Plus :size="16" />
              添加
            </button>
          </section>

          <!-- Subtext Instruction -->
          <p class="subtext-note">
            粘贴更多素材（故事、笔记、观点），它会与原素材合并成“源素材”，在下一次生成与检查时使用。
          </p>
        </div>

        <!-- Tab Content 2: 文稿列表（固定 5:5 分区：上=文件夹+文稿，下=固定说明面板） -->
        <div v-show="leftActiveTab === 'drafts'" class="drafts-panel">
          <!-- 上方 5/5：文件夹 + 文稿列表（可独立滚动，增删文件夹不会挤压下方面板） -->
          <div class="drafts-scroll-zone">
            <div class="flex items-center justify-between pb-1 border-b border-border/40">
              <span class="text-xs font-semibold text-muted-foreground">
                文稿 · 仅正文文本（{{ aiTurns.length }}）
              </span>
              <button
                class="new-folder-btn"
                type="button"
                title="新建文件夹"
                aria-label="新建文件夹"
                @click="createDraftFolder"
              >
                <FolderPlus :size="14" />
              </button>
            </div>

            <!-- 文件夹块（头部行 + 内部文稿）+ 未分类区：与文档左栏同一套结构。
                 整个文件夹块都是投放区（data-folder-id 挂在块容器上），
                 文稿卡片直接嵌在文件夹内部，折叠时随文件夹一起收起。 -->
            <div
              v-if="aiTurns.length > 0 || autoStore.draftFolders.length > 0"
              class="drafts-tree"
            >
              <div
                v-for="folder in autoStore.draftFolders"
                :key="folder.id"
                class="draft-folder-block"
                :data-folder-id="folder.id"
                :class="{ 'drag-over': dragOverFolderId === folder.id }"
              >
                <div class="draft-folder-row">
                  <button
                    class="draft-folder-caret"
                    type="button"
                    :title="isFolderCollapsed(folder.id) ? '展开文件夹' : '收起文件夹'"
                    @click.stop="toggleFolderCollapse(folder.id)"
                  >
                    <ChevronDown
                      v-if="!isFolderCollapsed(folder.id)"
                      :size="12"
                      :stroke-width="2.2"
                    />
                    <ChevronRight v-else :size="12" :stroke-width="2.2" />
                  </button>
                  <Folder :size="13" class="draft-folder-icon" />
                  <template v-if="renamingFolderId === folder.id">
                    <input
                      ref="folderRenameInputEl"
                      v-model="draftFolderRename"
                      class="draft-folder-rename-input"
                      type="text"
                      @keydown.enter.prevent="commitFolderRename(folder.id)"
                      @keydown.esc="cancelFolderRename"
                      @blur="commitFolderRename(folder.id)"
                      @click.stop
                    />
                  </template>
                  <span
                    v-else
                    class="draft-folder-name"
                    :title="`「${folder.name}」双击重命名 · 整个文件夹区域都是投放区`"
                    @dblclick.stop="startFolderRename(folder)"
                  >
                    {{ folder.name }}
                  </span>
                  <span class="draft-folder-count">
                    {{ turnsInFolder(folder.id).length }}
                  </span>
                  <button
                    class="draft-item-del"
                    title="删除文件夹（其中文稿回到未分类）"
                    type="button"
                    @click.stop="deleteDraftFolder(folder.id)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>

                <div
                  v-if="!isFolderCollapsed(folder.id) && turnsInFolder(folder.id).length > 0"
                  class="draft-folder-children"
                >
                  <div
                    v-for="turn in [...turnsInFolder(folder.id)].reverse()"
                    :key="turn.id"
                    class="draft-item"
                    :class="{
                      active: selectedHistoryId === turn.id,
                      'is-dragging': draggingTurnId === turn.id,
                    }"
                    :title="`长按拖拽到文件夹归类 · 点击定位：${turnLabel(turn)}`"
                    @mousedown="beginTurnDrag($event, turn)"
                    @click="restoreHistory(turn)"
                  >
                    <div class="draft-item-header">
                      <GripVertical
                        :size="11"
                        class="draft-item-grip"
                      />
                      <span class="draft-item-title">{{ turnLabel(turn) }}</span>
                      <span class="draft-item-time">{{ turn.timestamp }}</span>
                    </div>
                    <p class="draft-item-preview">
                      {{ turn.content.slice(0, 75).trim() }}...
                    </p>
                    <div class="draft-item-footer">
                      <span class="draft-item-chars">{{ turn.content.trim().length }} 字</span>
                      <button
                        class="draft-item-del"
                        title="删除此文稿版本"
                        type="button"
                        @click.stop="deleteHistory(turn)"
                      >
                        <Trash2 :size="12" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 未分类：同样整块可投放，文稿移出文件夹即回到这里。 -->
              <div class="draft-root-section" :class="{ 'drag-over': draggingOverRoot }">
                <div class="draft-folder-row">
                  <span class="draft-folder-caret-spacer"></span>
                  <FileText :size="13" class="draft-folder-icon" />
                  <span class="draft-folder-name">未分类</span>
                  <span class="draft-folder-count">
                    {{ turnsInFolder(null).length }}
                  </span>
                </div>
                <div
                  v-if="turnsInFolder(null).length > 0"
                  class="draft-folder-children"
                >
                  <div
                    v-for="turn in [...turnsInFolder(null)].reverse()"
                    :key="turn.id"
                    class="draft-item"
                    :class="{
                      active: selectedHistoryId === turn.id,
                      'is-dragging': draggingTurnId === turn.id,
                    }"
                    :title="`长按拖拽到文件夹归类 · 点击定位：${turnLabel(turn)}`"
                    @mousedown="beginTurnDrag($event, turn)"
                    @click="restoreHistory(turn)"
                  >
                    <div class="draft-item-header">
                      <GripVertical
                        :size="11"
                        class="draft-item-grip"
                      />
                      <span class="draft-item-title">{{ turnLabel(turn) }}</span>
                      <span class="draft-item-time">{{ turn.timestamp }}</span>
                    </div>
                    <p class="draft-item-preview">
                      {{ turn.content.slice(0, 75).trim() }}...
                    </p>
                    <div class="draft-item-footer">
                      <span class="draft-item-chars">{{ turn.content.trim().length }} 字</span>
                      <button
                        class="draft-item-del"
                        title="删除此文稿版本"
                        type="button"
                        @click.stop="deleteHistory(turn)"
                      >
                        <Trash2 :size="12" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div
              v-if="aiTurns.length === 0 && autoStore.draftFolders.length === 0"
              class="drafts-list-empty-hint"
            >
              尚未生成过文稿
            </div>

            <!-- 过往创作：每一轮「新建创作」独立归档并持久保存 -->
            <div v-if="autoStore.autoSessions.length > 0" class="drafts-archives">
              <div class="drafts-archives-head">
                <History :size="12" :stroke-width="2" />
                过往创作（{{ autoStore.autoSessions.length }}）
              </div>
              <div
                v-for="arch in autoStore.autoSessions"
                :key="arch.id"
                class="draft-archive-item"
              >
                <div class="draft-archive-main">
                  <span class="draft-archive-title">{{ arch.title }}</span>
                  <span class="draft-archive-meta">
                    {{ arch.turns.length }} 条产出
                    <template v-if="arch.topicContent">
                      · {{ arch.topicContent.slice(0, 12) }}
                    </template>
                  </span>
                </div>
                <div class="draft-archive-actions">
                  <button
                    class="draft-archive-restore"
                    type="button"
                    title="载入该轮创作的全部内容"
                    @click="restoreSession(arch)"
                  >
                    载入
                  </button>
                  <button
                    class="draft-item-del"
                    type="button"
                    title="删除该轮归档"
                    @click.stop="deleteSessionArchive(arch.id)"
                  >
                    <Trash2 :size="12" />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- 紧凑底部说明条：一行放完，不占用文稿列表空间 -->
          <div class="drafts-foot-panel">
            <div class="drafts-foot-note">
              <History :size="13" class="drafts-foot-icon" />
              <template v-if="aiTurns.length === 0">
                <span class="drafts-foot-hint">暂无历史文稿</span>
              </template>
              <template v-else>
                <span class="drafts-foot-hint">
                  长按文稿卡片拖拽归类 · 完整上下文对话请查看
                </span>
              </template>
            </div>
            <button
              class="drafts-foot-history-btn"
              type="button"
              title="查看全部上下文对话"
              @click="goToHistoryPage"
            >
              <History :size="12" />
              历史对话
            </button>
          </div>
        </div>

        <!-- Tab Content 3: 故事状态追踪表（等级、装备、伏笔、要点独立分存） -->
        <div v-show="leftActiveTab === 'state'" class="flex-1 min-h-0 flex flex-col overflow-hidden -mx-3.5 -mb-5 mt-2">
          <AutoStoryStateTracker
            :current-doc-title="turnLabel(aiMessage)"
            :current-doc-content="aiMessage.content"
          />
        </div>
      </aside>

      <!-- 左栏拖拽分隔线（双击复位默认宽度） -->
      <div
        class="panel-resizer"
        :class="{ dragging: resizingSide === 'left' }"
        title="拖拽调整左栏宽度（双击恢复默认）"
        @mousedown="startPanelResize('left', $event)"
        @dblclick="resetPanelWidth('left')"
      ></div>

      <!-- 对话目录条：默认窄条短横显示，鼠标光标靠近时悬浮展开 -->
      <nav
        v-if="tocItems.length > 0"
        class="auto-toc-rail"
        aria-label="对话目录"
      >
        <!-- 默认短横条：极窄占用空间，锁在当前位置 -->
        <div class="auto-toc-dash-track">
          <button
            v-for="item in tocItems"
            :key="item.id"
            class="auto-toc-dash-item"
            :class="{ active: activeTocId === item.id }"
            type="button"
            :title="item.title"
            @click="tocJump(item)"
          >
            <span class="auto-toc-dash-bar"></span>
          </button>
        </div>

        <!-- 鼠标光标靠近/悬停时展开的卡片弹窗面板 -->
        <div class="auto-toc-popover">
          <div class="auto-toc-popover-list">
            <button
              v-for="item in tocItems"
              :key="item.id"
              class="auto-toc-popover-item"
              :class="{ active: activeTocId === item.id }"
              type="button"
              :title="item.title"
              @click="tocJump(item)"
            >
              <span class="auto-toc-popover-text">{{ item.title }}</span>
              <span class="auto-toc-popover-dash"></span>
            </button>
          </div>
        </div>
      </nav>

      <!-- Middle Editor Area: Setup Form at Start, AI Reply Zone on Output -->
      <div class="middle-editor-wrapper">
        <!-- 查找与替换悬浮卡片 (快捷键: Ctrl+F 查找 / Ctrl+H 替换 / Esc 关闭) -->
        <transition name="fade-slide">
          <div
            v-if="findPanelOpen"
            class="find-replace-panel"
            role="region"
            aria-label="查找与替换面板"
          >
            <!-- 查找行 -->
            <div class="find-row">
              <div class="find-input-box">
                <svg
                  class="find-icon"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  ref="findInputRef"
                  v-model="findQuery"
                  class="find-replace-input"
                  type="text"
                  placeholder="查找内容 (Enter 下一个，Shift+Enter 上一个)..."
                  @input="updateFindMatches"
                  @keydown.enter.exact.prevent="findNext"
                  @keydown.shift.enter.prevent="findPrev"
                  @keydown.esc.prevent="closeFindPanel"
                />
                <span class="find-counter-badge">
                  {{
                    findQuery
                      ? findMatches.length > 0
                        ? `${findMatchIndex + 1} / ${findMatches.length}`
                        : "无结果"
                      : ""
                  }}
                </span>
              </div>

              <!-- 控制按钮组 -->
              <div class="find-actions-group">
                <button
                  class="find-mini-btn"
                  type="button"
                  :disabled="findMatches.length === 0"
                  title="上一个 (Shift+Enter)"
                  @click="findPrev"
                >
                  <ArrowUp :size="12" :stroke-width="2.2" />
                </button>
                <button
                  class="find-mini-btn"
                  type="button"
                  :disabled="findMatches.length === 0"
                  title="下一个 (Enter)"
                  @click="findNext"
                >
                  <ArrowDown :size="12" :stroke-width="2.2" />
                </button>
                <button
                  class="find-mini-btn toggle"
                  :class="{ active: findCaseSensitive }"
                  type="button"
                  title="区分大小写"
                  @click="
                    findCaseSensitive = !findCaseSensitive;
                    updateFindMatches();
                  "
                >
                  <span class="font-mono text-[11px] font-bold">Aa</span>
                </button>
                <button
                  class="find-mini-btn toggle"
                  :class="{ active: findMatchWholeWord }"
                  type="button"
                  title="全词匹配"
                  @click="
                    findMatchWholeWord = !findMatchWholeWord;
                    updateFindMatches();
                  "
                >
                  <span class="font-mono text-[10px] font-bold">\b</span>
                </button>
                <button
                  class="find-mini-btn toggle"
                  :class="{ active: findShowReplace }"
                  type="button"
                  :title="findShowReplace ? '收起替换行 (Ctrl+H)' : '展开替换行 (Ctrl+H)'"
                  @click="toggleFindReplaceRow"
                >
                  <Pencil :size="12" :stroke-width="2" />
                </button>
                <button
                  class="find-mini-btn close"
                  type="button"
                  title="关闭 (Esc)"
                  @click="closeFindPanel"
                >
                  <X :size="12" :stroke-width="2.2" />
                </button>
              </div>
            </div>

            <!-- 替换行 -->
            <div v-show="findShowReplace" class="replace-row">
              <div class="find-input-box">
                <svg
                  class="find-icon"
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                <input
                  ref="replaceInputRef"
                  v-model="replaceQuery"
                  class="find-replace-input"
                  type="text"
                  placeholder="替换为..."
                  @keydown.enter.exact.prevent="executeFindReplace"
                  @keydown.esc.prevent="closeFindPanel"
                />
              </div>
              <div class="replace-buttons-group">
                <button
                  class="replace-action-btn"
                  type="button"
                  :disabled="findMatches.length === 0"
                  title="替换当前项 (快捷键: Alt+R)"
                  @click="executeFindReplace"
                >
                  替换
                </button>
                <button
                  class="replace-action-btn primary"
                  type="button"
                  :disabled="findMatches.length === 0"
                  title="全部替换 (快捷键: Alt+A)"
                  @click="executeFindReplaceAll"
                >
                  全部替换
                </button>
              </div>
            </div>
          </div>
        </transition>

        <!-- 顶部固定工具栏：下滑时透明度降低，停止时恢复正常 -->
        <div
          v-if="hasOutput || isGenerating"
          class="top-fixed-toolbar"
          :class="{ 'scrolling-dimmed': isMiddleScrollingDown }"
        >
          <div class="reply-badge">
            <BrainCircuit :size="15" class="badge-icon" />
            <span class="badge-model" :title="activeAgentModel">{{ activeAgentModel || "AI模型" }}</span>
            <span class="badge-mode">
              {{
                writingMode === "chat"
                  ? "对话探讨"
                  : writingMode === "auditor"
                  ? "审核意见"
                  : writingMode === "reader"
                  ? "读者视角"
                  : "AI深度写作"
              }}
            </span>
          </div>

          <div class="message-actions">
            <!-- 线性/翻页 对话布局切换按钮：位于“内容上色”左侧 -->
            <button
              class="chat-layout-toggle-btn"
              :class="{ active: chatLayoutMode === 'paged' }"
              type="button"
              :title="chatLayoutMode === 'linear' ? '当前为线性接续布局，点击切换为左右翻页布局' : '当前为左右翻页布局，点击切换为线性接续布局'"
              @click="toggleChatLayoutMode"
            >
              <BookOpen v-if="chatLayoutMode === 'paged'" :size="12" :stroke-width="1.9" />
              <FileText v-else :size="12" :stroke-width="1.9" />
              <span>{{ chatLayoutMode === 'paged' ? '翻页' : '线性' }}</span>
            </button>

            <!-- 内容上色开关：与文档界面同一个全局开关（contentColoringOn），
                 两处任意一侧切换都同步生效。 -->
            <button
              class="color-toggle"
              :class="{ active: contentColoringOn }"
              type="button"
              title="开启后按 标题 / 粗体 / 引用块 / 引号 / 括号 / 标点 / 特殊标记 / 字母 / 数字 给正文配色，只改文字颜色、不影响背景"
              @click="toggleContentColoring"
            >
              <Palette :size="11" :stroke-width="1.9" />
              内容上色
            </button>

            <!-- 新建空白：在内容上色右侧醒目呈现 -->
            <button
              class="top-blank-btn"
              type="button"
              title="新建空白：创建一个空白的 WYSIWYG 编辑区，由用户自行输入或粘贴文本内容，完成后正常进入文稿面板中"
              @click="createBlankDoc"
            >
              <FilePlus :size="12" :stroke-width="2" />
              <span>新建空白</span>
            </button>

            <!-- 新建创作：调换至历史对话前面，与新建空白醒目呈现 -->
            <button
              class="top-new-creation-btn"
              type="button"
              title="新建创作：归档当前轮次，开始新一轮独立 AI 编排（历史都会保存）"
              :disabled="isGenerating"
              @click="startNewCreation"
            >
              <Sparkles :size="12" :stroke-width="2" />
              <span>新建创作</span>
            </button>

            <!-- 历史对话 -->
            <button
              class="top-history-btn"
              type="button"
              title="历史对话（查看全部上下文对话记录）"
              @click="goToHistoryPage"
            >
              <History :size="13" :stroke-width="1.9" />
              <span>历史对话</span>
            </button>

            <button
              class="mini-icon-btn danger"
              title="清空并重置为空白"
              @click="clearOutput"
            >
              <Trash2 :size="14" :stroke-width="1.8" />
            </button>
          </div>
        </div>

        <main
          ref="middleEditorRef"
          class="middle-editor"
          @scroll="handleMiddleScroll"
          @wheel="onMiddleWheel"
          @touchstart.passive="onMiddleTouchStart"
          @touchmove.passive="onMiddleTouchMove"
          @mouseup="handleTextSelection"
        >
        <!-- 无正文且非写作类模式：保持纯留白 -->
        <div
          v-if="!hasOutput && !isGenerating && !showWritingForm"
          class="blank-middle-canvas"
        />

        <!-- 无正文时的创作设定表单：开始处理后自动消退，让位给思考链与正文 -->
        <div
          v-else-if="!hasOutput && !isGenerating"
          class="setup-panel"
        >
          <div class="setup-container">
            <div class="setup-head">
              <div class="setup-title-wrap">
                <Wand2 :size="16" class="setup-icon" />
                <span class="setup-title">创作设定</span>
                <span v-if="setupSelectedCount > 0" class="setup-count">
                  已选 {{ setupSelectedCount }} 项
                </span>
              </div>
              <div class="setup-head-actions">
                <button
                  v-if="setupSelectedCount > 0"
                  class="setup-reset-btn"
                  type="button"
                  @click="resetSetup"
                >
                  <X :size="12" />
                  清空设定
                </button>
                <button
                  class="setup-blank-btn"
                  type="button"
                  title="创建一个完全空白的 WYSIWYG 编辑区，自由输入或粘贴文稿，直接进入文稿管理"
                  @click="createBlankDoc"
                >
                  <FilePlus :size="13" />
                  新建空白
                </button>
                <button
                  class="setup-new-btn"
                  type="button"
                  title="归档当前这一轮创作，立刻开始新一轮独立编排（历史都会保存）"
                  @click="startNewCreation"
                >
                  <Sparkles :size="13" />
                  新建创作
                </button>
                <button
                  class="setup-history-btn"
                  type="button"
                  title="查看全部上下文对话记录"
                  @click="goToHistoryPage"
                >
                  <History :size="13" />
                  历史对话
                </button>
              </div>
            </div>
            <p class="setup-hint">
              选定后将与右侧「大纲或灵感」一并发送给 AI；点击「开始处理」本表单自动隐藏，切换为思考链与正文输出。全部为可选项，留空即按 AI 自行判断。
            </p>
            <div class="setup-groups">
              <section class="setup-group full-width">
                <div class="setup-group-label">题材</div>
                <div class="setup-options">
                  <button
                    v-for="opt in GENRE_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupGenre === opt.id && !customSetupActive.genre }"
                    type="button"
                    @click="pickSetupPreset('genre', opt.id)"
                  >
                    <Check v-if="setupGenre === opt.id && !customSetupActive.genre" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                  <button
                    class="setup-opt custom-opt"
                    :class="{ active: customSetupActive.genre }"
                    type="button"
                    @click="toggleCustomSetup('genre')"
                  >
                    <Pencil :size="11" />
                    <span>自定义</span>
                  </button>
                </div>
                <div v-if="customSetupActive.genre" class="setup-custom-wrap">
                  <input
                    v-model="customSetupValues.genre"
                    class="setup-custom-input"
                    type="text"
                    placeholder="输入自定义题材，如：赛博仙侠、末日废土、无限流悬疑..."
                    @input="onCustomSetupInput('genre')"
                  />
                </div>
              </section>

              <section class="setup-group">
                <div class="setup-group-label">频道定位</div>
                <div class="setup-options">
                  <button
                    v-for="opt in CHANNEL_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupChannel === opt.id }"
                    type="button"
                    @click="pickSetup('channel', opt.id)"
                  >
                    <Check v-if="setupChannel === opt.id" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                </div>
              </section>

              <section class="setup-group">
                <div class="setup-group-label">叙事人称</div>
                <div class="setup-options">
                  <button
                    v-for="opt in PERSON_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupPerson === opt.id }"
                    type="button"
                    @click="pickSetup('person', opt.id)"
                  >
                    <Check v-if="setupPerson === opt.id" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                </div>
              </section>

              <section class="setup-group full-width">
                <div class="setup-group-label">整体基调</div>
                <div class="setup-options">
                  <button
                    v-for="opt in TONE_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupTone === opt.id && !customSetupActive.tone }"
                    type="button"
                    @click="pickSetupPreset('tone', opt.id)"
                  >
                    <Check v-if="setupTone === opt.id && !customSetupActive.tone" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                  <button
                    class="setup-opt custom-opt"
                    :class="{ active: customSetupActive.tone }"
                    type="button"
                    @click="toggleCustomSetup('tone')"
                  >
                    <Pencil :size="11" />
                    <span>自定义</span>
                  </button>
                </div>
                <div v-if="customSetupActive.tone" class="setup-custom-wrap">
                  <input
                    v-model="customSetupValues.tone"
                    class="setup-custom-input"
                    type="text"
                    placeholder="输入自定义基调，如：荒诞怪异、克制冷峻、黑色幽默..."
                    @input="onCustomSetupInput('tone')"
                  />
                </div>
              </section>

              <section class="setup-group">
                <div class="setup-group-label">叙事时态</div>
                <div class="setup-options">
                  <button
                    v-for="opt in TENSE_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupTense === opt.id }"
                    type="button"
                    @click="pickSetup('tense', opt.id)"
                  >
                    <Check v-if="setupTense === opt.id" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                </div>
              </section>

              <section class="setup-group">
                <div class="setup-group-label">叙事节奏</div>
                <div class="setup-options">
                  <button
                    v-for="opt in PACE_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupPace === opt.id && !customSetupActive.pace }"
                    type="button"
                    @click="pickSetupPreset('pace', opt.id)"
                  >
                    <Check v-if="setupPace === opt.id && !customSetupActive.pace" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                  <button
                    class="setup-opt custom-opt"
                    :class="{ active: customSetupActive.pace }"
                    type="button"
                    @click="toggleCustomSetup('pace')"
                  >
                    <Pencil :size="11" />
                    <span>自定义</span>
                  </button>
                </div>
                <div v-if="customSetupActive.pace" class="setup-custom-wrap">
                  <input
                    v-model="customSetupValues.pace"
                    class="setup-custom-input"
                    type="text"
                    placeholder="输入自定义节奏，如：层层紧逼、电影级快切..."
                    @input="onCustomSetupInput('pace')"
                  />
                </div>
              </section>

              <section class="setup-group">
                <div class="setup-group-label">核心冲突</div>
                <div class="setup-options">
                  <button
                    v-for="opt in CONFLICT_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupConflict === opt.id && !customSetupActive.conflict }"
                    type="button"
                    @click="pickSetupPreset('conflict', opt.id)"
                  >
                    <Check v-if="setupConflict === opt.id && !customSetupActive.conflict" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                  <button
                    class="setup-opt custom-opt"
                    :class="{ active: customSetupActive.conflict }"
                    type="button"
                    @click="toggleCustomSetup('conflict')"
                  >
                    <Pencil :size="11" />
                    <span>自定义</span>
                  </button>
                </div>
                <div v-if="customSetupActive.conflict" class="setup-custom-wrap">
                  <input
                    v-model="customSetupValues.conflict"
                    class="setup-custom-input"
                    type="text"
                    placeholder="输入自定义核心冲突，如：阶层割裂与个人救赎..."
                    @input="onCustomSetupInput('conflict')"
                  />
                </div>
              </section>

              <section class="setup-group">
                <div class="setup-group-label">侧重重心</div>
                <div class="setup-options">
                  <button
                    v-for="opt in FOCUS_OPTIONS"
                    :key="opt.id"
                    class="setup-opt"
                    :class="{ active: setupFocus === opt.id && !customSetupActive.focus }"
                    type="button"
                    @click="pickSetupPreset('focus', opt.id)"
                  >
                    <Check v-if="setupFocus === opt.id && !customSetupActive.focus" :size="12" class="check-icon" />
                    {{ opt.label }}
                  </button>
                  <button
                    class="setup-opt custom-opt"
                    :class="{ active: customSetupActive.focus }"
                    type="button"
                    @click="toggleCustomSetup('focus')"
                  >
                    <Pencil :size="11" />
                    <span>自定义</span>
                  </button>
                </div>
                <div v-if="customSetupActive.focus" class="setup-custom-wrap">
                  <input
                    v-model="customSetupValues.focus"
                    class="setup-custom-input"
                    type="text"
                    placeholder="输入自定义侧重重心，如：群像心理博弈、细节沉浸..."
                    @input="onCustomSetupInput('focus')"
                  />
                </div>
              </section>
            </div>
          </div>
        </div>
        <!-- When output is generated or streaming, show the full-featured assistant reply card -->
        <article v-else class="reply-card">
          <!-- 选中正文的悬浮精修面板：跟随选中文字的视口位置浮在选区上方，
             不再是固定在卡片顶部的横条。
             Teleport 到 body：拖选文字期间挂载 / 移动面板不会改动编辑区
             所在子树，避免浏览器把进行中的选区冲掉（与文档界面选中工具栏同款做法）。 -->
          <Teleport to="body">
          <div
            v-if="!customContextMenu.visible && (selectedText || activeRefineAction)"
            ref="floatingRefinePanelEl"
            class="floating-refine-panel"
            :style="refinePanelStyle"
            @mouseup.stop
          >
            <div class="top-refine-toolbar">
              <div class="toolbar-title-hint">
                <Wand2 :size="13" class="wand-icon" />
                <span>选中正文定位</span>
              </div>
              <div class="refine-action-buttons">
                <button
                  class="refine-tag-btn"
                  :class="{ active: activeRefineAction === '修订' }"
                  type="button"
                  @mousedown.prevent.stop
                  @click="openRefinePrompt('修订')"
                >
                  修订
                </button>
                <button
                  class="refine-tag-btn"
                  :class="{ active: activeRefineAction === '较短' }"
                  type="button"
                  @mousedown.prevent.stop
                  @click="openRefinePrompt('较短')"
                >
                  较短
                </button>
                <button
                  class="refine-tag-btn"
                  :class="{ active: activeRefineAction === '少说破' }"
                  type="button"
                  @mousedown.prevent.stop
                  @click="openRefinePrompt('少说破')"
                >
                  少说破
                </button>
                <button
                  class="refine-tag-btn"
                  :class="{ active: activeRefineAction === '更自然' }"
                  type="button"
                  @mousedown.prevent.stop
                  @click="openRefinePrompt('更自然')"
                >
                  更自然
                </button>
                <button
                  class="refine-tag-btn"
                  :class="{ active: activeRefineAction === '更具沉浸感' }"
                  type="button"
                  @mousedown.prevent.stop
                  @click="openRefinePrompt('更具沉浸感')"
                >
                  更具沉浸感
                </button>
              </div>
            </div>

            <!-- Inline Prompt Input Box on Action Click -->
            <div v-if="activeRefineAction" class="refine-input-card">
              <div class="refine-card-head">
                <span class="refine-mode-label">正在改写：{{ activeRefineAction }}</span>
                <span class="selected-text-preview" :title="selectedText">
                  "{{ selectedText.slice(0, 30) }}{{ selectedText.length > 30 ? '...' : '' }}"
                </span>
              </div>
              <textarea
                v-model="refineUserInstruction"
                class="refine-prompt-textarea"
                placeholder="补充自定义修改要求 (可留空，直接点击生成)..."
                rows="2"
              />
              <div class="refine-card-actions">
                <button
                  class="btn-primary-sm"
                  :disabled="isRefiningParagraph"
                  type="button"
                  @mousedown.prevent
                  @click="executeParagraphRefinement"
                >
                  <Sparkles v-if="!isRefiningParagraph" :size="13" />
                  <span>{{ isRefiningParagraph ? "生成中..." : "生成" }}</span>
                </button>
                <button
                  class="btn-secondary-sm"
                  type="button"
                  @mousedown.prevent
                  @click="cancelRefinePrompt"
                >
                  取消
                </button>
              </div>
            </div>
          </div>
          </Teleport>

          <!-- Floating Inline Refine Diff Card: 类似 Cursor / Copilot 就近锚定在选中段落旁展示对比与接受/拒绝，支持自由拖拽 -->
          <Teleport to="body">
            <div
              v-if="activeRefineDiff"
              class="floating-refine-diff-card"
              :class="{ 'is-user-dragged': refineDiffUserMoved }"
              :style="refineDiffStyle"
              @mousedown.stop
            >
              <div
                class="refine-diff-head is-draggable"
                title="按住鼠标左键可自由拖拽移动面板位置，避免遮挡正文"
                @mousedown="onRefineDiffDragStart"
              >
                <div class="refine-diff-title">
                  <GripVertical :size="13" class="refine-diff-drag-handle" />
                  <Sparkles :size="13" class="refine-diff-icon" />
                  <span class="refine-diff-action-tag">「{{ activeRefineDiff.action }}」建议</span>
                  <span class="refine-diff-tip">可按住标题拖拽 · Esc 拒绝 / Ctrl+Enter 接受</span>
                </div>
                <div class="refine-diff-actions" @mousedown.stop>
                  <button
                    v-if="refineDiffUserMoved"
                    class="refine-diff-btn reset-pos"
                    type="button"
                    title="重置面板到选区就近默认位置"
                    @click="resetRefineDiffPosition"
                  >
                    <RotateCcw :size="12" />
                    <span>复位</span>
                  </button>
                  <button
                    class="refine-diff-btn accept"
                    type="button"
                    title="接受修改并覆盖原文 (快捷键: Cmd/Ctrl + Enter)"
                    @click="acceptCurrentRefineDiff"
                  >
                    <Check :size="13" :stroke-width="2.2" />
                    <span>接受</span>
                  </button>
                  <button
                    class="refine-diff-btn reject"
                    type="button"
                    title="拒绝修改并保留原文 (快捷键: Esc)"
                    @click="rejectRefineDiff"
                  >
                    <X :size="13" :stroke-width="2.2" />
                    <span>拒绝</span>
                  </button>
                </div>
              </div>

              <div class="refine-diff-body">
                <div class="refine-diff-row original">
                  <div class="diff-tag-col">
                    <span class="diff-badge diff-del">原文</span>
                  </div>
                  <div class="diff-text-col diff-text-del">
                    {{ activeRefineDiff.originalText }}
                  </div>
                </div>
                <div class="diff-separator"></div>
                <div class="refine-diff-row suggested">
                  <div class="diff-tag-col">
                    <span class="diff-badge diff-add">改写</span>
                  </div>
                  <div class="diff-text-col diff-text-add">
                    {{ activeRefineDiff.refinedText }}
                  </div>
                </div>
              </div>
            </div>
          </Teleport>

          <!-- 自定义右键菜单：剪切、复制、粘贴、删除、全选 -->
          <Teleport to="body">
            <div
              v-if="customContextMenu.visible"
              class="custom-context-menu"
              :style="{ left: customContextMenu.x + 'px', top: customContextMenu.y + 'px' }"
              @mousedown.stop
              @contextmenu.prevent
            >
              <button
                class="context-menu-item"
                :class="{ disabled: !customContextMenu.hasSelection || !customContextMenu.canEdit }"
                :disabled="!customContextMenu.hasSelection || !customContextMenu.canEdit"
                type="button"
                @click="handleContextMenuCut"
              >
                <div class="menu-item-left">
                  <Scissors :size="13" class="menu-item-icon" />
                  <span>剪切</span>
                </div>
                <span class="menu-item-shortcut">Ctrl+X</span>
              </button>

              <button
                class="context-menu-item"
                :class="{ disabled: !customContextMenu.hasSelection }"
                :disabled="!customContextMenu.hasSelection"
                type="button"
                @click="handleContextMenuCopy"
              >
                <div class="menu-item-left">
                  <Copy :size="13" class="menu-item-icon" />
                  <span>复制</span>
                </div>
                <span class="menu-item-shortcut">Ctrl+C</span>
              </button>

              <button
                class="context-menu-item"
                :class="{ disabled: !customContextMenu.canEdit }"
                :disabled="!customContextMenu.canEdit"
                type="button"
                @click="handleContextMenuPaste"
              >
                <div class="menu-item-left">
                  <ClipboardPaste :size="13" class="menu-item-icon" />
                  <span>粘贴</span>
                </div>
                <span class="menu-item-shortcut">Ctrl+V</span>
              </button>

              <button
                class="context-menu-item danger-item"
                :class="{ disabled: !customContextMenu.hasSelection || !customContextMenu.canEdit }"
                :disabled="!customContextMenu.hasSelection || !customContextMenu.canEdit"
                type="button"
                @click="handleContextMenuDelete"
              >
                <div class="menu-item-left">
                  <Trash2 :size="13" class="menu-item-icon" />
                  <span>删除</span>
                </div>
                <span class="menu-item-shortcut">Del</span>
              </button>

              <button
                v-if="customContextMenu.hasSelection"
                ref="contextMenuFunctionBtnRef"
                class="context-menu-item items-has-sub"
                :class="{ disabled: !customContextMenu.canEdit }"
                :disabled="!customContextMenu.canEdit"
                type="button"
                title="对选中文字执行智能文本处理"
                @mouseenter="!contextMenuFnOpen && toggleContextFunctionSubmenu()"
                @click="toggleContextFunctionSubmenu"
              >
                <div class="menu-item-left">
                  <Wand2 :size="13" class="menu-item-icon" />
                  <span>功能</span>
                </div>
                <span class="menu-item-sub-arrow">
                  <ChevronRight :size="12" :stroke-width="2.2" />
                </span>
              </button>

              <div class="context-menu-divider"></div>

              <button
                class="context-menu-item"
                type="button"
                @click="handleContextMenuSelectAll"
              >
                <div class="menu-item-left">
                  <CheckSquare :size="13" class="menu-item-icon" />
                  <span>全选</span>
                </div>
                <span class="menu-item-shortcut">Ctrl+A</span>
              </button>
            </div>
          </Teleport>

          <!-- 右键菜单「功能」二级菜单：智能文本处理（样式同右键菜单，功能同文档选中工具栏） -->
          <Teleport to="body">
            <div
              v-if="customContextMenu.visible && contextMenuFnOpen"
              class="context-menu-submenu"
              :style="{ left: contextMenuFnPos.x + 'px', top: contextMenuFnPos.y + 'px' }"
              @mousedown.stop
              @contextmenu.prevent
            >
              <div class="context-menu-submenu-head">文本功能</div>
              <button
                class="context-menu-item"
                type="button"
                title="智能交换选中文字中：中文、英文（整词或字母）与标点的彼此位置"
                @click="runContextFunction(smartSwapTransform)"
              >
                <div class="menu-item-left">
                  <ArrowRightLeft :size="13" class="menu-item-icon" />
                  <span>智能交换</span>
                </div>
              </button>
              <button
                class="context-menu-item"
                type="button"
                title="英文大小写整体切换（全大写 ⇄ 小写）"
                @click="runContextFunction(smartEnglishCaseTransform)"
              >
                <div class="menu-item-left">
                  <span class="menu-item-glyph caps">Aa</span>
                  <span>英文大小写</span>
                </div>
              </button>
              <button
                class="context-menu-item"
                type="button"
                title="英文单词首字母大小写切换（首字母大写 ⇄ 小写）"
                @click="runContextFunction(smartWordCapitalsTransform)"
              >
                <div class="menu-item-left">
                  <span class="menu-item-glyph">Aa</span>
                  <span>首字母大小写</span>
                </div>
              </button>
              <button
                class="context-menu-item"
                type="button"
                title="智能引号替换：把半角直引号替换为成对弯引号（中文/英文双引号）"
                @click="runContextFunction(smartQuotesTransform)"
              >
                <div class="menu-item-left">
                  <Quote :size="13" class="menu-item-icon" />
                  <span>智能引号</span>
                </div>
              </button>
              <button
                class="context-menu-item"
                type="button"
                title="智能空格：英文单词与相邻文字之间自动补空格，让中英文混排自然留白"
                @click="runContextFunction(smartSpacesTransform)"
              >
                <div class="menu-item-left">
                  <span class="menu-item-glyph">&nbsp;空&nbsp;</span>
                  <span>智能空格</span>
                </div>
              </button>
            </div>
          </Teleport>

          <!-- Normal Display Mode: 每条产出上方先呈现该轮真正发给 AI 的用户要求
               （与写作界面右侧 AI 写作的用户消息同款：标签 + 长线正文），
               让用户随时能回看自己之前发了什么，也便于 AI 上下文自洽。
               AI 回复正文一律以 WYSIWYG 原地编辑呈现，修改自动保存，
               不再需要逐条点开「编辑正文」按钮。 -->
          <div class="turn-list" :class="{ 'is-paged': chatLayoutMode === 'paged' }">
            <!-- 翻页模式专属顶部翻页导航栏：左右翻页控制与轮次状态 -->
            <div v-if="chatLayoutMode === 'paged'" class="paged-conversation-bar">
              <button
                class="paged-nav-btn prev"
                type="button"
                :disabled="activeRoundIndex <= 0"
                title="上一页 (快捷键: Alt+←)"
                @click="pagedGoPrev"
              >
                <ChevronLeft :size="13" :stroke-width="2.2" />
                <span>上一页</span>
              </button>

              <div class="paged-nav-center">
                <div class="paged-round-meta">
                  <span class="paged-round-badge">第 {{ activeRoundIndex + 1 }} / {{ totalRounds }} 轮</span>
                  <span
                    v-if="currentPagedGroup"
                    class="paged-round-summary"
                    :title="turnLabel(activeTurnOf(currentPagedGroup))"
                  >
                    {{ turnLabel(activeTurnOf(currentPagedGroup)) }}
                  </span>
                </div>

                <!-- 快捷轮次点击胶囊 -->
                <div v-if="totalRounds > 1" class="paged-pills-bar">
                  <button
                    v-for="(grp, gIdx) in turnGroups"
                    :key="grp.groupId"
                    class="paged-round-pill"
                    :class="{ active: gIdx === activeRoundIndex }"
                    type="button"
                    :title="`第 ${gIdx + 1} 轮 · ${turnLabel(activeTurnOf(grp))}`"
                    @click="pagedGoTo(gIdx)"
                  >
                    {{ gIdx + 1 }}
                  </button>
                </div>
              </div>

              <button
                class="paged-nav-btn next"
                type="button"
                :disabled="activeRoundIndex >= totalRounds - 1"
                title="下一页 (快捷键: Alt+→)"
                @click="pagedGoNext"
              >
                <span>下一页</span>
                <ChevronRight :size="13" :stroke-width="2.2" />
              </button>
            </div>

            <template v-for="group in renderedTurnGroups" :key="group.groupId">
              <template v-for="turn in [activeTurnOf(group)]" :key="turn.id">
              <!-- 用户消息气泡：该轮发给 AI 的完整要求 —— 大纲明文呈现，
                   其余选项（创作设定 / 故事定制 / 叙事定制 / 素材 / 任务参数）
                   以胶囊分组挂载，不整段明文铺开。 -->
              <div
                v-if="turn.prompt"
                :id="'auto-user-' + turn.id"
                class="auto-user-message"
              >
                <div class="auto-user-message-head">
                  <UserRound :size="12" :stroke-width="2" class="auto-user-message-icon" />
                  <span class="auto-user-message-label">用户 · 本轮要求</span>
                  <span class="auto-user-message-time">{{ turn.timestamp }}</span>
                </div>
                <template v-if="userMessageFor(turn).mainText || userMessageFor(turn).groups.length > 0">
                  <div
                    v-if="userMessageFor(turn).mainText"
                    class="auto-user-main-text"
                  >{{ userMessageFor(turn).mainText }}</div>
                  <div
                    v-if="userMessageFor(turn).groups.length > 0"
                    class="auto-user-groups"
                  >
                    <div
                      v-for="g in userMessageFor(turn).groups"
                      :key="g.title"
                      class="auto-user-group"
                    >
                      <span class="auto-user-group-label">{{ g.title }}</span>
                      <div class="auto-user-chips">
                        <span
                          v-for="(c, ci) in g.chips"
                          :key="ci"
                          class="auto-user-chip"
                          :title="c.desc || c.label"
                        >{{ c.label }}</span>
                      </div>
                    </div>
                  </div>
                </template>
                <div v-else class="auto-user-message-body">{{ turn.prompt }}</div>
              </div>
              <div
                :id="'auto-turn-' + turn.id"
                :data-turn-id="turn.id"
                :data-group-id="group.groupId"
                class="turn-card"
                :class="{ 'is-current': turn.id === aiMessage.id, 'is-selected': selectedHistoryId === turn.id }"
                @mouseenter="onTurnCardMouseEnter(turn.id)"
                @mouseleave="onTurnCardMouseLeave(turn.id)"
              >
              <!-- 条目头部：正文标题 + 该条产出专属的操作按钮 + 时间。
                   「应用到文档 / 复制全文 / 删除」每一条回复各有一份。 -->
              <div class="turn-head">
                <div class="turn-head-title-wrap">
                  <span class="turn-title" :title="turnLabel(turn)">
                    <Sparkles :size="12" :stroke-width="2" />
                    {{ turnLabel(turn) }}
                  </span>
                  <span
                    v-if="group.turns.length > 1"
                    class="turn-head-version-tag"
                    title="当前展示版本"
                  >
                    第 {{ getGroupActiveIndex(group) + 1 }} / {{ group.turns.length }} 版
                  </span>
                </div>
                <div class="turn-head-actions">
                  <button
                    v-if="turn.content"
                    class="mini-icon-btn"
                    title="应用到文档编辑区（自动新建文档写入）"
                    type="button"
                    @click="applyToDoc(turn)"
                  >
                    <FileText :size="13" :stroke-width="1.8" />
                  </button>
                  <button
                    v-if="turn.content"
                    class="mini-icon-btn"
                    title="复制全文"
                    type="button"
                    @click="copyMessageText(turn)"
                  >
                    <Copy :size="13" :stroke-width="1.8" />
                  </button>
                  <button
                    v-if="turn.content"
                    class="mini-icon-btn format-menu-trigger"
                    :class="{ active: formatMenuTurnId === turn.id }"
                    title="文本清理：一键排版 / 随机排版 / 一键去了字 / 一键去的地得"
                    type="button"
                    @mousedown.prevent
                    @click.stop="toggleFormatMenu(turn)"
                  >
                    <WrapText :size="13" :stroke-width="1.8" />
                  </button>
                  <button
                    v-if="turn.content"
                    class="mini-icon-btn typo-menu-trigger"
                    :class="{ active: typoPanelOpen && typoPanelTurnId === turn.id }"
                    title="排版与字体表单"
                    type="button"
                    @mousedown.prevent
                    @click.stop="toggleTypoPanel(turn)"
                  >
                    <Type :size="13" :stroke-width="1.8" />
                  </button>
                  <button
                    v-if="!isGenerating || turn.id !== aiMessage.id"
                    class="mini-icon-btn danger"
                    title="删除该条回复"
                    type="button"
                    @click="deleteTurn(turn)"
                  >
                    <Trash2 :size="13" :stroke-width="1.8" />
                  </button>
                  <span class="turn-time">{{ turn.timestamp }}</span>
                </div>

                <!-- 「一键排版」下拉面板：复刻文档顶部工具栏的文本清理面板，
                     作用于本条产出，功能机制与文档界面一致。 -->
                <div
                  v-if="formatMenuTurnId === turn.id"
                  class="auto-format-menu"
                  @mousedown.prevent.stop
                  @mouseup.stop
                >
                  <button
                    class="auto-format-item"
                    title="清除多余空行，让内容更紧凑"
                    type="button"
                    @click="autoReformatWhitespace(turn)"
                  >
                    <WrapText :size="14" :stroke-width="1.8" />
                    <span>一键排版</span>
                    <span class="auto-format-syntax">Ctrl+Shift+F</span>
                  </button>
                  <button
                    class="auto-format-item"
                    title="把「一句一行」的短句随机并成段落，长段落、对白与结构行保持不动"
                    type="button"
                    @click="autoRandomizeLayout(turn)"
                  >
                    <Dices :size="14" :stroke-width="1.8" />
                    <span>随机排版</span>
                    <span class="auto-format-syntax">随性换行</span>
                  </button>
                  <div class="auto-format-section rl-section">
                    <div class="rl-row">
                      <span class="rl-label">短句上限</span>
                      <input
                        v-model.number="aiSettings.layoutShortLineMax"
                        class="rl-slider"
                        type="range"
                        :min="SHORT_LINE_MIN_LIMIT"
                        :max="SHORT_LINE_MAX_LIMIT"
                        step="1"
                        :title="`超过 ${aiSettings.layoutShortLineMax} 字的行按独立段落对待，不参与合并（${SHORT_LINE_MIN_LIMIT} ~ ${SHORT_LINE_MAX_LIMIT} 字）`"
                        @mousedown.stop
                      />
                      <span class="rl-value">{{ aiSettings.layoutShortLineMax }} 字</span>
                    </div>
                    <div class="rl-row">
                      <span class="rl-label">每段最多</span>
                      <input
                        v-model.number="aiSettings.layoutMaxMergedLines"
                        class="rl-slider"
                        type="range"
                        :min="MERGE_MIN_LIMIT"
                        :max="MERGE_MAX_LIMIT"
                        step="1"
                        :title="`一段最多并入 ${aiSettings.layoutMaxMergedLines} 行短句（${MERGE_MIN_LIMIT} ~ ${MERGE_MAX_LIMIT} 行）`"
                        @mousedown.stop
                      />
                      <span class="rl-value">{{ aiSettings.layoutMaxMergedLines }} 行</span>
                    </div>
                  </div>
                  <div class="auto-format-divider" />
                  <div class="auto-format-section">
                    <div class="auto-format-section-head">
                      <span>清理模式</span>
                    </div>
                    <div class="mode-switch">
                      <button
                        class="mode-seg"
                        :class="{ on: cleanupMode === 'smart' }"
                        title="逐字判断：词语内部、句末表变化、补语标记等必要用法一律保留"
                        type="button"
                        @click.stop="cleanupMode = 'smart'"
                      >
                        智能保留
                      </button>
                      <button
                        class="mode-seg"
                        :class="{ on: cleanupMode === 'all' }"
                        title="无差别删除（代码块与链接地址仍会跳过）"
                        type="button"
                        @click.stop="cleanupMode = 'all'"
                      >
                        全部删除
                      </button>
                    </div>
                    <div class="auto-format-section-tip">{{ formatCleanupModeTip }}</div>
                  </div>
                  <div class="auto-format-divider" />
                  <button
                    class="auto-format-item"
                    :title="
                      cleanupMode === 'smart'
                        ? '删除句中堆砌的完成体「了」，保留句末与词内的「了」'
                        : '删除正文中所有「了」'
                    "
                    type="button"
                    @click="autoCleanLeToken(turn)"
                  >
                    <Eraser :size="14" :stroke-width="1.8" />
                    <span>一键去了字</span>
                    <span class="auto-format-syntax">了</span>
                  </button>
                  <div class="auto-format-divider" />
                  <div class="auto-format-section">
                    <div class="auto-format-section-head">
                      <Eraser :size="14" :stroke-width="1.8" />
                      <span>一键去的地得</span>
                    </div>
                    <div class="auto-format-section-tip">勾选要清理的字，可只选其中一个</div>
                    <div class="de-pill-group">
                      <button
                        v-for="tk in DE_TOKENS"
                        :key="tk"
                        class="de-pill"
                        :class="{ on: selectedDeTokens.includes(tk) }"
                        :title="selectedDeTokens.includes(tk) ? `取消清理「${tk}」` : `勾选清理「${tk}」`"
                        type="button"
                        @click.stop="toggleDeToken(tk)"
                      >
                        {{ tk }}
                      </button>
                    </div>
                    <div
                      class="auto-format-section-tip tip-slot"
                      :class="{ warn: cleanupMode === 'smart' && selectedDeTokens.includes('得') }"
                    >
                      {{ formatDeTokenTip }}
                    </div>
                    <button
                      class="de-clean-btn"
                      :disabled="selectedDeTokens.length === 0"
                      :title="
                        selectedDeTokens.length === 0
                          ? '请先勾选要清理的字'
                          : `清理正文中冗余的「${selectedDeTokens.join('、')}」`
                      "
                      type="button"
                      @click="autoCleanDeTokens(turn)"
                    >
                      {{
                        selectedDeTokens.length === 0
                          ? '请先勾选要清理的字'
                          : `清理「${selectedDeTokens.join('、')}」`
                      }}
                    </button>
                  </div>
                </div>

                <!-- 「排版与字体」悬浮面板：复刻文档顶部工具栏的排版表单，
                     作用于与文档界面同一套 aiSettings 排版字段，两处 WYSIWYG 同步。
                     容器不 preventDefault：下拉框 / 数字输入需要原生交互，
                     与文档面板一致只 stop 冒泡。 -->
                <div
                  v-if="typoPanelOpen && typoPanelTurnId === turn.id"
                  class="auto-typo-panel"
                  @mousedown.stop
                  @mouseup.stop
                >
                  <div class="auto-typo-panel-header">
                    <span class="auto-typo-panel-title">排版与字体</span>
                    <button
                      class="auto-typo-reset-btn"
                      title="恢复默认设置"
                      type="button"
                      @click="resetTypographyDefaults"
                    >
                      <RotateCcw :size="12" :stroke-width="1.8" />
                      <span>恢复默认</span>
                    </button>
                  </div>

                  <div class="auto-typo-panel-form">
                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">字体</label>
                      <select
                        v-model="editorFont"
                        class="auto-typo-select"
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

                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">字号</label>
                      <select
                        v-model="editorFontSize"
                        class="auto-typo-select"
                        title="字号大小"
                        @change="setTypographyFontSize(Number(editorFontSize))"
                      >
                        <option v-for="size in EDITOR_FONT_SIZES" :key="size" :value="size">{{ size }}px</option>
                      </select>
                    </div>

                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">行间距</label>
                      <input
                        v-model.number="editorLineHeight"
                        type="number"
                        step="0.05"
                        min="1"
                        max="3"
                        class="auto-typo-input"
                        title="行间距（1.0 ~ 3.0）"
                      />
                    </div>

                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">水平边距</label>
                      <div class="auto-typo-input-wrap">
                        <input
                          v-model.number="editorMarginX"
                          type="number"
                          step="1"
                          min="0"
                          max="200"
                          class="auto-typo-input"
                          title="水平边距（px）"
                        />
                        <span class="auto-typo-unit">px</span>
                      </div>
                    </div>

                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">垂直边距</label>
                      <div class="auto-typo-input-wrap">
                        <input
                          v-model.number="editorMarginY"
                          type="number"
                          step="1"
                          min="0"
                          max="200"
                          class="auto-typo-input"
                          title="垂直边距（px）"
                        />
                        <span class="auto-typo-unit">px</span>
                      </div>
                    </div>

                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">网格线</label>
                      <select
                        v-model="editorGridLine"
                        class="auto-typo-select"
                        title="背景网格线"
                      >
                        <option value="none">无（默认）</option>
                        <option value="solid">横向实线</option>
                        <option value="dashed">横向虚线</option>
                        <option value="dotted">横向点线</option>
                      </select>
                    </div>

                    <div class="auto-typo-field-row">
                      <label class="auto-typo-field-label">段首样式</label>
                      <div
                        class="auto-typo-toggle-group"
                        role="group"
                        aria-label="段首样式"
                      >
                        <button
                          type="button"
                          class="auto-typo-toggle-btn"
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
                          class="auto-typo-toggle-btn"
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
              </div>

              <!-- 0. 知识项工具活动轨迹（模型读取知识项的过程记录） -->
              <div
                v-if="turn.tools && turn.tools.length > 0"
                class="tool-trace-list"
              >
                <span
                  v-for="(tr, i) in turn.tools"
                  :key="i"
                  class="tool-trace-chip"
                  :class="{ done: tr.done }"
                  :title="tr.detail || tr.label"
                >
                  <Check v-if="tr.done" :size="11" class="trace-check" />
                  <RefreshCw v-else :size="11" class="trace-spin" />
                  {{ tr.label }}
                </span>
              </div>

              <!-- 1. Thinking Chain / Reasoning Panel：按步分段展示，每步独立成卡，
                  便于用户清楚看到思考推进到哪一步、正在思考什么。 -->
              <div v-if="turn.reasoning" class="thinking-panel">
                <button
                  class="thinking-toggle"
                  type="button"
                  @click="reasoningExpanded = !reasoningExpanded"
                >
                  <ChevronRight v-if="!reasoningExpanded" :size="12" :stroke-width="2" />
                  <ChevronDown v-else :size="12" :stroke-width="2" />
                  <BrainCircuit :size="12" :stroke-width="2" />
                  <span
                    class="thinking-label"
                    :class="{ 'is-thinking': isGenerating && turn.id === aiMessage.id && !reasoningExpanded }"
                  >思考过程</span>
                  <span class="thinking-badge">
                    {{ reasoningExpanded ? "收起" : "展开" }}
                  </span>
                </button>
                <div v-if="reasoningExpanded" class="thinking-body think-steps">
                  <div
                    v-for="(step, i) in reasoningStepsFor(turn)"
                    :key="'s' + i"
                    class="think-step"
                    :class="{
                      'is-streaming':
                        isGenerating && turn.id === aiMessage.id && i === reasoningStepsFor(turn).length - 1,
                      collapsed: isThinkStepCollapsed(thinkStepKey(turn, i)),
                    }"
                  >
                    <div
                      class="think-step-head"
                      role="button"
                      tabindex="0"
                      :title="isThinkStepCollapsed(thinkStepKey(turn, i)) ? '展开本段思考' : '收起本段思考'"
                      @click="toggleThinkStep(thinkStepKey(turn, i))"
                      @keydown.enter.prevent="toggleThinkStep(thinkStepKey(turn, i))"
                    >
                      <ChevronRight :size="12" :stroke-width="2.2" class="think-step-arrow" />
                      <span class="think-step-name">{{ step.name }}</span>
                      <span
                        v-if="isGenerating && turn.id === aiMessage.id && i === reasoningStepsFor(turn).length - 1"
                        class="think-step-state thinking"
                        >思考中</span
                      >
                      <span v-else class="think-step-state done">已完成</span>
                    </div>
                    <div v-if="step.content && !isThinkStepCollapsed(thinkStepKey(turn, i))" class="think-step-content">
                      {{ step.content }}
                    </div>
                  </div>
                </div>
              </div>

              <!-- 2. Typing Indicator when starting with no text yet -->
              <div
                v-if="isGenerating && turn.id === aiMessage.id && !turn.content"
                class="typing-indicator-box"
              >
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>

              <!-- 3b. Rendered Body：AI 回复正文以所见即所得（WYSIWYG）直接呈现，
                   与「文档」界面 WYSIWYG 同一套块级引擎，点击正文即可原地修改，
                   输入 / 失焦时自动序列化回 Markdown 并同步保存（不再需要点「编辑正文」）。
                   审核意见 / 读者报告及雷达图卡片仍按原阅读渲染呈现。 -->
              <div v-if="turn.content || turn.isBlankDoc" class="turn-rendered-content">
                <!-- 空白文稿专属操作条 -->
                <AutoBlankDoc
                  v-if="turn.isBlankDoc"
                  :turn="turn"
                  :is-generating="isGenerating"
                  @paste-to-blank="pasteToBlank"
                  @clear-blank="clearBlank"
                />

                <!-- 读者评估报告：雷达图位于「面向作者的具体建议」上方 -->
                <template v-if="hasReaderReportJson(turn.content)">
                  <template v-if="splitReaderAdviceSections(turn.content).hasAdvice">
                    <div
                      v-if="splitReaderAdviceSections(turn.content).beforeAdvice"
                      class="markdown-body reading-view article-render"
                      :class="{ 'content-colored': contentColoringOn }"
                      :style="autoReadingStyle"
                      v-html="renderTurnBody(splitReaderAdviceSections(turn.content).beforeAdvice)"
                    />
                    <ReaderResultInline
                      v-if="turn.id !== aiMessage.id || !isGenerating"
                      class="reader-result-inline"
                      :content="turn.content"
                    />
                    <div
                      class="markdown-body reading-view article-render"
                      :class="{ 'content-colored': contentColoringOn }"
                      :style="autoReadingStyle"
                      v-html="renderTurnBody(splitReaderAdviceSections(turn.content).afterAdvice)"
                    />
                  </template>
                  <template v-else>
                    <div
                      class="markdown-body reading-view article-render"
                      :class="{ 'content-colored': contentColoringOn }"
                      :style="autoReadingStyle"
                      v-html="renderTurnBody(turn.content)"
                    />
                    <ReaderResultInline
                      v-if="turn.id !== aiMessage.id || !isGenerating"
                      class="reader-result-inline"
                      :content="turn.content"
                    />
                  </template>
                </template>

                <!-- 常规正文：WYSIWYG 原地编辑（流式输出中 / 审核 / 读者只读）。
                     初始 HTML 与外部变更由 syncBodyEditor 按需回写，避免扰动光标。 -->
                <div
                  v-else
                  :ref="bodyEditorRefFor(turn.id)"
                  class="markdown-body reading-view article-render auto-wysiwyg-body"
                  :class="[autoWysiwygClass, { 'is-readonly': !bodyEditable(turn), 'is-blank-wysiwyg': turn.isBlankDoc }]"
                  :style="autoWysiwygStyle"
                  :contenteditable="bodyEditable(turn)"
                  :data-placeholder="turn.isBlankDoc ? '在此直接输入或粘贴文本内容，完成后自动保存并进入文稿列表...' : '点击正文即可直接编辑，修改自动保存'"
                  @input="onBodyInput(turn, $event)"
                  @compositionstart="onBodyCompositionStart(turn)"
                  @compositionend="onBodyCompositionEnd(turn)"
                  @paste="onBodyPaste(turn, $event)"
                  @blur="onBodyBlur(turn)"
                  @click="onBodyFocusEvent"
                  @keyup="onBodyFocusEvent"
                  @select="onBodyFocusEvent"
                  @mouseup="onBodyFocusEvent"
                  @contextmenu="openCustomContextMenu(turn, $event)"
                ></div>
              </div>

              <!-- 4. Incomplete continuation bar -->
              <div
                v-if="!isGenerating && turn.id === aiMessage.id && turn.incomplete"
                class="incomplete-bar"
              >
                <span class="incomplete-text">正文尚未写完（被输出长度上限截断或已中止）</span>
                <button
                  class="incomplete-btn"
                  type="button"
                  title="紧接着断点把正文写完"
                  @click="continueUnfinished"
                >
                  <ArrowUp :size="12" :stroke-width="2.2" />
                  接着写完
                </button>
              </div>

              <!-- 6. AI 抛出的点选选项（常见于反复审核同一文档时 AI 问「需要我做什么」
                   并列出 1、2、3 等文字选项）：渲染成可点击胶囊，点一下即把该选项作为
                   新的追问回发给 AI。 -->
              <div
                v-if="turn.id === aiMessage.id && !isGenerating && parseChoiceOptions(turn.content).length > 0"
                class="choice-reply-bar"
              >
                <span class="choice-reply-label">
                  <MessageSquare :size="12" :stroke-width="2" class="choice-reply-icon" />
                  向 AI 回复：
                </span>
                <button
                  v-for="(opt, ci) in parseChoiceOptions(turn.content)"
                  :key="ci"
                  class="choice-reply-btn"
                  type="button"
                  :title="`发送这条回复给 AI：${opt}`"
                  @click="sendChoiceOption(opt)"
                >
                  {{ opt }}
                  <ChevronRight :size="11" :stroke-width="2" class="choice-reply-send" />
                </button>
              </div>

              <!-- 5. Footer Metadata: Tokens/Chars (Left), Pagination & Variant Actions (Center), Time (Right) - 统一同行排布 -->
              <div
                v-if="turn.tokens || turn.timestamp || turn.continued || (!isGenerating && canShowVariantActions(turn)) || group.turns.length > 1 || turn.isBlankDoc"
                class="reply-footer-meta"
              >
                <!-- Tokens 统计 / 字符统计 与接续组件 (左侧) -->
                <div class="footer-left-meta">
                  <!-- 新建空白 WYSIWYG 编辑区机制下显示字符统计 -->
                  <div
                    v-if="turn.isBlankDoc || turn.variant === 'blank'"
                    class="token-widget char-widget"
                    title="当前空白文稿字符统计（含标点与空格）"
                  >
                    <Type :size="11" :stroke-width="1.9" />
                    <span>字符数</span>
                    <strong>{{ (turn.content || '').length.toLocaleString() }}</strong>
                  </div>
                  <!-- 常规 AI 产出显示 Tokens 消耗 -->
                  <div v-else-if="turn.tokens" class="token-widget" title="消耗Token数">
                    <Coins :size="11" :stroke-width="1.9" />
                    <span>Tokens</span>
                    <strong>{{ turn.tokens.toLocaleString() }}</strong>
                  </div>
                  <div
                    v-if="turn.continued"
                    class="continued-widget"
                    title="已自动接续次数"
                  >
                    自动接续 {{ turn.continued }} 次
                  </div>
                </div>

                <!-- 分页与变体动作按钮组：与 Tokens 统计和时间戳整齐稳定位于同一专属信息行内 -->
                <div class="footer-variant-actions-row">
                  <!-- 分页控制器：仅在有多个生成版本时呈现，如 <2/2>，用于在同一面板位置切换呈现 -->
                  <div
                    v-if="group.turns.length > 1"
                    class="turn-pagination-bar"
                    title="切换历史生成版本"
                  >
                    <button
                      class="turn-page-btn"
                      type="button"
                      :disabled="isGenerating || getGroupActiveIndex(group) <= 0"
                      title="上一页"
                      @click="switchGroupPage(group, getGroupActiveIndex(group) - 1)"
                    >
                      <ChevronLeft :size="12" :stroke-width="2.2" />
                    </button>
                    <span class="turn-page-indicator">
                      {{ getGroupActiveIndex(group) + 1 }}/{{ group.turns.length }}
                    </span>
                    <button
                      class="turn-page-btn"
                      type="button"
                      :disabled="isGenerating || getGroupActiveIndex(group) >= group.turns.length - 1"
                      title="下一页"
                      @click="switchGroupPage(group, getGroupActiveIndex(group) + 1)"
                    >
                      <ChevronRight :size="12" :stroke-width="2.2" />
                    </button>
                  </div>

                  <!-- 变体动作按钮组：只存在对话跟AI写作的回复正文，审核意见跟读者模式不展示 -->
                  <div
                    v-if="!isGenerating && canShowVariantActions(turn)"
                    class="footer-variant-actions"
                  >
                    <span
                      v-if="!turn.isBlankDoc && turn.variant !== 'blank'"
                      class="next-chapter-wrap"
                      ref="nextChapterBtnWrapEl"
                      @mouseenter="showNextChapterTooltip"
                      @mouseleave="hideNextChapterTooltip"
                    >
                      <button
                        class="variant-btn next-chapter-btn"
                        :class="{ 'is-disabled': nextChapterState.disabled }"
                        type="button"
                        :disabled="isGenerating || nextChapterState.disabled"
                        :title="nextChapterState.tooltip"
                        @click="runNextChapter(turn)"
                      >
                        <FastForward :size="12" :stroke-width="2" />
                        <span>下一章</span>
                      </button>
                    </span>
                    <button
                      class="variant-btn primary"
                      type="button"
                      :disabled="isGenerating"
                      title="按当前设定重新生成，以分页形式呈现"
                      @click="runVariantGeneration('refresh', turn)"
                    >
                      <RefreshCw :size="12" />
                      <span>重新生成</span>
                    </button>
                    <button
                      class="variant-btn"
                      type="button"
                      :disabled="isGenerating"
                      title="换一个叙事结构重写"
                      @click="runVariantGeneration('structure', turn)"
                    >
                      <RotateCcw :size="12" />
                      <span>换个结构</span>
                    </button>
                    <button
                      class="variant-btn"
                      type="button"
                      :disabled="isGenerating"
                      title="换一个叙事手法重写"
                      @click="runVariantGeneration('technique', turn)"
                    >
                      <RotateCcw :size="12" />
                      <span>换个手法</span>
                    </button>
                    <button
                      class="variant-btn"
                      type="button"
                      :disabled="isGenerating"
                      title="换一个结局结尾重写"
                      @click="runVariantGeneration('ending', turn)"
                    >
                      <RotateCcw :size="12" />
                      <span>换个结尾</span>
                    </button>
                    <button
                      class="variant-btn"
                      type="button"
                      :disabled="isGenerating"
                      :title="rewriteVariantTitle(turn)"
                      @click="runVariantGeneration('rewrite', turn)"
                    >
                      <Pencil :size="12" />
                      <span>重写篇章</span>
                    </button>
                  </div>
                </div>

                <!-- 时间显示组件 (右侧) -->
                <div v-if="turn.timestamp" class="message-timestamp">
                  {{ turn.timestamp }}
                </div>
              </div>
            </div>
            </template>
          </template>

          <!-- 翻页模式底部快速翻页工具条 -->
          <div v-if="chatLayoutMode === 'paged' && totalRounds > 1" class="paged-bottom-bar">
            <button
              class="paged-nav-btn prev"
              type="button"
              :disabled="activeRoundIndex <= 0"
              title="上一页 (Alt+←)"
              @click="pagedGoPrev"
            >
              <ChevronLeft :size="12" :stroke-width="2" />
              <span>上一页</span>
            </button>
            <span class="paged-bottom-hint">
              按 <strong>Alt + ←</strong> / <strong>Alt + →</strong> 快速翻页
            </span>
            <button
              class="paged-nav-btn next"
              type="button"
              :disabled="activeRoundIndex >= totalRounds - 1"
              title="下一页 (Alt+→)"
              @click="pagedGoNext"
            >
              <span>下一页</span>
              <ChevronRight :size="12" :stroke-width="2" />
            </button>
          </div>
        </div>
        </article>
      </main>

      <!-- 悬浮最底部功能图标：用户往上滑动时出现，点击后快速回到最底部 -->
      <transition name="fade-slide">
        <button
          v-if="showScrollBottomBtn"
          id="middle-scroll-to-bottom-btn"
          class="scroll-bottom-btn"
          :class="{ 'see-through': scrollBottomBtnSeeThrough }"
          type="button"
          title="回到最底部"
          @click="scrollToBottom"
        >
          <ArrowDown :size="14" />
          <span>最底部</span>
        </button>
      </transition>
    </div>

      <!-- Right Parameter Drawer Panel -->
      <!-- 右栏拖拽分隔线（双击复位默认宽度） -->
      <div
        v-if="!isRightPanelCollapsed"
        class="panel-resizer"
        :class="{ dragging: resizingSide === 'right' }"
        title="拖拽调整右栏宽度（双击恢复默认）"
        @mousedown="startPanelResize('right', $event)"
        @dblclick="resetPanelWidth('right')"
      ></div>

      <aside
        class="right-panel"
        :class="{ 'is-collapsed': isRightPanelCollapsed }"
        :style="{ width: isRightPanelCollapsed ? '44px' : rightWidth + 'px' }"
        @click="isRightPanelCollapsed ? toggleRightPanel() : null"
      >
        <div class="panel-inner space-y-3.5">
          <!-- 1. Writing Mode Selector (Moved Up with tight gap to textarea below) -->
          <section class="space-y-1 writing-mode-section">
            <div class="writing-mode-header flex items-center justify-between">
              <label class="block-label mb-0 flex items-center gap-1 cursor-pointer" for="writing-mode-select">
                <span v-if="!isRightPanelCollapsed">写作模式</span>
                <span v-else class="collapsed-title-tag" title="点击展开右侧面板">模式</span>
              </label>
              <button
                type="button"
                class="panel-collapse-btn"
                :title="isRightPanelCollapsed ? '展开右侧面板 (<)' : '折叠右侧面板 (>)'"
                @click.stop="toggleRightPanel"
              >
                <ChevronLeft v-if="isRightPanelCollapsed" :size="15" :stroke-width="2.2" />
                <ChevronRight v-else :size="15" :stroke-width="2.2" />
              </button>
            </div>
            <div v-show="!isRightPanelCollapsed" class="relative flex items-center mt-1">
              <select
                id="writing-mode-select"
                v-model="writingMode"
                class="form-select select-with-arrow"
              >
                <option value="chat">对话</option>
                <option value="writer">AI写作</option>
                <option value="auditor">审核意见</option>
                <option value="reader">读者</option>
              </select>
            </div>
          </section>

          <!-- 折叠面板时的极简垂直标识 -->
          <div v-if="isRightPanelCollapsed" class="collapsed-panel-rail" title="点击展开右侧面板" @click.stop="toggleRightPanel">
            <Sparkles :size="14" class="text-primary mb-1 opacity-80" />
            <span class="collapsed-rail-text">写作面板</span>
          </div>

          <!-- 展开状态下才渲染其余右侧功能选项 -->
          <template v-if="!isRightPanelCollapsed">

          <!-- 1b. 待处理文档选择（仅审核意见 / 读者模式） -->
          <section v-if="!showWritingForm" class="space-y-1">
            <label class="block-label" for="audit-doc-select">
              待处理文档
            </label>
            <div class="relative flex items-center">
              <select
                id="audit-doc-select"
                v-model="auditDocId"
                class="form-select select-with-arrow"
              >
                <option v-if="auditDocOptions.length === 0" value="current">
                  暂无可处理的文档
                </option>
                <option
                  v-for="doc in auditDocOptions"
                  :key="doc.id"
                  :value="doc.id"
                >
                  {{ doc.label }}
                </option>
              </select>
            </div>
            <p class="audit-doc-hint">
              从当前正文或「历史」版本中选择一份，交给{{
                writingMode === "auditor" ? "审核意见" : "读者"
              }}智能体处理。
            </p>
          </section>

          <!-- 2. Outline / Inspiration Input Textarea (Clean Placeholder with Model/Search/Thinking toolbar) -->
          <template v-if="showWritingForm">
          <section class="space-y-1">
            <div class="auto-composer-box">
              <textarea
                id="topic-content"
                v-model="topicContent"
                class="auto-composer-textarea"
                placeholder="请输入大纲或灵感"
                rows="5"
              />
              <div class="auto-composer-tools">
                <div class="auto-composer-options-left">
                  <!-- 1. 模型选择组件 (与写作界面统一图标及下拉) -->
                  <div class="popover-wrapper">
                    <button
                      class="icon-pill-btn"
                      :class="{ active: activePopover === 'model' }"
                      :title="`当前模型: ${currentModelLabel}`"
                      type="button"
                      @click.stop="togglePopover('model')"
                    >
                      <BrainCircuit :size="15" />
                    </button>
                    <div v-if="activePopover === 'model'" class="popover-dropdown model-dropdown" @click.stop>
                      <div class="popover-title">选择 AI 模型</div>
                      <input
                        v-model="modelFilter"
                        class="model-filter-input"
                        placeholder="筛选模型…"
                        @click.stop
                      />
                      <div class="popover-options model-options">
                        <div v-if="visibleModelGroups.length === 0" class="model-empty">
                          没有匹配的模型
                        </div>
                        <div
                          v-for="group in visibleModelGroups"
                          :key="group.id"
                          class="model-group"
                        >
                          <button
                            class="model-group-head"
                            type="button"
                            @click.stop="toggleGroup(group)"
                          >
                            <ChevronDown
                              v-if="isGroupOpen(group)"
                              :size="12"
                              :stroke-width="2.2"
                            />
                            <ChevronRight v-else :size="12" :stroke-width="2.2" />
                            <span class="model-group-name" :title="group.label">
                              {{ group.label }}
                            </span>
                            <span
                              v-if="group.isActive"
                              class="model-group-dot"
                              title="当前使用的接口"
                            ></span>
                            <span class="model-group-count">
                              {{ filteredModels(group).length }}
                            </span>
                          </button>

                          <div v-if="isGroupOpen(group)" class="model-group-body">
                            <div
                              v-for="model in filteredModels(group)"
                              :key="group.id + model"
                              class="popover-option model-option"
                              :class="{ selected: group.isActive && aiSettings.model === model }"
                              :title="model"
                              @click="selectModel(group, model)"
                            >
                              <span class="model-option-name">{{ model }}</span>
                              <Check
                                v-if="group.isActive && aiSettings.model === model"
                                :size="12"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- 2. 联网搜索组件 (与写作界面统一) -->
                  <div class="popover-wrapper">
                    <button
                      class="icon-pill-btn"
                      :class="{ active: aiSettings.webSearchEnabled || activePopover === 'webSearch' }"
                      :title="`联网搜索: ${webSearchLabel}`"
                      type="button"
                      @click.stop="togglePopover('webSearch')"
                    >
                      <Globe :size="15" />
                    </button>
                    <div v-if="activePopover === 'webSearch'" class="popover-dropdown" @click.stop>
                      <div class="popover-title">联网搜索设置</div>
                      <div class="popover-options">
                        <div
                          class="popover-option"
                          :class="{ selected: !aiSettings.webSearchEnabled }"
                          @click="webSearchMode = 'off'; activePopover = null"
                        >
                          <span>关闭联网</span>
                          <Check v-if="!aiSettings.webSearchEnabled" :size="12" />
                        </div>
                        <div
                          class="popover-option"
                          :class="{ selected: aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'bing' }"
                          title="首发 DuckDuckGo，失败自动回退 Bing / Brave / Startpage"
                          @click="webSearchMode = 'bing'; activePopover = null"
                        >
                          <span>开启（综合优先）</span>
                          <Check
                            v-if="aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'bing'"
                            :size="12"
                          />
                        </div>
                        <div
                          class="popover-option"
                          :class="{ selected: aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'google' }"
                          title="首发 Startpage（Google 结果），失败自动回退其余引擎"
                          @click="webSearchMode = 'google'; activePopover = null"
                        >
                          <span>开启（Google 结果优先）</span>
                          <Check
                            v-if="aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'google'"
                            :size="12"
                          />
                        </div>
                      </div>
                      <div class="slash-foot">任一引擎失败会自动换下一个；全部失败时 AI 会如实说明未拿到联网资料。</div>
                    </div>
                  </div>

                  <!-- 3. 思考等级组件 (与写作界面统一) -->
                  <div class="popover-wrapper">
                    <button
                      class="icon-pill-btn"
                      :class="{ active: activePopover === 'thinking' }"
                      :title="`思考等级: ${thinkingLevelLabel}`"
                      type="button"
                      @click.stop="togglePopover('thinking')"
                    >
                      <Sparkles :size="15" />
                    </button>
                    <div v-if="activePopover === 'thinking'" class="popover-dropdown" @click.stop>
                      <div class="popover-title">思考等级设置</div>
                      <div class="popover-options">
                        <div
                          class="popover-option"
                          :class="{ selected: aiSettings.thinkingLevel === 'off' }"
                          @click="aiSettings.thinkingLevel = 'off'; activePopover = null"
                        >
                          <span>关闭 (精简直接)</span>
                          <Check v-if="aiSettings.thinkingLevel === 'off'" :size="12" />
                        </div>
                        <div
                          class="popover-option"
                          :class="{ selected: aiSettings.thinkingLevel === 'auto' }"
                          @click="aiSettings.thinkingLevel = 'auto'; activePopover = null"
                        >
                          <span>自动 (智能调节)</span>
                          <Check v-if="aiSettings.thinkingLevel === 'auto'" :size="12" />
                        </div>
                        <div
                          class="popover-option"
                          :class="{ selected: aiSettings.thinkingLevel === 'standard' }"
                          @click="aiSettings.thinkingLevel = 'standard'; activePopover = null"
                        >
                          <span>标准 (逐步推演)</span>
                          <Check v-if="aiSettings.thinkingLevel === 'standard'" :size="12" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div class="auto-composer-status">
                  <span class="model-current-hint" :title="currentModelLabel">{{ currentModelLabel }}</span>
                </div>
              </div>
            </div>
          </section>

          <!-- 3. Metrics Row: 目标字数 + 篇幅 + 输出类型（原正文下拉挪到原模型位置） -->
          <section class="metrics-row">
            <!-- 目标字数 -->
            <div class="metric-col">
              <label class="block-label-sm" for="word-count-input">
                目标字数
              </label>
              <input
                id="word-count-input"
                v-if="outputTargetType === 'story'"
                v-model.number="targetWordCount"
                type="number"
                class="form-input"
                placeholder="2000"
                min="100"
                step="500"
              />
              <input
                id="word-count-input"
                v-else
                type="text"
                class="form-input disabled-metric"
                value="表单类型项"
                disabled
                title="大纲篇幅由篇幅类型决定，不设具体字数"
              />
            </div>
            <!-- 篇幅（短篇、中篇、长篇） -->
            <div class="metric-col">
              <label class="block-label-sm" for="article-length-select">
                篇幅
              </label>
              <div class="relative flex items-center">
                <select
                  id="article-length-select"
                  v-model="articleLength"
                  class="form-select select-with-arrow"
                  @change="handleArticleLengthChange"
                >
                  <option value="short">短篇</option>
                  <option value="medium">中篇</option>
                  <option value="long">长篇</option>
                </select>
              </div>
            </div>
            <!-- 输出类型（大纲 / 正文）—— 挪到原先的模型下拉位置 -->
            <div class="metric-col">
              <label class="block-label-sm" for="output-target-select">
                输出类型
              </label>
              <div class="relative flex items-center">
                <select
                  id="output-target-select"
                  v-model="outputTargetType"
                  class="form-select select-with-arrow"
                  @change="handleOutputTargetTypeChange"
                >
                  <option value="story">正文</option>
                  <option value="outline">大纲</option>
                </select>
              </div>
            </div>
          </section>

          <!-- 4. Three Categorized Option Groups (Clean tags without gray backgrounds) -->

          <!-- Group A: 素材库 (项目素材库，解耦) -->
          <section class="custom-group-box">
            <div class="group-header">
              <div class="group-title-wrap">
                <span class="block-label">素材库</span>
                <span class="group-page-hint">({{ materialCurrentPage }}/{{ materialTotalPages }})</span>
              </div>
              <div class="group-pager">
                <span
                  class="group-selected-badge"
                  :class="{ 'has-selected': selectedMaterialCount > 0 }"
                  :title="`已选择 ${selectedMaterialCount} 项`"
                >
                  {{ selectedMaterialCount }}
                </span>
                <button
                  class="pager-icon-btn"
                  type="button"
                  title="上一组素材"
                  @click="prevMaterials"
                >
                  <ChevronLeft :size="13" />
                </button>
                <button
                  class="pager-icon-btn"
                  type="button"
                  title="下一组素材"
                  @click="cycleMaterials"
                >
                  <ChevronRight :size="13" />
                </button>
                <button
                  class="cycle-btn"
                  type="button"
                  title="换下一组素材"
                  @click="cycleMaterials"
                >
                  <RefreshCw :size="11" />
                  换一换
                </button>
              </div>
            </div>
            <div class="tag-grid">
              <button
                v-for="mat in visibleMaterials"
                :key="mat.id"
                class="compact-tag-btn"
                :class="{ active: mat.selected }"
                :title="tagTooltip(mat.content, mat.title)"
                type="button"
                @click="toggleMaterial(mat.id)"
              >
                <Check v-if="mat.selected" :size="11" class="check-icon" />
                <span class="tag-name">{{ mat.title }}</span>
              </button>
            </div>
          </section>

          <!-- Group B: 故事定制 (归纳子分类: 角色原型 / 经典情节，无灰色底框) -->
          <section class="custom-group-box space-y-1.5">
            <span class="block-label">故事定制</span>

            <!-- Sub-group B1: 角色原型 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">角色原型</span>
                  <span class="group-page-hint">({{ archetypeCurrentPage }}/{{ archetypeTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': selectedArchetypeCount > 0 }"
                    :title="`已选择 ${selectedArchetypeCount} 项`"
                  >
                    {{ selectedArchetypeCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组角色原型"
                    @click="prevArchetypes"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组角色原型"
                    @click="cycleArchetypes"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组角色原型"
                    @click="cycleArchetypes"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="st in visibleArchetypes"
                  :key="st.id"
                  class="compact-tag-btn"
                  :class="{ active: selectedStoryIds.has(st.id) }"
                  :title="tagTooltip(st.desc, st.name)"
                  type="button"
                  @click="toggleStory(st.id)"
                >
                  <Check v-if="selectedStoryIds.has(st.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ st.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group B2: 经典情节 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">经典情节</span>
                  <span class="group-page-hint">({{ plotCurrentPage }}/{{ plotTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': selectedPlotCount > 0 }"
                    :title="`已选择 ${selectedPlotCount} 项`"
                  >
                    {{ selectedPlotCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组情节"
                    @click="prevPlots"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组情节"
                    @click="cyclePlots"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组情节"
                    @click="cyclePlots"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="st in visiblePlots"
                  :key="st.id"
                  class="compact-tag-btn"
                  :class="{ active: selectedStoryIds.has(st.id) }"
                  :title="tagTooltip(st.desc, st.name)"
                  type="button"
                  @click="toggleStory(st.id)"
                >
                  <Check v-if="selectedStoryIds.has(st.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ st.name }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- Group C: 叙事定制 (归纳子分类: 叙事结构 / 叙事手法 / 结局结尾，无灰色底框) -->
          <section class="custom-group-box space-y-1.5">
            <span class="block-label">叙事定制</span>

            <!-- Sub-group C1: 叙事结构 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">叙事结构</span>
                  <span class="group-page-hint">({{ structureCurrentPage }}/{{ structureTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': selectedStructureCount > 0 }"
                    :title="`已选择 ${selectedStructureCount} 项`"
                  >
                    {{ selectedStructureCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组叙事结构"
                    @click="prevStructures"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组叙事结构"
                    @click="cycleStructures"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组叙事结构"
                    @click="cycleStructures"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="nar in visibleStructures"
                  :key="nar.id"
                  class="compact-tag-btn"
                  :class="{ active: selectedNarrativeIds.has(nar.id) }"
                  :title="tagTooltip(nar.desc, nar.name)"
                  type="button"
                  @click="toggleNarrative(nar.id)"
                >
                  <Check v-if="selectedNarrativeIds.has(nar.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ nar.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group C2: 叙事手法 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">叙事手法</span>
                  <span class="group-page-hint">({{ techniqueCurrentPage }}/{{ techniqueTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': selectedTechniqueCount > 0 }"
                    :title="`已选择 ${selectedTechniqueCount} 项`"
                  >
                    {{ selectedTechniqueCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组叙事手法"
                    @click="prevTechniques"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组叙事手法"
                    @click="cycleTechniques"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组叙事手法"
                    @click="cycleTechniques"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="nar in visibleTechniques"
                  :key="nar.id"
                  class="compact-tag-btn"
                  :class="{ active: selectedNarrativeIds.has(nar.id) }"
                  :title="tagTooltip(nar.desc, nar.name)"
                  type="button"
                  @click="toggleNarrative(nar.id)"
                >
                  <Check v-if="selectedNarrativeIds.has(nar.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ nar.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group C3: 结局结尾 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">结局结尾</span>
                  <span class="group-page-hint">({{ endingCurrentPage }}/{{ endingTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': selectedEndingCount > 0 }"
                    :title="`已选择 ${selectedEndingCount} 项`"
                  >
                    {{ selectedEndingCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组结局结尾"
                    @click="prevEndings"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组结局结尾"
                    @click="cycleEndings"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组结局结尾"
                    @click="cycleEndings"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="nar in visibleEndings"
                  :key="nar.id"
                  class="compact-tag-btn"
                  :class="{ active: selectedNarrativeIds.has(nar.id) }"
                  :title="tagTooltip(nar.desc, nar.name)"
                  type="button"
                  @click="toggleNarrative(nar.id)"
                >
                  <Check v-if="selectedNarrativeIds.has(nar.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ nar.name }}</span>
                </button>
              </div>
            </div>
          </section>
          </template>

          <!-- 5. Primary & Secondary Actions -->
          <section
            class="action-buttons-section"
            :class="{ centered: !showWritingForm }"
          >
            <!-- 1. 开始处理 / 停止处理 -->
            <button
              v-if="!isGenerating"
              class="btn-primary flex items-center justify-center gap-2"
              :class="showWritingForm ? 'flex-1' : ''"
              type="button"
              @click="startGeneration"
            >
              <Sparkles :size="16" />
              {{ outputTargetType === 'outline' ? '生成大纲' : '开始处理' }}
            </button>
            <button
              v-else-if="activeGeneratingAction === 'normal'"
              class="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center justify-center gap-2"
              :class="showWritingForm ? 'flex-1' : ''"
              type="button"
              title="中断当前生成"
              @click="stopGeneration"
            >
              <Square :size="16" />
              停止处理
            </button>
            <button
              v-else
              class="btn-primary opacity-50 cursor-not-allowed flex items-center justify-center gap-2"
              :class="showWritingForm ? 'flex-1' : ''"
              type="button"
              disabled
            >
              <Sparkles :size="16" />
              处理中
            </button>

            <!-- 2. 章纲生成 / 停止章纲生成 -->
            <button
              v-if="showWritingForm && (!isGenerating || activeGeneratingAction !== 'chapter_outline')"
              class="btn-outline-action flex items-center justify-center gap-1.5"
              type="button"
              title="按照章节细纲固定格式模板生成失衡叙事章纲"
              :disabled="isGenerating"
              @click="startChapterOutlineGeneration"
            >
              <BookOpen :size="15" />
              章纲生成
            </button>
            <button
              v-else-if="showWritingForm && isGenerating && activeGeneratingAction === 'chapter_outline'"
              class="btn-outline-action stopping-btn flex items-center justify-center gap-1.5"
              type="button"
              title="中断章纲生成"
              @click="stopGeneration"
            >
              <Square :size="15" />
              停止生成
            </button>

            <!-- 3. 对话话本 / 停止对话生成 -->
            <button
              v-if="showWritingForm && (!isGenerating || activeGeneratingAction !== 'dialogue_only')"
              class="btn-outline-action flex items-center justify-center gap-1.5"
              type="button"
              title="参考细纲或文档内容，只写剧本式对话框架"
              :disabled="isGenerating"
              @click="startDialogueOnlyGeneration"
            >
              <MessageSquare :size="15" />
              对话话本
            </button>
            <button
              v-else-if="showWritingForm && isGenerating && activeGeneratingAction === 'dialogue_only'"
              class="btn-outline-action stopping-btn flex items-center justify-center gap-1.5"
              type="button"
              title="中断对话框架生成"
              @click="stopGeneration"
            >
              <Square :size="15" />
              停止生成
            </button>

            <!-- 4. 取消 -->
            <button
              v-if="showWritingForm"
              class="btn-secondary"
              type="button"
              :disabled="isGenerating"
              title="重置素材库、故事与叙事的勾选项"
              @click="cancelSelections"
            >
              取消
            </button>
          </section>
          </template>
        </div>
      </aside>
    </div>
  </template>

    <!-- "下一章" 禁用时的友好说明气泡（fixed 定位，跟随按钮锚点）
         position: fixed 以视口为定位基准，不受祖先 overflow 裁剪影响。 -->
    <transition name="tooltip-fade">
      <div
        v-if="ncTipVisible"
        class="next-chapter-tooltip"
        :style="{ left: ncTipX + 'px', top: ncTipY + 'px' }"
      >
        {{ ncTipText }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.auto-view-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-family: var(--app-font);
}

.auto-workspace {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* Common Aside Panel Styling（宽度由 :style 绑定，支持拖拽） */
.left-panel {
  flex-shrink: 0;
  background-color: var(--surface-bright);
  overflow: hidden;
  padding: 12px 14px 20px;
  z-index: 10;
  border-right: 1px solid var(--outline-variant);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* Left Panel Tabs Header */
.left-panel-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px;
  background-color: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  margin-bottom: 6px;
  flex-shrink: 0;
}

.left-tab-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 6px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
}

.left-tab-btn:hover:not(:disabled) {
  color: var(--on-surface);
  background-color: rgba(var(--primary-rgb) / 0.05);
}

.left-tab-btn:disabled,
.left-tab-btn.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.left-tab-btn.active {
  background-color: var(--surface-bright);
  color: var(--primary);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
}

.left-tab-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-size: 0.68rem;
  font-weight: 700;
}

/* Drafts View in Left Panel */
.drafts-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  border: 1px dashed var(--outline-variant);
  border-radius: 12px;
  background-color: var(--surface-container-low);
}

.draft-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 11px 13px;
  border-radius: 10px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  cursor: pointer;
  transition: all 0.18s ease;
}

.draft-item:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.03);
  transform: translateY(-1px);
}

.draft-item.active {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  box-shadow: 0 0 0 1px var(--primary);
}

.draft-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.draft-item-title {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-item-time {
  font-size: 0.7rem;
  color: var(--on-surface-variant);
  flex-shrink: 0;
}

.draft-item-preview {
  font-size: 0.775rem;
  line-height: 1.5;
  color: var(--on-surface-variant);
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  word-break: break-all;
}

.draft-item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-top: 4px;
  border-top: 1px dashed rgba(var(--on-surface-rgb, 120, 120, 120) / 0.12);
}

.draft-item-chars {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
}

.draft-item-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 3px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.draft-item-del:hover {
  color: var(--error, #ef4444);
  background-color: rgba(239, 68, 68, 0.1);
}

/* 文稿：新建文件夹按钮 */
.new-folder-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--primary);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.new-folder-btn:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.1);
}

/* 文稿：文件夹头部行（块的标题栏） */
.draft-folder-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 8px;
  border: 1px solid transparent;
  background-color: transparent;
  color: var(--on-surface-variant);
  transition: all 0.15s ease;
}

.draft-folder-row:hover {
  background-color: var(--surface-container-high);
}

.draft-folder-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.draft-folder-caret:hover {
  background-color: var(--surface-container-high);
  color: var(--on-surface);
}

.draft-folder-caret-spacer {
  width: 18px;
  flex-shrink: 0;
}

.draft-folder-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.draft-folder-name {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.draft-folder-rename-input {
  flex: 1;
  min-width: 0;
  padding: 3px 6px;
  border-radius: 5px;
  border: 1px solid var(--primary);
  outline: none;
  font-size: 0.78rem;
  color: var(--on-surface);
  background-color: var(--surface-bright);
}

.draft-folder-count {
  font-size: 0.68rem;
  font-weight: 700;
  color: var(--on-surface-variant);
  opacity: 0.8;
  flex-shrink: 0;
}

.draft-item.is-dragging {
  opacity: 0.45;
  border-style: dashed;
}

.draft-item-grip {
  color: var(--on-surface-variant);
  opacity: 0.45;
  flex-shrink: 0;
}

.draft-item:hover .draft-item-grip {
  opacity: 0.9;
  color: var(--primary);
}

/* 文稿：过往创作归档 */
.drafts-archives {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  padding-top: 10px;
  border-top: 1px solid var(--outline-variant);
}

.drafts-archives-head {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--on-surface-variant);
}

.drafts-archives-head svg {
  color: var(--primary);
}

.draft-archive-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
}

.draft-archive-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.draft-archive-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-archive-meta {
  font-size: 0.7rem;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-archive-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.draft-archive-restore {
  padding: 3px 9px;
  border-radius: 6px;
  border: 1px solid rgba(var(--primary-rgb) / 0.35);
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s ease;
}

.draft-archive-restore:hover {
  background-color: rgba(var(--primary-rgb) / 0.2);
}

/* 文稿面板：上=可滚动列表占满，下=一行紧凑底部条 */
.drafts-panel {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding-top: 14px;
}

.drafts-scroll-zone {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}

.drafts-list-empty-hint {
  font-size: 0.78rem;
  color: var(--on-surface-variant);
  opacity: 0.7;
  text-align: center;
  padding: 24px 12px;
  border: 1px dashed var(--outline-variant);
  border-radius: 10px;
}

/* 文稿树：文件夹块 + 未分类，与文档左栏（DocumentSidebar）同构 */
.drafts-tree {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.draft-folder-block {
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  background-color: var(--surface-container-low);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.draft-folder-block.drag-over {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.draft-folder-children {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 6px 8px 10px;
  border-top: 1px dashed var(--outline-variant);
}

.draft-root-section {
  display: flex;
  flex-direction: column;
  border: 1px dashed transparent;
  border-radius: 10px;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.draft-root-section.drag-over {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.1);
}

/* 紧凑底部说明条：一行放完，不挤占文稿列表 */
.drafts-foot-panel {
  flex: 0 0 auto;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--outline-variant);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.drafts-foot-note {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.drafts-foot-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.drafts-foot-hint {
  font-size: 0.7rem;
  line-height: 1.35;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drafts-foot-history-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  border: 1px solid rgba(var(--primary-rgb) / 0.4);
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 700;
  flex-shrink: 0;
  cursor: pointer;
  transition: all 0.15s ease;
}

.drafts-foot-history-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.2);
}

/* 自动界面中区：用户消息气泡（与写作界面右侧 AI 写作的用户消息同款） */
.auto-user-message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 12px;
  background-color: rgba(var(--primary-rgb) / 0.06);
  border: 1px solid rgba(var(--primary-rgb) / 0.16);
  border-left: 3px solid var(--primary);
  max-width: 100%;
  user-select: text;
}

.auto-user-message-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-user-message-icon {
  flex-shrink: 0;
  color: var(--primary);
}

.auto-user-message-label {
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: var(--primary);
}

.auto-user-message-time {
  margin-left: auto;
  font-size: 0.68rem;
  color: var(--on-surface-variant);
  opacity: 0.75;
  flex-shrink: 0;
}

.auto-user-message-body {
  font-size: 0.82rem;
  line-height: 1.65;
  color: var(--on-surface);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---- 用户消息结构化的两部分：明文大纲 + 选项胶囊 ---- */
.auto-user-main-text {
  font-size: 0.82rem;
  line-height: 1.65;
  color: var(--on-surface);
  background-color: var(--surface-bright);
  border: 1px solid rgba(var(--primary-rgb) / 0.16);
  border-radius: 8px;
  padding: 8px 10px;
  white-space: pre-wrap;
  word-break: break-word;
}

.auto-user-groups {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.auto-user-group {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.auto-user-group-label {
  flex-shrink: 0;
  width: 54px;
  padding-top: 3px;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1.3;
  color: var(--primary);
}

.auto-user-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  min-width: 0;
}

/* 胶囊式选项：与 AI 知识项工具轨迹同款观感（primary 描边 + 点色标识） */
.auto-user-chip {
  display: inline-flex;
  align-items: center;
  max-width: 240px;
  padding: 3px 9px;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.06);
  border: 1px solid rgba(var(--primary-rgb) / 0.3);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
}

/* 用户消息与下方 AI 卡片之间的呼吸间距 */
.auto-user-message + .turn-card {
  margin-top: -4px;
}

/* ---------------- 对话目录条（窄条短横 + 悬停展开弹窗） ---------------- */
.auto-toc-rail {
  position: relative;
  flex: 0 0 12px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  z-index: 25;
  background-color: transparent;
  user-select: none;
}

.auto-toc-dash-track {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding-top: 24px;
  width: 100%;
}

.auto-toc-dash-item {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 3px;
  transition: transform 0.15s ease;
}

.auto-toc-dash-bar {
  display: block;
  width: 10px;
  height: 3px;
  border-radius: 9999px;
  background-color: var(--outline-variant, #cbd5e1);
  transition: all 0.18s ease;
}

.auto-toc-dash-item:hover .auto-toc-dash-bar {
  background-color: var(--on-surface-variant, #94a3b8);
  width: 12px;
}

.auto-toc-dash-item.active .auto-toc-dash-bar {
  width: 14px;
  height: 3.5px;
  background-color: var(--primary, #2563eb);
}

/* 悬停展开浮动卡片（缩窄到十二个汉字宽度） */
.auto-toc-popover {
  position: absolute;
  left: 2px;
  top: 16px;
  width: 185px;
  min-width: 175px;
  max-width: 195px;
  max-height: calc(100vh - 120px);
  background-color: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.08));
  border-radius: 14px;
  box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.12), 0 4px 12px -2px rgba(0, 0, 0, 0.06);
  padding: 8px 10px;
  opacity: 0;
  pointer-events: none;
  transform: translateY(-4px) scale(0.98);
  transition: opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1), transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 60;
}

.auto-toc-rail:hover .auto-toc-popover,
.auto-toc-popover:hover {
  opacity: 1;
  pointer-events: auto;
  transform: translateY(0) scale(1);
}

.auto-toc-popover-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  max-height: calc(100vh - 150px);
  overflow-y: auto;
  overflow-x: hidden;
}

.auto-toc-popover-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background-color 0.15s ease, color 0.15s ease;
}

.auto-toc-popover-item:hover {
  background-color: var(--surface-container-high, rgba(0, 0, 0, 0.04));
}

.auto-toc-popover-text {
  flex: 1;
  min-width: 0;
  max-width: 12.5em;
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--on-surface-variant, #475569);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.4;
}

.auto-toc-popover-item.active .auto-toc-popover-text {
  color: var(--primary, #2563eb);
  font-weight: 600;
}

.auto-toc-popover-dash {
  flex-shrink: 0;
  width: 10px;
  height: 3px;
  border-radius: 9999px;
  background-color: var(--outline-variant, #cbd5e1);
  transition: all 0.15s ease;
}

.auto-toc-popover-item.active .auto-toc-popover-dash {
  width: 14px;
  height: 3.5px;
  background-color: var(--primary, #2563eb);
}

.right-panel {
  flex-shrink: 0;
  background-color: var(--surface-bright);
  overflow-y: auto;
  padding: 14px 14px 20px;
  z-index: 10;
  border-left: 1px solid var(--outline-variant);
  transition: width 0.22s cubic-bezier(0.4, 0, 0.2, 1), padding 0.22s ease;
}

.right-panel.is-collapsed {
  padding: 12px 6px;
  overflow: hidden;
  cursor: pointer;
  user-select: none;
}

.right-panel.is-collapsed:hover {
  background-color: var(--surface-container-lowest);
}

.writing-mode-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.panel-collapse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  border: 1px solid transparent;
  background-color: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  margin-left: 4px;
}

.panel-collapse-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--primary);
  border-color: var(--outline-variant);
}

.collapsed-title-tag {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary);
  writing-mode: vertical-rl;
  letter-spacing: 1px;
}

.collapsed-panel-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 18px;
  gap: 6px;
  color: var(--on-surface-variant);
  font-size: 0.76rem;
  font-weight: 500;
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  opacity: 0.8;
  cursor: pointer;
  transition: opacity 0.15s ease, color 0.15s ease;
}

.right-panel.is-collapsed:hover .collapsed-panel-rail {
  opacity: 1;
  color: var(--primary);
}

/* 拖拽分隔线：宽 3px 的透明热区，悬浮 / 拖拽时高亮 */
.panel-resizer {
  flex: 0 0 3px;
  align-self: stretch;
  cursor: col-resize;
  background-color: transparent;
  z-index: 20;
  transition: background-color 0.15s ease;
}

.panel-resizer:hover {
  background-color: rgba(var(--primary-rgb) / 0.25);
}

.panel-resizer.dragging {
  background-color: var(--primary);
}
.panel-inner {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  width: 100%;
}

.section-title {
  font-size: 1.05rem;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: var(--on-surface);
  display: block;
}

.block-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--on-surface);
}

.sub-block-label {
  font-size: 0.775rem;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.block-label-sm {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin-bottom: 4px;
}

.status-card {
  padding: 10px 12px;
  background-color: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
}

.selected-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mat-chip {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 0.775rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mat-chip:hover {
  background-color: rgba(var(--primary-rgb) / 0.2);
}

.form-textarea {
  width: 100%;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--on-surface);
  background-color: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.form-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb) / 0.15);
}

.outline-textarea {
  min-height: 150px;
}

.form-input {
  width: 100%;
  height: 38px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  border-radius: 10px;
  padding: 0 10px;
  color: var(--on-surface);
  font-size: 0.875rem;
  outline: none;
  transition: border-color 0.18s ease;
}

.form-input:focus {
  border-color: var(--primary);
}

.form-select {
  width: 100%;
  appearance: none;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--on-surface);
  font-size: 0.875rem;
  outline: none;
  cursor: pointer;
  transition: border-color 0.18s ease;
}

.form-select:focus {
  border-color: var(--primary);
}

.select-with-arrow {
  padding-right: 30px;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' fill='%2366736c'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px 14px;
}

.metrics-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.25fr;
  gap: 8px;
  align-items: flex-end;
}

/* 写作模式区块：正常自然留白，确保“写作模式”字样清晰可见不被遮挡 */
.writing-mode-section {
  margin-top: 0;
  margin-bottom: 8px;
  position: relative;
  z-index: 2;
}

.audit-doc-hint {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--on-surface-variant);
  opacity: 0.8;
  margin-top: 2px;
}

.metric-col {
  display: flex;
  flex-direction: column;
}

/* Custom Groups (3 items per group with 换一换 & Compact Tag Style) */
.custom-group-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sub-item-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.group-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-page-hint {
  font-size: 0.75rem;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.cycle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--primary);
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.cycle-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.1);
}

/* 分组翻页：上一组 / 下一组 + 换一换 */
.group-pager {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

/* 已选数量纯数字指示器 */
.group-selected-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  color: var(--on-surface-variant);
  background-color: var(--surface-container-high);
  border: 1px solid var(--outline-variant);
  transition: all 0.18s ease;
  user-select: none;
  margin-right: 2px;
}

.group-selected-badge.has-selected {
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  border-color: rgba(var(--primary-rgb) / 0.35);
  font-weight: 800;
}

.pager-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.pager-icon-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.compact-tag-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.775rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.compact-tag-btn:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.05);
}

.compact-tag-btn.active {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.check-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.tag-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Action Buttons Section with Clear Spacing & Single Row Layout */
.action-buttons-section {
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--outline-variant);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.action-buttons-section.centered {
  justify-content: center;
}

.btn-primary {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  background-color: var(--primary);
  color: #ffffff;
  font-weight: 700;
  font-size: 0.825rem;
  border: none;
  cursor: pointer;
  transition: opacity 0.18s ease, transform 0.12s ease;
  box-shadow: var(--shadow);
  white-space: nowrap;
  flex: 1.15;
  min-width: 0;
}

.btn-primary:hover {
  opacity: 0.92;
}

.btn-primary:active {
  transform: scale(0.98);
}

.btn-secondary {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-weight: 500;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.18s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-secondary:hover {
  background-color: var(--surface-container-low);
}

.btn-outline-action {
  height: 38px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  color: var(--primary);
  font-weight: 700;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.btn-outline-action:hover:not(:disabled) {
  background-color: rgba(var(--primary-rgb) / 0.16);
  transform: translateY(-1px);
}

.btn-outline-action:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-outline-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.subtext-note {
  font-size: 0.775rem;
  line-height: 1.5;
  color: var(--on-surface-variant);
  padding-top: 8px;
  border-top: 1px solid var(--outline-variant);
  opacity: 0.85;
}

.disabled-metric {
  background-color: var(--surface-container-low, #f3f4f6);
  color: var(--on-surface-variant);
  opacity: 0.8;
  cursor: not-allowed;
}

/* Auto Composer Box (Upper Prompt Textarea with toolbar at lower-left) */
.auto-composer-box {
  background-color: var(--surface-container-lowest, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  padding: 10px 12px 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  display: flex;
  flex-direction: column;
}

.auto-composer-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb) / 0.15);
}

.auto-composer-textarea {
  width: 100%;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--on-surface);
  resize: vertical;
  min-height: 120px;
  padding: 0;
  margin-bottom: 8px;
}

.auto-composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--outline-variant);
}

.auto-composer-options-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-composer-status {
  display: flex;
  align-items: center;
  max-width: 180px;
}

.model-current-hint {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(var(--primary-rgb) / 0.08);
  padding: 2px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(var(--primary-rgb) / 0.2);
}

/* Composer Popovers */
.popover-wrapper {
  position: relative;
  display: inline-flex;
}

.icon-pill-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--surface-container, #f3f4f6);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-pill-btn:hover {
  background: var(--surface-container-high, #e5e7eb);
  color: var(--on-surface);
}

.icon-pill-btn.active {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.popover-dropdown {
  position: absolute;
  /* 右栏输入框紧贴窗口顶部，向上展开会被顶部标题栏裁切，改为向下展开。 */
  top: calc(100% + 6px);
  left: 0;
  width: 210px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.12));
  padding: 8px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-dropdown {
  width: 240px;
}

.popover-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--on-surface-variant);
  padding: 4px 6px;
  border-bottom: 1px solid var(--outline-variant);
  margin-bottom: 4px;
}

.popover-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.popover-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease;
}

.popover-option:hover {
  background: var(--surface-container-high, #f0f1f5);
  color: var(--on-surface);
}

.popover-option.selected {
  background: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.slash-foot {
  padding: 6px 6px 2px;
  border-top: 1px solid var(--outline-variant);
  font-size: 10px;
  line-height: 1.4;
  color: var(--on-surface-variant);
  opacity: 0.8;
}

.model-filter-input {
  width: 100%;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low, #f9fafb);
  color: var(--on-surface);
  font-size: 12px;
  outline: none;
  margin-bottom: 6px;
}

.model-filter-input:focus {
  border-color: var(--primary);
}

.model-options {
  max-height: 220px;
}

.model-empty {
  font-size: 12px;
  color: var(--on-surface-variant);
  padding: 8px;
  text-align: center;
}

.model-group + .model-group {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid var(--outline-variant);
}

.model-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 5px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.model-group-head:hover {
  background: var(--surface-container-high, #f0f1f5);
}

.model-group-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.model-group-dot {
  width: 6px;
  height: 6px;
  border-radius: 9999px;
  background-color: var(--primary);
}

.model-group-count {
  font-size: 10px;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.model-group-body {
  padding-left: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
}

.model-option-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---------------- Middle Editor Wrapper & Area ---------------- */
.middle-editor-wrapper {
  flex: 1;
  height: 100%;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background-color: var(--surface-bright);
}

.middle-editor {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  background-color: var(--surface-bright);
  padding: 0 0 100px 0;
  margin: 0;
  display: flex;
  flex-direction: column;
}

/* Pure blank state before generation */
.blank-middle-canvas {
  width: 100%;
  height: 100%;
  background-color: var(--surface-bright);
}

/* ---------------- 中间区创作设定表单 ---------------- */
.setup-panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 20px 16px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: var(--surface-bright);
}

.setup-container {
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background-color: var(--surface-container-lowest, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 16px;
  padding: 22px 26px 28px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
}

.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.setup-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setup-icon {
  color: var(--primary);
}

.setup-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--on-surface);
  letter-spacing: 0.01em;
}

.setup-count {
  font-size: 0.72rem;
  padding: 2px 9px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.setup-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-reset-btn:hover {
  border-color: var(--error, #ef4444);
  color: var(--error, #ef4444);
  background-color: rgba(239, 68, 68, 0.06);
}

.setup-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.setup-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(var(--primary-rgb) / 0.4);
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-new-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.2);
  box-shadow: 0 2px 8px rgba(var(--primary-rgb) / 0.2);
}

.setup-history-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
  color: var(--on-surface-variant);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-history-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
}

.setup-hint {
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--on-surface-variant);
  opacity: 0.85;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--outline-variant);
  margin: 0;
}

.setup-groups {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px 18px;
}

.setup-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background-color: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  padding: 16px 18px;
  transition: border-color 0.2s ease;
}

.setup-group:hover {
  border-color: rgba(var(--primary-rgb) / 0.35);
}

.setup-group.full-width {
  grid-column: 1 / -1;
}

.setup-group-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--on-surface);
  display: flex;
  align-items: center;
  gap: 6px;
}

.setup-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.setup-opt {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transform-origin: center center;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.22s ease,
              border-color 0.2s ease,
              background-color 0.2s ease,
              color 0.2s ease;
}

.setup-opt:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.06);
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.setup-opt:active {
  transform: scale(0.96);
  transition-duration: 0.08s;
}

.setup-opt.active {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
  transform: scale(1.06);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb) / 0.22);
  z-index: 2;
}

.setup-opt.active:hover {
  transform: translateY(-1px) scale(1.08);
  box-shadow: 0 6px 16px rgba(var(--primary-rgb) / 0.28);
}

.setup-opt.custom-opt {
  border-style: dashed;
}

.setup-custom-wrap {
  margin-top: 6px;
  width: 100%;
}

.setup-custom-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--primary);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.82rem;
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb) / 0.12);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.setup-custom-input:focus {
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb) / 0.24);
}

.check-icon {
  animation: setupCheckPop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes setupCheckPop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

@media (max-width: 720px) {
  .setup-groups {
    grid-template-columns: 1fr;
  }
  .setup-group.full-width {
    grid-column: auto;
  }
  .setup-container {
    padding: 20px 18px;
  }
}
/* AI Reply Zone on Output */
.reply-card {
  width: 100%;
  min-height: 100%;
  background-color: var(--surface-bright);
  padding: 14px 14px 40px;
  display: flex;
  flex-direction: column;
  position: relative;
}

/* 选中正文的悬浮精修面板：固定定位跟随选区视口坐标，
   悬浮面板样式呈现（毛玻璃卡片感），最高浮层避免被正文覆盖。 */
.floating-refine-panel {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 280px;
  max-width: min(520px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 10px 14px;
  background-color: color-mix(in srgb, var(--surface-container-low) 88%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--outline-variant);
  border-radius: 14px;
  box-shadow: 0 12px 32px -6px rgba(0, 0, 0, 0.22), 0 4px 12px -2px rgba(0, 0, 0, 0.08);
}

.top-refine-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-title-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary);
}

.wand-icon {
  color: var(--primary);
}

.refine-action-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.refine-tag-btn {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.775rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.refine-tag-btn:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  color: var(--primary);
}

.refine-tag-btn.active {
  border-color: var(--primary);
  background-color: var(--primary);
  color: #ffffff;
}

.refine-input-card {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--outline-variant);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.refine-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.775rem;
}

.refine-mode-label {
  font-weight: 700;
  color: var(--primary);
}

.selected-text-preview {
  color: var(--on-surface-variant);
  opacity: 0.8;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refine-prompt-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.85rem;
  outline: none;
  resize: vertical;
}

.refine-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  background-color: var(--primary);
  color: #fff;
  font-size: 0.775rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
}

.btn-secondary-sm {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  background-color: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface);
  font-size: 0.775rem;
  cursor: pointer;
}

/* AI 改写辅助建议块 (Diff 补助建议浮层，就近锚定在选中文本附近) */
.floating-refine-diff-card,
.refine-diff-card {
  position: fixed;
  z-index: 1005;
  border: 1px solid rgba(var(--primary-rgb) / 0.38);
  border-radius: 12px;
  background: var(--surface-container-low);
  backdrop-filter: blur(16px);
  overflow: hidden;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18), 0 4px 14px rgba(0, 0, 0, 0.08);
  animation: refineDiffSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: 480px;
  display: flex;
  flex-direction: column;
}

@keyframes refineDiffSlideIn {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.refine-diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(var(--primary-rgb) / 0.09);
  border-bottom: 1px solid rgba(var(--primary-rgb) / 0.16);
  user-select: none;
  flex-shrink: 0;
}

.refine-diff-head.is-draggable {
  cursor: grab;
}

.refine-diff-head.is-draggable:active {
  cursor: grabbing;
}

.floating-refine-diff-card.is-user-dragged {
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.26), 0 6px 20px rgba(0, 0, 0, 0.14);
}

.refine-diff-drag-handle {
  color: var(--primary);
  opacity: 0.7;
  cursor: grab;
  margin-right: -2px;
}

.refine-diff-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--primary);
  flex-wrap: wrap;
}

.refine-diff-icon {
  color: var(--primary);
}

.refine-diff-action-tag {
  font-weight: 700;
}

.refine-diff-tip {
  font-size: 0.73rem;
  font-weight: normal;
  color: var(--on-surface-variant);
  opacity: 0.8;
}

.refine-diff-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.refine-diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 11px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
}

.refine-diff-btn.accept {
  background: #0b7a3b;
  color: #ffffff;
  border: 1px solid #096330;
  box-shadow: 0 1px 4px rgba(11, 122, 59, 0.25);
}

.refine-diff-btn.accept:hover {
  background: #0d8f45;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(11, 122, 59, 0.35);
}

.refine-diff-btn.reject {
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
}

.refine-diff-btn.reject:hover {
  background: rgba(220, 53, 69, 0.08);
  color: #dc3545;
  border-color: rgba(220, 53, 69, 0.3);
}

.refine-diff-btn.reset-pos {
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
  opacity: 0.9;
}

.refine-diff-btn.reset-pos:hover {
  background: var(--surface-container-highest);
  color: var(--primary);
  border-color: rgba(var(--primary-rgb) / 0.3);
}

.refine-diff-body {
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  font-size: 0.88rem;
  line-height: 1.75;
  overflow-y: auto;
  max-height: 380px;
}

.refine-diff-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.diff-tag-col {
  flex-shrink: 0;
}

.diff-badge {
  display: inline-block;
  font-size: 0.72rem;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 600;
  white-space: nowrap;
  margin-top: 2px;
}

.diff-badge.diff-del {
  background: rgba(220, 53, 69, 0.12);
  color: #dc3545;
}

.diff-badge.diff-add {
  background: rgba(11, 122, 59, 0.12);
  color: #0b7a3b;
}

.diff-text-col {
  flex: 1;
  word-break: break-word;
  white-space: pre-wrap;
}

.diff-text-del {
  color: var(--on-surface-variant);
  text-decoration: line-through;
  opacity: 0.75;
}

.diff-text-add {
  color: var(--on-surface);
  font-weight: 500;
}

.diff-separator {
  height: 1px;
  background: var(--outline-variant);
  opacity: 0.4;
}

/* 自定义右键菜单样式（剪切、复制、粘贴、删除、全选） */
.custom-context-menu {
  position: fixed;
  z-index: 10000;
  min-width: 170px;
  background: var(--surface-container-low);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  user-select: none;
  animation: contextMenuPop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes contextMenuPop {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.context-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 6px 10px;
  border-radius: 6px;
  border: none;
  background: transparent;
  color: var(--on-surface);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.12s ease, color 0.12s ease;
  text-align: left;
}

.context-menu-item:hover:not(:disabled):not(.disabled) {
  background: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.context-menu-item.danger-item:hover:not(:disabled):not(.disabled) {
  background: rgba(220, 53, 69, 0.12);
  color: #dc3545;
}

.context-menu-item:disabled,
.context-menu-item.disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

/* 「功能」带二级菜单的菜单项：右侧小箭头指示可展开。 */
.context-menu-item.items-has-sub .menu-item-sub-arrow {
  display: inline-flex;
  align-items: center;
  color: var(--on-surface-variant);
  opacity: 0.7;
  margin-left: 14px;
}

.menu-item-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 17px;
  height: 15px;
  border: 1px solid currentColor;
  border-radius: 3px;
  font-size: 0.62rem;
  font-weight: 600;
  line-height: 1;
  flex-shrink: 0;
  color: inherit;
  opacity: 0.8;
}

.menu-item-glyph.caps {
  border-color: transparent;
  font-size: 0.7rem;
}

/* 右键菜单「功能」二级菜单面板：独立浮层，定位在「功能」按钮右侧。 */
.context-menu-submenu {
  position: fixed;
  z-index: 10001;
  min-width: 168px;
  background: var(--surface-container-low);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.22), 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  user-select: none;
  animation: contextMenuPop 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}

.context-menu-submenu-head {
  padding: 4px 10px 6px;
  font-size: 0.68rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--on-surface-variant);
  opacity: 0.7;
  border-bottom: 1px solid var(--outline-variant);
  margin-bottom: 3px;
}

.context-menu-submenu .context-menu-item {
  white-space: nowrap;
}

.context-menu-submenu .context-menu-item .menu-item-left {
  flex: 1;
}

.menu-item-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.menu-item-icon {
  flex-shrink: 0;
  color: inherit;
  opacity: 0.85;
}

.menu-item-shortcut {
  font-size: 0.72rem;
  color: var(--on-surface-variant);
  opacity: 0.65;
  font-family: inherit;
  margin-left: 14px;
}

.context-menu-divider {
  height: 1px;
  background: var(--outline-variant);
  opacity: 0.5;
  margin: 3px 2px;
}

.top-fixed-toolbar,
.reply-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
  z-index: 20;
  transition: opacity 0.25s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.2s ease, box-shadow 0.2s ease;
}

.top-fixed-toolbar.scrolling-dimmed {
  opacity: 0.32;
}

.top-fixed-toolbar.scrolling-dimmed:hover {
  opacity: 1;
}

.reply-badge {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-icon {
  color: var(--primary);
}

.badge-model {
  font-size: 0.8rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--primary);
}

.badge-mode {
  font-size: 0.75rem;
  padding: 2px 8px;
  border-radius: 9999px;
  background-color: var(--surface-container-high);
  color: var(--on-surface-variant);
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mini-icon-btn.active {
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

/* 「内容上色」切换按钮：与文档界面预览区同款观感（同一套开关，同一套外观）。 */
.color-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
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

/* 「线性 / 翻页」切换按钮：位于内容上色左侧，同等视觉层级 */
.chat-layout-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.chat-layout-toggle-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.chat-layout-toggle-btn.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-fixed);
}

/* ---------------- 同排整理（历史下拉已移除，历史由独立页面承载） ---------------- */

.mini-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mini-icon-btn:hover {
  background-color: var(--surface-container-high);
  color: var(--on-surface);
}

.mini-icon-btn.danger:hover {
  background-color: var(--error-container, #fee2e2);
  color: var(--error, #ef4444);
}

.reply-body-wrap {
  flex: 1;
  display: flex;
  flex-direction: column;
}

/* Turn List: 中间区按时间顺序保留的全部 AI 产出条目 */
.turn-list {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 12px 18px 140px;
}

.turn-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 20px 20px;
  border: 1px solid var(--outline-variant);
  border-radius: 14px;
  background-color: var(--surface-bright);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
  margin-bottom: 16px;
  box-sizing: border-box;
  user-select: text;
  -webkit-user-select: text;
}

.turn-card:last-child {
  margin-bottom: 54px;
}

.turn-card.is-current {
  border-color: rgba(var(--primary-rgb) / 0.45);
  box-shadow: 0 0 0 1px rgba(var(--primary-rgb) / 0.18), 0 4px 16px rgba(0, 0, 0, 0.04);
}

.turn-card.is-selected {
  border-color: var(--primary);
  box-shadow: 0 0 0 1.5px var(--primary);
}

.turn-head {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.turn-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--primary);
}

.turn-title svg {
  flex-shrink: 0;
}

.turn-time {
  font-size: 0.72rem;
  color: var(--on-surface-variant);
  opacity: 0.75;
  flex-shrink: 0;
}

/* 每条 AI 回复标题栏右侧的专属操作按钮（应用到文档 / 复制全文 / 编辑正文）。 */
.turn-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.turn-head-actions .mini-icon-btn {
  width: 25px;
  height: 25px;
}

.turn-head-actions .mini-icon-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

/* ---------------- 「一键排版」下拉面板（复刻文档顶部工具栏 toolbar-menu） ----------------
   挂在该条回复标题栏右下角，作用对象是被点击的那一条产出的正文。
   配色完全对齐文档界面的 toolbar-menu / format-menu：surface-bright 面板底色、
   surface-container-high 悬停、primary 强调、232px 固定宽。 */
.auto-format-menu {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 60;
  width: 232px;
  max-height: min(520px, calc(100vh - 90px));
  overflow-y: auto;
  padding: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px -2px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  user-select: none;
}

.auto-format-item {
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

.auto-format-item > span:first-of-type {
  flex: 1;
  min-width: 0;
}

.auto-format-item:hover {
  background: var(--surface-container-high);
}

.auto-format-item.on {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.auto-format-syntax {
  flex-shrink: 0;
  font-family: var(--code-font);
  font-size: 10px;
  color: var(--on-surface-variant);
}

.auto-format-item.on .auto-format-syntax {
  color: var(--primary);
}

.auto-format-divider {
  height: 1px;
  margin: 4px 2px;
  background: var(--outline-variant);
  opacity: 0.7;
}

.auto-format-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px 8px 6px;
}

.auto-format-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--on-surface);
}

.auto-format-section-tip {
  font-size: 10px;
  line-height: 1.4;
  color: var(--on-surface-variant);
}

/* 会随模式 / 勾选换文案的说明：锁死两行高度，换句话不撑动面板。 */
.auto-format-section-tip.tip-slot {
  height: 28px;
  overflow: hidden;
}

.auto-format-section-tip.warn {
  color: var(--primary);
  opacity: 0.85;
}

/* 随机排版的两个滑块：紧贴在「随机排版」下面，读作它的参数。 */
.rl-section {
  gap: 4px;
  padding-top: 2px;
}

.rl-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 18px;
}

.rl-label {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.rl-slider {
  flex: 1;
  min-width: 0;
  height: 16px;
  margin: 0;
  accent-color: var(--primary);
  cursor: pointer;
}

.rl-value {
  flex-shrink: 0;
  width: 36px;
  text-align: right;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: var(--primary);
}

/* 清理模式：智能保留 / 全部删除，两段式开关。 */
.mode-switch {
  display: flex;
  padding: 2px;
  border-radius: 6px;
  background: var(--surface-container-high);
}

.mode-seg {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.mode-seg.on {
  background: var(--surface-bright, #ffffff);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

/* 去的地得：可多选的字胶囊 */
.de-pill-group {
  display: flex;
  gap: 6px;
}

.de-pill {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.de-pill:hover {
  background: var(--surface-container-high);
}

.de-pill.on {
  border-color: rgb(var(--primary-rgb) / 0.45);
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.de-clean-btn {
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 6px;
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-size: 11px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.de-clean-btn:hover:not(:disabled) {
  background: rgb(var(--primary-rgb) / 0.2);
}

.de-clean-btn:disabled {
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
  cursor: not-allowed;
}

/* ---------------- 「排版与字体」悬浮面板（复刻文档顶部工具栏） ----------------
   全局排版字段（aiSettings.editorFontSize / LineHeight / MarginX / MarginY /
   GridLine / appFont / 段首样式）与文档界面同一套，改一处两处 WYSIWYG 同步；
   控件观感（下拉 / 数字输入 / 缩进·首字切换）逐条对齐文档界面的 typography-panel。 */
.auto-typo-panel {
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 61;
  width: 250px;
  max-height: min(560px, calc(100vh - 90px));
  overflow-y: auto;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 10px 30px -4px rgba(0, 0, 0, 0.2), 0 3px 8px rgba(0, 0, 0, 0.08);
  user-select: none;
}

.auto-typo-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--outline-variant);
}

.auto-typo-panel-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.auto-typo-reset-btn {
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

.auto-typo-reset-btn:hover {
  background: rgb(var(--primary-rgb) / 0.16);
  border-color: var(--primary);
}

.auto-typo-panel-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.auto-typo-field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.auto-typo-field-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface-variant, #666);
  white-space: nowrap;
}

.auto-typo-select,
.auto-typo-input {
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

.auto-typo-select {
  flex: 1;
  min-width: 0;
  cursor: pointer;
}

.auto-typo-select:focus,
.auto-typo-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgb(var(--primary-rgb) / 0.15);
}

.auto-typo-input-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100px;
}

.auto-typo-input-wrap .auto-typo-input {
  width: 100%;
  flex: 1;
  min-width: 0;
  text-align: right;
}

.auto-typo-input[type="number"] {
  width: 100px;
  text-align: right;
}

.auto-typo-unit {
  font-size: 11px;
  color: var(--on-surface-variant, #888);
}

/* 段首样式：缩进 / 首字 —— 与文档界面同款独立描边按钮，激活时主色描边 + 淡主底色。 */
.auto-typo-toggle-group {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  justify-content: flex-end;
}

.auto-typo-toggle-btn {
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

.auto-typo-toggle-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.auto-typo-toggle-btn.active {
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.1);
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgb(var(--primary-rgb) / 0.12);
}

/* 知识项工具活动轨迹 */
.tool-trace-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-trace-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 9px;
  border-radius: 9999px;
  font-size: 0.72rem;
  font-weight: 500;
  color: var(--on-surface-variant);
  background-color: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
}

.tool-trace-chip.done {
  color: var(--primary);
  border-color: rgba(var(--primary-rgb) / 0.3);
  background-color: rgba(var(--primary-rgb) / 0.06);
}

.trace-check {
  color: var(--primary);
  flex-shrink: 0;
}

.trace-spin {
  color: var(--primary);
  flex-shrink: 0;
  animation: turn-trace-spin 1s linear infinite;
}

@keyframes turn-trace-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* Thinking Panel */
.thinking-panel {
  margin-bottom: 16px;
  border: 1px dashed var(--outline-variant);
  border-radius: 10px;
  background: var(--surface-container-low);
  overflow: hidden;
}

.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 12px;
  color: var(--on-surface-variant);
  font-size: 0.8rem;
  font-weight: 600;
  background: transparent;
  border: none;
  cursor: pointer;
  transition: background 0.15s ease;
}

.thinking-toggle:hover {
  background: var(--surface-container-high);
}

.thinking-toggle svg {
  flex-shrink: 0;
  color: var(--primary);
}

.thinking-label {
  display: inline-block;
  transition: color 0.15s ease;
}

.thinking-label.is-thinking {
  color: var(--primary);
  animation: typingPulse 1.4s infinite ease-in-out;
}

.thinking-badge {
  margin-left: auto;
  font-weight: 400;
  opacity: 0.75;
  font-size: 0.75rem;
}

.thinking-body {
  padding: 10px 14px;
  border-top: 1px dashed var(--outline-variant);
  font-size: 0.85rem;
  line-height: 1.65;
  color: var(--on-surface-variant);
  white-space: pre-wrap;
}

/* 思考链按步分段：每步独立成卡，带步骤名与推进状态。 */
.think-steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.think-step {
  border: 1px solid var(--outline-variant);
  border-left: 3px solid var(--primary);
  border-radius: 8px;
  background: var(--surface-bright);
  padding: 8px 10px;
}

.think-step.is-streaming {
  border-left-color: var(--primary);
  border-left-style: solid;
  box-shadow: 0 0 0 1px rgba(var(--primary-rgb) / 0.25);
}

.think-step-head {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  border-radius: 6px;
}

.think-step-head:hover .think-step-name {
  color: var(--primary);
}

.think-step-arrow {
  color: var(--primary);
  opacity: 0.65;
  flex-shrink: 0;
  transition: transform 0.15s ease;
  transform: rotate(90deg);
}

.think-step.collapsed .think-step-arrow {
  transform: rotate(0deg);
  opacity: 0.4;
}

.think-step.collapsed {
  border-left-color: var(--outline-variant);
  opacity: 0.9;
}

.think-step.is-streaming .think-step-arrow {
  animation: stepArrowPulse 1.1s ease-in-out infinite;
}

@keyframes stepArrowPulse {
  0%, 100% { opacity: 0.3; transform: rotate(90deg) translateX(-1px); }
  50% { opacity: 1; transform: rotate(90deg) translateX(2px); }
}

.think-step-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--on-surface);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.think-step-state {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 8px;
  border-radius: 999px;
}

.think-step-state.done {
  color: #0b7a3b;
  background: rgba(11, 122, 59, 0.12);
}

.think-step-state.thinking {
  color: var(--primary);
  background: rgba(var(--primary-rgb) / 0.1);
  animation: typingPulse 1.4s infinite ease-in-out;
}

.think-step-content {
  margin-top: 6px;
  font-size: 0.8rem;
  line-height: 1.6;
  color: var(--on-surface-variant);
  white-space: pre-wrap;
  word-break: break-word;
}

/* AI 抛出的点选选项：可点击的「向 AI 回复」胶囊。 */
.choice-reply-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
}

.choice-reply-label {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.choice-reply-icon {
  color: var(--primary);
}

.choice-reply-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  max-width: 280px;
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid rgba(var(--primary-rgb) / 0.4);
  background: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 0.78rem;
  font-weight: 600;
  line-height: 1.4;
  text-align: left;
  cursor: pointer;
  transition: all 0.15s ease;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.choice-reply-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.choice-reply-send {
  flex-shrink: 0;
}

/* Typing Indicator */
.typing-indicator-box {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 0;
}

.typing-indicator-box .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--outline);
  animation: typingPulse 1.4s infinite ease-in-out;
}

.typing-indicator-box .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator-box .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typingPulse {
  0%, 60%, 100% {
    opacity: 0.3;
    transform: scale(0.85);
  }
  30% {
    opacity: 1;
    transform: scale(1);
  }
}

/* Rendered Article
   正文颜色交给 .markdown-body.reading-view（未上色）与
   .reading-view.content-colored（上色时的 --zj-body）—— 这里再写一条 color
   会和它们同权重打架，把内容上色的正文色顶掉，所以只留排版尺寸。 */
.article-render {
  flex: 1;
  font-size: 1.05rem;
  line-height: 1.85;
}

/* ---------------- AI 回复正文 WYSIWYG 原地编辑 ----------------
   与「文档」界面 WYSIWYG（MarkdownWysiwyg.vue）同一套块级结构与语法折叠机制，
   字号 / 字体 / 行距 / 段首样式 / 网格线也共用同一批 aiSettings 排版字段。
   只是不套独立滚动容器，直接铺在回复卡片内。文本节点由 markdownToLiveHtml
   动态注入，scoped 样式需用 :deep() 穿透匹配。 */
.auto-wysiwyg-body {
  outline: none;
  cursor: text;
  word-break: break-word;
  padding-bottom: 16px;
  user-select: text !important;
  -webkit-user-select: text !important;
}

.auto-wysiwyg-body.is-blank-wysiwyg {
  padding-bottom: 24px;
}

.turn-rendered-content,
.turn-rendered-content * {
  user-select: text;
  -webkit-user-select: text;
}

/* 无内容时的占位提示（contenteditable 空态）。 */
.auto-wysiwyg-body:empty::before {
  content: attr(data-placeholder);
  color: var(--reading-text-faint, #c6cad2);
  pointer-events: none;
  font-size: 0.95em;
  opacity: 0.8;
}

.auto-wysiwyg-body.is-readonly {
  cursor: default;
}

/* 背景网格线（排版与字体 → 网格线）：与文档界面同一套三类网格，
   以 --ed-line-height-px（= 字号 × 行距）为行距逐行落下。 */
.auto-wysiwyg-body.grid-line-solid {
  background-image: linear-gradient(
    to bottom,
    transparent calc(100% - 1px),
    var(--grid-line-color, rgba(140, 140, 140, 0.35)) 1px
  );
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 0;
  background-attachment: local;
  background-repeat: repeat-y;
}

.auto-wysiwyg-body.grid-line-dashed {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' overflow='visible'%3E%3Cline x1='0' y1='calc(100%25 - 0.5px)' x2='100%25' y2='calc(100%25 - 0.5px)' stroke='rgba(120, 120, 120, 0.55)' stroke-width='1' stroke-dasharray='6 3' shape-rendering='crispEdges'/%3E%3C/svg%3E");
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 0;
  background-attachment: local;
  background-repeat: repeat-y;
}

.auto-wysiwyg-body.grid-line-dotted {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' overflow='visible'%3E%3Cline x1='0' y1='calc(100%25 - 0.5px)' x2='100%25' y2='calc(100%25 - 0.5px)' stroke='rgba(110, 110, 110, 0.65)' stroke-width='1.2' stroke-dasharray='2 3' shape-rendering='crispEdges'/%3E%3C/svg%3E");
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 0;
  background-attachment: local;
  background-repeat: repeat-y;
}

/* 块级容器：与文档 WYSIWYG 一致，每个物理行为一个可编辑块。 */
.auto-wysiwyg-body :deep(.md-block) {
  position: relative;
}

.auto-wysiwyg-body :deep(.md-block.md-p) {
  margin: 0;
  line-height: inherit;
  min-height: 1em;
}

.auto-wysiwyg-body :deep(.md-block.md-p.md-empty) {
  margin: 0;
  min-height: calc(var(--ed-line-height-px, 1.5em));
}

.auto-wysiwyg-body :deep(.md-block:first-child) {
  margin-top: 0;
}

.auto-wysiwyg-body :deep(.md-block:last-child) {
  margin-bottom: 0;
}

/* 语法折叠：默认隐藏，光标所在行 / 行内元素激活时原位暴露 Markdown 语法。 */
.auto-wysiwyg-body :deep(.md-syntax) {
  display: none;
  font-family: var(--code-font);
  color: var(--primary);
  opacity: 0.65;
  font-size: 0.9em;
  font-weight: normal;
  font-style: normal;
  letter-spacing: 0;
  vertical-align: baseline;
  user-select: text;
  -webkit-user-select: text;
}

.auto-wysiwyg-body :deep(.md-block.is-focused > .md-syntax),
.auto-wysiwyg-body :deep(.md-block.is-focused .md-syntax),
.auto-wysiwyg-body :deep(.md-inline.is-focused .md-syntax) {
  display: inline;
}

/* 激活块给一层微弱的呼吸底色，标明当前光标所在行。 */
.auto-wysiwyg-body :deep(.md-block.is-focused) {
  background: rgb(var(--primary-rgb) / 0.03);
  border-radius: 4px;
}

/* 列表：div 承载，缩进与项目符号自绘，间距对齐 .reading-view li。 */
.auto-wysiwyg-body :deep(.md-list-item) {
  position: relative;
  margin: 0.28em 0;
  padding-left: 1.8em;
  line-height: inherit;
  box-sizing: border-box;
}

.auto-wysiwyg-body :deep(.md-list-item + .md-p),
.auto-wysiwyg-body :deep(.md-p + .md-list-item) {
  margin-top: 0.9em;
}

/* 非聚焦状态：项目符号与序号放置在左侧槽位，多行排版自然对齐，避免负 text-indent 导致语法溢出 */
.auto-wysiwyg-body :deep(.md-bullet),
.auto-wysiwyg-body :deep(.md-number) {
  position: absolute;
  left: 0;
  top: 0;
  width: 1.5em;
  text-align: left;
  color: var(--primary);
  user-select: none;
  pointer-events: none;
  line-height: inherit;
}

.auto-wysiwyg-body :deep(.md-bullet) {
  text-align: center;
}

/* 聚焦编辑状态：暴露原生 Markdown 序列语法（如 - / * / 1. / 2. 等），折叠项目符号；
   切换为安全内边距与正常行内布局，确保 Markdown 语法代码完整呈现在文本左侧，绝不溢出左侧边框 */
.auto-wysiwyg-body :deep(.md-block.is-focused.md-list-item),
.auto-wysiwyg-body :deep(.md-list-item.is-focused) {
  padding-left: 0.5em;
  padding-right: 0.5em;
}

.auto-wysiwyg-body :deep(.md-block.is-focused .md-bullet),
.auto-wysiwyg-body :deep(.md-block.is-focused .md-number) {
  display: none;
}

.auto-wysiwyg-body :deep(.md-block.is-focused.md-list-item > .md-syntax),
.auto-wysiwyg-body :deep(.md-list-item.is-focused > .md-syntax) {
  display: inline;
  font-family: var(--code-font);
  color: var(--primary);
  font-weight: 600;
  margin-right: 4px;
}

/* 引用块 / 分割线 / 代码围栏。 */
.auto-wysiwyg-body :deep(.md-quote) {
  margin: 1.15em 0;
}

.auto-wysiwyg-body :deep(.md-quote .md-content) {
  display: inline;
}

.auto-wysiwyg-body :deep(.md-hr) {
  margin: 1.9em 0;
  line-height: 1;
}

.auto-wysiwyg-body :deep(.md-hr hr) {
  margin: 0;
  border: none;
  border-top: 1px solid var(--reading-border, #e6e6e6);
}

.auto-wysiwyg-body :deep(.md-hr.is-focused hr) {
  display: none;
}

.auto-wysiwyg-body :deep(.md-code-block) {
  margin: 1.2em 0;
}

.auto-wysiwyg-body :deep(.md-code-block code) {
  display: block;
  white-space: pre-wrap;
}

.auto-wysiwyg-body :deep(.code-fence-top),
.auto-wysiwyg-body :deep(.code-fence-bottom) {
  display: none;
  color: var(--reading-text-faint, #c6cad2);
  font-size: 11px;
}

.auto-wysiwyg-body :deep(.md-block.is-focused .code-fence-top),
.auto-wysiwyg-body :deep(.md-block.is-focused .code-fence-bottom) {
  display: block;
}

/* 表格：与文档 WYSIWYG 一致，分隔行默认隐藏、聚焦时暴露。 */
.auto-wysiwyg-body :deep(.md-table) {
  margin: 1.2em 0;
}

.auto-wysiwyg-body :deep(.md-table table) {
  width: 100%;
  border-collapse: collapse;
}

.auto-wysiwyg-body :deep(.md-table th),
.auto-wysiwyg-body :deep(.md-table td) {
  border: 1px solid var(--reading-border, #e6e6e6);
  padding: 6px 10px;
  text-align: left;
  vertical-align: top;
}

.auto-wysiwyg-body :deep(.md-table th) {
  background: var(--surface-container-low);
  font-weight: 600;
}

.auto-wysiwyg-body :deep(.md-table .md-content) {
  display: inline;
}

.auto-wysiwyg-body :deep(.md-table .md-tbl-sep) {
  display: none;
}

.auto-wysiwyg-body :deep(.md-table.is-focused .md-tbl-sep) {
  display: table-row;
}

.auto-wysiwyg-body :deep(.md-table .md-tbl-sep-cell) {
  padding: 0 10px;
  font-size: 0.9em;
}

/* Incomplete Bar */
.incomplete-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 16px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-container-low);
  border: 1px dashed var(--outline);
}

.incomplete-text {
  font-size: 0.8rem;
  color: var(--on-surface-variant);
}

.incomplete-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  background-color: var(--primary);
  color: #fff;
  border: none;
  font-size: 0.775rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.incomplete-btn:hover {
  opacity: 0.9;
}

/* Reply Footer Meta: Tokens (Left), Variant Actions (Center), Time (Right) - 统一同一行内排布 */
.reply-footer-meta {
  margin-top: 18px;
  margin-bottom: 12px;
  padding-top: 12px;
  padding-bottom: 6px;
  border-top: 1px solid var(--outline-variant);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 0.75rem;
  color: var(--on-surface-variant);
  flex-wrap: nowrap;
  width: 100%;
}

.footer-left-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  white-space: nowrap;
}

.footer-variant-actions-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: 0 4px;
}

.footer-variant-actions-row::-webkit-scrollbar {
  display: none;
}

.turn-pagination-bar {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  height: 26px;
  padding: 0 4px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
  color: var(--on-surface);
  flex-shrink: 0;
  user-select: none;
}

.turn-page-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
  padding: 0;
}

.turn-page-btn:hover:not(:disabled) {
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.turn-page-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.turn-page-indicator {
  padding: 0 4px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--on-surface);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.5px;
}

.turn-head-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.turn-head-version-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  border: 1px solid rgba(var(--primary-rgb) / 0.2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.footer-variant-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex-wrap: nowrap;
  flex-shrink: 0;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  padding: 0 2px;
}

.footer-variant-actions::-webkit-scrollbar {
  display: none;
}

.message-timestamp {
  flex-shrink: 0;
  white-space: nowrap;
}

.variant-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
  color: var(--on-surface);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  flex-shrink: 0;
  user-select: none;
}

.variant-btn:hover:not(:disabled) {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  color: var(--primary);
}

.variant-btn.primary {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.variant-btn.primary:hover:not(:disabled) {
  background-color: var(--primary);
  color: #fff;
}

.variant-btn.next-chapter-btn {
  border-color: rgba(var(--primary-rgb) / 0.45);
  background-color: rgba(var(--primary-rgb) / 0.09);
  color: var(--primary);
  font-weight: 600;
}

.variant-btn.next-chapter-btn:hover:not(:disabled) {
  background-color: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.variant-btn.next-chapter-btn.is-disabled,
.variant-btn.next-chapter-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  border-color: var(--outline-variant);
  background-color: var(--surface-container-low);
  color: var(--on-surface-variant);
}

.next-chapter-wrap {
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
}

/* "下一章" 禁用说明气泡：固定定位，悬停时浮现在按钮上方。 */
.next-chapter-tooltip {
  position: fixed;
  z-index: 1000;
  width: 260px;
  padding: 9px 11px;
  border-radius: 9px;
  background-color: var(--surface-container-high);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.22);
  font-size: 0.75rem;
  line-height: 1.55;
  pointer-events: none;
  transform: translate(-50%, -100%);
  white-space: pre-line;
}

.next-chapter-tooltip::after {
  content: "";
  position: absolute;
  left: 50%;
  bottom: -6px;
  transform: translateX(-50%);
  border: 6px solid transparent;
  border-top-color: var(--surface-container-high);
  border-bottom: none;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
}

.variant-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.btn-outline-action.stopping-btn {
  border-color: #d97706;
  background-color: rgba(217, 119, 6, 0.14);
  color: #b45309;
}

.btn-outline-action.stopping-btn:hover:not(:disabled) {
  background-color: rgba(217, 119, 6, 0.24);
}

/* 顶部操作区按钮：新建空白、新建创作、历史对话醒目区分呈现 */
.top-blank-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  border-radius: 6px;
  background: rgba(16, 185, 129, 0.08);
  color: #059669;
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.top-blank-btn:hover {
  background: rgba(16, 185, 129, 0.18);
  border-color: #059669;
  box-shadow: 0 1px 4px rgba(16, 185, 129, 0.2);
}

.top-new-creation-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid rgba(var(--primary-rgb) / 0.4);
  border-radius: 6px;
  background: rgba(var(--primary-rgb) / 0.08);
  color: var(--primary);
  font-size: 11px;
  font-weight: 700;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.top-new-creation-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb) / 0.18);
  border-color: var(--primary);
  box-shadow: 0 1px 4px rgba(var(--primary-rgb) / 0.2);
}

.top-new-creation-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.top-history-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.top-history-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

/* 设定面板中的新建空白按钮 */
.setup-blank-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  background-color: rgba(16, 185, 129, 0.1);
  color: #059669;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-blank-btn:hover {
  background-color: rgba(16, 185, 129, 0.2);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
  border-color: #059669;
}

/* 字符统计标签 */
.token-widget.char-widget {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.3);
}

.token-widget.char-widget svg {
  color: #059669;
}

.token-widget.char-widget strong {
  color: #059669;
}

.token-widget {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  font-size: 0.75rem;
}

.token-widget svg {
  color: var(--primary);
}

.token-widget strong {
  color: var(--primary);
  font-family: var(--code-font);
}

.continued-widget {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 9999px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  font-size: 0.75rem;
}

/* ---------------- 中间区域最底部悬浮按钮 ---------------- */
.scroll-bottom-btn {
  position: absolute;
  right: 28px;
  bottom: 24px;
  z-index: 50;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 16px;
  border-radius: 9999px;
  background-color: var(--primary);
  color: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.25);
  font-size: 0.775rem;
  font-weight: 600;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1),
              box-shadow 0.18s ease,
              opacity 0.18s ease;
  user-select: none;
}

.scroll-bottom-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.26);
  opacity: 0.96;
}

.scroll-bottom-btn:active {
  transform: translateY(0);
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: opacity 0.2s ease, transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

/* ---------------- 历史对话页（全部上下文对话，卡片式） ---------------- */
.auto-history-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--surface-bright);
}

.history-page-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 26px;
  border-bottom: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
}

.history-page-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--on-surface);
}

.history-page-icon {
  color: var(--primary);
}

.history-page-count {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.history-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-back-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.05);
}

.history-page-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 26px 48px;
}

.history-page-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--on-surface-variant);
}

/* 折叠条目：默认一行标题；点行体跳回对话界面，点小箭头才展开完整上下文。 */
.history-entry {
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  background-color: var(--surface-bright);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.history-entry:hover {
  border-color: var(--primary);
}

.history-entry.expanded {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.history-entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  cursor: pointer;
  user-select: none;
}

.history-entry-row:hover {
  background-color: rgba(var(--primary-rgb) / 0.04);
}

.history-entry-icon {
  flex-shrink: 0;
  color: var(--primary);
}

.history-entry-title {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-entry-chars {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
}

.history-entry-time {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--on-surface-variant);
  opacity: 0.75;
}

.history-entry-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-entry-caret:hover {
  background-color: var(--surface-container-high);
  color: var(--primary);
}

.history-entry-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 16px 16px;
  border-top: 1px solid var(--outline-variant);
}

.history-card-tokens {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.history-card-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-card-del:hover {
  color: var(--error, #ef4444);
  background-color: rgba(239, 68, 68, 0.1);
}

.history-prompt,
.history-reasoning {
  border: 1px dashed var(--outline-variant);
  border-radius: 10px;
  background-color: var(--surface-container-low);
  overflow: hidden;
}

.history-prompt-summary,
.history-reasoning-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--on-surface-variant);
  cursor: pointer;
  user-select: none;
}

.history-prompt-summary svg,
.history-reasoning-summary svg {
  flex-shrink: 0;
  color: var(--primary);
}

.history-prompt-body,
.history-reasoning-body {
  margin: 0;
  padding: 10px 12px;
  border-top: 1px dashed var(--outline-variant);
  font-family: inherit;
  font-size: 0.8rem;
  line-height: 1.65;
  color: var(--on-surface-variant);
  white-space: pre-wrap;
  word-break: break-word;
}

.history-card-body {
  line-height: 1.75;
}

.history-incomplete {
  font-size: 0.75rem;
  color: var(--error, #ef4444);
  opacity: 0.85;
}

.history-continued {
  font-size: 0.75rem;
  color: var(--on-surface-variant);
  opacity: 0.8;
}

/* ---------------- 最底部按钮：压到文字上时自动降透明度 ---------------- */
.scroll-bottom-btn.see-through {
  opacity: 0.5;
}

.scroll-bottom-btn.see-through:hover {
  opacity: 0.72;
}

/* 读者评估雷达图卡片：套用本界面主题变量，替换 ReaderCard 的默认配色。 */
.reader-result-inline {
  margin: 16px 0;
}

.reader-result-inline :deep(.reader-card) {
  border-color: var(--outline-variant);
  background: var(--surface-container-low);
}

.reader-result-inline :deep(.reader-card-title) {
  color: var(--on-surface-variant);
}

.reader-result-inline :deep(.reader-one-liner) {
  color: var(--on-surface);
}

.reader-result-inline :deep(.reader-score-item) {
  background: var(--surface-bright);
}

.reader-result-inline :deep(.reader-score-label) {
  color: var(--on-surface-variant);
}

.reader-result-inline :deep(.reader-score-value) {
  color: var(--on-surface);
}

.reader-result-inline :deep(.reader-list li) {
  color: var(--on-surface);
}

.reader-result-inline :deep(.reader-list.complaint li) {
  color: var(--error, #ef4444);
}

/* ---------------- 翻页对话布局组件与左右浮动按钮 ---------------- */
.turn-list.is-paged {
  position: relative;
  min-height: 280px;
}

.paged-conversation-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  margin-bottom: 12px;
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  user-select: none;
}

.paged-nav-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.paged-nav-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
  background: rgba(var(--primary-rgb) / 0.08);
}

.paged-nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.paged-nav-center {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.paged-round-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}

.paged-round-badge {
  font-size: 12px;
  font-weight: 700;
  color: var(--primary);
  background: rgba(var(--primary-rgb) / 0.1);
  padding: 2px 8px;
  border-radius: 9999px;
}

.paged-round-summary {
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface-variant);
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.paged-pills-bar {
  display: flex;
  align-items: center;
  gap: 4px;
}

.paged-round-pill {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}

.paged-round-pill:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.paged-round-pill.active {
  background: var(--primary);
  color: var(--on-primary, #ffffff);
  border-color: var(--primary);
}

/* 浮动左右侧边翻页手柄 */
.floating-page-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 25;
  display: flex;
  align-items: center;
  gap: 2px;
  height: 48px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 24px;
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
  cursor: pointer;
  opacity: 0.8;
  transition: all 0.2s ease;
}

.floating-page-btn:hover {
  opacity: 1;
  color: var(--primary);
  border-color: var(--primary);
  background: var(--surface-bright);
  transform: translateY(-50%) scale(1.05);
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.14);
}

.floating-page-btn.side-prev {
  left: 6px;
}

.floating-page-btn.side-next {
  right: 6px;
}

.floating-page-label {
  font-size: 11px;
  font-weight: 600;
}

/* 翻页底部提示条 */
.paged-bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  margin-top: 14px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
}

.paged-bottom-hint {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.paged-bottom-hint strong {
  color: var(--primary);
  font-weight: 600;
}

/* ---------------- 查找与替换悬浮卡片面板 ---------------- */
.find-replace-panel {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 60;
  min-width: 320px;
  max-width: 440px;
  background: var(--surface-container-highest);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.find-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.find-input-box {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  padding: 0 6px;
  height: 28px;
  transition: border-color 0.15s ease;
}

.find-input-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.find-icon {
  color: var(--on-surface-variant);
  margin-right: 4px;
  flex-shrink: 0;
}

.find-replace-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--on-surface);
  font-size: 12px;
  min-width: 0;
}

.find-counter-badge {
  font-size: 10px;
  color: var(--on-surface-variant);
  white-space: nowrap;
  margin-left: 4px;
}

.find-actions-group {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.find-mini-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.12s ease;
}

.find-mini-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.find-mini-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.find-mini-btn.toggle.active {
  background: var(--primary-fixed);
  color: var(--primary);
  border-color: var(--primary);
}

.find-mini-btn.close:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.replace-buttons-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.replace-action-btn {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 4px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
}

.replace-action-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.replace-action-btn.primary {
  background: var(--primary);
  color: var(--on-primary, #ffffff);
  border-color: var(--primary);
}

.replace-action-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.replace-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
</style>
