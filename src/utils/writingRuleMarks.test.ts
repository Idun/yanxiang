import { describe, it, expect } from "vitest";
import {
  collectWritingRuleMarks,
  ruleHighlightTerms,
  severityOf,
} from "./writingRuleMarks";
import { WritingRuleItem } from "../types/writingRules";

function rule(
  id: string,
  category: WritingRuleItem["category"],
  name: string,
  description?: string,
): WritingRuleItem {
  return { id, category, name, description, createdAt: 0 };
}

describe("writingRuleMarks", () => {
  it("maps banned categories to warn and others to hint", () => {
    expect(severityOf("banned_word")).toBe("warn");
    expect(severityOf("banned_sentence")).toBe("warn");
    expect(severityOf("common_word")).toBe("hint");
    expect(severityOf("technique")).toBe("hint");
  });

  it("collects every literal occurrence with exact offsets", () => {
    const text = "他指尖微凉，指尖微凉得厉害。";
    const marks = collectWritingRuleMarks(text, [rule("1", "banned_word", "指尖微凉")]);
    expect(marks.length).toBe(2);
    expect(text.slice(marks[0].start, marks[0].end)).toBe("指尖微凉");
    expect(text.slice(marks[1].start, marks[1].end)).toBe("指尖微凉");
    expect(marks[0].severity).toBe("warn");
  });

  it("treats ellipsis-separated patterns as a spanning match", () => {
    const text = "这不仅让局势紧张，而且彻底失控了。";
    const marks = collectWritingRuleMarks(text, [
      rule("2", "banned_sentence", "不仅……而且……"),
    ]);
    expect(marks.length).toBe(1);
    expect(text.slice(marks[0].start, marks[0].end)).toBe("不仅让局势紧张，而且");
  });

  it("is case-insensitive for latin text and escapes regex metacharacters", () => {
    const text = "AI ai A.I. [说明]";
    const marks = collectWritingRuleMarks(text, [
      rule("3", "banned_word", "ai"),
      rule("4", "banned_word", "[说明]"),
    ]);
    const hits = marks.map((m) => text.slice(m.start, m.end));
    expect(hits).toContain("AI");
    expect(hits).toContain("ai");
    expect(hits).toContain("[说明]");
    expect(marks.length).toBe(3);
  });

  it("returns nothing for empty text, empty rules or blank names", () => {
    expect(collectWritingRuleMarks("", [rule("1", "banned_word", "x")])).toEqual([]);
    expect(collectWritingRuleMarks("内容", [])).toEqual([]);
    expect(collectWritingRuleMarks("内容", [rule("1", "banned_word", "   ")])).toEqual([]);
  });

  it("dedupes identical ranges and sorts by start offset", () => {
    const text = "甲甲乙";
    const marks = collectWritingRuleMarks(text, [
      rule("1", "banned_word", "甲甲"),
      rule("2", "common_word", "甲甲"),
    ]);
    expect(marks.length).toBe(1);
    expect(marks[0].start).toBe(0);
    expect(marks[0].end).toBe(2);
  });

  it("builds a de-duplicated term table for the WYSIWYG layer", () => {
    const terms = ruleHighlightTerms([
      rule("1", "banned_word", "指尖微凉", "太文青"),
      rule("2", "banned_sentence", "指尖微凉"),
      rule("3", "common_word", "宛如"),
    ]);
    expect(terms.length).toBe(2);
    expect(terms[0]).toEqual({ name: "指尖微凉", severity: "warn", description: "太文青" });
    expect(terms[1]).toEqual({ name: "宛如", severity: "hint", description: undefined });
  });
});
