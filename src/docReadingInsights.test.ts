import { describe, expect, it } from "vitest";
import {
  buildPayoffMap,
  parseForeshadowLine,
  parseVolumeOutline,
  pickBestBlock,
  splitForeshadowEntries,
  toSearchKey,
} from "./docReadingInsights";

/**
 * 「地点 · 细纲」右栏的伏笔解析回归测试。
 *
 * 基准格式来自 src/prompts/chapterOutlineAgent.ts 的 CHAPTER_OUTLINE_TEMPLATE：
 *   【伏笔】
 *   ① [核心道具] —— 关联[后文具体章节及事件]（说明）；
 */

const fbTexts = (doc: string, chapterNum: number) =>
  (parseVolumeOutline(doc).find((c) => c.num === chapterNum)?.foreshadows ?? []);

describe("parseForeshadowLine", () => {
  it("剥离带圈序号并解析中文数字收回章号", () => {
    const fb = parseForeshadowLine("① 判官笔上的暗红指痕 —— 关联第十二章沈府对质（此物将成为翻案铁证）；");
    expect(fb.text).toBe("判官笔上的暗红指痕");
    expect(fb.targetChapter).toBe(12);
  });

  it("兼容「关联后文第X章」的插入语", () => {
    const fb = parseForeshadowLine("② 底层胥吏的怯懦 —— 关联后文第二十章民变（推动主线主题闭环）；");
    expect(fb.text).toBe("底层胥吏的怯懦");
    expect(fb.targetChapter).toBe(20);
  });

  it("兼容阿拉伯数字与括号收回写法", () => {
    expect(parseForeshadowLine("③ 褪色红绸 —— 关联第7章；").targetChapter).toBe(7);
    expect(parseForeshadowLine("- 伏笔：老井底的青铜匣 (第15章收回)").targetChapter).toBe(15);
    expect(parseForeshadowLine("1. 伏笔记录：断剑残锋 —— 收回点：第三章").text).toBe("断剑残锋");
    expect(parseForeshadowLine("⑤ 城南酒肆的暗号 → 第二十五章").targetChapter).toBe(25);
  });

  it("没有收回点时保留完整正文", () => {
    const fb = parseForeshadowLine("④ 林昭袖中那半枚虎符（尚未言明来历）。");
    expect(fb.text).toBe("林昭袖中那半枚虎符（尚未言明来历）。");
    expect(fb.targetChapter).toBeNull();
  });
});

describe("splitForeshadowEntries", () => {
  it("一行挤多条时按带圈序号拆开（旧实现在此漏计）", () => {
    const entries = splitForeshadowEntries([
      "① a —— 关联第一章；② b —— 关联第二章；③ c —— 关联第三章",
    ]);
    expect(entries).toHaveLength(3);
  });

  it("一条跨多行时按续行合并", () => {
    const entries = splitForeshadowEntries([
      "① 判官笔上的暗红指痕",
      "—— 关联第十二章沈府对质",
      "② 那封未拆的密信",
      "—— 关联第十五章",
    ]);
    expect(entries).toHaveLength(2);
  });

  it("无序号时一行即一条，不会被并成一条", () => {
    const entries = splitForeshadowEntries([
      "判官笔上的暗红指痕 —— 关联第十二章",
      "那封未拆的密信 —— 关联第十五章",
    ]);
    expect(entries).toHaveLength(2);
  });
});

describe("parseVolumeOutline · 伏笔计数完整性", () => {
  it("标准模板：5 条伏笔全部呈现", () => {
    const doc = `——第1章——
【五线落实对照】
- 情境：雨夜的临安府衙。
- 结局：林昭被押入死牢。

【场面设计】
1. **雨夜叩阍**：鼓声与雷声交叠。

【伏笔】
① 判官笔上的暗红指痕 —— 关联第十二章沈府对质；
② 底层胥吏的怯懦与沉默 —— 关联后文第二十章民变；
③ 停尸房梁上的褪色红绸 —— 关联第7章；
④ 城南暗桩的接头暗号 —— 关联第十八章；
⑤ 林昭袖中那半枚虎符 —— 关联第二十二章。
`;
    expect(fbTexts(doc, 1)).toHaveLength(5);
  });

  it("回归：后两条挤在同一行时仍应识别为 5 条（旧实现只出 3 条）", () => {
    const doc = `——第1章——
【伏笔】
① 判官笔上的暗红指痕 —— 关联第十二章；
② 底层胥吏的怯懦 —— 关联第二十章；
③ 褪色红绸 —— 关联第七章；④ 接头暗号 —— 关联第十八章；⑤ 半枚虎符 —— 关联第二十二章。
`;
    const fbs = fbTexts(doc, 1);
    expect(fbs).toHaveLength(5);
    expect(fbs.map((f) => f.targetChapter)).toEqual([12, 20, 7, 18, 22]);
  });

  it("回归：伏笔被后续【…】块截断时，块外圈号条目仍应补回（旧实现只出 3 条）", () => {
    const doc = `——第1章——
【伏笔】
① 判官笔上的暗红指痕 —— 关联第十二章；
② 底层胥吏的怯懦 —— 关联第二十章；
③ 褪色红绸 —— 关联第七章；

【下章衔接】
④ 接头暗号 —— 关联第十八章；
⑤ 半枚虎符 —— 关联第二十二章。
`;
    expect(fbTexts(doc, 1)).toHaveLength(5);
  });

  it("回归：条目跨行书写时不应被算成 10 条", () => {
    const doc = `——第1章——
【伏笔】
① 判官笔上的暗红指痕
   —— 关联第十二章沈府对质；
② 底层胥吏的怯懦
   —— 关联第二十章民变；
`;
    const fbs = fbTexts(doc, 1);
    expect(fbs).toHaveLength(2);
    expect(fbs[0].text).toBe("判官笔上的暗红指痕");
    expect(fbs[0].targetChapter).toBe(12);
  });

  it("兼容裸标题 / 加粗标题 / 同行内联三种伏笔写法", () => {
    const bare = `——第3章——
### 伏笔
① 驿丞袖口的暗纹 —— 关联第十一章；
② 那封未拆的密信 —— 关联第15章。
`;
    const bold = `——第3章——
**伏笔**：
- 驿丞袖口的暗纹 —— 关联第十一章
- 那封未拆的密信（第15章收回）
`;
    const inline = `——第3章——
【伏笔】① 驿丞袖口的暗纹 —— 关联第十一章；② 那封未拆的密信 —— 关联第15章。
`;
    for (const doc of [bare, bold, inline]) {
      const fbs = fbTexts(doc, 3);
      expect(fbs).toHaveLength(2);
      expect(fbs.map((f) => f.targetChapter)).toEqual([11, 15]);
    }
  });
});

describe("parseVolumeOutline · 不得回归本节构成", () => {
  const doc = `——第1章——
**【叙事手法·结构】**：失衡叙事三幕剧。

【五线落实对照】
- 情境：雨夜的临安府衙，判官笔与血书并置于案。
- 欲望：林昭要在天亮前取得翻案铁证。
- 阻碍：府衙大门落锁，唯一证人已被灭口。
- 行动：林昭孤身潜入停尸房。
- 结局：铁证到手却被当场夺走。

【场面设计】
1. **雨夜叩阍**：鼓声与雷声交叠。
2. **停尸验毒**：银针、烛火与血书三物交锋。
3. **反手成擒**：张府尹当庭翻脸。

【伏笔】
① 判官笔上的暗红指痕 —— 关联第十二章；
`;

  it("本节构成条数与五要素归属保持既有行为", () => {
    const ch = parseVolumeOutline(doc).find((c) => c.num === 1)!;
    expect(ch.sections).toHaveLength(5);
    expect(ch.sections[0].situation).toBe("雨夜的临安府衙，判官笔与血书并置于案。");
    expect(ch.sections[0].desire).toBe("林昭要在天亮前取得翻案铁证。");
    expect(ch.sections[0].conflict).toBe("府衙大门落锁，唯一证人已被灭口。");
    expect(ch.sections[1].label).toBe("行动");
    expect(ch.sections[1].result).toBe("铁证到手却被当场夺走。");
    expect(ch.sections.slice(2).map((s) => s.label)).toEqual([
      "雨夜叩阍**",
      "停尸验毒**",
      "反手成擒**",
    ]);
  });

  it("【场面设计】不会被伏笔区域吞掉", () => {
    const swallowed = `——第1章——
【伏笔】
① 驿丞袖口的暗纹 —— 关联第十一章；

【场面设计】
1. **雪夜驿站**：三方势力同席而坐。
2. **密信易主**：局势反转。
`;
    const ch = parseVolumeOutline(swallowed).find((c) => c.num === 1)!;
    expect(ch.foreshadows).toHaveLength(1);
    expect(ch.sections).toHaveLength(2);
  });
});

describe("buildPayoffMap · 收回点", () => {
  it("按中文数字章号正确归集到目标章", () => {
    const doc = `——第1章——
【伏笔】
① 判官笔上的暗红指痕 —— 关联第十二章；
② 那封未拆的密信 —— 关联第十二章；

——第3章——
【伏笔】
① 褪色红绸 —— 关联第十二章。
`;
    const map = buildPayoffMap(parseVolumeOutline(doc));
    expect(map.get(12)?.count).toBe(3);
    expect(map.get(12)?.items.map((i) => i.from)).toEqual(["第1章", "第1章", "第3章"]);
  });
});

describe("toSearchKey · 剥离细纲元信息", () => {
  it("去掉「—— 关联第X章」尾巴与括注说明", () => {
    expect(toSearchKey("判官笔上的暗红指痕 —— 关联第十二章沈府对质（此物将成为翻案铁证）；")).toBe(
      "判官笔上的暗红指痕",
    );
  });

  it("去掉带圈序号前缀", () => {
    expect(toSearchKey("③ 停尸房梁上的褪色红绸 —— 关联第7章；")).toBe("停尸房梁上的褪色红绸");
    expect(toSearchKey("1. 伏笔记录：断剑残锋 —— 收回点：第三章")).toBe("断剑残锋");
    expect(toSearchKey("- 伏笔：老井底的青铜匣 (第15章收回)")).toBe("老井底的青铜匣");
  });

  it("去掉不带破折号的收回点标注", () => {
    expect(toSearchKey("老井底的青铜匣 (第15章收回)")).toBe("老井底的青铜匣");
  });

  it("保留纯正文描述", () => {
    expect(toSearchKey("林昭袖中那半枚虎符")).toBe("林昭袖中那半枚虎符");
  });
});

describe("pickBestBlock · 正文定位", () => {
  /* 真实 Markdown 正文块：空行会被渲染成空的 .md-block。 */
  const blocks = [
    "第1章 雨夜叩阍",
    "",
    "雨水顺着屋檐砸下来，林昭把鼓槌攥得死紧。",
    "",
    "他借着烛火看清了那支判官笔，笔杆上有一抹早已发暗的红。",
    "",
    "张府尹合上卷宗，没有抬头。",
  ];

  it("回归：空块不得吞掉跳转（旧实现恒命中第一个空行）", () => {
    const hit = pickBestBlock(toSearchKey("判官笔上的暗红指痕 —— 关联第十二章"), blocks);
    expect(hit.index).not.toBe(1);
    expect(blocks[hit.index]).toContain("判官笔");
  });

  it("细纲概括说法能模糊匹配到正文措辞", () => {
    const hit = pickBestBlock(toSearchKey("判官笔上的暗红指痕"), blocks);
    expect(hit.index).toBe(4);
  });

  it("原文逐字出现时走精确命中", () => {
    const hit = pickBestBlock(toSearchKey("张府尹合上卷宗"), blocks);
    expect(hit.exact).toBe(true);
    expect(hit.index).toBe(6);
  });

  it("人名 / 地名等短键仍可精确定位", () => {
    expect(pickBestBlock("林昭", blocks).index).toBe(2);
  });

  it("正文里确实没有时返回未命中，而不是乱跳", () => {
    const hit = pickBestBlock(toSearchKey("城南酒肆的接头暗号 —— 关联第十八章"), blocks);
    expect(hit.index).toBe(-1);
  });

  it("全为空块时返回未命中", () => {
    expect(pickBestBlock("判官笔", ["", "", ""]).index).toBe(-1);
  });
});

