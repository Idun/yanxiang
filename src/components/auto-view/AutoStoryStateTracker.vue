<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  AlertCircle,
  Bookmark,
  Clock,
  Compass,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  Sparkles,
  Trash2,
  User,
  Users,
  X,
} from "lucide-vue-next";
import { startLongPressDrag } from "../../longPressDrag";
import { storyStateStore } from "./storyStateStore";

const props = defineProps<{
  currentDocTitle?: string;
  currentDocContent?: string;
}>();

defineEmits<{
  (e: "close"): void;
  (e: "inject-prompt", text: string): void;
}>();

type TrackerTab = "characters" | "foreshadowing" | "context" | "keypoints";
const activeTab = ref<TrackerTab>("characters");

// 新增角色表单
const showAddChar = ref(false);
const newCharName = ref("");
const newCharRole = ref("主角");
const newCharLevel = ref("");
const newCharEquip = ref("");
const newCharStatus = ref("");

function handleAddChar() {
  if (!newCharName.value.trim()) return;
  const equips = newCharEquip.value
    .split(/[,，、]/)
    .map((s) => s.trim())
    .filter(Boolean);
  storyStateStore.addCharacter({
    name: newCharName.value.trim(),
    role: newCharRole.value,
    level: newCharLevel.value.trim() || "初级",
    equipment: equips,
    status: newCharStatus.value.trim() || "正常",
  });
  newCharName.value = "";
  newCharLevel.value = "";
  newCharEquip.value = "";
  newCharStatus.value = "";
  showAddChar.value = false;
}

// 新增伏笔表单
const showAddFore = ref(false);
const newForeChapter = ref(props.currentDocTitle || "第1章");
const newForeContent = ref("");
const newForeNotes = ref("");

function handleAddFore() {
  if (!newForeContent.value.trim()) return;
  storyStateStore.addForeshadowing({
    chapter: newForeChapter.value.trim() || "本章",
    content: newForeContent.value.trim(),
    status: "planted",
    notes: newForeNotes.value.trim(),
  });
  newForeContent.value = "";
  newForeNotes.value = "";
  showAddFore.value = false;
}

// 新增关键要点/规则
const newKeyPointText = ref("");
function handleAddKeyPoint() {
  if (!newKeyPointText.value.trim()) return;
  storyStateStore.addKeyPoint(newKeyPointText.value);
  newKeyPointText.value = "";
}

const newWorldRuleText = ref("");
function handleAddWorldRule() {
  if (!newWorldRuleText.value.trim()) return;
  storyStateStore.addWorldRule(newWorldRuleText.value);
  newWorldRuleText.value = "";
}

// 自动从当前文档分析更新
const isExtracting = ref(false);
const extractFeedback = ref("");

function handleAutoExtract() {
  if (!props.currentDocContent || props.currentDocContent.trim().length < 30) {
    extractFeedback.value =
      "暂无可同步的剧情正文(审核意见、读者评估报告、大纲、细纲、话本等不作为提取来源)";
    setTimeout(() => (extractFeedback.value = ""), 3200);
    return;
  }
  isExtracting.value = true;
  storyStateStore.autoUpdateStoryStateFromChapter(
    props.currentDocContent,
    props.currentDocTitle || "当前章节"
  );
  setTimeout(() => {
    isExtracting.value = false;
    extractFeedback.value = `已从「${props.currentDocTitle || "当前章节"}」同步状态`;
    setTimeout(() => (extractFeedback.value = ""), 3000);
  }, 400);
}

const activeForeshadowCount = computed(() =>
  storyStateStore.ledger.foreshadowing.filter((f) => f.status !== "resolved").length
);

// 标签栏长按左右拖拽平移(窄面板下防止「场景局势 / 要点备忘」被挤出视野找不到)
const tabsBarRef = ref<HTMLElement | null>(null);
const isTabsBarDragging = ref(false);
const tabsBarCanScrollRight = ref(false);

function syncTabsBarOverflow() {
  const el = tabsBarRef.value;
  if (!el) {
    tabsBarCanScrollRight.value = false;
    return;
  }
  tabsBarCanScrollRight.value =
    el.scrollWidth - el.scrollLeft - el.clientWidth > 2;
}

function handleTabsBarScroll() {
  syncTabsBarOverflow();
}

function handleTabsBarDragStart(event: MouseEvent) {
  const el = tabsBarRef.value;
  if (!el || el.scrollWidth <= el.clientWidth + 1) return;

  const startLeft = el.scrollLeft;
  const startX = event.clientX;
  /* 长按静置 200ms 才武装拖拽,轻点仍是正常切换标签(见 longPressDrag)。 */
  startLongPressDrag({
    event,
    ghostLabel: "左右拖拽切换标签",
    ghostVariant: "row",
    onStart: () => {
      isTabsBarDragging.value = true;
      syncTabsBarOverflow();
    },
    onMove: (x) => {
      el.scrollLeft = startLeft - (x - startX);
    },
    onEnd: () => {
      isTabsBarDragging.value = false;
    },
  });
}

function handleTabsBarWheel(e: WheelEvent) {
  const el = tabsBarRef.value;
  if (!el || el.scrollWidth <= el.clientWidth + 1) return;
  const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
  if (Math.abs(delta) > 0) {
    el.scrollLeft += delta;
  }
}

let tabsBarResizeObserver: ResizeObserver | null = null;

onMounted(() => {
  syncTabsBarOverflow();
  const el = tabsBarRef.value;
  if (el && typeof ResizeObserver !== "undefined") {
    tabsBarResizeObserver = new ResizeObserver(syncTabsBarOverflow);
    tabsBarResizeObserver.observe(el);
    /* 标签数量变化会改变 scrollWidth 而不改变标签栏自身尺寸,同样需要重算。 */
    tabsBarResizeObserver.observe(el.firstElementChild ?? el);
  }
});

onBeforeUnmount(() => {
  tabsBarResizeObserver?.disconnect();
  tabsBarResizeObserver = null;
});

watch(activeTab, () => {
  requestAnimationFrame(syncTabsBarOverflow);
});

// 左右拖拽平移表单项与卡片逻辑
const isTabContentDragging = ref(false);
let startDragX = 0;
let startScrollLeft = 0;
let currentDragEl: HTMLElement | null = null;

function handleWheelScroll(e: WheelEvent) {
  const target = e.currentTarget as HTMLElement;
  if (!target) return;
  if (target.scrollWidth > target.clientWidth) {
    const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (Math.abs(delta) > 0) {
      target.scrollLeft += delta;
    }
  }
}

function handleDragScrollMouseDown(e: MouseEvent) {
  if (e.button !== 0) return;
  const target = e.currentTarget as HTMLElement;
  if (!target) return;
  const targetEl = e.target as HTMLElement;
  const targetTag = targetEl.tagName.toLowerCase();
  if (
    ["input", "textarea", "select", "button", "a", "option"].includes(targetTag) ||
    targetEl.closest("input, textarea, select, button, a, .fore-status-badge")
  ) {
    return;
  }

  isTabContentDragging.value = true;
  currentDragEl = target;
  startDragX = e.clientX;
  startScrollLeft = target.scrollLeft;
  document.body.style.userSelect = "none";
  document.body.style.cursor = "grabbing";

  const onMouseMove = (ev: MouseEvent) => {
    if (!isTabContentDragging.value || !currentDragEl) return;
    ev.preventDefault();
    const dx = ev.clientX - startDragX;
    currentDragEl.scrollLeft = startScrollLeft - dx;
  };

  const onMouseUp = () => {
    isTabContentDragging.value = false;
    currentDragEl = null;
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
  };

  window.addEventListener("mousemove", onMouseMove);
  window.addEventListener("mouseup", onMouseUp);
}
</script>

<template>
  <div class="story-tracker-root">
    <!-- 头部栏 -->
    <header class="tracker-header">
      <div class="tracker-header-left">
        <Shield :size="16" class="tracker-header-icon" />
        <span class="tracker-title">故事状态追踪表</span>
        <span class="tracker-pill-badge">分章防丢</span>
      </div>
      <div class="tracker-header-right">
        <button
          type="button"
          class="tracker-btn tracker-btn-outline"
          title="根据当前正文自动分析并提取等级突破、新得装备及伏笔"
          :disabled="isExtracting"
          @click="handleAutoExtract"
        >
          <RefreshCw :size="12" :class="{ 'spin-icon': isExtracting }" />
          <span>从正文更新</span>
        </button>
      </div>
    </header>

    <!-- 反馈提示条 -->
    <div v-if="extractFeedback" class="tracker-feedback-bar">
      {{ extractFeedback }}
    </div>

    <!-- 标签页导航(窄面板可长按左右拖拽平移,避免末尾标签被挤出视野) -->
    <div class="tracker-tabs-wrap">
      <div
        ref="tabsBarRef"
        class="tracker-tabs-bar"
        :class="{ 'is-dragging': isTabsBarDragging, 'can-scroll-right': tabsBarCanScrollRight }"
        @mousedown="handleTabsBarDragStart"
        @wheel="handleTabsBarWheel"
        @scroll="handleTabsBarScroll"
      >
      <button
        type="button"
        class="tracker-tab-btn"
        :class="{ active: activeTab === 'characters' }"
        @click="activeTab = 'characters'"
      >
        <Users :size="13" />
        <span>角色装备</span>
        <span class="tracker-tab-count">
          {{ storyStateStore.ledger.characters.length }}
        </span>
      </button>
      <button
        type="button"
        class="tracker-tab-btn"
        :class="{ active: activeTab === 'foreshadowing' }"
        @click="activeTab = 'foreshadowing'"
      >
        <Bookmark :size="13" />
        <span>伏笔线索</span>
        <span class="tracker-tab-count">
          {{ activeForeshadowCount }}
        </span>
      </button>
      <button
        type="button"
        class="tracker-tab-btn"
        :class="{ active: activeTab === 'context' }"
        @click="activeTab = 'context'"
      >
        <Compass :size="13" />
        <span>场景局势</span>
      </button>
      <button
        type="button"
        class="tracker-tab-btn"
        :class="{ active: activeTab === 'keypoints' }"
        @click="activeTab = 'keypoints'"
      >
        <AlertCircle :size="13" />
        <span>要点备忘</span>
        <span class="tracker-tab-count">
          {{ (storyStateStore.ledger.keyPoints?.length || 0) + (storyStateStore.ledger.context.worldRules?.length || 0) }}
        </span>
      </button>
      </div>
    </div>

    <!-- 标签页内容区 -->
    <div class="tracker-body">
      <!-- 1. 角色与装备等级 -->
      <section v-show="activeTab === 'characters'" class="tab-pane">
        <div class="section-title-bar">
          <span class="section-title">核心人物、当前等级/境界与持有道具</span>
          <div class="title-right-actions">
            <button
              v-if="!showAddChar"
              type="button"
              class="section-add-btn"
              @click="showAddChar = true"
            >
              <Plus :size="13" />
              <span>添加角色</span>
            </button>
          </div>
        </div>

        <!-- 添加角色表单 -->
        <div v-if="showAddChar" class="tracker-card add-form-card">
          <div class="form-title-bar">
            <span class="form-title">添加新角色</span>
            <button type="button" class="form-close-btn" @click="showAddChar = false">
              <X :size="14" />
            </button>
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">角色姓名</label>
              <input
                v-model="newCharName"
                type="text"
                placeholder="例如：林萧"
                class="form-input"
              />
            </div>
            <div class="form-group flex-1">
              <label class="form-label">角色定位</label>
              <select v-model="newCharRole" class="form-select">
                <option value="主角">主角</option>
                <option value="核心配角">核心配角</option>
                <option value="反派敌手">反派敌手</option>
                <option value="导师长辈">导师长辈</option>
                <option value="中立过客">中立过客</option>
              </select>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group flex-1">
              <label class="form-label">当前等级/境界</label>
              <input
                v-model="newCharLevel"
                type="text"
                placeholder="例如：筑基中期 / 剑宗真传"
                class="form-input"
              />
            </div>
            <div class="form-group flex-1">
              <label class="form-label">当前状态</label>
              <input
                v-model="newCharStatus"
                type="text"
                placeholder="例如：健康 / 经脉微损"
                class="form-input"
              />
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">持有装备/法宝（逗号分隔）</label>
            <input
              v-model="newCharEquip"
              type="text"
              placeholder="例如：青钢剑, 灵兽袋, 破界符"
              class="form-input"
            />
          </div>
          <div class="form-actions">
            <button
              type="button"
              class="tracker-btn tracker-btn-primary"
              @click="handleAddChar"
            >
              保存角色
            </button>
            <button
              type="button"
              class="tracker-btn tracker-btn-outline"
              @click="showAddChar = false"
            >
              取消
            </button>
          </div>
        </div>

        <div
          class="drag-scroll-zone"
          :class="{ 'is-dragging': isTabContentDragging }"
          @mousedown="handleDragScrollMouseDown"
          @wheel="handleWheelScroll"
        >
          <div class="drag-scroll-inner">
            <!-- 角色列表卡片 -->
            <div class="items-list">
              <div
                v-for="char in storyStateStore.ledger.characters"
                :key="char.id"
                class="tracker-card item-card"
              >
                <div class="card-head">
                  <div class="char-title-group">
                    <User :size="14" class="char-icon" />
                    <span class="char-name">{{ char.name }}</span>
                    <span class="char-role-badge">{{ char.role }}</span>
                    <span class="char-level-badge">{{ char.level }}</span>
                  </div>
                  <button
                    type="button"
                    class="card-delete-btn"
                    title="删除角色"
                    @click="storyStateStore.removeCharacter(char.id)"
                  >
                    <Trash2 :size="13" />
                  </button>
                </div>

                <div class="char-detail-row">
                  <span class="detail-label">持有装备/法宝：</span>
                  <div v-if="char.equipment && char.equipment.length > 0" class="tags-wrap">
                    <span
                      v-for="(eq, i) in char.equipment"
                      :key="i"
                      class="equipment-pill"
                    >
                      {{ eq }}
                    </span>
                  </div>
                  <span v-else class="text-placeholder">暂无特殊装备</span>
                </div>

                <div class="char-detail-row">
                  <span class="detail-label">状态：</span>
                  <span class="detail-value">{{ char.status || "正常" }}</span>
                </div>
              </div>

              <div
                v-if="storyStateStore.ledger.characters.length === 0"
                class="empty-box"
              >
                暂无角色状态记录，点击上方「添加角色」录入主角与核心人物。
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 2. 伏笔与暗线 -->
      <section v-show="activeTab === 'foreshadowing'" class="tab-pane">
        <div class="section-title-bar">
          <span class="section-title">伏笔暗线与回收追踪</span>
          <div class="title-right-actions">
            <button
              v-if="!showAddFore"
              type="button"
              class="section-add-btn"
              @click="showAddFore = true"
            >
              <Plus :size="13" />
              <span>埋设伏笔</span>
            </button>
          </div>
        </div>

        <!-- 新增伏笔表单 -->
        <div v-if="showAddFore" class="tracker-card add-form-card">
          <div class="form-title-bar">
            <span class="form-title">记录新伏笔</span>
            <button type="button" class="form-close-btn" @click="showAddFore = false">
              <X :size="14" />
            </button>
          </div>
          <div class="form-group">
            <label class="form-label">埋设章节/场景</label>
            <input
              v-model="newForeChapter"
              type="text"
              placeholder="例如：第1章 / 云雾谷"
              class="form-input"
            />
          </div>
          <div class="form-group">
            <label class="form-label">伏笔内容与暗示细节</label>
            <textarea
              v-model="newForeContent"
              rows="2"
              placeholder="例如：玉佩在触碰古鼎时闪过一道蓝光"
              class="form-textarea"
            />
          </div>
          <div class="form-group">
            <label class="form-label">预期推进或回收备忘</label>
            <input
              v-model="newForeNotes"
              type="text"
              placeholder="例如：预计第10章揭晓主角身世"
              class="form-input"
            />
          </div>
          <div class="form-actions">
            <button
              type="button"
              class="tracker-btn tracker-btn-primary"
              @click="handleAddFore"
            >
              保存伏笔
            </button>
            <button
              type="button"
              class="tracker-btn tracker-btn-outline"
              @click="showAddFore = false"
            >
              取消
            </button>
          </div>
        </div>

        <div
          class="drag-scroll-zone"
          :class="{ 'is-dragging': isTabContentDragging }"
          @mousedown="handleDragScrollMouseDown"
          @wheel="handleWheelScroll"
        >
          <div class="drag-scroll-inner">
            <!-- 伏笔列表 -->
            <div class="items-list">
              <div
                v-for="fore in storyStateStore.ledger.foreshadowing"
                :key="fore.id"
                class="tracker-card item-card"
              >
                <div class="card-head">
                  <div class="fore-head-left">
                    <span class="fore-chapter-badge">{{ fore.chapter }}</span>
                    <span
                      class="fore-status-badge"
                      :class="fore.status"
                      @click="
                        storyStateStore.updateForeshadowing(fore.id, {
                          status:
                            fore.status === 'planted'
                              ? 'progressing'
                              : fore.status === 'progressing'
                              ? 'resolved'
                              : 'planted',
                        })
                      "
                      :title="'点击切换状态：待推进 -> 推进中 -> 已回收'"
                    >
                      {{
                        fore.status === "planted"
                          ? "待推进"
                          : fore.status === "progressing"
                          ? "推进中"
                          : "已回收"
                      }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="card-delete-btn"
                    title="删除伏笔"
                    @click="storyStateStore.removeForeshadowing(fore.id)"
                  >
                    <Trash2 :size="13" />
                  </button>
                </div>
                <p class="fore-content-text">{{ fore.content }}</p>
                <div v-if="fore.notes" class="fore-note-row">
                  <span class="detail-label">备忘：</span>
                  <span class="detail-value">{{ fore.notes }}</span>
                </div>
              </div>

              <div
                v-if="storyStateStore.ledger.foreshadowing.length === 0"
                class="empty-box"
              >
                暂无伏笔记录，正文生成后将自动捕捉，也可手动在此登记。
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 3. 场景与即时局势 -->
      <section v-show="activeTab === 'context'" class="tab-pane">
        <div class="section-title-bar">
          <span class="section-title">当前时空场景与局势冲突</span>
        </div>

        <div class="fit-zone">
          <div class="drag-scroll-inner fit-width">
            <div class="tracker-card context-form-card">
              <div class="form-group">
                <label class="form-label flex-inline-label">
                  <MapPin :size="12" />
                  <span>当前所在地点/场景</span>
                </label>
                <input
                  v-model="storyStateStore.ledger.context.currentLocation"
                  type="text"
                  placeholder="例如：天剑峰·传功阁殿外广场"
                  class="form-input"
                />
              </div>

              <div class="form-group">
                <label class="form-label flex-inline-label">
                  <Clock :size="12" />
                  <span>当前时间/天气氛围</span>
                </label>
                <input
                  v-model="storyStateStore.ledger.context.timeProgress"
                  type="text"
                  placeholder="例如：黄昏日落，山风萧瑟"
                  class="form-input"
                />
              </div>

              <div class="form-group">
                <label class="form-label flex-inline-label">
                  <Sparkles :size="12" />
                  <span>当前局势与核心危机</span>
                </label>
                <textarea
                  v-model="storyStateStore.ledger.context.coreConflict"
                  rows="3"
                  placeholder="例如：宗门大比在即，敌对堂口执事前来刁难挑衅"
                  class="form-textarea"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- 4. 关键要点与世界观规则 -->
      <section v-show="activeTab === 'keypoints'" class="tab-pane">
        <div class="section-title-bar">
          <span class="section-title">世界观底线规则与约束要点</span>
        </div>

        <div class="fit-zone">
          <div class="drag-scroll-inner fit-width">
            <div class="add-inline-row">
              <input
                v-model="newWorldRuleText"
                type="text"
                placeholder="例如：灵石纯度不可人工合成"
                class="form-input"
                @keydown.enter.prevent="handleAddWorldRule"
              />
              <button
                type="button"
                class="tracker-btn tracker-btn-primary"
                @click="handleAddWorldRule"
              >
                添加规则
              </button>
            </div>
            <div class="rules-list">
              <div
                v-for="(rule, idx) in storyStateStore.ledger.context.worldRules"
                :key="idx"
                class="rule-item-row"
              >
                <span class="rule-bullet">•</span>
                <span class="rule-text">{{ rule }}</span>
                <button
                  type="button"
                  class="card-delete-btn"
                  title="删除"
                  @click="storyStateStore.removeWorldRule(idx)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>

            <div class="section-title-bar mt-4">
              <span class="section-title">核心剧情要点与约束</span>
            </div>
            <div class="add-inline-row">
              <input
                v-model="newKeyPointText"
                type="text"
                placeholder="例如：男主绝不当众暴露真实修为"
                class="form-input"
                @keydown.enter.prevent="handleAddKeyPoint"
              />
              <button
                type="button"
                class="tracker-btn tracker-btn-primary"
                @click="handleAddKeyPoint"
              >
                添加要点
              </button>
            </div>
            <div class="rules-list">
              <div
                v-for="(kp, idx) in storyStateStore.ledger.keyPoints"
                :key="idx"
                class="rule-item-row"
              >
                <span class="rule-bullet">•</span>
                <span class="rule-text">{{ kp }}</span>
                <button
                  type="button"
                  class="card-delete-btn"
                  title="删除"
                  @click="storyStateStore.removeKeyPoint(idx)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 底部状态说明与重置 -->
    <footer class="tracker-footer">
      <span class="footer-sync-info">
        最近同步：{{ storyStateStore.ledger.lastUpdatedChapter || "未同步" }}
      </span>
      <button
        type="button"
        class="footer-reset-btn"
        title="重置状态表为默认"
        @click="storyStateStore.reset()"
      >
        <RotateCcw :size="11" />
        <span>重置</span>
      </button>
    </footer>
  </div>
</template>

<style scoped>
.story-tracker-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background-color: var(--surface-bright, #ffffff);
  color: var(--on-surface, #1f2937);
  font-family: var(--app-font, inherit);
  overflow: hidden;
  box-sizing: border-box;
}

/* 头部栏 */
.tracker-header {
  padding: 8px 10px;
  border-bottom: 1px solid var(--outline-variant, #e5e7eb);
  background-color: var(--surface-container-low, #f9fafb);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.tracker-header-left {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.tracker-header-icon {
  color: var(--primary, #2563eb);
  flex-shrink: 0;
}

.tracker-title {
  font-size: 0.82rem;
  font-weight: 700;
  color: var(--on-surface, #111827);
  white-space: nowrap;
}

.tracker-pill-badge {
  font-size: 0.62rem;
  padding: 1px 6px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb, 59 130 246) / 0.12);
  color: var(--primary, #2563eb);
  font-weight: 600;
  white-space: nowrap;
}

.tracker-feedback-bar {
  padding: 6px 10px;
  font-size: 0.72rem;
  background-color: rgba(16, 185, 129, 0.12);
  color: #065f46;
  border-bottom: 1px solid rgba(16, 185, 129, 0.2);
  flex-shrink: 0;
  word-break: break-all;
}

/* 标签页导航 (自适应平滑横向滚动与紧凑拉伸) */
.tracker-tabs-wrap {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
  background-color: var(--surface-container-low, #f3f4f6);
  border-bottom: 1px solid var(--outline-variant, #e5e7eb);
  flex-shrink: 0;
  padding-right: 4px;
}

.tracker-tabs-bar {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 5px;
  background-color: transparent;
  overflow-x: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  cursor: grab;
}

.tracker-tabs-bar.is-dragging {
  cursor: grabbing;
}

/* 仅当右侧仍有未显示的标签时才在右缘渐隐提示;滚到末尾则渐隐消失 */
.tracker-tabs-bar.can-scroll-right {
  mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent 100%);
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 14px), transparent 100%);
}

.tracker-tabs-bar::-webkit-scrollbar {
  display: none;
}

.tracker-tab-btn {
  flex: 1 0 auto;
  min-width: max-content;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
  height: 25px;
  padding: 0 4px;
  border-radius: 6px;
  border: 1px solid transparent;
  background-color: transparent;
  color: var(--on-surface-variant, #6b7280);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tracker-tab-btn:hover {
  color: var(--on-surface, #111827);
  background-color: rgba(0, 0, 0, 0.04);
}

.tracker-tab-btn.active {
  background-color: var(--surface-bright, #ffffff);
  border-color: var(--outline-variant, #e5e7eb);
  color: var(--primary, #2563eb);
  font-weight: 700;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.tracker-tab-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 9999px;
  font-size: 0.62rem;
  background-color: rgba(var(--primary-rgb, 59 130 246) / 0.12);
  color: var(--primary, #2563eb);
}

/* 主内容区 */
.tracker-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 8px;
  min-height: 0;
  width: 100%;
  box-sizing: border-box;
}

.tab-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.section-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  flex-wrap: wrap;
}

.title-right-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.drag-scroll-zone {
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  cursor: grab;
  user-select: none;
  touch-action: pan-x pan-y;
  -webkit-overflow-scrolling: touch;
  padding-bottom: 6px;
  scrollbar-width: thin;
}

.drag-scroll-zone:active,
.drag-scroll-zone.is-dragging {
  cursor: grabbing;
}

.drag-scroll-zone::-webkit-scrollbar {
  height: 4px;
}

.drag-scroll-zone::-webkit-scrollbar-track {
  background: transparent;
}

.drag-scroll-zone::-webkit-scrollbar-thumb {
  background: var(--outline-variant, #d1d5db);
  border-radius: 4px;
}

.drag-scroll-zone::-webkit-scrollbar-thumb:hover {
  background: var(--outline, #9ca3af);
}

.drag-scroll-inner {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
  width: 100%;
  box-sizing: border-box;
}

/* 卡片列表(角色装备 / 伏笔线索)靠 380px 最小宽度触发横向拖拽平移,
   而同一区域内的新增表单保持随面板宽度自适应 —— 表单不被这个最小宽度撑开。 */
.items-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 380px;
  flex-shrink: 0;
}

/* 场景局势 / 要点备忘:表单不做横向溢出平移,输入框随面板宽度自适应 */
.fit-zone {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}

.fit-width {
  min-width: 0;
  width: 100%;
}

.section-title {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--on-surface, #1f2937);
  word-break: break-all;
}

.section-add-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px dashed var(--primary, #2563eb);
  background-color: transparent;
  color: var(--primary, #2563eb);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.section-add-btn:hover {
  background-color: rgba(var(--primary-rgb, 59 130 246) / 0.08);
}

/* 卡片样式 */
.tracker-card {
  background-color: var(--surface-container-lowest, #ffffff);
  border: 1px solid var(--outline-variant, #e5e7eb);
  border-radius: 8px;
  padding: 8px 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.02);
  box-sizing: border-box;
}

/* 新增表单卡片:随面板宽度自适应,窄面板时两列并排自动换成单列堆叠 */
.add-form-card {
  background-color: var(--surface-container-low, #f9fafb);
  border: 1px solid rgba(var(--primary-rgb, 59 130 246) / 0.3);
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
}

.form-title-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.form-title {
  font-size: 0.76rem;
  font-weight: 700;
  color: var(--primary, #2563eb);
}

.form-close-btn {
  border: none;
  background: transparent;
  color: var(--on-surface-variant, #9ca3af);
  cursor: pointer;
  padding: 2px;
}

.form-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.form-row > .form-group {
  flex: 1 1 130px;
  min-width: 0;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.flex-1 {
  flex: 1;
}

.form-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: var(--on-surface-variant, #6b7280);
}

.flex-inline-label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.form-input {
  width: 100%;
  height: 30px;
  padding: 0 8px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant, #d1d5db);
  background-color: var(--surface-bright, #ffffff);
  color: var(--on-surface, #111827);
  font-size: 0.76rem;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.form-input:focus {
  border-color: var(--primary, #2563eb);
}

.form-textarea {
  width: 100%;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant, #d1d5db);
  background-color: var(--surface-bright, #ffffff);
  color: var(--on-surface, #111827);
  font-size: 0.76rem;
  outline: none;
  font-family: inherit;
  resize: vertical;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.form-textarea:focus {
  border-color: var(--primary, #2563eb);
}

.form-select {
  width: 100%;
  height: 30px;
  padding: 0 6px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant, #d1d5db);
  background-color: var(--surface-bright, #ffffff);
  color: var(--on-surface, #111827);
  font-size: 0.76rem;
  outline: none;
  box-sizing: border-box;
}

.form-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

/* 按钮通用 */
.tracker-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 6px;
  font-size: 0.74rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.tracker-btn-primary {
  background-color: var(--primary, #2563eb);
  color: var(--on-primary, #ffffff);
  border: 1px solid var(--primary, #2563eb);
}

.tracker-btn-primary:hover {
  opacity: 0.92;
}

.tracker-btn-outline {
  background-color: var(--surface-bright, #ffffff);
  border: 1px solid var(--outline-variant, #d1d5db);
  color: var(--on-surface, #374151);
}

.tracker-btn-outline:hover {
  background-color: var(--surface-container-low, #f3f4f6);
}

/* 列表卡片 */
.item-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.char-title-group {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.char-icon {
  color: var(--primary, #2563eb);
}

.char-name {
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--on-surface, #111827);
}

.char-role-badge {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
  background-color: var(--surface-container-high, #e5e7eb);
  color: var(--on-surface-variant, #4b5563);
}

.char-level-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: rgba(var(--primary-rgb, 59 130 246) / 0.12);
  color: var(--primary, #2563eb);
  font-weight: 600;
}

.card-delete-btn {
  border: none;
  background: transparent;
  color: var(--on-surface-variant, #9ca3af);
  cursor: pointer;
  padding: 2px;
  transition: color 0.15s ease;
}

.card-delete-btn:hover {
  color: var(--error, #ef4444);
}

.char-detail-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.72rem;
  flex-wrap: wrap;
}

.detail-label {
  color: var(--on-surface-variant, #6b7280);
  font-weight: 500;
}

.detail-value {
  color: var(--on-surface, #111827);
}

.text-placeholder {
  color: var(--outline, #9ca3af);
  font-style: italic;
}

.tags-wrap {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}

.equipment-pill {
  font-size: 0.68rem;
  padding: 1px 6px;
  border-radius: 4px;
  background-color: var(--surface-container-low, #f3f4f6);
  border: 1px solid var(--outline-variant, #e5e7eb);
  color: var(--on-surface, #1f2937);
}

/* 伏笔卡片 */
.fore-head-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.fore-chapter-badge {
  font-size: 0.65rem;
  padding: 1px 5px;
  border-radius: 4px;
  background-color: var(--surface-container-high, #e5e7eb);
  color: var(--on-surface-variant, #4b5563);
}

.fore-status-badge {
  font-size: 0.65rem;
  padding: 1px 6px;
  border-radius: 4px;
  cursor: pointer;
  font-weight: 600;
  user-select: none;
}

.fore-status-badge.planted {
  background-color: rgba(245, 158, 11, 0.12);
  color: #b45309;
  border: 1px solid rgba(245, 158, 11, 0.3);
}

.fore-status-badge.progressing {
  background-color: rgba(59, 130, 246, 0.12);
  color: #1d4ed8;
  border: 1px solid rgba(59, 130, 246, 0.3);
}

.fore-status-badge.resolved {
  background-color: rgba(16, 185, 129, 0.12);
  color: #047857;
  border: 1px solid rgba(16, 185, 129, 0.3);
}

.fore-content-text {
  font-size: 0.76rem;
  line-height: 1.4;
  color: var(--on-surface, #111827);
  margin: 0;
  word-break: break-all;
}

.fore-note-row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.7rem;
  color: var(--on-surface-variant, #6b7280);
  word-break: break-all;
}

.empty-box {
  padding: 20px 12px;
  text-align: center;
  font-size: 0.72rem;
  color: var(--on-surface-variant, #9ca3af);
  border: 1px dashed var(--outline-variant, #d1d5db);
  border-radius: 8px;
  background-color: var(--surface-container-low, #f9fafb);
}

/* 场景卡片 */
.context-form-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 规则与要点 */
.add-inline-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.add-inline-row > .form-input {
  flex: 1 1 140px;
  min-width: 0;
}

.rules-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 4px;
}

.rule-item-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  background-color: var(--surface-container-low, #f9fafb);
  border: 1px solid var(--outline-variant, #e5e7eb);
  font-size: 0.74rem;
}

.rule-bullet {
  color: var(--primary, #2563eb);
  font-weight: bold;
}

.rule-text {
  flex: 1;
  color: var(--on-surface, #111827);
  word-break: break-all;
}

.mt-4 {
  margin-top: 14px;
}

/* 底部栏 */
.tracker-footer {
  padding: 8px 14px;
  border-top: 1px solid var(--outline-variant, #e5e7eb);
  background-color: var(--surface-container-low, #f9fafb);
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.72rem;
  color: var(--on-surface-variant, #6b7280);
  flex-shrink: 0;
}

.footer-reset-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant, #6b7280);
  cursor: pointer;
  font-size: 0.7rem;
  transition: color 0.15s ease;
}

.footer-reset-btn:hover {
  color: var(--error, #ef4444);
}

.spin-icon {
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
