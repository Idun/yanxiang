<script setup lang="ts">
defineProps<{
  /** 当前主界面：docs=文档 / cards=写作画布。决定快捷按钮指向哪个编辑区。 */
  workspace: "docs" | "cards" | "none";
  /** 是否正在生成中（禁用快捷按钮）。 */
  sending: boolean;
}>();

const emit = defineEmits<{
  /** 点「评估当前文档」：请求父组件以读者视角评估当前文档。 */
  evaluateDoc: [];
  /** 点「评估当前卡片」：请求父组件以读者视角评估画布选中的卡片。 */
  evaluateCard: [];
  /** 点「清空当前会话」。 */
  clear: [];
}>();
</script>

<template>
  <div class="reader-tab">
    <div class="reader-tab-actions">
      <button
        v-if="workspace === 'docs'"
        class="reader-quick-btn"
        title="以读者视角评估当前打开的文档（AI 会用工具读取正文）"
        :disabled="sending"
        @click="emit('evaluateDoc')"
      >
        评估当前文档
      </button>
      <button
        v-else-if="workspace === 'cards'"
        class="reader-quick-btn"
        title="以读者视角评估写作画布当前选中的文本卡片（AI 会用工具读取卡片正文）"
        :disabled="sending"
        @click="emit('evaluateCard')"
      >
        评估当前卡片
      </button>
      <span v-else class="reader-tab-hint">切到「文档」或「写作画布」界面后，可一键让读者评估当前正文。</span>
      <button class="reader-clear-btn" title="清空读者评估对话" :disabled="sending" @click="emit('clear')">
        清空
      </button>
    </div>
  </div>
</template>

<style scoped>
.reader-tab {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reader-tab-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.reader-quick-btn {
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--accent, #43588c);
  color: var(--accent, #43588c);
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}
.reader-quick-btn:hover:not(:disabled) {
  background: var(--accent-soft, rgba(67, 88, 140, 0.12));
}
.reader-quick-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.reader-clear-btn {
  font-size: 12px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid transparent;
  color: var(--muted, #8a91a5);
  background: transparent;
  cursor: pointer;
}
.reader-clear-btn:hover:not(:disabled) {
  color: #b02020;
}
.reader-clear-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.reader-tab-hint {
  font-size: 12px;
  color: var(--muted, #8a91a5);
}
</style>
