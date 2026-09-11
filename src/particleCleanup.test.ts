import { describe, expect, it } from "vitest";
import { cleanParticles, type Particle } from "./particleCleanup";

const LE: Particle[] = ["了"];
const DE1: Particle[] = ["的"];
const DI: Particle[] = ["地"];
const DE2: Particle[] = ["得"];
const ALL: Particle[] = ["的", "地", "得"];

const smart = (text: string, tokens: Particle[]) => cleanParticles(text, tokens, "smart").text;

describe("了 · 必要用法一个不动", () => {
  it("读 liǎo 的词不拆", () => {
    expect(smart("他了解这件事。", LE)).toBe("他了解这件事。");
    expect(smart("这事总算了结了。", LE)).toBe("这事总算了结了。");
    expect(smart("他一目了然。", LE)).toBe("他一目了然。");
  });

  it("固定搭配不拆", () => {
    expect(smart("除了他，没人知道。", LE)).toBe("除了他，没人知道。");
    expect(smart("为了活下去，他什么都干。", LE)).toBe("为了活下去，他什么都干。");
    expect(smart("他受不了这个味道。", LE)).toBe("他受不了这个味道。");
    expect(smart("不过是个玩笑罢了。", LE)).toBe("不过是个玩笑罢了。");
  });

  it("句末表变化的「了」是句子的骨头", () => {
    expect(smart("他走了。", LE)).toBe("他走了。");
    expect(smart("他走了，我也走了。", LE)).toBe("他走了，我也走了。");
    expect(smart("太好了！", LE)).toBe("太好了！");
  });

  it("V了V、了+数量、了+语气词都留", () => {
    expect(smart("他看了看我。", LE)).toBe("他看了看我。");
    expect(smart("他等了三年。", LE)).toBe("他等了三年。");
    expect(smart("你吃了吗？", LE)).toBe("你吃了吗？");
    expect(smart("他病了很久。", LE)).toBe("他病了很久。");
    expect(smart("吃了之后再说。", LE)).toBe("吃了之后再说。");
    expect(smart("他吃了就走。", LE)).toBe("他吃了就走。");
  });

  it("「成了」删掉句子就不通", () => {
    expect(smart("他成了英雄。", LE)).toBe("他成了英雄。");
  });
});

describe("了 · 句中堆砌的完成体该删", () => {
  it("网文最典型的一串「了」", () => {
    expect(smart("他推开了门，走进了房间，看到了桌上的信。", LE)).toBe(
      "他推开门，走进房间，看到桌上的信。",
    );
  });

  it("必要与冗余混在一句里各判各的", () => {
    const r = cleanParticles("他放下了茶杯，站起来走了。", LE, "smart");
    expect(r.text).toBe("他放下茶杯，站起来走了。");
    expect(r.perParticle.了).toEqual({ removed: 1, kept: 1 });
  });
});

describe("的 · 一个小句只留最后一个", () => {
  it("的的不休削成一个", () => {
    expect(smart("他的手上的伤还没好。", DE1)).toBe("他手上的伤还没好。");
    expect(smart("我的朋友的书不见了。", DE1)).toBe("我朋友的书不见了。");
  });

  it("单个「的」是结构，不动", () => {
    expect(smart("我的书。", DE1)).toBe("我的书。");
    expect(smart("这是他的。", DE1)).toBe("这是他的。");
    expect(smart("他说的是真话。", DE1)).toBe("他说的是真话。");
    expect(smart("我来的时候他已经走了。", DE1)).toBe("我来的时候他已经走了。");
  });

  it("的确、的话、目的、似的不拆", () => {
    expect(smart("他的确来过。", DE1)).toBe("他的确来过。");
    expect(smart("要是可以的话，我想去。", DE1)).toBe("要是可以的话，我想去。");
    expect(smart("他的目的很明显。", DE1)).toBe("他的目的很明显。");
    expect(smart("像是睡着了似的。", DE1)).toBe("像是睡着了似的。");
  });

  it("并列短语各管各的，不算的的不休", () => {
    expect(smart("我的书和他的笔都不见了。", DE1)).toBe("我的书和他的笔都不见了。");
  });

  it("颜色/属性类定语的「的」可省", () => {
    expect(smart("红色的头发。", DE1)).toBe("红色头发。");
    expect(smart("理性的选择。", DE1)).toBe("理性选择。");
  });
});

describe("地 · 只删状语助词", () => {
  it("叠字状语与常见状语后的「地」可删", () => {
    expect(smart("他慢慢地走过来。", DI)).toBe("他慢慢走过来。");
    expect(smart("她轻轻地放下杯子。", DI)).toBe("她轻轻放下杯子。");
    expect(smart("他忽然地停住。", DI)).toBe("他忽然停住。");
    expect(smart("他用力地推开门。", DI)).toBe("他用力推开门。");
    expect(smart("他大声地喊。", DI)).toBe("他大声喊。");
  });

  it("名词性的「地」一个不动", () => {
    expect(smart("他躺在地上。", DI)).toBe("他躺在地上。");
    expect(smart("这块土地很肥沃。", DI)).toBe("这块土地很肥沃。");
    expect(smart("他心地善良。", DI)).toBe("他心地善良。");
    expect(smart("目的地还很远。", DI)).toBe("目的地还很远。");
    expect(smart("他猛地站起来。", DI)).toBe("他猛地站起来。");
    expect(smart("当地人都这么说。", DI)).toBe("当地人都这么说。");
  });
});

describe("得 · 智能模式下全部保留", () => {
  it("补语、动词、助动词三种用法删掉都会错", () => {
    const text = "他跑得很快，觉得值得再试，我得走了。";
    const r = cleanParticles(text, DE2, "smart");
    expect(r.text).toBe(text);
    expect(r.removed).toBe(0);
    expect(r.perParticle.得.kept).toBe(4);
  });
});

describe("保护区", () => {
  it("代码块、行内代码、链接地址不参与清理", () => {
    const text = "看这段：\n```js\nconst 的地得 = 1; // 他推开了门\n```\n还有 `他的的确确` 与 [说明](https://a.com/的地得)。";
    expect(cleanParticles(text, [...ALL, "了"], "smart").text).toBe(text);
  });

  it("全部删除模式同样跳过保护区", () => {
    const r = cleanParticles("`他的书`他的手上的伤", DE1, "all");
    expect(r.text).toBe("`他的书`他手上伤");
    expect(r.removed).toBe(2);
  });
});

describe("模式与统计", () => {
  it("all 模式无差别删除", () => {
    expect(cleanParticles("他了解了这件事。", LE, "all").text).toBe("他解这件事。");
  });

  it("统计分字返回", () => {
    const r = cleanParticles("他慢慢地推开了门，走进了他的房间。", ["了", "地", "的"], "smart");
    expect(r.perParticle.地.removed).toBe(1);
    expect(r.perParticle.了.removed).toBe(2);
    expect(r.removed).toBe(r.perParticle.了.removed + r.perParticle.地.removed + r.perParticle.的.removed);
  });

  it("空文本 / 空选择原样返回", () => {
    expect(cleanParticles("", LE, "smart").text).toBe("");
    expect(cleanParticles("他走了。", [], "smart").text).toBe("他走了。");
  });
});
