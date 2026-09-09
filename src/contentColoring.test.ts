// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { applyContentColoring } from "./contentColoring";
import { markdownToLiveHtml } from "./components/MarkdownWysiwyg.vue";

/** 着色后的 HTML 里落在「引号色」内的可见字符总数。 */
function countQuoteClass(html: string): number {
  const m = html.match(/<span class="zj-quote">([^<]*)<\/span>/g) ?? [];
  let total = 0;
  for (const s of m) {
    total += s.replace(/<[^>]+>/g, "").length;
  }
  return total;
}

/** 引号色里的可见文本片段。 */
function quoteFragments(html: string): string[] {
  return (html.match(/<span class="zj-quote">([^<]*)<\/span>/g) ?? []).map((s) =>
    s.replace(/<[^>]+>/g, ""),
  );
}

describe("WYSIWYG 内容上色（resetAtBlocks）：AI 回复粘贴场景", () => {
  it("正常中文对白：只有引号内文字上引号色，其余段落不受影响", () => {
    const md = [
      "第一章",
      "",
      "她推开窗，风灌进来。她说：“你把钥匙放下吧。”",
      "他摇了摇头：“放不下了。”",
      "窗外雨声渐密，屋里没人再开口。",
    ].join("\n");
    const html = applyContentColoring(markdownToLiveHtml(md), { resetAtBlocks: true });
    const q = countQuoteClass(html);
    expect(q).toBeGreaterThan(0);
    /* 对白引号内的文字（约 14 字）远少于全篇，不能把整篇染上。 */
    expect(q).toBeLessThan(40);
    const colored = quoteFragments(html).join("");
    expect(colored).toContain("你把钥匙放下吧");
    expect(colored).not.toContain("风灌进来");
  });

  it("英文撇号（奇数个）：只影响本段，后续段落不再被引号色贯穿", () => {
    const md = [
      "主角叫 Jack，大家喊他 Jacky。",
      "L'amour 是他最喜欢的词。",
      "他推开窗，风灌进来。",
      "她笑了笑，没接话。",
    ].join("\n");
    const html = applyContentColoring(markdownToLiveHtml(md), { resetAtBlocks: true });
    const colored = quoteFragments(html).join("");
    /* 撇号只让本段后半截上色，绝不能染到后两段。 */
    expect(colored).not.toContain("他推开窗");
    expect(colored).not.toContain("她笑了笑");
    expect(colored).toContain("是他最喜欢的词");
    /* 后两段应保持普通段落的字数（引号色总量很小）。 */
    expect(countQuoteClass(html)).toBeLessThan(30);
  });

  it("ASCII 引号数量不对称时，不影响后续段落", () => {
    const md = [
      '他说了句"随便"就走了。',
      "第二段是正常叙述。",
      "第三段继续正常叙述。",
      "第四段还是正常叙述。",
    ].join("\n");
    const html = applyContentColoring(markdownToLiveHtml(md), { resetAtBlocks: true });
    const colored = quoteFragments(html).join("");
    expect(colored).not.toContain("第二段");
    expect(colored).not.toContain("第三段");
    expect(colored).not.toContain("第四段");
  });

  it("常见 AI 章节正文样例：不得出现大量段落被引号色贯穿", () => {
    const md = [
      "第一章 雨夜",
      "",
      "林晚推开茶室的门，雨水顺着伞骨淌下来，在门槛上汇成一小滩。",
      "柜台后的老板娘抬头看了她一眼：“这个点还来？”",
      "林晚把伞立在墙边，笑了笑：“约了人。”",
      "老板娘没说别的，只把炉子上的水重新烧上。",
      "墙上挂钟走到九点一刻。",
      "二楼传来脚步声，一个穿灰大衣的男人走下来。",
      "他停在林晚面前，低声说：“你还记得我吗？”",
      "林晚没有回答，只是看着窗外的雨。",
      "雨声很大，大到足够盖住很多不该说的话。",
    ].join("\n");
    const html = applyContentColoring(markdownToLiveHtml(md), { resetAtBlocks: true });
    const colored = quoteFragments(html).join("");
    expect(colored).not.toContain("雨声很大");
    expect(colored).not.toContain("挂钟走到九点一刻");
    expect(colored).not.toContain("老板娘没说别的");
    expect(colored).toContain("约了人");
    expect(colored).toContain("你还记得我吗");
  });
});

describe("markdown 预览（默认行为）保持跨段贯穿诊断", () => {
  it("不加 resetAtBlocks 时，未闭合引号仍贯穿后续段落（点名问题所在）", () => {
    const md = ["L'amour 是他最喜欢的词。", "他推开窗，风灌进来。", "她笑了笑，没接话。"].join("\n");
    const html = applyContentColoring(markdownToLiveHtml(md));
    const colored = quoteFragments(html).join("");
    /* 默认路径保持原有诊断行为：撇号开启后一直贯穿到文末。 */
    expect(colored).toContain("他推开窗");
    expect(colored).toContain("她笑了笑");
  });
});
