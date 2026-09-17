import {
  CleanupMode,
  TextCleanupRuleItem,
  TextCleanupAppliedItem,
} from '../types/writingRules';

export type { TextCleanupRuleItem, TextCleanupAppliedItem };

export const STORAGE_KEY = 'ai_writing_rules_db';
export const LINKED_DOC_ID_KEY = 'ai_writing_rules_linked_doc_id';
export const CLEANUP_STORAGE_KEY = 'ai_writing_rules_text_cleanup_db';

export const CLEANUP_MODE_OPTIONS: { value: CleanupMode; label: string; desc: string }[] = [
  { value: 'exact', label: '精确匹配', desc: '按输入的字词全字/全字符匹配' },
  { value: 'fuzzy', label: '模糊匹配', desc: '忽略英文大小写，适配全半角标点' },
  { value: 'wrap', label: '成对包裹', desc: '替换成对出现的首尾括弧或引号' },
  { value: 'sentence', label: '句式替换', desc: '支持带……的跨词句式结构匹配' },
  { value: 'regex', label: '正则匹配', desc: '支持标准正则表达式及 $1 捕获组' },
];

export const DEFAULT_CLEANUP_RULES: TextCleanupRuleItem[] = [
  {
    id: 'clean-default-1',
    mode: 'wrap',
    source: '[',
    target: '【',
    sourceEnd: ']',
    targetEnd: '】',
    enabled: true,
  },
  {
    id: 'clean-default-2',
    mode: 'wrap',
    source: '(',
    target: '（',
    sourceEnd: ')',
    targetEnd: '）',
    enabled: true,
  },
  {
    id: 'clean-default-3',
    mode: 'regex',
    source: '\\n{3,}',
    target: '\\n\\n',
    enabled: true,
  },
  {
    id: 'clean-default-4',
    mode: 'regex',
    source: '([，。！？、；：])\\1+',
    target: '$1',
    enabled: true,
  },
  {
    id: 'clean-default-5',
    mode: 'regex',
    source: '(\\.{3,}|…{1,2}|。{3,})',
    target: '……',
    enabled: true,
  },
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unescapeTarget(target: string): string {
  if (!target) return '';
  return target
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

export function getRuleHitCount(text: string, rule: TextCleanupRuleItem): number {
  if (!text || !rule || rule.enabled === false) return 0;

  const mode = rule.mode || 'exact';

  if (mode === 'exact') {
    if (!rule.source) return 0;
    const regex = new RegExp(escapeRegex(rule.source), 'g');
    return (text.match(regex) || []).length;
  }

  if (mode === 'fuzzy') {
    if (!rule.source) return 0;
    const regex = new RegExp(escapeRegex(rule.source), 'gi');
    return (text.match(regex) || []).length;
  }

  if (mode === 'wrap') {
    let count = 0;
    if (rule.source) {
      const regStart = new RegExp(escapeRegex(rule.source), 'g');
      count += (text.match(regStart) || []).length;
    }
    if (rule.sourceEnd) {
      const regEnd = new RegExp(escapeRegex(rule.sourceEnd), 'g');
      count += (text.match(regEnd) || []).length;
    }
    return count;
  }

  if (mode === 'sentence') {
    if (!rule.source) return 0;
    if (rule.source.includes('……') || rule.source.includes('...')) {
      const parts = rule.source.split(/……|\.{3,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        try {
          const pattern = parts.map(escapeRegex).join('([\\s\\S]{1,50}?)');
          const regex = new RegExp(pattern, 'g');
          return (text.match(regex) || []).length;
        } catch {
          return 0;
        }
      }
    }
    const regex = new RegExp(escapeRegex(rule.source), 'g');
    return (text.match(regex) || []).length;
  }

  if (mode === 'regex') {
    if (!rule.source) return 0;
    try {
      const regex = new RegExp(rule.source, 'g');
      return (text.match(regex) || []).length;
    } catch {
      return 0;
    }
  }

  return 0;
}

export function applyRuleToText(
  text: string,
  rule: TextCleanupRuleItem
): { newText: string; count: number } {
  if (!text || !rule || rule.enabled === false) {
    return { newText: text, count: 0 };
  }

  const mode = rule.mode || 'exact';
  let count = 0;
  let newText = text;

  if (mode === 'exact') {
    if (!rule.source) return { newText: text, count: 0 };
    const regex = new RegExp(escapeRegex(rule.source), 'g');
    const matches = text.match(regex);
    count = matches ? matches.length : 0;
    if (count > 0) {
      newText = text.replace(regex, unescapeTarget(rule.target));
    }
  } else if (mode === 'fuzzy') {
    if (!rule.source) return { newText: text, count: 0 };
    const regex = new RegExp(escapeRegex(rule.source), 'gi');
    const matches = text.match(regex);
    count = matches ? matches.length : 0;
    if (count > 0) {
      newText = text.replace(regex, unescapeTarget(rule.target));
    }
  } else if (mode === 'wrap') {
    if (rule.source) {
      const regStart = new RegExp(escapeRegex(rule.source), 'g');
      const startMatches = newText.match(regStart);
      const startCount = startMatches ? startMatches.length : 0;
      if (startCount > 0) {
        newText = newText.replace(regStart, unescapeTarget(rule.target));
        count += startCount;
      }
    }
    if (rule.sourceEnd && rule.targetEnd !== undefined) {
      const regEnd = new RegExp(escapeRegex(rule.sourceEnd), 'g');
      const endMatches = newText.match(regEnd);
      const endCount = endMatches ? endMatches.length : 0;
      if (endCount > 0) {
        newText = newText.replace(regEnd, unescapeTarget(rule.targetEnd));
        count += endCount;
      }
    }
  } else if (mode === 'sentence') {
    if (!rule.source) return { newText: text, count: 0 };

    if (rule.source.includes('……') || rule.source.includes('...')) {
      const parts = rule.source.split(/……|\.{3,}/).map((p) => p.trim()).filter(Boolean);
      if (parts.length >= 2) {
        try {
          const pattern = parts.map(escapeRegex).join('([\\s\\S]{1,50}?)');
          const regex = new RegExp(pattern, 'g');
          const matches = newText.match(regex);
          count = matches ? matches.length : 0;
          if (count > 0) {
            let targetPattern = rule.target;
            if (targetPattern.includes('……') || targetPattern.includes('...')) {
              const targetParts = targetPattern.split(/……|\.{3,}/).map((p) => p.trim());
              if (targetParts.length >= 2) {
                targetPattern = `${targetParts[0]}$1${targetParts[1]}`;
              }
            }
            newText = newText.replace(regex, unescapeTarget(targetPattern));
          }
        } catch {
          const regex = new RegExp(escapeRegex(rule.source), 'g');
          const matches = newText.match(regex);
          count = matches ? matches.length : 0;
          if (count > 0) newText = newText.replace(regex, unescapeTarget(rule.target));
        }
      } else {
        const regex = new RegExp(escapeRegex(rule.source), 'g');
        const matches = newText.match(regex);
        count = matches ? matches.length : 0;
        if (count > 0) newText = newText.replace(regex, unescapeTarget(rule.target));
      }
    } else {
      const regex = new RegExp(escapeRegex(rule.source), 'g');
      const matches = newText.match(regex);
      count = matches ? matches.length : 0;
      if (count > 0) newText = newText.replace(regex, unescapeTarget(rule.target));
    }
  } else if (mode === 'regex') {
    if (!rule.source) return { newText: text, count: 0 };
    try {
      const regex = new RegExp(rule.source, 'g');
      const matches = newText.match(regex);
      count = matches ? matches.length : 0;
      if (count > 0) {
        newText = newText.replace(regex, unescapeTarget(rule.target));
      }
    } catch {
      return { newText: text, count: 0 };
    }
  }

  return { newText, count };
}

export function applyAllRulesToText(
  text: string,
  rules: TextCleanupRuleItem[]
): {
  newText: string;
  totalCount: number;
  appliedRules: TextCleanupAppliedItem[];
} {
  let currentText = text;
  let totalCount = 0;
  const appliedRules: TextCleanupAppliedItem[] = [];

  for (const rule of rules) {
    if (rule.enabled === false) continue;
    const { newText, count } = applyRuleToText(currentText, rule);
    if (count > 0) {
      currentText = newText;
      totalCount += count;
      appliedRules.push({
        ruleId: rule.id,
        mode: rule.mode || 'exact',
        source: rule.source,
        target: rule.target,
        sourceEnd: rule.sourceEnd,
        targetEnd: rule.targetEnd,
        count,
      });
    }
  }

  return {
    newText: currentText,
    totalCount,
    appliedRules,
  };
}
