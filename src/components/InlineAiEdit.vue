<script setup lang="ts">
/**
 * Ctrl+K 行内 AI 编辑（长条输入框 + 接受 / 拒绝）。
 *
 * 独立成文件，不改动任何既有编辑器逻辑：宿主只需把自己的 textarea 与正文双向
 * 绑定进来，本组件自行接管 Ctrl+K、浮层定位、流式生成与取舍落笔。
 *
 *   <InlineAiEdit :target="editorRef" v-model="markdown" />
 *
 * 交互流程：
 *   1. 在文本域按 Ctrl+K —— 有选区就取选区，没有选区则自动扩到光标所在段落
 *      （以空行为界），随后在该段落下方浮出一条长输入框。
 *   2. 输入提问 / 修改指令后回车 —— AI 输出流式写入「原文下方空一行」处，
 *      原文一律保持原样，两块分别着色便于逐句对比。
 *   3. 输出块右上角浮出「接受 / 拒绝」：接受则用 AI 输出替换原文段落并记入
 *      修改记忆；拒绝则清空 AI 输出、原文分毫不动。
 *
 * 前后端搭配：请求走既有的 agentRunner（前端直连所配置的模型接口，四种协议
 * 通用、真流式），系统提示复用写作 Agent 提示词 + 用户写作习惯画像，用量记入
 * tokenStore 的 editor 桶 —— 与编辑器内既有的润色 / 续写完全同源，无需新增
 * 任何 Rust 侧命令。
 */
import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Check, CornerDownLeft, Loader2, Sparkles, X } from "lucide-vue-next";
import { runAgent } from "../agentRunner";
import { aiSettings } from "../settings";
import { recordTokens } from "../tokenStore";
import { WRITER_AGENT_PROMPT } from "../prompts/writerAgent";
import { buildInsightContext, showToast, trackModification } from "../insightStore";
import { measureTextareaTops } from "../readingOutline";

const props = withDefaults(
  defineProps<{
    /** 被接管的文本域。父级 v-if 切换时可为 null，本组件自动解绑。 */
    target: HTMLTextAreaElement | null;
    /** 关掉本功能（例如某些只读场景）。 */
    enabled?: boolean;
    /** 出现在输入框里的场景名，仅用于占位文案。 */
    label?: string;
  }>(),
  { enabled: true, label: "" },
);

/** 与宿主共享的正文。接受 / 拒绝都只经由它落笔。 */
const model = defineModel<string>({ required: true });

const emit = defineEmits<{
  (e: "applied", payload: { before: string; after: string }): void;
  /** 浮层呼出时通知宿主：立即清退自己的选中浮现工具栏，并在此期间不再复现。 */
  (e: "opened"): void;
  /** 浮层收起（接受 / 拒绝 / 取消）时通知宿主解除上述抑制。 */
  (e: "closed"): void;
}>();

/* ---------------- 状态 ---------------- */

type Phase = "idle" | "input" | "streaming" | "review";

const phase = ref<Phase>("idle");
const instruction = ref("");
const draft = ref("");

/** 原文段落在正文中的区间（提交后固定不变）。 */
const origStart = ref(0);
const origEnd = ref(0);
/** AI 输出块在预览态正文中的起点。 */
const outStart = ref(0);

/** 提交那一刻的正文快照：接受与拒绝都以它为基准重算，绝不依赖预览态。 */
let baseText = "";
/** 预览态正文 = head + draft + tail。 */
let previewHead = "";
let previewTail = "";
/** 原文段落之后的原始尾串，接受时按原样接回。 */
let rawTail = "";

let controller: AbortController | null = null;
let boundTarget: HTMLTextAreaElement | null = null;

const rootRef = ref<HTMLDivElement | null>(null);
const inputRef = ref<HTMLTextAreaElement | null>(null);
const pillRef = ref<HTMLDivElement | null>(null);

const barPos = ref({ top: 0, left: 0, width: 420, show: false });
const pillPos = ref({ top: 0, left: 0, show: false });
const origBand = ref({ top: 0, left: 0, width: 0, height: 0, show: false });
const outBand = ref({ top: 0, left: 0, width: 0, height: 0, show: false });

/** 长条输入框宽度上限：比阅读宽度窄一档，不横跨整个编辑区。 */
const BAR_MAX_WIDTH = 420;

/* 左下角「/」菜单里的指令模板。默认不选中任何一条，纯手写指令也完全可用。 */
const presetMenuOpen = ref(false);
const presets = [
  { label: "润色选段", text: "润色选段：" },
  { label: "续写", text: "续写：" },
  { label: "依习惯生成", text: "依习惯生成：" },
];

/* ---------------- 段落解析 ---------------- */

/** 取「选区」；没有选区时以空行为界扩到光标所在段落，并去掉两端空白。 */
function resolveRange(el: HTMLTextAreaElement): { start: number; end: number } | null {
  const val = el.value;
  let start = typeof el.selectionStart === "number" ? el.selectionStart : 0;
  let end = typeof el.selectionEnd === "number" ? el.selectionEnd : 0;

  if (start === end) {
    const back = val.lastIndexOf("\n\n", Math.max(0, start - 1));
    const forward = val.indexOf("\n\n", start);
    start = back < 0 ? 0 : back + 2;
    end = forward < 0 ? val.length : forward;
  }

  while (start < end && /\s/.test(val[start])) start += 1;
  while (end > start && /\s/.test(val[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

/* ---------------- 浮层定位 ---------------- */

function textMetrics(el: HTMLTextAreaElement) {
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 16;
  const lineHeight =
    cs.lineHeight === "normal" ? fontSize * 1.6 : parseFloat(cs.lineHeight) || fontSize * 1.6;
  return {
    lineHeight,
    padLeft: parseFloat(cs.paddingLeft) || 0,
    padRight: parseFloat(cs.paddingRight) || 0,
  };
}

/** 把「相对内容原点的行顶」换算成视口坐标，并裁进文本域可见区。 */
function bandOf(
  topRaw: number,
  bottomRaw: number,
  elTop: number,
  elBottom: number,
  scrollTop: number,
  left: number,
  width: number,
) {
  const top = Math.max(elTop, elTop + topRaw - scrollTop);
  const bottom = Math.min(elBottom, elTop + bottomRaw - scrollTop);
  return { top, left, width, height: Math.max(0, bottom - top), show: bottom > top };
}

function reposition() {
  const el = props.target;
  if (!el || phase.value === "idle") return;

  const rect = el.getBoundingClientRect();
  const { lineHeight, padLeft, padRight } = textMetrics(el);
  /* clientWidth 已不含竖向滚动条，直接以它定右边界，和真实文本区对齐。 */
  const contentLeft = rect.left + padLeft;
  const contentRight = rect.left + el.clientWidth - padRight;
  const contentWidth = Math.max(160, contentRight - contentLeft);
  const streaming = phase.value === "streaming" || phase.value === "review";
  const outEnd = outStart.value + draft.value.trimEnd().length;

  const offsets = streaming
    ? [origStart.value, origEnd.value, outStart.value, outEnd]
    : [origStart.value, origEnd.value];
  const tops = measureTextareaTops(el, offsets);

  origBand.value = bandOf(
    tops[0],
    tops[1] + lineHeight,
    rect.top,
    rect.bottom,
    el.scrollTop,
    contentLeft,
    contentWidth,
  );

  if (streaming && draft.value) {
    outBand.value = bandOf(
      tops[2],
      tops[3] + lineHeight,
      rect.top,
      rect.bottom,
      el.scrollTop,
      contentLeft,
      contentWidth,
    );
  } else {
    outBand.value = { ...outBand.value, show: false };
  }

  /* 长条输入框：贴在原文段落下方，下方不够则翻到上方。宽度收在
     BAR_MAX_WIDTH 以内，不再横跨整个阅读宽度。 */
  const barW = Math.min(BAR_MAX_WIDTH, contentWidth);
  const barH = rootRef.value?.querySelector<HTMLElement>(".iae-bar")?.offsetHeight || 46;
  const gap = 8;
  const margin = 8;
  const anchorBottom = rect.top + tops[1] + lineHeight - el.scrollTop;
  const anchorTop = rect.top + tops[0] - el.scrollTop;
  let barTop = anchorBottom + gap;
  if (barTop + barH > window.innerHeight - margin) {
    const above = anchorTop - barH - gap;
    barTop = above >= margin ? above : Math.max(margin, window.innerHeight - barH - margin);
  }
  barPos.value = {
    top: barTop,
    left: Math.min(Math.max(contentLeft, margin), Math.max(margin, window.innerWidth - barW - margin)),
    width: barW,
    show: phase.value === "input",
  };

  /* 接受 / 拒绝：钉在 AI 输出块的右上角，顶部越界则落到块内首行。 */
  if (streaming) {
    const pillH = pillRef.value?.offsetHeight || 30;
    const outTop = rect.top + tops[2] - el.scrollTop;
    let pillTop = outTop - pillH - 4;
    if (pillTop < rect.top + 2) pillTop = Math.min(outTop + 2, rect.bottom - pillH - 2);
    pillPos.value = {
      top: Math.max(margin, Math.min(pillTop, window.innerHeight - pillH - margin)),
      left: contentRight,
      show: true,
    };
  } else {
    pillPos.value = { ...pillPos.value, show: false };
  }
}

function scheduleReposition() {
  nextTick(reposition);
}

/**
 * 两趟定位。第一趟浮层还没渲染出来，offsetHeight 量不到、只能用估值；渲染后
 * 再量一次才能让「下方放不下就翻到上方」的翻转结果落在真实高度上。
 */
function settle() {
  nextTick(() => {
    reposition();
    nextTick(reposition);
  });
}

/* ---------------- 呼出 / 收起 ---------------- */

function open() {
  const el = props.target;
  if (!el) return;
  const range = resolveRange(el);
  if (!range) {
    showToast("没有可处理的文本", "把光标放进某个段落，或先选中一段文字", "edit");
    return;
  }
  baseText = el.value;
  origStart.value = range.start;
  origEnd.value = range.end;
  instruction.value = "";
  draft.value = "";
  phase.value = "input";
  bindViewportListeners();
  emit("opened");
  nextTick(() => {
    reposition();
    inputRef.value?.focus();
    autoGrow();
    /* 渲染后再量一次真实高度，翻转方向才准。 */
    nextTick(reposition);
  });
}

/** 中止正在进行的流式生成（正文回退由 catch 分支统一处理）。 */
function abortStreaming() {
  controller?.abort();
}

/** 收起浮层。不动正文——正文由 accept / reject / restore 负责。 */
function close() {
  if (phase.value === "idle") return;
  controller?.abort();
  controller = null;
  phase.value = "idle";
  instruction.value = "";
  draft.value = "";
  presetMenuOpen.value = false;
  barPos.value = { ...barPos.value, show: false };
  pillPos.value = { ...pillPos.value, show: false };
  origBand.value = { ...origBand.value, show: false };
  outBand.value = { ...outBand.value, show: false };
  unbindViewportListeners();
  emit("closed");
}

/** 把正文回退到提交前的快照。 */
function restore() {
  if (phase.value !== "idle") model.value = baseText;
  close();
}

/* ---------------- 生成 ---------------- */

/** 去掉整体包裹的代码围栏与前后空白，避免把 ``` 写进正文。 */
function cleanOutput(raw: string): string {
  let text = raw.trim();
  const fence = text.match(/^```[^\n]*\n([\s\S]*?)\n?```$/);
  if (fence) text = fence[1];
  return text.trim();
}

function buildPromptAndSystem(original: string, ask: string) {
  const isPolish = ask.includes("润色选段");
  const isContinue = ask.includes("续写");
  const isHabitGen = ask.includes("依习惯生成");

  let taskDesc = "";
  let userContent = "";

  if (isPolish) {
    const userOpinion = ask.replace(/润色选段[：:]?\s*/, "").trim();
    taskDesc = [
      "本次任务：行内编辑 - 润色选段。",
      "机制约束：",
      "1. 仅润色目标原文片段，保持原意与长度量级（不大幅扩写或缩写）。",
      "2. 结合用户的写作习惯画像与个人语气偏好进行精修。",
      userOpinion ? `3. 用户特别要求/意见：${userOpinion}` : "",
      "4. 只输出润色后的正文内容本身，不要解释、不要复述原文、不要代码围栏。",
    ].filter(Boolean).join("\n");
    userContent = `目标原文片段：\n"""\n${original}\n"""`;
  } else if (isContinue) {
    const userOpinion = ask.replace(/续写[：:]?\s*/, "").trim();
    taskDesc = [
      "本次任务：行内编辑 - 续写。",
      "机制约束：",
      "1. 紧接目标原文续写下一段，无缝承接上下文的语境、情节、语气与视角。",
      "2. 字数严格控制在 250~450 字以内，严禁冗长或水文。",
      userOpinion ? `3. 用户特别要求/意见：${userOpinion}` : "",
      "4. 充分应用用户的写作习惯画像，只输出续写正文，不要任何解释说明。",
    ].filter(Boolean).join("\n");
    userContent = `已有原文上下文：\n"""\n${original}\n"""`;
  } else if (isHabitGen) {
    const userOpinion = ask.replace(/依习惯生成[：:]?\s*/, "").trim();
    taskDesc = [
      "本次任务：行内编辑 - 依习惯生成。",
      "机制约束：",
      "1. 严格结合上文上下文语境与用户的写作习惯画像，重新生成或扩充该段正文。",
      "2. 字数严格控制在 250~450 字以内，保持自然连贯。",
      userOpinion ? `3. 用户特别要求/意见：${userOpinion}` : "",
      "4. 绝不输出任何统计分析、大纲或说明，只输出纯正文内容。",
    ].filter(Boolean).join("\n");
    userContent = `已有原文上下文：\n"""\n${original}\n"""`;
  } else {
    taskDesc = [
      "本次任务：行内编辑。",
      "机制约束：",
      "1. 根据用户的指令修改或处理目标原文段落。",
      "2. 保持与原文一致的语言、体裁与 Markdown 语法层级。",
      "3. 只输出可直接替换原文的正文内容本身，不要解释说明、不要代码围栏。",
    ].join("\n");
    userContent = `原文段落：\n"""\n${original}\n"""\n\n指令：${ask}`;
  }

  const systemPrompt = [
    aiSettings.writerPrompt.trim() || WRITER_AGENT_PROMPT,
    taskDesc,
    buildInsightContext(),
  ]
    .filter(Boolean)
    .join("\n\n");

  return { systemPrompt, userContent };
}

async function submit() {
  const el = props.target;
  const ask = instruction.value.trim();
  if (!el || !ask || phase.value !== "input") return;
  if (!aiSettings.apiKey.trim()) {
    showToast("未配置 API", "请先在「设置 → AI接口设置」中填写 API key", "edit");
    return;
  }

  baseText = model.value;
  const original = baseText.slice(origStart.value, origEnd.value);
  if (!original.trim()) {
    close();
    return;
  }

  /* 预览排版：原文 → 空一行 → AI 输出 → 空一行 → 原有后文。
     两侧空行统一规整，接受 / 拒绝时都按 baseText 重算，不留副作用。 */
  rawTail = baseText.slice(origEnd.value);
  const tailBody = rawTail.replace(/^\n+/, "");
  previewHead = `${baseText.slice(0, origEnd.value)}\n\n`;
  previewTail = tailBody ? `\n\n${tailBody}` : "";
  outStart.value = previewHead.length;

  draft.value = "";
  phase.value = "streaming";
  model.value = previewHead + previewTail;
  settle();

  controller = new AbortController();
  const signal = controller.signal;

  const { systemPrompt, userContent } = buildPromptAndSystem(original, ask);

  try {
    const result = await runAgent({
      provider: aiSettings.provider,
      apiType: aiSettings.apiType,
      apiKey: aiSettings.apiKey,
      url: aiSettings.url,
      model: aiSettings.model,
      systemPrompt,
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
      stream: true,
      maxRounds: 1,
      temperature: 0.7,
      signal,
      /* onChunk 给的是累计全文，直接赋值，不能追加。 */
      onChunk: (full) => {
        if (signal.aborted) return;
        draft.value = full;
        model.value = previewHead + full + previewTail;
        scheduleReposition();
      },
    });

    /* 极少数情况下 abort 恰好落在请求完成之后：runAgent 正常返回，但用户已经
       撤销了这次生成，此时同样回退，不能让浮层卡在生成态。 */
    if (signal.aborted) {
      restore();
      return;
    }
    recordTokens("editor", result.tokens);

    const final = cleanOutput(result.text);
    if (!final) {
      showToast("AI 未返回内容", "换个说法或换个模型再试一次", "edit");
      restore();
      return;
    }
    draft.value = final;
    model.value = previewHead + final + previewTail;
    phase.value = "review";
    settle();
  } catch (error) {
    if ((error as Error)?.name === "AbortError") {
      restore();
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    showToast("AI 调用失败", message.slice(0, 120), "edit");
    restore();
  } finally {
    controller = null;
  }
}

/* ---------------- 接受 / 拒绝 ---------------- */

function accept() {
  const after = draft.value.trim();
  if (!after) {
    restore();
    return;
  }
  const el = props.target;
  const before = baseText.slice(origStart.value, origEnd.value);
  model.value = baseText.slice(0, origStart.value) + after + rawTail;
  /* 真实的「原文 → 修改后」配对，修改记忆就是由它累积出来的。 */
  trackModification(before, after, undefined, { source: "ai" });
  emit("applied", { before, after });

  const caret = origStart.value + after.length;
  close();
  nextTick(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(caret, caret);
  });
  showToast("已接受 AI 输出", "原文段落已被替换，并记入修改记忆", "edit");
}

function reject() {
  const el = props.target;
  const caretStart = origStart.value;
  restore();
  nextTick(() => {
    if (!el) return;
    el.focus();
    el.setSelectionRange(caretStart, caretStart);
  });
  showToast("已拒绝 AI 输出", "生成内容已清空，原文保持不变", "edit");
}

/* ---------------- 事件绑定 ---------------- */

function onTargetKeydown(event: KeyboardEvent) {
  if (!props.enabled) return;
  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return;
  if (event.key.toLowerCase() !== "k") return;
  event.preventDefault();
  event.stopPropagation();
  if (phase.value === "streaming") return;
  if (phase.value === "review") {
    /* 复看阶段再按一次：直接落笔接受，与 Ctrl+Enter 一致。 */
    accept();
    return;
  }
  if (phase.value === "input") {
    close();
    return;
  }
  open();
}

function onInputKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    event.preventDefault();
    /* 菜单开着时 Esc 只关菜单，再按一次才收浮层。 */
    if (presetMenuOpen.value) {
      presetMenuOpen.value = false;
      inputRef.value?.focus();
      return;
    }
    close();
    props.target?.focus();
    return;
  }
  /* 焦点在浮层输入框里时，Ctrl+K 不会经过文本域，这里补一次「再按即取消」。 */
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
    event.preventDefault();
    close();
    props.target?.focus();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void submit();
  }
}

/**
 * 复看 / 生成阶段的全局快捷键：Esc 拒绝、Ctrl+Enter 或 Ctrl+K 接受。
 *
 * 本监听在捕获阶段、且注册在 window 上，因此一定早于文本域自身的处理器；
 * 处理掉的键必须同时停止传播，否则 accept() 把 phase 归零后，事件继续走到
 * onTargetKeydown 会被当成一次全新的 Ctrl+K 呼出。
 */
function onWindowKeydown(event: KeyboardEvent) {
  if (phase.value === "streaming") {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      abortStreaming();
    }
    return;
  }
  if (phase.value !== "review") return;
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    reject();
    return;
  }
  const mod = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (!mod) return;
  /* 复看阶段焦点常已不在文本域上，Ctrl+K 在这里兜底为「接受」。 */
  if (event.key === "Enter" || event.key.toLowerCase() === "k") {
    event.preventDefault();
    event.stopPropagation();
    accept();
  }
}

/**
 * 输入阶段点浮层以外的地方就收起；复看阶段必须显式接受 / 拒绝。
 *
 * 必须注册在捕获阶段：画布卡片编辑面板的外壳带 `@mousedown.stop`
 * （LibraryView.vue 的 .modal-shell → raiseEditor），冒泡阶段的 document
 * 监听收不到面板内的点击，浮层就会一直钉在面板里关不掉。
 */
function onDocumentMouseDown(event: MouseEvent) {
  if (phase.value !== "input") return;
  const node = event.target as Node | null;
  if (!node) return;
  if (rootRef.value?.contains(node)) {
    /* 点在浮层内、但不在「/」菜单上：收起菜单，保留浮层。 */
    const el = node instanceof Element ? node : node.parentElement;
    if (presetMenuOpen.value && !el?.closest(".iae-slash-wrap")) {
      presetMenuOpen.value = false;
    }
    return;
  }
  close();
}

/**
 * 用户直接改动正文时的处理，按阶段分开。
 *
 * 输入中：段落区间是呼出那一刻量好的，正文一改就失效，因此直接收起浮层。
 * 生成中：流式输出正按字符偏移往正文里写，插入文字会让偏移全部错位，
 * 所以拦下这次输入并提示一次（不丢内容，也不破坏对比区间）。
 * 复看中：视为「不用取舍了，我自己接着改」——静默退出浮层，原文与 AI 输出
 * 都按当前样子留在正文里，交给用户手动编辑。
 */
let lockToastAt = 0;

function onTargetBeforeInput(event: Event) {
  if (phase.value === "streaming") {
    event.preventDefault();
    /* 连按时不重复弹提示。 */
    const now = Date.now();
    if (now - lockToastAt > 4000) {
      lockToastAt = now;
      showToast("正在生成", "生成期间正文暂不可改，按 Esc 可中止", "edit");
    }
    return;
  }
  if (phase.value === "input" || phase.value === "review") close();
}

/* ---------------- 监听器装卸 ---------------- */

let viewportBound = false;

function bindViewportListeners() {
  if (viewportBound) return;
  viewportBound = true;
  window.addEventListener("resize", reposition);
  /* 捕获阶段监听滚动：编辑区外层任一祖先滚动都要跟着重定位。 */
  window.addEventListener("scroll", reposition, true);
  /* 捕获阶段监听按键：要早于文本域自己的处理器拿到 Esc / Ctrl+Enter。 */
  window.addEventListener("keydown", onWindowKeydown, true);
  /* 同样用捕获阶段：宿主面板外壳带 @mousedown.stop，冒泡阶段收不到。 */
  document.addEventListener("mousedown", onDocumentMouseDown, true);
}

function unbindViewportListeners() {
  if (!viewportBound) return;
  viewportBound = false;
  window.removeEventListener("resize", reposition);
  window.removeEventListener("scroll", reposition, true);
  window.removeEventListener("keydown", onWindowKeydown, true);
  document.removeEventListener("mousedown", onDocumentMouseDown, true);
}

watch(
  () => props.target,
  (el) => {
    if (boundTarget) {
      boundTarget.removeEventListener("keydown", onTargetKeydown, true);
      boundTarget.removeEventListener("beforeinput", onTargetBeforeInput);
    }
    boundTarget = el;
    /* 捕获阶段接管，宿主自己的 keydown 里不必新增任何分支。 */
    el?.addEventListener("keydown", onTargetKeydown, true);
    el?.addEventListener("beforeinput", onTargetBeforeInput);
    if (!el && phase.value !== "idle") close();
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  controller?.abort();
  if (boundTarget) {
    boundTarget.removeEventListener("keydown", onTargetKeydown, true);
    boundTarget.removeEventListener("beforeinput", onTargetBeforeInput);
  }
  unbindViewportListeners();
});

function usePreset(text: string) {
  instruction.value = text;
  presetMenuOpen.value = false;
  nextTick(() => {
    const el = inputRef.value;
    if (!el) return;
    el.focus();
    /* 光标落到末尾，方便在模板后面继续补要求。 */
    el.setSelectionRange(text.length, text.length);
  });
}

function togglePresetMenu() {
  presetMenuOpen.value = !presetMenuOpen.value;
  if (!presetMenuOpen.value) inputRef.value?.focus();
}

/**
 * 输入框随内容长高。单行指令保持一行的紧凑高度；一旦内容超过一行就至少撑到
 * 三行（长指令不必在一条缝里滚动着写），再长则封顶到六行内部滚动。
 */
const INPUT_MIN_ROWS = 1;
const INPUT_LONG_ROWS = 3;
const INPUT_MAX_ROWS = 6;

function autoGrow() {
  const el = inputRef.value;
  if (!el) return;
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 13.5;
  const lineH = cs.lineHeight === "normal" ? fontSize * 1.6 : parseFloat(cs.lineHeight) || fontSize * 1.6;
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);

  /* 先塌到一行量真实内容高度，再决定落在哪一档。 */
  el.style.height = `${lineH * INPUT_MIN_ROWS + padY}px`;
  const contentRows = Math.max(INPUT_MIN_ROWS, Math.round((el.scrollHeight - padY) / lineH));
  const rows =
    contentRows <= INPUT_MIN_ROWS
      ? INPUT_MIN_ROWS
      : Math.min(INPUT_MAX_ROWS, Math.max(INPUT_LONG_ROWS, contentRows));

  el.style.height = `${lineH * rows + padY}px`;
  el.style.overflowY = contentRows > INPUT_MAX_ROWS ? "auto" : "hidden";
  scheduleReposition();
}

watch(instruction, () => nextTick(autoGrow));
</script>

<template>
  <Teleport to="body">
    <div v-if="phase !== 'idle'" ref="rootRef" class="iae-root">
      <!-- 原文段落底色：只做对比标记，不吃点击。 -->
      <div
        v-if="origBand.show"
        class="iae-band orig"
        :style="{
          top: origBand.top + 'px',
          left: origBand.left + 'px',
          width: origBand.width + 'px',
          height: origBand.height + 'px',
        }"
      ></div>
      <!-- AI 输出块底色。 -->
      <div
        v-if="outBand.show"
        class="iae-band out"
        :style="{
          top: outBand.top + 'px',
          left: outBand.left + 'px',
          width: outBand.width + 'px',
          height: outBand.height + 'px',
        }"
      ></div>

      <!-- Ctrl+K 长条输入框 -->
      <div
        v-if="barPos.show"
        class="iae-bar"
        role="dialog"
        aria-label="行内 AI 编辑"
        :style="{ top: barPos.top + 'px', left: barPos.left + 'px', width: barPos.width + 'px' }"
        @mousedown.stop
      >
        <div class="iae-bar-row">
          <Sparkles class="iae-bar-icon" :size="15" :stroke-width="1.8" aria-hidden="true" />
          <textarea
            ref="inputRef"
            v-model="instruction"
            v-auto-pair
            class="iae-input"
            rows="1"
            spellcheck="false"
            aria-label="对选中文字提问或下达修改指令"
            :placeholder="label ? `对${label}的这段文字提问或下达修改指令…` : '对这段文字提问或下达修改指令…'"
            @keydown="onInputKeydown"
          ></textarea>
          <button
            class="iae-send"
            :disabled="!instruction.trim()"
            title="生成（Enter）"
            aria-label="生成"
            @click="submit"
          >
            <CornerDownLeft :size="14" :stroke-width="2" aria-hidden="true" />
          </button>
        </div>
        <div class="iae-bar-foot">
          <!-- 「/」指令菜单：默认收起、默认无选择，点开才列出四条模板。 -->
          <div class="iae-slash-wrap">
            <button
              class="iae-slash"
              :class="{ on: presetMenuOpen }"
              title="插入常用指令模板"
              aria-label="插入常用指令模板"
              :aria-expanded="presetMenuOpen"
              @click="togglePresetMenu"
            >
              /
            </button>
            <div v-if="presetMenuOpen" class="iae-slash-menu" role="menu">
              <button
                v-for="p in presets"
                :key="p.label"
                class="iae-slash-item"
                role="menuitem"
                :title="p.text"
                @click="usePreset(p.text)"
              >
                {{ p.label }}
              </button>
            </div>
          </div>
          <span class="iae-hint">Enter 生成 · Shift+Enter 换行 · Esc 取消</span>
        </div>
      </div>

      <!-- 输出块右上角：接受 / 拒绝 -->
      <div
        v-if="pillPos.show"
        ref="pillRef"
        class="iae-pill"
        role="group"
        aria-label="AI 输出取舍"
        :style="{ top: pillPos.top + 'px', left: pillPos.left + 'px' }"
        @mousedown.stop.prevent
      >
        <template v-if="phase === 'streaming'">
          <Loader2 class="iae-spin" :size="13" :stroke-width="2" aria-hidden="true" />
          <span class="iae-pill-text" role="status">生成中…</span>
          <button class="iae-pill-btn" title="中止生成（Esc）" aria-label="中止生成" @click="abortStreaming">
            <X :size="13" :stroke-width="2" aria-hidden="true" />
          </button>
        </template>
        <template v-else>
          <button class="iae-pill-btn accept" title="接受，替换原文（Ctrl+Enter）" @click="accept">
            <Check :size="13" :stroke-width="2.2" aria-hidden="true" />
            <span>接受</span>
          </button>
          <span class="iae-pill-sep" aria-hidden="true"></span>
          <button class="iae-pill-btn reject" title="拒绝，清空生成内容（Esc）" @click="reject">
            <X :size="13" :stroke-width="2.2" aria-hidden="true" />
            <span>拒绝</span>
          </button>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 层级需高于画布卡片编辑面板（≈1000）、地图卡片面板与拼接弹窗（≈2000），
   也高于既有的选中浮动工具栏（3000），否则会被压在下面。 */
.iae-root {
  position: fixed;
  inset: 0;
  z-index: 3500;
  pointer-events: none;
}

.iae-root > * {
  pointer-events: auto;
}

/* 对比色带：淡到能透出正文，仅做区块提示。 */
.iae-band {
  position: fixed;
  border-radius: 4px;
  pointer-events: none;
}

.iae-band.orig {
  background: rgb(239 68 68 / 0.09);
  box-shadow: inset 2px 0 0 rgb(239 68 68 / 0.5);
}

.iae-band.out {
  background: rgb(34 197 94 / 0.12);
  box-shadow: inset 2px 0 0 rgb(34 197 94 / 0.55);
}

.iae-bar {
  position: fixed;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: 0 12px 32px -6px rgb(15 23 42 / 0.22), 0 2px 6px rgb(15 23 42 / 0.08);
  backdrop-filter: blur(8px);
}

.iae-bar-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.iae-bar-icon {
  flex: 0 0 auto;
  color: var(--primary);
  margin-top: 4px;
}

/* 高度由 autoGrow() 按行数直接写在 style 上：1 行 → 长文至少 3 行 → 封顶 6 行。 */
.iae-input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  resize: none;
  padding: 2px 0;
  background: transparent;
  color: var(--on-surface);
  font-family: var(--app-font);
  font-size: 13.5px;
  line-height: 1.6;
}

.iae-input::placeholder {
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.iae-send {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 6px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.iae-send:disabled {
  opacity: 0.35;
  cursor: default;
}

.iae-send:not(:disabled):hover {
  transform: translateY(-1px);
}

.iae-bar-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

/* 左下角「/」菜单：收起时只占一枚小方块，展开向上弹出模板列表。 */
.iae-slash-wrap {
  position: relative;
  flex: 0 0 auto;
}

.iae-slash {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 1px solid var(--outline-variant);
  border-radius: 5px;
  background: var(--surface-container-low);
  color: var(--on-surface-variant);
  font-family: var(--code-font);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s ease;
}

.iae-slash:hover,
.iae-slash.on {
  border-color: var(--primary);
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.08);
}

.iae-slash-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  display: flex;
  flex-direction: column;
  min-width: 92px;
  padding: 4px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px -2px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.08);
}

.iae-slash-item {
  padding: 5px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-size: 12.5px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.iae-slash-item:hover {
  background: rgb(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.iae-hint {
  flex: 0 0 auto;
  color: var(--reading-text-faint);
  font-size: 11px;
  white-space: nowrap;
}

.iae-pill {
  position: fixed;
  transform: translateX(-100%);
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 3px 5px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px -2px rgb(0 0 0 / 0.18), 0 2px 6px rgb(0 0 0 / 0.08);
  white-space: nowrap;
  user-select: none;
}

.iae-pill-text {
  color: var(--on-surface-variant);
  font-size: 11.5px;
  padding: 0 2px;
}

.iae-pill-sep {
  width: 1px;
  height: 14px;
  background: var(--outline-variant);
  margin: 0 2px;
}

.iae-pill-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 3px 7px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.iae-pill-btn.accept:hover {
  background: rgb(34 197 94 / 0.16);
  color: #15803d;
}

.iae-pill-btn.reject:hover {
  background: var(--error-container);
  color: var(--error);
}

.iae-spin {
  color: var(--primary);
  animation: iae-rotate 0.9s linear infinite;
}

/* 键盘操作可见焦点圈：浮层里的按钮都能 Tab 到。 */
.iae-send:focus-visible,
.iae-slash:focus-visible,
.iae-slash-item:focus-visible,
.iae-pill-btn:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 1px;
}

@keyframes iae-rotate {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .iae-spin {
    animation-duration: 2.4s;
  }
}
</style>
