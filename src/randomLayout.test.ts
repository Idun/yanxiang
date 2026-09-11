import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  MAX_MERGED_LINES,
  MERGE_MAX_LIMIT,
  MERGE_MIN_LIMIT,
  randomizeLayout,
  SHORT_LINE_MAX,
  SHORT_LINE_MAX_LIMIT,
  SHORT_LINE_MIN_LIMIT,
} from "./randomLayout";

const run = (text: string, seed = 7) =>
  randomizeLayout(text, { random: createSeededRandom(seed) });

describe("短行合并", () => {
  it("一串一句一行的短句会被并成更少的行", () => {
    const text = ["他推开门。", "屋里很黑。", "灯忽然亮了。", "有人坐在那里。", "他愣住了。"].join("\n");
    const r = run(text);
    expect(r.merged).toBeGreaterThan(0);
    expect(r.text.split("\n").length).toBeLessThan(5);
    /* 合并只吃换行，一个字都不许丢。 */
    expect(r.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
  });

  it("并出来的段落不超过上限行数", () => {
    const text = Array.from({ length: 12 }, (_, i) => `第${i}句很短。`).join("\n");
    const r = run(text);
    for (const line of r.text.split("\n")) {
      /* 每行最多是 maxMerged 个短句拼起来的。 */
      expect(line.length).toBeLessThanOrEqual(MAX_MERGED_LINES * "第11句很短。".length);
    }
    expect(r.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
  });

  it("长段落一行都不动", () => {
    const long = "他站在门口，看着屋里的一切，忽然觉得这十年的光阴就像窗外那场雨，落下来就再也收不回去。";
    const text = [long, long, long].join("\n");
    const r = run(text);
    expect(r.text).toBe(text);
    expect(r.merged).toBe(0);
  });

  it("孤零零一行短句保持独立", () => {
    const r = run("雨夜。");
    expect(r.text).toBe("雨夜。");
    expect(r.merged).toBe(0);
  });

  it("阈值边界：刚好短的行参与，长一行就不参与", () => {
    const short = "短".repeat(SHORT_LINE_MAX); // 正好卡在阈值上
    const long = "长".repeat(SHORT_LINE_MAX + 1); // 刚好多一个字
    expect(short.length).toBe(SHORT_LINE_MAX);
    expect(long.length).toBe(SHORT_LINE_MAX + 1);

    const both = run([short, short].join("\n"));
    expect(both.merged).toBe(1);

    /* 中间夹着长行，两边的短行不成串，谁都并不了。 */
    const mixed = run([short, long, short].join("\n"));
    expect(mixed.text).toBe([short, long, short].join("\n"));
    expect(mixed.merged).toBe(0);
  });
});

describe("结构行与空行是硬边界", () => {
  it("标题、列表、引用、表格各自独立", () => {
    const text = [
      "# 第一章",
      "他推开门。",
      "屋里很黑。",
      "- 第一条",
      "- 第二条",
      "> 引一句话。",
      "| 甲 | 乙 |",
      "灯忽然亮了。",
      "有人坐在那里。",
    ].join("\n");
    const r = run(text);
    expect(r.text).toContain("# 第一章\n");
    expect(r.text).toContain("- 第一条\n- 第二条\n");
    expect(r.text).toContain("> 引一句话。\n");
    expect(r.text).toContain("| 甲 | 乙 |\n");
    expect(r.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
  });

  it("空行隔开的段落之间绝不合并", () => {
    const text = ["他推开门。", "屋里很黑。", "", "灯忽然亮了。", "有人坐在那里。"].join("\n");
    const r = run(text);
    expect(r.text).toContain("\n\n");
    expect(r.text.split("\n\n").length).toBe(2);
    expect(r.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
  });

  it("代码块内部一个换行都不吃", () => {
    const text = ["```js", "const a = 1;", "const b = 2;", "const c = 3;", "```"].join("\n");
    const r = run(text);
    expect(r.text).toBe(text);
    expect(r.merged).toBe(0);
  });

  it("分隔线与缩进代码块同样不碰", () => {
    const text = ["---", "他推开门。", "    const x = 1;", "屋里很黑。"].join("\n");
    const r = run(text);
    expect(r.text).toContain("---\n");
    expect(r.text).toContain("    const x = 1;\n");
  });

  it("对白各自成段：两个人的话绝不并进一段", () => {
    const text = ["“你终于来了。”", "“我来了。”", "“坐吧。”"].join("\n");
    const r = run(text);
    expect(r.text).toBe(text);
    expect(r.merged).toBe(0);
  });

  it("对白也不会被上下叙述吞掉", () => {
    const text = ["那人笑了笑。", "“坐吧。”", "他坐下。", "桌上有两只杯子。"].join("\n");
    const r = run(text);
    expect(r.text).toContain("那人笑了笑。\n");
    expect(r.text).toContain("“坐吧。”\n");
    expect(r.text).toContain("他坐下。桌上有两只杯子。");
  });

  it("直角引号与英文引号一并认作对白", () => {
    const text = ["「第一句。」", "「第二句。」", '"第三句。"'].join("\n");
    expect(run(text).text).toBe(text);
  });
});

describe("随机性", () => {
  it("同一段文字换个种子结果不同", () => {
    const text = Array.from({ length: 10 }, (_, i) => `第${i}句。`).join("\n");
    const a = run(text, 1).text;
    const b = run(text, 99).text;
    expect(a.replace(/\n/g, "")).toBe(b.replace(/\n/g, ""));
    expect(a).not.toBe(b);
    expect(run(text, 1).text).toBe(a); // 同种子可复现
  });

  it("留出参差：不是每一段都并满上限", () => {
    const text = Array.from({ length: 24 }, (_, i) => `第${i}句。`).join("\n");
    const sizes = run(text, 5)
      .text.split("\n")
      .map((l) => l.length / "第11句。".length);
    expect(sizes.some((s) => s < MAX_MERGED_LINES)).toBe(true);
  });
});

describe("可调参数", () => {
  const lines = Array.from({ length: 8 }, () => "十个字的短句子。"); // 每行 8 字

  it("短句上限调小后短句不再算短，一行都不并", () => {
    const text = lines.join("\n");
    const loose = randomizeLayout(text, {
      random: createSeededRandom(3),
      shortLineMax: 20,
    });
    const tight = randomizeLayout(text, {
      random: createSeededRandom(3),
      shortLineMax: SHORT_LINE_MIN_LIMIT, // 10 字，仍够得上 8 字的行
    });
    expect(loose.merged).toBeGreaterThan(0);
    expect(tight.merged).toBeGreaterThan(0);

    const longer = Array.from({ length: 8 }, () => "这是一句十五个字的句子哦。"); // 13 字
    const blocked = randomizeLayout(longer.join("\n"), {
      random: createSeededRandom(3),
      shortLineMax: 12,
    });
    expect(blocked.merged).toBe(0);
    expect(blocked.text).toBe(longer.join("\n"));
  });

  it("每段最多行数决定并出来的段落粗细", () => {
    const text = Array.from({ length: 16 }, () => "短句。").join("\n");
    const thin = randomizeLayout(text, {
      random: createSeededRandom(11),
      maxMergedLines: MERGE_MIN_LIMIT,
    });
    const thick = randomizeLayout(text, {
      random: createSeededRandom(11),
      maxMergedLines: MERGE_MAX_LIMIT,
    });
    /* 上限放大 → 行数更少（每行装得更多）。 */
    expect(thick.text.split("\n").length).toBeLessThan(thin.text.split("\n").length);
    for (const line of thin.text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(MERGE_MIN_LIMIT * "短句。".length);
    }
  });

  it("越界数值被夹回合法区间，不会炸也不会空转", () => {
    const text = Array.from({ length: 10 }, () => "短句。").join("\n");
    const insane = randomizeLayout(text, {
      random: createSeededRandom(4),
      shortLineMax: 99999,
      maxMergedLines: 99999,
    });
    /* maxMergedLines 被夹到上限，每行最多装这么多。 */
    for (const line of insane.text.split("\n")) {
      expect(line.length).toBeLessThanOrEqual(MERGE_MAX_LIMIT * "短句。".length);
    }
    expect(insane.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));

    const negative = randomizeLayout(text, {
      random: createSeededRandom(4),
      shortLineMax: -5,
      maxMergedLines: 0,
    });
    expect(negative.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));

    const nan = randomizeLayout(text, {
      random: createSeededRandom(4),
      shortLineMax: Number.NaN,
      maxMergedLines: Number.NaN,
    });
    expect(nan.text.replace(/\n/g, "")).toBe(text.replace(/\n/g, ""));
  });

  it("默认值落在可调区间内", () => {
    expect(SHORT_LINE_MAX).toBeGreaterThanOrEqual(SHORT_LINE_MIN_LIMIT);
    expect(SHORT_LINE_MAX).toBeLessThanOrEqual(SHORT_LINE_MAX_LIMIT);
    expect(MAX_MERGED_LINES).toBeGreaterThanOrEqual(MERGE_MIN_LIMIT);
    expect(MAX_MERGED_LINES).toBeLessThanOrEqual(MERGE_MAX_LIMIT);
  });
});

describe("边界情况", () => {
  it("空文本 / 单行原样返回", () => {
    expect(randomizeLayout("").text).toBe("");
    expect(randomizeLayout("就一行。").text).toBe("就一行。");
  });

  it("不增删空行，不动缩进与标点", () => {
    const text = ["  他推开门。  ", "屋里很黑。", "", "", "灯忽然亮了。", "有人坐在那里。"].join("\n");
    const r = run(text);
    const blankBefore = text.split("\n").filter((l) => l.trim() === "").length;
    const blankAfter = r.text.split("\n").filter((l) => l.trim() === "").length;
    expect(blankAfter).toBe(blankBefore);
    expect(r.text.replace(/\n/g, "").replace(/\s/g, "")).toBe(
      text.replace(/\n/g, "").replace(/\s/g, ""),
    );
  });

  it("行内标记不计入长度：加粗的短句仍算短句", () => {
    const text = ["**他推开门。**", "*屋里很黑。*", "灯忽然亮了。"].join("\n");
    expect(run(text).merged).toBeGreaterThan(0);
  });
});
