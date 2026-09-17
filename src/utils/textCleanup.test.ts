import { describe, it, expect } from 'vitest';
import {
  applyRuleToText,
  getRuleHitCount,
  applyAllRulesToText,
  TextCleanupRuleItem,
} from './textCleanup';

describe('textCleanup', () => {
  it('applies exact cleanup rule correctly', () => {
    const rule: TextCleanupRuleItem = {
      id: '1',
      mode: 'exact',
      source: '指尖微凉',
      target: '手指微凉',
    };
    const { newText, count } = applyRuleToText('她感觉指尖微凉，确实是指尖微凉。', rule);
    expect(count).toBe(2);
    expect(newText).toBe('她感觉手指微凉，确实是手指微凉。');
  });

  it('applies wrap cleanup rule correctly', () => {
    const rule: TextCleanupRuleItem = {
      id: '2',
      mode: 'wrap',
      source: '[',
      target: '【',
      sourceEnd: ']',
      targetEnd: '】',
    };
    const { newText, count } = applyRuleToText('[说明] 文本 [内容]', rule);
    expect(count).toBe(4);
    expect(newText).toBe('【说明】 文本 【内容】');
  });

  it('applies regex cleanup rule correctly', () => {
    const rule: TextCleanupRuleItem = {
      id: '3',
      mode: 'regex',
      source: '\\n{3,}',
      target: '\\n\\n',
    };
    const { newText, count } = applyRuleToText('A\n\n\n\nB', rule);
    expect(count).toBe(1);
    expect(newText).toBe('A\n\nB');
  });

  it('calculates hit count correctly', () => {
    const rule: TextCleanupRuleItem = {
      id: '4',
      mode: 'exact',
      source: '测试',
      target: '实验',
    };
    const hits = getRuleHitCount('这是一个测试，又是测试。', rule);
    expect(hits).toBe(2);
  });

  it('applies all rules sequentially', () => {
    const rules: TextCleanupRuleItem[] = [
      { id: '1', mode: 'exact', source: 'a', target: 'b' },
      { id: '2', mode: 'exact', source: 'b', target: 'c' },
    ];
    const { newText, totalCount, appliedRules } = applyAllRulesToText('a', rules);
    expect(newText).toBe('c');
    expect(totalCount).toBe(2);
    expect(appliedRules.length).toBe(2);
  });
});
