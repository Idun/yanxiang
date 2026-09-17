export type RuleCategory =
  | 'technique'
  | 'common_word'
  | 'common_sentence'
  | 'banned_word'
  | 'banned_sentence';

export interface WritingRuleItem {
  id: string;
  category: RuleCategory;
  name: string;
  description?: string;
  createdAt: number;
}

export type CleanupMode = 'exact' | 'fuzzy' | 'wrap' | 'sentence' | 'regex';

export interface TextCleanupRuleItem {
  id: string;
  mode: CleanupMode;
  source: string;
  target: string;
  sourceEnd?: string;
  targetEnd?: string;
  enabled?: boolean;
  createdAt?: number;
}

export interface TextCleanupAppliedItem {
  ruleId: string;
  mode: CleanupMode;
  source: string;
  target: string;
  sourceEnd?: string;
  targetEnd?: string;
  count: number;
}

export interface TextCleanupResultLog {
  id: string;
  timestamp: number;
  originalText: string;
  resultText: string;
  totalCount: number;
  appliedRules: TextCleanupAppliedItem[];
}

export interface DocumentItem {
  id: string;
  title: string;
  content: string;
  lastModified?: number;
  wordCount?: number;
}
