import { RuleCategory, WritingRuleItem } from "../types/writingRules";

/**
 * 正文中的「写作规范命中」区间。
 *
 * severity 决定编辑区用哪一种视觉：
 *   warn —— 禁用词汇 / 禁用句式，红色波浪线，属于要改掉的东西；
 *   hint —— 写作手法 / 常用词汇 / 常用句式，青绿色点线，属于可选参考。
 */
export type WritingRuleSeverity = "warn" | "hint";

export interface WritingRuleMark {
  start: number;
  end: number;
  ruleId: string;
  name: string;
  description?: string;
  category: RuleCategory;
  severity: WritingRuleSeverity;
}

const BANNED_CATEGORIES: RuleCategory[] = ["banned_word", "banned_sentence"];

export function severityOf(category: RuleCategory): WritingRuleSeverity {
  return BANNED_CATEGORIES.includes(category) ? "warn" : "hint";
}

/** 转义正则元字符：规范词条按字面匹配，`[说明]`、`A.I.` 这类不能当正则语法解析。 */
export function escapeRuleRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 在任意文本里找某个规范词条的全部命中区间。
 *
 * 这是「正文命中 N 次」、markdown 覆盖层波浪线与 WYSIWYG 就地包裹共用的唯一匹配口径：
 * 省略号 / 顿号 / 空白视作断点，单段按整串匹配，多段则允许中间最多 40 个字符的跨度。
 * 两侧必须走同一套逻辑，否则「不仅……而且……」这类句式会只在 markdown 里画线、
 * WYSIWYG 里什么都看不到。
 */
export function matchRuleKeywordRanges(text: string, keyword: string): Array<[number, number]> {
  const cleaned = keyword.replace(/[…\.、\s]+/g, " ").trim();
  if (!cleaned) return [];

  const parts = cleaned.split(" ").filter(Boolean);
  const ranges: Array<[number, number]> = [];

  try {
    if (parts.length === 1) {
      const regex = new RegExp(escapeRuleRegex(parts[0]), "gi");
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        ranges.push([m.index, m.index + m[0].length]);
      }
    } else {
      const pattern = parts.map(escapeRuleRegex).join("[\\s\\S]{1,40}?");
      const regex = new RegExp(pattern, "gi");
      let m: RegExpExecArray | null;
      while ((m = regex.exec(text)) !== null) {
        if (m[0].length === 0) {
          regex.lastIndex++;
          continue;
        }
        ranges.push([m.index, m.index + m[0].length]);
      }
    }
  } catch {
    return [];
  }

  return ranges;
}

/**
 * 把所有规范条目在正文里的命中位置摊平成区间列表，并按起点排序。
 * 同名规则只保留一条区间记录，避免重叠条目在覆盖层里互相打架。
 */
export function collectWritingRuleMarks(
  text: string,
  rules: WritingRuleItem[],
): WritingRuleMark[] {
  if (!text || !Array.isArray(rules) || rules.length === 0) return [];

  const marks: WritingRuleMark[] = [];
  for (const rule of rules) {
    if (!rule || !rule.name || !rule.name.trim()) continue;
    for (const [start, end] of matchRuleKeywordRanges(text, rule.name)) {
      marks.push({
        start,
        end,
        ruleId: rule.id,
        name: rule.name,
        description: rule.description,
        category: rule.category,
        severity: severityOf(rule.category),
      });
    }
  }

  marks.sort((a, b) => a.start - b.start || a.end - b.end);

  /* 去掉完全同区间的重复命中（同一条规则被两处引用时会出现）。 */
  const deduped: WritingRuleMark[] = [];
  for (const m of marks) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.start === m.start && prev.end === m.end) continue;
    deduped.push(m);
  }
  return deduped;
}

/** 命中区间的最小查询集：供 WYSIWYG 只取词条名去 DOM 里找。 */
export function ruleHighlightTerms(rules: WritingRuleItem[]): Array<{
  name: string;
  severity: WritingRuleSeverity;
  description?: string;
}> {
  const seen = new Set<string>();
  const out: Array<{ name: string; severity: WritingRuleSeverity; description?: string }> = [];
  for (const rule of rules) {
    if (!rule || !rule.name || !rule.name.trim()) continue;
    const key = rule.name.trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: key,
      severity: severityOf(rule.category),
      description: rule.description,
    });
  }
  return out;
}
