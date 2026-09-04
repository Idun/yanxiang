<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { RefreshCw, Trash2 } from "lucide-vue-next";
import {
  clearModificationHistory,
  insightStore,
  refreshInsights,
  relativeTime,
} from "../insightStore";
import { rebuildInsightVectorIndex } from "../vectorStore";

function switchTab(tab: "habits" | "history" | "profile") {
  insightStore.activeTab = tab;
}

function toggleSwitch(idx: number) {
  insightStore.habits.toggles[idx].on = !insightStore.habits.toggles[idx].on;
}

const refreshing = ref(false);

/** Re-derive everything from the current documents / cards / 精修 history. */
async function runRefresh() {
  refreshing.value = true;
  refreshInsights(true);
  rebuildInsightVectorIndex();
  /* Brief hold so the spinner is perceivable on tiny corpora. */
  await new Promise((r) => setTimeout(r, 260));
  refreshing.value = false;
}

const analysis = computed(() => insightStore.analysis);

const corpusSummary = computed(() => {
  const a = analysis.value;
  if (a.sampleCount === 0) return "尚未检测到可分析的文本";
  return `已分析 ${a.sampleCount} 份文本 · ${a.paragraphCount} 段 · ${a.sentenceCount} 句 · ${a.totalChars} 字`;
});

const lastRunLabel = computed(() =>
  analysis.value.lastRunAt ? relativeTime(analysis.value.lastRunAt) : "未运行",
);

const hasHabits = computed(
  () =>
    insightStore.habits.phrasing.length > 0 ||
    insightStore.habits.paragraph.length > 0 ||
    insightStore.habits.editing.length > 0,
);

const showAllHistory = ref(false);
const visibleHistory = computed(() =>
  showAllHistory.value ? insightStore.history.items : insightStore.history.items.slice(0, 12),
);

onMounted(() => {
  refreshInsights();
});
</script>

<template>
  <div class="insight-view">
    <div class="insight-panel">
      <div class="panel-tabs">
        <button
          class="panel-tab"
          :class="{ active: insightStore.activeTab === 'habits' }"
          @click="switchTab('habits')"
        >
          写作习惯
        </button>
        <button
          class="panel-tab"
          :class="{ active: insightStore.activeTab === 'history' }"
          @click="switchTab('history')"
        >
          修改记忆
        </button>
        <button
          class="panel-tab"
          :class="{ active: insightStore.activeTab === 'profile' }"
          @click="switchTab('profile')"
        >
          风格画像
        </button>

        <div class="panel-tab-spacer"></div>

        <div class="corpus-meta" :title="`上次分析：${lastRunLabel}`">{{ corpusSummary }}</div>
        <button class="refresh-btn" :class="{ spinning: refreshing }" title="重新分析真实文本" @click="runRefresh">
          <RefreshCw :size="14" :stroke-width="1.9" />
          重新分析
        </button>
      </div>

      <div class="panel-scroll">
        <!-- ========== 写作习惯 ========== -->
        <div v-show="insightStore.activeTab === 'habits'" class="panel-body">
          <div v-if="!hasHabits" class="insight-empty">
            <div class="insight-empty-title">还没有可提炼的写作习惯</div>
            <p>
              习惯完全由你的真实文本统计得出。请先在「文档」中写入内容（或把 AI 回复拖入「写作」画布形成卡片），
              累计约 8 句以上后点击右上角「重新分析」。
            </p>
            <p v-if="analysis.sampleCount > 0" class="insight-empty-hint">
              当前已收录 {{ analysis.sampleCount }} 份文本，共 {{ analysis.totalChars }} 字，样本量仍不足以给出可信结论。
            </p>
          </div>

          <template v-else>
            <section v-if="insightStore.habits.phrasing.length > 0" class="habit-section">
              <div class="section-title">
                <span class="section-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                </span>
                遣词造句偏好
              </div>

              <div
                v-for="item in insightStore.habits.phrasing"
                :key="item.id"
                class="habit-card"
              >
                <span class="habit-tag" :class="item.tagType">{{ item.tag }}</span>
                <div class="habit-desc">{{ item.desc }}</div>
                <div v-if="item.examples.length" class="habit-example">
                  <div v-for="(ex, i) in item.examples" :key="i">{{ ex }}</div>
                </div>
                <div class="habit-stats">
                  <span class="habit-strength">
                    习惯强度
                    <span class="strength-bar">
                      <span class="strength-fill" :style="{ width: item.strength + '%' }"></span>
                    </span>
                  </span>
                  <span v-if="item.confidence" class="habit-confidence">
                    置信度
                    <span class="confidence-dots">
                      <span
                        v-for="d in 5"
                        :key="d"
                        class="confidence-dot"
                        :class="{ filled: d <= (item.confidence ?? 0) }"
                      ></span>
                    </span>
                  </span>
                  <span v-if="item.sampleCount">来自 {{ item.sampleCount }} 个句子样本</span>
                  <span v-if="item.hitRate">命中率 {{ item.hitRate }}</span>
                </div>
              </div>
            </section>

            <section v-if="insightStore.habits.paragraph.length > 0" class="habit-section">
              <div class="section-title">
                <span class="section-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
                </span>
                段落结构偏好
              </div>

              <div
                v-for="item in insightStore.habits.paragraph"
                :key="item.id"
                class="habit-card"
              >
                <span class="habit-tag" :class="item.tagType">{{ item.tag }}</span>
                <div class="habit-desc">{{ item.desc }}</div>
                <div class="habit-stats">
                  <span class="habit-strength">
                    习惯强度
                    <span class="strength-bar">
                      <span class="strength-fill" :style="{ width: item.strength + '%' }"></span>
                    </span>
                  </span>
                  <span v-if="item.sampleCount">来自 {{ item.sampleCount }} 个段落样本</span>
                </div>
              </div>
            </section>

            <section v-if="insightStore.habits.editing.length > 0" class="habit-section">
              <div class="section-title">
                <span class="section-icon">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
                </span>
                修改倾向
              </div>

              <div
                v-for="item in insightStore.habits.editing"
                :key="item.id"
                class="habit-card"
              >
                <span class="habit-tag edit">{{ item.tag }}</span>
                <div class="habit-desc">{{ item.desc }}</div>
                <div v-if="item.examples.length" class="habit-example">
                  <div v-for="(ex, i) in item.examples" :key="i">{{ ex }}</div>
                </div>
                <div class="habit-stats">
                  <span v-if="item.sampleCount">基于 {{ item.sampleCount }} 次真实改写</span>
                </div>
              </div>
            </section>
          </template>

          <section class="habit-section">
            <div class="section-title">
              <span class="section-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              </span>
              习惯应用设置
            </div>

            <div
              v-for="(tog, i) in insightStore.habits.toggles"
              :key="i"
              class="habit-toggle"
            >
              <div class="toggle-info">
                <span class="toggle-label">{{ tog.label }}</span>
                <span class="toggle-desc">{{ tog.desc }}</span>
              </div>
              <div
                class="toggle-switch"
                :class="{ on: tog.on }"
                @click="toggleSwitch(i)"
              ></div>
            </div>
          </section>
        </div>

        <!-- ========== 修改记忆 ========== -->
        <div v-show="insightStore.activeTab === 'history'" class="panel-body">
          <div class="section-header">
            <h3>近期修改记录</h3>
            <span v-if="insightStore.history.items.length > 12" class="see-all" @click="showAllHistory = !showAllHistory">
              {{ showAllHistory ? "收起" : `查看全部 (${insightStore.history.items.length})` }}
            </span>
            <button
              v-if="insightStore.history.items.length > 0"
              class="clear-history-btn"
              title="清空修改记忆"
              @click="clearModificationHistory()"
            >
              <Trash2 :size="13" :stroke-width="1.9" />
            </button>
          </div>

          <div v-if="insightStore.history.items.length === 0" class="insight-empty">
            <div class="insight-empty-title">暂无修改记录</div>
            <p>
              这里只记录真实发生过的改写：运行「精修」后每个被改动的句子会自动入库，
              在编辑器中采纳 AI 润色/续写也会记录下来。
            </p>
          </div>

          <div
            v-for="item in visibleHistory"
            :key="item.id"
            class="history-item"
          >
            <div class="history-header">
              <span class="history-type" :style="{ color: item.typeColor }">{{ item.typeLabel }}</span>
              <span v-if="item.source" class="history-source">{{ item.source === 'refine' ? '精修' : item.source === 'ai' ? 'AI' : '编辑器' }}</span>
              <span class="history-time">{{ relativeTime(item.at) }}</span>
            </div>
            <div class="history-before">{{ item.before }}</div>
            <div v-if="item.after" class="history-arrow">替换为</div>
            <div v-if="item.after" class="history-after">{{ item.after }}</div>
            <div v-if="item.note" class="history-note">{{ item.note }}</div>
          </div>

          <template v-if="insightStore.history.stats.length > 0">
            <div class="section-header" style="margin-top: 24px">
              <h3>修改模式统计</h3>
            </div>
            <div class="stat-grid">
              <div
                v-for="(stat, i) in insightStore.history.stats"
                :key="i"
                class="stat-card"
              >
                <div class="stat-value">{{ stat.count }}</div>
                <div class="stat-label">{{ stat.label }}</div>
              </div>
            </div>
          </template>
        </div>

        <!-- ========== 风格画像 ========== -->
        <div v-show="insightStore.activeTab === 'profile'" class="panel-body">
          <div v-if="!analysis.hasData" class="insight-empty">
            <div class="insight-empty-title">风格画像尚未生成</div>
            <p>
              光谱、高频用词与段落数据全部由真实文本统计得出，需要至少 8 个句子的语料。
              写入内容后点击右上角「重新分析」即可生成。
            </p>
          </div>

          <template v-else>
            <div class="profile-card">
              <h4>你的写作风格光谱</h4>

              <div
                v-for="(meter, i) in insightStore.profile.meters"
                :key="i"
                class="style-meter"
              >
                <div class="meter-label">
                  <span>{{ meter.label }}</span>
                  <span>{{ meter.value }}</span>
                </div>
                <div class="meter-track">
                  <div
                    class="meter-fill"
                    :style="{
                      width: meter.fillPercent + '%',
                      background: 'linear-gradient(90deg, ' + meter.fillGradient + ')',
                    }"
                  ></div>
                </div>
                <div class="meter-ends">
                  <span>{{ meter.leftLabel }}</span>
                  <span>{{ meter.rightLabel }}</span>
                </div>
              </div>
            </div>

            <div class="section-header">
              <h3>高频用词</h3>
            </div>
            <div v-if="insightStore.profile.highFreq.length > 0" class="word-cloud">
              <span
                v-for="(w, i) in insightStore.profile.highFreq"
                :key="i"
                class="word-chip"
                :class="'freq-' + w.freq"
              >{{ w.word }}</span>
            </div>
            <div v-else class="inline-empty">语料量还不足以稳定统计出高频表达</div>

            <div class="section-header" style="margin-top: 16px">
              <h3>回避用词</h3>
            </div>
            <div v-if="insightStore.profile.avoided.length > 0" class="word-cloud word-cloud-avoided">
              <span
                v-for="(w, i) in insightStore.profile.avoided"
                :key="i"
                class="word-chip word-chip-avoided"
              >{{ w.word }}</span>
            </div>
            <div v-else class="inline-empty">
              回避用词来自「精修」中被你反复删掉的表达，跑过几轮精修后会自动出现
            </div>

            <div class="section-header" style="margin-top: 16px">
              <h3>段落数据</h3>
            </div>
            <div class="stat-grid">
              <div
                v-for="(pref, i) in insightStore.profile.prefs"
                :key="i"
                class="stat-card"
              >
                <div class="stat-value" :style="{ color: pref.color }">{{ pref.value }}</div>
                <div class="stat-label">{{ pref.label }}</div>
              </div>
            </div>

            <template v-if="insightStore.profile.tags.length > 0">
              <div class="section-header" style="margin-top: 16px">
                <h3>风格参照</h3>
              </div>
              <div class="reference-card">
                <div class="habit-desc">依据统计结果，你的写作风格呈现以下特征：</div>
                <div class="tag-group">
                  <span
                    v-for="(tag, i) in insightStore.profile.tags"
                    :key="i"
                    class="ref-tag"
                  >{{ tag }}</span>
                </div>
              </div>
            </template>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.insight-view {
  flex: 1;
  height: 100%;
  display: flex;
  background: var(--surface-container-low);
  overflow: hidden;
}

.insight-panel {
  width: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border-left: 1px solid var(--outline-variant);
  overflow: hidden;
}

.panel-tabs {
  display: flex;
  align-items: center;
  border-bottom: 1px solid var(--outline-variant);
  flex-shrink: 0;
  background: var(--surface-bright);
  padding-right: 12px;
  gap: 8px;
}

.panel-tab-spacer {
  flex: 0 0 4px;
}

.corpus-meta {
  flex-shrink: 1;
  min-width: 0;
  font-size: 11px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.refresh-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
  padding: 5px 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-family: inherit;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
}

.refresh-btn:hover {
  background: var(--primary-fixed-dim, #dfe3ef);
  border-color: var(--primary);
  color: var(--primary);
}

.refresh-btn.spinning svg {
  animation: insightSpin 0.8s linear infinite;
}

@keyframes insightSpin {
  to { transform: rotate(360deg); }
}

/* ---- empty states ---- */

.insight-empty {
  padding: 22px 20px;
  margin-bottom: 18px;
  border: 1px dashed var(--outline-variant);
  border-radius: 10px;
  background: var(--surface-container-lowest);
  color: var(--on-surface-variant);
}

.insight-empty-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  margin-bottom: 8px;
}

.insight-empty p {
  margin: 0 0 6px;
  font-size: 12px;
  line-height: 1.7;
}

.insight-empty-hint {
  color: var(--primary);
}

.inline-empty {
  padding: 10px 12px;
  border-radius: 8px;
  background: var(--surface-container-lowest);
  border: 1px dashed var(--outline-variant);
  font-size: 11px;
  line-height: 1.6;
  color: var(--on-surface-variant);
}

.history-source {
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--surface-container-high);
  font-size: 10px;
  color: var(--on-surface-variant);
}

.clear-history-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin-left: 8px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.clear-history-btn:hover {
  background: var(--surface-container-high);
  color: var(--error);
}

.panel-tab {
  flex: 1;
  padding: 14px 8px;
  font-size: 12px;
  font-weight: 600;
  text-align: center;
  color: var(--on-surface-variant);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  transition: all 0.2s;
  letter-spacing: 0.02em;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  font-family: inherit;
}

.panel-tab:hover {
  color: var(--on-surface);
  background: var(--surface-container-low);
}

.panel-tab.active {
  color: var(--primary);
  border-bottom-color: var(--primary);
}

.panel-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 0;
}

/* Section headers */
.section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--on-surface-variant);
  margin-bottom: 10px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.section-icon {
  display: inline-flex;
  color: var(--primary);
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.section-header h3 {
  font-size: 13px;
  font-weight: 600;
  color: var(--on-surface);
  margin: 0;
}

.see-all {
  font-size: 11px;
  color: var(--primary);
  cursor: pointer;
}

.see-all:hover {
  text-decoration: underline;
}

/* Habit cards */
.habit-section {
  margin-bottom: 20px;
}

.habit-card {
  background: var(--surface-container);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 8px;
  border: 1px solid transparent;
  transition: all 0.2s;
}

.habit-card:hover {
  border-color: var(--outline-variant);
}

.habit-tag {
  display: inline-flex;
  height: 22px;
  padding: 0 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  align-items: center;
  margin-bottom: 8px;
}

.habit-tag.style {
  background: var(--primary-fixed-dim);
  color: var(--primary);
}
.habit-tag.word {
  background: var(--primary-fixed-dim);
  color: var(--primary);
}
.habit-tag.structure {
  background: #d1fae5;
  color: #065f46;
}
.habit-tag.tone {
  background: #fed7aa;
  color: #9a3412;
}
.habit-tag.edit {
  background: var(--error-container);
  color: var(--error);
}

.habit-desc {
  font-size: 12px;
  line-height: 1.7;
  color: var(--on-surface-variant);
}

.habit-example {
  margin-top: 8px;
  padding: 8px 10px;
  background: var(--surface-container-low);
  border-radius: 6px;
  font-size: 12px;
  color: var(--on-surface-variant);
  line-height: 1.6;
  border-left: 2px solid var(--primary);
}

.habit-stats {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 11px;
  color: var(--on-surface-variant);
  flex-wrap: wrap;
}

.habit-strength {
  display: flex;
  align-items: center;
  gap: 4px;
}

.strength-bar {
  width: 48px;
  height: 4px;
  border-radius: 2px;
  background: var(--surface-container-low);
  overflow: hidden;
}

.strength-fill {
  height: 100%;
  border-radius: 2px;
  background: var(--primary);
  transition: width 0.4s ease;
}

.habit-confidence {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 10px;
  color: var(--on-surface-variant);
}

.confidence-dots {
  display: flex;
  gap: 2px;
}

.confidence-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--outline-variant);
}

.confidence-dot.filled {
  background: var(--primary);
}

/* Toggle switches */
.habit-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: var(--surface-container);
  border-radius: 10px;
  margin-bottom: 8px;
}

.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

.toggle-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--on-surface);
}

.toggle-desc {
  font-size: 10px;
  color: var(--on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toggle-switch {
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: var(--outline-variant);
  cursor: pointer;
  position: relative;
  transition: background 0.2s;
  flex-shrink: 0;
  margin-left: 12px;
}

.toggle-switch.on {
  background: var(--primary);
}

.toggle-switch::after {
  content: '';
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  position: absolute;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
  box-shadow: 0 1px 2px rgba(0,0,0,0.15);
}

.toggle-switch.on::after {
  transform: translateX(16px);
}

/* History items */
.history-item {
  padding: 12px 14px;
  background: var(--surface-container);
  border-radius: 10px;
  margin-bottom: 8px;
}

.history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.history-type {
  font-size: 11px;
  font-weight: 600;
}

.history-time {
  font-size: 10px;
  color: var(--on-surface-variant);
}

.history-before {
  font-size: 12px;
  color: var(--error);
  text-decoration: line-through;
  margin-bottom: 4px;
  padding: 4px 8px;
  background: var(--error-container);
  border-radius: 4px;
  line-height: 1.6;
}

.history-after {
  font-size: 12px;
  color: #065f46;
  padding: 4px 8px;
  background: #d1fae5;
  border-radius: 4px;
  line-height: 1.6;
}

.history-arrow {
  text-align: center;
  color: var(--on-surface-variant);
  font-size: 10px;
  padding: 2px 0;
}

.history-note {
  margin-top: 6px;
  font-size: 11px;
  color: var(--on-surface-variant);
  padding: 4px 8px;
  background: var(--surface-container-low);
  border-radius: 4px;
  line-height: 1.5;
}

/* Stats grid */
.stat-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
  margin-bottom: 16px;
}

.stat-card {
  background: var(--surface-container);
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  color: var(--on-surface);
  margin-bottom: 4px;
}

.stat-label {
  font-size: 10px;
  color: var(--on-surface-variant);
}

/* Style profile */
.profile-card {
  background: var(--surface-container);
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 16px;
}

.profile-card h4 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 14px;
  color: var(--on-surface);
  margin-top: 0;
}

.style-meter {
  margin-bottom: 12px;
}

.meter-label {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--on-surface-variant);
  margin-bottom: 6px;
}

.meter-track {
  height: 6px;
  border-radius: 3px;
  background: var(--surface-container-low);
  position: relative;
  overflow: hidden;
}

.meter-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.6s ease;
}

.meter-ends {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: var(--on-surface-variant);
  margin-top: 4px;
}

/* Word cloud */
.word-cloud {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 12px;
  background: var(--surface-container);
  border-radius: 10px;
  margin-bottom: 12px;
}

.word-cloud-avoided {
  border-left: 2px solid var(--error);
}

.word-chip {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--surface-container-low);
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
  transition: all 0.15s;
}

.word-chip.freq-high {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary);
  background: var(--primary-fixed-dim);
  border-color: transparent;
}

.word-chip.freq-mid {
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
}

.word-chip-avoided {
  text-decoration: line-through;
  color: var(--error);
  border-color: var(--error-container);
  background: var(--error-container);
}

/* Reference card */
.reference-card {
  background: var(--surface-container);
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 16px;
}

.tag-group {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ref-tag {
  padding: 4px 10px;
  border-radius: 6px;
  font-size: 12px;
  background: var(--surface-container-low);
  color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
  font-weight: 500;
}

/* Scrollbar */
.panel-scroll::-webkit-scrollbar {
  width: 5px;
}

.panel-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.panel-scroll::-webkit-scrollbar-thumb {
  background: var(--outline-variant);
  border-radius: 3px;
}

.panel-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--outline);
}
</style>