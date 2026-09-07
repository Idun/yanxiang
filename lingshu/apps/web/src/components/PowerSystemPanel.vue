<script setup lang="ts">
import { NButton, NInput } from 'naive-ui'
import { computed, ref, watch } from 'vue'
import {
  extractProtagonistStatus,
  extractRealmChain,
  parsePowerSystem,
  splitLabeled,
  splitPromotion,
  stringifyPowerSystem,
} from '../lib/powerSystem'

const props = defineProps<{
  modelValue: string
  compact?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const editing = ref(false)
const draft = ref(props.modelValue || '')

watch(
  () => props.modelValue,
  (value) => {
    draft.value = value || ''
  },
)

const parsed = computed(() => parsePowerSystem(props.modelValue || ''))
const chain = computed(() => (parsed.value ? extractRealmChain(parsed.value) : []))
const now = computed(() => (parsed.value ? extractProtagonistStatus(parsed.value) : null))
const rules = computed(() => {
  if (!parsed.value) return []
  return parsed.value.hard_rules
    .filter((rule) => !/主角/.test(rule))
    .map((rule) => splitLabeled(rule))
})

function onDraft() {
  emit('update:modelValue', draft.value)
}

function startEdit() {
  draft.value = props.modelValue || ''
  editing.value = true
}

function prettyAndClose() {
  const data = parsePowerSystem(draft.value)
  if (data) {
    draft.value = stringifyPowerSystem(data)
    emit('update:modelValue', draft.value)
  } else {
    emit('update:modelValue', draft.value)
  }
  editing.value = false
}
</script>

<template>
  <div class="power" :class="{ compact }">
    <div v-if="!editing && parsed" class="view">
      <div class="toolbar">
        <span class="hint">按篇章查阅，写章时对照境界与硬规则</span>
        <n-button size="tiny" quaternary @click="startEdit">编辑原文</n-button>
      </div>

      <div v-if="now" class="now">
        <span class="now-k">{{ now.title }}</span>
        <strong>{{ now.body }}</strong>
      </div>

      <p v-if="parsed.intro" class="intro">{{ parsed.intro }}</p>

      <div v-if="chain.length" class="ladder">
        <span class="ladder-label">境界</span>
        <ol>
          <li v-for="(realm, idx) in chain" :key="realm">
            <em>{{ realm }}</em>
            <i v-if="idx < chain.length - 1" aria-hidden="true">→</i>
          </li>
        </ol>
      </div>

      <article v-for="(stage, idx) in parsed.stages" :key="stage.stage + idx" class="card">
        <header>
          <span class="idx">{{ String(idx + 1).padStart(2, '0') }}</span>
          <div class="title">
            <strong>{{ stage.stage }}</strong>
            <small v-if="stage.level">{{ stage.level }}</small>
          </div>
        </header>
        <div v-if="stage.realms.length" class="chips">
          <span v-for="realm in stage.realms" :key="realm">{{ realm }}</span>
        </div>
        <p v-if="stage.core" class="core"><span>核心</span>{{ stage.core }}</p>
        <ul v-if="stage.promotion" class="promo">
          <li v-for="(row, pidx) in splitPromotion(stage.promotion)" :key="pidx" :class="{ plain: !row.title }">
            <b v-if="row.title">{{ row.title }}</b>
            <span>{{ row.body }}</span>
          </li>
        </ul>
        <p v-if="stage.notes" class="notes">{{ stage.notes }}</p>
      </article>

      <section v-if="rules.length" class="rules">
        <h4>硬规则</h4>
        <ol>
          <li v-for="(rule, idx) in rules" :key="idx">
            <b v-if="rule.title">{{ rule.title }}</b>
            <span>{{ rule.body }}</span>
          </li>
        </ol>
      </section>
    </div>
    <div v-else class="edit">
      <div class="toolbar">
        <span class="hint">{{ parsed ? '改完后会重新排成卡片' : '支持 JSON 或 Python 字典，保存后会排成卡片' }}</span>
        <n-button v-if="parsed || (draft && draft.trim())" size="tiny" type="primary" secondary @click="prettyAndClose">
          完成编辑
        </n-button>
      </div>
      <n-input
        v-model:value="draft"
        type="textarea"
        :autosize="compact ? { minRows: 10, maxRows: 18 } : { minRows: 14, maxRows: 24 }"
        placeholder="从低到高等级、晋升条件、主角当前境界。也可用 AI 生成结构化体系。"
        @update:value="onDraft"
      />
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
}
.hint {
  color: var(--muted);
  font-size: 12px;
}
.now {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  padding: 10px 12px;
  border: 1px solid rgba(122, 162, 255, 0.45);
  border-radius: 10px;
  background: linear-gradient(180deg, rgba(122, 162, 255, 0.16), rgba(122, 162, 255, 0.04));
}
.now-k {
  color: var(--accent);
  font-size: 11px;
  letter-spacing: 0.08em;
}
.now strong {
  color: var(--text);
  font-size: 13px;
  font-weight: 600;
  line-height: 1.55;
}
.intro {
  margin: 0 0 12px;
  color: var(--text);
  font-size: 13px;
  line-height: 1.75;
}
.ladder {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  margin-bottom: 14px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #12151c;
}
.ladder-label {
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--muted);
  font-size: 11px;
  letter-spacing: 0.12em;
}
.ladder ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 0;
  margin: 0;
  padding: 0;
  list-style: none;
}
.ladder li {
  display: inline-flex;
  align-items: center;
  color: var(--muted);
  font-size: 12px;
}
.ladder em {
  font-style: normal;
  color: var(--accent);
  font-weight: 600;
}
.ladder i {
  font-style: normal;
  opacity: 0.45;
  padding: 0 6px;
}
.card {
  margin-bottom: 10px;
  padding: 12px 14px 12px 12px;
  border: 1px solid var(--line);
  border-left: 3px solid var(--accent);
  border-radius: 10px;
  background: #12151c;
}
.card header {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}
.idx {
  flex-shrink: 0;
  color: var(--accent);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.8;
  padding-top: 2px;
}
.title {
  display: flex;
  flex: 1;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}
.card header strong {
  color: var(--text);
  font-size: 14px;
}
.card header small {
  color: var(--accent);
  font-size: 12px;
  white-space: nowrap;
}
.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}
.chips span {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(122, 162, 255, 0.14);
  color: var(--accent);
  font-size: 12px;
}
.core,
.notes {
  margin: 0 0 8px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.core span {
  display: inline-block;
  margin-right: 8px;
  padding: 0 6px;
  border-radius: 4px;
  background: rgba(122, 162, 255, 0.12);
  color: var(--accent);
  font-size: 11px;
}
.notes {
  margin-bottom: 0;
  padding-top: 6px;
  border-top: 1px dashed var(--line);
}
.promo {
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
  color: var(--text);
  font-size: 12px;
  line-height: 1.7;
}
.promo li {
  display: grid;
  grid-template-columns: 4.5em 1fr;
  gap: 8px;
  padding: 4px 0;
}
.promo li:not(:last-child) {
  border-bottom: 1px solid rgba(42, 48, 64, 0.8);
}
.promo li.plain {
  grid-template-columns: 1fr;
}
.promo b {
  color: var(--accent);
  font-weight: 600;
}
.promo li span {
  color: var(--text);
}
.rules {
  margin-top: 6px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #12151c;
}
.rules h4 {
  margin: 0 0 8px;
  color: var(--text);
  font-size: 13px;
}
.rules ol {
  margin: 0;
  padding-left: 18px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.rules li + li {
  margin-top: 6px;
}
.rules b {
  color: var(--text);
  margin-right: 6px;
  font-weight: 600;
}
.compact .card,
.compact .rules,
.compact .ladder,
.compact .now {
  padding: 8px 10px;
}
.compact .intro,
.compact .promo,
.compact .notes {
  font-size: 12px;
}
.compact .promo li {
  grid-template-columns: 1fr;
  gap: 2px;
}
</style>
