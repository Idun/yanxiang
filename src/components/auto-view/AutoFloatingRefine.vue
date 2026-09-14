<script setup lang="ts">
import { ref } from "vue";
import {
  Check,
  GripVertical,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-vue-next";

export interface RefineDiffData {
  turnId: number;
  action: string;
  originalText: string;
  refinedText: string;
  startIndex: number;
  endIndex: number;
}

interface Props {
  selectedText: string;
  activeRefineAction: string;
  refineUserInstruction: string;
  isRefiningParagraph: boolean;
  refinePanelStyle: Record<string, any>;
  activeRefineDiff: RefineDiffData | null;
  refineDiffUserMoved: boolean;
  refineDiffStyle: Record<string, any>;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:refineUserInstruction", val: string): void;
  (e: "openRefinePrompt", action: string): void;
  (e: "cancelRefinePrompt"): void;
  (e: "executeParagraphRefinement"): void;
  (e: "onRefineDiffDragStart", evt: MouseEvent): void;
  (e: "resetRefineDiffPosition"): void;
  (e: "acceptCurrentRefineDiff"): void;
  (e: "rejectRefineDiff"): void;
}>();

const floatingRefinePanelEl = ref<HTMLElement | null>(null);

defineExpose({
  floatingRefinePanelEl,
});
</script>

<template>
  <div>
    <!-- 选中正文的悬浮精修面板：跟随选中文字的视口位置浮在选区上方 -->
    <Teleport to="body">
      <div
        v-if="props.selectedText || props.activeRefineAction"
        ref="floatingRefinePanelEl"
        class="floating-refine-panel"
        :style="props.refinePanelStyle"
        @mouseup.stop
      >
        <div class="top-refine-toolbar">
          <div class="toolbar-title-hint">
            <Wand2 :size="13" class="wand-icon" />
            <span>选中正文定位</span>
          </div>
          <div class="refine-action-buttons">
            <button
              class="refine-tag-btn"
              :class="{ active: props.activeRefineAction === '修订' }"
              type="button"
              @mousedown.prevent.stop
              @click="emit('openRefinePrompt', '修订')"
            >
              修订
            </button>
            <button
              class="refine-tag-btn"
              :class="{ active: props.activeRefineAction === '较短' }"
              type="button"
              @mousedown.prevent.stop
              @click="emit('openRefinePrompt', '较短')"
            >
              较短
            </button>
            <button
              class="refine-tag-btn"
              :class="{ active: props.activeRefineAction === '少说破' }"
              type="button"
              @mousedown.prevent.stop
              @click="emit('openRefinePrompt', '少说破')"
            >
              少说破
            </button>
            <button
              class="refine-tag-btn"
              :class="{ active: props.activeRefineAction === '更自然' }"
              type="button"
              @mousedown.prevent.stop
              @click="emit('openRefinePrompt', '更自然')"
            >
              更自然
            </button>
            <button
              class="refine-tag-btn"
              :class="{ active: props.activeRefineAction === '更具沉浸感' }"
              type="button"
              @mousedown.prevent.stop
              @click="emit('openRefinePrompt', '更具沉浸感')"
            >
              更具沉浸感
            </button>
          </div>
        </div>
        <!-- Inline Prompt Input Box on Action Click -->
        <div v-if="props.activeRefineAction" class="refine-input-card">
          <div class="refine-card-head">
            <span class="refine-mode-label">正在改写：{{ props.activeRefineAction }}</span>
            <span class="selected-text-preview" :title="props.selectedText">
              "{{ props.selectedText.slice(0, 30) }}{{ props.selectedText.length > 30 ? '...' : '' }}"
            </span>
          </div>
          <textarea
            :value="props.refineUserInstruction"
            class="refine-prompt-textarea"
            placeholder="补充自定义修改要求 (可留空，直接点击生成)..."
            rows="2"
            @input="emit('update:refineUserInstruction', ($event.target as HTMLTextAreaElement).value)"
          />
          <div class="refine-card-actions">
            <button
              class="btn-primary-sm"
              :disabled="props.isRefiningParagraph"
              type="button"
              @mousedown.prevent
              @click="emit('executeParagraphRefinement')"
            >
              <Sparkles v-if="!props.isRefiningParagraph" :size="13" />
              <span>{{ props.isRefiningParagraph ? "生成中..." : "生成" }}</span>
            </button>
            <button
              class="btn-secondary-sm"
              type="button"
              @mousedown.prevent
              @click="emit('cancelRefinePrompt')"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <!-- Floating Inline Refine Diff Card: 类似 Cursor / Copilot 就近锚定在选中段落旁展示对比与接受/拒绝，支持自由拖拽 -->
    <Teleport to="body">
      <div
        v-if="props.activeRefineDiff"
        class="floating-refine-diff-card"
        :class="{ 'is-user-dragged': props.refineDiffUserMoved }"
        :style="props.refineDiffStyle"
        @mousedown.stop
      >
        <div
          class="refine-diff-head is-draggable"
          title="按住鼠标左键可自由拖拽移动面板位置，避免遮挡正文"
          @mousedown="emit('onRefineDiffDragStart', $event)"
        >
          <div class="refine-diff-title">
            <GripVertical :size="13" class="refine-diff-drag-handle" />
            <Sparkles :size="13" class="refine-diff-icon" />
            <span class="refine-diff-action-tag">「{{ props.activeRefineDiff.action }}」建议</span>
            <span class="refine-diff-tip">可按住标题拖拽 · Esc 拒绝 / Ctrl+Enter 接受</span>
          </div>
          <div class="refine-diff-actions" @mousedown.stop>
            <button
              v-if="props.refineDiffUserMoved"
              class="refine-diff-btn reset-pos"
              type="button"
              title="重置面板到选区就近默认位置"
              @click="emit('resetRefineDiffPosition')"
            >
              <RotateCcw :size="12" />
              <span>复位</span>
            </button>
            <button
              class="refine-diff-btn accept"
              type="button"
              title="接受修改并覆盖原文 (快捷键: Cmd/Ctrl + Enter)"
              @click="emit('acceptCurrentRefineDiff')"
            >
              <Check :size="13" :stroke-width="2.2" />
              <span>接受</span>
            </button>
            <button
              class="refine-diff-btn reject"
              type="button"
              title="拒绝修改并保留原文 (快捷键: Esc)"
              @click="emit('rejectRefineDiff')"
            >
              <X :size="13" :stroke-width="2.2" />
              <span>拒绝</span>
            </button>
          </div>
        </div>
        <div class="refine-diff-body">
          <div class="refine-diff-row original">
            <div class="diff-tag-col">
              <span class="diff-badge diff-del">原文</span>
            </div>
            <div class="diff-text-col diff-text-del">
              {{ props.activeRefineDiff.originalText }}
            </div>
          </div>
          <div class="diff-separator"></div>
          <div class="refine-diff-row suggested">
            <div class="diff-tag-col">
              <span class="diff-badge diff-add">改写</span>
            </div>
            <div class="diff-text-col diff-text-add">
              {{ props.activeRefineDiff.refinedText }}
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.floating-refine-panel {
  position: fixed;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 280px;
  max-width: min(520px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  overflow-y: auto;
  padding: 10px 14px;
  background-color: color-mix(in srgb, var(--surface-container-low) 88%, transparent);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  border: 1px solid var(--outline-variant);
  border-radius: 14px;
  box-shadow: 0 12px 32px -6px rgba(0, 0, 0, 0.22), 0 4px 12px -2px rgba(0, 0, 0, 0.08);
}

.top-refine-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.toolbar-title-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--primary);
}

.wand-icon {
  color: var(--primary);
}

.refine-action-buttons {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.refine-tag-btn {
  padding: 4px 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.775rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.refine-tag-btn:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  color: var(--primary);
}

.refine-tag-btn.active {
  border-color: var(--primary);
  background-color: var(--primary);
  color: #ffffff;
}

.refine-input-card {
  margin-top: 8px;
  padding-top: 10px;
  border-top: 1px dashed var(--outline-variant);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.refine-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.775rem;
}

.refine-mode-label {
  font-weight: 700;
  color: var(--primary);
}

.selected-text-preview {
  color: var(--on-surface-variant);
  opacity: 0.8;
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refine-prompt-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.85rem;
  outline: none;
  resize: vertical;
}

.refine-card-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.btn-primary-sm {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  background-color: var(--primary);
  color: #fff;
  font-size: 0.775rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
}

.btn-secondary-sm {
  height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  background-color: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface);
  font-size: 0.775rem;
  cursor: pointer;
}

.floating-refine-diff-card {
  position: fixed;
  z-index: 1005;
  border: 1px solid rgba(var(--primary-rgb) / 0.38);
  border-radius: 12px;
  background: var(--surface-container-low);
  backdrop-filter: blur(16px);
  overflow: hidden;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.18), 0 4px 14px rgba(0, 0, 0, 0.08);
  animation: refineDiffSlideIn 0.22s cubic-bezier(0.16, 1, 0.3, 1);
  max-height: 480px;
  display: flex;
  flex-direction: column;
}

@keyframes refineDiffSlideIn {
  from {
    opacity: 0;
    transform: translateY(6px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.refine-diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(var(--primary-rgb) / 0.09);
  border-bottom: 1px solid rgba(var(--primary-rgb) / 0.16);
  user-select: none;
  flex-shrink: 0;
}

.refine-diff-head.is-draggable {
  cursor: grab;
}

.refine-diff-head.is-draggable:active {
  cursor: grabbing;
}

.floating-refine-diff-card.is-user-dragged {
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.26), 0 6px 20px rgba(0, 0, 0, 0.14);
}

.refine-diff-drag-handle {
  color: var(--primary);
  opacity: 0.7;
  cursor: grab;
  margin-right: -2px;
}

.refine-diff-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--primary);
  flex-wrap: wrap;
}

.refine-diff-icon {
  color: var(--primary);
}

.refine-diff-action-tag {
  font-weight: 700;
}

.refine-diff-tip {
  font-size: 0.73rem;
  font-weight: normal;
  color: var(--on-surface-variant);
  opacity: 0.8;
}

.refine-diff-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.refine-diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 11px;
  border-radius: 6px;
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.16s ease;
}

.refine-diff-btn.accept {
  background: #0b7a3b;
  color: #ffffff;
  border: 1px solid #096330;
  box-shadow: 0 1px 4px rgba(11, 122, 59, 0.25);
}

.refine-diff-btn.accept:hover {
  background: #0d8f45;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(11, 122, 59, 0.35);
}

.refine-diff-btn.reject {
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
}

.refine-diff-btn.reject:hover {
  background: rgba(220, 53, 69, 0.08);
  color: #dc3545;
  border-color: rgba(220, 53, 69, 0.3);
}

.refine-diff-body {
  padding: 12px 14px;
  overflow-y: auto;
  font-size: 0.85rem;
  line-height: 1.65;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.refine-diff-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.diff-tag-col {
  flex-shrink: 0;
}

.diff-badge {
  font-size: 0.7rem;
  padding: 2px 6px;
  border-radius: 4px;
  font-weight: 600;
}

.diff-badge.diff-del {
  background-color: rgba(239, 68, 68, 0.12);
  color: #ef4444;
}

.diff-badge.diff-add {
  background-color: rgba(16, 185, 129, 0.12);
  color: #10b981;
}

.diff-text-col {
  flex: 1;
  word-break: break-word;
  white-space: pre-wrap;
}

.diff-text-del {
  color: #ef4444;
  text-decoration: line-through;
  opacity: 0.85;
}

.diff-text-add {
  color: #10b981;
  font-weight: 500;
}

.diff-separator {
  height: 1px;
  background-color: var(--outline-variant);
  margin: 4px 0;
}
</style>
