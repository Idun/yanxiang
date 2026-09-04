import { describe, expect, it } from "vitest";
import { contentScrollMax, mapScrollTop, scrollSpanOf } from "./typewriterScroll";

/**
 * 打字机滚动里与 DOM 无关的那部分：正文余量换算与两侧分段映射。
 *
 * 跑道（末尾预留的空白）不该掺进阅读进度，否则写到正文末尾时进度条只有 60%；
 * 而两个窗格互相同步时又必须把跑道算进去 —— 只按正文段映射，源窗格滚进跑道后
 * 目标窗格就卡在正文末尾不动（这正是「拼文对比看起来没有打字机滚动」的成因：
 * 可见的字由背层绘制，背层不跟着走，画面就是死的）。
 *
 * 行顶测量与舒适带判定依赖真实布局，留给手动验证。
 */

const fake = (scrollHeight: number, clientHeight: number) =>
  ({ scrollHeight, clientHeight }) as HTMLElement;

describe("contentScrollMax", () => {
  it("扣掉跑道后即为正文余量", () => {
    expect(contentScrollMax(fake(2000, 600), 250)).toBe(1150);
  });

  it("没有跑道时与真实余量一致", () => {
    expect(contentScrollMax(fake(2000, 600))).toBe(1400);
  });

  it("跑道大于余量时收敛到 0，不出现负值", () => {
    expect(contentScrollMax(fake(700, 600), 250)).toBe(0);
  });

  it("内容不足一屏时为 0", () => {
    expect(contentScrollMax(fake(400, 600), 250)).toBe(0);
  });

  it("元素缺失时为 0", () => {
    expect(contentScrollMax(null, 250)).toBe(0);
  });
});

describe("scrollSpanOf", () => {
  it("把可滚区间拆成正文段与跑道段", () => {
    expect(scrollSpanOf(fake(2000, 600), 250)).toEqual({ contentMax: 1150, runway: 250 });
  });

  it("真实余量不够一条跑道时，跑道按实际可滚的算", () => {
    expect(scrollSpanOf(fake(700, 600), 250)).toEqual({ contentMax: 0, runway: 100 });
  });

  it("内容不足一屏时两段都是 0", () => {
    expect(scrollSpanOf(fake(400, 600), 250)).toEqual({ contentMax: 0, runway: 0 });
  });

  it("元素缺失时两段都是 0", () => {
    expect(scrollSpanOf(null, 250)).toEqual({ contentMax: 0, runway: 0 });
  });
});

describe("mapScrollTop", () => {
  /* 两侧跑道长短刻意不同：正文段 1000 / 跑道 200 对 正文段 500 / 跑道 100。 */
  const from = { contentMax: 1000, runway: 200 };
  const to = { contentMax: 500, runway: 100 };

  it("文首映射到文首", () => {
    expect(mapScrollTop(0, from, to)).toBe(0);
  });

  it("正文段按比例映射到正文段", () => {
    expect(mapScrollTop(500, from, to)).toBe(250);
  });

  it("正文末尾映射到正文末尾（两侧同时是「最后一行贴底」）", () => {
    expect(mapScrollTop(1000, from, to)).toBe(500);
  });

  it("源窗格滚进跑道时，目标窗格也走自己的跑道而不是卡在正文末尾", () => {
    expect(mapScrollTop(1100, from, to)).toBe(550);
  });

  it("一侧滚到底时另一侧也刚好到底", () => {
    expect(mapScrollTop(1200, from, to)).toBe(600);
  });

  it("超出总余量时钳在底部", () => {
    expect(mapScrollTop(5000, from, to)).toBe(600);
  });

  it("源窗格没有正文余量（内容不足一屏）时目标回到文首", () => {
    expect(mapScrollTop(0, { contentMax: 0, runway: 0 }, to)).toBe(0);
  });

  it("源窗格只有跑道时，仍能把跑道映射过去", () => {
    expect(mapScrollTop(50, { contentMax: 0, runway: 100 }, to)).toBe(550);
  });

  it("目标窗格没有余量时返回 0", () => {
    expect(mapScrollTop(600, from, { contentMax: 0, runway: 0 })).toBe(0);
  });
});
