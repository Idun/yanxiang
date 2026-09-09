// @vitest-environment jsdom
import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  DEFAULT_WRITER_QUICK_COMMANDS,
  addWriterQuickCommand,
  removeWriterQuickCommand,
  resetWriterQuickCommands,
  writerQuickCommands,
} from "./quickCommands";

/**
 * AI写作输入框的「/ 快捷指令」：
 * 与「对话」页 / 创作指令完全独立，只是明文文本，点选后插入输入框。
 */

beforeEach(() => {
  resetWriterQuickCommands();
  localStorage.clear();
});

describe("快捷指令默认值", () => {
  it("内置默认指令是一整段整体，而不是拆开的几条", () => {
    expect(writerQuickCommands.value.length).toBe(1);
    const whole = writerQuickCommands.value[0];
    /* 四段写作要求同属一份指令，一个整体点选插入。 */
    expect(whole).toContain("只写对话框架");
    expect(whole).toContain("转场时加简单环境描写");
    expect(whole).toContain("600-1400字");
    expect(whole).toContain("避免与前一章节叙事手法上有所雷同");
    expect(whole.split("\n").length).toBeGreaterThanOrEqual(4);
  });

  it("默认指令与对话 / 创作指令表互不相关", () => {
    /* 快捷指令里不应出现 /身份模板 之类的对话创作指令触发词。 */
    expect(writerQuickCommands.value.some((c) => c.includes("/身份模板"))).toBe(false);
    expect(DEFAULT_WRITER_QUICK_COMMANDS.length).toBeGreaterThan(0);
  });
});

describe("增删与持久化", () => {
  it("可新增自定义指令", () => {
    const ok = addWriterQuickCommand("节奏加快，多写短句");
    expect(ok).toBe(true);
    expect(writerQuickCommands.value[writerQuickCommands.value.length - 1]).toBe("节奏加快，多写短句");
  });

  it("空白内容不会被添加", () => {
    expect(addWriterQuickCommand("   ")).toBe(false);
    expect(writerQuickCommands.value.length).toBe(DEFAULT_WRITER_QUICK_COMMANDS.length);
  });

  it("可删除指定序号的指令", () => {
    addWriterQuickCommand("自定义一条");
    const before = writerQuickCommands.value.length;
    removeWriterQuickCommand(0);
    expect(writerQuickCommands.value.length).toBe(before - 1);
    expect(writerQuickCommands.value[0]).toBe("自定义一条");
  });

  it("删除越界序号不报错", () => {
    expect(() => removeWriterQuickCommand(999)).not.toThrow();
  });

  it("变更会写入 localStorage，重载后仍在（持久化）", () => {
    addWriterQuickCommand("持久化测试指令");
    const saved = JSON.parse(localStorage.getItem("docintel:writer_quick_commands") ?? "[]");
    expect(Array.isArray(saved)).toBe(true);
    expect(saved).toContain("持久化测试指令");
  });

  it("恢复默认会回到内置指令集", () => {
    addWriterQuickCommand("临时指令");
    resetWriterQuickCommands();
    expect(writerQuickCommands.value).toEqual(DEFAULT_WRITER_QUICK_COMMANDS);
  });
});

describe("旧版默认值迁移", () => {
  const LEGACY = [
    '新建文档写入，只写对话框架（像话剧剧本）格式：XX说："..."，YY说："..."',
    "转场时加简单环境描写",
    "目标字数：600-1400字对话部分（实际字数要按剧情发展来，非硬性要求）",
    "注意，避免与前一章节叙事手法上有所雷同，造成结构被判定AI味，要学会多种手法写作，比如倒叙、插叙、白描、蒙太奇等等，自行分配，同时注意动词写作跟对话合作原则。",
  ];

  it("落盘数据还是旧版默认四条（用户没改过）时，迁移成一整段", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem("docintel:writer_quick_commands", JSON.stringify(LEGACY));
    const mod = await import("./quickCommands");
    expect(mod.writerQuickCommands.value.length).toBe(1);
    expect(mod.writerQuickCommands.value[0]).toContain("只写对话框架");
    expect(mod.writerQuickCommands.value[0]).toContain("对话合作原则");
  });

  it("用户自定义过的数据不做迁移", async () => {
    vi.resetModules();
    localStorage.clear();
    localStorage.setItem(
      "docintel:writer_quick_commands",
      JSON.stringify(["自定义一条", "转场时加简单环境描写"]),
    );
    const mod = await import("./quickCommands");
    expect(mod.writerQuickCommands.value).toEqual(["自定义一条", "转场时加简单环境描写"]);
  });
});
