import { reactive } from "vue";
import { CHAT_AGENT_PROMPT } from "./prompts/chatAgent";
import { WRITER_AGENT_PROMPT } from "./prompts/writerAgent";
import { AUDITOR_AGENT_PROMPT } from "./prompts/auditorAgent";
import { REFINE_AGENT_PROMPT } from "./prompts/refineAgent";
import {
  BUNDLED_AUDITOR_KNOWLEDGE,
  BUNDLED_CHAT_KNOWLEDGE,
  BUNDLED_WRITER_KNOWLEDGE,
} from "./prompts/knowledgeDefaults";

const providerUrls: Record<string, string> = {
  OpenAI: "https://api.openai.com/v1",
  Anthropic: "https://api.anthropic.com/v1",
  DeepSeek: "https://api.deepseek.com/v1",
  Google: "https://generativelanguage.googleapis.com/v1beta",
  AgentRouter: "https://agentrouter.org/v1",
  OpenRouter: "https://openrouter.ai/api/v1",
  OpenAICompatible: "",
};

/**
 * Wire protocol used to talk to the endpoint.
 *
 * Kept separate from `provider` because the two are genuinely independent: a
 * relay may speak the OpenAI Completions protocol while serving Claude models,
 * and OpenAI itself now offers two different shapes.
 */
export type ApiType =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages"
  | "google-generative";

export const apiTypeOptions: { id: ApiType; label: string; desc: string }[] = [
  {
    id: "openai-completions",
    label: "OpenAI Completions",
    desc: "POST /chat/completions · 兼容 DeepSeek、vLLM、Ollama 及绝大多数中转",
  },
  {
    id: "openai-responses",
    label: "OpenAI Responses",
    desc: "POST /responses · OpenAI 新版接口",
  },
  {
    id: "anthropic-messages",
    label: "Anthropic Messages",
    desc: "POST /messages · Claude 原生接口",
  },
  {
    id: "google-generative",
    label: "Google Generative AI",
    desc: "POST /models/{model}:generateContent · Gemini 原生接口",
  },
];

/** Protocol each provider speaks by default. */
const providerApiTypes: Record<string, ApiType> = {
  OpenAI: "openai-completions",
  Anthropic: "anthropic-messages",
  DeepSeek: "openai-completions",
  Google: "google-generative",
  AgentRouter: "openai-completions",
  OpenRouter: "openai-completions",
  OpenAICompatible: "openai-completions",
};

export function defaultApiTypeFor(provider: string): ApiType {
  return providerApiTypes[provider] ?? "openai-completions";
}

export function apiTypeLabel(apiType: ApiType): string {
  return apiTypeOptions.find((o) => o.id === apiType)?.label ?? apiType;
}

export interface KnowledgeFile {
  id: string;
  name: string;
  content: string;
  path?: string;
}

/**
 * A saved API provider configuration.
 *
 * The AI接口设置 tab edits the "draft" fields on `aiSettings` directly; hitting
 * 保存配置 materializes them into one of these cards so several providers can
 * live side by side and be switched with one click.
 */
export interface ProviderProfile {
  id: string;
  label: string;
  provider: string;
  apiType: ApiType;
  apiKey: string;
  url: string;
  model: string;
  auditorModel: string;
  models: string[];
  /** Custom display name for OpenAICompatible-style providers. */
  name?: string;
  createdAt: number;
}

export interface ThemeSettings {
  primary: string;
  primaryContainer: string;
  primaryFixedDim: string;
}

export const defaultTheme: ThemeSettings = {
  primary: "#43588c",
  /* Kept identical to deriveTheme("#43588c") so picking this colour in the
     custom palette produces exactly the same ramp as the preset. */
  primaryContainer: "#5b74b1",
  primaryFixedDim: "#dfe3ef",
};

/** 内容上色方案（方案一为当前默认 / 保存修改后自动生成方案二）。 */
export interface ContentColorScheme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

/** 内容上色方案数量上限：连默认的「方案一」一起，最多五套。 */
export const MAX_CONTENT_COLOR_SCHEMES = 5;

/** 方案名按序号取用（第 n 套即 CONTENT_COLOR_SCHEME_NAMES[n - 1]）。 */
export const CONTENT_COLOR_SCHEME_NAMES = [
  "方案一",
  "方案二",
  "方案三",
  "方案四",
  "方案五",
];

export const themeOptions: { label: string; theme: ThemeSettings }[] = [
  { label: "经典蓝", theme: { primary: "#43588c", primaryContainer: "#5b74b1", primaryFixedDim: "#dfe3ef" } },
  { label: "翡翠绿", theme: { primary: "#047857", primaryContainer: "#059669", primaryFixedDim: "#d1fae5" } },
  { label: "罗兰紫", theme: { primary: "#6d28d9", primaryContainer: "#7c3aed", primaryFixedDim: "#ede9fe" } },
  { label: "朱砂红", theme: { primary: "#b91c1c", primaryContainer: "#dc2626", primaryFixedDim: "#fee2e2" } },
  { label: "琥珀橙", theme: { primary: "#c2410c", primaryContainer: "#ea580c", primaryFixedDim: "#ffedd5" } },
  { label: "墨玉黑", theme: { primary: "#1e293b", primaryContainer: "#334155", primaryFixedDim: "#e2e8f0" } },
];

export const fontOptions = [
  "Inter",
  "Noto Sans SC",
  "PingFang SC",
  "Microsoft YaHei",
  "Source Han Serif SC",
  "JetBrains Mono",
  "Cascadia Code",
  "Consolas",
  "system-ui",
  "sans-serif",
  "serif",
  "monospace",
];

export const DEFAULT_APP_FONT = "Microsoft YaHei";
export const DEFAULT_EDITOR_FONT_SIZE = 16;
export const DEFAULT_EDITOR_LINE_HEIGHT = 1.75;
export const DEFAULT_EDITOR_MARGIN_X = 22;
export const DEFAULT_EDITOR_MARGIN_Y = 26;

/** 编辑区可选字号（px）。所有编辑区共用一份，保证各处一致。 */
export const EDITOR_FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24];

export function clampEditorFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_EDITOR_FONT_SIZE;
  const min = EDITOR_FONT_SIZES[0];
  const max = EDITOR_FONT_SIZES[EDITOR_FONT_SIZES.length - 1];
  return Math.min(max, Math.max(min, Math.round(size)));
}

export function clampEditorLineHeight(lh: number): number {
  if (!Number.isFinite(lh)) return DEFAULT_EDITOR_LINE_HEIGHT;
  return Math.min(3, Math.max(1, Math.round(lh * 100) / 100));
}

export function clampEditorMarginX(mx: number): number {
  if (!Number.isFinite(mx)) return DEFAULT_EDITOR_MARGIN_X;
  return Math.min(200, Math.max(0, Math.round(mx)));
}

export function clampEditorMarginY(my: number): number {
  if (!Number.isFinite(my)) return DEFAULT_EDITOR_MARGIN_Y;
  return Math.min(200, Math.max(0, Math.round(my)));
}

export interface BuiltinVectorModel {
  id: string;
  name: string;
  size: string;
  dimension: number;
  recommended?: boolean;
  desc: string;
  downloaded: boolean;
  enabled: boolean;
}

export const initialBuiltinVectorModels: BuiltinVectorModel[] = [
  {
    id: "all-minilm-l6-v2",
    name: "all-MiniLM-L6-v2",
    size: "~23 MB",
    dimension: 384,
    recommended: true,
    desc: "快速轻量，通用质量好 · 英文",
    downloaded: true,
    enabled: false,
  },
  {
    id: "bge-small-en-v1.5",
    name: "BGE Small EN v1.5",
    size: "~33 MB",
    dimension: 384,
    recommended: false,
    desc: "高质量英文嵌入 · 英文",
    downloaded: false,
    enabled: false,
  },
  {
    id: "bge-small-zh-v1.5",
    name: "BGE Small ZH v1.5",
    size: "~24 MB",
    dimension: 512,
    recommended: true,
    desc: "高质量中文嵌入 · 中文",
    downloaded: true,
    enabled: true,
  },
  {
    id: "multilingual-e5-small",
    name: "Multilingual E5 Small",
    size: "~118 MB",
    dimension: 384,
    recommended: false,
    desc: "多语言支持，综合性能好 · 100+ 语言",
    downloaded: false,
    enabled: false,
  },
];

export type EditorGridLine = "none" | "solid" | "dashed" | "dotted";

export const aiSettings = reactive({
  provider: "OpenAI",
  apiType: "openai-completions" as ApiType,
  apiKey: "",
  url: "https://api.openai.com/v1",
  model: "",
  auditorModel: "",
  /* Enabled models shown in the various model dropdowns (added via 「+」). */
  models: [] as string[],
  /* Full model pool fetched from the endpoint (drives the settings dropdown). */
  availableModels: [] as string[],
  /* Custom name for OpenAICompatible-style providers so they stay distinguishable. */
  providerName: "",
  /* Saved provider cards + which one is currently live. */
  providerProfiles: [] as ProviderProfile[],
  activeProfileId: "" as string,
  writerPrompt: WRITER_AGENT_PROMPT,
  auditorPrompt: AUDITOR_AGENT_PROMPT,
  refinePrompt: REFINE_AGENT_PROMPT,
  /* 「对话」标签页的提示词与知识项（设置面板 → 对话 选项卡）。 */
  chatPrompt: CHAT_AGENT_PROMPT,
  chatKnowledge: [] as KnowledgeFile[],
  chatKnowledgeAutoLoad: true,
  writerKnowledge: [] as KnowledgeFile[],
  auditorKnowledge: [] as KnowledgeFile[],
  writerKnowledgeAutoLoad: true,
  auditorKnowledgeAutoLoad: true,
  /* Web Search & Thinking Level Settings */
  webSearchEnabled: false,
  webSearchEngine: "bing" as "bing" | "google",
  thinkingLevel: "auto" as "off" | "auto" | "standard",
  theme: { ...defaultTheme } as ThemeSettings,
  appFont: DEFAULT_APP_FONT,
  /* 编辑区字号（px）。文档编辑器 / 画布卡片 / 拼文预览 / 拼文对比 共用同一个值，
     否则「拼文预览」与「拼文对比」两边字号会各自为政、对不上。区间见 EDITOR_FONT_SIZES。 */
  editorFontSize: DEFAULT_EDITOR_FONT_SIZE,
  /* 排版参数：行间距、水平边距（px）、垂直边距（px）、背景网格线。 */
  editorLineHeight: DEFAULT_EDITOR_LINE_HEIGHT,
  editorMarginX: DEFAULT_EDITOR_MARGIN_X,
  editorMarginY: DEFAULT_EDITOR_MARGIN_Y,
  editorGridLine: "none" as EditorGridLine,
  /* 选中文字浮现工具栏开关（默认开启，可在设置→配置中关闭）。 */
  selectionToolbarEnabled: true,
  /* 修订与批注（图层式修订）开关（默认开启，可在设置→配置中关闭）。
     关闭后不再能新建图层、右键菜单与快捷键一并隐去，已存的图层也不参与
     预览合成与编辑区着色——数据本身保留，重新开启即原样回来。 */
  revisionAnnotationEnabled: true,
  /* 素材库 / 故事定制 / 叙事定制 全局开关（默认开启，可在设置→配置中关闭）。 */
  materialLibraryEnabled: true,
  storyCraftEnabled: true,
  narrativeCraftEnabled: true,
  /* 阅读进度圆环：开关 + 直径（px）+ 不透明度（%）。区间见 readingRingStore 的
     RING_SIZE_* / RING_OPACITY_*，默认 34px、100%（即原设计的玻璃透明度）。 */
  readingRingEnabled: true,
  readingRingSize: 34,
  readingRingOpacity: 100,
  /* 段落聚光灯：朦胧虚化程度（px）+ 非聚光段落不透明度（%）。
     默认 1.5px / 40%（比原本更软、读写更舒适，可在设置→配置中自由调节）。 */
  spotlightBlur: 1.5,
  spotlightOpacity: 40,
  /* 行首缩进 & 首字下沉 开关（仅对纯文本正文有效，可在设置→配置中切换） */
  firstLineIndent: false,
  dropCap: false,
  /* 内容上色方案集：「方案一」为默认底本，保存修改后另存为下一套（方案二 … 方案五），
     横向标签切换，最多共 MAX_CONTENT_COLOR_SCHEMES 套。 */
  contentColorSchemes: [] as ContentColorScheme[],
  /* 当前生效的内容上色自定义方案 */
  contentColorScheme: {} as Record<string, string>,
  /* Vector Data Settings */
  vectorEnabled: true,
  vectorSource: "local" as "local" | "remote",
  builtinVectorModels: reactive([...initialBuiltinVectorModels]),
  activeVectorModel: "bge-small-zh-v1.5",
  remoteEmbeddingUrl: "https://api.openai.com/v1/embeddings",
  remoteEmbeddingKey: "",
  remoteEmbeddingModel: "text-embedding-3-small",
});

export function applyProvider(provider: string) {
  /* 不预置任何占位模型：模型列表只来自用户「获取模型」后得到的真实模型。 */
  aiSettings.availableModels = [];
  aiSettings.models = [];
  aiSettings.model = "";
  aiSettings.auditorModel = "";
  aiSettings.url = providerUrls[provider] ?? "";
  aiSettings.apiType = defaultApiTypeFor(provider);
  aiSettings.providerName = "";
}

/* ---------------- colour utilities ---------------- */

/** Expand `#abc` / `abc` to a 6-digit lowercase `#aabbcc`, or null if invalid. */
export function normalizeHex(hex: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let body = m[1].toLowerCase();
  if (body.length === 3) {
    body = body
      .split("")
      .map((c) => c + c)
      .join("");
  }
  return `#${body}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const n = Number.parseInt(normalized.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** "#43588c" -> "67 88 140" for use in rgb(var(--primary-rgb) / alpha). */
function hexToRgbChannels(hex: string): string | null {
  const rgb = hexToRgb(hex);
  return rgb ? `${rgb.r} ${rgb.g} ${rgb.b}` : null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${((1 << 24) | (clamp(r) << 16) | (clamp(g) << 8) | clamp(b)).toString(16).slice(1)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l };

  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s, l };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sat = Math.max(0, Math.min(1, s));
  const lum = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));

  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  const m = lum - c / 2;
  return rgbToHex((rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255);
}

/**
 * Build a complete theme from a single primary colour.
 *
 * `primaryContainer` is a visibly different sibling used for hovers/accents and
 * `primaryFixedDim` a light wash used for chips and selection fills. Both stay
 * on the primary's hue so any custom pick remains internally consistent.
 */
export function deriveTheme(primary: string): ThemeSettings {
  const normalized = normalizeHex(primary) ?? defaultTheme.primary;
  const hsl = hexToHsl(normalized);
  if (!hsl) return { ...defaultTheme };

  /* A grey pick must stay grey — never inject a hue into an achromatic colour. */
  const sat = hsl.s < 0.04 ? 0 : Math.max(0.12, hsl.s);

  /* Lighten dark primaries, darken light ones, so the container always reads as
     a distinct hover/accent rather than collapsing into the primary. */
  const containerL =
    hsl.l <= 0.5 ? Math.min(0.66, hsl.l + 0.12) : Math.max(0.3, hsl.l - 0.12);

  /* The wash must stay light regardless of how light the primary already is. */
  const dimL = Math.min(0.96, Math.max(0.88, hsl.l + 0.5));

  return {
    primary: normalized,
    primaryContainer: hslToHex(hsl.h, sat, containerL),
    primaryFixedDim: hslToHex(hsl.h, sat === 0 ? 0 : Math.min(0.45, sat), dimL),
  };
}

export function applyTheme(theme: ThemeSettings) {
  const root = document.documentElement;
  root.style.setProperty("--primary", theme.primary);
  root.style.setProperty("--primary-container", theme.primaryContainer);
  root.style.setProperty("--primary-fixed-dim", theme.primaryFixedDim);
  /* Keep the channel triplet in sync so every translucent primary tint
     (focus rings, selection washes, hover fills) tracks the theme. */
  const channels = hexToRgbChannels(theme.primary);
  if (channels) root.style.setProperty("--primary-rgb", channels);
  aiSettings.theme = { ...theme };
}

/** Apply an arbitrary primary colour, deriving the rest of the ramp. */
export function applyPrimaryColor(primary: string): boolean {
  const normalized = normalizeHex(primary);
  if (!normalized) return false;
  applyTheme(deriveTheme(normalized));
  return true;
}

export function resetTheme() {
  applyTheme({ ...defaultTheme });
}

export function applyFont(font: string) {
  /* Keep a fallback chain so missing glyphs (esp. CJK) still render. */
  const stack = `"${font}", "Inter", "Segoe UI", "PingFang SC", system-ui, sans-serif`;
  document.documentElement.style.setProperty("--app-font", stack);
  aiSettings.appFont = font;
}

/* ---------------- provider profiles ---------------- */

export const PROVIDER_LABELS: Record<string, string> = {
  OpenAI: "OpenAI",
  Anthropic: "Anthropic",
  DeepSeek: "DeepSeek",
  Google: "Google Gemini",
  AgentRouter: "Agent Router",
  OpenRouter: "OpenRouter",
  OpenAICompatible: "OpenAI 兼容 / 中转",
};

export function providerLabel(provider: string, customName?: string): string {
  if (customName && customName.trim()) return customName.trim();
  return PROVIDER_LABELS[provider] ?? provider;
}

/** `sk-abcd…wxyz` — never show a full key back to the user. */
export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return "未填写";
  if (trimmed.length <= 10) return `${trimmed.slice(0, 3)}${"*".repeat(Math.max(3, trimmed.length - 3))}`;
  return `${trimmed.slice(0, 6)}${"*".repeat(6)}${trimmed.slice(-4)}`;
}

function defaultProfileLabel(provider: string, model: string): string {
  return `${providerLabel(provider, aiSettings.providerName)} · ${model || "未选择模型"}`;
}

/** Snapshot of the fields currently being edited in the API settings tab. */
function draftProfile(): Omit<ProviderProfile, "id" | "createdAt"> {
  return {
    label: defaultProfileLabel(aiSettings.provider, aiSettings.model),
    provider: aiSettings.provider,
    apiType: aiSettings.apiType,
    apiKey: aiSettings.apiKey,
    url: aiSettings.url,
    model: aiSettings.model,
    auditorModel: aiSettings.auditorModel,
    models: [...aiSettings.models],
    name: aiSettings.providerName.trim() || undefined,
  };
}

/**
 * Persist the current draft as a card.
 *
 * When `id` is supplied (or an identical card already exists) that card is
 * updated in place instead of duplicated. "Identical" deliberately includes the
 * API key so two accounts on the same provider/model can coexist.
 */
export function saveProviderProfile(id?: string): ProviderProfile {
  const draft = draftProfile();

  const existing =
    (id ? aiSettings.providerProfiles.find((p) => p.id === id) : undefined) ??
    aiSettings.providerProfiles.find(
      (p) =>
        p.provider === draft.provider &&
        p.url === draft.url &&
        p.model === draft.model &&
        p.apiKey === draft.apiKey,
    );

  if (existing) {
    const keepCustomLabel = existing.label && existing.label !== defaultProfileLabel(existing.provider, existing.model);
    Object.assign(existing, draft, { label: keepCustomLabel ? existing.label : draft.label });
    aiSettings.activeProfileId = existing.id;
    return existing;
  }

  const profile: ProviderProfile = {
    ...draft,
    id: `prof_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  aiSettings.providerProfiles.push(profile);
  aiSettings.activeProfileId = profile.id;
  return profile;
}

/** Load a saved card into the live settings (and into the editor fields). */
export function activateProviderProfile(id: string): boolean {
  const profile = aiSettings.providerProfiles.find((p) => p.id === id);
  if (!profile) return false;

  aiSettings.provider = profile.provider;
  aiSettings.apiType = profile.apiType ?? defaultApiTypeFor(profile.provider);
  aiSettings.apiKey = profile.apiKey;
  aiSettings.url = profile.url;
  const checked = profile.models.length > 0 ? [...profile.models] : [];
  aiSettings.models = checked;
  aiSettings.availableModels = [...checked];
  aiSettings.providerName = profile.name ?? "";
  aiSettings.model = profile.model;
  aiSettings.auditorModel = profile.auditorModel || profile.model;
  aiSettings.activeProfileId = profile.id;
  return true;
}

export function removeProviderProfile(id: string): void {
  const index = aiSettings.providerProfiles.findIndex((p) => p.id === id);
  if (index === -1) return;
  aiSettings.providerProfiles.splice(index, 1);
  if (aiSettings.activeProfileId === id) {
    aiSettings.activeProfileId = aiSettings.providerProfiles[0]?.id ?? "";
  }
}

export function renameProviderProfile(id: string, label: string): void {
  const profile = aiSettings.providerProfiles.find((p) => p.id === id);
  if (profile && label.trim()) profile.label = label.trim();
}

/** Set the model a saved card should use, without switching to it. */
export function setProfileModel(id: string, model: string, which: "model" | "auditorModel" = "model"): void {
  const profile = aiSettings.providerProfiles.find((p) => p.id === id);
  if (!profile) return;
  profile[which] = model;
  if (aiSettings.activeProfileId === id) {
    aiSettings[which] = model;
  }
}

/** 知识项作用域：对应设置面板里带知识项的选项卡。 */
export type KnowledgeType = "chat" | "writer" | "auditor";

/**
 * Bring the knowledge list in sync with the auto-load flag.
 * When enabled, any missing bundled default is re-added; when disabled,
 * bundled defaults are removed from the list (user-imported files stay).
 */
export function applyKnowledgeAutoLoad(type: KnowledgeType) {
  const enabled =
    type === "chat"
      ? aiSettings.chatKnowledgeAutoLoad
      : type === "writer"
      ? aiSettings.writerKnowledgeAutoLoad
      : aiSettings.auditorKnowledgeAutoLoad;
  const list =
    type === "chat"
      ? aiSettings.chatKnowledge
      : type === "writer"
      ? aiSettings.writerKnowledge
      : aiSettings.auditorKnowledge;
  const defaults =
    type === "chat"
      ? BUNDLED_CHAT_KNOWLEDGE
      : type === "writer"
      ? BUNDLED_WRITER_KNOWLEDGE
      : BUNDLED_AUDITOR_KNOWLEDGE;
  const defaultIds = new Set(defaults.map((k) => k.id));

  if (enabled) {
    for (const d of defaults) {
      if (!list.some((k) => k.id === d.id)) {
        list.push({ ...d });
      }
    }
  } else {
    for (let i = list.length - 1; i >= 0; i--) {
      if (defaultIds.has(list[i].id)) {
        list.splice(i, 1);
      }
    }
  }
}

export function setKnowledgeAutoLoad(type: KnowledgeType, enabled: boolean) {
  if (type === "chat") aiSettings.chatKnowledgeAutoLoad = enabled;
  else if (type === "writer") aiSettings.writerKnowledgeAutoLoad = enabled;
  else aiSettings.auditorKnowledgeAutoLoad = enabled;
  applyKnowledgeAutoLoad(type);
}