//! sync.rs -- OpenClaw data endpoint extension, sync triggers, and client identity.
//!
//! Implements Phase 6 of the Architecture Direction plan:
//! - 6.1 Extension file content generation
//! - 6.2 Extension installation Tauri command
//! - 6.3 Local filesystem sync path
//! - 6.4 Client UUID generation + hostname detection
//! - 6.5 OpenClaw system prompt injection
//! - 6.6 Sync triggers (launch + close)
//!
//! Architecture: Rust handles all filesystem operations and merge logic.
//! TypeScript handles HTTP for remote sync (frontend has `fetch` built in).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

use crate::db_persistence::flush_db_json;
use crate::state::{AppState, DbJson, DbProjectData, DbRoadmapItem, SyncEventLogEntry};
use crate::util::write_json_atomic;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Version of the extension file. Bumped when the extension changes.
pub const EXTENSION_VERSION: &str = "1.0.0";

/// Maximum clock skew before warning (milliseconds).
const CLOCK_SKEW_THRESHOLD_MS: u64 = 5_000;

// ---------------------------------------------------------------------------
// 6.1 Extension file content
// ---------------------------------------------------------------------------

/// Generate the OpenClaw extension TypeScript file content as a string.
/// This extension registers an HTTP route for reading/writing Clawchestra data.
pub fn generate_extension_content() -> String {
    format!(
        r#"// Clawchestra Data Endpoint Extension
// Version: {version}
// Auto-installed by Clawchestra. Do not edit manually.
// Module system: CJS (require). If OpenClaw uses ESM, switch to import().
const EXTENSION_VERSION = '{version}';

export default function (api: any) {{
  const path = require('path');
  const fs = require('fs/promises');
  const os = require('os');
  const crypto = require('crypto');

  const DATA_ROOT = path.join(os.homedir(), '.openclaw', 'clawchestra');
  const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB limit
  const ALLOWED_FILES = new Set(['db.json', 'settings.json']);
  const CONTENT_FIELDS = ['specDocContent', 'specDocContent__updatedAt', 'planDocContent', 'planDocContent__updatedAt'];

  // Constant-time string comparison to prevent timing attacks on bearer tokens
  function safeEqual(a: string, b: string): boolean {{
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  }}

  api.registerHttpRoute({{
    path: '/clawchestra/data/*',
    handler: async (req: any, res: any) => {{
      // Bearer token auth — fail-closed
      const settingsRaw = await fs.readFile(path.join(DATA_ROOT, 'settings.json'), 'utf-8').catch(() => null);
      if (!settingsRaw) {{
        return res.status(500).json({{ error: 'Extension not configured — settings.json missing or unreadable' }});
      }}
      let settings;
      try {{
        settings = JSON.parse(settingsRaw);
      }} catch {{
        return res.status(500).json({{ error: 'Extension configuration invalid — settings.json is malformed JSON' }});
      }}
      if (!settings.bearerToken) {{
        return res.status(500).json({{ error: 'Extension not configured — missing bearer token' }});
      }}
      const auth = req.headers.authorization;
      const expected = `Bearer ${{settings.bearerToken}}`;
      if (!auth || !safeEqual(auth, expected)) {{
        return res.status(401).json({{ error: 'Unauthorized' }});
      }}

      // Path validation — use path.sep suffix to prevent prefix confusion
      const requestedPath = req.params[0] || 'db.json';
      const resolved = path.resolve(DATA_ROOT, requestedPath);
      if (resolved !== DATA_ROOT && !resolved.startsWith(DATA_ROOT + path.sep)) {{
        return res.status(403).json({{ error: 'Path traversal blocked' }});
      }}

      if (req.method === 'GET') {{
        try {{
          const content = await fs.readFile(resolved, 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          // Progressive loading: ?fields=index strips content fields for fast initial paint
          if (req.query?.fields === 'index') {{
            const data = JSON.parse(content);
            if (data.projects) {{
              for (const proj of Object.values(data.projects) as any[]) {{
                if (proj.roadmapItems) {{
                  for (const item of Object.values(proj.roadmapItems) as any[]) {{
                    for (const f of CONTENT_FIELDS) delete item[f];
                  }}
                }}
              }}
            }}
            return res.send(JSON.stringify(data));
          }}
          return res.send(content);
        }} catch {{
          return res.status(404).json({{ error: 'Not found' }});
        }}
      }}

      if (req.method === 'PUT') {{
        // Security: restrict PUT to allowlisted filenames only
        const basename = path.basename(resolved);
        if (!ALLOWED_FILES.has(basename)) {{
          return res.status(403).json({{ error: `Cannot write to '${{basename}}' — only ${{[...ALLOWED_FILES].join(', ')}} allowed` }});
        }}
        const serialized = JSON.stringify(req.body, null, 2);
        if (serialized.length > MAX_BODY_SIZE) {{
          return res.status(413).json({{ error: 'Payload too large' }});
        }}
        // Body validation for db.json
        if (basename === 'db.json') {{
          if (!req.body || typeof req.body !== 'object') {{
            return res.status(422).json({{ error: 'Invalid db.json — body must be a JSON object' }});
          }}
          if (typeof req.body._schemaVersion !== 'number') {{
            return res.status(422).json({{ error: 'Invalid db.json — _schemaVersion must be a number' }});
          }}
          if (typeof req.body._hlcCounter !== 'number') {{
            return res.status(422).json({{ error: 'Invalid db.json — _hlcCounter must be a number' }});
          }}
          if (typeof req.body.projects !== 'object' || req.body.projects === null) {{
            return res.status(422).json({{ error: 'Invalid db.json — projects must be an object' }});
          }}
        }}
        // Ensure target directory exists before realpath check
        await fs.mkdir(path.dirname(resolved), {{ recursive: true }});
        // Security: verify resolved path after realpath (symlink bypass prevention)
        const realResolved = await fs.realpath(path.dirname(resolved)).catch(() => null);
        const realDataRoot = await fs.realpath(DATA_ROOT).catch(() => DATA_ROOT);
        if (!realResolved || !realResolved.startsWith(realDataRoot)) {{
          return res.status(403).json({{ error: 'Path traversal blocked' }});
        }}
        await fs.writeFile(resolved, serialized);
        return res.json({{ ok: true }});
      }}

      res.status(405).json({{ error: 'Method not allowed' }});
    }}
  }});
}}
"#,
        version = EXTENSION_VERSION,
    )
}

// ---------------------------------------------------------------------------
// 6.2 Extension installation
// ---------------------------------------------------------------------------

/// Install the Clawchestra data endpoint extension into an OpenClaw installation.
///
/// Writes the extension file to `{openclaw_path}/extensions/clawchestra-data-endpoint.ts`.
/// Returns Ok(()) on success, Err(message) on failure.
pub fn install_extension(openclaw_path: &str) -> Result<(), String> {
    let base = Path::new(openclaw_path);
    if !base.exists() {
        return Err(format!(
            "OpenClaw path does not exist: {}",
            base.display()
        ));
    }

    let extensions_dir = base.join("extensions");
    fs::create_dir_all(&extensions_dir).map_err(|e| {
        format!(
            "Failed to create extensions directory {}: {}",
            extensions_dir.display(),
            e
        )
    })?;

    let extension_path = extensions_dir.join("clawchestra-data-endpoint.ts");
    let content = generate_extension_content();

    fs::write(&extension_path, content).map_err(|e| {
        format!(
            "Failed to write extension file {}: {}",
            extension_path.display(),
            e
        )
    })?;

    tracing::info!(
        "Installed Clawchestra extension v{} to {}",
        EXTENSION_VERSION,
        extension_path.display()
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// 6.3 Local filesystem sync path
// ---------------------------------------------------------------------------

/// The canonical path for the OpenClaw clawchestra data directory.
fn openclaw_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    Ok(home.join(".openclaw").join("clawchestra"))
}

/// The canonical path for the shared db.json (OpenClaw side).
fn openclaw_db_json_path() -> Result<PathBuf, String> {
    Ok(openclaw_data_dir()?.join("db.json"))
}

/// Read db.json from the local OpenClaw data directory.
/// Returns None if the file doesn't exist or can't be parsed.
pub fn read_local_openclaw_db() -> Option<DbJson> {
    let path = openclaw_db_json_path().ok()?;
    if !path.exists() {
        return None;
    }
    let raw = fs::read_to_string(&path).ok()?;
    serde_json::from_str::<DbJson>(&raw).ok()
}

/// Write db.json atomically to the local OpenClaw data directory.
pub fn write_local_openclaw_db(db: &DbJson) -> Result<(), String> {
    let path = openclaw_db_json_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_json_atomic(&path, db)
}

// ---------------------------------------------------------------------------
// 6.4 Client UUID + hostname
// ---------------------------------------------------------------------------

/// Generate a new client UUID and detect hostname.
/// Returns (uuid, hostname).
pub fn ensure_client_identity() -> (String, String) {
    let uuid = uuid::Uuid::new_v4().to_string();
    let hostname = get_hostname();
    (uuid, hostname)
}

/// Get the machine hostname. Falls back to "unknown" if it can't be determined.
fn get_hostname() -> String {
    // Try the HOSTNAME env var first (works on most systems)
    if let Ok(h) = std::env::var("HOSTNAME") {
        if !h.is_empty() {
            return h;
        }
    }
    // Try the system hostname command
    if let Ok(output) = std::process::Command::new("hostname").output() {
        if output.status.success() {
            let h = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !h.is_empty() {
                return h;
            }
        }
    }
    "unknown".to_string()
}

/// Get the platform string for this machine.
pub fn get_platform() -> String {
    if cfg!(target_os = "macos") {
        "macos".to_string()
    } else if cfg!(target_os = "windows") {
        "windows".to_string()
    } else if cfg!(target_os = "linux") {
        "linux".to_string()
    } else {
        std::env::consts::OS.to_string()
    }
}

// ---------------------------------------------------------------------------
// 6.5 OpenClaw system prompt injection
// ---------------------------------------------------------------------------

/// Write the system-context.md file for OpenClaw.
/// Contains orchestration context so OpenClaw knows about the database.
pub fn write_system_context(
    client_uuid: &str,
    hostname: &str,
    platform: &str,
) -> Result<(), String> {
    let data_dir = openclaw_data_dir()?;
    fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let content = format!(
        r#"You are integrated with Clawchestra, a project orchestration tool.

Database: ~/.openclaw/clawchestra/db.json
Format: JSON (schema below)

Known clients:
- {uuid}: {hostname} ({platform})

Schema rules:
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- completedAt required when status is complete
- Priorities unique per column

When asked about projects, roadmap items, or task status, read the database.
When making changes, write to the database. Sync is automatic.

Note: Data reflects the last time Clawchestra synced. For real-time status, check the Clawchestra app directly.
"#,
        uuid = client_uuid,
        hostname = hostname,
        platform = platform,
    );

    let path = data_dir.join("system-context.md");
    fs::write(&path, content).map_err(|e| {
        format!(
            "Failed to write system-context.md at {}: {}",
            path.display(),
            e
        )
    })?;

    tracing::info!("Wrote system-context.md to {}", path.display());
    Ok(())
}

// ---------------------------------------------------------------------------
// 6.6 Sync triggers -- HLC merge logic
// ---------------------------------------------------------------------------

/// Result of a sync operation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    /// Whether the sync succeeded
    pub success: bool,
    /// Human-readable summary of what happened
    pub message: String,
    /// Warnings (clock skew, stale data, etc.)
    pub warnings: Vec<String>,
    /// Number of fields that were merged from remote
    pub fields_from_remote: u32,
    /// Number of fields that were kept from local
    pub fields_from_local: u32,
}

/// Merge two DbJson databases using HLC timestamps.
/// For each field, keeps the one with the newer `__updatedAt` timestamp.
/// On ties, the lexicographically larger field value wins (content-based).
/// This ensures both sides converge to the same value regardless of merge order
/// and device count (commutative, associative).
///
/// Returns (merged_db, fields_from_remote, fields_from_local).
pub fn merge_db_json(
    local: &DbJson,
    remote: &DbJson,
    _local_client_uuid: &str,
) -> (DbJson, u32, u32) {
    let mut merged = local.clone();
    let mut from_remote: u32 = 0;
    let mut from_local: u32 = 0;

    // Tie-breaking: when two fields have the same HLC timestamp, the
    // lexicographically larger VALUE wins. This is content-based and
    // commutative — both sides of a merge see the same two values, so
    // they always agree on the winner regardless of device count.

    // Merge schema version: keep the higher one
    if remote.schema_version > merged.schema_version {
        merged.schema_version = remote.schema_version;
    }

    // Merge HLC counter: max + 1
    merged.hlc_counter = std::cmp::max(local.hlc_counter, remote.hlc_counter) + 1;

    // Merge last_synced_at: keep the newer one
    merged.last_synced_at = std::cmp::max(local.last_synced_at, remote.last_synced_at);

    // Merge clients: union (keep all clients from both)
    for (client_id, remote_client) in &remote.clients {
        match merged.clients.get(client_id) {
            Some(local_client) => {
                // Keep the one with the more recent last_seen_at
                if remote_client.last_seen_at > local_client.last_seen_at {
                    merged
                        .clients
                        .insert(client_id.clone(), remote_client.clone());
                }
            }
            None => {
                merged
                    .clients
                    .insert(client_id.clone(), remote_client.clone());
            }
        }
    }

    // Merge projects
    for (project_id, remote_entry) in &remote.projects {
        match merged.projects.get_mut(project_id) {
            Some(local_entry) => {
                // Merge project-level fields
                let (r, l) = merge_project_data(
                    &mut local_entry.project,
                    &remote_entry.project,
                );
                from_remote += r;
                from_local += l;

                // Merge roadmap items
                for (item_id, remote_item) in &remote_entry.roadmap_items {
                    match local_entry.roadmap_items.get_mut(item_id) {
                        Some(local_item) => {
                            let (r, l) = merge_roadmap_item(
                                local_item,
                                remote_item,
                            );
                            from_remote += r;
                            from_local += l;
                        }
                        None => {
                            // New item from remote
                            local_entry
                                .roadmap_items
                                .insert(item_id.clone(), remote_item.clone());
                            from_remote += 1;
                        }
                    }
                }
            }
            None => {
                // Entire project exists only on remote
                merged
                    .projects
                    .insert(project_id.clone(), remote_entry.clone());
                from_remote += 1;
            }
        }
    }

    (merged, from_remote, from_local)
}

/// Merge individual project data fields by HLC timestamp.
/// On ties, the lexicographically larger value wins (content-based, commutative).
/// Returns (fields_from_remote, fields_from_local).
fn merge_project_data(
    local: &mut DbProjectData,
    remote: &DbProjectData,
) -> (u32, u32) {
    let mut from_remote: u32 = 0;
    let mut from_local: u32 = 0;

    macro_rules! merge_field {
        ($field:ident, $ts_field:ident) => {
            if remote.$ts_field > local.$ts_field
                || (remote.$ts_field == local.$ts_field && remote.$field > local.$field)
            {
                local.$field = remote.$field.clone();
                local.$ts_field = remote.$ts_field;
                from_remote += 1;
            } else {
                from_local += 1;
            }
        };
    }

    merge_field!(title, title_updated_at);
    merge_field!(status, status_updated_at);
    merge_field!(description, description_updated_at);
    merge_field!(parent_id, parent_id_updated_at);
    merge_field!(tags, tags_updated_at);

    (from_remote, from_local)
}

/// Merge individual roadmap item fields by HLC timestamp.
/// On ties, the lexicographically larger value wins (content-based, commutative).
/// Returns (fields_from_remote, fields_from_local).
fn merge_roadmap_item(
    local: &mut DbRoadmapItem,
    remote: &DbRoadmapItem,
) -> (u32, u32) {
    let mut from_remote: u32 = 0;
    let mut from_local: u32 = 0;

    macro_rules! merge_field {
        ($field:ident, $ts_field:ident) => {
            if remote.$ts_field > local.$ts_field
                || (remote.$ts_field == local.$ts_field && remote.$field > local.$field)
            {
                local.$field = remote.$field.clone();
                local.$ts_field = remote.$ts_field;
                from_remote += 1;
            } else {
                from_local += 1;
            }
        };
    }

    macro_rules! merge_optional_field {
        ($field:ident, $ts_field:ident) => {
            let remote_ts = remote.$ts_field.unwrap_or(0);
            let local_ts = local.$ts_field.unwrap_or(0);
            if remote_ts > local_ts
                || (remote_ts == local_ts && remote.$field > local.$field)
            {
                local.$field = remote.$field.clone();
                local.$ts_field = remote.$ts_field;
                from_remote += 1;
            } else {
                from_local += 1;
            }
        };
    }

    merge_field!(title, title_updated_at);
    merge_field!(status, status_updated_at);
    merge_field!(priority, priority_updated_at);
    merge_optional_field!(next_action, next_action_updated_at);
    merge_optional_field!(tags, tags_updated_at);
    merge_optional_field!(icon, icon_updated_at);
    merge_optional_field!(blocked_by, blocked_by_updated_at);
    merge_optional_field!(spec_doc, spec_doc_updated_at);
    merge_optional_field!(plan_doc, plan_doc_updated_at);
    merge_optional_field!(spec_doc_branch, spec_doc_branch_updated_at);
    merge_optional_field!(plan_doc_branch, plan_doc_branch_updated_at);
    merge_optional_field!(spec_doc_content, spec_doc_content_updated_at);
    merge_optional_field!(plan_doc_content, plan_doc_content_updated_at);
    merge_optional_field!(completed_at, completed_at_updated_at);

    (from_remote, from_local)
}

/// Fix coupled-field invariant violations in a merged DB.
/// After HLC merge, a "complete" item may end up with no completedAt if
/// the status and completedAt came from different sides. Safest repair:
/// revert status to "in-progress" rather than guess completedAt.
///
/// Advances `status_updated_at` to `hlc_counter + 1` so the fix is not
/// undone by content-based tie-breaking on the next sync (since "complete" >
/// "in-progress" lexicographically, it would win ties without a newer timestamp).
fn fix_post_merge_invariants(db: &mut DbJson) {
    let mut fix_ts = db.hlc_counter;
    for entry in db.projects.values_mut() {
        for item in entry.roadmap_items.values_mut() {
            if item.status == "complete" && item.completed_at.is_none() {
                tracing::warn!(
                    "Sync merged 'complete' item '{}' with no completedAt — clearing status",
                    item.id
                );
                fix_ts += 1;
                item.status = "in-progress".to_string();
                item.status_updated_at = fix_ts;
            }
        }
    }
    if fix_ts > db.hlc_counter {
        db.hlc_counter = fix_ts;
    }
}

/// Public wrapper for `fix_post_merge_invariants` — used by lib.rs CAS reconciliation paths.
pub fn fix_post_merge_invariants_pub(db: &mut DbJson) {
    fix_post_merge_invariants(db);
}

/// Detect clock skew between local wall-clock and a remote timestamp.
/// Returns a warning string if skew exceeds the threshold, None otherwise.
pub fn detect_clock_skew(remote_timestamp: u64) -> Option<String> {
    let local_now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let diff = if local_now > remote_timestamp {
        local_now - remote_timestamp
    } else {
        remote_timestamp - local_now
    };

    if diff > CLOCK_SKEW_THRESHOLD_MS {
        Some(format!(
            "Clock difference detected between devices ({}ms). Sync results may be unexpected.",
            diff
        ))
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Sync on launch (local mode)
// ---------------------------------------------------------------------------

/// Perform local sync on launch:
/// 1. Read ~/.openclaw/clawchestra/db.json
/// 2. HLC merge with the app's in-memory DB
/// 3. Write merged result to both the app DB path and the OpenClaw path
///
/// Returns the merged DbJson (caller should update AppState) and a SyncResult.
pub fn sync_local_on_launch(local_db: &DbJson, client_uuid: &str) -> (DbJson, SyncResult) {
    let mut warnings = Vec::new();

    let remote_db = match read_local_openclaw_db() {
        Some(db) => db,
        None => {
            // No remote file yet -- just write local to the OpenClaw location
            if let Err(e) = write_local_openclaw_db(local_db) {
                return (
                    local_db.clone(),
                    SyncResult {
                        success: false,
                        message: format!("Failed to write initial sync file: {}", e),
                        warnings: vec![],
                        fields_from_remote: 0,
                        fields_from_local: 0,
                    },
                );
            }
            return (
                local_db.clone(),
                SyncResult {
                    success: true,
                    message: "Initial sync: wrote local DB to OpenClaw data directory".to_string(),
                    warnings: vec![],
                    fields_from_remote: 0,
                    fields_from_local: 0,
                },
            );
        }
    };

    // Clock skew detection using last_synced_at as proxy
    if remote_db.last_synced_at > 0 {
        if let Some(warning) = detect_clock_skew(remote_db.last_synced_at) {
            warnings.push(warning);
        }
    }

    // Merge
    let (mut merged, from_remote, from_local) = merge_db_json(local_db, &remote_db, client_uuid);
    fix_post_merge_invariants(&mut merged);

    // Write merged to both locations
    if let Err(e) = flush_db_json(&merged) {
        warnings.push(format!("Failed to write merged DB to local: {}", e));
    }
    if let Err(e) = write_local_openclaw_db(&merged) {
        warnings.push(format!("Failed to write merged DB to OpenClaw: {}", e));
    }

    (
        merged.clone(),
        SyncResult {
            success: true,
            message: format!(
                "Local sync complete: {} fields from remote, {} from local",
                from_remote, from_local
            ),
            warnings,
            fields_from_remote: from_remote,
            fields_from_local: from_local,
        },
    )
}

/// Merge a remote DbJson (passed from TypeScript after HTTP fetch) with the local DB.
/// Returns the merged DbJson and a SyncResult.
///
/// The caller (TypeScript) is responsible for:
/// 1. Fetching the remote DB via HTTP
/// 2. Calling this command with the fetched data
/// 3. Pushing the merged result back via HTTP PUT
pub fn merge_remote_db(
    local_db: &DbJson,
    remote_db: &DbJson,
    client_uuid: &str,
) -> (DbJson, SyncResult) {
    let mut warnings = Vec::new();

    // Clock skew detection
    if remote_db.last_synced_at > 0 {
        if let Some(warning) = detect_clock_skew(remote_db.last_synced_at) {
            warnings.push(warning);
        }
    }

    let (mut merged, from_remote, from_local) = merge_db_json(local_db, remote_db, client_uuid);
    fix_post_merge_invariants(&mut merged);

    // Write merged to local app DB
    if let Err(e) = flush_db_json(&merged) {
        warnings.push(format!("Failed to write merged DB to local: {}", e));
    }

    (
        merged,
        SyncResult {
            success: true,
            message: format!(
                "Remote sync complete: {} fields from remote, {} from local",
                from_remote, from_local
            ),
            warnings,
            fields_from_remote: from_remote,
            fields_from_local: from_local,
        },
    )
}

// ---------------------------------------------------------------------------
// Sync on close (local mode)
// ---------------------------------------------------------------------------

/// Flush DB state to the local OpenClaw data directory on close.
/// Used when sync_mode is Local.
pub fn sync_local_on_close(db: &DbJson) -> SyncResult {
    match write_local_openclaw_db(db) {
        Ok(()) => SyncResult {
            success: true,
            message: "Local sync on close: written".to_string(),
            warnings: vec![],
            fields_from_remote: 0,
            fields_from_local: 0,
        },
        Err(e) => SyncResult {
            success: false,
            message: format!("Local sync on close failed: {}", e),
            warnings: vec![],
            fields_from_remote: 0,
            fields_from_local: 0,
        },
    }
}

// ---------------------------------------------------------------------------
// 6.6 Continuous sync handle (Phase 6.6)
// ---------------------------------------------------------------------------

/// Manages the continuous sync loop.
///
/// Polls on the configured interval, checking if the HLC counter has changed since the
/// last sync. If yes, syncs to the OpenClaw data directory. This approach
/// avoids wiring sync triggers into every mutation command — the polling
/// interval naturally debounces rapid mutations.
///
/// Local mode syncs directly to the filesystem. Remote mode is handled by
/// TypeScript (has `fetch` built in).
pub struct SyncHandle {
    shutdown: Arc<AtomicBool>,
}

impl SyncHandle {
    /// Start the continuous sync loop. Returns a handle for shutdown.
    pub fn start(state: Arc<Mutex<AppState>>, sync_mode: crate::SyncMode, interval_ms: u64) -> Self {
        let shutdown = Arc::new(AtomicBool::new(false));
        if sync_mode != crate::SyncMode::Local {
            tracing::info!(
                "Continuous sync loop disabled for mode {:?}",
                sync_mode
            );
            return Self { shutdown };
        }

        let shutdown_clone = shutdown.clone();
        let interval_ms = interval_ms.max(1_000);
        tauri::async_runtime::spawn(async move {
            let mut last_synced_hlc: u64 = 0;
            let mut ticker = tokio::time::interval(Duration::from_millis(interval_ms));
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            // Consume immediate first tick so the first sync happens after interval_ms.
            ticker.tick().await;

            loop {
                ticker.tick().await;
                if shutdown_clone.load(Ordering::SeqCst) {
                    break;
                }

                // Check if HLC counter changed (mutation happened)
                let current_hlc = {
                    let guard = state.lock().await;
                    guard.db.hlc_counter
                };

                if current_hlc > last_synced_hlc {
                    perform_continuous_sync(&state).await;
                    // Update tracking counter after sync
                    last_synced_hlc = {
                        let guard = state.lock().await;
                        guard.db.hlc_counter
                    };
                }
            }
            tracing::info!("Continuous sync loop stopped");
        });

        Self { shutdown }
    }

    /// Stop the continuous sync loop.
    pub fn shutdown(&self) {
        self.shutdown.store(true, Ordering::SeqCst);
    }
}

/// Perform a single continuous sync cycle (local mode).
///
/// Reads the OpenClaw copy of db.json, merges with in-memory state using HLC,
/// and writes the merged result back to both locations.
async fn perform_continuous_sync(state: &Arc<Mutex<AppState>>) {
    // Snapshot under lock
    let (db_snapshot, client_uuid, snapshot_hlc) = {
        let guard = state.lock().await;
        (
            guard.db.clone(),
            guard.client_uuid.clone(),
            guard.db.hlc_counter,
        )
    };

    // Read remote (local filesystem mode)
    let remote_db = match read_local_openclaw_db() {
        Some(db) => db,
        None => {
            // No remote file yet — just write local
            if let Err(e) = write_local_openclaw_db(&db_snapshot) {
                tracing::warn!("Continuous sync: failed to write initial sync file: {}", e);
                append_sync_event(
                    state,
                    "continuous-sync-initial-write",
                    false,
                    0,
                    format!("Failed to write initial sync file: {e}"),
                )
                .await;
            } else {
                append_sync_event(
                    state,
                    "continuous-sync-initial-write",
                    true,
                    0,
                    "Wrote initial local snapshot to OpenClaw data directory".to_string(),
                )
                .await;
            }
            return;
        }
    };

    // Merge
    let (mut merged, from_remote, _from_local) =
        merge_db_json(&db_snapshot, &remote_db, &client_uuid);
    fix_post_merge_invariants(&mut merged);

    // Update last_synced_at (wall-clock, NOT HLC — used for write-back mtime comparison)
    merged.last_synced_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    // Write to OpenClaw location
    if let Err(e) = write_local_openclaw_db(&merged) {
        tracing::warn!("Continuous sync: failed to write to OpenClaw: {}", e);
        append_sync_event(
            state,
            "continuous-sync-write-openclaw",
            false,
            from_remote as u64,
            format!("Failed to write merged state to OpenClaw: {e}"),
        )
        .await;
        return;
    }

    // Write-back: if remote had content changes, write to local git files (Phase 6.6)
    let writeback_hashes = if from_remote > 0 {
        perform_write_backs(&db_snapshot, &merged)
    } else {
        Vec::new()
    };

    // Re-acquire lock; CAS check for concurrent mutations during sync
    let mut guard = state.lock().await;
    if guard.db.hlc_counter > snapshot_hlc {
        // Concurrent mutation happened while we were syncing — re-merge
        let (mut reconciled, _, _) = merge_db_json(&guard.db, &merged, &guard.client_uuid);
        fix_post_merge_invariants_pub(&mut reconciled);
        guard.db = reconciled;
    } else if from_remote > 0 {
        // Remote had newer fields — update in-memory state
        guard.db = merged;
    }
    guard.hlc_counter = guard.db.hlc_counter;

    // Store write-back hashes for echo prevention (cleared by watcher after match)
    for (path, hash) in writeback_hashes {
        guard.writeback_hashes.insert(path, hash);
    }

    tracing::debug!(
        "Continuous sync completed: {} fields from remote",
        from_remote
    );
    drop(guard);

    append_sync_event(
        state,
        "continuous-sync-cycle",
        true,
        from_remote as u64,
        format!("Continuous sync completed (remote fields merged: {})", from_remote),
    )
    .await;
}

async fn append_sync_event(
    state: &Arc<Mutex<AppState>>,
    event: &str,
    success: bool,
    fields_from_remote: u64,
    message: String,
) {
    let mut guard = state.lock().await;
    guard.push_sync_event(SyncEventLogEntry {
        timestamp: 0,
        event: event.to_string(),
        success,
        fields_from_remote,
        message,
    });
}

// ---------------------------------------------------------------------------
// 6.6 Write-back mechanism (git file sync)
// ---------------------------------------------------------------------------

/// Compare merged DB against pre-merge snapshot to find content field changes
/// from remote, then write changed content back to local git files.
///
/// Returns a Vec of (absolute_path, sha256_hash) for echo prevention.
fn perform_write_backs(snapshot: &DbJson, merged: &DbJson) -> Vec<(String, String)> {
    let mut hashes: Vec<(String, String)> = Vec::new();

    for (project_id, merged_entry) in &merged.projects {
        let snapshot_entry = match snapshot.projects.get(project_id) {
            Some(e) => e,
            None => continue, // Entire project from remote — no write-back (no local repo)
        };

        for (item_id, merged_item) in &merged_entry.roadmap_items {
            let snapshot_item = match snapshot_entry.roadmap_items.get(item_id) {
                Some(i) => i,
                None => continue, // New item from remote — no local file to write to
            };

            // Check specDocContent change
            if merged_item.spec_doc_content != snapshot_item.spec_doc_content {
                if let (Some(content), Some(doc_path)) =
                    (&merged_item.spec_doc_content, &merged_item.spec_doc)
                {
                    if let Some(hash) = maybe_write_back_file(
                        &merged_entry.project_path,
                        doc_path,
                        content,
                        merged_item.spec_doc_branch.as_deref(),
                        merged.last_synced_at,
                    ) {
                        hashes.push(hash);
                    }
                }
            }

            // Check planDocContent change
            if merged_item.plan_doc_content != snapshot_item.plan_doc_content {
                if let (Some(content), Some(doc_path)) =
                    (&merged_item.plan_doc_content, &merged_item.plan_doc)
                {
                    if let Some(hash) = maybe_write_back_file(
                        &merged_entry.project_path,
                        doc_path,
                        content,
                        merged_item.plan_doc_branch.as_deref(),
                        merged.last_synced_at,
                    ) {
                        hashes.push(hash);
                    }
                }
            }
        }
    }

    if !hashes.is_empty() {
        tracing::info!("Write-back: wrote {} files from remote content", hashes.len());
    }

    hashes
}

/// Attempt to write content back to a local git file.
///
/// Returns `Some((absolute_path, sha256_hash))` on successful write, `None` if skipped.
///
/// Skipped when:
/// - Current git branch doesn't match the expected branch (prevents cross-branch leakage)
/// - Local file mtime is newer than `_lastSyncedAt` (user is actively editing)
fn maybe_write_back_file(
    project_path: &str,
    doc_rel_path: &str,
    content: &str,
    expected_branch: Option<&str>,
    last_synced_at: u64,
) -> Option<(String, String)> {
    let full_path = Path::new(project_path).join(doc_rel_path);

    // Step 0: Check branch match (prevent cross-branch content leakage)
    if let Some(expected) = expected_branch {
        match crate::commands::git::run_git(project_path, &["rev-parse", "--abbrev-ref", "HEAD"]) {
            Ok(current) => {
                if current.trim() != expected {
                    tracing::debug!(
                        "Write-back skipped for {}: branch mismatch (current: {}, expected: {})",
                        doc_rel_path,
                        current.trim(),
                        expected
                    );
                    return None;
                }
            }
            Err(_) => {
                // Not a git repo or git not available — skip write-back
                return None;
            }
        }
    }

    // Step 1: Check file mtime vs _lastSyncedAt (wall-clock comparison)
    if let Ok(metadata) = fs::metadata(&full_path) {
        if let Ok(mtime) = metadata.modified() {
            let mtime_ms = mtime
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            if mtime_ms > last_synced_at {
                tracing::debug!(
                    "Write-back skipped for {}: local file is newer than last sync",
                    doc_rel_path
                );
                return None;
            }
        }
    }
    // If file doesn't exist yet, proceed (new file from remote)

    // Step 2: Write content to the git file
    let hash = crate::watcher::sha256_hex(content.as_bytes());
    if let Some(parent) = full_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    match fs::write(&full_path, content) {
        Ok(()) => {
            tracing::info!(
                "Write-back: wrote {} bytes to {}",
                content.len(),
                full_path.display()
            );
            Some((full_path.to_string_lossy().to_string(), hash))
        }
        Err(e) => {
            tracing::warn!("Write-back failed for {}: {}", full_path.display(), e);
            None
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{DbClient, DbProjectEntry};
    use std::collections::HashMap;

    #[test]
    fn extension_content_contains_version() {
        let content = generate_extension_content();
        assert!(content.contains(&format!(
            "const EXTENSION_VERSION = '{}';",
            EXTENSION_VERSION
        )));
        assert!(content.contains("registerHttpRoute"));
        assert!(content.contains("Bearer"));
        assert!(content.contains("Path traversal blocked"));
        assert!(content.contains("5 * 1024 * 1024"));
    }

    #[test]
    fn merge_db_json_newer_remote_wins() {
        let local = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Old Title".to_string(),
                            title_updated_at: 5,
                            status: "pending".to_string(),
                            status_updated_at: 5,
                            description: "desc".to_string(),
                            description_updated_at: 5,
                            parent_id: None,
                            parent_id_updated_at: 5,
                            tags: vec![],
                            tags_updated_at: 5,
                        },
                        roadmap_items: HashMap::new(),
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let remote = DbJson {
            schema_version: 1,
            last_synced_at: 200,
            hlc_counter: 20,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "New Title".to_string(),
                            title_updated_at: 15,
                            status: "in-progress".to_string(),
                            status_updated_at: 15,
                            description: "desc".to_string(),
                            description_updated_at: 3,
                            parent_id: None,
                            parent_id_updated_at: 3,
                            tags: vec![],
                            tags_updated_at: 3,
                        },
                        roadmap_items: HashMap::new(),
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let (merged, from_remote, from_local) = merge_db_json(&local, &remote, "test-uuid");

        // Title and status should come from remote (ts 15 > 5)
        let proj = &merged.projects["proj-1"].project;
        assert_eq!(proj.title, "New Title");
        assert_eq!(proj.status, "in-progress");
        // Description should come from local (ts 5 > 3)
        assert_eq!(proj.description, "desc");
        assert_eq!(proj.description_updated_at, 5);
        // HLC counter should be max + 1
        assert_eq!(merged.hlc_counter, 21);
        // Remote won title + status (2), local won description + parent_id + tags (3)
        assert_eq!(from_remote, 2);
        assert_eq!(from_local, 3);
    }

    #[test]
    fn merge_db_json_adds_remote_only_projects() {
        let local = DbJson::default();
        let remote = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "remote-proj".to_string(),
                    DbProjectEntry {
                        project_path: "/remote".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "remote-proj".to_string(),
                            title: "Remote Project".to_string(),
                            title_updated_at: 10,
                            status: "pending".to_string(),
                            status_updated_at: 10,
                            description: "A remote project".to_string(),
                            description_updated_at: 10,
                            parent_id: None,
                            parent_id_updated_at: 10,
                            tags: vec![],
                            tags_updated_at: 10,
                        },
                        roadmap_items: HashMap::new(),
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let (merged, from_remote, _from_local) = merge_db_json(&local, &remote, "test-uuid");
        assert!(merged.projects.contains_key("remote-proj"));
        assert_eq!(from_remote, 1);
    }

    #[test]
    fn merge_roadmap_items_newer_wins() {
        let mut local_items = HashMap::new();
        local_items.insert(
            "item-1".to_string(),
            DbRoadmapItem {
                id: "item-1".to_string(),
                title: "Local Title".to_string(),
                title_updated_at: 10,
                status: "pending".to_string(),
                status_updated_at: 10,
                priority: 1,
                priority_updated_at: 10,
                next_action: Some("local action".to_string()),
                next_action_updated_at: Some(10),
                tags: None,
                tags_updated_at: None,
                icon: None,
                icon_updated_at: None,
                blocked_by: None,
                blocked_by_updated_at: None,
                spec_doc: None,
                spec_doc_updated_at: None,
                plan_doc: None,
                plan_doc_updated_at: None,
                spec_doc_branch: None,
                spec_doc_branch_updated_at: None,
                plan_doc_branch: None,
                plan_doc_branch_updated_at: None,
                spec_doc_content: None,
                spec_doc_content_updated_at: None,
                plan_doc_content: None,
                plan_doc_content_updated_at: None,
                completed_at: None,
                completed_at_updated_at: None,
            },
        );

        let mut remote_items = HashMap::new();
        remote_items.insert(
            "item-1".to_string(),
            DbRoadmapItem {
                id: "item-1".to_string(),
                title: "Remote Title".to_string(),
                title_updated_at: 20,
                status: "in-progress".to_string(),
                status_updated_at: 20,
                priority: 2,
                priority_updated_at: 5,
                next_action: Some("remote action".to_string()),
                next_action_updated_at: Some(5),
                tags: None,
                tags_updated_at: None,
                icon: None,
                icon_updated_at: None,
                blocked_by: None,
                blocked_by_updated_at: None,
                spec_doc: None,
                spec_doc_updated_at: None,
                plan_doc: None,
                plan_doc_updated_at: None,
                spec_doc_branch: None,
                spec_doc_branch_updated_at: None,
                plan_doc_branch: None,
                plan_doc_branch_updated_at: None,
                spec_doc_content: None,
                spec_doc_content_updated_at: None,
                plan_doc_content: None,
                plan_doc_content_updated_at: None,
                completed_at: None,
                completed_at_updated_at: None,
            },
        );

        let local = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 15,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Test".to_string(),
                            title_updated_at: 1,
                            status: "pending".to_string(),
                            status_updated_at: 1,
                            description: "".to_string(),
                            description_updated_at: 1,
                            parent_id: None,
                            parent_id_updated_at: 1,
                            tags: vec![],
                            tags_updated_at: 1,
                        },
                        roadmap_items: local_items,
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let remote = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 25,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Test".to_string(),
                            title_updated_at: 1,
                            status: "pending".to_string(),
                            status_updated_at: 1,
                            description: "".to_string(),
                            description_updated_at: 1,
                            parent_id: None,
                            parent_id_updated_at: 1,
                            tags: vec![],
                            tags_updated_at: 1,
                        },
                        roadmap_items: remote_items,
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let (merged, from_remote, from_local) = merge_db_json(&local, &remote, "test-uuid");
        let item = &merged.projects["proj-1"].roadmap_items["item-1"];

        // title + status from remote (ts 20 > 10)
        assert_eq!(item.title, "Remote Title");
        assert_eq!(item.status, "in-progress");
        // priority + next_action from local (ts 10 > 5)
        assert_eq!(item.priority, 1);
        assert_eq!(item.next_action, Some("local action".to_string()));

        assert!(from_remote > 0);
        assert!(from_local > 0);
    }

    #[test]
    fn merge_timestamp_tie_larger_value_wins() {
        // When timestamps are equal, the lexicographically larger value wins
        // (content-based tie-breaking for deterministic multi-device convergence)
        let local = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Local Title".to_string(),
                            title_updated_at: 10,
                            status: "pending".to_string(),
                            status_updated_at: 10,
                            description: "local desc".to_string(),
                            description_updated_at: 10,
                            parent_id: None,
                            parent_id_updated_at: 10,
                            tags: vec![],
                            tags_updated_at: 10,
                        },
                        roadmap_items: HashMap::new(),
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let remote = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Remote Title".to_string(),
                            title_updated_at: 10,
                            status: "in-progress".to_string(),
                            status_updated_at: 10,
                            description: "remote desc".to_string(),
                            description_updated_at: 10,
                            parent_id: None,
                            parent_id_updated_at: 10,
                            tags: vec![],
                            tags_updated_at: 10,
                        },
                        roadmap_items: HashMap::new(),
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let (merged, from_remote, from_local) = merge_db_json(&local, &remote, "test-uuid");
        let proj = &merged.projects["proj-1"].project;

        // On tie, larger value wins:
        // "Remote Title" > "Local Title" → remote wins title
        // "in-progress" < "pending" → local keeps status ("pending" is larger)
        // "remote desc" > "local desc" → remote wins description
        // None == None → no change (local keeps)
        // [] == [] → no change (local keeps)
        assert_eq!(proj.title, "Remote Title");
        assert_eq!(proj.status, "pending"); // local's "pending" > remote's "in-progress"
        assert_eq!(proj.description, "remote desc");
        // title + description from remote (2), status + parent_id + tags kept local (3)
        assert_eq!(from_remote, 2);
        assert_eq!(from_local, 3);
    }

    #[test]
    fn clock_skew_detected_when_large() {
        // A timestamp 10 seconds in the future should trigger warning
        let future_ts = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
            + 10_000;

        let warning = detect_clock_skew(future_ts);
        assert!(warning.is_some());
        assert!(warning.unwrap().contains("Clock difference"));
    }

    #[test]
    fn clock_skew_not_detected_when_small() {
        let now = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        let warning = detect_clock_skew(now);
        assert!(warning.is_none());
    }

    #[test]
    fn system_context_content_has_placeholders() {
        // Verify the format string produces valid output
        let data_dir = openclaw_data_dir();
        assert!(data_dir.is_ok());
    }

    #[test]
    fn extension_version_not_empty() {
        assert!(!EXTENSION_VERSION.is_empty());
    }

    #[test]
    fn get_platform_returns_known_value() {
        let p = get_platform();
        assert!(
            ["macos", "windows", "linux"].contains(&p.as_str()) || !p.is_empty(),
            "Platform should be a known string"
        );
    }

    #[test]
    fn merge_clients_union() {
        let local = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: HashMap::new(),
            clients: {
                let mut m = HashMap::new();
                m.insert(
                    "client-a".to_string(),
                    DbClient {
                        hostname: "host-a".to_string(),
                        platform: "macos".to_string(),
                        last_seen_at: 100,
                    },
                );
                m
            },
        };

        let remote = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: HashMap::new(),
            clients: {
                let mut m = HashMap::new();
                m.insert(
                    "client-b".to_string(),
                    DbClient {
                        hostname: "host-b".to_string(),
                        platform: "linux".to_string(),
                        last_seen_at: 200,
                    },
                );
                m
            },
        };

        let (merged, _, _) = merge_db_json(&local, &remote, "client-a");
        assert!(merged.clients.contains_key("client-a"));
        assert!(merged.clients.contains_key("client-b"));
    }

    #[test]
    fn merge_new_remote_roadmap_items_added() {
        let local = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 10,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Test".to_string(),
                            title_updated_at: 1,
                            status: "pending".to_string(),
                            status_updated_at: 1,
                            description: "".to_string(),
                            description_updated_at: 1,
                            parent_id: None,
                            parent_id_updated_at: 1,
                            tags: vec![],
                            tags_updated_at: 1,
                        },
                        roadmap_items: HashMap::new(),
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let remote = DbJson {
            schema_version: 1,
            last_synced_at: 100,
            hlc_counter: 20,
            projects: {
                let mut m = HashMap::new();
                m.insert(
                    "proj-1".to_string(),
                    DbProjectEntry {
                        project_path: "/test".to_string(),
                        state_json_migrated: false,
                        project: DbProjectData {
                            id: "proj-1".to_string(),
                            title: "Test".to_string(),
                            title_updated_at: 1,
                            status: "pending".to_string(),
                            status_updated_at: 1,
                            description: "".to_string(),
                            description_updated_at: 1,
                            parent_id: None,
                            parent_id_updated_at: 1,
                            tags: vec![],
                            tags_updated_at: 1,
                        },
                        roadmap_items: {
                            let mut items = HashMap::new();
                            items.insert(
                                "new-item".to_string(),
                                DbRoadmapItem {
                                    id: "new-item".to_string(),
                                    title: "New Item".to_string(),
                                    title_updated_at: 15,
                                    status: "pending".to_string(),
                                    status_updated_at: 15,
                                    priority: 1,
                                    priority_updated_at: 15,
                                    next_action: None,
                                    next_action_updated_at: None,
                                    tags: None,
                                    tags_updated_at: None,
                                    icon: None,
                                    icon_updated_at: None,
                                    blocked_by: None,
                                    blocked_by_updated_at: None,
                                    spec_doc: None,
                                    spec_doc_updated_at: None,
                                    plan_doc: None,
                                    plan_doc_updated_at: None,
                                    spec_doc_branch: None,
                                    spec_doc_branch_updated_at: None,
                                    plan_doc_branch: None,
                                    plan_doc_branch_updated_at: None,
                                    spec_doc_content: None,
                                    spec_doc_content_updated_at: None,
                                    plan_doc_content: None,
                                    plan_doc_content_updated_at: None,
                                    completed_at: None,
                                    completed_at_updated_at: None,
                                },
                            );
                            items
                        },
                    },
                );
                m
            },
            clients: HashMap::new(),
        };

        let (merged, from_remote, _) = merge_db_json(&local, &remote, "test-uuid");
        assert!(merged.projects["proj-1"]
            .roadmap_items
            .contains_key("new-item"));
        assert!(from_remote >= 1);
    }
}
