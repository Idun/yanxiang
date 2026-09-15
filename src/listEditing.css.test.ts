import { describe, expect, it } from "vitest";
import markdownWysiwyg from "./components/MarkdownWysiwyg.vue?raw";
import packageJsonRaw from "../package.json?raw";

/**
 * 列表语法溢出防护：MarkdownWysiwyg 的列表项样式回归测试。
 *
 * 背景（修复前的 bug）：列表项用 `text-indent: -1.6em` 实现项目符号悬挂缩进。
 * 聚焦时会隐藏 .md-bullet / .md-number 并显示 .md-syntax（- / 1.），
 * 但负 text-indent 仍然生效，把暴露出的 Markdown 语法拽到内边距之外，
 * 于是 `- ` / `1. ` 溢出正文左缘，而不是紧贴文字。
 */

const vue = markdownWysiwyg;

/** 截取从 `anchor` 起、到该 CSS 规则块结束（`}` 独占一行）为止的文本。 */
function cssBlock(anchor: string): string {
  const i = vue.indexOf(anchor);
  if (i < 0) return "";
  const rest = vue.slice(i);
  const m = /\r?\n\}\r?\n/.exec(rest);
  return m ? rest.slice(0, m.index + m[0].length) : rest;
}

describe("MarkdownWysiwyg 列表语法溢出修复", () => {
  it("列表项不再使用负 text-indent（溢出的根因）", () => {
    const item = cssBlock(":deep(.md-list-item) {");
    expect(item).toBeTruthy();
    expect(item).not.toContain("text-indent");
    expect(item).toContain("position: relative");
    expect(item).toContain("padding-left: 1.6em");
  });

  it("项目符号 / 序号绝对定位在左侧槽位内，不参与文本流", () => {
    const bullet = cssBlock(":deep(.md-bullet),");
    expect(bullet).toBeTruthy();
    expect(bullet).toContain("position: absolute");
    expect(bullet).toContain("left: 0");
    expect(bullet).toContain("width: 1.5em");
    expect(bullet).not.toContain("margin-right");
  });

  it("聚焦时收窄内边距，让 - / 1. 语法完整落在正文左缘之内", () => {
    const focused = cssBlock(":deep(.md-block.is-focused.md-list-item),");
    expect(focused).toBeTruthy();
    expect(focused).toContain("padding-left: 0.5em");
  });

  it("聚焦时折叠项目符号并显式暴露 md-syntax", () => {
    const hideBullet = cssBlock(":deep(.md-block.is-focused .md-bullet),");
    expect(hideBullet).toContain("display: none");

    const showSyntax = cssBlock(":deep(.md-block.is-focused.md-list-item > .md-syntax),");
    expect(showSyntax).toContain("display: inline");
  });
});

describe("npm 单一包管理", () => {
  const pkg = JSON.parse(packageJsonRaw) as {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("依赖完整且不含冲突的 @types/animejs", () => {
    expect(pkg.dependencies.animejs).toBeTruthy();
    expect(pkg.dependencies["@types/animejs"]).toBeUndefined();
    expect(pkg.devDependencies.vitest).toBeTruthy();
    expect(pkg.devDependencies.jsdom).toBeTruthy();
  });
});