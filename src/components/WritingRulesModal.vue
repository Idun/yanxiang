<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import {
  BookOpen,
  Upload,
  X,
  Check,
  FileText,
  ExternalLink,
  ChevronDown,
  Plus,
  Sparkles,
  Split,
  RotateCcw,
} from "lucide-vue-next";
import {
  DocumentItem,
  RuleCategory,
  WritingRuleItem,
  TextCleanupRuleItem,
  CleanupMode,
  TextCleanupResultLog,
  TextCleanupAppliedItem,
} from "../types/writingRules";
import {
  parseRulesFromMarkdown,
  serializeRulesToMarkdown,
  DEFAULT_RULES_DOC_TITLE,
} from "../utils/rulesDocSync";
import {
  rulesDocsStore,
  findRulesDoc,
  createRulesDoc,
  upsertRulesDoc,
} from "../utils/rulesDocsStore";
import { writingRulesStore, setWritingRules } from "../utils/writingRulesStore";
import {
  CLEANUP_MODE_OPTIONS,
  DEFAULT_CLEANUP_RULES,
  STORAGE_KEY,
  LINKED_DOC_ID_KEY,
  CLEANUP_STORAGE_KEY,
  applyRuleToText,
  getRuleHitCount,
  applyAllRulesToText,
} from "../utils/textCleanup";
import TextCleanupDiffModal from "./TextCleanupDiffModal.vue";
import RegexHelperDropdown from "./RegexHelperDropdown.vue";

const props = withDefaults(
  defineProps<{
    isOpen: boolean;
    documentContent?: string;
    documentTitle?: string;
  }>(),
  {
    isOpen: false,
    documentContent: "",
    documentTitle: "",
  },
);

const emit = defineEmits<{
  (e: "close"): void;
  (e: "locateInText", keyword: string): void;
  (e: "updateDocument", doc: DocumentItem): void;
  (e: "addDocument", doc: DocumentItem): void;
  (e: "selectDocument", docId: string): void;
  (e: "batchReplaceContent", newContent: string): void;
}>();

const CATEGORY_TABS: {
  id: RuleCategory;
  label: string;
  placeholder: string;
  descPlaceholder: string;
}[] = [
  { id: "technique", label: "写作手法", placeholder: "输入写作手法", descPlaceholder: "描述（可选）" },
  { id: "common_word", label: "常用词汇", placeholder: "输入常用词汇", descPlaceholder: "描述（可选）" },
  { id: "common_sentence", label: "常用句式", placeholder: "输入常用句式", descPlaceholder: "描述（可选）" },
  { id: "banned_word", label: "禁用词汇", placeholder: "输入禁用词汇", descPlaceholder: "描述（可选）" },
  { id: "banned_sentence", label: "禁用句式", placeholder: "输入禁用句式", descPlaceholder: "描述（可选）" },
];

const ADD_CLEANUP_BUTTONS: { mode: CleanupMode; label: string; title: string }[] = [
  { mode: "exact", label: "精确匹配", title: "添加精确匹配规则" },
  { mode: "fuzzy", label: "模糊匹配", title: "添加模糊匹配规则（忽略大小写）" },
  { mode: "wrap", label: "成对包裹", title: "添加成对前后符号包裹替换" },
  { mode: "sentence", label: "句式替换", title: "添加带有……或连词关联的句式替换" },
  { mode: "regex", label: "正则匹配", title: "添加正则表达式替换" },
];

/* 顶部一级 Tab：写作规范 / 文字整理 */
const topTab = ref<"rules" | "cleanup">("rules");

/* 写作规范二级分类 */
const activeCategory = ref<RuleCategory>("banned_sentence");
const fileInputRef = ref<HTMLInputElement | null>(null);

/* 当前关联的本地文档（只认显式关联，绝不扫描项目文档目录） */
const linkedDocId = ref<string>(localStorage.getItem(LINKED_DOC_ID_KEY) || "");

const currentLinkedDoc = computed<DocumentItem | null>(() => {
  if (!linkedDocId.value) return null;
  return findRulesDoc(linkedDocId.value) || null;
});

/* 可选关联的规范文档 = 用户导入的本地文档 + 用户自建的文档 */
const rulesDocuments = computed<DocumentItem[]>(() => rulesDocsStore.docs);

function loadInitialRules(): WritingRuleItem[] {
  if (currentLinkedDoc.value?.content) {
    return parseRulesFromMarkdown(currentLinkedDoc.value.content);
  }
  /* 与编辑区的波浪线提示共用同一份 store，保证两边永远一致。 */
  if (writingRulesStore.rules.length > 0) return writingRulesStore.rules;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) {
    console.error(e);
  }
  return [];
}
const rules = ref<WritingRuleItem[]>(loadInitialRules());

/** 唯一出口：改本地 ref 的同时写入 store + localStorage，编辑区即时响应。 */
function persistRules(newRules: WritingRuleItem[]) {
  rules.value = newRules;
  setWritingRules(newRules);
}

/* 首次若规则来自关联文档，顺手同步进 store，保证编辑区波浪线与弹窗同源。 */
if (rules.value.length > 0) setWritingRules(rules.value);

function loadInitialCleanupRules(): TextCleanupRuleItem[] {
  try {
    const saved = localStorage.getItem(CLEANUP_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    console.error(e);
  }
  return DEFAULT_CLEANUP_RULES;
}
const cleanupRules = ref<TextCleanupRuleItem[]>(loadInitialCleanupRules());

const lastCleanupLog = ref<TextCleanupResultLog | null>(null);
const isDiffModalOpen = ref(false);
const cleanupFeedback = ref<string | null>(null);

const inputName = ref("");
const inputDesc = ref("");

const editingId = ref<string | null>(null);
const editName = ref("");
const editDesc = ref("");

const importFeedback = ref<string | null>(null);
const showDocSelector = ref(false);

/* 关联文档内容变更时同步刷新规范列表。 */
watch(
  () => [currentLinkedDoc.value?.id, currentLinkedDoc.value?.content],
  () => {
    if (currentLinkedDoc.value?.content) {
      const parsed = parseRulesFromMarkdown(currentLinkedDoc.value.content);
      persistRules(parsed);
    }
  },
);

/* 弹窗关掉时收起内部浮层，避免下次打开残留旧状态。 */
watch(
  () => props.isOpen,
  (open) => {
    if (!open) {
      showDocSelector.value = false;
      editingId.value = null;
    }
  },
);

function handleKeyDown(e: KeyboardEvent) {
  if (e.key === "Escape" && props.isOpen && !isDiffModalOpen.value) {
    emit("close");
  }
}

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeyDown);
});

const totalCleanupHits = computed(() =>
  cleanupRules.value.reduce((acc, r) => acc + getRuleHitCount(props.documentContent, r), 0),
);

function saveCleanupRules(newRules: TextCleanupRuleItem[]) {
  cleanupRules.value = newRules;
  localStorage.setItem(CLEANUP_STORAGE_KEY, JSON.stringify(newRules));
}

function syncRulesToDoc(newRules: WritingRuleItem[]) {
  persistRules(newRules);

  const linked = currentLinkedDoc.value;
  if (linked) {
    const updatedMarkdown = serializeRulesToMarkdown(newRules);
    const updatedDoc: DocumentItem = {
      ...linked,
      content: updatedMarkdown,
      lastModified: Date.now(),
      wordCount: updatedMarkdown.length,
    };
    /* 规范仓库是关联文档的正本；顺带同步一份到项目文档库（若已存在同 id 条目），
       这样用户仍可在编辑器里打开它。 */
    upsertRulesDoc({
      id: linked.id,
      title: updatedDoc.title,
      content: updatedMarkdown,
      createdAt: Date.now(),
    });
    emit("updateDocument", updatedDoc);
  }
}

const currentTabInfo = computed(
  () => CATEGORY_TABS.find((t) => t.id === activeCategory.value) || CATEGORY_TABS[4],
);

const filteredRules = computed(() =>
  rules.value.filter((r) => r.category === activeCategory.value),
);

function handleAddRule(e?: Event) {
  if (e) e.preventDefault();
  if (!inputName.value.trim()) return;

  const newRule: WritingRuleItem = {
    id: `rule-${activeCategory.value}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    category: activeCategory.value,
    name: inputName.value.trim(),
    description: inputDesc.value.trim() || undefined,
    createdAt: Date.now(),
  };

  syncRulesToDoc([newRule, ...rules.value]);
  inputName.value = "";
  inputDesc.value = "";
}

function handleDeleteRule(id: string) {
  syncRulesToDoc(rules.value.filter((r) => r.id !== id));
  if (editingId.value === id) editingId.value = null;
}

function handleStartEdit(rule: WritingRuleItem) {
  editingId.value = rule.id;
  editName.value = rule.name;
  editDesc.value = rule.description || "";
}

function handleSaveEdit(id: string) {
  if (!editName.value.trim()) return;
  syncRulesToDoc(
    rules.value.map((r) =>
      r.id === id
        ? { ...r, name: editName.value.trim(), description: editDesc.value.trim() || undefined }
        : r,
    ),
  );
  editingId.value = null;
}

function handleTriggerImport() {
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
    fileInputRef.value.click();
  }
}

function handleFileChange(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (event) => {
    const content = (event.target?.result as string) || "";
    if (!content.trim()) return;

    const parsed = parseRulesFromMarkdown(content);
    /* 导入的本地文档进入「规范文档仓库」，而不是扫描项目文档目录。 */
    const newDoc = createRulesDoc(file.name || DEFAULT_RULES_DOC_TITLE, content);
    emit("addDocument", newDoc);
    linkedDocId.value = newDoc.id;
    localStorage.setItem(LINKED_DOC_ID_KEY, newDoc.id);

    persistRules(parsed);
    importFeedback.value = `已导入 ${parsed.length} 条规范`;
    setTimeout(() => {
      importFeedback.value = null;
    }, 3000);
  };
  reader.readAsText(file);
}

function handleSelectLinkedDoc(docId: string) {
  linkedDocId.value = docId;
  localStorage.setItem(LINKED_DOC_ID_KEY, docId);
  showDocSelector.value = false;

  const doc = findRulesDoc(docId);
  if (doc) {
    persistRules(parseRulesFromMarkdown(doc.content));
  }
}

function handleCreateNewRulesDoc() {
  const newDoc = createRulesDoc(DEFAULT_RULES_DOC_TITLE, serializeRulesToMarkdown(rules.value));
  emit("addDocument", newDoc);
  linkedDocId.value = newDoc.id;
  localStorage.setItem(LINKED_DOC_ID_KEY, newDoc.id);
  showDocSelector.value = false;
}

function handleOpenLinkedDoc() {
  const doc = currentLinkedDoc.value;
  if (!doc) return;
  emit("selectDocument", doc.id);
  emit("close");
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getMatchCount(keyword: string): number {
  if (!keyword || !props.documentContent) return 0;
  const cleaned = keyword.replace(/[….、\s]+/g, " ").trim();
  if (!cleaned) return 0;

  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 1) {
    return (props.documentContent.match(new RegExp(escapeRegex(parts[0]), "gi")) || []).length;
  }
  try {
    const pattern = parts.map(escapeRegex).join("[\\s\\S]{1,40}?");
    return (props.documentContent.match(new RegExp(pattern, "gi")) || []).length;
  } catch {
    return 0;
  }
}

function isBannedCategory(category: RuleCategory) {
  return category === "banned_word" || category === "banned_sentence";
}

function handleLocate(keyword: string) {
  emit("locateInText", keyword);
  emit("close");
}

/* ---------------- 文字整理 ---------------- */

function handleAddCleanupRow(mode: CleanupMode = "exact") {
  saveCleanupRules([
    ...cleanupRules.value,
    {
      id: `clean-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      mode,
      source: "",
      target: "",
      sourceEnd: mode === "wrap" ? "" : undefined,
      targetEnd: mode === "wrap" ? "" : undefined,
      enabled: true,
      createdAt: Date.now(),
    },
  ]);
}

function handleUpdateRuleMode(id: string, newMode: CleanupMode) {
  saveCleanupRules(
    cleanupRules.value.map((row) =>
      row.id === id
        ? {
            ...row,
            mode: newMode,
            sourceEnd: newMode === "wrap" ? (row.sourceEnd ?? "") : undefined,
            targetEnd: newMode === "wrap" ? (row.targetEnd ?? "") : undefined,
          }
        : row,
    ),
  );
}

function handleUpdateCleanupField(
  id: string,
  field: "source" | "target" | "sourceEnd" | "targetEnd",
  value: string,
) {
  saveCleanupRules(
    cleanupRules.value.map((row) => (row.id === id ? { ...row, [field]: value } : row)),
  );
}

function handleDeleteCleanupRow(id: string) {
  saveCleanupRules(cleanupRules.value.filter((row) => row.id !== id));
}

function handleApplySingleCleanup(rule: TextCleanupRuleItem) {
  if (!rule.source) return;
  const originalText = props.documentContent;
  const { newText, count } = applyRuleToText(originalText, rule);

  if (count > 0) {
    emit("batchReplaceContent", newText);
    const appliedItem: TextCleanupAppliedItem = {
      ruleId: rule.id,
      mode: rule.mode || "exact",
      source: rule.source,
      target: rule.target,
      sourceEnd: rule.sourceEnd,
      targetEnd: rule.targetEnd,
      count,
    };
    lastCleanupLog.value = {
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      originalText,
      resultText: newText,
      totalCount: count,
      appliedRules: [appliedItem],
    };
    cleanupFeedback.value = `已完成替换（共 ${count} 处）`;
  } else {
    cleanupFeedback.value = `正文中未找到「${rule.source}」`;
  }
}

function handleApplyAllCleanup() {
  if (!props.documentContent || cleanupRules.value.length === 0) return;
  const originalText = props.documentContent;
  const { newText, totalCount, appliedRules } = applyAllRulesToText(
    originalText,
    cleanupRules.value,
  );

  if (totalCount > 0) {
    emit("batchReplaceContent", newText);
    lastCleanupLog.value = {
      id: `log-${Date.now()}`,
      timestamp: Date.now(),
      originalText,
      resultText: newText,
      totalCount,
      appliedRules,
    };
    cleanupFeedback.value = `成功批量替换 ${totalCount} 处词汇 / 符号 / 句式`;
  } else {
    cleanupFeedback.value = "正文中未匹配到任何需要替换的项";
  }
}

function handleUndoCleanup(originalText: string) {
  emit("batchReplaceContent", originalText);
  lastCleanupLog.value = null;
  cleanupFeedback.value = "已撤销本次整理，正文恢复原貌";
  setTimeout(() => {
    cleanupFeedback.value = null;
  }, 3000);
}

function sourcePlaceholder(mode?: CleanupMode) {
  if (mode === "sentence") return "不想要的句式（例：不仅……而且……）";
  if (mode === "regex") return "正则表达式（例：\\s{2,}）";
  if (mode === "fuzzy") return "模糊匹配词汇（例：指腹）";
  return "精确词汇 / 符号（例：指尖微凉）";
}

function targetPlaceholder(mode?: CleanupMode) {
  if (mode === "sentence") return "替换后的句式（例：既……又……）";
  if (mode === "regex") return "替换目标（支持 $1 捕获组）";
  if (mode === "fuzzy") return "替换后的词汇 / 符号（例：指尖）";
  return "替换后的词汇 / 符号（例：手指头有些发凉）";
}

function modeDesc(mode?: CleanupMode) {
  return CLEANUP_MODE_OPTIONS.find((o) => o.value === mode)?.desc || "";
}

const currentDocTitle = computed(
  () => currentLinkedDoc.value?.title || DEFAULT_RULES_DOC_TITLE,
);
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen" class="wr-overlay" @mousedown.self="emit('close')">
      <input
        ref="fileInputRef"
        type="file"
        accept=".md,.markdown,.txt"
        class="wr-file-input"
        @change="handleFileChange"
      />

      <div class="wr-shell" @mousedown.stop>
        <!-- 一级 Tab -->
        <header class="wr-tabbar">
          <div class="wr-tabs">
            <button
              type="button"
              class="wr-tab"
              :class="{ on: topTab === 'rules' }"
              @click="topTab = 'rules'"
            >
              写作规范
            </button>
            <button
              type="button"
              class="wr-tab"
              :class="{ on: topTab === 'cleanup' }"
              @click="topTab = 'cleanup'"
            >
              <span>文字整理</span>
              <span v-if="totalCleanupHits > 0" class="wr-tab-badge">{{ totalCleanupHits }}</span>
            </button>
          </div>

          <button type="button" class="wr-icon-btn danger" title="关闭弹窗" @click="emit('close')">
            <X :size="15" :stroke-width="1.9" />
          </button>
        </header>

        <!-- Tab 1：写作规范 -->
        <template v-if="topTab === 'rules'">
          <div class="wr-docbar">
            <div class="wr-docbar-left">
              <span class="wr-doc-icon">
                <BookOpen :size="15" :stroke-width="1.9" />
              </span>

              <div class="wr-doc-picker">
                <button
                  type="button"
                  class="wr-doc-trigger"
                  title="点击切换或关联其他本地文档"
                  @click="showDocSelector = !showDocSelector"
                >
                  <span class="wr-doc-title">{{ currentDocTitle }}</span>
                  <span class="wr-doc-chip">本地文档</span>
                  <ChevronDown :size="13" :stroke-width="2" />
                </button>

                <div v-if="showDocSelector" class="wr-doc-menu">
                  <p class="wr-doc-menu-head">选择或关联本地规范文档</p>
                  <div class="wr-doc-menu-list">
                    <button
                      v-for="d in rulesDocuments"
                      :key="d.id"
                      type="button"
                      class="wr-doc-menu-item"
                      :class="{ on: d.id === currentLinkedDoc?.id }"
                      @click="handleSelectLinkedDoc(d.id)"
                    >
                      <span class="wr-doc-menu-name">{{ d.title || "无标题文档" }}</span>
                      <Check
                        v-if="d.id === currentLinkedDoc?.id"
                        :size="13"
                        :stroke-width="2.2"
                      />
                    </button>
                    <p v-if="rulesDocuments.length === 0" class="wr-doc-menu-empty">
                      暂无已导入 / 自建的规范文档
                    </p>
                  </div>
                  <div class="wr-doc-menu-foot">
                    <button
                      type="button"
                      class="wr-doc-menu-item accent"
                      @click="showDocSelector = false; handleTriggerImport()"
                    >
                      <Upload :size="13" :stroke-width="1.9" />
                      <span>从本地电脑导入文件</span>
                    </button>
                    <button
                      type="button"
                      class="wr-doc-menu-item"
                      @click="handleCreateNewRulesDoc"
                    >
                      <FileText :size="13" :stroke-width="1.9" />
                      <span>新建专属规范文档</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div class="wr-docbar-right">
              <button
                type="button"
                class="wr-ghost-btn"
                title="从本地计算机导入 Markdown / TXT 规范文档"
                @click="handleTriggerImport"
              >
                <Upload :size="13" :stroke-width="1.9" />
                <span>{{ importFeedback || "导入本地文档" }}</span>
              </button>

              <button
                v-if="currentLinkedDoc"
                type="button"
                class="wr-icon-btn"
                title="在编辑器中打开此本地文档"
                @click="handleOpenLinkedDoc"
              >
                <ExternalLink :size="14" :stroke-width="1.9" />
              </button>
            </div>
          </div>

          <!-- 二级分类 -->
          <div class="wr-subtabs">
            <button
              v-for="tab in CATEGORY_TABS"
              :key="tab.id"
              type="button"
              class="wr-subtab"
              :class="{ on: activeCategory === tab.id }"
              @click="activeCategory = tab.id; editingId = null"
            >
              {{ tab.label }}
            </button>
          </div>

          <div class="wr-body">
            <div class="wr-card">
              <form class="wr-add-form" @submit="handleAddRule">
                <div class="wr-add-row">
                  <input v-model="inputName" type="text" class="wr-input" :placeholder="currentTabInfo.placeholder" />
                  <input v-model="inputDesc" type="text" class="wr-input" :placeholder="currentTabInfo.descPlaceholder" />
                </div>
                <div class="wr-add-foot">
                  <button type="submit" class="wr-primary-btn" :disabled="!inputName.trim()">
                    添加
                  </button>
                </div>
              </form>

              <div class="wr-rule-list">
                <p v-if="filteredRules.length === 0" class="wr-empty">
                  暂无{{ currentTabInfo.label }}，可在上方输入框添加
                </p>

                <template v-for="rule in filteredRules" :key="rule.id">
                  <!-- 编辑态 -->
                  <div v-if="editingId === rule.id" class="wr-rule-edit">
                    <input v-model="editName" type="text" class="wr-input" placeholder="规则名称 / 句式" />
                    <input v-model="editDesc" type="text" class="wr-input" placeholder="描述（可选）" />
                    <div class="wr-rule-edit-foot">
                      <button type="button" class="wr-text-btn" @click="editingId = null">取消</button>
                      <button type="button" class="wr-primary-btn" @click="handleSaveEdit(rule.id)">
                        保存
                      </button>
                    </div>
                  </div>

                  <!-- 展示态 -->
                  <div v-else class="wr-rule-row">
                    <div class="wr-rule-main">
                      <div class="wr-rule-name-line">
                        <span class="wr-rule-name">{{ rule.name }}</span>
                        <button
                          v-if="getMatchCount(rule.name) > 0"
                          type="button"
                          class="wr-hit-chip"
                          :class="isBannedCategory(rule.category) ? 'banned' : 'common'"
                          title="点击在正文中定位此项"
                          @click="handleLocate(rule.name)"
                        >
                          {{ isBannedCategory(rule.category) ? "正文出现" : "正文命中" }}
                          {{ getMatchCount(rule.name) }} 次
                        </button>
                      </div>
                      <p v-if="rule.description" class="wr-rule-desc">{{ rule.description }}</p>
                    </div>

                    <div class="wr-rule-actions">
                      <button type="button" class="wr-mini-btn" @click="handleStartEdit(rule)">编辑</button>
                      <button type="button" class="wr-mini-btn danger" @click="handleDeleteRule(rule.id)">
                        删除
                      </button>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>

        <!-- Tab 2：文字整理 -->
        <div v-else class="wr-body">
          <div class="wr-cleanup-top">
            <div class="wr-cleanup-add">
              <span class="wr-cleanup-add-label">新增规则</span>
              <button
                v-for="item in ADD_CLEANUP_BUTTONS"
                :key="item.mode"
                type="button"
                class="wr-chip-btn"
                :title="item.title"
                @click="handleAddCleanupRow(item.mode)"
              >
                <Plus :size="13" :stroke-width="2" />
                <span>{{ item.label }}</span>
              </button>
              <RegexHelperDropdown
                @select-preset="
                  (preset) =>
                    saveCleanupRules([
                      {
                        id: `clean-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                        mode: 'regex',
                        source: preset.source,
                        target: preset.target,
                        enabled: true,
                        createdAt: Date.now(),
                      },
                      ...cleanupRules,
                    ])
                "
              />
            </div>

            <button
              type="button"
              class="wr-primary-btn wide"
              :disabled="!documentContent || cleanupRules.length === 0"
              title="按照每项设定的独立模式，一键批量替换当前文档"
              @click="handleApplyAllCleanup"
            >
              <Sparkles :size="13" :stroke-width="1.9" />
              <span>一键替换当前文档</span>
              <span v-if="totalCleanupHits > 0" class="wr-primary-badge">{{ totalCleanupHits }} 处</span>
            </button>
          </div>

          <!-- 结果反馈条 -->
          <div v-if="lastCleanupLog" class="wr-feedback">
            <div class="wr-feedback-main">
              <span class="wr-feedback-dot" />
              <span class="wr-feedback-text">
                {{ cleanupFeedback || `已完成整理替换：共修改 ${lastCleanupLog.totalCount} 处内容` }}
              </span>
              <span class="wr-feedback-chip">{{ lastCleanupLog.appliedRules.length }} 条规则生效</span>
            </div>

            <div class="wr-feedback-actions">
              <button
                type="button"
                class="wr-mini-btn"
                title="打开对比视图查看修改前后差异"
                @click="isDiffModalOpen = true"
              >
                <Split :size="13" :stroke-width="1.9" />
                <span>查看替换对比</span>
              </button>
              <button
                type="button"
                class="wr-mini-btn danger"
                title="撤销本次文字整理，恢复整理前的正文"
                @click="handleUndoCleanup(lastCleanupLog.originalText)"
              >
                <RotateCcw :size="13" :stroke-width="1.9" />
                <span>撤销本次整理</span>
              </button>
              <button type="button" class="wr-icon-btn" title="隐藏提示" @click="lastCleanupLog = null">
                <X :size="13" :stroke-width="1.9" />
              </button>
            </div>
          </div>

          <!-- 规则卡片列表 -->
          <div class="wr-card">
            <p v-if="cleanupRules.length === 0" class="wr-empty">
              暂无替换规则，点击上方「新增规则」添加
            </p>

            <div v-for="row in cleanupRules" v-else :key="row.id" class="wr-clean-card">
              <div class="wr-clean-head">
                <div class="wr-clean-mode">
                  <span class="wr-clean-mode-label">匹配模式</span>
                  <span class="wr-select-wrap">
                    <select
                      class="wr-select"
                      :value="row.mode || 'exact'"
                      title="为此条目单独配置专属匹配模式"
                      @change="
                        handleUpdateRuleMode(
                          row.id,
                          ($event.target as HTMLSelectElement).value as CleanupMode,
                        )
                      "
                    >
                      <option v-for="opt in CLEANUP_MODE_OPTIONS" :key="opt.value" :value="opt.value">
                        {{ opt.label }}
                      </option>
                    </select>
                    <ChevronDown :size="11" :stroke-width="2.2" class="wr-select-caret" />
                  </span>
                  <span class="wr-clean-mode-desc">{{ modeDesc(row.mode) }}</span>
                </div>

                <div class="wr-clean-hit">
                  <button
                    v-if="getRuleHitCount(documentContent, row) > 0"
                    type="button"
                    class="wr-mini-btn ok"
                    title="仅按当前规则替换正文"
                    @click="handleApplySingleCleanup(row)"
                  >
                    替换本条（{{ getRuleHitCount(documentContent, row) }}）
                  </button>
                  <span v-else-if="row.source" class="wr-clean-miss">未命中</span>
                </div>
              </div>

              <!-- 成对包裹 -->
              <div v-if="row.mode === 'wrap'" class="wr-clean-form wrap">
                <div class="wr-clean-line">
                  <input
                    type="text"
                    class="wr-input mono"
                    :value="row.source"
                    placeholder="起始原符号（例：[ ）"
                    @input="handleUpdateCleanupField(row.id, 'source', ($event.target as HTMLInputElement).value)"
                  />
                  <span class="wr-arrow">→</span>
                  <input
                    type="text"
                    class="wr-input"
                    :value="row.target"
                    placeholder="起始目标符号（例：【 ）"
                    @input="handleUpdateCleanupField(row.id, 'target', ($event.target as HTMLInputElement).value)"
                  />
                  <span class="wr-clean-line-tail" />
                </div>
                <div class="wr-clean-line">
                  <input
                    type="text"
                    class="wr-input mono"
                    :value="row.sourceEnd ?? ''"
                    placeholder="结束原符号（例：] ）"
                    @input="handleUpdateCleanupField(row.id, 'sourceEnd', ($event.target as HTMLInputElement).value)"
                  />
                  <span class="wr-arrow">→</span>
                  <input
                    type="text"
                    class="wr-input"
                    :value="row.targetEnd ?? ''"
                    placeholder="结束目标符号（例：】 ）"
                    @input="handleUpdateCleanupField(row.id, 'targetEnd', ($event.target as HTMLInputElement).value)"
                  />
                  <button
                    type="button"
                    class="wr-del-btn"
                    title="删除此条包裹替换规则"
                    @click="handleDeleteCleanupRow(row.id)"
                  >
                    删除
                  </button>
                </div>
              </div>

              <!-- 精确 / 模糊 / 句式 / 正则 -->
              <div v-else class="wr-clean-form">
                <div class="wr-clean-line">
                  <span class="wr-clean-source">
                    <input
                      type="text"
                      class="wr-input mono"
                      :value="row.source"
                      :placeholder="sourcePlaceholder(row.mode)"
                      @input="handleUpdateCleanupField(row.id, 'source', ($event.target as HTMLInputElement).value)"
                    />
                    <RegexHelperDropdown
                      v-if="row.mode === 'regex'"
                      @select-preset="
                        (preset) => {
                          handleUpdateCleanupField(row.id, 'source', preset.source);
                          handleUpdateCleanupField(row.id, 'target', preset.target);
                        }
                      "
                    />
                  </span>
                  <span class="wr-arrow">→</span>
                  <input
                    type="text"
                    class="wr-input"
                    :value="row.target"
                    :placeholder="targetPlaceholder(row.mode)"
                    @input="handleUpdateCleanupField(row.id, 'target', ($event.target as HTMLInputElement).value)"
                  />
                  <button
                    type="button"
                    class="wr-del-btn"
                    title="删除此条替换规则"
                    @click="handleDeleteCleanupRow(row.id)"
                  >
                    删除
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>

  <TextCleanupDiffModal
    :is-open="isDiffModalOpen"
    :result-log="lastCleanupLog"
    @close="isDiffModalOpen = false"
    @undo="handleUndoCleanup"
  />
</template>

<style scoped>
.wr-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
}

.wr-file-input {
  display: none;
}

/* 固定宽高比（4 : 3）：宽度与高度同时钳制，面板不随内容增减变形，
   内容溢出交给内部 .wr-body 自己滚动。 */
.wr-shell {
  display: flex;
  flex-direction: column;
  width: min(860px, 92vw);
  height: min(645px, 88vh);
  overflow: hidden;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 14px;
  animation: wrPop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes wrPop {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

/* ---- 一级 Tab ---- */
.wr-tabbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 0 14px;
  background: var(--surface-container);
  border-bottom: 1px solid var(--outline-variant);
}

.wr-tabs {
  display: flex;
  align-items: center;
  gap: 18px;
}

.wr-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 11px 2px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: color 0.16s ease, border-color 0.16s ease;
}

.wr-tab:hover {
  color: var(--on-surface);
}

.wr-tab.on {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.wr-tab-badge {
  min-width: 17px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--error);
  color: #fff;
  font-family: var(--code-font);
  font-size: 10px;
  line-height: 16px;
  text-align: center;
}

.wr-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.wr-icon-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.wr-icon-btn.danger:hover {
  background: var(--error-container);
  color: var(--error);
}

/* ---- 关联文档条 ---- */
.wr-docbar {
  position: relative;
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 10px;
  padding: 9px 14px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
}

.wr-docbar-left,
.wr-docbar-right {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.wr-doc-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.wr-doc-picker {
  position: relative;
  min-width: 0;
}

.wr-doc-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 4px 7px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.wr-doc-trigger:hover {
  background: var(--surface-container);
}

.wr-doc-title {
  overflow: hidden;
  max-width: 220px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wr-doc-chip {
  flex-shrink: 0;
  padding: 1px 6px;
  border: 1px solid rgb(var(--primary-rgb) / 0.35);
  border-radius: 4px;
  background: rgb(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 10px;
  font-weight: 500;
}

.wr-doc-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 20;
  width: 264px;
  padding: 5px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 9px;
  box-shadow: 0 14px 32px -10px rgba(15, 23, 42, 0.28);
}

.wr-doc-menu-head {
  margin: 0;
  padding: 4px 7px 6px;
  border-bottom: 1px solid var(--outline-variant);
  color: var(--outline);
  font-size: 11px;
  font-weight: 600;
}

.wr-doc-menu-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 188px;
  overflow-y: auto;
  padding: 4px 0;
}

.wr-doc-menu-foot {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding-top: 4px;
  border-top: 1px solid var(--outline-variant);
}

.wr-doc-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 7px;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface);
  font-family: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.wr-doc-menu-item:hover {
  background: var(--surface-container);
}

.wr-doc-menu-item.on {
  background: rgb(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.wr-doc-menu-item.accent {
  justify-content: flex-start;
  color: var(--primary);
  font-weight: 600;
}

.wr-doc-menu-foot .wr-doc-menu-item {
  justify-content: flex-start;
}

.wr-doc-menu-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wr-doc-menu-empty {
  margin: 0;
  padding: 12px 8px;
  color: var(--outline);
  font-size: 12px;
  text-align: center;
}

.wr-ghost-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 27px;
  padding: 0 9px;
  border: 1px solid rgb(var(--primary-rgb) / 0.32);
  border-radius: 7px;
  background: rgb(var(--primary-rgb) / 0.08);
  color: var(--primary);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s ease;
}

.wr-ghost-btn:hover {
  background: rgb(var(--primary-rgb) / 0.16);
}

/* ---- 二级分类 Tab ---- */
.wr-subtabs {
  display: flex;
  align-items: flex-end;
  flex-shrink: 0;
  gap: 4px;
  padding: 9px 14px 0;
  overflow-x: auto;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
  scrollbar-width: none;
}

.wr-subtabs::-webkit-scrollbar {
  display: none;
}

.wr-subtab {
  flex-shrink: 0;
  padding: 6px 13px;
  border: none;
  border-radius: 6px 6px 0 0;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s ease, color 0.16s ease;
}

.wr-subtab:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.wr-subtab.on {
  background: var(--primary);
  color: #fff;
}

/* ---- 内容区 ---- */
.wr-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  gap: 11px;
  min-height: 0;
  overflow-y: auto;
  padding: 14px;
  background: var(--surface-bright);
}

.wr-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 13px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 11px;
}

.wr-add-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.wr-add-row {
  display: flex;
  gap: 9px;
}

.wr-add-row .wr-input {
  flex: 1 1 0;
  min-width: 0;
}

.wr-add-foot {
  display: flex;
  justify-content: flex-end;
}

.wr-input {
  height: 30px;
  padding: 0 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 7px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 12px;
}

.wr-input.mono {
  font-family: var(--code-font);
}

.wr-input::placeholder {
  color: var(--outline);
}

.wr-input:focus {
  outline: none;
  border-color: var(--primary);
}

.wr-primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 29px;
  padding: 0 15px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--primary);
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.16s ease, opacity 0.16s ease;
}

.wr-primary-btn:hover:not(:disabled) {
  background: var(--primary-container);
}

.wr-primary-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.wr-primary-btn.wide {
  height: 30px;
  padding: 0 14px;
}

.wr-primary-badge {
  padding: 0 5px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.24);
  font-size: 10px;
}

.wr-text-btn {
  height: 26px;
  padding: 0 10px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
}

.wr-text-btn:hover {
  background: var(--surface-container-high);
}

.wr-empty {
  margin: 0;
  padding: 28px 0;
  border: 1px dashed var(--outline-variant);
  border-radius: 9px;
  background: var(--surface-bright);
  color: var(--outline);
  font-size: 12px;
  text-align: center;
}

/* ---- 规范条目 ---- */
.wr-rule-list {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.wr-rule-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 11px;
  padding: 8px 11px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 9px;
  transition: background 0.14s ease;
}

.wr-rule-row:hover {
  background: var(--surface-container-low);
}

.wr-rule-main {
  min-width: 0;
  flex: 1 1 auto;
}

.wr-rule-name-line {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wr-rule-name {
  overflow: hidden;
  color: var(--on-surface);
  font-size: 12.5px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wr-hit-chip {
  flex-shrink: 0;
  padding: 1px 7px;
  border: none;
  border-radius: 999px;
  font-family: var(--code-font);
  font-size: 10px;
  cursor: pointer;
  transition: background 0.14s ease;
}

.wr-hit-chip.banned {
  background: #fde8e8;
  color: #b42318;
}

.wr-hit-chip.banned:hover {
  background: #fbd5d5;
}

.wr-hit-chip.common {
  background: #d8f5e8;
  color: #0f7a5a;
}

.wr-hit-chip.common:hover {
  background: #bcecd8;
}

.wr-rule-desc {
  margin: 3px 0 0;
  overflow: hidden;
  color: var(--on-surface-variant);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wr-rule-actions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.wr-mini-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 9px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.wr-mini-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.wr-mini-btn.danger:hover {
  border-color: #e88b8b;
  background: var(--error-container);
  color: #b42318;
}

.wr-mini-btn.ok {
  border-color: #a7d8c4;
  background: #ecfbf4;
  color: #0f7a5a;
}

.wr-mini-btn.ok:hover {
  background: #d8f5e8;
  border-color: #6fc7a5;
  color: #0f7a5a;
}

.wr-rule-edit {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  background: rgb(var(--primary-rgb) / 0.05);
  border: 1px solid rgb(var(--primary-rgb) / 0.35);
  border-radius: 9px;
}

.wr-rule-edit .wr-input {
  width: 100%;
}

.wr-rule-edit-foot {
  display: flex;
  justify-content: flex-end;
  gap: 7px;
}

/* ---- 文字整理顶栏 ---- */
.wr-cleanup-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 11px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 11px;
}

.wr-cleanup-add {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 5px;
}

.wr-cleanup-add-label {
  margin-right: 2px;
  color: var(--on-surface-variant);
  font-size: 12px;
  font-weight: 600;
}

.wr-chip-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-bright);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.wr-chip-btn:hover {
  border-color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.08);
  color: var(--primary);
}

/* ---- 反馈条 ---- */
.wr-feedback {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
  padding: 10px 11px;
  background: rgb(var(--primary-rgb) / 0.08);
  border: 1px solid rgb(var(--primary-rgb) / 0.3);
  border-radius: 11px;
}

.wr-feedback-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.wr-feedback-dot {
  width: 7px;
  height: 7px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #12b76a;
}

.wr-feedback-text {
  color: var(--on-surface);
  font-size: 12px;
  font-weight: 600;
}

.wr-feedback-chip {
  flex-shrink: 0;
  padding: 1px 8px;
  border: 1px solid rgb(var(--primary-rgb) / 0.3);
  border-radius: 999px;
  background: var(--surface-bright);
  color: var(--primary);
  font-family: var(--code-font);
  font-size: 10.5px;
}

.wr-feedback-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ---- 整理规则卡片 ---- */
.wr-clean-card {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 11px;
}

.wr-clean-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 9px;
}

.wr-clean-mode {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}

.wr-clean-mode-label {
  flex-shrink: 0;
  color: var(--outline);
  font-size: 11px;
  font-weight: 500;
}

.wr-select-wrap {
  position: relative;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.wr-select {
  height: 25px;
  padding: 0 21px 0 9px;
  border: none;
  border-radius: 6px;
  background: var(--surface-container);
  color: var(--on-surface);
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  appearance: none;
}

.wr-select:hover {
  background: var(--surface-container-high);
}

.wr-select:focus {
  outline: 1px solid var(--primary);
}

.wr-select-caret {
  position: absolute;
  right: 6px;
  color: var(--outline);
  pointer-events: none;
}

.wr-clean-mode-desc {
  overflow: hidden;
  color: var(--outline);
  font-size: 10.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wr-clean-hit {
  flex-shrink: 0;
}

.wr-clean-miss {
  color: var(--outline);
  font-size: 10.5px;
}

.wr-clean-form {
  display: flex;
  flex-direction: column;
  gap: 7px;
}

.wr-clean-line {
  display: flex;
  align-items: center;
  gap: 8px;
}

.wr-clean-line > .wr-input {
  flex: 1 1 0;
  min-width: 0;
}

.wr-clean-source {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1 1 0;
  min-width: 0;
}

.wr-clean-source .wr-input {
  flex: 1 1 0;
  min-width: 0;
}

.wr-arrow {
  flex-shrink: 0;
  color: var(--outline);
  font-size: 12px;
  font-weight: 700;
}

.wr-clean-line-tail {
  width: 52px;
  flex-shrink: 0;
}

.wr-del-btn {
  height: 29px;
  padding: 0 13px;
  flex-shrink: 0;
  border: 1px solid transparent;
  border-radius: 7px;
  background: #ba4353;
  color: #fff;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease;
}

.wr-del-btn:hover {
  background: #a63847;
}

@media (max-width: 640px) {
  .wr-add-row,
  .wr-clean-line {
    flex-wrap: wrap;
  }

  .wr-clean-line-tail {
    display: none;
  }
}
</style>
