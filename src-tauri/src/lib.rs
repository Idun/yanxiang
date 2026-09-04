use std::path::PathBuf;

use tauri::{Manager, State};

mod storage;
use storage::{
    CardGroupRow, InspirationNoteRow, RefineHistoryRow, SharedStorage, Storage, WritingCardRow,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| PathBuf::from("."));
            let storage = Storage::open(data_dir)
                .map_err(|e| Box::<dyn std::error::Error>::from(format!("存储初始化失败: {e}")))?;
            app.manage::<SharedStorage>(std::sync::Mutex::new(storage));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db_save_settings,
            db_load_settings,
            db_save_document,
            db_load_document,
            db_save_writing_cards,
            db_load_writing_cards,
            db_save_card_groups,
            db_load_card_groups,
            db_save_refine_history,
            db_load_refine_history,
            db_save_inspiration_note,
            db_delete_inspiration_note,
            db_load_inspiration_notes,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DocIntel AI desktop application");
}

/// Persists a batch of key/value settings.
#[tauri::command]
fn db_save_settings(state: State<'_, SharedStorage>, settings: Vec<(String, String)>) -> Result<(), String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    for (key, value) in settings {
        storage.set_setting(&key, &value)?;
    }
    Ok(())
}

/// Loads all settings (used on startup to restore prompt/config).
#[tauri::command]
fn db_load_settings(state: State<'_, SharedStorage>) -> Result<serde_json::Value, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    let pairs = storage.all_settings()?;
    let mut map = serde_json::Map::new();
    for (k, v) in pairs {
        map.insert(k, serde_json::Value::String(v));
    }
    Ok(serde_json::Value::Object(map))
}

/// Stores the active Markdown document.
#[tauri::command]
fn db_save_document(state: State<'_, SharedStorage>, content: String) -> Result<i64, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.save_document("MAIN.md", &content)
}

/// Loads the latest Markdown document.
#[tauri::command]
fn db_load_document(state: State<'_, SharedStorage>) -> Result<String, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    Ok(storage.get_latest_document()?.unwrap_or_default())
}

/// Persists writing cards (full replace) to the local database.
#[tauri::command]
fn db_save_writing_cards(state: State<'_, SharedStorage>, cards: Vec<WritingCardRow>) -> Result<u32, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.replace_writing_cards(&cards)
}

/// Loads writing cards from local database.
#[tauri::command]
fn db_load_writing_cards(state: State<'_, SharedStorage>) -> Result<Vec<WritingCardRow>, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.load_writing_cards()
}

/// Persists card groups to local database.
#[tauri::command]
fn db_save_card_groups(state: State<'_, SharedStorage>, groups: Vec<CardGroupRow>) -> Result<u32, String> {
    let mut storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.replace_card_groups(&groups)
}

/// Loads card groups from local database.
#[tauri::command]
fn db_load_card_groups(state: State<'_, SharedStorage>) -> Result<Vec<CardGroupRow>, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.load_card_groups()
}

/// Persists refine history (full replace) to the local database.
#[tauri::command]
fn db_save_refine_history(state: State<'_, SharedStorage>, items: Vec<RefineHistoryRow>) -> Result<u32, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.replace_refine_history(&items)
}

/// Loads refine history from local database.
#[tauri::command]
fn db_load_refine_history(state: State<'_, SharedStorage>) -> Result<Vec<RefineHistoryRow>, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.load_refine_history()
}

/// Upserts one inspiration note (灵感速记). Per-note writes keep the capture
/// flow cheap and make an accidental full wipe impossible.
#[tauri::command]
fn db_save_inspiration_note(
    state: State<'_, SharedStorage>,
    note: InspirationNoteRow,
) -> Result<(), String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.upsert_inspiration_note(&note)
}

/// Deletes one inspiration note by id.
#[tauri::command]
fn db_delete_inspiration_note(state: State<'_, SharedStorage>, id: String) -> Result<(), String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.delete_inspiration_note(&id)
}

/// Loads all inspiration notes, newest first.
#[tauri::command]
fn db_load_inspiration_notes(
    state: State<'_, SharedStorage>,
) -> Result<Vec<InspirationNoteRow>, String> {
    let storage = state
        .lock()
        .map_err(|e| format!("数据库锁获取失败: {e}"))?;
    storage.load_inspiration_notes()
}