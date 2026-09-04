import { marked } from "marked";
import hljs from "highlight.js";
import "highlight.js/styles/github.css";
import { isPureChapterTitle, matchChapterLine } from "./readingOutline";

/**
 * Configure marked to highlight fenced code blocks with highlight.js.
 */
const renderer = new marked.Renderer();

renderer.code = (code: string, infostring: string | undefined) => {
  const language = (infostring ?? "").trim().split(/\s+/)[0] || "";
  const validLang = language && hljs.getLanguage(language);
  const highlighted = validLang
    ? hljs.highlight(code, { language }).value
    : hljs.highlightAuto(code).value;

  const langClass = validLang ? ` language-${language}` : "";
  return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>`;
};

marked.setOptions({
  gfm: true,
  breaks: true,
  renderer,
});

function preprocessMarkers(input: string): string {
  /* The `{{AI:...\/}}` terminator is written as backslash + slash. A lazy
   * capture like `(.+?)\/` would swallow that backslash, and the raw
   * `\</span>` then gets treated by marked as an escape so the injected
   * closing tag leaks into the page as literal text (`&lt;/span&gt;`).
   * Capture the content lazily and consume the optional backslash as part
   * of the closing delimiter so the span stays well-formed. */
  return input
    .replace(/\{\{\+(.+?)\+\}\}/gs, '<span class="diff-add">$1</span>')
    .replace(/\{\{-(.+?)-\}\}/gs, '<span class="diff-del">$1</span>')
    .replace(/\{\{~(.+?)~\}\}/gs, '<span class="diff-replace">$1</span>')
    .replace(/\{\{AI:([\s\S]*?)(?:\\?\/)\}\}/gs, '<span class="ai-generated">$1</span>');
}

export function renderMarkdown(input: string): string {
  const processed = preprocessMarkers(input);
  return marked.parse(processed, { async: false }) as string;
}

/**
 * 段首字面空白的最小化归一。小说原文的段首常自带全角空格「　　」；
 * 阅读视图又用 CSS `text-indent: 2em` 统一缩进 —— 两套机制叠加会让
 * 段落（尤其首字下沉时被归零缩进的那段之后的正文）多缩进两个字符。
 * 这里把段首的字面空格 / 制表符剥掉，让缩进只由 CSS 负责。
 *
 * 只剥「段落行」：以 Markdown 结构标记开头的行（列表 / 引用 / 表格 /
 * 标题 / 分割线）保留原样，避免破坏结构；围栏代码块内部也不动。
 * 纯文本一律剥全角 + 空格 + 制表符；Markdown 文档只剥全角空格
 * （半角缩进可能是 4 空格触发的代码块，不能烧）。 */
const FENCE_LINE_RE = /^[ \t]{0,3}(```+|~~~+)/;
const STRUCTURAL_LINE_RE =
  /^(#{1,6}\s|>\s?|```|~~~|[-+*]\s|\d+[.)]\s|\|.*\|\s*$|([-*_](\s*[-*_]){2,}|={3,}|-{3,})\s*$)/;

/**
 * 预处理器：把 reading 渲染原始文本里每行的段首字面空白按需剥掉。
 * 返回处理后的整段文本；结构行与围栏内部原样保留。
 */
function normalizeParagraphIndents(input: string, stripAscii: boolean): string {
  const chunk = stripAscii ? "[ \t\u3000]+" : "\u3000+";
  const leadingRe = new RegExp(`^(${chunk})`);
  let inFence = false;
  return input
    .split("\n")
    .map((line) => {
      if (FENCE_LINE_RE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const m = leadingRe.exec(line);
      if (!m) return line;
      const body = line.slice(m[0].length);
      if (STRUCTURAL_LINE_RE.test(body.trimStart())) return line;
      return body;
    })
    .join("\n");
}

/**
 * 纯文本章节标题行的预览渲染：整行命中（第一章 / 楔子 / 1、…）时，在预览层
 * 提升为真正的 Markdown 标题，让章节标题本身不再参与「行首缩进」，其下正文
 * 自动独立成段、各自首行缩进两格；同时内容上色会按标题上下文给标题上色。
 * 提升成标题后，每一章的开头段落都是「紧跟标题的第一个顶层段落」，
 * 首字下沉便能逐章独立生效（对应 CSS 的 `h* + p::first-letter`）。
 *
 * 只改预览，不动原文。复用 readingOutline 同源的一套章节识别规则；与阅读目录
 * 保持同一门控——文档里已含 Markdown 标题（# / Setext 下划线）时不做转换，
 * 避免把普通段落里的「第三章」误当标题。
 */
export function renderForReading(input: string): string {
  if (/^\s{0,3}#{1,6}\s+/m.test(input) || /^\s*(=|-){3,}\s*$/m.test(input)) {
    return renderMarkdown(normalizeParagraphIndents(input, false));
  }
  return renderMarkdown(
    normalizeParagraphIndents(input, true)
      .split("\n")
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.length > 0 && trimmed.length <= 60 && isPureChapterTitle(trimmed)) {
          const level = matchChapterLine(trimmed)?.level === 1 ? "# " : "## ";
          /* 缩进必须丢掉：小说正文常给章节行也留两个全角空格 / 若干半角空格，
             而 ATX 标题只允许 0–3 个半角空格缩进 —— 原样带上缩进的话，
             「　　第二章」不会被解析成标题，只能当普通段落，
             这一章的正文开头段落就既拿不到 `h* + p` 的首字下沉，
             也会被算进行首缩进。标题在阅读视图里本就不缩进，去掉无副作用。 */
          return `${level}${trimmed}`;
        }
        return line;
      })
      .join("\n"),
  );
}

/**
 * 判断给定的文本是否为纯文本正文（无 Markdown 结构语法/标记）。
 * 用于「行首缩进」与「首字下沉」判定：包含 Markdown 语法（标题、粗体、列表、引用块、代码块等）
 * 时返回 false，避免应用缩进/下沉导致排版混乱。
 */
export function isPurePlainText(text: string): boolean {
  if (!text || !text.trim()) return true;

  // 结构化 Markdown 语法：出现即视为 Markdown 文档（这些在纯文本小说/散文里几乎不会出现）
  // 1. 标题 (# 标题 或 === / --- 下划线)
  if (/^\s{0,3}#{1,6}\s+/m.test(text)) return false;
  if (/^\s*(=|-){3,}\s*$/m.test(text)) return false;
  // 2. 引用块 (> 引用)
  if (/^\s{0,3}>\s+/m.test(text)) return false;
  // 3. 代码块 (``` 或 ~~~)
  if (/^\s{0,3}(```|~~~)/m.test(text)) return false;
  // 4. 分割线 (---, ***, ___)
  if (/^\s{0,3}([\-*_]\s*){3,}\s*$/m.test(text)) return false;
  // 5. 行内代码 (`代码`)
  if (/`[^`\n]+`/.test(text)) return false;
  // 6. 链接 / 图片 ([文本](链接) 或 ![Alt](链接))
  if (/!?\[[^\]]*\]\([^)]*\)/.test(text)) return false;
  // 7. 表格 (| 列 |)
  if (/^\s*\|.*\|\s*$/m.test(text)) return false;
  // 8. 强标记（粗体 / 删除线）：成对包裹、内容不能跨空行，出现即视为 Markdown
  if (/\*\*[^\n*]+?\*\*|__[^\n_]+?__|~~[^\n~]+?~~/.test(text)) return false;

  // 弱标记：需要出现 >= 2 处才判定为真正的列表 / 斜体，避免把
  // 「1. 章节行」「- 对话引子」这类小说排版误判成 Markdown。
  // 9. 无序 / 有序列表
  const bulletCount = (text.match(/^\s{0,3}[-+*]\s+/gm) || []).length;
  const orderedCount = (text.match(/^\s{0,3}\d+[.)]\s+/gm) || []).length;
  if (bulletCount + orderedCount >= 2) return false;
  // 10. 单星号 / 单下划线 斜体
  const italicCount =
    (text.match(/\*[^\s*][^*\n]*\*/g) || []).length +
    (text.match(/_[^\s_][_\n]*_/g) || []).length;
  if (italicCount >= 2) return false;

  return true;
}
