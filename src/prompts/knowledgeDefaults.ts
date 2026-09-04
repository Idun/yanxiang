import type { KnowledgeFile } from "../settings";

/**
 * Bundled default knowledge materials shipped with the app.
 *
 * The `.md` files under `src/prompts/md/` are inlined at build time via
 * Vite's `?raw` imports, so they become part of the packaged bundle and are
 * available offline on every install.
 *
 * Auto-load behavior:
 *  - Chat tab    ➜ 身份模板.md
 *  - Writer tab  ➜ AI写作——反面例子.md、禁止模式.md、人类写作 vs AI写作.md、
 *    网络文学小白作者与网文读者受众画像及写作规范深度研究报告.md
 *  - Auditor tab ➜ AI写作——反面例子.md、自查评分表.md、禁止模式.md
 */

const mdSources = import.meta.glob("./md/*.md", {
  eager: true,
  query: "?raw",
  import: "default",
}) as Record<string, string>;

function bundled(name: string, id: string): KnowledgeFile {
  return {
    id,
    name,
    content: mdSources[`./md/${name}`] ?? "",
    path: `bundled://md/${name}`,
  };
}

/** 「对话」选项卡的身份模板知识项文件名。斜杠指令要用它来点名要读哪个文件。 */
export const IDENTITY_TEMPLATE_FILE = "身份模板.md";

export const BUNDLED_CHAT_KNOWLEDGE: KnowledgeFile[] = [
  bundled(IDENTITY_TEMPLATE_FILE, "builtin:chat:identity-template"),
];

export const BUNDLED_WRITER_KNOWLEDGE: KnowledgeFile[] = [
  bundled("AI写作——反面例子.md", "builtin:writer:ai-negative-examples"),
  bundled("禁止模式.md", "builtin:writer:forbidden-patterns"),
  bundled("人类写作 vs AI写作.md", "builtin:writer:human-vs-ai"),
  bundled(
    "网络文学小白作者与网文读者受众画像及写作规范深度研究报告.md",
    "builtin:writer:webnovel-audience",
  ),
];

export const BUNDLED_AUDITOR_KNOWLEDGE: KnowledgeFile[] = [
  bundled("AI写作——反面例子.md", "builtin:auditor:ai-negative-examples"),
  bundled("自查评分表.md", "builtin:auditor:self-check"),
  bundled("禁止模式.md", "builtin:auditor:forbidden-patterns"),
];