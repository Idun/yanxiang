<script lang="ts">
/**
 * Markdown 所见即所得（WYSIWYG）核心机制
 *
 * 核心架构与设计规范：
 * 1. 原地编辑与语法折叠/暴露 (In-Place Live Preview & Focus-Reveal)：
 *    - 纯单画布富文本表面（contenteditable="true"），彻底摒弃编辑区与渲染区来回割裂切换的模式。
 *    - 所有排版元素（标题、粗体、斜体、引用、列表、行内代码、分割线）均在原地以高保真样式呈现。
 *    - 语法暴露：当鼠标光标点击移入任意块级或行内元素时，该元素原地激活（.is-focused），
 *      对应的 Markdown 语法标记（如 # 、**、*、> 、- 、`）立即在当前位置原位暴露显示，供作者直接精确编辑语法；
 *    - 离焦渲染：当光标移开到其他位置时，语法标记原地折叠隐藏，即刻恢复为纯净的视觉排版。
 *
 * 2. 块级段落上下自由拖拽对换机制 (Block Drag & Reorder)：
 *    - 每个顶级块元素（.md-block）在鼠标悬停时，左侧留白处浮现块拖拽手柄（GripVertical）；
 *    - 拖动时触发全局块拖拽状态（docBlockDrag），鼠标实时跟随半透明预览贴片，并在目标缝隙显示高亮插入指示线；
 *    - 松开鼠标后立即在 DOM 中对换段落顺序，并毫秒级重组序列化为 Markdown 源码。
 *
 * 3. “内容上色”（抓阄配色）原生兼容：
 *    - 原地挂载 --zj-* 配色变量并应用 .content-colored；
 *    - 在编译 Live HTML 时，文字内容叠加 applyContentColoring，确保引号、括号、标点、字母、数字等高保真着色；
 *    - 序列化回 Markdown 时，zj-* 颜色 span 被视为透明容器完全透传，输出 100% 纯净 Markdown 标记。
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 解析行内 Markdown 并植入语法折叠/暴露标记 */
function parseInlineWithSyntax(text: string): string {
  let res = escapeHtml(text);

  // 1. 行内代码 `code`
  res = res.replace(/`([^`\n]+?)`/g, (_m, code) => {
    return `<code class="md-inline md-code"><span class="md-syntax">\`</span><span class="md-text">${code}</span><span class="md-syntax">\`</span></code>`;
  });

  // 2. 粗体 **text** 或 __text__
  res = res.replace(/(\*\*|__)([^\n*]+?)\1/g, (_m, delim, inner) => {
    return `<strong class="md-inline md-bold"><span class="md-syntax">${delim}</span><span class="md-text">${inner}</span><span class="md-syntax">${delim}</span></strong>`;
  });

  // 3. 斜体 *text* 或 _text_
  res = res.replace(/(?<![*_])([*_])([^\s*_][^*\n_]*?)\1(?![*_])/g, (_m, delim, inner) => {
    return `<em class="md-inline md-italic"><span class="md-syntax">${delim}</span><span class="md-text">${inner}</span><span class="md-syntax">${delim}</span></em>`;
  });

  // 4. 删除线 ~~text~~
  res = res.replace(/~~([^\n~]+?)~~/g, (_m, inner) => {
    return `<del class="md-inline md-del"><span class="md-syntax">~~</span><span class="md-text">${inner}</span><span class="md-syntax">~~</span></del>`;
  });

  // 5. 超链接 [text](url)
  res = res.replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, (_m, linkText, url) => {
    return `<a class="md-inline md-link" href="${url}"><span class="md-syntax">[</span><span class="md-text">${linkText}</span><span class="md-syntax">](${url})</span></a>`;
  });

  return res;
}

/** 将 Markdown 源码编译为支持“原地编辑与语法暴露”的 Live HTML */
export function markdownToLiveHtml(md: string): string {
  if (!md || !md.trim()) {
    return `<p class="md-block md-p md-empty" data-block-type="p"><br></p>`;
  }

  const lines = md.split(/\r\n|\r|\n/);
  const blockHtmls: string[] = [];
  let inCodeFence = false;
  let codeFenceLang = "";
  let codeFenceLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // 代码围栏
    const fenceMatch = /^[ \t]{0,3}(```+|~~~+)(.*)/.exec(line);
    if (fenceMatch) {
      if (!inCodeFence) {
        inCodeFence = true;
        codeFenceLang = fenceMatch[2].trim();
        codeFenceLines = [];
      } else {
        inCodeFence = false;
        const codeContent = escapeHtml(codeFenceLines.join("\n"));
        blockHtmls.push(
          `<pre class="md-block md-code-block" data-block-type="code" data-lang="${codeFenceLang}"><div class="md-syntax code-fence-top">\`\`\`${codeFenceLang}</div><code>${codeContent}</code><div class="md-syntax code-fence-bottom">\`\`\`</div></pre>`,
        );
        codeFenceLines = [];
      }
      continue;
    }

    if (inCodeFence) {
      codeFenceLines.push(line);
      continue;
    }

    // 空行：真实占一行的空块，与 markdown 编辑区里的空白行一致（行高可落光标）
    if (line.trim() === "") {
      blockHtmls.push(`<p class="md-block md-p md-empty" data-block-type="p"><br></p>`);
      continue;
    }

    // 标题 H1 - H6
    const headingMatch = /^(#{1,6})\s+(.*)/.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1];
      const level = hashes.length;
      const content = parseInlineWithSyntax(headingMatch[2]);
      blockHtmls.push(
        `<h${level} class="md-block md-h${level}" data-block-type="h${level}"><span class="md-syntax">${hashes} </span><span class="md-content">${content}</span></h${level}>`,
      );
      continue;
    }

    // 引用块
    const quoteMatch = /^>\s?(.*)/.exec(line);
    if (quoteMatch) {
      const content = parseInlineWithSyntax(quoteMatch[1]);
      blockHtmls.push(
        `<blockquote class="md-block md-quote" data-block-type="quote"><span class="md-syntax">&gt; </span><span class="md-content">${content}</span></blockquote>`,
      );
      continue;
    }

    // 无序列表项 (- 或 *)
    const ulMatch = /^([ \t]*)([-*+])\s+(.*)/.exec(line);
    if (ulMatch) {
      const bullet = ulMatch[2];
      const content = parseInlineWithSyntax(ulMatch[3]);
      blockHtmls.push(
        `<div class="md-block md-list-item md-ul" data-block-type="ul" data-bullet="${bullet}"><span class="md-bullet">•</span><span class="md-syntax">${bullet} </span><span class="md-content">${content}</span></div>`,
      );
      continue;
    }

    // 有序列表项 (1. )
    const olMatch = /^([ \t]*)(\d+)\.\s+(.*)/.exec(line);
    if (olMatch) {
      const num = olMatch[2];
      const content = parseInlineWithSyntax(olMatch[3]);
      blockHtmls.push(
        `<div class="md-block md-list-item md-ol" data-block-type="ol" data-num="${num}"><span class="md-number">${num}.</span><span class="md-syntax">${num}. </span><span class="md-content">${content}</span></div>`,
      );
      continue;
    }

    // 分割线
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      blockHtmls.push(
        `<div class="md-block md-hr" data-block-type="hr"><span class="md-syntax">---</span><hr></div>`,
      );
      continue;
    }

    // 普通行：一行即一段（与 markdown 编辑区里每个物理行为一个可拖拽块对齐）
    const inline = parseInlineWithSyntax(line);
    blockHtmls.push(
      `<p class="md-block md-p" data-block-type="p"><span class="md-content">${inline}</span></p>`,
    );
  }

  if (inCodeFence) {
    const codeContent = escapeHtml(codeFenceLines.join("\n"));
    blockHtmls.push(
      `<pre class="md-block md-code-block" data-block-type="code" data-lang="${codeFenceLang}"><div class="md-syntax code-fence-top">\`\`\`${codeFenceLang}</div><code>${codeContent}</code><div class="md-syntax code-fence-bottom">\`\`\`</div></pre>`,
    );
  }

  if (blockHtmls.length === 0) {
    blockHtmls.push(`<p class="md-block md-p md-empty" data-block-type="p"><br></p>`);
  }

  return blockHtmls.join("");
}

/** 递归序列化单个行内节点为 Markdown 文本 */
function serializeInlineNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || "";
  }
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return "";
  }
  const el = node as HTMLElement;

  // 忽略装饰性的项目符号圆点与列表序号
  if (el.classList.contains("md-bullet") || el.classList.contains("md-number")) {
    return "";
  }

  // 忽略块级容器直接子级的 md-syntax（块序列化器会统一补齐前缀）
  if (el.parentElement?.classList.contains("md-block") && el.classList.contains("md-syntax")) {
    return "";
  }

  // 行内元素内部自带的 md-syntax 标签忽略，由外层结构统一包覆 Markdown 标记
  if (el.classList.contains("md-syntax")) {
    return "";
  }

  // 段落内保留的软换行 <br>：还原为源码换行符，保证原文逐行排版不被压平
  if (el.tagName.toLowerCase() === "br") {
    return "\n";
  }

  // 粗体
  if (el.classList.contains("md-bold") || el.tagName.toLowerCase() === "strong" || el.tagName.toLowerCase() === "b") {
    const inner = serializeInlineChildren(el).trim();
    return inner ? `**${inner}**` : "";
  }

  // 斜体
  if (el.classList.contains("md-italic") || el.tagName.toLowerCase() === "em" || el.tagName.toLowerCase() === "i") {
    const inner = serializeInlineChildren(el).trim();
    return inner ? `*${inner}*` : "";
  }

  // 删除线
  if (el.classList.contains("md-del") || el.tagName.toLowerCase() === "del" || el.tagName.toLowerCase() === "s") {
    const inner = serializeInlineChildren(el).trim();
    return inner ? `~~${inner}~~` : "";
  }

  // 行内代码
  if (el.classList.contains("md-code") || el.tagName.toLowerCase() === "code") {
    const inner = el.querySelector(".md-text")?.textContent || el.textContent || "";
    return inner ? `\`${inner}\`` : "";
  }

  // 超链接
  if (el.classList.contains("md-link") || el.tagName.toLowerCase() === "a") {
    const inner = el.querySelector(".md-text") ? serializeInlineChildren(el.querySelector(".md-text")!) : serializeInlineChildren(el);
    const href = el.getAttribute("href") || "";
    return `[${inner}](${href})`;
  }

  // 图片
  if (el.classList.contains("md-img") || el.tagName.toLowerCase() === "img") {
    const img = el.tagName.toLowerCase() === "img" ? el : el.querySelector("img");
    const src = img?.getAttribute("src") || "";
    const alt = img?.getAttribute("alt") || "";
    return `![${alt}](${src})`;
  }

  // 内容上色 zj-* span 或普通 span：透明递归提取文字
  return serializeInlineChildren(el);
}

function serializeInlineChildren(parent: HTMLElement): string {
  let out = "";
  for (const child of Array.from(parent.childNodes)) {
    out += serializeInlineNode(child);
  }
  return out;
}

/** 序列化单个块级元素 */
export function serializeLiveBlock(block: HTMLElement): string {
  const type = block.getAttribute("data-block-type") || "";

  if (type === "empty" || block.classList.contains("md-empty")) {
    /* 空行块在 markdown 源码里是 0 字符；但粘贴 / 拖入等途径可能把真实文本
       塞进这种块里，此时必须按普通段落还原，不能整块丢弃（否则切文档内容消失）。 */
    const contentEl = (block.querySelector(".md-content") || block) as HTMLElement;
    return serializeInlineChildren(contentEl).trim();
  }

  if (type === "hr" || block.classList.contains("md-hr")) {
    return "---";
  }

  if (type === "code" || block.classList.contains("md-code-block")) {
    const lang = block.getAttribute("data-lang") || "";
    const code = block.querySelector("code")?.textContent || "";
    return `\`\`\`${lang}\n${code.replace(/\n$/, "")}\n\`\`\``;
  }

  if (/^h[1-6]$/.test(type)) {
    const level = parseInt(type[1], 10);
    const contentEl = (block.querySelector(".md-content") || block) as HTMLElement;
    const inner = serializeInlineChildren(contentEl).trim();
    return `${"#".repeat(level)} ${inner}`;
  }

  if (type === "quote" || block.classList.contains("md-quote")) {
    const contentEl = (block.querySelector(".md-content") || block) as HTMLElement;
    const inner = serializeInlineChildren(contentEl).trim();
    return inner
      .split("\n")
      .map((l) => (l.startsWith(">") ? l : `> ${l}`))
      .join("\n");
  }

  if (type === "ul" || block.classList.contains("md-ul")) {
    const bullet = block.getAttribute("data-bullet") || "-";
    const contentEl = (block.querySelector(".md-content") || block) as HTMLElement;
    const inner = serializeInlineChildren(contentEl).trim();
    return `${bullet} ${inner}`;
  }

  if (type === "ol" || block.classList.contains("md-ol")) {
    const num = block.getAttribute("data-num") || "1";
    const contentEl = (block.querySelector(".md-content") || block) as HTMLElement;
    const inner = serializeInlineChildren(contentEl).trim();
    return `${num}. ${inner}`;
  }

  // 普通段落
  const contentEl = (block.querySelector(".md-content") || block) as HTMLElement;
  return serializeInlineChildren(contentEl).trim();
}

/** 将原地编辑的 DOM 树反编译为纯净无瑕的 Markdown 文本 */
export function liveHtmlToMarkdown(root: HTMLElement): string {
  const blocks = root.querySelectorAll(":scope > .md-block");
  if (blocks.length === 0) {
    return root.textContent || "";
  }

  const parts: string[] = [];
  blocks.forEach((block) => {
    parts.push(serializeLiveBlock(block as HTMLElement));
  });

  // 每个块对应一个物理行（空块序列化为空串，还原出空行），
  // 因此以单个 \n 连接可做到与原文逐行无损往返；连续空块自然还原连续空行。
  return parts.join("\n").trimEnd();
}

/** 取一个节点「所见即所得当前状态」的 Markdown 文本（含语法字符，跳过装饰符号）。 */
export function liveNodeRawText(node: Node): string {
  let out = "";
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      out += n.textContent || "";
      return;
    }
    /* DocumentFragment（Range.cloneContents 的产物）：rawOffsetAt 正是靠它
       取“块首到光标处”的部分文本，必须继续下钻子节点，否则偏移恒为 0，
       重渲染后光标永远被放回段落开头。 */
    if (n.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
      for (const c of Array.from(n.childNodes)) walk(c);
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (el.classList.contains("md-bullet") || el.classList.contains("md-number")) return;
    /* 空行块在 markdown 源码里是 0 字符（""），它的 <br> 只是为了占住一行、
       让光标能落脚。若把 <br> 也算 1 个字符，块偏移空间与 markdown 偏移空间
       就会在每个空行处差出 1，查找命中 / 选区映射 / 光标还原全部随之错位。
       但粘贴 / 拖入等途径可能把真实文本塞进这种块里，此时必须照常收集，
       否则序列化会把整块当成空行丢掉、内容静默消失。 */
    if (el.classList.contains("md-empty")) {
      for (const c of Array.from(el.childNodes)) {
        if (c.nodeType === Node.ELEMENT_NODE && (c as HTMLElement).tagName.toLowerCase() === "br") continue;
        walk(c);
      }
      return;
    }
    if (el.tagName.toLowerCase() === "br") {
      out += "\n";
      return;
    }
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  walk(node);
  return out;
}

/**
 * 结构签名：比较「当前块」与「规范重解析结果」是否同构。
 * 文本节点直接取文本（相邻文本自然拼接，容忍浏览器拆分文本节点）；
 * 配色 span（zj-*）与 md-content/md-text/md-inline 视为透明包装，只透传内容；
 * md-syntax / 加粗斜体等结构必须原样入签名，才能精确暴露「标记被删」。
 */
export function structKey(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  if (el.classList.contains("md-bullet") || el.classList.contains("md-number")) return "";
  if (tag === "br") return "\n";
  const cl = Array.from(el.classList).filter((c) => !c.startsWith("zj-"));
  const transparent =
    cl.length === 0 || cl.every((c) => c === "md-content" || c === "md-text" || c === "md-inline");
  let inner = "";
  for (const c of Array.from(el.childNodes)) inner += structKey(c);
  if (transparent) return inner;
  return `<${tag}.${cl.join(",")}>${inner}</${tag}>`;
}

/** 收集一个节点内按「当前可见文本」顺序排列的文字块（文本节点与 <br>）。 */
export function collectRawChunks(root: Node): { node: Node; len: number }[] {
  const chunks: { node: Node; len: number }[] = [];
  const walk = (n: Node): void => {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n.textContent || "";
      if (t.length > 0) chunks.push({ node: n, len: t.length });
      return;
    }
    if (n.nodeType !== Node.ELEMENT_NODE) return;
    const el = n as HTMLElement;
    if (el.classList.contains("md-bullet") || el.classList.contains("md-number")) return;
    if (el.tagName.toLowerCase() === "br") {
      chunks.push({ node: el, len: 1 });
      return;
    }
    for (const c of Array.from(el.childNodes)) walk(c);
  };
  walk(root);
  return chunks;
}

/** 按「当前可见文本」偏移把光标放回某个块内（遍历文本 / <br> 累积长度）。 */
export function placeCaretByRawOffset(root: HTMLElement, offset: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const chunks = collectRawChunks(root);
  let remaining = Math.max(0, offset);
  for (const ch of chunks) {
    if (remaining <= ch.len) {
      const r = document.createRange();
      r.setStart(ch.node, remaining);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
      return;
    }
    remaining -= ch.len;
  }
  const r = document.createRange();
  r.selectNodeContents(root);
  r.collapse(false);
  sel.removeAllRanges();
  sel.addRange(r);
}

/** 某个容器「当前可见文本」里从块首到该 (node,offset) 的偏移；容器外节点取全块长。 */
export function rawOffsetAt(block: HTMLElement, container: Node | null, offset: number): number {
  if (!container) return 0;
  if (!block.contains(container)) return liveNodeRawText(block).length;
  /* 空行块对齐 markdown 的 0 字符：只有占位 <br>、没有真实文本时，块内任何位置
     都映射为偏移 0（liveNodeRawText 已对 md-empty 跳过占位 <br>，但 cloneContents
     得到的 DocumentFragment 不含 md-empty 元素本身，必须在这里显式归零）。
     一旦空行块被浏览器塞进了真实文本（键入 / 粘贴 / 拖入），必须按真实位置算偏移，
     否则成对标点补全在空行处会拿到错误的 caret 而失效。 */
  if (block.classList.contains("md-empty") && !liveNodeRawText(block)) return 0;
  const before = document.createRange();
  before.selectNodeContents(block);
  try {
    before.setEnd(container, offset);
  } catch {
    return liveNodeRawText(block).length;
  }
  return liveNodeRawText(before.cloneContents()).length;
}

/** 光标在块内「当前可见文本」中的偏移（供重渲染后还原光标）。 */
export function caretRawOffsetIn(block: HTMLElement): number {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return 0;
  const range = sel.getRangeAt(0);
  return rawOffsetAt(block, range.startContainer, range.startOffset);
}

/** 选中某个块内在「当前可见文本」偏移 [start, end] 的范围（夹取到块内）。 */
export function selectRawRange(root: HTMLElement, start: number, end: number) {
  const sel = window.getSelection();
  if (!sel) return;
  const chunks = collectRawChunks(root);
  const locate = (offset: number): { node: Node | null; inner: number } => {
    let remaining = Math.max(0, offset);
    for (const ch of chunks) {
      if (remaining <= ch.len) return { node: ch.node, inner: remaining };
      remaining -= ch.len;
    }
    return { node: null, inner: 0 };
  };
  const a = locate(start);
  const b = locate(Math.max(start, end));
  const range = document.createRange();
  if (a.node) range.setStart(a.node, a.inner);
  else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  if (b.node) range.setEnd(b.node, Math.min(b.inner, b.node instanceof Text ? (b.node.textContent?.length ?? 0) : 1));
  else {
    range.selectNodeContents(root);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { GripVertical, Palette, X } from "lucide-vue-next";
import {
  applyContentColoring,
  contentColorCssVars,
  contentColoringOn,
} from "../contentColoring";
import {
  computeDeletePairCorrection,
  computeInsertPairCorrection,
  isSymmetricPair,
  pairCloseFor,
  type PairEditResult,
} from "../autoPairPunctuation";
import { aiSettings } from "../settings";
import { documentFilesStore } from "../documentFilesStore";
import ReadingProgressRing from "./ReadingProgressRing.vue";
import { RING_SIZE_MAX } from "../readingRingStore";
import { showToast } from "../insightStore";
import {
  docBlockDrag,
  startBlockDrag,
  endBlockDrag,
  type DocBlockPayload,
} from "../docEditorDrop";

const props = withDefaults(
  defineProps<{
    modelValue: string;
    fontSize?: number;
    fontFamily?: string;
    lineHeight?: number;
    marginX?: number;
    marginY?: number;
    fileId?: string | null;
    ringSlot?: string;
    zenMode?: "markdown" | "preview" | "off";
    spotlightEnabled?: boolean;
    singleEditor?: boolean;
    embedded?: boolean;
    /** 查找高亮状态（由上层传入）：查找框开着且有词时，在编辑区内逐处包裹命中。 */
    findHighlight?: { open: boolean; text: string; caseSensitive: boolean; index: number } | null;
  }>(),
  {
    fontSize: 16,
    fontFamily: "var(--app-font)",
    lineHeight: 1.75,
    marginX: 32,
    marginY: 24,
    fileId: "",
    ringSlot: "",
    zenMode: "off",
    spotlightEnabled: false,
    singleEditor: false,
    embedded: false,
    findHighlight: null,
  },
);

const emit = defineEmits<{
  (e: "update:modelValue", value: string): void;
  (e: "toggleZen", mode: "markdown" | "preview" | "off"): void;
  (e: "toggleSpotlight", active: boolean): void;
  (e: "undo"): void;
  (e: "redo"): void;
  (e: "selectionchange"): void;
  (e: "find"): void;
  /** 编辑区内右键：把视口坐标交给上层（与 markdown 编辑区同一套右键菜单）。 */
  (e: "contextmenu", payload: { x: number; y: number }): void;
  /** 编辑区滚动（scroll 事件不冒泡，由组件主动转发，供上层跟随重定位选中工具栏）。 */
  (e: "scroll"): void;
}>();

const editorRef = ref<HTMLDivElement | null>(null);
const scrollRef = ref<HTMLDivElement | null>(null);
const paperRef = ref<HTMLDivElement | null>(null);

let isInternalEdit = false;

/** 当前被聚焦的块元素与行内元素（用于就地暴露语法） */
let currentFocusedBlock: HTMLElement | null = null;
let currentFocusedInline: HTMLElement | null = null;

/** 光标所在块当前挂着的行级标记（供上层工具栏菜单打勾，见 focusedLineStyle 更新）。 */
const focusedLineStyle = ref<string | null>(null);

/** 段落聚光灯：当前被高亮的块（其余压暗） */
const spotlightTargetEl = ref<HTMLElement | null>(null);

function setSpotlightTarget(el: HTMLElement | null) {
  if (spotlightTargetEl.value === el) return;
  if (spotlightTargetEl.value) spotlightTargetEl.value.classList.remove("spotlight-target");
  spotlightTargetEl.value = el;
  if (el) el.classList.add("spotlight-target");
}

/** 鼠标悬浮的段落块（供左侧浮现拖拽手柄） */
const hoveredBlockEl = ref<HTMLElement | null>(null);
const handleTopPx = ref(0);
const handleHeightPx = ref(20);
/**
 * 手柄消隐宽限计时器。
 *
 * 手柄悬浮在正文左侧留白（纸面 padding 区）里，鼠标从段落挪向手柄的途中必然
 * 要「离开段落」一瞬 —— 若此时立即把 hoveredBlockEl 清空，手柄会在用户还没
 * 点到它之前就消失。这里给一段宽限期，鼠标进入手柄本身即撤销消隐。
 */
let hoverClearTimer: number | null = null;

function cancelHoverClear() {
  if (hoverClearTimer !== null) {
    window.clearTimeout(hoverClearTimer);
    hoverClearTimer = null;
  }
}

function scheduleHoverClear() {
  cancelHoverClear();
  hoverClearTimer = window.setTimeout(() => {
    hoverClearTimer = null;
    if (!docBlockDrag.isDragging) {
      hoveredBlockEl.value = null;
    }
  }, 700);
}

/** 拖拽目标指示线位置 */
const draggedBlockEl = ref<HTMLElement | null>(null);
const targetDropIndex = ref(-1);
const targetInsertionTopPx = ref(0);

const scrollProgress = ref(0);

const currentDocTitle = computed(() => {
  return documentFilesStore.files.find((f) => f.id === props.fileId)?.title || "未命名文档";
});

/** 渲染带内容上色的 Live HTML */
function compileLiveHtml(md: string): string {
  let html = markdownToLiveHtml(md);
  if (contentColoringOn.value) {
    html = applyContentColoring(html);
  }
  return html;
}

/**
 * 实时同步鼠标光标焦点状态：
 * 当光标落入某个段落或行内加粗/代码时，给对应节点添加 .is-focused，
 * 触发 CSS 立即原地暴露底层 Markdown 语法；移出时自动移除并还原渲染。
 */
function updateFocusState() {
  saveSelectionIfInside();
  const sel = window.getSelection();
  const editor = editorRef.value;
  if (!editor) {
    clearFocusState();
    return;
  }
  /* 无论选区落在哪里（含塌缩 / 移出编辑区）都通知上层：上层据此收起或
     浮现「选中文字工具栏」。只要调用方在意的选区状态真的变了才值得发 ——
     但 selectionchange 事件本身只在选区变化时派发，这里照单全收即可。 */
  emit("selectionchange");
  if (!sel || !sel.anchorNode || !editor.contains(sel.anchorNode)) {
    clearFocusState();
    return;
  }

  /* 选区确实落在这个编辑区内：上层（DocumentViewer）在同一事件里刷新撤销
     历史栈顶快照的光标位置（textarea 的 @click/@select/@keyup 走同一套
     syncTopSelection）。 */

  let node: Node | null = sel.anchorNode;
  let blockEl: HTMLElement | null = null;
  let inlineEl: HTMLElement | null = null;

  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains("md-inline") && !inlineEl) {
        inlineEl = el;
      }
      if (el.classList.contains("md-block") && !blockEl) {
        blockEl = el;
      }
    }
    node = node.parentNode;
  }

  if (currentFocusedBlock !== blockEl) {
    if (currentFocusedBlock) currentFocusedBlock.classList.remove("is-focused");
    if (blockEl) blockEl.classList.add("is-focused");
    currentFocusedBlock = blockEl;
  }

  if (currentFocusedInline !== inlineEl) {
    if (currentFocusedInline) currentFocusedInline.classList.remove("is-focused");
    if (inlineEl) inlineEl.classList.add("is-focused");
    currentFocusedInline = inlineEl;
  }

  focusedLineStyle.value = blockEl ? lineStyleOfRaw(liveNodeRawText(blockEl)) : null;
}

function clearFocusState() {
  if (currentFocusedBlock) {
    currentFocusedBlock.classList.remove("is-focused");
    currentFocusedBlock = null;
  }
  if (currentFocusedInline) {
    currentFocusedInline.classList.remove("is-focused");
    currentFocusedInline = null;
  }
}

/** 从原地编辑 DOM 提取 Markdown 并同步到外部模型 */
function syncDomToModel() {
  const el = editorRef.value;
  if (!el) return;
  const md = liveHtmlToMarkdown(el);
  if (md !== props.modelValue) {
    isInternalEdit = true;
    emit("update:modelValue", md);
  }
}

/* ---------------- 语法删除修复 + 内容上色即时刷新 ----------------
 *
 * 序列化器是按「块/行内类型 + class」重建 Markdown 标记的：`# 标题` 里删掉
 * `# ` 后 DOM 仍是 <h2>，序列化照样补回 `#` —— 「删了语法却仍被渲染成
 * markdown」的根源。每次输入后取「当前块」判断两件事：
 *
 *   1. 结构一致性：liveNodeRawText（当前可见字符，含残留语法）与
 *      serializeLiveBlock（按类型重建的标记）是否吻合。不吻合说明用户动过
 *      语法标记（删了 `# ` / `**` 等）→ 以当前可见内容重新解析成规范块。
 *   2. 内容上色：开启内容上色时，新输入的文字还没有 zj-* 配色 → 用
 *      compileLiveHtml 重渲染当前块，让配色即时跟上（无需切视图）。
 *
 * 若结构一致且未开启上色，则零打扰放行（不重渲染、光标不动）。 */

function focusedBlockEl(): HTMLElement | null {
  const sel = window.getSelection();
  const editor = editorRef.value;
  if (!sel || !sel.anchorNode || !editor || !editor.contains(sel.anchorNode)) return null;
  let node: Node | null = sel.anchorNode;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains("md-block")) {
      return node as HTMLElement;
    }
    node = node.parentNode;
  }
  return null;
}

/** 最近一次落在编辑区内的选区（工具栏按钮夺焦后用于恢复）。 */
let savedSelectionRange: Range | null = null;

/** 选区仍在编辑区内时保存一份（点击工具栏导致失焦时保持旧值）。
    只有焦点还落在编辑区里时才更新保存的选区：点击工具栏按钮夺走焦点的
    瞬间，浏览器可能把选区折叠成空光标，若此刻覆盖保存，工具栏的加粗/斜体
    就会拿不到用户刚选中的文字、落入占位文本。焦点离开后保持上一次快照。 */
function saveSelectionIfInside() {
  const sel = window.getSelection();
  const editor = editorRef.value;
  if (!sel || sel.rangeCount === 0 || !editor) return;
  if (document.activeElement !== editor) return;
  const range = sel.getRangeAt(0);
  if (editor.contains(range.commonAncestorContainer)) {
    savedSelectionRange = range.cloneRange();
  }
}

/** 只把焦点还给编辑区，绝不挪动选区（供工具栏操作在取完选区之后调用）。 */
function ensureEditorFocus() {
  const editor = editorRef.value;
  if (editor && document.activeElement !== editor) editor.focus();
}

/**
 * 取工具栏操作应作用的选区：优先「实时未折叠选区」（点击按钮不会清掉它）；
 * 实时选区被浏览器折叠 / 丢失时，退回焦点还在编辑区内时保存的非折叠快照；
 * 都拿不到才返回光标处的实时选区。
 */
function toolbarRange(): Range | null {
  const editor = editorRef.value;
  if (!editor) return null;
  const sel = window.getSelection();
  const live = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  if (live && !live.collapsed && editor.contains(live.commonAncestorContainer)) {
    return live.cloneRange();
  }
  if (
    savedSelectionRange &&
    !savedSelectionRange.collapsed &&
    editor.contains(savedSelectionRange.commonAncestorContainer)
  ) {
    return savedSelectionRange.cloneRange();
  }
  return live && editor.contains(live.commonAncestorContainer) ? live.cloneRange() : null;
}

/** 选区起点所在块；拿不到时退回最后一个块。 */
function blockOfRange(range: Range): HTMLElement {
  const editor = editorRef.value;
  let node: Node | null = range.startContainer;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains("md-block")) {
      return node as HTMLElement;
    }
    node = node.parentNode;
  }
  return (editor?.lastElementChild as HTMLElement) || (null as unknown as HTMLElement);
}

/* ---------------- 文档级选区 ↔ markdown 文本偏移双向映射 ----------------
   编辑区每个顶级块对应 markdown 里的一个物理行（空块为空行），块与块之间
   隔一个换行。把「DOM 光标/选区」翻译成与 textarea 同一套数值的 markdown
   绝对偏移（撤销/重做历史、外部重渲染后还原光标共用），反之亦然。 */

/** 当前光标/选区映射为 markdown 文本偏移 [start, end]。 */
function docSelectionOffsets(): { start: number; end: number } {
  const editor = editorRef.value;
  if (!editor) return { start: 0, end: 0 };
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return { start: 0, end: 0 };
  const range = sel.getRangeAt(0);
  const blocks = Array.from(editor.querySelectorAll(":scope > .md-block")) as HTMLElement[];
  const offsetOf = (container: Node | null, offset: number): number => {
    let acc = 0;
    for (const b of blocks) {
      if (b.contains(container)) return acc + rawOffsetAt(b, container, offset);
      acc += liveNodeRawText(b).length + 1;
    }
    return acc;
  };
  const start = offsetOf(range.startContainer, range.startOffset);
  return { start, end: Math.max(start, offsetOf(range.endContainer, range.endOffset)) };
}

/** 在某个块内按「可见文本」偏移定位到具体节点（含 <br> 占位）。 */
function locateNodeByRaw(block: HTMLElement, offset: number): { node: Node | null; inner: number } {
  const chunks = collectRawChunks(block);
  let rem = Math.max(0, offset);
  for (const ch of chunks) {
    if (rem <= ch.len) return { node: ch.node, inner: rem };
    rem -= ch.len;
  }
  return { node: null, inner: 0 };
}

/** 把 [start, end]（markdown 文本偏移）还原为编辑区 DOM 选区。 */
function placeDocOffsets(start: number, end: number) {
  const editor = editorRef.value;
  const sel = window.getSelection();
  if (!editor || !sel) return;
  const blocks = Array.from(editor.querySelectorAll(":scope > .md-block")) as HTMLElement[];
  if (blocks.length === 0) return;

  const resolve = (offset: number): { block: HTMLElement; node: Node | null; inner: number } => {
    let acc = 0;
    for (const b of blocks) {
      const len = liveNodeRawText(b).length;
      if (offset <= acc + len) return { block: b, ...locateNodeByRaw(b, offset - acc) };
      acc += len + 1;
    }
    const last = blocks[blocks.length - 1];
    return { block: last, ...locateNodeByRaw(last, liveNodeRawText(last).length) };
  };

  const clampText = (node: Node | null, inner: number): number =>
    node instanceof Text ? Math.min(inner, node.textContent?.length ?? 0) : inner;

  const a = resolve(Math.max(0, start));
  const b = resolve(Math.max(start, end));
  const range = document.createRange();
  if (a.node) {
    try {
      range.setStart(a.node, clampText(a.node, a.inner));
    } catch {
      range.selectNodeContents(a.block);
      range.collapse(true);
    }
  } else {
    range.selectNodeContents(a.block);
    range.collapse(true);
  }
  if (b.node) {
    try {
      range.setEnd(b.node, clampText(b.node, b.inner));
    } catch {
      range.selectNodeContents(b.block);
      range.collapse(false);
    }
  } else {
    range.selectNodeContents(b.block);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/** 重渲染后按 markdown 偏移还原选区并聚焦编辑区（供外部恢复 / 撤销重做回放用）。 */
function restoreDocSelection(start: number, end: number) {
  const editor = editorRef.value;
  if (!editor) return;
  editor.focus();
  placeDocOffsets(start, end);
}

/** 查找定位：把选区放到 markdown 偏移 [start, end] 处并滚动到可视区中部，
    不夺走查找框焦点（与 textarea 模式 setSelectionRange 不聚焦的行为一致）。 */
function selectRawRangeForFind(start: number, end: number) {
  const editor = editorRef.value;
  const scroll = scrollRef.value;
  if (!editor) return;
  placeDocOffsets(start, end);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || !scroll) return;
  const range = sel.getRangeAt(0);
  if (!range.getBoundingClientRect) return;
  const rect = range.getBoundingClientRect();
  if (!rect || rect.height <= 0) return;
  const sRect = scroll.getBoundingClientRect();
  const target = scroll.scrollTop + rect.top - sRect.top - sRect.height / 2;
  scroll.scrollTop = Math.max(0, target);
}

function focusEditor() {
  const editor = editorRef.value;
  if (editor && document.activeElement !== editor) editor.focus();
}

/* ---------------- 查找命中高亮（WYSIWYG 画布内就地包裹 <mark>） ----------------
   与 textarea 模式的覆盖层高亮同一套视觉（.find-hit / .find-hit-current），
   但直接作用在编辑区 DOM 上：把 markdown 偏移 [start, end) 映射回块内文本节点，
   切分后包上 <mark>。mark 是透明容器，序列化 / 结构一致性 / 光标偏移均不受影响，
   关闭查找后由 applyFindHighlight 统一拆掉还原纯净 DOM。 */

/** 在 markdown 文本里找全部命中的起始下标。 */
function findMatchesIn(md: string, term: string, caseSensitive: boolean): number[] {
  if (!term) return [];
  const hay = caseSensitive ? md : md.toLowerCase();
  const needle = caseSensitive ? term : term.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) break;
    out.push(at);
    from = at + Math.max(1, needle.length);
  }
  return out;
}

/** 在单个块内按「可见文本」偏移 [start, end) 切分文本节点并包上 <mark>。 */
function wrapRawRange(block: HTMLElement, startOffset: number, endOffset: number, cls: string) {
  const chunks = collectRawChunks(block);
  if (chunks.length === 0) return;
  let acc = 0;
  let si = -1, sInner = 0;
  let ei = -1, eInner = 0;
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i];
    const endAcc = acc + c.len;
    if (si === -1 && startOffset < endAcc) {
      si = i;
      sInner = Math.max(0, startOffset - acc);
    }
    if (endOffset <= endAcc) {
      ei = i;
      eInner = endOffset - acc;
      break;
    }
    acc = endAcc;
  }
  if (si === -1) return;
  if (ei === -1) {
    ei = chunks.length - 1;
    eInner = chunks[ei].len;
  }
  if (ei < si || eInner - sInner <= 0) return;

  const toWrap: Node[] = [];
  for (let i = si; i <= ei; i++) {
    const c = chunks[i];
    if (c.node.nodeType !== Node.TEXT_NODE) continue;
    const tn = c.node as Text;
    let startCut = 0;
    let endCut = tn.length;
    if (i === si) startCut = Math.min(sInner, tn.length);
    if (i === ei) endCut = Math.min(eInner, tn.length);
    if (endCut <= startCut) continue;
    if (startCut > 0) tn.splitText(startCut);
    const mid = (startCut > 0 ? tn.nextSibling : tn) as Text;
    const inner = endCut - startCut;
    if (inner < mid.length) mid.splitText(inner);
    toWrap.push(mid);
  }
  if (toWrap.length === 0) return;
  const mark = document.createElement("mark");
  mark.className = cls;
  const first = toWrap[0];
  /* 先记下原宿主与「包裹区之后的下一个节点」，再搬节点入 mark，
     最后把 mark 插回原位（first 已被移走，不能再用它当参照）。 */
  const parent = first.parentNode;
  const refNode = first.nextSibling;
  for (const n of toWrap) mark.appendChild(n);
  if (refNode) parent?.insertBefore(mark, refNode);
  else parent?.appendChild(mark);
}

/** 把 markdown 文本偏移 [start, end) 定位到对应块并包裹高亮。 */
function wrapMarkdownRange(blocks: HTMLElement[], start: number, end: number, cls: string) {
  let acc = 0;
  for (const b of blocks) {
    const len = liveNodeRawText(b).length;
    if (start <= acc + len) {
      const s = Math.max(start, acc);
      const e = Math.min(end, acc + len);
      if (e > s) wrapRawRange(b, s - acc, e - acc, cls);
      return;
    }
    acc += len + 1;
  }
}

/** 重放查找高亮：先拆掉旧 <mark> 还原 DOM，再按当前查找状态重新包裹全部命中。
    注意匹配文本必须取编辑区当前 DOM 的原文（块级 liveNodeRawText 拼接），
    而不是 props.modelValue —— 输入回显期间 DOM 可能已先于模型更新，用模型算
    出的偏移会包到错位文本上。 */
function applyFindHighlight() {
  const editor = editorRef.value;
  if (!editor) return;
  editor.querySelectorAll("mark.find-hit").forEach((m) => m.replaceWith(...Array.from(m.childNodes)));
  const st = props.findHighlight;
  if (!st || !st.open || !st.text) return;
  const blocks = Array.from(editor.querySelectorAll(":scope > .md-block")) as HTMLElement[];
  const docRaw = blocks.map((b) => liveNodeRawText(b)).join("\n");
  const matches = findMatchesIn(docRaw, st.text, st.caseSensitive);
  if (matches.length === 0) return;
  const active = Math.min(Math.max(0, st.index), matches.length - 1);
  matches.forEach((start, i) => {
    const end = start + st.text.length;
    if (end > docRaw.length) return;
    wrapMarkdownRange(blocks, start, end, i === active ? "find-hit find-hit-current" : "find-hit");
  });
}

/** 当前块结构是否与「按类型重建的标记」一致（没动过语法）。 */
function isBlockStructConsistent(block: HTMLElement): boolean {
  if (block.classList.contains("md-code-block")) return true;
  /* 空行块一旦被浏览器塞进了真实文本，应规范化为普通段落（去掉 md-empty），
     否则会一直顶着空行的占位样式。 */
  if (block.classList.contains("md-empty") && liveNodeRawText(block)) return false;
  const raw = liveNodeRawText(block);
  const reconstructed = serializeLiveBlock(block);
  return raw.trim() === reconstructed.trim();
}

/**
 * 用「当前可见内容」重渲染光标所在块（带内容上色），并按文字偏移还原光标。
 * 规范结构可能拆成多个块（如 `a\nb` 两行），按序全部插入。
 */
function reRenderFocusedBlockAs(block: HTMLElement, raw: string) {
  const wrap = document.createElement("div");
  wrap.innerHTML = compileLiveHtml(raw);
  const canonBlocks = Array.from(wrap.children).filter(
    (el) => (el as HTMLElement).classList.contains("md-block"),
  ) as HTMLElement[];
  if (canonBlocks.length === 0) return;

  const caretOffset = caretRawOffsetIn(block);
  let last = canonBlocks[0];
  for (let k = 1; k < canonBlocks.length; k++) {
    last.insertAdjacentElement("afterend", canonBlocks[k]);
    last = canonBlocks[k];
  }
  block.replaceWith(canonBlocks[0]);
  /* 先重放查找高亮再落光标：高亮会切分文本节点，后放光标才能按最终 DOM 定位。 */
  applyFindHighlight();
  placeCaretByRawOffset(canonBlocks[0], Math.min(caretOffset, liveNodeRawText(canonBlocks[0]).length));
}

/**
 * 输入后修复步骤：结构被改动（删了语法标记）→ 重新规范化；
 * 结构完好但开启内容上色 → 只重渲染本块以刷新配色。两者都按字数还原光标，
 * 普通打字（结构一致 + 未开上色）不重渲染。
 */
function repairFocusedBlock() {
  const block = focusedBlockEl();
  if (!block || block.classList.contains("md-code-block")) return;

  const raw = liveNodeRawText(block);
  const consistent = isBlockStructConsistent(block);
  if (consistent && !contentColoringOn.value) return;

  /* 结构一致但开了上色：仅刷新配色（不干预结构）；否则按当前内容规范化。 */
  reRenderFocusedBlockAs(block, raw);
}

/** 需要跳过本次结构修复的编辑（工具栏格式命令 / 粘贴 / Tab，其 DOM 变更由自身接管）。 */
let suppressRepair = false;

/* ---------------- 成对标点自动补全（WYSIWYG 版） ----------------
 *
 * 与 markdown 编辑区同一套规则，但这里没有 textarea 的 .value / setSelectionRange，
 * 改成「改动前快照 + input 后按块内文本校正」：
 *
 *   1. beforeinput 拍快照：当前块的可见文本 + 光标/选区的块内偏移；
 *   2. 浏览器把字符插进 DOM、input 事件落地后，用快照与当前状态算出校正
 *      （computeInsertPairCorrection / computeDeletePairCorrection，纯函数，
 *      与文本域版规则一致）；
 *   3. 需要校正时整块重渲染并还原光标，模型随之同步 —— 谁拦不住它，
 *      也不用管光标落进了 .md-syntax 还是 .md-content。
 *
 * 中文输入法把全角标点当组合上屏时另走 compositionend 兜底通道。 */

/** 成对标点校正用的改动前快照（块内文本 + 选区偏移）。 */
interface PairSnap {
  raw: string;
  selStart: number;
  selEnd: number;
}

let pairSnap: PairSnap | null = null;

/** 快照只对「单个字符键入 / 退格」有意义，其余编辑一律不进入校正流程。 */
function onEditorBeforeInput(e: Event) {
  const ie = e as InputEvent;
  if (
    ie.isComposing ||
    ie.inputType === "insertCompositionText" ||
    ie.inputType === "insertFromComposition" ||
    (ie.inputType !== "insertText" && ie.inputType !== "deleteContentBackward")
  ) {
    pairSnap = null;
    return;
  }
  const editor = editorRef.value;
  const block = focusedBlockEl();
  if (!editor || !block || block.classList.contains("md-code-block")) {
    pairSnap = null;
    return;
  }
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) {
    pairSnap = null;
    return;
  }
  const range = sel.getRangeAt(0);
  /* 选区必须整个落在这个块内（跨块选区不参与校正）。 */
  if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) {
    pairSnap = null;
    return;
  }
  pairSnap = {
    raw: liveNodeRawText(block),
    selStart: rawOffsetAt(block, range.startContainer, range.startOffset),
    selEnd: rawOffsetAt(block, range.endContainer, range.endOffset),
  };
}

/** 按校正结果整块重渲染并还原光标 / 选区，随后同步模型。 */
function applyPairResult(block: HTMLElement, result: PairEditResult) {
  const editor = editorRef.value;
  if (!editor) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = compileLiveHtml(result.next);
  const blocks = Array.from(wrap.children).filter(
    (el) => (el as HTMLElement).classList.contains("md-block"),
  ) as HTMLElement[];
  if (blocks.length === 0) return;
  const first = blocks[0];
  block.replaceWith(first);
  let last = first;
  for (let k = 1; k < blocks.length; k++) {
    last.insertAdjacentElement("afterend", blocks[k]);
    last = blocks[k];
  }
  /* 先重放查找高亮再放光标：高亮会切分文本节点，后放才能按最终 DOM 定位。 */
  applyFindHighlight();
  const len = liveNodeRawText(first).length;
  selectRawRange(first, Math.max(0, result.selStart), Math.min(result.selEnd, len));
  editor.focus();
  syncDomToModel();
  updateFocusState();
}

/**
 * input 落地后的校正入口。返回 true 表示已做补全/跨越/双删，调用方应跳过
 * 后续 repair（整块已由 applyPairResult 重渲染，结构和配色都已就位）。
 */
function handleAutoPair(e?: Event): boolean {
  const snap = pairSnap;
  pairSnap = null;
  if (!snap) return false;

  const block = focusedBlockEl();
  const editor = editorRef.value;
  if (!block || !editor || block.classList.contains("md-code-block")) return false;

  const ie = e instanceof InputEvent ? e : null;
  if (!ie || ie.isComposing) return false;
  if (ie.inputType === "insertCompositionText" || ie.inputType === "insertFromComposition") return false;

  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  const after = liveNodeRawText(block);
  const caret = rawOffsetAt(block, range.startContainer, range.startOffset);

  let result: PairEditResult | null = null;
  if (ie.inputType === "deleteContentBackward") {
    result = computeDeletePairCorrection(snap.raw, snap.selStart, snap.selEnd, after, caret);
  } else if (ie.inputType === "insertText") {
    const ch = ie.data ?? "";
    if (Array.from(ch).length !== 1) return false;
    result = computeInsertPairCorrection(snap.raw, snap.selStart, snap.selEnd, after, caret, ch);
  } else {
    return false;
  }

  if (!result) return false;
  applyPairResult(block, result);
  return true;
}

/**
 * 输入法兜底通道：组合上屏一个左标点（全角引号等）后补上另一半。
 * 推到下一个宏任务再补 —— v-model 自己的 compositionend 处理器先跑完并补发
 * input，我们随后补的改写才不会被宿主丢掉，出现「界面上有、模型里没有」。
 */
function onCompositionEnd(e: CompositionEvent) {
  const editor = editorRef.value;
  if (!editor) return;
  const data = e.data ?? "";
  if (Array.from(data).length !== 1) return;
  const close = pairCloseFor(data);
  /* 同形引号在组合通道里分不出开合，宁可不补。 */
  if (!close || isSymmetricPair(data)) return;
  setTimeout(() => {
    if (document.activeElement !== editor) return;
    const block = focusedBlockEl();
    if (!block || block.classList.contains("md-code-block")) return;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!range.collapsed) return;
    const caret = rawOffsetAt(block, range.startContainer, range.startOffset);
    const raw = liveNodeRawText(block);
    /* 光标必须紧跟在刚上屏的这个字符后面，否则不是我们要接的那一次。 */
    if (raw.slice(caret - data.length, caret) !== data) return;
    /* 已经有另一半就别重复补。 */
    if (raw.slice(caret, caret + close.length) === close) return;
    applyPairResult(block, { next: raw.slice(0, caret) + close + raw.slice(caret), selStart: caret, selEnd: caret });
  }, 0);
}

function onInput(e?: Event) {
  const composing = e instanceof InputEvent && e.isComposing;
  if (!suppressRepair && !composing) {
    if (handleAutoPair(e)) {
      suppressRepair = false;
      updateFocusState();
      return;
    }
    repairFocusedBlock();
  }
  suppressRepair = false;
  syncDomToModel();
  updateFocusState();
}

/** 把一行 Markdown 编译成单个独立块元素（供回车拆段复用解析逻辑）。 */
function blockFromMarkdown(mdLine: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = markdownToLiveHtml(mdLine);
  return (wrap.querySelector(":scope > .md-block") || wrap.firstElementChild) as HTMLElement;
}

/** 拆段时按原块的块类型还原标记前缀，保持语义类型（标题 / 列表 / 引用）。 */
function mdPrefixForBlock(text: string, source: HTMLElement): string {
  if (!text.trim()) return "";
  const type = source.getAttribute("data-block-type") || "";
  if (/^h[1-6]$/.test(type)) return `${"#".repeat(parseInt(type[1], 10))} ${text}`;
  if (type === "ul") return `${source.getAttribute("data-bullet") || "-"} ${text}`;
  if (type === "ol") return `${source.getAttribute("data-num") || "1"}. ${text}`;
  if (type === "quote") return `> ${text}`;
  return text;
}

function placeCaretAtStart(el: HTMLElement) {
  const sel = window.getSelection();
  if (!sel) return;
  const content = el.querySelector(".md-content");
  const target = (content?.firstChild as Node) || el.querySelector("br") || el.firstChild || el;
  const range = document.createRange();
  range.setStart(target, 0);
  range.collapse(true);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** 回车：把当前块在光标处拆成两个独立块（行尾则换出一个新的空行），
    与 markdown 编辑区里回车开新行一致；空块上回车继续多空出一行。 */
function onEnterKey() {
  const editor = editorRef.value;
  const sel = window.getSelection();
  if (!editor || !sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) range.collapse(false);
  if (!editor.contains(range.startContainer)) return;

  let node: Node | null = range.startContainer;
  let block: HTMLElement | null = null;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains("md-block")) {
      block = node as HTMLElement;
      break;
    }
    node = node.parentNode;
  }
  const host = block || editor;

  const beforeRange = document.createRange();
  beforeRange.selectNodeContents(host);
  beforeRange.setEnd(range.startContainer, range.startOffset);
  const beforeText = serializeInlineChildren(beforeRange.cloneContents() as unknown as HTMLElement).trim();

  const afterRange = document.createRange();
  afterRange.selectNodeContents(host);
  afterRange.setStart(range.startContainer, range.startOffset);
  const afterText = serializeInlineChildren(afterRange.cloneContents() as unknown as HTMLElement).trim();

  let afterBlock: HTMLElement;
  if (!afterText) {
    afterBlock = blockFromMarkdown("");
    if (block) block.insertAdjacentElement("afterend", afterBlock);
    else editor.appendChild(afterBlock);
  } else {
    const beforeBlock = blockFromMarkdown(mdPrefixForBlock(beforeText, block || editor));
    afterBlock = blockFromMarkdown(mdPrefixForBlock(afterText, block || editor));
    if (block) {
      block.replaceWith(beforeBlock);
      beforeBlock.insertAdjacentElement("afterend", afterBlock);
    } else {
      editor.appendChild(beforeBlock);
      editor.appendChild(afterBlock);
    }
  }

  placeCaretAtStart(afterBlock);
  applyFindHighlight();
  syncDomToModel();
  updateFocusState();
}

/** 键盘交互 */
function onKeydown(e: KeyboardEvent) {
  // Enter（不含 Shift/Ctrl，且非中文组合输入确认）：按块拆段 / 换出新空行
  if (e.key === "Enter" && !e.isComposing && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    onEnterKey();
    return;
  }
  // Ctrl+B (粗体)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
    e.preventDefault();
    suppressRepair = true;
    document.execCommand("bold");
    syncDomToModel();
    updateFocusState();
    return;
  }

  // Ctrl+I (斜体)
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "i") {
    e.preventDefault();
    suppressRepair = true;
    document.execCommand("italic");
    syncDomToModel();
    updateFocusState();
    return;
  }

  // Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y（撤销 / 重做）：
  // 完整历史栈由上层 DocumentViewer 维护（textarea 与 WYSIWYG 共用），
  // 这里只是把快捷键转发过去，避免走浏览器原生栈漏掉工具栏/AI 的程序化改动。
  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "z") {
    e.preventDefault();
    if (e.shiftKey) emit("redo");
    else emit("undo");
    return;
  }

  if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "y") {
    e.preventDefault();
    emit("redo");
    return;
  }

  // Ctrl+F / Ctrl+H（查找 / 替换）：textarea 的 onEditorKeydown 在 WYSIWYG 模式下
  // 收不到按键，这里转发给上层打开查找框，选区文本由上层 getSelectedText() 自动填入。
  if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key.toLowerCase() === "f" || e.key.toLowerCase() === "h")) {
    e.preventDefault();
    emit("find");
    return;
  }

  // Tab (插入 2 格空格缩进)
  if (e.key === "Tab") {
    e.preventDefault();
    suppressRepair = true;
    document.execCommand("insertText", false, "  ");
    syncDomToModel();
    return;
  }
}

/** 把光标所在块换算成整篇 markdown 的起始偏移（空块按 0 字符 + 换行分隔符计）。 */
function docOffsetOfBlock(block: HTMLElement): number {
  const editor = editorRef.value;
  if (!editor) return 0;
  let acc = 0;
  for (const b of editor.querySelectorAll(":scope > .md-block")) {
    if (b === block) return acc;
    acc += liveNodeRawText(b as HTMLElement).length + 1;
  }
  return acc;
}

/**
 * 光标是否落在代码区（行内 `code` 或 ``` 代码块）里。
 * 这些位置的粘贴交给浏览器默认行为：文本直接落进 <code>，序列化无损；
 * 走块重渲染反而可能把反引号 / 围栏结构拆坏。
 */
function caretInCode(): boolean {
  const editor = editorRef.value;
  const sel = window.getSelection();
  if (!editor || !sel || sel.rangeCount === 0) return false;
  const container = sel.getRangeAt(0).commonAncestorContainer;
  let node: Node | null = container.nodeType === Node.TEXT_NODE ? container.parentNode : container;
  while (node && node !== editor) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.classList.contains("md-code")) return true;
      if (el.classList.contains("md-code-block")) return true;
    }
    node = node.parentNode;
  }
  return false;
}

/**
 * 粘贴处理。
 *
 * 一律拦截并转成规范块结构插入 —— 不能放浏览器默认粘贴：contenteditable 的
 * 默认粘贴会按 WebView 语义插入 <div>/<br>，或把文本塞进带 .md-empty 的空行块
 * 里，这些内容序列化时都会被丢掉（liveNodeRawText / serializeLiveBlock 对
 * md-empty 一律按空行处理），于是「WYSIWYG 里粘贴 → 切走再切回内容消失」。
 * 这里以 markdown 串层面插入：含换行的粘贴逐行变成独立块、行首标题语法照常
 * 解析，与 markdown 编辑区的粘贴语义一致，且模型必然同步。
 */
function onPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData("text/plain");
  if (!text) return;
  /* 代码区粘贴走浏览器默认行为（见 caretInCode）。 */
  if (caretInCode()) return;
  e.preventDefault();
  insertMarkdownAtCaret(text);
}

/** 把一段 markdown 文本按光标位置插入，替换原块并同步模型。 */
function insertMarkdownAtCaret(text: string) {
  const editor = editorRef.value;
  const sel = window.getSelection();
  if (!editor || !sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  const block = focusedBlockEl();
  if (!editor.contains(range.commonAncestorContainer)) return;

  const start = block ? rawOffsetAt(block, range.startContainer, range.startOffset) : 0;
  const end = block ? Math.max(start, rawOffsetAt(block, range.endContainer, range.endOffset)) : 0;
  const raw = block ? liveNodeRawText(block) : "";
  const next = raw.slice(0, start) + text + raw.slice(end);
  const caretInBlock = start + text.length;
  const blockDocOffset = block ? docOffsetOfBlock(block) : 0;

  const wrap = document.createElement("div");
  wrap.innerHTML = compileLiveHtml(next);
  const newBlocks = Array.from(wrap.children).filter(
    (el) => (el as HTMLElement).classList.contains("md-block"),
  ) as HTMLElement[];
  if (newBlocks.length === 0) return;

  if (block) {
    const first = newBlocks[0];
    block.replaceWith(first);
    let last = first;
    for (let k = 1; k < newBlocks.length; k++) {
      last.insertAdjacentElement("afterend", newBlocks[k]);
      last = newBlocks[k];
    }
  } else {
    newBlocks.forEach((b) => editor.appendChild(b));
  }

  /* 先重放查找高亮再落光标：高亮会切分文本节点，后放才能按最终 DOM 定位。 */
  applyFindHighlight();
  placeDocOffsets(blockDocOffset + caretInBlock, blockDocOffset + caretInBlock);
  updateFocusState();
  syncDomToModel();
}

/* ---------------- 顶部 markdown 工具栏桥接 ----------------
   工具栏（DocumentViewer）在 WYSIWYG 模式把按钮动作转发到这里，
   直接对内容可编辑的当前块做「可见文本」级操作：加粗/斜体/链接/代码块
   走选区包裹，标题/列表/引用走行级标记，行为与 markdown 编辑区一致。 */

type WysiwygLineStyle = "h1" | "h2" | "h3" | "h4" | "h5" | "h6" | "bullet" | "ordered" | "quote";

const W_HEADING_RE = /^(#{1,6})[ \t]+/;
const W_BULLET_RE = /^([-*+])[ \t]+/;
const W_ORDERED_RE = /^(\d{1,9})([.)])[ \t]+/;
const W_QUOTE_RE = /^>[ \t]?/;

function lineStyleOfRaw(text: string): WysiwygLineStyle | null {
  const body = text.replace(/^[ \t]*/, "");
  const h = W_HEADING_RE.exec(body);
  if (h) return `h${Math.min(6, h[1].length)}` as WysiwygLineStyle;
  if (W_ORDERED_RE.test(body)) return "ordered";
  if (W_BULLET_RE.test(body)) return "bullet";
  if (W_QUOTE_RE.test(body)) return "quote";
  return null;
}

function stripLineStyleRaw(text: string): string {
  let body = text.replace(/^[ \t]*/, "");
  body = body.replace(W_QUOTE_RE, "");
  if (W_HEADING_RE.test(body)) body = body.replace(W_HEADING_RE, "");
  else if (W_ORDERED_RE.test(body)) body = body.replace(W_ORDERED_RE, "");
  else if (W_BULLET_RE.test(body)) body = body.replace(W_BULLET_RE, "");
  return body;
}

function lineStylePrefixRaw(style: WysiwygLineStyle): string {
  if (style === "bullet") return "- ";
  if (style === "ordered") return "1. ";
  if (style === "quote") return "> ";
  return "#".repeat(Number(style.slice(1))) + " ";
}

/** 取「光标所在块」（无选区时退回最后一个块）。 */
function targetBlockForToolbar(): HTMLElement {
  const editor = editorRef.value;
  return editor ? ((focusedBlockEl() || editor.lastElementChild) as HTMLElement) : (null as unknown as HTMLElement);
}

/** 用给定 raw 重渲染并替换目标块，然后选中/聚焦指定的可见文本区间。 */
function replaceFocusedBlockWith(raw: string, selStart: number, selEnd: number, block?: HTMLElement) {
  const editor = editorRef.value;
  const target = block || targetBlockForToolbar();
  if (!editor || !target) return;
  const wrap = document.createElement("div");
  wrap.innerHTML = compileLiveHtml(raw);
  const blocks = Array.from(wrap.children).filter(
    (el) => (el as HTMLElement).classList.contains("md-block"),
  ) as HTMLElement[];
  if (blocks.length === 0) return;
  let last = blocks[0];
  for (let k = 1; k < blocks.length; k++) {
    last.insertAdjacentElement("afterend", blocks[k]);
    last = blocks[k];
  }
  target.replaceWith(blocks[0]);
  /* 先重放查找高亮再设选区：高亮会切分文本节点，后设选区才能按最终 DOM 定位。 */
  applyFindHighlight();
  selectRawRange(blocks[0], Math.max(0, selStart), Math.min(selEnd, liveNodeRawText(blocks[0]).length));
  editor.focus();
  syncDomToModel();
  updateFocusState();
}

/** 加粗 / 斜体等：把选区（或光标处）文本用 before/after 包裹。 */
function wrapSelection(before: string, after = before, placeholder = "文本") {
  const editor = editorRef.value;
  if (!editor) return;
  const range = toolbarRange();
  if (!range) return;
  ensureEditorFocus();
  const block = blockOfRange(range);
  if (!block) return;
  const raw = liveNodeRawText(block);
  const start = rawOffsetAt(block, range.startContainer, range.startOffset);
  const end = Math.max(start, rawOffsetAt(block, range.endContainer, range.endOffset));
  const selected = raw.slice(start, end) || placeholder;
  const next = raw.slice(0, start) + before + selected + after + raw.slice(end);
  replaceFocusedBlockWith(next, start + before.length, start + before.length + selected.length, block);
}

/** 标题 / 无序 / 有序 / 引用：切换光标所在块的行级标记（再点同一档即取消）。 */
function applyLineStyle(style: WysiwygLineStyle) {
  const editor = editorRef.value;
  if (!editor) return;
  const range = toolbarRange();
  if (!range) return;
  ensureEditorFocus();
  const block = blockOfRange(range);
  if (!block) return;
  const raw = liveNodeRawText(block);
  const current = lineStyleOfRaw(raw);
  const body = stripLineStyleRaw(raw);
  const toggleOff = style === current;
  const next = toggleOff ? body : lineStylePrefixRaw(style) + body;
  const bodyStart = toggleOff ? 0 : lineStylePrefixRaw(style).length;
  replaceFocusedBlockWith(next, bodyStart, bodyStart, block);
}

/** 代码块：在光标所在块之后插入一段占位代码块。 */
function insertCodeBlock() {
  const editor = editorRef.value;
  if (!editor) return;
  const range = toolbarRange();
  ensureEditorFocus();
  const block = range ? blockOfRange(range) : focusedBlockEl();
  const el = blockFromMarkdown("```ts\n// write code here\n```");
  if (block) block.insertAdjacentElement("afterend", el);
  else editor.appendChild(el);
  const code = el.querySelector("code");
  const sel = window.getSelection();
  if (sel && code) {
    const r = document.createRange();
    r.setStart(code, 0);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }
  editor.focus();
  syncDomToModel();
  updateFocusState();
}

/** 链接：用选区文本作链接文字，否则插入占位链接。 */
function insertLink() {
  const editor = editorRef.value;
  if (!editor) return;
  const range = toolbarRange();
  if (!range) return;
  ensureEditorFocus();
  const block = blockOfRange(range);
  if (!block) return;
  const raw = liveNodeRawText(block);
  const start = rawOffsetAt(block, range.startContainer, range.startOffset);
  const end = Math.max(start, rawOffsetAt(block, range.endContainer, range.endOffset));
  const selected = raw.slice(start, end);
  const snippet = selected ? `[${selected}](https://)` : "[链接文字](https://)";
  const next = raw.slice(0, start) + snippet + raw.slice(end);
  const textStart = start + 1;
  const textEnd = start + 1 + (selected || "链接文字").length;
  replaceFocusedBlockWith(next, textStart, textEnd, block);
}

/* ---------------- 块悬停手柄与段落自由拖拽对换机制 ---------------- */

/**
 * 悬停探测挂在整张纸面（.paper-card）上，而不是只挂在正文容器上。
 *
 * 手柄浮在正文左侧的留白里，那块区域属于纸面的 padding、不属于正文容器：
 * 只监听正文容器时，鼠标一旦横向移出正文去点手柄就先触发 mouseleave，
 * 手柄当场消失，永远点不到。改挂纸面后，正文与留白同属一个监听区域，
 * 鼠标在两者之间往返都不会打断悬停态。
 *
 * 纸面很宽而正文段落只占中间一栏，所以这里不要求指针正好落在段落上：
 * 按指针纵坐标就近取一个块，手柄始终对齐当前那一行。
 */
function onPaperMouseMove(e: MouseEvent) {
  if (docBlockDrag.isDragging) return;
  const editor = editorRef.value;
  const paper = paperRef.value;
  if (!editor || !paper) return;

  /* 段落聚光灯：指针所在块高亮，其余压暗（仅 spotlight 开启时生效）。 */
  if (props.spotlightEnabled) {
    const el = (e.target as HTMLElement | null)?.closest?.(".md-block") as HTMLElement | null;
    setSpotlightTarget(el && el.parentElement === editor ? el : null);
  }

  /* 指针在手柄自身上时保持现状，避免手柄跟着指针来回跳。 */
  if ((e.target as HTMLElement)?.closest(".block-drag-handle")) {
    cancelHoverClear();
    return;
  }

  const blocks = Array.from(editor.querySelectorAll(":scope > .md-block") as NodeListOf<HTMLElement>);
  if (blocks.length === 0) {
    hoveredBlockEl.value = null;
    return;
  }

  const paperRect = paper.getBoundingClientRect();
  const y = e.clientY;

  /* 先找指针纵向落在哪个块的跨度内；落在块间空隙时取最近的那个。 */
  let hit: HTMLElement | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const block of blocks) {
    const r = block.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) {
      hit = block;
      break;
    }
    const dist = y < r.top ? r.top - y : y - r.bottom;
    if (dist < bestDist) {
      bestDist = dist;
      hit = block;
    }
  }

  /* 离所有段落都太远（例如纸面底部的大片空白）时才收起手柄。 */
  if (!hit || bestDist > 120) {
    scheduleHoverClear();
    return;
  }

  cancelHoverClear();
  const hitRect = hit.getBoundingClientRect();
  hoveredBlockEl.value = hit;
  /* 现在一个块就是一行（含空行）：手柄撑满这一行的整段行高，
     图标在行框内垂直居中，与该行文字的视觉中线严格对齐。 */
  handleHeightPx.value = Math.max(18, Math.round(hitRect.height));
  handleTopPx.value =
    hitRect.top - paperRect.top + Math.max(0, (hitRect.height - handleHeightPx.value) / 2);
}

function onPaperMouseLeave() {
  if (props.spotlightEnabled) {
    setSpotlightTarget(null);
  }
  if (!docBlockDrag.isDragging) {
    scheduleHoverClear();
  }
}

/** 指针进入手柄本身：撤销消隐，让用户有充足时间按下去。 */
function onHandleMouseEnter() {
  cancelHoverClear();
}

function startBlockDragFromHandle(e: MouseEvent) {
  if (!hoveredBlockEl.value || !editorRef.value) return;
  draggedBlockEl.value = hoveredBlockEl.value;

  const blockText = serializeLiveBlock(hoveredBlockEl.value);
  const allBlocks = Array.from(editorRef.value.querySelectorAll(":scope > .md-block"));
  const blockIndex = allBlocks.indexOf(hoveredBlockEl.value);

  const payload: DocBlockPayload = {
    sourceDocId: (props.fileId as string) || "main-doc",
    sourceDocTitle: currentDocTitle.value,
    blockIndex,
    blockText: blockText || "（空段落）",
  };

  startBlockDrag(payload, e.clientX, e.clientY);

  window.addEventListener("mousemove", onGlobalDragMove, true);
  window.addEventListener("mouseup", onGlobalDragMouseUp, true);
}

function onGlobalDragMove(e: MouseEvent) {
  if (!docBlockDrag.isDragging) return;
  docBlockDrag.pointerX = e.clientX;
  docBlockDrag.pointerY = e.clientY;

  const editor = editorRef.value;
  const paper = paperRef.value;
  if (!editor || !paper) return;

  const paperRect = paper.getBoundingClientRect();
  const allBlocks = Array.from(editor.querySelectorAll(":scope > .md-block") as NodeListOf<HTMLElement>);
  if (allBlocks.length === 0) return;

  const y = e.clientY;
  let foundIndex = -1;
  let lineTop = 0;

  for (let i = 0; i < allBlocks.length; i++) {
    const r = allBlocks[i].getBoundingClientRect();
    if (y < r.top) {
      foundIndex = i;
      lineTop = r.top - paperRect.top;
      break;
    } else if (y >= r.top && y <= r.bottom) {
      const mid = (r.top + r.bottom) / 2;
      if (y >= mid) {
        foundIndex = i + 1;
        lineTop = r.bottom - paperRect.top;
      } else {
        foundIndex = i;
        lineTop = r.top - paperRect.top;
      }
      break;
    }
  }

  if (foundIndex === -1) {
    foundIndex = allBlocks.length;
    const lastR = allBlocks[allBlocks.length - 1].getBoundingClientRect();
    lineTop = lastR.bottom - paperRect.top;
  }

  targetDropIndex.value = foundIndex;
  targetInsertionTopPx.value = lineTop;
}

function onGlobalDragMouseUp() {
  window.removeEventListener("mousemove", onGlobalDragMove, true);
  window.removeEventListener("mouseup", onGlobalDragMouseUp, true);

  if (!docBlockDrag.isDragging || !draggedBlockEl.value || !editorRef.value) {
    endBlockDrag();
    targetDropIndex.value = -1;
    draggedBlockEl.value = null;
    return;
  }

  const editor = editorRef.value;
  const allBlocks = Array.from(editor.querySelectorAll(":scope > .md-block") as NodeListOf<HTMLElement>);
  const fromIdx = allBlocks.indexOf(draggedBlockEl.value);
  const toIdx = targetDropIndex.value;

  if (fromIdx >= 0 && toIdx >= 0 && fromIdx !== toIdx && fromIdx !== toIdx - 1) {
    if (toIdx >= allBlocks.length) {
      editor.appendChild(draggedBlockEl.value);
    } else {
      const refNode = allBlocks[toIdx];
      editor.insertBefore(draggedBlockEl.value, refNode);
    }

    syncDomToModel();
    showToast("位置已调整", "段落自由对换成功", "edit");
  }

  endBlockDrag();
  targetDropIndex.value = -1;
  draggedBlockEl.value = null;
  hoveredBlockEl.value = null;
}

/* ---------------- 阅读进度与圆环 ---------------- */

function onScroll() {
  const el = scrollRef.value;
  if (!el) return;
  const max = el.scrollHeight - el.clientHeight;
  scrollProgress.value = max <= 0 ? 0 : Math.min(1, el.scrollTop / max);
  /* scroll 事件不冒泡，主动转发给上层，让选中工具栏跟随重定位。 */
  emit("scroll");
}

function onRingJump(payload: { index: number; top: number }) {
  const el = scrollRef.value;
  if (!el) return;
  el.scrollTo({ top: payload.top, behavior: "smooth" });
}

function updateFromRing(newText: string) {
  emit("update:modelValue", newText);
  const el = editorRef.value;
  if (!el) return;
  /* 回显内容与当前 DOM 一致时零打扰放行，绝不重排、不动光标。 */
  if (liveHtmlToMarkdown(el) === newText) {
    setSpotlightTarget(null);
    return;
  }
  const focused = document.activeElement === el;
  const caret = focused ? docSelectionOffsets() : { start: 0, end: 0 };
  setSpotlightTarget(null);
  el.innerHTML = compileLiveHtml(newText);
  applyFindHighlight();
  if (focused) placeDocOffsets(caret.start, caret.end);
  updateFocusState();
}

/* 纸面排版样式。
   横向留白与 markdown 编辑区同一套公式（--ed-pad-x = max(边距, 居中列宽)）：
   宽窗时正文列与网格线都收在 --reading-measure 内并居中，窄窗时退回固定边距，
   左右对称，文字列与网格线宽度跟 markdown 编辑区完全一致。
   左侧留白最低 44px 仍是拖拽手柄的容身处（见 .block-drag-handle）。 */
const paperCardStyle = computed(() => {
  const floor = Math.max(44, props.marginX + 16);
  const padX = `max(${floor}px, calc((100% - var(--reading-measure)) / 2))`;
  return {
    "--ed-font-size": props.fontSize + "px",
    "--ed-line-height": props.lineHeight,
    "--ed-line-height-px": (props.fontSize * props.lineHeight).toFixed(2) + "px",
    "--ed-pad-y": props.marginY + "px",
    "--ed-pad-x": padX,
    padding: `${props.marginY + 18}px ${padX} 96px ${padX}`,
  };
});

// 继承并挂载内容上色 CSS 变量
const readingViewStyle = computed(() => ({
  fontSize: props.fontSize + "px",
  fontFamily: props.fontFamily,
  lineHeight: props.lineHeight,
  ...contentColorCssVars(),
}));

/** 外部正文更新 */
watch(
  () => props.modelValue,
  (newVal) => {
    if (isInternalEdit) {
      isInternalEdit = false;
      return;
    }
    const el = editorRef.value;
    if (!el) return;
    /* 输入回显期间：编辑器已含新值（DOM 序列化相等）且仍持有焦点时，
       直接放行，避免整树 innerHTML 替换把光标清回到开头。 */
    if (document.activeElement === el && liveHtmlToMarkdown(el) === newVal) {
      return;
    }
    /* 真正需要重渲染（外部改写 / 切换文档）时，只要镜头还在编辑区里，
       就先记下当前光标位置，替换完整棵树再按原位置放回去 ——
       保证“末尾删除”等操作永远不会被一次的整树替换打到开头。 */
    const focused = document.activeElement === el;
    const caret = focused ? docSelectionOffsets() : { start: 0, end: 0 };
    setSpotlightTarget(null);
    el.innerHTML = compileLiveHtml(newVal);
    applyFindHighlight();
    if (focused) placeDocOffsets(caret.start, caret.end);
    updateFocusState();
  },
);

/** 内容上色开关响应 */
watch(contentColoringOn, () => {
  const el = editorRef.value;
  if (!el) return;
  const focused = document.activeElement === el;
  const caret = focused ? docSelectionOffsets() : { start: 0, end: 0 };
  setSpotlightTarget(null);
  el.innerHTML = compileLiveHtml(props.modelValue);
  applyFindHighlight();
  if (focused) placeDocOffsets(caret.start, caret.end);
  updateFocusState();
});

/** 查找高亮状态变化：无需重渲染，直接就地更新命中包裹。 */
watch(
  () => props.findHighlight,
  () => {
    applyFindHighlight();
  },
);

/** 聚光灯开关：关闭时清理残留的定位高亮 */
watch(
  () => props.spotlightEnabled,
  (on) => {
    if (!on) setSpotlightTarget(null);
  },
);

onMounted(() => {
  if (editorRef.value) {
    editorRef.value.innerHTML = compileLiveHtml(props.modelValue);
    applyFindHighlight();
  }
  document.addEventListener("selectionchange", updateFocusState);
});

onBeforeUnmount(() => {
  document.removeEventListener("selectionchange", updateFocusState);
  window.removeEventListener("mousemove", onGlobalDragMove, true);
  window.removeEventListener("mouseup", onGlobalDragMouseUp, true);
});

/* ---------------- 选区浮动工具栏 / 右键菜单支撑 ----------------
   与 markdown 编辑区（textarea）同一套能力：剪切 / 复制 / 粘贴 / 全选 / 删除，
   以及「更多文本处理」。这里在 DOM 侧把选区翻译成 markdown 文本偏移，
   再统一走「改串 → emit 同步模型 → 重渲染 → 还原选区」的管线，保证
   WYSIWYG 与 textarea 的工具栏行为一致（包括空行块偏移对齐）。 */

/** 编辑区根元素（供上层判断指针 / 选区是否落在编辑区内）。 */
function getEditorElement(): HTMLDivElement | null {
  return editorRef.value;
}

/** 滚动容器（.wysiwyg-scroll），供上层持久化 / 恢复阅读位置。 */
function getScrollContainer(): HTMLDivElement | null {
  return scrollRef.value;
}

/** 当前是否有一个非空选区落在编辑区内。 */
function selectionInsideEditor(): boolean {
  const sel = window.getSelection();
  const editor = editorRef.value;
  return !!sel && !!editor && sel.rangeCount > 0 && editor.contains(sel.anchorNode);
}

/** 编辑区内非空选区对应的 markdown 文本偏移 [start, end]；无选区 / 移出编辑区为 null。 */
function selectionOffsets(): { start: number; end: number } | null {
  const sel = window.getSelection();
  const editor = editorRef.value;
  if (!sel || sel.rangeCount === 0 || !editor) return null;
  const range = sel.getRangeAt(0);
  if (range.collapsed || !editor.contains(range.commonAncestorContainer)) return null;
  return docSelectionOffsets();
}

/** 按 markdown 偏移设选区（供工具栏动作重渲染后还原选中）。 */
function setSelectionOffsets(start: number, end: number) {
  placeDocOffsets(start, end);
}

/**
 * 把编辑结果写回：emit 给上层同步 markdown，同时本地立即重渲染并还原选区。
 * 与 updateFromRing 同一条管线（modelValue 回流时 DOM 已一致即零打扰放行）。
 */
function applyMarkdownEdit(next: string, selStart: number, selEnd: number) {
  const editor = editorRef.value;
  if (!editor) return;
  emit("update:modelValue", next);
  if (liveHtmlToMarkdown(editor) === next) {
    placeDocOffsets(selStart, selEnd);
    editor.focus();
    return;
  }
  editor.innerHTML = compileLiveHtml(next);
  applyFindHighlight();
  placeDocOffsets(selStart, selEnd);
  editor.focus();
  updateFocusState();
}

/** 复制选中文字（markdown 原文，含 ** 等语法，与 textarea 复制行为一致）。 */
async function copySelection(): Promise<boolean> {
  const off = selectionOffsets();
  if (!off) return false;
  const md = props.modelValue;
  const text = md.slice(off.start, off.end);
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* 剪贴板被拒时静默失败（与 textarea 侧行为一致） */
  }
  return true;
}

/** 剪切：复制 + 删除选中区间。 */
async function cutSelection(): Promise<boolean> {
  const off = selectionOffsets();
  if (!off) return false;
  const md = props.modelValue;
  const text = md.slice(off.start, off.end);
  if (!text) return false;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    /* ignore */
  }
  applyMarkdownEdit(md.slice(0, off.start) + md.slice(off.end), off.start, off.start);
  return true;
}

/** 粘贴：把剪贴板文本插到选中处（无选区则插光标处）。 */
async function pasteSelection(): Promise<boolean> {
  const editor = editorRef.value;
  if (!editor) return false;
  let text: string | null = null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    /* ignore */
  }
  if (!text) return false;
  const off = selectionOffsets() ?? { start: 0, end: 0 };
  const md = props.modelValue;
  const next = md.slice(0, off.start) + text + md.slice(off.end);
  applyMarkdownEdit(next, off.start + text.length, off.start + text.length);
  return true;
}

/** 删除选中区间。 */
function deleteSelection(): boolean {
  const off = selectionOffsets();
  if (!off) return false;
  const md = props.modelValue;
  applyMarkdownEdit(md.slice(0, off.start) + md.slice(off.end), off.start, off.start);
  return true;
}

/** 全选整篇。 */
function selectAllEditor(): boolean {
  const editor = editorRef.value;
  const sel = window.getSelection();
  if (!editor || !sel) return false;
  const range = document.createRange();
  range.selectNodeContents(editor);
  sel.removeAllRanges();
  sel.addRange(range);
  if (document.activeElement !== editor) editor.focus();
  return true;
}

/** 编辑区内右键：交上层弹同一套右键菜单。 */
function onEditorContextMenu(e: MouseEvent) {
  e.preventDefault();
  emit("contextmenu", { x: e.clientX, y: e.clientY });
}

/* 供上层（DocumentViewer 工具栏）在 WYSIWYG 模式调用。 */
defineExpose({
  wrapSelection,
  applyLineStyle,
  insertCodeBlock,
  insertLink,
  focusedLineStyle,
  focusEditor,
  docSelectionOffsets,
  restoreDocSelection,
  selectRawRangeForFind,
  getEditorElement,
  getScrollContainer,
  selectionInsideEditor,
  getSelectionOffsets: selectionOffsets,
  setSelectionOffsets,
  copySelection,
  cutSelection,
  pasteSelection,
  deleteSelection,
  selectAllEditor,
});
</script>

<template>
  <div class="wysiwyg-pane">
    <div v-if="props.zenMode === 'off'" class="read-progress" aria-hidden="true">
      <span class="read-progress-fill" :style="{ width: scrollProgress * 100 + '%' }"></span>
    </div>

    <!-- 顶部状态栏 -->
    <div v-if="props.zenMode === 'off'" class="wysiwyg-meta">
      <span class="wysiwyg-meta-label">
        所见即所得
        <span class="wysiwyg-meta-sub">WYSIWYG · 原地编辑 · 点击暴露语法</span>
      </span>
      <span class="wysiwyg-meta-right">
        <!-- 内容上色切换开关 -->
        <button
          class="color-toggle"
          :class="{ active: contentColoringOn }"
          title="开启后按 标题 / 粗体 / 引用块 / 引号 / 括号 / 标点 / 特殊标记 / 字母 / 数字 给正文配色，只改文字颜色、不影响背景"
          @click="contentColoringOn = !contentColoringOn"
        >
          <Palette :size="11" :stroke-width="1.9" />
          内容上色
        </button>
        <span class="char-count">{{ (props.modelValue || "").length }} 字符</span>
      </span>
    </div>

    <!-- 所见即所得编辑纸面滚动区。
         悬停探测挂在纸面上：正文左侧留白属于纸面 padding，手柄就浮在那里，
         鼠标从段落挪到手柄的途中不会因为「离开正文容器」而让手柄消失。 -->
    <div ref="scrollRef" class="wysiwyg-scroll" @scroll="onScroll">
      <div
        ref="paperRef"
        class="paper-card"
        :style="paperCardStyle"
        @mousemove="onPaperMouseMove"
        @mouseleave="onPaperMouseLeave"
      >
        <!-- 块级拖拽插入提示线 -->
        <div
          v-if="docBlockDrag.isDragging && targetDropIndex >= 0"
          class="block-insertion-line"
          :style="{ top: targetInsertionTopPx + 'px' }"
        >
          <span class="insertion-dot left"></span>
          <span class="insertion-line-bar"></span>
          <span class="insertion-dot right"></span>
        </div>

        <!-- 段落拖拽手柄：浮在正文左侧留白内，悬停出现后带宽限期，
             鼠标移到它上面即锁定不消隐，可以从容按下拖拽。 -->
        <button
          v-if="hoveredBlockEl && !docBlockDrag.isDragging"
          class="block-drag-handle"
          :style="{ top: handleTopPx + 'px', height: handleHeightPx + 'px' }"
          title="按住拖拽以对换段落位置"
          @mouseenter="onHandleMouseEnter"
          @mousedown.stop.prevent="startBlockDragFromHandle"
        >
          <GripVertical :size="13" :stroke-width="1.8" />
        </button>

        <!-- 原地所见即所得编辑容器 -->
        <div
          ref="editorRef"
          class="markdown-body reading-view wysiwyg-editor"
          :class="{
            'content-colored': contentColoringOn,
            'first-line-indent': aiSettings.firstLineIndent,
            'drop-cap': aiSettings.dropCap,
            'spotlight-on': props.spotlightEnabled,
            ['grid-line-' + aiSettings.editorGridLine]: aiSettings.editorGridLine !== 'none',
          }"
          :style="readingViewStyle"
          contenteditable="true"
          spellcheck="false"
          data-placeholder="在此输入正文... 支持 Markdown 原地所见即所得编辑"
          @beforeinput="onEditorBeforeInput"
          @input="onInput"
          @compositionend="onCompositionEnd"
          @keydown="onKeydown"
          @paste="onPaste"
          @click="updateFocusState"
          @contextmenu="onEditorContextMenu"
        ></div>
      </div>
    </div>

    <!-- 全局拖拽跟随贴片 -->
    <Teleport to="body">
      <div
        v-if="docBlockDrag.isDragging && docBlockDrag.payload"
        class="block-drag-ghost"
        :style="{ left: docBlockDrag.pointerX + 'px', top: docBlockDrag.pointerY + 'px' }"
      >
        <GripVertical :size="13" :stroke-width="1.8" />
        <span class="block-drag-ghost-text">{{ docBlockDrag.payload.blockText }}</span>
      </div>
    </Teleport>

    <!-- 悬浮阅读进度圆环 -->
    <ReadingProgressRing
      :progress="scrollProgress"
      :source="props.modelValue"
      :target="scrollRef"
      :slot-key="(props.ringSlot || 'doc') + ':wysiwyg'"
      kind="preview"
      :inset-top="props.zenMode !== 'off' ? 10 : 43"
      :inset-right="14"
      :inset-bottom="10"
      :inset-left="14"
      :max-size="props.embedded ? 34 : RING_SIZE_MAX"
      :zen-mode="props.zenMode"
      :spotlight-active="props.spotlightEnabled"
      :doc-title="currentDocTitle"
      :zen-disabled="props.embedded || !!props.ringSlot"
      @toggleZen="emit('toggleZen', $event)"
      @toggleSpotlight="emit('toggleSpotlight', $event)"
      @jump="onRingJump"
      @update:source="updateFromRing"
      @save="showToast('已保存', '正文已更新并保存', 'edit')"
    />

    <!-- 退出禅定模式悬浮胶囊 -->
    <button
      v-if="props.zenMode !== 'off'"
      class="zen-exit-pill"
      title="退出禅定专注模式 (或按 ESC)"
      @click="emit('toggleZen', 'off')"
    >
      <X :size="12" :stroke-width="2" />
      <span>退出禅定 (ESC)</span>
    </button>
  </div>
</template>

<style scoped>
.wysiwyg-pane {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-width: 0;
  min-height: 0;
  background: var(--reading-surface);
}

.wysiwyg-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 1px solid var(--reading-border);
  font-family: var(--code-font);
  font-size: 11px;
  color: var(--on-surface-variant);
  background: var(--reading-surface);
  flex-shrink: 0;
  opacity: 0.9;
}

.wysiwyg-meta-label {
  font-weight: 600;
  color: var(--primary);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wysiwyg-meta-sub {
  font-size: 10px;
  font-weight: 400;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.wysiwyg-meta-right {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
}

.char-count {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.color-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--reading-border);
  border-radius: 5px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-family: var(--code-font);
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
}

.color-toggle:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.color-toggle.active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-fixed);
}

.wysiwyg-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--reading-surface);
}

.paper-card {
  position: relative;
  background: transparent;
  width: 100%;
  /* 不再收窄纸面：正文列由对称的 --ed-pad-x 居中，宽度与 markdown 编辑区一致。 */
  max-width: none;
  min-height: 100%;
  box-sizing: border-box;
  margin: 0 auto;
}

.wysiwyg-editor {
  outline: none;
  min-height: calc(100vh - 200px);
  cursor: text;
  word-break: break-word;
  user-select: text;
  -webkit-user-select: text;
}

.wysiwyg-editor:empty::before {
  content: attr(data-placeholder);
  color: var(--reading-text-faint);
  pointer-events: none;
}

/* ---------------- 块级排版：补齐 div 承载块的垂直节奏 ----------------

   全局 style.css 里的 .reading-view 排版规则是按语义标签写的（p / h1–h6 /
   blockquote / ul / li / pre）。本编辑器为了在原地承载「可编辑的语法标记」，
   列表项与分割线只能用 div 承载（li 内嵌 span 会被浏览器的列表标记机制干扰），
   而裸 div 的 margin 是 0 —— 少了这一组规则，段落、列表、分割线就会全挤在
   一起，没有任何行间留白。这里按与 .reading-view 同一档的间距把它们补齐，
   数值与 style.css 的 p / ul / blockquote 保持一致，两种视图排版观感统一。 */

:deep(.md-block) {
  position: relative;
}

/* 顶层段落：与 markdown 编辑区同一行的行距节拍 —— 每个物理行占一个
   --ed-line-height 的行框、上下零外间距，段落之间没有额外空隙
   （空行由 .md-empty 单独占一整行）。这里必须以高于全局
   .reading-view p 的优先级覆盖其 margin / line-height，否则全局那套
   「每段自成一块」的读屏间距会把行间撑出较大空隙。 */
:deep(.md-block.md-p) {
  margin: 0;
  line-height: inherit;
  min-height: 1em;
}

/* 空段落（连续回车留出的空行）也要占住与正文行同高的一整行，光标可落脚，
   与 markdown 编辑区里的空白行观感一致。 */
:deep(.md-block.md-p.md-empty) {
  margin: 0;
  min-height: calc(var(--ed-line-height-px, 1.5em));
}

/* ---------------- 背景网格线（排版与字体 → 网格线） ----------------
   与 markdown 编辑区同一套三类网格：以 --ed-line-height-px 为行距逐行落下、
   background-attachment: local 使行线随文字内容一起滚动。 */
.wysiwyg-editor.grid-line-solid {
  background-image: linear-gradient(
    to bottom,
    transparent calc(100% - 1px),
    var(--grid-line-color, rgba(140, 140, 140, 0.35)) 1px
  );
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 0;
  background-attachment: local;
  background-repeat: repeat-y;
}

.wysiwyg-editor.grid-line-dashed {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' overflow='visible'%3E%3Cline x1='0' y1='calc(100%25 - 0.5px)' x2='100%25' y2='calc(100%25 - 0.5px)' stroke='rgba(120, 120, 120, 0.55)' stroke-width='1' stroke-dasharray='6 3' shape-rendering='crispEdges'/%3E%3C/svg%3E");
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 0;
  background-attachment: local;
  background-repeat: repeat-y;
}

.wysiwyg-editor.grid-line-dotted {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' overflow='visible'%3E%3Cline x1='0' y1='calc(100%25 - 0.5px)' x2='100%25' y2='calc(100%25 - 0.5px)' stroke='rgba(110, 110, 110, 0.65)' stroke-width='1.2' stroke-dasharray='2 3' shape-rendering='crispEdges'/%3E%3C/svg%3E");
  background-size: 100% var(--ed-line-height-px, 28px);
  background-position: 0 0;
  background-attachment: local;
  background-repeat: repeat-y;
}

/* 标题：div/h 混排时统一取全局 .reading-view h* 的上下留白。
   标题标签本身是 h1–h6，全局规则已生效，这里只补 .md-content 的行内表现。 */
:deep(.md-block[data-block-type^="h"] .md-content) {
  display: inline;
}

/* 列表项：用 div 承载，缩进与项目符号自绘，间距对齐 .reading-view li。 */
:deep(.md-list-item) {
  margin: 0.24em 0;
  padding-left: 1.6em;
  text-indent: -1.6em;
  line-height: inherit;
}

/* 列表块的首尾与相邻段落之间留出成组的间距，让列表整体成为一个视觉块。 */
:deep(.md-list-item + .md-p),
:deep(.md-p + .md-list-item) {
  margin-top: 0.9em;
}

/* 引用块：blockquote 标签已吃到全局规则，这里只把内部行内元素摆平。 */
:deep(.md-quote) {
  margin: 1.15em 0;
}

:deep(.md-quote .md-content) {
  display: inline;
}

/* 分割线：div 包一条 hr，上下给足呼吸。 */
:deep(.md-hr) {
  margin: 1.9em 0;
  line-height: 1;
}

:deep(.md-hr hr) {
  margin: 0;
  border: none;
  border-top: 1px solid var(--reading-border);
}

/* 激活分割线时暴露 --- 语法，此时把 hr 让位给文本，避免语法与线重叠。 */
:deep(.md-hr.is-focused hr) {
  display: none;
}

/* 代码块：pre 已有全局规则，这里补围栏行的位置与内部代码的换行表现。 */
:deep(.md-code-block) {
  margin: 1.2em 0;
}

:deep(.md-code-block code) {
  display: block;
  white-space: pre-wrap;
}

/* 首个块不带上间距，末块不带下间距，纸面上下留白由 paper-card 统一负责。 */
:deep(.md-block:first-child) {
  margin-top: 0;
}

:deep(.md-block:last-child) {
  margin-bottom: 0;
}

/* ---------------- 语法折叠与原地暴露核心机制 ---------------- */

:deep(.md-syntax) {
  display: none;
  font-family: var(--code-font);
  color: var(--primary);
  opacity: 0.65;
  font-size: 0.9em;
  font-weight: normal;
  font-style: normal;
  letter-spacing: 0;
  vertical-align: baseline;
  user-select: text;
  -webkit-user-select: text;
}

/* 当块级元素激活时，原地展开该块内的 Markdown 语法 */
:deep(.md-block.is-focused > .md-syntax),
:deep(.md-block.is-focused .md-syntax),
:deep(.md-inline.is-focused .md-syntax) {
  display: inline;
}

/* 处于激活状态的块给予微弱呼吸底色，强化当前光标所在行的空间归属感 */
:deep(.md-block.is-focused) {
  background: rgb(var(--primary-rgb) / 0.03);
  border-radius: 4px;
}

/* ---------------- 查找命中高亮（与 textarea 覆盖层 / 预览区同一套视觉） ----------------
   由 applyFindHighlight 就地包裹 <mark>，关闭查找后拆掉。 */

:deep(mark.find-hit) {
  background: rgb(var(--primary-rgb) / 0.26);
  color: inherit;
  border-radius: 3px;
  padding: 0 2px;
}

:deep(mark.find-hit-current) {
  background: #fdba2d;
  box-shadow: 0 0 0 2px var(--on-surface), inset 0 0 0 1px #fff;
  color: var(--on-surface);
  font-weight: 700;
}

/* 命中词落在斜体 / 粗体里时，荧光底优先于样式色。 */
:deep(em mark.find-hit),
:deep(strong mark.find-hit) {
  background: rgb(var(--primary-rgb) / 0.34);
}

/* 列表项在非激活状态下显示实心圆点或序号，激活时隐藏圆点并暴露出 - 或 1. 语法 */
:deep(.md-bullet),
:deep(.md-number) {
  display: inline-block;
  color: var(--primary);
  margin-right: 6px;
  user-select: none;
}

:deep(.md-block.is-focused .md-bullet),
:deep(.md-block.is-focused .md-number) {
  display: none;
}

:deep(.code-fence-top),
:deep(.code-fence-bottom) {
  display: none;
  color: var(--reading-text-faint);
  font-size: 11px;
}

:deep(.md-block.is-focused .code-fence-top),
:deep(.md-block.is-focused .code-fence-bottom) {
  display: block;
}

/* ---------------- 段落聚光灯 (Spotlight) ----------------
   与预览/编辑器两侧同一套参数：默认整篇压暗并轻微模糊，
   指针所在的段落恢复全亮，方便逐段专注浏览。 */
.wysiwyg-editor.spotlight-on :deep(.md-block) {
  opacity: calc(v-bind('aiSettings.spotlightOpacity') / 100) !important;
  filter: blur(calc(v-bind('aiSettings.spotlightBlur') * 1px)) grayscale(0.2) !important;
  transition: opacity 0.22s ease, filter 0.22s ease, transform 0.22s ease;
  user-select: none;
  cursor: pointer;
}

.wysiwyg-editor.spotlight-on :deep(.md-block:hover),
.wysiwyg-editor.spotlight-on :deep(.md-block.spotlight-target) {
  opacity: 1 !important;
  filter: none !important;
  transform: scale(1.008);
  user-select: text;
  cursor: text;
}

/* ---------------- 段落块悬停手柄与拖拽对换机制 ----------------
   与 markdown 编辑区行块句柄同一套视觉与定位：透明无框无阴影的图标手柄，
   悬浮在正文列左侧留白内，高度由脚本按该块真实行高设定，图标与行文中线对齐。 */
.block-drag-handle {
  position: absolute;
  /* 与 markdown 编辑区手柄同一条位置公式：以 --ed-pad-x（正文列起点）为基准
     向左让出 38px 留白，窄窗时回退 2px 兜底，保证两种视图手柄齐位。 */
  left: max(2px, calc(var(--ed-pad-x, 22px) - 38px));
  z-index: 30;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  opacity: 0.9;
  cursor: grab;
  padding: 0;
  transition: color 0.12s ease, opacity 0.12s ease;
}

/* 放大可命中范围，指针在手柄附近的抖动不会掉出去。 */
.block-drag-handle::before {
  content: "";
  position: absolute;
  inset: -8px -10px;
}

.block-drag-handle:hover {
  color: var(--primary);
  opacity: 1;
}

.block-drag-handle:active {
  cursor: grabbing;
}

/* 拖拽位置插入线 */
.block-insertion-line {
  position: absolute;
  left: 0;
  right: 0;
  z-index: 20;
  height: 0;
  display: flex;
  align-items: center;
  pointer-events: none;
  transform: translateY(-1px);
}

.insertion-line-bar {
  flex: 1;
  height: 2px;
  background: var(--primary);
  box-shadow: 0 0 6px rgb(var(--primary-rgb) / 0.55);
  border-radius: 2px;
}

.insertion-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--primary);
  flex-shrink: 0;
  box-shadow: 0 0 5px rgb(var(--primary-rgb) / 0.6);
}

/* 全局拖拽跟随贴片 */
.block-drag-ghost {
  position: fixed;
  z-index: 9999;
  transform: translate(12px, -50%);
  max-width: 320px;
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 7px 12px;
  border: 1px solid var(--primary);
  border-radius: 8px;
  background: var(--surface-bright, #fff);
  box-shadow: 0 10px 26px -6px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.block-drag-ghost-text {
  font-size: 12px;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 进度条 */
.read-progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: transparent;
  z-index: 10;
  pointer-events: none;
}

.read-progress-fill {
  display: block;
  height: 100%;
  background: var(--primary);
  transition: width 0.1s linear;
}

.zen-exit-pill {
  position: absolute;
  top: 14px;
  right: 20px;
  z-index: 20;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 11px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
</style>
