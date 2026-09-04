<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { FileText, Save, X } from "lucide-vue-next";
import { cardEvents, requestCloseMap } from "./cardEvents";
import { docStore } from "./docStore";
import { libraryStore } from "./libraryStore";
import { aiSettings } from "./settings";
import AiSettingsPanel from "./components/AiSettingsPanel.vue";
import ChatSidebar from "./components/ChatSidebar.vue";
import DocumentViewer from "./components/DocumentViewer.vue";
import HomeView from "./components/HomeView.vue";
import InsightView from "./components/InsightView.vue";
import LibraryView from "./components/LibraryView.vue";
import RefineView from "./components/RefineView.vue";
import TopAppBar, { type TopTab } from "./components/TopAppBar.vue";
import {
  JSON_PICKER_TYPES,
  TEXT_PICKER_TYPES,
  downloadTextFileWithDialog,
  openTextFilesWithDialog,
  writeToHandle,
} from "./download";
import { activeDocFile, createDocFile, documentFilesStore, renameDocFile, selectDocFile } from "./documentFilesStore";
import { showToast } from "./insightStore";

/* 启动落在主页：先看到最近文档与写作进度，再决定进入哪个工作区。 */
const activeTab = ref<TopTab>("home");
const settingsOpen = ref(false);

/* Right-panel open state, decoupled independently for every tab.
   The writing (library) view defaults to expanded; other views are collapsed.
   主页不需要 AI 侧栏，保持关闭。 */
const sidebarStates = reactive<Record<TopTab, boolean>>({
  home: false,
  docs: false,
  library: true,
  refine: false,
  insight: false,
});

const sidebarOpen = computed({
  get: () => sidebarStates[activeTab.value],
  set: (val: boolean) => {
    sidebarStates[activeTab.value] = val;
  },
});

function onSelectTab(tab: TopTab) {
  activeTab.value = tab;
}

/** 主页跳转：切到目标工作区。 */
function onHomeNavigate(tab: Exclude<TopTab, "home">) {
  activeTab.value = tab;
}

/** 主页点开某个文档：选中它并进入「文档」界面。 */
function onHomeOpenDoc(fileId: string) {
  selectDocFile(fileId);
  activeTab.value = "docs";
}

/* 离开写作画布时自动收起故事地图：让「写作卡片（画布）」与「地图地点」各自
   只进入自己的界面，互不耦合（地图打开状态不再滞留到下一次进入画布）。 */
watch(activeTab, (tab) => {
  if (tab !== "library") requestCloseMap();
});

const documentModel = computed({
  get: () => docStore.markdown,
  set: (val: string) => {
    docStore.markdown = val;
  },
});

/* 分栏：右侧 pane 独立绑定第二个文档。 */
const splitMode = ref(false);
/* 左右分栏各自的文档面板折叠状态：分栏时左折叠、右展开。 */
const leftSidebarCollapsed = ref(false);
const rightSidebarCollapsed = ref(false);
/* 左右分栏宽度占比（左栏百分比），可拖拽中间分隔线调整。 */
const splitRatio = ref(50);
const splitDragging = ref(false);
const docsSplitRef = ref<HTMLDivElement | null>(null);

const splitDocumentModel = computed({
  get: () => docStore.secondaryMarkdown,
  set: (val: string) => {
    docStore.secondaryMarkdown = val;
  },
});

function toggleSplit() {
  splitMode.value = !splitMode.value;
  if (splitMode.value) {
    /* 打开分栏时，自动给右侧 pane 挑一个不同的文档。 */
    const active = documentFilesStore.activeFileId;
    const current = documentFilesStore.activeFileId2;
    if (!current || !documentFilesStore.files.some((f) => f.id === current)) {
      const other = documentFilesStore.files.find((f) => f.id !== active);
      documentFilesStore.activeFileId2 = other?.id ?? null;
    }
    leftSidebarCollapsed.value = true;
    rightSidebarCollapsed.value = false;
    splitRatio.value = 50;
  } else {
    leftSidebarCollapsed.value = false;
  }
}

/** 拖拽中间分隔线调整左右宽度占比。 */
function startSplitDrag(event: MouseEvent) {
  event.preventDefault();
  splitDragging.value = true;

  const move = (e: MouseEvent) => {
    const el = docsSplitRef.value;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = ((e.clientX - rect.left) / rect.width) * 100;
    splitRatio.value = Math.min(80, Math.max(20, ratio));
  };
  const up = () => {
    splitDragging.value = false;
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", up);
  };
  window.addEventListener("mousemove", move);
  window.addEventListener("mouseup", up);
}

watch(
  () => cardEvents.isDraggingMessage,
  (dragging) => {
    if (dragging) {
      activeTab.value = "library";
    }
  },
);

function importFile() {
  void (async () => {
    const picked = await openTextFilesWithDialog();
    if (picked.length === 0) return;

    activeTab.value = "docs";

    /* 逐一导入：每个文件新建一个文档条目，并记下其磁盘句柄。 */
    const imported: string[] = [];
    for (const f of picked) {
      const file = createDocFile(null, fileTitle(f.name));
      file.content = f.content;
      documentFilesStore.activeFileId = file.id;
      if (f.handle) fileHandles.set(file.id, f.handle);
      imported.push(file.id);
    }

    /* 最后一个导入的文档作为当前活动文档显示。 */
    const lastId = imported[imported.length - 1];
    const last = documentFilesStore.files.find((fl) => fl.id === lastId);
    if (last) docStore.markdown = last.content;

    showToast(
      "已导入文件",
      picked.length > 1 ? `共导入 ${picked.length} 个文件` : picked[0].name,
      "habit",
    );
  })();
}

function fileTitle(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

/* ---------------- Save to local ---------------- */

type WritableHandle = { createWritable(): Promise<{ write(c: string): Promise<void>; close(): Promise<void> }> };

/** Remembers the OS file each document tab is bound to, so 保存 can skip the dialog. */
const fileHandles = new Map<string, WritableHandle>();

function currentFileName(): string {
  return activeDocFile()?.title ?? "未命名文档";
}

const topbarFileName = computed(() => {
  void documentFilesStore.activeFileId;
  return currentFileName();
});

function withMarkdownExtension(name: string): string {
  return /\.(md|markdown|txt)$/i.test(name) ? name : `${name.replace(/[\\/:*?"<>|]/g, "_")}.md`;
}

/** 已关联的本地文件的展示名：优先用句柄自带的文件名，否则回退到文档标题。 */
function boundFileName(handle: WritableHandle | undefined): string {
  const name = (handle as { name?: string } | undefined)?.name;
  if (name) return name;
  return withMarkdownExtension(currentFileName());
}

/** Ctrl+S / 工具栏「保存」——
    1. 已关联/导入过本地文件：弹出项目样式的「保存更改」确认弹窗（包含【保存更改】和【取消】按钮）；
    2. 未关联本地文件：弹出项目样式的「同步到本地文件」引导弹窗（引导另存为建立关联）。 */
async function saveFlow() {
  const active = activeDocFile();
  const handle = active ? fileHandles.get(active.id) : undefined;

  if (handle) {
    openOverwriteDialog();
  } else {
    openSaveDialog();
  }
}

/** Ctrl+Shift+S — always ask for a destination path. */
async function saveFileAs() {
  const active = activeDocFile();
  const suggested = withMarkdownExtension(currentFileName());
  const result = await downloadTextFileWithDialog(
    suggested,
    docStore.markdown,
    "text/markdown;charset=utf-8",
    TEXT_PICKER_TYPES,
  );
  if (!result.saved) return;

  if (active && result.handle) {
    fileHandles.set(active.id, result.handle as WritableHandle);
    if (result.handle.name) renameDocFile(active.id, result.handle.name);
  }
  showToast("已保存到本地", result.handle?.name ?? suggested, "habit");
}

async function backupData() {
  const cards = libraryStore.cards.map((c) => ({ title: c.title, content: c.content }));

  const payload = {
    exportedAt: new Date().toISOString(),
    writingCards: cards,
    settings: {
      provider: aiSettings.provider,
      url: aiSettings.url,
      model: aiSettings.model,
      auditorModel: aiSettings.auditorModel,
    },
    document: docStore.markdown,
  };
  const fileName = `yanxiang_backup_${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  await downloadTextFileWithDialog(
    fileName,
    JSON.stringify(payload, null, 2),
    "application/json;charset=utf-8",
    JSON_PICKER_TYPES,
  );
}

/* ---------------- 全局禅定专注模式 ---------------- */
const zenMode = ref<"markdown" | "preview" | "off">("off");

/* ---------------- 项目样式的「保存更改」对话框 ----------------
   针对已导入 / 已关联本地文件的文档，Ctrl+S 保存时替代浏览器原生的
   “是否将所做更改保存到”提示弹窗，与“同步到本地文件”弹窗完全分开。 */

const overwriteDialogOpen = ref(false);
const overwriteFileName = ref("");
const overwriteCharCount = ref(0);
const overwritePrimaryRef = ref<HTMLButtonElement | null>(null);

function openOverwriteDialog() {
  const active = activeDocFile();
  const handle = active ? fileHandles.get(active.id) : undefined;
  overwriteFileName.value = boundFileName(handle);
  overwriteCharCount.value = docStore.markdown.length;
  overwriteDialogOpen.value = true;
  nextTick(() => overwritePrimaryRef.value?.focus());
}

function closeOverwriteDialog() {
  overwriteDialogOpen.value = false;
}

async function confirmOverwriteSave() {
  overwriteDialogOpen.value = false;
  const active = activeDocFile();
  const content = docStore.markdown;
  const handle = active ? fileHandles.get(active.id) : undefined;

  if (handle && (await writeToHandle(handle, content))) {
    showToast("已保存到本地", boundFileName(handle), "habit");
    return;
  }
  void saveFileAs();
}

/* ---------------- 项目样式的「同步到本地文件」对话框 ----------------
   浏览器 / WebView 对 Ctrl+S 有各自的原生「保存网页」弹窗（样式不可控），
   这里在捕获阶段彻底掐掉浏览器默认行为，改用项目的保存面板。

   语义（与应用内数据库的实时自动保存解耦）：
   - 应用内数据库：正文与文档树始终实时自动落盘，无需任何手动保存；
   - Ctrl+S 的唯一职责是「同步到本地文件」：已关联过弹窗询问「保存更改」，
     没关联过弹这个面板，引导一次「另存为本地文件」建立关联。 */

const saveDialogOpen = ref(false);
const saveFileName = ref("未命名文档");
const saveCharCount = ref(0);
const savePrimaryRef = ref<HTMLButtonElement | null>(null);

function openSaveDialog() {
  saveFileName.value = currentFileName();
  saveCharCount.value = docStore.markdown.length;
  saveDialogOpen.value = true;
  nextTick(() => savePrimaryRef.value?.focus());
}

function closeSaveDialog() {
  saveDialogOpen.value = false;
}

/** Ctrl+S 目标动作二：未关联本地文件的文档，就地另存为并建立关联。 */
function saveFileAsFromDialog() {
  saveDialogOpen.value = false;
  void saveFileAs();
}

/* ---------------- Global shortcuts ---------------- */

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") {
    if (overwriteDialogOpen.value) {
      closeOverwriteDialog();
      return;
    }
    if (saveDialogOpen.value) {
      closeSaveDialog();
      return;
    }
    if (zenMode.value !== "off") {
      zenMode.value = "off";
      return;
    }
  }

  const mod = event.ctrlKey || event.metaKey;
  if (!mod || event.altKey) return;

  const key = event.key.toLowerCase();

  if (key === "s") {
    /* 捕获阶段掐断浏览器 / WebView 的「保存网页」默认行为。
       Ctrl+S = 同步到本地文件（已关联则静默覆盖，未关联则引导另存）；Shift+S = 总是另存。 */
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.shiftKey) void saveFileAs();
    else void saveFlow();
    return;
  }
  if (key === "o" && !event.shiftKey) {
    event.preventDefault();
    importFile();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onGlobalKeydown, true);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onGlobalKeydown, true);
});
</script>

<template>
  <div class="app-shell" :class="{ 'zen-active': zenMode !== 'off' }">
    <div class="app-main">
      <TopAppBar
        v-if="zenMode === 'off'"
        :active="activeTab"
        :current-file-name="topbarFileName"
        :split-mode="splitMode"
        @toggleSidebar="sidebarOpen = !sidebarOpen"
        @select="onSelectTab"
        @openSettings="settingsOpen = true"
        @importFile="importFile"
        @saveFile="saveFlow"
        @saveFileAs="saveFileAs"
        @backupData="backupData"
        @toggleSplit="toggleSplit"
      />

      <div class="app-body">
        <main class="main-panel">
          <HomeView
            v-if="activeTab === 'home'"
            @navigate="onHomeNavigate"
            @openDoc="onHomeOpenDoc"
            @importFile="importFile"
          />
          <div v-show="activeTab === 'docs'" ref="docsSplitRef" class="docs-split">
            <DocumentViewer
              v-model="documentModel"
              v-model:sidebarCollapsed="leftSidebarCollapsed"
              class="docs-pane"
              :style="splitMode ? { flex: `0 0 ${splitRatio}%` } : undefined"
              :zen-mode="zenMode"
              @toggleZen="(m) => (zenMode = m)"
            />
            <div
              v-if="splitMode"
              class="docs-split-divider"
              :class="{ dragging: splitDragging }"
              title="拖动调整左右宽度"
              @mousedown="startSplitDrag"
            ></div>
            <DocumentViewer
              v-if="splitMode"
              v-model="splitDocumentModel"
              v-model:sidebarCollapsed="rightSidebarCollapsed"
              class="docs-pane"
              secondary
            />
          </div>
          <LibraryView
            v-show="activeTab === 'library'"
            :sidebar-open="sidebarStates.library"
            @requestSidebar="(open: boolean) => (sidebarStates.library = open)"
          />
          <RefineView v-show="activeTab === 'refine'" />
          <InsightView v-show="activeTab === 'insight'" />
        </main>
      </div>
    </div>

    <ChatSidebar
      v-if="sidebarOpen && activeTab !== 'refine' && activeTab !== 'home'"
      :active-main-tab="activeTab"
      @close="sidebarOpen = false"
    />
    <AiSettingsPanel v-if="settingsOpen" @close="settingsOpen = false" />

    <!-- 项目样式的「保存更改」面板：出现在已导入 / 已关联本地文件的 Ctrl+S 场景，
         替代浏览器原生的“是否将所做更改保存到”提示弹窗。 -->
    <Teleport to="body">
      <Transition name="save-modal">
        <div v-if="overwriteDialogOpen" class="save-modal-mask" @click.self="closeOverwriteDialog">
          <div class="save-modal-shell" role="dialog" aria-modal="true" aria-label="保存更改">
            <div class="save-modal-header">
              <span class="save-modal-title">保存更改</span>
              <button class="save-modal-close" title="取消 (Esc)" @click="closeOverwriteDialog">
                <X :size="16" :stroke-width="1.8" />
              </button>
            </div>
            <div class="save-modal-body">
              <p class="save-modal-ask">是否将所做更改保存到「{{ overwriteFileName }}」？</p>
              <p class="save-modal-hint">
                应用内已实时保存当前修改。点击「保存更改」会将更新内容同步写回绑定的本地文件。
              </p>
              <div class="save-modal-file">
                <FileText :size="14" :stroke-width="1.8" />
                <span class="save-modal-file-name">{{ overwriteFileName }}</span>
                <span class="save-modal-chars num-tabular">{{ overwriteCharCount }} 字符</span>
              </div>
            </div>
            <div class="save-modal-footer">
              <button class="save-modal-btn cancel" @click="closeOverwriteDialog">取消</button>
              <button ref="overwritePrimaryRef" class="save-modal-btn primary" @click="confirmOverwriteSave">
                <Save :size="13" :stroke-width="1.8" />
                保存更改
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>

    <!-- 项目样式的保存面板：仅出现在「尚未关联本地文件」的 Ctrl+S 场景，
         替代浏览器/WebView 原生「保存网页」弹窗。 -->
    <Teleport to="body">
      <Transition name="save-modal">
        <div v-if="saveDialogOpen" class="save-modal-mask" @click.self="closeSaveDialog">
          <div class="save-modal-shell" role="dialog" aria-modal="true" aria-label="同步到本地文件">
            <div class="save-modal-header">
              <span class="save-modal-title">同步到本地文件</span>
              <button class="save-modal-close" title="取消 (Esc)" @click="closeSaveDialog">
                <X :size="16" :stroke-width="1.8" />
              </button>
            </div>
            <div class="save-modal-body">
              <p class="save-modal-ask">「{{ saveFileName }}」正文已实时保存在应用内，要同步保存为本地文件吗？</p>
              <p class="save-modal-hint">
                应用内数据库本身就实时保存着所有更改，无需手动「保存到应用内」。首次点击下方按钮选择保存位置
                后，这份文档便与本地文件建立关联——以后再按 Ctrl+S 就直接覆盖更新它，不再弹窗。
              </p>
              <div class="save-modal-file">
                <FileText :size="14" :stroke-width="1.8" />
                <span class="save-modal-file-name">{{ saveFileName }}</span>
                <span class="save-modal-chars num-tabular">{{ saveCharCount }} 字符</span>
              </div>
            </div>
            <div class="save-modal-footer">
              <button class="save-modal-btn cancel" @click="closeSaveDialog">取消</button>
              <button ref="savePrimaryRef" class="save-modal-btn primary" @click="saveFileAsFromDialog">
                <Save :size="13" :stroke-width="1.8" />
                保存到本地文件…
              </button>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-shell {
  height: 100%;
  display: flex;
  flex-direction: row;
  background: var(--surface-container-low);
}

.app-shell.zen-active .chat-sidebar {
  display: none !important;
}

.app-shell.zen-active .main-panel {
  position: fixed !important;
  inset: 0 !important;
  z-index: 9999 !important;
  background: var(--reading-surface) !important;
}

.app-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.app-body {
  flex: 1;
  min-height: 0;
  display: flex;
  overflow: hidden;
}

.main-panel {
  flex: 1;
  min-width: 0;
  display: flex;
  overflow: hidden;
}

/* 分栏：左右并排两个文档编辑区 */
.docs-split {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: row;
}

.docs-pane {
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

/* 可拖拽的中间分隔线 */
.docs-split-divider {
  flex: 0 0 6px;
  cursor: col-resize;
  background: var(--outline-variant);
  position: relative;
  transition: background 0.15s ease;
}

.docs-split-divider::after {
  content: "";
  position: absolute;
  inset: 0 -3px;
}

.docs-split-divider:hover,
.docs-split-divider.dragging {
  background: var(--primary);
}

/* ---------- 项目样式的「保存」面板 ---------- */
.save-modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
}

.save-modal-shell {
  width: 400px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.save-modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--outline-variant);
}

.save-modal-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--on-surface);
}

.save-modal-close {
  background: transparent;
  border: none;
  color: var(--on-surface-variant);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s ease, color 0.15s ease;
}

.save-modal-close:hover {
  background: var(--surface-container-high);
  color: var(--on-surface);
}

.save-modal-body {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.save-modal-ask {
  font-size: 13.5px;
  font-weight: 500;
  line-height: 20px;
  color: var(--on-surface);
}

.save-modal-hint {
  font-size: 12px;
  line-height: 19px;
  color: var(--on-surface-variant);
}

.save-modal-file {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 9px 11px;
  border-radius: 8px;
  background: var(--surface-container);
  border: 1px solid var(--outline-variant);
  color: var(--primary);
}

.save-modal-file-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  font-weight: 500;
  color: var(--on-surface);
}

.save-modal-chars {
  font-size: 11px;
  color: var(--on-surface-variant);
}

.save-modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  background: var(--surface-container-lowest);
  border-top: 1px solid var(--outline-variant);
}

.save-modal-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.save-modal-btn.cancel {
  background: var(--surface-container);
  color: var(--on-surface-variant);
}

.save-modal-btn.cancel:hover {
  background: var(--surface-container-high);
}

.save-modal-btn.secondary {
  background: transparent;
  border-color: var(--outline);
  color: var(--on-surface-variant);
}

.save-modal-btn.secondary:hover {
  border-color: var(--primary);
  color: var(--primary);
  background: rgb(var(--primary-rgb) / 0.06);
}

.save-modal-btn.primary {
  background: var(--primary);
  color: #ffffff;
  box-shadow: 0 2px 8px -2px rgb(var(--primary-rgb) / 0.5);
}

.save-modal-btn.primary:hover {
  filter: brightness(1.06);
}

.save-modal-btn.primary:focus-visible {
  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.save-modal-enter-active,
.save-modal-leave-active {
  transition: opacity 0.22s cubic-bezier(0.16, 1, 0.3, 1);
}

.save-modal-leave-active {
  transition: opacity 0.15s ease;
}

.save-modal-enter-from,
.save-modal-leave-to {
  opacity: 0;
}

.save-modal-enter-active .save-modal-shell,
.save-modal-leave-active .save-modal-shell {
  transition: transform 0.26s cubic-bezier(0.16, 1, 0.3, 1);
}

.save-modal-enter-from .save-modal-shell,
.save-modal-leave-to .save-modal-shell {
  transform: translateY(10px) scale(0.96);
}
</style>
