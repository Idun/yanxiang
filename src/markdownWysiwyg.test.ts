// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  liveHtmlToMarkdown,
  markdownToLiveHtml,
  rawOffsetAt,
} from "./components/MarkdownWysiwyg.vue";

/**
 * WYSIWYG 块级序列化的关键回归：空行块（.md-empty）一旦被浏览器塞进真实文本
 * （默认粘贴 / 拖入等），旧实现会把整块当成空行丢弃 → 「WYSIWYG 里粘贴、
 * 切走再切回内容消失」。这里锁住修复后的序列化行为。
 */

describe("md-empty 空行块的序列化", () => {
  it("真正空行块仍序列化为空串，不引入占位字符", () => {
    const root = document.createElement("div");
    root.innerHTML = '<p class="md-block md-p md-empty" data-block-type="p"><br></p>';
    expect(liveHtmlToMarkdown(root)).toBe("");
  });

  it("空行块被塞入真实文本 → 按普通段落还原，不整块丢弃", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p class="md-block md-p md-empty" data-block-type="p">被粘贴进来的文字</p>';
    expect(liveHtmlToMarkdown(root)).toBe("被粘贴进来的文字");
  });

  it("空行块带文本 + 占位 <br> → 只还原文本，<br> 不算字符", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p class="md-block md-p md-empty" data-block-type="p">正文<br></p>';
    expect(liveHtmlToMarkdown(root)).toBe("正文");
  });
});

describe("markdownToLiveHtml ↔ liveHtmlToMarkdown 往返", () => {
  it("普通文档逐行无损往返", () => {
    const md = "# 标题\n\n正文段落。\n\n- 列表一\n- 列表二\n\n> 引用行";
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("连续空行保持连续", () => {
    const md = "首行\n\n\n尾行";
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("行内标记（加粗 / 斜体 / 行内代码 / 链接）还原", () => {
    const md = "有 **加粗** 与 `code` 与 [链接](https://example.com)。";
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("表格渲染成 <table> 并可无损往返", () => {
    const md = [
      "| 列1 | 列2 | 列3 |",
      "| --- | :---: | ---: |",
      "| a | b | c |",
      "| x | y | z |",
    ].join("\n");
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    /* 渲染出真正的表格结构 */
    expect(root.querySelector(".md-table table")).toBeTruthy();
    expect(root.querySelectorAll(".md-table thead th.md-tbl-cell").length).toBe(3);
    expect(root.querySelectorAll(".md-table tbody tr.md-tbl-row").length).toBe(2);
    expect(root.querySelectorAll(".md-table .md-content").length).toBe(3 + 3 + 3);
    /* 列对齐反映到单元格内容样式 */
    const headCells = root.querySelectorAll(".md-table thead th .md-content");
    expect(headCells[0].getAttribute("style")).toBeNull();
    expect(headCells[1].getAttribute("style")).toContain("center");
    expect(headCells[2].getAttribute("style")).toContain("right");
    /* 往返无损 */
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("表格在文档中间：与前后段落正确往返", () => {
    const md = [
      "开头段落。",
      "",
      "| 名称 | 数值 |",
      "| --- | --- |",
      "| 甲 | 1 |",
      "",
      "结尾段落。",
    ].join("\n");
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    const tables = root.querySelectorAll(".md-block.md-table");
    expect(tables.length).toBe(1);
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("表头只有一行、没有数据行也能往返", () => {
    const md = "| 标题 |\n| --- |\n| 内容 |";
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("单列表格也能渲染与往返", () => {
    const md = ["| 日期 |", "| --- |", "| 周一 |", "| 周二 |"].join("\n");
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(root.querySelector(".md-table")).toBeTruthy();
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("单元格里的 | 被转义还原，不破坏列结构", () => {
    const md = ["| 表达式 | 结果 |", "| --- | --- |", "| a \\| b | 3 |"].join("\n");
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(liveHtmlToMarkdown(root)).toBe(md);
  });

  it("非表格的带竖线行不会被误判成表格", () => {
    const md = "这段 | 不是表格。\n下一行只是普通文字。";
    const root = document.createElement("div");
    root.innerHTML = markdownToLiveHtml(md);
    expect(root.querySelector(".md-table")).toBeNull();
  });
});

/**
 * 成对标点补全在空行处失效的根因：rawOffsetAt 对 md-empty 块一律返回 0，
 * 空行块被键入的字符「唤醒」后仍读成偏移 0，cleanInsert 校验不过 → 不补全。
 * 修复后只有「真正空行」归零，被塞进文本的空行块按真实位置算偏移。
 */
describe("rawOffsetAt · 空行块偏移", () => {
  it("真正空行块内任何位置都映射为 0", () => {
    const block = document.createElement("p");
    block.className = "md-block md-p md-empty";
    block.setAttribute("data-block-type", "p");
    block.innerHTML = "<br>";
    const br = block.querySelector("br")!;
    expect(rawOffsetAt(block, br, 0)).toBe(0);
    expect(rawOffsetAt(block, block, 0)).toBe(0);
  });

  it("空行块被塞入文本后，光标偏移按真实位置计算（补全不再失效）", () => {
    const block = document.createElement("p");
    block.className = "md-block md-p md-empty";
    block.setAttribute("data-block-type", "p");
    block.innerHTML = "“";
    const text = block.firstChild as Text;
    expect(rawOffsetAt(block, text, 1)).toBe(1);
    expect(rawOffsetAt(block, text, 0)).toBe(0);
  });
});

