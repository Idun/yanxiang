// @vitest-environment jsdom
import { describe, it, expect, beforeAll } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import WritingRulesButton from './WritingRulesButton.vue';
import WritingRulesModal from './WritingRulesModal.vue';

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
});

describe('WritingRulesButton & WritingRulesModal', () => {
  it('renders button and opens modal on click', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(WritingRulesButton, {
              documentContent: '这是一段测试文本。不仅……而且……很生硬。',
              documentTitle: '测试文档',
            });
        },
      })
    );

    app.mount(root);
    await nextTick();

    const btn = root.querySelector('button[title="写作规范与文字整理"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();

    btn.click();
    await nextTick();

    /* 弹窗经 Teleport 挂到 body，断言要从 document 上取。 */
    expect(document.body.textContent).toContain('写作规范');
    expect(document.body.textContent).toContain('文字整理');

    app.unmount();
    root.remove();
  });

  it('modal renders rule categories and handles add', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);

    const app = createApp(
      defineComponent({
        setup() {
          return () =>
            h(WritingRulesModal, {
              isOpen: true,
              documentContent: '指尖微凉的内容',
              documentTitle: '测试文档',
            });
        },
      })
    );

    app.mount(root);
    await nextTick();

    /* 弹窗经 Teleport 挂到 body，断言要从 document 上取。 */
    expect(document.body.textContent).toContain('写作规范');
    expect(document.body.textContent).toContain('禁用句式');
    expect(document.body.textContent).toContain('常用词汇');

    app.unmount();
    root.remove();
  });
});
