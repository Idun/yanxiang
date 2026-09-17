<script setup lang="ts">
import {
  BookOpen,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Command,
  MessageSquare,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-vue-next";
import AutoAIAssistPanel, { type AssistActionPayload } from "./AutoAIAssistPanel.vue";

export interface StoryElement {
  id: string;
  name: string;
  desc?: string;
}

export interface ModelOption {
  id: string;
  name: string;
}

export interface ModelGroup {
  provider: string;
  providerName: string;
  models: ModelOption[];
}

export interface PromptPreset {
  id: string;
  name: string;
  template: string;
}

interface Props {
  rightWidth: number;
  resizingSide: "left" | "right" | null;
  topicContent: string;
  customPrompt: string;
  showModelMenu: boolean;
  showWritingForm: boolean;
  selectedModelName: string;
  modelFilterKeyword: string;
  groupedModels: ModelGroup[];
  selectedGenModelId: string;
  showPromptPresetMenu: boolean;
  promptPresets: PromptPreset[];
  activeGenMode: "standard" | "speed" | "creative" | "custom";
  outputTargetType: "chapter" | "outline" | "worldbuilding";
  thinkLevel: "none" | "low" | "medium" | "high";
  thinkBudget: number;
  temperature: number;
  topP: number;
  isGenerating: boolean;
  hasOutput?: boolean;
  matchPersona?: boolean;
  strictPlot?: boolean;
  activeGeneratingAction: "normal" | "chapter_outline" | "dialogue_only" | null;

  visibleHooks: StoryElement[];
  hookCurrentPage: number;
  hookTotalPages: number;
  selectedHookCount: number;

  visibleDynamics: StoryElement[];
  dynamicCurrentPage: number;
  dynamicTotalPages: number;
  selectedDynamicCount: number;

  visibleClimaxes: StoryElement[];
  climaxCurrentPage: number;
  climaxTotalPages: number;
  selectedClimaxCount: number;

  selectedStoryIds: Set<string>;

  visibleOpenings: StoryElement[];
  openingCurrentPage: number;
  openingTotalPages: number;
  selectedOpeningCount: number;

  visibleTechniques: StoryElement[];
  techniqueCurrentPage: number;
  techniqueTotalPages: number;
  selectedTechniqueCount: number;

  visibleEndings: StoryElement[];
  endingCurrentPage: number;
  endingTotalPages: number;
  selectedEndingCount: number;

  selectedNarrativeIds: Set<string>;

  ncTipVisible: boolean;
  ncTipText: string;
  ncTipX: number;
  ncTipY: number;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:topicContent", val: string): void;
  (e: "update:customPrompt", val: string): void;
  (e: "update:modelFilterKeyword", val: string): void;
  (e: "update:activeGenMode", val: "standard" | "speed" | "creative" | "custom"): void;
  (e: "update:outputTargetType", val: "chapter" | "outline" | "worldbuilding"): void;
  (e: "update:thinkLevel", val: "none" | "low" | "medium" | "high"): void;
  (e: "update:thinkBudget", val: number): void;
  (e: "update:temperature", val: number): void;
  (e: "update:topP", val: number): void;
  (e: "toggleModelMenu"): void;
  (e: "selectModel", id: string): void;
  (e: "togglePromptPresetMenu"): void;
  (e: "applyPromptPreset", template: string): void;
  (e: "cycleHooks"): void;
  (e: "prevHooks"): void;
  (e: "cycleDynamics"): void;
  (e: "prevDynamics"): void;
  (e: "cycleClimaxes"): void;
  (e: "prevClimaxes"): void;
  (e: "toggleStory", id: string): void;
  (e: "cycleOpenings"): void;
  (e: "prevOpenings"): void;
  (e: "cycleTechniques"): void;
  (e: "prevTechniques"): void;
  (e: "cycleEndings"): void;
  (e: "prevEndings"): void;
  (e: "toggleNarrative", id: string): void;
  (e: "startGeneration"): void;
  (e: "stopGeneration"): void;
  (e: "startChapterOutlineGeneration"): void;
  (e: "startDialogueOnlyGeneration"): void;
  (e: "cancelSelections"): void;
  (e: "assistAction", payload: AssistActionPayload): void;
  (e: "checkWorldview"): void;
  (e: "update:matchPersona", val: boolean): void;
  (e: "update:strictPlot", val: boolean): void;
  (e: "startPanelResize", side: "left" | "right", evt: MouseEvent): void;
  (e: "resetPanelWidth", side: "left" | "right"): void;
}>();

function tagTooltip(desc?: string, name?: string): string {
  return desc && desc.trim().length > 0 ? desc : name || "";
}
</script>

<template>
  <div class="right-panel-wrapper">
    <!-- 右栏拖拽分隔线（双击复位默认宽度） -->
    <div
      class="panel-resizer"
      :class="{ dragging: props.resizingSide === 'right' }"
      title="拖拽调整右栏宽度（双击恢复默认）"
      @mousedown="emit('startPanelResize', 'right', $event)"
      @dblclick="emit('resetPanelWidth', 'right')"
    ></div>

    <!-- Right Panel: Controls & Options -->
    <aside
      class="right-panel"
      :style="{ width: props.rightWidth + 'px' }"
    >
      <div class="panel-inner space-y-4">
        <!-- 1. Auto Composer Box -->
        <section class="space-y-1.5">
          <label class="block-label">大纲或灵感</label>
          <div class="auto-composer-box">
            <textarea
              :value="props.topicContent"
              class="auto-composer-textarea"
              placeholder="输入故事梗概、分集细纲、关键转折或人物对白..."
              rows="4"
              @input="emit('update:topicContent', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
            <div class="auto-composer-tools">
              <div class="auto-composer-options-left">
                <!-- 模型切换 Popover -->
                <div class="popover-wrapper">
                  <button
                    class="icon-pill-btn"
                    :class="{ active: props.showModelMenu }"
                    type="button"
                    title="选择本轮写作模型"
                    @click.stop="emit('toggleModelMenu')"
                  >
                    <Bot :size="14" />
                  </button>
                  <div
                    v-if="props.showModelMenu"
                    class="popover-dropdown model-dropdown"
                    @click.stop
                  >
                    <div class="popover-title">选择当前模型</div>
                    <input
                      :value="props.modelFilterKeyword"
                      class="model-filter-input"
                      placeholder="搜索模型名称..."
                      type="text"
                      @click.stop
                      @input="emit('update:modelFilterKeyword', ($event.target as HTMLInputElement).value)"
                    />
                    <div class="model-options">
                      <div
                        v-if="props.groupedModels.length === 0"
                        class="model-empty"
                      >
                        无匹配模型
                      </div>
                      <div
                        v-for="grp in props.groupedModels"
                        :key="grp.provider"
                        class="model-group"
                      >
                        <div class="model-group-head">
                          <span class="model-group-dot"></span>
                          <span class="model-group-label">{{ grp.providerName }}</span>
                        </div>
                        <div
                          v-for="m in grp.models"
                          :key="m.id"
                          class="popover-option model-option-item"
                          :class="{ selected: props.selectedGenModelId === m.id }"
                          @click="emit('selectModel', m.id)"
                        >
                          <span class="model-option-name">{{ m.name }}</span>
                          <Check
                            v-if="props.selectedGenModelId === m.id"
                            :size="12"
                            class="model-option-check"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- 预设提示词快捷菜单 -->
                <div class="popover-wrapper">
                  <button
                    class="icon-pill-btn"
                    :class="{ active: props.showPromptPresetMenu }"
                    type="button"
                    title="选择内置提示词模版"
                    @click.stop="emit('togglePromptPresetMenu')"
                  >
                    <Command :size="13" />
                  </button>
                  <div
                    v-if="props.showPromptPresetMenu"
                    class="popover-dropdown"
                    @click.stop
                  >
                    <div class="popover-title">预设提示词模版</div>
                    <div class="popover-options">
                      <div
                        v-for="preset in props.promptPresets"
                        :key="preset.id"
                        class="popover-option"
                        @click="emit('applyPromptPreset', preset.template)"
                      >
                        <span>{{ preset.name }}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- 右侧展示当前使用的模型简短名称 -->
              <div class="auto-composer-status">
                <span class="model-current-hint" :title="props.selectedModelName">
                  {{ props.selectedModelName }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- 进入正文时（hasOutput || isGenerating）：显示截图中的辅助功能布局组件 -->
        <AutoAIAssistPanel
          v-if="props.hasOutput || props.isGenerating"
          :is-generating="props.isGenerating"
          :has-text="!!props.topicContent"
          :match-persona="props.matchPersona ?? true"
          :strict-plot="props.strictPlot ?? true"
          @assist-action="(payload) => emit('assistAction', payload)"
          @check-worldview="emit('checkWorldview')"
          @update:match-persona="(val) => emit('update:matchPersona', val)"
          @update:strict-plot="(val) => emit('update:strictPlot', val)"
        />

        <!-- 无正文时（创作设定阶段）：呈现写作模式与故事/叙事要素定制 -->
        <template v-else>
        <!-- 2. Generation Modes -->
        <section class="space-y-1.5 writing-mode-section">
          <label class="block-label">写作模式</label>
          <div class="metrics-row">
            <div class="metric-col">
              <label class="block-label-sm">模式</label>
              <select
                :value="props.activeGenMode"
                class="form-select select-with-arrow"
                @change="emit('update:activeGenMode', ($event.target as HTMLSelectElement).value as any)"
              >
                <option value="standard">标准模式</option>
                <option value="speed">极速模式</option>
                <option value="creative">创意发散</option>
                <option value="custom">深度定制</option>
              </select>
            </div>
            <div class="metric-col">
              <label class="block-label-sm">目标</label>
              <select
                :value="props.outputTargetType"
                class="form-select select-with-arrow"
                @change="emit('update:outputTargetType', ($event.target as HTMLSelectElement).value as any)"
              >
                <option value="chapter">正文章节</option>
                <option value="outline">大纲细化</option>
                <option value="worldbuilding">设定推演</option>
              </select>
            </div>
            <div class="metric-col">
              <label class="block-label-sm">思考深度</label>
              <select
                :value="props.thinkLevel"
                class="form-select select-with-arrow"
                @change="emit('update:thinkLevel', ($event.target as HTMLSelectElement).value as any)"
              >
                <option value="none">关闭思考</option>
                <option value="low">浅层 (1k)</option>
                <option value="medium">中度 (4k)</option>
                <option value="high">深度 (16k)</option>
              </select>
            </div>
          </div>
        </section>

        <!-- Advanced Custom Parameters (When in 'custom' mode) -->
        <section
          v-if="props.activeGenMode === 'custom'"
          class="space-y-3 pt-2 border-t border-[var(--outline-variant)]"
        >
          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="block-label-sm">
                Temperature ({{ props.temperature }})
              </label>
              <input
                :value="props.temperature"
                class="w-full"
                max="2"
                min="0"
                step="0.1"
                type="range"
                @input="emit('update:temperature', parseFloat(($event.target as HTMLInputElement).value))"
              />
            </div>
            <div>
              <label class="block-label-sm">Top-P ({{ props.topP }})</label>
              <input
                :value="props.topP"
                class="w-full"
                max="1"
                min="0"
                step="0.05"
                type="range"
                @input="emit('update:topP', parseFloat(($event.target as HTMLInputElement).value))"
              />
            </div>
          </div>
          <div>
            <label class="block-label-sm">自定义系统提示词</label>
            <textarea
              :value="props.customPrompt"
              class="form-textarea"
              placeholder="可留空，若填写将完全覆盖预设写作人设..."
              rows="3"
              @input="emit('update:customPrompt', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>
        </section>

        <template v-if="props.showWritingForm">
          <!-- 3. 故事要素库 (Hook, Dynamic, Climax) -->
          <section class="custom-group-box">
            <label class="block-label">故事要素</label>
            <!-- Sub-group S1: 开篇钩子 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">开篇钩子</span>
                  <span class="group-page-hint">({{ props.hookCurrentPage }}/{{ props.hookTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': props.selectedHookCount > 0 }"
                    :title="`已选择 ${props.selectedHookCount} 项`"
                  >
                    {{ props.selectedHookCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组开篇钩子"
                    @click="emit('prevHooks')"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组开篇钩子"
                    @click="emit('cycleHooks')"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组开篇钩子"
                    @click="emit('cycleHooks')"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="hook in props.visibleHooks"
                  :key="hook.id"
                  class="compact-tag-btn"
                  :class="{ active: props.selectedStoryIds.has(hook.id) }"
                  :title="tagTooltip(hook.desc, hook.name)"
                  type="button"
                  @click="emit('toggleStory', hook.id)"
                >
                  <Check v-if="props.selectedStoryIds.has(hook.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ hook.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group S2: 动态推演 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">动态推演</span>
                  <span class="group-page-hint">({{ props.dynamicCurrentPage }}/{{ props.dynamicTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': props.selectedDynamicCount > 0 }"
                    :title="`已选择 ${props.selectedDynamicCount} 项`"
                  >
                    {{ props.selectedDynamicCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组动态推演"
                    @click="emit('prevDynamics')"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组动态推演"
                    @click="emit('cycleDynamics')"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组动态推演"
                    @click="emit('cycleDynamics')"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="dyn in props.visibleDynamics"
                  :key="dyn.id"
                  class="compact-tag-btn"
                  :class="{ active: props.selectedStoryIds.has(dyn.id) }"
                  :title="tagTooltip(dyn.desc, dyn.name)"
                  type="button"
                  @click="emit('toggleStory', dyn.id)"
                >
                  <Check v-if="props.selectedStoryIds.has(dyn.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ dyn.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group S3: 核心高潮 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">核心高潮</span>
                  <span class="group-page-hint">({{ props.climaxCurrentPage }}/{{ props.climaxTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': props.selectedClimaxCount > 0 }"
                    :title="`已选择 ${props.selectedClimaxCount} 项`"
                  >
                    {{ props.selectedClimaxCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组核心高潮"
                    @click="emit('prevClimaxes')"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组核心高潮"
                    @click="emit('cycleClimaxes')"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组核心高潮"
                    @click="emit('cycleClimaxes')"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="clx in props.visibleClimaxes"
                  :key="clx.id"
                  class="compact-tag-btn"
                  :class="{ active: props.selectedStoryIds.has(clx.id) }"
                  :title="tagTooltip(clx.desc, clx.name)"
                  type="button"
                  @click="emit('toggleStory', clx.id)"
                >
                  <Check v-if="props.selectedStoryIds.has(clx.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ clx.name }}</span>
                </button>
              </div>
            </div>
          </section>

          <!-- 4. 叙事要素库 (Opening, Technique, Ending) -->
          <section class="custom-group-box">
            <label class="block-label">叙事手法</label>
            <!-- Sub-group C1: 叙事开篇 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">叙事开篇</span>
                  <span class="group-page-hint">({{ props.openingCurrentPage }}/{{ props.openingTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': props.selectedOpeningCount > 0 }"
                    :title="`已选择 ${props.selectedOpeningCount} 项`"
                  >
                    {{ props.selectedOpeningCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组叙事开篇"
                    @click="emit('prevOpenings')"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组叙事开篇"
                    @click="emit('cycleOpenings')"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组叙事开篇"
                    @click="emit('cycleOpenings')"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="nar in props.visibleOpenings"
                  :key="nar.id"
                  class="compact-tag-btn"
                  :class="{ active: props.selectedNarrativeIds.has(nar.id) }"
                  :title="tagTooltip(nar.desc, nar.name)"
                  type="button"
                  @click="emit('toggleNarrative', nar.id)"
                >
                  <Check v-if="props.selectedNarrativeIds.has(nar.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ nar.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group C2: 叙事手法 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">叙事手法</span>
                  <span class="group-page-hint">({{ props.techniqueCurrentPage }}/{{ props.techniqueTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': props.selectedTechniqueCount > 0 }"
                    :title="`已选择 ${props.selectedTechniqueCount} 项`"
                  >
                    {{ props.selectedTechniqueCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组叙事手法"
                    @click="emit('prevTechniques')"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组叙事手法"
                    @click="emit('cycleTechniques')"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组叙事手法"
                    @click="emit('cycleTechniques')"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="nar in props.visibleTechniques"
                  :key="nar.id"
                  class="compact-tag-btn"
                  :class="{ active: props.selectedNarrativeIds.has(nar.id) }"
                  :title="tagTooltip(nar.desc, nar.name)"
                  type="button"
                  @click="emit('toggleNarrative', nar.id)"
                >
                  <Check v-if="props.selectedNarrativeIds.has(nar.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ nar.name }}</span>
                </button>
              </div>
            </div>

            <!-- Sub-group C3: 结局结尾 -->
            <div class="sub-item-wrap">
              <div class="group-header">
                <div class="group-title-wrap">
                  <span class="sub-block-label">结局结尾</span>
                  <span class="group-page-hint">({{ props.endingCurrentPage }}/{{ props.endingTotalPages }})</span>
                </div>
                <div class="group-pager">
                  <span
                    class="group-selected-badge"
                    :class="{ 'has-selected': props.selectedEndingCount > 0 }"
                    :title="`已选择 ${props.selectedEndingCount} 项`"
                  >
                    {{ props.selectedEndingCount }}
                  </span>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="上一组结局结尾"
                    @click="emit('prevEndings')"
                  >
                    <ChevronLeft :size="13" />
                  </button>
                  <button
                    class="pager-icon-btn"
                    type="button"
                    title="下一组结局结尾"
                    @click="emit('cycleEndings')"
                  >
                    <ChevronRight :size="13" />
                  </button>
                  <button
                    class="cycle-btn"
                    type="button"
                    title="换下一组结局结尾"
                    @click="emit('cycleEndings')"
                  >
                    <RefreshCw :size="11" />
                    换一换
                  </button>
                </div>
              </div>
              <div class="tag-grid">
                <button
                  v-for="nar in props.visibleEndings"
                  :key="nar.id"
                  class="compact-tag-btn"
                  :class="{ active: props.selectedNarrativeIds.has(nar.id) }"
                  :title="tagTooltip(nar.desc, nar.name)"
                  type="button"
                  @click="emit('toggleNarrative', nar.id)"
                >
                  <Check v-if="props.selectedNarrativeIds.has(nar.id)" :size="11" class="check-icon" />
                  <span class="tag-name">{{ nar.name }}</span>
                </button>
              </div>
            </div>
          </section>
        </template>
        </template>

        <!-- 5. Primary & Secondary Actions -->
        <section
          class="action-buttons-section"
          :class="{ centered: !props.showWritingForm }"
        >
          <!-- 1. 开始处理 / 停止处理 -->
          <button
            v-if="!props.isGenerating"
            class="btn-primary flex items-center justify-center gap-2"
            :class="props.showWritingForm ? 'flex-1' : ''"
            type="button"
            @click="emit('startGeneration')"
          >
            <Sparkles :size="16" />
            {{ props.outputTargetType === 'outline' ? '生成大纲' : '开始处理' }}
          </button>
          <button
            v-else-if="props.activeGeneratingAction === 'normal'"
            class="btn-primary bg-amber-600 hover:bg-amber-700 flex items-center justify-center gap-2"
            :class="props.showWritingForm ? 'flex-1' : ''"
            type="button"
            title="中断当前生成"
            @click="emit('stopGeneration')"
          >
            <Square :size="16" />
            停止处理
          </button>
          <button
            v-else
            class="btn-primary opacity-50 cursor-not-allowed flex items-center justify-center gap-2"
            :class="props.showWritingForm ? 'flex-1' : ''"
            type="button"
            disabled
          >
            <Sparkles :size="16" />
            处理中
          </button>

          <!-- 2. 章纲生成 / 停止章纲生成 -->
          <button
            v-if="props.showWritingForm && (!props.isGenerating || props.activeGeneratingAction !== 'chapter_outline')"
            class="btn-outline-action flex items-center justify-center gap-1.5"
            type="button"
            title="按照章节细纲固定格式模板生成失衡叙事章纲"
            :disabled="props.isGenerating"
            @click="emit('startChapterOutlineGeneration')"
          >
            <BookOpen :size="15" />
            章纲生成
          </button>
          <button
            v-else-if="props.showWritingForm && props.isGenerating && props.activeGeneratingAction === 'chapter_outline'"
            class="btn-outline-action stopping-btn flex items-center justify-center gap-1.5"
            type="button"
            title="中断章纲生成"
            @click="emit('stopGeneration')"
          >
            <Square :size="15" />
            停止生成
          </button>

          <!-- 3. 对话话本 / 停止对话生成 -->
          <button
            v-if="props.showWritingForm && (!props.isGenerating || props.activeGeneratingAction !== 'dialogue_only')"
            class="btn-outline-action flex items-center justify-center gap-1.5"
            type="button"
            title="参考细纲或文档内容，只写剧本式对话框架"
            :disabled="props.isGenerating"
            @click="emit('startDialogueOnlyGeneration')"
          >
            <MessageSquare :size="15" />
            对话话本
          </button>
          <button
            v-else-if="props.showWritingForm && props.isGenerating && props.activeGeneratingAction === 'dialogue_only'"
            class="btn-outline-action stopping-btn flex items-center justify-center gap-1.5"
            type="button"
            title="中断对话框架生成"
            @click="emit('stopGeneration')"
          >
            <Square :size="15" />
            停止生成
          </button>

          <!-- 4. 取消 -->
          <button
            v-if="props.showWritingForm"
            class="btn-secondary"
            type="button"
            :disabled="props.isGenerating"
            title="重置素材库、故事与叙事的勾选项"
            @click="emit('cancelSelections')"
          >
            取消
          </button>
        </section>
      </div>
    </aside>

    <!-- "下一章" 禁用时的友好说明气泡（fixed 定位，跟随按钮锚点） -->
    <transition name="tooltip-fade">
      <div
        v-if="props.ncTipVisible"
        class="next-chapter-tooltip"
        :style="{ left: props.ncTipX + 'px', top: props.ncTipY + 'px' }"
      >
        {{ props.ncTipText }}
      </div>
    </transition>
  </div>
</template>

<style scoped>
.right-panel-wrapper {
  display: flex;
  height: 100%;
  position: relative;
}

.right-panel {
  flex-shrink: 0;
  background-color: var(--surface-bright);
  overflow-y: auto;
  padding: 14px 14px 20px;
  z-index: 10;
  border-left: 1px solid var(--outline-variant);
  height: 100%;
}

.panel-resizer {
  width: 4px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
  z-index: 10;
  flex-shrink: 0;
}

.panel-resizer:hover,
.panel-resizer.dragging {
  background: var(--primary);
}

.panel-inner {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  width: 100%;
}

.block-label {
  display: block;
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--on-surface);
}

.sub-block-label {
  font-size: 0.775rem;
  font-weight: 600;
  color: var(--on-surface-variant);
}

.block-label-sm {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin-bottom: 4px;
}

.form-textarea {
  width: 100%;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--on-surface);
  background-color: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  padding: 10px 12px;
  resize: vertical;
  outline: none;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}

.form-textarea:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb) / 0.15);
}

.form-select {
  width: 100%;
  appearance: none;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  border-radius: 10px;
  padding: 8px 12px;
  color: var(--on-surface);
  font-size: 0.875rem;
  outline: none;
  cursor: pointer;
  transition: border-color 0.18s ease;
}

.form-select:focus {
  border-color: var(--primary);
}

.select-with-arrow {
  padding-right: 30px;
  background-image: url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z' fill='%2366736c'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  background-size: 14px 14px;
}

.metrics-row {
  display: grid;
  grid-template-columns: 1fr 1fr 1.25fr;
  gap: 8px;
  align-items: flex-end;
}

.writing-mode-section {
  margin-top: 0;
  margin-bottom: 8px;
  position: relative;
  z-index: 2;
}

.metric-col {
  display: flex;
  flex-direction: column;
}

.custom-group-box {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sub-item-wrap {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.group-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.group-title-wrap {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-page-hint {
  font-size: 0.75rem;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.cycle-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75rem;
  color: var(--primary);
  padding: 2px 6px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.cycle-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.1);
}

.group-pager {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.group-selected-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9999px;
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
  color: var(--on-surface-variant);
  background-color: var(--surface-container-high);
  border: 1px solid var(--outline-variant);
  transition: all 0.18s ease;
  user-select: none;
  margin-right: 2px;
}

.group-selected-badge.has-selected {
  color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  border-color: rgba(var(--primary-rgb) / 0.35);
  font-weight: 800;
}

.pager-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.pager-icon-btn:hover {
  background-color: rgba(var(--primary-rgb) / 0.1);
  color: var(--primary);
}

.tag-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.compact-tag-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.775rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.compact-tag-btn:hover {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.05);
}

.compact-tag-btn.active {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.check-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.tag-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-buttons-section {
  padding-top: 14px;
  margin-top: 14px;
  border-top: 1px solid var(--outline-variant);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
}

.action-buttons-section.centered {
  justify-content: center;
}

.btn-primary {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  background-color: var(--primary);
  color: #ffffff;
  font-weight: 700;
  font-size: 0.825rem;
  border: none;
  cursor: pointer;
  transition: opacity 0.18s ease, transform 0.12s ease;
  box-shadow: var(--shadow);
  white-space: nowrap;
  flex: 1.15;
  min-width: 0;
}

.btn-primary:hover {
  opacity: 0.92;
}

.btn-primary:active {
  transform: scale(0.98);
}

.btn-secondary {
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-weight: 500;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.18s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.btn-secondary:hover {
  background-color: var(--surface-container-low);
}

.btn-outline-action {
  height: 38px;
  padding: 0 8px;
  border-radius: 8px;
  border: 1px solid var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
  color: var(--primary);
  font-weight: 700;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.18s ease;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.btn-outline-action:hover:not(:disabled) {
  background-color: rgba(var(--primary-rgb) / 0.16);
  transform: translateY(-1px);
}

.btn-outline-action:active:not(:disabled) {
  transform: scale(0.98);
}

.btn-outline-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
  transform: none;
}

.auto-composer-box {
  background-color: var(--surface-container-lowest, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 12px;
  padding: 10px 12px 8px;
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
  display: flex;
  flex-direction: column;
}

.auto-composer-box:focus-within {
  border-color: var(--primary);
  box-shadow: 0 0 0 2px rgba(var(--primary-rgb) / 0.15);
}

.auto-composer-textarea {
  width: 100%;
  border: none;
  background: transparent;
  outline: none;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--on-surface);
  resize: vertical;
  min-height: 120px;
  padding: 0;
  margin-bottom: 8px;
}

.auto-composer-tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 6px;
  border-top: 1px dashed var(--outline-variant);
}

.auto-composer-options-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.auto-composer-status {
  display: flex;
  align-items: center;
  max-width: 180px;
}

.model-current-hint {
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  background: rgba(var(--primary-rgb) / 0.08);
  padding: 2px 8px;
  border-radius: 9999px;
  border: 1px solid rgba(var(--primary-rgb) / 0.2);
}

.popover-wrapper {
  position: relative;
  display: inline-flex;
}

.icon-pill-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: var(--surface-container, #f3f4f6);
  border: 1px solid var(--outline-variant);
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.2s ease;
}

.icon-pill-btn:hover {
  background: var(--surface-container-high, #e5e7eb);
  color: var(--on-surface);
}

.icon-pill-btn.active {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.popover-dropdown {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  width: 210px;
  background: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: var(--shadow-lg, 0 10px 25px rgba(0, 0, 0, 0.12));
  padding: 8px;
  z-index: 100;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-dropdown {
  width: 240px;
}

.popover-title {
  font-size: 11px;
  font-weight: 700;
  color: var(--on-surface-variant);
  padding: 4px 6px;
  border-bottom: 1px solid var(--outline-variant);
  margin-bottom: 4px;
}

.popover-options {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 200px;
  overflow-y: auto;
}

.popover-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.15s ease;
}

.popover-option:hover {
  background: var(--surface-container-high, #f0f1f5);
  color: var(--on-surface);
}

.popover-option.selected {
  background: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
  font-weight: 600;
}

.model-filter-input {
  width: 100%;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-low, #f9fafb);
  color: var(--on-surface);
  font-size: 12px;
  outline: none;
  margin-bottom: 6px;
}

.model-filter-input:focus {
  border-color: var(--primary);
}

.model-options {
  max-height: 220px;
  overflow-y: auto;
}

.model-empty {
  font-size: 12px;
  color: var(--on-surface-variant);
  padding: 8px;
  text-align: center;
}

.model-group + .model-group {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid var(--outline-variant);
}

.model-group-head {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 2px;
}

.model-group-dot {
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: var(--primary);
}

.model-group-label {
  font-size: 10.5px;
  font-weight: 700;
  color: var(--on-surface-variant);
  text-transform: uppercase;
}

.model-option-item {
  font-size: 12px;
  padding: 5px 8px;
}

.model-option-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-option-check {
  color: var(--primary);
  flex-shrink: 0;
}

.next-chapter-tooltip {
  position: fixed;
  z-index: 99999;
  transform: translate(-50%, -100%);
  margin-top: -8px;
  padding: 6px 12px;
  border-radius: 8px;
  background-color: rgba(26, 28, 30, 0.94);
  color: #f1f3f4;
  font-size: 0.75rem;
  line-height: 1.4;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.22);
}

.next-chapter-tooltip::after {
  content: "";
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border-width: 5px;
  border-style: solid;
  border-color: rgba(26, 28, 30, 0.94) transparent transparent transparent;
}

.tooltip-fade-enter-active,
.tooltip-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.tooltip-fade-enter-from,
.tooltip-fade-leave-to {
  opacity: 0;
  transform: translate(-50%, calc(-100% + 4px));
}
</style>
