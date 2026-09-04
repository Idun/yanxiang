<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onMounted } from "vue";
import { Settings2, X, FileText, Plus, Trash2, Palette, Database, DownloadCloud, CheckCircle2, RefreshCw, Download, Upload, RotateCcw, Check, Pencil, Pipette, Server, Search, ChevronDown, Keyboard, Info, ExternalLink, MessageSquare } from "lucide-vue-next";
import {
  aiSettings,
  activateProviderProfile,
  apiTypeLabel,
  apiTypeOptions,
  applyProvider,
  applyTheme,
  applyFont,
  defaultTheme,
  fontOptions,
  EDITOR_FONT_SIZES,
  maskApiKey,
  providerLabel,
  removeProviderProfile,
  renameProviderProfile,
  saveProviderProfile,
  setProfileModel,
  themeOptions,
  KnowledgeFile,
  applyKnowledgeAutoLoad,
  setKnowledgeAutoLoad,
  type ContentColorScheme,
  CONTENT_COLOR_SCHEME_NAMES,
  MAX_CONTENT_COLOR_SCHEMES,
} from "../settings";
import {
  clampRingOpacity,
  clampRingSize,
  readingRingStore,
  RING_OPACITY_MAX,
  RING_OPACITY_MIN,
  RING_SIZE_MAX,
  RING_SIZE_MIN,
} from "../readingRingStore";
import { ensureLocalFonts, fontState, loadLocalFonts } from "../fonts";
import { resolveEndpoint } from "../agentRunner";
import ThemeColorPicker from "./ThemeColorPicker.vue";
import ChatSettingsTab from "./ChatSettingsTab.vue";
import { WRITER_AGENT_PROMPT } from "../prompts/writerAgent";
import { AUDITOR_AGENT_PROMPT } from "../prompts/auditorAgent";
import { REFINE_AGENT_PROMPT } from "../prompts/refineAgent";
import { vectorStore, rebuildInsightVectorIndex } from "../vectorStore";
// 应用图标：直接引用 Tauri 打包所用的同一份图标，避免副本不同步
import appIconUrl from "../../src-tauri/icons/128x128@2x.png";

import {
  CONTENT_COLOR_ITEMS,
  DEFAULT_CONTENT_COLOR_SCHEME,
  applyContentColoring,
  contentColorCssVarsOf,
  customContentColorScheme,
  resetCustomContentColors,
  setCustomContentColors,
} from "../contentColoring";
import { renderForReading } from "../markdown";
import { showToast } from "../insightStore";

type SettingsTab = "api" | "config" | "contentColor" | "shortcuts" | "chat" | "writer" | "auditor" | "refine" | "vector" | "about";
const activeTab = ref<SettingsTab>("api");

/* ---- 快捷键清单（表单：名称 + 快捷键） ---- */

interface ShortcutEntry {
  name: string;
  keys: string;
}

const shortcutGroups: { group: string; items: ShortcutEntry[] }[] = [
  {
    group: "全局",
    items: [
      { name: "保存当前文档", keys: "Ctrl+S" },
      { name: "另存为 / 导出", keys: "Ctrl+Shift+S" },
      { name: "导入文档", keys: "Ctrl+O" },
    ],
  },
  {
    group: "文档编辑器",
    items: [
      { name: "撤销", keys: "Ctrl+Z" },
      { name: "重做", keys: "Ctrl+Shift+Z / Ctrl+Y" },
      { name: "粗体", keys: "Ctrl+B" },
      { name: "斜体", keys: "Ctrl+I" },
      { name: "标题 1 - 5", keys: "Ctrl+1 ~ Ctrl+5" },
      { name: "序号 (有序列表)", keys: "Ctrl+Shift+O" },
      { name: "代码块", keys: "Ctrl+Shift+C" },
      { name: "插入链接", keys: "Ctrl+L" },
      { name: "引用", keys: "Ctrl+Shift+Q" },
      { name: "一键排版（清除多余空行）", keys: "Ctrl+Shift+F" },
      { name: "查找 / 替换", keys: "Ctrl+F / Ctrl+H" },
      { name: "呼出行内 AI 编辑（选段/当前段落）", keys: "Ctrl+K" },
      { name: "修订与批注（选中文字后）", keys: "Ctrl+Shift+M" },
    ],
  },
  {
    group: "修订与批注（Ctrl+Shift+M）",
    items: [
      { name: "加入图层", keys: "Ctrl+Enter" },
      { name: "取消", keys: "Esc" },
    ],
  },
  {
    group: "行内 AI 编辑（Ctrl+K）",
    items: [
      { name: "生成", keys: "Enter" },
      { name: "输入框内换行", keys: "Shift+Enter" },
      { name: "接受，替换原文", keys: "Ctrl+Enter" },
      { name: "拒绝 / 中止 / 取消", keys: "Esc" },
    ],
  },
  {
    group: "对话 / AI写作 / 审核",
    items: [
      { name: "发送消息", keys: "Ctrl+Enter" },
      { name: "呼出创作指令菜单（对话页，输入框首字符）", keys: "/" },
    ],
  },
  {
    group: "灵感速记",
    items: [
      { name: "发布灵感", keys: "Ctrl+Enter" },
      { name: "关闭弹层", keys: "Esc" },
    ],
  },
  {
    group: "写作画布（卡片）",
    items: [
      { name: "打组所选卡片", keys: "Ctrl+G" },
      { name: "取消打组", keys: "Ctrl+Shift+G" },
      { name: "拼文预览", keys: "Ctrl+Shift+P" },
      { name: "拼文对比", keys: "Ctrl+Shift+C" },
      { name: "平移画布", keys: "空格" },
    ],
  },
  {
    group: "拼文对话框",
    items: [
      { name: "撤销", keys: "Ctrl+Z" },
      { name: "重做", keys: "Ctrl+Y / Ctrl+Shift+Z" },
      { name: "呼出行内 AI 编辑", keys: "Ctrl+K" },
    ],
  },
  {
    group: "故事地图",
    items: [
      { name: "选择工具", keys: "V" },
      { name: "绘制路径", keys: "P" },
      { name: "添加地点", keys: "M" },
      { name: "擦除", keys: "E" },
      { name: "框选", keys: "B" },
      { name: "重置视图", keys: "0" },
      { name: "平移画布", keys: "空格" },
      { name: "完成路径绘制", keys: "Enter" },
      { name: "撤销上一个节点", keys: "Ctrl+Z" },
      { name: "删除选中地点", keys: "Delete / Backspace" },
      { name: "收纳全部未分组路径", keys: "Ctrl+G" },
      { name: "关闭地图", keys: "Esc" },
    ],
  },
];

const emit = defineEmits<{
  (e: "close"): void;
}>();

const status = ref("");
const statusType = ref<"ok" | "error" | "">("");

/* ---- model dropdown: search + per-model "+" enable ---- */

const modelMenuRef = ref<HTMLDivElement | null>(null);
const modelMenuOpen = ref(false);
const modelQuery = ref("");
const filteredAvailableModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase();
  if (!q) return aiSettings.availableModels;
  return aiSettings.availableModels.filter((m) => m.toLowerCase().includes(q));
});

/** Pick a model as the active one for the current provider/chat. */
function selectModel(model: string) {
  aiSettings.model = model;
  modelMenuOpen.value = false;
  if (!aiSettings.models.includes(model)) {
    aiSettings.models.push(model);
  }
}

/** Toggle whether a model appears in the chat bottom model dropdown. */
function toggleModelEnabled(model: string) {
  const idx = aiSettings.models.indexOf(model);
  if (idx === -1) aiSettings.models.push(model);
  else aiSettings.models.splice(idx, 1);
}

function onDocumentMouseDown(event: MouseEvent) {
  if (modelMenuOpen.value && modelMenuRef.value && !modelMenuRef.value.contains(event.target as Node)) {
    modelMenuOpen.value = false;
  }
}

function onProviderChange() {
  applyProvider(aiSettings.provider);
  status.value = "";
  statusType.value = "";
}

function onThemeSelect(theme: { label: string; theme: { primary: string; primaryContainer: string; primaryFixedDim: string } }) {
  applyTheme(theme.theme);
  colorPickerOpen.value = false;
}

/* ---- free-form theme colour picker ---- */

const colorPickerOpen = ref(false);
const colorPickerSeed = ref(defaultTheme.primary);

function openColorPicker(seed: string) {
  colorPickerSeed.value = seed;
  colorPickerOpen.value = true;
}

function onColorApplied(hex: string) {
  status.value = `主题色已更新为 ${hex.toUpperCase()}`;
  statusType.value = "ok";
}

/* ---- 内容上色设置：方案机制（方案一为默认底本，最多共五套） ---- */

/** 已保存的内容上色方案集；无记录时自动建一条「方案一」。 */
const contentColorSchemes = ref<ContentColorScheme[]>(
  aiSettings.contentColorSchemes.length > 0
    ? JSON.parse(JSON.stringify(aiSettings.contentColorSchemes))
    : [
        {
          id: "scheme-1",
          name: "方案一",
          colors: { ...(aiSettings.contentColorScheme && Object.keys(aiSettings.contentColorScheme).length ? aiSettings.contentColorScheme : DEFAULT_CONTENT_COLOR_SCHEME) },
        },
      ],
);
/** 当前激活的方案 id：默认取最后一条（即最近保存的那一版）。 */
const activeSchemeId = ref(
  contentColorSchemes.value[contentColorSchemes.value.length - 1]?.id ?? "scheme-1",
);

const draftContentColors = ref<Record<string, string>>({
  ...(contentColorSchemes.value.find((s) => s.id === activeSchemeId.value)?.colors ?? DEFAULT_CONTENT_COLOR_SCHEME),
});

/** 还能再新建几套（含上限判断，界面上显示 n / 5）。 */
const schemeCount = computed(() => contentColorSchemes.value.length);
const schemeLimitReached = computed(() => schemeCount.value >= MAX_CONTENT_COLOR_SCHEMES);

/** 当前方案是不是默认底本「方案一」：它只作底本，保存一律另存为新方案。 */
const activeIsBaseScheme = computed(() => activeSchemeId.value === "scheme-1");

const activeSchemeName = computed(
  () => contentColorSchemes.value.find((s) => s.id === activeSchemeId.value)?.name ?? "方案一",
);

/** 找出第一个空着的方案序号（1-based）；已满则返回 0。 */
function nextSchemeSlot(): number {
  for (let n = 1; n <= MAX_CONTENT_COLOR_SCHEMES; n++) {
    if (!contentColorSchemes.value.some((s) => s.id === `scheme-${n}`)) return n;
  }
  return 0;
}

/** 标签按方案序号排列：删掉中间一套后再新建，补的还是那个空位，顺序不乱。 */
function sortSchemesBySlot() {
  contentColorSchemes.value.sort(
    (a, b) => (Number(a.id.replace("scheme-", "")) || 0) - (Number(b.id.replace("scheme-", "")) || 0),
  );
}

const contentColorInputRefs = ref<Record<string, HTMLInputElement | null>>({});

function setContentColorInputRef(key: string, el: any) {
  if (el) contentColorInputRefs.value[key] = el as HTMLInputElement;
}

function triggerContentColorPicker(key: string) {
  const input = contentColorInputRefs.value[key];
  if (input) {
    input.click();
  }
}

function formatHexForColorPicker(hex: string): string {
  if (!hex) return "#000000";
  let h = hex.trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (h.length === 4) {
    h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h.slice(0, 7);
}

/**
 * 内容上色方案的操作回执。
 *
 * 单独一组 ref，不复用 `status`：`status` 只渲染在「AI接口设置 / 向量化」两个
 * 标签页里，内容上色页看不到它 —— 之前保存方案的提示就是这么被吞掉的。
 * 这里在本页内联一条状态条，并同时弹一次全局 Toast，两处都能看见结果。
 */
const schemeStatus = ref("");
const schemeStatusType = ref<"ok" | "error" | "">("");

function reportSchemeStatus(text: string, ok: boolean, toastTitle: string) {
  schemeStatus.value = text;
  schemeStatusType.value = ok ? "ok" : "error";
  showToast(toastTitle, text, ok ? "habit" : "edit");
}

/** 把一组颜色写到「当前生效位」（即时预览 + 当前方案字段）。 */
function applyContentColorScheme(colors: Record<string, string>) {
  setCustomContentColors(colors);
  aiSettings.contentColorScheme = { ...colors };
}

/** 切换方案：草稿与即时预览都切到目标方案，预览随即换肤。 */
function selectContentColorScheme(id: string) {
  const scheme = contentColorSchemes.value.find((s) => s.id === id);
  if (!scheme) return;
  activeSchemeId.value = id;
  draftContentColors.value = { ...scheme.colors };
  applyContentColorScheme(scheme.colors);
  schemeStatus.value = `已切换到「${scheme.name}」并生效`;
  schemeStatusType.value = "ok";
}

/** 删除已有方案（默认「方案一」不可删）；删掉当前方案时回落到最后一条并生效。 */
function deleteContentColorScheme(id: string) {
  const idx = contentColorSchemes.value.findIndex((s) => s.id === id);
  if (idx <= 0) return;
  const removed = contentColorSchemes.value[idx];
  contentColorSchemes.value.splice(idx, 1);
  if (activeSchemeId.value === id) {
    const fallback = contentColorSchemes.value[contentColorSchemes.value.length - 1];
    if (fallback) {
      activeSchemeId.value = fallback.id;
      draftContentColors.value = { ...fallback.colors };
      applyContentColorScheme(fallback.colors);
    }
  }
  persistContentColorSchemes();
  reportSchemeStatus(
    `已删除「${removed.name}」，当前生效「${activeSchemeName.value}」，剩 ${schemeCount.value} / ${MAX_CONTENT_COLOR_SCHEMES} 套`,
    true,
    "方案已删除",
  );
}

/** 修改即时生效（只改预览，不落方案）；点「保存方案」才沉淀成方案。 */
function onContentColorPickerInput(key: string, event: Event) {
  const val = (event.target as HTMLInputElement).value;
  draftContentColors.value[key] = val;
  customContentColorScheme[key] = val;
}

function onContentColorHexTextChange(key: string) {
  const val = draftContentColors.value[key];
  if (val && val.startsWith("#") && (val.length === 4 || val.length === 7)) {
    customContentColorScheme[key] = val;
  }
}

/* ---- 方案预览样张 ----
   走的是文档预览那条完全一样的管线：renderForReading → applyContentColoring，
   再把草稿配色以 --zj-* 变量挂在样张容器上，所以这里看到的效果与实际预览
   一致（标题 H1–H5 / 引用块 / 粗体 / 引号 / 括号 / 标点 / 特殊标记 / 字母 / 数字
   逐项都能对上）。样张文字覆盖全部 14 个可上色项，改哪一项都立刻看得出。 */
const CONTENT_COLOR_SAMPLE = [
  "# 第一章 长夜将尽",
  "",
  "## 一、启程",
  "",
  "他说：“天亮之前必须动身。”她没有答话（只是把灯芯拨亮了一寸）。",
  "",
  "窗外风声大作，屋檐下的铜铃响了 3 下，像是某种 signal——又像一句未讲完的话。",
  "",
  "> 记：卷宗第 12 号，缺《山河图》残页两张。",
  "",
  "真正要紧的是**不要回头**；剩下的事，交给天亮以后的人去办。",
  "",
  "### 二、旁注",
  "",
  "#### 四级小节",
  "",
  "##### 五级小节",
].join("\n");

/** 样张 HTML：与文档预览同一条渲染 + 上色管线。 */
const contentColorPreviewHtml = computed(() =>
  applyContentColoring(renderForReading(CONTENT_COLOR_SAMPLE)),
);

/** 样张容器上的配色变量：跟随草稿即时变化，不必先保存。 */
const contentColorPreviewStyle = computed(() => contentColorCssVarsOf(draftContentColors.value));

/** 把方案集同步到 aiSettings，交给持久化 watcher 落盘。 */
function persistContentColorSchemes() {
  aiSettings.contentColorSchemes = contentColorSchemes.value.map((s) => ({
    ...s,
    colors: { ...s.colors },
  }));
}

function restoreDefaultContentColors() {
  resetCustomContentColors();
  const colors = { ...DEFAULT_CONTENT_COLOR_SCHEME };
  draftContentColors.value = { ...colors };
  const scheme = contentColorSchemes.value.find((s) => s.id === activeSchemeId.value);
  if (scheme) scheme.colors = { ...colors };
  applyContentColorScheme(colors);
  persistContentColorSchemes();
  reportSchemeStatus(`「${activeSchemeName.value}」已恢复为默认配色`, true, "已恢复默认");
}

/**
 * 保存当前草稿。
 *
 * 「方案一」是默认底本，不被改写：在它上面调完色点保存，会另存为下一套空位
 * （方案二 … 方案五）并切过去；已在方案二及以后时，保存即覆盖该套方案本身。
 * 五套占满又停在方案一时不静默丢弃，直接报出该怎么做。
 */
function saveContentColors() {
  const colors = { ...draftContentColors.value };

  /* 停在方案二及以后：覆盖保存该套方案本身。
     （方案不存在属于异常数据，走下面的「另存为新方案」兜底。） */
  const current = activeIsBaseScheme.value
    ? undefined
    : contentColorSchemes.value.find((s) => s.id === activeSchemeId.value);
  if (current) {
    current.colors = { ...colors };
    applyContentColorScheme(colors);
    persistContentColorSchemes();
    reportSchemeStatus(
      `已更新「${current.name}」并生效（共 ${schemeCount.value} / ${MAX_CONTENT_COLOR_SCHEMES} 套）`,
      true,
      "方案已保存",
    );
    return;
  }

  const slot = nextSchemeSlot();
  if (slot === 0) {
    reportSchemeStatus(
      `方案数量已达上限 ${MAX_CONTENT_COLOR_SCHEMES} 套：请先删除一套，或切到方案二及以后的任一方案再保存以覆盖它`,
      false,
      "未保存",
    );
    return;
  }

  const scheme: ContentColorScheme = {
    id: `scheme-${slot}`,
    name: CONTENT_COLOR_SCHEME_NAMES[slot - 1] ?? `方案${slot}`,
    colors,
  };
  contentColorSchemes.value.push(scheme);
  sortSchemesBySlot();
  activeSchemeId.value = scheme.id;
  applyContentColorScheme(colors);
  persistContentColorSchemes();
  reportSchemeStatus(
    `已新建「${scheme.name}」并生效（共 ${schemeCount.value} / ${MAX_CONTENT_COLOR_SCHEMES} 套）`,
    true,
    "方案已保存",
  );
}

function onFontSelect(event: Event) {
  const target = event.target as HTMLSelectElement;
  applyFont(target.value);
}

const readingRingOpen = ref(false);
const spotlightOpen = ref(false);
function onRingSizeInput(event: Event) {
  const target = event.target as HTMLInputElement;
  aiSettings.readingRingSize = clampRingSize(Number(target.value));
}

/* 圆环 / 目录面板的不透明度，同样即时生效。 */
function onRingOpacityInput(event: Event) {
  const target = event.target as HTMLInputElement;
  aiSettings.readingRingOpacity = clampRingOpacity(Number(target.value));
}

/** 清空全部槽位的位置记忆，圆环回落到各自面板的右上角。 */
function resetRingLayout() {
  readingRingStore.positions = {};
}

/** 已被挪动过的圆环数量（默认位置不入库，所以键数即挪动过的位点数）。 */
const ringPositionCount = computed(() => Object.keys(readingRingStore.positions).length);

function restorePrompt(type: "writer" | "auditor" | "refine") {
  const defaults = {
    writer: WRITER_AGENT_PROMPT,
    auditor: AUDITOR_AGENT_PROMPT,
    refine: REFINE_AGENT_PROMPT,
  };
  if (type === "writer") aiSettings.writerPrompt = defaults.writer;
  else if (type === "auditor") aiSettings.auditorPrompt = defaults.auditor;
  else aiSettings.refinePrompt = defaults.refine;
}

/* ---------------- API type driven endpoints ---------------- */

/** Base URL to use, falling back to the provider default when blank. */
function effectiveBase(): string {
  const url = aiSettings.url.trim().replace(/\/+$/, "");
  if (url) return url;
  return PROVIDER_DEFAULT_BASE[aiSettings.provider] ?? "";
}

const PROVIDER_DEFAULT_BASE: Record<string, string> = {
  OpenAI: "https://api.openai.com/v1",
  DeepSeek: "https://api.deepseek.com/v1",
  Anthropic: "https://api.anthropic.com/v1",
  Google: "https://generativelanguage.googleapis.com/v1beta",
  AgentRouter: "https://agentrouter.org/v1",
  OpenRouter: "https://openrouter.ai/api/v1",
};

/** Auth headers for the currently selected API type. */
function probeHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!aiSettings.apiKey.trim()) return headers;

  if (aiSettings.apiType === "anthropic-messages") {
    headers["x-api-key"] = aiSettings.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else if (aiSettings.apiType === "google-generative") {
    headers["x-goog-api-key"] = aiSettings.apiKey;
  } else {
    headers["Authorization"] = `Bearer ${aiSettings.apiKey}`;
  }
  return headers;
}

/** Model-list endpoint for the current API type, or null when unsupported. */
function modelsEndpoint(): string | null {
  const base = effectiveBase();
  if (!base) return null;
  /* All four protocols expose a listing route, they just differ in shape. */
  if (aiSettings.apiType === "google-generative") return `${base}/models`;
  return `${base}/models`;
}

async function fetchModels() {
  status.value = "正在获取模型列表...";
  statusType.value = "";

  const modelsUrl = modelsEndpoint();
  if (!modelsUrl) {
    status.value = "请先填写 URL，或选择内置提供商";
    statusType.value = "error";
    return;
  }

  try {
    const response = await fetch(modelsUrl, { headers: probeHeaders() });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    let modelIds: string[] = [];

    if (Array.isArray(data?.data)) {
      /* OpenAI / Anthropic / relay shape: { data: [{ id }] } */
      modelIds = data.data
        .map((item: { id?: string }) => item.id)
        .filter((id: string | undefined): id is string => !!id);
    } else if (Array.isArray(data?.models)) {
      /* Google shape: { models: [{ name: "models/gemini-..." }] } */
      modelIds = data.models
        .map((item: { name?: string }) => item.name?.replace(/^models\//, ""))
        .filter((id: string | undefined): id is string => !!id);
    }

    if (modelIds.length === 0) {
      status.value = "未获取到模型列表（接口返回的结构无法识别）";
      statusType.value = "error";
      return;
    }

    modelIds.sort();
    aiSettings.availableModels = [...modelIds];
    /* 保留用户已「+」启用的模型；超出新列表的检查掉。 */
    const enabled = aiSettings.models.filter((m) => modelIds.includes(m));
    aiSettings.models = enabled;
    if (!modelIds.includes(aiSettings.model)) {
      aiSettings.model = enabled[0] ?? modelIds[0];
    }
    /* 保证当前激活的模型始终在聊天模型下拉列表中。 */
    if (!aiSettings.models.includes(aiSettings.model)) {
      aiSettings.models.push(aiSettings.model);
    }

    status.value = `已获取 ${modelIds.length} 个模型（${apiTypeLabel(aiSettings.apiType)}）`;
    statusType.value = "ok";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    status.value = `获取模型失败: ${message}`;
    statusType.value = "error";
  }
}

async function testConnection() {
  const base = effectiveBase();
  if (!base) {
    status.value = "请先填写 URL";
    statusType.value = "error";
    return;
  }
  if (!/^https?:\/\//i.test(base)) {
    status.value = "URL 需以 http:// 或 https:// 开头（支持中转地址）";
    statusType.value = "error";
    return;
  }
  if (!aiSettings.apiKey.trim()) {
    status.value = "请先填写 API key";
    statusType.value = "error";
    return;
  }

  status.value = `正在按「${apiTypeLabel(aiSettings.apiType)}」测试连接...`;
  statusType.value = "";

  try {
    /* Probing the real chat route (with a 1-token request) is the only way to
       verify the selected API type actually works; a /models call would pass
       even when the protocol is wrong. */
    const endpoint = resolveEndpoint(
      aiSettings.apiType,
      aiSettings.provider,
      base,
      aiSettings.model,
      false,
    );
    if (!endpoint) {
      status.value = "无法确定该 API 类型的请求地址";
      statusType.value = "error";
      return;
    }

    const body = buildProbeBody();
    const response = await fetch(endpoint.apiUrl, {
      method: "POST",
      headers: probeHeaders(),
      body: JSON.stringify(body),
    });

    if (response.ok) {
      status.value = `连接测试成功 · ${apiTypeLabel(aiSettings.apiType)} · ${aiSettings.model}`;
      statusType.value = "ok";
      return;
    }

    const detail = (await response.text()).slice(0, 200);
    status.value = `连接测试失败: HTTP ${response.status} ${detail}`;
    statusType.value = "error";
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    status.value = `连接测试失败: ${message}`;
    statusType.value = "error";
  }
}

/** Smallest valid request body for each protocol. */
function buildProbeBody(): Record<string, unknown> {
  const ping = "ping";
  if (aiSettings.apiType === "anthropic-messages") {
    return {
      model: aiSettings.model,
      max_tokens: 1,
      messages: [{ role: "user", content: ping }],
    };
  }
  if (aiSettings.apiType === "openai-responses") {
    return {
      model: aiSettings.model,
      input: [{ type: "message", role: "user", content: ping }],
      max_output_tokens: 16,
    };
  }
  if (aiSettings.apiType === "google-generative") {
    return {
      contents: [{ role: "user", parts: [{ text: ping }] }],
      generationConfig: { maxOutputTokens: 1 },
    };
  }
  return {
    model: aiSettings.model,
    messages: [{ role: "user", content: ping }],
    max_tokens: 1,
  };
}

function onApiTypeChange() {
  status.value = `已切换 API 类型：${apiTypeLabel(aiSettings.apiType)}`;
  statusType.value = "";
}

const apiTypeDesc = computed(
  () => apiTypeOptions.find((o) => o.id === aiSettings.apiType)?.desc ?? "",
);

/**
 * 保存配置 on the API tab materializes the current draft into a provider card
 * so multiple provider APIs can coexist. On the other tabs it just closes.
 */
function saveConfig() {
  if (activeTab.value === "api") {
    if (!aiSettings.apiKey.trim()) {
      status.value = "请先填写 API key 再保存为配置卡片";
      statusType.value = "error";
      return;
    }
    if (aiSettings.provider === "OpenAICompatible" && !aiSettings.url.trim()) {
      status.value = "OpenAI 兼容协议需要填写 URL";
      statusType.value = "error";
      return;
    }

    const profile = saveProviderProfile(editingProfileId.value || undefined);
    editingProfileId.value = "";
    status.value = `已保存并启用「${profile.label}」，共 ${aiSettings.providerProfiles.length} 个模型提供商`;
    statusType.value = "ok";
    return;
  }

  status.value = "配置已保存";
  statusType.value = "ok";
  emit("close");
}

/* ---------------- provider profile cards ---------------- */

/** Non-empty while 保存配置 should overwrite an existing card instead of adding one. */
const editingProfileId = ref("");
const renamingProfileId = ref("");
const renameDraft = ref("");

const providerProfiles = computed(() => aiSettings.providerProfiles);

function onUseProfile(id: string) {
  if (!activateProviderProfile(id)) return;
  editingProfileId.value = "";
  const profile = aiSettings.providerProfiles.find((p) => p.id === id);
  status.value = `已切换到「${profile?.label ?? id}」`;
  statusType.value = "ok";
}

/** Load a card back into the form so 保存配置 updates it in place. */
function onEditProfile(id: string) {
  if (!activateProviderProfile(id)) return;
  editingProfileId.value = id;
  status.value = "已载入该配置，修改后点击「保存配置」即可更新此卡片";
  statusType.value = "";
}

function onDeleteProfile(id: string) {
  removeProviderProfile(id);
  if (editingProfileId.value === id) editingProfileId.value = "";
  status.value = "已删除该模型提供商配置";
  statusType.value = "ok";
}

function startRenameProfile(id: string, current: string) {
  renamingProfileId.value = id;
  renameDraft.value = current;
}

function commitRenameProfile() {
  if (renamingProfileId.value) {
    renameProviderProfile(renamingProfileId.value, renameDraft.value);
  }
  renamingProfileId.value = "";
  renameDraft.value = "";
}

function onProfileModelChange(id: string, event: Event) {
  setProfileModel(id, (event.target as HTMLSelectElement).value);
}

function onProfileAuditorModelChange(id: string, event: Event) {
  setProfileModel(id, (event.target as HTMLSelectElement).value, "auditorModel");
}

/** Clear the form so the next 保存配置 creates a brand-new card. */
function startNewProfile() {
  editingProfileId.value = "";
  aiSettings.apiKey = "";
  applyProvider(aiSettings.provider);
  status.value = "已清空表单，填写后点击「保存配置」将新增一个提供商卡片";
  statusType.value = "";
}

function addKnowledgeFile(type: "writer" | "auditor") {
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".txt,.md,.pdf,.docx,.doc,.rtf";
  input.onchange = async (e: Event) => {
    const target = e.target as HTMLInputElement;
    const files = target.files;
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      try {
        const content = await readFileContent(file);
        const newFile: KnowledgeFile = {
          id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
          name: file.name,
          content: content,
          path: file.webkitRelativePath || undefined,
        };

        if (type === "writer") {
          aiSettings.writerKnowledge.push(newFile);
        } else {
          aiSettings.auditorKnowledge.push(newFile);
        }
      } catch (error) {
        console.error("读取文件失败:", error);
        status.value = `读取文件 ${file.name} 失败`;
        statusType.value = "error";
      }
    }
  };
  input.click();
}

function readFileContent(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error("读取文件失败"));
    };

    if (file.type === "text/plain" || file.name.endsWith(".md") || file.name.endsWith(".txt")) {
      reader.readAsText(file);
    } else {
      reader.readAsText(file);
    }
  });
}

function removeKnowledgeFile(type: "writer" | "auditor", id: string) {
  const list = type === "writer" ? aiSettings.writerKnowledge : aiSettings.auditorKnowledge;
  const index = list.findIndex(f => f.id === id);
  if (index !== -1) list.splice(index, 1);
}

function onWriterAutoLoadChange(event: Event) {
  setKnowledgeAutoLoad("writer", (event.target as HTMLInputElement).checked);
}

/** 子选项卡（对话）回报的状态提示，复用面板底部同一条状态栏。 */
function onTabStatus(message: string, type: "ok" | "error") {
  status.value = message;
  statusType.value = type;
}

function onAuditorAutoLoadChange(event: Event) {
  setKnowledgeAutoLoad("auditor", (event.target as HTMLInputElement).checked);
}

const localFonts = computed(() => fontState.localFonts);
const localFontsError = computed(() => fontState.error);
const localFontsLoading = computed(() => fontState.loading);

/** Local fonts minus anything already listed under 预设字体. */
const localOnlyFonts = computed(() => {
  const presets = new Set(fontOptions);
  return localFonts.value.filter((f) => !presets.has(f));
});

function reloadLocalFonts() {
  void loadLocalFonts(true);
}

function onConfigTab() {
  activeTab.value = "config";
  ensureLocalFonts();
}

function toggleVectorModel(modelId: string) {
  aiSettings.builtinVectorModels.forEach((m) => {
    if (m.id === modelId) {
      m.enabled = !m.enabled;
      if (m.enabled) {
        aiSettings.activeVectorModel = m.id;
      }
    } else {
      m.enabled = false;
    }
  });
  rebuildInsightVectorIndex();
}

function downloadVectorModel(modelId: string) {
  const model = aiSettings.builtinVectorModels.find((m) => m.id === modelId);
  if (model) {
    status.value = `正在下载模型 ${model.name}...`;
    setTimeout(() => {
      model.downloaded = true;
      model.enabled = true;
      toggleVectorModel(model.id);
      status.value = `模型 ${model.name} 加载完成！`;
      statusType.value = "ok";
    }, 800);
  }
}

function clearVectorModel(modelId: string) {
  const model = aiSettings.builtinVectorModels.find((m) => m.id === modelId);
  if (model) {
    model.downloaded = false;
    model.enabled = false;
  }
}

function triggerReindex() {
  rebuildInsightVectorIndex();
  status.value = "向量数据库索引重构完成！";
  statusType.value = "ok";
}

function exportVectorConfig() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: "YanXiang agent",
    section: "vector",
    vectorEnabled: aiSettings.vectorEnabled,
    vectorSource: aiSettings.vectorSource,
    activeVectorModel: aiSettings.activeVectorModel,
    builtinVectorModels: aiSettings.builtinVectorModels.map((m) => ({
      id: m.id,
      name: m.name,
      downloaded: m.downloaded,
      enabled: m.enabled,
    })),
    remoteEmbeddingUrl: aiSettings.remoteEmbeddingUrl,
    remoteEmbeddingKey: aiSettings.remoteEmbeddingKey,
    remoteEmbeddingModel: aiSettings.remoteEmbeddingModel,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `yanxiang_vector_${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  status.value = "向量化配置已导出";
  statusType.value = "ok";
}

function importVectorConfig() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = (e: Event) => {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(String(reader.result ?? ""));
        if (cfg && typeof cfg.vectorEnabled === "boolean") {
          aiSettings.vectorEnabled = cfg.vectorEnabled;
        }
        if (cfg && (cfg.vectorSource === "local" || cfg.vectorSource === "remote")) {
          aiSettings.vectorSource = cfg.vectorSource;
        }
        if (cfg && typeof cfg.activeVectorModel === "string") {
          aiSettings.activeVectorModel = cfg.activeVectorModel;
          aiSettings.builtinVectorModels.forEach((m) => {
            m.enabled = m.id === cfg.activeVectorModel;
          });
        }
        if (cfg && Array.isArray(cfg.builtinVectorModels)) {
          const byId = new Map<string, { id: string; downloaded?: boolean; enabled?: boolean }>(
            cfg.builtinVectorModels.map((m: { id: string; downloaded?: boolean; enabled?: boolean }): [string, { id: string; downloaded?: boolean; enabled?: boolean }] => [m.id, m]),
          );
          aiSettings.builtinVectorModels.forEach((m) => {
            const incoming = byId.get(m.id);
            if (incoming) {
              if (typeof incoming.downloaded === "boolean") m.downloaded = incoming.downloaded;
              if (typeof incoming.enabled === "boolean") m.enabled = incoming.enabled;
            }
          });
        }
        if (cfg && typeof cfg.remoteEmbeddingUrl === "string") aiSettings.remoteEmbeddingUrl = cfg.remoteEmbeddingUrl;
        if (cfg && typeof cfg.remoteEmbeddingKey === "string") aiSettings.remoteEmbeddingKey = cfg.remoteEmbeddingKey;
        if (cfg && typeof cfg.remoteEmbeddingModel === "string") aiSettings.remoteEmbeddingModel = cfg.remoteEmbeddingModel;

        rebuildInsightVectorIndex();
        status.value = "向量化配置已导入并重建索引";
        statusType.value = "ok";
      } catch {
        status.value = "导入失败：配置文件格式不正确";
        statusType.value = "error";
      }
    };
    reader.readAsText(file);
  };
  input.click();
}

onMounted(() => {
  ensureLocalFonts();
  applyKnowledgeAutoLoad("chat");
  applyKnowledgeAutoLoad("writer");
  applyKnowledgeAutoLoad("auditor");
  rebuildInsightVectorIndex();
  document.addEventListener("mousedown", onDocumentMouseDown);
});

onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocumentMouseDown);
});
</script>

<template>
  <Teleport to="body">
    <div class="settings-overlay" @click.self="emit('close')">
      <div class="settings-dialog">
        <aside class="settings-nav">
          <div class="nav-caption">设置</div>
          <button class="nav-item" :class="{ active: activeTab === 'config' }" @click="onConfigTab">
            <Palette :size="16" :stroke-width="1.8" />
            配置
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'contentColor' }" @click="activeTab = 'contentColor'">
            <Palette :size="16" :stroke-width="1.8" />
            内容上色
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'api' }" @click="activeTab = 'api'">
            <Settings2 :size="16" :stroke-width="1.8" />
            AI接口设置
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'shortcuts' }" @click="activeTab = 'shortcuts'">
            <Keyboard :size="16" :stroke-width="1.8" />
            快捷键
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'chat' }" @click="activeTab = 'chat'">
            <MessageSquare :size="16" :stroke-width="1.8" />
            对话
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'writer' }" @click="activeTab = 'writer'">
            <FileText :size="16" :stroke-width="1.8" />
            AI写作
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'auditor' }" @click="activeTab = 'auditor'">
            <FileText :size="16" :stroke-width="1.8" />
            审核员
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'refine' }" @click="activeTab = 'refine'">
            <FileText :size="16" :stroke-width="1.8" />
            精修
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'vector' }" @click="activeTab = 'vector'">
            <Database :size="16" :stroke-width="1.8" />
            向量数据
          </button>
          <button class="nav-item" :class="{ active: activeTab === 'about' }" @click="activeTab = 'about'">
            <Info :size="16" :stroke-width="1.8" />
            关于
          </button>
        </aside>

        <div class="settings-main">
          <div class="settings-header">
            <h2>{{
              activeTab === 'api' ? 'AI接口设置' :
              activeTab === 'config' ? '配置' :
              activeTab === 'contentColor' ? '内容上色设置' :
              activeTab === 'shortcuts' ? '快捷键' :
              activeTab === 'chat' ? '对话设置' :
              activeTab === 'writer' ? 'AI写作设置' :
              activeTab === 'auditor' ? '审核员设置' :
              activeTab === 'refine' ? '精修设置' :
              activeTab === 'vector' ? '向量数据' : '关于'
            }}</h2>
            <button class="close-btn" title="关闭" @click="emit('close')">
              <X :size="18" :stroke-width="1.8" />
            </button>
          </div>

          <div class="settings-body">
            <!-- AI接口设置 -->
            <template v-if="activeTab === 'api'">
              <label class="field-label" for="provider">提供商</label>
              <select id="provider" v-model="aiSettings.provider" @change="onProviderChange">
                <option value="OpenAI">OpenAI</option>
                <option value="Anthropic">Anthropic</option>
                <option value="DeepSeek">DeepSeek</option>
                <option value="Google">Google Gemini</option>
                <option value="AgentRouter">Agent Router</option>
                <option value="OpenRouter">OpenRouter</option>
                <option value="OpenAICompatible">
                  {{ aiSettings.providerName.trim() || "OpenAI 兼容协议 / 中转" }}
                </option>
              </select>

              <template v-if="aiSettings.provider === 'OpenAICompatible'">
                <label class="field-label" for="providerName">提供商名称</label>
                <input
                  id="providerName"
                  v-model="aiSettings.providerName"
                  type="text"
                  placeholder="例如：我的本地 vLLM、Groq、Ollama…"
                  autocomplete="off"
                />
                <p class="field-hint">为便于区分多个 OpenAI 兼容 / 中转地址，请给这个提供商起个名字。</p>
              </template>

              <label class="field-label" for="apiType">API 类型</label>
              <select id="apiType" v-model="aiSettings.apiType" @change="onApiTypeChange">
                <option v-for="opt in apiTypeOptions" :key="opt.id" :value="opt.id">
                  {{ opt.label }}
                </option>
              </select>
              <p class="field-hint">{{ apiTypeDesc }}</p>

              <label class="field-label" for="apiKey">API key</label>
              <input
                id="apiKey"
                v-model="aiSettings.apiKey"
                type="password"
                placeholder="支持 sk- 或非 sk- 前缀的 Key"
                autocomplete="off"
              />

              <label class="field-label" for="url">URL</label>
              <input
                id="url"
                v-model="aiSettings.url"
                type="text"
                :placeholder="aiSettings.provider === 'OpenAICompatible' ? 'http://localhost:8000/v1 或中转地址' : '已自动配置，可手动覆盖'"
              />

              <label class="field-label" for="model">模型</label>
              <div ref="modelMenuRef" class="model-dropdown">
                <button
                  type="button"
                  class="model-dropdown-trigger"
                  @click.stop="modelMenuOpen = !modelMenuOpen"
                >
                  <span class="model-dropdown-value">{{ aiSettings.model || "点击选择模型" }}</span>
                  <ChevronDown :size="14" :stroke-width="2" />
                </button>

                <Transition name="menu">
                  <div v-if="modelMenuOpen" class="model-dropdown-menu" @click.stop>
                    <div class="model-dropdown-search">
                      <Search :size="13" :stroke-width="2" class="model-search-icon" />
                      <input
                        v-model="modelQuery"
                        class="model-search-input"
                        type="text"
                        placeholder="搜索模型…"
                      />
                    </div>
                    <div class="model-dropdown-list">
                      <div
                        v-for="m in filteredAvailableModels"
                        :key="m"
                        class="model-dropdown-item"
                        :class="{ active: aiSettings.model === m, enabled: aiSettings.models.includes(m) }"
                      >
                        <button
                          type="button"
                          class="model-dropdown-name"
                          :title="`选择 ${m}`"
                          @click.stop="selectModel(m)"
                        >
                          {{ m }}
                        </button>
                        <button
                          type="button"
                          class="model-dropdown-add"
                          :class="{ on: aiSettings.models.includes(m) }"
                          :title="aiSettings.models.includes(m) ? '已加入聊天模型列表，点击移除' : '点击加入聊天模型列表'"
                          @click.stop="toggleModelEnabled(m)"
                        >
                          <Check v-if="aiSettings.models.includes(m)" :size="12" :stroke-width="2.4" />
                          <Plus v-else :size="12" :stroke-width="2.2" />
                        </button>
                      </div>
                      <div v-if="filteredAvailableModels.length === 0" class="model-dropdown-empty">
                        无匹配模型
                      </div>
                    </div>
                  </div>
                </Transition>
              </div>
              <p class="field-hint">点击模型名称右上角「+」将其加入聊天底部模型下拉列表；当前选中的模型用于本次对话。</p>

              <div class="action-row">
                <button class="secondary-btn" @click="fetchModels">
                  <RefreshCw :size="13" :stroke-width="1.9" />
                  获取模型
                </button>
                <button class="secondary-btn" @click="testConnection">测试连接</button>
              </div>

              <p v-if="status" class="status-text" :class="statusType">{{ status }}</p>

              <button class="save-btn inline" @click="saveConfig">
                {{ editingProfileId ? "保存配置（更新当前卡片）" : "保存配置（新增提供商卡片）" }}
              </button>

              <!-- 已保存的模型提供商卡片 -->
              <div class="profile-section">
                <div class="profile-header">
                  <label class="field-label">模型提供商</label>
                  <div class="profile-header-actions">
                    <span class="profile-count">{{ providerProfiles.length }} 个</span>
                    <button class="knowledge-add-btn" title="清空表单以新增提供商" @click="startNewProfile">
                      <Plus :size="16" :stroke-width="1.8" />
                    </button>
                  </div>
                </div>

                <div v-if="providerProfiles.length === 0" class="profile-empty">
                  暂无已保存的提供商。填写上方表单后点击「保存配置」，即会在此生成一张卡片。
                </div>

                <div
                  v-for="profile in providerProfiles"
                  :key="profile.id"
                  class="profile-card"
                  :class="{ active: profile.id === aiSettings.activeProfileId, editing: profile.id === editingProfileId }"
                >
                  <div class="profile-card-head">
                    <Server :size="14" :stroke-width="1.8" class="profile-icon" />

                    <input
                      v-if="renamingProfileId === profile.id"
                      v-model="renameDraft"
                      class="profile-rename-input"
                      autofocus
                      @keydown.enter="commitRenameProfile"
                      @keydown.esc="renamingProfileId = ''"
                      @blur="commitRenameProfile"
                    />
                    <span
                      v-else
                      class="profile-name"
                      title="双击重命名"
                      @dblclick="startRenameProfile(profile.id, profile.label)"
                    >
                      {{ profile.label }}
                    </span>

                    <span v-if="profile.id === aiSettings.activeProfileId" class="profile-badge">
                      <Check :size="11" :stroke-width="2.4" />
                      使用中
                    </span>

                    <div class="profile-card-actions">
                      <button
                        v-if="profile.id !== aiSettings.activeProfileId"
                        class="profile-mini-btn"
                        title="切换为当前使用"
                        @click="onUseProfile(profile.id)"
                      >
                        <Check :size="13" :stroke-width="2" />
                      </button>
                      <button class="profile-mini-btn" title="载入表单编辑" @click="onEditProfile(profile.id)">
                        <Pencil :size="13" :stroke-width="1.9" />
                      </button>
                      <button class="profile-mini-btn danger" title="删除该提供商" @click="onDeleteProfile(profile.id)">
                        <Trash2 :size="13" :stroke-width="1.9" />
                      </button>
                    </div>
                  </div>

                  <div class="profile-meta">
                    <span class="profile-chip">{{ providerLabel(profile.provider, profile.name) }}</span>
                    <span class="profile-chip accent">{{ apiTypeLabel(profile.apiType) }}</span>
                    <span class="profile-chip subtle">{{ maskApiKey(profile.apiKey) }}</span>
                    <span v-if="profile.url" class="profile-chip subtle" :title="profile.url">{{ profile.url }}</span>
                  </div>

                  <div class="profile-model-row">
                    <label class="profile-model-label">写作模型</label>
                    <select
                      class="profile-model-select"
                      :value="profile.model"
                      @change="onProfileModelChange(profile.id, $event)"
                    >
                      <option v-for="m in (profile.models.length > 0 ? profile.models : [profile.model])" :key="m" :value="m">
                        {{ m }}
                      </option>
                    </select>
                  </div>

                  <div class="profile-model-row">
                    <label class="profile-model-label">审核模型</label>
                    <select
                      class="profile-model-select"
                      :value="profile.auditorModel || profile.model"
                      @change="onProfileAuditorModelChange(profile.id, $event)"
                    >
                      <option v-for="m in (profile.models.length > 0 ? profile.models : [profile.model])" :key="m" :value="m">
                        {{ m }}
                      </option>
                    </select>
                  </div>
                </div>
              </div>
            </template>

            <!-- 配置 -->
            <template v-if="activeTab === 'config'">
              <div class="theme-header">
                <label class="field-label">主题色</label>
                <span class="theme-current" :title="aiSettings.theme.primary">
                  <span class="theme-current-dot" :style="{ background: aiSettings.theme.primary }"></span>
                  {{ aiSettings.theme.primary.toUpperCase() }}
                </span>
              </div>

              <div class="theme-grid">
                <!-- 点击色点即打开可自由取色的调色盘 -->
                <div v-for="opt in themeOptions" :key="opt.label" class="theme-btn-wrap">
                  <button
                    class="theme-btn"
                    :class="{ active: aiSettings.theme.primary === opt.theme.primary }"
                    :title="`应用 ${opt.label}（${opt.theme.primary.toUpperCase()}）· 点击色点自定义`"
                    @click="onThemeSelect(opt)"
                  >
                    <span
                      class="theme-swatch"
                      :style="{ background: opt.theme.primary }"
                      title="打开调色盘自定义"
                      @click.stop="openColorPicker(opt.theme.primary)"
                    ></span>
                    <span class="theme-label">{{ opt.label }}</span>
                  </button>
                </div>

                <button class="theme-btn theme-btn-custom" title="自定义任意主题色" @click="openColorPicker(aiSettings.theme.primary)">
                  <span class="theme-swatch swatch-custom">
                    <Pipette :size="12" :stroke-width="2" />
                  </span>
                  <span class="theme-label">自定义</span>
                </button>
              </div>

              <div class="theme-picker-anchor">
                <ThemeColorPicker
                  v-if="colorPickerOpen"
                  :value="colorPickerSeed"
                  @close="colorPickerOpen = false"
                  @applied="onColorApplied"
                />
              </div>

              <label class="field-label" for="appFont">字体</label>
               <div class="font-section">
                 <select id="appFont" v-model="aiSettings.appFont" class="font-select" @change="onFontSelect">
                   <optgroup label="预设字体">
                     <option v-for="f in fontOptions" :key="f" :value="f">{{ f }}</option>
                   </optgroup>
                   <optgroup v-if="localOnlyFonts.length > 0" label="本地字体">
                     <option v-for="f in localOnlyFonts" :key="f" :value="f">{{ f }}</option>
                   </optgroup>
                 </select>
                 <div v-if="localFontsError" class="font-error-row">
                   <span class="font-hint">未能在当前系统中检测到本地字体</span>
                   <button class="retry-btn" @click="reloadLocalFonts">重新获取</button>
                 </div>
                 <p v-if="localFontsLoading" class="font-loading">正在获取本地字体列表...</p>
               </div>

               <!-- 统一排版表单：字号、行间距、水平边距、垂直边距 -->
               <div style="margin-top: 14px; display: flex; flex-direction: column; gap: 10px;">
                 <div style="display: flex; align-items: center; justify-content: space-between;">
                   <label class="field-label" style="margin: 0;">字号</label>
                   <select
                     v-model.number="aiSettings.editorFontSize"
                     class="font-select"
                     style="width: 140px; padding: 6px 8px;"
                   >
                     <option v-for="size in EDITOR_FONT_SIZES" :key="size" :value="size">{{ size }}px</option>
                   </select>
                 </div>
                 <div style="display: flex; align-items: center; justify-content: space-between;">
                   <label class="field-label" style="margin: 0;">行间距</label>
                   <input
                     v-model.number="aiSettings.editorLineHeight"
                     type="number"
                     step="0.05"
                     min="1"
                     max="3"
                     class="font-select"
                     style="width: 140px; padding: 6px 8px; text-align: right;"
                   />
                 </div>
                 <div style="display: flex; align-items: center; justify-content: space-between;">
                   <label class="field-label" style="margin: 0;">水平边距</label>
                   <div style="display: flex; align-items: center; gap: 4px;">
                     <input
                       v-model.number="aiSettings.editorMarginX"
                       type="number"
                       step="1"
                       min="0"
                       max="200"
                       class="font-select"
                       style="width: 110px; padding: 6px 8px; text-align: right;"
                     />
                     <span style="font-size: 12px; color: var(--on-surface-variant);">px</span>
                   </div>
                 </div>
                 <div style="display: flex; align-items: center; justify-content: space-between;">
                   <label class="field-label" style="margin: 0;">垂直边距</label>
                   <div style="display: flex; align-items: center; gap: 4px;">
                     <input
                       v-model.number="aiSettings.editorMarginY"
                       type="number"
                       step="1"
                       min="0"
                       max="200"
                       class="font-select"
                       style="width: 110px; padding: 6px 8px; text-align: right;"
                     />
                     <span style="font-size: 12px; color: var(--on-surface-variant);">px</span>
                   </div>
                 </div>
               </div>

              <div class="vector-master-row" style="margin-top: 18px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">行首缩进</div>
                  <div class="vector-master-desc">在预览区与手机高保真模拟预览中将每个正文段落首行缩进 2 字符（开启首字下沉的首段不再缩进；标题 / 列表 / 引用 / 代码块除外）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.firstLineIndent"
                    @change="aiSettings.firstLineIndent = !aiSettings.firstLineIndent"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="vector-master-row" style="margin-top: 10px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">首字下沉</div>
                  <div class="vector-master-desc">在预览区与手机高保真模拟预览中将正文首字放大下沉显示（首字下沉与行首缩进互斥，开启后首段不再缩进；标题 / 列表 / 引用 / 代码块除外）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.dropCap"
                    @change="aiSettings.dropCap = !aiSettings.dropCap"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="vector-master-row" style="margin-top: 10px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">选中文字浮现工具栏</div>
                  <div class="vector-master-desc">选中文字时在光标旁浮现 剪切/复制/粘贴/智能文本处理 等快捷工具（默认开启）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.selectionToolbarEnabled"
                    @change="aiSettings.selectionToolbarEnabled = !aiSettings.selectionToolbarEnabled"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="vector-master-row" style="margin-top: 10px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">修订与批注</div>
                  <div class="vector-master-desc">选中正文后以图层方式记录修订与批注，挂在左侧文档条目下方；小眼睛控制预览是否套用修订（默认开启）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.revisionAnnotationEnabled"
                    @change="aiSettings.revisionAnnotationEnabled = !aiSettings.revisionAnnotationEnabled"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="vector-master-row" style="margin-top: 10px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">素材库</div>
                  <div class="vector-master-desc">对话中输入框旁的「素材库」面板，勾选的素材以后台上下文携带（默认开启）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.materialLibraryEnabled"
                    @change="aiSettings.materialLibraryEnabled = !aiSettings.materialLibraryEnabled"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="vector-master-row" style="margin-top: 10px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">故事定制</div>
                  <div class="vector-master-desc">对话中可点选角色原型 / 情节，约束生成的人物与情节骨架（默认开启）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.storyCraftEnabled"
                    @change="aiSettings.storyCraftEnabled = !aiSettings.storyCraftEnabled"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div class="vector-master-row" style="margin-top: 10px;">
                <div class="vector-master-info">
                  <div class="vector-master-title">叙事定制</div>
                  <div class="vector-master-desc">对话 / AI写作 中可点选结构 · 手法 · 结尾，打散机械同构的写法（默认开启）</div>
                </div>
                <label class="toggle-switch">
                  <input
                    type="checkbox"
                    :checked="aiSettings.narrativeCraftEnabled"
                    @change="aiSettings.narrativeCraftEnabled = !aiSettings.narrativeCraftEnabled"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <!-- 阅读进度圆环折叠面板 -->
              <div class="vector-master-row" style="margin-top: 10px; cursor: pointer;" @click="readingRingOpen = !readingRingOpen">
                <div class="vector-master-info">
                  <div class="vector-master-title" style="display: flex; align-items: center; gap: 6px;">
                    <ChevronDown :size="15" :style="{ transform: readingRingOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }" />
                    阅读进度圆环设置
                  </div>
                  <div class="vector-master-desc">悬浮圆环开关、大小、不透明度与位置复位（点击展开/折叠）</div>
                </div>
                <label class="toggle-switch" @click.stop>
                  <input
                    type="checkbox"
                    :checked="aiSettings.readingRingEnabled"
                    @change="aiSettings.readingRingEnabled = !aiSettings.readingRingEnabled"
                  />
                  <span class="toggle-slider"></span>
                </label>
              </div>

              <div v-if="readingRingOpen && aiSettings.readingRingEnabled" class="ring-size-row">
                <div class="ring-size-head">
                  <span class="ring-size-label">圆环大小</span>
                  <span class="ring-size-value num-tabular">{{ aiSettings.readingRingSize }} px</span>
                </div>
                <input
                  type="range"
                  class="ring-size-slider"
                  :min="RING_SIZE_MIN"
                  :max="RING_SIZE_MAX"
                  step="1"
                  :value="aiSettings.readingRingSize"
                  @input="onRingSizeInput"
                />
                <div class="ring-size-scale">
                  <span>{{ RING_SIZE_MIN }} px 小巧</span>
                  <span>{{ RING_SIZE_MAX }} px 醒目</span>
                </div>

                <div class="ring-size-head" style="margin-top: 14px;">
                  <span class="ring-size-label">不透明度</span>
                  <span class="ring-size-value num-tabular">{{ aiSettings.readingRingOpacity }} %</span>
                </div>
                <input
                  type="range"
                  class="ring-size-slider"
                  :min="RING_OPACITY_MIN"
                  :max="RING_OPACITY_MAX"
                  step="1"
                  :value="aiSettings.readingRingOpacity"
                  @input="onRingOpacityInput"
                />
                <div class="ring-size-scale">
                  <span>{{ RING_OPACITY_MIN }} % 通透</span>
                  <span>{{ RING_OPACITY_MAX }} % 清晰</span>
                </div>
                <p class="ring-size-hint">同时作用于圆环与展开的目录面板：底色、描边、投影与磨砂强度一起变化，环内数值与目录文字始终保持可读。</p>

                <div class="ring-size-actions">
                  <button
                    class="ring-size-reset"
                    :disabled="ringPositionCount === 0"
                    :title="ringPositionCount === 0 ? '当前全部圆环都在默认的右上角' : `复位 ${ringPositionCount} 处已挪动的圆环`"
                    @click="resetRingLayout"
                  >
                    圆环位置复位到右上角
                  </button>
                </div>
              </div>

              <!-- 段落聚光灯折叠面板 -->
              <div class="vector-master-row" style="margin-top: 16px; border-top: 1px solid var(--outline-variant); padding-top: 14px; cursor: pointer;" @click="spotlightOpen = !spotlightOpen">
                <div class="vector-master-info">
                  <div class="vector-master-title" style="display: flex; align-items: center; gap: 6px;">
                    <ChevronDown :size="15" :style="{ transform: spotlightOpen ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s' }" />
                    段落聚光灯朦胧遮罩设置
                  </div>
                  <div class="vector-master-desc">调整段落聚光灯模式下非焦点段落的虚化朦胧度与半透明过度（点击展开/折叠）</div>
                </div>
              </div>

              <div v-if="spotlightOpen" class="ring-size-row">
                <div class="ring-size-head">
                  <span class="ring-size-label">非焦点虚化朦胧度</span>
                  <span class="ring-size-value num-tabular">{{ aiSettings.spotlightBlur }} px</span>
                </div>
                <input
                  type="range"
                  class="ring-size-slider"
                  min="0"
                  max="5"
                  step="0.5"
                  :value="aiSettings.spotlightBlur"
                  @input="aiSettings.spotlightBlur = Number(($event.target as HTMLInputElement).value)"
                />
                <div class="ring-size-scale">
                  <span>0 px 无虚化</span>
                  <span>5 px 强朦胧</span>
                </div>

                <div class="ring-size-head" style="margin-top: 14px;">
                  <span class="ring-size-label">非焦点文本透明度</span>
                  <span class="ring-size-value num-tabular">{{ aiSettings.spotlightOpacity }} %</span>
                </div>
                <input
                  type="range"
                  class="ring-size-slider"
                  min="10"
                  max="80"
                  step="5"
                  :value="aiSettings.spotlightOpacity"
                  @input="aiSettings.spotlightOpacity = Number(($event.target as HTMLInputElement).value)"
                />
                <div class="ring-size-scale">
                  <span>10 % 幽暗</span>
                  <span>80 % 柔和</span>
                </div>
              </div>
            </template>

            <!-- 内容上色 -->
            <template v-if="activeTab === 'contentColor'">
              <p class="field-hint">设置文档预览与高保真阅读时按字符和语法元素划分的内容配色方案。「方案一」是默认底本、不被改写：在它上面调色后点「保存方案」会另存为下一套（方案二 … 方案五）并切过去；停在方案二及以后时，保存即覆盖该套方案本身。最多共 {{ MAX_CONTENT_COLOR_SCHEMES }} 套，横向标签随时换回任意方案，所有修改即时生效。</p>

              <div class="content-color-tabs">
                <div
                  v-for="s in contentColorSchemes"
                  :key="s.id"
                  class="content-color-tab-wrap"
                  :class="{ active: s.id === activeSchemeId }"
                >
                  <button
                    class="content-color-tab"
                    :class="{ active: s.id === activeSchemeId }"
                    @click="selectContentColorScheme(s.id)"
                  >{{ s.name }}</button>
                  <button
                    v-if="contentColorSchemes.length > 1 && s.id !== 'scheme-1'"
                    class="content-color-tab-del"
                    title="删除该方案"
                    @click.stop="deleteContentColorScheme(s.id)"
                  >
                    <X :size="11" :stroke-width="2.2" />
                  </button>
                </div>
                <span class="content-color-tab-count" :class="{ full: schemeLimitReached }">
                  {{ schemeCount }} / {{ MAX_CONTENT_COLOR_SCHEMES }} 套
                </span>
              </div>

              <div class="content-color-grid">
                <div v-for="item in CONTENT_COLOR_ITEMS" :key="item.key" class="content-color-card">
                  <div class="content-color-left">
                    <span
                      class="content-color-dot"
                      :style="{ background: draftContentColors[item.key] }"
                      :title="`点击打开调色盘 · ${item.label}`"
                      @click="triggerContentColorPicker(item.key)"
                    ></span>
                    <input
                      type="color"
                      :ref="(el) => setContentColorInputRef(item.key, el)"
                      class="color-picker-hidden"
                      :value="formatHexForColorPicker(draftContentColors[item.key])"
                      @input="onContentColorPickerInput(item.key, $event)"
                    />
                    <span class="content-color-name">{{ item.label }}</span>
                  </div>
                  <input
                    type="text"
                    class="content-color-hex-input"
                    v-model="draftContentColors[item.key]"
                    @input="onContentColorHexTextChange(item.key)"
                    placeholder="#000000"
                  />
                </div>
              </div>

              <p v-if="schemeStatus" class="status-text" :class="schemeStatusType">{{ schemeStatus }}</p>

              <!-- 方案预览：与文档预览同一条渲染 + 上色管线，改色即时反映 -->
              <div class="scheme-preview">
                <div class="scheme-preview-head">
                  <span class="scheme-preview-title">方案预览</span>
                  <span class="scheme-preview-hint">当前草稿配色 · {{ activeSchemeName }}</span>
                </div>
                <div class="scheme-preview-paper">
                  <div
                    class="markdown-body reading-view content-colored"
                    :style="contentColorPreviewStyle"
                    v-html="contentColorPreviewHtml"
                  ></div>
                </div>
              </div>

              <div class="content-color-actions">
                <button class="btn btn-secondary" @click="restoreDefaultContentColors">恢复默认</button>
                <button
                  class="btn btn-primary"
                  :title="activeIsBaseScheme
                    ? (schemeLimitReached
                        ? `方案已满 ${MAX_CONTENT_COLOR_SCHEMES} 套：删掉一套，或切到方案二及以后再保存`
                        : '另存为下一套新方案并切过去')
                    : `覆盖保存到「${activeSchemeName}」`"
                  @click="saveContentColors"
                >
                  {{ activeIsBaseScheme ? "保存方案（另存为新方案）" : `保存方案（更新${activeSchemeName}）` }}
                </button>
              </div>
            </template>

            <!-- 快捷键 -->
            <template v-if="activeTab === 'shortcuts'">
              <p class="field-hint">项目中涉及的全部快捷键，按功能分组整理如下。</p>
              <div class="shortcut-section" v-for="group in shortcutGroups" :key="group.group">
                <div class="shortcut-group-title">{{ group.group }}</div>
                <div class="shortcut-table">
                  <div class="shortcut-row shortcut-row-head">
                    <span class="shortcut-name">名称</span>
                    <span class="shortcut-keys">快捷键</span>
                  </div>
                  <div v-for="item in group.items" :key="group.group + item.name" class="shortcut-row">
                    <span class="shortcut-name">{{ item.name }}</span>
                    <span class="shortcut-keys">
                      <kbd v-for="k in item.keys.split(' / ')" :key="k">{{ k }}</kbd>
                    </span>
                  </div>
                </div>
              </div>
            </template>

            <!-- 对话设置（表单结构与 AI写作 一致，独立组件维护） -->
            <template v-if="activeTab === 'chat'">
              <ChatSettingsTab @save="saveConfig" @status="onTabStatus" />
            </template>

            <!-- AI写作设置 -->
            <template v-if="activeTab === 'writer'">
              <div class="prompt-header">
                <label class="field-label" for="writerPrompt">提示词</label>
                <button class="restore-prompt-btn" title="恢复默认提示词" @click="restorePrompt('writer')">
                  <RotateCcw :size="13" :stroke-width="1.8" />
                  恢复默认
                </button>
              </div>
              <textarea
                id="writerPrompt"
                v-model="aiSettings.writerPrompt"
                class="prompt-textarea"
                rows="12"
                placeholder="请输入AI写作的提示词..."
              ></textarea>

              <div class="knowledge-section">
                <div class="knowledge-header">
                  <label class="field-label">知识</label>
                  <div class="knowledge-header-actions">
                    <label class="auto-load-control" title="自动加载内置默认知识素材（AI写作——反面例子、禁止模式、人类写作 vs AI写作、网络文学受众画像）">
                      <span class="auto-load-text">自动加载</span>
                      <span class="toggle-switch">
                        <input type="checkbox" :checked="aiSettings.writerKnowledgeAutoLoad" @change="onWriterAutoLoadChange" />
                        <span class="toggle-slider"></span>
                      </span>
                    </label>
                    <button class="knowledge-add-btn" @click="addKnowledgeFile('writer')" title="添加知识文件">
                      <Plus :size="16" :stroke-width="1.8" />
                    </button>
                  </div>
                </div>
                <div class="knowledge-list">
                  <div v-if="aiSettings.writerKnowledge.length === 0" class="knowledge-empty">
                    暂无知识文件，点击 + 添加
                  </div>
                  <div v-for="file in aiSettings.writerKnowledge" :key="file.id" class="knowledge-item">
                    <div class="knowledge-file-info">
                      <FileText :size="14" :stroke-width="1.8" />
                      <span class="knowledge-file-name">{{ file.name }}</span>
                    </div>
                    <button class="knowledge-remove-btn" @click="removeKnowledgeFile('writer', file.id)" title="移除文件">
                      <Trash2 :size="14" :stroke-width="1.8" />
                    </button>
                  </div>
                </div>
              </div>

              <button class="save-btn" @click="saveConfig">保存配置</button>
            </template>

            <!-- 审核员设置 -->
            <template v-if="activeTab === 'auditor'">
              <div class="prompt-header">
                <label class="field-label" for="auditorPrompt">提示词</label>
                <button class="restore-prompt-btn" title="恢复默认提示词" @click="restorePrompt('auditor')">
                  <RotateCcw :size="13" :stroke-width="1.8" />
                  恢复默认
                </button>
              </div>
              <textarea
                id="auditorPrompt"
                v-model="aiSettings.auditorPrompt"
                class="prompt-textarea"
                rows="12"
                placeholder="请输入审核员的提示词..."
              ></textarea>

              <div class="knowledge-section">
                <div class="knowledge-header">
                  <label class="field-label">知识</label>
                  <div class="knowledge-header-actions">
                    <label class="auto-load-control" title="自动加载内置默认知识素材（AI写作——反面例子、自查评分表、禁止模式）">
                      <span class="auto-load-text">自动加载</span>
                      <span class="toggle-switch">
                        <input type="checkbox" :checked="aiSettings.auditorKnowledgeAutoLoad" @change="onAuditorAutoLoadChange" />
                        <span class="toggle-slider"></span>
                      </span>
                    </label>
                    <button class="knowledge-add-btn" @click="addKnowledgeFile('auditor')" title="添加知识文件">
                      <Plus :size="16" :stroke-width="1.8" />
                    </button>
                  </div>
                </div>
                <div class="knowledge-list">
                  <div v-if="aiSettings.auditorKnowledge.length === 0" class="knowledge-empty">
                    暂无知识文件，点击 + 添加
                  </div>
                  <div v-for="file in aiSettings.auditorKnowledge" :key="file.id" class="knowledge-item">
                    <div class="knowledge-file-info">
                      <FileText :size="14" :stroke-width="1.8" />
                      <span class="knowledge-file-name">{{ file.name }}</span>
                    </div>
                    <button class="knowledge-remove-btn" @click="removeKnowledgeFile('auditor', file.id)" title="移除文件">
                      <Trash2 :size="14" :stroke-width="1.8" />
                    </button>
                  </div>
                </div>
              </div>

              <button class="save-btn" @click="saveConfig">保存配置</button>
            </template>

            <!-- 精修设置 -->
            <template v-if="activeTab === 'refine'">
              <div class="prompt-header">
                <label class="field-label" for="refinePrompt">提示词</label>
                <button class="restore-prompt-btn" title="恢复默认提示词" @click="restorePrompt('refine')">
                  <RotateCcw :size="13" :stroke-width="1.8" />
                  恢复默认
                </button>
              </div>
              <textarea
                id="refinePrompt"
                v-model="aiSettings.refinePrompt"
                class="prompt-textarea"
                rows="12"
                placeholder="请输入精修环节的提示词..."
              ></textarea>

              <button class="save-btn" @click="saveConfig">保存配置</button>
            </template>

            <!-- 向量数据设置 -->
            <template v-if="activeTab === 'vector'">
              <div class="vector-section">
                <!-- 向量模型总开关 -->
                <div class="vector-master-row">
                  <div class="vector-master-info">
                    <div class="vector-master-title">向量模型</div>
                    <div class="vector-master-desc">总开关：开启后「洞察」数据将被向量化并在 AI 写作/精修中做 RAG 语义联动</div>
                  </div>
                  <label class="toggle-switch">
                    <input
                      type="checkbox"
                      :checked="aiSettings.vectorEnabled"
                      @change="aiSettings.vectorEnabled = !aiSettings.vectorEnabled"
                    />
                    <span class="toggle-slider"></span>
                  </label>
                </div>

                <div class="vector-section-title" style="margin-top: 14px;">模型来源</div>
                <div class="vector-source-cards">
                  <div
                    class="vector-source-card"
                    :class="{ active: aiSettings.vectorSource === 'local' }"
                    @click="aiSettings.vectorSource = 'local'"
                  >
                    <div class="source-card-title">内置本地模型</div>
                    <div class="source-card-sub">下载模型到本地运行，无需 API</div>
                  </div>
                  <div
                    class="vector-source-card"
                    :class="{ active: aiSettings.vectorSource === 'remote' }"
                    @click="aiSettings.vectorSource = 'remote'"
                  >
                    <div class="source-card-title">远程 API</div>
                    <div class="source-card-sub">使用外部嵌入 API 服务</div>
                  </div>
                </div>

                <template v-if="aiSettings.vectorSource === 'local'">
                  <div class="vector-section-title" style="margin-top: 16px;">内置模型</div>
                  <div class="vector-section-desc">下载轻量模型在应用内本地运行，首次下载后自动缓存。</div>

                  <div class="builtin-models-list">
                    <div
                      v-for="m in aiSettings.builtinVectorModels"
                      :key="m.id"
                      class="builtin-model-card"
                      :class="{ enabled: m.enabled }"
                    >
                      <div class="model-card-left">
                        <div class="model-card-header">
                          <span class="model-name">{{ m.name }}</span>
                          <span class="model-size">{{ m.size }}</span>
                          <span class="model-dim">维度: {{ m.dimension }}</span>
                          <span v-if="m.recommended" class="model-badge">推荐</span>
                          <span v-if="m.downloaded" class="model-status-tag">
                            <CheckCircle2 :size="12" /> 已加载
                          </span>
                        </div>
                        <div class="model-desc">{{ m.desc }}</div>
                      </div>

                      <div class="model-card-right">
                        <template v-if="m.downloaded">
                          <button class="model-clear-btn" title="清除已缓存模型" @click="clearVectorModel(m.id)">
                            <Trash2 :size="14" />
                            <span>清除</span>
                          </button>
                          <label class="toggle-switch">
                            <input
                              type="checkbox"
                              :checked="m.enabled"
                              @change="toggleVectorModel(m.id)"
                            />
                            <span class="toggle-slider"></span>
                          </label>
                        </template>
                        <template v-else>
                          <button class="model-download-btn" @click="downloadVectorModel(m.id)">
                            <DownloadCloud :size="14" />
                            <span>下载</span>
                          </button>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>

                <template v-else>
                  <div class="remote-api-box" style="margin-top: 12px;">
                    <label class="field-label">Embedding 服务 Endpoint</label>
                    <input
                      v-model="aiSettings.remoteEmbeddingUrl"
                      type="text"
                      placeholder="https://api.openai.com/v1/embeddings"
                    />

                    <label class="field-label" style="margin-top: 10px;">Embedding API Key</label>
                    <input
                      v-model="aiSettings.remoteEmbeddingKey"
                      type="password"
                      placeholder="sk-..."
                    />

                    <label class="field-label" style="margin-top: 10px;">模型名称</label>
                    <input
                      v-model="aiSettings.remoteEmbeddingModel"
                      type="text"
                      placeholder="text-embedding-3-small"
                    />
                  </div>
                </template>

                <div class="vector-status-card" style="margin-top: 16px;">
                  <div class="status-card-header">
                    <div class="status-info">
                      <span class="status-dot"></span>
                      <span class="status-title">洞察向量数据库状态：{{ vectorStore.statusText }}</span>
                    </div>
                    <button class="reindex-btn" @click="triggerReindex">
                      <RefreshCw :size="13" />
                      <span>重新索引向量库</span>
                    </button>
                  </div>
                  <div class="status-details">
                    已向量化 <strong>{{ vectorStore.totalChunks }}</strong> 条洞察分析数据样本。RAG 语义匹配实时在 AI 写作/精修中关联。
                  </div>
                  <div class="vector-config-actions">
                    <button class="config-action-btn" @click="exportVectorConfig" title="导出向量化配置为 JSON">
                      <Download :size="14" />
                      <span>导出向量化配置</span>
                    </button>
                    <button class="config-action-btn" @click="importVectorConfig" title="从 JSON 导入向量化配置">
                      <Upload :size="14" />
                      <span>导入向量化配置</span>
                    </button>
                  </div>
                </div>
              </div>

              <p v-if="status" class="status-text" :class="statusType">{{ status }}</p>
              <button class="save-btn" @click="saveConfig">保存配置</button>
            </template>

            <!-- 关于 -->
            <template v-if="activeTab === 'about'">
              <div class="about-card">
                <img
                  class="about-logo"
                  :src="appIconUrl"
                  width="64"
                  height="64"
                  alt="YanXiang agent 应用图标"
                  draggable="false"
                />
                <h3 class="about-name">YanXiang agent</h3>
                <p class="about-tagline">一体化的中文写作助手：AI 写作 · 审核 · 精修 · 素材库 · 故事/叙事定制 · 洞察 · 向量检索 · 故事地图</p>
                <div class="about-desc">
                  本项目是一个集文档编辑、AI 对话写作、智能精修、灵感速记、写作画布与故事地图于一体的写作工作台。
                  内置素材库与故事 / 叙事定制，让 AI 生成更贴近你的创作意图。
                </div>
              </div>
              <div class="about-card">
                <div class="about-row">
                  <span class="about-row-label">版本</span>
                  <span class="about-row-value">1.0.0</span>
                </div>
                <div class="about-row">
                  <span class="about-row-label">作者</span>
                  <span class="about-row-value">Idun</span>
                </div>
                <div class="about-row">
                  <span class="about-row-label">GitHub</span>
                  <a
                    class="about-link"
                    href="https://github.com/Idun"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    https://github.com/Idun
                    <ExternalLink :size="13" :stroke-width="1.8" />
                  </a>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.settings-overlay {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgb(15 23 42 / 0.45);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.settings-dialog {
  width: 780px;
  max-width: 100%;
  height: 720px;
  max-height: 90vh;
  display: flex;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.settings-nav {
  width: 200px;
  flex-shrink: 0;
  background: var(--surface-container);
  border-right: 1px solid var(--outline-variant);
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.nav-caption {
  padding: 8px 10px 12px;
  font-size: 11px;
  line-height: 16px;
  letter-spacing: 0.05em;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--on-surface-variant);
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  text-align: left;
  transition: background 0.2s ease, color 0.2s ease;
}

.nav-item.active {
  background: var(--primary);
  color: var(--on-primary, #fff);
}

.settings-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.settings-header {
  flex-shrink: 0;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  border-bottom: 1px solid var(--outline-variant);
}

.settings-header h2 {
  margin: 0;
  font-size: 18px;
  line-height: 24px;
  font-weight: 600;
}

.close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  transition: background 0.2s ease;
}

.close-btn:hover {
  background: var(--surface-container-high);
}

.settings-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin-top: 8px;
}

.settings-body input,
.settings-body select {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.settings-body input:focus,
.settings-body select:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.1);
}

.action-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

.secondary-btn {
  flex: 1;
  padding: 8px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container);
  color: var(--on-surface);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.secondary-btn:hover {
  background: var(--surface-container-high);
}

.model-dropdown {
  position: relative;
}

.model-dropdown-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.18s ease;
}

.model-dropdown-trigger:hover {
  border-color: var(--primary);
}

.model-dropdown-value {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.model-dropdown-menu {
  position: absolute;
  z-index: 60;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 280px;
  display: flex;
  flex-direction: column;
  padding: 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  background: var(--surface-bright);
  box-shadow: var(--shadow-lg);
}

.model-dropdown-search {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
}

.model-search-icon {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.model-search-input {
  flex: 1;
  min-width: 0;
  height: 30px;
  border: none;
  background: transparent;
  font-size: 12px;
  color: var(--on-surface);
  outline: none;
}

.model-dropdown-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.model-dropdown-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 4px 4px 8px;
  border-radius: 6px;
  transition: background 0.15s ease;
}

.model-dropdown-item:hover {
  background: var(--surface-container);
}

.model-dropdown-item.active .model-dropdown-name {
  color: var(--primary);
  font-weight: 600;
}

.model-dropdown-name {
  flex: 1;
  min-width: 0;
  padding: 4px 0;
  border: none;
  background: transparent;
  font-size: 12px;
  text-align: left;
  color: var(--on-surface);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-dropdown-name:hover {
  color: var(--primary);
}

.model-dropdown-add {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease, transform 0.1s ease;
}

.model-dropdown-add:hover {
  background: var(--primary);
  color: #fff;
}

.model-dropdown-add:active {
  transform: scale(0.92);
}

.model-dropdown-add.on {
  background: var(--primary);
  color: #fff;
  opacity: 0.85;
}

.model-dropdown-add.on:hover {
  opacity: 1;
}

.model-dropdown-empty {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--on-surface-variant);
  text-align: center;
}

.status-text {
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 6px;
  margin: 4px 0 0;
}

.status-text.ok {
  background: var(--surface-container-low);
  color: var(--primary);
}

.status-text.error {
  background: var(--error-container);
  color: var(--error);
}

.save-btn {
  margin-top: auto;
  padding: 10px 14px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s ease;
}

.save-btn:hover {
  background: var(--primary-container);
}

/* Keeps the button next to the form when the provider cards follow it. */
.save-btn.inline {
  margin-top: 12px;
}

/* ---------------- provider profile cards ---------------- */

.profile-section {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--outline-variant);
}

.profile-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.profile-header .field-label {
  margin-bottom: 0;
}

.profile-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.profile-count {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.profile-empty {
  padding: 14px 12px;
  border: 1px dashed var(--outline-variant);
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--on-surface-variant);
}

.profile-card {
  margin-bottom: 10px;
  padding: 10px 12px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-container-lowest);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.profile-card.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.08);
}

.profile-card.editing {
  background: var(--surface-container-low);
}

.profile-card-head {
  display: flex;
  align-items: center;
  gap: 7px;
}

.profile-icon {
  flex-shrink: 0;
  color: var(--primary);
}

.profile-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: text;
}

.settings-body .profile-rename-input {
  flex: 1;
  min-width: 0;
  width: auto;
  padding: 3px 6px;
  border: 1px solid var(--primary);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 13px;
  font-family: inherit;
  outline: none;
}

.profile-badge {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-size: 10px;
  font-weight: 600;
}

.profile-card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}

.profile-mini-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.profile-mini-btn:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.profile-mini-btn.danger:hover {
  color: #dc2626;
}

.profile-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin: 8px 0 6px;
}

.profile-chip {
  max-width: 100%;
  padding: 2px 7px;
  border-radius: 5px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.profile-chip.subtle {
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 10px;
}

.profile-chip.accent {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-weight: 600;
}

.field-hint {
  margin: -2px 0 2px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--on-surface-variant);
}

.profile-model-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 5px;
}

.profile-model-label {
  flex-shrink: 0;
  width: 56px;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.settings-body .profile-model-select {
  flex: 1;
  min-width: 0;
  width: auto;
  padding: 4px 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 12px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
}

.settings-body .profile-model-select:focus {
  border-color: var(--primary);
  box-shadow: none;
}

.prompt-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}

.prompt-header .field-label {
  margin-bottom: 0;
}

.restore-prompt-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.restore-prompt-btn:hover {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.prompt-textarea {
  width: 100%;
  min-height: 200px;
  padding: 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 13px;
  line-height: 1.5;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  resize: vertical;
  outline: none;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.prompt-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.1);
}

.knowledge-section {
  margin-top: 12px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  overflow: hidden;
}

.knowledge-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
}

.knowledge-header .field-label {
  margin: 0;
}

.knowledge-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.auto-load-control {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
}

.auto-load-text {
  font-size: 12px;
  color: var(--on-surface-variant);
  user-select: none;
}

.knowledge-add-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.knowledge-add-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

.knowledge-list {
  padding: 8px;
  max-height: 300px;
  overflow-y: auto;
}

.knowledge-empty {
  padding: 16px;
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 12px;
}

.knowledge-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  border-radius: 6px;
  transition: background 0.2s ease;
}

.knowledge-item:hover {
  background: var(--surface-container-low);
}

.knowledge-file-info {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.knowledge-file-info svg {
  flex-shrink: 0;
  color: var(--primary);
}

.knowledge-file-name {
  font-size: 13px;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.knowledge-remove-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.2s ease, color 0.2s ease;
}

.knowledge-remove-btn:hover {
  background: var(--error-container);
  color: var(--error);
}

/* 主题色选择 */
.theme-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.theme-header .field-label {
  margin-bottom: 0;
}

.theme-current {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.theme-current-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 1px rgb(15 23 42 / 0.18);
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-top: 4px;
}

.theme-btn-wrap {
  display: flex;
  min-width: 0;
}

.theme-btn-wrap > .theme-btn {
  flex: 1;
  min-width: 0;
}

/* The picker is absolutely positioned against this zero-height anchor so it
   can overlay the rest of the panel without shifting the layout. */
.theme-picker-anchor {
  position: relative;
  height: 0;
}

.theme-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-container);
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  font-size: 12px;
  color: var(--on-surface);
}

.theme-btn:hover {
  border-color: var(--primary);
}

.theme-btn.active {
  border-color: var(--primary);
  background: var(--primary-fixed-dim);
  box-shadow: 0 0 0 2px var(--primary-fixed-dim);
}

.theme-swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  flex-shrink: 0;
  border: 1px solid var(--outline-variant);
  cursor: pointer;
  transition: transform 0.14s ease, box-shadow 0.14s ease;
}

.theme-swatch:hover {
  transform: scale(1.18);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.18);
}

.swatch-custom {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: conic-gradient(
    from 180deg,
    #ef4444,
    #f59e0b,
    #22c55e,
    #06b6d4,
    #3b82f6,
    #a855f7,
    #ef4444
  );
  color: #fff;
}

.theme-btn-custom {
  border-style: dashed;
}

.theme-label {
  font-weight: 500;
}

/* 字体选择 */
.font-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.font-select {
  width: 100%;
  padding: 9px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container-lowest);
  color: var(--on-surface);
  font-size: 13px;
  outline: none;
  transition: border-color 0.2s ease;
  max-height: 200px;
}

.font-select:focus {
  border-color: var(--primary);
}

.font-hint {
  font-size: 11px;
  color: var(--error);
  line-height: 1.4;
}

.font-error-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 4px;
}

.retry-btn {
  flex-shrink: 0;
  padding: 3px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 4px;
  background: var(--surface-container);
  color: var(--on-surface);
  font-size: 11px;
  cursor: pointer;
  transition: background 0.15s;
  font-family: inherit;
}

.retry-btn:hover {
  background: var(--surface-container-high);
}

.font-loading {
  font-size: 11px;
  color: var(--on-surface-variant);
  margin: 4px 0 0;
}

/* 向量数据设置 CSS */
.vector-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.vector-section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
  margin-bottom: 2px;
}

.vector-section-desc {
  font-size: 12px;
  color: var(--on-surface-variant);
  margin-bottom: 8px;
}

.vector-source-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.vector-source-card {
  padding: 14px 16px;
  border-radius: 10px;
  border: 1.5px solid var(--outline-variant);
  background: var(--surface-container-low);
  cursor: pointer;
  transition: all 0.2s ease;
}

.vector-source-card:hover {
  border-color: var(--primary);
  background: var(--surface-bright);
}

.vector-source-card.active {
  border-color: var(--primary);
  background: var(--surface-bright);
  box-shadow: 0 0 0 1px var(--primary);
}

.source-card-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
  margin-bottom: 2px;
}

.source-card-sub {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.builtin-models-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.builtin-model-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  transition: all 0.2s ease;
}

.builtin-model-card.enabled {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.model-card-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.model-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.model-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
}

.model-size,
.model-dim {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.model-badge {
  font-size: 10px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-fixed-dim);
  padding: 1px 6px;
  border-radius: 4px;
}

.model-status-tag {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  font-weight: 500;
  color: #10b981;
}

.model-desc {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.model-card-right {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
}

.model-clear-btn,
.model-download-btn,
.reindex-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface);
}

.model-download-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.model-clear-btn:hover {
  background: var(--error-container);
  color: var(--error);
  border-color: var(--error);
}

.reindex-btn:hover {
  background: var(--primary);
  color: #fff;
  border-color: var(--primary);
}

/* Switch Toggle */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background-color: var(--outline-variant);
  transition: .2s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .2s;
  border-radius: 50%;
}

input:checked + .toggle-slider {
  background-color: #10b981;
}

input:checked + .toggle-slider:before {
  transform: translateX(18px);
}

.vector-status-card {
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.status-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.status-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #10b981;
}

.status-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.status-details {
  font-size: 12px;
  color: var(--on-surface-variant);
  line-height: 1.5;
}

.vector-master-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-radius: 10px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
}

.vector-master-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.vector-master-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
}

.vector-master-desc {
  font-size: 12px;
  color: var(--on-surface-variant);
}

/* ---------- 阅读进度圆环：大小调整 ---------- */
.ring-size-row {
  margin-top: 8px;
  padding: 11px 14px 12px;
  border-radius: 10px;
  border: 1px solid var(--outline-variant);
  border-top-style: dashed;
  background: var(--surface-container-low);
}

.ring-size-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 8px;
}

.ring-size-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.ring-size-value {
  font-family: var(--code-font);
  font-size: 11.5px;
  color: var(--primary);
  font-weight: 600;
}

.ring-size-slider {
  width: 100%;
  accent-color: var(--primary);
  cursor: pointer;
}

.ring-size-scale {
  display: flex;
  justify-content: space-between;
  margin-top: 5px;
  font-size: 11px;
  color: var(--on-surface-variant);
  opacity: 0.78;
}

.ring-size-actions {
  margin-top: 10px;
  padding-top: 9px;
  border-top: 1px dashed var(--outline-variant);
}

.ring-size-hint {
  margin: 9px 0 0;
  font-size: 11.5px;
  line-height: 1.5;
  color: var(--on-surface-variant);
  opacity: 0.82;
}

.ring-size-reset {
  padding: 5px 11px;
  border-radius: 7px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  font-size: 12px;
  color: var(--on-surface-variant);
}

.ring-size-reset:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.08);
}

.ring-size-reset:disabled {
  opacity: 0.5;
  cursor: default;
}

.ring-size-reset:disabled:hover {
  border-color: var(--outline-variant);
  color: var(--on-surface-variant);
  background: var(--surface-bright);
}

.vector-config-actions {
  display: flex;
  gap: 8px;
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px dashed var(--outline-variant);
}

.config-action-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface);
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.config-action-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--surface-container-low);
}

/* 快捷键设置 */
.shortcut-section {
  margin-top: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.shortcut-group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--primary);
  margin-top: 8px;
}

.shortcut-table {
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  overflow: hidden;
}

.shortcut-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--outline-variant);
  background: var(--surface-container-lowest);
}

.shortcut-row:last-child {
  border-bottom: none;
}

.shortcut-row-head {
  background: var(--surface-container-low);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--on-surface-variant);
}

.shortcut-name {
  font-size: 13px;
  color: var(--on-surface);
}

.shortcut-keys {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.shortcut-keys kbd {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-family: "JetBrains Mono", "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  line-height: 1.5;
  box-shadow: 0 1px 0 var(--outline-variant);
}

/* 关于 */
.about-card {
  padding: 16px 18px;
  border-radius: 12px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.about-logo {
  width: 64px;
  height: 64px;
  border-radius: 14px;
  object-fit: contain;
  /* 源图为 256x256，缩放到 64px 时保持锐利 */
  image-rendering: -webkit-optimize-contrast;
  user-select: none;
  -webkit-user-drag: none;
}

.about-name {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--on-surface);
}

.about-tagline {
  margin: 0;
  font-size: 13px;
  color: var(--primary);
  line-height: 1.5;
}

.about-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.7;
  color: var(--on-surface-variant);
}

.about-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.about-row-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.about-row-value {
  font-size: 13px;
  color: var(--on-surface);
}

.about-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--primary);
}

/* 内容上色样式 */

/* 方案横向标签：方案一 / 方案二 … */
.content-color-tabs {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 14px;
}

.content-color-tab-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-container);
  overflow: hidden;
  transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
}

.content-color-tab-wrap:hover {
  border-color: var(--primary);
}

.content-color-tab-wrap.active {
  background: var(--primary);
  border-color: var(--primary);
}

.content-color-tab {
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
}

.content-color-tab-wrap.active .content-color-tab {
  color: var(--on-primary, #fff);
}

.content-color-tab-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: stretch;
  padding: 0 6px;
  border: none;
  border-left: 1px solid rgb(var(--primary-rgb, 67 88 140) / 0.25);
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: color 0.12s ease;
}

.content-color-tab-wrap.active .content-color-tab-del {
  color: var(--on-primary, #fff);
  border-left-color: rgb(255 255 255 / 0.35);
}

.content-color-tab-del:hover {
  color: var(--primary);
}

.content-color-tab-wrap.active .content-color-tab-del:hover {
  color: #fff;
  background: rgb(255 255 255 / 0.16);
}

/* 方案计数：n / 5，满额时转为强调色提醒该删一套了。 */
.content-color-tab-count {
  margin-left: 2px;
  font-size: 11px;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.content-color-tab-count.full {
  color: var(--error);
  font-weight: 600;
}

.content-color-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  margin-top: 10px;
}

.content-color-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background: var(--surface-container);
  gap: 10px;
}

.content-color-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.content-color-dot {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid var(--outline-variant);
  flex-shrink: 0;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.content-color-dot:hover {
  transform: scale(1.18);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb, 67 88 140) / 0.18);
}

.content-color-name {
  /* 名称必须始终完整呈现：不允许被 flex 压缩或截断。 */
  flex: 1 0 auto;
  min-width: 4.5em;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
  white-space: nowrap;
  overflow: visible;
  text-overflow: clip;
}

/* 收窄色值输入框，给色点和名称留足空间，保证颜色圆点完整呈现。
   需带 .settings-body 前缀压过上方「.settings-body input { width: 100% }」的通用规则。 */
.settings-body .content-color-hex-input {
  width: 72px;
  flex: 0 0 auto;
  padding: 4px 6px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface);
  color: var(--on-surface);
  font-family: "JetBrains Mono", Consolas, monospace;
  font-size: 11px;
  text-align: center;
}

.settings-body .content-color-hex-input:focus {
  border-color: var(--primary);
  outline: none;
}

.color-picker-hidden {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
  pointer-events: none;
}

.content-color-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

/* ---------------- 方案预览样张 ----------------
   .markdown-body / .reading-view / .content-colored 的规则都在全局 style.css 里，
   scoped 样式不会命中它们，这里只负责样张的外框与尺寸收敛：
   字号压到 12px（em 制的标题层级会跟着整体缩小），高度封顶后可滚动，
   免得样张把「恢复默认 / 保存方案」两个按钮挤出可视区。 */
.scheme-preview {
  margin-top: 14px;
}

.scheme-preview-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.scheme-preview-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface);
}

.scheme-preview-hint {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.scheme-preview-paper {
  max-height: 260px;
  overflow-y: auto;
  padding: 14px 16px;
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  background: var(--reading-surface);
  /* 样张里的标题按 em 逐级放大，基准压小一档才不会一行占满整块。 */
  font-size: 12px;
}

/* 「恢复默认 / 保存方案」按钮：全局 button 是无样式重置，这里补出实体按钮外观，
   保存动作看得见、点得准（点击结果另有状态条 + 全局 Toast 双重回执）。 */
.content-color-actions .btn {
  padding: 8px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
}

.content-color-actions .btn-secondary {
  border-color: var(--outline-variant);
  background: var(--surface-container);
  color: var(--on-surface);
}

.content-color-actions .btn-secondary:hover {
  background: var(--surface-container-high);
}

.content-color-actions .btn-primary {
  background: var(--primary);
  color: #fff;
}

.content-color-actions .btn-primary:hover {
  background: var(--primary-container);
}

.about-link:hover {
  text-decoration: underline;
}
</style>