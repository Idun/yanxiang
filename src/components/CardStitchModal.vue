<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount, onMounted } from "vue";
import {
  X,
  FileText,
  GitCompare,
  BookOpen,
  ArrowLeftRight,
  Sparkles,
  PenLine,
  Quote,
  ArrowLeft,
} from "lucide-vue-next";
import { type WritingCard } from "../libraryStore";
import { showToast } from "../insightStore";
import { aiSettings } from "../settings";
import {
  contentScrollMax,
  mapScrollTop,
  scrollSpanOf,
  typewriterRunwayPx,
  typewriterTargetTop,
} from "../typewriterScroll";
import DocumentViewer from "./DocumentViewer.vue";
import ReadingProgressRing from "./ReadingProgressRing.vue";
import InlineAiEdit from "./InlineAiEdit.vue";

const props = defineProps<{
  cards: WritingCard[];
  initialMode?: "preview" | "compare";
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "save", updatedCards: WritingCard[]): void;
}>();

const activeMode = ref<"preview" | "compare">(props.initialMode || "preview");

/* ================= 拼文预览相关 ================= */
const stitchedContent = ref(
  props.cards.map((c) => `# ${c.title}\n\n${c.content}`).join("\n\n---\n\n")
);
const activeCardIdInPreview = ref<number | null>(props.cards[0]?.id ?? null);

function jumpToCardInPreview(card: WritingCard) {
  activeCardIdInPreview.value = card.id;
}

function handleSavePreview() {
  const updated = props.cards.map((card) => card);
  emit("save", updated);
  showToast("保存成功", "拼文预览内容已更新", "habit");
  emit("close");
}

/* ================= 拼文对比相关 ================= */
const compareLeftId = ref<number>(props.cards[0]?.id ?? 0);
const compareRightId = ref<number>(props.cards[1]?.id ?? props.cards[0]?.id ?? 0);

const leftCard = computed(() => props.cards.find((c) => c.id === compareLeftId.value) || props.cards[0]);
const rightCard = computed(() => props.cards.find((c) => c.id === compareRightId.value) || props.cards[1] || props.cards[0]);

const leftContent = ref(leftCard.value?.content ?? "");
const rightContent = ref(rightCard.value?.content ?? "");

/* 撤销/重做历史栈 */
const leftHistory = ref<string[]>([leftContent.value]);
const leftHistoryIndex = ref<number>(0);
const rightHistory = ref<string[]>([rightContent.value]);
const rightHistoryIndex = ref<number>(0);
let lockHistory = false;

function recordLeftHistory(val: string) {
  if (lockHistory) return;
  const h = leftHistory.value;
  const idx = leftHistoryIndex.value;
  if (h[idx] === val) return;
  const nextH = h.slice(0, idx + 1);
  nextH.push(val);
  if (nextH.length > 150) nextH.shift();
  leftHistory.value = nextH;
  leftHistoryIndex.value = nextH.length - 1;
}

function recordRightHistory(val: string) {
  if (lockHistory) return;
  const h = rightHistory.value;
  const idx = rightHistoryIndex.value;
  if (h[idx] === val) return;
  const nextH = h.slice(0, idx + 1);
  nextH.push(val);
  if (nextH.length > 150) nextH.shift();
  rightHistory.value = nextH;
  rightHistoryIndex.value = nextH.length - 1;
}

watch(leftContent, (val) => {
  recordLeftHistory(val);
});

watch(rightContent, (val) => {
  recordRightHistory(val);
});

watch(
  [compareLeftId, compareRightId],
  () => {
    leftContent.value = leftCard.value?.content ?? "";
    rightContent.value = rightCard.value?.content ?? "";
    leftHistory.value = [leftContent.value];
    leftHistoryIndex.value = 0;
    rightHistory.value = [rightContent.value];
    rightHistoryIndex.value = 0;
  },
  { immediate: true }
);

function undo(side: "left" | "right") {
  if (side === "left") {
    if (leftHistoryIndex.value > 0) {
      leftHistoryIndex.value--;
      lockHistory = true;
      leftContent.value = leftHistory.value[leftHistoryIndex.value];
      lockHistory = false;
    }
  } else {
    if (rightHistoryIndex.value > 0) {
      rightHistoryIndex.value--;
      lockHistory = true;
      rightContent.value = rightHistory.value[rightHistoryIndex.value];
      lockHistory = false;
    }
  }
}

function redo(side: "left" | "right") {
  if (side === "left") {
    if (leftHistoryIndex.value < leftHistory.value.length - 1) {
      leftHistoryIndex.value++;
      lockHistory = true;
      leftContent.value = leftHistory.value[leftHistoryIndex.value];
      lockHistory = false;
    }
  } else {
    if (rightHistoryIndex.value < rightHistory.value.length - 1) {
      rightHistoryIndex.value++;
      lockHistory = true;
      rightContent.value = rightHistory.value[rightHistoryIndex.value];
      lockHistory = false;
    }
  }
}

function swapCompareCards() {
  const tempId = compareLeftId.value;
  compareLeftId.value = compareRightId.value;
  compareRightId.value = tempId;

  const tempText = leftContent.value;
  leftContent.value = rightContent.value;
  rightContent.value = tempText;
}

interface DiffToken {
  text: string;
  type: "same" | "added" | "removed";
}

function splitSentenceUnits(text: string): string[] {
  if (!text) return [];
  const units = text.split(/(?<=[。！？.!?\n])/g).filter(Boolean);
  return units.length > 0 ? units : [text];
}

function diffSentencePair(s1: string, s2: string): { left: DiffToken[]; right: DiffToken[] } {
  const c1 = Array.from(s1);
  const c2 = Array.from(s2);
  const n = c1.length;
  const m = c2.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = c1[i] === c2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const left: DiffToken[] = [];
  const right: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (c1[i] === c2[j]) {
      left.push({ text: c1[i], type: "same" });
      right.push({ text: c2[j], type: "same" });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      left.push({ text: c1[i], type: "removed" });
      i++;
    } else {
      right.push({ text: c2[j], type: "added" });
      j++;
    }
  }

  while (i < n) {
    left.push({ text: c1[i], type: "removed" });
    i++;
  }
  while (j < m) {
    right.push({ text: c2[j], type: "added" });
    j++;
  }

  return { left, right };
}

function mergeDiffTokens(tokens: DiffToken[]): DiffToken[] {
  const merged: DiffToken[] = [];
  for (const t of tokens) {
    if (!t.text) continue;
    if (merged.length > 0 && merged[merged.length - 1].type === t.type) {
      merged[merged.length - 1].text += t.text;
    } else {
      merged.push({ ...t });
    }
  }
  return merged;
}

function sentenceSimilarity(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1;
  const c1 = Array.from(s1);
  const c2 = Array.from(s2);
  let common = 0;
  const set2 = new Map<string, number>();
  for (const char of c2) set2.set(char, (set2.get(char) || 0) + 1);
  for (const char of c1) {
    const count = set2.get(char);
    if (count && count > 0) {
      common++;
      set2.set(char, count - 1);
    }
  }
  return (2 * common) / (c1.length + c2.length);
}

function diffTexts(oldText: string | undefined, newText: string | undefined): { left: DiffToken[]; right: DiffToken[] } {
  const oldStr = oldText ?? "";
  const newStr = newText ?? "";

  if (!oldStr && !newStr) return { left: [], right: [] };
  if (!oldStr) return { left: [], right: [{ text: newStr, type: "added" }] };
  if (!newStr) return { left: [{ text: oldStr, type: "removed" }], right: [] };

  const u1 = splitSentenceUnits(oldStr);
  const u2 = splitSentenceUnits(newStr);
  const n = u1.length;
  const m = u2.length;

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = u1[i] === u2[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const leftRaw: DiffToken[] = [];
  const rightRaw: DiffToken[] = [];
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (u1[i] === u2[j]) {
      leftRaw.push({ text: u1[i], type: "same" });
      rightRaw.push({ text: u2[j], type: "same" });
      i++;
      j++;
    } else {
      const isPair =
        j < m &&
        sentenceSimilarity(u1[i], u2[j]) >= 0.22 &&
        (dp[i + 1][j + 1] === dp[i + 1][j] || dp[i + 1][j + 1] === dp[i][j + 1] || dp[i][j] === dp[i + 1][j + 1]);

      if (isPair) {
        const pair = diffSentencePair(u1[i], u2[j]);
        leftRaw.push(...pair.left);
        rightRaw.push(...pair.right);
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        leftRaw.push({ text: u1[i], type: "removed" });
        i++;
      } else {
        rightRaw.push({ text: u2[j], type: "added" });
        j++;
      }
    }
  }

  while (i < n) {
    leftRaw.push({ text: u1[i], type: "removed" });
    i++;
  }
  while (j < m) {
    rightRaw.push({ text: u2[j], type: "added" });
    j++;
  }

  return { left: mergeDiffTokens(leftRaw), right: mergeDiffTokens(rightRaw) };
}

const currentCompareDiff = computed(() => {
  return diffTexts(leftContent.value, rightContent.value);
});

const diffStats = computed(() => {
  let removedCount = 0;
  let addedCount = 0;
  for (const t of currentCompareDiff.value.left) {
    if (t.type === "removed") removedCount += t.text.length;
  }
  for (const t of currentCompareDiff.value.right) {
    if (t.type === "added") addedCount += t.text.length;
  }
  return { removedCount, addedCount };
});

const leftEditorRef = ref<HTMLTextAreaElement | null>(null);
const rightEditorRef = ref<HTMLTextAreaElement | null>(null);
const leftBackdropRef = ref<HTMLDivElement | null>(null);
const rightBackdropRef = ref<HTMLDivElement | null>(null);

/* 与拼文预览（内嵌 DocumentViewer 的编辑区）同源的字体与字号。
   预览侧是 :style="{ fontSize: editorFontSize + 'px', fontFamily: editorFontStack }"，
   其中 editorFontStack = `"${aiSettings.appFont}", var(--app-font)`；对比侧此前只在
   CSS 里写死 var(--code-font) / 14px，两边永远对不上。这里改为读同一份配置。
   textarea 与 backdrop 必须共用同一个 style，否则差异高亮会逐字错位。 */
const compareTextStyle = computed(() => ({
  fontSize: `${aiSettings.editorFontSize}px`,
  fontFamily: `"${aiSettings.appFont}", var(--app-font)`,
}));

/* ---- 拼文对比阅读进度条（0~1） ---- */
const leftProgress = ref(0);
const rightProgress = ref(0);

/* ---- 打字机滚动：末尾跑道 ----
   两侧编辑框各自补一段底部跑道，正文最后一行也能被滚到编辑框中部书写。
   背层（差异高亮）必须补同样的跑道，并与编辑框「分段映射」地同步：
   正文段映正文段、跑道段映跑道段。早先按单一比例（且钳在 1）同步，
   编辑框一旦被打字机滚进跑道，背层就卡在正文末尾不动 —— 而可见的字是
   背层画的（textarea 自身文字透明），于是看起来「打字机滚动完全没生效」。 */
const leftRunwayPx = ref(0);
const rightRunwayPx = ref(0);

function refreshStitchRunway() {
  leftRunwayPx.value = typewriterRunwayPx(leftEditorRef.value);
  rightRunwayPx.value = typewriterRunwayPx(rightEditorRef.value);
}

/** 四个滚动层各自的可滚区间（正文段 + 跑道段）。 */
function stitchSpans() {
  return {
    lEd: scrollSpanOf(leftEditorRef.value, leftRunwayPx.value),
    rEd: scrollSpanOf(rightEditorRef.value, rightRunwayPx.value),
    lBd: scrollSpanOf(leftBackdropRef.value, leftRunwayPx.value),
    rBd: scrollSpanOf(rightBackdropRef.value, rightRunwayPx.value),
  };
}

function updateStitchProgress() {
  const lEd = leftEditorRef.value;
  const rEd = rightEditorRef.value;
  if (!lEd) leftProgress.value = 0;
  else {
    const max = contentScrollMax(lEd, leftRunwayPx.value);
    leftProgress.value = max <= 0 ? 0 : Math.min(1, lEd.scrollTop / max);
  }
  if (!rEd) rightProgress.value = 0;
  else {
    const max = contentScrollMax(rEd, rightRunwayPx.value);
    rightProgress.value = max <= 0 ? 0 : Math.min(1, rEd.scrollTop / max);
  }
}

/**
 * 打字机滚动：写字时把光标那一行保持在编辑框中部。
 *
 * 只在 input（内容真的改了）时调用。滚动源编辑框后，背层与另一侧由 onScroll
 * 的分段映射跟上，四层不会错位。
 */
async function applyStitchTypewriter(side: "left" | "right") {
  const el = side === "left" ? leftEditorRef.value : rightEditorRef.value;
  if (!el) return;
  /* 跑道要先落到 DOM（它写进 padding-bottom）才量得准：值有变化就多等一帧，
     否则首次输入会拿着「还没有跑道」的 scrollHeight 去判断，推不到中部。 */
  const before = side === "left" ? leftRunwayPx.value : rightRunwayPx.value;
  refreshStitchRunway();
  const after = side === "left" ? leftRunwayPx.value : rightRunwayPx.value;
  if (after !== before) await nextTick();

  const next = typewriterTargetTop(el);
  if (next === null) return;
  el.scrollTop = next;
}

function onStitchInput(side: "left" | "right") {
  void nextTick(() => applyStitchTypewriter(side));
}

/* 内容变化 / 切换对比卡片后重算进度。 */
watch([leftContent, rightContent], () => {
  nextTick(() => {
    refreshStitchRunway();
    updateStitchProgress();
  });
});

let syncScrollLock = false;
/** 目录跳转期间的比例同步抑制计时器（下限兜底，scrollend 是主释放途径）。 */
let ringJumpTimer: number | null = null;

/**
 * 阅读圆环目录跳转的统一协调：把「另一侧编辑框 + 两个背层」直接落到目标比例，
 * 并在当前窗格的平滑滚动结束前抑制反向滚动同步。否则平滑滚动一帧帧前进时，
 * 反向同步会把源窗格 scrollTop 设回当前比例位置、中止平滑动画，表现为点目录不跳转。
 */
function onRingJump(side: "left" | "right", payload: { index: number; top: number }) {
  const lEd = leftEditorRef.value;
  const rEd = rightEditorRef.value;
  const lBd = leftBackdropRef.value;
  const rBd = rightBackdropRef.value;
  const sourceEditor = side === "left" ? lEd : rEd;
  if (!sourceEditor) return;

  /* 四层各自的可滚区间（含跑道段），与 onScroll 同一套分段映射。 */
  const span = stitchSpans();
  const fromSpan = side === "left" ? span.lEd : span.rEd;
  if (fromSpan.contentMax + fromSpan.runway <= 0) return;

  syncScrollLock = true;
  if (side === "left") {
    if (rEd) rEd.scrollTop = mapScrollTop(payload.top, fromSpan, span.rEd);
    if (rBd) rBd.scrollTop = mapScrollTop(payload.top, fromSpan, span.rBd);
  } else {
    if (lEd) lEd.scrollTop = mapScrollTop(payload.top, fromSpan, span.lEd);
    if (lBd) lBd.scrollTop = mapScrollTop(payload.top, fromSpan, span.lBd);
  }

  /* 源窗格的背层要跟着源编辑框一起平滑滚动（onScroll 正被同步锁抑制，
     不能指望它逐帧跟上来）。跳转结束后卸载这个即时镜像。 */
  const sourceBackdrop = side === "left" ? lBd : rBd;
  const sourceBackdropSpan = side === "left" ? span.lBd : span.rBd;
  const mirrorSourceBackdrop = () => {
    if (sourceBackdrop) {
      sourceBackdrop.scrollTop = mapScrollTop(
        sourceEditor.scrollTop,
        fromSpan,
        sourceBackdropSpan,
      );
    }
  };
  sourceEditor.addEventListener("scroll", mirrorSourceBackdrop);

  const release = () => {
    if (ringJumpTimer !== null) {
      window.clearTimeout(ringJumpTimer);
      ringJumpTimer = null;
    }
    sourceEditor.removeEventListener("scroll", mirrorSourceBackdrop);
    syncScrollLock = false;
    updateStitchProgress();
  };
  sourceEditor.addEventListener("scrollend", release, { once: true });
  ringJumpTimer = window.setTimeout(release, 600);
}

onBeforeUnmount(() => {
  if (ringJumpTimer !== null) {
    window.clearTimeout(ringJumpTimer);
    ringJumpTimer = null;
  }
  window.removeEventListener("resize", onStitchResize);
});

/** 窗口尺寸变化 → 可视高度变了，跑道与进度百分比都要重算。 */
function onStitchResize() {
  refreshStitchRunway();
  updateStitchProgress();
}

onMounted(() => {
  window.addEventListener("resize", onStitchResize);
  void nextTick(onStitchResize);
});

/* 切到「拼文对比」时两侧 textarea 才被挂载，此刻补量一次跑道。 */
watch(activeMode, (mode) => {
  if (mode === "compare") void nextTick(onStitchResize);
});

function onScroll(source: "left" | "right") {
  if (syncScrollLock) return;
  syncScrollLock = true;
  const lEd = leftEditorRef.value;
  const rEd = rightEditorRef.value;
  const lBd = leftBackdropRef.value;
  const rBd = rightBackdropRef.value;
  const span = stitchSpans();

  /* 分段映射（正文段 ↔ 正文段、跑道段 ↔ 跑道段）：源编辑框被打字机滚进跑道时，
     背层同样往下走完自己的跑道，字面才跟着上移；两侧跑道长短不同也不会错开。 */
  if (source === "left") {
    const top = lEd?.scrollTop ?? 0;
    if (rEd) rEd.scrollTop = mapScrollTop(top, span.lEd, span.rEd);
    if (lBd) lBd.scrollTop = mapScrollTop(top, span.lEd, span.lBd);
    if (rBd) rBd.scrollTop = mapScrollTop(top, span.lEd, span.rBd);
  } else {
    const top = rEd?.scrollTop ?? 0;
    if (lEd) lEd.scrollTop = mapScrollTop(top, span.rEd, span.lEd);
    if (lBd) lBd.scrollTop = mapScrollTop(top, span.rEd, span.lBd);
    if (rBd) rBd.scrollTop = mapScrollTop(top, span.rEd, span.rBd);
  }

  updateStitchProgress();

  requestAnimationFrame(() => {
    syncScrollLock = false;
  });
}

/* 文本选择浮层工具栏与右键菜单状态 */
const selectionToolbar = ref<{
  show: boolean;
  x: number;
  y: number;
  text: string;
  side: "left" | "right" | null;
  moreOpen: boolean;
}>({
  show: false,
  x: 0,
  y: 0,
  text: "",
  side: null,
  moreOpen: false,
});

let savedSelection = ref<{ start: number; end: number; side: "left" | "right" | null }>({
  start: 0,
  end: 0,
  side: null,
});

const ctxMenuState = ref<{ show: boolean; x: number; y: number; side: "left" | "right" | null }>({
  show: false,
  x: 0,
  y: 0,
  side: null,
});

function onTextSelection(side: "left" | "right", event: MouseEvent) {
  const target = event.target as HTMLTextAreaElement;
  if (!target) return;
  setTimeout(() => {
    /* 行内 AI 浮层在场时不浮现工具栏，避免遮挡 Ctrl+K 输入框。 */
    if (inlineAiActive.value) return;
    const start = target.selectionStart;
    const end = target.selectionEnd;
    if (start !== end) {
      const selectedText = target.value.slice(start, end);
      savedSelection.value = { start, end, side };
      const rawX = event.clientX || target.getBoundingClientRect().left + 80;
      const clampedX = Math.min(window.innerWidth - 240, Math.max(10, rawX - 60));
      selectionToolbar.value = {
        show: true,
        x: clampedX,
        y: Math.max(40, event.clientY - 55),
        text: selectedText,
        side,
        moreOpen: false,
      };
      ignoreNextClick = true;
      setTimeout(() => {
        ignoreNextClick = false;
      }, 150);
    } else {
      selectionToolbar.value.show = false;
    }
  }, 10);
}

function onEditorContextMenu(side: "left" | "right", event: MouseEvent) {
  event.preventDefault();
  closeAllMenus();
  ctxMenuState.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    side,
  };
}

let ignoreNextClick = false;

function closeAllMenus() {
  if (ignoreNextClick) return;
  selectionToolbar.value.show = false;
  ctxMenuState.value.show = false;
}

/* Ctrl+K 行内 AI 浮层呼出时无条件收起选中工具栏与右键菜单：这里不能走
   closeAllMenus，它为了防「选中即被点掉」而在 150ms 内自我豁免。 */
function forceCloseMenus() {
  selectionToolbar.value.show = false;
  ctxMenuState.value.show = false;
}

/* ---- Ctrl+K 行内 AI 编辑 ----
   浮层在场期间抑制选中浮现工具栏：呼出后 textarea 仍会派发 mouseup/选区事件，
   不抑制就会把刚收起的工具栏重新弹到输入框上面。 */
const inlineAiActive = ref(false);

function onInlineAiOpened() {
  inlineAiActive.value = true;
  forceCloseMenus();
}

function onInlineAiClosed() {
  inlineAiActive.value = false;
}

function getActiveEditor(): HTMLTextAreaElement | null {
  const side = selectionToolbar.value.side || ctxMenuState.value.side || savedSelection.value.side;
  return side === "left" ? leftEditorRef.value : rightEditorRef.value;
}

function doCut() {
  const ta = getActiveEditor();
  if (!ta) return;
  const start = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.start : ta.selectionStart;
  const end = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.end : ta.selectionEnd;
  const text = ta.value.slice(start, end);
  if (text) {
    navigator.clipboard.writeText(text).catch(() => {});
    const side = savedSelection.value.side || selectionToolbar.value.side;
    if (side === "left") {
      leftContent.value = ta.value.slice(0, start) + ta.value.slice(end);
    } else {
      rightContent.value = ta.value.slice(0, start) + ta.value.slice(end);
    }
    showToast("已剪切", "内容已剪切到剪贴板", "habit");
  }
  closeAllMenus();
}

function doCopy() {
  const ta = getActiveEditor();
  if (!ta) return;
  const start = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.start : ta.selectionStart;
  const end = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.end : ta.selectionEnd;
  const text = ta.value.slice(start, end) || ta.value;
  if (text) {
    navigator.clipboard.writeText(text).catch(() => {});
    showToast("已复制", "内容已复制到剪贴板", "habit");
  }
  closeAllMenus();
}

function doPaste() {
  const ta = getActiveEditor();
  if (!ta) return;
  navigator.clipboard.readText().then((text) => {
    if (!text) return;
    const start = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.start : ta.selectionStart;
    const end = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.end : ta.selectionEnd;
    const side = savedSelection.value.side || selectionToolbar.value.side;
    if (side === "left") {
      leftContent.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    } else {
      rightContent.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    }
    showToast("已粘贴", "内容已从剪贴板粘贴", "habit");
  }).catch(() => {});
  closeAllMenus();
}

function doSelectAll() {
  const ta = getActiveEditor();
  if (ta) ta.select();
  closeAllMenus();
}

function doDelete() {
  const ta = getActiveEditor();
  if (!ta) return;
  const start = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.start : ta.selectionStart;
  const end = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.end : ta.selectionEnd;
  if (start !== end) {
    const side = savedSelection.value.side || selectionToolbar.value.side;
    if (side === "left") {
      leftContent.value = ta.value.slice(0, start) + ta.value.slice(end);
    } else {
      rightContent.value = ta.value.slice(0, start) + ta.value.slice(end);
    }
    showToast("已删除", "已删除选中内容", "habit");
  }
  closeAllMenus();
}

function doUndo() {
  const side = ctxMenuState.value.side || savedSelection.value.side || "left";
  undo(side);
  closeAllMenus();
}

function doRedo() {
  const side = ctxMenuState.value.side || savedSelection.value.side || "left";
  redo(side);
  closeAllMenus();
}

function triggerAiAction(type: "polish" | "continue" | "habit") {
  closeAllMenus();
  if (type === "polish") {
    showToast("AI 智能润色", "已调用 AI 智能体完成选段润色", "habit");
  } else if (type === "continue") {
    showToast("AI 续写", "已调用 AI 智能体生成下一段", "habit");
  } else if (type === "habit") {
    showToast("依习惯生成", "已根据风格画像完成生成", "habit");
  }
}

function applyTextTransform(type: string) {
  const side = savedSelection.value.side || selectionToolbar.value.side || "left";
  const ta = side === "left" ? leftEditorRef.value : rightEditorRef.value;
  if (!ta) return;

  const start = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.start : ta.selectionStart;
  const end = savedSelection.value.start !== savedSelection.value.end ? savedSelection.value.end : ta.selectionEnd;
  const selected = ta.value.slice(start, end);
  if (!selected) {
    showToast("提示", "请先在编辑区选中一段文字", "edit");
    closeAllMenus();
    return;
  }

  let transformed = selected;
  if (type === "uppercase") {
    transformed = selected === selected.toUpperCase() ? selected.toLowerCase() : selected.toUpperCase();
  } else if (type === "lowercase") {
    transformed = selected.toLowerCase();
  } else if (type === "capitalize") {
    // Robust capitalize toggle: if already capitalized (each word starts with upper), lowercase them; otherwise capitalize
    const isCapitalized = selected.split(/\s+/).every(w => !w || w[0] === w[0].toUpperCase());
    if (isCapitalized) {
      transformed = selected.toLowerCase();
    } else {
      transformed = selected.replace(/\b\w/g, (c) => c.toUpperCase());
    }
  } else if (type === "smartQuotes") {
    if (/['"]/.test(selected)) {
      transformed = selected.replace(/'([^']*?)'/g, "“$1”").replace(/"([^"]*?)"/g, "“$1”");
    } else {
      transformed = `“${selected}”`;
    }
  } else if (type === "smartSpaces") {
    transformed = selected.replace(/([\u4e00-\u9fa5])([A-Za-z0-9])/g, "$1 $2").replace(/([A-Za-z0-9])([\u4e00-\u9fa5])/g, "$1 $2");
  } else if (type === "swap") {
    transformed = selected.split("").reverse().join("");
  }

  if (side === "left") {
    leftContent.value = ta.value.slice(0, start) + transformed + ta.value.slice(end);
  } else {
    rightContent.value = ta.value.slice(0, start) + transformed + ta.value.slice(end);
  }
  closeAllMenus();
  showToast("文本处理完成", "已应用文本变换", "habit");
}

function onEditorKeydown(side: "left" | "right", event: KeyboardEvent) {
  const mod = event.ctrlKey || event.metaKey;
  if (mod && !event.altKey) {
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) {
        redo(side);
      } else {
        undo(side);
      }
      return;
    }
    if (key === "y") {
      event.preventDefault();
      redo(side);
      return;
    }
  }
}

function handleSaveCompare() {
  const updated = props.cards.map((c) => {
    if (c.id === compareLeftId.value) return { ...c, content: leftContent.value };
    if (c.id === compareRightId.value) return { ...c, content: rightContent.value };
    return c;
  });
  emit("save", updated);
  showToast("保存成功", "对比编辑内容已更新到卡片", "habit");
  emit("close");
}

function charCount(text: string): number {
  return (text || "").replace(/\s/g, "").length;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", closeAllMenus);
}
</script>

<template>
  <div class="stitch-modal-overlay" @click.self="emit('close')">
    <div class="stitch-modal-shell">
      <!-- 顶栏：切换 拼文预览 / 拼文对比 -->
      <div class="stitch-modal-header">
        <div class="stitch-header-left">
          <div class="mode-tabs">
            <button
              class="mode-tab"
              :class="{ active: activeMode === 'preview' }"
              @click="activeMode = 'preview'"
            >
              <BookOpen :size="15" :stroke-width="1.8" />
              <span>拼文预览 ({{ cards.length }}张卡片)</span>
            </button>
            <button
              class="mode-tab"
              :class="{ active: activeMode === 'compare' }"
              @click="activeMode = 'compare'"
            >
              <GitCompare :size="15" :stroke-width="1.8" />
              <span>拼文对比</span>
            </button>
          </div>
        </div>
        <div class="stitch-header-right">
          <button class="modal-close-btn" title="关闭" @click="emit('close')">
            <X :size="18" :stroke-width="1.8" />
          </button>
        </div>
      </div>

      <!-- 主体内容区 -->
      <div class="stitch-modal-body">
        <!-- 1. 拼文预览模式 -->
        <div v-if="activeMode === 'preview'" class="stitch-preview-layout">
          <!-- 左侧：卡片列表目录 -->
          <aside class="stitch-toc-sidebar">
            <div class="toc-title">文本卡片目录</div>
            <div class="toc-list">
              <div
                v-for="card in cards"
                :key="card.id"
                class="toc-item"
                :class="{ active: activeCardIdInPreview === card.id }"
                @click="jumpToCardInPreview(card)"
              >
                <FileText :size="13" :stroke-width="1.8" />
                <span class="toc-item-title">{{ card.title }}</span>
                <span class="toc-item-chars">{{ card.content.length }}字</span>
              </div>
            </div>
          </aside>

          <!-- 右侧：标准 DocumentViewer 组件 -->
          <div class="stitch-editor-pane">
            <DocumentViewer v-model="stitchedContent" embedded single-editor ring-slot="stitchPreview" />
            <div class="editor-pane-footer">
              <span class="footer-stat">总字数: {{ stitchedContent.length }} 字</span>
              <button class="primary-done-btn" @click="handleSavePreview">
                完成并更新
              </button>
            </div>
          </div>
        </div>

        <!-- 2. 拼文对比模式 -->
        <div v-else class="stitch-compare-layout" @click="closeAllMenus">
          <!-- 顶部工具栏 -->
          <div class="compare-toolbar">
            <div class="compare-selector-group">
              <span class="selector-label">左侧基准卡片:</span>
              <select v-model="compareLeftId" class="card-select compact">
                <option v-for="c in cards" :key="c.id" :value="c.id">
                  {{ c.title }}
                </option>
              </select>
            </div>
            <button
              class="swap-cards-btn"
              title="点击互换左右卡片与内容"
              @click="swapCompareCards"
            >
              <ArrowLeftRight :size="15" :stroke-width="1.8" />
            </button>
            <div class="compare-selector-group right-group">
              <span class="selector-label">右侧对比卡片:</span>
              <select v-model="compareRightId" class="card-select compact">
                <option v-for="c in cards" :key="c.id" :value="c.id">
                  {{ c.title }}
                </option>
              </select>
            </div>
          </div>

          <!-- 一体化原地高亮对比编辑面板 -->
          <div class="compare-panels">
            <!-- 左侧 -->
            <div class="compare-panel">
              <div class="compare-panel-header">
                <span class="panel-card-title">{{ leftCard?.title ?? '左侧卡片' }}</span>
                <span class="panel-card-chars">{{ charCount(leftContent) }} 字 (基准)</span>
              </div>
              <div class="code-editor-wrapper" :style="{ '--ed-runway': leftRunwayPx + 'px' }">
                <div class="read-progress" aria-hidden="true">
                  <span
                    class="read-progress-fill"
                    :style="{ width: leftProgress * 100 + '%' }"
                  ></span>
                </div>
                <div
                  ref="leftBackdropRef"
                  class="editor-backdrop"
                  :style="compareTextStyle"
                  @scroll="onScroll('left')"
                >
                  <template v-for="(token, i) in currentCompareDiff.left" :key="i">
                    <span v-if="token.type === 'removed'" class="diff-removed">{{ token.text }}</span>
                    <template v-else>{{ token.text }}</template>
                  </template>
                </div>
                <textarea
                  ref="leftEditorRef"
                  v-model="leftContent"
                  v-auto-pair
                  class="editor-textarea"
                  :style="compareTextStyle"
                  @scroll="onScroll('left')"
                  @input="onStitchInput('left')"
                  @mouseup="onTextSelection('left', $event)"
                  @keydown="onEditorKeydown('left', $event)"
                  @contextmenu="onEditorContextMenu('left', $event)"
                  placeholder="在此无障碍编辑左侧 Markdown 正文..."
                ></textarea>
                <!-- 对比编辑框内的同款阅读圆环（默认右上角，长按环心可拖动）。 -->
                <ReadingProgressRing
                  :progress="leftProgress"
                  :source="leftContent"
                  :target="leftEditorRef"
                  slot-key="stitchCompare:left"
                  kind="editor"
                  :inset-top="10"
                  :inset-right="12"
                  :inset-bottom="10"
                  :inset-left="12"
                  :max-size="34"
                  :zen-disabled="true"
                  :doc-title="leftCard?.title ?? '左侧卡片'"
                  @jump="onRingJump('left', $event)"
                  @update:source="leftContent = $event"
                  @save="handleSaveCompare"
                />
                <!-- Ctrl+K 行内 AI 编辑（左侧小编辑框） -->
                <InlineAiEdit
                  v-model="leftContent"
                  :target="leftEditorRef"
                  label="左侧卡片"
                  @opened="onInlineAiOpened"
                  @closed="onInlineAiClosed"
                />
              </div>
            </div>

            <!-- 右侧 -->
            <div class="compare-panel">
              <div class="compare-panel-header">
                <span class="panel-card-title">{{ rightCard?.title ?? '右侧卡片' }}</span>
                <span class="panel-card-chars">{{ charCount(rightContent) }} 字 (对比)</span>
              </div>
              <div class="code-editor-wrapper" :style="{ '--ed-runway': rightRunwayPx + 'px' }">
                <div class="read-progress" aria-hidden="true">
                  <span
                    class="read-progress-fill"
                    :style="{ width: rightProgress * 100 + '%' }"
                  ></span>
                </div>
                <div
                  ref="rightBackdropRef"
                  class="editor-backdrop"
                  :style="compareTextStyle"
                  @scroll="onScroll('right')"
                >
                  <template v-for="(token, i) in currentCompareDiff.right" :key="i">
                    <span v-if="token.type === 'added'" class="diff-added">{{ token.text }}</span>
                    <template v-else>{{ token.text }}</template>
                  </template>
                </div>
                <textarea
                  ref="rightEditorRef"
                  v-model="rightContent"
                  v-auto-pair
                  class="editor-textarea"
                  :style="compareTextStyle"
                  @scroll="onScroll('right')"
                  @input="onStitchInput('right')"
                  @mouseup="onTextSelection('right', $event)"
                  @keydown="onEditorKeydown('right', $event)"
                  @contextmenu="onEditorContextMenu('right', $event)"
                  placeholder="在此无障碍编辑右侧 Markdown 正文..."
                ></textarea>
                <ReadingProgressRing
                  :progress="rightProgress"
                  :source="rightContent"
                  :target="rightEditorRef"
                  slot-key="stitchCompare:right"
                  kind="editor"
                  :inset-top="10"
                  :inset-right="12"
                  :inset-bottom="10"
                  :inset-left="12"
                  :max-size="34"
                  :zen-disabled="true"
                  :doc-title="rightCard?.title ?? '右侧卡片'"
                  @jump="onRingJump('right', $event)"
                  @update:source="rightContent = $event"
                  @save="handleSaveCompare"
                />
                <!-- Ctrl+K 行内 AI 编辑（右侧小编辑框） -->
                <InlineAiEdit
                  v-model="rightContent"
                  :target="rightEditorRef"
                  label="右侧卡片"
                  @opened="onInlineAiOpened"
                  @closed="onInlineAiClosed"
                />
              </div>
            </div>
          </div>

          <!-- 底部栏 -->
          <div class="compare-footer">
            <div class="compare-diff-badge">
              差异统计: 删减 <strong>-{{ diffStats.removedCount }}</strong>字 / 新增 <strong>+{{ diffStats.addedCount }}</strong>字
            </div>
            <button class="primary-done-btn" @click="handleSaveCompare">
              保存对比修改
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 文本选中浮现工具栏（对齐拼文预览/DocumentViewer，带有对应图标） -->
    <div
      v-if="selectionToolbar.show"
      class="selection-bar"
      :style="{ top: selectionToolbar.y + 'px', left: selectionToolbar.x + 'px' }"
      @click.stop
    >
      <template v-if="!selectionToolbar.moreOpen">
        <button class="selection-bar-btn" @mousedown.prevent @click="doCut"><span>剪切</span></button>
        <button class="selection-bar-btn" @mousedown.prevent @click="doCopy"><span>复制</span></button>
        <button class="selection-bar-btn" @mousedown.prevent @click="doPaste"><span>粘贴</span></button>
        <button class="selection-bar-btn" @mousedown.prevent @click="doSelectAll"><span>全选</span></button>
        <button class="selection-bar-btn danger" @mousedown.prevent @click="doDelete"><span>删除</span></button>
        <button class="selection-bar-btn menu" title="更多文本处理" @mousedown.prevent @click="selectionToolbar.moreOpen = true"><span>⋮</span></button>
      </template>
      <template v-else>
        <div class="selection-more-menu" @click.stop>
          <div class="menu-item" @mousedown.prevent @click="applyTextTransform('swap')">
            <ArrowLeftRight :size="14" />
            <span>智能交换</span>
          </div>
          <div class="menu-item" @mousedown.prevent @click="applyTextTransform('uppercase')">
            <span class="menu-case-glyph caps">Aa</span>
            <span>英文大小写</span>
          </div>
          <div class="menu-item" @mousedown.prevent @click="applyTextTransform('capitalize')">
            <span class="menu-case-glyph">Aa</span>
            <span>首字母大小写</span>
          </div>
          <div class="menu-item" @mousedown.prevent @click="applyTextTransform('smartQuotes')">
            <Quote :size="14" />
            <span>智能引号</span>
          </div>
          <div class="menu-item" @mousedown.prevent @click="applyTextTransform('smartSpaces')">
            <span class="menu-space-glyph">&nbsp;空&nbsp;</span>
            <span>智能空格</span>
          </div>
          <div class="menu-divider"></div>
          <div class="menu-item back" @mousedown.prevent @click="selectionToolbar.moreOpen = false">
            <ArrowLeft :size="14" />
            <span>返回</span>
          </div>
        </div>
      </template>
    </div>

    <!-- 右键菜单 -->
    <div
      v-if="ctxMenuState.show"
      class="stitch-ctx-menu"
      :style="{ top: ctxMenuState.y + 'px', left: ctxMenuState.x + 'px' }"
      @click.stop
    >
      <div class="ctx-item" @click="triggerAiAction('polish')"><Sparkles :size="14" /><span>润色选段</span></div>
      <div class="ctx-item" @click="triggerAiAction('continue')"><PenLine :size="14" /><span>续写下一段</span></div>
      <div class="ctx-item" @click="triggerAiAction('habit')"><BookOpen :size="14" /><span>依习惯生成</span></div>
      <div class="ctx-divider"></div>
      <div class="ctx-item" @click="doUndo"><span>撤销</span></div>
      <div class="ctx-item" @click="doRedo"><span>重做</span></div>
    </div>
  </div>
</template>

<style scoped>
.stitch-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 30px;
}

.stitch-modal-shell {
  width: 100%;
  max-width: 1300px;
  height: 90vh;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 14px;
  box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.25);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: modalScaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modalScaleIn {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}

.stitch-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
  flex-shrink: 0;
}

.mode-tabs {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-container);
  padding: 3px;
  border-radius: 8px;
}

.mode-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-tab:hover {
  color: var(--on-surface);
}

.mode-tab.active {
  background: var(--surface-bright);
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}

.modal-close-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  transition: background 0.15s;
}

.modal-close-btn:hover {
  background: var(--surface-container-high);
}

.stitch-modal-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* 拼文预览布局 */
.stitch-preview-layout {
  flex: 1;
  min-height: 0;
  display: flex;
}

.stitch-toc-sidebar {
  width: 260px;
  flex-shrink: 0;
  background: var(--surface-bright);
  border-right: 1px solid var(--outline-variant);
  display: flex;
  flex-direction: column;
  padding: 12px;
}

.toc-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 4px 8px 10px;
}

.toc-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.toc-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.15s;
}

.toc-item:hover {
  background: var(--surface-container-high);
}

.toc-item.active {
  background: var(--primary-fixed-dim);
  color: var(--primary);
  font-weight: 500;
}

.toc-item-title {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-item-chars {
  font-size: 11px;
  color: var(--on-surface-variant);
  flex-shrink: 0;
}

.stitch-editor-pane {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
}

.editor-pane-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-top: 1px solid var(--outline-variant);
  background: var(--surface-container-lowest);
  flex-shrink: 0;
}

.footer-stat {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.primary-done-btn {
  padding: 8px 18px;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
}

.primary-done-btn:hover {
  background: var(--primary-container);
}

/* 拼文对比布局 */
.stitch-compare-layout {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.compare-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 20px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
  flex-shrink: 0;
  position: relative;
}

.compare-selector-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.compare-selector-group.right-group {
  margin-left: auto;
}

.selector-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface-variant);
  white-space: nowrap;
}

.card-select.compact {
  max-width: 140px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container-low);
  color: var(--on-surface);
  font-size: 12px;
  outline: none;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.swap-cards-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.swap-cards-btn:hover {
  background: var(--primary-fixed-dim);
  border-color: var(--primary);
  color: var(--primary);
}

.compare-diff-badge {
  font-size: 12px;
  color: var(--on-surface-variant);
}

.compare-diff-badge strong {
  color: var(--primary);
  font-weight: 600;
}

.compare-panels {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--outline-variant);
}

.compare-panel {
  display: flex;
  flex-direction: column;
  background: var(--reading-surface);
  min-height: 0;
}

.compare-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--reading-surface);
  border-bottom: 1px solid var(--reading-border);
  flex-shrink: 0;
}

.panel-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
}

.panel-card-chars {
  font-size: 12px;
  color: var(--on-surface-variant);
}

/* 一体化原地对比编辑：底层渲染差异高亮，顶层透明 textarea 承接光标与输入。
   两层的排版度量必须完全一致，收在一组变量里，改动时不会错位。
   行距与内边距对齐「拼文预览」里嵌入式 DocumentViewer 的编辑区
   （.document-viewer.embedded .editor-wrap：--ed-line-height 1.75 / 18px），
   字体与字号由 compareTextStyle 内联注入，与预览侧同源。 */
.code-editor-wrapper {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background: var(--reading-surface);
  --ed-line-height: 1.75;
  --ed-pad: 18px;
}

/* 阅读进度条：贴合对比编辑区顶部边框，主题色实色填充，无阴影 */
.read-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: transparent;
  pointer-events: none;
  z-index: 3;
}

.read-progress-fill {
  display: block;
  height: 100%;
  width: 0;
  background: var(--primary);
  transition: width 0.06s linear;
  border-radius: 0 2px 2px 0;
}

/* 字体与字号不写在这里：由 compareTextStyle 内联注入，与拼文预览同源。
   其余度量对齐预览侧的 .editor-textarea（行距、字距、tab 宽、换行策略），
   两层共用同一份规则，差异高亮才能逐字对齐。
   底部额外叠一段 --ed-runway（打字机滚动的末尾跑道）：编辑框与背层必须
   补同样的跑道，否则两层可滚动高度不同、高亮会逐行错位。 */
.editor-textarea,
.editor-backdrop {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  padding: var(--ed-pad) var(--ed-pad) calc(var(--ed-pad) + var(--ed-runway, 0px));
  margin: 0;
  border: none;
  line-height: var(--ed-line-height);
  letter-spacing: -0.004em;
  tab-size: 2;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  word-wrap: break-word;
  overflow-y: auto;
}

.editor-textarea {
  background: transparent;
  color: transparent;
  caret-color: var(--primary);
  resize: none;
  outline: none;
  z-index: 2;
}

.editor-textarea::selection {
  background: rgb(var(--primary-rgb) / 0.16);
}

.editor-backdrop {
  background: transparent;
  color: var(--reading-text);
  z-index: 1;
  pointer-events: none;
  user-select: none;
}

.compare-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: var(--surface-bright);
  border-top: 1px solid var(--outline-variant);
  flex-shrink: 0;
}

.diff-removed {
  background-color: rgb(239, 68, 68, 0.22);
  color: var(--error);
  text-decoration: line-through;
  border-radius: 3px;
  padding: 0 2px;
}

.diff-added {
  background-color: rgb(34, 197, 94, 0.22);
  color: #15803d;
  border-radius: 3px;
  padding: 0 2px;
}

/* 文本选中浮现工具栏 */
.selection-bar {
  position: fixed;
  z-index: 9999;
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  white-space: nowrap !important;
  flex-shrink: 0 !important;
  width: auto !important;
  max-width: none !important;
}

.selection-bar-btn {
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface);
  background: transparent;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap !important;
  flex-shrink: 0 !important;
}

.selection-bar-btn:hover {
  background: var(--surface-container-high);
}

.selection-bar-btn.danger:hover {
  background: var(--error-container);
  color: var(--error);
}

.selection-bar-btn.menu {
  font-weight: 700;
  color: var(--primary);
  white-space: nowrap !important;
  flex-shrink: 0 !important;
}

.selection-more-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  min-width: 150px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  padding: 4px;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--on-surface);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.menu-item:hover {
  background: var(--surface-container-high);
}

.menu-item.back {
  color: var(--on-surface-variant);
}

.menu-divider {
  height: 1px;
  background: var(--outline-variant);
  margin: 3px 4px;
}

/* 菜单项小图标/glyph */
.menu-case-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  font-size: 11px;
  font-weight: 700;
  background: var(--surface-container);
  border-radius: 3px;
  color: var(--on-surface-variant);
}

.menu-case-glyph.caps {
  font-size: 9px;
}

.menu-space-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0 2px;
  height: 16px;
  font-size: 10px;
  font-weight: 600;
  background: var(--surface-container);
  border-radius: 3px;
  color: var(--on-surface-variant);
}

/* 右键菜单 */
.stitch-ctx-menu {
  position: fixed;
  z-index: 9999;
  min-width: 150px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
  padding: 4px;
}

.ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--on-surface);
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.15s;
  white-space: nowrap;
}

.ctx-item:hover {
  background: var(--surface-container-high);
}

.ctx-divider {
  height: 1px;
  background: var(--outline-variant);
  margin: 3px 4px;
}
</style>
