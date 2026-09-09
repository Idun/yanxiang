// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from "vitest";
import { documentFilesStore, createDocFile } from "./documentFilesStore";
import { describeDocToolCall, docToolDefinitions, runDocTool } from "./docTools";

/**
 * 批量文档工具（read_documents / update_documents / append_documents）：
 * 一次调用处理多篇文档，避免模型在多轮工具循环里把正文反复回注导致上下文爆掉。
 */

function seedDocs() {
  documentFilesStore.files.length = 0;
  const a = createDocFile(null, "第一章 相遇");
  a.content = ["第一行：雨夜。", "第二行：他推开门。", "第三行：屋里有人。", "第四行：灯忽然灭了。"].join("\n");
  const b = createDocFile(null, "第二章 告别");
  b.content = ["第一行：天亮。", "第二行：她整理行李。", "第三行：站台上没有回头。"].join("\n");
  const c = createDocFile(null, "空白稿");
  c.content = "";
  return { a, b, c };
}

beforeEach(() => {
  seedDocs();
});

describe("read_documents 批量读取", () => {
  it("一次读取多篇文档，各自带标题与行号", () => {
    const out = runDocTool("read_documents", { titles: ["第一章 相遇", "第二章 告别"] });
    expect(out).toContain("文档「第一章 相遇」");
    expect(out).toContain("文档「第二章 告别」");
    expect(out).toContain("1: 第一行：雨夜。");
    expect(out).toContain("1: 第一行：天亮。");
  });

  it("title 单值 / 逗号分隔同样识别", () => {
    const out = runDocTool("read_documents", { titles: "第一章 相遇, 第二章 告别" });
    expect(out).toContain("第一章 相遇");
    expect(out).toContain("第二章 告别");
  });

  it("未给标题时读取用户当前打开的那一篇", () => {
    documentFilesStore.activeFileId = documentFilesStore.files[0].id;
    const out = runDocTool("read_documents", {});
    expect(out).toContain("第一章 相遇");
    expect(out).not.toContain("第二章 告别");
  });

  it("按 limit 截取每篇行数，并在尾部给出继续读取提示", () => {
    const out = runDocTool("read_documents", { titles: ["第一章 相遇"], limit: 2 });
    expect(out).toContain("本次前 2 行");
    expect(out).toContain("1: 第一行：雨夜。");
    expect(out).toContain("2: 第二行：他推开门。");
    expect(out).not.toContain("3: 第三行");
    expect(out).toContain("还有 2 行未读取");
  });

  it("命中不存在的标题时提示未找到，并列出可用文档", () => {
    const out = runDocTool("read_documents", { titles: ["不存在的章"] });
    expect(out).toContain("未找到");
    expect(out).toContain("第一章 相遇");
  });

  it("同篇被多个别名命中时去重，不会重复返回", () => {
    const out = runDocTool("read_documents", { titles: ["第一章 相遇", "第一章"] });
    const count = (out.match(/文档「第一章 相遇」/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe("update_documents 批量改写", () => {
  it("一次替换多篇正文", () => {
    const out = runDocTool("update_documents", {
      docs: [
        { title: "第一章 相遇", content: "新版第一章正文。" },
        { title: "第二章 告别", content: "新版第二章正文。" },
      ],
    });
    expect(out).toContain("已替换「第一章 相遇」");
    expect(out).toContain("已替换「第二章 告别」");
    expect(documentFilesStore.files.find((f) => f.title === "第一章 相遇")?.content).toBe("新版第一章正文。");
    expect(documentFilesStore.files.find((f) => f.title === "第二章 告别")?.content).toBe("新版第二章正文。");
  });

  it("content 为空的项会被跳过并说明", () => {
    const out = runDocTool("update_documents", {
      docs: [{ title: "第一章 相遇", content: "" }],
    });
    expect(out).toContain("跳过");
    expect(documentFilesStore.files.find((f) => f.title === "第一章 相遇")?.content).toContain("第一行：雨夜。");
  });
});

describe("append_documents 批量追加", () => {
  it("一次给多篇文档文末追加内容", () => {
    const out = runDocTool("append_documents", {
      docs: [
        { title: "第一章 相遇", content: "追加A" },
        { title: "第二章 告别", content: "追加B" },
      ],
    });
    expect(out).toContain("已在「第一章 相遇」末尾追加");
    expect(out).toContain("已在「第二章 告别」末尾追加");
    expect(documentFilesStore.files.find((f) => f.title === "第一章 相遇")?.content).toContain("追加A");
    expect(documentFilesStore.files.find((f) => f.title === "第二章 告别")?.content).toContain("追加B");
  });
});

describe("工具声明与轨迹描述", () => {
  it("声明里包含批量工具与子代理入口描述", () => {
    const defs = docToolDefinitions();
    const names = defs.map((d) => d.name);
    expect(names).toContain("read_documents");
    expect(names).toContain("update_documents");
    expect(names).toContain("append_documents");
    expect(defs.find((d) => d.name === "read_documents")?.description).toContain("多篇");
  });

  it("批量工具的轨迹描述简洁可读", () => {
    expect(describeDocToolCall("read_documents", { titles: ["A", "B"] })).toContain("2 篇");
    expect(describeDocToolCall("update_documents", {})).toBe("批量改写多篇文档");
    expect(describeDocToolCall("append_documents", {})).toBe("批量续写多篇文档");
  });
});
