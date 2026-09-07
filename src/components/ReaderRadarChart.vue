<script setup lang="ts">
import { computed } from "vue";
import type { ReaderScores } from "../prompts/readerAgent";

const props = defineProps<{
  scores: ReaderScores;
}>();

const labels: Record<keyof ReaderScores, string> = {
  attraction: "吸引",
  emotion: "共鸣",
  curiosity: "追更",
  payoff: "兑现",
};

const keys = computed<Array<keyof ReaderScores>>(() =>
  (["attraction", "emotion", "curiosity", "payoff"] as Array<keyof ReaderScores>).filter((k) => props.scores[k] > 0),
);

const size = 180;
const cx = size / 2;
const cy = size / 2;
const radius = 62;

function point(index: number, value: number) {
  const n = Math.max(keys.value.length, 3);
  const angle = (Math.PI * 2 * index) / n - Math.PI / 2;
  const r = (Math.max(0, Math.min(10, value)) / 10) * radius;
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
}

const polygon = computed(() =>
  keys.value.map((key, i) => point(i, props.scores[key]).join(",")).join(" "),
);

const axes = computed(() =>
  keys.value.map((key, i) => {
    const [x, y] = point(i, 10);
    const [lx, ly] = point(i, 12.4);
    return { key, x, y, lx, ly, label: labels[key] };
  }),
);
</script>

<template>
  <svg v-if="keys.length" class="reader-radar" :viewBox="`0 0 ${size} ${size}`" role="img" aria-label="读者评估雷达图">
    <polygon
      v-for="ring in [2, 4, 6, 8, 10]"
      :key="ring"
      :points="keys.map((_, i) => point(i, ring).join(',')).join(' ')"
      class="grid"
    />
    <line v-for="axis in axes" :key="axis.key" :x1="cx" :y1="cy" :x2="axis.x" :y2="axis.y" class="axis" />
    <polygon :points="polygon" class="area" />
    <text v-for="axis in axes" :key="axis.key + '-l'" :x="axis.lx" :y="axis.ly" class="label">
      {{ axis.label }} {{ props.scores[axis.key] }}
    </text>
  </svg>
</template>

<style scoped>
.reader-radar {
  width: 176px;
  height: 176px;
  flex-shrink: 0;
}
.grid,
.axis {
  fill: none;
  stroke: var(--line-strong, #d5d9e4);
  stroke-width: 1;
}
.area {
  fill: var(--accent-soft, rgba(67, 88, 140, 0.18));
  stroke: var(--accent, #43588c);
  stroke-width: 1.5;
}
.label {
  fill: var(--muted, #8a91a5);
  font-size: 10.5px;
  text-anchor: middle;
  dominant-baseline: middle;
}
</style>
