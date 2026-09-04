<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import {
  Columns2,
  Download,
  FileDown,
  FilePlus2,
  FolderOpen,
  PanelLeft,
  Save,
  Settings,
} from "lucide-vue-next";

export type TopTab = "home" | "docs" | "library" | "refine" | "insight";

defineProps<{
  active: TopTab;
  currentFileName?: string;
  /** Whether the docs view is currently in split (分栏) mode. */
  splitMode?: boolean;
}>();

const emit = defineEmits<{
  (e: "toggleSidebar"): void;
  (e: "select", tab: TopTab): void;
  (e: "openSettings"): void;
  (e: "importFile"): void;
  (e: "saveFile"): void;
  (e: "saveFileAs"): void;
  (e: "backupData"): void;
  (e: "toggleSplit"): void;
}>();

const fileMenuOpen = ref(false);
const fileMenuRef = ref<HTMLDivElement | null>(null);

/** Windows/Linux show "Ctrl", macOS shows the command glyph. */
const modKey =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)
    ? "\u2318"
    : "Ctrl";

function toggleFileMenu() {
  fileMenuOpen.value = !fileMenuOpen.value;
}

function runFileAction(action: "import" | "save" | "saveAs") {
  fileMenuOpen.value = false;
  if (action === "import") emit("importFile");
  else if (action === "save") emit("saveFile");
  else emit("saveFileAs");
}

function onDocumentClick(event: MouseEvent) {
  if (!fileMenuOpen.value) return;
  const root = fileMenuRef.value;
  if (root && !root.contains(event.target as Node)) {
    fileMenuOpen.value = false;
  }
}

function onDocumentKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") fileMenuOpen.value = false;
}

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onDocumentKeydown);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onDocumentKeydown);
});
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <div ref="fileMenuRef" class="file-menu-wrap">
        <button
          class="icon-btn"
          :class="{ active: fileMenuOpen }"
          title="文件：导入 / 保存到本地"
          @click.stop="toggleFileMenu"
        >
          <FolderOpen :size="20" :stroke-width="1.7" />
        </button>

        <Transition name="file-menu">
          <div v-if="fileMenuOpen" class="file-menu" @click.stop>
            <button class="file-menu-item" @click="runFileAction('import')">
              <FilePlus2 :size="15" :stroke-width="1.8" />
              <span class="file-menu-label">导入文件</span>
              <span class="file-menu-hint">{{ modKey }}+O</span>
            </button>
            <button class="file-menu-item" @click="runFileAction('save')">
              <Save :size="15" :stroke-width="1.8" />
              <span class="file-menu-label">保存到本地</span>
              <span class="file-menu-hint">{{ modKey }}+S</span>
            </button>
            <button class="file-menu-item" @click="runFileAction('saveAs')">
              <FileDown :size="15" :stroke-width="1.8" />
              <span class="file-menu-label">另存为…</span>
              <span class="file-menu-hint">{{ modKey }}+Shift+S</span>
            </button>
            <div class="file-menu-divider"></div>
            <div class="file-menu-note">
              {{ currentFileName || "未命名文档" }}
            </div>
          </div>
        </Transition>
      </div>

      <button class="icon-btn" title="备份数据" @click="emit('backupData')">
        <Download :size="20" :stroke-width="1.7" />
      </button>

      <button
        class="icon-btn"
        :class="{ active: splitMode }"
        title="分栏：左右并排打开两个文档，便于对比参考"
        @click="emit('toggleSplit')"
      >
        <Columns2 :size="20" :stroke-width="1.7" />
      </button>

      <nav class="top-nav">
        <button
          class="nav-link"
          :class="{ active: active === 'home' }"
          title="主页：最近文档、置顶、写作进度"
          @click="emit('select', 'home')"
        >
          主页
        </button>
        <button
          class="nav-link"
          :class="{ active: active === 'docs' }"
          @click="emit('select', 'docs')"
        >
          文档
        </button>
        <button
          class="nav-link"
          :class="{ active: active === 'library' }"
          @click="emit('select', 'library')"
        >
          写作
        </button>
        <button
          class="nav-link"
          :class="{ active: active === 'refine' }"
          @click="emit('select', 'refine')"
        >
          精修
        </button>
        <button
          class="nav-link"
          :class="{ active: active === 'insight' }"
          @click="emit('select', 'insight')"
        >
          洞察
        </button>
      </nav>
    </div>

    <div class="topbar-center" />

      <div class="topbar-right">
        <button
          v-if="active !== 'refine' && active !== 'home'"
          class="icon-btn"
          title="折叠/展开右侧"
          @click="emit('toggleSidebar')"
        >
          <PanelLeft :size="20" :stroke-width="1.7" />
        </button>
        <button class="icon-btn" title="系统设置" @click="emit('openSettings')">
          <Settings :size="20" :stroke-width="1.7" />
        </button>
      </div>
    </header>
</template>

<style scoped>
.topbar {
  height: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: var(--surface-bright);
  backdrop-filter: blur(12px);
  border-bottom: 1px solid var(--outline-variant);
  position: relative;
  z-index: 20;
}

.topbar-left,
.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.divider {
  width: 1px;
  height: 16px;
  background: var(--outline-variant);
  margin: 0 4px;
}

.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border-radius: 8px;
  color: var(--on-surface-variant);
  transition: background 0.18s ease, color 0.18s ease, transform 0.12s ease;
}

.icon-btn:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.icon-btn:active {
  transform: scale(0.94);
}

.icon-btn.active {
  background: rgba(var(--primary-rgb) / 0.12);
  color: var(--primary);
}

/* ---- File menu ---- */

.file-menu-wrap {
  position: relative;
  display: inline-flex;
}

.file-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  min-width: 216px;
  padding: 6px;
  border-radius: 12px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  box-shadow: var(--shadow-lg);
  z-index: 60;
}

.file-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  background: transparent;
  border-radius: 8px;
  cursor: pointer;
  color: var(--on-surface);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s ease, transform 0.1s ease;
}

.file-menu-item:hover {
  background: var(--surface-container-high);
}

.file-menu-item:active {
  transform: scale(0.98);
}

.file-menu-item svg {
  flex-shrink: 0;
  color: var(--on-surface-variant);
}

.file-menu-label {
  flex: 1;
  min-width: 0;
}

.file-menu-hint {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.02em;
  color: var(--on-surface-variant);
  opacity: 0.8;
  font-family: var(--code-font);
}

.file-menu-divider {
  height: 1px;
  margin: 6px 2px;
  background: var(--outline-variant);
}

.file-menu-note {
  padding: 4px 10px;
  font-size: 11px;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-menu-enter-active,
.file-menu-leave-active {
  transition: opacity 0.16s cubic-bezier(0.16, 1, 0.3, 1), transform 0.16s cubic-bezier(0.16, 1, 0.3, 1);
}

.file-menu-enter-from,
.file-menu-leave-to {
  opacity: 0;
  transform: translateY(-6px) scale(0.98);
}

.top-nav {
  display: none;
  align-items: center;
  gap: 8px;
  margin-left: 16px;
}

@media (min-width: 768px) {
  .top-nav {
    display: flex;
  }
}

.nav-link {
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 18px;
  letter-spacing: 0.04em;
  font-weight: 600;
  color: var(--on-surface-variant);
  text-decoration: none;
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease, transform 0.12s ease;
}

.nav-link:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.nav-link:active {
  transform: scale(0.96);
}

.nav-link.active {
  color: var(--primary);
  background: rgba(var(--primary-rgb) / 0.1);
  border-color: rgba(var(--primary-rgb) / 0.2);
}
</style>
