<script setup lang="ts">
import { NButton, NInput, NInputNumber, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import { coverUrl, formatChapterSpan, orphanSeasons, outlineChapterCount, parseOutline, seasonsInVolume, volumeChapterSpan, volumeHeading } from '../lib/outline'
import type { Character, NamedItem, Novel, OutlineVolume, Relationship, Season } from '../types'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const novelId = computed(() => Number(route.params.id))

const novel = ref<Novel | null>(null)
const characters = ref<Character[]>([])
const relationships = ref<Relationship[]>([])
const locations = ref<NamedItem[]>([])
const events = ref<NamedItem[]>([])
const seasons = ref<Season[]>([])
const working = ref('')
const chapterCount = ref(30)
const extra = ref('')
const fileInput = ref<HTMLInputElement | null>(null)

const volumes = computed<OutlineVolume[]>(() => parseOutline(novel.value?.outline_json || '[]'))
const chapterTotal = computed(() => outlineChapterCount(volumes.value))
const outlineOrphans = computed(() => orphanSeasons(seasons.value, volumes.value))

function volMeta(vol: OutlineVolume) {
  const span = volumeChapterSpan(vol)
  if (!span) return ''
  return `规划 ${span.count} 章（${formatChapterSpan(span.start, span.end)}）`
}

function seasonsOf(vol: OutlineVolume) {
  return seasonsInVolume(seasons.value, vol)
}

async function load() {
  novel.value = await api.getNovel(novelId.value)
  characters.value = await api.listCharacters(novelId.value)
  relationships.value = await api.listRelationships(novelId.value)
  locations.value = await api.listLocations(novelId.value)
  events.value = await api.listEvents(novelId.value)
  try {
    seasons.value = await api.listSeasons(novelId.value)
  } catch {
    seasons.value = []
  }
}

async function saveMeta() {
  if (!novel.value) return
  novel.value = await api.updateNovel(novel.value.id, {
    title: novel.value.title,
    description: novel.value.description,
    genre: novel.value.genre,
    world_bible: novel.value.world_bible,
  })
  message.success('已保存书名和简介')
}

async function onCover(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !novel.value) return
  working.value = 'cover'
  try {
    novel.value = await api.uploadCover(novel.value.id, file)
    message.success('封面已更新')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '上传失败')
  } finally {
    working.value = ''
  }
}

async function runOutline() {
  working.value = 'outline'
  try {
    const result = await api.generateOutline(novelId.value, {
      chapter_count: chapterCount.value,
      instruction: extra.value,
    })
    novel.value = result.novel
    message.success(`已列出 ${chapterTotal.value} 章大纲，先看一遍再生成设定`)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '大纲失败')
  } finally {
    working.value = ''
  }
}

async function runBible() {
  if (!volumes.value.length) {
    message.warning('先让 AI 列出大纲')
    return
  }
  working.value = 'bible'
  try {
    const result = await api.generateBible(novelId.value)
    novel.value = result.novel
    await load()
    message.success('设定和章节目录已生成，可以去写章')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '设定失败')
  } finally {
    working.value = ''
  }
}

function charName(id: number) {
  return characters.value.find((c) => c.id === id)?.name || `#${id}`
}

onMounted(async () => {
  try {
    await load()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载失败')
  }
})
</script>

<template>
  <div v-if="novel" class="page">
    <section class="hero">
      <button class="cover" type="button" @click="fileInput?.click()">
        <img v-if="novel.has_cover" :src="coverUrl(novel.id, novel.updated_at)" alt="封面" />
        <span v-else>上传封面</span>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onCover" />
      </button>
      <div class="meta">
        <p class="step">第一步：把大纲列清楚。角色、关系、场景由 AI 补，不用手填。</p>
        <n-input v-model:value="novel.title" size="large" />
        <div class="row">
          <n-input v-model:value="novel.genre" placeholder="类型" style="width: 160px" />
          <n-button :disabled="!!working" @click="saveMeta">保存书名</n-button>
          <n-button :disabled="!!working || !chapterTotal" @click="router.push(`/novels/${novel.id}/read`)">预览</n-button>
          <n-button type="primary" :disabled="!!working || novel.chapter_count === 0" @click="router.push(`/novels/${novel.id}/write`)">去写章</n-button>
        </div>
        <n-input v-model:value="novel.description" type="textarea" :autosize="{ minRows: 3, maxRows: 6 }" />
      </div>
    </section>

    <section class="panel">
      <header>
        <h2>大纲</h2>
        <span class="muted">{{ chapterTotal ? `骨架约 ${chapterTotal} 章（大纲不列章名，看卷/季）` : '立项后还是骨架，点下面生成完整目录' }}</span>
      </header>
      <div class="row">
        <n-input-number v-model:value="chapterCount" :min="8" :max="80" :step="2" style="width: 140px" />
        <n-input v-model:value="extra" placeholder="可选：节奏/禁写/必须出现的人" />
        <n-button type="primary" :loading="working === 'outline'" :disabled="!!working" @click="runOutline">AI 列出大纲</n-button>
        <n-button :loading="working === 'bible'" :disabled="!!working" @click="runBible">确认大纲，生成设定和章节</n-button>
      </div>
      <div v-if="!volumes.length" class="empty">还没有大纲。先点「AI 列出大纲」。</div>
      <article v-for="vol in volumes" :key="vol.volume" class="volume">
        <h3>{{ volumeHeading(vol.volume, vol.title) }}</h3>
        <p>{{ vol.summary }}</p>
        <p v-if="volMeta(vol)" class="muted">{{ volMeta(vol) }}</p>
        <ul v-if="seasonsOf(vol).length" class="season-outline">
          <li v-for="s in seasonsOf(vol)" :key="s.id">
            <strong>第{{ s.number }}季 {{ s.theme }}</strong>
            <span>{{ formatChapterSpan(s.start_number, s.end_number) }}</span>
            <span v-if="s.intro || s.summary">{{ s.intro || s.summary }}</span>
          </li>
        </ul>
        <p v-else class="muted">
          {{ volMeta(vol) ? '本卷剧集尚未规划；章节细节在写章页目录中查看。' : '这是立项骨架，细化后会拆成可写的章节。' }}
        </p>
      </article>
      <article v-if="outlineOrphans.length" class="volume">
        <h3>未归卷剧集</h3>
        <ul class="season-outline">
          <li v-for="s in outlineOrphans" :key="'o' + s.id">
            <strong>第{{ s.number }}季 {{ s.theme }}</strong>
            <span>{{ formatChapterSpan(s.start_number, s.end_number) }}</span>
          </li>
        </ul>
      </article>
    </section>

    <section class="panel">
      <header>
        <h2>世界观</h2>
        <n-button size="small" :disabled="!!working" @click="saveMeta">保存</n-button>
      </header>
      <n-input v-model:value="novel.world_bible" type="textarea" :autosize="{ minRows: 8, maxRows: 16 }" />
    </section>

    <section class="panel">
      <header>
        <h2>设定（AI 生成）</h2>
        <span class="muted">角色、关系、场景、伏笔会在确认大纲后自动写入</span>
      </header>
      <div v-if="!characters.length && !locations.length" class="empty">确认大纲后，这里会出现角色和场景。</div>
      <div v-else class="bible">
        <div>
          <h4>角色</h4>
          <p v-for="c in characters" :key="c.id"><strong>{{ c.name }}</strong> · {{ c.role }} · {{ c.personality }}</p>
        </div>
        <div>
          <h4>关系</h4>
          <p v-for="r in relationships" :key="r.id">{{ charName(r.from_char_id) }} → {{ charName(r.to_char_id) }}（{{ r.relation_type }}）</p>
        </div>
        <div>
          <h4>场景 / 伏笔</h4>
          <p v-for="loc in locations" :key="'l' + loc.id">{{ loc.name }}</p>
          <p v-for="ev in events" :key="'e' + ev.id">伏笔：{{ ev.name }}</p>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 980px;
}
.hero,
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 16px;
}
.hero {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: 16px;
}
.cover {
  width: 140px;
  height: 186px;
  border: 1px dashed var(--line);
  border-radius: 8px;
  background: #12151c;
  color: var(--muted);
  cursor: pointer;
  overflow: hidden;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.meta,
.panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.step,
.muted,
.empty {
  color: var(--muted);
  font-size: 13px;
  margin: 0;
}
.row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}
header {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}
h2,
h3,
h4 {
  margin: 0;
}
.volume {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.volume p,
.volume span,
.bible p {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.65;
  margin: 6px 0 0;
}
.volume strong,
.bible strong {
  color: var(--text);
}
.season-outline {
  list-style: none;
  margin: 8px 0 0;
  padding: 0 0 0 12px;
  border-left: 2px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.season-outline li {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.season-outline span {
  margin: 0;
}
ol {
  margin: 8px 0 0;
  padding-left: 20px;
}
.bible {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 16px;
}
</style>
