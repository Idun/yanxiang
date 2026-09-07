<script setup lang="ts">
import { useDialog, useMessage } from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { chapterHeading, chapterPrefix, customChapterTitle } from '../lib/outline'
import type { Chapter, Novel } from '../types'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const novelId = computed(() => Number(route.params.id))

const novel = ref<Novel | null>(null)
const chapters = ref<Chapter[]>([])
const current = ref<Chapter | null>(null)
const night = ref(false)
const fontSize = ref(18)
const catalogOpen = ref(false)
const error = ref('')
const editing = ref(false)
const saving = ref(false)
const draftTitle = ref('')
const draftContent = ref('')
const editorRef = ref<HTMLTextAreaElement | null>(null)

const isLocked = computed(
  () => (current.value?.lock_status || 'in_progress') === 'locked',
)
const dirty = computed(() => {
  if (!current.value) return false
  const titleChanged =
    customChapterTitle(current.value.number, draftTitle.value) !==
    customChapterTitle(current.value.number, current.value.title)
  const bodyChanged = editing.value && draftContent.value !== (current.value.content || '')
  return titleChanged || bodyChanged
})
const draftWords = computed(() => draftContent.value.replace(/\s/g, '').length)

const readable = computed(() => chapters.value.filter((c) => (c.content || '').trim()))
const paragraphs = computed(() =>
  (current.value?.content || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean),
)
const progress = computed(() => {
  if (!readable.value.length || !current.value) return '0/0'
  const idx = readable.value.findIndex((c) => c.id === current.value?.id)
  return `${Math.max(idx, 0) + 1}/${readable.value.length}`
})

function applyChapter(chapter: Chapter) {
  current.value = chapter
  editing.value = false
  draftTitle.value = customChapterTitle(chapter.number, chapter.title)
  draftContent.value = chapter.content || ''
}

async function confirmLeaveEdit() {
  if (!dirty.value) return true
  return await new Promise<boolean>((resolve) => {
    let settled = false
    const done = (value: boolean) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.warning({
      title: '有未保存的修改',
      content: '离开后预览里改过的内容会丢掉。要先保存吗？',
      positiveText: '保存并离开',
      negativeText: '不保存',
      onPositiveClick: async () => {
        const ok = await saveChapter()
        done(ok)
        if (!ok) return false
      },
      onNegativeClick: () => done(true),
      onClose: () => done(false),
    })
  })
}

async function openChapter(chapter: Chapter) {
  if (chapter.id === current.value?.id) {
    catalogOpen.value = false
    return
  }
  if (!(await confirmLeaveEdit())) return
  applyChapter(chapter)
  catalogOpen.value = false
  router.replace({
    params: { ...route.params, chapterId: String(chapter.id) },
    query: { ...route.query },
  })
  const scroller = document.querySelector('.paper')
  if (scroller) scroller.scrollTop = 0
}

async function step(delta: number) {
  if (!current.value || !readable.value.length) return
  const idx = readable.value.findIndex((c) => c.id === current.value?.id)
  const next = readable.value[idx + delta]
  if (next) await openChapter(next)
}

async function startEdit() {
  if (!current.value) return
  if (isLocked.value) {
    message.warning('章节已锁定，请先回工作台解锁再改')
    return
  }
  draftTitle.value = customChapterTitle(current.value.number, current.value.title)
  draftContent.value = current.value.content || ''
  editing.value = true
  await nextTick()
  editorRef.value?.focus()
}

function cancelEdit() {
  if (!current.value) return
  draftTitle.value = customChapterTitle(current.value.number, current.value.title)
  draftContent.value = current.value.content || ''
  editing.value = false
}

async function saveChapter() {
  if (!current.value) return false
  if (isLocked.value) {
    message.warning('章节已锁定，无法保存')
    return false
  }
  saving.value = true
  try {
    const title =
      customChapterTitle(current.value.number, draftTitle.value) ||
      chapterPrefix(current.value.number)
    const payload: Partial<Chapter> = { title }
    if (editing.value) payload.content = draftContent.value
    const saved = await api.updateChapter(current.value.id, payload)
    current.value = saved
    const idx = chapters.value.findIndex((c) => c.id === saved.id)
    if (idx >= 0) chapters.value[idx] = saved
    draftTitle.value = customChapterTitle(saved.number, saved.title)
    draftContent.value = saved.content || ''
    message.success(editing.value ? `已保存 ${saved.word_count || 0} 字` : '章节标题已保存')
    return true
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败')
    return false
  } finally {
    saving.value = false
  }
}

function onKey(ev: KeyboardEvent) {
  if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 's') {
    ev.preventDefault()
    if (!isLocked.value && dirty.value) void saveChapter()
    return
  }
  if (editing.value) {
    if (ev.key === 'Escape') cancelEdit()
    return
  }
  if (ev.key === 'ArrowRight') void step(1)
  if (ev.key === 'ArrowLeft') void step(-1)
}

function writePath(chapterId?: number | null) {
  const id = chapterId ?? current.value?.id
  const q = id != null ? `?chapter=${id}` : ''
  return `/novels/${novelId.value}/write${q}`
}

async function goBack() {
  if (!(await confirmLeaveEdit())) return
  const from = String(route.query.from || '')
  const chapterFromQuery = Number(route.query.chapter)
  const backChapter =
    current.value?.id ||
    (Number.isFinite(chapterFromQuery) && chapterFromQuery > 0 ? chapterFromQuery : null)
  if (from === 'write') {
    router.push(writePath(backChapter))
    return
  }
  if (from === 'studio') {
    router.push(`/novels/${novelId.value}`)
    return
  }
  if (from === 'home') {
    router.push('/')
    return
  }
  if (window.history.length > 1) {
    router.back()
    return
  }
  router.push(writePath(backChapter))
}

async function load() {
  error.value = ''
  novel.value = await api.getNovel(novelId.value)
  chapters.value = await api.listChapters(novelId.value)
  const wanted = Number(route.params.chapterId)
  const found =
    chapters.value.find((c) => c.id === wanted) ||
    readable.value[0] ||
    chapters.value[0] ||
    null
  if (found) applyChapter(found)
  else current.value = null
}

onMounted(async () => {
  try {
    await load()
  } catch (err) {
    error.value = err instanceof Error ? err.message : '加载失败'
  }
  window.addEventListener('keydown', onKey)
})
onUnmounted(() => window.removeEventListener('keydown', onKey))
watch(
  () => route.params.chapterId,
  async () => {
    const wanted = Number(route.params.chapterId)
    const found = chapters.value.find((c) => c.id === wanted)
    if (!found || found.id === current.value?.id) return
    if (!(await confirmLeaveEdit())) {
      if (current.value) {
        router.replace({
          params: { ...route.params, chapterId: String(current.value.id) },
          query: { ...route.query },
        })
      }
      return
    }
    applyChapter(found)
  },
)
</script>

<template>
  <div class="stage" :class="{ night }">
    <div class="phone">
      <header class="bar">
        <button type="button" @click="goBack">返回</button>
        <strong>{{ novel?.title || '阅读' }}</strong>
        <button type="button" @click="night = !night">{{ night ? '日间' : '夜间' }}</button>
      </header>
      <div v-if="error" class="empty">{{ error }}</div>
      <div v-else-if="!current" class="empty">还没有章节可预览。先去大纲页生成目录并写章。</div>
      <div v-else class="paper" :style="{ fontSize: fontSize + 'px' }">
        <div class="tools">
          <span v-if="isLocked" class="hint">已锁定，只能阅读</span>
          <span v-else-if="dirty" class="hint warn">未保存</span>
          <span v-else class="hint">标题可直接改；点击正文可改正文</span>
          <template v-if="!isLocked">
            <button v-if="!editing" type="button" @click="startEdit">编辑正文</button>
            <button v-if="editing || dirty" type="button" :disabled="saving" @click="cancelEdit">取消</button>
            <button type="button" class="primary" :disabled="saving || !dirty" @click="saveChapter">
              {{ saving ? '保存中…' : '保存' }}
            </button>
          </template>
        </div>
        <div class="title-line">
          <span class="chap-no">第{{ current.number }}章</span>
          <input
            v-model="draftTitle"
            class="title-input"
            placeholder="自定义标题，如：开篇"
            :disabled="isLocked || saving"
            @keydown.enter.prevent="saveChapter"
          />
        </div>
        <template v-if="editing">
          <textarea
            ref="editorRef"
            v-model="draftContent"
            class="body-input"
            placeholder="在这里直接改正文，改完点保存。"
            :disabled="saving"
          />
          <p class="count">{{ draftWords }} 字</p>
        </template>
        <template v-else>
          <p v-if="!(current.content || '').trim()" class="empty clickable" @click="startEdit">
            这一章还没有正文。点击后可直接写。
          </p>
          <p v-for="(p, idx) in paragraphs" :key="idx" class="clickable" @click="startEdit">{{ p }}</p>
        </template>
      </div>
      <footer class="bar bottom">
        <button type="button" :disabled="!readable.length" @click="step(-1)">上一章</button>
        <button type="button" @click="catalogOpen = true">目录 {{ progress }}</button>
        <button type="button" @click="fontSize = fontSize >= 22 ? 16 : fontSize + 2">字号</button>
        <button type="button" :disabled="!readable.length" @click="step(1)">下一章</button>
      </footer>
    </div>
    <aside v-if="catalogOpen" class="mask" @click="catalogOpen = false">
      <div class="drawer" @click.stop>
        <h3>目录</h3>
        <button
          v-for="ch in chapters"
          :key="ch.id"
          type="button"
          class="toc"
          :class="{ on: current?.id === ch.id, dim: !(ch.content || '').trim() }"
          @click="openChapter(ch)"
        >
          {{ chapterHeading(ch.number, ch.title) }}
          <small>{{ ch.word_count ? ch.word_count + ' 字' : '未写' }}</small>
        </button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.stage {
  min-height: calc(100vh - 56px);
  display: flex;
  justify-content: center;
  padding: 12px 0 24px;
  background: #1a1d24;
}
.phone {
  width: min(420px, 100%);
  height: calc(100vh - 92px);
  display: flex;
  flex-direction: column;
  background: #f6f1e8;
  color: #2b241c;
  border-radius: 20px;
  overflow: hidden;
  border: 1px solid #d7cbb8;
}
.night .phone {
  background: #171411;
  color: #d9d0c4;
  border-color: #3a332c;
}
.bar {
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 12px;
  font-size: 13px;
  border-bottom: 1px solid #e6dccb;
}
.night .bar {
  border-color: #3a332c;
}
.bottom {
  border-bottom: 0;
  border-top: 1px solid #e6dccb;
}
.bar button,
.toc,
.tools button {
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
}
.bar button:disabled,
.tools button:disabled {
  opacity: 0.35;
  cursor: default;
}
.paper {
  flex: 1;
  overflow: auto;
  padding: 8px 22px 28px;
  line-height: 1.9;
  display: flex;
  flex-direction: column;
}
.tools {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  min-height: 36px;
  font-size: 12px;
}
.tools .hint {
  margin-right: auto;
  color: #8a7d6c;
  font-size: 12px;
}
.tools .hint.warn {
  color: #c45c26;
}
.tools .primary {
  color: #c45c26;
  font-weight: 600;
}
.paper h1,
.title-line {
  display: flex;
  align-items: baseline;
  justify-content: center;
  gap: 8px;
  margin: 10px 0 12px;
}
.chap-no {
  flex: none;
  font-size: 1.15em;
  font-weight: 700;
}
.title-input {
  flex: 1;
  min-width: 0;
  font-size: 1.15em;
  font-weight: 700;
  text-align: center;
  color: inherit;
  width: 100%;
  border: 0;
  border-bottom: 1px dashed #d7cbb8;
  background: transparent;
  outline: none;
  padding: 4px 0;
  font-family: inherit;
}
.night .title-input {
  border-color: #3a332c;
}
.paper p {
  margin: 0 0 0.9em;
  text-indent: 2em;
}
.clickable {
  cursor: text;
}
.body-input {
  flex: 1;
  min-height: 240px;
  width: 100%;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  line-height: 1.9;
  resize: none;
  outline: none;
  padding: 0;
}
.count {
  margin: 8px 0 0;
  text-indent: 0;
  font-size: 12px;
  color: #8a7d6c;
  text-align: right;
}
.empty {
  padding: 48px 24px;
  text-align: center;
  color: #8a7d6c;
  text-indent: 0;
}
.mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  justify-content: center;
  align-items: stretch;
}
.drawer {
  width: min(420px, 100%);
  margin-top: 56px;
  background: #fffaf2;
  color: #2b241c;
  overflow: auto;
  padding: 16px;
}
.night .drawer {
  background: #211c18;
  color: #d9d0c4;
}
.toc {
  width: 100%;
  display: flex;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid #efe6d6;
  text-align: left;
}
.toc.on {
  color: #c45c26;
}
.toc.dim {
  opacity: 0.5;
}
.toc small {
  color: #8a7d6c;
}
</style>
