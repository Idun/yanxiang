use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;

/// Core persistence layer backed by an embedded SQLite database.
///
/// All SQL here is intentionally written as a portable subset (CREATE TABLE,
/// INSERT, SELECT, UPDATE, DELETE) so the same schema and statements can be
/// lifted onto a PostgreSQL backend later by swapping the connection provider.
pub struct Storage {
    conn: Connection,
}

impl Storage {
    pub fn open(data_dir: PathBuf) -> Result<Self, String> {
        let dir = data_dir;
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
        }
        let db_path = dir.join("app.db");
        let conn = Connection::open(&db_path)
            .map_err(|e| format!("打开数据库失败: {}", e))?;
        conn.pragma_update(None, "journal_mode", "WAL")
            .map_err(|e| format!("设置日志模式失败: {}", e))?;
        conn.pragma_update(None, "foreign_keys", "ON")
            .map_err(|e| format!("启用外键失败: {}", e))?;

        let storage = Storage { conn };
        storage.init_schema()?;
        Ok(storage)
    }

    fn init_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                r#"
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS documents (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS writing_cards (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    title TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL DEFAULT '',
                    x INTEGER,
                    y INTEGER,
                    group_id TEXT,
                    created_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS card_groups (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL DEFAULT '',
                    color TEXT NOT NULL DEFAULT ''
                );

                CREATE TABLE IF NOT EXISTS refine_history (
                    id TEXT PRIMARY KEY,
                    time TEXT NOT NULL,
                    title TEXT NOT NULL,
                    original TEXT NOT NULL DEFAULT '',
                    content TEXT NOT NULL DEFAULT '',
                    chars INTEGER NOT NULL DEFAULT 0,
                    adjusted INTEGER NOT NULL DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS inspiration_notes (
                    id TEXT PRIMARY KEY,
                    content TEXT NOT NULL DEFAULT '',
                    tags TEXT NOT NULL DEFAULT '[]',
                    images TEXT NOT NULL DEFAULT '[]',
                    pinned INTEGER NOT NULL DEFAULT 0,
                    created_at INTEGER NOT NULL DEFAULT 0,
                    updated_at INTEGER NOT NULL DEFAULT 0
                );

                CREATE INDEX IF NOT EXISTS idx_inspiration_created
                    ON inspiration_notes (created_at DESC);
                "#,
            )
            .map_err(|e| format!("初始化数据库表失败: {}", e))?;

        let _ = self.conn.execute("ALTER TABLE writing_cards ADD COLUMN x INTEGER", []);
        let _ = self.conn.execute("ALTER TABLE writing_cards ADD COLUMN y INTEGER", []);
        let _ = self.conn.execute("ALTER TABLE writing_cards ADD COLUMN group_id TEXT", []);
        let _ = self.conn.execute("ALTER TABLE card_groups ADD COLUMN folded INTEGER", []);
        let _ = self.conn.execute("ALTER TABLE card_groups ADD COLUMN collapsed INTEGER", []);

        Ok(())
    }

    /* ---------- settings ---------- */

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO app_settings (key, value) VALUES (?1, ?2)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                rusqlite::params![key, value],
            )
            .map_err(|e| format!("保存设置失败: {}", e))?;
        Ok(())
    }

    pub fn all_settings(&self) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT key, value FROM app_settings")
            .map_err(|e| format!("查询设置失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
            .map_err(|e| format!("读取设置失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析设置失败: {}", e))
    }

    /* ---------- documents ---------- */

    pub fn save_document(&self, title: &str, content: &str) -> Result<i64, String> {
        let now = chrono::Local::now().to_rfc3339();
        self.conn
            .execute(
                "INSERT INTO documents (title, content, updated_at) VALUES (?1, ?2, ?3)",
                rusqlite::params![title, content, now],
            )
            .map_err(|e| format!("保存文档失败: {}", e))?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn get_latest_document(&self) -> Result<Option<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT content FROM documents ORDER BY id DESC LIMIT 1")
            .map_err(|e| format!("查询文档失败: {}", e))?;
        let mut rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| format!("读取文档失败: {}", e))?;
        match rows.next() {
            Some(Ok(v)) => Ok(Some(v)),
            Some(Err(e)) => Err(format!("解析文档失败: {}", e)),
            None => Ok(None),
        }
    }

    /* ---------- writing cards & groups ---------- */

    pub fn replace_writing_cards(&self, cards: &[WritingCardRow]) -> Result<u32, String> {
        self.conn
            .execute("DELETE FROM writing_cards", [])
            .map_err(|e| format!("清空写作卡片失败: {}", e))?;
        let now = chrono::Local::now().to_rfc3339();
        let mut count = 0u32;
        for card in cards {
            self.conn
                .execute(
                    "INSERT INTO writing_cards (id, title, content, x, y, group_id, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![card.id, card.title, card.content, card.x, card.y, card.group_id, now],
                )
                .map_err(|e| format!("保存写作卡片失败: {}", e))?;
            count += 1;
        }
        Ok(count)
    }

    pub fn load_writing_cards(&self) -> Result<Vec<WritingCardRow>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, title, content, x, y, group_id FROM writing_cards ORDER BY id ASC")
            .map_err(|e| format!("查询写作卡片失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(WritingCardRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    content: row.get(2)?,
                    x: row.get(3)?,
                    y: row.get(4)?,
                    group_id: row.get(5)?,
                })
            })
            .map_err(|e| format!("读取写作卡片失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析写作卡片失败: {}", e))
    }

    pub fn replace_card_groups(&mut self, groups: &[CardGroupRow]) -> Result<u32, String> {
        /* 整批替换放同一事务里：避免先 DELETE 后逐条 INSERT，中途失败会留下
           半份数据（表现为重启后组框消失）。color 为 None 时补空串，避免
           写入 color TEXT NOT NULL 约束冲突导致整批保存失败。 */
        let tx = self
            .conn
            .transaction()
            .map_err(|e| format!("开启卡片分组事务失败: {}", e))?;
        tx.execute("DELETE FROM card_groups", [])
            .map_err(|e| format!("清空卡片分组失败: {}", e))?;
        let mut count = 0u32;
        for g in groups {
            tx.execute(
                "INSERT INTO card_groups (id, title, color, folded, collapsed) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![
                    g.id,
                    g.title,
                    g.color.as_deref().unwrap_or(""),
                    g.folded.unwrap_or(false),
                    g.collapsed.unwrap_or(false),
                ],
            )
            .map_err(|e| format!("保存卡片分组失败: {}", e))?;
            count += 1;
        }
        tx.commit()
            .map_err(|e| format!("提交卡片分组失败: {}", e))?;
        Ok(count)
    }

    pub fn load_card_groups(&self) -> Result<Vec<CardGroupRow>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, title, color, folded, collapsed FROM card_groups")
            .map_err(|e| format!("查询卡片分组失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(CardGroupRow {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    color: row.get(2)?,
                    folded: row
                        .get::<_, Option<i64>>(3)?
                        .map(|v| v != 0),
                    collapsed: row
                        .get::<_, Option<i64>>(4)?
                        .map(|v| v != 0),
                })
            })
            .map_err(|e| format!("读取卡片分组失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析卡片分组失败: {}", e))
    }

    /* ---------- refine history ---------- */

    pub fn replace_refine_history(&self, items: &[RefineHistoryRow]) -> Result<u32, String> {
        self.conn
            .execute("DELETE FROM refine_history", [])
            .map_err(|e| format!("清空历史版本失败: {}", e))?;
        let mut count = 0u32;
        for item in items {
            self.conn
                .execute(
                    "INSERT INTO refine_history (id, time, title, original, content, chars, adjusted)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    rusqlite::params![
                        item.id,
                        item.time,
                        item.title,
                        item.original,
                        item.content,
                        item.chars,
                        item.adjusted
                    ],
                )
                .map_err(|e| format!("保存历史版本失败: {}", e))?;
            count += 1;
        }
        Ok(count)
    }

    pub fn load_refine_history(&self) -> Result<Vec<RefineHistoryRow>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id, time, title, original, content, chars, adjusted FROM refine_history")
            .map_err(|e| format!("查询历史版本失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(RefineHistoryRow {
                    id: row.get(0)?,
                    time: row.get(1)?,
                    title: row.get(2)?,
                    original: row.get(3)?,
                    content: row.get(4)?,
                    chars: row.get(5)?,
                    adjusted: row.get(6)?,
                })
            })
            .map_err(|e| format!("读取历史版本失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析历史版本失败: {}", e))
    }

    /* ---------- inspiration notes (灵感速记) ---------- */

    /// Upsert a single note. Inspiration capture is append-heavy and每条独立，
    /// 所以这里按 id 逐条写入，而不是像其他表那样整批替换 —— 避免一次误操作
    /// 就把用户攒下的灵感全部清空。
    pub fn upsert_inspiration_note(&self, note: &InspirationNoteRow) -> Result<(), String> {
        self.conn
            .execute(
                "INSERT INTO inspiration_notes
                     (id, content, tags, images, pinned, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT(id) DO UPDATE SET
                     content = excluded.content,
                     tags = excluded.tags,
                     images = excluded.images,
                     pinned = excluded.pinned,
                     updated_at = excluded.updated_at",
                rusqlite::params![
                    note.id,
                    note.content,
                    note.tags,
                    note.images,
                    note.pinned,
                    note.created_at,
                    note.updated_at,
                ],
            )
            .map_err(|e| format!("保存灵感速记失败: {}", e))?;
        Ok(())
    }

    pub fn delete_inspiration_note(&self, id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM inspiration_notes WHERE id = ?1",
                rusqlite::params![id],
            )
            .map_err(|e| format!("删除灵感速记失败: {}", e))?;
        Ok(())
    }

    pub fn load_inspiration_notes(&self) -> Result<Vec<InspirationNoteRow>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, content, tags, images, pinned, created_at, updated_at
                 FROM inspiration_notes
                 ORDER BY created_at DESC",
            )
            .map_err(|e| format!("查询灵感速记失败: {}", e))?;
        let rows = stmt
            .query_map([], |row| {
                Ok(InspirationNoteRow {
                    id: row.get(0)?,
                    content: row.get(1)?,
                    tags: row.get(2)?,
                    images: row.get(3)?,
                    pinned: row.get::<_, i64>(4)? != 0,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            })
            .map_err(|e| format!("读取灵感速记失败: {}", e))?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("解析灵感速记失败: {}", e))
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct WritingCardRow {
    pub id: Option<i64>,
    pub title: String,
    pub content: String,
    pub x: Option<i64>,
    pub y: Option<i64>,
    pub group_id: Option<String>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct CardGroupRow {
    pub id: String,
    pub title: String,
    pub color: Option<String>,
    pub folded: Option<bool>,
    pub collapsed: Option<bool>,
}

#[derive(serde::Serialize, serde::Deserialize)]
pub struct RefineHistoryRow {
    pub id: String,
    pub time: String,
    pub title: String,
    pub original: String,
    pub content: String,
    pub chars: i64,
    pub adjusted: i64,
}

/// 一条灵感速记。`tags` / `images` 以 JSON 数组字符串落库，保持表结构在
/// SQLite 与 PostgreSQL 之间可移植（迁移时可原样转成 jsonb）。
#[derive(serde::Serialize, serde::Deserialize)]
pub struct InspirationNoteRow {
    pub id: String,
    pub content: String,
    pub tags: String,
    pub images: String,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

pub type SharedStorage = Mutex<Storage>;