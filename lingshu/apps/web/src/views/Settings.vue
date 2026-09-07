<script setup lang="ts">
import { NButton, NInput, NSelect, useMessage } from 'naive-ui'
import { onMounted, ref } from 'vue'
import { api } from '../api/client'
import type { Settings } from '../types'

const message = useMessage()
const loading = ref(false)
const probing = ref(false)
const form = ref({
  deepseek_api_key: '',
  deepseek_model: 'deepseek-v4-flash',
  deepseek_base_url: 'https://api.deepseek.com',
})
const current = ref<Settings | null>(null)
const models = [
  { label: 'deepseek-v4-flash（写章默认）', value: 'deepseek-v4-flash' },
  { label: 'deepseek-v4-pro（立项/复杂规划）', value: 'deepseek-v4-pro' },
]

async function load() {
  current.value = await api.getSettings()
  form.value.deepseek_model = current.value.deepseek_model
  form.value.deepseek_base_url = current.value.deepseek_base_url
}

async function save() {
  loading.value = true
  try {
    const payload: Record<string, string> = {
      deepseek_model: form.value.deepseek_model,
      deepseek_base_url: form.value.deepseek_base_url,
    }
    if (form.value.deepseek_api_key.trim()) {
      payload.deepseek_api_key = form.value.deepseek_api_key.trim()
    }
    current.value = await api.saveSettings(payload)
    form.value.deepseek_api_key = ''
    message.success('已保存到本地 data/settings.json')
  } catch (err) {
    message.error(err instanceof Error ? err.message : '保存失败')
  } finally {
    loading.value = false
  }
}

async function probe() {
  probing.value = true
  try {
    const result = await api.healthSettings()
    if (result.ok) message.success(result.message)
    else message.warning(result.message)
  } catch (err) {
    message.error(err instanceof Error ? err.message : '探测失败')
  } finally {
    probing.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="wrap">
    <h1>设置</h1>
    <p class="hint">API Key 只存在本机。搭建完成后再填写即可，没有 Key 时仍可管理作品与章节。</p>
    <p v-if="current" class="status">
      当前 Key：{{ current.has_api_key ? current.api_key_masked : '未填写' }}
    </p>
    <label>DeepSeek API Key</label>
    <n-input v-model:value="form.deepseek_api_key" type="password" show-password-on="mousedown" placeholder="留空则不改动已保存的 Key" />
    <label>模型</label>
    <n-select v-model:value="form.deepseek_model" :options="models" />
    <label>Base URL</label>
    <n-input v-model:value="form.deepseek_base_url" />
    <div class="row">
      <n-button type="primary" :loading="loading" @click="save">保存</n-button>
      <n-button :loading="probing" @click="probe">测试连接</n-button>
    </div>
  </div>
</template>

<style scoped>
.wrap {
  max-width: 560px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
h1 {
  margin: 0;
}
.hint,
.status {
  color: var(--muted);
  margin: 0 0 8px;
}
label {
  font-size: 13px;
  color: var(--muted);
  margin-top: 6px;
}
.row {
  display: flex;
  gap: 12px;
  margin-top: 12px;
}
</style>
