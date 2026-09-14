<script setup lang="ts">
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  GripVertical,
  History,
  Plus,
  Square,
  CheckSquare,
  Trash2,
  X,
} from "lucide-vue-next";
import type { AiTurn, AutoSessionArchive, DraftFolder } from "../../autoStore";

export interface TocItem {
  id: number;
  title: string;
}

export interface SessionSourceItem {
  id: string;
  title: string;
  content: string;
  selected: boolean;
}

interface Props {
  leftWidth: number;
  leftActiveTab: "source" | "drafts";
  sessionSources: SessionSourceItem[];
  selectedSessionSources: SessionSourceItem[];
  newSourceText: string;
  aiTurns: AiTurn[];
  draftFolders: DraftFolder[];
  autoSessions: AutoSessionArchive[];
  collapsedFolderIds: Set<string>;
  editingFolderId: string | null;
  draftFolderRename: string;
  selectedHistoryId: number | null;
  draggingTurnId: number | null;
  draggingOverFolderId: string | null;
  draggingOverRoot: boolean;
  resizingSide: "left" | "right" | null;
  tocItems: TocItem[];
  activeTocId: number | null;
  turnLabel: (turn: AiTurn) => string;
  turnsInFolder: (folderId: string | null) => AiTurn[];
}

const props = defineProps<Props>();

const emit = defineEmits<{
  (e: "update:leftActiveTab", val: "source" | "drafts"): void;
  (e: "update:newSourceText", val: string): void;
  (e: "update:draftFolderRename", val: string): void;
  (e: "toggleSessionSource", id: string): void;
  (e: "removeSessionSource", id: string): void;
  (e: "addSourceMaterial"): void;
  (e: "createDraftFolder"): void;
  (e: "toggleFolderCollapse", folderId: string): void;
  (e: "startFolderRename", folder: DraftFolder): void;
  (e: "commitFolderRename", folderId: string): void;
  (e: "cancelFolderRename"): void;
  (e: "deleteDraftFolder", folderId: string): void;
  (e: "beginTurnDrag", evt: MouseEvent, turn: AiTurn): void;
  (e: "restoreHistory", turn: AiTurn): void;
  (e: "deleteHistory", turn: AiTurn): void;
  (e: "restoreSession", arch: AutoSessionArchive): void;
  (e: "deleteSessionArchive", id: string): void;
  (e: "goToHistoryPage"): void;
  (e: "startPanelResize", side: "left" | "right", evt: MouseEvent): void;
  (e: "resetPanelWidth", side: "left" | "right"): void;
  (e: "tocJump", item: TocItem): void;
}>();
</script>

<template>
  <div class="left-panel-wrapper">
    <!-- Left Panel: Tabs for Source Material and Document Drafts -->
    <aside class="left-panel" :style="{ width: props.leftWidth + 'px' }">
      <!-- Left Panel Horizontal Tab Bar -->
      <div class="left-panel-tabs">
        <button
          class="left-tab-btn"
          :class="{ active: props.leftActiveTab === 'source' }"
          type="button"
          @click="emit('update:leftActiveTab', 'source')"
        >
          <span>新素材</span>
          <span
            v-if="props.selectedSessionSources.length > 0"
            class="left-tab-badge"
          >
            {{ props.selectedSessionSources.length }}
          </span>
        </button>
        <button
          class="left-tab-btn"
          :class="{ active: props.leftActiveTab === 'drafts' }"
          type="button"
          @click="emit('update:leftActiveTab', 'drafts')"
        >
          <span>文稿列表</span>
          <span v-if="props.aiTurns.length > 0" class="left-tab-badge">
            {{ props.aiTurns.length }}
          </span>
        </button>
      </div>

      <!-- Tab Content 1: 素材来源 -->
      <div v-if="props.leftActiveTab === 'source'" class="source-panel">
        <!-- Source Status -->
        <section v-if="props.selectedSessionSources.length > 0" class="space-y-3">
          <div class="space-y-2">
            <div
              v-for="mat in props.sessionSources"
              :key="mat.id"
              class="source-mat-card"
              :class="{ active: mat.selected }"
              @click="emit('toggleSessionSource', mat.id)"
            >
              <div class="source-mat-header">
                <div class="source-mat-info">
                  <component
                    :is="mat.selected ? CheckSquare : Square"
                    :size="14"
                    class="source-mat-check"
                  />
                  <span class="source-mat-title">{{ mat.title }}</span>
                </div>
                <button
                  class="source-mat-del"
                  title="移除本素材"
                  type="button"
                  @click.stop="emit('removeSessionSource', mat.id)"
                >
                  <X :size="12" />
                </button>
              </div>
              <p class="source-mat-preview">{{ mat.content }}</p>
            </div>
          </div>
        </section>

        <!-- Add Source Form (临时素材，用完即扔，解耦) -->
        <section class="space-y-3">
          <div class="source-input-wrapper">
            <textarea
              :value="props.newSourceText"
              class="source-textarea"
              placeholder="粘贴参考文档、前情摘要、背景设定等本轮专属素材 (不存入素材库，关闭即失效)..."
              rows="5"
              @input="emit('update:newSourceText', ($event.target as HTMLTextAreaElement).value)"
            ></textarea>
          </div>
        </section>

        <!-- Actions -->
        <section class="pt-1 flex items-center space-x-3">
          <button
            class="btn-primary"
            type="button"
            :disabled="!props.newSourceText.trim()"
            @click="emit('addSourceMaterial')"
          >
            <Plus :size="14" />
            <span>添加临时素材</span>
          </button>
        </section>

        <!-- Subtext Instruction -->
        <p class="source-instruction">
          粘贴的素材将作为参考上下文注入给 AI；此处为本轮会话专属，不影响全局项目素材库。
        </p>
      </div>

      <!-- Tab Content 2: 文稿列表 -->
      <div v-else class="drafts-panel">
        <!-- 上方：文件夹 + 文稿列表 -->
        <div class="drafts-scroll-zone">
          <div class="drafts-tree-toolbar">
            <span class="drafts-tree-heading">归档目录</span>
            <button
              class="draft-add-folder-btn"
              type="button"
              title="新建文件夹用于文稿归类"
              @click="emit('createDraftFolder')"
            >
              <FolderPlus :size="12" />
              <span>新建文件夹</span>
            </button>
          </div>

          <div class="drafts-tree">
            <!-- 文件夹块（头部行 + 内部文稿） -->
            <div
              v-for="folder in props.draftFolders"
              :key="folder.id"
              class="draft-folder-block"
              :class="{ 'drag-over': props.draggingOverFolderId === folder.id }"
            >
              <div
                class="draft-folder-row"
                @click="emit('toggleFolderCollapse', folder.id)"
              >
                <button
                  class="draft-folder-caret"
                  type="button"
                  :title="props.collapsedFolderIds.has(folder.id) ? '展开文件夹' : '折叠文件夹'"
                  @click.stop="emit('toggleFolderCollapse', folder.id)"
                >
                  <ChevronDown
                    v-if="!props.collapsedFolderIds.has(folder.id)"
                    :size="13"
                    :stroke-width="2.2"
                  />
                  <ChevronRight v-else :size="13" :stroke-width="2.2" />
                </button>
                <Folder :size="13" class="draft-folder-icon" />

                <!-- 双击重命名 / 展示文件夹名 -->
                <input
                  v-if="props.editingFolderId === folder.id"
                  :value="props.draftFolderRename"
                  class="draft-folder-rename-input"
                  type="text"
                  autofocus
                  @click.stop
                  @input="emit('update:draftFolderRename', ($event.target as HTMLInputElement).value)"
                  @keydown.enter.prevent="emit('commitFolderRename', folder.id)"
                  @keydown.esc="emit('cancelFolderRename')"
                  @blur="emit('commitFolderRename', folder.id)"
                />
                <span
                  v-else
                  class="draft-folder-name"
                  title="双击可重命名文件夹"
                  @dblclick.stop="emit('startFolderRename', folder)"
                >
                  {{ folder.name }}
                </span>

                <span class="draft-folder-count">
                  {{ props.turnsInFolder(folder.id).length }}
                </span>
                <button
                  class="draft-item-del"
                  title="删除此文件夹（文稿将移至未分类）"
                  type="button"
                  @click.stop="emit('deleteDraftFolder', folder.id)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>

              <!-- 文件夹内部文稿 -->
              <div
                v-if="!props.collapsedFolderIds.has(folder.id) && props.turnsInFolder(folder.id).length > 0"
                class="draft-folder-children"
              >
                <div
                  v-for="turn in [...props.turnsInFolder(folder.id)].reverse()"
                  :key="turn.id"
                  class="draft-item"
                  :class="{
                    active: props.selectedHistoryId === turn.id,
                    'is-dragging': props.draggingTurnId === turn.id,
                  }"
                  :title="`长按拖拽到文件夹归类 · 点击定位：${props.turnLabel(turn)}`"
                  @mousedown="emit('beginTurnDrag', $event, turn)"
                  @click="emit('restoreHistory', turn)"
                >
                  <div class="draft-item-header">
                    <GripVertical
                      :size="11"
                      class="draft-item-grip"
                    />
                    <span class="draft-item-title">{{ props.turnLabel(turn) }}</span>
                    <span class="draft-item-time">{{ turn.timestamp }}</span>
                  </div>
                  <p class="draft-item-preview">
                    {{ turn.content.slice(0, 75).trim() }}...
                  </p>
                  <div class="draft-item-footer">
                    <span class="draft-item-chars">{{ turn.content.trim().length }} 字</span>
                    <button
                      class="draft-item-del"
                      title="删除此文稿版本"
                      type="button"
                      @click.stop="emit('deleteHistory', turn)"
                    >
                      <Trash2 :size="12" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- 未分类：同样整块可投放，文稿移出文件夹即回到这里 -->
            <div class="draft-root-section" :class="{ 'drag-over': props.draggingOverRoot }">
              <div class="draft-folder-row">
                <span class="draft-folder-caret-spacer"></span>
                <FileText :size="13" class="draft-folder-icon" />
                <span class="draft-folder-name">未分类</span>
                <span class="draft-folder-count">
                  {{ props.turnsInFolder(null).length }}
                </span>
              </div>
              <div
                v-if="props.turnsInFolder(null).length > 0"
                class="draft-folder-children"
              >
                <div
                  v-for="turn in [...props.turnsInFolder(null)].reverse()"
                  :key="turn.id"
                  class="draft-item"
                  :class="{
                    active: props.selectedHistoryId === turn.id,
                    'is-dragging': props.draggingTurnId === turn.id,
                  }"
                  :title="`长按拖拽到文件夹归类 · 点击定位：${props.turnLabel(turn)}`"
                  @mousedown="emit('beginTurnDrag', $event, turn)"
                  @click="emit('restoreHistory', turn)"
                >
                  <div class="draft-item-header">
                    <GripVertical
                      :size="11"
                      class="draft-item-grip"
                    />
                    <span class="draft-item-title">{{ props.turnLabel(turn) }}</span>
                    <span class="draft-item-time">{{ turn.timestamp }}</span>
                  </div>
                  <p class="draft-item-preview">
                    {{ turn.content.slice(0, 75).trim() }}...
                  </p>
                  <div class="draft-item-footer">
                    <span class="draft-item-chars">{{ turn.content.trim().length }} 字</span>
                    <button
                      class="draft-item-del"
                      title="删除此文稿版本"
                      type="button"
                      @click.stop="emit('deleteHistory', turn)"
                    >
                      <Trash2 :size="12" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div
            v-if="props.aiTurns.length === 0 && props.draftFolders.length === 0"
            class="drafts-list-empty-hint"
          >
            尚未生成过文稿
          </div>

          <!-- 过往创作：每一轮「新建创作」独立归档并持久保存 -->
          <div v-if="props.autoSessions.length > 0" class="drafts-archives">
            <div class="drafts-archives-head">
              <History :size="12" :stroke-width="2" />
              过往创作（{{ props.autoSessions.length }}）
            </div>
            <div
              v-for="arch in props.autoSessions"
              :key="arch.id"
              class="draft-archive-item"
            >
              <div class="draft-archive-main">
                <span class="draft-archive-title">{{ arch.title }}</span>
                <span class="draft-archive-meta">
                  {{ arch.turns.length }} 条产出
                  <template v-if="arch.topicContent">
                    · {{ arch.topicContent.slice(0, 12) }}
                  </template>
                </span>
              </div>
              <div class="draft-archive-actions">
                <button
                  class="draft-archive-restore"
                  type="button"
                  title="载入该轮创作的全部内容"
                  @click="emit('restoreSession', arch)"
                >
                  载入
                </button>
                <button
                  class="draft-item-del"
                  type="button"
                  title="删除该轮归档"
                  @click.stop="emit('deleteSessionArchive', arch.id)"
                >
                  <Trash2 :size="12" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- 紧凑底部说明条：一行放完，不占用文稿列表空间 -->
        <div class="drafts-foot-panel">
          <div class="drafts-foot-note">
            <History :size="13" class="drafts-foot-icon" />
            <template v-if="props.aiTurns.length === 0">
              <span class="drafts-foot-hint">暂无历史文稿</span>
            </template>
            <template v-else>
              <span class="drafts-foot-hint">
                长按文稿卡片拖拽归类 · 完整上下文对话请查看
              </span>
            </template>
          </div>
          <button
            class="drafts-foot-history-btn"
            type="button"
            title="查看全部上下文对话"
            @click="emit('goToHistoryPage')"
          >
            <History :size="12" />
            历史对话
          </button>
        </div>
      </div>
    </aside>

    <!-- 左栏拖拽分隔线（双击复位默认宽度） -->
    <div
      class="panel-resizer"
      :class="{ dragging: props.resizingSide === 'left' }"
      title="拖拽调整左栏宽度（双击恢复默认）"
      @mousedown="emit('startPanelResize', 'left', $event)"
      @dblclick="emit('resetPanelWidth', 'left')"
    ></div>

    <!-- 对话目录条：默认窄条短横显示，鼠标光标靠近时悬浮展开 -->
    <nav
      v-if="props.tocItems.length > 0"
      class="auto-toc-rail"
      aria-label="对话目录"
    >
      <!-- 默认短横条：极窄占用空间，锁在当前位置 -->
      <div class="auto-toc-dash-track">
        <button
          v-for="item in props.tocItems"
          :key="item.id"
          class="auto-toc-dash-item"
          :class="{ active: props.activeTocId === item.id }"
          type="button"
          :title="item.title"
          @click="emit('tocJump', item)"
        >
          <span class="auto-toc-dash-bar"></span>
        </button>
      </div>

      <!-- 鼠标光标靠近/悬停时展开的卡片弹窗面板 -->
      <div class="auto-toc-popover">
        <div class="auto-toc-popover-list">
          <button
            v-for="item in props.tocItems"
            :key="item.id"
            class="auto-toc-popover-item"
            :class="{ active: props.activeTocId === item.id }"
            type="button"
            :title="item.title"
            @click="emit('tocJump', item)"
          >
            <span class="auto-toc-popover-text">{{ item.title }}</span>
            <span class="auto-toc-popover-dash"></span>
          </button>
        </div>
      </div>
    </nav>
  </div>
</template>

<style scoped>
.left-panel-wrapper {
  display: flex;
  height: 100%;
  position: relative;
}

.left-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--surface-container-low);
  border-right: 1px solid var(--outline-variant);
  overflow: hidden;
  position: relative;
  flex-shrink: 0;
}

.left-panel-tabs {
  display: flex;
  align-items: center;
  gap: 3px;
  padding: 6px 8px;
  background-color: var(--surface-container-lowest);
  border-bottom: 1px solid var(--outline-variant);
  flex-shrink: 0;
}

.left-tab-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 5px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background-color: transparent;
  color: var(--on-surface-variant);
  font-size: 0.78rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}

.left-tab-btn:hover {
  color: var(--on-surface);
  background-color: var(--surface-container-high);
}

.left-tab-btn.active {
  color: var(--primary);
  background-color: var(--surface-bright);
  border-color: var(--outline-variant);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.left-tab-badge {
  font-size: 0.68rem;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 9999px;
  background-color: rgba(var(--primary-rgb) / 0.14);
  color: var(--primary);
}

.source-panel {
  flex: 1;
  overflow-y: auto;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.source-mat-card {
  padding: 10px;
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background-color: var(--surface-bright);
  cursor: pointer;
  transition: all 0.15s ease;
}

.source-mat-card:hover {
  border-color: var(--primary);
}

.source-mat-card.active {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.05);
}

.source-mat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.source-mat-info {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.source-mat-check {
  color: var(--primary);
  flex-shrink: 0;
}

.source-mat-title {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-mat-del {
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
}

.source-mat-del:hover {
  color: var(--error, #ef4444);
}

.source-mat-preview {
  font-size: 0.75rem;
  color: var(--on-surface-variant);
  line-height: 1.5;
  margin: 0;
  max-height: 48px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.source-input-wrapper {
  width: 100%;
}

.source-textarea {
  width: 100%;
  padding: 8px 10px;
  border-radius: 8px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface);
  font-size: 0.82rem;
  line-height: 1.5;
  outline: none;
  resize: vertical;
}

.source-textarea:focus {
  border-color: var(--primary);
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 14px;
  border-radius: 6px;
  background-color: var(--primary);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  border: none;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.btn-primary:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.source-instruction {
  font-size: 0.72rem;
  line-height: 1.5;
  color: var(--on-surface-variant);
  opacity: 0.75;
  margin: 0;
}

.drafts-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.drafts-scroll-zone {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.drafts-tree-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 6px;
}

.drafts-tree-heading {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--on-surface-variant);
  letter-spacing: 0.02em;
}

.draft-add-folder-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--on-surface-variant);
  font-size: 0.72rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.draft-add-folder-btn:hover {
  border-color: var(--primary);
  color: var(--primary);
}

.drafts-tree {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.draft-folder-block {
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  background-color: var(--surface-bright);
  overflow: hidden;
}

.draft-folder-block.drag-over,
.draft-root-section.drag-over {
  border-color: var(--primary);
  background-color: rgba(var(--primary-rgb) / 0.08);
}

.draft-folder-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 10px;
  background-color: var(--surface-container-high);
  cursor: pointer;
  user-select: none;
}

.draft-folder-caret {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
}

.draft-folder-caret-spacer {
  width: 18px;
  height: 18px;
}

.draft-folder-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.draft-folder-name {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-folder-rename-input {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  padding: 1px 4px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  outline: none;
}

.draft-folder-count {
  font-size: 0.68rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 9999px;
  background-color: var(--surface-container-highest);
  color: var(--on-surface-variant);
}

.draft-folder-children {
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.draft-root-section {
  border: 1px dashed var(--outline-variant);
  border-radius: 8px;
  background-color: var(--surface-container-lowest);
  overflow: hidden;
}

.draft-item {
  padding: 8px 10px;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  cursor: pointer;
  transition: all 0.15s ease;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.draft-item:hover {
  border-color: var(--primary);
  transform: translateY(-1px);
}

.draft-item.active {
  border-color: var(--primary);
  box-shadow: 0 0 0 1px var(--primary);
}

.draft-item.is-dragging {
  opacity: 0.4;
}

.draft-item-header {
  display: flex;
  align-items: center;
  gap: 6px;
}

.draft-item-grip {
  color: var(--on-surface-variant);
  opacity: 0.5;
  cursor: grab;
}

.draft-item-title {
  flex: 1;
  min-width: 0;
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-item-time {
  font-size: 0.68rem;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.draft-item-preview {
  font-size: 0.72rem;
  color: var(--on-surface-variant);
  line-height: 1.45;
  margin: 0;
  max-height: 38px;
  overflow: hidden;
}

.draft-item-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 2px;
}

.draft-item-chars {
  font-size: 0.68rem;
  font-weight: 600;
  color: var(--primary);
}

.draft-item-del {
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
}

.draft-item-del:hover {
  color: var(--error, #ef4444);
}

.drafts-list-empty-hint {
  font-size: 0.75rem;
  color: var(--on-surface-variant);
  opacity: 0.6;
  text-align: center;
  padding: 24px 0;
}

.drafts-archives {
  margin-top: 8px;
  border-top: 1px solid var(--outline-variant);
  padding-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.drafts-archives-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.72rem;
  font-weight: 700;
  color: var(--on-surface-variant);
}

.draft-archive-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 6px;
  background-color: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  gap: 6px;
}

.draft-archive-main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.draft-archive-title {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-archive-meta {
  font-size: 0.68rem;
  color: var(--on-surface-variant);
  opacity: 0.7;
}

.draft-archive-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.draft-archive-restore {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-container-high);
  color: var(--primary);
  font-size: 0.7rem;
  font-weight: 600;
  cursor: pointer;
}

.drafts-foot-panel {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  background-color: var(--surface-container-high);
  border-top: 1px solid var(--outline-variant);
}

.drafts-foot-note {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.drafts-foot-icon {
  color: var(--primary);
  flex-shrink: 0;
}

.drafts-foot-hint {
  font-size: 0.7rem;
  color: var(--on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.drafts-foot-history-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 5px;
  border: 1px solid var(--outline-variant);
  background-color: var(--surface-bright);
  color: var(--primary);
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
  flex-shrink: 0;
}

.panel-resizer {
  width: 4px;
  height: 100%;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
  z-index: 10;
  flex-shrink: 0;
}

.panel-resizer:hover,
.panel-resizer.dragging {
  background: var(--primary);
}

/* 目录短横轨与悬浮展开 */
.auto-toc-rail {
  position: absolute;
  top: 60px;
  left: 100%;
  z-index: 20;
}

.auto-toc-dash-track {
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 6px 3px;
  background: rgba(var(--surface-container-low-rgb, 240, 240, 240) / 0.85);
  backdrop-filter: blur(8px);
  border-radius: 0 6px 6px 0;
  border: 1px solid var(--outline-variant);
  border-left: none;
}

.auto-toc-dash-item {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  display: flex;
  align-items: center;
}

.auto-toc-dash-bar {
  width: 12px;
  height: 3px;
  border-radius: 2px;
  background-color: var(--on-surface-variant);
  opacity: 0.4;
  transition: all 0.15s ease;
}

.auto-toc-dash-item:hover .auto-toc-dash-bar {
  opacity: 0.9;
  width: 16px;
  background-color: var(--primary);
}

.auto-toc-dash-item.active .auto-toc-dash-bar {
  opacity: 1;
  width: 18px;
  background-color: var(--primary);
}

.auto-toc-popover {
  position: absolute;
  top: 0;
  left: 100%;
  min-width: 160px;
  max-width: 240px;
  max-height: 360px;
  overflow-y: auto;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 8px;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
  padding: 6px;
  display: none;
}

.auto-toc-rail:hover .auto-toc-popover,
.auto-toc-popover:hover {
  display: block;
}

.auto-toc-popover-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.auto-toc-popover-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 5px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  font-size: 0.74rem;
  cursor: pointer;
  text-align: left;
}

.auto-toc-popover-item:hover {
  background-color: var(--surface-container-high);
  color: var(--on-surface);
}

.auto-toc-popover-text {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.auto-toc-popover-item.active .auto-toc-popover-text {
  color: var(--primary);
  font-weight: 600;
}

.auto-toc-popover-dash {
  width: 8px;
  height: 2px;
  background-color: currentColor;
  opacity: 0.4;
}

.auto-toc-popover-item.active .auto-toc-popover-dash {
  opacity: 1;
  background-color: var(--primary);
}
</style>
