import { reactive } from "vue";

/**
 * 全局 Token 用量账本。
 *
 * 项目里所有走 `runAgent` 的 AI 调用都会把本次返回的 usage 记到这里，按“来源”
 * 分桶累计，主页的 HUD 直接读它。只累计模型真实返回的 usage 字段，不做本地
 * 估算 —— 拿不到 usage 的响应记 0，宁可少算也不编数。
 *
 * 记账分两层：
 *  - 累计层（total / byCategory / calls）：终身累计，仅供 7 天图表的「累计」角标
 *    及历史参考，不再直接上 HUD 主数字；
 *  - 按日层（days）：key 为本地日期 `YYYY-MM-DD`，HUD 上的总量与各细分项都读
 *    当日桶 —— 次日零点自动起新的全 0 桶，对话 / 写作 / 审核的位数不再越滚越长。
 *
 * 数据随设置一起落库（key: `tokenUsage`），见 persistenceBootstrap。
 */

export type TokenCategory =
  /** 侧栏「对话」标签：通用问答 */
  | "chat"
  /** 侧栏「写作」Agent */
  | "writer"
  /** 侧栏「审稿」Agent */
  | "auditor"
  /** 逐句精修的改写请求 */
  | "refine"
  /** 精修前让 agent 读知识项、提炼判据清单 */
  | "knowledge"
  /** 编辑器内的润色 / 续写 / 依习惯生成 */
  | "editor";

export interface TokenCategoryMeta {
  key: TokenCategory;
  /** HUD 里显示的短标签，尽量两到四个字，保证竖排对齐好看。 */
  label: string;
  /** 悬停提示，说明这一项统计的是哪些调用。 */
  hint: string;
}

/** 展示顺序（无数据的项不会渲染）。 */
export const TOKEN_CATEGORIES: TokenCategoryMeta[] = [
  { key: "chat", label: "对话", hint: "AI 侧栏「对话」标签的通用问答" },
  { key: "writer", label: "写作", hint: "AI 侧栏「写作」Agent" },
  { key: "auditor", label: "审稿", hint: "AI 侧栏「审稿」Agent" },
  { key: "refine", label: "精修", hint: "逐句精修的改写请求" },
  { key: "knowledge", label: "知识", hint: "精修前读取知识项、提炼判据清单" },
  { key: "editor", label: "编辑器", hint: "编辑器内的润色 / 续写 / 依习惯生成" },
];

function emptyBuckets(): Record<TokenCategory, number> {
  return { chat: 0, writer: 0, auditor: 0, refine: 0, knowledge: 0, editor: 0 };
}

/** 单日用量桶。byCategory / calls 用 Partial：一天可能只跑过其中几个来源。 */
export interface DayBucket {
  total: number;
  byCategory: Partial<Record<TokenCategory, number>>;
  calls: Partial<Record<TokenCategory, number>>;
}

export const tokenStore = reactive({
  /** 终身累计 Token 总量（图表角标 / 历史参考用，不直接上 HUD 主数字）。 */
  total: 0,
  /** 各来源终身累计 Token。 */
  byCategory: emptyBuckets(),
  /** 各来源终身调用次数。 */
  calls: emptyBuckets(),
  /** 最近一次记账时间（epoch ms），0 表示从未调用过。 */
  updatedAt: 0,
  /** 按日桶：本地日期 `YYYY-MM-DD` → 当日用量。HUD 主数字与细分项都读它。 */
  days: {} as Record<string, DayBucket>,
});

/* ---------------- 按日桶 ---------------- */

/** 本地日期键 `YYYY-MM-DD`（零填充，字符串序即时间序）。 */
export function dateKeyOf(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 距今 `offset` 天的本地日期键（todayKey() 即 offset = 0）。 */
function dateKeyOffset(offset: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return dateKeyOf(d);
}

/** 保留的最长按日记录：7 天图只展示一周，多留几天填补窗口，避免换日瞬间剪影。 */
const DAYS_TO_KEEP = 14;

function emptyDay(): DayBucket {
  return { total: 0, byCategory: {}, calls: {} };
}

/** 取（必要时创建）某天的桶。 */
function dayBucket(dateKey: string): DayBucket {
  let b = tokenStore.days[dateKey];
  if (!b) {
    b = emptyDay();
    tokenStore.days[dateKey] = b;
  }
  return b;
}

/** 清掉窗口外的旧记录与异常的未来记录（时钟回拨防御）。 */
function pruneDays(): void {
  const today = dateKeyOffset(0);
  const cutoff = dateKeyOffset(-(DAYS_TO_KEEP - 1));
  for (const key of Object.keys(tokenStore.days)) {
    if (key < cutoff || key > today) delete tokenStore.days[key];
  }
}

/** 今日用量；今日还没产生过调用时返回全 0 的临时对象，不建桶。 */
export function todayUsage(): DayBucket {
  return tokenStore.days[dateKeyOf(new Date())] ?? emptyDay();
}

/** 记一次调用的用量。tokens 为 0 或非法时只计次数不计量。 */
export function recordTokens(category: TokenCategory, tokens: number | undefined): void {
  if (!(category in tokenStore.byCategory)) return;

  tokenStore.calls[category] += 1;
  tokenStore.updatedAt = Date.now();

  /* 当日桶：调用次数必记；用量与累计层一样只在拿到真实 usage 时记。 */
  const today = dayBucket(dateKeyOf(new Date()));
  today.calls[category] = (today.calls[category] ?? 0) + 1;

  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return;
  const n = Math.round(tokens);
  tokenStore.byCategory[category] += n;
  tokenStore.total += n;
  today.byCategory[category] = (today.byCategory[category] ?? 0) + n;
  today.total = (today.total ?? 0) + n;

  pruneDays();
}

/* ---------------- HUD 取值（均为「当日」口径） ---------------- */

export interface TokenBreakdownItem extends TokenCategoryMeta {
  tokens: number;
  calls: number;
  /** 占当日总量的百分比（0–100），用于 HUD 里的细条。 */
  percent: number;
}

export interface CoreTokenCategoryItem {
  key: "chat" | "writer" | "auditor";
  label: string;
  tokens: number;
  calls: number;
}

/** 三大核心 AI 智能体（对话 / 写作 / 审核）当日用量，固定在 HUD 顶部标题右侧展示。 */
export function coreTokenBreakdown(): CoreTokenCategoryItem[] {
  const t = todayUsage();
  return [
    { key: "chat", label: "对话", tokens: t.byCategory.chat || 0, calls: t.calls.chat || 0 },
    { key: "writer", label: "写作", tokens: t.byCategory.writer || 0, calls: t.calls.writer || 0 },
    { key: "auditor", label: "审核", tokens: t.byCategory.auditor || 0, calls: t.calls.auditor || 0 },
  ];
}

/** 其余非核心分类（精修、知识、编辑器等）当日用量，按用量倒序呈现于列表内。 */
export function otherTokenBreakdown(): TokenBreakdownItem[] {
  const t = todayUsage();
  const total = t.total;
  const coreKeys: TokenCategory[] = ["chat", "writer", "auditor"];
  return TOKEN_CATEGORIES
    .filter((meta) => !coreKeys.includes(meta.key))
    .map((meta) => ({
      ...meta,
      tokens: t.byCategory[meta.key] || 0,
      calls: t.calls[meta.key] || 0,
      percent: total > 0 ? ((t.byCategory[meta.key] || 0) / total) * 100 : 0,
    }))
    .filter((item) => item.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens);
}

/* ---------------- 7 天序列（图标弹出的柱状图） ---------------- */

export interface DailyTokenPoint {
  /** `YYYY-MM-DD` */
  key: string;
  /** 柱下展示的短标签：今天 / 昨天 / M/D */
  label: string;
  total: number;
  byCategory: Partial<Record<TokenCategory, number>>;
  calls: Partial<Record<TokenCategory, number>>;
  isToday: boolean;
}

/** 近 `days` 天（含今日）每天的总用量，按时间升序排列，未记录的日期补 0。 */
export function dailyTokenSeries(days = 7): DailyTokenPoint[] {
  const now = new Date();
  const today = dateKeyOf(now);
  const out: DailyTokenPoint[] = [];

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = dateKeyOf(d);
    const b = tokenStore.days[key];
    const isToday = key === today;
    out.push({
      key,
      label: isToday
        ? "今天"
        : i === 1
        ? "昨天"
        : `${d.getMonth() + 1}/${d.getDate()}`,
      total: b?.total ?? 0,
      byCategory: { ...(b?.byCategory ?? {}) },
      calls: { ...(b?.calls ?? {}) },
      isToday,
    });
  }
  return out;
}

/* ---------------- 格式化 ---------------- */

/** 千分位格式化（精确值，用于悬浮提示 / 明细）。 */
export function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

/** HUD 大数字用的紧凑格式：1,2345 → 「1.2万」，10 万以上的位数锁在 4 位以内，
    避免细分项数字一旦变大就把卡片撑破、显示不完整。 */
export function formatTokensCompact(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 10000) return n.toLocaleString("en-US");
  const w = n / 10000;
  const rounded = w >= 100 ? Math.round(w) : Math.round(w * 10) / 10;
  return `${rounded.toLocaleString("en-US")}万`;
}

/* ---------------- 持久化序列化 ---------------- */

export interface TokenUsagePayload {
  total: number;
  byCategory: Partial<Record<TokenCategory, number>>;
  calls: Partial<Record<TokenCategory, number>>;
  updatedAt: number;
  /** 按日桶（可选：旧版本数据没有这个字段）。 */
  days?: Record<string, DayBucket>;
}

export function exportTokenUsage(): TokenUsagePayload {
  pruneDays();
  return {
    total: tokenStore.total,
    byCategory: { ...tokenStore.byCategory },
    calls: { ...tokenStore.calls },
    updatedAt: tokenStore.updatedAt,
    days: { ...tokenStore.days },
  };
}

/**
 * 读回磁盘上的账本。
 *
 * 累计层以各分项之和为准（而不是直接信 `total`），这样即使旧版本少写了某个字段，
 * 显示出来的总量也和细分项自洽。按日桶逐桶校验后读入；旧版本没有 `days` 时，
 * 当日桶从 0 开始累积（历史用量保留在累计层，7 天图从今天起填充）。
 */
export function importTokenUsage(raw: unknown): void {
  if (!raw || typeof raw !== "object") return;
  const data = raw as Partial<TokenUsagePayload>;

  const buckets = emptyBuckets();
  const calls = emptyBuckets();
  for (const meta of TOKEN_CATEGORIES) {
    const t = data.byCategory?.[meta.key];
    if (typeof t === "number" && Number.isFinite(t) && t > 0) buckets[meta.key] = Math.round(t);
    const c = data.calls?.[meta.key];
    if (typeof c === "number" && Number.isFinite(c) && c > 0) calls[meta.key] = Math.round(c);
  }

  tokenStore.byCategory = buckets;
  tokenStore.calls = calls;
  tokenStore.total = TOKEN_CATEGORIES.reduce((sum, m) => sum + buckets[m.key], 0);
  tokenStore.updatedAt =
    typeof data.updatedAt === "number" && Number.isFinite(data.updatedAt) ? data.updatedAt : 0;

  const days: Record<string, DayBucket> = {};
  if (data.days && typeof data.days === "object") {
    for (const key of Object.keys(data.days)) {
      /* 键必须是本地日期 `YYYY-MM-DD`，防脏数据。 */
      if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) continue;
      const d = data.days[key];
      const bucket = emptyDay();
      if (d && typeof d === "object") {
        if (typeof d.total === "number" && Number.isFinite(d.total) && d.total > 0) {
          bucket.total = Math.round(d.total);
        }
        for (const meta of TOKEN_CATEGORIES) {
          const t = d.byCategory?.[meta.key];
          if (typeof t === "number" && Number.isFinite(t) && t > 0) bucket.byCategory[meta.key] = Math.round(t);
          const c = d.calls?.[meta.key];
          if (typeof c === "number" && Number.isFinite(c) && c > 0) bucket.calls[meta.key] = Math.round(c);
        }
      }
      days[key] = bucket;
    }
  }
  tokenStore.days = days;
  pruneDays();
}