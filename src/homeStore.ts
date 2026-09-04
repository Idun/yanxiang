import { reactive, watch } from "vue";
import { documentFilesStore, type DocFileItem } from "./documentFilesStore";
import { loadSettings, saveSettings } from "./persistence";

/**
 * 主页（Home）状态。
 *
 * 主页本身只做“聚合展示 + 快捷入口”，因此这里只保存主页自己产生的数据：
 * - 置顶文档（用户手动钉在主页上的文档）
 * - 打开记录（真实的文档访问时间，用来渲染「最近打开」）
 * - 今日字数目标与当日基线（用来计算今天实际写了多少字）
 *
 * 所有数字都来自真实数据：文档树、卡片库、精修历史。没有任何预置的假数据。
 */

export interface DocVisit {
  fileId: string;
  /** epoch ms */
  at: number;
}

/** 当天写作量的基线：当日首次进入时记录一次全量字数，之后的增量即今日字数。 */
export interface DailyBaseline {
  /** 形如 2026-8-28 的本地日期 */
  date: string;
  chars: number;
}

const MAX_VISITS = 40;

export const homeStore = reactive({
  pinnedDocIds: [] as string[],
  /** 最近打开的文档，按时间倒序，同一文档只保留最近一次。 */
  visits: [] as DocVisit[],
  dailyGoalChars: 1000,
  dailyBaseline: { date: "", chars: 0 } as DailyBaseline,
  /** 自定义问候语；留空时按时段自动生成。 */
  customGreeting: "",
  /** 右侧灵感速记面板是否折叠。 */
  inspirationCollapsed: false,
  /** 右侧灵感速记面板宽度（px），由用户拖拽分隔线调整。 */
  inspirationWidth: 340,
});

/** 面板宽度的允许区间：太窄放不下工具条，太宽会挤掉左侧主体。 */
export const INSPIRATION_MIN_WIDTH = 240;
export const INSPIRATION_MAX_WIDTH = 720;

export function setInspirationWidth(px: number): void {
  if (!Number.isFinite(px)) return;
  /* 同时受窗口宽度约束：至少给左侧主体留 360px。 */
  const roomCap =
    typeof window !== "undefined" ? Math.max(INSPIRATION_MIN_WIDTH, window.innerWidth - 360) : INSPIRATION_MAX_WIDTH;
  const cap = Math.min(INSPIRATION_MAX_WIDTH, roomCap);
  homeStore.inspirationWidth = Math.round(Math.min(cap, Math.max(INSPIRATION_MIN_WIDTH, px)));
}

/* ---------------- 工具 ---------------- */

export function localDateKey(at: number = Date.now()): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/** 统计有效字数：去掉空白与常见 Markdown 记号，避免把符号算成字。 */
export function countChars(text: string): number {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*`_~\-[\]()!|]/g, "")
    .replace(/\s+/g, "")
    .length;
}

/** 当前所有文档的总字数。 */
export function totalDocChars(): number {
  return documentFilesStore.files.reduce((sum, f) => sum + countChars(f.content), 0);
}

/* ---------------- 置顶 ---------------- */

export function isDocPinned(fileId: string): boolean {
  return homeStore.pinnedDocIds.includes(fileId);
}

export function toggleDocPinned(fileId: string): boolean {
  const idx = homeStore.pinnedDocIds.indexOf(fileId);
  if (idx === -1) {
    homeStore.pinnedDocIds.push(fileId);
    return true;
  }
  homeStore.pinnedDocIds.splice(idx, 1);
  return false;
}

/** 置顶文档（已丢弃指向不存在文档的记录）。 */
export function pinnedDocFiles(): DocFileItem[] {
  return homeStore.pinnedDocIds
    .map((id) => documentFilesStore.files.find((f) => f.id === id))
    .filter((f): f is DocFileItem => !!f);
}

/* ---------------- 访问记录 ---------------- */

export function recordDocVisit(fileId: string | null | undefined): void {
  if (!fileId) return;
  if (!documentFilesStore.files.some((f) => f.id === fileId)) return;

  const rest = homeStore.visits.filter((v) => v.fileId !== fileId);
  rest.unshift({ fileId, at: Date.now() });
  homeStore.visits = rest.slice(0, MAX_VISITS);
}

export interface RecentDoc {
  file: DocFileItem;
  at: number;
}

/** 最近打开过的文档；不足时用文档树中新建时间最近的补齐。 */
export function recentDocs(limit = 6): RecentDoc[] {
  const out: RecentDoc[] = [];
  const seen = new Set<string>();

  for (const v of homeStore.visits) {
    const file = documentFilesStore.files.find((f) => f.id === v.fileId);
    if (!file) continue;
    out.push({ file, at: v.at });
    seen.add(file.id);
    if (out.length >= limit) return out;
  }

  const fallback = documentFilesStore.files
    .filter((f) => !seen.has(f.id))
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);

  for (const file of fallback) {
    out.push({ file, at: file.createdAt });
    if (out.length >= limit) break;
  }
  return out;
}

/* ---------------- 今日写作量 ---------------- */

/** 校准当日基线：跨天（或首次运行）时把当前总字数记为今天的起点。 */
export function ensureDailyBaseline(): void {
  const today = localDateKey();
  if (homeStore.dailyBaseline.date !== today) {
    homeStore.dailyBaseline = { date: today, chars: totalDocChars() };
  }
}

/** 今日新增字数。删除内容不会让它变成负数。 */
export function todayChars(): number {
  ensureDailyBaseline();
  return Math.max(0, totalDocChars() - homeStore.dailyBaseline.chars);
}

export function dailyProgressPercent(): number {
  const goal = homeStore.dailyGoalChars;
  if (goal <= 0) return 0;
  return Math.min(100, Math.round((todayChars() / goal) * 100));
}

export function setDailyGoal(chars: number): void {
  if (!Number.isFinite(chars)) return;
  homeStore.dailyGoalChars = Math.min(100_000, Math.max(0, Math.round(chars)));
}

/* ---------------- 持久化 ---------------- */

const KEY_PINNED = "homePinnedDocs";
const KEY_VISITS = "homeDocVisits";
const KEY_GOAL = "homeDailyGoal";
const KEY_BASELINE = "homeDailyBaseline";
const KEY_GREETING = "homeGreeting";
const KEY_INSP_COLLAPSED = "homeInspirationCollapsed";
const KEY_INSP_WIDTH = "homeInspirationWidth";

let booted = false;

/**
 * 主页自带的持久化引导：读回上次的置顶 / 访问记录 / 目标。
 *
 * 由 HomeView 首次挂载时调用，重复调用无副作用。自动保存与访问记录的监听器
 * 在模块加载时就已注册（见文件末尾），因此离开主页后仍会继续累积记录。
 */
export async function bootHomeStore(): Promise<void> {
  if (booted) return;
  booted = true;

  try {
    const settings = await loadSettings();

    if (settings[KEY_PINNED]) {
      const parsed = JSON.parse(settings[KEY_PINNED]);
      if (Array.isArray(parsed)) homeStore.pinnedDocIds = parsed.filter((x) => typeof x === "string");
    }
    if (settings[KEY_VISITS]) {
      const parsed = JSON.parse(settings[KEY_VISITS]);
      if (Array.isArray(parsed)) {
        /* 合并：磁盘记录在后，本次启动已记录的访问保持在最前。 */
        const live = homeStore.visits.slice();
        const merged = live.concat(
          parsed.filter(
            (v: DocVisit) =>
              typeof v?.fileId === "string" &&
              typeof v?.at === "number" &&
              !live.some((l) => l.fileId === v.fileId),
          ),
        );
        homeStore.visits = merged.slice(0, MAX_VISITS);
      }
    }
    if (settings[KEY_GOAL]) {
      const goal = Number(settings[KEY_GOAL]);
      if (Number.isFinite(goal)) homeStore.dailyGoalChars = goal;
    }
    if (settings[KEY_BASELINE]) {
      const parsed = JSON.parse(settings[KEY_BASELINE]);
      if (typeof parsed?.date === "string" && typeof parsed?.chars === "number") {
        homeStore.dailyBaseline = parsed;
      }
    }
    if (typeof settings[KEY_GREETING] === "string") {
      homeStore.customGreeting = settings[KEY_GREETING];
    }
    if (settings[KEY_INSP_COLLAPSED] !== undefined) {
      homeStore.inspirationCollapsed = settings[KEY_INSP_COLLAPSED] === "true";
    }
    if (settings[KEY_INSP_WIDTH]) {
      setInspirationWidth(Number(settings[KEY_INSP_WIDTH]));
    }
  } catch {
    /* 读取失败时保留默认值，主页仍可正常使用 */
  }

  ensureDailyBaseline();
  recordDocVisit(documentFilesStore.activeFileId);
}

/* 当前文档切换即视为一次打开。注册在模块作用域，不随主页组件卸载而停止。 */
watch(
  () => documentFilesStore.activeFileId,
  (id) => recordDocVisit(id),
);

watch(
  () => [
    homeStore.pinnedDocIds,
    homeStore.visits,
    homeStore.dailyGoalChars,
    homeStore.dailyBaseline,
    homeStore.customGreeting,
    homeStore.inspirationCollapsed,
    homeStore.inspirationWidth,
  ],
  () => {
    /* 读回磁盘数据之前不写，避免默认值覆盖上次的记录。 */
    if (!booted) return;
    try {
      void saveSettings([
        { key: KEY_PINNED, value: JSON.stringify(homeStore.pinnedDocIds) },
        { key: KEY_VISITS, value: JSON.stringify(homeStore.visits) },
        { key: KEY_GOAL, value: String(homeStore.dailyGoalChars) },
        { key: KEY_BASELINE, value: JSON.stringify(homeStore.dailyBaseline) },
        { key: KEY_GREETING, value: homeStore.customGreeting },
        { key: KEY_INSP_COLLAPSED, value: String(homeStore.inspirationCollapsed) },
        { key: KEY_INSP_WIDTH, value: String(homeStore.inspirationWidth) },
      ]);
    } catch {
      /* ignore */
    }
  },
  { deep: true },
);
