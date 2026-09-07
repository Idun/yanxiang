<script setup lang="ts">
import { NButton, NInput, NTabPane, NTabs, useMessage } from 'naive-ui'
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { api } from '../api/client'
import FieldAiModal from '../components/FieldAiModal.vue'
import PowerSystemPanel from '../components/PowerSystemPanel.vue'
import { FIELD_AI, type AiField, type FieldAiConfig, type FieldContext } from '../lib/fieldAi'
import { coverUrl, formatChapterSpan, orphanSeasons, parseOutline, seasonsInVolume, volumeChapterSpan, volumeHeading } from '../lib/outline'
import { parsePowerSystem, stringifyPowerSystem } from '../lib/powerSystem'
import type { Character, NamedItem, Novel, Relationship, Season } from '../types'

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
const fileInput = ref<HTMLInputElement | null>(null)

const aiShow = ref(false)
const aiConfig = ref<FieldAiConfig | null>(null)

const volumes = computed(() => parseOutline(novel.value?.outline_json || '[]'))
const outlineOrphans = computed(() => orphanSeasons(seasons.value, volumes.value))
const hasOutlineStructure = computed(() => volumes.value.length > 0)

function volMeta(vol: (typeof volumes.value)[number]) {
  const span = volumeChapterSpan(vol)
  if (!span) return ''
  return `规划 ${span.count} 章（${formatChapterSpan(span.start, span.end)}）`
}

function seasonsOf(vol: (typeof volumes.value)[number]) {
  return seasonsInVolume(seasons.value, vol)
}
const hasChapterBreakdown = computed(() =>
  volumes.value.some((vol) => (vol.chapters || []).length > 0),
)

const fieldContext = computed<FieldContext | null>(() => {
  if (!novel.value) return null
  return {
    novel: novel.value,
    characterCount: characters.value.length,
    hasOutlineStructure: hasOutlineStructure.value,
    hasChapterBreakdown: hasChapterBreakdown.value,
    characters: characters.value,
    relationships: relationships.value,
    locations: locations.value,
    events: events.value,
  }
})

function openAi(field: AiField) {
  aiConfig.value = FIELD_AI[field]
  aiShow.value = true
}

async function load() {
  const state = await api.studioState(novelId.value)
  novel.value = state.novel
  characters.value = state.characters
  relationships.value = state.relationships
  locations.value = state.locations
  events.value = state.events
  try {
    seasons.value = await api.listSeasons(novelId.value)
  } catch {
    seasons.value = []
  }
  const parsedPower = parsePowerSystem(novel.value?.power_system || '')
  if (novel.value && parsedPower) novel.value.power_system = stringifyPowerSystem(parsedPower)
}

async function saveLeft() {
  if (!novel.value) return
  const parsedPower = parsePowerSystem(novel.value.power_system || '')
  if (parsedPower) novel.value.power_system = stringifyPowerSystem(parsedPower)
  novel.value = await api.updateNovel(novel.value.id, {
    title: novel.value.title,
    description: novel.value.description,
    genre: novel.value.genre,
    cover_prompt: novel.value.cover_prompt,
    world_bible: novel.value.world_bible,
    power_system: novel.value.power_system,
    premise: novel.value.premise,
  })
  message.success('作品资料已保存')
}

async function onCover(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !novel.value) return
  try {
    novel.value = await api.uploadCover(novel.value.id, file)
    message.success('封面已更新')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '上传失败')
  }
}

function charName(id: number) {
  return characters.value.find((c) => c.id === id)?.name || `#${id}`
}

async function pruneToProtagonist() {
  try {
    const result = await api.keepProtagonistOnly(novelId.value)
    await load()
    if (result.removed_count > 0) {
      message.success(`已只留男主，清除 ${result.removed_count} 人`)
    } else {
      message.info('角色表里本来就只有男主（或尚未登记）')
    }
  } catch (err) {
    message.error(err instanceof Error ? err.message : '清理失败')
  }
}

async function onAiConfirmed() {
  try {
    await load()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '刷新失败')
  }
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
  <div v-if="novel" class="studio">
    <header class="head">
      <div class="cover-row">
        <button class="cover" type="button" @click="fileInput?.click()">
          <img v-if="novel.has_cover" :src="coverUrl(novel.id, novel.updated_at)" alt="封面" />
          <span v-else>上传封面</span>
        </button>
        <input ref="fileInput" type="file" accept="image/jpeg,image/png,image/webp" hidden @change="onCover" />
        <div class="cover-meta">
          <n-input v-model:value="novel.title" placeholder="书名" />
          <n-input v-model:value="novel.genre" placeholder="类型" size="small" style="margin-top: 8px" />
          <p class="lead">完善各项设定；需要 AI 时点右侧按钮，确认后才会写入。</p>
          <div class="navs">
            <n-button size="tiny" @click="router.push(`/novels/${novel.id}/write`)">去写章</n-button>
            <n-button size="tiny" @click="router.push(`/novels/${novel.id}/read?from=studio`)">预览</n-button>
          </div>
        </div>
      </div>
    </header>

    <section class="panel">
      <n-tabs type="line" animated>
        <n-tab-pane name="intro" tab="简介">
          <div class="section-head">
            <div>
              <p class="label">封面提示词</p>
            </div>
            <n-button size="small" type="primary" secondary @click="openAi('naming')">AI</n-button>
          </div>
          <n-input
            v-model:value="novel.cover_prompt"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder="可用 AI 生成后确认写入"
          />
          <div class="section-head">
            <p class="label">故事简介</p>
          </div>
          <n-input v-model:value="novel.description" type="textarea" :autosize="{ minRows: 6, maxRows: 12 }" />
          <p class="label">灵感原话</p>
          <n-input
            v-model:value="novel.premise"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 8 }"
            placeholder="作者最初的想法，生成时会作为锁定上下文"
          />
        </n-tab-pane>

        <n-tab-pane name="world" tab="世界观">
          <div class="section-head">
            <p class="label">世界观设定</p>
            <n-button size="small" type="primary" secondary @click="openAi('world')">AI</n-button>
          </div>
          <n-input v-model:value="novel.world_bible" type="textarea" :autosize="{ minRows: 14, maxRows: 24 }" />
        </n-tab-pane>

        <n-tab-pane name="outline" tab="大纲">
          <div class="section-head">
            <p class="label">分卷 / 剧集（不列具体章节）</p>
            <div class="ai-group">
              <n-button size="small" type="primary" secondary @click="openAi('outline')">AI 大纲</n-button>
              <n-button size="small" secondary @click="openAi('chapters')">AI 拆章</n-button>
            </div>
          </div>
          <div v-if="!volumes.length" class="empty">还没有大纲。点「AI 大纲」生成分卷结构，确认后写入。</div>
          <article v-for="vol in volumes" :key="vol.volume" class="vol">
            <strong>{{ volumeHeading(vol.volume, vol.title) }}</strong>
            <p>{{ vol.summary }}</p>
            <p v-if="volMeta(vol)" class="muted">{{ volMeta(vol) }}</p>
            <div v-if="seasonsOf(vol).length" class="season-block">
              <p v-for="s in seasonsOf(vol)" :key="s.id">
                <strong>第{{ s.number }}季 {{ s.theme }}</strong>
                · {{ formatChapterSpan(s.start_number, s.end_number) }}
                <span v-if="s.intro || s.summary"> — {{ s.intro || s.summary }}</span>
              </p>
            </div>
            <p v-else-if="volMeta(vol)" class="muted">本卷剧集尚未规划（去写章页「剧集」生成）</p>
          </article>
          <article v-if="outlineOrphans.length" class="vol">
            <strong>未归卷剧集</strong>
            <p v-for="s in outlineOrphans" :key="'o' + s.id">
              第{{ s.number }}季 {{ s.theme }} · {{ formatChapterSpan(s.start_number, s.end_number) }}
            </p>
          </article>
        </n-tab-pane>

        <n-tab-pane name="bible" tab="角色">
          <div class="section-head">
            <p class="label">角色与设定</p>
            <div class="ai-group">
              <n-button
                size="small"
                secondary
                :disabled="!characters.length"
                @click="pruneToProtagonist"
              >
                只留男主
              </n-button>
              <n-button size="small" type="primary" secondary @click="openAi('bible')">AI</n-button>
            </div>
          </div>
          <p class="empty" style="margin-bottom: 8px">
            立项只登记男主；写章不拿整张角色表卡剧情。点「只留男主」可清掉配角与关系。
          </p>
          <div v-if="!characters.length" class="empty">还没有男主。点「AI」根据简介与世界观生成（只登记男主）。</div>
          <p v-for="c in characters" :key="c.id">
            <strong>{{ c.name }}</strong> · {{ c.role }} · {{ c.personality }}
          </p>
          <p v-for="r in relationships" :key="r.id">
            {{ charName(r.from_char_id) }} → {{ charName(r.to_char_id) }}（{{ r.relation_type }}）
          </p>
          <p v-for="loc in locations" :key="'l' + loc.id">场景：{{ loc.name }}</p>
          <p v-for="ev in events" :key="'e' + ev.id">伏笔：{{ ev.name }}</p>
        </n-tab-pane>

        <n-tab-pane name="power" tab="修炼体系">
          <div class="section-head">
            <p class="label">修炼 / 战力体系</p>
            <n-button size="small" type="primary" secondary @click="openAi('power')">AI</n-button>
          </div>
          <PowerSystemPanel v-model="novel.power_system" />
        </n-tab-pane>
      </n-tabs>
      <n-button block style="margin-top: 14px" @click="saveLeft">保存修改</n-button>
    </section>

    <FieldAiModal
      v-model:show="aiShow"
      :novel-id="novelId"
      :config="aiConfig"
      :novel="novel"
      :field-context="fieldContext"
      @confirmed="onAiConfirmed"
    />
  </div>
</template>

<style scoped>
.studio {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-width: 880px;
  margin: 0 auto;
  height: calc(100vh - 80px);
  min-height: 0;
}
.head,
.panel {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
}
.head {
  padding: 12px;
  flex-shrink: 0;
}
.panel {
  padding: 12px 14px 14px;
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.cover-row {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 10px;
}
.cover {
  width: 92px;
  height: 122px;
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
  font-size: 12px;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.lead {
  margin: 8px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}
.navs {
  display: flex;
  gap: 6px;
  margin-top: 8px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 4px;
}
.ai-group {
  display: flex;
  gap: 6px;
}
.label,
.empty,
.vol p,
.panel p {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.55;
}
.label {
  margin: 10px 0 4px;
}
.section-head .label {
  margin: 0;
}
.vol {
  margin-top: 10px;
}
.vol strong,
.panel p strong {
  color: var(--text);
}
.muted {
  color: var(--muted);
  font-size: 12px;
}
.season-block {
  margin-top: 6px;
  padding-left: 10px;
  border-left: 2px solid var(--line);
}
</style>
