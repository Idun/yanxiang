import { reactive, ref } from "vue";

/**
 * 内容上色（抓阄配色）。
 *
 * 给文档预览区的正文按字符类别上一套「抓阄」配色，帮作者一眼看出：
 * 引号有没有配全、括号有没有配对、标点是否误用、夹带了什么特殊标记，
 * 以及正文里混进了英文 / 数字；并按元素区分 标题 H1–H5 / 引用块 / 粗体。
 * markdown 与纯文本都走 renderMarkdown 渲染，统一在这里着色，
 * 因此两套文档都适用。
 *
 * 实现是「对渲染后的 HTML 字符串做一次序列化扫描」：
 *  - 标签原样透传，只对标签之间的文本按类别着色（引号 / 括号状态跨标签续接）；
 *  - `<pre>` / `<code>` / `<script>` / `<style>` 里是代码与排版源码，整体跳过上色；
 *  - 着色只改文字颜色、不动背景，输出依然是合法 HTML，交由 v-html 渲染。
 */

/* ---------------- 配色方案 ---------------- */

/** 内容上色默认配色方案（浅色阅读面）。 */
export const DEFAULT_CONTENT_COLOR_SCHEME: Record<string, string> = {
  /** 正文 */
  body: "#383a42",
  /** 引号内文字（“ ” ‘ ’ 「 」 『 』 《 》 〈 〉 直引号） */
  quote: "#cb4b16",
  /** 括号内文字（( ) [ ] { } （ ） 【 】 〔 〕 ［ ］ ｛ ｝） */
  bracket: "#268bd2",
  /** 标点（。，！？；：、…—·等） */
  punctuation: "#2aa198",
  /** 特殊标记（# * | ~ ★ ☆ ※ 箭头 等） */
  special: "#dc322f",
  /** 字母（A-Z a-z 全角Ａ-Ｚ ａ-ｚ） */
  letter: "#b58900",
  /** 数字（0-9 全角０-９） */
  digit: "#d33682",
  /** 引用块文字（> 引用） */
  blockquote: "#22863a",
  /** 粗体（** ... **） */
  bold: "#d73a49",
  /** 标题 H1；H2–H5 依次减弱色值，便于肉眼区分层级 */
  heading1: "#e36209",
  /** 标题 H2 */
  heading2: "#e87e35",
  /** 标题 H3 */
  heading3: "#ed975d",
  /** 标题 H4 */
  heading4: "#f1b184",
  /** 标题 H5 */
  heading5: "#f5c6a6",
};

export const CONTENT_COLOR_SCHEME = DEFAULT_CONTENT_COLOR_SCHEME;

/** 动态可自定义的内容上色配色方案（即时生效）。 */
export const customContentColorScheme = reactive<Record<string, string>>({
  ...DEFAULT_CONTENT_COLOR_SCHEME,
});

/** 可上色的字符与语法元素项定义列表 */
export const CONTENT_COLOR_ITEMS: { key: string; label: string }[] = [
  { key: "body", label: "正文" },
  { key: "quote", label: "引号内文字" },
  { key: "bracket", label: "括号内文字" },
  { key: "punctuation", label: "标点" },
  { key: "special", label: "特殊标记" },
  { key: "letter", label: "字母" },
  { key: "digit", label: "数字" },
  { key: "blockquote", label: "引用块文字" },
  { key: "bold", label: "粗体" },
  { key: "heading1", label: "标题 H1" },
  { key: "heading2", label: "标题 H2" },
  { key: "heading3", label: "标题 H3" },
  { key: "heading4", label: "标题 H4" },
  { key: "heading5", label: "标题 H5" },
];

export function resetCustomContentColors() {
  Object.assign(customContentColorScheme, DEFAULT_CONTENT_COLOR_SCHEME);
}

export function setCustomContentColors(colors: Record<string, string>) {
  if (!colors || typeof colors !== "object") return;
  for (const key of Object.keys(DEFAULT_CONTENT_COLOR_SCHEME)) {
    if (colors[key]) {
      customContentColorScheme[key] = colors[key];
    }
  }
}

/**
 * 夜间配色方案：Adobe Photoshop 暗色界面同款中性灰阶。
 * 各字符类别按相对亮度拉开可辨的层级，但整体收敛为纯灰度，适配暗色阅读面。
 */
export const CONTENT_COLOR_SCHEME_NIGHT: Record<string, string> = {
  body: "#d3d3d3",
  quote: "#9d9d9d",
  bracket: "#8c8c8c",
  punctuation: "#b5b5b5",
  special: "#7e7e7e",
  letter: "#c9c9c9",
  digit: "#b0b0b0",
  blockquote: "#c2c2c2",
  bold: "#ededed",
  heading1: "#ffffff",
  heading2: "#f0f0f0",
  heading3: "#e1e1e1",
  heading4: "#d2d2d2",
  heading5: "#c3c3c3",
};

/** 全局开关：预览正文是否上色。默认开启。 */
export const contentColoringOn = ref(true);

/** 把配色方案映射为可挂在预览容器上的 CSS 变量（--zj-*）。night 时改用灰阶夜间方案。 */
export function contentColorCssVars(night = false): Record<string, string> {
  return contentColorCssVarsOf(night ? CONTENT_COLOR_SCHEME_NIGHT : customContentColorScheme);
}

/**
 * 同上，但配色由调用方给定 —— 供「设置 → 内容上色」的方案预览用：
 * 那里要按「正在调的草稿配色」渲染样张，而不是当前已生效的方案。
 */
export function contentColorCssVarsOf(c: Record<string, string>): Record<string, string> {
  return {
    "--zj-body": c.body || DEFAULT_CONTENT_COLOR_SCHEME.body,
    "--zj-quote": c.quote || DEFAULT_CONTENT_COLOR_SCHEME.quote,
    "--zj-bracket": c.bracket || DEFAULT_CONTENT_COLOR_SCHEME.bracket,
    "--zj-punct": c.punctuation || DEFAULT_CONTENT_COLOR_SCHEME.punctuation,
    "--zj-special": c.special || DEFAULT_CONTENT_COLOR_SCHEME.special,
    "--zj-letter": c.letter || DEFAULT_CONTENT_COLOR_SCHEME.letter,
    "--zj-digit": c.digit || DEFAULT_CONTENT_COLOR_SCHEME.digit,
    "--zj-blockquote": c.blockquote || DEFAULT_CONTENT_COLOR_SCHEME.blockquote,
    "--zj-bold": c.bold || DEFAULT_CONTENT_COLOR_SCHEME.bold,
    "--zj-heading1": c.heading1 || DEFAULT_CONTENT_COLOR_SCHEME.heading1,
    "--zj-heading2": c.heading2 || DEFAULT_CONTENT_COLOR_SCHEME.heading2,
    "--zj-heading3": c.heading3 || DEFAULT_CONTENT_COLOR_SCHEME.heading3,
    "--zj-heading4": c.heading4 || DEFAULT_CONTENT_COLOR_SCHEME.heading4,
    "--zj-heading5": c.heading5 || DEFAULT_CONTENT_COLOR_SCHEME.heading5,
  };
}

/* ---------------- 字符类别表 ---------------- */

/** 左引号。打开引号上下文，其后的内容按引号色着色。 */
const QUOTE_OPEN = new Set(["“", "‘", "「", "『", "《", "〈"]);
/** 右引号。关闭引号上下文。 */
const QUOTE_CLOSE = new Set(["”", "’", "」", "』", "》", "〉"]);
/** 左右同形的直引号（英文直引号）：靠「当前栈顶是不是同一种」来判开合。 */
const SYMMETRIC_QUOTE = new Set(['"', "'"]);

/** 左括号。压栈并按括号色着色。 */
const BRACKET_OPEN = new Set([
  "(", "[", "{", "（", "【", "〔", "［", "〖", "｛", "﹛",
]);
/** 右括号。弹栈。 */
const BRACKET_CLOSE = new Set([
  ")", "]", "}", "）", "】", "〕", "］", "〗", "｝", "﹜",
]);

/** 标点（引号 / 括号已在上面单列）。 */
const PUNCT = new Set([
  "，", "。", "！", "？", "；", "：", "、", "…", "—", "―", "·", "‥", "⋯", "．", "｡", "∶",
  ",", ".", "!", "?", ";", ":", "・", "﹒",
]);

/** 特殊标记：控制符 / 装饰符 / 罕见符号。 */
const SPECIAL = new Set([
  "#", "*", "＊", "|", "｜", "~", "～", "^", "@", "%", "％", "$", "&", "=", "+", "×", "÷", "±", "_", "/", "＼", "￥",
  "★", "☆", "※", "◎", "○", "●", "◇", "◆", "□", "■", "△", "▲", "▽", "▼",
  "♪", "♫", "♡", "♥", "→", "←", "↑", "↓", "⇒", "⇔", "§", "№", "¤", "™", "◎",
]);

const LETTER_RE = /[A-Za-zＡ-Ｚａ-ｚ]/;
const DIGIT_RE = /[0-9０-９]/;

/* ---------------- 序列化扫描 ---------------- */

type ColorClass =
  | "quote"
  | "bracket"
  | "punct"
  | "special"
  | "letter"
  | "digit"
  | "blockquote"
  | "bold"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5";

interface ColorState {
  quote: string[];
  bracket: string[];
}

/** 代码 / 排版源码区域：内部一律不上色（保留原样），也不参与引号匹配。 */
const SKIP_TAGS = new Set(["pre", "code", "script", "style"]);

/** 自闭合的空元素：不会 push 进标签栈。 */
const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input",
  "link", "meta", "param", "source", "track", "wbr",
]);

const TAG_RE = /^<\/?([a-zA-Z][a-zA-Z0-9-]*)/;

/**
 * 从标签栈里找出文本的「结构化上下文」颜色：
 * 标题 H1–H5 / 引用块 / 粗体。从最内层向外找，命中哪个就用哪个
 * （如 引用块 里的 粗体 仍是粗体色）。h6 及以上不在此列，按正文处理。
 */
function contextColorOf(stack: string[]): ColorClass | null {
  for (let k = stack.length - 1; k >= 0; k--) {
    const tag = stack[k];
    if (tag === "h1") return "heading1";
    if (tag === "h2") return "heading2";
    if (tag === "h3") return "heading3";
    if (tag === "h4") return "heading4";
    if (tag === "h5") return "heading5";
    if (tag === "blockquote") return "blockquote";
    if (tag === "strong" || tag === "b") return "bold";
  }
  return null;
}

/**
 * 给一挂文本逐字着色。
 *
 * 优先级：数字 / 字母 / 特殊标记 → 引号区域 → 括号区域 → 标点 → 上下文色
 * 标题 / 引用块 / 粗体 → 正文。
 * 数字、字母、特殊标记、标点在任何位置都保留自己的颜色（方便揪出对话里的
 * 英文与数字）；引号 / 括号内的文字跟随区域色，让整段对白一眼成块；
 * 剩下的普通字再按所在元素着 标题 / 引用块 / 粗体 色。
 * 引号 / 括号状态记在 state 上，跨标签/跨段续接 —— 缺了右引号时，
 * 其后所有正文都会被引号色贯穿，正是指名问题所在。
 */
function processText(buf: string, out: string[], state: ColorState, context: ColorClass | null) {
  const classify = (ch: string): ColorClass | null => {
    if (DIGIT_RE.test(ch)) return "digit";
    if (LETTER_RE.test(ch)) return "letter";
    if (SPECIAL.has(ch)) return "special";
    /* 直引号左右同形：栈顶是同一个就是收，否则是开。 */
    if (SYMMETRIC_QUOTE.has(ch)) {
      const top = state.quote[state.quote.length - 1];
      if (top === ch) state.quote.pop();
      else state.quote.push(ch);
      return "quote";
    }
    if (QUOTE_OPEN.has(ch)) {
      state.quote.push(ch);
      return "quote";
    }
    if (QUOTE_CLOSE.has(ch)) {
      if (state.quote.length > 0) state.quote.pop();
      return "quote";
    }
    if (BRACKET_OPEN.has(ch)) {
      state.bracket.push(ch);
      return "bracket";
    }
    if (BRACKET_CLOSE.has(ch)) {
      if (state.bracket.length > 0) state.bracket.pop();
      return "bracket";
    }
    if (state.quote.length > 0) return "quote";
    if (state.bracket.length > 0) return "bracket";
    if (PUNCT.has(ch)) return "punct";
    return context;
  };

  let cls: ColorClass | null = null;
  let text = "";
  const flush = () => {
    if (text) {
      out.push(cls ? `<span class="zj-${cls}">${text}</span>` : text);
    }
    cls = null;
    text = "";
  };

  for (const ch of buf) {
    const next = classify(ch);
    if (next !== cls) {
      flush();
      cls = next;
    }
    text += ch;
  }
  flush();
}

/** 标签栈里最深的那层「跳过上色」标签；没有则 undefined。 */
function deepestSkip(stack: string[]): string | undefined {
  for (let k = stack.length - 1; k >= 0; k--) {
    if (SKIP_TAGS.has(stack[k])) return stack[k];
  }
  return undefined;
}

/**
 * 给渲染好的 HTML 上一套内容配色。原样返回已是合法 HTML 字符串。
 *
 * @param html renderMarkdown 输出的 HTML（可再叠加查找高亮 / 修订定位标记）
 */
export function applyContentColoring(html: string): string {
  const out: string[] = [];
  const stack: string[] = [];
  const state: ColorState = { quote: [], bracket: [] };
  let textBuf = "";

  const flushText = () => {
    if (textBuf) {
      processText(textBuf, out, state, contextColorOf(stack));
      textBuf = "";
    }
  };

  let i = 0;
  const n = html.length;
  while (i < n) {
    const skipTag = deepestSkip(stack);

    /* 代码 / 源码区域：整段原样透传，直到遇到对应关闭标签。 */
    if (skipTag) {
      const nextLt = html.indexOf("<", i);
      if (nextLt === -1) {
        out.push(html.slice(i));
        break;
      }
      const closeRe = new RegExp(`</${skipTag}\\s*>`, "i");
      const m = closeRe.exec(html.slice(nextLt));
      if (m && m.index === 0) {
        const raw = html.slice(nextLt, nextLt + m[0].length);
        out.push(html.slice(i, nextLt), raw);
        while (stack.length > 0 && stack[stack.length - 1] !== skipTag) stack.pop();
        if (stack.length > 0) stack.pop();
        i = nextLt + m[0].length;
        continue;
      }
      out.push(html.slice(i, nextLt + 1));
      i = nextLt + 1;
      continue;
    }

    const ch = html[i];

    /* 标签：原样透传，维护标签栈。 */
    if (ch === "<") {
      const m = TAG_RE.exec(html.slice(i));
      if (m) {
        const name = m[1].toLowerCase();
        const gt = html.indexOf(">", i);
        if (gt !== -1) {
          const raw = html.slice(i, gt + 1);
          flushText();
          out.push(raw);
          if (raw[1] === "/") {
            for (let k = stack.length - 1; k >= 0; k--) {
              if (stack[k] === name) {
                stack.splice(k, 1);
                break;
              }
            }
          } else if (!/\/\s*>$/.test(raw) && !VOID_TAGS.has(name)) {
            stack.push(name);
          }
          i = gt + 1;
          continue;
        }
      }
      /* 不是合法标签：当普通文本处理。 */
      textBuf += ch;
      i++;
      continue;
    }

    /* HTML 实体：整体透传，不拆开着色。 */
    if (ch === "&") {
      const semi = html.indexOf(";", i);
      if (semi !== -1 && semi - i <= 12) {
        flushText();
        out.push(html.slice(i, semi + 1));
        i = semi + 1;
        continue;
      }
    }

    /* 普通文本：一次吞到下一个标签 / 实体边界再进缓冲区，避免逐字拼接。 */
    let j = i;
    while (j < n && html[j] !== "<" && html[j] !== "&") j++;
    if (j === i) {
      /* '&' 不成实体（或过长）时仍要前进，否则会原地空转。 */
      textBuf += html[i];
      i++;
    } else {
      textBuf += html.slice(i, j);
      i = j;
    }
  }

  flushText();
  return out.join("");
}