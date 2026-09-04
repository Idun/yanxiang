<script setup lang="ts">
/**
 * 主页（Home）。
 *
 * 布局参考 Obsidian 的 Homepage 插件：一个「落地页」式仪表盘，把最常用的入口
 * 和真实数据聚合在一屏内 —— 问候语 + 今日进度、快捷操作、最近打开、置顶文档、
 * 资料库概览、快速搜索、写作灵感、最近修改。
 *
 * 这里只做聚合与跳转，不改动任何既有数据结构；配色全部复用项目的 CSS 变量，
 * 所以跟随设置面板里的主题色。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Clock,
  Coins,
  FilePlus2,
  FileText,
  Folder,
  FolderOpen,
  History,
  Layers,
  Lightbulb,
  Map as MapIcon,
  Pin,
  PinOff,
  Plus,
  Search,
  Shuffle,
  Sparkles,
  Target,
  Wand2,
} from "lucide-vue-next";
import { createDocFile, documentFilesStore, type DocFileItem } from "../documentFilesStore";
import { libraryStore } from "../libraryStore";
import { refineStore } from "../refineStore";
import { mapStore } from "../mapStore";
import { requestOpenMap } from "../cardEvents";
import { materialStore } from "../materialStore";
import { aiSettings } from "../settings";
import { insightStore, refreshInsights, relativeTime } from "../insightStore";
import { formatTokens, formatTokensCompact, dailyTokenSeries, coreTokenBreakdown, otherTokenBreakdown, todayUsage, tokenStore, TOKEN_CATEGORIES } from "../tokenStore";
import InspirationPanel from "./InspirationPanel.vue";
import {
  bootHomeStore,
  countChars,
  dailyProgressPercent,
  homeStore,
  isDocPinned,
  pinnedDocFiles,
  recentDocs,
  setDailyGoal,
  todayChars,
  toggleDocPinned,
  totalDocChars,
} from "../homeStore";

const emit = defineEmits<{
  /** 切换主界面标签（由 App.vue 接管）。 */
  (e: "navigate", tab: "docs" | "library" | "refine" | "insight"): void;
  /** 打开指定文档并切到「文档」标签。 */
  (e: "openDoc", fileId: string): void;
  /** 复用顶栏的导入流程。 */
  (e: "importFile"): void;
}>();

/* ---------------- 问候语与日期 ---------------- */

const now = ref(new Date());

const greeting = computed(() => {
  if (homeStore.customGreeting.trim()) return homeStore.customGreeting.trim();
  const h = now.value.getHours();
  if (h < 5) return "夜深了，注意休息";
  if (h < 11) return "早上好，今天写点什么";
  if (h < 14) return "午间好，继续推进";
  if (h < 18) return "下午好，保持手感";
  if (h < 23) return "晚上好，安静写作时间";
  return "夜深了，注意休息";
});

const dateLabel = computed(() =>
  now.value.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }),
);

/* ---------------- 今日进度 ---------------- */

const goalEditing = ref(false);
const goalDraft = ref("");

/** 今日新增字数。显式读取文档内容，内容变化时自动重算。 */
const todayCount = computed(() => {
  void documentFilesStore.files.map((f) => f.content.length).join(",");
  return todayChars();
});

const progress = computed(() => {
  void documentFilesStore.files.map((f) => f.content.length).join(",");
  return dailyProgressPercent();
});

const allChars = computed(() => {
  void documentFilesStore.files.map((f) => f.content.length).join(",");
  return totalDocChars();
});

/* 进度环：半径 26，周长 = 2πr */
const RING_CIRCUMFERENCE = 2 * Math.PI * 26;
const ringOffset = computed(
  () => RING_CIRCUMFERENCE * (1 - Math.min(100, progress.value) / 100),
);

function startEditGoal() {
  goalDraft.value = String(homeStore.dailyGoalChars);
  goalEditing.value = true;
}

function commitGoal() {
  const n = Number(goalDraft.value);
  if (Number.isFinite(n)) setDailyGoal(n);
  goalEditing.value = false;
}

/* ---------------- Token 用量 HUD ---------------- */

/* 跨过零点时按日桶自动换成新的全 0 桶；让 HUD 的 computed 依赖这个「日期戳」，
   这样整点/零点一到，今日数字立刻归零重算，无需等下次记账。 */
const todayStamp = computed(() => {
  const d = now.value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
});

/** 总量（今日口径）。只统计模型真实返回的 usage，没返回就不计。 */
const tokenTotal = computed(() => {
  void todayStamp.value;
  return formatTokensCompact(todayUsage().total);
});

/** 三大核心智能体 (对话 / 写作 / 审核) 当日用量，固定置顶呈现 */
const coreTokens = computed(() => {
  void todayStamp.value;
  return coreTokenBreakdown();
});

/** 其余分类 (精修 / 知识 / 编辑器等) 当日用量 */
const otherTokenItems = computed(() => {
  void todayStamp.value;
  return otherTokenBreakdown();
});

/** 今日有调用、但一个 token 都没拿到（对端不返回 usage）时给个说明。 */
const tokenCalledButUnreported = computed(() => {
  const t = todayUsage();
  return t.total === 0 && TOKEN_CATEGORIES.some((m) => (t.calls[m.key] ?? 0) > 0);
});

/* ---------------- 近 7 天用量柱状图（Header 小图标弹出） ---------------- */

const tokenChartOpen = ref(false);
const tokenChartBtnRef = ref<HTMLButtonElement | null>(null);
const tokenChartPopRef = ref<HTMLDivElement | null>(null);
/** 浮层定位（视口坐标，Teleport 到 body 后使用）。 */
const tokenChartPos = ref({ left: 0, top: 0 });
const TOKEN_CHART_W = 236;

/** 近 7 天数据（含今日），时间升序。 */
const dailyTokenSeriesData = computed(() => {
  void todayStamp.value;
  return dailyTokenSeries(7);
});

/** 7 天里的最大单日用量，决定各柱的相对高度。 */
const dailyMax = computed(() =>
  Math.max(1, ...dailyTokenSeriesData.value.map((d) => d.total)),
);

const sevenDayTotal = computed(
  () => dailyTokenSeriesData.value.reduce((sum, d) => sum + d.total, 0),
);

function barHeight(total: number): string {
  if (total <= 0) return "2px";
  const pct = Math.max(6, Math.round((total / dailyMax.value) * 100));
  return `${pct}%`;
}

function chartTip(d: (typeof dailyTokenSeriesData.value)[number]): string {
  return `${d.key}（${d.label}）：${formatTokens(d.total)} tokens`;
}

function openTokenChart() {
  const btn = tokenChartBtnRef.value;
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  let left = rect.right - TOKEN_CHART_W;
  left = Math.max(12, Math.min(left, window.innerWidth - TOKEN_CHART_W - 12));
  tokenChartPos.value = { left, top: rect.bottom + 8 };
  tokenChartOpen.value = true;
}

function toggleTokenChart() {
  if (tokenChartOpen.value) tokenChartOpen.value = false;
  else openTokenChart();
}

function closeTokenChart() {
  tokenChartOpen.value = false;
}

/** 点浮层 / 按钮以外的地方、或窗口滚动/缩放时收起。 */
function onTokenChartDocMouseDown(event: MouseEvent) {
  if (!tokenChartOpen.value) return;
  const node = event.target as Node;
  if (tokenChartPopRef.value?.contains(node)) return;
  if (tokenChartBtnRef.value?.contains(node)) return;
  tokenChartOpen.value = false;
}

function onTokenChartScroll() {
  closeTokenChart();
}

/* ---------------- 资料库概览 ---------------- */

const stats = computed(() => [
  {
    key: "docs",
    label: "文档",
    value: documentFilesStore.files.length,
    icon: FileText,
    tab: "docs" as const,
  },
  {
    key: "folders",
    label: "文件夹",
    value: documentFilesStore.folders.length,
    icon: Folder,
    tab: "docs" as const,
  },
  {
    key: "cards",
    label: "写作卡片",
    value: libraryStore.cards.length,
    icon: Layers,
    tab: "library" as const,
  },
  {
    key: "refine",
    label: "精修版本",
    value: refineStore.historyVersions.length,
    icon: Wand2,
    tab: "refine" as const,
  },
  {
    key: "places",
    label: "地图地点",
    value: mapStore.places.length,
    icon: MapIcon,
    tab: "library" as const,
  },
  {
    key: "chars",
    label: "累计字数",
    value: allChars.value,
    icon: BookOpen,
    tab: "docs" as const,
  },
]);

/* 资料库概览卡片点击：切到对应工作区；「地图地点」额外请求直接打开故事地图。 */
function onStatClick(s: { key: string; tab: "docs" | "library" | "refine" | "insight" }) {
  emit("navigate", s.tab);
  if (s.key === "places") requestOpenMap();
}

/* ---------------- 最近 / 置顶 ---------------- */

const recent = computed(() => {
  void homeStore.visits.length;
  void documentFilesStore.files.length;
  return recentDocs(6);
});

const pinned = computed(() => {
  void homeStore.pinnedDocIds.length;
  return pinnedDocFiles();
});

/* ---------------- 置顶文档分页 ---------------- */

/** 一页四张卡片（2×2）；第五张起进入下一页。 */
const PINNED_PAGE_SIZE = 4;

const pinnedPage = ref(0);

const pinnedPageCount = computed(() =>
  Math.max(1, Math.ceil(pinned.value.length / PINNED_PAGE_SIZE)),
);

const pinnedPageItems = computed(() => {
  const start = pinnedPage.value * PINNED_PAGE_SIZE;
  return pinned.value.slice(start, start + PINNED_PAGE_SIZE);
});

/** 分页状态下末页不足四张时补空位，避免翻页时下方分页器上下跳动。 */
const pinnedPagePlaceholders = computed(() =>
  pinnedPageCount.value > 1 ? PINNED_PAGE_SIZE - pinnedPageItems.value.length : 0,
);

/* 取消置顶可能让当前页消失（例如在第 2 页取消了唯一一张），把页码收回有效区间。 */
watch(pinnedPageCount, (count) => {
  if (pinnedPage.value > count - 1) pinnedPage.value = Math.max(0, count - 1);
});

function goPinnedPage(index: number) {
  pinnedPage.value = Math.min(pinnedPageCount.value - 1, Math.max(0, index));
}

function folderNameOf(file: DocFileItem): string {
  if (!file.folderId) return "根目录";
  return documentFilesStore.folders.find((f) => f.id === file.folderId)?.title ?? "根目录";
}

function excerptOf(file: DocFileItem): string {
  const text = file.content.replace(/[#>*`_~[\]()!|]/g, "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 76) : "空白文档";
}

function openDoc(fileId: string) {
  emit("openDoc", fileId);
}

function onTogglePin(fileId: string, event: MouseEvent) {
  event.stopPropagation();
  toggleDocPinned(fileId);
}

/* 灵感速记面板的「应用」动作直接沿用主页已有的跳转出口。 */
function onHomeOpenDocFromPanel(fileId: string) {
  emit("openDoc", fileId);
}

function onHomeNavigateFromPanel(tab: "docs" | "library" | "refine" | "insight") {
  emit("navigate", tab);
}

/* ---------------- 快捷操作 ---------------- */

function newDoc() {
  const file = createDocFile(null, "未命名文档");
  emit("openDoc", file.id);
}

const quickActions = computed(() => [
  { key: "new", label: "新建文档", desc: "空白 Markdown", icon: FilePlus2, run: newDoc },
  {
    key: "import",
    label: "导入文件",
    desc: "从本地打开",
    icon: FolderOpen,
    run: () => emit("importFile"),
  },
  {
    key: "card",
    label: "写作画布",
    desc: `${libraryStore.cards.length} 张卡片`,
    icon: Plus,
    run: () => emit("navigate", "library"),
  },
  {
    key: "refine",
    label: "逐句精修",
    desc: refineStore.inputText ? "有未完成的稿件" : "润色与改写",
    icon: Wand2,
    run: () => emit("navigate", "refine"),
  },
  {
    key: "insight",
    label: "写作洞察",
    desc: insightStore.analysis.hasData ? "已有风格画像" : "尚未分析",
    icon: Sparkles,
    run: () => emit("navigate", "insight"),
  },
]);

/* ---------------- 快速搜索 ---------------- */

const query = ref("");

const searchResults = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [] as DocFileItem[];
  return documentFilesStore.files
    .filter((f) => f.title.toLowerCase().includes(q) || f.content.toLowerCase().includes(q))
    .slice(0, 8);
});

/* ---------------- 写作灵感（素材库随机一条） ---------------- */

const inspirationIndex = ref(0);

const inspiration = computed(() => {
  const items = materialStore.items;
  if (items.length === 0) return null;
  return items[inspirationIndex.value % items.length];
});

/* 正文不再按固定行数截断：区块已与「最近修改」等高，交给内部滚动去适配，
   这样高度变化时不会出现「上面留白、下面被砍」的错位。 */
const inspirationText = computed(() => inspiration.value?.content.trim() ?? "");

/** 素材共几行，用于在标题右侧提示体量。 */
const inspirationLineCount = computed(
  () => inspirationText.value.split("\n").filter((l) => l.trim()).length,
);

const inspirationBodyEl = ref<HTMLElement | null>(null);
/** 内容是否超出可视高度 —— 决定要不要显示底部渐隐。 */
const inspirationOverflow = ref(false);
/** 是否已滚到底部 —— 到底后收起渐隐，避免遮住最后一行。 */
const inspirationAtEnd = ref(false);

function measureInspiration() {
  const el = inspirationBodyEl.value;
  if (!el) {
    inspirationOverflow.value = false;
    return;
  }
  inspirationOverflow.value = el.scrollHeight - el.clientHeight > 2;
  inspirationAtEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
}

function onInspirationScroll() {
  const el = inspirationBodyEl.value;
  if (!el) return;
  inspirationAtEnd.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
}

/** 换素材 / 高度变化后重新量一次。 */
function scheduleInspirationMeasure() {
  nextTick(() => {
    const el = inspirationBodyEl.value;
    if (el) el.scrollTop = 0;
    measureInspiration();
  });
}

/* 高度会随「最近修改」条数、窗口大小、灵感面板拖宽而变，用 ResizeObserver
   直接盯住滚动容器，比监听 window.resize 更可靠。 */
let inspirationObserver: ResizeObserver | null = null;

function rollInspiration() {
  const len = materialStore.items.length;
  if (len <= 1) return;
  let next = inspirationIndex.value;
  while (next === inspirationIndex.value) {
    next = Math.floor(Math.random() * len);
  }
  inspirationIndex.value = next;
  scheduleInspirationMeasure();
}

/* ---------------- 洞察：已分析语料 ---------------- */

/** 与「洞察」界面同源的语料统计，直接读 insightStore.analysis。 */
const analysis = computed(() => insightStore.analysis);

const analysisStats = computed(() => {
  const a = analysis.value;
  return [
    { key: "samples", value: a.sampleCount, unit: "份文本" },
    { key: "paragraphs", value: a.paragraphCount, unit: "段" },
    { key: "sentences", value: a.sentenceCount, unit: "句" },
    { key: "chars", value: a.totalChars, unit: "字" },
  ];
});

/* ---------------- 最近修改记忆 ---------------- */

const recentEdits = computed(() => insightStore.history.items.slice(0, 4));

/* 跨过整点时问候语要跟着变 */
let clockTimer: number | null = null;

onMounted(() => {
  void bootHomeStore();
  /* 与「洞察」一致：进入时按需重算一次（内部有指纹判重，不会重复分析）。 */
  refreshInsights();
  inspirationIndex.value = Math.floor(Math.random() * Math.max(1, materialStore.items.length));
  scheduleInspirationMeasure();
  clockTimer = window.setInterval(() => {
    now.value = new Date();
  }, 60_000);
  /* 灵感面板拖宽会改变本区块高度，需要重新判断是否溢出 */
  window.addEventListener("resize", measureInspiration);
  document.addEventListener("mousedown", onTokenChartDocMouseDown);
  window.addEventListener("scroll", onTokenChartScroll, true);
  window.addEventListener("resize", onTokenChartScroll);
  nextTick(() => {
    const el = inspirationBodyEl.value;
    if (el && typeof ResizeObserver !== "undefined") {
      inspirationObserver = new ResizeObserver(() => measureInspiration());
      inspirationObserver.observe(el);
    }
  });
});

onBeforeUnmount(() => {
  if (clockTimer !== null) window.clearInterval(clockTimer);
  window.removeEventListener("resize", measureInspiration);
  document.removeEventListener("mousedown", onTokenChartDocMouseDown);
  window.removeEventListener("scroll", onTokenChartScroll, true);
  window.removeEventListener("resize", onTokenChartScroll);
  inspirationObserver?.disconnect();
  inspirationObserver = null;
});
</script>

<template>
  <div class="home-view">
    <!-- 左侧：灵感速记（独立于滚动区，占据滚动条左侧的整条区域） -->
    <InspirationPanel @openDoc="onHomeOpenDocFromPanel" @navigate="onHomeNavigateFromPanel" />

    <div class="home-scroll">
      <!-- ============ Hero：问候 + 今日进度 ============ -->
      <section class="hero">
        <div class="hero-text">
          <div class="hero-date">{{ dateLabel }}</div>
          <h1 class="hero-greeting">{{ greeting }}</h1>
          <div class="hero-sub">
            <span class="hero-sub-group">
              共 {{ documentFilesStore.files.length }} 篇文档 ·
              {{ libraryStore.cards.length }} 张卡片 ·
              累计 {{ allChars }} 字
            </span>

            <span class="hero-sub-divider" aria-hidden="true"></span>

            <span
              class="hero-sub-group analysis-group"
              :title="analysis.lastRunAt ? `上次分析：${relativeTime(analysis.lastRunAt)}` : '尚未运行分析'"
            >
              <template v-if="analysis.sampleCount > 0">
                已分析
                <template v-for="(item, i) in analysisStats" :key="item.key">
                  <span v-if="i > 0" class="analysis-sep">·</span>
                  <span class="num-tabular">{{ item.value }}</span>
                  {{ item.unit }}
                </template>
              </template>
              <template v-else>尚未检测到可分析的文本</template>
            </span>
          </div>
        </div>

        <!-- Token 用量 HUD 与「今日写作」成对存在：包在同一个 .hero-cards 里，
             因此永远同行、同高、右对齐，绝不会各自折行错开。 -->
        <div class="hero-cards">
          <!-- Token 用量 HUD：与「今日写作」等宽等高。仍是竖排：总量在最上方
               且较大，细分项在其下小字显示。 -->
          <section
            class="token-hud"
            :title="tokenStore.updatedAt ? `最近一次调用：${relativeTime(tokenStore.updatedAt)}` : '尚未产生 AI 调用'"
          >
            <div class="token-hud-top-container">
              <div class="token-hud-total-box">
                <div class="token-hud-head">
                  <Coins :size="11" :stroke-width="2" />
                  <span>Token 总量</span>
                  <!-- 近 7 天用量柱状图入口 -->
                  <button
                    ref="tokenChartBtnRef"
                    type="button"
                    class="token-chart-btn"
                    :class="{ open: tokenChartOpen }"
                    :title="'近 7 天 Token 用量'"
                    @mousedown.stop
                    @click.stop="toggleTokenChart"
                  >
                    <BarChart3 :size="11" :stroke-width="2.2" />
                  </button>
                </div>
                <div class="token-hud-total num-tabular">{{ tokenTotal }}</div>
              </div>

              <!-- 固定置于 Token 总量字样右侧的三大核心智能体明细 (对话、写作、审核)，均为当日用量 -->
              <div class="token-hud-core-group">
                <div
                  v-for="c in coreTokens"
                  :key="c.key"
                  class="token-hud-core-item"
                  :title="`${c.label}（今日） · ${c.calls} 次调用 · 当日 ${formatTokens(c.tokens)} tokens`"
                >
                  <span class="token-hud-core-label">{{ c.label }}</span>
                  <span class="token-hud-core-value num-tabular">{{ formatTokensCompact(c.tokens) }}</span>
                </div>
              </div>
            </div>

            <!-- 下方其他分类（如精修、知识、编辑器等）当日按用量倒序 -->
            <div v-if="otherTokenItems.length > 0" class="token-hud-list">
              <div
                v-for="item in otherTokenItems"
                :key="item.key"
                class="token-hud-row"
                :title="`${item.hint}（今日） · ${item.calls} 次调用 · 当日 ${formatTokens(item.tokens)} tokens`"
              >
                <span class="token-hud-label">{{ item.label }}</span>
                <span class="token-hud-bar">
                  <span class="token-hud-bar-fill" :style="{ width: item.percent + '%' }"></span>
                </span>
                <span class="token-hud-value num-tabular">{{ formatTokensCompact(item.tokens) }}</span>
              </div>
            </div>
            <div v-else class="token-hud-empty">
              {{ tokenCalledButUnreported ? "今日接口未返回用量" : "今日暂无其他 AI 调用记录" }}
            </div>
          </section>

          <!-- 近 7 天用量柱状图（随 Header 小图标弹出，Teleport 到 body 避开
               卡片的 overflow:hidden 与滚动裁剪） -->
          <Teleport to="body">
            <Transition name="token-chart">
              <div
                v-if="tokenChartOpen"
                ref="tokenChartPopRef"
                class="token-chart-pop"
                :style="{ left: tokenChartPos.left + 'px', top: tokenChartPos.top + 'px' }"
                @mousedown.stop
                @click.stop
              >
                <div class="token-chart-head">
                  <BarChart3 :size="12" :stroke-width="2.2" />
                  <span>近 7 天 Token 用量</span>
                </div>

                <div class="token-chart-bars">
                  <div
                    v-for="d in dailyTokenSeriesData"
                    :key="d.key"
                    class="token-chart-col"
                    :title="chartTip(d)"
                  >
                    <div class="token-chart-track">
                      <div
                        class="token-chart-bar"
                        :class="{ today: d.isToday, empty: d.total === 0 }"
                        :style="{ height: barHeight(d.total) }"
                      ></div>
                    </div>
                    <span class="token-chart-day num-tabular" :class="{ today: d.isToday }">
                      {{ d.label }}
                    </span>
                  </div>
                </div>

                <div class="token-chart-foot">
                  <span class="token-chart-stat">
                    今日
                    <b class="num-tabular">{{ formatTokensCompact(todayUsage().total) }}</b>
                  </span>
                  <span class="token-chart-stat">
                    近7日
                    <b class="num-tabular">{{ formatTokensCompact(sevenDayTotal) }}</b>
                  </span>
                </div>
                <div class="token-chart-life">
                  累计用量
                  <b class="num-tabular">{{ formatTokensCompact(tokenStore.total) }}</b>
                  <span class="token-chart-life-note">（每日细分归零重算）</span>
                </div>
              </div>
            </Transition>
          </Teleport>

          <div class="goal-card">
            <div class="ring-wrap">
              <svg class="ring" viewBox="0 0 60 60">
                <circle class="ring-track" cx="30" cy="30" r="26" />
                <circle
                  class="ring-fill"
                  cx="30"
                  cy="30"
                  r="26"
                  :stroke-dasharray="RING_CIRCUMFERENCE"
                  :stroke-dashoffset="ringOffset"
                />
              </svg>
              <span class="ring-label num-tabular">{{ progress }}%</span>
            </div>

            <div class="goal-body">
              <div class="goal-title">
                <Target :size="14" :stroke-width="1.9" />
                今日写作
              </div>
              <div class="goal-value num-tabular">
                {{ todayCount }}
                <span class="goal-unit">/ {{ homeStore.dailyGoalChars }} 字</span>
              </div>
              <button v-if="!goalEditing" class="goal-edit" @click="startEditGoal">修改目标</button>
              <div v-else class="goal-editor">
                <input
                  v-model="goalDraft"
                  class="goal-input num-tabular"
                  type="number"
                  min="0"
                  @keydown.enter="commitGoal"
                />
                <button class="goal-save" @click="commitGoal">保存</button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- ============ 主体：左侧快捷操作竖排，右侧其余区块上移填充 ============ -->
      <div class="home-body">
        <!-- 左侧竖排快捷操作 -->
        <aside class="action-rail">
          <div class="block-head">
            <h2 class="block-title">快捷操作</h2>
          </div>
          <button
            v-for="action in quickActions"
            :key="action.key"
            class="action-card"
            @click="action.run()"
          >
            <span class="action-lg">
              <span class="action-slide"></span>
              <span class="action-content">
                <span class="action-icon">
                  <component :is="action.icon" :size="18" :stroke-width="1.8" />
                </span>
                <span class="action-label">{{ action.label }}</span>
                <span class="action-desc">{{ action.desc }}</span>
              </span>
            </span>
          </button>
        </aside>

        <div class="home-main">
          <!-- ============ 快速搜索 ============ -->
          <section class="search-section">
            <div class="search-box">
              <Search :size="16" :stroke-width="1.8" />
              <input v-model="query" class="search-input" placeholder="搜索文档标题或正文…" />
            </div>
            <div v-if="query.trim()" class="search-results">
              <div v-if="searchResults.length === 0" class="search-empty">没有匹配的文档</div>
              <button
                v-for="file in searchResults"
                :key="file.id"
                class="search-item"
                @click="openDoc(file.id)"
              >
                <FileText :size="14" :stroke-width="1.8" />
                <span class="search-item-title">{{ file.title }}</span>
                <span class="search-item-meta">{{ folderNameOf(file) }}</span>
                <ArrowRight :size="13" :stroke-width="1.8" class="search-item-go" />
              </button>
            </div>
          </section>

          <div class="two-col">
            <!-- ============ 最近打开 ============ -->
            <section class="block">
              <div class="block-head">
                <h2 class="block-title">
                  <Clock :size="14" :stroke-width="1.9" />
                  最近打开
                </h2>
                <button class="block-link" @click="emit('navigate', 'docs')">
                  全部文档
                  <ArrowRight :size="12" :stroke-width="2" />
                </button>
              </div>

              <div v-if="recent.length === 0" class="empty-hint">
                还没有文档。点击「新建文档」开始，或从本地导入。
              </div>
              <div v-else class="doc-list">
                <div
                  v-for="item in recent"
                  :key="item.file.id"
                  class="doc-row"
                  @click="openDoc(item.file.id)"
                >
                  <FileText :size="15" :stroke-width="1.8" class="doc-row-icon" />
                  <div class="doc-row-main">
                    <div class="doc-row-title" :data-title="item.file.title">{{ item.file.title }}</div>
                    <div class="doc-row-excerpt">{{ excerptOf(item.file) }}</div>
                  </div>
                  <div class="doc-row-side">
                    <span class="doc-row-meta num-tabular">{{ countChars(item.file.content) }} 字</span>
                    <span class="doc-row-time">{{ relativeTime(item.at) }}</span>
                  </div>
                  <button
                    class="pin-btn"
                    :class="{ pinned: isDocPinned(item.file.id) }"
                    :title="isDocPinned(item.file.id) ? '取消置顶' : '置顶到主页'"
                    @click="onTogglePin(item.file.id, $event)"
                  >
                    <component
                      :is="isDocPinned(item.file.id) ? PinOff : Pin"
                      :size="13"
                      :stroke-width="1.8"
                    />
                  </button>
                </div>
              </div>
            </section>

            <!-- ============ 置顶文档 ============ -->
            <section class="block">
              <div class="block-head">
                <h2 class="block-title">
                  <Pin :size="14" :stroke-width="1.9" />
                  置顶文档
                  <span v-if="pinned.length > 0" class="block-meta num-tabular">
                    {{ pinned.length }}
                  </span>
                </h2>
              </div>

              <div v-if="pinned.length === 0" class="empty-hint">
                在「最近打开」里点图钉，就能把常写的文档固定在这里。
              </div>
              <!-- 四张一组（2×2）。超过四张时下方出现分页器，布局高度保持不变。 -->
              <template v-else>
                <div class="pin-grid">
                  <div
                    v-for="file in pinnedPageItems"
                    :key="file.id"
                    class="pin-card"
                    @click="openDoc(file.id)"
                  >
                    <div class="pin-card-head">
                      <span class="pin-card-title">{{ file.title }}</span>
                      <button class="pin-btn pinned" title="取消置顶" @click="onTogglePin(file.id, $event)">
                        <PinOff :size="13" :stroke-width="1.8" />
                      </button>
                    </div>
                    <div class="pin-card-excerpt">{{ excerptOf(file) }}</div>
                    <div class="pin-card-meta">
                      <span>{{ folderNameOf(file) }}</span>
                      <span class="num-tabular">{{ countChars(file.content) }} 字</span>
                    </div>
                  </div>
                  <!-- 末页补位：保持 2×2 网格高度恒定，分页器不会上下窜动 -->
                  <div
                    v-for="i in pinnedPagePlaceholders"
                    :key="`ph-${i}`"
                    class="pin-card-placeholder"
                    aria-hidden="true"
                  ></div>
                </div>

                <nav v-if="pinnedPageCount > 1" class="pin-pager" aria-label="置顶文档分页">
                  <button
                    class="pin-pager-arrow"
                    :disabled="pinnedPage === 0"
                    title="上一页"
                    @click="goPinnedPage(pinnedPage - 1)"
                  >
                    <ChevronLeft :size="14" :stroke-width="2" />
                  </button>
                  <button
                    v-for="n in pinnedPageCount"
                    :key="n"
                    class="pin-pager-dot"
                    :class="{ active: pinnedPage === n - 1 }"
                    :title="`第 ${n} 页`"
                    :aria-current="pinnedPage === n - 1 ? 'page' : undefined"
                    @click="goPinnedPage(n - 1)"
                  >
                    {{ n }}
                  </button>
                  <button
                    class="pin-pager-arrow"
                    :disabled="pinnedPage >= pinnedPageCount - 1"
                    title="下一页"
                    @click="goPinnedPage(pinnedPage + 1)"
                  >
                    <ChevronRight :size="14" :stroke-width="2" />
                  </button>
                </nav>
              </template>
            </section>
          </div>

          <!-- ============ 资料库概览 ============ -->
          <section class="block">
            <div class="block-head">
              <h2 class="block-title">资料库概览</h2>
            </div>
            <div class="stat-grid">
              <button
                v-for="s in stats"
                :key="s.key"
                class="stat-card"
                @click="onStatClick(s)"
              >
                <span class="stat-icon">
                  <component :is="s.icon" :size="16" :stroke-width="1.8" />
                </span>
                <span class="stat-number num-tabular">{{ s.value }}</span>
                <span class="stat-label">{{ s.label }}</span>
                <span class="go-corner" aria-hidden="true">
                  <span class="go-arrow">→</span>
                </span>
              </button>
            </div>
          </section>

          <div class="two-col">
            <!-- ============ 写作灵感 ============ -->
            <section v-if="aiSettings.materialLibraryEnabled" class="block block-fill">
              <div class="block-head">
                <h2 class="block-title">
                  <Lightbulb :size="14" :stroke-width="1.9" />
                  写作灵感
                  <span v-if="inspirationLineCount > 0" class="block-meta num-tabular">
                    {{ inspirationLineCount }} 行
                  </span>
                </h2>
                <button class="block-link" title="换一条" @click="rollInspiration">
                  <Shuffle :size="12" :stroke-width="2" />
                  换一条
                </button>
              </div>

              <div v-if="!inspiration" class="empty-hint">素材库为空。</div>
              <div v-else class="inspiration">
                <div class="inspiration-title">{{ inspiration.title }}</div>
                <div
                  ref="inspirationBodyEl"
                  class="inspiration-scroll"
                  @scroll="onInspirationScroll"
                >
                  <pre class="inspiration-body">{{ inspirationText }}</pre>
                </div>
                <!-- 底部渐隐：仅在还有未读内容时出现 -->
                <div
                  v-if="inspirationOverflow && !inspirationAtEnd"
                  class="inspiration-fade"
                ></div>
              </div>
            </section>

            <!-- ============ 最近修改 ============ -->
            <section class="block block-fill">
              <div class="block-head">
                <h2 class="block-title">
                  <History :size="14" :stroke-width="1.9" />
                  最近修改
                </h2>
                <button class="block-link" @click="emit('navigate', 'insight')">
                  修改记忆
                  <ArrowRight :size="12" :stroke-width="2" />
                </button>
              </div>

              <div v-if="recentEdits.length === 0" class="empty-hint">
                还没有改写记录。在「精修」里润色文本后会出现在这里。
              </div>
              <div v-else class="edit-list">
                <div v-for="item in recentEdits" :key="item.id" class="edit-row">
                  <span class="edit-tag" :style="{ color: item.typeColor }">{{ item.typeLabel }}</span>
                  <div class="edit-texts">
                    <div class="edit-before">{{ item.before.slice(0, 48) }}</div>
                    <div class="edit-after">{{ item.after.slice(0, 48) }}</div>
                  </div>
                  <span class="edit-time">{{ relativeTime(item.at) }}</span>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>

    <!-- 灵感速记已上移为左侧面板（见本模板开头） -->
  </div>
</template>

<style scoped>
.home-view {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
  overflow: hidden;
  background: var(--surface-container-low);
}

/* 内容整体右对齐于面板之后（原先是 max-width + margin: 0 auto 居中）：滚动条随之
   右移，把左侧整条区域让给灵感速记面板。不设 max-width，否则 flex 会在面板左侧留下
   一块死区，面板就贴不住窗口左边。 */
.home-scroll {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 24px 28px 40px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  width: 100%;
  /* 隐藏滚动条但保留滚动：Firefox / 旧 Edge */
  scrollbar-width: none;
  -ms-overflow-style: none;
  /* 供 .home-body / .two-col 的容器查询使用：布局要跟着内容区实际宽度走，
     而不是窗口宽度 —— 用户拖宽灵感面板后内容区会明显变窄。 */
  container: home-page / inline-size;
}

/* 隐藏滚动条但保留滚动：Chromium(WebView2) */
.home-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/* ---------------- Hero ---------------- */

.hero {
  display: flex;
  align-items: center;
  /* 问候语列在左（吃掉所有余量），成对的读数卡片靠 .hero-cards 的
     margin-left:auto 贴住右边缘。 */
  justify-content: flex-start;
  gap: 20px;
  /* 仅作为极窄时的兜底：正常情况下卡片是整体收窄而不是折行。 */
  flex-wrap: wrap;
  padding: 22px 24px;
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgb(var(--primary-rgb) / 0.1), rgb(var(--primary-rgb) / 0.02)),
    var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: var(--shadow);
  /* Token HUD 与「今日写作」共用的盒型：同宽 + 同高，因而宽高比完全一致。
     宽度取 .goal-card 静息态的自然宽（16×2 内边距 + 60 进度环 + 14 间隙 +
     132 文字列 + 2 边框 + 余量 = 256；比旧值 240 略宽一档，给 Token 细分数字
     更多喘息空间，避免 10 万级数字溢出）；高度在其自然高（≈99）上略放宽到 112，
     好让 HUD 竖排的细分项一屏能看到两到三条。
     这两个变量会随内容区宽度逐档收窄（见文件下方的 home-page 容器查询），
     卡片因此能跟着窗口大小自适应，而不是死守 256×112 把 Hero 顶高。 */
  --hero-card-w: 256px;
  --hero-card-h: 112px;
  --hero-cards-gap: 20px;
}

/* 两张读数卡片必须成对：包在同一个网格里，因此永远同行、同宽、同高。
   过去它们是 Hero 的两个独立 flex 项 —— 一旦宽度不够，goal-card 会单独折到
   下一行，再被自己的 margin-left:auto 推到右端，于是出现「Token 在左上、
   今日写作在右下」的对角错位，Hero 也白白高出一整行。现在折行只可能是这一
   对整体发生，且优先通过收窄来避免。 */
.hero-cards {
  /* 不参与拉伸；基准宽度 = 两张卡 + 间隙，随 --hero-card-w 一起变化。
     允许收缩，让卡片在两个断点之间也能连续跟着宽度变化，而不是一路死守到
     断点才跳一次。 */
  flex: 0 1 calc(var(--hero-card-w) * 2 + var(--hero-cards-gap));
  /* 收缩下限：低于这个宽度卡片内容就开始难看，此时宁可整对折到下一行
     （仍是一对，不会对角错位），交给 620px 断点改成上下堆叠。 */
  min-width: calc(var(--hero-card-min-w, 168px) * 2 + var(--hero-cards-gap));
  margin-left: auto;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, var(--hero-card-w)));
  gap: var(--hero-cards-gap);
  /* 余量留在左侧，卡片始终贴右。 */
  justify-content: end;
  align-items: stretch;
}

/* 两张卡片严格同宽同高 —— 宽高比一致是这一对卡片成立的前提。
   宽度交给网格轨道，卡片自己只负责不被内容撑破。 */
.token-hud,
.goal-card {
  width: 100%;
  min-width: 0;
  height: var(--hero-card-h);
  /* 收窄到极限时内部文字自行裁切，绝不反过来把卡片和 Hero 顶高。 */
  overflow: hidden;
}

/* 问候语列吃掉卡片之外的全部余量。flex-basis 取 0、min-width 给一个下限，
   让「换行判定」只看这个下限而不是问候语的自然宽度 —— 否则副标题那一长串
   统计文字会把整对卡片挤到下一行去。 */
.hero-text {
  flex: 1 1 0;
  min-width: 200px;
}

.hero-date {
  font-size: 11px;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.hero-greeting {
  margin: 6px 0;
  font-size: 26px;
  line-height: 1.2;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--on-surface);
}

.hero-sub {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 12.5px;
  color: var(--on-surface-variant);
  font-variant-numeric: tabular-nums;
}

.hero-sub-group {
  display: inline-flex;
  align-items: baseline;
  gap: 3px;
  flex-wrap: wrap;
}

/* 「累计字数」与「洞察·已分析」之间的分隔线 */
.hero-sub-divider {
  width: 1px;
  height: 13px;
  flex-shrink: 0;
  background: var(--outline-variant);
}

.analysis-group {
  color: var(--on-surface-variant);
}

.analysis-sep {
  opacity: 0.6;
  margin: 0 1px;
}

/* ---------------- Token HUD ---------------- */

/* 紧跟问候语左置，与右边缘的「今日写作」等宽等高。刻意用 dashed 边框 +
   低饱和底色区分于实心的 .goal-card：它是「读数」而非「入口」，不该抢走
   进度环的视觉权重。 */
.token-hud {
  display: flex;
  flex-direction: column;
  gap: 3px;
  /* 内边距与 .goal-card 对齐（12/16），保证两张卡片的留白节奏一致。 */
  padding: 12px 16px;
  border-radius: 14px;
  border: 1px dashed var(--outline-variant);
  background: rgb(var(--primary-rgb) / 0.04);
}

.token-hud-top-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.token-hud-total-box {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex-shrink: 0;
}

.token-hud-core-group {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 8px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  flex-shrink: 0;
}

.token-hud-core-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 28px;
}

.token-hud-core-label {
  font-size: 9.5px;
  color: var(--on-surface-variant);
  opacity: 0.8;
  white-space: nowrap;
}

.token-hud-core-value {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  white-space: nowrap;
}

.token-hud-head {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--on-surface-variant);
  white-space: nowrap;
  flex-shrink: 0;
}

.token-hud-head svg {
  color: var(--primary);
  opacity: 0.75;
}

/* 「Token 总量」字样右侧的 7 天用量入口 */
.token-chart-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 2px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.token-chart-btn:hover,
.token-chart-btn.open {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.token-chart-btn svg {
  opacity: 1;
}

.token-hud-total {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--on-surface);
}

.token-hud-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 2px;
  padding-top: 5px;
  border-top: 1px solid var(--outline-variant);
  /* 卡片高度已固定，分项超出可视区时内部滚动，绝不把卡片撑高。 */
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.token-hud-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.token-hud-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10.5px;
  /* 收紧行高：卡片高度锁死后，这里每省下的几像素都会变成「露出下一行一角」，
     那道半截的行本身就是「还能往下滚」的提示。 */
  line-height: 1.4;
  color: var(--on-surface-variant);
}

.token-hud-label {
  flex: 0 0 34px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 细占比条：只是量级提示，宽度固定，避免数字被挤到换行。 */
.token-hud-bar {
  flex: 1;
  min-width: 12px;
  height: 3px;
  border-radius: 999px;
  background: var(--surface-container-high);
  overflow: hidden;
}

.token-hud-bar-fill {
  display: block;
  height: 100%;
  border-radius: 999px;
  background: var(--primary);
  opacity: 0.55;
  transition: width 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}

.token-hud-value {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  color: var(--on-surface);
  opacity: 0.85;
}

.token-hud-empty {
  font-size: 10.5px;
  line-height: 1.5;
  color: var(--on-surface-variant);
  opacity: 0.8;
}

/* ---------------- 近 7 天用量柱状图浮层 ---------------- */

.token-chart-pop {
  position: fixed;
  z-index: 1200;
  width: 236px;
  padding: 10px 12px 8px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: var(--shadow-elevation-2, 0 10px 28px rgb(0 0 0 / 0.2));
}

.token-chart-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface);
  padding-bottom: 6px;
}

.token-chart-head svg {
  color: var(--primary);
}

.token-chart-bars {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.token-chart-col {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: default;
}

.token-chart-track {
  width: 100%;
  height: 64px;
  display: flex;
  align-items: flex-end;
  border-bottom: 1px solid var(--outline-variant);
}

.token-chart-bar {
  width: 100%;
  max-width: 18px;
  margin: 0 auto;
  border-radius: 3px 3px 0 0;
  background: var(--primary);
  opacity: 0.45;
  transition: height 0.3s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

.token-chart-bar.today {
  opacity: 1;
}

.token-chart-bar.empty {
  background: var(--surface-container-high);
  opacity: 1;
}

.token-chart-day {
  font-size: 9.5px;
  line-height: 1;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.token-chart-day.today {
  color: var(--primary);
  font-weight: 700;
}

.token-chart-foot {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-top: 8px;
  padding-top: 7px;
  border-top: 1px solid var(--outline-variant);
}

.token-chart-stat {
  font-size: 10.5px;
  color: var(--on-surface-variant);
}

.token-chart-stat b {
  margin-left: 2px;
  color: var(--on-surface);
  font-weight: 600;
}

.token-chart-life {
  margin-top: 5px;
  display: flex;
  align-items: baseline;
  gap: 4px;
  font-size: 10.5px;
  color: var(--on-surface-variant);
}

.token-chart-life b {
  color: var(--primary);
  font-weight: 600;
}

.token-chart-life-note {
  margin-left: auto;
  font-size: 9px;
  opacity: 0.8;
  white-space: nowrap;
}

.token-chart-enter-active,
.token-chart-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
  transform-origin: top right;
}

.token-chart-enter-from,
.token-chart-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.98);
}

.goal-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border-radius: 14px;
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
}

.ring-wrap {
  position: relative;
  width: var(--goal-ring-size, 60px);
  height: var(--goal-ring-size, 60px);
  flex-shrink: 0;
}

.ring {
  width: var(--goal-ring-size, 60px);
  height: var(--goal-ring-size, 60px);
  transform: rotate(-90deg);
}

.ring-track {
  fill: none;
  stroke: var(--surface-container-high);
  stroke-width: 6;
}

.ring-fill {
  fill: none;
  stroke: var(--primary);
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.5s cubic-bezier(0.16, 1, 0.3, 1);
}

.ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
}

/* 不再用 min-width 硬撑：卡片收窄时这一列跟着收，文字自行省略，
   避免内容反过来把卡片顶宽、把整对卡片挤到下一行。 */
.goal-body {
  flex: 1;
  min-width: 0;
}

.goal-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.goal-title svg {
  flex-shrink: 0;
  color: var(--primary);
}

.goal-value {
  margin-top: 4px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.goal-unit {
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface-variant);
  margin-left: 2px;
}

.goal-edit {
  margin-top: 4px;
  font-size: 11px;
  color: var(--primary);
  white-space: nowrap;
}

.goal-edit:hover {
  text-decoration: underline;
}

.goal-editor {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.goal-input {
  width: 100%;
  max-width: 78px;
  min-width: 0;
  padding: 3px 6px;
  font-size: 12px;
  border-radius: 6px;
  border: 1px solid var(--primary);
  outline: none;
  background: var(--surface-bright);
  color: var(--on-surface);
}

.goal-save {
  flex-shrink: 0;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 6px;
  color: var(--on-primary-container);
  background: var(--primary);
}

/* ---------------- Hero 自适应：卡片随内容区宽度逐档收窄 ---------------- */

/* 断点按内容区（.home-scroll）实际宽度判定，而不是窗口宽度 —— 用户拖宽右侧
   灵感面板、或展开 AI 侧栏时，内容区会明显变窄，判定必须跟着它走。
   收窄顺序：先压卡片宽度 → 再压进度环与字号 → 最后才允许换行堆叠。 */

/* 档一：卡片整体收窄，仍并排贴右。 */
@container home-page (max-width: 900px) {
  .hero {
    --hero-card-w: 216px;
    --hero-cards-gap: 14px;
    --hero-card-min-w: 160px;
  }

  .hero-text {
    min-width: 170px;
  }
}

/* 档二：进度环与总量字号一起缩，卡片可以再窄一截而不溢出。 */
@container home-page (max-width: 780px) {
  .hero {
    --hero-card-w: 186px;
    --hero-card-h: 104px;
    --hero-cards-gap: 12px;
    --hero-card-min-w: 148px;
    padding: 18px 18px;
  }

  .hero-cards {
    --goal-ring-size: 48px;
  }

  .goal-card,
  .token-hud {
    padding: 10px 12px;
  }

  .goal-card {
    gap: 10px;
  }

  .token-hud-total {
    font-size: 18px;
  }

  .goal-value {
    font-size: 17px;
  }

  .hero-greeting {
    font-size: 22px;
  }

  .hero-text {
    min-width: 150px;
  }
}

/* 档三：确实放不下并排了，问候语与卡片上下堆叠。此时卡片对仍是一个整体，
   两张各占一半宽度平分，不会出现一张在左上、另一张在右下的对角错位。 */
@container home-page (max-width: 620px) {
  .hero {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }

  .hero-cards {
    /* flex:none 让基准宽度失效，宽度完全交给下面的网格轨道平分；
       min-width 一并解除，避免竖排时反过来撑出横向滚动。 */
    flex: none;
    width: 100%;
    min-width: 0;
    margin-left: 0;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    justify-content: stretch;
  }

  .hero-text {
    min-width: 0;
  }
}

/* 档四：两张并排都塞不下时才竖排，高度改为按内容自适应。 */
@container home-page (max-width: 420px) {
  .hero-cards {
    grid-template-columns: minmax(0, 1fr);
  }

  .token-hud,
  .goal-card {
    height: auto;
    min-height: var(--hero-card-h);
  }
}

/* ---------------- 搜索 ---------------- */

.search-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* 参考 ErzenXz 输入框动效（配色改用项目主题色，不照搬 lightgrey/grey）：
   悬停加粗边框 + 柔光、按下轻微缩放、聚焦主色描边 */
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1.5px solid var(--outline-variant);
  color: var(--on-surface-variant);
  transition: all 0.3s cubic-bezier(0.19, 1, 0.22, 1);
  box-shadow: 0px 0px 20px -18px rgb(var(--primary-rgb) / 0.8);
  cursor: text;
}

.search-box:hover {
  border-width: 2px;
  border-color: var(--outline-variant);
  box-shadow: 0px 0px 20px -17px rgb(var(--primary-rgb) / 0.8);
}

.search-box:active {
  transform: scale(0.97);
}

.search-box:focus-within {
  border-width: 2px;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb) / 0.12), 0px 0px 24px -12px rgb(var(--primary-rgb) / 0.8);
}

.search-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  font-size: 13.5px;
  color: var(--on-surface);
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: var(--shadow);
}

.search-empty {
  padding: 10px;
  font-size: 12.5px;
  color: var(--on-surface-variant);
  text-align: center;
}

.search-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;
  color: var(--on-surface);
  font-size: 13px;
}

.search-item:hover {
  background: var(--surface-container-high);
}

.search-item svg {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.search-item-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-item-meta {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.search-item-go {
  color: var(--primary) !important;
}

/* ---------------- 通用区块 ---------------- */

.block {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}

.block-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.block-title {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--on-surface);
}

.block-title svg {
  color: var(--primary);
}

/* 标题右侧的轻量计数（如素材行数） */
.block-meta {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 999px;
  color: var(--on-surface-variant);
  background: var(--surface-container-high);
}

.block-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--primary);
  padding: 3px 8px;
  border-radius: 6px;
}

.block-link:hover {
  background: rgb(var(--primary-rgb) / 0.1);
}

.empty-hint {
  padding: 18px 16px;
  border-radius: 12px;
  border: 1px dashed var(--outline-variant);
  background: var(--surface-bright);
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--on-surface-variant);
}

/* 「写作灵感」与「最近修改」的内容框高度固定。
   
   之前这两块会随内容长短抽动，根因有两个，缺一不可：
   1) 两者同处一个 `.two-col` grid 行，行高按 auto 由内容决定，`align-items`
      默认 stretch，于是行高 = max(灵感正文自然高, 修改列表条数高)；
   2) `.block-fill > *` 用 `flex: 1` 去吃剩余高度 —— 剩余高度本身就是被内容
      撑出来的，所以「等高」只保证左右一致，并不保证跨内容稳定。
      换一条更长的素材、或修改记录从 2 条涨到 4 条，行高就跟着变。
   
   这里直接把内容框钉在固定值上（= 修改列表满 4 条时的现有高度：
   6px 内边距 ×2 + 4 行 ×54.8px + 3 个 4px 间隙 + 2px 边框 ≈ 246px），
   溢出交给内部滚动。行高从此与内容无关。 */
.block-fill {
  --home-block-h: 246px;
}

.block-fill > .inspiration,
.block-fill > .edit-list,
.block-fill > .empty-hint {
  flex: none;
  height: var(--home-block-h);
  min-height: 0;
}

/* 记录不足 4 条时下方留白，不再把列表拉伸；超出则内部滚动。 */
.block-fill > .edit-list {
  overflow-y: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.block-fill > .edit-list::-webkit-scrollbar {
  width: 0;
  height: 0;
}

.block-fill > .empty-hint {
  overflow-y: auto;
}

/* 单列回落时不需要额外规则：固定高度对两种排布都成立。 */

.two-col {
  display: grid;
  grid-template-columns: 1fr;
  gap: 20px;
}

/* 按主体自身宽度决定列数，而不是窗口宽度 —— 用户把灵感面板拖宽后，
   主体变窄就要及时回落到单列。 */
@container home-main (min-width: 700px) {
  .two-col {
    grid-template-columns: 1.15fr 1fr;
  }
}

/* ---------------- 主体两栏：左侧快捷操作栏 + 右侧内容 ---------------- */

.home-body {
  display: flex;
  align-items: flex-start;
  gap: 20px;
  min-width: 0;
}

/* 左侧竖排快捷操作。宽度取原先网格单元的尺寸，卡片内边距与内容不变，
   因此每张卡片的宽高比与横排时保持一致。 */
.action-rail {
  flex: 0 0 158px;
  width: 158px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: sticky;
  top: 0;
}

.home-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 20px;
  /* 供 .two-col 的容器查询使用 */
  container: home-main / inline-size;
}

@container home-page (max-width: 860px) {
  /* 窄内容区回退为上下堆叠，快捷操作恢复横向自适应网格 */
  .home-body {
    flex-direction: column;
  }

  .action-rail {
    flex: none;
    width: 100%;
    position: static;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  }

  .action-rail .block-head {
    grid-column: 1 / -1;
  }
}

/* ---------------- 快捷操作 ----------------
   参考 mrhyddenn 的双层边框 + 斜切滑动填充动效，配色全部改用项目主题色：
   - ::before / ::after 拼成上下两段边框（hover 时点亮为主题色）
   - :active 时边框向内收缩 3px，模拟“按压”反馈
   - .action-slide 斜切填充条悬停时从左滑入（背景为主色柔光） */

.action-card {
  -moz-appearance: none;
  -webkit-appearance: none;
  appearance: none;
  border: none;
  background: none;
  cursor: pointer;
  position: relative;
  padding: 6px;
  font-family: inherit;
  text-align: left;
  transition: transform 0.15s ease;
}

.action-card::before,
.action-card::after {
  content: '';
  display: block;
  position: absolute;
  left: 0;
  right: 0;
  height: calc(50% - 4px);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  pointer-events: none;
  transition: all 0.15s ease;
}

.action-card::before {
  top: 0;
  border-bottom-width: 0;
  border-bottom-left-radius: 0;
  border-bottom-right-radius: 0;
}

.action-card::after {
  bottom: 0;
  border-top-width: 0;
  border-top-left-radius: 0;
  border-top-right-radius: 0;
}

.action-card:active::before,
.action-card:active::after {
  left: 3px;
  right: 3px;
}

.action-card:active::before {
  top: 3px;
}

.action-card:active::after {
  bottom: 3px;
}

.action-card:active {
  outline: none;
}

.action-card:hover {
  transform: translateY(-1px);
}

.action-card:hover::before,
.action-card:hover::after {
  border-color: var(--primary);
}

.action-lg {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  overflow: hidden;
  padding: 14px;
  border-radius: 7px;
  background: var(--surface-bright);
  box-shadow: inset 0 0 0 1px var(--outline-variant);
  transition: box-shadow 0.18s ease;
}

.action-card:hover .action-lg {
  box-shadow: inset 0 0 0 1px rgba(var(--primary-rgb) / 0.35);
}

.action-slide {
  display: block;
  position: absolute;
  top: 0;
  bottom: 0;
  left: -10px;
  width: 0;
  background: linear-gradient(90deg, rgba(var(--primary-rgb) / 0.14), var(--primary-fixed-dim));
  transform: skew(-15deg);
  transition: width 0.22s ease;
  pointer-events: none;
}

.action-card:hover .action-slide {
  width: calc(100% + 20px);
}

.action-lg::after {
  content: '';
  display: block;
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 5px;
  height: 5px;
  border-radius: 2px;
  background: var(--primary-container);
  opacity: 0;
  transform: translateY(2px);
  transition: all 0.2s ease;
  pointer-events: none;
}

.action-card:hover .action-lg::after {
  opacity: 1;
  background: var(--primary);
  transform: translateY(0);
}

.action-content {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  z-index: 1;
}

.action-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  margin-bottom: 6px;
  border-radius: 9px;
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
  transition: background 0.18s ease, color 0.18s ease;
}

.action-card:hover .action-icon {
  background: var(--primary);
  color: #fff;
}

.action-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.action-desc {
  font-size: 11.5px;
  color: var(--on-surface-variant);
}

/* ---------------- 文档列表 ---------------- */

.doc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
}

.doc-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.doc-row:hover {
  background: var(--surface-container);
}

/* 参考 satyamchaudharydev 按钮动效（配色改用项目主题色）：
   悬停时底部主题色下划线从左侧生长到满宽 */
.doc-row::after {
  position: absolute;
  content: '';
  width: 0;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--primary);
  box-shadow: 0 0 6px rgb(var(--primary-rgb) / 0.45);
  transition: width 0.3s ease-out;
  pointer-events: none;
}

.doc-row:hover::after {
  width: 100%;
}

.doc-row-icon {
  flex-shrink: 0;
  color: var(--on-surface-variant);
  transition: color 0.2s ease, transform 0.2s ease;
}

.doc-row:hover .doc-row-icon {
  color: var(--primary);
  transform: translateX(3px);
}

.doc-row-main {
  flex: 1;
  min-width: 0;
}

.doc-row-title {
  position: relative;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 文字填充扫描：悬停时标题文字从左到右“刷”成主题色 */
.doc-row-title::before {
  content: attr(data-title);
  position: absolute;
  inset: 0;
  width: 0%;
  overflow: hidden;
  white-space: nowrap;
  color: var(--primary);
  transition: width 0.3s ease-out;
  pointer-events: none;
}

.doc-row:hover .doc-row-title::before {
  width: 100%;
}

.doc-row-excerpt {
  font-size: 11.5px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.doc-row-side {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.doc-row-time {
  opacity: 0.85;
}

.pin-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.doc-row:hover .pin-btn,
.pin-card:hover .pin-btn {
  opacity: 1;
}

.pin-btn.pinned {
  opacity: 1;
  color: var(--primary);
}

.pin-btn:hover {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

/* ---------------- 置顶卡片 ---------------- */

/* 固定 2×2：四张一组，第五张起翻页。列数不随宽度变化，否则「一组四张」的
   分页语义会被网格自动折行破坏。 */
.pin-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

/* 末页补位：只占格子，不画任何东西 */
.pin-card-placeholder {
  border-radius: 12px;
  border: 1px dashed var(--outline-variant);
  opacity: 0.45;
}

/* ---------------- 置顶分页器 ---------------- */

.pin-pager {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

.pin-pager-arrow,
.pin-pager-dot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  min-width: 22px;
  padding: 0 5px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
  font-variant-numeric: tabular-nums;
}

.pin-pager-arrow:hover:not(:disabled),
.pin-pager-dot:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.pin-pager-arrow:disabled {
  opacity: 0.35;
  cursor: default;
}

.pin-pager-dot.active {
  color: var(--on-primary-container);
  background: var(--primary);
}

.pin-pager-dot.active:hover {
  color: var(--on-primary-container);
  background: var(--primary);
}

.pin-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  cursor: pointer;
  transition: border-color 0.18s ease, box-shadow 0.18s ease, transform 0.12s ease;
}

.pin-card:hover {
  border-color: var(--primary);
  box-shadow: var(--shadow);
  transform: translateY(-1px);
}

.pin-card-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.pin-card-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pin-card-excerpt {
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.pin-card-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10.5px;
  color: var(--on-surface-variant);
  opacity: 0.9;
}

/* ---------------- 统计 ---------------- */

.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(128px, 1fr));
  gap: 10px;
}

.stat-card {
  position: relative;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 13px 14px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  transition: border-color 0.18s ease, transform 0.12s ease;
}

/* 参考 Prince4fff 卡片动效（配色改用项目主题色，不照搬 #00838d）：
   悬停时右上角主题色圆斑放大铺满整卡，图标 / 数字 / 标签转为白色 */
.stat-card::before {
  content: "";
  position: absolute;
  z-index: 0;
  top: -16px;
  right: -16px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 0 24px rgb(var(--primary-rgb) / 0.5);
  transform: scale(1);
  transform-origin: 50% 50%;
  transition: transform 0.25s ease-out;
}

.stat-card:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
}

.stat-card:hover::before {
  transform: scale(30);
}

.stat-icon,
.stat-number,
.stat-label,
.go-corner {
  position: relative;
  z-index: 1;
  transition: color 0.3s ease-out;
}

.stat-icon {
  display: inline-flex;
  margin-bottom: 4px;
  color: var(--primary);
}

.stat-number {
  font-size: 20px;
  font-weight: 700;
  color: var(--on-surface);
}

.stat-label {
  font-size: 11.5px;
  color: var(--on-surface-variant);
}

.stat-card:hover .stat-icon,
.stat-card:hover .stat-number,
.stat-card:hover .stat-label {
  color: #fff;
}

/* 右上角“前往”角标（圆角切角 + 白色箭头） */
.go-corner {
  display: flex;
  align-items: center;
  justify-content: center;
  position: absolute;
  top: 0;
  right: 0;
  width: 32px;
  height: 32px;
  overflow: hidden;
  background: var(--primary);
  border-radius: 0 12px 0 32px;
}

.go-arrow {
  margin-top: -4px;
  margin-right: -4px;
  color: #fff;
  font-family: courier, monospace;
  font-size: 17px;
  line-height: 1;
}

/* ---------------- 灵感 ---------------- */

/* 写作灵感：外框与「最近修改」等高，正文在内部滚动，
   高度由 flex 拉伸决定，不再依赖固定行数。 */
.inspiration {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-left: 3px solid var(--primary);
}

.inspiration-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  /* 隐藏滚动条但保留滚动，与主页其他滚动区一致 */
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.inspiration-scroll::-webkit-scrollbar {
  width: 0;
  height: 0;
}

/* 还有未读内容时，底部淡出提示可以继续滚 */
.inspiration-fade {
  position: absolute;
  left: 3px;
  right: 1px;
  bottom: 1px;
  height: 30px;
  border-radius: 0 0 11px 11px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--surface-bright));
}

.inspiration-title {
  flex-shrink: 0;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--primary);
  margin-bottom: 6px;
}

.inspiration-body {
  margin: 0;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.75;
  color: var(--on-surface-variant);
  white-space: pre-wrap;
  word-break: break-word;
}

/* ---------------- 修改记录 ---------------- */

.edit-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
}

.edit-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 9px;
}

.edit-row:hover {
  background: var(--surface-container);
}

.edit-tag {
  flex-shrink: 0;
  font-size: 10.5px;
  font-weight: 600;
  padding-top: 2px;
  min-width: 52px;
}

.edit-texts {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  line-height: 1.6;
}

.edit-before {
  color: var(--on-surface-variant);
  text-decoration: line-through;
  opacity: 0.75;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-after {
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.edit-time {
  flex-shrink: 0;
  font-size: 10.5px;
  color: var(--on-surface-variant);
  padding-top: 2px;
}
</style>
