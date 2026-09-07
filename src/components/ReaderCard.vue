<script setup lang="ts">
import type { ReaderEvaluationResult, ReaderScores } from "../prompts/readerAgent";
import ReaderRadarChart from "./ReaderRadarChart.vue";

defineProps<{
  result: ReaderEvaluationResult;
}>();

const SCORE_LABELS: Record<keyof ReaderScores, string> = {
  attraction: "吸引",
  emotion: "共鸣",
  curiosity: "追更",
  payoff: "兑现",
};

const SCORE_KEYS = ["attraction", "emotion", "curiosity", "payoff"] as const;

function scoreLabel(key: keyof ReaderScores): string {
  return SCORE_LABELS[key] ?? key;
}
</script>

<template>
  <div class="reader-card">
    <div class="reader-card-head">
      <span class="reader-card-title">读者视角评估</span>
      <span class="reader-overall" :class="result.overall >= 7 ? 'good' : result.overall >= 5 ? 'mid' : 'bad'">
        {{ result.overall.toFixed(1) }} 分
      </span>
      <span class="reader-continue" :class="result.would_continue ? 'yes' : 'no'">
        {{ result.would_continue ? "会继续追" : "可能弃文" }}
      </span>
    </div>

    <div class="reader-card-body">
      <ReaderRadarChart :scores="result.scores" />
      <div class="reader-card-side">
        <p v-if="result.one_liner" class="reader-one-liner">{{ result.one_liner }}</p>
        <div class="reader-score-grid">
          <div
            v-for="(key) in SCORE_KEYS"
            :key="key"
            class="reader-score-item"
          >
            <span class="reader-score-label">{{ scoreLabel(key) }}</span>
            <span class="reader-score-value">{{ result.scores[key] }}</span>
          </div>
        </div>
      </div>
    </div>

    <div class="reader-card-lists">
      <div v-if="result.praise.length > 0" class="reader-list praise">
        <div class="reader-list-title">亮点</div>
        <ul>
          <li v-for="(p, i) in result.praise" :key="'p' + i">{{ p }}</li>
        </ul>
      </div>
      <div v-if="result.complaints.length > 0" class="reader-list complaint">
        <div class="reader-list-title">吐槽 / 毒点</div>
        <ul>
          <li v-for="(c, i) in result.complaints" :key="'c' + i">{{ c }}</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.reader-card {
  border: 1px solid var(--line-strong, #d5d9e4);
  border-radius: 10px;
  background: var(--bg-soft, rgba(255, 255, 255, 0.6));
  padding: 12px 14px;
  margin: 4px 0 12px;
}
.reader-card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.reader-card-title {
  font-size: 12px;
  color: var(--muted, #8a91a5);
  letter-spacing: 1px;
}
.reader-overall {
  font-size: 13px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 999px;
}
.reader-overall.good {
  color: #0b7a3b;
  background: rgba(11, 122, 59, 0.12);
}
.reader-overall.mid {
  color: #8a5b00;
  background: rgba(190, 130, 20, 0.14);
}
.reader-overall.bad {
  color: #b02020;
  background: rgba(176, 32, 32, 0.12);
}
.reader-continue {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
}
.reader-continue.yes {
  color: #0b7a3b;
  background: rgba(11, 122, 59, 0.1);
}
.reader-continue.no {
  color: #b02020;
  background: rgba(176, 32, 32, 0.1);
}
.reader-card-body {
  display: flex;
  gap: 12px;
  align-items: center;
}
.reader-card-side {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.reader-one-liner {
  font-size: 13px;
  color: var(--text, #2b3245);
  line-height: 1.5;
  margin: 0;
}
.reader-score-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 4px;
}
.reader-score-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.035);
}
.reader-score-label {
  color: var(--muted, #8a91a5);
}
.reader-score-value {
  font-weight: 700;
  color: var(--text, #2b3245);
}
.reader-card-lists {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.reader-list-title {
  font-size: 11px;
  color: var(--muted, #8a91a5);
  margin-bottom: 2px;
}
.reader-list ul {
  margin: 0;
  padding-left: 18px;
}
.reader-list li {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--text, #2b3245);
  margin-bottom: 2px;
}
.reader-list.complaint li {
  color: #b02020;
}
</style>
