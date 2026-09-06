import { describe, expect, it } from "vitest";
import {
  AUTO_SAVE_MINUTES_MAX,
  AUTO_SAVE_MINUTES_MIN,
  DEFAULT_AUTO_SAVE_MINUTES,
  clampAutoSaveMinutes,
} from "./settings";

describe("clampAutoSaveMinutes", () => {
  it("保留区间内的整数分钟", () => {
    for (let m = AUTO_SAVE_MINUTES_MIN; m <= AUTO_SAVE_MINUTES_MAX; m++) {
      expect(clampAutoSaveMinutes(m)).toBe(m);
    }
  });

  it("越界值收进 1–5 分钟", () => {
    expect(clampAutoSaveMinutes(0)).toBe(AUTO_SAVE_MINUTES_MIN);
    expect(clampAutoSaveMinutes(-30)).toBe(AUTO_SAVE_MINUTES_MIN);
    expect(clampAutoSaveMinutes(6)).toBe(AUTO_SAVE_MINUTES_MAX);
    expect(clampAutoSaveMinutes(999)).toBe(AUTO_SAVE_MINUTES_MAX);
  });

  it("小数四舍五入到整分钟", () => {
    expect(clampAutoSaveMinutes(2.4)).toBe(2);
    expect(clampAutoSaveMinutes(2.5)).toBe(3);
  });

  it("非法数值回落到默认值", () => {
    expect(clampAutoSaveMinutes(Number.NaN)).toBe(DEFAULT_AUTO_SAVE_MINUTES);
    expect(clampAutoSaveMinutes(Number.POSITIVE_INFINITY)).toBe(DEFAULT_AUTO_SAVE_MINUTES);
    expect(clampAutoSaveMinutes(Number("abc"))).toBe(DEFAULT_AUTO_SAVE_MINUTES);
  });

  it("默认值落在允许区间内", () => {
    expect(DEFAULT_AUTO_SAVE_MINUTES).toBeGreaterThanOrEqual(AUTO_SAVE_MINUTES_MIN);
    expect(DEFAULT_AUTO_SAVE_MINUTES).toBeLessThanOrEqual(AUTO_SAVE_MINUTES_MAX);
  });
});
