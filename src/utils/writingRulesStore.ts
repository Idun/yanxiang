import { reactive } from "vue";
import { WritingRuleItem } from "../types/writingRules";

/**
 * 写作规范的响应式单一数据源。
 *
 * 弹窗（WritingRulesModal）负责增删改，编辑区（DocumentViewer / MarkdownWysiwyg）
 * 只读订阅，这样在弹窗里刚加的「禁用句式」能立刻在正文里画出波浪线，
 * 无需刷新或重开文档。持久化仍落在同一个 localStorage key 上，与旧数据兼容。
 */
export const WRITING_RULES_STORAGE_KEY = "ai_writing_rules_db";

function loadFromStorage(): WritingRuleItem[] {
  try {
    const raw = localStorage.getItem(WRITING_RULES_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as WritingRuleItem[];
    }
  } catch (e) {
    console.error(e);
  }
  return [];
}

export const writingRulesStore = reactive({
  rules: loadFromStorage() as WritingRuleItem[],
});

/** 覆盖整份规范列表，并同步持久化。 */
export function setWritingRules(rules: WritingRuleItem[]): void {
  writingRulesStore.rules = rules;
  try {
    localStorage.setItem(WRITING_RULES_STORAGE_KEY, JSON.stringify(rules));
  } catch (e) {
    console.error(e);
  }
}
