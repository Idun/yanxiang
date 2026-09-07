<script setup lang="ts">
import { NButton, NInput, NInputNumber, NSelect, NSwitch, NTabPane, NTabs, useMessage } from 'naive-ui'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api, streamGenerate, streamSse } from '../api/client'
import RadarChart from '../components/RadarChart.vue'
import PowerSystemPanel from '../components/PowerSystemPanel.vue'
import {
  chapterBeat,
  chapterHeading,
  customChapterTitle,
  formatChapterSpan,
  orphanSeasons,
  parseOutline,
  seasonsInVolume,
  volumeChapterSpan,
  volumeHeading,
} from '../lib/outline'
import { parsePowerSystem, stringifyPowerSystem } from '../lib/powerSystem'
import { loadThinkingPref, saveThinkingPref } from '../lib/thinking'
import type { Chapter, Character, NamedItem, Novel, NovelReport, OutlineVolume, Relationship, Review, ReviewIssue, Season } from '../types'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const novelId = computed(() => Number(route.params.id))

const novel = ref<Novel | null>(null)
const chapters = ref<Chapter[]>([])
const characters = ref<Character[]>([])
const relationships = ref<Relationship[]>([])
const items = ref<NamedItem[]>([])
const locations = ref<NamedItem[]>([])
const events = ref<NamedItem[]>([])
const current = ref<Chapter | null>(null)
const generating = ref(false)
const mode = ref<'lottery' | 'plot'>('plot')
const instruction = ref('')
const optimizeNotes = ref('')
const thinking = ref(loadThinkingPref())
const reasoning = ref('')
const targetWords = ref(3500)
const useContentPlan = ref(true)
const arcTheme = ref('')
const arcCount = ref(8)
const arcStart = ref(0)
const arcExtra = ref('')
const arcWorking = ref(false)
const latestArc = ref<{
  theme: string
  intro?: string
  arc_summary: string
  season_hook?: string
  next_theme?: string
  next_preview?: string
  start_number: number
  end_number: number
  chapters: { number: number; title: string; summary: string }[]
} | null>(null)
const seasons = ref<Season[]>([])
const lastSeason = computed(() => (seasons.value.length ? seasons.value[seasons.value.length - 1] : null))
const latestPlan = ref('')
const nextChapterPreview = ref<{ number: number; title: string; summary: string } | null>(null)
const abortRef = ref<AbortController | null>(null)
const working = ref(false)
const stageLabel = ref('')
const latestReview = ref<Review | null>(null)
const latestReader = ref<Review | null>(null)
const latestContinuity = ref<{
  pass: boolean
  score: number
  prev_hook: string
  issues: string[]
} | null>(null)
const report = ref<NovelReport | null>(null)
const manualBible = ref(false)
const bibleWorking = ref(false)

const bibleDraft = ref({ name: '', extra: '' })
const charDraft = ref({ name: '', role: '', personality: '', background: '' })
const relDraft = ref({ from_char_id: 0, to_char_id: 0, relation_type: '相识', description: '' })

const outlinePreview = computed<OutlineVolume[]>(() => parseOutline(novel.value?.outline_json || '[]'))
const outlineOrphans = computed(() => orphanSeasons(seasons.value, outlinePreview.value))

function outlineSeasonsOf(vol: OutlineVolume) {
  return seasonsInVolume(seasons.value, vol)
}

/** 优先用真实章节目录统计范围，避免大纲 JSON 幽灵章把数字撑大 */
function outlineVolMeta(vol: OutlineVolume) {
  const real = chapters.value.filter((c) => (c.volume || 1) === (vol.volume || 1))
  if (real.length) {
    const nums = real.map((c) => c.number)
    return `共 ${real.length} 章（${formatChapterSpan(Math.min(...nums), Math.max(...nums))}）`
  }
  const span = volumeChapterSpan(vol)
  if (!span) return ''
  return `规划 ${span.count} 章（${formatChapterSpan(span.start, span.end)}）`
}

const charOptions = computed(() =>
  characters.value.map((c) => ({ label: c.name, value: c.id })),
)

const isLocked = computed(
  () => (current.value?.lock_status || 'in_progress') === 'locked',
)

const titleDraft = ref('')

function lockLabel(ch: Chapter) {
  return (ch.lock_status || 'in_progress') === 'locked' ? '锁定' : '进行中'
}

async function toggleLock() {
  if (!current.value) return
  const next = isLocked.value ? 'in_progress' : 'locked'
  const locking = next === 'locked'
  try {
    current.value = await api.updateChapter(current.value.id, { lock_status: next })
    chapters.value = await api.listChapters(novelId.value)
    if (!locking) {
      message.success('章节已解锁，可继续编辑')
      return
    }
    const loadingMsg = message.loading('章节已锁定，正在识别本章角色…', { duration: 0 })
    try {
      const result = await api.recognizeCast(current.value.id)
      characters.value = await api.listCharacters(novelId.value)
      relationships.value = await api.listRelationships(novelId.value)
      loadingMsg.destroy()
      if (result.created > 0) {
        message.success(
          `已锁定。新写入 ${result.created} 个角色${result.names?.length ? '：' + result.names.join('、') : ''}`,
        )
      } else {
        message.success('已锁定。本章没有需要新收录的有名角色')
      }
    } catch (err) {
      loadingMsg.destroy()
      message.warning(
        `已锁定，但角色识别失败：${err instanceof Error ? err.message : '请稍后重试'}`,
      )
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '锁定失败')
  }
}

async function pruneToProtagonist() {
  if (!novel.value) return
  bibleWorking.value = true
  try {
    const result = await api.keepProtagonistOnly(novelId.value)
    characters.value = await api.listCharacters(novelId.value)
    relationships.value = await api.listRelationships(novelId.value)
    if (result.removed_count > 0) {
      message.success(`已只留男主，清除 ${result.removed_count} 人`)
    } else {
      message.info('角色表里本来就只有男主（或尚未登记）')
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '清理失败')
  } finally {
    bibleWorking.value = false
  }
}

function queryChapterId(): number | undefined {
  const raw = route.query.chapter
  const n = Number(Array.isArray(raw) ? raw[0] : raw)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function syncChapterQuery(chapterId?: number | null) {
  const id = chapterId ?? current.value?.id
  const prev = String(route.query.chapter || '')
  const next = id != null ? String(id) : ''
  if (prev === next) return
  const query = { ...route.query } as Record<string, string | string[]>
  if (next) query.chapter = next
  else delete query.chapter
  void router.replace({ query })
}

async function scrollActiveChapterIntoView() {
  await nextTick()
  const el = document.querySelector('.mid .ch.active') as HTMLElement | null
  el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
}

async function loadAll(opts: { preferChapterId?: number } = {}) {
  const stayId = opts.preferChapterId ?? queryChapterId() ?? current.value?.id
  novel.value = await api.getNovel(novelId.value)
  const parsedPower = parsePowerSystem(novel.value?.power_system || '')
  if (novel.value && parsedPower) novel.value.power_system = stringifyPowerSystem(parsedPower)
  chapters.value = await api.listChapters(novelId.value)
  characters.value = await api.listCharacters(novelId.value)
  relationships.value = await api.listRelationships(novelId.value)
  items.value = await api.listItems(novelId.value)
  locations.value = await api.listLocations(novelId.value)
  events.value = await api.listEvents(novelId.value)
  try {
    seasons.value = await api.listSeasons(novelId.value)
  } catch {
    seasons.value = []
  }

  const preferred =
    (stayId != null ? chapters.value.find((c) => c.id === stayId) : undefined) ||
    (current.value?.id != null
      ? chapters.value.find((c) => c.id === current.value?.id)
      : undefined)
  if (preferred) {
    current.value = preferred
  } else if (!current.value && chapters.value.length) {
    current.value = chapters.value[0]
  } else if (current.value) {
    const fresh = chapters.value.find((c) => c.id === current.value?.id)
    if (fresh) current.value = fresh
    else if (chapters.value.length) current.value = chapters.value[0]
  }

  if (current.value) {
    instruction.value = chapterInstruction(current.value)
    titleDraft.value = customChapterTitle(current.value.number, current.value.title)
    syncChapterQuery(current.value.id)
    await loadReviews(current.value.id)
    void scrollActiveChapterIntoView()
  }
  try {
    await loadReport()
  } catch {
    report.value = null
  }
}

async function loadReviews(chapterId: number) {
  try {
    const rows = await api.listReviews(chapterId)
    latestReview.value = rows.find((r) => r.agent === 'review') || null
    latestReader.value = rows.find((r) => r.agent === 'reader') || null
  } catch {
    latestReview.value = null
    latestReader.value = null
  }
}

async function loadReport() {
  report.value = await api.novelReport(novelId.value)
}

async function saveNovel() {
  if (!novel.value) return
  const parsedPower = parsePowerSystem(novel.value.power_system || '')
  if (parsedPower) novel.value.power_system = stringifyPowerSystem(parsedPower)
  novel.value = await api.updateNovel(novel.value.id, {
    title: novel.value.title,
    description: novel.value.description,
    genre: novel.value.genre,
    world_bible: novel.value.world_bible,
    power_system: novel.value.power_system,
    outline_json: novel.value.outline_json,
    premise: novel.value.premise,
  })
  message.success('设定已保存')
}

async function addChapter() {
  const created = await api.createChapter(novelId.value, {})
  chapters.value = await api.listChapters(novelId.value)
  current.value = created
  titleDraft.value = customChapterTitle(created.number, created.title)
  instruction.value = chapterInstruction(created)
  syncChapterQuery(created.id)
}

function chapterInstruction(chapter: Chapter) {
  return (
    (chapter.plot_brief || '').trim() ||
    (chapter.summary || '').trim() ||
    chapterBeat(novel.value?.outline_json || '', chapter.number) ||
    ''
  )
}

function selectChapter(chapter: Chapter) {
  const switching = current.value?.id !== chapter.id
  current.value = chapter
  titleDraft.value = customChapterTitle(chapter.number, chapter.title)
  instruction.value = chapterInstruction(chapter)
  syncChapterQuery(chapter.id)
  // 只有切到另一章时才清空优化点；同章刷新/误点不丢输入
  if (switching) {
    optimizeNotes.value = ''
    latestPlan.value = ''
    nextChapterPreview.value = null
    latestContinuity.value = null
  }
  void loadReviews(chapter.id)
}

async function saveChapter() {
  if (!current.value) return
  if (isLocked.value) {
    message.warning('章节已锁定，请先解锁再保存')
    return
  }
  current.value.title = titleDraft.value.trim()
  current.value = await api.updateChapter(current.value.id, {
    title: current.value.title,
    content: current.value.content,
    volume: current.value.volume,
    plot_brief: instruction.value.trim(),
  })
  titleDraft.value = customChapterTitle(current.value.number, current.value.title)
  chapters.value = await api.listChapters(novelId.value)
  if (novel.value) novel.value = await api.getNovel(novelId.value)
  message.success('章节与剧情要点已保存')
}

async function saveTitle() {
  if (!current.value || isLocked.value) return
  const title = titleDraft.value.trim()
  if (title === customChapterTitle(current.value.number, current.value.title)) return
  current.value = await api.updateChapter(current.value.id, { title })
  titleDraft.value = customChapterTitle(current.value.number, current.value.title)
  chapters.value = await api.listChapters(novelId.value)
  if (novel.value) novel.value = await api.getNovel(novelId.value)
  message.success('章节标题已保存')
}

async function savePlotBrief() {
  if (!current.value) return
  if (isLocked.value) {
    message.warning('章节已锁定，请先解锁再改剧情要点')
    return
  }
  const brief = instruction.value.trim()
  if (!brief) {
    message.warning('剧情要点不能为空')
    return
  }
  current.value = await api.updateChapter(current.value.id, {
    plot_brief: brief,
    title: titleDraft.value.trim() || current.value.title,
  })
  chapters.value = await api.listChapters(novelId.value)
  if (novel.value) novel.value = await api.getNovel(novelId.value)
  message.success('剧情要点已保存')
}

async function removeChapter(chapter: Chapter) {
  if ((chapter.lock_status || 'in_progress') === 'locked') {
    message.warning('章节已锁定，请先解锁再删除')
    return
  }
  await api.deleteChapter(chapter.id)
  if (current.value?.id === chapter.id) current.value = null
  await loadAll()
}

async function generate() {
  if (!current.value) {
    message.warning('先新建或选择一章')
    return
  }
  if (isLocked.value) {
    message.warning('章节已锁定，请先解锁再生成')
    return
  }
  const plotHint =
    instruction.value.trim() ||
    chapterInstruction(current.value) ||
    ''
  if (mode.value === 'plot' && !plotHint) {
    message.warning('剧情模式请填写本章指令，或先在大纲页确认章节要点')
    return
  }
  // 生成前自动落盘剧情要点，避免改完忘记保存
  if (plotHint && plotHint !== (current.value.plot_brief || '').trim()) {
    try {
      current.value = await api.updateChapter(current.value.id, {
        plot_brief: plotHint,
        title: titleDraft.value.trim() || current.value.title,
      })
      if (novel.value) novel.value = await api.getNovel(novelId.value)
    } catch {
      /* 仍继续生成 */
    }
  }
  generating.value = true
  reasoning.value = ''
  latestContinuity.value = null
  const stayChapterId = current.value.id
  let sawError = false
  if (targetWords.value < 3500) targetWords.value = 3500
  stageLabel.value = thinking.value
    ? useContentPlan.value
      ? '深度思考中，内容规划…'
      : '深度思考中，写作起草…'
    : useContentPlan.value
      ? '内容规划 Agent 拆场景并预告下一章…'
      : '写作 Agent 起草中…'
  current.value.content = ''
  latestPlan.value = ''
  nextChapterPreview.value = null
  const controller = new AbortController()
  abortRef.value = controller
  try {
    await streamGenerate(
      stayChapterId,
      {
        mode: mode.value,
        instruction: plotHint,
        target_words: targetWords.value,
        character_ids: [],
        polish: true,
        plan: useContentPlan.value,
        thinking: thinking.value,
      },
      (event) => {
        if (!current.value) return
        if (current.value.id !== stayChapterId) {
          const stay = chapters.value.find((c) => c.id === stayChapterId)
          if (stay) current.value = stay
          else return
        }
        if (event.type === 'stage') {
          stageLabel.value = event.label || event.stage || ''
          if (
            event.stage === 'deai' ||
            event.stage === 'revise' ||
            event.stage === 'continuity_fix'
          ) {
            current.value.content = ''
          }
        }
        if (event.type === 'reasoning' && event.text) {
          reasoning.value += event.text
          if (!stageLabel.value.includes('深度思考')) stageLabel.value = '深度思考中…'
        }
        if (event.type === 'plan' && event.text) {
          latestPlan.value = event.text
          const n = event.scene_count || 0
          stageLabel.value = n
            ? `场景计划已就绪（${n} 场）${event.focus ? ' · ' + event.focus : ''}，开始写作…`
            : '场景计划已就绪，开始写作…'
        }
        if (event.type === 'next_chapter') {
          nextChapterPreview.value = {
            number: Number(event.number) || (current.value.number + 1),
            title: event.title || '',
            summary: event.summary || '',
          }
          patchNextChapter(nextChapterPreview.value)
          stageLabel.value = `已预填第${nextChapterPreview.value.number}章主要内容，继续写作…`
        }
        if (event.type === 'characters') {
          const n = Number(event.updated) || 0
          const names = Array.isArray(event.names) ? event.names : []
          if (n > 0) stageLabel.value = `已写入 ${n} 个新角色${names.length ? '：' + names.join('、') : ''}`
        }
        if (event.type === 'relationships') {
          const n = Number(event.updated) || 0
          if (n > 0) stageLabel.value = `已自动更新 ${n} 条人物关系`
        }
        if (event.type === 'continuity') {
          applyContinuity({
            pass: event.pass,
            score: event.score,
            prev_hook: event.prev_hook,
            issues: event.issues,
            warn: false,
          })
          stageLabel.value = event.pass
            ? `章间接力通过（${event.score}/10）`
            : `章间接力未过（${event.score}/10）`
        }
        if (event.type === 'token' && event.text) current.value.content += event.text
        if (event.type === 'review' && event.data) latestReview.value = asReview(event.data, 'review')
        if (event.type === 'done') {
          applyDone(event)
          current.value.status = event.review ? 'polished' : 'generated'
          if (event.review) latestReview.value = asReview(event.review, 'review')
          if (event.reader) latestReader.value = asReview(event.reader, 'reader')
          if (sawError) return
          const extra = event.review ? `，审查 ${asReview(event.review, 'review').overall}` : ''
          const cont = latestContinuity.value
          if (cont && !cont.pass) {
            message.warning(
              `已过审 ${current.value.word_count} 字${extra}；章间接力未达标，建议改开场`,
            )
          } else {
            message.success(`已过审 ${current.value.word_count} 字${extra}`)
          }
        }
        if (event.type === 'error') {
          sawError = true
          message.error(event.message || '生成失败')
        }
      },
      controller.signal,
    )
    chapters.value = await api.listChapters(novelId.value)
    if (current.value) await loadReviews(current.value.id)
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      message.error(err instanceof Error ? err.message : '生成失败')
    }
  } finally {
    generating.value = false
    abortRef.value = null
    stageLabel.value = ''
    try {
      await loadAll({ preferChapterId: stayChapterId })
    } catch {
      /* ignore */
    }
  }
}

function stopGenerate() {
  abortRef.value?.abort()
}

function applyContinuity(raw: {
  pass?: boolean
  score?: number
  prev_hook?: string
  issues?: unknown
  warn?: boolean
}) {
  const issues = Array.isArray(raw.issues)
    ? raw.issues.map((x) => String(x)).filter(Boolean)
    : []
  const pass = Boolean(raw.pass)
  const score = Number(raw.score) || 0
  latestContinuity.value = {
    pass,
    score,
    prev_hook: typeof raw.prev_hook === 'string' ? raw.prev_hook : '',
    issues,
  }
  if (raw.warn !== false && !pass) {
    const tip = issues[0] || '开场未承接上一章钩子，可手动优化开场'
    message.warning(`章间接力未达标（${score}/10）：${tip}`)
  }
}

function applyDone(event: {
  word_count?: number
  summary?: string
  content?: string
  continuity?: {
    pass?: boolean
    score?: number
    prev_hook?: string
    issues?: unknown
  }
}) {
  if (!current.value) return
  if (event.content) current.value.content = event.content
  current.value.word_count = event.word_count || current.value.word_count
  if (event.summary) current.value.summary = event.summary
  if (event.continuity) applyContinuity({ ...event.continuity, warn: false })
}

function patchNextChapter(next: { number: number; title: string; summary: string }) {
  const idx = chapters.value.findIndex((c) => c.number === next.number)
  if (idx >= 0) {
    chapters.value[idx] = {
      ...chapters.value[idx],
      title: next.title || chapters.value[idx].title,
      plot_brief: next.summary || chapters.value[idx].plot_brief,
      summary: next.summary || chapters.value[idx].summary,
    }
    return
  }
  // 后端新建了下一章，本地列表还没有：先插占位，最终 loadAll 会对齐
  const volume = current.value?.volume || 1
  chapters.value = [
    ...chapters.value,
    {
      id: -next.number,
      novel_id: novelId.value,
      volume,
      number: next.number,
      title: next.title || `第${next.number}章`,
      content: '',
      summary: next.summary || '',
      plot_brief: next.summary || '',
      word_count: 0,
      status: 'draft',
      tags_json: '[]',
      storyline_ids_json: '[]',
      generation_mode: '',
      lock_status: 'in_progress',
      created_at: '',
      updated_at: '',
    } as Chapter,
  ].sort((a, b) => a.number - b.number)
}

async function runJsonAgent(kind: 'review' | 'reader') {
  if (isLocked.value && kind === 'review') {
    message.warning('章节已锁定，请先解锁再审查（审查会改章节状态）')
    return
  }
  if (!current.value?.content.trim()) {
    message.warning('本章还没有正文')
    return
  }
  working.value = true
  stageLabel.value = kind === 'review' ? '审查中…' : '读者评估中…'
  try {
    const row = kind === 'review' ? await api.runReview(current.value.id) : await api.runReader(current.value.id)
    if (kind === 'review') latestReview.value = row
    else latestReader.value = row
    message.success(kind === 'review' ? `审查完成，综合 ${row.overall}` : `读者评分 ${row.overall}`)
    await loadAll()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '失败')
  } finally {
    working.value = false
    stageLabel.value = ''
  }
}

function asReview(data: unknown, agent: string): Review {
  const row = (data || {}) as Record<string, unknown>
  const issues = (row.issues as Review['issues']) || (row.complaints as string[]) || []
  const suggestions = (row.suggestions as string[]) || (row.praise as string[]) || []
  const oneLiner = String(row.one_liner || row.comment || '')
  const flag = row.would_continue === true ? '会点下一章。' : row.would_continue === false ? '可能弃章。' : ''
  return {
    id: Number(row.id) || 0,
    chapter_id: Number(row.chapter_id) || current.value?.id || 0,
    novel_id: Number(row.novel_id) || novelId.value,
    agent,
    overall: Number(row.overall) || 0,
    scores: (row.scores as Record<string, number>) || {},
    issues,
    suggestions,
    comment: `${flag}${oneLiner}`.trim(),
    created_at: String(row.created_at || ''),
  }
}

async function runStreamAgent(
  path: string,
  successText: string,
  options: { emptyFirst?: boolean; body?: unknown } = {},
) {
  if (isLocked.value) {
    message.warning('章节已锁定，请先解锁')
    return
  }
  if (!current.value?.content.trim()) {
    message.warning('本章还没有正文')
    return
  }
  const stayChapterId = current.value.id
  const notesKeep = optimizeNotes.value
  const snapshot = current.value.content
  working.value = true
  reasoning.value = ''
  const controller = new AbortController()
  abortRef.value = controller
  if (options.emptyFirst) current.value.content = ''
  try {
    await streamSse(
      path,
      options.body ?? {},
      (event) => {
        if (!current.value) return
        // 流式过程中若 current 被误切走，仍写回原章节
        if (current.value.id !== stayChapterId) {
          const stay = chapters.value.find((c) => c.id === stayChapterId)
          if (stay) current.value = stay
          else return
        }
        if (event.type === 'stage') {
          stageLabel.value = event.label || event.stage || ''
          if (
            event.stage === 'deai' ||
            event.stage === 'revise' ||
            event.stage === 'continuity_fix'
          ) {
            current.value.content = ''
          }
        }
        if (event.type === 'reasoning' && event.text) {
          reasoning.value += event.text
          stageLabel.value = '深度思考中…'
        }
        if (event.type === 'next_chapter') {
          nextChapterPreview.value = {
            number: Number(event.number) || (current.value.number + 1),
            title: event.title || '',
            summary: event.summary || '',
          }
          patchNextChapter(nextChapterPreview.value)
          stageLabel.value = `已更新第${nextChapterPreview.value.number}章主要内容`
        }
        if (event.type === 'characters') {
          const n = Number(event.updated) || 0
          const names = Array.isArray(event.names) ? event.names : []
          if (n > 0) stageLabel.value = `已写入 ${n} 个新角色${names.length ? '：' + names.join('、') : ''}`
        }
        if (event.type === 'relationships') {
          const n = Number(event.updated) || 0
          if (n > 0) stageLabel.value = `已自动更新 ${n} 条人物关系`
        }
        if (event.type === 'continuity') {
          applyContinuity({
            pass: event.pass,
            score: event.score,
            prev_hook: event.prev_hook,
            issues: event.issues,
            warn: false,
          })
        }
        if (event.type === 'token' && event.text) current.value.content += event.text
        if (event.type === 'review' && event.data) latestReview.value = asReview(event.data, 'review')
        if (event.type === 'done') {
          applyDone(event)
          current.value.status = 'polished'
          if (event.review) latestReview.value = asReview(event.review, 'review')
          if (event.reader) latestReader.value = asReview(event.reader, 'reader')
          if (latestContinuity.value && !latestContinuity.value.pass) {
            message.warning(`${successText}；章间接力未达标，建议改开场`)
          } else {
            message.success(successText)
          }
        }
        if (event.type === 'error') message.error(event.message || '失败')
      },
      controller.signal,
    )
    await loadAll({ preferChapterId: stayChapterId })
    optimizeNotes.value = notesKeep
  } catch (err) {
    if (current.value && current.value.id === stayChapterId && !current.value.content.trim()) {
      current.value.content = snapshot
    }
    optimizeNotes.value = notesKeep
    if ((err as Error).name !== 'AbortError') message.error(err instanceof Error ? err.message : '失败')
  } finally {
    working.value = false
    stageLabel.value = ''
    abortRef.value = null
  }
}

async function runDeai() {
  if (!current.value) return
  stageLabel.value = '去 AI 味…'
  await runStreamAgent(`/api/chapters/${current.value.id}/deai`, '去 AI 味完成', { emptyFirst: true })
}

async function runRevise() {
  if (!current.value) return
  const notes = optimizeNotes.value.trim()
  if (!notes && !latestReview.value) {
    message.warning('请先填写下方优化点，或先点「审查」')
    return
  }
  stageLabel.value = notes
    ? thinking.value
      ? '深度思考中，按你的要求改写…'
      : '按你的要求改写中…'
    : thinking.value
      ? '深度思考中，按审查意见改写…'
      : '按审查意见改写…'
  await runStreamAgent(`/api/chapters/${current.value.id}/revise`, '改写完成', {
    emptyFirst: true,
    body: { notes, content: current.value.content, thinking: thinking.value },
  })
}

async function runOptimizeByNotes() {
  if (!current.value?.content.trim()) {
    message.warning('请先生成或填写本章正文')
    return
  }
  const notes = optimizeNotes.value.trim()
  if (!notes) {
    message.warning('请先写上想改的点，再点「按优化点改写」')
    return
  }
  await runRevise()
}

async function applySeasonResult(result: {
  novel?: Novel
  theme: string
  intro?: string
  arc_summary: string
  season_hook?: string
  next_theme?: string
  next_preview?: string
  start_number: number
  end_number: number
  chapters?: { number: number; title: string; summary: string }[]
  seasons?: Season[]
  season?: Season
  created: number
}) {
  if (result.novel) novel.value = result.novel
  latestArc.value = {
    theme: result.theme,
    intro: result.intro,
    arc_summary: result.arc_summary,
    season_hook: result.season_hook,
    next_theme: result.next_theme,
    next_preview: result.next_preview,
    start_number: result.start_number,
    end_number: result.end_number,
    chapters: result.chapters || [],
  }
  if (result.seasons) seasons.value = result.seasons
  if (result.next_theme) arcTheme.value = result.next_theme
  const stayId = current.value?.id
  await loadAll(stayId != null ? { preferChapterId: stayId } : {})
}

async function runArcPlan() {
  const theme = arcTheme.value.trim()
  if (!theme) {
    message.warning('请先填写本季主题，例如：全国大比')
    return
  }
  arcWorking.value = true
  try {
    const payload: {
      theme: string
      chapter_count: number
      instruction: string
      thinking: boolean
      start_number?: number
    } = {
      theme,
      chapter_count: arcCount.value,
      instruction: arcExtra.value.trim(),
      thinking: thinking.value,
    }
    if (arcStart.value > 0) payload.start_number = arcStart.value
    const result = await api.generateArc(novelId.value, payload)
    await applySeasonResult(result)
    message.success(
      `已规划第${result.season?.number || seasons.value.length}季「${result.theme}」第 ${result.start_number}–${result.end_number} 章（新建 ${result.created} 章）`,
    )
  } catch (err) {
    message.error(err instanceof Error ? err.message : '剧集生成失败')
  } finally {
    arcWorking.value = false
  }
}

async function runNextSeason() {
  if (!lastSeason.value) {
    message.warning('还没有本季。请先点「规划本卷剧集」或「生成本季」')
    return
  }
  arcWorking.value = true
  try {
    const result = await api.generateNextSeason(novelId.value, {
      theme: arcTheme.value.trim() || lastSeason.value.next_theme || undefined,
      chapter_count: arcCount.value,
      instruction: arcExtra.value.trim(),
      thinking: thinking.value,
    })
    await applySeasonResult(result)
    message.success(
      `已接下季：第${result.season?.number || seasons.value.length}季「${result.theme}」第 ${result.start_number}–${result.end_number} 章`,
    )
  } catch (err) {
    message.error(err instanceof Error ? err.message : '下一季生成失败')
  } finally {
    arcWorking.value = false
  }
}

async function runVolumePlan() {
  const vol = current.value?.volume || 1
  arcWorking.value = true
  try {
    const result = await api.planVolumeSeasons(novelId.value, vol, {
      instruction: arcExtra.value.trim(),
      thinking: thinking.value,
      replot: true,
    })
    if (result.novel) novel.value = result.novel
    if (result.seasons) seasons.value = result.seasons
    const first = result.seasons[0]
    if (first) {
      latestArc.value = {
        theme: first.theme,
        intro: first.intro,
        arc_summary: first.summary,
        season_hook: first.season_hook,
        next_theme: first.next_theme,
        next_preview: first.next_preview,
        start_number: first.start_number,
        end_number: first.end_number,
        chapters: first.chapters || [],
      }
    }
    const stayId = current.value?.id
    await loadAll(stayId != null ? { preferChapterId: stayId } : {})
    if (current.value) instruction.value = chapterInstruction(current.value)
    message.success(
      `第${result.volume}卷已定 ${result.seasons.length} 季，并重梳 ${result.replot_count} 章剧情要点（正文未覆盖）`,
    )
  } catch (err) {
    message.error(err instanceof Error ? err.message : '本卷季规划失败')
  } finally {
    arcWorking.value = false
  }
}

async function runCoherenceBook() {
  const written = chapters.value.filter((c) => (c.content || '').trim() && c.number <= 14)
  if (!written.length) {
    message.warning('前14章还没有正文可梳理')
    return
  }
  working.value = true
  reasoning.value = ''
  stageLabel.value = '正在梳理已写章节（文风/战力/人物）…'
  const controller = new AbortController()
  abortRef.value = controller
  const stayId = current.value?.id
  try {
    await streamSse(
      `/api/novels/${novelId.value}/coherence`,
      { start_number: 1, end_number: 14, thinking: thinking.value },
      (event) => {
        if (event.type === 'stage') stageLabel.value = event.label || '梳理中…'
        if (event.type === 'reasoning' && event.text) reasoning.value += event.text
        if (event.type === 'chapter_done') {
          stageLabel.value = `第${event.number}章已梳理（${event.word_count || 0} 字）`
          const idx = chapters.value.findIndex((c) => c.number === event.number)
          if (idx >= 0) {
            chapters.value[idx] = {
              ...chapters.value[idx],
              content: event.content || chapters.value[idx].content,
              word_count: event.word_count || chapters.value[idx].word_count,
              summary: event.summary || chapters.value[idx].summary,
              status: 'polished',
            }
          }
          if (current.value && current.value.number === event.number && event.content) {
            current.value.content = event.content
            current.value.word_count = event.word_count || current.value.word_count
          }
        }
        if (event.type === 'error') message.error(event.message || '梳理失败')
        if (event.type === 'done') message.success('前14章已按战力/人物/文风梳理完成')
      },
      controller.signal,
    )
    await loadAll(stayId != null ? { preferChapterId: stayId } : {})
    if (current.value) instruction.value = chapterInstruction(current.value)
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      message.error(err instanceof Error ? err.message : '梳理失败')
    }
  } finally {
    working.value = false
    abortRef.value = null
    stageLabel.value = ''
  }
}

async function runPipeline() {
  if (!current.value) return
  reasoning.value = ''
  latestContinuity.value = null
  await runStreamAgent(`/api/chapters/${current.value.id}/pipeline`, '再优化完成', {
    body: { apply_revise: true, threshold: 7, thinking: thinking.value },
  })
}

function onBibleTab(name: string) {
  if (name === 'report') void loadReport()
}

function issueText(item: ReviewIssue | string) {
  if (typeof item === 'string') return item
  return `${item.severity || ''}｜${item.detail || ''}${item.suggestion ? ' → ' + item.suggestion : ''}`
}

async function fillBible() {
  bibleWorking.value = true
  try {
    await api.generateBible(novelId.value)
    message.success('设定已由 AI 更新')
    await loadAll()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '设定失败')
  } finally {
    bibleWorking.value = false
  }
}

async function syncRelationships() {
  bibleWorking.value = true
  try {
    const result = await api.syncRelationships(novelId.value)
    if (result.skipped === 'characters_lt_2' || result.skipped === 'no_characters') {
      message.warning('还没有角色，先生成核心班底或写一章让系统收录')
    } else if (!result.updated) {
      message.info('未发现需更新的关系')
    } else {
      message.success(`已自动更新 ${result.updated} 条关系`)
    }
    await loadAll()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '同步失败')
  } finally {
    bibleWorking.value = false
  }
}

async function addCharacter() {
  if (!charDraft.value.name.trim()) return
  await api.createCharacter(novelId.value, charDraft.value)
  charDraft.value = { name: '', role: '', personality: '', background: '' }
  characters.value = await api.listCharacters(novelId.value)
}

async function addNamed(kind: 'items' | 'locations' | 'events') {
  if (!bibleDraft.value.name.trim()) return
  const payload = { name: bibleDraft.value.name.trim(), description: bibleDraft.value.extra }
  if (kind === 'items') await api.createItem(novelId.value, payload)
  if (kind === 'locations') await api.createLocation(novelId.value, payload)
  if (kind === 'events') await api.createEvent(novelId.value, { ...payload, timeline: '' })
  bibleDraft.value = { name: '', extra: '' }
  await loadAll()
}

async function addRelationship() {
  if (!relDraft.value.from_char_id || !relDraft.value.to_char_id) {
    message.warning('请选择两个角色')
    return
  }
  await api.createRelationship(novelId.value, relDraft.value)
  relationships.value = await api.listRelationships(novelId.value)
}

function charName(id: number) {
  return characters.value.find((c) => c.id === id)?.name || `#${id}`
}

onMounted(async () => {
  try {
    await loadAll()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载失败')
  }
})

watch(novelId, loadAll)
watch(thinking, (on) => saveThinkingPref(on))
</script>

<template>
  <div v-if="novel" class="studio">
    <aside class="left">
      <div class="row-nav">
        <n-button size="tiny" @click="router.push(`/novels/${novelId}`)">设定</n-button>
        <n-button size="tiny" :loading="bibleWorking" @click="fillBible">AI 补设定</n-button>
        <n-button size="tiny" quaternary @click="manualBible = !manualBible">{{ manualBible ? '收起手填' : '手填' }}</n-button>
      </div>
      <n-input v-model:value="novel.title" />
      <n-input v-model:value="novel.genre" placeholder="类型" size="small" style="margin-top: 8px" />
      <n-tabs type="line" animated style="margin-top: 12px" @update:value="onBibleTab">
        <n-tab-pane name="world" tab="世界观">
          <n-input v-model:value="novel.world_bible" type="textarea" :autosize="{ minRows: 10, maxRows: 22 }" />
        </n-tab-pane>
        <n-tab-pane name="outline" tab="大纲">
          <p class="hint">大纲只展示卷与季；具体章节在中间目录与「剧集」里看。</p>
          <ul v-if="outlinePreview.length" class="outline">
            <li v-for="(node, idx) in outlinePreview" :key="idx">
              <strong>{{ volumeHeading(node.volume, node.title) }}</strong>
              <span v-if="node.summary">{{ node.summary }}</span>
              <small v-if="outlineVolMeta(node)" class="outline-meta">{{ outlineVolMeta(node) }}</small>
              <ul v-if="outlineSeasonsOf(node).length" class="outline-seasons">
                <li v-for="s in outlineSeasonsOf(node)" :key="s.id">
                  <strong>第{{ s.number }}季 {{ s.theme }}</strong>
                  <small>
                    {{ formatChapterSpan(s.start_number, s.end_number) }}
                    <template v-if="s.intro || s.summary"> · {{ s.intro || s.summary }}</template>
                  </small>
                </li>
              </ul>
              <small v-else-if="outlineVolMeta(node)" class="outline-meta">本卷剧集尚未规划</small>
            </li>
            <li v-if="outlineOrphans.length">
              <strong>未归卷剧集</strong>
              <ul class="outline-seasons">
                <li v-for="s in outlineOrphans" :key="'o' + s.id">
                  <strong>第{{ s.number }}季 {{ s.theme }}</strong>
                  <small>{{ formatChapterSpan(s.start_number, s.end_number) }}</small>
                </li>
              </ul>
            </li>
          </ul>
          <div v-else class="hint">还没有分卷大纲。</div>
        </n-tab-pane>
        <n-tab-pane name="chars" tab="角色">
          <div v-if="manualBible" class="stack">
            <n-input v-model:value="charDraft.name" placeholder="姓名" size="small" />
            <n-input v-model:value="charDraft.role" placeholder="身份" size="small" />
            <n-input v-model:value="charDraft.personality" placeholder="性格" size="small" />
            <n-input v-model:value="charDraft.background" placeholder="背景" size="small" />
            <n-button size="small" @click="addCharacter">添加角色</n-button>
          </div>
          <p v-else class="hint">立项只登记男主。写章不拿角色表卡剧情；每章点「锁定」后，AI 会从正文识别有名角色并写入这里。</p>
          <n-button
            size="tiny"
            quaternary
            :disabled="bibleWorking || generating || working"
            style="margin-bottom: 8px"
            @click="pruneToProtagonist"
          >
            只留男主（清掉其余）
          </n-button>
          <div v-for="c in characters" :key="c.id" class="chip">
            <div>
              <strong>{{ c.name }}</strong>
              <small>{{ c.role }} · {{ c.personality }}</small>
            </div>
            <n-button v-if="manualBible" size="tiny" quaternary type="error" @click="api.deleteCharacter(novelId, c.id).then(loadAll)">删</n-button>
          </div>
        </n-tab-pane>
        <n-tab-pane name="power" tab="修炼体系">
          <p class="hint">写章、改写、字段 AI 都会带上这份设定，用来保持战力一致。</p>
          <PowerSystemPanel v-model="novel.power_system" compact />
        </n-tab-pane>
        <n-tab-pane name="rel" tab="关系">
          <p class="hint">人物关系由 AI 在写章/优化后自动维护，一般不用手填。</p>
          <n-button
            size="small"
            :loading="bibleWorking"
            :disabled="generating || working"
            style="margin-bottom: 8px"
            @click="syncRelationships"
          >
            AI 同步关系
          </n-button>
          <template v-if="manualBible">
            <n-select v-model:value="relDraft.from_char_id" :options="charOptions" placeholder="从" size="small" />
            <n-select v-model:value="relDraft.to_char_id" :options="charOptions" placeholder="到" size="small" style="margin-top: 6px" />
            <n-input v-model:value="relDraft.relation_type" placeholder="关系类型" size="small" style="margin-top: 6px" />
            <n-button size="small" style="margin-top: 6px" @click="addRelationship">手动添加</n-button>
          </template>
          <div v-if="!relationships.length" class="hint">暂无关系。生成或优化章节后会自动补上。</div>
          <div v-for="r in relationships" :key="r.id" class="chip">
            <span>{{ charName(r.from_char_id) }} → {{ charName(r.to_char_id) }}（{{ r.relation_type }}）</span>
            <n-button v-if="manualBible" size="tiny" quaternary type="error" @click="api.deleteRelationship(novelId, r.id).then(loadAll)">删</n-button>
          </div>
        </n-tab-pane>
        <n-tab-pane name="items" tab="道具">
          <template v-if="manualBible">
            <n-input v-model:value="bibleDraft.name" placeholder="名称" size="small" />
            <n-input v-model:value="bibleDraft.extra" placeholder="说明" size="small" style="margin-top: 6px" />
            <n-button size="small" style="margin-top: 6px" @click="addNamed('items')">添加</n-button>
          </template>
          <div v-for="it in items" :key="it.id" class="chip">
            <span>{{ it.name }}</span>
            <n-button v-if="manualBible" size="tiny" quaternary type="error" @click="api.deleteItem(novelId, it.id).then(loadAll)">删</n-button>
          </div>
        </n-tab-pane>
        <n-tab-pane name="loc" tab="场景">
          <template v-if="manualBible">
            <n-input v-model:value="bibleDraft.name" placeholder="名称" size="small" />
            <n-input v-model:value="bibleDraft.extra" placeholder="说明" size="small" style="margin-top: 6px" />
            <n-button size="small" style="margin-top: 6px" @click="addNamed('locations')">添加</n-button>
          </template>
          <div v-for="loc in locations" :key="loc.id" class="chip">
            <span>{{ loc.name }}</span>
            <n-button v-if="manualBible" size="tiny" quaternary type="error" @click="api.deleteLocation(novelId, loc.id).then(loadAll)">删</n-button>
          </div>
        </n-tab-pane>
        <n-tab-pane name="ev" tab="事件">
          <template v-if="manualBible">
            <n-input v-model:value="bibleDraft.name" placeholder="名称" size="small" />
            <n-input v-model:value="bibleDraft.extra" placeholder="说明" size="small" style="margin-top: 6px" />
            <n-button size="small" style="margin-top: 6px" @click="addNamed('events')">添加</n-button>
          </template>
          <div v-for="ev in events" :key="ev.id" class="chip">
            <span>{{ ev.name }}</span>
            <n-button v-if="manualBible" size="tiny" quaternary type="error" @click="api.deleteEvent(novelId, ev.id).then(loadAll)">删</n-button>
          </div>
        </n-tab-pane>
        <n-tab-pane name="report" tab="评估">
          <n-button size="small" @click="loadReport">刷新全书评估</n-button>
          <p v-if="report" class="hint">已审查 {{ report.reviewed_count }} / {{ report.chapter_count }} 章</p>
          <RadarChart v-if="report && report.reviewed_count" :scores="report.averages" />
          <div v-for="ch in report?.chapters || []" :key="ch.id" class="chip">
            <span>第{{ ch.number }}章 {{ ch.title }}</span>
            <small>{{ ch.overall == null ? '未审' : ch.overall }}</small>
          </div>
        </n-tab-pane>
      </n-tabs>
      <n-button type="primary" block style="margin-top: 12px" @click="saveNovel">保存设定</n-button>
    </aside>

    <section class="mid">
      <div class="mid-head">
        <h3>章节</h3>
        <n-button size="small" @click="addChapter">新建</n-button>
      </div>
      <button
        v-for="ch in chapters"
        :key="ch.id"
        class="ch"
        :class="{ active: current?.id === ch.id, locked: (ch.lock_status || '') === 'locked' }"
        @click="selectChapter(ch)"
      >
        <strong>{{ chapterHeading(ch.number, ch.title) }}</strong>
        <small>{{ ch.word_count }} 字 · {{ lockLabel(ch) }} · {{ ch.status }}</small>
      </button>
    </section>

    <section class="right">
      <div v-if="current" class="editor">
        <div class="title-row">
          <span class="chap-no">第{{ current.number }}章</span>
          <n-input
            v-model:value="titleDraft"
            placeholder="自定义标题，如：开篇"
            :disabled="isLocked"
            style="flex: 1"
            @blur="saveTitle"
            @keydown.enter.prevent="saveTitle"
          />
          <n-button :disabled="isLocked" @click="saveChapter">保存正文</n-button>
          <n-button
            :type="isLocked ? 'warning' : 'default'"
            @click="toggleLock"
          >
            {{ isLocked ? '解锁' : '锁定' }}
          </n-button>
          <n-button @click="router.push(`/novels/${novelId}/read/${current.id}?from=write&chapter=${current.id}`)">预览</n-button>
          <n-button quaternary type="error" :disabled="isLocked" @click="removeChapter(current)">删除</n-button>
        </div>
        <p v-if="isLocked" class="lock-hint">本章已锁定（定稿只读）。锁定时会自动识别正文角色写入左侧列表；解锁后才能改内容或再生成。</p>
        <div class="gen">
          <n-select
            v-model:value="mode"
            :disabled="isLocked || generating || working"
            :options="[
              { label: '剧情模式', value: 'plot' },
              { label: '抽卡模式', value: 'lottery' },
            ]"
            style="width: 140px"
          />
          <n-input-number
            v-model:value="targetWords"
            :min="2000"
            :max="8000"
            :step="100"
            :disabled="isLocked || generating || working"
            style="width: 140px"
          />
          <label class="plan-switch">
            <n-switch v-model:value="useContentPlan" :disabled="isLocked || generating || working" size="small" />
            <span>内容规划</span>
          </label>
          <label
            class="think-switch"
            :title="thinking ? '生成与过审会先走思维链，更准，也会更慢' : '打开后按 DeepSeek 思考模式生成并过审'"
          >
            <n-switch v-model:value="thinking" size="small" :disabled="isLocked || generating || working" />
            <span>深度思考</span>
          </label>
          <n-button type="primary" :loading="generating" :disabled="isLocked || working" @click="generate">生成并过审</n-button>
          <n-button v-if="generating || working" @click="stopGenerate">停止</n-button>
        </div>
        <div class="plot-row">
          <n-input
            v-model:value="instruction"
            type="textarea"
            placeholder="本章剧情要点：可改慢节奏、删掉赶剧情的事件。保存后生成会按这里写。下一章也会在这里预填。"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :disabled="isLocked"
            :readonly="isLocked"
          />
          <n-button size="small" :disabled="isLocked || generating || working" @click="savePlotBrief">保存剧情要点</n-button>
        </div>
        <div v-if="nextChapterPreview" class="next-preview">
          <strong>已更新第{{ nextChapterPreview.number }}章主要内容（打开该章可在剧情要点框看到）</strong>
          <p>第{{ nextChapterPreview.number }}章 {{ nextChapterPreview.title }}</p>
          <p>{{ nextChapterPreview.summary }}</p>
        </div>
        <details v-if="latestPlan" class="plan-preview" open>
          <summary>本章场景规划（内容规划 Agent）</summary>
          <pre>{{ latestPlan }}</pre>
        </details>
        <details v-if="reasoning" class="think-box" :open="generating || working">
          <summary>{{ generating || working ? '正在思考' : '思考过程' }}</summary>
          <pre>{{ reasoning }}</pre>
        </details>
        <div class="arc-box">
          <div class="optimize-head">
            <div class="optimize-title">
              <strong>剧集</strong>
              <span class="think-hint">先定本卷有几季，再写章；不是每章都要爆点</span>
            </div>
            <div class="arc-actions">
              <n-button
                type="primary"
                size="small"
                :loading="arcWorking"
                :disabled="generating || working || arcWorking"
                @click="runVolumePlan"
              >
                规划本卷剧集
              </n-button>
              <n-button
                size="small"
                :loading="arcWorking"
                :disabled="generating || working || arcWorking"
                @click="runArcPlan"
              >
                {{ lastSeason ? '再规划一季' : '生成本季' }}
              </n-button>
              <n-button
                size="small"
                :loading="arcWorking"
                :disabled="generating || working || arcWorking || !lastSeason"
                @click="runNextSeason"
              >
                生成下一季
              </n-button>
            </div>
          </div>
          <div v-if="seasons.length" class="season-list">
            <button
              v-for="s in seasons"
              :key="s.id"
              type="button"
              class="season-chip"
              :class="{ active: lastSeason?.id === s.id }"
              @click="latestArc = { theme: s.theme, intro: s.intro, arc_summary: s.summary, season_hook: s.season_hook, next_theme: s.next_theme, next_preview: s.next_preview, start_number: s.start_number, end_number: s.end_number, chapters: s.chapters || [] }"
            >
              第{{ s.number }}季 {{ s.theme }}
              <small>第{{ s.start_number }}–{{ s.end_number }}章</small>
            </button>
          </div>
          <div class="arc-row">
            <n-input
              v-model:value="arcTheme"
              :placeholder="lastSeason?.next_theme ? `下一季主题，默认：${lastSeason.next_theme}` : '本季主题：如全国大比 / 秘境试炼'"
              :disabled="arcWorking || generating || working"
            />
            <n-input-number
              v-model:value="arcCount"
              :min="3"
              :max="30"
              :disabled="arcWorking || generating || working"
              style="width: 110px"
            />
            <n-input-number
              v-model:value="arcStart"
              :min="0"
              :max="500"
              :disabled="arcWorking || generating || working"
              placeholder="起始章"
              style="width: 110px"
            />
          </div>
          <n-input
            v-model:value="arcExtra"
            type="textarea"
            placeholder="补充要求（可选）。建议先点「规划本卷剧集」：先定本卷有几季、每季主线，再重梳已有章的剧情要点（不覆盖正文）。单季生成仍可用下面两个按钮。"
            :autosize="{ minRows: 2, maxRows: 4 }"
            :disabled="arcWorking || generating || working"
          />
          <p v-if="lastSeason" class="summary">
            上一季「{{ lastSeason.theme }}」钩子：{{ lastSeason.season_hook || '（尚未写明）' }}
            <template v-if="lastSeason.next_preview">；预告：{{ lastSeason.next_preview }}</template>
          </p>
          <details v-if="latestArc" class="plan-preview" open>
            <summary>
              「{{ latestArc.theme }}」第 {{ latestArc.start_number }}–{{ latestArc.end_number }} 章
            </summary>
            <p v-if="latestArc.intro" class="summary">介绍：{{ latestArc.intro }}</p>
            <p v-if="latestArc.arc_summary" class="summary">主线：{{ latestArc.arc_summary }}</p>
            <p v-if="latestArc.season_hook" class="summary">季末钩子：{{ latestArc.season_hook }}</p>
            <p v-if="latestArc.next_theme || latestArc.next_preview" class="summary">
              下一季{{ latestArc.next_theme ? `「${latestArc.next_theme}」` : '' }}：{{ latestArc.next_preview }}
            </p>
            <ul class="arc-list">
              <li v-for="ch in latestArc.chapters" :key="ch.number">
                <strong>第{{ ch.number }}章 {{ ch.title }}</strong>
                <span>{{ ch.summary }}</span>
              </li>
            </ul>
          </details>
          <p class="summary">
            先把一卷里的季定完，再写章。不是每章都要爆点：缓章用观察/恢复/对话。点「规划本卷剧集」会按当前卷重划季，并改写各章剧情要点（已有正文保留，可再按新要点生成/改写）。全国大比默认不进本卷下一季。
          </p>
        </div>
        <div class="gen wrap">
          <n-button type="primary" :disabled="generating || working" @click="runCoherenceBook">梳理前14章</n-button>
          <n-button :disabled="isLocked || generating || working" @click="runPipeline">再优化一遍</n-button>
          <n-button size="small" :disabled="isLocked || generating || working" @click="runJsonAgent('review')">审查</n-button>
          <n-button size="small" :disabled="isLocked || generating || working" @click="runDeai">去 AI 味</n-button>
          <n-button size="small" :disabled="generating || working" @click="runJsonAgent('reader')">读者</n-button>
          <n-button size="small" :disabled="isLocked || generating || working" @click="runRevise">按意见改写</n-button>
        </div>
        <div class="optimize-box">
          <div class="optimize-head">
            <div class="optimize-title">
              <strong>手动优化点</strong>
              <span class="think-hint">{{ thinking ? '已开深度思考（与上方开关同步）' : '可在上方打开深度思考' }}</span>
            </div>
            <n-button
              type="primary"
              size="small"
              :disabled="isLocked || generating || working || !current.content.trim()"
              :loading="working"
              @click="runOptimizeByNotes"
            >
              按优化点改写
            </n-button>
          </div>
          <n-input
            v-model:value="optimizeNotes"
            type="textarea"
            placeholder="像跟 AI 对话一样写你想改的地方。境界必须用左边「修炼体系」里已有的等级，不要自造。例如：写到「提示：零号序列…」就收束；把这句之前写细，并交代修炼等级（从低到高）和主角当前境界。"
            :autosize="{ minRows: 3, maxRows: 8 }"
            :disabled="isLocked || generating || working"
          />
          <p class="summary">改写会强制对照左边修炼体系：只许用表内境界，表外等级会改回去。你的优化点仍会落实，不会无故推倒重来；改完后自动更新下一章主要内容。</p>
        </div>
        <p class="summary">
          默认先走「内容规划 → 写作 → 章间接力 → 审查…」。第 2 章起会校验开场是否承接上一章钩子；不通过则自动改写（最多 2 次）。打开「深度思考」后整条链路都会用思考模式。
        </p>
        <p v-if="stageLabel" class="summary">{{ stageLabel }}</p>
        <div v-if="latestContinuity" class="continuity-box" :class="{ fail: !latestContinuity.pass }">
          <strong>
            章间接力
            {{ latestContinuity.pass ? '通过' : '未达标' }}
            （{{ latestContinuity.score }}/10）
          </strong>
          <p v-if="latestContinuity.prev_hook">钩子：{{ latestContinuity.prev_hook }}</p>
          <ul v-if="latestContinuity.issues.length">
            <li v-for="(item, idx) in latestContinuity.issues.slice(0, 4)" :key="idx">{{ item }}</li>
          </ul>
        </div>
        <n-input
          v-model:value="current.content"
          type="textarea"
          class="body"
          placeholder="正文"
          :autosize="{ minRows: 16, maxRows: 32 }"
          :disabled="isLocked"
          :readonly="isLocked"
        />
        <p v-if="current.summary" class="summary">摘要：{{ current.summary }}</p>
        <div v-if="latestReview || latestReader" class="quality">
          <div v-if="latestReview" class="qcard">
            <h4>审查 {{ latestReview.overall }}</h4>
            <RadarChart :scores="latestReview.scores" />
            <ul>
              <li v-for="(item, idx) in (latestReview.issues || []).slice(0, 6)" :key="idx">{{ issueText(item) }}</li>
            </ul>
          </div>
          <div v-if="latestReader" class="qcard">
            <h4>读者 {{ latestReader.overall }}</h4>
            <RadarChart :scores="latestReader.scores || {}" />
            <p class="summary">{{ latestReader.comment }}</p>
            <ul>
              <li v-for="(item, idx) in (latestReader.issues || []).slice(0, 4)" :key="'r' + idx">{{ issueText(item) }}</li>
            </ul>
          </div>
        </div>
      </div>
      <div v-else class="empty">还没有章节。在对话里确认大纲后会生成目录，也可以在左边新建一章。</div>
    </section>
  </div>
</template>

<style scoped>
.row-nav {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.studio {
  display: grid;
  grid-template-columns: 280px 220px 1fr;
  gap: 12px;
  height: calc(100vh - 96px);
}
.left,
.mid,
.right {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 12px;
  overflow: auto;
}
.stack,
.chip {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.chip {
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
  font-size: 13px;
  border-top: 1px solid var(--line);
  padding-top: 8px;
}
.chip small {
  display: block;
  color: var(--muted);
}
.outline {
  padding-left: 16px;
  color: var(--muted);
  font-size: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.outline > li {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.outline strong {
  color: var(--text);
  display: block;
}
.outline-meta {
  display: block;
  color: var(--muted);
}
.outline-seasons {
  list-style: none;
  margin: 4px 0 0;
  padding: 0 0 0 10px;
  border-left: 2px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.outline-seasons strong {
  font-weight: 600;
}
.outline-seasons small {
  display: block;
  color: var(--muted);
  line-height: 1.4;
}
.mid-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
h3 {
  margin: 0;
}
.ch {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  border-bottom: 1px solid var(--line);
  color: inherit;
  padding: 10px 4px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ch.active {
  color: var(--accent);
}
.ch.locked strong::after {
  content: ' · 锁';
  font-weight: 500;
  opacity: 0.75;
}
.ch small {
  color: var(--muted);
}
.lock-hint {
  margin: 0;
  font-size: 13px;
  color: var(--muted);
}
.editor {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 100%;
}
.title-row,
.gen {
  display: flex;
  gap: 8px;
  align-items: center;
}
.chap-no {
  flex: none;
  font-size: 14px;
  color: var(--muted);
}
.gen.wrap {
  flex-wrap: wrap;
}
.optimize-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #12151c;
}
.arc-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: #10141c;
}
.arc-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.arc-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.season-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.season-chip {
  border: 1px solid var(--line);
  background: #161b24;
  color: inherit;
  border-radius: 8px;
  padding: 6px 8px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  font-size: 12px;
}
.season-chip.active {
  border-color: var(--accent);
  color: var(--accent);
}
.season-chip small {
  color: var(--muted);
  font-size: 11px;
}
.arc-list {
  margin: 8px 0 0;
  padding-left: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.arc-list li {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 13px;
  color: var(--muted);
}
.arc-list strong {
  color: inherit;
}
.optimize-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.optimize-head strong {
  font-size: 13px;
}
.optimize-title {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.think-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
}
.think-hint {
  color: var(--muted);
  font-size: 12px;
  font-weight: normal;
}
.think-box {
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: #10131a;
  color: var(--muted);
  font-size: 12px;
}
.think-box summary {
  cursor: pointer;
  color: var(--accent);
}
.think-box pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  line-height: 1.65;
  font-family: inherit;
}
.plan-switch {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--muted);
  font-size: 12px;
  white-space: nowrap;
}
.plot-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
}
.plot-row > .n-button {
  align-self: flex-end;
}
.plan-preview {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  background: #12151c;
}
.plan-preview summary {
  cursor: pointer;
  color: var(--accent);
  font-size: 13px;
}
.plan-preview pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
  font-family: inherit;
}
.next-preview {
  border: 1px dashed var(--accent);
  border-radius: 10px;
  padding: 10px;
  background: #12151c;
}
.next-preview strong {
  display: block;
  font-size: 13px;
  margin-bottom: 6px;
}
.next-preview p {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.hint {
  color: var(--muted);
  font-size: 12px;
}
.quality {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.qcard {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px;
}
.qcard h4 {
  margin: 0 0 6px;
  font-size: 13px;
}
.qcard ul {
  margin: 0;
  padding-left: 16px;
  color: var(--muted);
  font-size: 12px;
}
.body :deep(textarea) {
  min-height: 380px;
}
.summary {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.continuity-box {
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #12161f;
  font-size: 13px;
}
.continuity-box.fail {
  border-color: #a85b4a;
}
.continuity-box p,
.continuity-box ul {
  margin: 6px 0 0;
  color: var(--muted);
}
.continuity-box ul {
  padding-left: 1.2em;
}
.empty {
  color: var(--muted);
  padding: 40px 12px;
}
</style>
