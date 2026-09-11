import { describe, expect, it } from "vitest";
import {
  computeDeletePairCorrection,
  computeInsertPairCorrection,
} from "./autoPairPunctuation";

/**
 * 成对标点自动补全的纯函数校正（文本域版与 WYSIWYG 版共用同一套规则）。
 *
 * 约定：before = 改动前文本；[beforeStart, beforeEnd) 是改动前选区；
 * after = 浏览器已落地的改动后文本；caret = 改动后光标位置。
 */

describe("computeInsertPairCorrection · 普通补全", () => {
  it("中文双引号：键入左引号自动补右引号，光标停在中间", () => {
    const r = computeInsertPairCorrection("他说", 2, 2, "他说“", 3, "“");
    expect(r).toEqual({ next: "他说“”", selStart: 3, selEnd: 3 });
  });

  it("中文单引号", () => {
    const r = computeInsertPairCorrection("说", 1, 1, "说‘", 2, "‘");
    expect(r).toEqual({ next: "说‘’", selStart: 2, selEnd: 2 });
  });

  it("书名号：键入《 自动补 》", () => {
    const r = computeInsertPairCorrection("读史", 2, 2, "读史《", 3, "《");
    expect(r).toEqual({ next: "读史《》", selStart: 3, selEnd: 3 });
  });

  it("全角括号：在段落中间补全", () => {
    const r = computeInsertPairCorrection("abcd", 2, 2, "ab（cd", 3, "（");
    expect(r).toEqual({ next: "ab（）cd", selStart: 3, selEnd: 3 });
  });

  it("半角括号同样补全", () => {
    const r = computeInsertPairCorrection("ab", 1, 1, "a(b", 2, "(");
    expect(r).toEqual({ next: "a()b", selStart: 2, selEnd: 2 });
  });

  it("非成对标点（字母）不做任何校正", () => {
    const r = computeInsertPairCorrection("a", 1, 1, "ab", 2, "b");
    expect(r).toBeNull();
  });
});

describe("computeInsertPairCorrection · 同形直引号", () => {
  it("紧跟在词内字符后面 → 按撇号处理，不补全", () => {
    const r = computeInsertPairCorrection("it", 2, 2, 'it"', 3, '"');
    expect(r).toBeNull();
  });

  it("行首 / 空格后 → 视为左引号，补上右引号", () => {
    const r = computeInsertPairCorrection(" hi", 1, 1, ' "hi', 2, '"');
    expect(r).toEqual({ next: ' ""hi', selStart: 2, selEnd: 2 });
  });

  it("光标正压在直引号前再打直引号 → 跨过去，不重复", () => {
    const r = computeInsertPairCorrection('a"', 1, 1, 'a""', 2, '"');
    expect(r).toEqual({ next: 'a"', selStart: 2, selEnd: 2 });
  });
});

describe("computeInsertPairCorrection · ASCII 引号在中文语境下转全角", () => {
  it("汉字后打 \" → 自动输出 “” 并补全，光标停在中间", () => {
    const r = computeInsertPairCorrection("他说", 2, 2, '他说"', 3, '"');
    expect(r).toEqual({ next: "他说“”", selStart: 3, selEnd: 3 });
  });

  it("中文标点后打 ' → 输出 ‘’ 并补全", () => {
    const r = computeInsertPairCorrection("他说，", 3, 3, "他说，'", 4, "'");
    expect(r).toEqual({ next: "他说，‘’", selStart: 4, selEnd: 4 });
  });

  it("选中中文后打 \" → 用全角引号整段包起来，包完保持选中", () => {
    const r = computeInsertPairCorrection("选中文字", 0, 4, '"', 1, '"');
    expect(r).toEqual({ next: "“选中文字”", selStart: 1, selEnd: 5 });
  });

  it("光标压在已补全的全角右引号前打 \" → 撤掉刚打的，直接跨过去", () => {
    const r = computeInsertPairCorrection("“他说”", 3, 3, '“他说"”', 4, '"');
    expect(r).toEqual({ next: "“他说”", selStart: 4, selEnd: 4 });
  });

  it("前面已有未闭合左引号时打 \" → 换成全角右引号收尾，不重复补另一半", () => {
    const r = computeInsertPairCorrection("他说“", 3, 3, '他说“"', 4, '"');
    expect(r).toEqual({ next: "他说“”", selStart: 4, selEnd: 4 });
  });

  it("行首（中文文档）打 \" → 开引号并补全", () => {
    const r = computeInsertPairCorrection("", 0, 0, '"', 1, '"');
    expect(r).toEqual({ next: "“”", selStart: 1, selEnd: 1 });
  });

  it("紧跟在半角字母后打 ' → 保留撇号语义，不转全角", () => {
    const r = computeInsertPairCorrection("他说 it", 5, 5, "他说 it'", 6, "'");
    expect(r).toBeNull();
  });
});

describe("computeInsertPairCorrection · 跨越 / 选中包裹", () => {
  it("光标压在同一个右引号前 → 撤掉刚打的字符直接跨过去", () => {
    const r = computeInsertPairCorrection("他道：“”", 4, 4, "他道：“””", 5, "”");
    expect(r).toEqual({ next: "他道：“”", selStart: 5, selEnd: 5 });
  });

  it("选中一段后键入左引号 → 整段包起来，包完保持选中", () => {
    const r = computeInsertPairCorrection("选中文字", 0, 4, "“", 1, "“");
    expect(r).toEqual({ next: "“选中文字”", selStart: 1, selEnd: 5 });
  });

  it("快照对不上当前值（非普通键入）→ 不校正", () => {
    const r = computeInsertPairCorrection("abc", 1, 1, "a“c", 2, "“");
    /* after 并不是「before + 插入 “」，快照过期，按无快照处理。 */
    expect(r).toBeNull();
  });
});

describe("computeDeletePairCorrection · 空对退格", () => {
  it("一对空引号中间退格 → 两半一起删", () => {
    const r = computeDeletePairCorrection("他说“”", 3, 3, "他说”", 2);
    expect(r).toEqual({ next: "他说", selStart: 2, selEnd: 2 });
  });

  it("一对空括号中间退格 → 两半一起删", () => {
    const r = computeDeletePairCorrection("（）", 1, 1, "）", 0);
    expect(r).toEqual({ next: "", selStart: 0, selEnd: 0 });
  });

  it("普通退格 → 不校正", () => {
    const r = computeDeletePairCorrection("你好", 1, 1, "好", 0);
    expect(r).toBeNull();
  });

  it("左标点后面不是对应右标点 → 不校正", () => {
    const r = computeDeletePairCorrection("（好", 1, 1, "好", 0);
    expect(r).toBeNull();
  });
});
