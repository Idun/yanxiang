import { describe, expect, it } from "vitest";
import { pickBestBlock, toSearchKey } from "./docReadingInsights";

/** 一段贴近真实的正文：段落之间有空行（会渲染成空的 .md-block）。 */
const body = [
  "第1章 雨夜叩阍",
  "",
  "雨水顺着屋檐砸下来，林昭把鼓槌攥得死紧。三通鼓毕，府衙的灯火反倒一盏盏熄了。",
  "",
  "停尸房里潮气很重。他借着烛火看清了那支判官笔，笔杆上有一抹早已发暗的红。",
  "",
  "廊下的胥吏们低着头，谁也不肯接他的话。有人往后缩了半步，鞋底在青砖上磨出一声轻响。",
  "",
  "梁上垂着一截红绸，颜色褪得几乎看不出本来的样子。",
  "",
  "张府尹合上卷宗，没有抬头：「盗尸之罪，先收押。」",
  "",
  "铁门在身后合拢。林昭摸了摸袖中那半枚虎符，指腹被边缘硌得生疼。",
].map((s) => s);

/** 期望：细纲里的伏笔条目 → 正文中对应段落的下标。 */
const cases: Array<[string, number]> = [
  ["① 判官笔上的暗红指痕 —— 关联第十二章沈府对质（此物将成为翻案铁证）；", 4],
  ["② 底层胥吏的怯懦与沉默 —— 关联后文第二十章民变；", 6],
  ["③ 停尸房梁上的褪色红绸 —— 关联第7章；", 8],
  ["④ 林昭袖中那半枚虎符 —— 关联第二十二章。", 12],
];

describe("侧栏跳转 · 端到端定位", () => {
  it.each(cases)("伏笔「%s」定位到正文段落", (entry, expected) => {
    const hit = pickBestBlock(toSearchKey(entry), body);
    expect(hit.index).toBe(expected);
  });

  it("绝不命中空块", () => {
    const emptyIdx = body.map((t, i) => (t.trim() ? -1 : i)).filter((i) => i >= 0);
    for (const [entry] of cases) {
      const hit = pickBestBlock(toSearchKey(entry), body);
      expect(emptyIdx).not.toContain(hit.index);
    }
  });

  it("正文尚未写到的伏笔不产生误跳", () => {
    for (const entry of [
      "⑤ 城南酒肆的接头暗号 —— 关联第十八章；",
      "⑥ 漕运账册上的朱批 —— 关联第三十章；",
    ]) {
      expect(pickBestBlock(toSearchKey(entry), body).index).toBe(-1);
    }
  });

  it("收回点条目（来自前章的伏笔文本）同样可定位", () => {
    expect(pickBestBlock(toSearchKey("停尸房梁上的褪色红绸"), body).index).toBe(8);
  });
});
