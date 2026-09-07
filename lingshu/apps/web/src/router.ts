import { createRouter, createWebHistory } from 'vue-router'
import Home from './views/Home.vue'
import NovelNew from './views/NovelNew.vue'
import Reader from './views/Reader.vue'
import Settings from './views/Settings.vue'
import Studio from './views/Studio.vue'
import Workspace from './views/Workspace.vue'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    { path: '/novels/new', name: 'novel-new', component: NovelNew },
    { path: '/novels/:id', name: 'studio', component: Studio, props: true, meta: { studio: true } },
    { path: '/novels/:id/write', name: 'workspace', component: Workspace, props: true },
    { path: '/novels/:id/read/:chapterId?', name: 'reader', component: Reader, props: true, meta: { plain: true } },
    { path: '/settings', name: 'settings', component: Settings },
  ],
})
