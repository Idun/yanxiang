import { reactive } from "vue";

/**
 * 「写作规范」专用文档仓库。
 *
 * 这里只收纳两类文档：
 *   1. 用户从本地电脑显式导入的 Markdown / TXT 规范文件；
 *   2. 用户在弹窗内点「新建专属规范文档」自建的文档。
 *
 * 刻意与 documentFilesStore 分离：规范面板不主动扫描项目文档目录，也不做
 * 标题匹配式的自动关联，避免「禁用句式」被无关的项目正文文档悄悄接管。
 */
export interface RulesDocItem {
  id: string;
  title: string;
  content: string;
  createdAt: number;
}

export const RULES_DOCS_STORAGE_KEY = "ai_writing_rules_docs";

function loadFromStorage(): RulesDocItem[] {
  try {
    const raw = localStorage.getItem(RULES_DOCS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as RulesDocItem[];
    }
  } catch (e) {
    console.error(e);
  }
  return [];
}

export const rulesDocsStore = reactive({
  docs: loadFromStorage() as RulesDocItem[],
});

function persist() {
  try {
    localStorage.setItem(RULES_DOCS_STORAGE_KEY, JSON.stringify(rulesDocsStore.docs));
  } catch (e) {
    console.error(e);
  }
}

/** 新增或按 id 覆盖一条规范文档。 */
export function upsertRulesDoc(doc: RulesDocItem): void {
  const idx = rulesDocsStore.docs.findIndex((d) => d.id === doc.id);
  if (idx >= 0) rulesDocsStore.docs[idx] = doc;
  else rulesDocsStore.docs.unshift(doc);
  persist();
}

export function findRulesDoc(id: string): RulesDocItem | undefined {
  return rulesDocsStore.docs.find((d) => d.id === id);
}

export function createRulesDoc(title: string, content = ""): RulesDocItem {
  const doc: RulesDocItem = {
    id: `rules-doc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title,
    content,
    createdAt: Date.now(),
  };
  upsertRulesDoc(doc);
  return doc;
}
