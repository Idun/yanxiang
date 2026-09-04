/**
 * 打字机滚动（typewriter scrolling）。
 *
 * 问题：文本域的原生行为只保证「光标可见」。写到正文末尾时，光标就一直贴在
 * 编辑区底边，之后每敲一行都在最底下那条线上写字 —— 视线被压到屏幕边缘，
 * 既看不到下文（本来也没有下文），也看不清刚写完的上文。
 *
 * 这里做两件事，合起来让「正在写的那一行」稳定停在编辑区中部：
 *
 *  1. 末尾跑道（runway）：给滚动容器补一段底部内边距，正文最后一行因此也能被
 *     滚到中部。跑道按可视高度取比例，并保证至少留三行正文的可见空间，
 *     画布卡片 / 拼文对比这类矮编辑框不会一屏全是空白。
 *  2. 舒适带（band）：光标所在行的底边越过「锚点 + 一行」时，把它拉回锚点。
 *     所以连续写下去表现为「每新起一行，画面上移一行」，而在锚点之上编辑
 *     （翻到前文改字）完全不会引起画面跳动。
 *
 * 只在「内容真的发生变化」时调用（textarea 的 input），不挂在光标移动上：
 * 点击、方向键、选中都不该把画面拽走。
 *
 * 跑道不只属于文本域：与它做比例同步的每一层（差异高亮背层、预览纸面）都必须
 * 补上各自的跑道，并一律按 {@link contentScrollMax} 换算比例，否则「同一个
 * 比例」在两侧指的不是同一段正文，同步就会对不上（表现为预览比编辑区多走
 * 一截，或写到末尾时被反向同步拽回底边）。
 *
 * 行顶测量复用 readingOutline 的镜像测量，与阅读目录 / 块拖拽同一口径。
 */

import { measureTextareaTops } from "./readingOutline";

/** 跑道最多吃掉可视高度的这个比例。 */
const RUNWAY_RATIO = 0.42;
/** 光标行应当停靠的位置（占可视高度的比例，自顶部起算）。 */
const ANCHOR_RATIO = 0.45;
/** 舒适带下沿 = 锚点 + 这么多行；越过才滚动。 */
const BAND_LINES = 1;
/** 跑道之外至少留这么多行的可见正文空间。 */
const MIN_VISIBLE_LINES = 3;

/**
 * 一行的像素高度（line-height 为 normal 时按 1.6 折算，与镜像测量同口径）。
 * 文本域与预览纸面都适用 —— 预览按它的基准行高算，跑道因此随字号一起缩放。
 */
export function lineHeightOf(el: HTMLElement): number {
  const cs = window.getComputedStyle(el);
  const fontSize = parseFloat(cs.fontSize) || 15;
  return cs.lineHeight === "normal" ? fontSize * 1.6 : parseFloat(cs.lineHeight) || fontSize * 1.6;
}

/**
 * 该滚动容器应当预留的末尾跑道（px）。
 *
 * 由调用方写成内边距（一般是 `padding-bottom: calc(基础内边距 + 跑道)`），
 * 并把同一个值传给 {@link contentScrollMax} / {@link scrollSpanOf}，
 * 让进度百分比的含义保持不变。
 *
 * @param lineHeightPx 显式给出行高。预览纸面的行高写在内层正文元素上，
 *   滚动容器自己取到的是继承值，对不上实际排版，这时由调用方传入。
 */
export function typewriterRunwayPx(el: HTMLElement | null, lineHeightPx?: number): number {
  if (!el) return 0;
  const h = el.clientHeight;
  if (h <= 0) return 0;
  const lh = lineHeightPx && lineHeightPx > 0 ? lineHeightPx : lineHeightOf(el);
  const cap = Math.max(0, h - lh * MIN_VISIBLE_LINES);
  return Math.round(Math.max(0, Math.min(h * RUNWAY_RATIO, cap)));
}

/**
 * 「正文」的滚动余量：真实余量减去末尾跑道。
 *
 * 阅读进度、位置记忆都按它换算，于是 100% 依然表示「正文最后一行贴到底边」
 * ——与加跑道之前完全一致；跑道本身只是允许再往下多滚一段空白，进度会被夹在 100%。
 */
export function contentScrollMax(el: HTMLElement | null, runway = 0): number {
  if (!el) return 0;
  return Math.max(0, el.scrollHeight - el.clientHeight - runway);
}

/**
 * 一个滚动容器的可滚动区间，拆成「正文段 + 跑道段」两截。
 *
 * 两个窗格互相同步时必须按这两截分别换算：只按正文段算，源窗格滚进跑道后
 * 目标窗格就卡在正文末尾不动了（写到最后一行时预览停住）；只按总余量算，
 * 两侧跑道比例不同又会让正文位置整体错开。
 */
export interface ScrollSpan {
  /** 正文段余量：滚到这里时正文最后一行贴到底边。 */
  contentMax: number;
  /** 跑道段：正文之后额外可滚的空白（受真实余量约束后的有效值）。 */
  runway: number;
}

export function scrollSpanOf(el: HTMLElement | null, runway = 0): ScrollSpan {
  if (!el) return { contentMax: 0, runway: 0 };
  const max = Math.max(0, el.scrollHeight - el.clientHeight);
  /* 内容短到装不满一屏时，真实余量可能还不够一条跑道，此时跑道按实际可滚的算。 */
  const effective = Math.min(Math.max(0, runway), max);
  return { contentMax: max - effective, runway: effective };
}

/**
 * 把一个窗格的滚动位置换算成另一个窗格的滚动位置。
 *
 * 正文段按比例映射到正文段，跑道段按比例映射到跑道段，因此：
 *  - 正文任意位置在两侧指的是同一段文字；
 *  - 一侧滚到底（跑道走完）时另一侧也刚好到底，不会一边还差一截。
 */
export function mapScrollTop(top: number, from: ScrollSpan, to: ScrollSpan): number {
  if (top <= from.contentMax) {
    if (from.contentMax <= 0) return 0;
    return (Math.max(0, top) / from.contentMax) * to.contentMax;
  }
  if (from.runway <= 0) return to.contentMax + to.runway;
  const t = Math.min(1, (top - from.contentMax) / from.runway);
  return to.contentMax + t * to.runway;
}

/**
 * 算出为了把光标行拉回锚点而应当滚到的位置；已在舒适带内则返回 null。
 *
 * 调用时机是 input 之后，此时浏览器已经把光标滚进可视区，所以只需处理
 * 「光标被压到舒适带下沿之下」这一种情况。
 */
export function typewriterTargetTop(el: HTMLTextAreaElement): number | null {
  const h = el.clientHeight;
  if (h <= 0) return null;
  const max = el.scrollHeight - h;
  /* 内容不足一屏：既没有滚动余量，也没有「贴底书写」的问题。 */
  if (max <= 0) return null;

  const lh = lineHeightOf(el);
  const caret = typeof el.selectionStart === "number" ? el.selectionStart : 0;
  const [lineTop] = measureTextareaTops(el, [caret]);
  if (!Number.isFinite(lineTop)) return null;

  const anchor = h * ANCHOR_RATIO;
  /* 下沿不能低于「最后一行完整可见」的位置，否则矮编辑框里永远触发不了。 */
  const bandBottom = Math.min(Math.max(lh, h - lh), anchor + lh * BAND_LINES);
  const caretTop = lineTop - el.scrollTop;
  if (caretTop + lh <= bandBottom) return null;

  const next = Math.round(Math.min(max, Math.max(0, lineTop - anchor)));
  return Math.abs(next - el.scrollTop) < 1 ? null : next;
}
