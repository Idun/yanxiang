<script setup lang="ts">
import { NConfigProvider, NDialogProvider, NMessageProvider, darkTheme, dateZhCN, zhCN } from 'naive-ui'
import { RouterLink, RouterView, useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <n-config-provider :theme="darkTheme" :locale="zhCN" :date-locale="dateZhCN">
    <n-message-provider>
      <n-dialog-provider>
        <div class="shell">
          <header class="topbar">
            <RouterLink to="/" class="brand">
              <span class="mark">NOVA</span>
              <span class="sub">灵枢</span>
            </RouterLink>
            <nav>
              <RouterLink to="/" :class="{ active: route.name === 'home' }">作品</RouterLink>
              <RouterLink to="/novels/new" :class="{ active: route.name === 'novel-new' }">创建</RouterLink>
              <RouterLink to="/settings" :class="{ active: route.name === 'settings' }">设置</RouterLink>
            </nav>
          </header>
          <main class="main" :class="{ plain: route.meta.plain, studio: route.meta.studio }">
            <RouterView />
          </main>
        </div>
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  border-bottom: 1px solid var(--line);
  background: #12151c;
}
.brand {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.mark {
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--accent);
}
.sub {
  color: var(--muted);
  font-size: 13px;
}
nav {
  display: flex;
  gap: 18px;
  font-size: 14px;
}
nav a {
  color: var(--muted);
}
nav a.active,
nav a:hover {
  color: var(--text);
}
.main {
  flex: 1;
  padding: 20px 24px 32px;
}
.main.plain {
  padding: 0;
}
.main.studio {
  padding: 12px 16px;
  overflow: hidden;
}
</style>
