import { describe, expect, it } from "vitest";
import { parseRefinedLines, splitSentences } from "./refineText";

describe("splitSentences", () => {
  it("把右引号并进前一句，而不是让它孤零零地开启下一句", () => {
    expect(splitSentences('他说：“走吧。”于是两人推门出去。')).toEqual([
      '他说：“走吧。”',
      "于是两人推门出去。",
    ]);
    expect(splitSentences("他喊道：「快跑！」身后传来脚步声。")).toEqual([
      "他喊道：「快跑！」",
      "身后传来脚步声。",
    ]);
  });

  it("连写的句末标点算一个终止串", () => {
    expect(splitSentences("真的吗？！我不敢信。")).toEqual(["真的吗？！", "我不敢信。"]);
  });

  it("不在小数点处断开", () => {
    expect(splitSentences("这是 3.14 的近似值。下一句。")).toEqual([
      "这是 3.14 的近似值。",
      "下一句。",
    ]);
  });

  it("句中省略号不断句", () => {
    expect(splitSentences("第一句……第二句。")).toEqual(["第一句……第二句。"]);
  });

  it("普通多句按句末标点切开", () => {
    expect(splitSentences("他站起来。她没抬头。风把帘子掀起来一角。")).toEqual([
      "他站起来。",
      "她没抬头。",
      "风把帘子掀起来一角。",
    ]);
  });

  it("段落换行留在下一句句首，拼回后与原文完全一致", () => {
    const text = "段落一。\n\n段落二。";
    expect(splitSentences(text)).toEqual(["段落一。", "\n\n段落二。"]);
    expect(splitSentences(text).join("")).toBe(text);
  });

  it("切分无损：各段拼回等于原文", () => {
    const samples = [
      '他说：“走吧。”于是两人推门出去。',
      "真的吗？！我不敢信。",
      "他停下（大概是想起了什么），又继续走。他没回头。",
      "这是 3.14 的近似值。下一句。",
      "没有句末标点的一段话",
    ];
    for (const s of samples) {
      expect(splitSentences(s).join("")).toBe(s);
    }
  });

  it("纯空白不产出句子", () => {
    expect(splitSentences("   \n  ")).toEqual([]);
    expect(splitSentences("")).toEqual([]);
  });
});

describe("parseRefinedLines", () => {
  const expectHit = (line: string) => {
    const { lines, parsed } = parseRefinedLines(line, 3);
    expect(parsed, line).toBe(1);
    expect(lines[0], line).toBe("他站起来。");
  };

  it("认得模型常用的各种编号写法", () => {
    for (const line of [
      "[1] 他站起来。",
      "[1]他站起来。",
      "[1]. 他站起来。",
      "**[1]** 他站起来。",
      "1. 他站起来。",
      "1.他站起来。",
      "1、他站起来。",
      "1) 他站起来。",
      "（1）他站起来。",
      "【1】他站起来。",
      "［1］他站起来。",
      "(1) 他站起来。",
      "1: 他站起来。",
      "1：他站起来。",
      "第1句：他站起来。",
      "第 1 条：他站起来。",
      "- [1] 他站起来。",
    ]) {
      expectHit(line);
    }
  });

  it("不把小数、普通句子、代码围栏当成编号行", () => {
    for (const line of [
      "3.14 是圆周率，这个数字大家都知道。",
      "他说：走吧。",
      "```",
      "|---|---|",
      "以下是精修结果：",
    ]) {
      expect(parseRefinedLines(line, 5).parsed, line).toBe(0);
    }
  });

  it("整组混合编号能逐句对上号", () => {
    const block = [
      "[1] 他起身，掸掉身上的灰。",
      "2.她没抬头。",
      "（3）门外的风把帘子掀起来一角。",
      "第4句：他把手插进兜里。",
      "5) 巷子深处传来一声狗叫。",
    ].join("\n");
    const { lines, parsed } = parseRefinedLines(block, 5);
    expect(parsed).toBe(5);
    expect(lines).toEqual([
      "他起身，掸掉身上的灰。",
      "她没抬头。",
      "门外的风把帘子掀起来一角。",
      "他把手插进兜里。",
      "巷子深处传来一声狗叫。",
    ]);
  });

  it("缺行、越界编号、空正文都退化为空串而不是报错", () => {
    const { lines, parsed } = parseRefinedLines("[1] 甲。\n[9] 越界。\n[3]", 3);
    expect(parsed).toBe(1);
    expect(lines).toEqual(["甲。", "", ""]);
  });

  it("行数超过 count 时不会越界写入", () => {
    const { lines } = parseRefinedLines("[1] 甲。\n[2] 乙。", 1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe("甲。");
  });
});
