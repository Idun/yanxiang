import { WritingRuleItem, RuleCategory } from '../types/writingRules';

export const DEFAULT_RULES_DOC_TITLE = '写作规范与禁用句式';

const CATEGORY_MAP: Record<RuleCategory, string> = {
  technique: '写作手法',
  common_word: '常用词汇',
  common_sentence: '常用句式',
  banned_word: '禁用词汇',
  banned_sentence: '禁用句式',
};

const TITLE_TO_CATEGORY_MAP: Record<string, RuleCategory> = {
  写作手法: 'technique',
  常用词汇: 'common_word',
  常用句式: 'common_sentence',
  禁用词汇: 'banned_word',
  禁用句式: 'banned_sentence',
};

export function parseRulesFromMarkdown(markdown: string): WritingRuleItem[] {
  if (!markdown || !markdown.trim()) return [];

  const lines = markdown.split(/\r?\n/);
  const rules: WritingRuleItem[] = [];
  let currentCategory: RuleCategory = 'banned_sentence';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check header
    if (line.startsWith('#')) {
      const headerText = line.replace(/^#+\s*/, '').trim();
      for (const [title, cat] of Object.entries(TITLE_TO_CATEGORY_MAP)) {
        if (headerText.includes(title)) {
          currentCategory = cat;
          break;
        }
      }
      continue;
    }

    // Check list item
    const listMatch = line.match(/^(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const content = listMatch[1].trim();
      let name = content;
      let description: string | undefined = undefined;

      // Check "Name: Description" or "Name：Description"
      const colonIdx = content.search(/[:：]/);
      if (colonIdx > 0) {
        name = content.substring(0, colonIdx).trim();
        description = content.substring(colonIdx + 1).trim() || undefined;
      } else {
        // Check "Name (Description)" or "Name（Description）"
        const parenMatch = content.match(/^(.+?)\s*[(（](.+?)[)）]$/);
        if (parenMatch) {
          name = parenMatch[1].trim();
          description = parenMatch[2].trim() || undefined;
        }
      }

      if (name) {
        rules.push({
          id: `rule-${currentCategory}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}-${rules.length}`,
          category: currentCategory,
          name,
          description,
          createdAt: Date.now(),
        });
      }
    }
  }

  return rules;
}

export function serializeRulesToMarkdown(rules: WritingRuleItem[]): string {
  const categories: RuleCategory[] = [
    'technique',
    'common_word',
    'common_sentence',
    'banned_word',
    'banned_sentence',
  ];

  let output = `# ${DEFAULT_RULES_DOC_TITLE}\n\n`;

  for (const cat of categories) {
    const title = CATEGORY_MAP[cat];
    const catRules = rules.filter((r) => r.category === cat);

    output += `## ${title}\n`;
    if (catRules.length === 0) {
      output += `*(暂无${title})*\n\n`;
    } else {
      for (const rule of catRules) {
        if (rule.description) {
          output += `- ${rule.name}: ${rule.description}\n`;
        } else {
          output += `- ${rule.name}\n`;
        }
      }
      output += '\n';
    }
  }

  return output.trim() + '\n';
}
