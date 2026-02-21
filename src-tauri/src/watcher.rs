//! watcher.rs — Unified file watcher using the `notify` crate.
//!
//! Implements Phase 2.3: single Rust-side watcher that categorizes events and
//! emits typed Tauri events to the frontend.
//!
//! Event categories:
//! - `project-file-changed` — CLAWCHESTRA.md or PROJECT.md modified
//! - `state-json-merged` — `.clawchestra/state.json` merged after external edit
//! - `git-status-changed` — git-tracked files modified

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use sha2::{Digest, Sha256};
use tauri::Emitter;
use tokio::sync::Mutex;

use crate::db_persistence::DbFlushHandle;
use crate::merge::merge_state_json;
use crate::state::{AppState, ProjectId, StateJson};
use crate::util::write_str_atomic;
use crate::validation::MAX_STATE_JSON_SIZE;

/// Tauri event name constants
pub const EVENT_PROJECT_FILE_CHANGED: &str = "project-file-changed";
pub const EVENT_GIT_STATUS_CHANGED: &str = "git-status-changed";
pub const EVENT_STATE_JSON_MERGED: &str = "state-json-merged";

/// Payload emitted for `state-json-merged` events.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJsonMergedEventPayload {
    pub project_id: String,
    pub project: StateJsonProjectPayload,
    pub roadmap_items: Vec<StateJsonRoadmapItemPayload>,
    pub applied_changes: Vec<String>,
    pub rejected_fields: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJsonProjectPayload {
    pub id: String,
    pub title: String,
    pub status: String,
    pub description: String,
    pub parent_id: Option<String>,
    pub tags: Vec<String>,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJsonRoadmapItemPayload {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: Option<i64>,
    pub next_action: Option<String>,
    pub tags: Option<Vec<String>>,
    pub icon: Option<String>,
    pub blocked_by: Option<String>,
    pub spec_doc: Option<String>,
    pub plan_doc: Option<String>,
    pub completed_at: Option<String>,
}

/// Payload emitted for `project-file-changed` events.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFileChangedPayload {
    pub project_path: String,
    pub file_name: String,
}

/// Payload emitted for `git-status-changed` events.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusChangedPayload {
    pub project_path: String,
}

/// Compute SHA-256 hash of a byte slice, returning a hex string.
pub fn sha256_hex(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

/// Start the unified file watcher.
///
/// Watches all provided scan paths recursively. Events are categorized and
/// dispatched to appropriate handlers.
pub fn start_watching(
    app_handle: tauri::AppHandle,
    state: Arc<Mutex<AppState>>,
    flush_handle: Arc<DbFlushHandle>,
    scan_paths: Vec<String>,
) -> Result<RecommendedWatcher, String> {
    let (tx, rx) = std::sync::mpsc::channel();

    let mut watcher = RecommendedWatcher::new(
        tx,
        Config::default().with_poll_interval(Duration::from_millis(100)),
    )
    .map_err(|e| format!("Failed to create file watcher: {}", e))?;

    for path in &scan_paths {
        let p = Path::new(path);
        if p.exists() {
            watcher
                .watch(p, RecursiveMode::Recursive)
                .map_err(|e| format!("Failed to watch {}: {}", path, e))?;
            tracing::info!("Watching: {}", path);
        } else {
            tracing::warn!("Scan path does not exist, skipping: {}", path);
        }
    }

    // Spawn event processing thread
    let state_clone = state.clone();
    let handle_clone = app_handle.clone();
    let flush_clone = flush_handle.clone();

    std::thread::spawn(move || {
        // Debounce: collect events for 100ms before processing
        let debounce_duration = Duration::from_millis(100);
        let mut pending_paths: HashSet<PathBuf> = HashSet::new();
        let mut first_event_time: Option<std::time::Instant> = None;

        loop {
            match rx.recv_timeout(debounce_duration) {
                Ok(Ok(event)) => {
                    // Collect paths from the event
                    for path in event.paths {
                        match event.kind {
                            EventKind::Modify(_)
                            | EventKind::Create(_)
                            | EventKind::Remove(_) => {
                                if first_event_time.is_none() {
                                    first_event_time = Some(std::time::Instant::now());
                                }
                                pending_paths.insert(path);
                            }
                            _ => {}
                        }
                    }
                }
                Ok(Err(e)) => {
                    tracing::warn!("Watcher error: {}", e);
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    // Process pending events after debounce period
                }
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    tracing::info!("Watcher channel disconnected, stopping");
                    break;
                }
            }

            // Process batch if debounce period has elapsed since first event in batch
            let should_flush = first_event_time
                .is_some_and(|t| t.elapsed() >= debounce_duration);
            if !pending_paths.is_empty() && should_flush {
                let batch: Vec<PathBuf> = pending_paths.drain().collect();
                first_event_time = None;

                for path in batch {
                    categorize_and_handle(
                        &path,
                        &handle_clone,
                        &state_clone,
                        &flush_clone,
                    );
                }
            }
        }
    });

    Ok(watcher)
}

/// Categorize a changed file path and dispatch to the appropriate handler.
///
/// State.json changes are spawned as async tasks on the tokio runtime to avoid
/// `block_on` deadlocks (the handler needs to acquire the async `Mutex<AppState>`).
/// Other event types emit Tauri events synchronously since they don't need the lock.
fn categorize_and_handle(
    path: &Path,
    app_handle: &tauri::AppHandle,
    state: &Arc<Mutex<AppState>>,
    flush_handle: &Arc<DbFlushHandle>,
) {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");

    // Check if this is a state.json change
    if file_name == "state.json" {
        if let Some(clawchestra_dir) = path.parent() {
            if clawchestra_dir
                .file_name()
                .and_then(|n| n.to_str())
                == Some(".clawchestra")
            {
                if let Some(project_dir) = clawchestra_dir.parent() {
                    // Spawn async: avoids block_on deadlock when acquiring tokio Mutex
                    let path_owned = path.to_path_buf();
                    let project_dir_owned = project_dir.to_path_buf();
                    let handle = app_handle.clone();
                    let state = state.clone();
                    let flush = flush_handle.clone();
                    tauri::async_runtime::spawn(async move {
                        handle_state_json_change(
                            &path_owned,
                            &project_dir_owned,
                            &handle,
                            &state,
                            &flush,
                        )
                        .await;
                    });
                    return;
                }
            }
        }
    }

    // Check if this is a project file change (CLAWCHESTRA.md or PROJECT.md)
    if file_name == "CLAWCHESTRA.md" || file_name == "PROJECT.md" {
        if let Some(project_dir) = path.parent() {
            let _ = app_handle.emit(
                EVENT_PROJECT_FILE_CHANGED,
                ProjectFileChangedPayload {
                    project_path: project_dir.to_string_lossy().to_string(),
                    file_name: file_name.to_string(),
                },
            );
            return;
        }
    }

    // Check if this is inside a git-tracked directory (heuristic: not in .git/ itself)
    if !path_contains_component(path, ".git")
        && !path_contains_component(path, "node_modules")
        && !path_contains_component(path, ".clawchestra")
    {
        // Find the project root (closest parent with CLAWCHESTRA.md, PROJECT.md, or .git/)
        if let Some(project_dir) = find_project_root(path) {
            let _ = app_handle.emit(
                EVENT_GIT_STATUS_CHANGED,
                GitStatusChangedPayload {
                    project_path: project_dir.to_string_lossy().to_string(),
                },
            );
        }
    }
}

/// Handle a state.json change event (async — spawned from categorize_and_handle).
async fn handle_state_json_change(
    state_json_path: &Path,
    project_dir: &Path,
    app_handle: &tauri::AppHandle,
    state: &Arc<Mutex<AppState>>,
    flush_handle: &Arc<DbFlushHandle>,
) {
    // 1. Check file size
    let metadata = match fs::metadata(state_json_path) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!("Cannot read state.json metadata: {}", e);
            return;
        }
    };
    if metadata.len() > MAX_STATE_JSON_SIZE {
        tracing::warn!(
            "state.json exceeds 1MB limit ({} bytes) — likely a bug. File ignored.",
            metadata.len()
        );
        return;
    }

    // 2. Read the file
    let content = match fs::read(state_json_path) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Cannot read state.json: {}", e);
            return;
        }
    };

    // 3. Compute SHA-256
    let hash = sha256_hex(&content);

    // 4. Parse JSON first to get the canonical project ID
    let incoming: StateJson = match serde_json::from_slice(&content) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(
                "Failed to parse state.json in '{}': {}",
                project_dir.display(),
                e
            );
            // #020: Restore last-known-good state on parse failure so agents don't read garbage
            write_back_current_state(state_json_path, project_dir, state).await;
            return;
        }
    };

    // Use project.id from the parsed document (not directory name)
    let project_id = incoming.project.id.clone();
    if project_id.is_empty() {
        tracing::warn!("state.json in '{}' has empty project.id, ignoring", project_dir.display());
        return;
    }
    let pid = ProjectId(project_id.clone());
    let project_dir_str = project_dir.to_string_lossy().to_string();

    // Single lock acquisition: hash check → merge → payload build (atomic, no TOCTOU gap)
    let merge_outcome = {
        let mut guard = state.lock().await;

        // Compare against last-written hash (D8)
        if guard.content_hashes.get(&pid).is_some_and(|h| h == &hash) {
            None // Own write — skip
        } else {
            // External change detected — validate and merge
            let result = merge_state_json(&mut guard, &project_id, &project_dir_str, incoming);

            // #015: Record validation rejections for agent feedback
            if !result.rejected_fields.is_empty() {
                use std::collections::VecDeque;
                use crate::state::ValidationRejection;

                let rejection = ValidationRejection {
                    timestamp: guard.hlc_counter,
                    project_id: project_id.clone(),
                    rejected_fields: result.rejected_fields.iter().map(|r| r.field.clone()).collect(),
                    reason: result.rejected_fields.iter()
                        .map(|r| format!("{}: {}", r.field, r.reason))
                        .collect::<Vec<_>>()
                        .join("; "),
                    resolved: false,
                };
                let buffer = guard.validation_rejections
                    .entry(pid.clone())
                    .or_insert_with(|| VecDeque::with_capacity(10));
                if buffer.len() >= 10 {
                    buffer.pop_front();
                }
                buffer.push_back(rejection);
            }

            // Build event payload from post-merge state
            let payload = guard
                .project_state_json(&project_id)
                .map(|state| StateJsonMergedEventPayload {
                    project_id: project_id.clone(),
                    project: StateJsonProjectPayload {
                        id: state.project.id.clone(),
                        title: state.project.title.clone(),
                        status: state.project.status.clone(),
                        description: state.project.description.clone(),
                        parent_id: state.project.parent_id.clone(),
                        tags: state.project.tags.clone(),
                    },
                    roadmap_items: state
                        .roadmap_items
                        .iter()
                        .map(|item| StateJsonRoadmapItemPayload {
                            id: item.id.clone(),
                            title: item.title.clone(),
                            status: item.status.clone(),
                            priority: item.priority,
                            next_action: item.next_action.clone(),
                            tags: item.tags.clone(),
                            icon: item.icon.clone(),
                            blocked_by: item.blocked_by.clone(),
                            spec_doc: item.spec_doc.clone(),
                            plan_doc: item.plan_doc.clone(),
                            completed_at: item.completed_at.clone(),
                        })
                        .collect(),
                    applied_changes: result
                        .applied_changes
                        .iter()
                        .map(|c| c.field.clone())
                        .collect(),
                    rejected_fields: result
                        .rejected_fields
                        .iter()
                        .map(|r| r.field.clone())
                        .collect(),
                });

            // If merge rejected fields, prepare a write-back of the corrected state
            // so the on-disk file matches the in-memory state.
            let writeback = if !result.rejected_fields.is_empty() {
                guard.project_state_json(&project_id).and_then(|corrected| {
                    let serialized = serde_json::to_string_pretty(&corrected).ok()?;
                    let wb_hash = sha256_hex(serialized.as_bytes());
                    // Pre-register hash so the watcher skips this write
                    guard.content_hashes.insert(pid.clone(), wb_hash);
                    Some(serialized)
                })
            } else {
                None
            };

            // #015: Build last-rejection.json sidecar content if fields were rejected
            let rejection_sidecar = if !result.rejected_fields.is_empty() {
                Some(serde_json::json!({
                    "timestamp": guard.hlc_counter,
                    "rejectedFields": result.rejected_fields.iter().map(|r| {
                        serde_json::json!({
                            "field": r.field,
                            "reason": r.reason,
                        })
                    }).collect::<Vec<_>>(),
                }))
            } else {
                None
            };

            Some((result, payload, writeback, rejection_sidecar))
        }
    };
    // Lock released here

    let Some((result, payload, writeback, rejection_sidecar)) = merge_outcome else {
        tracing::debug!(
            "state.json change for '{}' matches our own write, ignoring",
            project_id
        );
        return;
    };

    tracing::info!(
        "Merge result for '{}': {} applied, {} rejected, {} warnings",
        project_id,
        result.applied_changes.len(),
        result.rejected_fields.len(),
        result.warnings.len(),
    );

    // Write back corrected state.json if fields were rejected
    if let Some(content) = writeback {
        if let Err(e) = write_str_atomic(state_json_path, &content) {
            tracing::warn!(
                "Failed to write back corrected state.json for '{}': {}",
                project_id,
                e
            );
            // Remove pre-registered hash on failure so the next external edit isn't skipped
            let mut guard = state.lock().await;
            guard.content_hashes.remove(&pid);
        } else {
            tracing::info!(
                "Wrote back corrected state.json for '{}' ({} fields rejected)",
                project_id,
                result.rejected_fields.len()
            );
        }
    }

    // #015: Write last-rejection.json sidecar for agent feedback
    if let Some(sidecar_json) = rejection_sidecar {
        let clawchestra_dir = state_json_path.parent().unwrap_or(state_json_path);
        let sidecar_path = clawchestra_dir.join("last-rejection.json");
        if let Ok(content) = serde_json::to_string_pretty(&sidecar_json) {
            if let Err(e) = write_str_atomic(&sidecar_path, &content) {
                tracing::warn!("Failed to write last-rejection.json: {}", e);
            }
        }
    }

    // Schedule DB persistence
    flush_handle.schedule_flush();

    // Emit merged event to frontend
    if let Some(payload) = payload {
        let _ = app_handle.emit(EVENT_STATE_JSON_MERGED, payload);
    }
}

/// Write back the current projected state for a project when external JSON is unparseable (#020).
/// Finds the project by matching the directory path against known projects.
async fn write_back_current_state(
    state_json_path: &Path,
    project_dir: &Path,
    state: &Arc<Mutex<AppState>>,
) {
    let project_dir_str = project_dir.to_string_lossy().to_string();

    // Extract what we need under the lock, then release before I/O
    let writeback_info = {
        let guard = state.lock().await;

        // Find the project whose project_path matches this directory
        let project_id = guard.db.projects.iter()
            .find(|(_, entry)| entry.project_path == project_dir_str)
            .map(|(id, _)| id.clone());

        project_id.and_then(|pid_str| {
            guard.project_state_json(&pid_str).and_then(|projected| {
                serde_json::to_string_pretty(&projected).ok().map(|serialized| {
                    (pid_str, serialized)
                })
            })
        })
    };
    // Lock released here

    match writeback_info {
        Some((project_id, serialized)) => {
            let pid = ProjectId(project_id.clone());
            let wb_hash = sha256_hex(serialized.as_bytes());
            {
                let mut guard = state.lock().await;
                guard.content_hashes.insert(pid, wb_hash);
            }
            if let Err(e) = write_str_atomic(state_json_path, &serialized) {
                tracing::warn!("Failed to restore state.json after parse failure: {}", e);
            } else {
                tracing::info!(
                    "Restored last-known-good state.json for '{}' after parse failure",
                    project_id
                );
            }
        }
        None => {
            tracing::warn!(
                "Cannot restore state.json in '{}': no matching project in DB — renaming corrupt file",
                project_dir.display()
            );
            let corrupt_path = state_json_path.with_extension("json.corrupt");
            if let Err(e) = std::fs::rename(state_json_path, &corrupt_path) {
                tracing::warn!("Failed to rename corrupt state.json: {}", e);
            }
        }
    }
}

/// Check if a path contains a specific directory component.
fn path_contains_component(path: &Path, component: &str) -> bool {
    path.components().any(|c| {
        c.as_os_str()
            .to_str()
            .is_some_and(|s| s == component)
    })
}

/// Find the project root by walking up from a file path.
/// Looks for CLAWCHESTRA.md, PROJECT.md, or .git/.
fn find_project_root(path: &Path) -> Option<PathBuf> {
    let mut current = if path.is_file() {
        path.parent()?.to_path_buf()
    } else {
        path.to_path_buf()
    };

    loop {
        if current.join("CLAWCHESTRA.md").exists()
            || current.join("PROJECT.md").exists()
            || current.join(".git").exists()
        {
            return Some(current);
        }
        if !current.pop() {
            return None;
        }
    }
}
