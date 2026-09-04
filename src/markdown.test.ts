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

  it("剥掉段落行首的字面缩进，缩进交给 CSS 统一排版", () => {
    /* 原文段首的两个全角空格是字面空白：随 marked 原样进 <p>，再叠 CSS
       text-indent 会双重缩进（首字下沉让首段归零后，第二段多缩两字符）。
       阅读视图应剥掉字面缩进，输出干净的 <p>正文…</p>。 */
    const html = renderForReading("第一章 起风\n\n　　正文一段。\n\n　　正文二段。\n");
    expect(html).toContain("<p>正文一段。</p>");
    expect(html).toContain("<p>正文二段。</p>");
    expect(html).not.toMatch(/<p>\s*　/);
  });

  it("Markdown 文档同样剥全角段首缩进，但不剥半角（可能是代码块缩进）", () => {
    const html = renderForReading("# 序\n\n　　正文一段。\n\n  正文二段。\n");
    expect(html).toContain("<p>正文一段。</p>");
    /* 半角两个空格：在 Markdown 里只是普通段落的弱缩进，保留不动。 */
    expect(html).toContain("<p>  正文二段。</p>");
  });

  it("围栏代码块内部的原样空白保留，不做段首剥离", () => {
    const html = renderForReading("第一章 起风\n\n```js\n  const a = 1;\n　　const b = 2;\n```\n\n　　正文。\n");
    expect(html).toContain("<pre><code");
    /* 围栏内的全角空白原样保留（highlight 只包语法 span，不吞空白；
       本文档经剥离后唯一还带「　　」的位置就是围栏内部）。 */
    expect(html).toContain("　　");
    /* 段落行的字面缩进被剥掉。 */
    expect(html).not.toContain("<p>　　正文。</p>");
  });

  it("以结构标记开头的行保留原样，不因段首剥离而变形", () => {
    const html = renderForReading("# 序\n\n　　> 引用行。\n\n　　  - 列表项。\n");
    /* U+3000 前缀不在 marked 允许的结构缩进内，整行本就被当作普通段落字面输出；
       剥离逻辑不得把「结构标记前缀」当成段落去压平、更不能削掉字面空白。 */
    expect(html).toContain("　　&gt; 引用行。");
    expect(html).toContain("　　  - 列表项。");
  });
});
