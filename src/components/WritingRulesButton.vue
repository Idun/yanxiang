<script setup lang="ts">
import { ref } from "vue";
import { BookOpen } from "lucide-vue-next";
import WritingRulesModal from "./WritingRulesModal.vue";
import { DocumentItem } from "../types/writingRules";
import { documentFilesStore, createDocFile, selectDocFile2 } from "../documentFilesStore";

const props = withDefaults(
  defineProps<{
    documentContent?: string;
    documentTitle?: string;
    secondary?: boolean;
  }>(),
  {
    documentContent: "",
    documentTitle: "",
    secondary: false,
  },
);

const emit = defineEmits<{
  (e: "replaceContent", newContent: string): void;
  (e: "locateInText", keyword: string): void;
  (e: "selectDocument", docId: string): void;
}>();

const isModalOpen = ref(false);

/* 规范文档仓库不经此组件，弹窗直接读写；这里只负责把它按 id 同步进项目文档库，
   使用户仍可在编辑器中打开该规范文档。 */
function handleUpdateDocument(doc: DocumentItem) {
  const target = documentFilesStore.files.find((f) => f.id === doc.id);
  if (target) {
    target.content = doc.content;
    target.title = doc.title;
  }
}

function handleAddDocument(doc: DocumentItem) {
  const newFile = createDocFile(null, doc.title, doc.id);
  newFile.content = doc.content;
}

function handleSelectDocument(docId: string) {
  if (props.secondary) selectDocFile2(docId);
  else documentFilesStore.activeFileId = docId;
  emit("selectDocument", docId);
}
</script>

<template>
  <button
    type="button"
    class="wr-toolbar-btn"
    :class="{ on: isModalOpen }"
    title="写作规范与文字整理"
    @click="isModalOpen = true"
  >
    <BookOpen :size="15" :stroke-width="1.8" />
  </button>

  <WritingRulesModal
    :is-open="isModalOpen"
    :document-content="documentContent"
    :document-title="documentTitle"
    @close="isModalOpen = false"
    @locate-in-text="emit('locateInText', $event)"
    @batch-replace-content="emit('replaceContent', $event)"
    @update-document="handleUpdateDocument"
    @add-document="handleAddDocument"
    @select-document="handleSelectDocument"
  />
</template>

<style scoped>
/* 复刻 DocumentViewer 的 .format-btn：父级样式是 scoped，子组件模板里的按钮
   拿不到那条规则，所以在这里自带一份等价定义，保证与同行图标尺寸 / 垂直对齐一致。 */
.wr-toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 28px;
  flex-shrink: 0;
  padding: 0;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  transition: background 0.2s ease, color 0.2s ease;
}

.wr-toolbar-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.wr-toolbar-btn.on {
  background: rgb(var(--primary-rgb) / 0.14);
  color: var(--primary);
}
</style>
