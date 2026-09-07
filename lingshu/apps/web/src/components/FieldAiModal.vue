<script setup lang="ts">
import { NButton, NInput, NModal, NSwitch, useMessage } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'
import { api, streamChat } from '../api/client'
import {
  buildSendPayload,
  type AiField,
  type FieldAiConfig,
  type FieldContext,
} from '../lib/fieldAi'
import { loadThinkingPref, saveThinkingPref } from '../lib/thinking'
import type { Character, ChatMessage, NamedItem, Novel, Relationship } from '../types'

const props = defineProps<{
  show: boolean
  novelId: number
  config: FieldAiConfig | null
  novel: Novel | null
  fieldContext?: FieldContext | null
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  confirmed: []
}>()

const message = useMessage()
const messages = ref<ChatMessage[]>([])
const localNovel = ref<Novel | null>(null)
const localChars = ref<Character[]>([])
const localRels = ref<Relationship[]>([])
const localLocs = ref<NamedItem[]>([])
const localEvents = ref<NamedItem[]>([])
const thinking = ref(loadThinkingPref())
const reasoning = ref('')
const draft = ref('')
const sending = ref(false)
const streaming = ref('')
const stage = ref('')
const confirming = ref(false)
const opening = ref(false)
const optimizeMode = ref(false)
const abortRef = ref<AbortController | null>(null)
const scroller = ref<HTMLElement | null>(null)

const visible = computed({
  get: () => props.show,
  set: (v: boolean) => emit('update:show', v),
})

const field = computed<AiField | null>(() => props.config?.field ?? null)
const activeNovel = computed(() => localNovel.value || props.novel)

const activeContext = computed<FieldContext | null>(() => {
  const novel = activeNovel.value
  if (!novel) return null
  const base = props.fieldContext
  return {
    novel,
    characterCount: localChars.value.length || base?.characterCount || 0,
    hasOutlineStructure: base?.hasOutlineStructure ?? false,
    hasChapterBreakdown: base?.hasChapterBreakdown ?? false,
    characters: localChars.value.length ? localChars.value : base?.characters,
    relationships: localRels.value.length ? localRels.value : base?.relationships,
    locations: localLocs.value.length ? localLocs.value : base?.locations,
    events: localEvents.value.length ? localEvents.value : base?.events,
  }
})

const modeHint = computed(() => {
  if (!props.config) return ''
  if (optimizeMode.value) {
    return '当前为优化模式：发送后会按已有内容分析改进，可先补充你想改的点。'
  }
  return props.config.hint
})

const canConfirm = computed(() => {
  const n = activeNovel.value
  if (!n) return false
  if (n.has_pending) {
    const step = n.studio_step
    if (step === 'bible' && n.pending_kind !== 'bible') return false
    return true
  }
  if (!field.value) return false
  const last = [...messages.value].reverse().find((row) => row.role === 'assistant')
  if (!last) return false
  const text = last.content.trim()
  if (text.length < 40) return false
  if (field.value === 'bible') return /主角|配角|对手|角色/.test(text)
  return true
})

const confirmLabel = computed(() => {
  if (activeNovel.value?.confirm_label) return activeNovel.value.confirm_label
  if (field.value === 'bible') return '确认，写入角色'
  if (field.value === 'outline') return '确认，写入结构大纲'
  if (field.value === 'chapters') return '确认，生成章节目录'
  if (field.value === 'world') return '确认，写入世界观'
  if (field.value === 'power') return '确认，写入修炼体系'
  return '确认，写入作品信息'
})

const lastAssistantId = computed(() => {
  const last = [...messages.value].reverse().find((row) => row.role === 'assistant')
  return last?.id || 0
})

async function refreshMessages() {
  const state = await api.studioState(props.novelId)
  messages.value = state.messages
  localNovel.value = state.novel
  localChars.value = state.characters
  localRels.value = state.relationships
  localLocs.value = state.locations
  localEvents.value = state.events
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  return state.novel
}

async function openSession() {
  if (!props.config) return
  opening.value = true
  streaming.value = ''
  stage.value = ''
  try {
    await api.clearChat(props.novelId, props.config.field)
    const novel = await refreshMessages()
    const ctx: FieldContext = activeContext.value || {
      novel,
      characterCount: localChars.value.length,
      hasOutlineStructure: false,
      hasChapterBreakdown: false,
      characters: localChars.value,
      relationships: localRels.value,
    }
    optimizeMode.value = props.config.hasContent({ ...ctx, novel })
    draft.value = optimizeMode.value ? props.config.optimizePrompt : props.config.generatePrompt
  } catch (err) {
    message.error(err instanceof Error ? err.message : '打开 AI 失败')
  } finally {
    opening.value = false
  }
}

watch(thinking, (on) => saveThinkingPref(on))

watch(
  () => props.show,
  async (open) => {
    if (open && props.config) await openSession()
    if (!open) {
      abortRef.value?.abort()
      sending.value = false
      stage.value = ''
      streaming.value = ''
      reasoning.value = ''
      optimizeMode.value = false
    }
  },
)

async function send(text?: string, forceOptimize?: boolean) {
  const content = (text ?? draft.value).trim()
  if (!content || sending.value || !field.value) return
  const ctx = activeContext.value
  if (!ctx) return
  const useOptimize = forceOptimize ?? optimizeMode.value
  const apiContent = buildSendPayload(field.value, content, ctx, useOptimize)
  const displayContent = useOptimize
    ? `${content}\n\n（已附带当前字段内容，供分析优化）`
    : content

  draft.value = ''
  sending.value = true
  streaming.value = ''
  reasoning.value = ''
  stage.value = thinking.value
    ? '深度思考中…'
    : useOptimize
      ? '正在分析已有内容…'
      : '正在想…'
  const controller = new AbortController()
  abortRef.value = controller
  messages.value.push({
    id: Date.now(),
    novel_id: props.novelId,
    role: 'user',
    content: displayContent,
    created_at: new Date().toISOString(),
  })
  await nextTick()
  if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
  try {
    await streamChat(
      props.novelId,
      apiContent,
      (event) => {
        if (event.type === 'stage') stage.value = event.label || stage.value
        if (event.type === 'reasoning' && event.text) {
          reasoning.value = reasoning.value
            ? `${reasoning.value}\n\n——\n\n${event.text}`
            : event.text
        }
        if (event.type === 'token' && event.text) streaming.value += event.text
        if (event.type === 'error') message.error(event.message || '对话失败')
        if (event.type === 'saved' && event.novel) localNovel.value = event.novel as Novel
        if (scroller.value) scroller.value.scrollTop = scroller.value.scrollHeight
      },
      controller.signal,
      field.value,
      thinking.value,
    )
    await refreshMessages()
    streaming.value = ''
    reasoning.value = ''
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      message.error(err instanceof Error ? err.message : '对话失败')
    }
  } finally {
    sending.value = false
    stage.value = ''
    abortRef.value = null
  }
}

function stopChat() {
  abortRef.value?.abort()
}

async function confirmDraft() {
  if (confirming.value || sending.value) return
  confirming.value = true
  try {
    await api.confirmStudio(props.novelId)
    message.success('已写入对应信息')
    emit('confirmed')
    visible.value = false
  } catch (err) {
    message.error(err instanceof Error ? err.message : '确认失败')
  } finally {
    confirming.value = false
  }
}

async function removeMessage(msg: ChatMessage) {
  try {
    await api.deleteChatMessage(props.novelId, msg.id, field.value || undefined)
    await refreshMessages()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '删除失败')
  }
}

async function clearMessages() {
  if (!field.value) return
  try {
    await api.clearChat(props.novelId, field.value)
    await refreshMessages()
    message.success('对话已清空')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '清空失败')
  }
}
</script>

<template>
  <n-modal
    v-model:show="visible"
    preset="card"
    :title="config?.title || 'AI 助手'"
    :bordered="false"
    :style="{ width: 'min(720px, 94vw)' }"
    :segmented="{ content: true, footer: 'soft' }"
    :mask-closable="!sending && !confirming"
    :close-on-esc="!sending && !confirming"
  >
    <p class="hint">{{ modeHint }}</p>
    <div ref="scroller" class="msgs">
      <div v-if="opening" class="stage">正在准备上下文…</div>
      <div v-for="msg in messages" :key="msg.id" class="bubble" :class="msg.role">
        <span>{{ msg.content }}</span>
        <button class="del" type="button" title="删除这条" :disabled="sending" @click.stop="removeMessage(msg)">
          删除
        </button>
        <n-button
          v-if="canConfirm && msg.id === lastAssistantId && msg.role === 'assistant'"
          class="bubble-confirm"
          type="primary"
          size="small"
          :loading="confirming"
          :disabled="sending"
          @click="confirmDraft"
        >
          {{ confirmLabel }}
        </n-button>
      </div>
      <details v-if="reasoning" class="think-box" :open="sending">
        <summary>{{ sending ? '正在思考' : '思考过程' }}</summary>
        <pre>{{ reasoning }}</pre>
      </details>
      <div v-if="streaming" class="bubble assistant"><span>{{ streaming }}</span></div>
      <p v-if="stage && !streaming" class="stage">{{ stage }}</p>
    </div>

    <template #footer>
      <div class="composer">
        <div class="actions">
          <n-button
            v-if="canConfirm"
            type="primary"
            :loading="confirming"
            :disabled="sending"
            @click="confirmDraft"
          >
            {{ confirmLabel }}
          </n-button>
          <n-button
            v-if="config"
            size="small"
            :disabled="sending || opening"
            @click="send(config.optimizePrompt, true)"
          >
            再优化
          </n-button>
          <n-button
            v-if="config"
            size="small"
            :disabled="sending || opening"
            @click="send(config.generatePrompt, false)"
          >
            重新生成
          </n-button>
        </div>
        <n-input
          v-model:value="draft"
          type="textarea"
          :autosize="{ minRows: 2, maxRows: 5 }"
          :placeholder="
            optimizeMode
              ? '可补充想改的点，再点发送；AI 会基于当前内容分析优化。'
              : '可先改提示或补充要求，再点发送。'
          "
          :disabled="sending || opening"
          @keydown.enter.exact.prevent="send()"
        />
        <div class="send-row">
          <label class="think-switch" :title="thinking ? '先输出思维链再作答，更准，也会更慢' : '打开后按 DeepSeek 思考模式作答'">
            <n-switch v-model:value="thinking" size="small" :disabled="sending || opening" />
            <span>深度思考</span>
          </label>
          <n-button size="small" quaternary :disabled="sending || !messages.length" @click="clearMessages">
            清空对话
          </n-button>
          <n-button v-if="sending" @click="stopChat">停止</n-button>
          <n-button type="primary" :loading="sending" :disabled="opening" @click="send()">
            {{ optimizeMode ? '分析优化' : '发送' }}
          </n-button>
        </div>
      </div>
    </template>
  </n-modal>
</template>

<style scoped>
.hint {
  margin: 0 0 10px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}
.msgs {
  height: min(48vh, 420px);
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 4px 2px 8px;
}
.bubble {
  max-width: 92%;
  padding: 10px 48px 10px 12px;
  border-radius: 10px;
  white-space: pre-wrap;
  line-height: 1.65;
  font-size: 14px;
  position: relative;
}
.bubble .del {
  position: absolute;
  top: 6px;
  right: 6px;
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  cursor: pointer;
  opacity: 0.7;
}
.bubble .del:hover {
  color: var(--text);
  opacity: 1;
}
.bubble-confirm {
  display: block;
  margin-top: 10px;
}
.bubble.user {
  align-self: flex-end;
  background: #2a3a5c;
}
.bubble.assistant {
  align-self: flex-start;
  background: #12151c;
  border: 1px solid var(--line);
}
.stage {
  color: var(--muted);
  font-size: 12px;
  margin: 0;
}
.composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.send-row {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  align-items: center;
}
.think-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
}
.think-box {
  align-self: flex-start;
  max-width: 92%;
  padding: 8px 12px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  background: #10131a;
  color: var(--muted);
  font-size: 12px;
}
.think-box summary {
  cursor: pointer;
  color: var(--accent);
  font-size: 12px;
}
.think-box pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  line-height: 1.65;
  font-family: inherit;
  color: var(--muted);
}
</style>
