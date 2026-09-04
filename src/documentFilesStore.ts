import { reactive } from "vue";
import { dropReadingPosition } from "./readingPositionStore";

export interface DocFolderItem {
  id: string;
  title: string;
}

export interface DocFileItem {
  id: string;
  folderId: string | null;
  title: string;
  content: string;
  createdAt: number;
}

const ROOT_FILE_TITLE = "Main.md";

function initialFiles(): DocFileItem[] {
  return [
    {
      id: "file_main",
      folderId: null,
      title: ROOT_FILE_TITLE,
      content: "",
      createdAt: Date.now(),
    },
  ];
}

export const documentFilesStore = reactive({
  folders: [] as DocFolderItem[],
  files: initialFiles() as DocFileItem[],
  activeFileId: "file_main" as string | null,
  /* Secondary slot used by the 分栏 (split) two-column doc view. */
  activeFileId2: null as string | null,
});

export function activeDocFile(): DocFileItem | undefined {
  return documentFilesStore.files.find((f) => f.id === documentFilesStore.activeFileId);
}

/** Select the document shown in the secondary (分栏) pane. */
export function selectDocFile2(fileId: string): void {
  if (documentFilesStore.files.some((f) => f.id === fileId)) {
    documentFilesStore.activeFileId2 = fileId;
  }
}

export function createDocFolder(title?: string): DocFolderItem {
  const folder: DocFolderItem = {
    id: `folder_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: title?.trim() || "新建文件夹",
  };
  documentFilesStore.folders.push(folder);
  return folder;
}

export function renameDocFolder(folderId: string, title: string): void {
  const folder = documentFilesStore.folders.find((f) => f.id === folderId);
  if (folder && title.trim()) folder.title = title.trim();
}

export function deleteDocFolder(folderId: string): void {
  documentFilesStore.folders = documentFilesStore.folders.filter((f) => f.id !== folderId);
  const removed = documentFilesStore.files.filter((f) => f.folderId === folderId);
  removed.forEach((f) => {
    if (documentFilesStore.activeFileId === f.id) {
      switchToDefaultFile();
    }
    /* 文档没了，它的阅读位置记忆一起销账，避免 settings 里留下死条目。 */
    dropReadingPosition(f.id);
  });
  documentFilesStore.files = documentFilesStore.files.filter((f) => f.folderId !== folderId);
}

export function createDocFile(folderId: string | null, title?: string): DocFileItem {
  const file: DocFileItem = {
    id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    folderId,
    title: title?.trim() || "未命名文档",
    content: "",
    createdAt: Date.now(),
  };
  documentFilesStore.files.push(file);
  return file;
}

export function renameDocFile(fileId: string, title: string): void {
  const file = documentFilesStore.files.find((f) => f.id === fileId);
  if (file && title.trim()) file.title = title.trim();
}

export function duplicateDocFile(fileId: string): DocFileItem | undefined {
  const src = documentFilesStore.files.find((f) => f.id === fileId);
  if (!src) return undefined;
  const copy: DocFileItem = {
    id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    folderId: src.folderId,
    title: `${src.title} (副本)`,
    content: src.content,
    createdAt: Date.now(),
  };
  documentFilesStore.files.push(copy);
  return copy;
}

export function deleteDocFile(fileId: string): void {
  if (documentFilesStore.activeFileId === fileId) {
    switchToDefaultFile();
  }
  documentFilesStore.files = documentFilesStore.files.filter((f) => f.id !== fileId);
  dropReadingPosition(fileId);
}

function switchToDefaultFile(): void {
  const defaultFile = documentFilesStore.files.find(
    (f) => f.id !== documentFilesStore.activeFileId && f.folderId === null,
  );
  if (defaultFile) {
    documentFilesStore.activeFileId = defaultFile.id;
    return;
  }
  if (documentFilesStore.files.length > 0) {
    documentFilesStore.activeFileId = documentFilesStore.files[0].id;
    return;
  }
  const root = createDocFile(null, "Main.md");
  documentFilesStore.activeFileId = root.id;
}

export function selectDocFile(fileId: string): void {
  if (documentFilesStore.files.some((f) => f.id === fileId)) {
    documentFilesStore.activeFileId = fileId;
  }
}

export function moveDocFile(fileId: string, direction: -1 | 1): void {
  const index = documentFilesStore.files.findIndex((f) => f.id === fileId);
  if (index === -1) return;
  const file = documentFilesStore.files[index];
  const siblings = documentFilesStore.files.filter((f) => f.folderId === file.folderId);
  const siblingIndex = siblings.findIndex((f) => f.id === fileId);
  const targetSiblingIndex = siblingIndex + direction;
  if (targetSiblingIndex < 0 || targetSiblingIndex >= siblings.length) return;
  const swap = siblings[targetSiblingIndex];
  const swapMainIndex = documentFilesStore.files.indexOf(swap);
  if (swapMainIndex === -1) return;
  const next = documentFilesStore.files.slice();
  next[index] = swap;
  next[swapMainIndex] = file;
  documentFilesStore.files = next;
}

/**
 * Drop `fileId` immediately before/after `targetFileId`.
 *
 * The dragged file also adopts the target's folder, so a single gesture handles
 * both re-ordering within a list and moving between folders.
 */
export function reorderDocFile(
  fileId: string,
  targetFileId: string,
  place: "before" | "after",
): boolean {
  if (fileId === targetFileId) return false;

  const files = documentFilesStore.files.slice();
  const from = files.findIndex((f) => f.id === fileId);
  if (from === -1) return false;

  const [moved] = files.splice(from, 1);

  const targetIndex = files.findIndex((f) => f.id === targetFileId);
  if (targetIndex === -1) return false;

  const target = files[targetIndex];
  moved.folderId = target.folderId;

  const insertAt = place === "before" ? targetIndex : targetIndex + 1;
  files.splice(insertAt, 0, moved);

  documentFilesStore.files = files;
  return true;
}

/** Send a document to the end of the given folder (or of the root list). */
export function appendDocFileToFolder(fileId: string, folderId: string | null): boolean {
  const files = documentFilesStore.files.slice();
  const from = files.findIndex((f) => f.id === fileId);
  if (from === -1) return false;

  const [moved] = files.splice(from, 1);
  moved.folderId = folderId;

  let insertAt = files.length;
  for (let i = files.length - 1; i >= 0; i--) {
    if (files[i].folderId === folderId) {
      insertAt = i + 1;
      break;
    }
  }
  files.splice(insertAt, 0, moved);

  documentFilesStore.files = files;
  return true;
}

/** Drop `folderId` immediately before/after `targetFolderId` in the tree order. */
export function reorderDocFolder(
  folderId: string,
  targetFolderId: string,
  place: "before" | "after",
): boolean {
  if (folderId === targetFolderId) return false;

  const folders = documentFilesStore.folders.slice();
  const from = folders.findIndex((f) => f.id === folderId);
  if (from === -1) return false;

  const [moved] = folders.splice(from, 1);

  const targetIndex = folders.findIndex((f) => f.id === targetFolderId);
  if (targetIndex === -1) return false;

  folders.splice(place === "before" ? targetIndex : targetIndex + 1, 0, moved);
  documentFilesStore.folders = folders;
  return true;
}

/** Move a folder to the very start / end of the folder list. */
export function moveDocFolderToEdge(folderId: string, edge: "start" | "end"): boolean {
  const folders = documentFilesStore.folders.slice();
  const from = folders.findIndex((f) => f.id === folderId);
  if (from === -1) return false;
  if ((edge === "start" && from === 0) || (edge === "end" && from === folders.length - 1)) {
    return false;
  }
  const [moved] = folders.splice(from, 1);
  if (edge === "start") folders.unshift(moved);
  else folders.push(moved);
  documentFilesStore.folders = folders;
  return true;
}