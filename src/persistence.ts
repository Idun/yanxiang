/**
 * Local persistence facade.
 *
 * In a Tauri (desktop) runtime this delegates to the Rust SQLite layer
 * (via `invoke`). In plain-browser previews it falls back to localStorage
 * so the app still works during development.
 *
 * All key names / shapes are designed to transfer to a PostgreSQL backend
 * later without changing the call sites.
 */

interface TauriWindow {
  __TAURI_INTERNALS__?: unknown;
}

async function isTauri(): Promise<boolean> {
  return typeof window !== "undefined" && !!(window as TauriWindow).__TAURI_INTERNALS__;
}

async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const mod = await import("@tauri-apps/api/core");
  return mod.invoke<T>(cmd, args);
}

const LS_PREFIX = "docintel:db:";

/* ---------- settings ---------- */

export async function saveSettings(
  settings: { key: string; value: string }[],
): Promise<void> {
  if (await isTauri()) {
    await invoke("db_save_settings", {
      settings: settings.map((s) => [s.key, s.value]),
    });
  } else {
    for (const s of settings) {
      localStorage.setItem(LS_PREFIX + s.key, s.value);
    }
  }
}

export async function loadSettings(): Promise<Record<string, string>> {
  if (await isTauri()) {
    const raw = await invoke<Record<string, string>>("db_load_settings");
    return raw ?? {};
  }
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LS_PREFIX)) {
      out[key.slice(LS_PREFIX.length)] = localStorage.getItem(key) ?? "";
    }
  }
  return out;
}

/* ---------- document ---------- */

export async function saveDocument(content: string): Promise<void> {
  if (await isTauri()) {
    await invoke("db_save_document", { content });
  } else {
    localStorage.setItem(LS_PREFIX + "document", content);
  }
}

export async function loadDocument(): Promise<string> {
  if (await isTauri()) {
    return await invoke<string>("db_load_document");
  }
  return localStorage.getItem(LS_PREFIX + "document") ?? "";
}

/* ---------- writing cards & groups ---------- */

export interface WritingCardPayload {
  id?: number;
  title: string;
  content: string;
  x?: number;
  y?: number;
  groupId?: string;
}

export interface CardGroupPayload {
  id: string;
  title: string;
  color?: string;
  folded?: boolean;
  collapsed?: boolean;
}

export async function saveWritingCards(cards: WritingCardPayload[]): Promise<void> {
  if (await isTauri()) {
    const rustCards = cards.map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      x: c.x,
      y: c.y,
      group_id: c.groupId,
    }));
    await invoke("db_save_writing_cards", { cards: rustCards });
  } else {
    localStorage.setItem(LS_PREFIX + "writingCards", JSON.stringify(cards));
  }
}

export async function loadWritingCards(): Promise<WritingCardPayload[]> {
  if (await isTauri()) {
    const raw = await invoke<Array<{ id?: number; title: string; content: string; x?: number; y?: number; group_id?: string }>>("db_load_writing_cards");
    return (raw ?? []).map((c) => ({
      id: c.id,
      title: c.title,
      content: c.content,
      x: c.x,
      y: c.y,
      groupId: c.group_id,
    }));
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + "writingCards");
    return raw ? (JSON.parse(raw) as WritingCardPayload[]) : [];
  } catch {
    return [];
  }
}

export async function saveCardGroups(groups: CardGroupPayload[]): Promise<void> {
  /* color 列在 SQLite 中为 NOT NULL，缺省时若不补成空串，Rust 端会绑定
     NULL 触发约束冲突，导致打组永远无法落库（重启后组框丢失）。
     folded/collapsed 一并补默认值，保证折叠/展开状态随组一起持久化。 */
  const normalized = groups.map((g) => ({
    id: g.id,
    title: g.title,
    color: g.color ?? "",
    folded: g.folded ?? false,
    collapsed: g.collapsed ?? false,
  }));
  if (await isTauri()) {
    await invoke("db_save_card_groups", { groups: normalized });
  } else {
    localStorage.setItem(LS_PREFIX + "cardGroups", JSON.stringify(normalized));
  }
}

export async function loadCardGroups(): Promise<CardGroupPayload[]> {
  if (await isTauri()) {
    const raw = await invoke<CardGroupPayload[]>("db_load_card_groups");
    return raw ?? [];
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + "cardGroups");
    return raw ? (JSON.parse(raw) as CardGroupPayload[]) : [];
  } catch {
    return [];
  }
}

/* ---------- refine history ---------- */

export interface RefineHistoryPayload {
  id: string;
  time: string;
  title: string;
  original: string;
  content: string;
  chars: number;
  adjusted: number;
  tokens?: number;
}

export async function saveRefineHistory(items: RefineHistoryPayload[]): Promise<void> {
  if (await isTauri()) {
    await invoke("db_save_refine_history", { items });
  } else {
    localStorage.setItem(LS_PREFIX + "refineHistory", JSON.stringify(items));
  }
}

export async function loadRefineHistory(): Promise<RefineHistoryPayload[]> {
  if (await isTauri()) {
    const raw = await invoke<RefineHistoryPayload[]>("db_load_refine_history");
    return raw ?? [];
  }
  try {
    const raw = localStorage.getItem(LS_PREFIX + "refineHistory");
    return raw ? (JSON.parse(raw) as RefineHistoryPayload[]) : [];
  } catch {
    return [];
  }
}

/* ---------- inspiration notes (灵感速记) ---------- */

/**
 * 一条灵感速记。`tags` / `images` 在 Rust 侧以 JSON 数组字符串存列，
 * 这里保持相同形状，以便后续换到 PostgreSQL 时列类型可直接升级为 jsonb。
 */
export interface InspirationNotePayload {
  id: string;
  content: string;
  /** JSON 数组字符串，如 `["灵感","设定"]` */
  tags: string;
  /** JSON 数组字符串，元素为 data URL */
  images: string;
  pinned: boolean;
  created_at: number;
  updated_at: number;
}

const LS_NOTES_KEY = LS_PREFIX + "inspirationNotes";

function readLocalNotes(): InspirationNotePayload[] {
  try {
    const raw = localStorage.getItem(LS_NOTES_KEY);
    return raw ? (JSON.parse(raw) as InspirationNotePayload[]) : [];
  } catch {
    return [];
  }
}

/** 逐条 upsert：灵感是持续追加的数据，避免整批替换带来的全量丢失风险。 */
export async function saveInspirationNote(note: InspirationNotePayload): Promise<void> {
  if (await isTauri()) {
    await invoke("db_save_inspiration_note", { note });
    return;
  }
  const items = readLocalNotes();
  const idx = items.findIndex((n) => n.id === note.id);
  if (idx === -1) items.unshift(note);
  else items[idx] = note;
  localStorage.setItem(LS_NOTES_KEY, JSON.stringify(items));
}

export async function deleteInspirationNote(id: string): Promise<void> {
  if (await isTauri()) {
    await invoke("db_delete_inspiration_note", { id });
    return;
  }
  localStorage.setItem(
    LS_NOTES_KEY,
    JSON.stringify(readLocalNotes().filter((n) => n.id !== id)),
  );
}

export async function loadInspirationNotes(): Promise<InspirationNotePayload[]> {
  if (await isTauri()) {
    const raw = await invoke<InspirationNotePayload[]>("db_load_inspiration_notes");
    return raw ?? [];
  }
  return readLocalNotes().sort((a, b) => b.created_at - a.created_at);
}