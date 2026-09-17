import { describe, it, expect } from 'vitest';
import { parseRulesFromMarkdown, serializeRulesToMarkdown } from './rulesDocSync';
import { WritingRuleItem } from '../types/writingRules';

describe('rulesDocSync', () => {
  it('parses markdown into WritingRuleItem list correctly', () => {
    const md = `
# 写作规范与禁用句式

## 禁用句式
- 不仅……而且……: 过于刻板
- 毫不夸张地说

## 常用词汇
- 宛如: 比喻修辞
    `;

    const rules = parseRulesFromMarkdown(md);
    expect(rules.length).toBe(3);
    expect(rules[0].category).toBe('banned_sentence');
    expect(rules[0].name).toBe('不仅……而且……');
    expect(rules[0].description).toBe('过于刻板');

    expect(rules[1].category).toBe('banned_sentence');
    expect(rules[1].name).toBe('毫不夸张地说');
    expect(rules[1].description).toBeUndefined();

    expect(rules[2].category).toBe('common_word');
    expect(rules[2].name).toBe('宛如');
    expect(rules[2].description).toBe('比喻修辞');
  });

  it('serializes rules back to markdown correctly', () => {
    const rules: WritingRuleItem[] = [
      {
        id: '1',
        category: 'banned_sentence',
        name: '不仅……而且……',
        description: '太生硬',
        createdAt: Date.now(),
      },
    ];

    const md = serializeRulesToMarkdown(rules);
    expect(md).toContain('# 写作规范与禁用句式');
    expect(md).toContain('## 禁用句式');
    expect(md).toContain('- 不仅……而且……: 太生硬');
  });
});
