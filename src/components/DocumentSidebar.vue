<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import {
  ChevronRight,
  ChevronDown,
  FilePlus,
  FileText,
  Folder,
  FolderPlus,
  Plus,
  Search,
  Trash2,
  Copy,
  Clipboard,
  Pencil,
  X,
  ArrowUp,
  ArrowDown,
  PanelLeftClose,
  CheckCheck,
  XCircle,
  MoreVertical,
} from "lucide-vue-next";
import {
  documentFilesStore,
  appendDocFileToFolder,
  createDocFolder,
  createDocFile,
  moveDocFolderToEdge,
  renameDocFolder,
  renameDocFile,
  deleteDocFolder,
  deleteDocFile,
  duplicateDocFile,
  moveDocFile,
  reorderDocFile,
  reorderDocFolder,
  selectDocFile,
  selectDocFile2,
  type DocFileItem,
  type DocFolderItem,
} from "../documentFilesStore";
import { startLongPressDrag } from "../longPressDrag";
import { isAiEditingDoc } from "../aiDocActivity";
import {
  applyAllRevisions,
  isRevisionListCollapsed,
  rejectAllRevisions,
  revisionCount,
  toggleRevisionList,
} from "../revisionStore";
import { showToast } from "../insightStore";
import { aiSettings } from "../settings";
import RevisionLayerList from "./RevisionLayerList.vue";

const props = withDefaults(
  defineProps<{
    /** Which document slot this panel drives: the main pane or the 分栏 pane. */
    target?: "primary" | "secondary";
  }>(),
  { target: "primary" },
);

const emit = defineEmits<{
  (e: "selectFile", fileId: string): void;
  (e: "collapse"): void;
}>();

/** Id of the file this panel should highlight as active. */
const activeIdForTarget = computed(() =>
  props.target === "secondary" ? documentFilesStore.activeFileId2 : documentFilesStore.activeFileId,
);

const searchText = ref("");
const renamingFolderId = ref<string | null>(null);
const renamingFileId = ref<string | null>(null);
const renameValue = ref("");
const renameInputEl = ref<HTMLInputElement | null>(null);

function focusRenameInput() {
  nextTick(() => {
    renameInputEl.value?.focus();
    renameInputEl.value?.select();
  });
}

/* --- context menu state --- */
interface CtxMenu {
  x: number;
  y: number;
  show: boolean;
  kind: "file" | "folder" | "empty";
  id: string | null;
}
const ctxMenu = ref<CtxMenu>({ x: 0, y: 0, show: false, kind: "empty", id: null });
const copiedFileId = ref<string | null>(null);

const visibleFolders = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  if (!q) return documentFilesStore.folders;
  return documentFilesStore.folders.filter((f) => f.title.toLowerCase().includes(q));
});

function filesInFolder(folderId: string): DocFileItem[] {
  const q = searchText.value.trim().toLowerCase();
  return documentFilesStore.files.filter(
    (f) => f.folderId === folderId && (!q || f.title.toLowerCase().includes(q)),
  );
}

const rootFiles = computed(() => {
  const q = searchText.value.trim().toLowerCase();
  return documentFilesStore.files.filter(
    (f) => f.folderId === null && (!q || f.title.toLowerCase().includes(q)),
  );
});

/* --- selection --- */
function selectFile(file: DocFileItem) {
  if (props.target === "secondary") selectDocFile2(file.id);
  else selectDocFile(file.id);
  emit("selectFile", file.id);
}

/* --- create --- */
function onCreateFolder() {
  const folder = createDocFolder();
  renamingFolderId.value = folder.id;
  renameValue.value = folder.title;
  focusRenameInput();
}

function onCreateFile(folderId: string | null = null) {
  const file = createDocFile(folderId);
  selectFile(file);
  renamingFileId.value = file.id;
  renameValue.value = file.title;
  focusRenameInput();
}

/* --- rename (double click or context menu) --- */
function startRenameFolder(folder: DocFolderItem) {
  renamingFolderId.value = folder.id;
  renameValue.value = folder.title;
  focusRenameInput();
}

function startRenameFile(file: DocFileItem) {
  renamingFileId.value = file.id;
  renameValue.value = file.title;
  focusRenameInput();
}

function commitRename(kind: "folder" | "file", id: string) {
  if (kind === "folder") {
    if (renameValue.value.trim()) renameDocFolder(id, renameValue.value);
    renamingFolderId.value = null;
  } else {
    if (renameValue.value.trim()) renameDocFile(id, renameValue.value);
    renamingFileId.value = null;
  }
  renameValue.value = "";
}

/* Rename is cancelled whenever focus moves away (e.g. clicking blank space). */
function cancelRename() {
  renamingFolderId.value = null;
  renamingFileId.value = null;
  renameValue.value = "";
}

/* --- folder collapse / expand --- */
const collapsedFolders = ref<Set<string>>(new Set());

function toggleFolderCollapse(folderId: string, event?: MouseEvent) {
  event?.stopPropagation();
  const next = new Set(collapsedFolders.value);
  if (next.has(folderId)) next.delete(folderId);
  else next.add(folderId);
  collapsedFolders.value = next;
}

function isFolderCollapsed(folderId: string): boolean {
  return collapsedFolders.value.has(folderId);
}

/* --- drag & drop: reorder files and folders, move files between folders ---
   Uses the shared long-press gesture instead of HTML5 DnD, so a plain click
   still selects/renames and a hold-and-drag reorders. */
const draggingFileId = ref<string | null>(null);
const draggingFolderId = ref<string | null>(null);
const dragOverFolderId = ref<string | null>(null);
const draggingOverRoot = ref(false);
/** Insertion indicator for a file row: which row, and which edge of it. */
const dropTarget = ref<{ fileId: string; place: "before" | "after" } | null>(null);
/** Insertion indicator for a folder row (folder reordering). */
const folderDropTarget = ref<{ folderId: string; place: "before" | "after" } | null>(null);

function resetDragState() {
  draggingFileId.value = null;
  draggingFolderId.value = null;
  dropTarget.value = null;
  folderDropTarget.value = null;
  dragOverFolderId.value = null;
  draggingOverRoot.value = false;
}

function clearDropIndicators() {
  dropTarget.value = null;
  folderDropTarget.value = null;
  dragOverFolderId.value = null;
  draggingOverRoot.value = false;
}

/** Which half of a row is the cursor in? */
function edgeOf(row: HTMLElement, y: number): "before" | "after" {
  const rect = row.getBoundingClientRect();
  return y < rect.top + rect.height / 2 ? "before" : "after";
}

/* ---- dragging a document ---- */

function beginFileDrag(event: MouseEvent, file: DocFileItem) {
  const target = event.target as HTMLElement | null;
  /* Row buttons (move/delete) and the rename input keep their own behavior. */
  if (target?.closest("button, input")) return;
  if (renamingFileId.value === file.id) return;

  startLongPressDrag({
    event,
    ghostVariant: "row",
    ghostLabel: file.title,
    onStart: () => {
      draggingFileId.value = file.id;
    },
    onMove: (x, y) => updateFileDropTarget(x, y),
    onDrop: (x, y) => {
      /* Re-resolve at the exact release point: the last mousemove may have
         been a few pixels away from where the button actually came up. */
      updateFileDropTarget(x, y);
      commitFileDrop();
    },
    onEnd: resetDragState,
  });
}

/** Resolve what is under the cursor: a sibling row, a folder header, or root. */
function updateFileDropTarget(x: number, y: number) {
  clearDropIndicators();

  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return;

  /* 悬在修订与批注图层列表上时不解析放置目标：那里既不是文档行也不是根区域，
     若按「根区域」处理会让文档被意外移出所在文件夹。 */
  if (el.closest(".rl-list")) return;

  const row = el.closest<HTMLElement>(".ds-file");
  if (row?.dataset.fileId && row.dataset.fileId !== draggingFileId.value) {
    dropTarget.value = { fileId: row.dataset.fileId, place: edgeOf(row, y) };
    return;
  }
  if (row) return; // hovering over the dragged row itself — no-op

  const folderRow = el.closest<HTMLElement>(".ds-folder-row");
  if (folderRow?.dataset.folderId) {
    dragOverFolderId.value = folderRow.dataset.folderId;
    return;
  }

  if (el.closest(".ds-tree")) {
    draggingOverRoot.value = true;
  }
}

function commitFileDrop() {
  const fileId = draggingFileId.value;
  if (!fileId) return;

  if (dropTarget.value) {
    reorderDocFile(fileId, dropTarget.value.fileId, dropTarget.value.place);
    return;
  }
  if (dragOverFolderId.value) {
    /* Dropping onto a collapsed folder should reveal the result. */
    const next = new Set(collapsedFolders.value);
    next.delete(dragOverFolderId.value);
    collapsedFolders.value = next;
    appendDocFileToFolder(fileId, dragOverFolderId.value);
    return;
  }
  if (draggingOverRoot.value) {
    appendDocFileToFolder(fileId, null);
  }
}

/* ---- dragging a folder ---- */

function beginFolderDrag(event: MouseEvent, folder: DocFolderItem) {
  const target = event.target as HTMLElement | null;
  /* Chevron, add-file button and the rename input keep their own behavior. */
  if (target?.closest("button, input")) return;
  if (renamingFolderId.value === folder.id) return;
  if (documentFilesStore.folders.length < 2) return;

  startLongPressDrag({
    event,
    ghostVariant: "row",
    ghostLabel: folder.title,
    onStart: () => {
      draggingFolderId.value = folder.id;
    },
    onMove: (x, y) => updateFolderDropTarget(x, y),
    onDrop: (x, y) => {
      updateFolderDropTarget(x, y);
      commitFolderDrop();
    },
    onEnd: resetDragState,
  });
}

/**
 * Folders only reorder among folders. Hovering a file row resolves to that
 * file's folder so dragging across a folder's children still works.
 */
function updateFolderDropTarget(x: number, y: number) {
  clearDropIndicators();

  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el) return;

  const folderRow = el.closest<HTMLElement>(".ds-folder-row");
  if (folderRow?.dataset.folderId) {
    if (folderRow.dataset.folderId === draggingFolderId.value) return;
    folderDropTarget.value = { folderId: folderRow.dataset.folderId, place: edgeOf(folderRow, y) };
    return;
  }

  /* Over a folder's child list -> treat as "after that folder". */
  const folderBlock = el.closest<HTMLElement>(".ds-folder");
  if (folderBlock?.dataset.folderBlockId) {
    if (folderBlock.dataset.folderBlockId === draggingFolderId.value) return;
    folderDropTarget.value = { folderId: folderBlock.dataset.folderBlockId, place: "after" };
    return;
  }

  /* Below every folder (root file area / empty space) -> send to the end. */
  if (el.closest(".ds-tree")) {
    draggingOverRoot.value = true;
  }
}

function commitFolderDrop() {
  const folderId = draggingFolderId.value;
  if (!folderId) return;

  if (folderDropTarget.value) {
    reorderDocFolder(folderId, folderDropTarget.value.folderId, folderDropTarget.value.place);
    return;
  }
  if (draggingOverRoot.value) {
    moveDocFolderToEdge(folderId, "end");
  }
}

/* ---- indicator classes ---- */

function dropIndicatorClass(fileId: string): Record<string, boolean> {
  const t = dropTarget.value;
  return {
    "drop-before": t?.fileId === fileId && t.place === "before",
    "drop-after": t?.fileId === fileId && t.place === "after",
    "is-dragging": draggingFileId.value === fileId,
  };
}

function folderRowClass(folderId: string): Record<string, boolean> {
  const t = folderDropTarget.value;
  return {
    "drag-over": dragOverFolderId.value === folderId,
    "drop-before": t?.folderId === folderId && t.place === "before",
    "drop-after": t?.folderId === folderId && t.place === "after",
    "is-dragging": draggingFolderId.value === folderId,
  };
}

/* --- copy / paste / delete --- */
function copyFile(fileId: string) {
  copiedFileId.value = fileId;
}

function pasteInto(targetFolderId: string | null) {
  if (!copiedFileId.value) return;
  const src = documentFilesStore.files.find((f) => f.id === copiedFileId.value);
  if (!src) {
    copiedFileId.value = null;
    return;
  }
  const copy = duplicateDocFile(src.id);
  if (copy) {
    copy.folderId = targetFolderId;
  }
  copiedFileId.value = null;
}

function removeFile(fileId: string) {
  deleteDocFile(fileId);
}

function removeFolder(folderId: string) {
  deleteDocFolder(folderId);
}

/* --- 修订与批注图层（文档条目的二级目录） --- */

/**
 * 该文档条目下有几条图层。为 0 时不显示折叠箭头与批量菜单项。
 * 设置里关掉「修订与批注」后一律按 0 处理：图层数据仍在库里，只是不呈现。
 */
function layerCount(fileId: string): number {
  if (!aiSettings.revisionAnnotationEnabled) return 0;
  return revisionCount(fileId);
}

function layersCollapsed(fileId: string): boolean {
  return isRevisionListCollapsed(fileId);
}

function onToggleLayers(fileId: string) {
  toggleRevisionList(fileId);
}

/** 全部应用：逐条落笔，定位不到原文的那几条保留在图层里。 */
function onApplyAllLayers(fileId: string) {
  const { done, failed } = applyAllRevisions(fileId);
  if (done === 0 && failed === 0) return;
  if (failed > 0) {
    showToast(
      "部分修订未应用",
      `已应用 ${done} 条，${failed} 条在正文中找不到原文，仍保留在图层里`,
      "edit",
    );
  } else {
    showToast("已全部应用", `共 ${done} 条修订已替换原文并从图层中清除`, "edit");
  }
}

/** 全部拒绝：清空该文档的图层，正文分毫不动。 */
function onRejectAllLayers(fileId: string) {
  const removed = rejectAllRevisions(fileId);
  if (removed > 0) {
    showToast("已全部拒绝", `共清除 ${removed} 条修订与批注，正文未改动`, "edit");
  }
}

/* --- 行内「更多」菜单（⋮） ---
   上移 / 下移 / 全部应用 / 全部拒绝 都收进这里：图标直接铺在行上会把文档名
   挤到只剩几个字，收进菜单后标题重新拿回宽度，功能一个不少。 */
const rowMenu = ref<{ fileId: string; x: number; y: number } | null>(null);

function toggleRowMenu(event: MouseEvent, fileId: string) {
  if (rowMenu.value?.fileId === fileId) {
    rowMenu.value = null;
    return;
  }
  const btn = event.currentTarget as HTMLElement | null;
  const rect = btn?.getBoundingClientRect();
  /* 贴着按钮右下角展开；菜单自身用 CSS 兜住视口下边界。 */
  rowMenu.value = {
    fileId,
    x: rect ? rect.right : event.clientX,
    y: rect ? rect.bottom + 4 : event.clientY,
  };
}

function closeRowMenu() {
  rowMenu.value = null;
}

/** 菜单项统一出口：执行完就收起菜单。 */
function rowMenuAction(action: "up" | "down" | "apply-all" | "reject-all") {
  const fileId = rowMenu.value?.fileId;
  closeRowMenu();
  if (!fileId) return;
  if (action === "up") moveDocFile(fileId, -1);
  else if (action === "down") moveDocFile(fileId, 1);
  else if (action === "apply-all") onApplyAllLayers(fileId);
  else if (action === "reject-all") onRejectAllLayers(fileId);
}

/* --- context menu --- */
function openCtxMenu(event: MouseEvent, kind: "file" | "folder" | "empty", id: string | null) {
  event.preventDefault();
  event.stopPropagation();
  ctxMenu.value = { x: event.clientX, y: event.clientY, show: true, kind, id };
}

function closeCtxMenu() {
  ctxMenu.value = { ...ctxMenu.value, show: false };
}

function ctxAction(action: string) {
  const ctx = ctxMenu.value;
  const id = ctx.id;

  if (action === "new-folder") {
    onCreateFolder();
  } else if (action === "new-file-root") {
    onCreateFile(null);
  }

  if (ctx.kind === "file" && id) {
    if (action === "rename") {
      const file = documentFilesStore.files.find((f) => f.id === id);
      if (file) startRenameFile(file);
    } else if (action === "copy") {
      copyFile(id);
    } else if (action === "paste") {
      pasteInto(documentFilesStore.files.find((f) => f.id === id)?.folderId ?? null);
    } else if (action === "delete") {
      removeFile(id);
    } else if (action === "new-file-here") {
      onCreateFile(documentFilesStore.files.find((f) => f.id === id)?.folderId ?? null);
    }
  }

  if (ctx.kind === "folder" && id) {
    if (action === "rename") {
      const folder = documentFilesStore.folders.find((f) => f.id === id);
      if (folder) startRenameFolder(folder);
    } else if (action === "paste") {
      pasteInto(id);
    } else if (action === "new-file-here") {
      onCreateFile(id);
    } else if (action === "delete") {
      removeFolder(id);
    }
  }

  closeCtxMenu();
}
</script>

<template>
  <aside class="doc-sidebar" @click="closeCtxMenu(); closeRowMenu()">
    <div class="ds-header">
      <div class="ds-search">
        <Search :size="14" :stroke-width="1.8" />
        <input
          v-model="searchText"
          class="ds-search-input"
          placeholder="搜索文档..."
          @click.stop
        />
      </div>
      <div class="ds-actions">
        <button class="ds-icon-btn" title="新建文件夹" @click.stop="onCreateFolder">
          <FolderPlus :size="16" :stroke-width="1.8" />
        </button>
        <button class="ds-icon-btn" title="新建文档" @click.stop="onCreateFile(null)">
          <FilePlus :size="16" :stroke-width="1.8" />
        </button>
        <button class="ds-icon-btn" title="折叠文档面板" @click.stop="emit('collapse')">
          <PanelLeftClose :size="16" :stroke-width="1.8" />
        </button>
      </div>
    </div>

    <div class="ds-tree" :class="{ 'drag-over-root': draggingOverRoot }" @contextmenu="(e) => openCtxMenu(e, 'empty', null)">
      <!-- Empty state -->
      <div
        v-if="documentFilesStore.folders.length === 0 && documentFilesStore.files.length === 0"
        class="ds-empty"
      >
        暂无文档，点击上方按钮新建
      </div>

      <!-- Folder items -->
      <div
        v-for="folder in visibleFolders"
        :key="folder.id"
        class="ds-folder"
        :data-folder-block-id="folder.id"
        @contextmenu.stop="(e) => openCtxMenu(e, 'folder', folder.id)"
      >
        <div
          class="ds-folder-row"
          :class="folderRowClass(folder.id)"
          :data-folder-id="folder.id"
          title="长按可拖动排序"
          @mousedown="beginFolderDrag($event, folder)"
        >
          <button
            class="ds-chevron-btn"
            :title="isFolderCollapsed(folder.id) ? '展开' : '折叠'"
            @click.stop="toggleFolderCollapse(folder.id)"
          >
            <ChevronRight v-if="isFolderCollapsed(folder.id)" :size="13" :stroke-width="1.8" />
            <ChevronDown v-else :size="13" :stroke-width="1.8" />
          </button>
          <Folder :size="15" :stroke-width="1.8" class="ds-folder-icon" />
          <template v-if="renamingFolderId === folder.id">
            <input
              v-model="renameValue"
              ref="renameInputEl"
              class="ds-rename-input"
              @keydown.enter="commitRename('folder', folder.id)"
              @blur="cancelRename"
              @click.stop
            />
          </template>
          <span
            v-else
            class="ds-folder-title"
            title="双击重命名"
            @dblclick.stop="startRenameFolder(folder)"
          >{{ folder.title }}</span>
          <button
            class="ds-add-file-btn"
            title="在此文件夹下新建文档"
            @click.stop="onCreateFile(folder.id)"
          >
            <Plus :size="14" :stroke-width="2" />
          </button>
        </div>

        <!-- Files inside folder -->
        <div v-if="!isFolderCollapsed(folder.id) && filesInFolder(folder.id).length > 0" class="ds-folder-children">
          <template v-for="file in filesInFolder(folder.id)" :key="file.id">
            <div
              class="ds-file"
              :class="[
                { active: activeIdForTarget === file.id, 'ai-editing': isAiEditingDoc(file.id) },
                dropIndicatorClass(file.id),
              ]"
              :data-file-id="file.id"
              title="长按可拖动排序 / 移入其他文件夹"
              @click="selectFile(file)"
              @mousedown="beginFileDrag($event, file)"
              @contextmenu.stop="(e) => openCtxMenu(e, 'file', file.id)"
            >
              <!-- 有修订与批注图层时，左侧出现折叠 / 展开箭头，避免图层多了铺满面板。 -->
              <button
                v-if="layerCount(file.id) > 0"
                class="ds-layer-chevron"
                :title="layersCollapsed(file.id) ? `展开 ${layerCount(file.id)} 条修订与批注` : '折叠修订与批注'"
                @click.stop="onToggleLayers(file.id)"
              >
                <ChevronRight v-if="layersCollapsed(file.id)" :size="12" :stroke-width="2" />
                <ChevronDown v-else :size="12" :stroke-width="2" />
              </button>
              <FileText :size="14" :stroke-width="1.8" class="ds-file-icon" />
              <template v-if="renamingFileId === file.id">
                <input
                  v-model="renameValue"
                  ref="renameInputEl"
                  class="ds-rename-input"
                  @keydown.enter="commitRename('file', file.id)"
                  @blur="cancelRename"
                  @click.stop
                />
              </template>
              <span
                v-else
                class="ds-file-title"
                title="双击重命名"
                @dblclick.stop="startRenameFile(file)"
              >{{ file.title }}</span>
              <button class="ds-file-del" title="删除" @click.stop="removeFile(file.id)">
                <X :size="12" :stroke-width="1.8" />
              </button>
              <!-- 更多：上移 / 下移 / 全部应用 / 全部拒绝，位于删除图标右侧。 -->
              <button
                class="ds-file-more"
                :class="{ open: rowMenu?.fileId === file.id }"
                title="更多操作"
                @click.stop="toggleRowMenu($event, file.id)"
              >
                <MoreVertical :size="12" :stroke-width="2" />
              </button>
              <ChevronRight :size="14" :stroke-width="2" class="ds-file-open" aria-hidden="true" />
            </div>
            <!-- 修订与批注：作为该文档条目的二级目录（图层叠加）。 -->
            <RevisionLayerList v-if="layerCount(file.id) > 0" :file-id="file.id" nested />
          </template>
        </div>
      </div>

      <!-- Root-level files -->
      <template v-for="file in rootFiles" :key="file.id">
        <div
          class="ds-file"
          :class="[
            { active: activeIdForTarget === file.id, 'ai-editing': isAiEditingDoc(file.id) },
            dropIndicatorClass(file.id),
          ]"
          :data-file-id="file.id"
          title="长按可拖动排序 / 移入文件夹"
          @click="selectFile(file)"
          @mousedown="beginFileDrag($event, file)"
          @contextmenu.stop="(e) => openCtxMenu(e, 'file', file.id)"
        >
          <!-- 有修订与批注图层时，左侧出现折叠 / 展开箭头，避免图层多了铺满面板。 -->
          <button
            v-if="layerCount(file.id) > 0"
            class="ds-layer-chevron"
            :title="layersCollapsed(file.id) ? `展开 ${layerCount(file.id)} 条修订与批注` : '折叠修订与批注'"
            @click.stop="onToggleLayers(file.id)"
          >
            <ChevronRight v-if="layersCollapsed(file.id)" :size="12" :stroke-width="2" />
            <ChevronDown v-else :size="12" :stroke-width="2" />
          </button>
          <FileText :size="14" :stroke-width="1.8" class="ds-file-icon" />
          <template v-if="renamingFileId === file.id">
            <input
              v-model="renameValue"
              ref="renameInputEl"
              class="ds-rename-input"
              @keydown.enter="commitRename('file', file.id)"
              @blur="cancelRename"
              @click.stop
            />
          </template>
          <span
            v-else
            class="ds-file-title"
            title="双击重命名"
            @dblclick.stop="startRenameFile(file)"
          >{{ file.title }}</span>
          <button class="ds-file-del" title="删除" @click.stop="removeFile(file.id)">
            <X :size="12" :stroke-width="1.8" />
          </button>
          <!-- 更多：上移 / 下移 / 全部应用 / 全部拒绝，位于删除图标右侧。 -->
          <button
            class="ds-file-more"
            :class="{ open: rowMenu?.fileId === file.id }"
            title="更多操作"
            @click.stop="toggleRowMenu($event, file.id)"
          >
            <MoreVertical :size="12" :stroke-width="2" />
          </button>
        </div>
        <!-- 修订与批注：作为该文档条目的二级目录（图层叠加）。 -->
        <RevisionLayerList v-if="layerCount(file.id) > 0" :file-id="file.id" />
      </template>
    </div>

    <!-- 行内「更多」菜单：上移 / 下移 / 全部应用 / 全部拒绝。
         Teleport 到 body，用视口坐标定位，不受面板 overflow 裁剪。 -->
    <Teleport to="body">
      <div
        v-if="rowMenu"
        class="ds-ctx ds-row-menu"
        :style="{ left: rowMenu.x + 'px', top: rowMenu.y + 'px' }"
        @click.stop
      >
        <div class="ds-ctx-item" @click="rowMenuAction('up')">
          <ArrowUp :size="14" :stroke-width="1.8" />
          上移
        </div>
        <div class="ds-ctx-item" @click="rowMenuAction('down')">
          <ArrowDown :size="14" :stroke-width="1.8" />
          下移
        </div>
        <template v-if="layerCount(rowMenu.fileId) > 0">
          <div class="ds-ctx-divider"></div>
          <div class="ds-ctx-item" @click="rowMenuAction('apply-all')">
            <CheckCheck :size="14" :stroke-width="1.8" />
            全部应用（{{ layerCount(rowMenu.fileId) }}）
          </div>
          <div class="ds-ctx-item" @click="rowMenuAction('reject-all')">
            <XCircle :size="14" :stroke-width="1.8" />
            全部拒绝（{{ layerCount(rowMenu.fileId) }}）
          </div>
        </template>
      </div>
    </Teleport>

    <!-- Context menu -->
    <Teleport to="body">
      <div
        v-if="ctxMenu.show"
        class="ds-ctx"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }"
        @click.stop
      >
        <template v-if="ctxMenu.kind === 'empty'">
          <div class="ds-ctx-item" @click="ctxAction('new-folder')">
            <FolderPlus :size="14" :stroke-width="1.8" />
            新建文件夹
          </div>
          <div class="ds-ctx-item" @click="ctxAction('new-file-root')">
            <FilePlus :size="14" :stroke-width="1.8" />
            新建文档
          </div>
          <div
            class="ds-ctx-item"
            :class="{ disabled: !copiedFileId }"
            @click="pasteInto(null)"
          >
            <Clipboard :size="14" :stroke-width="1.8" />
            粘贴到当前目录
          </div>
        </template>

        <template v-else-if="ctxMenu.kind === 'file'">
          <div class="ds-ctx-item" @click="ctxAction('rename')">
            <Pencil :size="14" :stroke-width="1.8" />
            重命名
          </div>
          <div class="ds-ctx-item" @click="ctxAction('copy')">
            <Copy :size="14" :stroke-width="1.8" />
            复制
          </div>
          <div class="ds-ctx-item" :class="{ disabled: !copiedFileId }" @click="ctxAction('paste')">
            <Clipboard :size="14" :stroke-width="1.8" />
            粘贴到此
          </div>
          <div class="ds-ctx-item" @click="ctxAction('delete')">
            <Trash2 :size="14" :stroke-width="1.8" />
            删除
          </div>
        </template>

        <template v-else-if="ctxMenu.kind === 'folder'">
          <div class="ds-ctx-item" @click="ctxAction('rename')">
            <Pencil :size="14" :stroke-width="1.8" />
            重命名
          </div>
          <div class="ds-ctx-item" :class="{ disabled: !copiedFileId }" @click="ctxAction('paste')">
            <Clipboard :size="14" :stroke-width="1.8" />
            粘贴到此
          </div>
          <div class="ds-ctx-item" @click="ctxAction('new-file-here')">
            <FilePlus :size="14" :stroke-width="1.8" />
            在文件夹中新建文档
          </div>
          <div class="ds-ctx-item" @click="ctxAction('delete')">
            <Trash2 :size="14" :stroke-width="1.8" />
            删除
          </div>
        </template>
      </div>
    </Teleport>
  </aside>
</template>

<style scoped>
.doc-sidebar {
  width: 220px;
  min-width: 220px;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--surface-bright);
  border-right: 1px solid var(--outline-variant);
}

.ds-header {
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-bottom: 1px solid var(--outline-variant);
}

.ds-search {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: 6px;
  padding: 5px 8px;
  color: var(--on-surface-variant);
}

.ds-search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 12px;
  color: var(--on-surface);
}

.ds-search-input::placeholder {
  color: var(--on-surface-variant);
}

.ds-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.ds-icon-btn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 5px 0;
  border-radius: 6px;
  border: 1px solid var(--outline-variant);
  background: var(--surface-container);
  color: var(--on-surface-variant);
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.ds-icon-btn:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.ds-tree {
  flex: 1;
  overflow-y: auto;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ds-empty {
  padding: 24px 10px;
  text-align: center;
  font-size: 12px;
  color: var(--on-surface-variant);
}

.ds-folder {
  display: flex;
  flex-direction: column;
}

.ds-folder-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 6px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  cursor: default;
}

.ds-folder-row:hover {
  background: var(--surface-container);
}

.ds-folder-row.drag-over {
  background: var(--primary-fixed-dim, #dfe3ef);
  outline: 1px solid var(--primary);
}

/* ---- folder long-press reorder indicators ---- */

.ds-folder-row.is-dragging {
  opacity: 0.4;
}

.ds-folder-row.drop-before::before,
.ds-folder-row.drop-after::after {
  content: "";
  position: absolute;
  left: 2px;
  right: 2px;
  height: 2px;
  border-radius: 2px;
  background: var(--primary);
  box-shadow: 0 0 0 1px var(--primary-fixed-dim, #dfe3ef);
}

.ds-folder-row.drop-before::before {
  top: -2px;
}

.ds-folder-row.drop-after::after {
  bottom: -2px;
}

.ds-chevron-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.ds-chevron-btn:hover {
  background: var(--surface-container-high);
  color: var(--primary);
}

.ds-tree.drag-over-root {
  outline: 1px dashed var(--primary);
  outline-offset: -3px;
  border-radius: 8px;
  background: var(--primary-fixed-dim, #dfe3ef);
}

.ds-file.drag-over {
  background: var(--primary-fixed-dim, #dfe3ef);
  outline: 1px solid var(--primary);
}

/* ---- long-press reorder indicators ---- */

.ds-file {
  position: relative;
}

.ds-file.is-dragging {
  opacity: 0.4;
}

.ds-file.drop-before::before,
.ds-file.drop-after::after {
  content: "";
  position: absolute;
  left: 4px;
  right: 4px;
  height: 2px;
  border-radius: 2px;
  background: var(--primary);
  box-shadow: 0 0 0 1px var(--primary-fixed-dim, #dfe3ef);
}

.ds-file.drop-before::before {
  top: -1px;
}

.ds-file.drop-after::after {
  bottom: -1px;
}

.ds-file-del {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.ds-file:hover .ds-file-del {
  opacity: 1;
}

.ds-file-del:hover {
  background: var(--error-container);
  color: var(--error);
}

/* ---- 修订与批注图层：条目左侧折叠箭头 ---- */

/* 折叠箭头常驻（不随 hover 淡入）：它承载状态信息，藏起来就看不出有没有图层。 */
.ds-layer-chevron {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  margin-left: -3px;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--primary);
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.ds-layer-chevron:hover {
  background: rgb(var(--primary-rgb) / 0.14);
}

/* 「更多」按钮（⋮）：上移 / 下移 / 全部应用 / 全部拒绝都收在它后面的菜单里，
   这样行上只留删除与它两枚图标，文档名重新拿回宽度。菜单打开期间常驻可见。 */
.ds-file-more {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s ease;
}

.ds-file:hover .ds-file-more,
.ds-file-more.open {
  opacity: 1;
}

.ds-file-more:hover,
.ds-file-more.open {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
}

.ds-folder-icon {
  color: #e8b531;
  flex-shrink: 0;
}

.ds-folder-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 500;
  color: var(--on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ds-add-file-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ds-add-file-btn:hover {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
}

.ds-folder-children {
  margin-left: 16px;
  border-left: 1px solid var(--outline-variant);
  padding-left: 4px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.ds-file {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 8px;
  border-radius: 6px;
  color: var(--on-surface-variant);
  cursor: pointer;
  transition: background 0.25s ease, color 0.25s ease;
}

/* 参考 alshahwan 按钮动效（配色改用项目主题色，不照搬 #25D366）：
   悬停时整条背景填充为主题色、文字左移并变白、右侧箭头淡入。
   拖拽排序 / 放置指示（drop-before / drop-after / is-dragging）期间不启用填充，
   避免盖住插入位置指示线。 */
.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover {
  background: var(--primary);
  color: #fff;
}

.ds-file.active {
  background: var(--primary-fixed-dim, #dfe3ef);
  color: var(--primary);
  font-weight: 500;
}

/* ---- AI 正在改这一篇：边框颜色循环播放 ----
   用 inset box-shadow 画环而不是 ::before/::after，避开拖拽排序指示线占用的
   两个伪元素；不改 border/padding，所以行高与既有布局分毫不动。 */
.ds-file.ai-editing {
  animation: dsAiEditRing 2.4s linear infinite;
}

@keyframes dsAiEditRing {
  0% {
    box-shadow: inset 0 0 0 1.5px var(--primary), 0 0 0 0 rgb(var(--primary-rgb) / 0.34);
  }
  25% {
    box-shadow: inset 0 0 0 1.5px var(--secondary), 0 0 0 3px rgb(var(--primary-rgb) / 0.16);
  }
  50% {
    box-shadow: inset 0 0 0 1.5px var(--primary-container), 0 0 0 4px rgb(var(--primary-rgb) / 0.08);
  }
  75% {
    box-shadow: inset 0 0 0 1.5px var(--secondary-container), 0 0 0 3px rgb(var(--primary-rgb) / 0.16);
  }
  100% {
    box-shadow: inset 0 0 0 1.5px var(--primary), 0 0 0 0 rgb(var(--primary-rgb) / 0.34);
  }
}

/* 拖拽期间让位给插入位置指示线，避免两套视觉同时抢注意力。 */
.ds-file.ai-editing.is-dragging,
.ds-file.ai-editing.drop-before,
.ds-file.ai-editing.drop-after {
  animation: none;
}

@media (prefers-reduced-motion: reduce) {
  .ds-file.ai-editing {
    animation: none;
    box-shadow: inset 0 0 0 1.5px var(--primary);
  }
}

.ds-file-icon {
  flex-shrink: 0;
  opacity: 0.8;
  transition: color 0.25s ease;
}

.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-icon {
  color: #fff;
}

.ds-file-title {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.25s ease, transform 0.25s ease;
}

.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-title {
  color: #fff;
  transform: translateX(-2px);
}

/* 右侧行内按钮（删除 / 更多）在填充后的主题色底上保持可读 */
.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-more,
.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-del {
  color: #fff;
}

/* 折叠箭头同理：整行填成主题色后要转白，否则读不出来。 */
.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-layer-chevron {
  color: #fff;
}

.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-layer-chevron:hover,
.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-more:hover,
.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-more.open {
  background: rgb(255 255 255 / 0.2);
  color: #fff;
}

.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-del:hover {
  background: rgb(255 255 255 / 0.2);
  color: #ffe2e2;
}

/* 参考的“图标淡入”：右侧主题色箭头随悬浮显现 */
.ds-file-open {
  flex-shrink: 0;
  color: #fff;
  opacity: 0;
  transform: translateX(-3px);
  transition: opacity 0.3s ease, transform 0.3s ease;
  pointer-events: none;
}

.ds-file:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-open {
  opacity: 1;
  transform: translateX(0);
}

.ds-file.active .ds-file-open {
  color: var(--primary);
}

.ds-file.active:not(.is-dragging):not(.drop-before):not(.drop-after):hover .ds-file-open {
  color: #fff;
}

.ds-rename-input {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  padding: 2px 4px;
  border: 1px solid var(--primary);
  border-radius: 4px;
  outline: none;
  background: var(--surface-bright);
  color: var(--on-surface);
}

/* Context menu */
.ds-ctx {
  position: fixed;
  z-index: 90;
  min-width: 158px;
  background: var(--surface-bright);
  border: 1px solid var(--outline-variant);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
  padding: 5px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ds-ctx-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 10px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--on-surface);
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease;
}

.ds-ctx-item:hover {
  background: var(--surface-container-high);
}

.ds-ctx-item:active {
  transform: scale(0.97);
}

.ds-ctx-item.disabled {
  opacity: 0.5;
  pointer-events: none;
}

.ds-ctx-divider {
  height: 1px;
  margin: 3px 6px;
  background: var(--outline-variant);
}

/* 行内「更多」菜单：从按钮右下角展开，所以要右对齐；贴近视口下边界时
   自身向上翻转由 max-height + 内滚动兜住，不再额外测算。 */
.ds-row-menu {
  transform: translateX(-100%);
  min-width: 150px;
  max-height: calc(100vh - 24px);
  overflow-y: auto;
}
</style>