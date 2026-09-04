/**
 * 阅读目录（Markdown 标题 / 纯文本章节）与标题定位工具。
 *
 * 只服务于「悬浮阅读进度圆环」（components/ReadingProgressRing.vue），
 * 单独成文件以便后续针对性优化，不改动 markdown.ts 的渲染管线，
 * 因此预览区标题无需 id / anchor：编辑区用镜像 div 量像素，
 * 预览区按顺序匹配已渲染的节点。
 *
 * 两类目录项：
 * - kind: "heading"  —— Markdown 标题（`#` 或 Setext 下划线）；
 * - kind: "chapter"  —— 纯文本 TXT 的章节行（「第一章 …」「楔子」「1、…」等）。
 *   纯文本小说不带任何 Markdown 标记，只有整行的章节标题；这类文档在
 *   「没有任何 Markdown 标题」时才启用章节识别，避免把正文里偶然出现的
 *   「第三章的内容……」误当成目录项插进 .md 文稿的目录里。
 */

export type OutlineKind = "heading" | "chapter";

export interface OutlineItem {
  /** 稳定到「同一份文档内唯一」即可，用于列表 key。 */
  id: string;
  /** 1 ~ 6 */
  level: number;
  /** 已剥离行内标记的纯文本标题。 */
  text: string;
  /** 0-based 行号。 */
  line: number;
  /** 标题行行首在原文中的字符偏移。 */
  offset: number;
  /** 标题行之后（正文第一个字符）的偏移，用于统计本节字数。 */
  bodyOffset: number;
  /** 本节字数：不含标题本身、不含空白字符。 */
  chars: number;
  /** 目录项来源。 */
  kind: OutlineKind;
}

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const ATX_RE = /^\s{0,3}(#{1,6})(?:\s+(.*))?$/;
/** Setext 下划线：`=` 无歧义；`-` 要求 2 个以上，避开列表项与分隔线。 */
const SETEXT_RE = /^\s{0,3}(=+|-{2,})\s*$/;
/** 明显不是「标题正文」的行：列表、引用、表格、分隔线、HTML。 */
const NOT_SETEXT_TEXT_RE = /^\s{0,3}(?:[-*+>|#]|\d+[.)]\s|<)/;

/* ---------------- 纯文本章节标题 ---------------- */

/** 「第一章 / 第十二回 / 第3卷 …」，后面最多再跟 40 字的小标题。 */
const CHAPTER_NUMBERED_RE =
  /^\s*(第[零一二三四五六七八九十百千万两0-9０-９]{1,12}[章回卷节集部篇])\s*(.{0,40})\s*$/;
/** 「序章 / 楔子 / 引子 / 尾声 / 后记 / 番外 / 完结感言」。 */
const CHAPTER_SPECIAL_RE = /^\s*(序章|楔子|引子|尾声|后记|番外|完结感言)\s*(.{0,40})\s*$/;
/** 「1、标题」式编号行。 */
const CHAPTER_LISTED_RE = /^\s*(\d+、)\s*(.{0,40})\s*$/;

/** 卷 / 部 / 篇是「大节」，章 / 回 / 节 / 集是其下一级。 */
function chapterLevel(marker: string): number {
  return /[卷部篇]$/.test(marker) ? 1 : 2;
}

/** 命中则返回该行的章节标题信息。 */
export function matchChapterLine(line: string): { level: number; text: string } | null {
  /* 纯空行、过长的正文行先排掉：正文段落通常远超一行标题的长度。 */
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return null;

  const numbered = CHAPTER_NUMBERED_RE.exec(line);
  if (numbered) {
    const title = numbered[2].trim();
    return {
      level: chapterLevel(numbered[1]),
      text: title ? `${numbered[1]} ${title}` : numbered[1],
    };
  }

  const special = CHAPTER_SPECIAL_RE.exec(line);
  if (special) {
    const title = special[2].trim();
    return { level: 1, text: title ? `${special[1]} ${title}` : special[1] };
  }

  const listed = CHAPTER_LISTED_RE.exec(line);
  if (listed) {
    const title = listed[2].trim();
    /* 「1、」后面什么都没有的行更像正文里的编号残片，不收进目录。 */
    if (!title) return null;
    return { level: 2, text: `${listed[1]}${title}` };
  }

  return null;
}

/** 是否纯文本章节标题行（复用与阅读目录同一套识别规则）。 */
export function isPureChapterTitle(line: string): boolean {
  return matchChapterLine(line) !== null;
}

/** 剥离标题里的行内 markdown 标记，只留可读文字。 */
function stripInline(raw: string): string {
  return raw
    .replace(/^#+\s*/, "")
    /* 尾部 ATX 闭合井号：`## 标题 ##` */
    .replace(/\s+#+\s*$/, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`+([^`]*)`+/g, "$1")
    /* 只吃成对/多字符强调标记，保留 snake_case 里的单下划线 */
    .replace(/\*{1,3}|_{2,3}|~~/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 供「预览区顺序匹配」使用的归一化文本比较键。 */
export function normalizeHeadingText(raw: string | null | undefined): string {
  return (raw || "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** 章节行的比较键：连空白一并去掉，「第一章　风起」与「第一章风起」视为同一行。 */
function compactKey(raw: string | null | undefined): string {
  return (raw || "").replace(/\s+/g, "").toLowerCase();
}

/** 字数：不计空白字符，与中文写作里「多少字」的直觉一致。 */
export function countChars(text: string): number {
  if (!text) return 0;
  return text.replace(/\s+/g, "").length;
}

/** 给目录项补上「本节字数」：从标题行之后一直数到下一个同类目录项。 */
function fillChars(source: string, items: OutlineItem[]): void {
  for (let i = 0; i < items.length; i++) {
    const start = Math.min(items[i].bodyOffset, source.length);
    const end = i + 1 < items.length ? items[i + 1].offset : source.length;
    items[i].chars = end > start ? countChars(source.slice(start, end)) : 0;
  }
}

/** 「1234」/「1.2万」——目录行里塞得下的紧凑字数写法。 */
export function formatChars(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 10000) return String(n);
  const wan = n / 10000;
  return `${wan < 10 ? wan.toFixed(1) : Math.round(wan)}万`;
}

/**
 * 从文档原文提取目录。
 *
 * 优先按 Markdown 标题解析（ATX `#` 与 Setext 下划线，跳过围栏代码块与
 * 顶部 YAML frontmatter）；整篇没有任何 Markdown 标题时，退回纯文本章节
 * 识别，这样带章节标题的 TXT 也能有目录。
 */
export function parseOutline(markdown: string): OutlineItem[] {
  const headings: OutlineItem[] = [];
  const chapters: OutlineItem[] = [];
  if (!markdown) return headings;

  const lines = markdown.split("\n");
  /* 每行行首的字符偏移，用于把标题映射回原文位置。 */
  const offsets: number[] = new Array(lines.length);
  let acc = 0;
  for (let i = 0; i < lines.length; i++) {
    offsets[i] = acc;
    acc += lines[i].length + 1;
  }
  const bodyStartOf = (lineIndex: number) =>
    Math.min(offsets[lineIndex] + lines[lineIndex].length + 1, markdown.length);

  let start = 0;
  /* 顶部 frontmatter：--- ... --- 整段跳过。 */
  if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
    for (let i = 1; i < lines.length; i++) {
      if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
        start = i + 1;
        break;
      }
    }
  }

  let fence: string | null = null;
  let seq = 0;

  for (let i = start; i < lines.length; i++) {
    const line = lines[i];

    const fenceHit = FENCE_RE.exec(line);
    if (fenceHit) {
      const marker = fenceHit[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;

    const atx = ATX_RE.exec(line);
    if (atx) {
      const text = stripInline(atx[2] || "");
      headings.push({
        id: `h-${i}-${seq++}`,
        level: atx[1].length,
        text: text || "（空标题）",
        line: i,
        offset: offsets[i],
        bodyOffset: bodyStartOf(i),
        chars: 0,
        kind: "heading",
      });
      continue;
    }

    /* Setext：本行是下划线，上一行是普通正文。 */
    const setext = SETEXT_RE.exec(line);
    if (setext && i > start) {
      const prev = lines[i - 1];
      if (prev && prev.trim() && !NOT_SETEXT_TEXT_RE.test(prev) && !ATX_RE.test(prev)) {
        const text = stripInline(prev);
        if (text) {
          headings.push({
            id: `h-${i - 1}-${seq++}`,
            level: setext[1][0] === "=" ? 1 : 2,
            text,
            line: i - 1,
            offset: offsets[i - 1],
            /* 正文从下划线那一行之后开始。 */
            bodyOffset: bodyStartOf(i),
            chars: 0,
            kind: "heading",
          });
          continue;
        }
      }
    }

    /* 纯文本章节行：先攒着，整篇没有 Markdown 标题时才启用。 */
    const chapter = matchChapterLine(line);
    if (chapter) {
      chapters.push({
        id: `c-${i}-${chapters.length}`,
        level: chapter.level,
        text: chapter.text,
        line: i,
        offset: offsets[i],
        bodyOffset: bodyStartOf(i),
        chars: 0,
        kind: "chapter",
      });
    }
  }

  const items = headings.length > 0 ? headings : chapters;
  fillChars(markdown, items);
  return items;
}

/**
 * 需要从真实文本域复制到镜像 div 的属性。
 *
 * 必须写 kebab-case：`CSSStyleDeclaration.getPropertyValue()` 按规范只接受
 * CSS 属性名，传 camelCase（"fontSize"）一律返回空串——曾经就是这样，导致镜像
 * 拿不到字体与字号，用浏览器默认字体去量一篇 TXT，换行点逐行错开、误差一路
 * 累积，目录跳转能差出几十屏。
 *
 * 除字体度量外，`white-space` / `word-break` / `overflow-wrap` / `text-*` 一并
 * 复制：任何影响「同一段文字在多宽的容器里折成几行」的属性都必须一致。
 */
const MIRROR_COPY_PROPS = [
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variant",
  "font-stretch",
  "letter-spacing",
  "word-spacing",
  "text-indent",
  "text-transform",
  "text-rendering",
  "tab-size",
  "white-space",
  "word-break",
  "overflow-wrap",
  "word-wrap",
  "line-break",
  "hyphens",
  "direction",
  "writing-mode",
];

/** 把影响换行与行高的样式整套搬到镜像元素上。 */
function applyMirrorStyle(mirror: HTMLElement, styles: CSSStyleDeclaration, el: HTMLElement): void {
  for (const prop of MIRROR_COPY_PROPS) {
    const value = styles.getPropertyValue(prop);
    if (value) mirror.style.setProperty(prop, value);
  }

  /* line-height 计算值通常已是 px；仅 "normal" 需要自己折算。 */
  const fontSize = parseFloat(styles.fontSize) || 16;
  mirror.style.lineHeight =
    styles.lineHeight === "normal" ? `${fontSize * 1.6}px` : styles.lineHeight;

  /* textarea 默认 pre-wrap；若上面没取到（老浏览器返回空），兜一个默认值。 */
  if (!mirror.style.whiteSpace) mirror.style.whiteSpace = "pre-wrap";

  /* clientWidth 已不含竖向滚动条，直接作为 border-box 宽度即可与真实文本区逐行等宽；
     再扣一次滚动条宽会让换行点逐行漂移，长文定位就会整体偏上。 */
  mirror.style.width = `${Math.max(100, el.clientWidth)}px`;
  mirror.style.padding = `${styles.paddingTop} ${styles.paddingRight} ${styles.paddingBottom} ${styles.paddingLeft}`;
  mirror.style.boxSizing = "border-box";
  mirror.style.border = "0 solid transparent";
  mirror.style.position = "absolute";
  mirror.style.top = "0";
  mirror.style.left = "0";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.overflow = "hidden";
  mirror.setAttribute("aria-hidden", "true");
}

/**
 * 用「镜像 div」一次性量出 textarea 中多个字符偏移各自所在行的顶部像素位置
 * （相对内容原点，未计入 scrollTop）。所有偏移共用一次布局，避免逐个测量的抖动。
 */
export function measureTextareaTops(el: HTMLTextAreaElement, offsets: number[]): number[] {
  const out = new Array<number>(offsets.length).fill(0);
  if (!offsets.length) return out;

  const styles = window.getComputedStyle(el);
  const mirror = document.createElement("div");
  applyMirrorStyle(mirror, styles, el);

  const text = el.value;
  const sorted = offsets
    .map((offset, index) => ({
      offset: Math.max(0, Math.min(offset, text.length)),
      index,
    }))
    .sort((a, b) => a.offset - b.offset);

  const marks: HTMLSpanElement[] = [];
  let cursor = 0;
  for (const item of sorted) {
    if (item.offset > cursor) {
      mirror.appendChild(document.createTextNode(text.slice(cursor, item.offset)));
      cursor = item.offset;
    }
    const mark = document.createElement("span");
    /* 零宽占位符：offsetTop 即为该插入点所在行的顶部。 */
    mark.textContent = "\u200b";
    mirror.appendChild(mark);
    marks.push(mark);
  }
  mirror.appendChild(document.createTextNode(`${text.slice(cursor)}\u200b`));

  document.body.appendChild(mirror);
  /* 绝对定位的 mirror 就是子节点的 offsetParent，offsetTop 已含与 textarea 一致的 padding-top。 */
  for (let k = 0; k < sorted.length; k++) out[sorted[k].index] = marks[k].offsetTop;

  /* ---- 标定 ----
     镜像再怎么抄样式，也可能因为字体回退、缩放、平台字距等残留一点差异；
     长文里这点差异会被行数放大成很大的位移。这里用「整篇总高度」做一次校准：
     镜像量出的总高应当等于文本域的可滚动总高，不等就按比例把各行位置缩放回去。

     只在真的溢出时才校准：没溢出时 scrollHeight 等于盒高而不是内容高，
     拿它当分子会把比例算大，反而把短文档的位置推飞。 */
  const padTop = parseFloat(styles.paddingTop) || 0;
  const padBottom = parseFloat(styles.paddingBottom) || 0;
  const overflowing = el.scrollHeight - el.clientHeight > 1;
  const mirrorBody = mirror.offsetHeight - padTop - padBottom;
  const realBody = el.scrollHeight - padTop - padBottom;
  document.body.removeChild(mirror);

  if (overflowing && mirrorBody > 1 && realBody > 1) {
    const ratio = realBody / mirrorBody;
    /* 0.5% 以内视作测量噪声；超过 2 倍的偏差不像是字体差异，更像量错了，
       这种情况下宁可原样返回，也不要拿一个离谱的系数去缩放。 */
    if (Math.abs(ratio - 1) > 0.005 && ratio > 0.5 && ratio < 2) {
      for (let i = 0; i < out.length; i++) {
        out[i] = padTop + (out[i] - padTop) * ratio;
      }
    }
  }

  return out;
}

/** 收集容器里所有非空文本节点，保持文档顺序。 */
function collectTextNodes(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    const text = node as Text;
    if (text.data.trim()) nodes.push(text);
    node = walker.nextNode();
  }
  return nodes;
}

/** 文本节点首行的顶部像素位置（相对预览容器内容原点）。 */
function textNodeTop(node: Text, base: number): number | null {
  const range = document.createRange();
  range.selectNodeContents(node);
  /* 用首个行盒而非整体包围盒：章节标题和后面的正文可能同处一个 <p>。 */
  const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
  if (!rect || (rect.top === 0 && rect.height === 0)) return null;
  return rect.top - base;
}

/**
 * 量出目录各项在预览区内容坐标系中的顶部像素位置。
 *
 * - Markdown 标题：按「层级 + 文本」顺序匹配已渲染的 h1~h6；
 * - 纯文本章节：按顺序在文本节点里找标题那一行（章节行渲染成 `<p>` 或
 *   `<p>` 里被 `<br>` 分开的一段，都能定位到）。
 * 匹配失败的项沿用上一项的位置，保证返回值单调不降，
 * 「当前章节」的判定（activeHeadingIndex）才不会跳回文首。
 */
export function measurePreviewTops(el: HTMLElement, items: OutlineItem[]): number[] {
  const out = new Array<number>(items.length).fill(0);
  if (!items.length) return out;

  /* getBoundingClientRect 换算：容器内容原点 = 容器视口顶 - 当前 scrollTop。 */
  const base = el.getBoundingClientRect().top - el.scrollTop;
  const headings = Array.from(el.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6"));
  const needsText = items.some((item) => item.kind === "chapter");
  const textNodes = needsText ? collectTextNodes(el) : [];

  let headingCursor = 0;
  let textCursor = 0;
  let last = 0;

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const key = normalizeHeadingText(item.text);
    let top: number | null = null;

    if (item.kind === "heading") {
      for (let k = headingCursor; k < headings.length; k++) {
        const node = headings[k];
        if (
          Number(node.tagName.slice(1)) === item.level &&
          normalizeHeadingText(node.textContent) === key
        ) {
          top = node.getBoundingClientRect().top - base;
          headingCursor = k + 1;
          break;
        }
      }
      /* 兜底：引用块里的标题、行内标记差异导致文本对不上时，按序号取同序号节点。 */
      if (top === null && headings[i]) {
        top = headings[i].getBoundingClientRect().top - base;
      }
    } else {
      const compact = compactKey(item.text);
      for (let k = textCursor; k < textNodes.length; k++) {
        const nodeKey = compactKey(textNodes[k].data);
        if (nodeKey === compact || nodeKey.startsWith(compact)) {
          top = textNodeTop(textNodes[k], base);
          textCursor = k + 1;
          break;
        }
      }
    }

    out[i] = top === null ? last : Math.max(0, top);
    last = out[i];
  }

  return out;
}

/** 找出「顶部之上最后一个」标题的下标，作为当前阅读所在章节。 */
export function activeHeadingIndex(tops: number[], scrollTop: number, atBottom: boolean): number {
  if (!tops.length) return -1;
  if (atBottom) return tops.length - 1;
  const probe = scrollTop + 24;
  let index = -1;
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= probe) index = i;
    else break;
  }
  return index < 0 ? 0 : index;
}
