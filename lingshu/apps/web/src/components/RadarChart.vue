<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  scores: Record<string, number>
  labels?: Record<string, string>
}>()

const defaultLabels: Record<string, string> = {
  consistency: '连贯',
  character: '人设',
  pacing: '节奏',
  hook: '钩子',
  dialogue: '对话',
  ai_flavor: '去味',
  attraction: '吸引',
  emotion: '共鸣',
  curiosity: '追更',
  payoff: '兑现',
}

const keys = computed(() => Object.keys(props.scores || {}))
const size = 180
const cx = size / 2
const cy = size / 2
const radius = 62

function point(index: number, value: number) {
  const n = Math.max(keys.value.length, 3)
  const angle = (Math.PI * 2 * index) / n - Math.PI / 2
  const r = (Math.max(0, Math.min(10, value)) / 10) * radius
  return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)]
}

const polygon = computed(() =>
  keys.value
    .map((key, i) => point(i, props.scores[key] || 0).join(','))
    .join(' '),
)

const axes = computed(() =>
  keys.value.map((key, i) => {
    const [x, y] = point(i, 10)
    const [lx, ly] = point(i, 12.4)
    return { key, x, y, lx, ly, label: props.labels?.[key] || defaultLabels[key] || key }
  }),
)
</script>

<template>
  <svg v-if="keys.length" class="radar" :viewBox="`0 0 ${size} ${size}`" role="img">
    <polygon
      v-for="ring in [2, 4, 6, 8, 10]"
      :key="ring"
      :points="keys.map((_, i) => point(i, ring).join(',')).join(' ')"
      class="grid"
    />
    <line v-for="axis in axes" :key="axis.key" :x1="cx" :y1="cy" :x2="axis.x" :y2="axis.y" class="axis" />
    <polygon :points="polygon" class="area" />
    <text v-for="axis in axes" :key="axis.key + '-l'" :x="axis.lx" :y="axis.ly" class="label">{{ axis.label }}</text>
  </svg>
</template>

<style scoped>
.radar {
  width: 180px;
  height: 180px;
}
.grid,
.axis {
  fill: none;
  stroke: #2a3040;
  stroke-width: 1;
}
.area {
  fill: rgba(122, 162, 255, 0.28);
  stroke: #7aa2ff;
  stroke-width: 1.5;
}
.label {
  fill: #8b95a8;
  font-size: 10px;
  text-anchor: middle;
  dominant-baseline: middle;
}
</style>
