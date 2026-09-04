<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { aiSettings, activateProviderProfile, providerLabel } from "../settings";
import { renderMarkdown } from "../markdown";
import { requestCreateCard, cardEvents, commitCardDrop, type DragCardPayload } from "../cardEvents";
import { startLongPressDrag } from "../longPressDrag";
import { commitDocEditorDrop, docEditorDrag } from "../docEditorDrop";
import { cardAttachments, removeCardAttachment, fileAttachments, addFileAttachment, removeFileAttachment } from "../attachments";
import { downloadTextFileWithDialog } from "../download";
import { docStore } from "../docStore";
import { documentFilesStore } from "../documentFilesStore";
import { pulseAiDocEdit } from "../aiDocActivity";
import { showToast } from "../insightStore";
import { WRITER_AGENT_NAME, WRITER_AGENT_PROMPT } from "../prompts/writerAgent";
import { AUDITOR_AGENT_NAME, AUDITOR_AGENT_PROMPT } from "../prompts/auditorAgent";
import { CHAT_AGENT_PROMPT } from "../prompts/chatAgent";
import {
  CHAT_CASUAL_GUARD,
  SLASH_COMMANDS,
  chatContinuationDirective,
  detectSlashCommand,
  identityTemplateMounted,
  isContinueRequest,
  makeSlashHit,
  slashCommandDirective,
  type ContinuationContext,
  type SlashCommand,
  type SlashCommandHit,
} from "../chatSlashCommands";
import { buildRAGInsightContext } from "../vectorStore";
import { looksUnfinished, runAgent, type AgentTurn } from "../agentRunner";
import { recordTokens, type TokenCategory } from "../tokenStore";
import {
  describeKnowledgeToolCall,
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
  cardToolDefinitions,
  describeCardToolCall,
  isCardTool,
  runCardTool,
} from "../cardTools";
import {
  describeDocToolCall,
  docToolDefinitions,
  isDocTool,
  runDocTool,
} from "../docTools";
import {
  materialStore,
  selectedMaterials,
  createMaterial,
  updateMaterial,
  toggleMaterial,
  removeMaterial,
} from "../materialStore";
import {
  NARRATIVE_GROUPS,
  buildNarrativeDirective,
  clearNarrativeSelection,
  isNarrativeSelected,
  narrativeChips,
  narrativeSelectedCount,
  narrativeStore,
  stripNarrativeTag,
  toggleNarrativeOption,
  type NarrativeChip,
  type NarrativeKind,
  type NarrativeScope,
} from "../narrativeStore";
import {
  STORY_GROUPS,
  buildStoryDirective,
  clearStorySelection,
  isStorySelected,
  storyChips,
  storyGroupCount,
  storySelectedCount,
  toggleStoryOption,
  type StoryChip,
  type StoryKind,
} from "../storyStore";
import {
  ArrowUp,
  BookOpen,
  BookOpenCheck,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  Copy,
  Download,
  Drama,
  FileText,
  Globe,
  GripVertical,
  Layers,
  Library,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRightClose,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Slash,
  Sparkles,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-vue-next";

defineEmits<{
  (e: "close"): void;
}>();

const props = defineProps<{
  activeMainTab?: "home" | "docs" | "library" | "refine" | "insight";
}>();

export type SidebarTab = "chat" | "writer" | "auditor";

const activeSidebarTab = ref<SidebarTab>("chat");

/**
 * 当前对话面板所属的工作区，决定 AI 能碰哪一个编辑区。
 *
 * 文档界面与写作画布各有自己的编辑区，两边必须解耦：在文档界面让 AI「分析
 * 这篇正文」，它就只能读文档条目；在画布界面才轮到文本卡片。此前两个界面
 * 共用同一套卡片工具，于是在文档界面提要求时 AI 只能去读画布卡片 —— 就是
 * 跨区错读的根因。
 *
 * "none"：洞察等没有编辑区的界面，此时不挂任何编辑区工具。
 */
const workspace = computed<"docs" | "cards" | "none">(() => {
  if (props.activeMainTab === "docs") return "docs";
  if (props.activeMainTab === "library") return "cards";
  return "none";
});

interface ChatHistoryItem {
  id: number;
  title: string;
  time: string;
  messages: ChatMessage[];
}

interface ToolTrace {
  label: string;
  done: boolean;
  detail?: string;
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  /** Model's chain-of-thought / reasoning (separate panel, not part of copy/drag). */
  reasoning?: string;
  /** Tokens spent producing this reply (display-only, never part of copy/drag). */
  tokens?: number;
  /** Timestamp when the reply was generated. */
  timestamp?: string;
  loading?: boolean;
  title?: string;
  /** Knowledge-tool activity for this turn (agent reading knowledge items). */
  tools?: ToolTrace[];
  /** Attached items (cards/files). Content is carried to the backend; the
      bubble only shows these little chips. */
  attachments?: { kind: "card" | "file"; label: string }[];
  /** 本轮生效的叙事定制（展示用胶囊）。指令本体走系统提示词，不进正文，
      因此复制 / 拖拽生成卡片时不会被带上。 */
  narrative?: { kindLabel: string; name: string }[];
  /** 本轮生效的故事定制（角色原型 / 情节），同样只用于展示。 */
  story?: { kindLabel: string; name: string }[];
  /** 本轮生效的创作指令（/身份模板 之类）。只用于在气泡里渲染不可编辑的胶囊，
      指令词不进 content，因此复制 / 拖拽 / 重新发送都不会把它当正文带上。 */
  slash?: { id: string; label: string };
  /** AI 回复上方的「创作模式已生效」告知条：说明本轮走了哪条创作指令、
      与哪些定制项联动。仅展示，不属于正文，也绝不回显身份模板的任何内容。 */
  mode?: { label: string; parts: string[] };
  /** 这条 AI 回复的正文没写完（被输出长度上限截断，或用户点了「停止生成」）。
      置位后气泡下方出现「接着写完」入口，下一轮的续写也据此认定断点。 */
  incomplete?: boolean;
  /** 本轮为了把正文写完而自动接续的次数（仅展示，用来解释这条回复为何较长）。 */
  continued?: number;
}

function formatTimestamp(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const m = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const h = pad(d.getHours());
  const min = pad(d.getMinutes());
  const s = pad(d.getSeconds());
  return `${y}-${m}-${day} ${h}:${min}:${s}`;
}

function cloneMessages(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({ ...message }));
}

/* --- Decoupled States for Free Chat --- */
const freeChatHistory = ref<ChatHistoryItem[]>([]);
const activeFreeChatHistoryId = ref<number | null>(null);
const freeChatMessages = ref<ChatMessage[]>([]);
const freeChatComposerText = ref("");

/* --- Decoupled States for Writer --- */
const writerChatHistory = ref<ChatHistoryItem[]>([]);
const activeWriterHistoryId = ref<number | null>(null);
const writerMessages = ref<ChatMessage[]>([]);
const writerComposerText = ref("");

/* --- Decoupled States for Auditor --- */
const auditorChatHistory = ref<ChatHistoryItem[]>([]);
const activeAuditorHistoryId = ref<number | null>(null);
const auditorMessages = ref<ChatMessage[]>([]);
const auditorComposerText = ref("");

/* --- Chat Persistence --- */
const CHAT_STORAGE_KEY = "docintel:chat_sidebar_data";

function saveChatData() {
  try {
    const payload = {
      freeChatMessages: freeChatMessages.value,
      freeChatHistory: freeChatHistory.value,
      writerMessages: writerMessages.value,
      writerChatHistory: writerChatHistory.value,
      auditorMessages: auditorMessages.value,
      auditorChatHistory: auditorChatHistory.value,
    };
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}

function loadChatData() {
  try {
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data.freeChatMessages)) freeChatMessages.value = data.freeChatMessages;
    /* 旧版本只写入过「刚刚」占位、从未落盘真实时间戳：加载时一旦发现占位值
       就升级为当前时间，避免重启后历史记录永远显示「刚刚」。 */
    if (Array.isArray(data.freeChatHistory)) freeChatHistory.value = data.freeChatHistory.map(replacePlaceholderTime);
    if (Array.isArray(data.writerMessages)) writerMessages.value = data.writerMessages;
    if (Array.isArray(data.writerChatHistory)) writerChatHistory.value = data.writerChatHistory.map(replacePlaceholderTime);
    if (Array.isArray(data.auditorMessages)) auditorMessages.value = data.auditorMessages;
    if (Array.isArray(data.auditorChatHistory)) auditorChatHistory.value = data.auditorChatHistory.map(replacePlaceholderTime);
  } catch {
    /* ignore */
  }
}

function replacePlaceholderTime(item: ChatHistoryItem): ChatHistoryItem {
  if (item && (typeof item.time !== "string" || item.time === "刚刚" || item.time.trim() === "")) {
    return { ...item, time: formatTimestamp() };
  }
  return item;
}

watch(
  [freeChatMessages, freeChatHistory, writerMessages, writerChatHistory, auditorMessages, auditorChatHistory],
  () => {
    saveChatData();
  },
  { deep: true },
);

/* --- Popover States --- */
const activePopover = ref<"slash" | "model" | "webSearch" | "thinking" | null>(null);

function togglePopover(pop: "slash" | "model" | "webSearch" | "thinking") {
  activePopover.value = activePopover.value === pop ? null : pop;
}

function handleDocumentClick(e: MouseEvent) {
  const target = e.target as HTMLElement;
  if (!target.closest(".popover-wrapper")) {
    activePopover.value = null;
  }
  if (materialsWrapRef.value && !materialsWrapRef.value.contains(target)) {
    materialsOpen.value = false;
    narrativeOpen.value = false;
    storyOpen.value = false;
  }
}

onMounted(() => {
  loadChatData();
  document.addEventListener("click", handleDocumentClick);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleDocumentClick);
});

/* --- Active Computed Properties --- */
const currentMessages = computed({
  get: () => {
    if (activeSidebarTab.value === "chat") return freeChatMessages.value;
    if (activeSidebarTab.value === "writer") return writerMessages.value;
    return auditorMessages.value;
  },
  set: (val) => {
    if (activeSidebarTab.value === "chat") freeChatMessages.value = val;
    else if (activeSidebarTab.value === "writer") writerMessages.value = val;
    else auditorMessages.value = val;
  },
});

const currentChatHistory = computed(() => {
  if (activeSidebarTab.value === "chat") return freeChatHistory.value;
  if (activeSidebarTab.value === "writer") return writerChatHistory.value;
  return auditorChatHistory.value;
});

const currentActiveHistoryId = computed({
  get: () => {
    if (activeSidebarTab.value === "chat") return activeFreeChatHistoryId.value;
    if (activeSidebarTab.value === "writer") return activeWriterHistoryId.value;
    return activeAuditorHistoryId.value;
  },
  set: (val) => {
    if (activeSidebarTab.value === "chat") activeFreeChatHistoryId.value = val;
    else if (activeSidebarTab.value === "writer") activeWriterHistoryId.value = val;
    else activeAuditorHistoryId.value = val;
  },
});

const currentComposerText = computed({
  get: () => {
    if (activeSidebarTab.value === "chat") return freeChatComposerText.value;
    if (activeSidebarTab.value === "writer") return writerComposerText.value;
    return auditorComposerText.value;
  },
  set: (val) => {
    if (activeSidebarTab.value === "chat") freeChatComposerText.value = val;
    else if (activeSidebarTab.value === "writer") writerComposerText.value = val;
    else auditorComposerText.value = val;
  },
});

const currentModel = computed({
  get: () => (activeSidebarTab.value === "auditor" ? aiSettings.auditorModel : aiSettings.model),
  set: (val) => {
    if (activeSidebarTab.value === "auditor") aiSettings.auditorModel = val;
    else aiSettings.model = val;
  },
});

/* ---- 「/」创作指令（仅「对话」标签页） ----------------------------------

   指令是一层显式开关：输入框正文以 /身份模板 开头时，本轮才会把对应的创作
   指令块追加到系统提示词，并让模型用知识项工具去读挂载的模板文件。没打指令
   的时候这里全程不参与，日常问答与改造前完全一致。 */

const slashCommands = SLASH_COMMANDS;

/**
 * 当前「对话」标签页生效的创作指令，作为独立胶囊存储，不写进输入框正文。
 *
 * 正文里只有需求内容；指令词渲染为输入框上方的不可编辑胶囊，用户无法按退格
 * 误删它，只能通过胶囊自带的 ×（或再点一次菜单项）显式退出。
 */
const chatSlashCmd = ref<SlashCommand | null>(null);

/** 当前这条输入是否命中了创作指令（胶囊优先，兼容旧文本兜底）。 */
const activeSlashCommand = computed<SlashCommand | null>(() => {
  if (activeSidebarTab.value !== "chat") return null;
  return chatSlashCmd.value ?? detectSlashCommand(currentComposerText.value)?.command ?? null;
});

const slashButtonTitle = computed(() =>
  activeSlashCommand.value
    ? `创作模式：${activeSlashCommand.value.label}（再次点选菜单项或点胶囊的 × 可退出）`
    : "创作模式指令（/）",
);

/** 对话标签页输入框占位符：命中指令时提示继续写需求正文。 */
const composerPlaceholder = computed(() => {
  if (activeSidebarTab.value !== "chat") {
    return activeSidebarTab.value === "writer"
      ? "给 AI 写手发送消息... (Ctrl+Enter 发送)"
      : "粘贴完成的草稿给审核员评估... (Ctrl+Enter 发送)";
  }
  return activeSlashCommand.value
    ? `已启用「${activeSlashCommand.value.label}」，可直接写下或粘贴需求正文...`
    : "向 AI 发送任意消息，输入 / 选择创作模式... (Ctrl+Enter 发送)";
});

/**
 * 正文里出现行首创作指令时自动收进胶囊：菜单点选、手工输入 /身份模板、调回
 * 带指令的历史消息都会落到同一条路径，指令词从此不再随正文编辑被误删。
 */
watch(currentComposerText, (text) => {
  if (activeSidebarTab.value !== "chat") return;
  const hit = detectSlashCommand(text);
  if (!hit) return;
  chatSlashCmd.value = hit.command;
  /* 把指令词从正文里剥掉，只留需求内容；watch 由此会再跑一次，届时 detect
     命中不了（正文不再以指令开头），不会死循环。 */
  if (currentComposerText.value !== hit.body) currentComposerText.value = hit.body;
});

/** 菜单里点一条指令：把指令收进胶囊，正文保持干净，焦点交回输入框继续写需求。 */
function applySlashCommand(command: SlashCommand) {
  chatSlashCmd.value = command;
  activePopover.value = null;
  /* 明确的进入反馈：告知「已进入」这件事本身，不透露模板内容。
     联动项在同一条提示里点名，让用户一眼确认素材库 / 故事 / 叙事定制是否带上了。 */
  const parts = slashModeParts();
  showToast(
    `已进入「${command.label}」创作模式`,
    parts.length > 0
      ? `本轮联动：${parts.join(" / ")}。写下需求后发送即可。`
      : "写下需求后发送即可；点胶囊的 × 可退出。",
    "edit",
  );
  nextTick(() => {
    const el = composerRef.value;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
    handleComposerInput();
  });
}

/** 退出创作模式：只清胶囊，已写的需求正文原样保留。 */
function clearSlashCommand() {
  const previous = chatSlashCmd.value;
  chatSlashCmd.value = null;
  activePopover.value = null;
  if (previous) {
    showToast("已退出创作模式", `「${previous.label}」已关闭，已写的需求正文保留在输入框。`, "edit");
  }
  nextTick(() => composerRef.value?.focus());
}

/**
 * 身份模板 + 素材库 / 叙事定制 / 故事定制的联动清单。
 *
 * 只列「用户本轮确实选中」的项；全没选时返回空串，身份模板就走原有流程。
 * 素材库原文已在系统提示词的【素材库】块里全文携带，这里只点名标题；
 * 叙事 / 故事的具体要求就在各自的【定制】块里，这里点名其胶囊并强调结合。
 */
function slashIntegrationContext(): string {
  const parts: string[] = [];

  const mats = aiSettings.materialLibraryEnabled ? selectedMaterials() : [];
  if (mats.length > 0) {
    parts.push(
      `· 素材库：已选中 ${mats.length} 项 —— ${mats.map((m) => `「${m.title}」`).join("、")}（原文已在【素材库】块全文提供）`,
    );
  }

  if (aiSettings.narrativeCraftEnabled) {
    const chips = narrativeChips("chat");
    if (chips.length > 0) {
      parts.push(`· 叙事定制：${chips.map((c) => `${c.kindLabel}·${c.name}`).join("、")}（具体要求见【叙事定制】块）`);
    }
  }

  if (aiSettings.storyCraftEnabled) {
    const chips = storyChips();
    if (chips.length > 0) {
      parts.push(`· 故事定制：${chips.map((c) => `${c.kindLabel}·${c.name}`).join("、")}（具体要求见【故事定制】块）`);
    }
  }

  return parts.join("\n");
}

/**
 * 「创作模式已生效」告知条要显示的联动项清单。
 *
 * 与 slashIntegrationContext 取的是同一批数据（素材库 / 故事定制 / 叙事定制），
 * 但只给出「类别 + 项名」这种一眼可读的短标签，不携带任何身份模板内容——
 * 用户看到的是「已进入哪种模式、带上了哪些定制」，而不是模板本身。
 */
function slashModeParts(): string[] {
  const parts: string[] = [];

  const mats = aiSettings.materialLibraryEnabled ? selectedMaterials() : [];
  if (mats.length > 0) {
    parts.push(`素材库 ${mats.length} 项`);
  }
  if (aiSettings.storyCraftEnabled) {
    const chips = storyChips();
    if (chips.length > 0) parts.push(`故事定制：${chips.map((c) => c.name).join("、")}`);
  }
  if (aiSettings.narrativeCraftEnabled) {
    const chips = narrativeChips("chat");
    if (chips.length > 0) parts.push(`叙事定制：${chips.map((c) => c.name).join("、")}`);
  }
  /* 知识项被用户摘掉时走的是内置模板兜底，这一点也值得让用户看见。 */
  if (!identityTemplateMounted()) {
    parts.push("模板来源：内置副本（知识项未挂载）");
  }
  return parts;
}

/* ---- Composer model picker: grouped by provider, collapsible ---- */

interface ModelGroup {
  id: string;
  label: string;
  provider: string;
  models: string[];
  /** True for the provider profile that is currently live. */
  isActive: boolean;
}

/**
 * Group the flat model list by saved provider card so the dropdown stops being
 * one long undifferentiated list. Models belonging to the live provider that
 * aren't attached to any card land in a synthetic "当前接口" group.
 */
const modelGroups = computed<ModelGroup[]>(() => {
  const groups: ModelGroup[] = [];
  const claimed = new Set<string>();

  for (const profile of aiSettings.providerProfiles) {
    const models = profile.models.length > 0 ? [...profile.models] : [profile.model].filter(Boolean);
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
      isActive: aiSettings.providerProfiles.every((p) => p.id !== aiSettings.activeProfileId),
    });
  }

  /* Active provider first — that's what the user is most likely picking from. */
  groups.sort((a, b) => Number(b.isActive) - Number(a.isActive));
  return groups;
});

/** Group ids the user has explicitly folded open/closed. */
const expandedModelGroups = ref<Set<string>>(new Set());
const modelFilter = ref("");

function isModelGroupOpen(group: ModelGroup): boolean {
  if (expandedModelGroups.value.has(group.id)) return true;
  if (modelFilter.value.trim()) return true;
  /* Default: only the group holding the current model starts expanded. */
  return !userTouchedGroups.value && group.models.includes(currentModel.value);
}

/** Once the user collapses/expands anything, stop auto-deciding for them. */
const userTouchedGroups = ref(false);

function toggleModelGroup(group: ModelGroup) {
  userTouchedGroups.value = true;
  const next = new Set(expandedModelGroups.value);
  if (next.has(group.id)) next.delete(group.id);
  else next.add(group.id);
  expandedModelGroups.value = next;
}

function filteredModels(group: ModelGroup): string[] {
  const q = modelFilter.value.trim().toLowerCase();
  if (!q) return group.models;
  return group.models.filter((m) => m.toLowerCase().includes(q));
}

const visibleModelGroups = computed(() =>
  modelGroups.value.filter((g) => filteredModels(g).length > 0),
);

/**
 * Selecting a model from a saved card also switches the live API credentials to
 * that card, otherwise the model would be sent to the wrong endpoint.
 */
function selectModel(group: ModelGroup, model: string) {
  if (group.id !== "__current__" && group.id !== aiSettings.activeProfileId) {
    activateProviderProfile(group.id);
  }
  currentModel.value = model;
  activePopover.value = null;
  modelFilter.value = "";
}

/** Label shown next to the assistant reply, e.g. "OpenAI · gpt-4.1". */
const currentModelLabel = computed(() => {
  const active = aiSettings.providerProfiles.find((p) => p.id === aiSettings.activeProfileId);
  const prefix = active?.label ?? providerLabel(aiSettings.provider, aiSettings.providerName);
  return `${prefix} · ${currentModel.value}`;
});

const historyMenuOpen = ref(false);
const historyMenuRef = ref<HTMLDivElement | null>(null);
const moreMenuOpen = ref(false);
const moreMenuRef = ref<HTMLDivElement | null>(null);
const composerRef = ref<HTMLTextAreaElement | null>(null);
const chatMessagesRef = ref<HTMLDivElement | null>(null);
const editingMessageId = ref<number | null>(null);
/* 思考过程面板的展开状态：默认折叠，仅记录展开的 message.id。 */
const expandedReasoningIds = ref<Set<number>>(new Set());

function toggleReasoning(messageId: number) {
  const next = new Set(expandedReasoningIds.value);
  if (next.has(messageId)) next.delete(messageId);
  else next.add(messageId);
  expandedReasoningIds.value = next;
}

/* ---------------- resizable width ---------------- */

/** Unchanged from the previous fixed layout, so nothing shifts on first run. */
const DEFAULT_SIDEBAR_WIDTH = 400;
const MIN_SIDEBAR_WIDTH = 300;
/** Leave at least this much room for the main area at any window size. */
const MIN_MAIN_WIDTH = 420;
const WIDTH_STORAGE_KEY = "docintel:chat_sidebar_width";

const sidebarWidth = ref(DEFAULT_SIDEBAR_WIDTH);
const resizing = ref(false);

function maxSidebarWidth(): number {
  return Math.max(MIN_SIDEBAR_WIDTH, window.innerWidth - MIN_MAIN_WIDTH);
}

function clampWidth(value: number): number {
  return Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxSidebarWidth(), value)));
}

function loadSidebarWidth() {
  const raw = localStorage.getItem(WIDTH_STORAGE_KEY);
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed)) sidebarWidth.value = clampWidth(parsed);
}

function persistSidebarWidth() {
  try {
    localStorage.setItem(WIDTH_STORAGE_KEY, String(sidebarWidth.value));
  } catch {
    /* ignore quota errors */
  }
}

/** The panel is right-docked, so dragging left (negative dx) widens it. */
function startResize(event: MouseEvent) {
  if (event.button !== 0) return;
  event.preventDefault();
  resizing.value = true;

  const startX = event.clientX;
  const startWidth = sidebarWidth.value;
  const previousCursor = document.body.style.cursor;
  const previousSelect = document.body.style.userSelect;
  document.body.style.cursor = "col-resize";
  document.body.style.userSelect = "none";

  const move = (e: MouseEvent) => {
    sidebarWidth.value = clampWidth(startWidth - (e.clientX - startX));
  };
  const up = () => {
    resizing.value = false;
    document.body.style.cursor = previousCursor;
    document.body.style.userSelect = previousSelect;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
    persistSidebarWidth();
  };

  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

function resetWidth() {
  sidebarWidth.value = DEFAULT_SIDEBAR_WIDTH;
  persistSidebarWidth();
}

/** Keep the panel valid when the window shrinks. */
function onWindowResize() {
  const clamped = clampWidth(sidebarWidth.value);
  if (clamped !== sidebarWidth.value) sidebarWidth.value = clamped;
}

const editContent = ref("");

/* --- Material library (chat tab only) --- */
const materialsOpen = ref(false);
const materialsWrapRef = ref<HTMLDivElement | null>(null);
const materialEditingId = ref<string | null>(null);
const materialDraftTitle = ref("");
const materialDraftContent = ref("");

function toggleMaterialsPanel() {
  materialsOpen.value = !materialsOpen.value;
  if (materialsOpen.value) {
    narrativeOpen.value = false;
    storyOpen.value = false;
  }
}

function startCreateMaterial() {
  materialEditingId.value = "new";
  materialDraftTitle.value = "";
  materialDraftContent.value = "";
}

function startEditMaterial(id: string) {
  const item = materialStore.items.find((m) => m.id === id);
  if (!item) return;
  materialEditingId.value = id;
  materialDraftTitle.value = item.title;
  materialDraftContent.value = item.content;
}

function commitMaterialSave() {
  if (materialEditingId.value === "new") {
    if (materialDraftTitle.value.trim() || materialDraftContent.value.trim()) {
      createMaterial(materialDraftTitle.value, materialDraftContent.value);
    }
  } else if (materialEditingId.value) {
    updateMaterial(materialEditingId.value, materialDraftTitle.value, materialDraftContent.value);
  }
  materialEditingId.value = null;
  materialDraftTitle.value = "";
  materialDraftContent.value = "";
}

function cancelMaterialEdit() {
  materialEditingId.value = null;
  materialDraftTitle.value = "";
  materialDraftContent.value = "";
}

/* --- 叙事定制（对话 / AI写作 两个标签页） --- */

/** 审核意见不接入叙事定制，因此仅 chat / writer 有作用域。 */
const narrativeScope = computed<NarrativeScope | null>(() =>
  activeSidebarTab.value === "chat" || activeSidebarTab.value === "writer"
    ? (activeSidebarTab.value as NarrativeScope)
    : null,
);

const narrativeOpen = ref(false);
/** 折叠状态：默认三组都展开，用户可自行收起。 */
const collapsedNarrativeGroups = ref<Set<NarrativeKind>>(new Set());

const narrativeGroups = NARRATIVE_GROUPS;

const narrativeCount = computed(() =>
  narrativeScope.value ? narrativeSelectedCount(narrativeScope.value) : 0,
);

function toggleNarrativePanel() {
  narrativeOpen.value = !narrativeOpen.value;
  /* 三个面板共用输入框上方的空间，同时展开会互相挤压。 */
  if (narrativeOpen.value) {
    materialsOpen.value = false;
    storyOpen.value = false;
  }
}

function isNarrativeGroupOpen(kind: NarrativeKind): boolean {
  return !collapsedNarrativeGroups.value.has(kind);
}

function toggleNarrativeGroup(kind: NarrativeKind) {
  const next = new Set(collapsedNarrativeGroups.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  collapsedNarrativeGroups.value = next;
}

function narrativeGroupCount(kind: NarrativeKind): number {
  const scope = narrativeScope.value;
  if (!scope) return 0;
  return narrativeStore.selections[scope][kind].length;
}

function narrativeChecked(kind: NarrativeKind, id: string): boolean {
  const scope = narrativeScope.value;
  return scope ? isNarrativeSelected(scope, kind, id) : false;
}

/** 勾选 / 取消勾选后，输入框内的胶囊随之增减。 */
function onToggleNarrative(kind: NarrativeKind, id: string) {
  const scope = narrativeScope.value;
  if (!scope) return;
  toggleNarrativeOption(scope, kind, id);
}

function clearNarrative() {
  const scope = narrativeScope.value;
  if (!scope) return;
  clearNarrativeSelection(scope);
}

/** 输入框内渲染的胶囊：不可编辑，仅能通过胶囊上的 × 或面板勾选增减。 */
const composerNarrativeChips = computed<NarrativeChip[]>(() =>
  aiSettings.narrativeCraftEnabled && narrativeScope.value
    ? narrativeChips(narrativeScope.value)
    : [],
);

/** 点胶囊自带的 × 直接取消该项，不必再打开面板。 */
function removeNarrativeChip(chip: NarrativeChip) {
  const scope = narrativeScope.value;
  if (!scope) return;
  toggleNarrativeOption(scope, chip.kind, chip.id);
}

/* 切到审核意见页时收起面板：该页不接入叙事定制。 */
watch(activeSidebarTab, (tab) => {
  if (tab === "auditor") narrativeOpen.value = false;
  /* 故事定制仅「对话」页有效，离开该页即收起。 */
  if (tab !== "chat") storyOpen.value = false;
});

/* --- 故事定制（角色原型 / 情节，仅「对话」标签页） --- */

const storyOpen = ref(false);
/** 折叠状态：默认两组都展开，用户可自行收起。 */
const collapsedStoryGroups = ref<Set<StoryKind>>(new Set());

const storyGroups = STORY_GROUPS;

const storyCount = computed(() => storySelectedCount());

function toggleStoryPanel() {
  storyOpen.value = !storyOpen.value;
  /* 三个面板共用输入框上方的空间，同时展开会互相挤压。 */
  if (storyOpen.value) {
    materialsOpen.value = false;
    narrativeOpen.value = false;
  }
}

function isStoryGroupOpen(kind: StoryKind): boolean {
  return !collapsedStoryGroups.value.has(kind);
}

function toggleStoryGroup(kind: StoryKind) {
  const next = new Set(collapsedStoryGroups.value);
  if (next.has(kind)) next.delete(kind);
  else next.add(kind);
  collapsedStoryGroups.value = next;
}

function storyChecked(kind: StoryKind, id: string): boolean {
  return isStorySelected(kind, id);
}

function onToggleStory(kind: StoryKind, id: string) {
  toggleStoryOption(kind, id);
}

function clearStory() {
  clearStorySelection();
}

/** 输入框内渲染的故事胶囊：仅「对话」页呈现，其余页为空。 */
const composerStoryChips = computed<StoryChip[]>(() =>
  activeSidebarTab.value === "chat" && aiSettings.storyCraftEnabled ? storyChips() : [],
);

function removeStoryChip(chip: StoryChip) {
  toggleStoryOption(chip.kind, chip.id);
}

/* 三个页签各自的「正在生成」标志。
   必须是 ref：isSendingCurrent 是 computed，若这里用普通 let 布尔量，
   赋值不会触发依赖收集，发送按钮就永远不会切换成停止图标
   （只有切换页签让 activeSidebarTab 变化时才会被动刷新一次）。 */
const isChatSending = ref(false);
const isWriterSending = ref(false);
const isAuditorSending = ref(false);
/* 正在进行的 AI 请求，按页签各存一份：三个页签可以同时跑，
   「停止生成」只掐掉当前页签这一路，不会误伤另外两路。 */
const activeAbortControllers: Record<SidebarTab, AbortController | null> = {
  chat: null,
  writer: null,
  auditor: null,
};

const isSendingCurrent = computed(() => {
  if (activeSidebarTab.value === "chat") return isChatSending.value;
  if (activeSidebarTab.value === "writer") return isWriterSending.value;
  return isAuditorSending.value;
});

/** 统一切换某个页签的「正在生成」标志。 */
function setTabSending(tab: SidebarTab, value: boolean) {
  if (tab === "chat") isChatSending.value = value;
  else if (tab === "writer") isWriterSending.value = value;
  else isAuditorSending.value = value;
}

/**
 * streamAiReply 是 fire-and-forget 调用：它在 try 之前的准备阶段若抛错，
 * onDone / onError / onAbort 一个都不会触发，「正在生成」标志与停止图标
 * 就会永远卡住。这里统一兜底，保证标志一定会被清掉。
 */
function guardSending(promise: Promise<void>, finalize: () => void, settled: () => boolean) {
  void promise
    .catch((error: unknown) => {
      console.error("AI 回复流程异常:", error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      if (!settled()) finalize();
    });
}

/** 胶囊不算正文：输入框里只有胶囊（指令态）时也允许发送——只带指令、不带需求，
    后端会收到「身份模板」的引导流程；正文为空且无指令时不允许发送。 */
const canSend = computed(() => {
  if (isSendingCurrent.value) return false;
  if (activeSlashCommand.value) return true;
  return stripNarrativeTag(currentComposerText.value).trim().length > 0;
});

function toggleHistoryMenu() {
  historyMenuOpen.value = !historyMenuOpen.value;
}

function closeHistoryMenu() {
  historyMenuOpen.value = false;
}

function toggleMoreMenu() {
  moreMenuOpen.value = !moreMenuOpen.value;
}

function closeMoreMenu() {
  moreMenuOpen.value = false;
}

type TabRecordKey = "chat" | "writer" | "auditor";

interface ChatRecordTab {
  tabId: TabRecordKey;
  tabName: string;
  history: ChatHistoryItem[];
}

function tabRecords(): ChatRecordTab[] {
  return [
    { tabId: "chat", tabName: "对话", history: freeChatHistory.value },
    { tabId: "writer", tabName: "AI写作", history: writerChatHistory.value },
    { tabId: "auditor", tabName: "审核意见", history: auditorChatHistory.value },
  ];
}

async function downloadChatRecords() {
  const payload = {
    app: "yanxiang-agent",
    type: "chat-records",
    exportedAt: new Date().toISOString(),
    tabs: tabRecords().map((t) => ({
      tabId: t.tabId,
      tabName: t.tabName,
      history: t.history,
    })),
  };
  const fileName = `yanxiang_chat_records_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await downloadTextFileWithDialog(fileName, JSON.stringify(payload, null, 2));
  closeMoreMenu();
}

function findTabHistory(id: string): ChatHistoryItem[] | undefined {
  if (id === "chat") return freeChatHistory.value;
  if (id === "writer") return writerChatHistory.value;
  if (id === "auditor") return auditorChatHistory.value;
  return undefined;
}

async function importChatRecords() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".json,application/json";
  input.onchange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? ""));
        let tabs: ChatRecordTab[] = [];
        if (Array.isArray(data)) {
          tabs = data;
        } else if (data && typeof data === "object" && Array.isArray(data.tabs)) {
          tabs = data.tabs;
        }
        if (tabs.length === 0) {
          showToast("导入失败", "未找到对话记录数据", "edit");
          return;
        }
        const latestId = Math.max(
          0,
          ...freeChatHistory.value.map((h) => h.id),
          ...writerChatHistory.value.map((h) => h.id),
          ...auditorChatHistory.value.map((h) => h.id),
        );
        let counter = latestId;

        tabs.forEach((tab: ChatRecordTab) => {
          const historyList = findTabHistory(tab.tabId);
          if (!historyList || !Array.isArray(tab.history)) return;
          tab.history.forEach((item: ChatHistoryItem) => {
            if (!item || typeof item !== "object") return;
            historyList.unshift({
              id: ++counter,
              title: typeof item.title === "string" ? item.title : "导入对话",
              time: typeof item.time === "string" ? item.time : "刚刚",
              messages: Array.isArray(item.messages)
                ? item.messages.map((m, idx) => ({
                    id: ++counter + idx,
                    role: m?.role === "assistant" ? "assistant" : "user",
                    content: typeof m?.content === "string" ? m.content : "",
                  }))
                : [],
            });
          });
        });
        closeMoreMenu();
        const total = tabs.reduce((n, t) => n + (Array.isArray(t.history) ? t.history.length : 0), 0);
        showToast("导入成功", `共导入 ${total} 条对话记录`, "habit");
      } catch {
        showToast("解析失败", "对话记录 JSON 解析失败，请检查文件格式", "edit");
      }
      target.value = "";
    };
    reader.onerror = () => {
      showToast("读取失败", "读取文件失败", "edit");
    };
    reader.readAsText(file);
  };
  input.click();
}

function createNewChat() {
  const historyList = currentChatHistory.value;
  const id = Date.now();
  const newItem: ChatHistoryItem = {
    id,
    title: `新对话 ${historyList.length + 1}`,
    time: formatTimestamp(),
    messages: [],
  };
  historyList.unshift(newItem);
  currentActiveHistoryId.value = id;
  currentMessages.value = [];
  closeHistoryMenu();
}

function selectHistory(id: number) {
  const historyList = currentChatHistory.value;
  const history = historyList.find((item) => item.id === id);
  if (!history) return;
  currentActiveHistoryId.value = id;
  currentMessages.value = cloneMessages(history.messages);
  closeHistoryMenu();
}

function deleteHistoryItem(id: number) {
  const historyList = currentChatHistory.value;
  const index = historyList.findIndex((item) => item.id === id);
  if (index === -1) return;

  historyList.splice(index, 1);

  if (currentActiveHistoryId.value === id) {
    const next = historyList[Math.min(index, historyList.length - 1)];
    currentActiveHistoryId.value = next?.id ?? null;
    currentMessages.value = next ? cloneMessages(next.messages) : [];
  }
}

const showScrollToBottom = ref(false);
const tabScrollPositions = reactive<Record<SidebarTab, number>>({
  chat: 0,
  writer: 0,
  auditor: 0,
});
const prevLength = reactive<Record<SidebarTab, number>>({
  chat: 0,
  writer: 0,
  auditor: 0,
});

function handleMessagesScroll() {
  const el = chatMessagesRef.value;
  if (!el) return;
  const threshold = 100;
  const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  showScrollToBottom.value = distFromBottom > threshold;
  tabScrollPositions[activeSidebarTab.value] = el.scrollTop;
}

watch(activeSidebarTab, (newTab, oldTab) => {
  if (chatMessagesRef.value && oldTab) {
    tabScrollPositions[oldTab] = chatMessagesRef.value.scrollTop;
    prevLength[oldTab] = currentMessages.value.length;
  }
  nextTick(() => {
    const el = chatMessagesRef.value;
    if (!el) return;
    prevLength[newTab] = currentMessages.value.length;
    const savedPos = tabScrollPositions[newTab];
    if (typeof savedPos === "number" && savedPos > 0) {
      el.scrollTop = savedPos;
    } else {
      el.scrollTop = el.scrollHeight;
    }
    handleMessagesScroll();
  });
});

function scrollToBottom(smooth = false) {
  nextTick(() => {
    const el = chatMessagesRef.value;
    if (!el) return;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      /* 初始化/切换标签页时瞬时置底，避免从顶部平滑滚过来造成视觉跳动。 */
      el.scrollTop = el.scrollHeight;
    }
    showScrollToBottom.value = false;
  });
}

/* Sync the active conversation into its matching history entry so that
   conversations can be reopened from the history menu after restart. */
watch(
  currentMessages,
  (messages) => {
    const hid = currentActiveHistoryId.value;
    if (hid == null) return;
    const history = currentChatHistory.value.find((h) => h.id === hid);
    if (history) {
      history.messages = cloneMessages(messages);
      /* 新建对话的历史条目最初以占位时间创建，一旦真正落入消息，
         立即升级成真实时间戳，保证重启后恢复的是常规时间而非「刚刚」。 */
      if (messages.length > 0 && (history.time === "刚刚" || !history.time)) {
        history.time = formatTimestamp();
      }
      if (messages.length > 0 && history.title.startsWith("新对话")) {
        const firstUser = messages.find((m) => m.role === "user");
        if (firstUser) {
          /* 指令词不进正文，所以「只启用了创作模式、没写需求」的首条消息正文为空。
             这种情况用模式名当标题，避免历史列表里留下一条永远叫「新对话 N」的记录。 */
          const title = firstUser.content.replace(/\s+/g, " ").trim();
          if (title.length > 0) history.title = title.slice(0, 20);
          else if (firstUser.slash) history.title = firstUser.slash.label;
        }
      }
    }
  },
  { deep: true },
);

watch(
  () => currentMessages.value.length,
  (length) => {
    /* 仅在本标签页内消息数量增加（发送/回复新消息）且用户本就在底部附近时，
       才平滑跟随到底部；切换标签页等引起的数量变化一律不触发滚动。 */
    const prev = prevLength[activeSidebarTab.value];
    prevLength[activeSidebarTab.value] = length;
    if (length > prev && !showScrollToBottom.value) scrollToBottom(true);
  },
);

watch(
  () => cardEvents.newChatRequest,
  () => {
    if (cardEvents.newChatRequest > 0) createNewChat();
  },
);

/**
 * Long-press anywhere on an assistant reply to drag it onto the 写作 canvas.
 *
 * The old implementation put `draggable="true"` on a 14px grip icon only, so
 * dragging the reply body just ran a native text selection across the rest of
 * the conversation. We now use a pointer-based gesture that arms after a short
 * hold and suppresses selection for its duration.
 */
const draggingMessageId = ref<number | null>(null);

function beginMessageDrag(event: MouseEvent, message: ChatMessage) {
  if (message.role !== "assistant" || message.loading) return;
  if (editingMessageId.value === message.id) return;

  /* Never hijack the action buttons, links or the edit textarea. */
  const target = event.target as HTMLElement | null;
  if (target?.closest("button, a, input, textarea, select")) return;

  /* 文档界面走独立路径：AI 回复拖入文档自身编辑区、落在鼠标光标处。
    与写作界面「拖到画布生成卡片」完全解耦：不走 cardEvents，也不会把
    主界面切到写作画布。 */
  if (props.activeMainTab === "docs") {
    startDocMessageDrag(event, message);
    return;
  }

  const payload: DragCardPayload = {
    title: `AI回复 · ${message.content.slice(0, 20)}`,
    content: message.content,
  };

  startLongPressDrag({
    event,
    ghostLabel: "松开鼠标放入画布",
    onStart: () => {
      draggingMessageId.value = message.id;
      cardEvents.dragPayload = payload;
      cardEvents.dragPointer = { x: event.clientX, y: event.clientY };
      /* Reveals the canvas (App.vue switches to the 写作 tab on this flag). */
      cardEvents.isDraggingMessage = true;
    },
    onMove: (x, y) => {
      cardEvents.dragPointer = { x, y };
    },
    onDrop: (x, y) => {
      const created = commitCardDrop(x, y);
      if (!created) {
        /* The canvas sits to the LEFT of this chat panel. */
        showToast("未放入画布", "请把内容拖到左侧写作画布区域内再松开", "edit");
      }
    },
    onEnd: () => {
      draggingMessageId.value = null;
      cardEvents.isDraggingMessage = false;
      cardEvents.dragPayload = null;
      cardEvents.dragPointer = null;
    },
  });
}

/**
 * 文档界面专用的长按拖拽：掠过编辑区时高亮，松开把回复内容插入到光标处。
 * 与卡片的 beginMessageDrag 共用长按手势，但不共享卡片拖拽状态。
 */
function startDocMessageDrag(event: MouseEvent, message: ChatMessage) {
  startLongPressDrag({
    event,
    ghostLabel: "松开鼠标插入文档光标处",
    onStart: () => {
      draggingMessageId.value = message.id;
      docEditorDrag.isDragging = true;
      docEditorDrag.pointer = { x: event.clientX, y: event.clientY };
    },
    onMove: (x, y) => {
      docEditorDrag.pointer = { x, y };
    },
    onDrop: (x, y) => {
      const inserted = commitDocEditorDrop(x, y, message.content);
      if (!inserted) {
        showToast("未放入编辑区", "请把内容拖到左侧文档编辑区内再松开", "edit");
      }
    },
    onEnd: () => {
      draggingMessageId.value = null;
      docEditorDrag.isDragging = false;
      docEditorDrag.pointer = null;
    },
  });
}

async function copyText(content: string, event?: Event) {
  event?.stopPropagation();
  try {
    await navigator.clipboard.writeText(content);
  } catch {
    // Clipboard may be unavailable in WebView environments.
  }
}

function startEdit(message: ChatMessage) {
  editingMessageId.value = message.id;
  editContent.value = message.content;
}

function saveEdit(message: ChatMessage) {
  message.content = editContent.value;
  editingMessageId.value = null;
  editContent.value = "";
}

function cancelEdit() {
  editingMessageId.value = null;
  editContent.value = "";
}

function deleteMessage(messageId: number) {
  const target = currentMessages.value;
  const index = target.findIndex((m) => m.id === messageId);
  if (index === -1) return;
  target.splice(index, 1);
}

/* ---- 已发送气泡的呈现 ----------------------------------------------------

   指令词是「模式开关」而不是正文的一部分，因此在气泡里也必须以胶囊呈现，
   不能作为可选中、可复制、可被当成正文的明文出现。

   两条来源都要覆盖：
     1. 新消息 —— 指令存在 message.slash 里，content 只有需求正文；
     2. 历史消息 —— 旧版本把 `/身份模板 xxx` 整句写进了 content，
        这里按正文再解析一次，把指令词剥出来当胶囊，正文只留 xxx。 */

/** 这条用户消息本轮生效的创作模式名（没有则空串）。 */
function bubbleSlashLabel(message: ChatMessage): string {
  if (message.slash) return message.slash.label;
  /* 兼容兜底只对「对话」页生效：其余页从不支持创作指令，那里的 `/xxx`
     是用户真心要写的正文，不能被当成指令剥掉。 */
  if (message.role !== "user" || activeSidebarTab.value !== "chat") return "";
  return detectSlashCommand(message.content)?.command.label ?? "";
}

/** 气泡里应当显示的正文：永远不含指令词。 */
function bubbleText(message: ChatMessage): string {
  if (message.slash) return message.content;
  if (message.role !== "user" || activeSidebarTab.value !== "chat") return message.content;
  const hit = detectSlashCommand(message.content);
  return hit ? hit.body : message.content;
}


/** 撤回用户消息：需求正文回到输入框、创作指令回到胶囊，并连同对应的 AI 回复
    一并移除等待重新编辑。 */
function recallUserMessage(message: ChatMessage) {
  const list = currentMessages.value;
  const index = list.findIndex((m) => m.id === message.id);
  if (index === -1) return;

  /* 指令回到胶囊而不是正文：撤回后输入框里依旧不该出现明文指令词。 */
  const slashId = message.slash?.id ?? detectSlashCommand(message.content)?.command.id;
  if (activeSidebarTab.value === "chat") {
    chatSlashCmd.value = slashId ? SLASH_COMMANDS.find((c) => c.id === slashId) ?? null : null;
  }
  currentComposerText.value = bubbleText(message);

  const nextMsg = list[index + 1];
  if (nextMsg && nextMsg.role === "assistant") {
    list.splice(index, 2);
  } else {
    list.splice(index, 1);
  }

  nextTick(() => {
    if (composerRef.value) {
      composerRef.value.focus();
      composerRef.value.style.height = "auto";
      composerRef.value.style.height = Math.min(composerRef.value.scrollHeight, 150) + "px";
    }
  });

  showToast("已撤回消息", "原本发送的内容已重新回归输入框", "edit");
}

/** 删除用户发送的消息（仅移除本条，不联动 AI 回复）。 */
function deleteUserMessage(message: ChatMessage) {
  deleteMessage(message.id);
}

function applyToCard(message: ChatMessage) {
  if (props.activeMainTab === "docs") {
    const separator = docStore.markdown ? "\n\n" : "";
    docStore.markdown += separator + message.content;
    /* 让左侧文档面板对应条目亮一下：一次性写入没有过程可跟，点亮固定时长即可。 */
    pulseAiDocEdit(documentFilesStore.activeFileId);
    showToast("已应用到文档", "AI 回复内容已插入到文档编辑区", "habit");
    return;
  }
  const prefix =
    activeSidebarTab.value === "chat"
      ? "自由对话"
      : activeSidebarTab.value === "writer"
      ? "AI写作"
      : "审核意见";
  requestCreateCard(`${prefix} · ${message.content.slice(0, 18)}`, message.content);
}

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

/* 标签如实反映当前的引擎链：这个开关只决定「谁首发」，任一引擎失败都会
   自动回退到链上的下一个，因此写成「优先」而不是「只用」。
   持久化的取值仍是 bing / google，老配置无需迁移。 */
const webSearchLabel = computed(() => {
  if (!aiSettings.webSearchEnabled) return "关闭";
  return aiSettings.webSearchEngine === "google" ? "Google 结果优先" : "综合优先";
});

const thinkingLevelLabel = computed(() => {
  if (aiSettings.thinkingLevel === "off") return "关闭";
  if (aiSettings.thinkingLevel === "standard") return "标准";
  return "自动";
});

/* ---- 续写（接上一回合把正文写完） --------------------------------------

   身份模板这类创作指令一轮就要交出完整正文，但输出常常撞到模型的长度上限，
   或者被用户点「停止生成」掐断。此时用户会打一句「继续」，语义上是「接着刚才
   那半截往下写」——不是新问题。

   所以这里做两层保底：
     1. runAgent 侧：协议报了截断（finish_reason=length / stop_reason=max_tokens
        / response.incomplete / MAX_TOKENS）就在同一回合内自动接着写，直到正文
        写完，用户看到的始终是完整正文；
     2. 本层：用户手打「继续」时，把上一回合的创作指令、需求原文、已写正文的
        断点一起重新交给模型，接着写而不是重开头。 */

/** 上一回合：最后一条有正文的 AI 回复。 */
function findPrevTurn(list: ChatMessage[]): { ai: ChatMessage; user: ChatMessage | null } | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    /* 正在生成的占位（本轮那条）与空回复都不算上一回合。 */
    if (m.role !== "assistant" || m.loading || !m.content.trim()) continue;
    let user: ChatMessage | null = null;
    /* 往回找「真正提需求」的那条用户消息：一路跳过「继续」这类续写指令，
       否则连续续写第二次时会把上一句「继续」当成需求，丢掉原始需求与创作模式。 */
    for (let j = i - 1; j >= 0; j--) {
      if (list[j].role !== "user") continue;
      if (!user) user = list[j];
      if (isContinueRequest(list[j].content)) continue;
      user = list[j];
      break;
    }
    return { ai: m, user };
  }
  return null;
}

/** 用户消息的纯需求正文（剥掉可能写在正文里的历史指令词）。 */
function plainUserText(m: ChatMessage, tab: SidebarTab): string {
  if (m.slash) return m.content;
  if (tab !== "chat") return m.content;
  const hit = detectSlashCommand(m.content);
  return hit ? hit.body : m.content;
}

/** 交给模型的断点尾部长度上限：够它接上，又不至于把整篇再塞一遍。 */
const CONTINUE_TAIL_LIMIT = 1800;

/** 一个回合内最多自动接续几次（创作模式给足，日常问答少给）。 */
const AUTO_CONTINUE_CREATIVE = 4;
const AUTO_CONTINUE_CASUAL = 2;

/**
 * 把「继续」解析成一次续写：断点上下文 + 上一回合的创作指令。
 *
 * sendMessage 用它给这一轮的气泡补上创作模式胶囊与告知条，streamAiReply 用它
 * 组装提示词 —— 同一份判定，两处共用，不会出现「界面说没模式、提示词里有模式」
 * 这类不一致。
 */
function resolveContinuation(
  userText: string,
  tab: SidebarTab,
): { ctx: ContinuationContext; command: SlashCommand | null } | null {
  if (!isContinueRequest(userText)) return null;
  const list =
    tab === "chat" ? freeChatMessages.value : tab === "writer" ? writerMessages.value : auditorMessages.value;
  const prev = findPrevTurn(list);
  if (!prev) return null;

  const full = prev.ai.content.trim();
  const tailOnly = full.length > CONTINUE_TAIL_LIMIT;
  const ctx: ContinuationContext = {
    tail: tailOnly ? full.slice(-CONTINUE_TAIL_LIMIT) : full,
    tailOnly,
    request: prev.user ? plainUserText(prev.user, tab).trim() : "",
    truncated: !!prev.ai.incomplete,
  };

  /* 创作指令是「每轮一次性」的，发送后胶囊已复位；续写这一轮必须把上一回合的
     模式原样接回来，否则模型会掉回日常对话守则、丢掉身份与字数约束。 */
  let command: SlashCommand | null = null;
  if (tab === "chat" && prev.user) {
    const prevId = prev.user.slash?.id ?? detectSlashCommand(prev.user.content)?.command.id;
    if (prevId) command = SLASH_COMMANDS.find((c) => c.id === prevId) ?? null;
  }
  return { ctx, command };
}

async function streamAiReply(
  userMessage: string,
  tab: SidebarTab,
  onChunk: (text: string) => void,
  onDone: (fullText: string, tokens?: number, meta?: { incomplete?: boolean; continued?: number }) => void,
  onError: (msg: string) => void,
  onTool?: (trace: ToolTrace[]) => void,
  attachmentContext?: string,
  signal?: AbortSignal,
  onAbort?: () => void,
  onReasoning?: (text: string) => void,
  /** 本轮生效的创作指令。指令词不再进消息正文，因此由调用方显式传入；
      传 undefined 时退回按正文识别（兼容重新生成旧消息、以及用户手打指令的
      历史数据）。 */
  slashOverride?: SlashCommandHit | null,
) {
  const { provider, apiKey, url } = aiSettings;
  const model = tab === "auditor" ? aiSettings.auditorModel : aiSettings.model;
  let systemPrompt = "";

  const targetMessages =
    tab === "chat"
      ? freeChatMessages.value
      : tab === "writer"
      ? writerMessages.value
      : auditorMessages.value;

  /* 「对话」标签页命中的创作指令（/身份模板 之类）。未命中为 null。 */
  let slashHit =
    tab === "chat"
      ? slashOverride !== undefined
        ? slashOverride
        : detectSlashCommand(userMessage)
      : null;

  /* 本轮是不是「接着上一回写」。判定很严（整句就是一条续写指令），
     「继续讲讲这个」这类新需求不会误入续写分支。 */
  const resolved = resolveContinuation(userMessage, tab);
  const continuation = resolved?.ctx ?? null;
  if (resolved?.command && !slashHit) {
    slashHit = makeSlashHit(resolved.command, resolved.ctx.request);
  }

  if (tab === "chat") {
    systemPrompt = aiSettings.chatPrompt.trim() || CHAT_AGENT_PROMPT;
  } else if (tab === "writer") {
    systemPrompt = aiSettings.writerPrompt.trim() || WRITER_AGENT_PROMPT;
  } else {
    systemPrompt = aiSettings.auditorPrompt.trim() || AUDITOR_AGENT_PROMPT;
  }

  /* 附件内容作为后台上下文携带，绝不进入用户可见的消息文本。 */
  if (attachmentContext) {
    systemPrompt += `\n\n【附带附件 (仅供模型阅读，无需向用户复述原文)】:\n${attachmentContext}`;
  }

  /* Knowledge items are exposed as *tools*, not dumped into the prompt.
     The model receives a catalogue and reads only what it actually needs. */
  const scope: KnowledgeScope | null =
    tab === "chat" ? "chat" : tab === "writer" ? "writer" : tab === "auditor" ? "auditor" : null;
  const useKnowledgeTools = scope !== null && knowledgeList(scope).length > 0;

  if (scope && useKnowledgeTools) {
    systemPrompt += `\n\n${knowledgeManifest(scope)}`;
  }

  if (tab === "chat") {
    /* 对话 (chat) tab: selected material-library items ride along as back-end
       context only; they never appear in the user's visible bubble text. */
    const mats = aiSettings.materialLibraryEnabled ? selectedMaterials() : [];
    if (mats.length > 0) {
      const matContext = mats.map((m) => `[素材: ${m.title}]\n${m.content}`).join("\n\n---\n\n");
      systemPrompt += `\n\n【素材库 (后台携带)】:\n以下是用户选中的写作素材，供你在回答时参考运用，无需向用户复述素材原文：\n\n${matContext}`;
    }

    /* 命中指令 → 追加该指令的创作流程，并把本轮同时选中的素材库 / 叙事定制 /
       故事定制作为联动项一起交给它结合分析；没命中 → 明确按住"日常对话"这条线，
       免得挂了知识项之后模型闲聊也去翻写作规范。

       续写这一轮是第三条路：既不能按日常对话守则（那会让模型重新组织一段话），
       也不能按普通创作轮（那会重开头），要带着断点上下文接着写。 */
    systemPrompt += `\n\n${
      slashHit
        ? slashCommandDirective(slashHit, slashIntegrationContext(), continuation ?? undefined)
        : continuation
        ? chatContinuationDirective(continuation)
        : CHAT_CASUAL_GUARD
    }`;
  } else if (continuation) {
    /* AI写作 / 审核员两页没有创作指令体系，但一样会被长度上限截断。 */
    systemPrompt += `\n\n${chatContinuationDirective(continuation)}`;
  }

  if (aiSettings.webSearchEnabled) {
    systemPrompt += `\n\n【联网搜索: 已开启（${webSearchLabel.value}）】你拥有 web_search 实时网页搜索工具。当用户的问题涉及你可能不了解的最新事实、时效性数据、实时资讯或不确定的专业领域知识时，请先调用 web_search 工具检索网页获取真实资料，再基于检索结果作答；严禁凭记忆臆造不确定的信息。
  · 工具返回的是若干条「标题 / 链接 / 摘要」。请只依据这些内容作答，需要时可标注来源站点。
  · 若工具明确告知本次检索失败或没有相关结果，就如实向用户说明「这次没能拿到联网资料」，不要假装检索成功，也不要把记忆里的旧信息当成检索结果。
  · 一次检索的关键词不理想时，可换更精准的关键词再调用一次（最多两三次），不要反复空转。`;
  }

  /* 叙事定制：仅「对话 / AI写作」两个标签页；用户未勾选任何项时
     buildNarrativeDirective 返回空串，此处不做任何注入，流程与原来完全一致。 */
  if ((tab === "chat" || tab === "writer") && aiSettings.narrativeCraftEnabled) {
    const narrativeDirective = buildNarrativeDirective(tab);
    if (narrativeDirective) {
      systemPrompt += `\n\n${narrativeDirective}`;
    }
  }

  /* 故事定制（角色原型 / 情节）：仅「对话」标签页；未勾选时同样返回空串。 */
  if (tab === "chat" && aiSettings.storyCraftEnabled) {
    const storyDirective = buildStoryDirective();
    if (storyDirective) {
      systemPrompt += `\n\n${storyDirective}`;
    }
  }

  if (aiSettings.thinkingLevel) {
    const thinkLabel =
      aiSettings.thinkingLevel === "off"
        ? "关闭 (直接简洁输出结果，不展示思考过程)"
        : aiSettings.thinkingLevel === "standard"
        ? "标准 (一步步清晰分析推演，给出详尽完整的解答)"
        : "自动 (根据问题复杂程度自适应调节思考深度)";
    systemPrompt += `\n\n【思考等级: ${thinkLabel}】`;
  }

  if (tab === "writer") {
    const insightCtx = buildRAGInsightContext(userMessage);
    if (insightCtx) {
      systemPrompt = systemPrompt + "\n\n" + insightCtx;
    }
  }

  if (!apiKey.trim()) {
    onError("请先在设置中配置 API Key。");
    return;
  }

  /* 历史消息 → 模型输入。
     指令词不进 content，因此「只启用了创作模式、没写需求」的那一轮正文是空的。
     直接按非空过滤会把这一轮整条丢掉，历史里就会出现 assistant 紧跟 assistant
     的序列（Anthropic 等协议要求首条为 user，还可能直接报错）。这里给这类空轮
     补一句中性占位，把轮次结构保住 —— 指令块的「第五步」会负责礼貌地向用户
     要需求，不会凭空开写。

     创作指令是「每轮一次性」的，指令词又不在 content 里，模型看历史时无从得知
     某一轮走过创作模式。这里给带指令的用户轮加一句极简的模式标注，让「继续」
     这类跨轮请求能在历史里找到上下文锚点（标注只是给模型看的元信息，界面上
     的气泡仍然只显示需求正文）。 */
  const historyMsgs: AgentTurn[] = [];
  for (const m of targetMessages) {
    if (m.loading) continue;
    const content = m.content.trim();
    if (content.length > 0) {
      historyMsgs.push({
        role: m.role,
        content:
          m.role === "user" && m.slash
            ? `（本轮已启用「${m.slash.label}」创作模式）\n${m.content}`
            : m.role === "assistant" && m.incomplete
            ? `${m.content}\n\n[系统标注：以上正文在此处被输出长度上限截断，尚未写完。这行标注不属于正文，不要复述。]`
            : m.content,
      });
      continue;
    }
    if (m.role === "user" && m.slash) {
      historyMsgs.push({
        role: "user",
        content: `（我启用了「${m.slash.label}」创作模式，但这条消息里还没写需求。）`,
      });
    }
  }

  /* 兜底：本轮的用户消息若因任何原因没进上面的列表，补回来，保证模型一定能
     收到「这一轮用户说了什么」。 */
  const lastTurn = historyMsgs[historyMsgs.length - 1];
  if (!lastTurn || lastTurn.role !== "user") {
    historyMsgs.push({
      role: "user",
      content:
        userMessage.trim() ||
        (slashHit
          ? `（我启用了「${slashHit.command.label}」创作模式，但这条消息里还没写需求。）`
          : "（空消息）"),
    });
  }

  /* 非首轮对话：知识项内容已存在于上文（模型具备上下文记忆），
     除非用户明确要求重新查阅，否则不应重复调用工具阅读知识项。 */
  if (scope && useKnowledgeTools && historyMsgs.length > 1) {
    systemPrompt += `\n\n【上下文记忆提示】当前会话已有前文。若前面轮次中已经通过工具阅读过相关知识项，其内容已在你的上下文中，请直接沿用记忆作答；除非用户明确要求「重新查阅/更新」某个知识项，否则不要再调用 read_knowledge / search_knowledge 重复阅读。`;
  }

  /* 编辑区工具：按当前所在的主界面挂载，各界面互不越界。
     文档界面 → 只给文档工具；写作画布 → 只给卡片工具；其余界面（洞察等）
     不挂任何编辑区工具，AI 只依据对话与附件作答。 */
  if (workspace.value === "docs") {
    systemPrompt += `\n\n【文档编辑区工具（当前界面：文档）】你有 5 个工具可读写「文档」界面里的文档条目：list_documents / read_document / create_document / update_document / append_document。
  · 用户说「分析/总结/审阅/评价这篇文档、当前文档、选中的文档、上面的正文」时，先调用 read_document（省略 title 即读用户当前打开的那一篇）把正文读进来，再基于真实正文作答，严禁凭空猜测内容。
  · 只有用户明确要求「改写/替换/润色这篇文档」才调用 update_document；明确要求「续写/追加」才调用 append_document。没有明确指示时一律只读不写。
  · 用户明确要求「新建/创建一篇文档」「把这些内容单独存成一篇新文档」时，调用 create_document 新建条目，不要用 update_document 覆盖现有文档。反之，用户要改的是已有文档时，也不要用 create_document 另建一篇。
  · 本界面下你接触不到、也不要提及写作画布的文本卡片；用户此刻说的「正文 / 这段 / 这篇」指的都是文档条目。`;
  } else if (workspace.value === "cards") {
    systemPrompt += `\n\n【画布文本卡片工具（当前界面：写作画布）】你有 4 个工具可读写写作画布里的文本卡片：list_cards / read_card / create_card / update_card。只有当你明确收到这类指令时才使用它们——例如用户说「把这段内容创建为卡片放入画布」「阅读某某卡片后重新输出」「修改某张卡片」；若用户没有明确要求操作卡片，就按当前任务正常作答，不要自行创建、改动或删除任何文本卡片。
  · 本界面下你接触不到、也不要提及「文档」界面的文档条目；用户此刻说的「这段 / 这张」指的都是画布卡片。`;
  } else {
    systemPrompt += `\n\n【当前界面没有可操作的编辑区】你此刻拿不到文档条目，也拿不到画布文本卡片，不要声称已读取或已改动它们。请只依据对话内容与用户挂载的附件作答；确实需要正文时，请用户把内容粘贴进来或切到对应界面。`;
  }

  const traces: ToolTrace[] = [];

  /* Knowledge items + web search + the current workspace's editor tools. */
  const toolDefs: ToolDefinition[] = [];
  if (workspace.value === "docs") toolDefs.push(...docToolDefinitions());
  else if (workspace.value === "cards") toolDefs.push(...cardToolDefinitions());
  if (scope && useKnowledgeTools) toolDefs.push(...knowledgeToolDefinitions(scope));
  if (aiSettings.webSearchEnabled) toolDefs.push(...webSearchToolDefinitions());
  const useTools = toolDefs.length > 0;

  /* 一个回合要交付完整正文：正文被输出长度上限截断时，runAgent 内部自动接着写，
     直到写完或用满次数。创作模式（身份模板）篇幅长、最需要这层保底，给足次数；
     日常问答给两次即可，避免闲聊被无谓地拉长。 */
  const creativeTurn = !!slashHit || !!continuation;
  let autoContinued = 0;

  const baseRun = {
    provider,
    apiType: aiSettings.apiType,
    apiKey,
    url,
    model,
    messages: historyMsgs.length > 0 ? historyMsgs : [{ role: "user" as const, content: userMessage }],
    stream: true,
    autoContinue: creativeTurn ? AUTO_CONTINUE_CREATIVE : AUTO_CONTINUE_CASUAL,
    /* 中转接口常常不回传 finish_reason，纯靠协议信号会漏判：正文形态上明显
       断在半句里时也补一次续写。仅创作轮启用，免得把日常问答的短回复误判。 */
    needsContinuation: creativeTurn ? looksUnfinished : undefined,
    onAutoContinue: (attempt: number) => {
      autoContinued = attempt;
      onTool?.([
        ...traces,
        { label: `正文被长度上限截断，正在接着写完（第 ${attempt} 次）`, done: false },
      ]);
    },
    onChunk,
    onReasoning,
    signal,
  };

  try {
    let result;
    try {
      result = await runAgent({
        ...baseRun,
        systemPrompt,
        tools: useTools ? toolDefs : undefined,
        executeTool: useTools
          ? (name: string, args: Record<string, unknown>) => {
              /* 只执行当前界面挂载的那一套编辑区工具。
                 模型若凭记忆调了另一界面的工具，这里明确回绝，
                 免得它跨区读写到别的界面的内容。 */
              if (isDocTool(name)) {
                if (workspace.value !== "docs") {
                  return `当前不在「文档」界面，${name} 不可用。请只处理当前界面的内容。`;
                }
                return runDocTool(name, args);
              }
              if (isCardTool(name)) {
                if (workspace.value !== "cards") {
                  return `当前不在「写作画布」界面，${name} 不可用。请只处理当前界面的内容。`;
                }
                return runCardTool(name, args);
              }
              if (isWebSearchTool(name)) {
                /* 把本轮的中止信号一路传下去：用户点「停止生成」时，
                   正在跑的搜索请求也要立刻掐掉，不再干等到超时。 */
                return runWebSearch(String(args.query ?? args.q ?? args.keyword ?? ""), signal);
              }
              if (scope && useKnowledgeTools) return runKnowledgeTool(scope, name, args);
              return `未知工具: ${name}`;
            }
          : undefined,
        onToolCall: (call) => {
          const label = isDocTool(call.name)
            ? describeDocToolCall(call.name, call.args)
            : isCardTool(call.name)
            ? describeCardToolCall(call.name, call.args)
            : isWebSearchTool(call.name)
            ? describeWebSearchToolCall(call.name, call.args)
            : describeKnowledgeToolCall(call.name, call.args);
          traces.push({ label, done: false });
          onTool?.([...traces]);
        },
        onToolResult: (_call, output) => {
          const last = traces[traces.length - 1];
          if (last) {
            last.done = true;
            last.detail = output.split("\n")[0]?.slice(0, 60) ?? "";
          }
          onTool?.([...traces]);
        },
      });
    } catch (error: unknown) {
      /* Some relays / older models reject the `tools` field outright. Fall back
         to the legacy behavior (knowledge inlined into the prompt) instead of
         failing the whole turn. */
      if (!(scope && useKnowledgeTools) || !isToolUnsupportedError(error)) throw error;

      traces.length = 0;
      onTool?.([]);
      result = await runAgent({
        ...baseRun,
        systemPrompt: `${systemPrompt}\n\n${inlineKnowledgeFallback(scope)}`,
      });
    }

    /* 全局 Token 账本：按当前标签分桶，主页 HUD 读的就是这份数据。 */
    const bucket: TokenCategory = tab === "chat" ? "chat" : tab === "writer" ? "writer" : "auditor";
    recordTokens(bucket, result.tokens);

    /* 自动续写的过程提示是临时的，收尾时撤掉，只留真正的工具轨迹。 */
    if (autoContinued > 0) onTool?.([...traces]);

    /* 用满续写次数仍没写完 → 如实标记，气泡下方给出「接着写完」入口，
       而不是把半截正文当成完成品交出去。 */
    onDone(result.text || "未收到回复内容", result.tokens, {
      incomplete: result.truncated,
      continued: autoContinued,
    });
  } catch (error: unknown) {
    /* 用户点击「停止生成」时主动中止：静默收起 loading 状态即可。 */
    if (error instanceof Error && error.name === "AbortError") {
      onAbort?.();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("AI API 调用失败:", message);
    onError(`请求失败: ${message}\n\n请检查网络连接和 API 配置。`);
  }
}

/** Heuristic: does this API error mean "this model/relay has no tool support"? */
function isToolUnsupportedError(error: unknown): boolean {
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  if (!/\b(400|404|422)\b/.test(msg)) return false;
  return /tool|function[_ ]?call/.test(msg);
}

/** Legacy path: paste knowledge content straight into the system prompt. */
function inlineKnowledgeFallback(scope: KnowledgeScope): string {
  const files = knowledgeList(scope);
  if (files.length === 0) return "";
  const ctx = files.map((k) => `[知识文件: ${k.name}]\n${k.content}`).join("\n\n---\n\n");
  return `【内置知识库资料 (当前模型不支持工具调用，已直接携带)】:\n${ctx}`;
}

/**
 * 发送一条消息。
 *
 * overrideText：不取输入框内容，直接发这段文字（「接着写完」按钮用）。
 * 这种情况下输入框里的草稿与创作模式胶囊一律不动 —— 用户可能正打着下一条
 * 消息，续写不该把它清掉。
 */
async function sendMessage(overrideText?: string) {
  /* 叙事定制与创作指令都以胶囊形式独立存在，不在 textarea 里；这里只处理正文。
     stripNarrativeTag 兜底清掉用户从旧版本粘贴进来的明文标记。

     指令词绝不拼进消息正文：以前为了让后端认出指令，发送时会把 `/身份模板`
     拼回行首，于是已发送的气泡里就出现了一行明文指令（还随 content 一起被
     复制 / 拖拽带走）。现在指令作为独立元数据传给 streamAiReply，气泡里则渲染
     成不可编辑的胶囊。 */
  const body = stripNarrativeTag(overrideText ?? currentComposerText.value).trim();
  /* 续写这一路不看输入框的胶囊：它属于用户正在写的下一条消息，本轮该沿用的
     是上一回合的创作模式（由 resolveContinuation 从历史里取回）。 */
  const slash = overrideText === undefined ? activeSlashCommand.value : null;
  const text = body;
  if ((!text && !slash) || isSendingCurrent.value) return;

  /* Ensure the current conversation is backed by a history entry so it can be
     re-opened later and always survives an app restart. */
  const activeHid = currentActiveHistoryId.value;
  const activeHistory = currentChatHistory.value.find((h) => h.id === activeHid);
  if (activeHid == null || !activeHistory) {
    const historyList = currentChatHistory.value;
    const id = Date.now();
    const newItem: ChatHistoryItem = {
      id,
      title: `新对话 ${historyList.length + 1}`,
      time: formatTimestamp(),
      messages: [],
    };
    historyList.unshift(newItem);
    currentActiveHistoryId.value = id;
  } else {
    /* 继续已有会话：发送即视为活动，刷新时间戳为当前时间。 */
    activeHistory.time = formatTimestamp();
  }

  const currentTab = activeSidebarTab.value;
  setTabSending(currentTab, true);

  /* 附件以“挂载”形式存在：气泡里只显示小标签，原文作为后台上下文传给模型。

     续写这一路不吃附件：挂载的卡片 / 文件属于用户正在准备的下一条消息，
     「接着写完」只该把上一回的正文续上，不该顺手把它们消耗掉。 */
  const attachments = overrideText === undefined ? cardAttachments.items : [];
  const attachFiles = overrideText === undefined ? fileAttachments.items : [];
  const attachmentMeta: { kind: "card" | "file"; label: string }[] = [];
  const attachmentContextParts: string[] = [];

  if (attachments.length > 0) {
    attachmentContextParts.push(
      attachments.map((a) => `[卡片: ${a.title}]\n${a.content}`).join("\n\n---\n\n"),
    );
    attachmentMeta.push(...attachments.map((a) => ({ kind: "card" as const, label: a.title })));
  }
  if (attachFiles.length > 0) {
    attachmentContextParts.push(
      attachFiles
        .map((a) => `[附件文件: ${a.name}]\n${a.content || "(读取文件文本内容失败，仅附带文件名)"}`)
        .join("\n\n---\n\n"),
    );
    attachmentMeta.push(...attachFiles.map((a) => ({ kind: "file" as const, label: a.name })));
  }
  const attachmentContext = attachmentContextParts.join("\n\n---\n\n");

  const targetList =
    currentTab === "chat"
      ? freeChatMessages.value
      : currentTab === "writer"
      ? writerMessages.value
      : auditorMessages.value;

  /* 本轮生效的叙事定制：只作为气泡上的展示胶囊留档，指令本体走系统提示词。 */
  const narrativeMeta =
    (currentTab === "chat" || currentTab === "writer") && aiSettings.narrativeCraftEnabled
      ? narrativeChips(currentTab).map((c) => ({ kindLabel: c.kindLabel, name: c.name }))
      : [];

  /* 故事定制只在「对话」页生效，其余页不留档。 */
  const storyMeta =
    currentTab === "chat" && aiSettings.storyCraftEnabled
      ? storyChips().map((c) => ({ kindLabel: c.kindLabel, name: c.name }))
      : [];

  /* 本轮生效的创作指令：与叙事 / 故事定制同样只作为展示元数据留档，
     不进 content —— 气泡里渲染成不可编辑胶囊，复制 / 拖拽都带不走它。

     用户打「继续」时胶囊是空的（创作指令每轮一次性），但这一轮实际仍在上一回合
     的创作模式里跑。这里把模式接回来一并留档，界面上的胶囊与告知条才和真正
     生效的提示词一致，历史里也留下了模式锚点供再次续写时接续。 */
  const cont = resolveContinuation(text, currentTab);
  const effectiveSlash = slash ?? cont?.command ?? null;
  const slashMeta = effectiveSlash ? { id: effectiveSlash.id, label: effectiveSlash.label } : undefined;
  /* 「创作模式已生效」告知条要用的联动清单，在清空勾选前先算好。 */
  const modeMeta = effectiveSlash
    ? { label: effectiveSlash.label, parts: cont ? ["接着上一回写完", ...slashModeParts()] : slashModeParts() }
    : cont
    ? { label: "续写", parts: ["接着上一回写完"] }
    : undefined;

  const userMsg: ChatMessage = {
    id: Date.now(),
    role: "user",
    content: text,
    attachments: attachmentMeta.length > 0 ? attachmentMeta : undefined,
    narrative: narrativeMeta.length > 0 ? narrativeMeta : undefined,
    story: storyMeta.length > 0 ? storyMeta : undefined,
    slash: slashMeta,
  };
  targetList.push(userMsg);
  if (overrideText === undefined) {
    cardAttachments.items = [];
    fileAttachments.items = [];
  }

  /* 叙事定制是「常驻偏好」而非一次性输入：发送后勾选保持不变，输入框内的
     胶囊继续留在原位，用户随时看到当前生效的定制项。
     创作指令是「每轮一次性」的：指令已作为元数据随这条消息留档，发送后胶囊
     复位，下一条消息不会意外继续带着创作模式。

     overrideText 这一路（「接着写完」按钮）不碰输入框：发出去的不是用户正在
     写的那段文字，凭什么替他清掉。 */
  if (overrideText === undefined) {
    if (currentTab === "chat") {
      freeChatComposerText.value = "";
      chatSlashCmd.value = null;
    } else if (currentTab === "writer") writerComposerText.value = "";
    else auditorComposerText.value = "";

    if (composerRef.value) {
      composerRef.value.style.height = "auto";
    }
  }

  const aiMsgId = Date.now() + 1;
  const aiMsg: ChatMessage = {
    id: aiMsgId,
    role: "assistant",
    content: "",
    loading: true,
    /* 非正文的明确告知：本轮已进入哪种创作模式、与哪些定制项联动。
       只报「已进入」这件事，绝不回显身份模板的任何内容。 */
    mode: modeMeta,
  };
  targetList.push(aiMsg);

  const abort = new AbortController();
  activeAbortControllers[currentTab] = abort;

  let settled = false;
  const finalizeSending = () => {
    settled = true;
    setTabSending(currentTab, false);
    if (activeAbortControllers[currentTab] === abort) activeAbortControllers[currentTab] = null;
  };

  guardSending(
    streamAiReply(
      text,
      currentTab,
      (chunk) => {
        const idx = targetList.findIndex((m) => m.id === aiMsgId);
        if (idx !== -1) {
          targetList[idx] = { ...targetList[idx], content: chunk, loading: chunk.length === 0 };
        }
      },
      (fullText, tokens, meta) => {
        const idx = targetList.findIndex((m) => m.id === aiMsgId);
        if (idx !== -1) {
          targetList[idx] = {
            ...targetList[idx],
            content: fullText,
            loading: false,
            tokens,
            timestamp: formatTimestamp(),
            incomplete: meta?.incomplete || undefined,
            continued: meta?.continued || undefined,
          };
        }
        finalizeSending();
      },
      (errorMsg) => {
        const idx = targetList.findIndex((m) => m.id === aiMsgId);
        if (idx !== -1) {
          targetList[idx] = { ...targetList[idx], content: errorMsg, loading: false };
        }
        finalizeSending();
      },
      (traces) => {
        const idx = targetList.findIndex((m) => m.id === aiMsgId);
        if (idx !== -1) {
          targetList[idx] = { ...targetList[idx], tools: traces };
        }
      },
      attachmentContext,
      abort.signal,
      () => {
        const idx = targetList.findIndex((m) => m.id === aiMsgId);
        if (idx !== -1) {
          /* 用户点「停止生成」：这条正文按定义就是没写完的。如实标记，
             气泡下方给出「接着写完」，下一轮据此从断点续上。 */
          const partial = targetList[idx].content.trim().length > 0;
          targetList[idx] = {
            ...targetList[idx],
            loading: false,
            incomplete: partial || undefined,
            timestamp: partial ? formatTimestamp() : targetList[idx].timestamp,
          };
        }
        finalizeSending();
      },
      (reasoning) => {
        const idx = targetList.findIndex((m) => m.id === aiMsgId);
        if (idx !== -1) {
          targetList[idx] = { ...targetList[idx], reasoning };
        }
      },
      slash ? makeSlashHit(slash, body) : null,
    ),
    finalizeSending,
    () => settled,
  );
}

/** 用户点击「停止生成」：只中止当前页签正在进行的那一路 AI 请求。 */
function stopGeneration() {
  activeAbortControllers[activeSidebarTab.value]?.abort();
}

/**
 * 「接着写完」：为没写完的那条回复补一轮续写。
 *
 * 走的仍是正常的发送路径（发一条「继续」），因此续写沿用同一套上下文组装：
 * streamAiReply 会认出这是续写请求，把上一回合的创作指令、需求原文与断点
 * 一并接回来。这样按钮与用户手打「继续」表现完全一致，不存在两套逻辑。
 * 用 overrideText 而非写进输入框，是为了不动用户正在写的草稿。
 */
function continueUnfinished(message: ChatMessage) {
  if (message.loading || isSendingCurrent.value) return;
  const list = currentMessages.value;
  /* 只对「最后一条回复」有意义：接着写的是当前断点，不是历史里的某个旧断点。 */
  const lastAi = findPrevTurn(list);
  if (!lastAi || lastAi.ai.id !== message.id) {
    showToast("无法接续", "只能接着写最新那条未写完的回复。", "edit");
    return;
  }
  sendMessage("继续");
}

function regenerateMessage(message: ChatMessage) {
  if (message.loading) return;
  if (isSendingCurrent.value) return;

  const messages = currentMessages.value;
  const idx = messages.findIndex((m) => m.id === message.id);
  if (idx === -1) return;

  let userIdx = -1;
  for (let i = idx - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userIdx = i;
      break;
    }
  }
  if (userIdx === -1 || idx <= userIdx) return;

  const userMsg = messages[userIdx];
  const currentTab = activeSidebarTab.value;
  setTabSending(currentTab, true);

  const history = currentChatHistory.value.find((h) => h.id === currentActiveHistoryId.value);
  if (history) history.time = formatTimestamp();

  /* 重新生成要沿用那一轮的创作指令。指令词不在正文里，只能从消息元数据取；
     老数据（指令词还写在正文里的那一批）则由 streamAiReply 内部按正文识别兜底。 */
  const prevSlash = userMsg.slash
    ? SLASH_COMMANDS.find((c) => c.id === userMsg.slash!.id) ?? null
    : undefined;

  const targetList = currentMessages.value;
  const prevMode = messages[idx]?.mode;
  targetList.splice(idx, targetList.length - idx);

  const aiMsgId = Date.now() + 1;
  const aiMsg: ChatMessage = {
    id: aiMsgId,
    role: "assistant",
    content: "",
    loading: true,
    mode: prevMode,
  };
  targetList.push(aiMsg);

  const abort = new AbortController();
  activeAbortControllers[currentTab] = abort;

  let settled = false;
  const finalizeSending = () => {
    settled = true;
    setTabSending(currentTab, false);
    if (activeAbortControllers[currentTab] === abort) activeAbortControllers[currentTab] = null;
  };

  guardSending(
    streamAiReply(
      userMsg.content.trim(),
      currentTab,
      (chunk) => {
        const arr = currentMessages.value;
        const ci = arr.findIndex((m) => m.id === aiMsgId);
        if (ci !== -1) arr[ci] = { ...arr[ci], content: chunk, loading: chunk.length === 0 };
      },
      (fullText, tokens, meta) => {
        const arr = currentMessages.value;
        const ci = arr.findIndex((m) => m.id === aiMsgId);
        if (ci !== -1) {
          arr[ci] = {
            ...arr[ci],
            content: fullText,
            loading: false,
            tokens,
            timestamp: formatTimestamp(),
            incomplete: meta?.incomplete || undefined,
            continued: meta?.continued || undefined,
          };
        }
        finalizeSending();
      },
      (errorMsg) => {
        const arr = currentMessages.value;
        const ci = arr.findIndex((m) => m.id === aiMsgId);
        if (ci !== -1) arr[ci] = { ...arr[ci], content: errorMsg, loading: false };
        finalizeSending();
      },
      (traces) => {
        const arr = currentMessages.value;
        const ci = arr.findIndex((m) => m.id === aiMsgId);
        if (ci !== -1) arr[ci] = { ...arr[ci], tools: traces };
      },
      undefined,
      abort.signal,
      () => {
        const arr = currentMessages.value;
        const ci = arr.findIndex((m) => m.id === aiMsgId);
        if (ci !== -1) {
          const partial = arr[ci].content.trim().length > 0;
          arr[ci] = {
            ...arr[ci],
            loading: false,
            incomplete: partial || undefined,
            timestamp: partial ? formatTimestamp() : arr[ci].timestamp,
          };
        }
        finalizeSending();
      },
      (reasoning) => {
        const arr = currentMessages.value;
        const ci = arr.findIndex((m) => m.id === aiMsgId);
        if (ci !== -1) arr[ci] = { ...arr[ci], reasoning };
      },
      prevSlash === undefined
        ? undefined
        : prevSlash
        ? makeSlashHit(prevSlash, userMsg.content.trim())
        : null,
    ),
    finalizeSending,
    () => settled,
  );
}

function handleComposerKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    sendMessage();
  }
}

function handleComposerInput() {
  /* 在「对话」输入框里刚打出头一个「/」时，顺手把创作指令菜单弹出来——
     与左下角那个「/」按钮共用同一个面板。不再以 / 开头就收起来。 */
  if (activeSidebarTab.value === "chat") {
    const text = currentComposerText.value;
    if (text === "/" || text === "／") {
      activePopover.value = "slash";
    } else if (activePopover.value === "slash" && !/^\s*[/／]/.test(text)) {
      activePopover.value = null;
    }
  }

  nextTick(() => {
    if (composerRef.value) {
      composerRef.value.style.height = "auto";
      composerRef.value.style.height = Math.min(composerRef.value.scrollHeight, 150) + "px";
    }
  });
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function triggerFileInput() {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".pdf,.docx,.txt,.md,.markdown,.png,.jpg,.jpeg";
  input.onchange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (files && files.length > 0) {
      Array.from(files).forEach((file) => {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
        if (["txt", "md", "markdown"].includes(ext)) {
          file
            .text()
            .then((content) => addFileAttachment(file.name, content, file.size))
            .catch(() => addFileAttachment(file.name, "", file.size));
        } else {
          addFileAttachment(file.name, "", file.size);
        }
      });
    }
    target.value = "";
  };
  input.click();
}

function renderMessageContent(content: string): string {
  return renderMarkdown(content);
}

function handleClickOutside(event: MouseEvent) {
  const menuEl = historyMenuRef.value;
  if (menuEl && !menuEl.contains(event.target as Node)) {
    historyMenuOpen.value = false;
  }
  const moreEl = moreMenuRef.value;
  if (moreEl && !moreEl.contains(event.target as Node)) {
    moreMenuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
  window.addEventListener("resize", onWindowResize);
  loadSidebarWidth();
  prevLength[activeSidebarTab.value] = currentMessages.value.length;
  scrollToBottom();
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutside);
  window.removeEventListener("resize", onWindowResize);
});
</script>

<template>
  <aside class="chat-sidebar" :class="{ resizing }" :style="{ width: sidebarWidth + 'px' }">
    <!-- 左边框拖拽手柄：调整聊天面板与左侧区域的宽度比例 -->
    <div
      class="chat-resizer"
      :class="{ active: resizing }"
      title="拖动调整面板宽度（双击恢复默认）"
      @mousedown="startResize"
      @dblclick="resetWidth"
    ></div>
    <div class="chat-header">
      <div class="chat-header-left">
        <button class="icon-btn" title="收起侧边栏" @click="$emit('close')">
          <PanelRightClose :size="20" :stroke-width="1.7" />
        </button>
        <div class="agent-nav-tabs">
          <button
            class="agent-nav-btn"
            :class="{ active: activeSidebarTab === 'chat' }"
            @click="activeSidebarTab = 'chat'"
          >
            对话
          </button>
          <button
            class="agent-nav-btn"
            :class="{ active: activeSidebarTab === 'writer' }"
            @click="activeSidebarTab = 'writer'"
          >
            AI写作
          </button>
          <button
            class="agent-nav-btn"
            :class="{ active: activeSidebarTab === 'auditor' }"
            @click="activeSidebarTab = 'auditor'"
          >
            审核意见
          </button>
        </div>
      </div>

      <div ref="historyMenuRef" class="chat-header-right">
        <button class="icon-btn" title="新建对话" @click="toggleHistoryMenu">
          <MessageSquarePlus :size="18" :stroke-width="1.7" />
        </button>
        <div ref="moreMenuRef" class="more-menu-wrap">
          <button class="icon-btn" title="更多选项" @click.stop="toggleMoreMenu">
            <MoreHorizontal :size="20" :stroke-width="1.7" />
          </button>

          <Transition name="dropdown">
            <div v-if="moreMenuOpen" class="more-menu">
              <div class="menu-section-title">对话记录</div>
              <button class="menu-item" @click="downloadChatRecords">
                <Download :size="15" :stroke-width="1.8" />
                下载对话记录JSON
              </button>
              <button class="menu-item" @click="importChatRecords">
                <Upload :size="15" :stroke-width="1.8" />
                导入对话记录JSON
              </button>
            </div>
          </Transition>
        </div>

        <Transition name="dropdown">
          <div v-if="historyMenuOpen" class="history-menu">
            <button class="menu-item" @click="createNewChat">
              <MessageSquarePlus :size="15" :stroke-width="1.8" />
              新建对话
            </button>
            <div class="menu-divider"></div>
            <div class="menu-section-title">
              {{ activeSidebarTab === 'chat' ? '对话历史' : activeSidebarTab === 'writer' ? 'AI写作历史' : '审核员历史' }}
            </div>
            <div class="history-list">
              <div v-for="item in currentChatHistory" :key="item.id" class="history-item">
                <button class="history-title" @click="selectHistory(item.id)">
                  <span class="history-name">{{ item.title }}</span>
                  <span class="history-time">{{ item.time }}</span>
                </button>
                <button
                  class="history-delete"
                  title="删除对话"
                  @click.stop="deleteHistoryItem(item.id)"
                >
                  <Trash2 :size="14" :stroke-width="1.8" />
                </button>
              </div>
              <div v-if="currentChatHistory.length === 0" class="history-empty">
                暂无历史对话
              </div>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <div ref="chatMessagesRef" class="chat-messages" @scroll="handleMessagesScroll">
      <div v-if="currentMessages.length === 0" class="chat-empty">
        {{ activeSidebarTab === 'chat' ? '轻松与 AI 展开自由对话...' : activeSidebarTab === 'writer' ? '开始AI写作对话吧' : '粘贴草稿开始审查评估吧' }}
      </div>

      <div v-for="message in currentMessages" :key="message.id" class="message" :class="message.role">
        <template v-if="message.role === 'user'">
          <div class="user-head">
            <div class="message-label">用户</div>
            <div class="message-actions user-actions">
              <button
                class="mini-icon-btn"
                title="撤回此消息（内容回归输入框）"
                @click.stop="recallUserMessage(message)"
              >
                <RotateCcw :size="13" :stroke-width="1.8" />
              </button>
              <button
                class="mini-icon-btn danger"
                title="删除消息"
                @click.stop="deleteUserMessage(message)"
              >
                <Trash2 :size="13" :stroke-width="1.8" />
              </button>
            </div>
          </div>
          <div class="user-body">
            <!-- 创作指令：在已发送的气泡里同样渲染成不可编辑的胶囊。
                 指令词不在 message.content 里；历史消息（旧版本把指令词拼进了
                 正文）由 bubbleSlashLabel / bubbleText 兜底剥离，因此老对话
                 回看时也不会再出现明文 `/身份模板`。 -->
            <div v-if="bubbleSlashLabel(message)" class="user-attachments">
              <span class="user-attach-chip slash-attach-chip" title="本轮生效的创作模式">
                <Slash :size="11" :stroke-width="2.2" />
                {{ bubbleSlashLabel(message) }}
              </span>
            </div>
            <div v-if="bubbleText(message)" class="user-text">{{ bubbleText(message) }}</div>
            <div v-else-if="bubbleSlashLabel(message)" class="user-text muted-text">
              （仅启用创作模式，未附需求正文）
            </div>
            <div
              v-if="(message.story && message.story.length > 0) || (message.narrative && message.narrative.length > 0)"
              class="user-attachments"
            >
              <span
                v-for="(st, si) in message.story || []"
                :key="'s' + si"
                class="user-attach-chip story-attach-chip"
              >
                <Drama :size="11" :stroke-width="1.9" />
                {{ st.kindLabel }}·{{ st.name }}
              </span>
              <span
                v-for="(nar, ni) in message.narrative || []"
                :key="'n' + ni"
                class="user-attach-chip narrative-attach-chip"
              >
                <Layers :size="11" :stroke-width="1.9" />
                {{ nar.kindLabel }}·{{ nar.name }}
              </span>
            </div>
            <div v-if="message.attachments && message.attachments.length > 0" class="user-attachments">
              <span v-for="(att, ai) in message.attachments" :key="ai" class="user-attach-chip">
                <FileText v-if="att.kind === 'card'" :size="11" :stroke-width="1.9" />
                <Paperclip v-else :size="11" :stroke-width="1.9" />
                {{ att.label }}
              </span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="message-label">
            {{ activeSidebarTab === 'chat' ? 'AI 助手' : activeSidebarTab === 'writer' ? WRITER_AGENT_NAME : AUDITOR_AGENT_NAME }}
          </div>
          <div
            class="assistant-reply-zone"
            :class="{ dragging: draggingMessageId === message.id, loading: message.loading }"
            @mousedown="beginMessageDrag($event, message)"
          >
            <div class="assistant-head">
              <div
                class="drag-handle-wrapper"
                :title="props.activeMainTab === 'docs' ? '长按拖动到文档编辑区，松开插入光标处' : '长按拖动到画布创建文本卡片'"
              >
                <GripVertical :size="14" :stroke-width="1.7" class="drag-handle" />
              </div>
              <span class="model-label" :title="currentModelLabel">{{ currentModelLabel }}</span>
              <div class="message-actions">
                <button
                  class="mini-icon-btn"
                  :title="props.activeMainTab === 'docs' ? '应用到文档编辑区' : '应用到画布'"
                  @click.stop="applyToCard(message)"
                >
                  <FileText :size="13" :stroke-width="1.8" />
                </button>
                <button class="mini-icon-btn" title="复制" @click.stop="copyText(message.content, $event)">
                  <Copy :size="13" :stroke-width="1.8" />
                </button>
                <button class="mini-icon-btn" title="重新生成" @click.stop="regenerateMessage(message)">
                  <RefreshCw :size="13" :stroke-width="1.8" />
                </button>
                <button class="mini-icon-btn" title="编辑" @click.stop="startEdit(message)">
                  <Pencil :size="13" :stroke-width="1.8" />
                </button>
                <button class="mini-icon-btn danger" title="删除消息" @click.stop="deleteMessage(message.id)">
                  <Trash2 :size="13" :stroke-width="1.8" />
                </button>
              </div>
            </div>
            <template v-if="editingMessageId === message.id">
              <textarea v-model="editContent" v-auto-pair class="edit-textarea" rows="4"></textarea>
              <div class="edit-actions">
                <button class="edit-btn save" @click.stop="saveEdit(message)"><Check :size="14" /> 保存</button>
                <button class="edit-btn cancel" @click.stop="cancelEdit"><X :size="14" /> 取消</button>
              </div>
            </template>
            <template v-else>
              <!-- 创作模式生效告知：非正文，只报「已进入哪种模式、带上了哪些
                   定制项」，不呈现身份模板的任何内容；也不参与复制 / 拖拽。 -->
              <div v-if="message.mode" class="mode-banner" title="本轮已按创作模式生成（模板内容不对外展示）">
                <Slash :size="11" :stroke-width="2.4" />
                <span class="mode-banner-label">创作模式已生效 · {{ message.mode.label }}</span>
                <span v-if="message.mode.parts.length > 0" class="mode-banner-parts">
                  联动 {{ message.mode.parts.join(' / ') }}
                </span>
              </div>
              <div v-if="message.reasoning" class="thinking-panel">
                <button class="thinking-toggle" @click="toggleReasoning(message.id)">
                  <ChevronRight v-if="!expandedReasoningIds.has(message.id)" :size="12" :stroke-width="2" />
                  <ChevronDown v-else :size="12" :stroke-width="2" />
                  <BrainCircuit :size="12" :stroke-width="2" />
                  思考过程
                  <span class="thinking-badge">
                    {{ expandedReasoningIds.has(message.id) ? "收起" : "展开" }}
                  </span>
                </button>
                <div v-if="expandedReasoningIds.has(message.id)" class="thinking-body">
                  {{ message.reasoning }}
                </div>
              </div>
              <div v-if="message.tools && message.tools.length > 0" class="tool-trace">
                <div
                  v-for="(trace, ti) in message.tools"
                  :key="ti"
                  class="tool-trace-row"
                  :class="{ done: trace.done }"
                  :title="trace.detail || ''"
                >
                  <BookOpenCheck v-if="trace.done" :size="12" :stroke-width="1.9" />
                  <BookOpen v-else :size="12" :stroke-width="1.9" class="spin-soft" />
                  <span class="tool-trace-label">{{ trace.label }}</span>
                </div>
              </div>
              <div v-if="message.loading" class="assistant-body typing-indicator">
                <span class="dot"></span>
                <span class="dot"></span>
                <span class="dot"></span>
              </div>
              <div v-else class="assistant-body markdown-body" v-html="renderMessageContent(message.content)"></div>
              <!-- 正文没写完的明确告知 + 一键接着写。非正文，不参与复制 / 拖拽。 -->
              <div v-if="!message.loading && message.incomplete" class="incomplete-bar">
                <span class="incomplete-text">正文尚未写完（被输出长度上限截断或已中止）</span>
                <button
                  class="incomplete-btn"
                  title="从断点接着把正文写完（沿用本轮的创作模式与需求）"
                  :disabled="isSendingCurrent"
                  @click.stop="continueUnfinished(message)"
                >
                  <ArrowUp :size="11" :stroke-width="2.2" />
                  接着写完
                </button>
              </div>
            </template>
            <!-- Token 消耗统计：仅展示消耗情况，不属于正文，复制/拖拽生成卡片时不会进入内容 -->
            <div v-if="!message.loading && (message.tokens || message.timestamp || message.continued)" class="assistant-footer-meta">
              <div
                v-if="!message.loading && message.tokens"
                class="token-widget"
                title="本次回复消耗的 Token 数"
              >
                <Coins :size="11" :stroke-width="1.9" />
                <span>Tokens</span>
                <strong>{{ message.tokens.toLocaleString() }}</strong>
              </div>
              <div
                v-if="!message.loading && message.continued"
                class="continued-widget"
                title="本轮正文曾被输出长度上限截断，已在同一回合内自动接着写完"
              >
                自动接续 {{ message.continued }} 次
              </div>
              <div v-if="!message.loading && message.timestamp" class="message-timestamp" title="回复时间戳">
                {{ message.timestamp }}
              </div>
            </div>
          </div>
        </template>
      </div>
    </div>

    <Transition name="dropdown">
      <button
        v-if="showScrollToBottom"
        class="scroll-bottom-btn"
        title="回到最底部"
        @click="scrollToBottom(true)"
      >
        <ChevronDown :size="16" :stroke-width="2.4" />
      </button>
    </Transition>

    <div class="chat-composer">
      <!-- 素材库 + 故事定制 (仅对话) + 叙事定制 (对话 / AI写作) -->
      <div ref="materialsWrapRef" class="materials-wrap">
      <div v-if="activeSidebarTab !== 'auditor'" class="material-bar">
        <button
          v-if="activeSidebarTab === 'chat' && aiSettings.materialLibraryEnabled"
          class="material-toggle-btn"
          :class="{ active: materialsOpen }"
          @click="toggleMaterialsPanel"
        >
          <Library :size="14" :stroke-width="1.8" />
          素材库
          <span v-if="selectedMaterials().length > 0" class="material-count">{{ selectedMaterials().length }}</span>
        </button>
        <button
          v-if="activeSidebarTab === 'chat' && aiSettings.storyCraftEnabled"
          class="material-toggle-btn"
          :class="{ active: storyOpen }"
          title="自由点选角色原型 / 情节，可只选其中一类，也可全部不选"
          @click="toggleStoryPanel"
        >
          <Drama :size="14" :stroke-width="1.8" />
          故事定制
          <span v-if="storyCount > 0" class="material-count">{{ storyCount }}</span>
        </button>
        <button
          v-if="aiSettings.narrativeCraftEnabled"
          class="material-toggle-btn"
          :class="{ active: narrativeOpen }"
          title="自由点选叙事结构 / 叙事手法 / 结局结尾，可只选其中一类，也可全部不选"
          @click="toggleNarrativePanel"
        >
          <Layers :size="14" :stroke-width="1.8" />
          叙事定制
          <span v-if="narrativeCount > 0" class="material-count">{{ narrativeCount }}</span>
        </button>
      </div>

      <Transition name="dropdown">
        <div v-if="materialsOpen && activeSidebarTab === 'chat' && aiSettings.materialLibraryEnabled" class="materials-panel">
          <div class="materials-header">
            <span class="materials-title">素材库</span>
            <div class="materials-actions">
              <button class="mini-icon-btn" title="新建素材" @click="startCreateMaterial">
                <Plus :size="14" :stroke-width="2" />
              </button>
            </div>
          </div>

          <div v-if="materialEditingId" class="material-editor">
            <input
              v-model="materialDraftTitle"
              class="material-title-input"
              placeholder="素材标题"
              @keydown.enter="commitMaterialSave"
            />
            <textarea
              v-model="materialDraftContent"
              class="material-content-input"
              rows="3"
              placeholder="素材内容..."
            ></textarea>
            <div class="material-editor-actions">
              <button class="material-btn save" @click="commitMaterialSave">保存</button>
              <button class="material-btn cancel" @click="cancelMaterialEdit">取消</button>
            </div>
          </div>

          <div class="materials-list">
            <div v-for="mat in materialStore.items" :key="mat.id" class="material-item">
              <div class="material-item-head" @click="toggleMaterial(mat.id)">
                <span
                  class="material-check"
                  :class="{ on: mat.selected }"
                >
                  <Check v-if="mat.selected" :size="11" :stroke-width="2.5" />
                </span>
                <span class="material-name">{{ mat.title }}</span>
              </div>
              <div class="material-item-actions">
                <button class="mini-icon-btn" title="编辑" @click.stop="startEditMaterial(mat.id)">
                  <Pencil :size="12" :stroke-width="1.8" />
                </button>
                <button class="mini-icon-btn" title="删除" @click.stop="removeMaterial(mat.id)">
                  <Trash2 :size="12" :stroke-width="1.8" />
                </button>
              </div>
            </div>
            <div v-if="materialStore.items.length === 0" class="materials-empty">
              暂无素材，点击右上角 + 新建
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="dropdown">
        <div v-if="storyOpen && activeSidebarTab === 'chat' && aiSettings.storyCraftEnabled" class="materials-panel narrative-panel">
          <div class="materials-header">
            <span class="materials-title">故事定制</span>
            <button
              v-if="storyCount > 0"
              class="narrative-clear-btn"
              title="清空全部选择（回到项目默认流程）"
              @click="clearStory"
            >
              清空
            </button>
          </div>

          <div class="narrative-hint">
            角色原型 / 情节两类自由点选，可只选一类，也可全部不选；不选时按现有流程生成。
          </div>

          <div class="materials-list">
            <div v-for="group in storyGroups" :key="group.kind" class="narrative-group">
              <button class="narrative-group-head" @click="toggleStoryGroup(group.kind)">
                <ChevronDown v-if="isStoryGroupOpen(group.kind)" :size="12" :stroke-width="2.2" />
                <ChevronRight v-else :size="12" :stroke-width="2.2" />
                <span class="narrative-group-name">{{ group.label }}</span>
                <span v-if="storyGroupCount(group.kind) > 0" class="narrative-group-count">
                  {{ storyGroupCount(group.kind) }}
                </span>
              </button>

              <div v-if="isStoryGroupOpen(group.kind)" class="narrative-group-body">
                <div
                  v-for="opt in group.options"
                  :key="opt.id"
                  class="material-item narrative-item"
                  role="checkbox"
                  tabindex="0"
                  :aria-checked="storyChecked(group.kind, opt.id)"
                  :title="opt.desc"
                  @click="onToggleStory(group.kind, opt.id)"
                  @keydown.enter.prevent="onToggleStory(group.kind, opt.id)"
                  @keydown.space.prevent="onToggleStory(group.kind, opt.id)"
                >
                  <div class="material-item-head">
                    <span class="material-check" :class="{ on: storyChecked(group.kind, opt.id) }">
                      <Check v-if="storyChecked(group.kind, opt.id)" :size="11" :stroke-width="2.5" />
                    </span>
                    <span class="narrative-text">
                      <span class="material-name">{{ opt.name }}</span>
                      <span class="narrative-gist">{{ opt.gist }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <Transition name="dropdown">
        <div v-if="narrativeOpen && narrativeScope && aiSettings.narrativeCraftEnabled" class="materials-panel narrative-panel">
          <div class="materials-header">
            <span class="materials-title">叙事定制</span>
            <button
              v-if="narrativeCount > 0"
              class="narrative-clear-btn"
              title="清空全部选择（回到项目默认流程）"
              @click="clearNarrative"
            >
              清空
            </button>
          </div>

          <div class="narrative-hint">
            结构 / 手法 / 结尾三类自由点选，可只选一类，也可全部不选；不选时按现有流程生成。
          </div>

          <div class="materials-list">
            <div v-for="group in narrativeGroups" :key="group.kind" class="narrative-group">
              <button class="narrative-group-head" @click="toggleNarrativeGroup(group.kind)">
                <ChevronDown v-if="isNarrativeGroupOpen(group.kind)" :size="12" :stroke-width="2.2" />
                <ChevronRight v-else :size="12" :stroke-width="2.2" />
                <span class="narrative-group-name">{{ group.label }}</span>
                <span v-if="narrativeGroupCount(group.kind) > 0" class="narrative-group-count">
                  {{ narrativeGroupCount(group.kind) }}
                </span>
              </button>

              <div v-if="isNarrativeGroupOpen(group.kind)" class="narrative-group-body">
                <div
                  v-for="opt in group.options"
                  :key="opt.id"
                  class="material-item narrative-item"
                  role="checkbox"
                  tabindex="0"
                  :aria-checked="narrativeChecked(group.kind, opt.id)"
                  :title="opt.desc"
                  @click="onToggleNarrative(group.kind, opt.id)"
                  @keydown.enter.prevent="onToggleNarrative(group.kind, opt.id)"
                  @keydown.space.prevent="onToggleNarrative(group.kind, opt.id)"
                >
                  <div class="material-item-head">
                    <span class="material-check" :class="{ on: narrativeChecked(group.kind, opt.id) }">
                      <Check v-if="narrativeChecked(group.kind, opt.id)" :size="11" :stroke-width="2.5" />
                    </span>
                    <span class="narrative-text">
                      <span class="material-name">{{ opt.name }}</span>
                      <span class="narrative-gist">{{ opt.gist }}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>
      </div>

      <div v-if="cardAttachments.items.length > 0 || fileAttachments.items.length > 0" class="attachment-bar">
        <div v-for="att in cardAttachments.items" :key="'c' + att.id" class="attachment-chip">
          <FileText :size="12" :stroke-width="1.8" />
          <span class="chip-title">{{ att.title }}</span>
          <button class="chip-remove" @click="removeCardAttachment(att.id)"><X :size="12" /></button>
        </div>
        <div v-for="att in fileAttachments.items" :key="'f' + att.id" class="attachment-chip file-chip">
          <Paperclip :size="12" :stroke-width="1.8" />
          <span class="chip-title" :title="att.name">{{ att.name }}</span>
          <span v-if="att.size > 0" class="chip-size">{{ formatFileSize(att.size) }}</span>
          <button class="chip-remove" @click="removeFileAttachment(att.id)"><X :size="12" /></button>
        </div>
      </div>
      <div class="composer-box">
        <!-- 定制胶囊：渲染在输入框内但独立于 textarea，因此不可被键入或误删；
             只能通过胶囊自带的 × 或对应面板增减。 -->
        <div
          v-if="activeSlashCommand || composerStoryChips.length > 0 || composerNarrativeChips.length > 0"
          class="narrative-chip-row"
        >
          <!-- 创作指令胶囊：指令词独立于 textarea，不可被键入或退格误删，
               只能通过自带的 ×（或再点一次菜单项）显式退出。胶囊只显示名称，
               触发词（/身份模板）只在「/」菜单里出现，避免两处重复。 -->
          <span
            v-if="activeSlashCommand"
            class="narrative-chip slash-chip"
            :title="`${activeSlashCommand.label} · ${activeSlashCommand.desc}`"
          >
            <span class="narrative-chip-name">{{ activeSlashCommand.label }}</span>
            <button
              class="narrative-chip-remove"
              :title="`退出「${activeSlashCommand.label}」创作模式`"
              @click="clearSlashCommand"
            >
              <X :size="11" :stroke-width="2.4" />
            </button>
          </span>
          <span
            v-for="chip in composerStoryChips"
            :key="chip.id"
            class="narrative-chip story-chip"
            :title="`${chip.kindLabel}：${chip.name}\n${chip.desc}`"
          >
            <span class="narrative-chip-kind">{{ chip.kindLabel }}</span>
            <span class="narrative-chip-name">{{ chip.name }}</span>
            <button
              class="narrative-chip-remove"
              :title="`移除「${chip.name}」`"
              @click="removeStoryChip(chip)"
            >
              <X :size="11" :stroke-width="2.4" />
            </button>
          </span>
          <span
            v-for="chip in composerNarrativeChips"
            :key="chip.id"
            class="narrative-chip"
            :title="`${chip.kindLabel}：${chip.name}\n${chip.desc}`"
          >
            <span class="narrative-chip-kind">{{ chip.kindLabel }}</span>
            <span class="narrative-chip-name">{{ chip.name }}</span>
            <button
              class="narrative-chip-remove"
              :title="`移除「${chip.name}」`"
              @click="removeNarrativeChip(chip)"
            >
              <X :size="11" :stroke-width="2.4" />
            </button>
          </span>
        </div>
        <textarea
          ref="composerRef"
          v-model="currentComposerText"
          v-auto-pair
          class="composer-textarea"
          :placeholder="composerPlaceholder"
          rows="2"
          @keydown="handleComposerKeydown"
          @input="handleComposerInput"
        ></textarea>
        <div class="composer-tools">
          <div class="composer-options-left">
            <!-- 0. 创作指令「/」Popover（仅对话页；模型列表左侧） -->
            <div v-if="activeSidebarTab === 'chat'" class="popover-wrapper">
              <button
                class="icon-pill-btn slash-pill-btn"
                :class="{ active: activeSlashCommand !== null || activePopover === 'slash' }"
                :title="slashButtonTitle"
                @click.stop="togglePopover('slash')"
              >
                <Slash :size="15" />
              </button>
              <div v-if="activePopover === 'slash'" class="popover-dropdown slash-dropdown" @click.stop>
                <div class="popover-title">创作模式</div>
                <div class="popover-options">
                  <div
                    v-for="cmd in slashCommands"
                    :key="cmd.id"
                    class="popover-option slash-option"
                    :class="{ selected: activeSlashCommand?.id === cmd.id }"
                    :title="cmd.desc"
                    @click="activeSlashCommand?.id === cmd.id ? clearSlashCommand() : applySlashCommand(cmd)"
                  >
                    <span class="slash-option-main">
                      <code class="slash-option-trigger">{{ cmd.trigger }}</code>
                    </span>
                    <Check v-if="activeSlashCommand?.id === cmd.id" :size="12" />
                  </div>
                </div>
                <div class="slash-foot">
                  选中后在指令后面写清需求即可；也可直接在输入框开头手打指令。不选则按日常对话回答。
                </div>
              </div>
            </div>

            <!-- 1. Model Selector Icon Popover -->
            <div class="popover-wrapper">
              <button
                class="icon-pill-btn"
                :class="{ active: activePopover === 'model' }"
                :title="`当前模型: ${currentModelLabel}`"
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

                  <div v-for="group in visibleModelGroups" :key="group.id" class="model-group">
                    <button class="model-group-head" @click.stop="toggleModelGroup(group)">
                      <ChevronDown v-if="isModelGroupOpen(group)" :size="12" :stroke-width="2.2" />
                      <ChevronRight v-else :size="12" :stroke-width="2.2" />
                      <span class="model-group-name" :title="group.label">{{ group.label }}</span>
                      <span v-if="group.isActive" class="model-group-dot" title="当前使用的接口"></span>
                      <span class="model-group-count">{{ filteredModels(group).length }}</span>
                    </button>

                    <div v-if="isModelGroupOpen(group)" class="model-group-body">
                      <div
                        v-for="model in filteredModels(group)"
                        :key="group.id + model"
                        class="popover-option model-option"
                        :class="{ selected: group.isActive && currentModel === model }"
                        :title="model"
                        @click="selectModel(group, model)"
                      >
                        <span class="model-option-name">{{ model }}</span>
                        <Check v-if="group.isActive && currentModel === model" :size="12" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 2. Web Search Icon Popover -->
            <div class="popover-wrapper">
              <button
                class="icon-pill-btn"
                :class="{ active: aiSettings.webSearchEnabled || activePopover === 'webSearch' }"
                :title="`联网搜索: ${webSearchLabel}`"
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
                    <Check v-if="aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'bing'" :size="12" />
                  </div>
                  <div
                    class="popover-option"
                    :class="{ selected: aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'google' }"
                    title="首发 Startpage（Google 结果），失败自动回退其余引擎"
                    @click="webSearchMode = 'google'; activePopover = null"
                  >
                    <span>开启（Google 结果优先）</span>
                    <Check v-if="aiSettings.webSearchEnabled && aiSettings.webSearchEngine === 'google'" :size="12" />
                  </div>
                </div>
                <div class="slash-foot">任一引擎失败会自动换下一个；全部失败时 AI 会如实说明未拿到联网资料。</div>
              </div>
            </div>

            <!-- 3. Thinking Level Icon Popover -->
            <div class="popover-wrapper">
              <button
                class="icon-pill-btn"
                :class="{ active: activePopover === 'thinking' }"
                :title="`思考等级: ${thinkingLevelLabel}`"
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

          <div class="composer-actions">
            <button class="icon-btn" title="添加附件" @click="triggerFileInput">
              <Paperclip :size="18" :stroke-width="1.7" />
            </button>
            <button
              v-if="isSendingCurrent"
              class="icon-btn send-btn stop"
              title="停止生成"
              @click="stopGeneration"
            >
              <Square :size="16" :stroke-width="2.2" />
            </button>
            <button
              v-else
              class="icon-btn send-btn"
              :class="{ active: canSend }"
              :disabled="!canSend"
              title="发送 (Ctrl+Enter)"
              @click="sendMessage()"
            >
              <ArrowUp :size="18" :stroke-width="2" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.chat-sidebar {
  /* Width is driven inline so it can be dragged; 400px stays the default. */
  position: relative;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--surface-bright);
  border-left: 1px solid var(--outline-variant);
  box-shadow: var(--drawer-shadow);
  z-index: 30;
}

/* Grab strip straddling the left border. */
.chat-resizer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  width: 7px;
  z-index: 40;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
}

.chat-resizer::after {
  content: "";
  position: absolute;
  top: 50%;
  left: 50%;
  width: 3px;
  height: 34px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: var(--outline-variant);
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.chat-resizer:hover::after,
.chat-resizer.active::after {
  opacity: 1;
  background: var(--primary);
}

.chat-resizer:hover,
.chat-resizer.active {
  background: rgb(var(--primary-rgb) / 0.1);
}

/* Suppress transitions mid-drag so the panel tracks the cursor exactly. */
.chat-sidebar.resizing,
.chat-sidebar.resizing * {
  transition: none !important;
}

.chat-header {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--outline-variant);
}

.chat-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.chat-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  position: relative;
}

.agent-nav-tabs {
  display: inline-flex;
  background: var(--surface-container-low);
  padding: 3px;
  border-radius: 8px;
  gap: 2px;
  border: 1px solid var(--outline-variant);
}

.agent-nav-btn {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface-variant);
  background: transparent;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
}

.agent-nav-btn:hover {
  color: var(--on-surface);
}

.agent-nav-btn.active {
  background: var(--surface-bright);
  color: var(--primary);
  font-weight: 600;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
}

.history-menu {
  position: absolute;
  top: 44px;
  right: 0;
  width: 300px;
  max-height: 420px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 12px 32px -8px rgb(0 0 0 / 0.2);
  z-index: 60;
}

.more-menu-wrap {
  position: relative;
  display: inline-flex;
}

.more-menu {
  position: absolute;
  top: 44px;
  right: 0;
  width: 220px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 12px 32px -8px rgb(0 0 0 / 0.2);
  z-index: 60;
}

.more-menu .menu-section-title {
  margin: 0;
  padding: 10px 12px 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  font-size: 13px;
  color: var(--on-surface);
  text-align: left;
  border: none;
  background: transparent;
  cursor: pointer;
  transition: background 0.2s ease;
}

.menu-item:hover {
  background: var(--surface-container-high);
}

.menu-divider {
  height: 1px;
  background: var(--outline-variant);
  margin: 0 8px;
}

.menu-section-title {
  padding: 10px 12px 6px;
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--on-surface-variant);
}

.history-list {
  overflow-y: auto;
  max-height: 280px;
  padding: 4px 6px 8px;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 4px;
  border-radius: 6px;
  transition: background 0.2s ease;
}

.history-item:hover {
  background: var(--surface-container-low);
}

.history-title {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 7px 8px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.history-name {
  font-size: 13px;
  color: var(--on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.history-time {
  font-size: 11px;
  color: var(--outline);
}

.history-delete {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 5px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease, color 0.2s ease;
  margin-right: 4px;
}

.history-delete:hover {
  background: var(--error-container);
  color: var(--error);
}

.history-empty {
  padding: 16px 8px;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease;
}

.icon-btn:hover {
  background: var(--surface-container-high);
}

.chat-messages {
  position: relative;
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  background: var(--surface-container-lowest);
}

.scroll-bottom-btn {
  position: absolute;
  bottom: 110px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  color: var(--primary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  cursor: pointer;
  z-index: 60;
  transition: all 0.2s ease;
}

.scroll-bottom-btn:hover {
  background: var(--primary);
  color: #ffffff;
  border-color: var(--primary);
  transform: translateX(-50%) scale(1.08);
}

.chat-empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--outline);
  font-size: 13px;
}

.message {
  border-bottom: 1px solid var(--outline-variant);
  padding: 16px 8px;
}

.message-label {
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--on-surface-variant);
  margin-bottom: 8px;
}

/* 用户消息头部：左侧「用户」标签，右侧撤回/删除操作 */
.user-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.user-head .message-label {
  margin-bottom: 8px;
}

.user-actions {
  opacity: 0;
  transition: opacity 0.15s ease;
  margin-left: auto;
}

.user-head:hover .user-actions,
.message:hover .user-actions {
  opacity: 1;
}

.user-body {
  color: var(--on-surface);
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
}

/* 附件以挂载形式展示：原文不进气泡，只显示小标签 */
.user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 6px;
}

.user-attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 220px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
  font-size: 11px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-attach-chip svg {
  flex-shrink: 0;
  color: var(--primary);
}

/* 本轮生效的叙事定制：与附件区分色，一眼看出是写法约束而非资料 */
.narrative-attach-chip {
  background: rgb(var(--primary-rgb) / 0.1);
  border: 1px solid rgb(var(--primary-rgb) / 0.3);
  color: var(--primary);
}

/* 本轮生效的故事定制：用次色与叙事定制区分 */
.story-attach-chip {
  background: var(--surface-container);
  border: 1px solid var(--secondary);
  color: var(--secondary);
}

.story-attach-chip svg {
  color: var(--secondary);
}

/* 本轮生效的创作指令：主色实心描边，与定制胶囊区分——它是「模式」而非「素材」。
   气泡里也保持胶囊形态，指令词不再以明文正文出现。 */
.slash-attach-chip {
  background: rgb(var(--primary-rgb) / 0.14);
  border: 1.5px solid var(--primary);
  color: var(--primary);
  font-weight: 600;
}

.slash-attach-chip svg {
  color: var(--primary);
}

/* 只启用了指令、没写需求时的占位提示 */
.muted-text {
  color: var(--on-surface-variant);
  font-style: italic;
}

/* 「创作模式已生效」告知条：AI 回复上方的一条非正文说明。
   它不进 message.content，因此复制 / 拖拽生成卡片都不会带上。 */
.mode-banner {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
  padding: 4px 9px;
  border-radius: 8px;
  border: 1px solid rgb(var(--primary-rgb) / 0.3);
  background: rgb(var(--primary-rgb) / 0.07);
  color: var(--primary);
  font-size: 11px;
  line-height: 16px;
  user-select: none;
}

.mode-banner svg {
  flex-shrink: 0;
}

.mode-banner-label {
  font-weight: 600;
}

.mode-banner-parts {
  color: var(--on-surface-variant);
}

.assistant-reply-zone {
  border-radius: 8px;
  padding: 8px;
  cursor: grab;
  transition: background 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
  border: 1px solid transparent;
}

.assistant-reply-zone:hover {
  background: var(--surface-container-lowest);
  border-color: var(--outline-variant);
}

.assistant-reply-zone:active,
.assistant-reply-zone.dragging {
  cursor: grabbing;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  background: var(--primary-fixed);
  border-color: var(--primary);
}

.assistant-reply-zone.loading {
  cursor: default;
}

.assistant-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.drag-handle-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: var(--surface-container);
  cursor: grab;
  flex-shrink: 0;
  transition: background 0.2s ease;
}

.drag-handle-wrapper:hover {
  background: var(--primary-container);
}

.drag-handle-wrapper:active {
  cursor: grabbing;
  background: var(--primary);
  color: var(--on-primary, #fff);
}

.drag-handle {
  pointer-events: none;
}

.model-label {
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--primary);
  min-width: 0;
  max-width: 190px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- Grouped model picker ---- */

.model-dropdown {
  width: 236px;
}

.model-filter-input {
  width: 100%;
  padding: 5px 7px;
  margin-bottom: 2px;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 12px;
  font-family: inherit;
  outline: none;
}

.model-filter-input:focus {
  border-color: var(--primary);
}

.model-options {
  max-height: 280px;
  gap: 1px;
}

.model-empty {
  padding: 10px 8px;
  font-size: 12px;
  text-align: center;
  color: var(--on-surface-variant);
}

.model-group + .model-group {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid var(--outline-variant);
}

.model-group-head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease;
}

.model-group-head:hover {
  background: var(--surface-container-high);
}

.model-group-head svg {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.model-group-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-group-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
}

.model-group-count {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 10px;
  font-weight: 500;
}

.model-group-body {
  padding-left: 12px;
}

.model-option {
  gap: 6px;
}

.model-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.message-actions {
  display: flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.assistant-reply-zone:hover .message-actions,
.message:hover .message-actions {
  opacity: 1;
}

.mini-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 23px;
  height: 23px;
  border-radius: 5px;
  color: var(--on-surface-variant);
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}

.mini-icon-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.mini-icon-btn:active {
  transform: scale(0.92);
}

.mini-icon-btn.danger:hover {
  background: var(--error-container);
  color: var(--error);
}

.assistant-body {
  color: var(--on-surface);
  font-size: 13px;
  line-height: 20px;
  user-select: none;
  -webkit-user-select: none;
}

.assistant-body :deep(h1),
.assistant-body :deep(h2),
.assistant-body :deep(h3),
.assistant-body :deep(h4) {
  margin: 12px 0 8px;
  font-weight: 600;
  color: var(--on-surface);
}

.assistant-body :deep(h1) { font-size: 18px; }
.assistant-body :deep(h2) { font-size: 16px; }
.assistant-body :deep(h3) { font-size: 14px; }

.assistant-body :deep(p) {
  margin: 4px 0;
}

.assistant-body :deep(ul),
.assistant-body :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
  color: var(--on-surface-variant);
}

.assistant-body :deep(li + li) {
  margin-top: 4px;
}

.assistant-body :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 3px solid var(--primary);
  background: var(--surface-container-low);
  border-radius: 0 4px 4px 0;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.assistant-body :deep(code) {
  background: var(--surface-container);
  padding: 2px 4px;
  border-radius: 3px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
}

.assistant-body :deep(pre) {
  margin: 8px 0;
  padding: 12px;
  background: var(--surface-container-low);
  border-radius: 6px;
  overflow-x: auto;
}

.assistant-body :deep(pre code) {
  background: transparent;
  padding: 0;
}

.assistant-body :deep(strong) {
  font-weight: 600;
  color: var(--on-surface);
}

.assistant-body :deep(em) {
  font-style: italic;
}

.assistant-body :deep(a) {
  color: var(--primary);
  text-decoration: none;
}

.assistant-body :deep(a:hover) {
  text-decoration: underline;
}

.assistant-body :deep(hr) {
  margin: 12px 0;
  border: none;
  border-top: 1px solid var(--outline-variant);
}

.assistant-body .typing-indicator {
  user-select: none;
  -webkit-user-select: none;
}

/* ---- Token 消耗统计 ---- */
.assistant-footer-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 6px;
  padding: 0 2px;
}

.message-timestamp {
  font-size: 11px;
  color: var(--on-surface-variant);
  opacity: 0.75;
  user-select: none;
  font-family: inherit;
}

.token-widget {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
  font-size: 10px;
  line-height: 16px;
  user-select: none;
  -webkit-user-select: none;
  max-width: 100%;
}

.token-widget svg {
  flex-shrink: 0;
  color: var(--primary);
}

.token-widget strong {
  font-weight: 600;
  color: var(--primary);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}

.continued-widget {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
  font-size: 10px;
  line-height: 16px;
  user-select: none;
  -webkit-user-select: none;
}

/* ---- 正文未写完的告知条 ---- */

.incomplete-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--surface-container-low);
  border: 1px dashed var(--outline);
}

.incomplete-text {
  font-size: 11px;
  line-height: 16px;
  color: var(--on-surface-variant);
}

.incomplete-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--primary);
  background: var(--primary-container);
  color: var(--on-primary-container, var(--primary));
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, opacity 0.2s ease;
}

.incomplete-btn:hover:not(:disabled) {
  background: var(--primary);
  color: var(--on-primary, #fff);
}

.incomplete-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ---- Knowledge tool activity ---- */

.assistant-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0;
  font-size: 12px;
}

.assistant-body :deep(th),
.assistant-body :deep(td) {
  padding: 6px 8px;
  border: 1px solid var(--outline-variant);
  text-align: left;
}

.assistant-body :deep(th) {
  background: var(--surface-container-low);
  font-weight: 600;
}

.edit-textarea {
  width: 100%;
  background: var(--surface-container-lowest);
  border: 1px solid var(--primary);
  border-radius: 6px;
  padding: 8px;
  font-size: 13px;
  line-height: 20px;
  color: var(--on-surface);
  resize: vertical;
  outline: none;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
}

.edit-actions {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}

.edit-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.edit-btn.save {
  background: var(--primary);
  color: var(--on-primary, #fff);
}

.edit-btn.save:hover {
  background: var(--primary-container);
}

.edit-btn.cancel {
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.edit-btn.cancel:hover {
  background: var(--surface-container-high);
}

.typing-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
}

/* ---- Knowledge tool activity ---- */

.tool-trace {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin: 2px 0 8px;
  padding: 6px 8px;
  border-left: 2px solid var(--primary-fixed-dim);
  background: var(--surface-container-low);
  border-radius: 0 6px 6px 0;
}

.tool-trace-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  line-height: 15px;
  color: var(--on-surface-variant);
}

.tool-trace-row svg {
  flex-shrink: 0;
  color: var(--primary);
}

.tool-trace-row.done {
  opacity: 0.72;
}

.tool-trace-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 思考过程：独立可折叠面板，与正文面板区分 ---- */
.thinking-panel {
  margin: 8px 0 4px;
  border: 1px dashed var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-container-low);
  overflow: hidden;
}

.thinking-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 10px;
  color: var(--on-surface-variant);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.thinking-toggle:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.thinking-toggle svg {
  flex-shrink: 0;
  color: var(--primary);
}

.thinking-badge {
  margin-left: auto;
  font-weight: 400;
  opacity: 0.75;
}

.thinking-body {
  padding: 8px 12px 10px;
  border-top: 1px dashed var(--outline-variant);
  font-size: 12px;
  line-height: 19px;
  color: var(--on-surface-variant);
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}

.spin-soft {
  animation: toolPulse 1.2s ease-in-out infinite;
}

@keyframes toolPulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

.typing-indicator .dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--outline);
  animation: typingPulse 1.4s infinite ease-in-out;
}

.typing-indicator .dot:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-indicator .dot:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes typingPulse {
  0%, 60%, 100% { opacity: 0.3; transform: scale(0.85); }
  30% { opacity: 1; transform: scale(1); }
}

.chat-composer {
  flex-shrink: 0;
  padding: 16px;
  background: var(--surface-bright);
}

.attachment-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 0 8px;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px 3px 8px;
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  border-radius: 4px;
  font-size: 11px;
  color: var(--on-surface-variant);
  max-width: 200px;
}

.chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 3px;
  color: var(--on-surface-variant);
  flex-shrink: 0;
}

.attachment-chip.file-chip {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
}

.attachment-chip.file-chip > svg {
  color: var(--primary);
}

.chip-size {
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
  flex-shrink: 0;
}

.chip-remove:hover {
  background: var(--surface-container-high);
  color: var(--error);
}

.composer-box {
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  padding: 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.composer-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.12);
}

/* 输入框内的叙事定制胶囊：位于 textarea 之外，键盘无法触达，
   避免用户误编辑或误删除；只能通过 × 或叙事定制面板增减。 */
.narrative-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 8px 0;
  user-select: none;
}

.narrative-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 2px 4px 2px 3px;
  border-radius: 999px;
  border: 1px solid rgb(var(--primary-rgb) / 0.32);
  background: rgb(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 11px;
  line-height: 16px;
  cursor: default;
}

.narrative-chip-kind {
  flex-shrink: 0;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--primary);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
}

.narrative-chip-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}

.narrative-chip-remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.narrative-chip-remove:hover {
  background: var(--error);
  color: #ffffff;
}

/* 创作指令胶囊：主色描边 + 触发词用等宽字显示，与叙事定制胶囊区分。 */
/* 创作指令胶囊：主色描边，与叙事定制胶囊区分。只显示名称，不加触发词。 */
.narrative-chip.slash-chip {
  border-width: 1.5px;
  border-color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.14);
  font-weight: 600;
}

/* 故事定制（角色原型 / 情节）用次色，与叙事定制的主色胶囊区分开 */
.narrative-chip.story-chip {
  border-color: var(--secondary);
  background: var(--surface-container);
  color: var(--secondary);
}

.narrative-chip.story-chip .narrative-chip-kind {
  background: var(--secondary);
}

.narrative-chip.story-chip .narrative-chip-remove {
  color: var(--secondary);
}

.narrative-chip.story-chip .narrative-chip-remove:hover {
  background: var(--error);
  color: #ffffff;
}

.composer-textarea {
  width: 100%;
  background: transparent;
  border: none;
  resize: none;
  outline: none;
  font-size: 13px;
  line-height: 20px;
  color: var(--on-surface);
  padding: 8px;
  min-height: 44px;
  max-height: 150px;
}

.composer-textarea::placeholder {
  color: var(--on-surface-variant);
}

.composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 0;
}

.composer-options-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

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
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-pill-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.icon-pill-btn.active {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.popover-dropdown {
  position: absolute;
  bottom: 34px;
  left: 0;
  width: 170px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-2, 0 6px 16px rgba(0, 0, 0, 0.15));
  padding: 6px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.popover-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
  padding: 4px 6px;
  border-bottom: 1px solid var(--outline-variant);
  margin-bottom: 2px;
}

.popover-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow-y: auto;
}

.popover-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 4px;
  font-size: 12px;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease;
}

.popover-option:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.popover-option.selected {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-weight: 600;
}

/* ---- 创作指令「/」下拉 ---- */

.slash-dropdown {
  width: 244px;
}

.slash-option {
  align-items: flex-start;
  gap: 6px;
}

.slash-option-main {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.slash-option-trigger {
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-container-high);
  color: var(--primary);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 11px;
}

.slash-foot {
  padding: 6px;
  border-top: 1px solid var(--outline-variant);
  font-size: 10px;
  line-height: 1.55;
  color: var(--on-surface-variant);
}

.composer-actions {
  display: flex;
  gap: 4px;
}

.send-btn {
  background: var(--surface-container);
  color: var(--on-surface-variant);
  border-radius: 6px;
}

.send-btn.active {
  background: var(--primary);
  color: var(--on-primary, #fff);
}

.send-btn.active:hover {
  background: var(--primary-container);
}

/* 生成中：发送按钮切换为“停止生成”图标 */
.send-btn.stop {
  background: var(--error-container);
  color: var(--error);
}

.send-btn.stop:hover {
  background: var(--error);
  color: #fff;
}

.send-btn[disabled] {
  cursor: not-allowed;
  opacity: 0.6;
}

/* Material library (chat tab) */
.materials-wrap {
  position: relative;
  flex-shrink: 0;
}

.material-bar {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 6px;
  padding: 4px 2px 0;
}

.material-toggle-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.material-toggle-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.material-toggle-btn.active {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.material-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--primary);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
}

.materials-panel {
  margin: 6px 2px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: var(--shadow-elevation-2, 0 6px 16px rgba(0, 0, 0, 0.12));
  padding: 8px;
  max-height: min(38vh, 300px);
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

.materials-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.materials-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.materials-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.material-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px dashed var(--primary);
  border-radius: 6px;
  padding: 6px;
  background: var(--surface-container-lowest);
}

.material-title-input {
  width: 100%;
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
  background: transparent;
  border: none;
  outline: none;
  padding: 2px 0;
}

.material-content-input {
  width: 100%;
  font-size: 12px;
  line-height: 18px;
  color: var(--on-surface);
  background: transparent;
  border: none;
  outline: none;
  resize: none;
}

.material-editor-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.material-btn {
  padding: 4px 12px;
  border-radius: 5px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
}

.material-btn.save {
  background: var(--primary);
  color: #ffffff;
}

.material-btn.save:hover {
  background: var(--primary-container);
}

.material-btn.cancel {
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.material-btn.cancel:hover {
  background: var(--surface-container-high);
}

.materials-list {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
  scrollbar-width: thin;
  scrollbar-color: var(--outline-variant) transparent;
}

.materials-list::-webkit-scrollbar {
  width: 6px;
}

.materials-list::-webkit-scrollbar-thumb {
  background: var(--outline-variant);
  border-radius: 3px;
}

.materials-list::-webkit-scrollbar-thumb:hover {
  background: var(--on-surface-variant);
}

.materials-empty {
  padding: 14px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--on-surface-variant);
}

.material-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.material-item:hover {
  background: var(--surface-container);
}

.material-item-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.material-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
  color: #ffffff;
  flex-shrink: 0;
}

.material-check.on {
  background: var(--primary);
  border-color: var(--primary);
}

.material-name {
  font-size: 12px;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-item-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.material-item:hover .material-item-actions {
  opacity: 1;
}

/* 叙事定制面板：结构 / 手法 / 结尾三组可折叠多选 */
.narrative-panel {
  max-height: min(46vh, 380px);
}

.narrative-clear-btn {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.narrative-clear-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.narrative-hint {
  font-size: 11px;
  line-height: 16px;
  color: var(--on-surface-variant);
}

.narrative-group {
  display: flex;
  flex-direction: column;
}

.narrative-group-head {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 5px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease;
}

.narrative-group-head:hover {
  background: var(--surface-container);
}

.narrative-group-name {
  flex: 1;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.narrative-group-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--primary);
  color: #ffffff;
  font-size: 10px;
  font-weight: 700;
}

.narrative-group-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 6px;
}

.narrative-item {
  align-items: flex-start;
}

.narrative-item .material-item-head {
  align-items: flex-start;
}

.narrative-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.narrative-gist {
  font-size: 11px;
  line-height: 15px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
