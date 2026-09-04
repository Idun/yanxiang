import { reactive } from "vue";

/**
 * 「AI 正在改哪一篇」的活动标记。
 *
 * 智能体（Ctrl+K 行内编辑 / 润色 / 续写 / 依习惯生成 / 对话「应用到文档」）
 * 一旦开始改动某个文档条目的正文，就在这里登记一次；左侧文档面板据此给对应
 * 条目挂上循环播放的描边动效，用户一眼就能看出 AI 在动哪一篇。
 *
 * 计数而非布尔：同一文档上可能同时有两路 AI 动作（例如流式续写未结束时又
 * 触发了一次润色），任一路结束都不该提前熄灭动效。
 */
const counts = reactive<Record<string, number>>({});

/** pulse() 用的自动熄灭定时器，按 fileId 归档，重复 pulse 会顺延。 */
const timers = new Map<string, number>();

/** AI 是否正在改这个文档条目。 */
export function isAiEditingDoc(fileId: string | null | undefined): boolean {
  if (!fileId) return false;
  return (counts[fileId] ?? 0) > 0;
}

/** 一次 AI 改动开始。必须与 endAiDocEdit 配对（用 try/finally）。 */
export function beginAiDocEdit(fileId: string | null | undefined): void {
  if (!fileId) return;
  counts[fileId] = (counts[fileId] ?? 0) + 1;
}

/** 一次 AI 改动结束。 */
export function endAiDocEdit(fileId: string | null | undefined): void {
  if (!fileId) return;
  const next = (counts[fileId] ?? 0) - 1;
  if (next > 0) counts[fileId] = next;
  else delete counts[fileId];
}

/**
 * 瞬时改动（一次性写入，没有“过程”可言，例如把对话回复应用到文档）：
 * 点亮一段固定时长，让用户来得及看见是哪一篇被改了。
 */
export function pulseAiDocEdit(fileId: string | null | undefined, ms = 2600): void {
  if (!fileId) return;
  const running = timers.get(fileId);
  if (running !== undefined) {
    window.clearTimeout(running);
  } else {
    beginAiDocEdit(fileId);
  }
  timers.set(
    fileId,
    window.setTimeout(() => {
      timers.delete(fileId);
      endAiDocEdit(fileId);
    }, ms),
  );
}
