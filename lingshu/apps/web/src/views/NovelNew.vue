<script setup lang="ts">
import { NButton, useMessage } from 'naive-ui'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../api/client'

const router = useRouter()
const message = useMessage()
const loading = ref(false)

async function start() {
  loading.value = true
  try {
    const novel = await api.createNovel({ title: '未命名作品' })
    await router.push(`/novels/${novel.id}`)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '创建失败')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="wrap">
    <h1>创建作品</h1>
    <p class="hint">点开始后进入作品页。在简介、角色、大纲等字段旁点 AI，生成后可继续优化，确认才会写入对应信息。</p>
    <n-button type="primary" :loading="loading" @click="start">开始创作</n-button>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 640px;
}
h1 {
  margin: 0 0 8px;
}
.hint {
  color: var(--muted);
  margin: 0 0 20px;
  line-height: 1.7;
}
</style>
