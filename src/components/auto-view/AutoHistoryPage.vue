<script setup lang="ts">
import { ref } from "vue";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Coins,
  History,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Trash2,
} from "lucide-vue-next";
import type { AiTurn } from "../../autoStore";

interface Props {
  aiTurns: AiTurn[];
  contentColoringOn?: boolean;
  autoReadingStyle?: Record<string, any>;
  renderTurnBody: (content: string) => string;
  turnLabel: (turn: AiTurn) => string;
}

const props = withDefaults(defineProps<Props>(), {
  contentColoringOn: false,
  autoReadingStyle: () => ({}),
});

const emit = defineEmits<{
  (e: "leaveHistory"): void;
  (e: "jumpToTurn", turn: AiTurn): void;
  (e: "deleteTurn", turn: AiTurn): void;
}>();

const expandedHistoryIds = ref<Set<number>>(new Set());

function isHistoryExpanded(id: number): boolean {
  return expandedHistoryIds.value.has(id);
}

function toggleHistoryEntry(id: number) {
  const next = new Set(expandedHistoryIds.value);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  expandedHistoryIds.value = next;
}
</script>

<template>
  <div class="auto-history-page">
    <div class="history-page-head">
      <div class="history-page-title">
        <History :size="16" class="history-page-icon" />
        <span>历史对话 · 全部上下文对话</span>
        <span class="history-page-count">{{ props.aiTurns.length }} 条</span>
      </div>
      <button class="history-back-btn" type="button" @click="emit('leaveHistory')">
        <ArrowLeft :size="14" />
        返回
      </button>
    </div>

    <div v-if="props.aiTurns.length === 0" class="history-page-empty">
      <History :size="28" class="opacity-30 mb-2" />
      <p class="text-xs opacity-60">
        暂无历史对话<br />
        每次 AI 产出后，完整上下文对话都会记录在这里
      </p>
    </div>

    <!-- 折叠条目列表：默认一行一条，点条目直接跳回对话界面并定位；
         要看这一轮的完整上下文再点右侧小箭头展开。 -->
    <div v-else class="history-page-list">
      <section
        v-for="turn in props.aiTurns"
        :key="turn.id"
        class="history-entry"
        :class="{ expanded: isHistoryExpanded(turn.id) }"
      >
        <div
          class="history-entry-row"
          role="button"
          tabindex="0"
          :title="`回到对话界面并定位到「${props.turnLabel(turn)}」`"
          @click="emit('jumpToTurn', turn)"
          @keydown.enter.prevent="emit('jumpToTurn', turn)"
          @keydown.space.prevent="emit('jumpToTurn', turn)"
        >
          <Sparkles :size="12" :stroke-width="2" class="history-entry-icon" />
          <span class="history-entry-title">{{ props.turnLabel(turn) }}</span>
          <span class="history-entry-chars">{{ turn.content.trim().length }} 字</span>
          <span class="history-entry-time">{{ turn.timestamp }}</span>
          <span v-if="turn.isBlankDoc || turn.variant === 'blank'" class="history-card-tokens" title="空白文稿字符统计">
            <FileText :size="11" :stroke-width="1.9" />
            {{ (turn.content || '').length.toLocaleString() }} 字符
          </span>
          <span v-else-if="turn.tokens" class="history-card-tokens">
            <Coins :size="11" :stroke-width="1.9" />
            {{ turn.tokens.toLocaleString() }}
          </span>
          <button
            class="history-entry-caret"
            type="button"
            :title="isHistoryExpanded(turn.id) ? '收起本轮上下文' : '展开本轮完整上下文'"
            @click.stop="toggleHistoryEntry(turn.id)"
          >
            <ChevronDown v-if="isHistoryExpanded(turn.id)" :size="13" :stroke-width="2.2" />
            <ChevronRight v-else :size="13" :stroke-width="2.2" />
          </button>
          <button
            class="history-card-del"
            title="删除此条目"
            type="button"
            @click.stop="emit('deleteTurn', turn)"
          >
            <Trash2 :size="12" />
          </button>
        </div>

        <div v-if="isHistoryExpanded(turn.id)" class="history-entry-body">
          <!-- 用户侧指令（要求的原文） -->
          <details v-if="turn.prompt" class="history-prompt" open>
            <summary class="history-prompt-summary">
              <MessageSquare :size="12" :stroke-width="2" />
              本轮要求
            </summary>
            <pre class="history-prompt-body">{{ turn.prompt }}</pre>
          </details>

          <!-- 知识项工具活动轨迹 -->
          <div
            v-if="turn.tools && turn.tools.length > 0"
            class="tool-trace-list"
          >
            <span
              v-for="(tr, i) in turn.tools"
              :key="i"
              class="tool-trace-chip"
              :class="{ done: tr.done }"
              :title="tr.detail || tr.label"
            >
              <Check v-if="tr.done" :size="11" class="trace-check" />
              <RefreshCw v-else :size="11" class="trace-spin" />
              {{ tr.label }}
            </span>
          </div>

          <!-- 思考过程 -->
          <details v-if="turn.reasoning" class="history-reasoning">
            <summary class="history-reasoning-summary">
              <BrainCircuit :size="12" :stroke-width="2" />
              思考过程
            </summary>
            <pre class="history-reasoning-body">{{ turn.reasoning }}</pre>
          </details>

          <!-- 完整正文：与文档界面同一条渲染管线（含内容上色） -->
          <div
            class="markdown-body reading-view article-render history-card-body"
            :class="{ 'content-colored': props.contentColoringOn }"
            :style="props.autoReadingStyle"
            v-html="props.renderTurnBody(turn.content)"
          />

          <div v-if="turn.incomplete" class="history-incomplete">
            正文尚未写完（被输出长度上限截断或已中止）
          </div>

          <div v-if="turn.continued" class="history-continued">
            自动接续 {{ turn.continued }} 次
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.auto-history-page {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background-color: var(--surface-bright);
}

.history-page-head {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 26px;
  border-bottom: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
}

.history-page-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 700;
  color: var(--on-surface);
}

.history-page-icon {
  color: var(--primary);
}

.history-page-count {
  font-size: 0.72rem;
  font-weight: 600;
  padding: 2px 9px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

.history-back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-back-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.05);
}

.history-page-list {
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 18px 26px 48px;
}

.history-page-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--on-surface-variant);
}

/* 折叠条目：默认一行标题；点行体跳回对话界面，点小箭头才展开完整上下文。 */
.history-entry {
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  background-color: var(--surface-bright);
  overflow: hidden;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.history-entry:hover {
  border-color: var(--primary);
}

.history-entry.expanded {
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
}

.history-entry-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 12px;
  cursor: pointer;
  user-select: none;
}

.history-entry-row:hover {
  background-color: rgba(var(--primary-rgb) / 0.04);
}

.history-entry-icon {
  flex-shrink: 0;
  color: var(--primary);
}

.history-entry-title {
  flex: 1;
  min-width: 0;
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-entry-chars {
  flex-shrink: 0;
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--primary);
}

.history-entry-time {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--on-surface-variant);
  opacity: 0.75;
}

.history-entry-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-entry-caret:hover {
  background-color: var(--surface-container-high);
  color: var(--primary);
}

.history-entry-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 16px 16px;
  border-top: 1px solid var(--outline-variant);
}

.history-card-tokens {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.history-card-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.history-card-del:hover {
  color: var(--error, #ef4444);
  background-color: rgba(239, 68, 68, 0.1);
}

.history-prompt,
.history-reasoning {
  border: 1px dashed var(--outline-variant);
  border-radius: 10px;
  background-color: var(--surface-container-low);
  overflow: hidden;
}

.history-prompt-summary,
.history-reasoning-summary {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 12px;
  font-size: 0.76rem;
  font-weight: 600;
  color: var(--on-surface-variant);
  cursor: pointer;
  user-select: none;
}

.history-prompt-summary svg,
.history-reasoning-summary svg {
  flex-shrink: 0;
}

.history-prompt-body,
.history-reasoning-body {
  margin: 0;
  padding: 8px 12px 12px;
  font-size: 0.76rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--on-surface);
  font-family: inherit;
  border-top: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
}

.history-card-body {
  font-size: 0.86rem;
  line-height: 1.75;
}

.history-incomplete {
  font-size: 0.72rem;
  color: #f59e0b;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  background-color: rgba(245, 158, 11, 0.1);
  align-self: flex-start;
}

.history-continued {
  font-size: 0.72rem;
  color: var(--primary);
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 6px;
  background-color: rgba(var(--primary-rgb) / 0.08);
  align-self: flex-start;
}

.tool-trace-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tool-trace-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 6px;
  background-color: var(--surface-container-high);
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
}

.tool-trace-chip.done {
  color: var(--on-surface);
}

.trace-check {
  color: #10b981;
}

.trace-spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
