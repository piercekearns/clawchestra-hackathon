use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

use once_cell::sync::Lazy;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{unix_timestamp_secs, DEFAULT_SESSION_KEY};

// -------------------------------------------------------------------------
// Global database connection (thread-safe)
// -------------------------------------------------------------------------

static CHAT_DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

fn get_chat_db_path() -> Result<PathBuf, String> {
    let data_dir =
        dirs::data_dir().ok_or_else(|| "Could not find app data directory".to_string())?;
    let app_dir = data_dir.join("clawchestra");
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    Ok(app_dir.join("chat.db"))
}

fn init_chat_db() -> Result<Connection, String> {
    let db_path = get_chat_db_path()?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;")
        .map_err(|e| e.to_string())?;

    // Create messages table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            metadata TEXT,
            created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Create index for timestamp queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_timestamp_id ON messages(timestamp DESC, id DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS pending_turns (
            turn_token TEXT PRIMARY KEY,
            session_key TEXT NOT NULL,
            run_id TEXT,
            status TEXT NOT NULL,
            submitted_at INTEGER NOT NULL,
            last_signal_at INTEGER NOT NULL,
            completed_at INTEGER,
            has_assistant_output INTEGER NOT NULL DEFAULT 0,
            completion_reason TEXT,
            updated_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_pending_turns_session_status
         ON pending_turns(session_key, status)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS chat_recovery_cursor (
            session_key TEXT PRIMARY KEY,
            last_message_id TEXT,
            last_timestamp INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(conn)
}

fn get_or_init_chat_db() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, String> {
    let mut guard = CHAT_DB.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(init_chat_db()?);
    }
    Ok(guard)
}

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatMessage {
    id: String,
    role: String,
    content: String,
    timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingTurn {
    turn_token: String,
    session_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    run_id: Option<String>,
    status: String,
    submitted_at: i64,
    last_signal_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    completed_at: Option<i64>,
    has_assistant_output: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    completion_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ChatRecoveryCursor {
    session_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    last_message_id: Option<String>,
    last_timestamp: i64,
    updated_at: i64,
}

// -------------------------------------------------------------------------
// Non-command helpers (used by migrations in lib.rs)
// -------------------------------------------------------------------------

/// Low-level DB clear that returns errors (unlike the Tauri command which is fire-and-forget).
/// Used by migrations and the `chat_messages_clear` Tauri command.
pub(crate) fn clear_chat_database() -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    conn.execute("DELETE FROM messages", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// -------------------------------------------------------------------------
// Tauri commands
// -------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn chat_messages_load(
    before_timestamp: Option<i64>,
    before_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, String> {
    let limit = limit.unwrap_or(50);
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    let mut messages: Vec<ChatMessage> = Vec::new();

    match before_timestamp {
        Some(ts) => {
            if let Some(cursor_id) = before_id {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, role, content, timestamp, metadata FROM messages
                         WHERE (timestamp < ?1) OR (timestamp = ?1 AND id < ?2)
                         ORDER BY timestamp DESC, id DESC LIMIT ?3",
                    )
                    .map_err(|e| e.to_string())?;

                let rows = stmt
                    .query_map(params![ts, cursor_id, limit], |row| {
                        Ok(ChatMessage {
                            id: row.get(0)?,
                            role: row.get(1)?,
                            content: row.get(2)?,
                            timestamp: row.get(3)?,
                            metadata: row.get(4)?,
                        })
                    })
                    .map_err(|e| e.to_string())?;

                for row in rows {
                    messages.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
                }
            } else {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, role, content, timestamp, metadata FROM messages
                         WHERE timestamp < ?1
                         ORDER BY timestamp DESC, id DESC LIMIT ?2",
                    )
                    .map_err(|e| e.to_string())?;

                let rows = stmt
                    .query_map(params![ts, limit], |row| {
                        Ok(ChatMessage {
                            id: row.get(0)?,
                            role: row.get(1)?,
                            content: row.get(2)?,
                            timestamp: row.get(3)?,
                            metadata: row.get(4)?,
                        })
                    })
                    .map_err(|e| e.to_string())?;

                for row in rows {
                    messages.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
                }
            }
        }
        None => {
            let mut stmt = conn
                .prepare(
                    "SELECT id, role, content, timestamp, metadata FROM messages
                     ORDER BY timestamp DESC, id DESC LIMIT ?1",
                )
                .map_err(|e| e.to_string())?;

            let rows = stmt
                .query_map(params![limit], |row| {
                    Ok(ChatMessage {
                        id: row.get(0)?,
                        role: row.get(1)?,
                        content: row.get(2)?,
                        timestamp: row.get(3)?,
                        metadata: row.get(4)?,
                    })
                })
                .map_err(|e| e.to_string())?;

            for row in rows {
                messages.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
            }
        }
    }

    // Reverse to get chronological order (oldest first)
    messages.reverse();

    Ok(messages)
}

#[tauri::command]
pub(crate) fn chat_message_save(message: ChatMessage) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    conn.execute(
        "INSERT OR IGNORE INTO messages (id, role, content, timestamp, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            message.id,
            message.role,
            message.content,
            message.timestamp,
            message.metadata,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn chat_messages_clear() -> Result<(), String> {
    clear_chat_database()
}

#[tauri::command]
pub(crate) fn chat_messages_count() -> Result<i64, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    Ok(count)
}

#[tauri::command]
pub(crate) fn chat_pending_turn_save(turn: PendingTurn) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    conn.execute(
        "INSERT OR REPLACE INTO pending_turns (
            turn_token,
            session_key,
            run_id,
            status,
            submitted_at,
            last_signal_at,
            completed_at,
            has_assistant_output,
            completion_reason,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, (strftime('%s', 'now') * 1000))",
        params![
            turn.turn_token,
            turn.session_key,
            turn.run_id,
            turn.status,
            turn.submitted_at,
            turn.last_signal_at,
            turn.completed_at,
            if turn.has_assistant_output { 1 } else { 0 },
            turn.completion_reason,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub(crate) fn chat_pending_turn_remove(turn_token: String) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "DELETE FROM pending_turns WHERE turn_token = ?1",
        params![turn_token],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn chat_pending_turns_load(
    session_key: Option<String>,
) -> Result<Vec<PendingTurn>, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    let mut turns: Vec<PendingTurn> = Vec::new();

    if let Some(session) = session_key {
        let mut stmt = conn
            .prepare(
                "SELECT turn_token, session_key, run_id, status, submitted_at, last_signal_at,
                        completed_at, has_assistant_output, completion_reason
                 FROM pending_turns
                 WHERE session_key = ?1
                 ORDER BY submitted_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![session], |row| {
                Ok(PendingTurn {
                    turn_token: row.get(0)?,
                    session_key: row.get(1)?,
                    run_id: row.get(2)?,
                    status: row.get(3)?,
                    submitted_at: row.get(4)?,
                    last_signal_at: row.get(5)?,
                    completed_at: row.get(6)?,
                    has_assistant_output: row.get::<_, i64>(7)? != 0,
                    completion_reason: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            turns.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
        }
    } else {
        let mut stmt = conn
            .prepare(
                "SELECT turn_token, session_key, run_id, status, submitted_at, last_signal_at,
                        completed_at, has_assistant_output, completion_reason
                 FROM pending_turns
                 ORDER BY submitted_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(PendingTurn {
                    turn_token: row.get(0)?,
                    session_key: row.get(1)?,
                    run_id: row.get(2)?,
                    status: row.get(3)?,
                    submitted_at: row.get(4)?,
                    last_signal_at: row.get(5)?,
                    completed_at: row.get(6)?,
                    has_assistant_output: row.get::<_, i64>(7)? != 0,
                    completion_reason: row.get(8)?,
                })
            })
            .map_err(|e| e.to_string())?;

        for row in rows {
            turns.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
        }
    }

    Ok(turns)
}

#[tauri::command]
pub(crate) fn chat_flush() -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    conn.execute_batch("PRAGMA wal_checkpoint(FULL); PRAGMA optimize;")
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn chat_recovery_cursor_get(
    session_key: Option<String>,
) -> Result<Option<ChatRecoveryCursor>, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    let key = session_key.unwrap_or_else(|| DEFAULT_SESSION_KEY.to_string());
    let mut stmt = conn
        .prepare(
            "SELECT session_key, last_message_id, last_timestamp, updated_at
             FROM chat_recovery_cursor
             WHERE session_key = ?1",
        )
        .map_err(|e| e.to_string())?;

    let cursor = stmt
        .query_row(params![key], |row| {
            Ok(ChatRecoveryCursor {
                session_key: row.get(0)?,
                last_message_id: row.get(1)?,
                last_timestamp: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(cursor)
}

#[tauri::command]
pub(crate) fn chat_recovery_cursor_advance(
    session_key: String,
    last_timestamp: i64,
    last_message_id: Option<String>,
) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    let now = (unix_timestamp_secs() as i64) * 1000;
    conn.execute(
        "INSERT INTO chat_recovery_cursor (session_key, last_message_id, last_timestamp, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(session_key) DO UPDATE SET
           last_message_id = CASE
             WHEN excluded.last_timestamp >= chat_recovery_cursor.last_timestamp
               THEN excluded.last_message_id
             ELSE chat_recovery_cursor.last_message_id
           END,
           last_timestamp = CASE
             WHEN excluded.last_timestamp >= chat_recovery_cursor.last_timestamp
               THEN excluded.last_timestamp
             ELSE chat_recovery_cursor.last_timestamp
           END,
           updated_at = excluded.updated_at",
        params![session_key, last_message_id, last_timestamp, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn chat_recovery_cursor_clear(session_key: Option<String>) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    if let Some(key) = session_key {
        conn.execute(
            "DELETE FROM chat_recovery_cursor WHERE session_key = ?1",
            params![key],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("DELETE FROM chat_recovery_cursor", [])
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
