import { describe, expect, it } from "vitest";
import {
  clampLayoutMaxMergedLines,
  clampLayoutShortLineMax,
} from "./settings";
import {
  MAX_MERGED_LINES,
  MERGE_MAX_LIMIT,
  MERGE_MIN_LIMIT,
  SHORT_LINE_MAX,
  SHORT_LINE_MAX_LIMIT,
  SHORT_LINE_MIN_LIMIT,
} from "./randomLayout";

/*
 * 随机排版参数落盘 / 恢复时的夹紧：
 * 面板滑块本身被 min/max 框住，但持久化还原读的是字符串，
 * 可能是手改 localStorage 的脏数据（NaN / 越界 / 小数），
 * 这两个 clamp 负责把值拉回合法区间，默认值兜底。
 */
describe("clampLayoutShortLineMax", () => {
  it("阈值内取整保留", () => {
    expect(clampLayoutShortLineMax(40)).toBe(40);
    expect(clampLayoutShortLineMax(45.6)).toBe(46);
  });

  it("越界夹回区间端点", () => {
    expect(clampLayoutShortLineMax(-5)).toBe(SHORT_LINE_MIN_LIMIT);
    expect(clampLayoutShortLineMax(99999)).toBe(SHORT_LINE_MAX_LIMIT);
  });

  it("NaN 兜底到默认值", () => {
    expect(clampLayoutShortLineMax(Number.NaN)).toBe(SHORT_LINE_MAX);
    expect(clampLayoutShortLineMax(Number("oops"))).toBe(SHORT_LINE_MAX);
  });
});

describe("clampLayoutMaxMergedLines", () => {
  it("阈值内保留", () => {
    expect(clampLayoutMaxMergedLines(4)).toBe(4);
    expect(clampLayoutMaxMergedLines(6)).toBe(6);
  });

  it("越界夹回区间端点", () => {
    expect(clampLayoutMaxMergedLines(0)).toBe(MERGE_MIN_LIMIT);
    expect(clampLayoutMaxMergedLines(999)).toBe(MERGE_MAX_LIMIT);
  });

  it("NaN 兜底到默认值", () => {
    expect(clampLayoutMaxMergedLines(Number.NaN)).toBe(MAX_MERGED_LINES);
  });
});