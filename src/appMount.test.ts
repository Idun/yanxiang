// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import App from "./App.vue";
import MarkdownWysiwyg from "./components/MarkdownWysiwyg.vue";
import { autoPairDirective } from "./autoPairPunctuation";

type Dictionary = {
  [key: string]: unknown;
  [index: number]: unknown;
};

/**
 * 启动冒烟测试：把整个 App 挂到 jsdom 上，捕获挂载 / 首帧渲染抛出的错误。
 * 曾出过「setup 阶段 evaluate 到声明在后面的 computed → ReferenceError → 整页空白」的回归，
 * 这类错误只有真正挂载 <App> 才能拦下来。
 * jsdom 缺一些浏览器能力，先补齐最小桩。
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
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
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
  if (!window.cancelAnimationFrame) {
    window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as unknown as typeof window.cancelAnimationFrame;
  }

  const rangeProto = window.Range.prototype as unknown as Dictionary;
  if (!rangeProto.getBoundingClientRect) {
    rangeProto.getBoundingClientRect = () =>
      ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }) as DOMRect;
  }
  if (!rangeProto.getClientRects) {
    rangeProto.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] });
  }

  document.body.innerHTML = '<div id="app"></div>';
});

describe("app mount smoke", () => {
  it("mounts without uncaught error and renders UI", async () => {
    const events: unknown[] = [];
    const onerror = (e: unknown) => events.push(e);
    window.addEventListener("error", onerror as EventListener);

    let app;
    try {
      app = createApp(App);
      app.directive("autoPair", autoPairDirective);
      app.mount("#app");
    } catch (err) {
      throw new Error(`app.mount threw: ${String(err)}\n${(err as Error)?.stack ?? ""}`);
    }
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener("error", onerror as EventListener);

    const html = document.body.innerHTML;
    const hasUi = html.includes("app-shell") && html.length > 1000;
    expect(events, `uncaught render errors: ${JSON.stringify(events)}`).toHaveLength(0);
    expect(hasUi).toBe(true);
    try {
      app.unmount();
    } catch {
      /* ignore teardown errors */
    }
  });

  it("WYSIWYG editor renders content without error", async () => {
    const md =
      "# 标题\n\n正文段落 **加粗** 与 *斜体*。\n\n- 列表项一\n- 列表项二\n\n> 引用行\n\n```ts\nconst a = 1;\n```\n";
    let app;
    try {
      app = createApp(
        defineComponent({
          render: () => h(MarkdownWysiwyg, { modelValue: md }),
        }),
      );
      app.directive("autoPair", autoPairDirective);
      app.mount("#app");
    } catch (err) {
      throw new Error(`wysiwyg mount threw: ${String(err)}\n${(err as Error)?.stack ?? ""}`);
    }
    await nextTick();
    await new Promise((r) => setTimeout(r, 50));

    const editor = document.querySelector(".wysiwyg-editor");
    const blocks = document.querySelectorAll(".md-block");
    expect(editor, "WYSIWYG 编辑区已渲染").toBeTruthy();
    expect(blocks.length, "块级结构被解析出来").toBeGreaterThan(3);

    /* 关键回归检查：含空行的文档不会把偏移空间撑乱（见 md-empty 归零修复）。 */
    const content = (editor as HTMLElement).textContent ?? "";
    expect(content).toContain("标题");
    expect(content).toContain("正文段落");
    expect(content).toContain("列表项二");
    expect(content).toContain("引用行");

    try {
      app.unmount();
    } catch {
      /* ignore teardown errors */
    }
  });
});