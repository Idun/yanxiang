import { ref, watch } from "vue";

/**
 * AI写作输入框的「/ 快捷指令」。
 *
 * 与「对话」页的 / 创作指令（chatSlashCommands）完全独立：
 * 创作指令走系统提示词注入、是一轮创作模式的开关；这里的快捷指令只是
 * 一段「明文文本」，点选后原样插进输入框正文，用于存放高频复用的写作要求，
 * 用户可自行增删，随 localStorage 持久化。
 */

/**
 * 内置默认快捷指令：一整段整体，而不是拆开的几条。
 *
 * 它描述的是「同一次写作要求」的完整约束——新建文档写入、只写对话框架、
 * 转场环境描写、目标字数、避免 AI 味的手法要求——是一份一次点选即可整体
 * 插入的指令块。因此合并为单条，用户在输入框里看到的就是完整一段。
 */
export const DEFAULT_WRITER_QUICK_COMMANDS: string[] = [
  [
    '新建文档写入，只写对话框架（像话剧剧本）格式：XX说："..."，YY说："..."',
    "转场时加简单环境描写",
    "目标字数：600-1400字对话部分（实际字数要按剧情发展来，非硬性要求）",
    "注意，避免与前一章节叙事手法上有所雷同，造成结构被判定AI味，要学会多种手法写作，比如倒叙、插叙、白描、蒙太奇等等，自行分配，同时注意动词写作跟对话合作原则。",
  ].join("\n"),
];

/** 旧版默认值（曾拆成 4 条），用于把已落盘的老数据迁移成新的「一整段」。 */
const LEGACY_DEFAULT_WRITER_QUICK_COMMANDS = [
  '新建文档写入，只写对话框架（像话剧剧本）格式：XX说："..."，YY说："..."',
  "转场时加简单环境描写",
  "目标字数：600-1400字对话部分（实际字数要按剧情发展来，非硬性要求）",
  "注意，避免与前一章节叙事手法上有所雷同，造成结构被判定AI味，要学会多种手法写作，比如倒叙、插叙、白描、蒙太奇等等，自行分配，同时注意动词写作跟对话合作原则。",
];

const STORAGE_KEY = "docintel:writer_quick_commands";

/** 判断落盘数据是否还是旧版默认的四条（用户没动过），是则迁移成新的一整段。 */
function isLegacyDefaults(parsed: unknown): boolean {
  return (
    Array.isArray(parsed) &&
    parsed.length === LEGACY_DEFAULT_WRITER_QUICK_COMMANDS.length &&
    LEGACY_DEFAULT_WRITER_QUICK_COMMANDS.every((item, i) => parsed[i] === item)
  );
}

function load(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [...DEFAULT_WRITER_QUICK_COMMANDS];
    const parsed = JSON.parse(raw);
    if (isLegacyDefaults(parsed)) return [...DEFAULT_WRITER_QUICK_COMMANDS];
    if (!Array.isArray(parsed)) return [...DEFAULT_WRITER_QUICK_COMMANDS];
    return parsed.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    return [...DEFAULT_WRITER_QUICK_COMMANDS];
  }
}

export const writerQuickCommands = ref<string[]>(load());

watch(
  writerQuickCommands,
  (val) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
    } catch {
      /* ignore quota errors */
    }
  },
  { deep: true },
);

function persist(val: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(val));
  } catch {
    /* ignore quota errors */
  }
}

/** 新增一条快捷指令（去空白）。成功返回 true。 */
export function addWriterQuickCommand(text: string): boolean {
  const clean = text.trim();
  if (!clean) return false;
  writerQuickCommands.value = [...writerQuickCommands.value, clean];
  persist(writerQuickCommands.value);
  return true;
}

/** 按序号删除一条快捷指令。 */
export function removeWriterQuickCommand(index: number): void {
  if (index < 0 || index >= writerQuickCommands.value.length) return;
  writerQuickCommands.value = writerQuickCommands.value.filter((_, i) => i !== index);
  persist(writerQuickCommands.value);
}

/** 恢复到内置默认指令集。 */
export function resetWriterQuickCommands(): void {
  writerQuickCommands.value = [...DEFAULT_WRITER_QUICK_COMMANDS];
  persist(writerQuickCommands.value);
}
