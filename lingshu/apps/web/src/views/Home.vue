<script setup lang="ts">
import { NButton, NEmpty, NSpin, useDialog, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'
import { coverUrl } from '../lib/outline'
import type { Novel } from '../types'

const router = useRouter()
const message = useMessage()
const dialog = useDialog()
const loading = ref(true)
const novels = ref<Novel[]>([])

const creating = ref(false)

async function load() {
  loading.value = true
  try {
    novels.value = await api.listNovels()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '加载失败')
  } finally {
    loading.value = false
  }
}

function confirmDelete(novel: Novel) {
  dialog.warning({
    title: '删除作品',
    content: `确定删除「${novel.title}」及其全部章节、设定？此操作不可恢复。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      await api.deleteNovel(novel.id)
      message.success('已删除')
      await load()
    },
  })
}

onMounted(load)

async function createWork() {
  creating.value = true
  try {
    const novel = await api.createNovel({ title: '未命名作品' })
    await router.push(`/novels/${novel.id}`)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '创建失败')
  } finally {
    creating.value = false
  }
}
</script>

<template>
  <div class="page">
    <div class="head">
      <div>
        <h1>作品库</h1>
        <p>点创建后直接聊。简介、角色、大纲都是先看稿，点确认才写入左边。</p>
      </div>
      <n-button type="primary" :loading="creating" @click="createWork">创建作品</n-button>
    </div>
    <n-spin :show="loading">
      <n-empty v-if="!loading && novels.length === 0" description="还没有小说。创建一个，把想法告诉 AI。">
        <template #extra>
          <n-button type="primary" :loading="creating" @click="createWork">创建第一部</n-button>
        </template>
      </n-empty>
      <div v-else class="grid">
        <article v-for="novel in novels" :key="novel.id" class="card" @click="router.push(`/novels/${novel.id}`)">
          <div class="cover">
            <img v-if="novel.has_cover" :src="coverUrl(novel.id, novel.updated_at)" alt="" />
            <span v-else>{{ novel.title.slice(0, 1) }}</span>
          </div>
          <div class="body">
            <div class="meta">
              <span class="genre">{{ novel.genre || '未分类' }}</span>
              <span>{{ novel.chapter_count }} 章 · {{ novel.word_count }} 字</span>
            </div>
            <h2>{{ novel.title }}</h2>
            <p>{{ novel.description || novel.premise || '暂无简介' }}</p>
            <div class="actions" @click.stop>
              <n-button size="small" @click="router.push(`/novels/${novel.id}`)">打开</n-button>
              <n-button size="small" @click="router.push(`/novels/${novel.id}/write`)">写章</n-button>
              <n-button size="small" @click="router.push(`/novels/${novel.id}/read?from=home`)">预览</n-button>
              <n-button size="small" quaternary type="error" @click="confirmDelete(novel)">删除</n-button>
            </div>
          </div>
        </article>
      </div>
    </n-spin>
  </div>
</template>

<style scoped>
.head {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 24px;
}
h1 {
  margin: 0 0 6px;
  font-size: 28px;
}
p {
  margin: 0;
  color: var(--muted);
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 16px;
}
.card {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: 12px;
  cursor: pointer;
  display: grid;
  grid-template-columns: 92px 1fr;
  min-height: 160px;
  overflow: hidden;
}
.card:hover {
  border-color: var(--accent);
}
.cover {
  background: #12151c;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
  font-size: 28px;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.body {
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.meta {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 12px;
}
.genre {
  color: var(--accent);
}
h2 {
  margin: 0;
  font-size: 18px;
}
.card p {
  flex: 1;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 13px;
  line-height: 1.6;
}
.actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 4px;
}
</style>
