//! db_persistence.rs — Atomic db.json persistence with debounced writes.
//!
//! Provides:
//! - `load_db_json()` — Load from `~/.openclaw/clawchestra/db.json`, or return default
//! - `flush_db_json()` — Atomic write (`.tmp` + rename)
//! - `schedule_db_flush()` — Debounced persistence (500ms)
//! - `DbFlushHandle` — Manages the debounce timer
//!
//! Phase 2.0 of the Architecture Direction plan.

use std::fs;
use std::sync::Arc;

use tokio::sync::Mutex;

use crate::state::{db_json_path, AppState, DbJson};
use crate::util::write_str_atomic;

/// Load db.json from the canonical path. Returns default if file doesn't exist
/// or fails to parse (with a backup of the corrupt file).
pub fn load_db_json() -> DbJson {
    let path = match db_json_path() {
        Ok(p) => p,
        Err(_) => return DbJson::default(),
    };

    if !path.exists() {
        return DbJson::default();
    }

    let raw = match fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("Failed to read db.json: {}", e);
            return DbJson::default();
        }
    };

    match serde_json::from_str::<DbJson>(&raw) {
        Ok(db) => db,
        Err(e) => {
            tracing::warn!("Failed to parse db.json, backing up corrupt file: {}", e);
            // Backup the corrupt file
            let backup_suffix = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let backup = path.with_file_name(format!("db.corrupt-{}.json", backup_suffix));
            let _ = fs::rename(&path, backup);
            DbJson::default()
        }
    }
}

/// Atomically write db.json to disk (write to `.tmp`, then rename).
pub fn flush_db_json(db: &DbJson) -> Result<(), String> {
    let path = db_json_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    crate::util::write_json_atomic(&path, db)
}

/// Write a pre-serialized JSON string to db.json atomically.
fn flush_db_json_str(content: &str) -> Result<(), String> {
    let path = db_json_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_str_atomic(&path, content)
}

/// Flush the AppState's db.json to disk if dirty, then clear the dirty flag.
///
/// Serializes under the lock (CPU-only, fast) to avoid cloning the full DbJson.
/// Clears dirty flag optimistically before I/O; restores it on write failure
/// so the debounce loop retries.
///
/// On process crash during I/O: the dirty flag is in-memory and lost regardless.
/// The atomic write (tmp + rename) ensures the on-disk file is never partial.
/// Mutations arriving between serialize and I/O trigger their own flush cycle
/// via schedule_flush(), so they are not lost.
pub async fn flush_if_dirty(state: &Arc<Mutex<AppState>>) -> Result<(), String> {
    let serialized = {
        let mut guard = state.lock().await;
        if !guard.dirty {
            return Ok(());
        }
        let json = serde_json::to_string_pretty(&guard.db)
            .map_err(|e| format!("JSON serialize error: {}", e))?;
        guard.dirty = false;
        json
    };
    // Lock released — do I/O without holding the mutex
    if let Err(e) = flush_db_json_str(&serialized) {
        // Restore dirty flag so debounce loop retries
        let mut guard = state.lock().await;
        guard.dirty = true;
        return Err(e);
    }
    Ok(())
}

/// Manages the 500ms debounce timer for db.json writes.
pub struct DbFlushHandle {
    /// Sender to notify the flush task that the DB is dirty.
    notify: Arc<tokio::sync::Notify>,
}

impl DbFlushHandle {
    /// Start the debounced flush loop. Returns a handle that can trigger flushes.
    pub fn start(state: Arc<Mutex<AppState>>) -> Self {
        let notify = Arc::new(tokio::sync::Notify::new());
        let notify_clone = notify.clone();

        tauri::async_runtime::spawn(async move {
            loop {
                // Wait until someone signals the DB is dirty
                notify_clone.notified().await;
                // Debounce: wait 500ms, coalescing multiple dirty signals
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                // Inner loop: flush until clean
                loop {
                    match flush_if_dirty(&state).await {
                        Err(e) => {
                            tracing::warn!("Debounced db.json flush failed: {}", e);
                            // Backoff then retry — dirty flag was restored by flush_if_dirty,
                            // but we need to self-wake since no external notify will come
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            if state.lock().await.dirty {
                                continue; // Retry the flush
                            }
                            break;
                        }
                        Ok(()) => {
                            // Check if dirty was set again during our flush
                            if !state.lock().await.dirty {
                                break;
                            }
                            // Brief delay to coalesce more writes before re-flushing
                            tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        }
                    }
                }
            }
        });

        Self { notify }
    }

    /// Signal that the DB is dirty and should be flushed after the debounce period.
    pub fn schedule_flush(&self) {
        self.notify.notify_one();
    }
}

