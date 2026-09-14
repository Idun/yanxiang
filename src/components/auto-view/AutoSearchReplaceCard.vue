<script setup lang="ts">
import { ref } from "vue";
import { ArrowDown, ArrowUp, Pencil, X } from "lucide-vue-next";

interface Props {
  findPanelOpen: boolean;
  findQuery: string;
  replaceQuery: string;
  findMatches: any[];
  findMatchIndex: number;
  findCaseSensitive: boolean;
  findMatchWholeWord: boolean;
  findShowReplace: boolean;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:findQuery", val: string): void;
  (e: "update:replaceQuery", val: string): void;
  (e: "update:findCaseSensitive", val: boolean): void;
  (e: "update:findMatchWholeWord", val: boolean): void;
  (e: "update:findShowReplace", val: boolean): void;
  (e: "updateFindMatches"): void;
  (e: "findNext"): void;
  (e: "findPrev"): void;
  (e: "closeFindPanel"): void;
  (e: "toggleFindReplaceRow"): void;
  (e: "executeFindReplace"): void;
  (e: "executeFindReplaceAll"): void;
}>();

const findInputRef = ref<HTMLInputElement | null>(null);
const replaceInputRef = ref<HTMLInputElement | null>(null);

function focusFindInput() {
  findInputRef.value?.focus();
  findInputRef.value?.select();
}

function focusReplaceInput() {
  replaceInputRef.value?.focus();
  replaceInputRef.value?.select();
}

defineExpose({
  findInputRef,
  replaceInputRef,
  focusFindInput,
  focusReplaceInput,
});
</script>

<template>
  <!-- 查找与替换悬浮卡片 (快捷键: Ctrl+F 查找 / Ctrl+H 替换 / Esc 关闭) -->
  <transition name="fade-slide">
    <div
      v-if="props.findPanelOpen"
      class="find-replace-panel"
      role="region"
      aria-label="查找与替换面板"
    >
      <!-- 查找行 -->
      <div class="find-row">
        <div class="find-input-box">
          <svg
            class="find-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            ref="findInputRef"
            :value="props.findQuery"
            class="find-replace-input"
            type="text"
            placeholder="查找内容 (Enter 下一个，Shift+Enter 上一个)..."
            @input="emit('update:findQuery', ($event.target as HTMLInputElement).value); emit('updateFindMatches')"
            @keydown.enter.exact.prevent="emit('findNext')"
            @keydown.shift.enter.prevent="emit('findPrev')"
            @keydown.esc.prevent="emit('closeFindPanel')"
          />
          <span class="find-counter-badge">
            {{
              props.findQuery
                ? props.findMatches.length > 0
                  ? `${props.findMatchIndex + 1} / ${props.findMatches.length}`
                  : "无结果"
                : ""
            }}
          </span>
        </div>
        <!-- 控制按钮组 -->
        <div class="find-actions-group">
          <button
            class="find-mini-btn"
            type="button"
            :disabled="props.findMatches.length === 0"
            title="上一个 (Shift+Enter)"
            @click="emit('findPrev')"
          >
            <ArrowUp :size="12" :stroke-width="2.2" />
          </button>
          <button
            class="find-mini-btn"
            type="button"
            :disabled="props.findMatches.length === 0"
            title="下一个 (Enter)"
            @click="emit('findNext')"
          >
            <ArrowDown :size="12" :stroke-width="2.2" />
          </button>
          <button
            class="find-mini-btn toggle"
            :class="{ active: props.findCaseSensitive }"
            type="button"
            title="区分大小写"
            @click="
              emit('update:findCaseSensitive', !props.findCaseSensitive);
              emit('updateFindMatches');
            "
          >
            <span class="font-mono text-[11px] font-bold">Aa</span>
          </button>
          <button
            class="find-mini-btn toggle"
            :class="{ active: props.findMatchWholeWord }"
            type="button"
            title="全词匹配"
            @click="
              emit('update:findMatchWholeWord', !props.findMatchWholeWord);
              emit('updateFindMatches');
            "
          >
            <span class="font-mono text-[10px] font-bold">\b</span>
          </button>
          <button
            class="find-mini-btn toggle"
            :class="{ active: props.findShowReplace }"
            type="button"
            :title="props.findShowReplace ? '收起替换行 (Ctrl+H)' : '展开替换行 (Ctrl+H)'"
            @click="emit('toggleFindReplaceRow')"
          >
            <Pencil :size="12" :stroke-width="2" />
          </button>
          <button
            class="find-mini-btn close"
            type="button"
            title="关闭 (Esc)"
            @click="emit('closeFindPanel')"
          >
            <X :size="12" :stroke-width="2.2" />
          </button>
        </div>
      </div>
      <!-- 替换行 -->
      <div v-show="props.findShowReplace" class="replace-row">
        <div class="find-input-box">
          <svg
            class="find-icon"
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="23 4 23 10 17 10" />
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
          </svg>
          <input
            ref="replaceInputRef"
            :value="props.replaceQuery"
            class="find-replace-input"
            type="text"
            placeholder="替换为..."
            @input="emit('update:replaceQuery', ($event.target as HTMLInputElement).value)"
            @keydown.enter.exact.prevent="emit('executeFindReplace')"
            @keydown.esc.prevent="emit('closeFindPanel')"
          />
        </div>
        <div class="replace-buttons-group">
          <button
            class="replace-action-btn"
            type="button"
            :disabled="props.findMatches.length === 0"
            title="替换当前项 (快捷键: Alt+R)"
            @click="emit('executeFindReplace')"
          >
            替换
          </button>
          <button
            class="replace-action-btn primary"
            type="button"
            :disabled="props.findMatches.length === 0"
            title="全部替换 (快捷键: Alt+A)"
            @click="emit('executeFindReplaceAll')"
          >
            全部替换
          </button>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.find-replace-panel {
  position: absolute;
  top: 10px;
  right: 16px;
  z-index: 60;
  min-width: 320px;
  max-width: 440px;
  background: var(--surface-container-highest);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12), 0 2px 6px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
}

.find-row,
.replace-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.find-input-box {
  position: relative;
  flex: 1;
  display: flex;
  align-items: center;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  padding: 0 6px;
  height: 28px;
  transition: border-color 0.15s ease;
}

.find-input-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.find-icon {
  color: var(--on-surface-variant);
  margin-right: 4px;
  flex-shrink: 0;
}

.find-replace-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--on-surface);
  font-size: 12px;
  min-width: 0;
}

.find-counter-badge {
  font-size: 10px;
  color: var(--on-surface-variant);
  white-space: nowrap;
  margin-left: 4px;
}

.find-actions-group {
  display: flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
}

.find-mini-btn {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.12s ease;
}

.find-mini-btn:hover:not(:disabled) {
  background: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.find-mini-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.find-mini-btn.toggle.active {
  background: var(--primary-fixed);
  color: var(--primary);
  border-color: var(--primary);
}

.find-mini-btn.close:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.replace-buttons-group {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.replace-action-btn {
  height: 26px;
  padding: 0 8px;
  border: 1px solid var(--outline-variant);
  border-radius: 4px;
  background: var(--surface-bright);
  color: var(--on-surface);
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.12s ease;
}

.replace-action-btn:hover:not(:disabled) {
  border-color: var(--primary);
  color: var(--primary);
}

.replace-action-btn.primary {
  background: var(--primary);
  color: var(--on-primary, #ffffff);
  border-color: var(--primary);
}

.replace-action-btn.primary:hover:not(:disabled) {
  opacity: 0.9;
}

.replace-action-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.18s ease;
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
