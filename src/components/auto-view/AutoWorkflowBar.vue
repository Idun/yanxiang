<script setup lang="ts">
import { computed } from "vue";
import {
  BookOpen,
  Check,
  ChevronRight,
  Eye,
  FastForward,
  FileCheck2,
  Lock,
  RotateCcw,
  Shield,
  Sparkles,
} from "lucide-vue-next";
import { storyStateStore } from "./storyStateStore";

export type WorkflowStepId =
  | "outline"
  | "chapter_outline"
  | "drafting"
  | "state_ledger"
  | "audit_review";

const props = defineProps<{
  currentStep: WorkflowStepId;
  hasOutline: boolean;
  hasChapterOutline: boolean;
  currentChapterTitle: string;
  totalChapters: number;
  isGenerating: boolean;
  isAuditOrReaderMode: boolean;
  canNextChapter: boolean;
  nextChapterTooltip?: string;
}>();

const emit = defineEmits<{
  (e: "select-step", step: WorkflowStepId): void;
  (e: "trigger-outline"): void;
  (e: "trigger-chapter-outline"): void;
  (e: "trigger-next-chapter"): void;
  (e: "trigger-audit"): void;
  (e: "trigger-reader"): void;
  (e: "trigger-rewrite-audit"): void;
  (e: "toggle-state-ledger"): void;
}>();

const activeForeshadowCount = computed(
  () =>
    storyStateStore.ledger.foreshadowing.filter((f) => f.status !== "resolved")
      .length
);

function isStepAccessible(id: WorkflowStepId): boolean {
  if (id === "outline") return true;
  if (id === "chapter_outline") return props.hasOutline;
  if (id === "drafting") return props.hasChapterOutline;
  if (id === "state_ledger") return props.totalChapters > 0;
  if (id === "audit_review") return props.totalChapters > 0;
  return false;
}

function getStepLockTip(id: WorkflowStepId): string {
  if (id === "chapter_outline" && !props.hasOutline) {
    return "第2步未解锁：请先完成第1步「设定与大纲」";
  }
  if (id === "drafting" && !props.hasChapterOutline) {
    return "第3步未解锁：请先完成第2步「章节细纲」";
  }
  if (id === "state_ledger" && props.totalChapters === 0) {
    return "第4步未解锁：请先在第3步起草正文";
  }
  if (id === "audit_review" && props.totalChapters === 0) {
    return "第5步未解锁：请先在第3步起草正文后再进行审评";
  }
  return "";
}

function handleStepClick(id: WorkflowStepId) {
  if (!isStepAccessible(id)) return;
  emit("select-step", id);
}

const steps = computed(() => [
  {
    id: "outline" as const,
    num: 1,
    title: "设定与大纲",
    desc: "选题素材与故事大纲",
    done: props.hasOutline,
    badge: props.hasOutline ? "已就绪" : "待构思",
  },
  {
    id: "chapter_outline" as const,
    num: 2,
    title: "章节细纲",
    desc: "规划分章事件冲突",
    done: props.hasChapterOutline,
    badge: !props.hasOutline ? "未解锁" : props.hasChapterOutline ? "已规划" : "待生成",
  },
  {
    id: "drafting" as const,
    num: 3,
    title: "逐章起草",
    desc: "单章推进审阅再续",
    done: props.totalChapters > 0,
    badge: !props.hasChapterOutline ? "未解锁" : props.totalChapters > 0 ? (props.currentChapterTitle || `已产出 ${props.totalChapters} 篇`) : "单章起草",
  },
  {
    id: "state_ledger" as const,
    num: 4,
    title: "状态表",
    desc: "等级装备伏笔分存",
    done: props.totalChapters > 0 && storyStateStore.ledger.characters.length > 0,
    badge: props.totalChapters === 0 ? "未解锁" : `伏笔 ${activeForeshadowCount.value} · 角色 ${storyStateStore.ledger.characters.length}`,
  },
  {
    id: "audit_review" as const,
    num: 5,
    title: "审核与重写",
    desc: "读者审评打回修正",
    done: props.isAuditOrReaderMode,
    badge: props.totalChapters === 0 ? "未解锁" : props.isAuditOrReaderMode ? "评估中" : "质检打回",
  },
]);
</script>

<template>
  <nav class="workflow-bar-root">
    <!-- 左侧工作流步骤指示器 -->
    <div class="workflow-steps">
      <template v-for="(step, index) in steps" :key="step.id">
        <button
          type="button"
          class="workflow-step-btn"
          :class="{
            active: currentStep === step.id,
            completed: step.done && currentStep !== step.id,
            locked: !isStepAccessible(step.id),
          }"
          :disabled="!isStepAccessible(step.id)"
          :title="!isStepAccessible(step.id) ? getStepLockTip(step.id) : `${step.num}. ${step.title}（${step.badge}）`"
          @click="handleStepClick(step.id)"
        >
          <!-- 步骤序号 / 完成标记 / 锁定标记 -->
          <span class="step-indicator">
            <Lock v-if="!isStepAccessible(step.id)" :size="10" />
            <Check v-else-if="step.done && currentStep !== step.id" :size="10" :stroke-width="3" />
            <span v-else>{{ step.num }}</span>
          </span>

          <div class="step-text-wrap">
            <span class="step-title">{{ step.title }}</span>
            <span class="step-badge">{{ step.badge }}</span>
          </div>
        </button>

        <!-- 步骤连接箭头 -->
        <ChevronRight
          v-if="index < steps.length - 1"
          :size="12"
          class="step-separator-icon"
        />
      </template>
    </div>

    <!-- 右侧流程捷径与关键操作区 -->
    <div class="workflow-actions">
      <!-- 步骤 1 捷径 -->
      <button
        v-if="currentStep === 'outline'"
        type="button"
        class="workflow-btn workflow-btn-primary"
        :disabled="isGenerating"
        @click="emit('trigger-outline')"
      >
        <Sparkles :size="13" />
        <span>生成故事大纲</span>
      </button>

      <!-- 步骤 2 捷径 -->
      <button
        v-else-if="currentStep === 'chapter_outline'"
        type="button"
        class="workflow-btn workflow-btn-primary"
        :disabled="isGenerating || !props.hasOutline"
        :title="!props.hasOutline ? '需先完成第1步故事大纲' : '规划并生成章节细纲'"
        @click="emit('trigger-chapter-outline')"
      >
        <BookOpen :size="13" />
        <span>生成章节细纲</span>
      </button>

      <!-- 步骤 3 捷径：下一章推进 (单章推进，绝不一次性多章) -->
      <template v-else-if="currentStep === 'drafting'">
        <button
          type="button"
          class="workflow-btn workflow-btn-primary"
          :disabled="isGenerating || !canNextChapter || !props.hasChapterOutline"
          :title="!props.hasChapterOutline ? '需先完成第2步章节细纲' : (nextChapterTooltip || '按细纲与状态表起草下一章正文')"
          @click="emit('trigger-next-chapter')"
        >
          <FastForward :size="13" />
          <span>推进单章正文</span>
        </button>
      </template>

      <!-- 步骤 4 捷径：状态追踪表开关 -->
      <button
        v-else-if="currentStep === 'state_ledger'"
        type="button"
        class="workflow-btn workflow-btn-outline"
        :disabled="props.totalChapters === 0"
        :title="props.totalChapters === 0 ? '需先起草正文后解锁' : '管理故事状态表'"
        @click="emit('toggle-state-ledger')"
      >
        <Shield :size="13" class="action-icon-accent" />
        <span>管理状态表</span>
      </button>

      <!-- 步骤 5 捷径：审核 / 读者扫文与打回 -->
      <div v-else-if="currentStep === 'audit_review'" class="workflow-btn-group">
        <button
          type="button"
          class="workflow-btn workflow-btn-outline"
          :disabled="isGenerating || props.totalChapters === 0"
          title="以编辑审核视角扫视全文结构与节奏"
          @click="emit('trigger-audit')"
        >
          <FileCheck2 :size="13" class="action-icon-amber" />
          <span>审核意见</span>
        </button>
        <button
          type="button"
          class="workflow-btn workflow-btn-outline"
          :disabled="isGenerating || props.totalChapters === 0"
          title="以真实读者视角评估故事趣味与代入感"
          @click="emit('trigger-reader')"
        >
          <Eye :size="13" class="action-icon-indigo" />
          <span>读者评估</span>
        </button>
        <button
          type="button"
          class="workflow-btn workflow-btn-primary"
          :disabled="isGenerating || props.totalChapters === 0"
          title="根据已生成的审核意见或读者反馈修改本章正文"
          @click="emit('trigger-rewrite-audit')"
        >
          <RotateCcw :size="13" />
          <span>按反馈打回重写</span>
        </button>
      </div>

      <!-- 常驻状态表呼出图标按钮 -->
      <button
        type="button"
        class="workflow-icon-btn"
        :class="{ active: currentStep === 'state_ledger', disabled: props.totalChapters === 0 }"
        :disabled="props.totalChapters === 0"
        :title="props.totalChapters === 0 ? '需先起草正文后解锁故事状态追踪表' : '故事状态追踪表（等级、装备、伏笔与当前要点）'"
        @click="emit('toggle-state-ledger')"
      >
        <Shield :size="14" />
        <span
          v-if="activeForeshadowCount > 0 && props.totalChapters > 0"
          class="state-dot-badge"
        />
      </button>
    </div>
  </nav>
</template>

<style scoped>
.workflow-bar-root {
  width: 100%;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 5px 10px;
  background-color: var(--surface-bright, #ffffff);
  border-bottom: 1px solid var(--outline-variant, #e5e7eb);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  font-family: var(--app-font, inherit);
  user-select: none;
  z-index: 20;
  box-sizing: border-box;
}

.workflow-steps {
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  padding: 1px 0;
}

.workflow-step-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 6px;
  border-radius: 6px;
  border: 1px solid transparent;
  background-color: transparent;
  color: var(--on-surface-variant, #6b7280);
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
  text-align: left;
}

.workflow-step-btn:hover:not(:disabled) {
  background-color: var(--surface-container-low, #f3f4f6);
  color: var(--on-surface, #111827);
}

.workflow-step-btn.active {
  background-color: rgba(var(--primary-rgb, 59 130 246) / 0.1);
  border-color: rgba(var(--primary-rgb, 59 130 246) / 0.4);
  color: var(--primary, #2563eb);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.workflow-step-btn.completed:not(.active) {
  background-color: var(--surface-container-lowest, #ffffff);
  border-color: var(--outline-variant, #e5e7eb);
  color: var(--on-surface, #1f2937);
}

.workflow-step-btn.locked,
.workflow-step-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  border-color: transparent;
  background-color: transparent;
}

.step-indicator {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.68rem;
  font-weight: 700;
  flex-shrink: 0;
  background-color: var(--surface-container-high, #e5e7eb);
  border: 1px solid var(--outline-variant, #d1d5db);
  color: var(--on-surface-variant, #6b7280);
  transition: all 0.18s ease;
}

.workflow-step-btn.active .step-indicator {
  background-color: var(--primary, #2563eb);
  border-color: var(--primary, #2563eb);
  color: var(--on-primary, #ffffff);
}

.workflow-step-btn.completed .step-indicator {
  background-color: #10b981;
  border-color: #10b981;
  color: #ffffff;
}

.workflow-step-btn.locked .step-indicator {
  background-color: var(--surface-container, #f3f4f6);
  border-color: var(--outline-variant, #e5e7eb);
  color: var(--on-surface-variant, #9ca3af);
}

.step-text-wrap {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.step-title {
  font-size: 0.78rem;
  font-weight: 600;
}

.step-badge {
  font-size: 0.68rem;
  opacity: 0.8;
  font-weight: 400;
}

.step-separator-icon {
  color: var(--outline, #9ca3af);
  opacity: 0.4;
  flex-shrink: 0;
  margin: 0 1px;
}

.workflow-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.workflow-btn-group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.workflow-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 12px;
  border-radius: 6px;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
  box-sizing: border-box;
}

.workflow-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.workflow-btn-primary {
  background-color: var(--primary, #2563eb);
  color: var(--on-primary, #ffffff);
  border: 1px solid var(--primary, #2563eb);
}

.workflow-btn-primary:hover:not(:disabled) {
  opacity: 0.92;
  box-shadow: 0 2px 6px rgba(var(--primary-rgb, 59 130 246) / 0.25);
}

.workflow-btn-outline {
  background-color: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant, #d1d5db);
  color: var(--on-surface, #1f2937);
}

.workflow-btn-outline:hover:not(:disabled) {
  background-color: var(--surface-container-low, #f3f4f6);
  border-color: var(--outline, #9ca3af);
}

.workflow-icon-btn {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant, #d1d5db);
  background-color: var(--surface-bright, #ffffff);
  color: var(--on-surface-variant, #6b7280);
  cursor: pointer;
  transition: all 0.18s ease;
}

.workflow-icon-btn:hover:not(:disabled) {
  background-color: var(--surface-container-low, #f3f4f6);
  color: var(--on-surface, #111827);
}

.workflow-icon-btn.active {
  background-color: rgba(var(--primary-rgb, 59 130 246) / 0.1);
  border-color: var(--primary, #2563eb);
  color: var(--primary, #2563eb);
}

.workflow-icon-btn.disabled,
.workflow-icon-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.action-icon-accent {
  color: var(--primary, #2563eb);
}

.action-icon-amber {
  color: #d97706;
}

.action-icon-indigo {
  color: #4f46e5;
}

.state-dot-badge {
  position: absolute;
  top: 3px;
  right: 3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: #f59e0b;
}

@media (max-width: 768px) {
  .step-badge {
    display: none;
  }
}
</style>
