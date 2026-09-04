import type { ObjectDirective } from "vue";

/**
 * 成对标点自动补全。
 *
 * 在编辑区 / 文本卡片 / 拼文编辑区等输入框里，键入左引号、书名号、括号一类
 * 「需要另一半」的标点时，自动把另一半补上，并把光标停在两者中间待命。
 *
 * ---- 为什么是「事后校正」而不是「拦下重写」 ----
 *
 * 第一版走的是 `beforeinput` + `preventDefault()` 自己插入。这条路在纯输入框里
 * 成立，但在文档编辑区 / 画布卡片 / 拼文弹窗这些「重装」编辑区里不成立：
 * 那几处的文本域上还叠着别人的 `beforeinput` 监听（行内 AI 编辑）、撤销栈的
 * 同步 watcher、覆盖层同步等等，取消默认行为这条路一旦被任何一环干扰，
 * 整个补全就静默失效，而且失效得毫无征兆。
 *
 * 现在改成完全不取消默认行为：
 *  1. document 捕获阶段的 `beforeinput` 只做一件事 —— 拍一张「改动前」的快照
 *     （正文 + 选区）。捕获阶段一定早于任何元素级监听，快照必然是干净的。
 *  2. document 冒泡阶段的 `input` 里做校正：浏览器已经把字符插进去了、`v-model`
 *     也已经同步过一轮，此时再把另一半补上并摆好光标，然后补发一次 `input`。
 * 这样谁都拦不住它，也不用关心宿主组件在文本域上还挂了什么。
 *
 * 输入法（中文全角标点常常走「组合上屏」）另有一条 `compositionend` 兜底通道。
 */

interface PairRule {
  open: string;
  close: string;
}

/**
 * 成对标点表。
 *
 * 只收「必须成对出现」的标点：中英文引号、书名号、各类括号。顿号、问号、
 * 破折号之类没有另一半，不在此列；ASCII 的 `<` `>` 也故意不收——Markdown 正文
 * 里它多半是别的意思，补全只会碍事。
 */
const PAIRS: PairRule[] = [
  /* 中文引号 */
  { open: "“", close: "”" },
  { open: "‘", close: "’" },
  /* 书名号 */
  { open: "《", close: "》" },
  { open: "〈", close: "〉" },
  /* 直角引号 */
  { open: "「", close: "」" },
  { open: "『", close: "』" },
  /* 方头括号 / 六角括号 */
  { open: "【", close: "】" },
  { open: "〖", close: "〗" },
  { open: "〔", close: "〕" },
  { open: "［", close: "］" },
  { open: "｛", close: "｝" },
  /* 全角圆括号 */
  { open: "（", close: "）" },
  /* 半角括号 */
  { open: "(", close: ")" },
  { open: "[", close: "]" },
  { open: "{", close: "}" },
  /* 英文直引号：左右同形，靠「跨过去」规则区分开合 */
  { open: '"', close: '"' },
];

const OPEN_TO_CLOSE = new Map(PAIRS.map((p) => [p.open, p.close]));
const CLOSERS = new Set(PAIRS.map((p) => p.close));
/** 左右同形的标点（英文直引号），需要额外判断该开还是该合。 */
const SYMMETRIC = new Set(PAIRS.filter((p) => p.open === p.close).map((p) => p.open));

/** 标记属性：指令挂上它，document 级监听只认带这个标记的输入框。 */
const ATTR = "data-auto-pair";

/** 字母 / 数字 / 汉字等「词内字符」。同形引号紧跟在词后面时按撇号处理，不补全。 */
function isWordChar(ch: string): boolean {
  if (!ch) return false;
  return /[0-9A-Za-z\u00c0-\u024f\u4e00-\u9fff]/.test(ch);
}

type PairableElement = HTMLTextAreaElement | HTMLInputElement;

/** 只在纯文本输入框上工作；密码框、数字框之类一律跳过。 */
function pairable(target: EventTarget | null): PairableElement | null {
  if (target instanceof HTMLTextAreaElement) return target;
  if (target instanceof HTMLInputElement) {
    const type = (target.type || "text").toLowerCase();
    if (type === "text" || type === "search" || type === "url") return target;
  }
  return null;
}

/** 该元素是否挂了 v-auto-pair 且当前可编辑。 */
function eligible(target: EventTarget | null): PairableElement | null {
  const el = pairable(target);
  if (!el || !el.hasAttribute(ATTR)) return null;
  if (el.readOnly || el.disabled) return null;
  return el;
}

/** 输入法组合进行中：这一轮交给 compositionend 兜底通道。 */
function composing(el: PairableElement, event: { isComposing?: boolean }): boolean {
  if (event.isComposing) return true;
  return Boolean((el as unknown as { composing?: boolean }).composing);
}

/* ---------------- 改动前快照 ---------------- */

interface Snapshot {
  value: string;
  selStart: number;
  selEnd: number;
}

const snapshots = new WeakMap<PairableElement, Snapshot>();

/** 正在落地自己的改写：期间产生的 input 事件不再进入校正流程。 */
let applying = false;

/**
 * 落地一次改写：写值 → 摆光标 → 补发 input 事件。
 *
 * 顺序很讲究：先摆好光标再补发事件，宿主的同步 watcher（比如文档编辑区的
 * 撤销栈）读到的才是改写后的真实光标位置，Ctrl+Z 回来才落得准。
 */
function apply(el: PairableElement, next: string, selStart: number, selEnd: number) {
  applying = true;
  try {
    el.value = next;
    el.setSelectionRange(selStart, selEnd);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } finally {
    applying = false;
  }

  /* 兜底：若宿主在 input 之后又回写了一次值（框架 patch），把光标摆回来。 */
  void Promise.resolve().then(() => {
    if (document.activeElement !== el) return;
    if (el.value !== next) return;
    if (el.selectionStart === selStart && el.selectionEnd === selEnd) return;
    el.setSelectionRange(selStart, selEnd);
  });
}

/* ---------------- 键入一个字符 ---------------- */

function handleInsert(el: PairableElement, ch: string, snap: Snapshot | undefined) {
  const curr = el.value;
  const caret = el.selectionStart ?? 0;
  /* 键入之后光标必然是折叠的，且刚落下的字符就在光标前面；对不上就不是普通键入。 */
  if ((el.selectionEnd ?? caret) !== caret) return;
  if (curr.slice(caret - ch.length, caret) !== ch) return;

  /* 快照必须与「当前值」自圆其说：把这次插入套回快照，结果应当正好等于当前值。
     对不上说明这份快照过期了（例如上一次 beforeinput 被别人 preventDefault，
     input 没来，快照留在了 WeakMap 里），此时按无快照处理。 */
  const consistent = (s: Snapshot): boolean => {
    const a = Math.min(s.selStart, s.selEnd);
    const b = Math.max(s.selStart, s.selEnd);
    return s.value.slice(0, a) + ch + s.value.slice(b) === curr && a + ch.length === caret;
  };

  /* 没拍到（或快照过期）时，按「折叠光标处插入一个字符」反推一份，
     这样主流程照样成立，只是失去「选中包裹」这一项能力。 */
  const before: Snapshot =
    snap && consistent(snap)
      ? snap
      : {
          value: curr.slice(0, caret - ch.length) + curr.slice(caret),
          selStart: caret - ch.length,
          selEnd: caret - ch.length,
        };

  const selStart = Math.min(before.selStart, before.selEnd);
  const selEnd = Math.max(before.selStart, before.selEnd);
  const collapsed = selStart === selEnd;

  /* 1) 光标原本正压在同一个右标点上 → 把刚打的这个撤掉，直接跨过去，
        不写出重复的一半。同形引号（"）也走这条，等于自动区分了开合。 */
  if (
    collapsed &&
    CLOSERS.has(ch) &&
    before.value.slice(selStart, selStart + ch.length) === ch
  ) {
    apply(el, curr.slice(0, caret - ch.length) + curr.slice(caret), caret, caret);
    return;
  }

  const close = OPEN_TO_CLOSE.get(ch);
  if (!close) return;

  /* 2) 原本选中了一段 → 浏览器已经用这个字符把选区替换掉了，
        用快照把它整段包起来重建回来，包完保持选中。 */
  if (!collapsed) {
    const inner = before.value.slice(selStart, selEnd);
    const next =
      before.value.slice(0, selStart) + ch + inner + close + before.value.slice(selEnd);
    apply(el, next, selStart + ch.length, selStart + ch.length + inner.length);
    return;
  }

  /* 3) 同形引号紧跟在词内字符后面，按撇号 / 收尾引号处理，不补全。 */
  if (SYMMETRIC.has(ch) && isWordChar(before.value.slice(selStart - 1, selStart))) return;

  /* 4) 普通补全：另一半贴在光标后面，光标原地待命。 */
  apply(el, curr.slice(0, caret) + close + curr.slice(caret), caret, caret);
}

/* ---------------- 退格 ---------------- */

/** 一对空标点中间按退格：两半一起删。 */
function handleBackspace(el: PairableElement, snap: Snapshot | undefined) {
  if (!snap) return;
  if (snap.selStart !== snap.selEnd || snap.selStart === 0) return;

  const opener = snap.value.slice(snap.selStart - 1, snap.selStart);
  const close = OPEN_TO_CLOSE.get(opener);
  if (!close) return;
  if (snap.value.slice(snap.selStart, snap.selStart + close.length) !== close) return;

  const curr = el.value;
  const caret = el.selectionStart ?? 0;
  if ((el.selectionEnd ?? caret) !== caret) return;
  /* 快照要与当前值自圆其说：这次退格删掉的正好是那个左半。 */
  if (caret !== snap.selStart - 1) return;
  if (snap.value.slice(0, snap.selStart - 1) + snap.value.slice(snap.selStart) !== curr) return;
  if (curr.slice(caret, caret + close.length) !== close) return;

  apply(el, curr.slice(0, caret) + curr.slice(caret + close.length), caret, caret);
}

/* ---------------- document 级监听 ---------------- */

/** 捕获阶段：只拍快照，绝不改动、绝不取消默认行为。 */
function onBeforeInput(event: Event) {
  if (applying) return;
  const el = eligible(event.target);
  if (!el) return;
  const start = el.selectionStart ?? 0;
  snapshots.set(el, {
    value: el.value,
    selStart: start,
    selEnd: el.selectionEnd ?? start,
  });
}

/** 冒泡阶段：浏览器与 v-model 都已经落定，这里做补全校正。 */
function onInput(event: Event) {
  if (applying) return;
  const el = eligible(event.target);
  if (!el) return;

  const snap = snapshots.get(el);
  snapshots.delete(el);

  const ie = event as InputEvent;
  if (composing(el, ie)) return;

  if (ie.inputType === "insertText") {
    const data = ie.data ?? "";
    /* 只处理单个字符；成串粘贴、输入法整词上屏都不动。 */
    if (Array.from(data).length !== 1) return;
    handleInsert(el, data, snap);
    return;
  }

  /* 少数浏览器 / 输入法在纯 ASCII 键入时不给 inputType（或给空串），
     此时靠快照与当前值的差异反推出「刚插入了一个字符」。 */
  if (!ie.inputType && snap) {
    const a = Math.min(snap.selStart, snap.selEnd);
    const caret = el.selectionStart ?? 0;
    const inserted = el.value.slice(a, caret);
    if (Array.from(inserted).length === 1) {
      handleInsert(el, inserted, snap);
    }
    return;
  }

  if (ie.inputType === "deleteContentBackward") {
    handleBackspace(el, snap);
  }
}

/**
 * 输入法兜底通道。
 *
 * 有些输入法把全角标点当成一次「组合上屏」交出来，这时 input 的 inputType 是
 * `insertCompositionText`，上面那条路会主动让开。这里在组合结束后补一刀：
 * 若刚上屏的正是一个左标点，就把另一半贴在光标后面，光标原地不动。
 */
function onCompositionEnd(event: Event) {
  const ce = event as CompositionEvent;
  const el = eligible(ce.target);
  if (!el) return;

  const data = ce.data ?? "";
  if (Array.from(data).length !== 1) return;

  const close = OPEN_TO_CLOSE.get(data);
  /* 同形引号在组合通道里分不出开合，宁可不补。 */
  if (!close || SYMMETRIC.has(data)) return;

  /* 推到下一个宏任务再补：v-model 自己的 compositionend 处理器要先跑完
     （它会清掉 composing 标记并补发 input），否则我们补发的 input 会被丢掉，
     出现「界面上有另一半、数据里没有」的错位。 */
  setTimeout(() => {
    if (document.activeElement !== el) return;
    const caret = el.selectionStart ?? 0;
    if ((el.selectionEnd ?? caret) !== caret) return;
    /* 光标必须紧跟在刚上屏的这个字符后面，否则不是我们要接的那一次。 */
    if (el.value.slice(caret - data.length, caret) !== data) return;
    /* 已经有另一半就别重复补。 */
    if (el.value.slice(caret, caret + close.length) === close) return;
    apply(el, el.value.slice(0, caret) + close + el.value.slice(caret), caret, caret);
  }, 0);
}

let installed = false;

/** 装上 document 级监听。幂等，模块加载时就调用一次。 */
export function installAutoPair() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  /* 捕获阶段拍快照：一定早于任何元素级 beforeinput 监听。 */
  document.addEventListener("beforeinput", onBeforeInput, true);
  /* 冒泡阶段做校正：一定晚于元素上的 v-model input 监听。 */
  document.addEventListener("input", onInput, false);
  document.addEventListener("compositionend", onCompositionEnd, false);
}

installAutoPair();

/**
 * `v-auto-pair` 指令。挂在 textarea / input 上即可。
 *
 * 指令本身只负责打标记（放在 `created` 里，比 `mounted` 更早、也不受渲染后
 * 队列的影响）。真正的处理在 document 级监听里，因此对 `v-model`、
 * `defineModel`、`:value + @input` 三种写法都同样有效，也不会跟宿主组件
 * 自己挂在文本域上的任何监听抢位置。
 */
export const autoPairDirective: ObjectDirective<PairableElement> = {
  created(el) {
    el.setAttribute(ATTR, "");
    installAutoPair();
  },
  mounted(el) {
    /* SSR / 手工创建节点等场景下 created 可能没跑到，这里再补一次。 */
    if (!el.hasAttribute(ATTR)) el.setAttribute(ATTR, "");
  },
  beforeUnmount(el) {
    snapshots.delete(el);
    el.removeAttribute(ATTR);
  },
};
