// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import MarkdownWysiwyg from "./MarkdownWysiwyg.vue";

/**
 * WYSIWYG 编辑区的写作规范波浪线 + 悬停提示数据。
 *
 * 这里守的是一个真实回归：mark 属性名曾经写成 camelCase（data-ruleName），
 * HTML 解析器统一小写后变成 data-rulename，读取端拿 data-rule-name 永远取空，
 * 导致 WYSIWYG 模式弹出的提示面板没有词条名与描述，与 markdown 编辑区不一致。
 */

beforeAll(() => {
  const w = window as unknown as Record<string, unknown>;
  if (!w.ResizeObserver) {
    w.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  if (!window.matchMedia) {
    window.matchMedia = ((q: string) => ({
      matches: false,
      media: q,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
  if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
      setTimeout(() => cb(Date.now()), 16)) as unknown as typeof window.requestAnimationFrame;
  }
});

function mountWysiwyg(
  ruleHighlight: Array<{ name: string; severity: "warn" | "hint"; description?: string }>,
  onRuleHover?: (p: unknown) => void,
  modelValue = "他指尖微凉，指尖微凉得厉害。",
) {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const app = createApp(
    defineComponent({
      setup() {
        return () =>
          h(MarkdownWysiwyg, {
            modelValue,
            ruleHighlight,
            onRuleHover: onRuleHover as never,
          });
      },
    }),
  );
  app.mount(root);
  return { root, app };
}

describe("MarkdownWysiwyg 写作规范波浪线", () => {
  it("按词条逐处包裹 mark.rule-mark，并带上 kebab-case 的 data-* 提示数据", async () => {
    const { root, app } = mountWysiwyg([
      { name: "指尖微凉", severity: "warn", description: "太文青" },
    ]);
    await nextTick();
    await nextTick();

    const marks = root.querySelectorAll("mark.rule-mark");
    expect(marks.length).toBe(2);
    expect(marks[0].classList.contains("rule-warn")).toBe(true);

    /* 关键：属性名必须是小写连字符形式，读取端才取得到。 */
    expect(marks[0].getAttribute("data-rule-name")).toBe("指尖微凉");
    expect(marks[0].getAttribute("data-rule-severity")).toBe("warn");
    expect(marks[0].getAttribute("data-rule-desc")).toBe("太文青");

    app.unmount();
    root.remove();
  });

  it("悬停波浪线时上抛与 markdown 编辑区同构的提示载荷", async () => {
    const payloads: unknown[] = [];
    const { root, app } = mountWysiwyg(
      [{ name: "指尖微凉", severity: "warn", description: "太文青" }],
      (p) => payloads.push(p),
    );
    await nextTick();
    await nextTick();

    const mark = root.querySelector("mark.rule-mark") as HTMLElement;
    expect(mark).not.toBeNull();
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 120, clientY: 240 }));
    await nextTick();

    expect(payloads.length).toBe(1);
    expect(payloads[0]).toMatchObject({
      name: "指尖微凉",
      severity: "warn",
      description: "太文青",
      x: 120,
      y: 240,
    });

    app.unmount();
    root.remove();
  });

  it("离开波浪线时上抛 null 以收起提示面板", async () => {
    const payloads: unknown[] = [];
    const { root, app } = mountWysiwyg(
      [{ name: "指尖微凉", severity: "warn" }],
      (p) => payloads.push(p),
    );
    await nextTick();
    await nextTick();

    const mark = root.querySelector("mark.rule-mark") as HTMLElement;
    mark.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, clientX: 10, clientY: 20 }));
    await nextTick();

    const editor = root.querySelector(".wysiwyg-editor") as HTMLElement;
    editor.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await nextTick();

    expect(payloads[payloads.length - 1]).toBeNull();

    app.unmount();
    root.remove();
  });

  it("无规则时不产生任何标记", async () => {
    const { root, app } = mountWysiwyg([]);
    await nextTick();
    await nextTick();

    expect(root.querySelectorAll("mark.rule-mark").length).toBe(0);

    app.unmount();
    root.remove();
  });

  it("与 markdown 覆盖层同一口径：省略号句式跨段命中", async () => {
    const { root, app } = mountWysiwyg(
      [{ name: "不仅……而且……", severity: "warn", description: "递进句式" }],
      undefined,
      "这不仅让局势紧张，而且彻底失控了。",
    );
    await nextTick();
    await nextTick();

    const marks = root.querySelectorAll("mark.rule-mark");
    expect(marks.length).toBe(1);
    expect((marks[0] as HTMLElement).textContent).toBe("不仅让局势紧张，而且");
    expect(marks[0].getAttribute("data-rule-name")).toBe("不仅……而且……");

    app.unmount();
    root.remove();
  });

  it("跨块（跨行）命中时逐块包裹，不截断在第一块", async () => {
    const { root, app } = mountWysiwyg(
      [{ name: "不仅……而且……", severity: "warn" }],
      undefined,
      "不仅局势紧张\n而且彻底失控",
    );
    await nextTick();
    await nextTick();

    const marks = Array.from(root.querySelectorAll("mark.rule-mark")) as HTMLElement[];
    expect(marks.length).toBe(2);
    expect(marks.map((m) => m.textContent)).toEqual(["不仅局势紧张", "而且"]);

    app.unmount();
    root.remove();
  });
});
