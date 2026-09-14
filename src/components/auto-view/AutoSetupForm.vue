<script setup lang="ts">
import { Check, FilePlus, History, Pencil, Plus, Sparkles, Wand2, X } from "lucide-vue-next";

export interface SetupOption {
  id: string;
  label: string;
}

interface Props {
  setupGenre: string;
  setupChannel: string;
  setupPerson: string;
  setupTense: string;
  setupTone: string;
  setupPace: string;
  setupConflict: string;
  setupFocus: string;
  setupSelectedCount: number;
  customSetupActive: Record<string, boolean>;
  customSetupValues: Record<string, string>;
  genreOptions: SetupOption[];
  channelOptions: SetupOption[];
  personOptions: SetupOption[];
  tenseOptions: SetupOption[];
  toneOptions: SetupOption[];
  paceOptions: SetupOption[];
  conflictOptions: SetupOption[];
  focusOptions: SetupOption[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "pickSetup", key: string, id: string): void;
  (e: "pickSetupPreset", key: string, id: string): void;
  (e: "toggleCustomSetup", key: string): void;
  (e: "customSetupInput", key: string): void;
  (e: "resetSetup"): void;
  (e: "goToHistoryPage"): void;
  (e: "startNewCreation"): void;
  (e: "createBlankDoc"): void;
}>();
</script>

<template>
  <div class="setup-panel">
    <div class="setup-container">
      <div class="setup-head">
        <div class="setup-title-wrap">
          <Wand2 :size="16" class="setup-icon" />
          <span class="setup-title">创作设定</span>
          <span v-if="props.setupSelectedCount > 0" class="setup-count">
            已选 {{ props.setupSelectedCount }} 项
          </span>
        </div>
        <div class="setup-head-actions">
          <button
            v-if="props.setupSelectedCount > 0"
            class="setup-reset-btn"
            type="button"
            @click="emit('resetSetup')"
          >
            <X :size="12" />
            清空设定
          </button>
          <button
            class="setup-blank-btn"
            type="button"
            title="创建一个完全空白的 WYSIWYG 编辑区，自由输入或粘贴文稿，直接进入文稿管理"
            @click="emit('createBlankDoc')"
          >
            <FilePlus :size="13" />
            新建空白
          </button>
          <button
            class="setup-new-btn"
            type="button"
            title="归档当前这一轮创作，立刻开始新一轮独立编排（历史都会保存）"
            @click="emit('startNewCreation')"
          >
            <Sparkles :size="13" />
            新建创作
          </button>
          <button
            class="setup-history-btn"
            type="button"
            title="查看全部上下文对话记录"
            @click="emit('goToHistoryPage')"
          >
            <History :size="13" />
            历史对话
          </button>
        </div>
      </div>

      <p class="setup-hint">
        选定后将与右侧「大纲或灵感」一并发送给 AI；点击「开始处理」本表单自动隐藏，切换为思考链与正文输出。全部为可选项，留空即按 AI 自行判断。
      </p>

      <div class="setup-groups">
        <!-- 题材 -->
        <section class="setup-group full-width">
          <div class="setup-group-label">题材类型</div>
          <div class="setup-options">
            <button
              v-for="opt in props.genreOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupGenre === opt.id && !props.customSetupActive.genre }"
              type="button"
              @click="emit('pickSetupPreset', 'genre', opt.id)"
            >
              <Check v-if="props.setupGenre === opt.id && !props.customSetupActive.genre" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
            <button
              class="setup-opt custom-opt"
              :class="{ active: props.customSetupActive.genre }"
              type="button"
              @click="emit('toggleCustomSetup', 'genre')"
            >
              <Pencil :size="11" />
              <span>自定义</span>
            </button>
          </div>
          <div v-if="props.customSetupActive.genre" class="setup-custom-wrap">
            <input
              v-model="props.customSetupValues.genre"
              class="setup-custom-input"
              type="text"
              placeholder="输入自定义题材，如：赛博修仙、克苏鲁武侠..."
              @input="emit('customSetupInput', 'genre')"
            />
          </div>
        </section>

        <!-- 频道定位 -->
        <section class="setup-group">
          <div class="setup-group-label">频道定位</div>
          <div class="setup-options">
            <button
              v-for="opt in props.channelOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupChannel === opt.id }"
              type="button"
              @click="emit('pickSetup', 'channel', opt.id)"
            >
              <Check v-if="props.setupChannel === opt.id" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
          </div>
        </section>

        <!-- 叙事人称 -->
        <section class="setup-group">
          <div class="setup-group-label">叙事人称</div>
          <div class="setup-options">
            <button
              v-for="opt in props.personOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupPerson === opt.id }"
              type="button"
              @click="emit('pickSetup', 'person', opt.id)"
            >
              <Check v-if="props.setupPerson === opt.id" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
          </div>
        </section>

        <!-- 整体基调 -->
        <section class="setup-group full-width">
          <div class="setup-group-label">整体基调</div>
          <div class="setup-options">
            <button
              v-for="opt in props.toneOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupTone === opt.id && !props.customSetupActive.tone }"
              type="button"
              @click="emit('pickSetupPreset', 'tone', opt.id)"
            >
              <Check v-if="props.setupTone === opt.id && !props.customSetupActive.tone" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
            <button
              class="setup-opt custom-opt"
              :class="{ active: props.customSetupActive.tone }"
              type="button"
              @click="emit('toggleCustomSetup', 'tone')"
            >
              <Pencil :size="11" />
              <span>自定义</span>
            </button>
          </div>
          <div v-if="props.customSetupActive.tone" class="setup-custom-wrap">
            <input
              v-model="props.customSetupValues.tone"
              class="setup-custom-input"
              type="text"
              placeholder="输入自定义基调，如：荒诞怪异、克制冷峻、黑色幽默..."
              @input="emit('customSetupInput', 'tone')"
            />
          </div>
        </section>

        <!-- 叙事时态 -->
        <section class="setup-group">
          <div class="setup-group-label">叙事时态</div>
          <div class="setup-options">
            <button
              v-for="opt in props.tenseOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupTense === opt.id }"
              type="button"
              @click="emit('pickSetup', 'tense', opt.id)"
            >
              <Check v-if="props.setupTense === opt.id" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
          </div>
        </section>

        <!-- 叙事节奏 -->
        <section class="setup-group">
          <div class="setup-group-label">叙事节奏</div>
          <div class="setup-options">
            <button
              v-for="opt in props.paceOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupPace === opt.id && !props.customSetupActive.pace }"
              type="button"
              @click="emit('pickSetupPreset', 'pace', opt.id)"
            >
              <Check v-if="props.setupPace === opt.id && !props.customSetupActive.pace" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
            <button
              class="setup-opt custom-opt"
              :class="{ active: props.customSetupActive.pace }"
              type="button"
              @click="emit('toggleCustomSetup', 'pace')"
            >
              <Pencil :size="11" />
              <span>自定义</span>
            </button>
          </div>
          <div v-if="props.customSetupActive.pace" class="setup-custom-wrap">
            <input
              v-model="props.customSetupValues.pace"
              class="setup-custom-input"
              type="text"
              placeholder="输入自定义节奏，如：层层紧逼、电影级快切..."
              @input="emit('customSetupInput', 'pace')"
            />
          </div>
        </section>

        <!-- 核心冲突 -->
        <section class="setup-group">
          <div class="setup-group-label">核心冲突</div>
          <div class="setup-options">
            <button
              v-for="opt in props.conflictOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupConflict === opt.id && !props.customSetupActive.conflict }"
              type="button"
              @click="emit('pickSetupPreset', 'conflict', opt.id)"
            >
              <Check v-if="props.setupConflict === opt.id && !props.customSetupActive.conflict" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
            <button
              class="setup-opt custom-opt"
              :class="{ active: props.customSetupActive.conflict }"
              type="button"
              @click="emit('toggleCustomSetup', 'conflict')"
            >
              <Pencil :size="11" />
              <span>自定义</span>
            </button>
          </div>
          <div v-if="props.customSetupActive.conflict" class="setup-custom-wrap">
            <input
              v-model="props.customSetupValues.conflict"
              class="setup-custom-input"
              type="text"
              placeholder="输入自定义核心冲突，如：阶层割裂与个人救赎..."
              @input="emit('customSetupInput', 'conflict')"
            />
          </div>
        </section>

        <!-- 侧重重心 -->
        <section class="setup-group">
          <div class="setup-group-label">侧重重心</div>
          <div class="setup-options">
            <button
              v-for="opt in props.focusOptions"
              :key="opt.id"
              class="setup-opt"
              :class="{ active: props.setupFocus === opt.id && !props.customSetupActive.focus }"
              type="button"
              @click="emit('pickSetupPreset', 'focus', opt.id)"
            >
              <Check v-if="props.setupFocus === opt.id && !props.customSetupActive.focus" :size="12" class="check-icon" />
              {{ opt.label }}
            </button>
            <button
              class="setup-opt custom-opt"
              :class="{ active: props.customSetupActive.focus }"
              type="button"
              @click="emit('toggleCustomSetup', 'focus')"
            >
              <Pencil :size="11" />
              <span>自定义</span>
            </button>
          </div>
          <div v-if="props.customSetupActive.focus" class="setup-custom-wrap">
            <input
              v-model="props.customSetupValues.focus"
              class="setup-custom-input"
              type="text"
              placeholder="输入自定义侧重重心，如：群像心理博弈、细节沉浸..."
              @input="emit('customSetupInput', 'focus')"
            />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.setup-panel {
  width: 100%;
  height: 100%;
  overflow-y: auto;
  padding: 20px 16px;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background-color: var(--surface-bright);
}

.setup-container {
  width: 100%;
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
  background-color: var(--surface-container-lowest, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 16px;
  padding: 22px 26px 28px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.03);
}

.setup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.setup-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setup-icon {
  color: var(--primary);
}

.setup-title {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--on-surface);
  letter-spacing: 0.01em;
}

.setup-count {
  font-size: 0.72rem;
  padding: 2px 9px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.setup-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 0.75rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-reset-btn:hover {
  border-color: var(--error, #ef4444);
  color: var(--error, #ef4444);
  background-color: rgba(239, 68, 68, 0.06);
}

.setup-head-actions {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.setup-blank-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(16, 185, 129, 0.45);
  background-color: rgba(16, 185, 129, 0.1);
  color: #059669;
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-blank-btn:hover {
  background-color: rgba(16, 185, 129, 0.2);
  box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
  border-color: #059669;
}

.setup-new-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid rgba(var(--primary-rgb) / 0.4);
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-new-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.2);
  box-shadow: 0 2px 8px rgba(var(--primary-rgb) / 0.2);
}

.setup-history-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low);
  color: var(--on-surface-variant);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.18s ease;
}

.setup-history-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
}

.setup-hint {
  font-size: 0.82rem;
  line-height: 1.6;
  color: var(--on-surface-variant);
  opacity: 0.85;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--outline-variant);
  margin: 0;
}

.setup-groups {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px 18px;
}

.setup-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background-color: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  padding: 16px 18px;
  transition: border-color 0.2s ease;
}

.setup-group:hover {
  border-color: rgba(var(--primary-rgb) / 0.35);
}

.setup-group.full-width {
  grid-column: 1 / -1;
}

.setup-group-label {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--on-surface);
  display: flex;
  align-items: center;
  gap: 6px;
}

.setup-options {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.setup-opt {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 6px 14px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.82rem;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transform-origin: center center;
  transition: transform 0.22s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.22s ease,
              border-color 0.2s ease,
              background-color 0.2s ease,
              color 0.2s ease;
}

.setup-opt:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.06);
  transform: translateY(-1px) scale(1.02);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
}

.setup-opt:active {
  transform: scale(0.96);
  transition-duration: 0.08s;
}

.setup-opt.active {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
  transform: scale(1.06);
  box-shadow: 0 4px 12px rgba(var(--primary-rgb) / 0.22);
  z-index: 2;
}

.setup-opt.active:hover {
  transform: translateY(-1px) scale(1.08);
  box-shadow: 0 6px 16px rgba(var(--primary-rgb) / 0.28);
}

.setup-opt.custom-opt {
  border-style: dashed;
}

.setup-custom-wrap {
  margin-top: 6px;
  width: 100%;
}

.setup-custom-input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 12px;
  border-radius: 8px;
  border: 1px solid var(--primary);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.82rem;
  outline: none;
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb) / 0.12);
  transition: border-color 0.2s, box-shadow 0.2s;
}

.setup-custom-input:focus {
  box-shadow: 0 0 0 3px rgba(var(--primary-rgb) / 0.24);
}

.check-icon {
  animation: setupCheckPop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes setupCheckPop {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
</style>
