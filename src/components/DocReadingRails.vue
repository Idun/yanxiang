<script setup lang="ts">
/**
 * 文档界面 WYSIWYG 阅读辅助侧栏（嵌入纸面两侧留白区，绝对不影响中间阅读区域宽度）：
 * - 左栏（纸面左留白）：当前章节出场人物星图 —— 支持 AI 深度提炼缓存 + 本地启发式即时提取，
 *   宽屏下展开呈现大字号星图与人物快跳标签；支持点击展开/收起；
 * - 右栏（纸面右留白）：本章地图地点（与地图连通）+ 章节细纲轴（本节构成、伏笔呈现、收回点），
 *   自动匹配当前所在章节，可点击导航跳到正文块；支持点击展开/收起。
 *
 * 全界面无英文副标题，纯中文高颜值浅色系呈现。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clover,
  Compass,
  FileText,
  MapPin,
  RotateCw,
  Sparkles,
  Star,
  Waypoints,
} from "lucide-vue-next";
import { documentFilesStore } from "../documentFilesStore";
import { mapStore, PLACE_ICON_COLORS } from "../mapStore";
import { hashText, getDocInsight } from "../docInsightStore";
import { extractInsightsFromChapter, type InsightExtractResult } from "../docInsightAgent";
import { showToast } from "../insightStore";
import {
  buildPayoffMap,
  detectChapterInfo,
  detectChapterNumber,
  findDetailedOutlineFile,
  isNonMainDocument,
  parseVolumeOutline,
  pickBestBlock,
  splitChapters,
  toSearchKey,
  type OutlineChapter,
} from "../docReadingInsights";

const props = defineProps<{
  content: string;
  fileId?: string | null;
  marginX?: number;
}>();

/* ---------------- 1. 屏蔽非正文规划文档（大纲 / 细纲 / 设定等自身编辑时屏蔽侧轨） ---------------- */
const currentFile = computed(() =>
  props.fileId ? documentFilesStore.files.find((f) => f.id === props.fileId) : undefined,
);

const isShielded = computed(() => isNonMainDocument(currentFile.value));

/* ---------------- 展开 / 收起 交互状态 ---------------- */
const leftExpanded = ref(false);
const rightExpanded = ref(false);
const sectionsCollapsed = ref(false);
const expandedTexts = ref<Record<string, boolean>>({});

let leftCloseTimer: number | null = null;
let rightCloseTimer: number | null = null;

function onLeftEnter() {
  if (leftCloseTimer !== null) {
    window.clearTimeout(leftCloseTimer);
    leftCloseTimer = null;
  }
  leftExpanded.value = true;
}

function onLeftLeave() {
  if (leftCloseTimer !== null) {
    window.clearTimeout(leftCloseTimer);
  }
  leftCloseTimer = window.setTimeout(() => {
    leftExpanded.value = false;
    leftCloseTimer = null;
  }, 220);
}

function closeLeftImmediate() {
  if (leftCloseTimer !== null) {
    window.clearTimeout(leftCloseTimer);
    leftCloseTimer = null;
  }
  leftExpanded.value = false;
}

function onRightEnter() {
  if (rightCloseTimer !== null) {
    window.clearTimeout(rightCloseTimer);
    rightCloseTimer = null;
  }
  rightExpanded.value = true;
}

function onRightLeave() {
  if (rightCloseTimer !== null) {
    window.clearTimeout(rightCloseTimer);
  }
  rightCloseTimer = window.setTimeout(() => {
    rightExpanded.value = false;
    rightCloseTimer = null;
  }, 220);
}

function closeRightImmediate() {
  if (rightCloseTimer !== null) {
    window.clearTimeout(rightCloseTimer);
    rightCloseTimer = null;
  }
  rightExpanded.value = false;
}

/* ---------------- 展开/折叠辅助方法 ---------------- */
function isExpanded(key: string): boolean {
  return !!expandedTexts.value[key];
}

function toggleExpand(key: string) {
  expandedTexts.value[key] = !expandedTexts.value[key];
}

/* ---------------- 实时几何测量（精确测量纸面两侧留白区） ---------------- */
const rootEl = ref<HTMLDivElement | null>(null);
const paneEl = ref<HTMLElement | null>(null);
const scrollEl = ref<HTMLElement | null>(null);
const editorEl = ref<HTMLElement | null>(null);
const paperEl = ref<HTMLElement | null>(null);

const leftGutterPx = ref(160);
const rightGutterPx = ref(160);
const scrollbarWidthPx = ref(6);

let resizeObserver: ResizeObserver | null = null;
let mutationObserver: MutationObserver | null = null;

function measureGeometry() {
  const pane = paneEl.value;
  const editor = editorEl.value;
  const scroll = scrollEl.value;
  if (!pane || !editor) return;

  const paneRect = pane.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();

  const leftG = Math.max(0, editorRect.left - paneRect.left);
  const rightG = Math.max(0, paneRect.right - editorRect.right);

  let sbWidth = 0;
  if (scroll) {
    sbWidth = Math.max(0, scroll.offsetWidth - scroll.clientWidth);
  }

  leftGutterPx.value = Math.round(leftG);
  rightGutterPx.value = Math.round(rightG);
  scrollbarWidthPx.value = Math.round(sbWidth);
}

const leftRailWidth = computed(() => {
  const avail = Math.max(0, leftGutterPx.value - 46);
  return Math.min(270, Math.max(130, avail));
});

const rightRailWidth = computed(() => {
  const avail = Math.max(0, rightGutterPx.value - 30 - scrollbarWidthPx.value);
  return Math.min(280, Math.max(140, avail));
});

const hasEnoughLeftSpace = computed(() => leftGutterPx.value >= 110);
const hasEnoughRightSpace = computed(() => rightGutterPx.value >= 110);

/* ---------------- 章节解析（解析规则见 ../docReadingInsights.ts） ---------------- */
const currentChapterNum = ref<number | null>(null);
const chapterHeadEls = ref<{ num: number; label: string; title: string; el: HTMLElement }[]>([]);

function collectChapterHeadEls() {
  if (!editorEl.value) return;
  const hits: { num: number; label: string; title: string; el: HTMLElement }[] = [];
  const blocks = Array.from(editorEl.value.querySelectorAll<HTMLElement>(".md-block"));
  for (const b of blocks) {
    const text = (b.innerText || "").trim();
    if (!text) continue;
    const isHeadingBlock =
      b.tagName === "H1" ||
      b.tagName === "H2" ||
      b.tagName === "H3" ||
      b.classList.contains("md-block-heading") ||
      /^(?:#{1,6}\s+|——\s*)?(?:序章|前言|楔子|引子|序言|序|尾声|后记|结语|附录|番外篇|番外|外传|第\s*[0-9一二三四五六七八九十百零]+\s*章|Chapter\s*\d+)/i.test(text);

    if (!isHeadingBlock) continue;

    const info = detectChapterInfo(text);
    if (info !== null) {
      hits.push({ num: info.num, label: info.label, title: info.title, el: b });
    }
  }
  hits.sort((a, b) => a.el.offsetTop - b.el.offsetTop);
  chapterHeadEls.value = hits;
  updateCurrentChapter();
}

function updateCurrentChapter() {
  const sc = scrollEl.value;
  if (!sc) return;
  const scRect = sc.getBoundingClientRect();
  const probeY = scRect.top + 140;

  let cur: number | null = null;
  for (const h of chapterHeadEls.value) {
    const rect = h.el.getBoundingClientRect();
    if (rect.top <= probeY) {
      cur = h.num;
    } else {
      break;
    }
  }
  if (cur === null && chapterHeadEls.value.length > 0) {
    cur = chapterHeadEls.value[0].num;
  }
  if (cur === null) {
    cur = detectChapterNumber(props.content || "");
  }
  currentChapterNum.value = cur;
}

function onRailScroll() {
  updateCurrentChapter();
}

function attachDom() {
  const root = rootEl.value;
  if (!root) return;

  const pane = root.closest<HTMLElement>(".wysiwyg-pane") ?? null;
  paneEl.value = pane;
  if (!pane) return;

  const sc = pane.querySelector<HTMLElement>(".wysiwyg-scroll") ?? null;
  scrollEl.value = sc;
  editorEl.value = pane.querySelector<HTMLElement>(".wysiwyg-editor") ?? null;
  paperEl.value = pane.querySelector<HTMLElement>(".paper-card") ?? null;

  sc?.addEventListener("scroll", onRailScroll, { passive: true });

  if (typeof ResizeObserver !== "undefined") {
    resizeObserver = new ResizeObserver(() => {
      measureGeometry();
    });
    resizeObserver.observe(pane);
    if (editorEl.value) resizeObserver.observe(editorEl.value);
  }

  if (editorEl.value && typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(() => {
      collectChapterHeadEls();
    });
    mutationObserver.observe(editorEl.value, { childList: true, subtree: true, characterData: true });
  }

  nextTick(() => {
    measureGeometry();
    collectChapterHeadEls();
  });
}

function detachDom() {
  if (leftCloseTimer !== null) {
    window.clearTimeout(leftCloseTimer);
    leftCloseTimer = null;
  }
  if (rightCloseTimer !== null) {
    window.clearTimeout(rightCloseTimer);
    rightCloseTimer = null;
  }
  scrollEl.value?.removeEventListener("scroll", onRailScroll);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  resizeObserver = null;
  mutationObserver = null;
  scrollEl.value = null;
  editorEl.value = null;
  paperEl.value = null;
  paneEl.value = null;
  chapterHeadEls.value = [];
}

onMounted(() => {
  attachDom();
});

onBeforeUnmount(() => {
  detachDom();
});

watch(
  () => props.content,
  () => {
    nextTick(() => requestAnimationFrame(collectChapterHeadEls));
  },
);

watch(
  () => props.fileId,
  () => {
    nextTick(() => {
      measureGeometry();
      collectChapterHeadEls();
    });
  },
);

/* ---------------- 章节内容切分 ---------------- */
const chapterSlices = computed(() => splitChapters(props.content || ""));
const currentChapterText = computed(() => {
  if (currentChapterNum.value === null) {
    return props.content || "";
  }
  const ch = chapterSlices.value.find((c) => c.num === currentChapterNum.value);
  return ch ? props.content.slice(ch.start, ch.end) : props.content || "";
});

const currentChapterHash = computed(() => hashText(currentChapterText.value.trim()));

const storedInsight = computed(() =>
  props.fileId ? getDocInsight(props.fileId) : undefined,
);

const insightValid = computed(
  () =>
    !!storedInsight.value &&
    storedInsight.value.chapterNum === currentChapterNum.value &&
    storedInsight.value.contentHash === currentChapterHash.value,
);

const extracting = ref(false);
const extractionError = ref(false);

async function runExtraction() {
  if (!props.fileId || extracting.value) return;
  extracting.value = true;
  extractionError.value = false;
  try {
    const result: InsightExtractResult | null = await extractInsightsFromChapter(
      props.fileId,
      currentChapterNum.value,
      currentChapterText.value,
    );
    if (result) {
      showToast("提取完成", `AI 识别出 ${result.characters.length} 位人物、${result.places.length} 处地点`, "habit");
    }
  } catch (err: any) {
    extractionError.value = true;
    showToast("提取失败", err?.message || "AI 请求出错，请稍后重试", "edit");
  } finally {
    extracting.value = false;
  }
}

/* ---------------- 人物星图提取 ---------------- */
interface CharacterNode {
  name: string;
  count?: number;
}

const CHINESE_NAME_STOP_WORDS = new Set([
  "突然", "然后", "此时", "此刻", "当下", "接着", "随后", "片刻", "以前", "以后",
  "原本", "原来", "之前", "之后", "同时", "一时", "最后", "开始", "因为", "所以",
  "但是", "如果", "结果", "即使", "虽然", "哪怕", "况且", "以及", "甚至", "或者",
  "既然", "反而", "反正", "总之", "不过", "由于", "几乎", "完全", "绝对", "肯定",
  "自己", "对方", "众人", "他们", "我们", "你们", "有人", "大家", "任何人", "彼此",
  "旁人", "手下", "属下", "四周", "周围", "面前", "眼前", "心里", "心中", "身上",
  "长老", "宗主", "师父", "掌门", "陛下", "殿下", "将军", "少爷", "小姐", "大人",
  "前辈", "晚辈", "徒弟", "弟子", "门人", "声音", "目光", "脸色", "表情", "眼神",
  "动作", "神情", "双手", "手掌", "头颅", "双眼", "脚步", "身影", "气息", "力量",
  "黑衣人", "白衣人", "神秘人", "蒙面人", "时间", "地方", "现在", "意思", "天下",
  "人间", "世界", "前面", "后面", "左边", "右边", "上面", "下面", "其中", "刹那",
  "瞬间", "重新", "再次", "反复", "不断", "频繁", "偶尔", "极其", "非常", "格外",
  "十分", "分外", "相当", "稍微", "略微", "难怪", "幸亏", "好在", "偏偏", "偏要",
  "何必", "何苦", "难道", "莫非", "未免", "难免", "不妨", "不如", "与其", "比起",
  "关于", "对于", "至于", "根据", "按照", "基于", "为了", "凭着", "通过", "借由",
  "随着", "顺着", "沿着", "朝向", "对准", "冲着", "奔着", "连同", "另外", "此外",
  "紧接着", "其实", "到底", "究竟", "一般", "一样", "如同", "仿佛", "好像", "似乎",
  "宛如", "好似", "恰似", "或者", "还是", "甚至", "而且", "何况", "固然", "倘若",
  "假使", "要不", "继续", "终于", "准备", "已经", "知道", "明白", "发现", "感觉",
  "想到", "听到", "看到", "说道", "笑着", "哭着", "喊道", "笑道", "叹道", "问者",
  "回答", "说明", "解释", "思考", "沉默", "摇摇", "点头", "低声", "轻声", "冷笑",
  "怒道", "吼道", "大声", "小声", "轻语", "微笑道", "冷哼", "哼道", "应道", "答道"
]);

function isValidCharacterName(name: string): boolean {
  if (!name || name.length < 2 || name.length > 4) return false;
  if (!/^[\u4e00-\u9fa5]+$/.test(name)) return false;
  if (CHINESE_NAME_STOP_WORDS.has(name)) return false;
  const badSubWords = ["知道", "明白", "发现", "感觉", "听到", "看到", "说道", "笑着", "哭着", "喊道", "就是", "只是", "说是", "也是"];
  if (badSubWords.some((w) => name.includes(w))) return false;
  return true;
}

function extractCharacters(text: string): CharacterNode[] {
  if (!text) return [];
  const scoreMap = new Map<string, number>();

  const quoteReg = /“[^”]{1,100}”[,\s]*([\u4e00-\u9fa5]{2,4})(?:[道说笑叹怒问答鸣叫喊吐喝]|轻声|低语|微笑道|冷笑道|怒道|叹道|喃喃道|默然道|冷哼道|淡然道|沉声道|正色道|大声道|呼道|喝道|劝道|议道|应道|回道|解释道)/g;
  let m: RegExpExecArray | null;
  while ((m = quoteReg.exec(text)) !== null) {
    const name = m[1].trim();
    if (isValidCharacterName(name)) {
      scoreMap.set(name, (scoreMap.get(name) || 0) + 3);
    }
  }

  const speakReg = /([\u4e00-\u9fa5]{2,4})(?:[:：]|[\s]*(?:微笑道|冷笑道|怒道|叹道|喃喃道|默然道|冷哼道|淡然道|沉声道|正色道|大声道|呼道|喝道|劝道|议道|应道|回道|解释道|笑道|问道))/g;
  while ((m = speakReg.exec(text)) !== null) {
    const name = m[1].trim();
    if (isValidCharacterName(name)) {
      scoreMap.set(name, (scoreMap.get(name) || 0) + 2);
    }
  }

  const interactReg = /([\u4e00-\u9fa5]{2,4})(?:对|看向|朝|同|与|跟|望向)([\u4e00-\u9fa5]{2,4})/g;
  while ((m = interactReg.exec(text)) !== null) {
    const n1 = m[1].trim();
    const n2 = m[2].trim();
    if (isValidCharacterName(n1)) scoreMap.set(n1, (scoreMap.get(n1) || 0) + 1);
    if (isValidCharacterName(n2)) scoreMap.set(n2, (scoreMap.get(n2) || 0) + 1);
  }

  return Array.from(scoreMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
}

const localCharacters = computed<CharacterNode[]>(() =>
  extractCharacters(currentChapterText.value),
);

const displayCharacters = computed<string[]>(() => {
  if (insightValid.value && storedInsight.value?.characters && storedInsight.value.characters.length > 0) {
    return storedInsight.value.characters;
  }
  return localCharacters.value.map((c) => c.name);
});

interface StarNode {
  name: string;
  x: number;
  y: number;
}

interface StarChartData {
  nodes: StarNode[];
  h: number;
  w: number;
}

const starChart = computed<StarChartData>(() => {
  const list = displayCharacters.value;
  const w = Math.max(100, leftRailWidth.value);
  const nodeGap = 36;
  const h = Math.max(140, list.length * nodeGap + 28);
  const paddingX = 26;
  const usableW = Math.max(20, w - paddingX * 2);

  const nodes = list.map((name, i) => {
    const phase = Math.sin(i * 1.5 + 0.4);
    const x = paddingX + usableW / 2 + phase * (usableW / 2.2);
    const y = 22 + i * nodeGap;
    return { name, x, y };
  });

  return { nodes, h, w };
});

function starPointsPath(data: StarChartData): string {
  if (data.nodes.length === 0) return "";
  return data.nodes.map((n, i) => `${i === 0 ? "M" : "L"}${n.x.toFixed(1)},${n.y.toFixed(1)}`).join(" ");
}

/* ---------------- 地图地点 ---------------- */
function placesInStore(): any[] {
  try {
    return mapStore.places || [];
  } catch {
    return [];
  }
}

function extractMapPlaces(text: string, storePlaces: any[]): Array<{ place: any }> {
  if (!text) return [];
  const res: Array<{ place: any }> = [];
  for (const p of storePlaces || []) {
    if (p.label && text.includes(p.label)) {
      res.push({ place: p });
    }
  }
  return res;
}

const displayPlaces = computed(() => {
  let names: string[] = [];
  if (insightValid.value && storedInsight.value?.places && storedInsight.value.places.length > 0) {
    names = storedInsight.value.places;
  } else {
    const matched = extractMapPlaces(currentChapterText.value, placesInStore());
    names = matched.map((m) => m.place.label);
  }

  const allMapPlaces = placesInStore();
  return names.map((label) => {
    const matched = allMapPlaces.find(
      (p) =>
        (p.label || "").trim() === label ||
        (p.label || "").trim().includes(label) ||
        label.includes((p.label || "").trim()),
    );
    return { label, place: matched };
  });
});

/* ---------------- 章节细纲轴：解析规则集中在 ../docReadingInsights.ts ---------------- */
const volumeFile = computed(() =>
  findDetailedOutlineFile(documentFilesStore.files, props.fileId ?? null),
);

const volumeOutline = computed<OutlineChapter[]>(() =>
  volumeFile.value ? parseVolumeOutline(volumeFile.value.content) : [],
);

const currentOutlineChapter = computed<OutlineChapter | undefined>(() => {
  if (volumeOutline.value.length === 0) return undefined;
  if (currentChapterNum.value === null) {
    return volumeOutline.value[0];
  }
  const match = volumeOutline.value.find((ch) => ch.num === currentChapterNum.value);
  if (match) return match;
  return volumeOutline.value.find((ch) => ch.num === 0) || volumeOutline.value[0];
});

/* ---------------- 7. 伏笔回收点计算 ---------------- */
const payoffMap = computed(() => buildPayoffMap(volumeOutline.value));

const currentPayoffs = computed(() =>
  currentChapterNum.value !== null ? payoffMap.value.get(currentChapterNum.value)?.items ?? [] : [],
);

/* ---------------- 跳转到正文块 ---------------- */
/** 当前章节对应的正文块范围；识别不到章节时退回全篇。 */
function blocksForCurrentChapter(all: HTMLElement[]): HTMLElement[] {
  const heads = chapterHeadEls.value;
  if (heads.length === 0 || currentChapterNum.value === null) return all;

  const idx = heads.findIndex((h) => h.num === currentChapterNum.value);
  if (idx < 0) return all;

  const start = all.indexOf(heads[idx].el);
  if (start < 0) return all;
  const nextEl = idx + 1 < heads.length ? heads[idx + 1].el : null;
  const end = nextEl ? all.indexOf(nextEl) : all.length;
  const slice = all.slice(start, end > start ? end : all.length);
  return slice.length > 0 ? slice : all;
}

function highlightBlock(el: HTMLElement) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.style.boxShadow = "inset 0 0 0 2px rgb(var(--primary-rgb, 2 132 199) / 0.9)";
  el.style.borderRadius = "4px";
  el.style.transition = "box-shadow 0.25s ease";
  window.setTimeout(() => {
    el.style.boxShadow = "";
    el.style.borderRadius = "";
  }, 1800);
}

function jumpToBlock(target: string) {
  const key = toSearchKey(target);
  if (!key || !editorEl.value) return;

  const all = Array.from(editorEl.value.querySelectorAll<HTMLElement>(".md-block"));
  if (all.length === 0) return;

  /* 先在本章范围内找，找不到再放宽到全篇，避免跳到别的章节去。 */
  const scoped = blocksForCurrentChapter(all);
  let pool = scoped;
  let match = pickBestBlock(key, pool.map((b) => b.innerText || ""));
  if (match.index < 0 && pool.length !== all.length) {
    pool = all;
    match = pickBestBlock(key, pool.map((b) => b.innerText || ""));
  }

  if (match.index < 0) {
    showToast("未找到对应正文", `正文中暂未出现「${target.slice(0, 14)}」相关段落`, "edit");
    return;
  }

  highlightBlock(pool[match.index]);
}
</script>

<template>
  <div v-if="!isShielded" ref="rootEl" class="doc-reading-rails">
    <!-- ==================== 左栏：人物星图 ==================== -->
    <Transition name="rail-left-tab">
      <button
        v-if="!leftExpanded || (!hasEnoughLeftSpace && !leftExpanded)"
        class="rail-collapsed-tab rail-collapsed-left"
        type="button"
        title="人物星图 (鼠标移入自动展开)"
        @mouseenter="onLeftEnter"
        @click="onLeftEnter"
      >
        <Waypoints :size="14" />
        <span class="tab-label">人物星图</span>
        <span v-if="displayCharacters.length > 0" class="tab-badge">{{ displayCharacters.length }}</span>
        <ChevronRight :size="12" />
      </button>
    </Transition>

    <Transition name="rail-left-panel">
      <div
        v-if="leftExpanded && (hasEnoughLeftSpace || leftExpanded)"
        class="rail rail-left"
        :class="{ overlay: !hasEnoughLeftSpace }"
        :style="{ width: leftRailWidth + 'px' }"
        @mouseenter="onLeftEnter"
        @mouseleave="onLeftLeave"
      >
        <div class="rail-cap">
          <div class="cap-title">
            <Waypoints :size="14" :stroke-width="2" />
            <span>人物星图</span>
            <span v-if="currentChapterNum !== null" class="chap-badge">
              {{ currentChapterNum === 0 ? "序章" : `第${currentChapterNum}章` }}
            </span>
          </div>
          <button
            class="cap-toggle-btn"
            type="button"
            title="收起人物星图"
            @click="closeLeftImmediate"
          >
            <ChevronLeft :size="14" />
          </button>
        </div>

        <!-- 星图绘制区 -->
        <div class="star-section">
          <template v-if="displayCharacters.length > 0">
            <div class="star-wrap">
              <svg
                class="star-svg"
                :viewBox="`0 0 ${starChart.w} ${starChart.h}`"
                width="100%"
              >
                <path
                  v-if="starChart.nodes.length > 1"
                  :d="starPointsPath(starChart)"
                  class="star-trail"
                />
                <g
                  v-for="n in starChart.nodes"
                  :key="n.name"
                  class="star-node-group"
                  :transform="`translate(${n.x}, ${n.y})`"
                  @click="jumpToBlock(n.name)"
                >
                  <circle r="7.5" class="star-dot-outer" />
                  <circle r="3.5" class="star-dot-core" />
                  <text text-anchor="middle" y="17" class="star-name">{{ n.name }}</text>
                </g>
              </svg>
            </div>

            <!-- 人物快跳标签云 -->
            <div class="chips-grid">
              <button
                v-for="name in displayCharacters"
                :key="name"
                class="char-chip"
                type="button"
                :title="`跳到正文中关于『${name}』的段落`"
                @click="jumpToBlock(name)"
              >
                <span class="char-dot" />
                <span class="char-text">{{ name }}</span>
              </button>
            </div>
          </template>

          <div v-else class="rail-tip empty">
            本章暂未发现出场人物
          </div>
        </div>

        <!-- AI 提炼触发器与状态底部 -->
        <div class="rail-foot-bar">
          <button
            class="extract-btn"
            type="button"
            :disabled="extracting"
            @click="runExtraction"
          >
            <span v-if="extracting" class="spin"><RotateCw :size="12" /></span>
            <Sparkles v-else :size="12" />
            <span>{{ extracting ? "AI 识别中…" : (insightValid ? "重新 AI 提炼" : "AI 深度提炼") }}</span>
          </button>

          <div v-if="insightValid" class="insight-status">
            <span class="status-dot green" /> AI 已提炼缓存
          </div>
          <div v-else class="insight-status">
            <span class="status-dot amber" /> 本地即时提取
          </div>
        </div>
      </div>
    </Transition>

    <!-- ==================== 右栏：地点 + 本章细纲轴 ==================== -->
    <Transition name="rail-right-tab">
      <button
        v-if="!rightExpanded || (!hasEnoughRightSpace && !rightExpanded)"
        class="rail-collapsed-tab rail-collapsed-right"
        :style="{ right: (10 + scrollbarWidthPx) + 'px' }"
        type="button"
        title="地点 · 细纲 (鼠标移入自动展开)"
        @mouseenter="onRightEnter"
        @click="onRightEnter"
      >
        <ChevronLeft :size="12" />
        <span class="tab-badge" v-if="displayPlaces.length > 0">{{ displayPlaces.length }}</span>
        <span class="tab-label">地点 · 细纲</span>
        <MapPin :size="14" />
      </button>
    </Transition>

    <Transition name="rail-right-panel">
      <div
        v-if="rightExpanded && (hasEnoughRightSpace || rightExpanded)"
        class="rail rail-right"
        :class="{ overlay: !hasEnoughRightSpace }"
        :style="{ width: rightRailWidth + 'px', right: (10 + scrollbarWidthPx) + 'px' }"
        @mouseenter="onRightEnter"
        @mouseleave="onRightLeave"
      >
        <div class="rail-cap">
          <div class="cap-title">
            <Compass :size="14" :stroke-width="2" />
            <span>地点 · 细纲</span>
          </div>
          <button
            class="cap-toggle-btn"
            type="button"
            title="收起地点与细纲"
            @click="closeRightImmediate"
          >
            <ChevronRight :size="14" />
          </button>
        </div>

      <!-- 模块 A：本章地图地点 -->
      <div class="rail-block places-block">
        <div class="block-title">
          <MapPin :size="13" />
          <span>本章地点</span>
          <span v-if="displayPlaces.length > 0" class="count-num">({{ displayPlaces.length }})</span>
        </div>

        <div v-if="displayPlaces.length > 0" class="places-list">
          <button
            v-for="p in displayPlaces"
            :key="p.label"
            class="place-chip"
            type="button"
            :title="p.place?.note ? p.place.note : `点击跳到正文『${p.label}』`"
            @click="jumpToBlock(p.label)"
          >
            <span
              v-if="p.place"
              class="place-ic"
              :style="{
                color: (PLACE_ICON_COLORS as any)[p.place.icon]?.color || 'var(--primary, #0284c7)',
                background: (PLACE_ICON_COLORS as any)[p.place.icon]?.bg || 'rgb(var(--primary-rgb, 2 132 199) / 0.14)'
              }"
            >
              {{ p.label.slice(0, 1) }}
            </span>
            <span v-else class="place-ic plain">{{ p.label.slice(0, 1) }}</span>
            <span class="place-name">{{ p.label }}</span>
          </button>
        </div>
        <div v-else class="rail-tip empty">本章未点名地图地点</div>
      </div>

      <!-- 模块 B：章节细纲轴 -->
      <div class="rail-block axis-block">
        <div class="block-title">
          <Star :size="13" />
          <span>本章细纲轴</span>
        </div>

        <div v-if="currentOutlineChapter" class="axis-content">
          <!-- 章节抬头横幅 -->
          <div class="chap-banner">
            <span class="chap-dot" />
            <span class="chap-title-text">
              {{ currentOutlineChapter.num === 0 ? "序章" : `第${currentOutlineChapter.num}章` }}
              <template v-if="currentOutlineChapter.title && currentOutlineChapter.title !== '序章'">
                · {{ currentOutlineChapter.title }}
              </template>
            </span>
          </div>

          <!-- 1. 本节构成（支持折叠/展开，高质感五色低饱和层次区分） -->
          <div v-if="currentOutlineChapter.sections.length > 0" class="axis-group">
            <div
              class="group-sub-header clickable"
              :title="sectionsCollapsed ? '点击展开本节构成' : '点击折叠本节构成'"
              @click="sectionsCollapsed = !sectionsCollapsed"
            >
              <ChevronDown v-if="!sectionsCollapsed" :size="13" />
              <ChevronRight v-else :size="13" />
              <span>本节构成</span>
              <span class="mini-count-badge">{{ currentOutlineChapter.sections.length }}节</span>
            </div>

            <div v-show="!sectionsCollapsed" class="sections-list">
              <div
                v-for="(sec, sIdx) in currentOutlineChapter.sections"
                :key="sec.label + sIdx"
                class="section-card"
              >
                <!-- 小节主标题按钮 -->
                <button
                  class="axis-section-btn"
                  type="button"
                  title="点击跳转到正文对应段落"
                  @click="jumpToBlock(sec.anchor || sec.label)"
                >
                  <span class="sec-dot" />
                  <span class="sec-label">{{ sec.label }}</span>
                </button>

                <!-- 五要素细纲展示：情境、欲望、冲突、转变、结果 -->
                <div
                  v-if="sec.situation || sec.desire || sec.conflict || sec.turn || sec.result"
                  class="dramatics-list"
                >
                  <!-- 情境 -->
                  <div v-if="sec.situation" class="drama-row drama-sit">
                    <span class="drama-tag">情境</span>
                    <div class="drama-val-wrap">
                      <span class="drama-val">
                        {{ isExpanded(`sit_${sIdx}`) || sec.situation.length <= 32 ? sec.situation : sec.situation.slice(0, 32) + '…' }}
                      </span>
                      <button
                        v-if="sec.situation.length > 32"
                        class="expand-link"
                        type="button"
                        @click.stop="toggleExpand(`sit_${sIdx}`)"
                      >
                        {{ isExpanded(`sit_${sIdx}`) ? '收起' : '展开' }}
                      </button>
                    </div>
                  </div>

                  <!-- 欲望 -->
                  <div v-if="sec.desire" class="drama-row drama-des">
                    <span class="drama-tag">欲望</span>
                    <div class="drama-val-wrap">
                      <span class="drama-val">
                        {{ isExpanded(`des_${sIdx}`) || sec.desire.length <= 32 ? sec.desire : sec.desire.slice(0, 32) + '…' }}
                      </span>
                      <button
                        v-if="sec.desire.length > 32"
                        class="expand-link"
                        type="button"
                        @click.stop="toggleExpand(`des_${sIdx}`)"
                      >
                        {{ isExpanded(`des_${sIdx}`) ? '收起' : '展开' }}
                      </button>
                    </div>
                  </div>

                  <!-- 冲突 -->
                  <div v-if="sec.conflict" class="drama-row drama-con">
                    <span class="drama-tag">冲突</span>
                    <div class="drama-val-wrap">
                      <span class="drama-val">
                        {{ isExpanded(`con_${sIdx}`) || sec.conflict.length <= 32 ? sec.conflict : sec.conflict.slice(0, 32) + '…' }}
                      </span>
                      <button
                        v-if="sec.conflict.length > 32"
                        class="expand-link"
                        type="button"
                        @click.stop="toggleExpand(`con_${sIdx}`)"
                      >
                        {{ isExpanded(`con_${sIdx}`) ? '收起' : '展开' }}
                      </button>
                    </div>
                  </div>

                  <!-- 转变 -->
                  <div v-if="sec.turn" class="drama-row drama-trn">
                    <span class="drama-tag">转变</span>
                    <div class="drama-val-wrap">
                      <span class="drama-val">
                        {{ isExpanded(`trn_${sIdx}`) || sec.turn.length <= 32 ? sec.turn : sec.turn.slice(0, 32) + '…' }}
                      </span>
                      <button
                        v-if="sec.turn.length > 32"
                        class="expand-link"
                        type="button"
                        @click.stop="toggleExpand(`trn_${sIdx}`)"
                      >
                        {{ isExpanded(`trn_${sIdx}`) ? '收起' : '展开' }}
                      </button>
                    </div>
                  </div>

                  <!-- 结果 -->
                  <div v-if="sec.result" class="drama-row drama-res">
                    <span class="drama-tag">结果</span>
                    <div class="drama-val-wrap">
                      <span class="drama-val">
                        {{ isExpanded(`res_${sIdx}`) || sec.result.length <= 32 ? sec.result : sec.result.slice(0, 32) + '…' }}
                      </span>
                      <button
                        v-if="sec.result.length > 32"
                        class="expand-link"
                        type="button"
                        @click.stop="toggleExpand(`res_${sIdx}`)"
                      >
                        {{ isExpanded(`res_${sIdx}`) ? '收起' : '展开' }}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 2. 伏笔呈现（本章埋下线索） -->
          <div v-if="currentOutlineChapter.foreshadows.length > 0" class="axis-group">
            <div class="group-sub amber">
              <Clover :size="12" />
              <span>伏笔呈现</span>
              <span class="mini-count-badge amber-badge">{{ currentOutlineChapter.foreshadows.length }}</span>
            </div>
            <div
              v-for="(fb, i) in currentOutlineChapter.foreshadows"
              :key="'fb' + i"
              class="fb-card"
              :title="`点击跳到正文『${fb.text}』`"
              @click="jumpToBlock(fb.text)"
            >
              <div class="fb-text-wrap">
                <span class="fb-text">
                  {{ isExpanded(`fb_${i}`) || fb.text.length <= 36 ? fb.text : fb.text.slice(0, 36) + '…' }}
                </span>
                <button
                  v-if="fb.text.length > 36"
                  class="expand-link amber-link"
                  type="button"
                  @click.stop="toggleExpand(`fb_${i}`)"
                >
                  {{ isExpanded(`fb_${i}`) ? '收起' : '展开' }}
                </button>
              </div>
              <div v-if="fb.targetChapter !== null" class="fb-target">
                收回点 → 第{{ fb.targetChapter }}章
              </div>
              <div v-else-if="fb.targetText" class="fb-target plain">
                关联 → {{ fb.targetText.length > 24 ? fb.targetText.slice(0, 24) + '…' : fb.targetText }}
              </div>
            </div>
          </div>

          <!-- 3. 伏笔收回点（本章应收回的前章伏笔） -->
          <div v-if="currentPayoffs.length > 0" class="axis-group">
            <div class="group-sub green">
              <CheckCircle2 :size="12" />
              <span>伏笔收回点</span>
              <span class="mini-count-badge green-badge">{{ currentPayoffs.length }}</span>
            </div>
            <div
              v-for="(p, i) in currentPayoffs"
              :key="'py' + i"
              class="py-card"
              :title="`点击跳到正文『${p.text}』`"
              @click="jumpToBlock(p.text)"
            >
              <span class="py-from">[{{ p.from }}]</span>
              <span class="py-text">{{ p.text }}</span>
            </div>
          </div>

          <div
            v-if="
              currentOutlineChapter.sections.length === 0 &&
              currentOutlineChapter.foreshadows.length === 0 &&
              currentPayoffs.length === 0
            "
            class="rail-tip empty"
          >
            本章细纲暂无结构规划
          </div>
        </div>

        <div v-else class="rail-tip outline-missing">
          <FileText :size="15" />
          <template v-if="volumeFile">
            细纲「{{ volumeFile.title }}」未找到{{ currentChapterNum === 0 ? "序章" : `第${currentChapterNum ?? "?"}章` }}细纲
          </template>
          <template v-else>
            未检索到细纲文档
          </template>
        </div>
      </div>
    </div>
  </Transition>
</div>
</template>

<style scoped>
.doc-reading-rails {
  position: absolute;
  inset: 38px 0 10px;
  pointer-events: none;
  z-index: 15;
}

/* ---------- 侧栏浅色质感 ---------- */
.rail {
  position: absolute;
  top: 0;
  bottom: 0;
  pointer-events: auto;
  display: flex;
  flex-direction: column;
  background: var(--surface-container-low, rgba(255, 255, 255, 0.9));
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.09));
  border-radius: 10px;
  box-shadow: 0 4px 18px -4px rgba(0, 0, 0, 0.06);
  padding: 10px;
  gap: 10px;
  overflow: hidden;
  color: var(--on-surface, #1e293b);
  transition: width 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
}

.rail.overlay {
  z-index: 40;
  box-shadow: 0 12px 32px -8px rgba(0, 0, 0, 0.16);
  background: var(--surface-bright, rgba(255, 255, 255, 0.98));
}

.rail-left {
  left: 8px;
}

.rail-right {
  right: 12px;
}

.rail-cap {
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.08));
  padding-bottom: 7px;
  flex-shrink: 0;
}

.cap-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--primary, #0284c7);
  letter-spacing: 0.02em;
}

.chap-badge {
  font-size: 0.65rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  background: rgb(var(--primary-rgb, 2 132 199) / 0.12);
  color: var(--primary, #0284c7);
}

.cap-toggle-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant, #64748b);
  border-radius: 4px;
  cursor: pointer;
  opacity: 0.7;
  transition: opacity 0.15s ease, background 0.15s ease;
}

.cap-toggle-btn:hover {
  opacity: 1;
  background: rgb(var(--primary-rgb, 2 132 199) / 0.12);
}

.rail-collapsed-tab {
  position: absolute;
  top: 10px;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.12));
  border-radius: 8px;
  background: var(--surface-container-high, rgba(255, 255, 255, 0.94));
  backdrop-filter: blur(8px);
  color: var(--on-surface, #1e293b);
  font-size: 0.72rem;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  z-index: 35;
  transition: transform 0.15s ease, background 0.15s ease;
}

.rail-collapsed-left {
  left: 6px;
}

.rail-collapsed-right {
  right: 14px;
}

.rail-collapsed-tab:hover {
  background: var(--surface-bright, #ffffff);
  color: var(--primary, #0284c7);
  transform: translateY(-1px);
}

.tab-badge {
  font-size: 0.62rem;
  padding: 0 5px;
  border-radius: 99px;
  background: var(--primary, #0284c7);
  color: #ffffff;
  font-weight: 700;
}

/* 左栏：星图 */
.star-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  gap: 8px;
}

.star-wrap {
  flex-shrink: 0;
  display: flex;
  justify-content: center;
  padding: 6px 0;
}

.star-svg {
  display: block;
  overflow: visible;
}

.star-trail {
  fill: none;
  stroke: rgb(var(--primary-rgb, 2 132 199) / 0.45);
  stroke-width: 1.3;
  stroke-dasharray: 3 3;
}

.star-node-group {
  cursor: pointer;
}

.star-node-group:hover .star-dot-outer {
  fill: rgb(var(--primary-rgb, 2 132 199) / 0.35);
  r: 9.5;
}

.star-node-group:hover .star-name {
  fill: var(--primary, #0284c7);
  font-size: 11px;
}

.star-dot-outer {
  fill: rgb(var(--primary-rgb, 2 132 199) / 0.2);
  stroke: rgb(var(--primary-rgb, 2 132 199) / 0.7);
  stroke-width: 1.4;
  transition: r 0.15s ease, fill 0.15s ease;
}

.star-dot-core {
  fill: var(--primary, #0284c7);
}

.star-name {
  font-size: 10px;
  fill: var(--on-surface, #1e293b);
  font-weight: 700;
  paint-order: stroke;
  stroke: var(--surface-container-low, #ffffff);
  stroke-width: 3px;
  stroke-linejoin: round;
  transition: fill 0.15s ease, font-size 0.15s ease;
}

.chips-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  padding: 2px;
}

.char-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border: 1px solid rgb(var(--primary-rgb, 2 132 199) / 0.2);
  border-radius: 6px;
  background: rgb(var(--primary-rgb, 2 132 199) / 0.06);
  color: var(--on-surface, #1e293b);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s ease, border-color 0.12s ease;
}

.char-chip:hover {
  background: rgb(var(--primary-rgb, 2 132 199) / 0.16);
  border-color: var(--primary, #0284c7);
  color: var(--primary, #0284c7);
}

.char-dot {
  width: 4.5px;
  height: 4.5px;
  border-radius: 50%;
  background: var(--primary, #0284c7);
}

.rail-foot-bar {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.08));
  padding-top: 6px;
  flex-shrink: 0;
}

.extract-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  padding: 5px 8px;
  border: 1px solid rgb(var(--primary-rgb, 2 132 199) / 0.3);
  border-radius: 7px;
  background: rgb(var(--primary-rgb, 2 132 199) / 0.08);
  color: var(--primary, #0284c7);
  font-size: 0.7rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s ease;
}

.extract-btn:hover:not(:disabled) {
  background: rgb(var(--primary-rgb, 2 132 199) / 0.18);
}

.extract-btn:disabled {
  opacity: 0.6;
  cursor: wait;
}

.insight-status {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 0.62rem;
  color: var(--on-surface-variant, #64748b);
  opacity: 0.85;
}

.status-dot {
  width: 5.5px;
  height: 5.5px;
  border-radius: 50%;
}

.status-dot.green {
  background: #10b981;
}

.status-dot.amber {
  background: #f59e0b;
}

.spin {
  display: inline-flex;
  animation: docspin 0.9s linear infinite;
}

@keyframes docspin {
  to {
    transform: rotate(360deg);
  }
}

/* 右栏：模块组 */
.rail-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.places-block {
  max-height: 32%;
  flex-shrink: 0;
}

.axis-block {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.08));
  padding-top: 8px;
  overflow: hidden;
}

.block-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--on-surface, #1e293b);
}

.count-num {
  font-size: 0.68rem;
  color: var(--on-surface-variant, #64748b);
  opacity: 0.8;
}

.places-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
}

.place-chip {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  cursor: pointer;
  text-align: left;
  transition: background 0.12s ease;
}

.place-chip:hover {
  background: rgb(var(--primary-rgb, 2 132 199) / 0.1);
}

.place-ic {
  width: 19px;
  height: 19px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.64rem;
  font-weight: 700;
  flex-shrink: 0;
}

.place-ic.plain {
  color: var(--on-surface-variant, #64748b);
  background: var(--surface-container-high, rgba(0, 0, 0, 0.06));
}

.place-name {
  flex: 1;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--on-surface, #1e293b);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.axis-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 2px;
}

.chap-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  font-weight: 700;
  color: var(--primary, #0284c7);
  padding: 2px 0 4px;
  border-bottom: 1px dashed rgba(2, 132, 199, 0.25);
}

.chap-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary, #0284c7);
  box-shadow: 0 0 0 3px rgb(var(--primary-rgb, 2 132 199) / 0.18);
  flex-shrink: 0;
}

.chap-title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.axis-group {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-left: 2px solid rgb(var(--primary-rgb, 2 132 199) / 0.35);
  padding-left: 8px;
  margin-left: 2px;
}

.group-sub-header {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--on-surface-variant, #475569);
  user-select: none;
}

.group-sub-header.clickable {
  cursor: pointer;
}

.group-sub-header.clickable:hover {
  color: var(--primary, #0284c7);
}

.group-sub {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--on-surface-variant, #475569);

  &.amber {
    color: #d97706;
  }
  &.green {
    color: #059669;
  }
}

.mini-count-badge {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.06);
  color: var(--on-surface-variant, #64748b);
}

.mini-count-badge.amber-badge {
  background: #fef3c7;
  color: #b45309;
}

.mini-count-badge.green-badge {
  background: #d1fae5;
  color: #047857;
}

.sections-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.section-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px;
  border-radius: 7px;
  background: var(--surface-bright, rgba(248, 250, 252, 0.8));
  border: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.08));
  transition: border-color 0.15s ease, background 0.15s ease;
}

.section-card:hover {
  border-color: rgb(var(--primary-rgb, 2 132 199) / 0.4);
  background: var(--surface-bright, #ffffff);
}

.axis-section-btn {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 0.74rem;
  font-weight: 700;
  color: var(--on-surface, #1e293b);
  cursor: pointer;
  padding: 0;
  line-height: 1.4;
  transition: color 0.12s ease;
}

.axis-section-btn:hover {
  color: var(--primary, #0284c7);
}

.sec-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--primary, #0284c7);
  flex-shrink: 0;
}

.sec-label {
  flex: 1;
  word-break: break-all;
}

/* 戏剧五要素列表 */
.dramatics-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 2px;
  padding-top: 4px;
  border-top: 1px dashed rgba(0, 0, 0, 0.06);
}

.drama-row {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.72rem;
  line-height: 1.5;
}

.drama-tag {
  font-size: 0.62rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  flex-shrink: 0;
  line-height: 1.35;
  margin-top: 1px;
}

.drama-sit .drama-tag {
  background: #e0f2fe;
  color: #0369a1;
  border: 1px solid #bae6fd;
}

.drama-des .drama-tag {
  background: #fef3c7;
  color: #b45309;
  border: 1px solid #fde68a;
}

.drama-con .drama-tag {
  background: #ffe4e6;
  color: #be123c;
  border: 1px solid #fecdd3;
}

.drama-trn .drama-tag {
  background: #ede9fe;
  color: #6d28d9;
  border: 1px solid #ddd6fe;
}

.drama-res .drama-tag {
  background: #d1fae5;
  color: #047857;
  border: 1px solid #a7f3d0;
}

.drama-val-wrap {
  flex: 1;
  display: inline-flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}

.drama-val {
  color: #334155;
  word-break: break-all;
}

.expand-link {
  border: none;
  background: transparent;
  padding: 0;
  font-size: 0.62rem;
  color: var(--primary, #0284c7);
  cursor: pointer;
  font-weight: 700;
}

.expand-link:hover {
  text-decoration: underline;
}

.expand-link.amber-link {
  color: #d97706;
}

/* 伏笔与回收卡片 */
.fb-card,
.py-card {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 5px 8px;
  border-radius: 6px;
  background: var(--surface-bright, rgba(248, 250, 252, 0.8));
  border: 1px solid var(--outline-variant, rgba(0, 0, 0, 0.08));
  font-size: 0.72rem;
  line-height: 1.5;
  cursor: pointer;
  transition: all 0.15s ease;
}

.fb-card {
  border-left: 3px solid #f59e0b;
  background: rgba(254, 243, 199, 0.35);
}

.fb-card:hover {
  background: rgba(254, 243, 199, 0.65);
  border-color: #f59e0b;
}

.py-card {
  border-left: 3px solid #10b981;
  background: rgba(209, 250, 229, 0.35);
}

.py-card:hover {
  background: rgba(209, 250, 229, 0.65);
  border-color: #10b981;
}

.fb-text-wrap {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px;
}

.fb-text,
.py-text {
  color: var(--on-surface, #1e293b);
  word-break: break-all;
}

.fb-target {
  font-size: 0.64rem;
  color: #b45309;
  font-weight: 700;
}

.fb-target.plain {
  color: #92703a;
  font-weight: 600;
  opacity: 0.9;
}

.py-from {
  font-size: 0.64rem;
  color: #047857;
  font-weight: 700;
}

.rail-tip {
  font-size: 0.68rem;
  color: var(--on-surface-variant, #64748b);
  opacity: 0.85;
  line-height: 1.4;
  padding: 6px 0;
}

.rail-tip.empty {
  text-align: center;
  opacity: 0.7;
}

.rail-tip.outline-missing {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 5px;
  text-align: center;
  padding: 14px 8px;
  background: var(--surface-bright, rgba(0, 0, 0, 0.02));
  border-radius: 6px;
  border: 1px dashed rgba(0, 0, 0, 0.1);
}

/* ==================== 侧栏折叠/展开精致 CSS 弹性动画 ==================== */
.rail-left-tab-enter-active,
.rail-left-tab-leave-active,
.rail-right-tab-enter-active,
.rail-right-tab-leave-active,
.rail-left-panel-enter-active,
.rail-left-panel-leave-active,
.rail-right-panel-enter-active,
.rail-right-panel-leave-active {
  transition: all 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 左侧折叠按钮过渡 */
.rail-left-tab-enter-from,
.rail-left-tab-leave-to {
  opacity: 0;
  transform: translateX(-16px) scale(0.92);
}

/* 左侧面板展开过渡 */
.rail-left-panel-enter-from,
.rail-left-panel-leave-to {
  opacity: 0;
  transform: translateX(-24px) scale(0.95);
}

/* 右侧折叠按钮过渡 */
.rail-right-tab-enter-from,
.rail-right-tab-leave-to {
  opacity: 0;
  transform: translateX(16px) scale(0.92);
}

/* 右侧面板展开过渡 */
.rail-right-panel-enter-from,
.rail-right-panel-leave-to {
  opacity: 0;
  transform: translateX(24px) scale(0.95);
}
</style>
