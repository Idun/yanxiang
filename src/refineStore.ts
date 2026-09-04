import { reactive } from "vue";

export interface HistoryVersion {
  id: string;
  time: string;
  title: string;
  original: string;
  content: string;
  chars: number;
  adjusted: number;
  tokens?: number;
}

export interface RefinedSentence {
  original: string;
  refined: string;
  changes: string[];
  /**
   * 用户的采纳决定，仅对有修改的句子有意义：
   * - undefined：尚未作出决定（默认视为采纳修订稿）
   * - true：已接受修订（修订内容生效）
   * - false：已拒绝修订（保留原文）
   */
  accepted?: boolean;
  /** 本句保留下来的原因说明（模型未返回有效修订等），用于区分「判定无需修改」与「没拿到结果」。 */
  note?: string;
  /**
   * 本句走了「降级采纳」：模型重排了断句，标点未能原位还原，
   * 已按原文风格归一并对齐句末标点。仅用于界面提示，不影响正文。
   */
  relaxed?: boolean;
}

export type RefineState = "input" | "processing" | "completed";

// 每组默认放进 10 句：一次请求里句子够多，模型才好在组内做真实取舍；
// 太少（如 5 句）会让「按比例修订」的下限被按组反复摊薄。
// 仅控制每请求携带的句子数；各组实际逐组串行调用。
export const DEFAULT_PARALLEL_GROUPS = 10;

export const refineStore = reactive({
  inputText: "",
  parallelGroups: DEFAULT_PARALLEL_GROUPS,
  historyVersions: [] as HistoryVersion[],
  state: "input" as RefineState,
  processedSentences: [] as RefinedSentence[],
  progress: 0 as number,
  totalGroups: 0 as number,
  completedGroups: 0 as number,
  adjustedCount: 0 as number,
  usedTokens: 0 as number,
});