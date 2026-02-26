use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::chat::get_or_init_chat_db;
use crate::unix_timestamp_secs;

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HubChat {
    pub id: String,
    pub project_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub item_id: Option<String>,
    #[serde(rename = "type")]
    pub chat_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_type: Option<String>,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_key: Option<String>,
    pub pinned: bool,
    pub unread: bool,
    pub sort_order: i64,
    pub created_at: i64,
    pub last_activity: i64,
    pub message_count: i64,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HubChatUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sort_order: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_activity: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_count: Option<i64>,
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

fn generate_session_key(project_id: &str, item_id: Option<&str>) -> String {
    if let Some(item) = item_id {
        format!("agent:main:project:{}:item:{}", project_id, item)
    } else {
        format!("agent:main:project:{}", project_id)
    }
}

fn now_ms() -> i64 {
    (unix_timestamp_secs() as i64) * 1000
}

fn row_to_hub_chat(row: &rusqlite::Row<'_>) -> rusqlite::Result<HubChat> {
    Ok(HubChat {
        id: row.get(0)?,
        project_id: row.get(1)?,
        item_id: row.get(2)?,
        chat_type: row.get(3)?,
        agent_type: row.get(4)?,
        title: row.get(5)?,
        session_key: row.get(6)?,
        pinned: row.get::<_, i64>(7)? != 0,
        unread: row.get::<_, i64>(8)? != 0,
        sort_order: row.get(9)?,
        created_at: row.get(10)?,
        last_activity: row.get(11)?,
        message_count: row.get(12)?,
        archived: row.get::<_, i64>(13)? != 0,
    })
}

// -------------------------------------------------------------------------
// DB initialisation (called from chat.rs init_chat_db)
// -------------------------------------------------------------------------

pub(crate) fn create_hub_chats_table(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            item_id TEXT,
            type TEXT NOT NULL DEFAULT 'openclaw',
            agent_type TEXT,
            title TEXT NOT NULL,
            session_key TEXT,
            pinned INTEGER NOT NULL DEFAULT 0,
            unread INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            last_activity INTEGER NOT NULL,
            message_count INTEGER DEFAULT 0,
            archived INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chats_project ON chats(project_id, archived)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chats_project_item ON chats(project_id, item_id)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chats_session_key ON chats(session_key)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_chats_last_activity ON chats(last_activity DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// -------------------------------------------------------------------------
// Tauri commands
// -------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn hub_chat_create(
    project_id: String,
    item_id: Option<String>,
    chat_type: String,
    agent_type: Option<String>,
    title: String,
) -> Result<HubChat, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    let id = Uuid::new_v4().to_string();
    let now = now_ms();

    // Generate session key for openclaw chats; null for terminal sessions
    let session_key = if chat_type == "openclaw" {
        Some(generate_session_key(&project_id, item_id.as_deref()))
    } else {
        None
    };

    // Determine sort_order: max existing + 1
    let max_sort: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM chats WHERE project_id = ?1",
            params![project_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    let chat = HubChat {
        id: id.clone(),
        project_id: project_id.clone(),
        item_id: item_id.clone(),
        chat_type: chat_type.clone(),
        agent_type: agent_type.clone(),
        title: title.clone(),
        session_key: session_key.clone(),
        pinned: false,
        unread: false,
        sort_order: max_sort + 1,
        created_at: now,
        last_activity: now,
        message_count: 0,
        archived: false,
    };

    conn.execute(
        "INSERT INTO chats (id, project_id, item_id, type, agent_type, title, session_key, pinned, unread, sort_order, created_at, last_activity, message_count, archived)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0, ?8, ?9, ?10, 0, 0)",
        params![
            id,
            project_id,
            item_id,
            chat_type,
            agent_type,
            title,
            session_key,
            max_sort + 1,
            now,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(chat)
}

#[tauri::command]
pub(crate) fn hub_chat_list(
    project_id: Option<String>,
    include_archived: Option<bool>,
) -> Result<Vec<HubChat>, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    let include_archived = include_archived.unwrap_or(false);

    let mut chats: Vec<HubChat> = Vec::new();

    if let Some(pid) = project_id {
        let sql = if include_archived {
            "SELECT id, project_id, item_id, type, agent_type, title, session_key, pinned, unread, sort_order, created_at, last_activity, message_count, archived
             FROM chats WHERE project_id = ?1
             ORDER BY pinned DESC, last_activity DESC"
        } else {
            "SELECT id, project_id, item_id, type, agent_type, title, session_key, pinned, unread, sort_order, created_at, last_activity, message_count, archived
             FROM chats WHERE project_id = ?1 AND archived = 0
             ORDER BY pinned DESC, last_activity DESC"
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![pid], |row| row_to_hub_chat(row))
            .map_err(|e| e.to_string())?;
        for row in rows {
            chats.push(row.map_err(|e| e.to_string())?);
        }
    } else {
        let sql = if include_archived {
            "SELECT id, project_id, item_id, type, agent_type, title, session_key, pinned, unread, sort_order, created_at, last_activity, message_count, archived
             FROM chats
             ORDER BY pinned DESC, last_activity DESC"
        } else {
            "SELECT id, project_id, item_id, type, agent_type, title, session_key, pinned, unread, sort_order, created_at, last_activity, message_count, archived
             FROM chats WHERE archived = 0
             ORDER BY pinned DESC, last_activity DESC"
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row_to_hub_chat(row))
            .map_err(|e| e.to_string())?;
        for row in rows {
            chats.push(row.map_err(|e| e.to_string())?);
        }
    }

    Ok(chats)
}

#[tauri::command]
pub(crate) fn hub_chat_get(chat_id: String) -> Result<HubChat, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;

    let chat = conn
        .query_row(
            "SELECT id, project_id, item_id, type, agent_type, title, session_key, pinned, unread, sort_order, created_at, last_activity, message_count, archived
             FROM chats WHERE id = ?1",
            params![chat_id],
            |row| row_to_hub_chat(row),
        )
        .map_err(|e| e.to_string())?;

    Ok(chat)
}

#[tauri::command]
pub(crate) fn hub_chat_update(
    chat_id: String,
    changes: HubChatUpdate,
) -> Result<HubChat, String> {
    // Scope the MutexGuard so it is dropped before hub_chat_get,
    // which also acquires the same mutex. Without this scope,
    // the non-reentrant std::sync::Mutex deadlocks.
    {
        let guard = get_or_init_chat_db()?;
        let conn = guard.as_ref().ok_or("Database not initialized")?;

        // Build SET clauses dynamically
        let mut sets: Vec<String> = Vec::new();
        let mut params_vec: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let mut param_idx = 1;

        if let Some(ref title) = changes.title {
            sets.push(format!("title = ?{}", param_idx));
            params_vec.push(Box::new(title.clone()));
            param_idx += 1;
        }
        if let Some(pinned) = changes.pinned {
            sets.push(format!("pinned = ?{}", param_idx));
            params_vec.push(Box::new(if pinned { 1i64 } else { 0i64 }));
            param_idx += 1;
        }
        if let Some(unread) = changes.unread {
            sets.push(format!("unread = ?{}", param_idx));
            params_vec.push(Box::new(if unread { 1i64 } else { 0i64 }));
            param_idx += 1;
        }
        if let Some(archived) = changes.archived {
            sets.push(format!("archived = ?{}", param_idx));
            params_vec.push(Box::new(if archived { 1i64 } else { 0i64 }));
            param_idx += 1;
        }
        if let Some(sort_order) = changes.sort_order {
            sets.push(format!("sort_order = ?{}", param_idx));
            params_vec.push(Box::new(sort_order));
            param_idx += 1;
        }
        if let Some(last_activity) = changes.last_activity {
            sets.push(format!("last_activity = ?{}", param_idx));
            params_vec.push(Box::new(last_activity));
            param_idx += 1;
        }
        if let Some(message_count) = changes.message_count {
            sets.push(format!("message_count = ?{}", param_idx));
            params_vec.push(Box::new(message_count));
            param_idx += 1;
        }

        if sets.is_empty() {
            // No changes — drop guard and return current record
        } else {
            let sql = format!(
                "UPDATE chats SET {} WHERE id = ?{}",
                sets.join(", "),
                param_idx
            );
            params_vec.push(Box::new(chat_id.clone()));

            let params_refs: Vec<&dyn rusqlite::types::ToSql> = params_vec.iter().map(|p| p.as_ref()).collect();
            conn.execute(&sql, params_refs.as_slice())
                .map_err(|e| e.to_string())?;
        }
    } // MutexGuard dropped here — safe to call hub_chat_get now

    hub_chat_get(chat_id)
}

#[tauri::command]
pub(crate) fn hub_chat_delete(chat_id: String) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    conn.execute("DELETE FROM chats WHERE id = ?1", params![chat_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub(crate) fn hub_chat_update_activity(chat_id: String) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    let now = now_ms();
    conn.execute(
        "UPDATE chats SET last_activity = ?1 WHERE id = ?2",
        params![now, chat_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
