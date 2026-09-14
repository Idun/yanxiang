<script setup lang="ts">
import { computed } from "vue";
import {
  ClipboardPaste,
  FilePlus,
  FileText,
  Sparkles,
  Trash2,
  Type,
} from "lucide-vue-next";
import type { AiTurn } from "../autoStore";

interface Props {
  turn?: AiTurn | null;
  charCount?: number;
  isGenerating?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  turn: null,
  charCount: 0,
  isGenerating: false,
});

const emit = defineEmits<{
  (e: "createBlank"): void;
  (e: "pasteToBlank", turnId: number): void;
  (e: "clearBlank", turnId: number): void;
}>();

const actualCharCount = computed(() => {
  if (props.turn) {
    return (props.turn.content || "").length;
  }
  return props.charCount;
});
</script>

<template>
  <div v-if="props.turn && props.turn.isBlankDoc" class="blank-doc-banner">
    <div class="blank-doc-info">
      <div class="blank-doc-badge">
        <FileText :size="12" :stroke-width="2" class="badge-icon" />
        <span>空白独立文稿</span>
      </div>
      <span class="blank-doc-tip">
        自主输入或直接粘贴，无需等待 AI，修改实时保存并归入文稿列表
      </span>
    </div>

    <div class="blank-doc-actions">
      <div class="blank-doc-chars" title="当前文稿总字符数（含标点与空格）">
        <Type :size="11" :stroke-width="2" />
        <span>{{ actualCharCount.toLocaleString() }} 字符</span>
      </div>

      <button
        class="blank-action-btn"
        type="button"
        title="从剪贴板粘贴文本到当前文稿"
        @click="emit('pasteToBlank', props.turn.id)"
      >
        <ClipboardPaste :size="12" :stroke-width="1.8" />
        <span>粘贴文本</span>
      </button>

      <button
        v-if="props.turn.content"
        class="blank-action-btn danger"
        type="button"
        title="清空当前空白文稿内容"
        @click="emit('clearBlank', props.turn.id)"
      >
        <Trash2 :size="12" :stroke-width="1.8" />
        <span>清空</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.blank-doc-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 14px;
  margin-bottom: 12px;
  background: var(--surface-container-low, #f8f9fa);
  border: 1px solid var(--outline-variant, #e2e8f0);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.blank-doc-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.blank-doc-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  background: rgba(16, 185, 129, 0.12);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.25);
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
}

.badge-icon {
  color: #059669;
}

.blank-doc-tip {
  font-size: 0.78rem;
  color: var(--on-surface-variant, #64748b);
}

.blank-doc-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.blank-doc-chars {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--surface-container, #f1f5f9);
  border: 1px solid var(--outline-variant, #e2e8f0);
  border-radius: 9999px;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--on-surface, #334155);
}

.blank-action-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant, #cbd5e1);
  border-radius: 6px;
  font-size: 0.75rem;
  color: var(--on-surface, #334155);
  cursor: pointer;
  transition: all 0.15s ease;
}

.blank-action-btn:hover {
  background: var(--surface-container-high, #e2e8f0);
  color: var(--primary, #0284c7);
  border-color: var(--primary, #0284c7);
}

.blank-action-btn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #ef4444;
  border-color: #ef4444;
}

@media (max-width: 640px) {
  .blank-doc-banner {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
