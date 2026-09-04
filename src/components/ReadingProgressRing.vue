<script setup lang="ts">
/**
 * 悬浮阅读进度圆环 + Markdown 目录面板。
 *
 * 收起态是编辑框（或预览区）内部的一枚玻璃圆环，环内是阅读百分比；
 * 点击向下（或向上，视空间而定）展开半透明目录面板，点任意标题即滚动到正文对应位置。
 * 百分比直接消费父级已算好的 progress（0~1），与顶部进度条同源、天然实时同步。
 *
 * 长按环心百分比可把圆环拖到面板内任意位置，落点以归一化坐标记入 readingRingStore
 * 并由持久化层落库；开关与直径由 aiSettings.readingRingEnabled / readingRingSize 控制。
 *
 * 独立成文件：不改动编辑器 / 预览区既有逻辑，后续可单独优化。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Focus,
  FileText,
  LayoutTemplate,
  Smartphone,
  ArrowLeft,
  Sun,
  Moon,
  Edit3,
  Save,
  Download,
  ChevronLeft,
  ChevronRight,
  List,
  Type,
  X,
} from "lucide-vue-next";
import { renderForReading } from "../markdown";
import { downloadTextFileWithDialog } from "../download";
import { applyContentColoring, contentColoringOn, contentColorCssVars } from "../contentColoring";
import {
  activeHeadingIndex,
  countChars,
  formatChars,
  measurePreviewTops,
  measureTextareaTops,
  parseOutline,
} from "../readingOutline";
import { aiSettings } from "../settings";
import {
  clampRingOpacity,
  clampRingSize,
  getRingPosition,
  setRingPosition,
  RING_OPACITY_MAX,
  RING_SIZE_MAX,
  RING_SIZE_MIN,
} from "../readingRingStore";

const props = withDefaults(
  defineProps<{
    /** 阅读进度 0~1，与所属面板顶部进度条同一数据源。 */
    progress: number;
    /** Markdown 原文，用于解析标题目录。 */
    source: string;
    /** 滚动容器：编辑区传 textarea，预览区传 .preview-scroll。 */
    target: HTMLTextAreaElement | HTMLElement | null;
    /** 位置记忆的槽位标识（每个界面位点各记一份）。 */
    slotKey: string;
    /** 定位标题的方式：编辑区量镜像行高，预览区匹配已渲染的 h1~h6。 */
    kind?: "editor" | "preview";
    /** 可摆放矩形距容器四边的内缩（预览区需让开顶部信息条）。 */
    insetTop?: number;
    insetRight?: number;
    insetBottom?: number;
    insetLeft?: number;
    /** 小编辑框里可传更小的上限，圆环与目录一起等比收小。 */
    maxSize?: number;
    zenMode?: "markdown" | "preview" | "off";
    spotlightActive?: boolean;
    docTitle?: string;
    zenDisabled?: boolean;
  }>(),
  {
    kind: "editor",
    insetTop: 10,
    insetRight: 12,
    insetBottom: 10,
    insetLeft: 12,
    maxSize: RING_SIZE_MAX,
    zenMode: "off",
    spotlightActive: false,
    docTitle: "未命名文档",
    zenDisabled: false,
  },
);

const enabled = computed(() => aiSettings.readingRingEnabled);

/* ---------------- 尺寸：随设置项等比缩放 ---------------- */

const ringSize = computed(() =>
  Math.min(clampRingSize(aiSettings.readingRingSize), Math.max(RING_SIZE_MIN, props.maxSize)),
);
/** 0（最小）~ 1（最大）的缩放位置，目录面板按同一比例收放。 */
const sizeRatio = computed(
  () => (ringSize.value - RING_SIZE_MIN) / (RING_SIZE_MAX - RING_SIZE_MIN),
);
function lerp(min: number, max: number): number {
  return min + (max - min) * sizeRatio.value;
}

/* 环线宽固定按设备像素给（而非随 viewBox 缩放），小圆环才不会细成一根线。 */
const strokeVB = computed(() => (lerp(2.2, 2.9) * 44) / ringSize.value);
const ringR = computed(() => 22 - strokeVB.value / 2 - 0.6);
const ringC = computed(() => 2 * Math.PI * ringR.value);
/** 直径太小时省掉 % 号，把空间全留给三位数的百分比（100% 时最挤）。 */
const showUnit = computed(() => ringSize.value >= 34);

const panelWidth = computed(() => Math.round(lerp(208, 252)));

/* ---------------- 不透明度：整套玻璃层同比例缩放 ---------------- */

/* 100% 对应原设计值；调低时白底、描边、阴影、模糊一起变淡，避免只有底色变透
   而描边和阴影仍然实心的割裂感。文字与环体本身始终保持可读，不参与淡化。 */
const opacityFactor = computed(
  () => clampRingOpacity(aiSettings.readingRingOpacity) / RING_OPACITY_MAX,
);
function fade(full: number, floor = 0): string {
  return (floor + (full - floor) * opacityFactor.value).toFixed(3);
}

const ringVars = computed(() => ({
  "--ring-size": `${ringSize.value}px`,
  "--ring-num": `${lerp(10.4, 12.6).toFixed(2)}px`,
  "--toc-radius": `${lerp(11, 14).toFixed(1)}px`,
  "--toc-font": `${lerp(11.6, 12.6).toFixed(2)}px`,
  "--toc-row-pad": `${lerp(4, 5.5).toFixed(1)}px`,
  "--toc-indent": `${lerp(9, 12).toFixed(1)}px`,
  /* 玻璃层：底色 / 描边 / 阴影 / 模糊 */
  "--glass-a": fade(0.66),
  "--glass-a-hover": fade(0.82),
  "--glass-a-active": fade(0.86),
  "--glass-a-drag": fade(0.9),
  "--glass-toc-a": fade(0.62),
  "--glass-edge": fade(0.7),
  "--glass-shadow": fade(1),
  "--glass-blur": `${(lerp(10, 12) * (0.55 + 0.45 * opacityFactor.value)).toFixed(1)}px`,
  "--toc-blur": `${(18 * (0.55 + 0.45 * opacityFactor.value)).toFixed(1)}px`,
  /* 玻璃越透，环内数字越贴在正文上，补一圈白色描边保住可读性。 */
  "--num-halo": (0.9 * (1 - opacityFactor.value)).toFixed(3),
}));

/* ---------------- 位置：归一化坐标 + 长按拖动 ---------------- */

const dockRef = ref<HTMLDivElement | null>(null);
const dockSize = ref({ w: 0, h: 0 });

const storedPos = computed(() => getRingPosition(props.slotKey));
/** 拖动进行中的临时位置，松手后才写回 store（避免每帧落库）。 */
const dragPos = ref<{ nx: number; ny: number } | null>(null);
const dragging = ref(false);

const travelX = computed(() => Math.max(0, dockSize.value.w - ringSize.value));
const travelY = computed(() => Math.max(0, dockSize.value.h - ringSize.value));

const livePos = computed(() => dragPos.value ?? storedPos.value);
const ringLeft = computed(() => livePos.value.nx * travelX.value);
const ringTop = computed(() => livePos.value.ny * travelY.value);

const ringStyle = computed(() => ({
  left: `${ringLeft.value}px`,
  top: `${ringTop.value}px`,
}));

const GAP = 10;

const spaceBelow = computed(
  () => dockSize.value.h - (ringTop.value + ringSize.value + GAP),
);
const spaceAbove = computed(() => ringTop.value - GAP);

/** 目录面板挂在圆环的哪一侧：下方空间不够就翻到上方。 */
const dropUp = computed(
  () => spaceBelow.value < 140 && spaceAbove.value > spaceBelow.value,
);

/* 高度上限跟随实际展开方向，否则「下方够用但上方更宽裕」时会按上方的余量
   放高，向下展开就溢出面板了。计算属性而非手动刷新：容器尺寸、圆环位置、
   直径任一变化都自动跟上。 */
const panelMaxHeight = computed(() => {
  const room = dropUp.value ? spaceAbove.value : spaceBelow.value;
  /* 下限 112px 保证「目录」头 + 两三行仍可读；但极矮的面板里以容器高度收口，
     免得整块面板被 overflow: hidden 齐腰切掉。 */
  const floor = Math.min(112, Math.max(64, dockSize.value.h));
  return Math.round(Math.min(lerp(280, 360), Math.max(floor, room)));
});

const panelStyle = computed(() => {
  const dockW = dockSize.value.w;
  const w = Math.min(panelWidth.value, Math.max(120, dockW));
  /* 圆环偏右时右缘对齐，偏左时左缘对齐，然后整体夹回面板内。 */
  const raw =
    livePos.value.nx > 0.5 ? ringLeft.value + ringSize.value - w : ringLeft.value;
  const left = Math.min(Math.max(0, raw), Math.max(0, dockW - w));
  const style: Record<string, string> = {
    width: `${w}px`,
    left: `${left}px`,
    maxHeight: `${panelMaxHeight.value}px`,
  };
  if (dropUp.value) style.bottom = `${dockSize.value.h - ringTop.value + GAP}px`;
  else style.top = `${ringTop.value + ringSize.value + GAP}px`;
  return style;
});

let resizeObserver: ResizeObserver | null = null;

function syncDockSize() {
  const el = dockRef.value;
  if (!el) return;
  dockSize.value = { w: el.clientWidth, h: el.clientHeight };
}

/** 容器尺寸未知前先不画圆环，避免它在左上角闪一帧再跳到右上角。 */
const measured = computed(() => dockSize.value.w > 0 && dockSize.value.h > 0);

function attachObserver() {
  const el = dockRef.value;
  if (!el) return;
  syncDockSize();
  if (resizeObserver || typeof ResizeObserver === "undefined") return;
  resizeObserver = new ResizeObserver(syncDockSize);
  resizeObserver.observe(el);
}

function detachObserver() {
  resizeObserver?.disconnect();
  resizeObserver = null;
}

/* ---- 长按环心 → 自由拖动 ---- */

const LONG_PRESS_MS = 200;
const MOVE_TOLERANCE = 4;
let pressTimer: number | null = null;
let pressOrigin = { x: 0, y: 0 };
let grabOffset = { x: 0, y: 0 };
let prevUserSelect = "";
let prevCursor = "";

function clearPressTimer() {
  if (pressTimer !== null) {
    window.clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function armDrag() {
  pressTimer = null;
  const el = dockRef.value;
  if (!el) return;
  dragging.value = true;
  open.value = false;
  window.getSelection()?.removeAllRanges();
  prevUserSelect = document.body.style.userSelect;
  prevCursor = document.body.style.cursor;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";
  dragPos.value = { ...storedPos.value };
}

function onRingPointerDown(event: MouseEvent) {
  if (!enabled.value || event.button !== 0) return;
  const el = dockRef.value;
  if (!el) return;
  syncDockSize();
  const rect = el.getBoundingClientRect();
  pressOrigin = { x: event.clientX, y: event.clientY };
  /* 记住抓取点在圆环内的偏移，拖动时圆环不会跳到光标中心。 */
  grabOffset = {
    x: event.clientX - (rect.left + ringLeft.value),
    y: event.clientY - (rect.top + ringTop.value),
  };
  clearPressTimer();
  pressTimer = window.setTimeout(armDrag, LONG_PRESS_MS);
  window.addEventListener("mousemove", onDragMove, true);
  window.addEventListener("mouseup", onDragEnd, true);
  window.addEventListener("keydown", onDragKey, true);
  window.addEventListener("blur", cancelDrag);
}

function onDragMove(event: MouseEvent) {
  if (!dragging.value) {
    /* 长按未成立就先动了：判定为普通点击/滑动，撤销本次手势。 */
    if (
      Math.abs(event.clientX - pressOrigin.x) > MOVE_TOLERANCE ||
      Math.abs(event.clientY - pressOrigin.y) > MOVE_TOLERANCE
    ) {
      cancelDrag();
    }
    return;
  }
  event.preventDefault();
  const el = dockRef.value;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  const x = event.clientX - rect.left - grabOffset.x;
  const y = event.clientY - rect.top - grabOffset.y;
  /* 某一轴没有可移动余量时保留原值，否则会把记忆里的 1（贴右/贴底）冲成 0。 */
  const prev = livePos.value;
  dragPos.value = {
    nx: travelX.value <= 0 ? prev.nx : Math.min(1, Math.max(0, x / travelX.value)),
    ny: travelY.value <= 0 ? prev.ny : Math.min(1, Math.max(0, y / travelY.value)),
  };
}

function onDragEnd() {
  const wasDragging = dragging.value;
  const committed = dragPos.value;
  teardownDrag();
  if (wasDragging && committed) {
    setRingPosition(props.slotKey, committed);
    /* 吞掉紧随拖动的那次 click，否则松手即误触展开目录。用 window 捕获而不是
       组件内的标志位：松手点常在圆环之外（此时根本不派发 click），标志位会残留
       下来，把用户之后一次真实点击吃掉。 */
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("click", swallow, { capture: true, once: true });
    window.setTimeout(
      () => window.removeEventListener("click", swallow, { capture: true }),
      0,
    );
  }
  dragPos.value = null;
}

function onDragKey(event: KeyboardEvent) {
  if (event.key === "Escape") cancelDrag();
}

/** 放弃本次拖动：不写回位置。 */
function cancelDrag() {
  teardownDrag();
  dragPos.value = null;
}

function teardownDrag() {
  clearPressTimer();
  window.removeEventListener("mousemove", onDragMove, true);
  window.removeEventListener("mouseup", onDragEnd, true);
  window.removeEventListener("keydown", onDragKey, true);
  window.removeEventListener("blur", cancelDrag);
  if (dragging.value) {
    dragging.value = false;
    document.body.style.userSelect = prevUserSelect;
    document.body.style.cursor = prevCursor;
  }
}

/* ---------------- 进度与目录 ---------------- */

const open = ref(false);

const emit = defineEmits<{
  (e: "toggleZen", mode: "markdown" | "preview" | "off"): void;
  (e: "toggleSpotlight", active: boolean): void;
  /** 点目录项跳转：附上目标窗格的最终滚动位置，父级可据此同步另一侧窗格。 */
  (e: "jump", payload: { index: number; top: number }): void;
  (e: "save"): void;
  (e: "update:source", source: string): void;
}>();

/* ---------------- 手机高保真模拟预览状态 ---------------- */
const mobilePreviewOpen = ref(false);
const mobileNight = ref(false);
const mobileEditing = ref(false);
const mobileSource = ref(props.source);
const mobileFontSize = ref(15);
const mobileTocOpen = ref(false);
const mobileActiveIndex = ref(0);
const mobileEditorRef = ref<HTMLTextAreaElement | null>(null);

/** 手机预览正文样式：内容上色 CSS 变量（行首缩进 / 首字下沉由全局样式
    按「顶层正文段落」生效，无需行内兜底）。 */
const mobileReadingViewStyle = computed(() => ({
  ...(contentColoringOn.value ? contentColorCssVars(mobileNight.value) : {}),
}));

/** 手机预览正文：纯文本文档用阅读渲染（章节标题提升为标题），再做内容上色。 */
const renderMobileContent = computed(() => {
  const markedHtml = renderForReading(mobileSource.value);
  return contentColoringOn.value ? applyContentColoring(markedHtml) : markedHtml;
});

watch(() => props.source, (val) => {
  if (!mobileEditing.value) mobileSource.value = val;
});

function handleMobileSave() {
  emit("update:source", mobileSource.value);
  emit("save");
}

async function handleDownloadMd() {
  await downloadTextFileWithDialog(
    `${props.docTitle || "文档"}.md`,
    mobileSource.value,
    "text/markdown;charset=utf-8",
    [{ description: "Markdown 文件", accept: { "text/markdown": [".md"] } }],
  );
}

async function handleDownloadTxt() {
  await downloadTextFileWithDialog(
    `${props.docTitle || "文档"}.txt`,
    mobileSource.value,
    "text/plain;charset=utf-8",
    [{ description: "纯文本文件", accept: { "text/plain": [".txt"] } }],
  );
}

function cycleFontSize() {
  if (mobileFontSize.value === 14) mobileFontSize.value = 16;
  else if (mobileFontSize.value === 16) mobileFontSize.value = 18;
  else if (mobileFontSize.value === 18) mobileFontSize.value = 14;
  else mobileFontSize.value = 16;
}

function jumpMobileChapter(index: number) {
  const items = outline.value;
  if (!items.length || index < 0 || index >= items.length) return;
  mobileActiveIndex.value = index;
  mobileTocOpen.value = false;
  const pane = mobileEditorRef.value || document.querySelector(".mp-preview-body");
  if (pane) {
    const headingEls = pane.querySelectorAll("h1, h2, h3, h4, h5, h6");
    const targetEl = headingEls[index];
    if (targetEl) {
      targetEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }
}

function setZenMode(mode: "markdown" | "preview" | "off") {
  emit("toggleZen", mode);
}

function toggleSpotlight() {
  emit("toggleSpotlight", !props.spotlightActive);
}
const listRef = ref<HTMLDivElement | null>(null);

const outline = computed(() => parseOutline(props.source));

/** 目录来源：纯文本章节 vs Markdown 标题，仅用于面板文案。 */
const outlineIsChapter = computed(() => outline.value[0]?.kind === "chapter");

/** 全文字数（不计空白），目录头里作总计展示。 */
const totalChars = computed(() => countChars(props.source));

const percent = computed(() => {
  const p = Number.isFinite(props.progress) ? props.progress : 0;
  return Math.round(Math.min(1, Math.max(0, p)) * 100);
});
const ringOffset = computed(() => ringC.value * (1 - percent.value / 100));

/** 目录里最浅的层级作为缩进基准，避免整份文档都是 ## 时白缩一格。 */
const baseLevel = computed(() =>
  outline.value.reduce((min, item) => Math.min(min, item.level), 6),
);

/** 各标题在滚动容器内容坐标系中的顶部像素位置。 */
const tops = ref<number[]>([]);
const activeIndex = ref(-1);

function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

function measure() {
  const el = props.target;
  const items = outline.value;
  if (!el || !items.length) {
    tops.value = [];
    activeIndex.value = -1;
    return;
  }

  if (props.kind === "editor") {
    tops.value = measureTextareaTops(
      el as HTMLTextAreaElement,
      items.map((item) => item.offset),
    );
  } else {
    tops.value = measurePreviewTops(el, items);
  }
  updateActive();
}

function updateActive() {
  const el = props.target;
  if (!el || !tops.value.length) {
    activeIndex.value = -1;
    return;
  }
  const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
  activeIndex.value = activeHeadingIndex(tops.value, el.scrollTop, atBottom);
}

/** 只在面板展开期间维护测量与高亮，收起时零开销。 */
let measureTimer: number | null = null;
function scheduleMeasure(delay = 160) {
  if (!open.value) return;
  if (measureTimer !== null) window.clearTimeout(measureTimer);
  measureTimer = window.setTimeout(() => {
    measureTimer = null;
    measure();
  }, delay);
}

watch(() => props.source, () => scheduleMeasure());
watch(() => props.progress, () => {
  if (open.value) updateActive();
});
watch(ringSize, () => {
  syncDockSize();
});
watch(open, (isOpen) => {
  if (isOpen) {
    syncDockSize();
    measure();
    /* 展开时把当前章节滚进目录视野。手动写 scrollTop 而不用 scrollIntoView，
       后者会连带滚动祖先容器，把正文一起带偏。 */
    requestAnimationFrame(() => {
      const list = listRef.value;
      if (!list) return;
      const active = list.querySelector<HTMLElement>(".ring-toc-item.active");
      if (!active) return;
      const top = active.offsetTop;
      const bottom = top + active.offsetHeight;
      if (top < list.scrollTop) list.scrollTop = Math.max(0, top - 4);
      else if (bottom > list.scrollTop + list.clientHeight) {
        list.scrollTop = bottom - list.clientHeight + 4;
      }
    });
  } else if (measureTimer !== null) {
    window.clearTimeout(measureTimer);
    measureTimer = null;
  }
});
watch(enabled, (on) => {
  if (!on) {
    open.value = false;
    cancelDrag();
    detachObserver();
    dockSize.value = { w: 0, h: 0 };
  } else {
    /* 关闭期间 v-if 已卸载 DOM，重新开启后要重新挂观察器并量一次容器。 */
    void nextTick(attachObserver);
  }
});

function onRingClick() {
  syncDockSize();
  open.value = !open.value;
}

function jumpTo(index: number) {
  const el = props.target;
  if (!el) return;
  /* 点击是低频操作：先重量一次，字号 / 换行 / 图片加载后的位移都能吃掉。 */
  measure();
  const top = tops.value[index];
  if (top === undefined) return;
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  const next = Math.min(max, Math.max(0, top - 12));
  /* 首个标题落在容器内边距里时贴顶，避免留下几像素的空滚动。 */
  el.scrollTo({
    top: next <= 20 ? 0 : next,
    behavior: prefersReducedMotion() ? "auto" : "smooth",
  });
  /* 把本窗格的落点交给父级：开启「同步滚动」时，父级需要在目标窗格平滑滚动
     期间抑制反向比例同步，否则每次反馈同步都会把滚动中的窗格拉回起点。 */
  emit("jump", { index, top: next <= 20 ? 0 : next });
  activeIndex.value = index;
}

function onDocumentMouseDown(event: MouseEvent) {
  if (!open.value) return;
  const target = event.target as Node | null;
  if (target && dockRef.value?.contains(target)) return;
  open.value = false;
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (open.value && event.key === "Escape") open.value = false;
}

function onWindowResize() {
  syncDockSize();
  scheduleMeasure(120);
}

onMounted(() => {
  attachObserver();
  document.addEventListener("mousedown", onDocumentMouseDown);
  document.addEventListener("keydown", onDocumentKeydown);
  window.addEventListener("resize", onWindowResize);
});

onBeforeUnmount(() => {
  detachObserver();
  document.removeEventListener("mousedown", onDocumentMouseDown);
  document.removeEventListener("keydown", onDocumentKeydown);
  window.removeEventListener("resize", onWindowResize);
  teardownDrag();
  if (measureTimer !== null) window.clearTimeout(measureTimer);
});
</script>

<template>
  <div
    v-if="enabled"
    ref="dockRef"
    class="ring-dock"
    :class="{ open, dragging }"
    :style="{
      top: insetTop + 'px',
      right: insetRight + 'px',
      bottom: insetBottom + 'px',
      left: insetLeft + 'px',
      ...ringVars,
    }"
  >
    <button
      class="ring-btn"
      :class="{ active: open, dragging }"
      type="button"
      :style="[ringStyle, measured ? {} : { visibility: 'hidden' }]"
      :aria-expanded="open"
      :aria-label="`阅读进度 ${percent}%，点击${open ? '收起' : '展开'}目录，长按可拖动摆放`"
      :title="`阅读进度 ${percent}% · 点击${open ? '收起' : '展开'}目录 · 长按环心可拖动摆放`"
      @click.stop="onRingClick"
      @mousedown.stop="onRingPointerDown"
    >
      <svg class="ring-svg" viewBox="0 0 44 44" aria-hidden="true">
        <circle
          class="ring-track"
          cx="22"
          cy="22"
          :r="ringR"
          :stroke-width="strokeVB"
          fill="none"
        />
        <circle
          class="ring-fill"
          cx="22"
          cy="22"
          :r="ringR"
          :stroke-width="strokeVB"
          fill="none"
          :stroke-dasharray="ringC"
          :stroke-dashoffset="ringOffset"
        />
      </svg>
      <span class="ring-label num-tabular">
        {{ percent }}<span v-if="showUnit" class="ring-unit">%</span>
      </span>
    </button>

    <Transition name="ring-panel">
      <nav
        v-if="open && !dragging"
        class="ring-toc"
        :class="{ up: dropUp, 'align-right': livePos.nx > 0.5 }"
        :style="panelStyle"
        aria-label="文档目录与专注禅定"
      >
        <div class="ring-toc-head">
          <span class="ring-toc-title label-caps">{{ outlineIsChapter ? '章节' : '目录' }}</span>
          <span class="ring-toc-count num-tabular">
            {{ outline.length }} 项
            <template v-if="totalChars > 0"> · {{ formatChars(totalChars) }} 字</template>
          </span>
        </div>
        <div v-if="outline.length" ref="listRef" class="ring-toc-list">
          <button
            v-for="(item, index) in outline"
            :key="item.id"
            class="ring-toc-item"
            :class="[`lv-${item.level}`, { active: index === activeIndex }]"
            :style="{
              paddingLeft: `calc(var(--toc-indent) + ${Math.min(4, item.level - baseLevel)} * 11px)`,
            }"
            type="button"
            :title="`${item.text}（${item.chars} 字）`"
            @click.stop="jumpTo(index)"
          >
            <span class="ring-toc-dot" aria-hidden="true"></span>
            <span class="ring-toc-text">{{ item.text }}</span>
            <span class="ring-toc-chars num-tabular">{{ formatChars(item.chars) }}</span>
          </button>
        </div>
        <div v-else class="ring-toc-empty">当前文档还没有标题或章节</div>

        <!-- 目录下方简洁靠右的禅定模式与聚光模式图标按钮（不占据目录太多空间） -->
        <div class="ring-zen-section">
          <div class="ring-zen-actions">
            <button
              class="ring-zen-icon-btn"
              :class="{ active: props.zenMode === 'markdown', disabled: props.zenDisabled }"
              :disabled="props.zenDisabled"
              :title="props.zenDisabled ? '卡片/拼文中不可用（已禁用禅定）' : '禅定：Markdown单栏全屏专注'"
              @click.stop="!props.zenDisabled && setZenMode(props.zenMode === 'markdown' ? 'off' : 'markdown')"
            >
              <FileText :size="13" :stroke-width="1.8" />
            </button>
            <button
              class="ring-zen-icon-btn"
              :class="{ active: props.zenMode === 'preview', disabled: props.zenDisabled }"
              :disabled="props.zenDisabled"
              :title="props.zenDisabled ? '卡片/拼文中不可用（已禁用禅定）' : '禅定：预览单栏全屏专注'"
              @click.stop="!props.zenDisabled && setZenMode(props.zenMode === 'preview' ? 'off' : 'preview')"
            >
              <LayoutTemplate :size="13" :stroke-width="1.8" />
            </button>
            <button
              class="ring-zen-icon-btn"
              :class="{ active: props.spotlightActive }"
              title="段落聚光灯（鼠标/光标所在段落清晰，其余朦胧化）"
              @click.stop="toggleSpotlight"
            >
              <Focus :size="13" :stroke-width="1.8" />
            </button>
            <button
              class="ring-zen-icon-btn"
              title="手机高保真模拟预览"
              @click.stop="mobilePreviewOpen = true"
            >
              <Smartphone :size="13" :stroke-width="1.8" />
            </button>
          </div>
        </div>
      </nav>
    </Transition>

    <!-- 手机高保真模拟预览弹窗面板 -->
    <Teleport to="body">
      <!-- mousedown.stop：本面板 Teleport 到 body，宿主（卡片编辑面板 / 地图卡片面板）
           的「点击空白处收起」是挂在 document 上的 mousedown，若让事件冒上去，
           点面板里任何按钮（夜间、字号、翻章节……）都会先把宿主面板关掉，
           连带本面板一起卸载，按钮的 click 永远不会执行。 -->
      <div
        v-if="mobilePreviewOpen"
        class="mobile-preview-mask"
        @mousedown.stop
        @click.self="mobilePreviewOpen = false"
      >
        <div class="mobile-preview-shell" :class="{ dark: mobileNight }">
          <!-- 顶部栏 -->
          <div class="mp-header">
            <button class="mp-btn" title="返回" @click="mobilePreviewOpen = false">
              <ArrowLeft :size="16" :stroke-width="2" />
            </button>
            <span class="mp-title">{{ docTitle }}</span>
            <button class="mp-btn" :title="mobileNight ? '切换为日间模式' : '切换为夜间模式'" @click="mobileNight = !mobileNight">
              <component :is="mobileNight ? Sun : Moon" :size="16" :stroke-width="1.8" />
            </button>
          </div>

          <!-- 功能操作栏：编辑正文、保存、下载 MD、下载 TXT -->
          <div class="mp-actions-bar">
            <button class="mp-action-chip" :class="{ active: mobileEditing }" @click="mobileEditing = !mobileEditing">
              <Edit3 :size="13" :stroke-width="1.8" />
              <span>{{ mobileEditing ? '退出编辑' : '编辑正文' }}</span>
            </button>
            <button class="mp-action-chip" @click="handleMobileSave">
              <Save :size="13" :stroke-width="1.8" />
              <span>保存</span>
            </button>
            <button class="mp-action-chip" @click="handleDownloadMd">
              <Download :size="13" :stroke-width="1.8" />
              <span>下载 MD</span>
            </button>
            <button class="mp-action-chip" @click="handleDownloadTxt">
              <Download :size="13" :stroke-width="1.8" />
              <span>下载 TXT</span>
            </button>
          </div>

          <!-- 手机尺寸屏幕阅读布局内容区 -->
          <div class="mp-device-frame">
            <div class="mp-device-speaker"></div>
            <div class="mp-preview-body" :style="{ fontSize: mobileFontSize + 'px' }">
              <textarea
                v-if="mobileEditing"
                ref="mobileEditorRef"
                v-model="mobileSource"
                class="mp-textarea"
                :style="{ fontSize: mobileFontSize + 'px' }"
                @input="emit('update:source', mobileSource)"
                placeholder="在此编辑正文..."
              ></textarea>
              <div
                v-else
                class="markdown-body reading-view"
                :class="{
                  'content-colored': contentColoringOn,
                  'first-line-indent': aiSettings.firstLineIndent,
                  'drop-cap': aiSettings.dropCap,
                }"
                :style="mobileReadingViewStyle"
                v-html="renderMobileContent"
              ></div>
            </div>
            <!-- 目录面板抽屉内嵌 -->
            <div v-if="mobileTocOpen" class="mp-toc-drawer" @click.stop>
              <div class="mp-toc-header">
                <span>文档目录</span>
                <button class="mp-btn-sm" @click="mobileTocOpen = false"><X :size="14" /></button>
              </div>
              <div class="mp-toc-list">
                <button
                  v-for="(item, idx) in outline"
                  :key="item.id"
                  class="mp-toc-item"
                  @click="jumpMobileChapter(idx)"
                >
                  {{ item.text }}
                </button>
                <div v-if="!outline.length" class="mp-toc-empty">暂无章节标题</div>
              </div>
            </div>
          </div>

          <!-- 底部工具栏：上一章、目录、字号、下一章 -->
          <div class="mp-footer">
            <button class="mp-footer-btn" :disabled="mobileActiveIndex <= 0" @click="jumpMobileChapter(mobileActiveIndex - 1)">
              <ChevronLeft :size="15" />
              <span>上一章</span>
            </button>
            <button class="mp-footer-btn" @click="mobileTocOpen = !mobileTocOpen">
              <List :size="15" />
              <span>目录</span>
            </button>
            <button class="mp-footer-btn" @click="cycleFontSize" :title="`当前字号：${mobileFontSize}px`">
              <Type :size="15" />
              <span>字号({{ mobileFontSize }})</span>
            </button>
            <button class="mp-footer-btn" :disabled="mobileActiveIndex >= outline.length - 1" @click="jumpMobileChapter(mobileActiveIndex + 1)">
              <span>下一章</span>
              <ChevronRight :size="15" />
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* 容器铺满可摆放矩形但不吃事件，只有圆环与目录项可交互，避免挡住正文选取。
   铺满也让归一化坐标有一个稳定的参照系：分栏宽度、窗口尺寸、圆环直径变化后，
   圆环仍停在用户放的那个角落 / 边上。 */
.ring-dock {
  position: absolute;
  z-index: 8;
  pointer-events: none;
}

/* ---------- 圆环 ---------- */
.ring-btn {
  position: absolute;
  width: var(--ring-size);
  height: var(--ring-size);
  border-radius: 50%;
  pointer-events: auto;
  cursor: pointer;
  /* 半透明玻璃：底下正文的颜色会透上来，环体仍然清晰。
     不透明度由设置项控制（--glass-* 由脚本按比例算好）。 */
  background: rgb(255 255 255 / var(--glass-a));
  border: 1px solid rgb(var(--primary-rgb) / calc(0.16 * var(--glass-edge) / 0.7));
  box-shadow:
    0 6px 18px -8px rgb(15 23 42 / calc(0.28 * var(--glass-shadow))),
    0 1px 2px rgb(15 23 42 / calc(0.06 * var(--glass-shadow))),
    inset 0 1px 0 rgb(255 255 255 / var(--glass-edge));
  backdrop-filter: blur(var(--glass-blur)) saturate(1.5);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.5);
  transition:
    transform 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.22s cubic-bezier(0.16, 1, 0.3, 1),
    background 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

/* 悬停 / 展开 / 拖动时整体提亮一档：即便用户把透明度调得很低，
   交互反馈依然清楚，但仍相对基准值等比例，不会突然实心。 */
.ring-btn:hover {
  transform: translateY(-1px) scale(1.04);
  background: rgb(255 255 255 / var(--glass-a-hover));
  border-color: rgb(var(--primary-rgb) / calc(0.34 * var(--glass-edge) / 0.7));
  box-shadow:
    0 12px 26px -10px rgb(15 23 42 / calc(0.34 * var(--glass-shadow))),
    0 2px 4px rgb(15 23 42 / calc(0.06 * var(--glass-shadow))),
    inset 0 1px 0 rgb(255 255 255 / var(--glass-edge));
}

.ring-btn:active {
  transform: scale(0.96);
}

.ring-btn.active {
  background: rgb(255 255 255 / var(--glass-a-active));
  border-color: rgb(var(--primary-rgb) / calc(0.42 * var(--glass-edge) / 0.7));
  box-shadow:
    0 12px 28px -10px rgb(15 23 42 / calc(0.32 * var(--glass-shadow))),
    0 0 0 3px rgb(var(--primary-rgb) / calc(0.1 * var(--glass-shadow))),
    inset 0 1px 0 rgb(255 255 255 / var(--glass-edge));
}

/* 拖动中：抬起、跟手，并抑制过渡以免落点滞后于光标。 */
.ring-btn.dragging,
.ring-btn.dragging:hover {
  transition: none;
  transform: scale(1.08);
  cursor: grabbing;
  background: rgb(255 255 255 / var(--glass-a-drag));
  border-color: rgb(var(--primary-rgb) / calc(0.5 * var(--glass-edge) / 0.7));
  box-shadow:
    0 18px 34px -12px rgb(15 23 42 / calc(0.4 * var(--glass-shadow))),
    0 0 0 4px rgb(var(--primary-rgb) / calc(0.12 * var(--glass-shadow))),
    inset 0 1px 0 rgb(255 255 255 / var(--glass-edge));
}

.ring-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  /* 12 点方向起笔，顺时针推进。 */
  transform: rotate(-90deg);
}

.ring-track {
  stroke: rgb(var(--primary-rgb) / 0.14);
}

.ring-fill {
  stroke: var(--primary);
  stroke-linecap: round;
  transition: stroke-dashoffset 0.24s cubic-bezier(0.16, 1, 0.3, 1);
}

.ring-label {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: baseline;
  justify-content: center;
  font-size: var(--ring-num);
  font-weight: 650;
  line-height: var(--ring-size);
  letter-spacing: -0.02em;
  color: var(--primary);
  /* 低不透明度时数字直接压在正文上，白色描边保住可读性；100% 时该值为 0，
     等同于没有描边。 */
  text-shadow:
    0 1px 2px rgb(255 255 255 / var(--num-halo)),
    0 0 3px rgb(255 255 255 / var(--num-halo));
  user-select: none;
  /* 长按拖动的手柄就是这块百分比。 */
  cursor: grab;
}

.ring-btn.dragging .ring-label {
  cursor: grabbing;
}

.ring-unit {
  font-size: 0.66em;
  font-weight: 600;
  opacity: 0.62;
  margin-left: 0.5px;
}

/* ---------- 目录面板 ---------- */
.ring-toc {
  position: absolute;
  display: flex;
  flex-direction: column;
  min-height: 0;
  pointer-events: auto;
  background: rgb(255 255 255 / var(--glass-toc-a));
  border: 1px solid rgb(255 255 255 / calc(0.58 * var(--glass-edge) / 0.7));
  outline: 1px solid rgb(var(--primary-rgb) / calc(0.1 * var(--glass-shadow)));
  outline-offset: -1px;
  border-radius: var(--toc-radius);
  box-shadow:
    0 18px 40px -16px rgb(15 23 42 / calc(0.34 * var(--glass-shadow))),
    0 2px 8px -2px rgb(15 23 42 / calc(0.08 * var(--glass-shadow)));
  backdrop-filter: blur(var(--toc-blur)) saturate(1.6);
  -webkit-backdrop-filter: blur(var(--toc-blur)) saturate(1.6);
  overflow: hidden;
  transform-origin: top left;
}

.ring-toc.align-right {
  transform-origin: top right;
}

.ring-toc.up {
  transform-origin: bottom left;
}

.ring-toc.up.align-right {
  transform-origin: bottom right;
}

.ring-toc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 11px 7px;
  border-bottom: 1px solid rgb(var(--primary-rgb) / calc(0.1 * var(--glass-shadow)));
  flex-shrink: 0;
}

.ring-toc-title {
  color: var(--primary);
}

.ring-toc-count {
  font-size: 10.5px;
  color: var(--on-surface-variant);
  opacity: 0.8;
}

.ring-toc-list {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ring-toc-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 7px;
  width: 100%;
  padding: var(--toc-row-pad) 9px var(--toc-row-pad) var(--toc-indent);
  border-radius: 7px;
  text-align: left;
  font-size: var(--toc-font);
  line-height: 1.45;
  color: var(--on-surface-variant);
  transition:
    background 0.16s ease,
    color 0.16s ease;
}

.ring-toc-item:hover {
  background: rgb(var(--primary-rgb) / 0.09);
  color: var(--on-surface);
}

.ring-toc-item:active {
  transform: none;
}

.ring-zen-section {
  padding: 4px 8px;
  border-top: 1px solid rgb(var(--primary-rgb) / calc(0.1 * var(--glass-shadow)));
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-start;
}

.ring-zen-actions {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ring-zen-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid rgb(var(--primary-rgb) / calc(0.16 * var(--glass-edge) / 0.7));
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ring-zen-icon-btn:hover {
  background: rgb(var(--primary-rgb) / 0.1);
  color: var(--primary);
  border-color: var(--primary);
}

.ring-zen-icon-btn.active {
  background: rgba(var(--primary-rgb) / 0.16);
  color: var(--primary);
  border-color: var(--primary);
}

/* 层级导引点：越深越小越淡，一眼分出标题层次。 */
.ring-toc-dot {
  flex: 0 0 auto;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.34;
}

.ring-toc-item.lv-1 .ring-toc-dot {
  width: 5px;
  height: 5px;
  opacity: 0.72;
}

.ring-toc-item.lv-2 .ring-toc-dot {
  opacity: 0.54;
}

.ring-toc-item.active .ring-toc-dot {
  opacity: 1;
}

.ring-toc-item.lv-1 {
  font-weight: 600;
  color: var(--on-surface);
}

.ring-toc-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 各章字数：靠右、比标题更淡，不与标题争视觉重心。 */
.ring-toc-chars {
  flex: 0 0 auto;
  font-size: 0.84em;
  font-variant-numeric: tabular-nums;
  color: var(--on-surface-variant);
  opacity: 0.62;
}

.ring-toc-item:hover .ring-toc-chars,
.ring-toc-item.active .ring-toc-chars {
  opacity: 0.85;
}

.ring-toc-empty {
  padding: 15px 12px 17px;
  text-align: center;
  font-size: var(--toc-font);
  color: var(--on-surface-variant);
  opacity: 0.75;
}

/* ---------- 展开 / 收起动画（自圆环那一侧生长） ---------- */
.ring-panel-enter-active {
  transition:
    opacity 0.2s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.ring-panel-leave-active {
  transition:
    opacity 0.14s ease,
    transform 0.16s ease;
}

.ring-panel-enter-from,
.ring-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.94);
}

.ring-toc.up.ring-panel-enter-from,
.ring-toc.up.ring-panel-leave-to {
  transform: translateY(8px) scale(0.94);
}

.ring-panel-enter-to,
.ring-panel-leave-from {
  opacity: 1;
  transform: translateY(0) scale(1);
}

@media (prefers-reduced-motion: reduce) {
  .ring-btn,
  .ring-fill,
  .ring-toc-item,
  .ring-panel-enter-active,
  .ring-panel-leave-active {
    transition: none;
  }

  .ring-btn:hover {
    transform: none;
  }
}

.ring-zen-icon-btn.disabled {
  opacity: 0.35;
  cursor: not-allowed;
  pointer-events: none;
}

/* 手机模拟预览弹窗 */
.mobile-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(15, 23, 42, 0.65);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.mobile-preview-shell {
  width: 410px;
  max-width: 100%;
  height: 780px;
  max-height: 92vh;
  background: var(--surface-bright, #ffffff);
  border-radius: 40px;
  border: 10px solid #1e293b;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.45);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  transition: background 0.2s, color 0.2s;
}

.mobile-preview-shell.dark {
  background: #2b2b2b;
  color: #e8e8e8;
  border-color: #1c1c1c;
}

.mobile-preview-shell.dark .mp-preview-body,
.mobile-preview-shell.dark .markdown-body {
  color: #e0e0e0;
}

.mp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--outline-variant, #e2e8f0);
  background: inherit;
  flex-shrink: 0;
}

.mobile-preview-shell.dark .mp-header {
  border-bottom-color: #404040;
}

.mp-title {
  font-size: 14px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 240px;
}

.mp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mp-btn:hover {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--primary);
}

.mp-actions-bar {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--outline-variant, #e2e8f0);
  background: var(--surface-container, #f1f5f9);
  flex-shrink: 0;
}

.mobile-preview-shell.dark .mp-actions-bar {
  background: #323232;
  border-bottom-color: #404040;
}

.mp-action-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 11.5px;
  font-weight: 500;
  background: var(--surface-bright, #fff);
  border: 1px solid var(--outline-variant, #cbd5e1);
  color: inherit;
  cursor: pointer;
}

.mobile-preview-shell.dark .mp-action-chip {
  background: #383838;
  border-color: #4f4f4f;
}

.mp-action-chip:hover,
.mp-action-chip.active {
  background: var(--primary);
  color: var(--on-primary, #fff);
  border-color: var(--primary);
}

.mp-device-frame {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: inherit;
  overflow: hidden;
}

.mp-device-speaker {
  width: 60px;
  height: 4px;
  background: #cbd5e1;
  border-radius: 2px;
  margin: 6px auto 0;
  flex-shrink: 0;
}

.mobile-preview-shell.dark .mp-device-speaker {
  background: #4d4d4d;
}

.mp-preview-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px 20px;
  line-height: 1.7;
}

.mp-textarea {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  resize: none;
  line-height: inherit;
}

.mp-toc-drawer {
  position: absolute;
  inset: 0;
  background: var(--surface-bright, #fff);
  z-index: 10;
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.mobile-preview-shell.dark .mp-toc-drawer {
  background: #2b2b2b;
}

.mobile-preview-shell.dark .mp-toc-header {
  border-bottom-color: #404040;
}

.mp-toc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--outline-variant, #e2e8f0);
}

.mp-toc-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mp-toc-item {
  width: 100%;
  padding: 8px 12px;
  border-radius: 8px;
  text-align: left;
  font-size: 12.5px;
  color: inherit;
  background: transparent;
  cursor: pointer;
}

.mp-toc-item:hover {
  background: rgba(var(--primary-rgb), 0.1);
  color: var(--primary);
}

.mp-toc-empty {
  padding: 20px;
  text-align: center;
  font-size: 12px;
  opacity: 0.7;
}

.mp-footer {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 10px 12px;
  border-top: 1px solid var(--outline-variant, #e2e8f0);
  background: var(--surface-container, #f8fafc);
  flex-shrink: 0;
}

.mobile-preview-shell.dark .mp-footer {
  background: #323232;
  border-top-color: #404040;
}

.mp-footer-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mp-footer-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb), 0.12);
  color: var(--primary);
}

.mp-footer-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
</style>
