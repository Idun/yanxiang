<script setup lang="ts">
import { X, Split, RotateCcw, Check, ArrowRight } from "lucide-vue-next";
import { TextCleanupResultLog } from "../types/writingRules";

const props = defineProps<{
  isOpen: boolean;
  resultLog: TextCleanupResultLog | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "undo", originalText: string): void;
}>();

const modeLabels: Record<string, string> = {
  exact: "精确",
  fuzzy: "模糊",
  wrap: "包裹",
  sentence: "句式",
  regex: "正则",
};

function handleUndo() {
  if (props.resultLog?.originalText !== undefined) {
    emit("undo", props.resultLog.originalText);
    emit("close");
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen && resultLog" class="diff-overlay" @mousedown.self="emit('close')">
      <div class="diff-shell" @mousedown.stop>
        <header class="diff-head">
          <div class="diff-head-main">
            <span class="diff-head-icon">
              <Split :size="15" :stroke-width="1.9" />
            </span>
            <div class="diff-head-text">
              <h3 class="diff-title">文字整理前后对比</h3>
              <p class="diff-sub">
                共替换 <b>{{ resultLog.totalCount }}</b> 处内容，生效规则
                <b>{{ resultLog.appliedRules.length }}</b> 条
              </p>
            </div>
          </div>
          <button type="button" class="diff-icon-btn" title="关闭" @click="emit('close')">
            <X :size="15" :stroke-width="1.9" />
          </button>
        </header>

        <div class="diff-rules">
          <span class="diff-rules-label">生效规则</span>
          <span v-for="(rule, idx) in resultLog.appliedRules" :key="idx" class="diff-rule-chip">
            <span class="diff-rule-mode">{{ modeLabels[rule.mode] || rule.mode }}</span>
            <code class="diff-rule-src" :title="rule.source">{{ rule.source }}</code>
            <ArrowRight :size="10" :stroke-width="2.2" class="diff-rule-arrow" />
            <code class="diff-rule-dst" :title="rule.target">{{ rule.target || "(空)" }}</code>
            <span class="diff-rule-count">{{ rule.count }} 处</span>
          </span>
        </div>

        <div class="diff-panes">
          <section class="diff-pane">
            <header class="diff-pane-head">
              <span>整理前原文</span>
              <span class="diff-pane-count">{{ resultLog.originalText.length }} 字</span>
            </header>
            <div class="diff-pane-body">{{ resultLog.originalText }}</div>
          </section>

          <section class="diff-pane">
            <header class="diff-pane-head accent">
              <span>整理后效果</span>
              <span class="diff-pane-count">{{ resultLog.resultText.length }} 字</span>
            </header>
            <div class="diff-pane-body">{{ resultLog.resultText }}</div>
          </section>
        </div>

        <footer class="diff-foot">
          <button
            type="button"
            class="diff-btn danger"
            title="还原为整理前的原文内容"
            @click="handleUndo"
          >
            <RotateCcw :size="14" :stroke-width="1.9" />
            <span>撤销整理并恢复原文</span>
          </button>
          <button type="button" class="diff-btn primary" @click="emit('close')">
            <Check :size="14" :stroke-width="1.9" />
            <span>确认保留并关闭</span>
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.diff-overlay {
  position: fixed;
  inset: 0;
  z-index: 4100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 28px;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(3px);
}

.diff-shell {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1000px;
  max-height: 86vh;
  overflow: hidden;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 14px;
  box-shadow: 0 25px 50px -12px rgba(15, 23, 42, 0.3);
  animation: diffPop 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes diffPop {
  from {
    opacity: 0;
    transform: scale(0.97);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 12px;
  padding: 12px 18px;
  background: var(--surface-bright);
  border-bottom: 1px solid var(--outline-variant);
}

.diff-head-main {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.diff-head-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 8px;
  background: rgb(var(--primary-rgb) / 0.14);
  color: var(--primary);
}

.diff-head-text {
  min-width: 0;
}

.diff-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
}

.diff-sub {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--on-surface-variant);
}

.diff-sub b {
  color: var(--primary);
}

.diff-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.16s ease, color 0.16s ease;
}

.diff-icon-btn:hover {
  background: var(--error-container);
  color: var(--error);
}

.diff-rules {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  max-height: 92px;
  overflow-y: auto;
  padding: 8px 18px;
  background: var(--surface-container);
  border-bottom: 1px solid var(--outline-variant);
}

.diff-rules-label {
  margin-right: 2px;
  font-size: 11px;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.diff-rule-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 7px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  font-size: 11px;
}

.diff-rule-mode {
  padding: 0 4px;
  border-radius: 3px;
  background: rgb(var(--primary-rgb) / 0.14);
  color: var(--primary);
  font-size: 10px;
  font-weight: 600;
}

.diff-rule-src,
.diff-rule-dst {
  max-width: 96px;
  overflow: hidden;
  font-family: var(--code-font);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-rule-src {
  color: #b42318;
}

.diff-rule-dst {
  color: #0f7a5a;
}

.diff-rule-arrow {
  flex-shrink: 0;
  color: var(--outline);
}

.diff-rule-count {
  color: var(--outline);
  font-size: 10px;
}

.diff-panes {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex: 1 1 auto;
  min-height: 260px;
  overflow: hidden;
}

.diff-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--surface-bright);
}

.diff-pane + .diff-pane {
  border-left: 1px solid var(--outline-variant);
}

.diff-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  padding: 7px 14px;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.diff-pane-head.accent {
  background: rgb(var(--primary-rgb) / 0.08);
  color: var(--primary);
}

.diff-pane-count {
  font-family: var(--code-font);
  font-size: 11px;
  font-weight: 400;
  opacity: 0.75;
}

.diff-pane-body {
  flex: 1 1 auto;
  overflow-y: auto;
  padding: 14px;
  color: var(--reading-text);
  font-size: 12.5px;
  line-height: 1.75;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
}

.diff-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  gap: 10px;
  padding: 10px 18px;
  background: var(--surface-bright);
  border-top: 1px solid var(--outline-variant);
}

.diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 14px;
  border-radius: 7px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.diff-btn.danger {
  border: 1px solid #f3c0c0;
  background: var(--error-container);
  color: #b42318;
}

.diff-btn.danger:hover {
  background: #fcd4d4;
}

.diff-btn.primary {
  border: 1px solid transparent;
  background: var(--primary);
  color: #fff;
}

.diff-btn.primary:hover {
  background: var(--primary-container);
}

@media (max-width: 720px) {
  .diff-panes {
    grid-template-columns: 1fr;
  }

  .diff-pane + .diff-pane {
    border-left: none;
    border-top: 1px solid var(--outline-variant);
  }
}
</style>
