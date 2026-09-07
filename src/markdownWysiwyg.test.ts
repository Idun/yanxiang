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

