import { describe, expect, it } from "vitest";
import { renderForReading } from "./markdown";

/**
 * 纯文本多章节的阅读渲染。
 *
 * 首字下沉靠 CSS 的 `> p:first-of-type` 与 `> h* + p` 命中「每章正文的开头段落」，
 * 前提是每个章节标题行都真的被渲染成顶层 <h1>/<h2>。这里锁住这个前提：
 * 章节行带缩进（小说常见的两个全角空格）时也必须提升为标题，否则第二章
 * 及以后的开头段落既拿不到下沉、又会被算进行首缩进。
 */
describe("renderForReading", () => {
  it("把纯文本章节行提升为顶层标题，正文各自独立成段", () => {
    const html = renderForReading("第一章 起风\n\n正文一段。\n\n第二章 落雨\n\n正文二段。\n");
    /* 章 / 回 / 节 是二级（卷 / 部 / 篇 才是一级），见 readingOutline.chapterLevel。 */
    expect(html).toContain("<h2>第一章 起风</h2>");
    expect(html).toContain("<h2>第二章 落雨</h2>");
    expect(html).toContain("<p>正文一段。</p>");
    expect(html).toContain("<p>正文二段。</p>");
  });

  it("章节行带全角 / 半角缩进时同样提升为标题", () => {
    const html = renderForReading(
      "　　第一章 起风\n\n　　正文一段。\n\n　　第二章 落雨\n\n　　正文二段。\n",
    );
    expect(html).toContain("<h2>第一章 起风</h2>");
    expect(html).toContain("<h2>第二章 落雨</h2>");
    /* 缩进的章节行绝不能退化成普通段落，否则该章开头段落拿不到首字下沉。 */
    expect(html).not.toMatch(/<p>[^<]*第二章/);
  });

  it("每个标题后面都紧跟一个顶层段落（h* + p 可命中）", () => {
    const html = renderForReading(
      "第一章 起风\n\n正文一段。\n\n第二章 落雨\n\n正文二段。\n\n第三章 见雪\n\n正文三段。\n",
    );
    const pairs = html.match(/<\/h[12]>\s*<p>/g) ?? [];
    expect(pairs).toHaveLength(3);
  });

  it("卷 / 楔子等特殊章节行也各自成标题", () => {
    const html = renderForReading("楔子\n\n开篇。\n\n第一卷 风起\n\n卷首。\n\n第一章 初见\n\n正文。\n");
    expect(html).toContain("<h1>楔子</h1>");
    expect(html).toContain("<h1>第一卷 风起</h1>");
    expect(html).toContain("<h2>第一章 初见</h2>");
  });

  it("文档本身已含 Markdown 标题时不再做章节行提升", () => {
    const html = renderForReading("# 序\n\n正文。\n\n第二章 落雨\n\n正文二段。\n");
    expect(html).toContain("<h1>序</h1>");
    /* 已是 Markdown 文档：按原样解析，「第二章」保持普通段落。 */
    expect(html).toContain("<p>第二章 落雨</p>");
  });
});
