/**
 * 精修的文本切分与模型回复解析。
 *
 * 从 RefineView.vue 里单独拆出来的两个纯函数：断句决定了「一句」的边界（进而
 * 决定标点合并要保护哪些符号），逐行解析决定了模型的回复能不能对上号。两者
 * 出错都会表现成「大面积没修订」，却和标点保护无关，所以值得单独成模块并测。
 */

/** 句末标点。省略号不算：中文里「他……没说话。」的省略号在句中，切开会碎句。 */
const SENTENCE_END = "。！？!?.";

/** 跟在句末标点后面、仍属于本句的收尾符号（右引号、右括号、书名号）。 */
const SENTENCE_CLOSER = "”\"』」）)]】》〉";

/**
 * 断句：按句末标点切分，连写的终止标点与右引号 / 右括号跟着前一句走。
 *
 * 之前用的 `text.split(/(?<=[。！？.!?])/g)` 有三处会切坏：
 *  · 「他说：“走吧。”于是两人推门出去。」被切成 `他说：“走吧。` +
 *    `”于是两人推门出去。` —— 后一句以孤立右引号开头，既不像人话，也给标点
 *    合并凭空多加一个必须保护的符号；
 *  · 「真的吗？！」被切成 `真的吗？` + `！`，凭空多出一个只有标点的「句子」；
 *  · 「3.14」在小数点处被切开。
 *
 * 所以改成逐字扫描：终止标点成串吞掉、收尾符号并入本句、数字/字母之间的
 * 半角句点不算句末。切分是无损的 —— 各段拼回去等于原文（只过滤纯空白段）。
 */
export function splitSentences(text: string): string[] {
  const out: string[] = [];
  let buf = "";
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    buf += ch;
    if (!SENTENCE_END.includes(ch)) continue;
    /* 3.14 / e.g. 这类词内半角句点不是句末。 */
    if (
      (ch === "." || ch === "!" || ch === "?") &&
      /[0-9A-Za-z]/.test(chars[i - 1] ?? "") &&
      /[0-9A-Za-z]/.test(chars[i + 1] ?? "")
    ) {
      continue;
    }
    /* 吞掉连写的终止标点（「？！」）与随后的收尾符号（右引号 / 右括号）。 */
    while (i + 1 < chars.length && SENTENCE_END.includes(chars[i + 1])) {
      buf += chars[++i];
    }
    while (i + 1 < chars.length && SENTENCE_CLOSER.includes(chars[i + 1])) {
      buf += chars[++i];
    }
    out.push(buf);
    buf = "";
  }
  if (buf) out.push(buf);
  return out.filter((s) => s.trim());
}

/**
 * 解析模型的逐行输出。
 *
 * 兼容常见的编号写法：[1]、**[1]**、1.、1)、（1）、【1】、［1］、1：、第1句：等，
 * 以及首尾包裹的 markdown 强调 / 围栏噪声。解析不到的行保持空串（= 按原文保留），
 * 由调用方通过 parsed 命中率判断整组是否格式异常，避免把「没解析出来」误显示成
 * 「AI 判定无需修改」。
 *
 * 「1.」后面不带空格的写法也认（模型很常这么写），但用负向前瞻挡掉小数：
 * 「3.14 是圆周率」不会被当成第 3 句。
 */
export function parseRefinedLines(
  text: string,
  count: number,
): { lines: string[]; parsed: number } {
  const out: string[] = [];
  const stripMarkdown = (s: string) => s.replace(/^[\s*_#>`~]+|[\s*_#>`~]+$/g, "").trim();
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    /* 跳过代码围栏 / 表格分隔线等非句子行。 */
    if (/^[`~]{3,}/.test(line) || /^[-|+:]+$/.test(line)) continue;
    const body = stripMarkdown(line);
    const m = body.match(
      /^(?:[-*+·]\s+)?(?:第\s*)?(?:\[(\d+)\](?:[.:：,，、])?|（(\d+)）|【(\d+)】|［(\d+)］|\((\d+)\)|(\d+)\s*(?:句|条)?\s*[、)）:：]|(\d+)\s*\.(?!\d)\s*)\s*(.*)$/,
    );
    if (!m) continue;
    const idx = Number(m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? m[6] ?? m[7]) - 1;
    if (idx < 0 || idx >= count) continue;
    /* 清掉编号与正文之间残留的 markdown 强调（如「**[1]** 甲」里第二个星号）。 */
    const content = m[8].replace(/^[*_~`]+\s*|\s*[*_~`]+$/g, "").trim();
    if (!content) continue;
    out[idx] = content;
  }
  const lines = Array.from({ length: count }, (_, i) => out[i] ?? "");
  return { lines, parsed: out.filter((l) => !!l).length };
}
