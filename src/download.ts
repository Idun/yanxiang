interface SaveFileWritable {
  write(content: string): Promise<void>;
  close(): Promise<void>;
}

interface SaveFileHandle {
  name?: string;
  createWritable(): Promise<SaveFileWritable>;
}

interface OpenFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<SaveFileWritable>;
}

type PickerType = { description: string; accept: Record<string, string[]> };

interface FilePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string;
    id?: string;
    startIn?: string;
    types?: PickerType[];
  }) => Promise<SaveFileHandle>;
  showOpenFilePicker?: (options: {
    id?: string;
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
    types?: PickerType[];
  }) => Promise<OpenFileHandle[]>;
}

export const JSON_PICKER_TYPES: PickerType[] = [
  { description: "JSON 文件", accept: { "application/json": [".json"] } },
];

export const TEXT_PICKER_TYPES: PickerType[] = [
  /* 第一项即对话框的默认筛选：把 md 与 txt 并在一起，导入纯文本小说
     不必先去下拉里切筛选器。后两项保留单独筛选，需要时仍可收窄。 */
  {
    description: "文本文档 (Markdown / 纯文本)",
    accept: { "text/markdown": [".md", ".markdown"], "text/plain": [".txt"] },
  },
  { description: "Markdown 文件", accept: { "text/markdown": [".md", ".markdown"] } },
  { description: "纯文本文件", accept: { "text/plain": [".txt"] } },
];

/**
 * Save a text file while showing the OS save-path dialog when the runtime
 * supports the File System Access API (Chromium / WebView2). Falls back to a
 * plain <a download> anchor when the API is unavailable.
 *
 * Returns the handle the user picked (when available) so callers can keep
 * writing to the very same file later without re-prompting, plus a `saved`
 * flag that is false when the user cancelled the dialog.
 */
export async function downloadTextFileWithDialog(
  suggestedName: string,
  content: string,
  mime = "application/json;charset=utf-8",
  types: PickerType[] = JSON_PICKER_TYPES,
): Promise<{ saved: boolean; handle?: SaveFileHandle }> {
  const w = window as unknown as FilePickerWindow;

  if (typeof w.showSaveFilePicker === "function") {
    try {
      const handle = await w.showSaveFilePicker({ suggestedName, types });
      const writable = await handle.createWritable();
      await writable.write(content);
      await writable.close();
      return { saved: true, handle };
    } catch {
      // User cancelled the dialog — do not silently download anything.
      return { saved: false };
    }
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return { saved: true };
}

/** Write text straight into a previously picked handle. Returns false on failure. */
export async function writeToHandle(
  handle: SaveFileHandle | undefined,
  content: string,
): Promise<boolean> {
  if (!handle) return false;
  try {
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

export interface PickedTextFile {
  name: string;
  content: string;
  handle?: SaveFileHandle;
}

/**
 * 规整导入的纯文本：去掉 UTF-8 BOM、把 CRLF / CR 统一成 LF。
 *
 * 纯文本 TXT（尤其是 Windows 下的小说文本）几乎都是 CRLF，残留的 `\r`
 * 会跟在每一行末尾，让章节标题匹配、字数统计与目录定位都要额外处理它。
 * 在入口一次性归一，后续所有逻辑只需面对 LF。
 */
function normalizeText(raw: string): string {
  return raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

/**
 * Open one or more text files through the OS dialog (multi-select). Uses the
 * File System Access API when present (so the same handle can later be written
 * back to), otherwise falls back to a hidden `<input type="file" multiple>`.
 * Returns an empty array when the user cancels.
 */
export async function openTextFilesWithDialog(
  types: PickerType[] = TEXT_PICKER_TYPES,
  accept = ".txt,.md,.markdown,text/plain,text/markdown",
): Promise<PickedTextFile[]> {
  const w = window as unknown as FilePickerWindow;

  if (typeof w.showOpenFilePicker === "function") {
    try {
      const handles = await w.showOpenFilePicker({ multiple: true, types });
      if (!handles || handles.length === 0) return [];
      const picked: PickedTextFile[] = [];
      for (const handle of handles) {
        const file = await handle.getFile();
        picked.push({ name: handle.name, content: normalizeText(await file.text()), handle });
      }
      return picked;
    } catch {
      return [];
    }
  }

  return new Promise<PickedTextFile[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = accept;
    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      if (files.length === 0) {
        resolve([]);
        return;
      }
      const picked: PickedTextFile[] = [];
      let pending = files.length;
      files.forEach((file, index) => {
        const reader = new FileReader();
        reader.onload = () => {
          picked[index] = { name: file.name, content: normalizeText(String(reader.result ?? "")) };
          if (--pending === 0) resolve(picked);
        };
        reader.onerror = () => {
          if (--pending === 0) resolve(picked);
        };
        reader.readAsText(file);
      });
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}
