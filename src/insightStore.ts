import { reactive } from "vue";
import {
  buildAvoidedWords,
  buildEditingHabits,
  buildHighFreqWords,
  buildParagraphHabits,
  buildPhrasingHabits,
  buildPrefStats,
  buildStyleMeters,
  buildStyleTags,
  collectCorpus,
  collectEditPairs,
  computeCorpusMetrics,
  computeRemovedPhrases,
  type CorpusMetrics,
} from "./insightAnalysis";

export interface SuggestionItem {
  id: string;
  habitLabel: string;
  habitDesc: string;
  suggestion: string;
  habitStrength: number;
  originalText: string;
  accepted: boolean;
  dismissed: boolean;
}

export interface ToastState {
  visible: boolean;
  title: string;
  desc: string;
  icon: "habit" | "edit" | "style";
  timeout: number | null;
}

export interface HabitItem {
  id: string;
  tag: string;
  tagType: "style" | "word" | "structure" | "tone" | "edit";
  title: string;
  desc: string;
  examples: string[];
  strength: number;
  confidence?: number;
  sampleCount?: number;
  hitRate?: string;
}

export interface HistoryItem {
  id: string;
  type: "vocab" | "delete" | "append" | "style" | "metaphor" | "paragraph";
  typeLabel: string;
  typeColor: string;
  before: string;
  after: string;
  /** Epoch ms — rendered as a relative label so it stays accurate. */
  at: number;
  note?: string;
  source?: "refine" | "editor" | "ai";
}

export interface StyleMeter {
  label: string;
  value: string;
  fillPercent: number;
  fillGradient: string;
  leftLabel: string;
  rightLabel: string;
}

export interface WordFreq {
  word: string;
  freq: "high" | "mid" | "low";
}

export interface PrefStat {
  value: string;
  label: string;
  color: string;
}

export interface ModStat {
  count: number;
  label: string;
}

export interface InsightState {
  toast: ToastState;
  suggestions: SuggestionItem[];
  habits: {
    phrasing: HabitItem[];
    paragraph: HabitItem[];
    editing: HabitItem[];
    toggles: { label: string; desc: string; on: boolean }[];
  };
  history: {
    items: HistoryItem[];
    stats: ModStat[];
  };
  profile: {
    meters: StyleMeter[];
    highFreq: WordFreq[];
    avoided: WordFreq[];
    prefs: PrefStat[];
    tags: string[];
  };
  /** Corpus scale behind the current analysis; drives the empty states. */
  analysis: {
    sampleCount: number;
    sentenceCount: number;
    paragraphCount: number;
    totalChars: number;
    editPairCount: number;
    lastRunAt: number;
    /** False until enough material exists to say anything meaningful. */
    hasData: boolean;
  };
  activeTab: "habits" | "history" | "profile";
}

/**
 * The store starts completely empty on purpose. Every number and every phrase
 * shown in 洞察 comes from `refreshInsights()`, which reads the user's real
 * documents, cards and 精修 history.
 */
export const insightStore = reactive<InsightState>({
  activeTab: "habits",
  toast: {
    visible: false,
    title: "",
    desc: "",
    icon: "habit",
    timeout: null,
  },
  suggestions: [],

  habits: {
    phrasing: [],
    paragraph: [],
    editing: [],
    toggles: [
      { label: "续写时应用遣词习惯", desc: "生成文本时复用你的比喻风格和句式偏好", on: true },
      { label: "润色时保留个人语气", desc: "修改措辞但不改变你的叙事视角和情感克制度", on: true },
      { label: "段落结构自动适配", desc: "控制生成段落的长度和节奏与你的习惯一致", on: true },
      { label: "自动剔除常删除的词", desc: "生成时主动避免使用你反复删除过的表达方式", on: false },
    ],
  },

  history: {
    items: [],
    stats: [],
  },

  profile: {
    meters: [],
    highFreq: [],
    avoided: [],
    prefs: [],
    tags: [],
  },

  analysis: {
    sampleCount: 0,
    sentenceCount: 0,
    paragraphCount: 0,
    totalChars: 0,
    editPairCount: 0,
    lastRunAt: 0,
    hasData: false,
  },
});

/* ---------------- toast ---------------- */

let toastTimer: number | null = null;

export function showToast(title: string, desc: string, icon: ToastState["icon"] = "habit") {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  insightStore.toast.visible = true;
  insightStore.toast.title = title;
  insightStore.toast.desc = desc;
  insightStore.toast.icon = icon;
  toastTimer = window.setTimeout(() => {
    insightStore.toast.visible = false;
    toastTimer = null;
  }, 5000);
}

export function dismissToast() {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  insightStore.toast.visible = false;
}

/* ---------------- modification memory ---------------- */

const HISTORY_TYPE_CONFIG: Record<HistoryItem["type"], { label: string; color: string }> = {
  vocab: { label: "词汇替换", color: "var(--primary)" },
  delete: { label: "删除冗词", color: "var(--error)" },
  append: { label: "增补细节", color: "var(--primary)" },
  style: { label: "句式调整", color: "var(--secondary)" },
  metaphor: { label: "比喻替换", color: "var(--primary)" },
  paragraph: { label: "删除段落", color: "var(--error)" },
};

const MAX_HISTORY = 200;

/** Classify a real before/after pair so the record carries an accurate label. */
export function classifyEdit(before: string, after: string): HistoryItem["type"] {
  const b = before.replace(/\s+/g, "");
  const a = after.replace(/\s+/g, "");
  if (!a) return "paragraph";
  if (/[像如仿佛好似宛如犹如]/.test(a) && !/[像如仿佛好似宛如犹如]/.test(b)) return "metaphor";
  if (a.length > b.length * 1.25) return "append";
  if (a.length < b.length * 0.75) return "delete";
  /* Same length band: decide between wording and structure by punctuation churn. */
  const bPunct = (b.match(/[，。；：、！？]/g) ?? []).length;
  const aPunct = (a.match(/[，。；：、！？]/g) ?? []).length;
  return Math.abs(aPunct - bPunct) >= 2 ? "style" : "vocab";
}

export function relativeTime(at: number): string {
  const diff = Date.now() - at;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 2_592_000_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return new Date(at).toLocaleDateString("zh-CN");
}

function recomputeHistoryStats() {
  const buckets: Record<string, number> = {};
  for (const item of insightStore.history.items) {
    buckets[item.type] = (buckets[item.type] ?? 0) + 1;
  }
  insightStore.history.stats = (Object.keys(HISTORY_TYPE_CONFIG) as HistoryItem["type"][])
    .filter((type) => buckets[type] > 0)
    .map((type) => ({ count: buckets[type], label: HISTORY_TYPE_CONFIG[type].label }));
}

/**
 * Record a real edit. `type` is inferred from the text when omitted so callers
 * cannot mislabel it.
 */
export function trackModification(
  before: string,
  after: string,
  type?: HistoryItem["type"],
  options?: { note?: string; source?: HistoryItem["source"]; at?: number; id?: string },
) {
  const trimmedBefore = before.trim();
  const trimmedAfter = after.trim();
  if (!trimmedBefore && !trimmedAfter) return;
  if (trimmedBefore === trimmedAfter) return;

  /* 一模一样的内容不重复入库：同一对「原文→修改后」只保留一条记录，
     避免重复操作面对同一内容产生重复统计。 */
  if (
    insightStore.history.items.some(
      (h) => h.before === trimmedBefore.slice(0, 300) && h.after === trimmedAfter.slice(0, 300),
    )
  ) {
    return;
  }

  const resolved = type ?? classifyEdit(trimmedBefore, trimmedAfter);
  const cfg = HISTORY_TYPE_CONFIG[resolved];
  const id = options?.id ?? `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  if (insightStore.history.items.some((h) => h.id === id)) return;

  insightStore.history.items.unshift({
    id,
    type: resolved,
    typeLabel: cfg.label,
    typeColor: cfg.color,
    before: trimmedBefore.slice(0, 300),
    after: trimmedAfter.slice(0, 300),
    at: options?.at ?? Date.now(),
    note: options?.note,
    source: options?.source ?? "editor",
  });

  if (insightStore.history.items.length > MAX_HISTORY) {
    insightStore.history.items.length = MAX_HISTORY;
  }
  recomputeHistoryStats();
}

export function clearModificationHistory() {
  insightStore.history.items = [];
  insightStore.history.stats = [];
}

/** Pull every before/after pair produced by 精修 into the modification memory. */
function importRefineHistory(): number {
  const pairs = collectEditPairs();

  /* 每次全套重建来自精修的记录：精修历史中的 content 会随用户「接受/拒绝」
     决定实时变化，旧的记录（含被拒绝的内容）不能残留重复统计。 */
  insightStore.history.items = insightStore.history.items.filter(
    (h) => !h.id.startsWith("refine_"),
  );

  const seen = new Set<string>();
  let added = 0;

  for (const [index, pair] of pairs.entries()) {
    const id = `refine_${pair.title}_${index}_${pair.before.slice(0, 12)}`;
    const key = `${pair.before}\u0000${pair.after}`;
    /* 一模一样的内容只统计一次。 */
    if (seen.has(key)) continue;
    seen.add(key);
    const type = classifyEdit(pair.before, pair.after);
    const cfg = HISTORY_TYPE_CONFIG[type];
    insightStore.history.items.push({
      id,
      type,
      typeLabel: cfg.label,
      typeColor: cfg.color,
      before: pair.before.slice(0, 300),
      after: pair.after.slice(0, 300),
      at: Date.parse(pair.time) || Date.now(),
      source: "refine",
    });
    added++;
  }

  if (added > 0) {
    insightStore.history.items.sort((a, b) => b.at - a.at);
    if (insightStore.history.items.length > MAX_HISTORY) {
      insightStore.history.items.length = MAX_HISTORY;
    }
  }
  return added;
}

/* ---------------- suggestions ---------------- */

export function dismissSuggestion(id: string) {
  const idx = insightStore.suggestions.findIndex((s) => s.id === id);
  if (idx !== -1) insightStore.suggestions.splice(idx, 1);
}

/* ---------------- analysis pipeline ---------------- */

let lastFingerprint = "";

/** Cheap change detector so we don't re-analyse on every keystroke. */
function corpusFingerprint(): string {
  const docs = collectCorpus();
  return [
    docs.length,
    docs.reduce((sum, d) => sum + d.text.length, 0),
    insightStore.history.items.length,
  ].join(":");
}

/**
 * Recompute every habit / profile figure from the user's real writing.
 * Returns true when something was recomputed.
 */
export function refreshInsights(force = false): boolean {
  importRefineHistory();

  const fingerprint = corpusFingerprint();
  if (!force && fingerprint === lastFingerprint) return false;
  lastFingerprint = fingerprint;

  const samples = collectCorpus();
  const metrics: CorpusMetrics | null = computeCorpusMetrics(samples);
  const pairs = collectEditPairs();
  const removed = computeRemovedPhrases(pairs);

  if (!metrics) {
    insightStore.habits.phrasing = [];
    insightStore.habits.paragraph = [];
    insightStore.habits.editing = buildEditingHabits(pairs, removed);
    insightStore.profile.meters = [];
    insightStore.profile.highFreq = [];
    insightStore.profile.avoided = buildAvoidedWords(removed);
    insightStore.profile.prefs = [];
    insightStore.profile.tags = [];
    insightStore.analysis = {
      sampleCount: samples.length,
      sentenceCount: 0,
      paragraphCount: 0,
      totalChars: samples.reduce((sum, s) => sum + s.text.length, 0),
      editPairCount: pairs.length,
      lastRunAt: Date.now(),
      hasData: false,
    };
    recomputeHistoryStats();
    return true;
  }

  insightStore.habits.phrasing = buildPhrasingHabits(samples, metrics);
  insightStore.habits.paragraph = buildParagraphHabits(metrics);
  insightStore.habits.editing = buildEditingHabits(pairs, removed);

  insightStore.profile.meters = buildStyleMeters(metrics);
  insightStore.profile.highFreq = buildHighFreqWords(samples);
  insightStore.profile.avoided = buildAvoidedWords(removed);
  insightStore.profile.prefs = buildPrefStats(metrics);
  insightStore.profile.tags = buildStyleTags(metrics);

  insightStore.analysis = {
    sampleCount: metrics.sampleCount,
    sentenceCount: metrics.sentenceCount,
    paragraphCount: metrics.paragraphCount,
    totalChars: metrics.totalChars,
    editPairCount: pairs.length,
    lastRunAt: Date.now(),
    hasData: true,
  };

  recomputeHistoryStats();
  return true;
}

/* ---------------- prompt context ---------------- */

/**
 * Habit context for the AI prompt. Emits nothing when no habits have been
 * derived yet, so the model is never fed invented preferences.
 */
export function buildInsightContext(): string {
  const toggles = insightStore.habits.toggles;
  if (!toggles.some((t) => t.on)) return "";

  const parts: string[] = [];

  if (toggles[0]?.on && insightStore.habits.phrasing.length > 0) {
    parts.push("### 遣词造句偏好");
    for (const h of insightStore.habits.phrasing) {
      parts.push(`- ${h.title}：${h.desc}`);
      if (h.examples.length) parts.push(`  实际样例：${h.examples[0]}`);
    }
  }

  if (toggles[1]?.on && insightStore.profile.meters.length > 0) {
    parts.push("### 语气与文风特征");
    for (const m of insightStore.profile.meters) {
      parts.push(`- ${m.label}：${m.value}`);
    }
    if (insightStore.profile.tags.length > 0) {
      parts.push(`- 风格标签：${insightStore.profile.tags.join("、")}`);
    }
  }

  if (toggles[2]?.on && insightStore.habits.paragraph.length > 0) {
    parts.push("### 段落结构偏好");
    for (const h of insightStore.habits.paragraph) {
      parts.push(`- ${h.title}：${h.desc}`);
    }
  }

  if (toggles[3]?.on && insightStore.habits.editing.length > 0) {
    parts.push("### 修改倾向（应避免的表达）");
    for (const h of insightStore.habits.editing) {
      parts.push(`- ${h.desc}`);
    }
  }

  if (toggles[3]?.on && insightStore.profile.avoided.length > 0) {
    parts.push(
      `### 回避用词\n生成时应避免使用：${insightStore.profile.avoided.map((w) => `「${w.word}」`).join("、")}。`,
    );
  }

  if (parts.length === 0) return "";

  return [
    `## 用户写作习惯与风格参考（基于 ${insightStore.analysis.sentenceCount} 句 / ${insightStore.analysis.sampleCount} 份真实文本统计）`,
    ...parts,
  ].join("\n\n");
}
