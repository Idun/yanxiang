import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Tauri expects a fixed port for development and does not use HMR on the
// production build.
export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
  },
  test: {
    /* 只跑纯逻辑单测（文本合并、断句、解析、续写判定），不涉及组件挂载，
       因此无需 jsdom。 */
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
