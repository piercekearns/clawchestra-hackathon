mod commands;
mod db_persistence;
mod injection;
mod locking;
mod merge;
mod migration;
mod state;
mod sync;
mod util;
mod validation;
mod watcher;

use std::collections::HashMap;
use std::env;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

pub(crate) use locking::*;
pub(crate) use state::*;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;
use tauri::Emitter;
use tracing_subscriber::prelude::*;

/// Type alias for the shared application state, used as Tauri managed state.
type SharedAppState = Arc<tokio::sync::Mutex<AppState>>;
/// Type alias for the DB flush handle, used as Tauri managed state.
type SharedFlushHandle = Arc<db_persistence::DbFlushHandle>;

// Embedded at compile time by build.rs
pub(crate) const BUILD_COMMIT: &str = env!("BUILD_COMMIT");
pub(crate) const DEFAULT_SESSION_KEY: &str = "agent:main:clawchestra";

#[derive(Serialize)]
struct OpenClawGatewayConfig {
    ws_url: String,
    token: Option<String>,
    session_key: String,
}

/// OpenClaw sync mode — how Clawchestra communicates with OpenClaw for db.json sync.
#[derive(Clone, Debug, Deserialize, Serialize, Default, PartialEq)]
pub(crate) enum SyncMode {
    /// Read/write directly to ~/.openclaw/clawchestra/db.json (same machine)
    #[default]
    Local,
    /// Sync via HTTP endpoint on a remote OpenClaw instance
    Remote,
    /// Sync disabled entirely
    Disabled,
    /// Catch-all for future variants — prevents deserialization crash on downgrade
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardSettings {
    #[serde(default = "default_settings_version")]
    settings_version: u32,
    #[serde(default = "default_migration_version")]
    migration_version: u32,
    #[serde(default = "default_scan_paths")]
    scan_paths: Vec<String>,
    #[serde(default = "default_openclaw_workspace_path")]
    openclaw_workspace_path: Option<String>,
    #[serde(default = "default_app_source_path")]
    app_source_path: Option<String>,
    #[serde(default = "default_update_mode")]
    update_mode: String,
    #[serde(default = "default_openclaw_context_policy")]
    openclaw_context_policy: String,
    /// Unique client identifier (UUID v4), generated on first launch
    #[serde(default)]
    client_uuid: Option<String>,
    /// How Clawchestra syncs with OpenClaw (Local, Remote, Disabled)
    #[serde(default)]
    openclaw_sync_mode: SyncMode,
    /// URL of the remote OpenClaw instance (when sync_mode is Remote)
    #[serde(default)]
    openclaw_remote_url: Option<String>,
    /// Bearer token for authenticating with the remote OpenClaw instance.
    /// Now stored in OS keychain; kept in struct for backwards-compat deserialization only.
    #[serde(default, skip_serializing)]
    #[allow(dead_code)]
    openclaw_bearer_token: Option<String>,
    /// Size of the per-project state history buffer (default: 20)
    #[serde(default = "default_state_history_buffer_size")]
    state_history_buffer_size: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OpenClawChatAttachmentInput {
    name: Option<String>,
    mime_type: String,
    content: String,
}

fn default_settings_version() -> u32 {
    1
}

fn default_migration_version() -> u32 {
    1 // New installs start at v1 (no migration needed)
}

fn default_scan_paths() -> Vec<String> {
    if let Ok(path) = std::env::var("CLAWCHESTRA_PROJECTS_DIR") {
        return vec![path];
    }

    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let mut paths = Vec::new();
    let preferred = [
        Path::new(&home).join("repos").to_string_lossy().to_string(),
        Path::new(&home)
            .join("projects")
            .to_string_lossy()
            .to_string(),
    ];

    for path in preferred {
        if Path::new(&path).exists() {
            paths.push(path);
        }
    }

    paths
}

fn default_openclaw_workspace_path() -> Option<String> {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    Some(format!("{home}/clawdbot-sandbox"))
}

fn default_app_source_path() -> Option<String> {
    None
}

fn default_update_mode() -> String {
    "source-rebuild".to_string()
}

fn default_openclaw_context_policy() -> String {
    "selected-project-first".to_string()
}

fn default_state_history_buffer_size() -> usize {
    20
}

fn settings_file_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("CLAWCHESTRA_SETTINGS_PATH") {
        return expand_tilde(&path);
    }

    let base = if cfg!(target_os = "macos") || cfg!(target_os = "windows") {
        dirs::data_dir()
            .ok_or_else(|| "Could not find application support directory".to_string())?
            .join("Clawchestra")
    } else {
        dirs::config_dir()
            .ok_or_else(|| "Could not find config directory".to_string())?
            .join("clawchestra")
    };

    Ok(base.join("settings.json"))
}

pub(crate) fn app_support_dir() -> Result<PathBuf, String> {
    let settings_path = settings_file_path()?;
    settings_path
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Could not find app data directory".to_string())
}

fn hardening_log_path() -> Result<PathBuf, String> {
    let logs_dir = app_support_dir()?.join("logs");
    fs::create_dir_all(&logs_dir).map_err(|error| error.to_string())?;
    Ok(logs_dir.join("hardening.log"))
}

pub(crate) fn append_hardening_log(event: &str, details: &str) {
    let Ok(path) = hardening_log_path() else {
        return;
    };
    let timestamp = unix_timestamp_secs();
    let line = format!("[{}] {} {}\n", timestamp, event, details);

    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
        let _ = file.write_all(line.as_bytes());
    }
}

// MutationLockGuard, acquire_mutation_lock_at, acquire_mutation_lock,
// and with_mutation_lock are now in locking.rs (re-exported via `pub(crate) use locking::*`)

fn normalize_lexical_path(path: &Path) -> PathBuf {
    use std::path::Component;

    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(Path::new(std::path::MAIN_SEPARATOR_STR)),
            Component::CurDir => {}
            Component::ParentDir => {
                let can_pop = normalized
                    .components()
                    .last()
                    .is_some_and(|last| !matches!(last, Component::RootDir | Component::Prefix(_)));

                if can_pop {
                    normalized.pop();
                }
            }
            Component::Normal(part) => normalized.push(part),
        }
    }

    if normalized.as_os_str().is_empty() {
        path.to_path_buf()
    } else {
        normalized
    }
}

pub(crate) fn normalize_path(path: &str) -> Result<String, String> {
    let expanded = expand_tilde(path)?;
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(expanded)
    };

    let normalized = if absolute.exists() {
        fs::canonicalize(&absolute).map_err(|error| {
            append_hardening_log(
                "path_normalization_failed",
                &format!("path={} error={}", absolute.to_string_lossy(), error),
            );
            error.to_string()
        })?
    } else {
        normalize_lexical_path(&absolute)
    };

    Ok(normalized.to_string_lossy().to_string())
}

fn normalize_optional_path(path: Option<String>) -> Result<Option<String>, String> {
    match path {
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                Ok(None)
            } else {
                Ok(Some(normalize_path(trimmed)?))
            }
        }
        None => Ok(None),
    }
}

fn sanitize_settings(mut settings: DashboardSettings) -> Result<DashboardSettings, String> {
    settings.settings_version = 1;
    if settings.migration_version > 1 {
        settings.migration_version = 1;
    }

    let mut scan_paths: Vec<String> = settings
        .scan_paths
        .into_iter()
        .filter_map(|path| {
            let trimmed = path.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(normalize_path(trimmed))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;

    scan_paths.sort();
    scan_paths.dedup();
    settings.scan_paths = scan_paths;

    settings.openclaw_workspace_path =
        normalize_optional_path(settings.openclaw_workspace_path.clone())?;
    settings.app_source_path = normalize_optional_path(settings.app_source_path.clone())?;

    if settings.update_mode != "none" && settings.update_mode != "source-rebuild" {
        settings.update_mode = default_update_mode();
    }
    if settings.openclaw_context_policy != "selected-project-first"
        && settings.openclaw_context_policy != "workspace-default"
    {
        settings.openclaw_context_policy = default_openclaw_context_policy();
    }

    Ok(settings)
}

pub(crate) fn default_settings() -> DashboardSettings {
    let settings = DashboardSettings {
        settings_version: default_settings_version(),
        migration_version: 1,
        scan_paths: default_scan_paths(),
        openclaw_workspace_path: default_openclaw_workspace_path(),
        app_source_path: default_app_source_path(),
        update_mode: default_update_mode(),
        openclaw_context_policy: default_openclaw_context_policy(),
        client_uuid: None,
        openclaw_sync_mode: SyncMode::default(),
        openclaw_remote_url: None,
        openclaw_bearer_token: None,
        state_history_buffer_size: default_state_history_buffer_size(),
    };

    sanitize_settings(settings).unwrap_or_else(|_| DashboardSettings {
        settings_version: 1,
        migration_version: 1,
        scan_paths: vec![],
        openclaw_workspace_path: None,
        app_source_path: default_app_source_path(),
        update_mode: default_update_mode(),
        openclaw_context_policy: default_openclaw_context_policy(),
        client_uuid: None,
        openclaw_sync_mode: SyncMode::default(),
        openclaw_remote_url: None,
        openclaw_bearer_token: None,
        state_history_buffer_size: default_state_history_buffer_size(),
    })
}

fn write_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    crate::util::write_str_atomic(path, content)
}

fn write_dashboard_settings_file(settings: &DashboardSettings) -> Result<(), String> {
    let path = settings_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    write_file_atomic(&path, &payload)
}

pub(crate) fn load_dashboard_settings() -> Result<DashboardSettings, String> {
    let path = settings_file_path()?;
    if !path.exists() {
        let defaults = default_settings();
        write_dashboard_settings_file(&defaults)?;
        return Ok(defaults);
    }

    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let parsed: DashboardSettings = match serde_json::from_str(&raw) {
        Ok(settings) => settings,
        Err(_) => {
            let backup_suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_secs())
                .unwrap_or(0);
            let backup = path.with_file_name(format!("settings.corrupt-{backup_suffix}.json"));
            let _ = fs::rename(&path, backup);
            let defaults = default_settings();
            write_dashboard_settings_file(&defaults)?;
            return Ok(defaults);
        }
    };
    let sanitized = sanitize_settings(parsed)?;
    write_dashboard_settings_file(&sanitized)?;
    Ok(sanitized)
}

/// Migrate data directories from old "Pipeline Dashboard" / "pipeline-dashboard" names
/// to new "Clawchestra" / "clawchestra" names. Idempotent: only renames when old exists
/// and new does not. Runs once on first launch post-rename, then is a no-op.
fn migrate_data_directories() {
    // Settings directory: "Pipeline Dashboard" → "Clawchestra" (macOS/Windows)
    // or "pipeline-dashboard" → "clawchestra" (Linux)
    if let Some(data_dir) = dirs::data_dir() {
        if cfg!(target_os = "macos") || cfg!(target_os = "windows") {
            let old = data_dir.join("Pipeline Dashboard");
            let new = data_dir.join("Clawchestra");
            migrate_dir(&old, &new, "settings");
        } else {
            if let Some(config_dir) = dirs::config_dir() {
                let old = config_dir.join("pipeline-dashboard");
                let new = config_dir.join("clawchestra");
                migrate_dir(&old, &new, "settings");
            }
        }

        // Chat DB directory: "pipeline-dashboard" → "clawchestra"
        let old_db = data_dir.join("pipeline-dashboard");
        let new_db = data_dir.join("clawchestra");
        migrate_dir(&old_db, &new_db, "chat-db");
    }

    // Best-effort cache cleanup
    if let Some(cache_dir) = dirs::cache_dir() {
        let _ = fs::remove_dir_all(cache_dir.join("pipeline-dashboard"));
        let _ = fs::remove_dir_all(cache_dir.join("com.clawdbot.pipeline-dashboard"));
    }

    // Best-effort old preferences cleanup (macOS)
    #[cfg(target_os = "macos")]
    {
        if let Some(home) = dirs::home_dir() {
            let old_plist = home
                .join("Library")
                .join("Preferences")
                .join("com.clawdbot.pipeline-dashboard.plist");
            let _ = fs::remove_file(old_plist);
        }
    }
}

fn migrate_dir(old: &Path, new: &Path, label: &str) {
    if old.exists() && !new.exists() {
        println!("[Migration] Migrating {label}: {} → {}", old.display(), new.display());
        if let Some(parent) = new.parent() {
            let _ = fs::create_dir_all(parent);
        }
        match fs::rename(old, new) {
            Ok(()) => println!("[Migration] {label} migrated successfully"),
            Err(e) => eprintln!("[Migration] {label} migration failed (continuing): {e}"),
        }
    }
}

fn run_migrations() {
    let mut settings = match load_dashboard_settings() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Migration] Failed to load settings, skipping: {e}");
            return;
        }
    };

    if settings.migration_version < 1 {
        println!("[Migration] Clearing chat.db for session key migration (v0 → v1)");
        match commands::chat::clear_chat_database() {
            Ok(()) => {
                settings.migration_version = 1;
                if let Err(e) = write_dashboard_settings_file(&settings) {
                    eprintln!("[Migration] Failed to update settings after clear: {e}");
                }
            }
            Err(e) => {
                eprintln!("[Migration] Failed to clear chat.db: {e}");
                // Do NOT bump migration_version — retry on next launch
            }
        }
    }
}

#[tauri::command]
fn get_dashboard_settings() -> Result<DashboardSettings, String> {
    load_dashboard_settings()
}

#[tauri::command]
fn update_dashboard_settings(settings: DashboardSettings) -> Result<DashboardSettings, String> {
    with_mutation_lock("update_dashboard_settings", || {
        let sanitized = sanitize_settings(settings)?;
        write_dashboard_settings_file(&sanitized)?;
        Ok(sanitized)
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScanResult {
    projects: Vec<String>,
    skipped: Vec<SkippedDirectory>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkippedDirectory {
    path: String,
    reason: String,
}

const SCAN_SKIP_DIRS: [&str; 6] = ["node_modules", ".git", "target", "dist", ".next", ".cache"];

#[tauri::command]
fn scan_projects(scan_paths: Vec<String>) -> Result<ScanResult, String> {
    let mut projects = Vec::new();
    let mut skipped = Vec::new();

    for scan_path in &scan_paths {
        let root = PathBuf::from(scan_path);
        if !root.exists() {
            skipped.push(SkippedDirectory {
                path: scan_path.clone(),
                reason: "not found".to_string(),
            });
            continue;
        }

        let entries = match fs::read_dir(&root) {
            Ok(entries) => entries,
            Err(_) => {
                skipped.push(SkippedDirectory {
                    path: scan_path.clone(),
                    reason: "permission denied".to_string(),
                });
                continue;
            }
        };

        for entry in entries {
            let entry = match entry {
                Ok(e) => e,
                Err(_) => continue,
            };

            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let dir_name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");

            // Skip hidden directories and known noise
            if dir_name.starts_with('.') || SCAN_SKIP_DIRS.contains(&dir_name) {
                continue;
            }

            // A project directory must contain CLAWCHESTRA.md (preferred) or PROJECT.md (legacy)
            let clawchestra_md = path.join("CLAWCHESTRA.md");
            let project_md = path.join("PROJECT.md");
            if clawchestra_md.exists() || project_md.exists() {
                projects.push(path.to_string_lossy().to_string());
            }
        }
    }

    projects.sort();
    Ok(ScanResult { projects, skipped })
}

/// Validate that a path is within one of the allowed directories.
/// Prevents arbitrary filesystem access via IPC commands.
fn validate_allowed_path(path: &str) -> Result<(), String> {
    let settings = load_dashboard_settings().unwrap_or_else(|_| default_settings());
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());

    // Build allowed prefixes: scan_paths + ~/.openclaw/ + /tmp + /private/tmp
    let mut allowed: Vec<PathBuf> = settings
        .scan_paths
        .iter()
        .filter_map(|p| fs::canonicalize(p).ok())
        .collect();

    if let Ok(openclaw) = fs::canonicalize(format!("{home}/.openclaw")) {
        allowed.push(openclaw);
    } else {
        // If it doesn't exist yet, allow the lexical path
        allowed.push(PathBuf::from(format!("{home}/.openclaw")));
    }
    allowed.push(PathBuf::from("/tmp"));
    allowed.push(PathBuf::from("/private/tmp"));

    if let Some(app_src) = &settings.app_source_path {
        if let Ok(p) = fs::canonicalize(app_src) {
            allowed.push(p);
        }
    }

    // Resolve the target path: canonicalize if exists, else canonicalize parent
    let target = Path::new(path);
    let canonical = if target.exists() {
        fs::canonicalize(target).map_err(|e| format!("Cannot resolve path: {e}"))?
    } else if let Some(parent) = target.parent() {
        if parent.exists() {
            let canon_parent = fs::canonicalize(parent)
                .map_err(|e| format!("Cannot resolve parent path: {e}"))?;
            canon_parent.join(target.file_name().unwrap_or_default())
        } else {
            return Err(format!("Path not within allowed directories: {path}"));
        }
    } else {
        return Err(format!("Path not within allowed directories: {path}"));
    };

    for prefix in &allowed {
        if canonical.starts_with(prefix) {
            return Ok(());
        }
    }

    Err(format!("Path not within allowed directories: {path}"))
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    validate_allowed_path(&path)?;
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    validate_allowed_path(&path)?;
    with_mutation_lock("write_file", || {
        if let Some(parent) = Path::new(&path).parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        fs::write(&path, content).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    validate_allowed_path(&path)?;
    with_mutation_lock("delete_file", || {
        fs::remove_file(path).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    validate_allowed_path(&path)?;
    with_mutation_lock("remove_path", || {
        let expanded = expand_tilde(&path)?;
        if expanded.is_file() {
            fs::remove_file(expanded).map_err(|error| error.to_string())
        } else if expanded.is_dir() {
            fs::remove_dir_all(expanded).map_err(|error| error.to_string())
        } else {
            Ok(())
        }
    })
}

#[tauri::command]
fn resolve_path(path: String) -> Result<String, String> {
    let expanded = expand_tilde(&path)?;

    fs::canonicalize(expanded)
        .map(|resolved| resolved.to_string_lossy().to_string())
        .map_err(|error| {
            append_hardening_log(
                "path_resolution_failed",
                &format!("path={} error={}", path, error),
            );
            error.to_string()
        })
}

#[tauri::command]
fn path_exists(path: String) -> Result<bool, String> {
    let expanded = expand_tilde(&path)?;
    Ok(expanded.exists())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    with_mutation_lock("create_directory", || {
        let expanded = expand_tilde(&path)?;
        fs::create_dir_all(expanded).map_err(|error| error.to_string())
    })
}

#[tauri::command]
fn pick_folder(initial_path: Option<String>) -> Result<Option<String>, String> {
    let mut dialog = rfd::FileDialog::new();

    if let Some(path) = initial_path {
        let expanded = expand_tilde(&path)?;
        dialog = dialog.set_directory(expanded);
    }

    Ok(dialog
        .pick_folder()
        .map(|folder| folder.to_string_lossy().to_string()))
}

#[tauri::command]
fn get_openclaw_gateway_config() -> Result<OpenClawGatewayConfig, String> {
    let home = env::var("HOME").map_err(|error| error.to_string())?;
    let config_path = Path::new(&home).join(".openclaw").join("openclaw.json");

    let mut port: u16 = 18789;
    let mut token: Option<String> = None;

    if let Ok(raw) = fs::read_to_string(config_path) {
        if let Ok(json) = serde_json::from_str::<Value>(&raw) {
            if let Some(gateway) = json.get("gateway") {
                if let Some(parsed_port) = gateway.get("port").and_then(|value| value.as_u64()) {
                    if parsed_port <= u16::MAX as u64 {
                        port = parsed_port as u16;
                    }
                }

                token = gateway
                    .get("auth")
                    .and_then(|auth| auth.get("token"))
                    .and_then(|value| value.as_str())
                    .map(|value| value.to_string());
            }
        }
    }

    Ok(OpenClawGatewayConfig {
        ws_url: format!("ws://127.0.0.1:{port}"),
        token,
        session_key: DEFAULT_SESSION_KEY.to_string(),
    })
}

fn run_command_with_output(command: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(command)
        .args(args)
        .output()
        .map_err(|error| format!("Failed to run `{command}`: {error}"))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();

        if !stderr.is_empty() {
            Err(stderr)
        } else if !stdout.is_empty() {
            Err(stdout)
        } else {
            Err(format!("`{command}` exited with status {}", output.status))
        }
    }
}

fn find_openclaw_binary() -> Option<PathBuf> {
    // Check common installation locations with explicit paths
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let candidates = [
        format!("{home}/Library/pnpm/openclaw"),
        format!("{home}/.local/bin/openclaw"),
        format!("{home}/.cargo/bin/openclaw"),
        format!("{home}/.npm-global/bin/openclaw"),
        "/usr/local/bin/openclaw".to_string(),
        "/opt/homebrew/bin/openclaw".to_string(),
    ];

    for candidate in candidates {
        let path = PathBuf::from(&candidate);
        if path.exists() {
            return Some(path);
        }
    }

    // Fallback: ask the shell to find it (login shell to get full PATH)
    if let Ok(output) = Command::new("/bin/sh")
        .args(["-l", "-c", "which openclaw"])
        .output()
    {
        if output.status.success() {
            let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path_str.is_empty() {
                let path = PathBuf::from(&path_str);
                if path.exists() {
                    return Some(path);
                }
            }
        }
    }

    None
}

const KEYRING_SERVICE: &str = "com.clawdbot.clawchestra";
const KEYRING_BEARER_KEY: &str = "openclaw-bearer-token";

fn get_or_create_bearer_token() -> Result<String, String> {
    let entry = keyring::Entry::new(KEYRING_SERVICE, KEYRING_BEARER_KEY)
        .map_err(|e| format!("Keyring init error: {e}"))?;
    match entry.get_password() {
        Ok(token) if !token.is_empty() => Ok(token),
        _ => {
            let token = uuid::Uuid::new_v4().to_string();
            entry
                .set_password(&token)
                .map_err(|e| format!("Keyring store error: {e}"))?;
            Ok(token)
        }
    }
}

#[tauri::command]
fn get_openclaw_bearer_token() -> Result<String, String> {
    get_or_create_bearer_token()
}

fn extension_for_mime(mime_type: &str) -> &'static str {
    match mime_type {
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        _ => "png",
    }
}

fn pick_attachment_names(attachments: &[OpenClawChatAttachmentInput]) -> Vec<String> {
    attachments
        .iter()
        .enumerate()
        .map(|(index, attachment)| {
            attachment.name.clone().unwrap_or_else(|| {
                format!(
                    "image-{}.{}",
                    index + 1,
                    extension_for_mime(&attachment.mime_type)
                )
            })
        })
        .collect()
}

fn normalize_session_key(session_key: Option<String>) -> String {
    let session = session_key
        .unwrap_or_else(|| DEFAULT_SESSION_KEY.to_string())
        .trim()
        .to_string();

    // Normalize legacy "main" values for backwards compatibility with older configs
    if session.is_empty() || session == "main" {
        DEFAULT_SESSION_KEY.to_string()
    } else {
        session
    }
}

fn gateway_call(method: &str, params: &Value) -> Result<Value, String> {
    let openclaw = find_openclaw_binary().ok_or_else(|| "OpenClaw CLI not found".to_string())?;

    let params_json = serde_json::to_string(params)
        .map_err(|error| format!("Failed to encode params: {error}"))?;

    // Build comprehensive PATH including common node locations
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let node_paths = format!(
        "/opt/homebrew/bin:/usr/local/bin:{home}/Library/pnpm:{home}/.nvm/versions/node/v22.0.0/bin:{home}/.local/bin:/usr/bin:/bin:{}",
        env::var("PATH").unwrap_or_default()
    );

    // For large payloads, warn and fail gracefully
    // Images should be resized on frontend before sending
    if params_json.len() > 200_000 {
        return Err("Payload too large. Please use smaller images (they are auto-resized, but this may indicate an issue).".to_string());
    }

    // Normal payloads use direct command
    let output = Command::new(&openclaw)
        .args([
            "gateway",
            "call",
            method,
            "--params",
            &params_json,
            "--json",
        ])
        .env("PATH", &node_paths)
        .output()
        .map_err(|e| format!("Failed to run gateway call: {e}"))?;

    if output.status.success() {
        let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
        serde_json::from_str::<Value>(&raw)
            .map_err(|error| format!("Invalid gateway response: {error}"))
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        Err(if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            "Gateway call failed".to_string()
        })
    }
}

fn latest_assistant_entry(history: &Value) -> Option<(i64, String)> {
    let messages = history.get("messages")?.as_array()?;
    for message in messages.iter().rev() {
        if message.get("role").and_then(Value::as_str) != Some("assistant") {
            continue;
        }

        let timestamp = message
            .get("timestamp")
            .and_then(Value::as_i64)
            .unwrap_or(0);
        let content = message.get("content");
        let text = if let Some(parts) = content.and_then(Value::as_array) {
            let joined = parts
                .iter()
                .filter_map(|part| part.get("text").and_then(Value::as_str))
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .collect::<Vec<&str>>()
                .join("\n");
            joined
        } else {
            content
                .and_then(Value::as_str)
                .map(str::trim)
                .unwrap_or_default()
                .to_string()
        };

        if !text.is_empty() {
            return Some((timestamp, text));
        }
    }

    None
}

fn new_idempotency_key() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("clawchestra-{nanos}")
}

#[tauri::command]
async fn openclaw_ping() -> Result<(), String> {
    let openclaw = find_openclaw_binary()
        .ok_or_else(|| "OpenClaw CLI not found. Install with: npm i -g openclaw".to_string())?;

    let openclaw_str = openclaw.to_string_lossy();
    let status = run_command_with_output(&openclaw_str, &["gateway", "status"])?;
    let normalized = status.to_lowercase();

    if normalized.contains("rpc probe: ok") || normalized.contains("runtime: running") {
        Ok(())
    } else {
        Err("OpenClaw gateway is not healthy. Run `openclaw gateway status`.".to_string())
    }
}

#[tauri::command]
async fn openclaw_chat(
    message: String,
    attachments: Vec<OpenClawChatAttachmentInput>,
    session_key: Option<String>,
) -> Result<String, String> {
    // Run the entire chat polling loop on a blocking thread pool to avoid
    // starving tokio workers (thread::sleep + sync Command::output inside async = bad).
    tokio::task::spawn_blocking(move || {
        openclaw_chat_blocking(message, attachments, session_key)
    })
    .await
    .map_err(|e| format!("Chat task panicked: {}", e))?
}

fn openclaw_chat_blocking(
    message: String,
    attachments: Vec<OpenClawChatAttachmentInput>,
    session_key: Option<String>,
) -> Result<String, String> {
    let _ = find_openclaw_binary()
        .ok_or_else(|| "OpenClaw CLI not found. Install with: npm i -g openclaw".to_string())?;

    let mut normalized = message.trim().to_string();
    let attachment_names = pick_attachment_names(&attachments);
    if !attachment_names.is_empty() {
        let joined = attachment_names.join(", ");
        if normalized.is_empty() {
            normalized = format!("Please review the attached images: {joined}");
        } else {
            normalized = format!("{normalized}\n\nAttached images: {joined}");
        }
    }

    if normalized.is_empty() {
        return Err("No message content to send".to_string());
    }

    let session = normalize_session_key(session_key);
    let baseline_history = gateway_call(
        "chat.history",
        &json!({ "sessionKey": session.clone(), "limit": 1 }),
    )?;
    let (baseline_timestamp, baseline_text) =
        latest_assistant_entry(&baseline_history).unwrap_or((0, String::new()));

    let gateway_attachments: Vec<Value> = attachments
        .iter()
        .map(|attachment| {
            json!({
                "type": "image",
                "mimeType": attachment.mime_type,
                "content": attachment.content,
            })
        })
        .collect();

    let send_params = if gateway_attachments.is_empty() {
        json!({
            "sessionKey": session.clone(),
            "message": normalized,
            "deliver": false,
            "idempotencyKey": new_idempotency_key(),
        })
    } else {
        json!({
            "sessionKey": session.clone(),
            "message": normalized,
            "deliver": false,
            "idempotencyKey": new_idempotency_key(),
            "attachments": gateway_attachments,
        })
    };

    let send_response = gateway_call("chat.send", &send_params)?;
    if send_response.get("status").and_then(Value::as_str) == Some("error") {
        let message = send_response
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("OpenClaw rejected the message.");
        return Err(message.to_string());
    }

    let started = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);

    let timeout_ms = 90_000_i64;
    let poll_interval = Duration::from_millis(1200);
    let settle_duration_ms = 8_000_i64; // Wait this long after first response to catch follow-ups

    let mut first_response_at: Option<i64> = None;
    let mut latest_text = String::new();

    loop {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis() as i64)
            .unwrap_or(started);

        if now - started > timeout_ms {
            break;
        }

        // If we found a response and settle period has passed, return it
        if let Some(first_at) = first_response_at {
            if now - first_at > settle_duration_ms && !latest_text.is_empty() {
                return Ok(latest_text);
            }
        }

        thread::sleep(poll_interval);
        let history = gateway_call(
            "chat.history",
            &json!({ "sessionKey": session.clone(), "limit": 10 }),
        )?;
        if let Some((assistant_timestamp, assistant_text)) = latest_assistant_entry(&history) {
            if assistant_timestamp > baseline_timestamp
                || (assistant_timestamp == baseline_timestamp && assistant_text != baseline_text)
            {
                // Found a new response - track when we first saw one
                if first_response_at.is_none() {
                    first_response_at = Some(now);
                }
                // Always update to the latest text
                latest_text = assistant_text;
            }
        }
    }

    // If we captured any response during polling, return it
    if !latest_text.is_empty() {
        return Ok(latest_text);
    }

    // Final check
    let latest_history = gateway_call(
        "chat.history",
        &json!({ "sessionKey": session, "limit": 1 }),
    )?;
    if let Some((assistant_timestamp, assistant_text)) = latest_assistant_entry(&latest_history) {
        if assistant_timestamp > baseline_timestamp
            || (assistant_timestamp == baseline_timestamp && assistant_text != baseline_text)
        {
            return Ok(assistant_text);
        }
    }

    Err("Timed out waiting for OpenClaw response.".to_string())
}

pub(crate) fn expand_tilde(path: &str) -> Result<PathBuf, String> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|error| error.to_string())?;
        return Ok(Path::new(&home).join(rest));
    }

    Ok(PathBuf::from(path))
}

pub(crate) fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

#[derive(Serialize)]
struct SlashCommand {
    name: String,
    desc: String,
    category: String,
}

/// Extract description from markdown frontmatter or first paragraph
fn extract_command_description(content: &str) -> String {
    let lines: Vec<&str> = content.lines().collect();
    let mut in_frontmatter = false;
    let mut frontmatter_count = 0;

    // Check for frontmatter description
    for line in &lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            frontmatter_count += 1;
            in_frontmatter = frontmatter_count == 1;
            if frontmatter_count == 2 {
                break;
            }
            continue;
        }

        if in_frontmatter && trimmed.starts_with("description:") {
            let desc = trimmed
                .trim_start_matches("description:")
                .trim()
                .trim_matches('"')
                .trim_matches('\'');
            return truncate_description(desc);
        }
    }

    // Fallback: first non-empty, non-heading line after frontmatter
    let mut past_frontmatter = frontmatter_count == 0;
    for line in &lines {
        let trimmed = line.trim();
        if trimmed == "---" {
            frontmatter_count += 1;
            if frontmatter_count == 2 {
                past_frontmatter = true;
            }
            continue;
        }

        if past_frontmatter && !trimmed.is_empty() && !trimmed.starts_with('#') {
            return truncate_description(trimmed);
        }
    }

    "No description".to_string()
}

fn truncate_description(desc: &str) -> String {
    // Get first sentence
    let first_sentence = desc
        .split(|c| c == '.' || c == '!' || c == '?')
        .next()
        .unwrap_or(desc)
        .trim();

    if first_sentence.len() > 80 {
        format!("{}...", &first_sentence[..77])
    } else {
        first_sentence.to_string()
    }
}

#[tauri::command]
fn list_slash_commands() -> Result<Vec<SlashCommand>, String> {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let mut commands: Vec<SlashCommand> = Vec::new();
    let mut seen_names: std::collections::HashSet<String> = std::collections::HashSet::new();

    // 1. Load from ~/.config/opencode/opencode.json
    let opencode_config = Path::new(&home).join(".config/opencode/opencode.json");
    if opencode_config.exists() {
        if let Ok(content) = fs::read_to_string(&opencode_config) {
            if let Ok(config) = serde_json::from_str::<Value>(&content) {
                if let Some(cmds) = config.get("command").and_then(|c| c.as_object()) {
                    for (key, value) in cmds {
                        // Only include commands with template or prompt
                        let has_template =
                            value.get("template").is_some() || value.get("prompt").is_some();
                        if !has_template {
                            continue;
                        }

                        let name = key.trim_start_matches("workflows:").to_string();
                        if seen_names.contains(&name) {
                            continue;
                        }
                        seen_names.insert(name.clone());

                        let desc = value
                            .get("description")
                            .or_else(|| value.get("desc"))
                            .and_then(|d| d.as_str())
                            .map(|s| truncate_description(s))
                            .unwrap_or_else(|| "Workflow command".to_string());

                        commands.push(SlashCommand {
                            name,
                            desc,
                            category: "workflow".to_string(),
                        });
                    }
                }
            }
        }
    }

    // 2. Load from ~/.claude/plugins/cache/every-marketplace/compound-engineering/*/commands/
    let plugins_base =
        Path::new(&home).join(".claude/plugins/cache/every-marketplace/compound-engineering");

    if plugins_base.exists() {
        if let Ok(versions) = fs::read_dir(&plugins_base) {
            for version_entry in versions.flatten() {
                let commands_dir = version_entry.path().join("commands");
                if !commands_dir.exists() {
                    continue;
                }

                // Read top-level command files
                if let Ok(entries) = fs::read_dir(&commands_dir) {
                    for entry in entries.flatten() {
                        let path = entry.path();

                        // Handle workflows subdirectory
                        if path.is_dir()
                            && path.file_name().map(|n| n == "workflows").unwrap_or(false)
                        {
                            if let Ok(workflow_entries) = fs::read_dir(&path) {
                                for wf_entry in workflow_entries.flatten() {
                                    let wf_path = wf_entry.path();
                                    if wf_path.extension().map(|e| e == "md").unwrap_or(false) {
                                        if let Some(name) =
                                            wf_path.file_stem().and_then(|n| n.to_str())
                                        {
                                            if seen_names.contains(name) {
                                                continue;
                                            }
                                            seen_names.insert(name.to_string());

                                            let desc = fs::read_to_string(&wf_path)
                                                .map(|c| extract_command_description(&c))
                                                .unwrap_or_else(|_| "Workflow command".to_string());

                                            commands.push(SlashCommand {
                                                name: name.to_string(),
                                                desc,
                                                category: "workflow".to_string(),
                                            });
                                        }
                                    }
                                }
                            }
                            continue;
                        }

                        // Handle regular command files
                        if path.extension().map(|e| e == "md").unwrap_or(false) {
                            if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                                if seen_names.contains(name) {
                                    continue;
                                }
                                seen_names.insert(name.to_string());

                                let desc = fs::read_to_string(&path)
                                    .map(|c| extract_command_description(&c))
                                    .unwrap_or_else(|_| "Plugin command".to_string());

                                commands.push(SlashCommand {
                                    name: name.to_string(),
                                    desc,
                                    category: "plugin".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    // 3. Load user commands from ~/.claude/commands/
    let user_commands_dir = Path::new(&home).join(".claude/commands");
    if user_commands_dir.exists() {
        if let Ok(entries) = fs::read_dir(&user_commands_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.extension().map(|e| e == "md").unwrap_or(false) {
                    continue;
                }

                if let Some(name) = path.file_stem().and_then(|n| n.to_str()) {
                    if seen_names.contains(name) {
                        continue;
                    }
                    seen_names.insert(name.to_string());

                    let desc = fs::read_to_string(&path)
                        .map(|c| extract_command_description(&c))
                        .unwrap_or_else(|_| "User command".to_string());

                    commands.push(SlashCommand {
                        name: name.to_string(),
                        desc,
                        category: "workflow".to_string(),
                    });
                }
            }
        }
    }

    // 4. Load skills from ~/.config/opencode/skills/
    let skills_dir = Path::new(&home).join(".config/opencode/skills");
    if skills_dir.exists() {
        if let Ok(entries) = fs::read_dir(&skills_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }

                if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                    if seen_names.contains(name) {
                        continue;
                    }

                    let skill_md = path.join("SKILL.md");
                    if skill_md.exists() {
                        seen_names.insert(name.to_string());

                        let desc = fs::read_to_string(&skill_md)
                            .map(|c| extract_command_description(&c))
                            .unwrap_or_else(|_| "Skill".to_string());

                        commands.push(SlashCommand {
                            name: name.to_string(),
                            desc,
                            category: "skill".to_string(),
                        });
                    }
                }
            }
        }
    }

    // 5. Add built-in session commands
    if !seen_names.contains("status") {
        commands.push(SlashCommand {
            name: "status".to_string(),
            desc: "Show session status".to_string(),
            category: "session".to_string(),
        });
    }
    if !seen_names.contains("new") {
        commands.push(SlashCommand {
            name: "new".to_string(),
            desc: "Start new session".to_string(),
            category: "session".to_string(),
        });
    }

    // Sort by category then name
    commands.sort_by(|a, b| {
        let cat_order = |cat: &str| match cat {
            "workflow" => 0,
            "plugin" => 1,
            "skill" => 2,
            "session" => 3,
            _ => 4,
        };
        cat_order(&a.category)
            .cmp(&cat_order(&b.category))
            .then_with(|| a.name.cmp(&b.name))
    });

    Ok(commands)
}

// =============================================================================
// Phase 2 Tauri commands
// =============================================================================

/// Ensure `.clawchestra/` directory exists in the given project path.
/// Returns the full path to the directory.
#[tauri::command]
fn ensure_clawchestra_dir(project_path: String) -> Result<String, String> {
    let dir = Path::new(&project_path).join(".clawchestra");
    fs::create_dir_all(&dir).map_err(|e| {
        format!(
            "Failed to create .clawchestra directory at {}: {}",
            dir.display(),
            e
        )
    })?;
    Ok(dir.to_string_lossy().to_string())
}

/// Write state.json atomically for a project.
///
/// 1. Acquires file lock on `.clawchestra/state.json.lock`
/// 2. Serializes to pretty-printed JSON
/// 3. Writes atomically (`.tmp` + rename)
/// 4. Computes and stores SHA-256 hash BEFORE releasing lock
/// 5. Read-verify: parses file back to ensure correctness
#[tauri::command]
async fn write_state_json(
    project_path: String,
    state_data: state::StateJson,
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<(), String> {
    let clawchestra_dir = Path::new(&project_path).join(".clawchestra");
    fs::create_dir_all(&clawchestra_dir).map_err(|e| {
        format!(
            "Failed to create .clawchestra directory at {}: {}",
            clawchestra_dir.display(),
            e
        )
    })?;

    let state_json_path = clawchestra_dir.join("state.json");
    let lock_path = clawchestra_dir.join("state.json.lock");

    // Acquire lock
    let _guard = acquire_mutation_lock_at(
        &lock_path,
        Duration::from_millis(locking::MUTATION_LOCK_TIMEOUT_MS),
        Duration::from_secs(60),
    )?;

    // Serialize to pretty JSON
    let content = serde_json::to_string_pretty(&state_data)
        .map_err(|e| format!("Failed to serialize state.json: {}", e))?;

    // Compute SHA-256 BEFORE writing (so we store the expected hash)
    let hash = {
        let mut hasher = Sha256::new();
        hasher.update(content.as_bytes());
        format!("{:x}", hasher.finalize())
    };

    // Pre-register hash BEFORE file becomes visible to watcher (closes TOCTOU gap)
    let project_id = state_data.project.id.clone();
    let pid = ProjectId(project_id.clone());
    {
        let mut guard = app_state.lock().await;
        guard.content_hashes.insert(pid.clone(), hash.clone());
    }

    // Atomic write: .tmp + rename
    let temp_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let temp_path = state_json_path.with_file_name(format!("state.json.tmp-{}", temp_suffix));
    if let Err(e) = fs::write(&temp_path, &content) {
        // Remove pre-registered hash on failure
        let mut guard = app_state.lock().await;
        guard.content_hashes.remove(&pid);
        return Err(format!(
            "Failed to write temp state.json at {}: {}",
            temp_path.display(),
            e
        ));
    }
    if let Err(e) = fs::rename(&temp_path, &state_json_path) {
        let _ = fs::remove_file(&temp_path);
        // Remove pre-registered hash on failure
        let mut guard = app_state.lock().await;
        guard.content_hashes.remove(&pid);
        return Err(format!(
            "Failed to rename temp state.json to {}: {}",
            state_json_path.display(),
            e
        ));
    }

    // Read-verify: parse back to ensure correctness
    let verify_content = fs::read_to_string(&state_json_path).map_err(|e| {
        format!(
            "Read-verify failed for {}: {}",
            state_json_path.display(),
            e
        )
    })?;
    let _: state::StateJson = serde_json::from_str(&verify_content).map_err(|e| {
        format!(
            "Read-verify parse failed for {}: {}. File may be corrupt.",
            state_json_path.display(),
            e
        )
    })?;

    tracing::info!(
        "Wrote state.json for project '{}' (hash: {})",
        project_id,
        &hash[..12]
    );

    Ok(())
    // Lock is released here when _guard drops
}

/// Response type for get_all_projects.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSummary {
    id: String,
    project_path: String,
    title: String,
    status: String,
    description: String,
    parent_id: Option<String>,
    tags: Vec<String>,
    roadmap_item_count: usize,
}

/// Get all projects from the in-memory DB.
#[tauri::command]
async fn get_all_projects(
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<Vec<ProjectSummary>, String> {
    let guard = app_state.lock().await;
    let projects: Vec<ProjectSummary> = guard
        .db
        .projects
        .iter()
        .map(|(id, entry)| ProjectSummary {
            id: id.clone(),
            project_path: entry.project_path.clone(),
            title: entry.project.title.clone(),
            status: entry.project.status.clone(),
            description: entry.project.description.clone(),
            parent_id: entry.project.parent_id.clone(),
            tags: entry.project.tags.clone(),
            roadmap_item_count: entry.roadmap_items.len(),
        })
        .collect();
    Ok(projects)
}

/// Response type for get_project — full project data with roadmap items.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectDetail {
    id: String,
    project_path: String,
    project: state::DbProjectData,
    roadmap_items: Vec<state::DbRoadmapItem>,
}

/// Get a single project's full data from the in-memory DB.
#[tauri::command]
async fn get_project(
    project_id: String,
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<ProjectDetail, String> {
    let guard = app_state.lock().await;
    let entry = guard
        .db
        .projects
        .get(&project_id)
        .ok_or_else(|| format!("Project '{}' not found", project_id))?;

    let mut items: Vec<state::DbRoadmapItem> = entry.roadmap_items.values().cloned().collect();
    items.sort_by_key(|item| item.priority);

    Ok(ProjectDetail {
        id: project_id,
        project_path: entry.project_path.clone(),
        project: entry.project.clone(),
        roadmap_items: items,
    })
}

// =============================================================================
// Phase 3 Migration commands
// =============================================================================

/// Response type for migration status of a single project.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationStatus {
    project_id: String,
    project_path: String,
    step: String,
    uses_legacy_filename: bool,
}

/// Get the derived migration status for all known projects.
#[tauri::command]
async fn get_migration_status(
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<Vec<MigrationStatus>, String> {
    let guard = app_state.lock().await;
    let mut statuses = Vec::new();

    for (id, entry) in &guard.db.projects {
        let project_dir = Path::new(&entry.project_path);
        let step = migration::derive_migration_step(project_dir, id, &guard);
        statuses.push(MigrationStatus {
            project_id: id.clone(),
            project_path: entry.project_path.clone(),
            step: format!("{:?}", step),
            uses_legacy_filename: migration::uses_legacy_filename(project_dir),
        });
    }

    Ok(statuses)
}

/// Run migration for a single project. Returns the migration result.
#[tauri::command]
async fn run_migration(
    project_id: String,
    project_path: String,
    project_title: String,
    app_state: tauri::State<'_, SharedAppState>,
    flush_handle: tauri::State<'_, SharedFlushHandle>,
) -> Result<migration::MigrationResult, String> {
    let project_dir = PathBuf::from(&project_path);
    if !project_dir.is_absolute() {
        return Err("project_path must be absolute".to_string());
    }
    let result = {
        let mut guard = app_state.lock().await;
        migration::run_project_migration(
            &mut guard,
            &project_id,
            &project_dir,
            &project_title,
        )
    };

    // Schedule DB flush after migration
    flush_handle.schedule_flush();

    Ok(result)
}

/// Run migration for all tracked projects.
#[tauri::command]
async fn run_all_migrations(
    app_state: tauri::State<'_, SharedAppState>,
    flush_handle: tauri::State<'_, SharedFlushHandle>,
    app_handle: tauri::AppHandle,
) -> Result<Vec<migration::MigrationResult>, String> {
    // Gather projects that need migration
    let projects_to_migrate: Vec<(String, String, String)> = {
        let guard = app_state.lock().await;
        guard
            .db
            .projects
            .iter()
            .map(|(id, entry)| {
                (
                    id.clone(),
                    entry.project_path.clone(),
                    entry.project.title.clone(),
                )
            })
            .collect()
    };

    let total = projects_to_migrate.len();
    let mut results = Vec::new();

    for (i, (project_id, project_path, project_title)) in
        projects_to_migrate.into_iter().enumerate()
    {
        let project_dir = PathBuf::from(&project_path);
        let result = {
            let mut guard = app_state.lock().await;
            migration::run_project_migration(
                &mut guard,
                &project_id,
                &project_dir,
                &project_title,
            )
        };

        // Emit progress event
        let _ = app_handle.emit(
            "migration-progress",
            serde_json::json!({
                "projectId": project_id,
                "completed": i + 1,
                "total": total,
                "error": result.error,
            }),
        );

        results.push(result);
    }

    // Schedule DB flush after all migrations
    flush_handle.schedule_flush();

    Ok(results)
}

/// Rename PROJECT.md -> CLAWCHESTRA.md for a single project (3.8 auto-rename offer).
#[tauri::command]
fn rename_project_md(project_path: String) -> Result<bool, String> {
    let project_dir = PathBuf::from(&project_path);
    if !project_dir.is_absolute() {
        return Err("project_path must be absolute".to_string());
    }
    migration::rename_project_file(&project_dir)
}

/// Get the derived migration step for a single project directory.
/// Used for projects not yet in the DB (e.g., newly scanned).
#[tauri::command]
async fn get_project_migration_step(
    project_id: String,
    project_path: String,
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<String, String> {
    let project_dir = PathBuf::from(&project_path);
    let guard = app_state.lock().await;
    let step = migration::derive_migration_step(&project_dir, &project_id, &guard);
    Ok(format!("{:?}", step))
}

// =============================================================================
// Phase 6: OpenClaw Data Endpoint & Sync
// =============================================================================

/// Install the Clawchestra data endpoint extension into an OpenClaw installation.
#[tauri::command]
fn install_openclaw_extension(openclaw_path: String) -> Result<(), String> {
    sync::install_extension(&openclaw_path)
}

/// Get the installed extension version (or null if not installed).
#[tauri::command]
fn get_openclaw_extension_version(openclaw_path: String) -> Option<String> {
    sync::get_installed_extension_version(&openclaw_path)
}

/// Check if the installed extension is stale and needs updating.
#[tauri::command]
fn is_openclaw_extension_stale(openclaw_path: String) -> bool {
    sync::is_extension_stale(&openclaw_path)
}

/// Generate the extension file content (for display/manual install).
#[tauri::command]
fn get_extension_content() -> String {
    sync::generate_extension_content()
}

/// Perform local sync on launch. Returns the SyncResult.
/// Updates the in-memory AppState with the merged DB.
#[tauri::command]
async fn sync_local_launch(
    app_state: tauri::State<'_, SharedAppState>,
    flush_handle: tauri::State<'_, SharedFlushHandle>,
) -> Result<sync::SyncResult, String> {
    // Clone data under lock, capture HLC for CAS check
    let (db_snapshot, client_uuid, snapshot_hlc) = {
        let guard = app_state.lock().await;
        (guard.db.clone(), guard.client_uuid.clone(), guard.db.hlc_counter)
    };

    // sync_local_on_launch reads/writes files — runs outside the lock
    let (merged, result) = sync::sync_local_on_launch(&db_snapshot, &client_uuid);

    // Re-acquire lock; CAS check for concurrent writes
    let mut guard = app_state.lock().await;
    if guard.db.hlc_counter > snapshot_hlc {
        // Watcher applied changes while we were syncing — merge rather than overwrite
        let (mut reconciled, _, _) = sync::merge_db_json(&guard.db, &merged, &guard.client_uuid);
        sync::fix_post_merge_invariants_pub(&mut reconciled);
        guard.db = reconciled;
    } else {
        guard.db = merged;
    }
    guard.hlc_counter = guard.db.hlc_counter;
    guard.dirty = true;
    drop(guard);
    flush_handle.schedule_flush();

    Ok(result)
}

/// Merge a remote DB (fetched by TypeScript via HTTP) with the local DB.
/// Returns the merged DB as JSON (for TypeScript to PUT back to remote) and a SyncResult.
#[tauri::command]
async fn sync_merge_remote(
    remote_db_json: String,
    app_state: tauri::State<'_, SharedAppState>,
    flush_handle: tauri::State<'_, SharedFlushHandle>,
) -> Result<(String, sync::SyncResult), String> {
    let remote_db: state::DbJson =
        serde_json::from_str(&remote_db_json).map_err(|e| format!("Invalid remote DB JSON: {}", e))?;

    // Clone data under lock, capture HLC for CAS check
    let (db_snapshot, client_uuid, snapshot_hlc) = {
        let guard = app_state.lock().await;
        (guard.db.clone(), guard.client_uuid.clone(), guard.db.hlc_counter)
    };

    // merge_remote_db does merge + flush_db_json — runs outside the lock
    let (merged, result) = sync::merge_remote_db(&db_snapshot, &remote_db, &client_uuid);

    // Re-acquire lock; CAS check for concurrent writes
    let mut guard = app_state.lock().await;
    if guard.db.hlc_counter > snapshot_hlc {
        let (mut reconciled, _, _) = sync::merge_db_json(&guard.db, &merged, &guard.client_uuid);
        sync::fix_post_merge_invariants_pub(&mut reconciled);
        guard.db = reconciled;
    } else {
        guard.db = merged;
    }
    guard.hlc_counter = guard.db.hlc_counter;
    guard.dirty = true;

    // Serialize the final DB for TypeScript to PUT back
    let merged_json = serde_json::to_string(&guard.db)
        .map_err(|e| format!("Failed to serialize merged DB: {}", e))?;
    drop(guard);
    flush_handle.schedule_flush();

    Ok((merged_json, result))
}

/// Flush DB state to the local OpenClaw data directory.
/// Used for sync-on-close in local mode.
#[tauri::command]
async fn sync_local_close(
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<sync::SyncResult, String> {
    let guard = app_state.lock().await;
    Ok(sync::sync_local_on_close(&guard.db))
}

/// Get the current DB as a JSON string (for TypeScript to push to remote on close).
#[tauri::command]
async fn get_db_json_for_sync(
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<String, String> {
    let guard = app_state.lock().await;
    serde_json::to_string(&guard.db).map_err(|e| format!("Failed to serialize DB: {}", e))
}

/// Initialize client identity and write system context.
/// Called once during app startup after settings are loaded.
#[tauri::command]
async fn ensure_sync_identity(
    app_state: tauri::State<'_, SharedAppState>,
    flush_handle: tauri::State<'_, SharedFlushHandle>,
) -> Result<(), String> {
    let mut guard = app_state.lock().await;

    // Check if we already have a client registered
    let needs_identity = guard.db.clients.is_empty();

    if needs_identity {
        let (uuid, hostname) = sync::ensure_client_identity();
        let platform = sync::get_platform();

        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        guard.db.clients.insert(
            uuid.clone(),
            state::DbClient {
                hostname: hostname.clone(),
                platform: platform.clone(),
                last_seen_at: now_ms,
            },
        );
        guard.client_uuid = uuid.clone();
        guard.mark_dirty();

        // Write system context (drop lock before I/O)
        let uuid_clone = uuid;
        let hostname_clone = hostname;
        let platform_clone = platform;
        drop(guard);
        flush_handle.schedule_flush();

        sync::write_system_context(&uuid_clone, &hostname_clone, &platform_clone)?;
    } else {
        // Update last_seen_at for existing client
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        // Update all known clients' last_seen_at (we are the local client, pick first)
        if let Some(client) = guard.db.clients.values_mut().next() {
            client.last_seen_at = now_ms;
        }
        guard.mark_dirty();

        // Rewrite system context with current info
        let (uuid, client) = guard
            .db
            .clients
            .iter()
            .next()
            .map(|(k, v)| (k.clone(), v.clone()))
            .ok_or_else(|| "No client identity found".to_string())?;
        drop(guard);
        flush_handle.schedule_flush();

        sync::write_system_context(&uuid, &client.hostname, &client.platform)?;
    }

    Ok(())
}

/// Write the system-context.md file for OpenClaw.
#[tauri::command]
async fn write_openclaw_system_context(
    client_uuid: String,
    hostname: String,
    platform: String,
) -> Result<(), String> {
    sync::write_system_context(&client_uuid, &hostname, &platform)
}

// =============================================================================
// Phase 7: Structured Logging & Error Reporting
// =============================================================================

/// Initialize the tracing subscriber with JSON file output + stdout (Phase 7.1).
///
/// Writes structured JSON log entries to `~/.clawchestra/app.log`.
/// Rotates to `app.log.1` when the file exceeds 1MB.
/// Also outputs human-readable logs to stdout for development.
fn init_tracing() {
    let log_dir = dirs::home_dir()
        .map(|h| h.join(".clawchestra"))
        .unwrap_or_else(|| PathBuf::from(".clawchestra"));

    // Ensure log directory exists
    let _ = fs::create_dir_all(&log_dir);

    // Rotate if existing log exceeds 1MB
    let log_file_path = log_dir.join("app.log");
    if log_file_path.exists() {
        if let Ok(meta) = fs::metadata(&log_file_path) {
            if meta.len() > 1_048_576 {
                let rotated = log_dir.join("app.log.1");
                let _ = fs::rename(&log_file_path, &rotated);
            }
        }
    }

    // File layer: JSON-structured output to app.log
    let log_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path);

    match log_file {
        Ok(file) => {
            let file_layer = tracing_subscriber::fmt::layer()
                .json()
                .with_writer(std::sync::Mutex::new(file))
                .with_target(true)
                .with_thread_ids(false)
                .with_file(false)
                .with_line_number(false);

            // Stdout layer: human-readable for development
            let stdout_layer = tracing_subscriber::fmt::layer()
                .with_target(false)
                .compact();

            let subscriber = tracing_subscriber::registry()
                .with(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
                )
                .with(file_layer)
                .with(stdout_layer);

            // If another subscriber is already set (e.g. in tests), this is a no-op
            let _ = tracing::subscriber::set_global_default(subscriber);
        }
        Err(e) => {
            // Fallback: stdout only if file cannot be opened
            let stdout_layer = tracing_subscriber::fmt::layer()
                .with_target(false)
                .compact();

            let subscriber = tracing_subscriber::registry()
                .with(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
                )
                .with(stdout_layer);

            let _ = tracing::subscriber::set_global_default(subscriber);
            tracing::warn!("Could not open log file at {}: {}", log_file_path.display(), e);
        }
    }

    tracing::info!("Clawchestra logging initialized (log file: {})", log_file_path.display());
}

/// Export debug info for troubleshooting (Phase 7.2).
///
/// Collects migration state, recent validation results, sync config,
/// app version, OS, and client UUID into a formatted string.
#[tauri::command]
async fn export_debug_info(
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<String, String> {
    let guard = app_state.lock().await;
    let mut lines: Vec<String> = Vec::new();

    // Header
    lines.push("=== Clawchestra Debug Export ===".to_string());
    lines.push(format!("Timestamp: {}", chrono::Local::now().to_rfc3339()));
    lines.push(format!("App Version: {} (commit: {})", env!("CARGO_PKG_VERSION"), BUILD_COMMIT));
    lines.push(format!("OS: {} {}", std::env::consts::OS, std::env::consts::ARCH));
    lines.push(format!("Client UUID: {}", guard.client_uuid));
    lines.push(String::new());

    // Migration state for all projects
    lines.push("--- Migration State ---".to_string());
    if guard.db.projects.is_empty() {
        lines.push("  (no projects)".to_string());
    } else {
        for (id, entry) in &guard.db.projects {
            let project_dir = Path::new(&entry.project_path);
            let step = migration::derive_migration_step(project_dir, id, &guard);
            lines.push(format!("  {} ({}): {:?}", id, entry.project_path, step));
        }
    }
    lines.push(String::new());

    // Last 20 state history entries (validation results)
    lines.push("--- Recent State History (last 20 per project) ---".to_string());
    if guard.state_history.is_empty() {
        lines.push("  (no history)".to_string());
    } else {
        for (project_id, history) in &guard.state_history {
            lines.push(format!("  Project: {}", project_id));
            let start = if history.len() > 20 { history.len() - 20 } else { 0 };
            for entry in history.iter().skip(start) {
                lines.push(format!(
                    "    [{}] source={:?} fields={:?}",
                    entry.timestamp, entry.source, entry.changed_fields
                ));
            }
        }
    }
    lines.push(String::new());

    // Validation rejections (Phase 7.3)
    lines.push("--- Validation Rejections (last 20 per project) ---".to_string());
    if guard.validation_rejections.is_empty() {
        lines.push("  (no rejections)".to_string());
    } else {
        for (project_id, rejections) in &guard.validation_rejections {
            lines.push(format!("  Project: {}", project_id));
            for rejection in rejections.iter() {
                lines.push(format!(
                    "    [{}] fields={:?} reason={} resolved={}",
                    rejection.timestamp,
                    rejection.rejected_fields,
                    rejection.reason,
                    rejection.resolved
                ));
            }
        }
    }
    lines.push(String::new());

    // Sync config
    lines.push("--- Sync Config ---".to_string());
    lines.push(format!("  HLC counter: {}", guard.hlc_counter));
    lines.push(format!("  DB dirty: {}", guard.dirty));
    lines.push(format!("  Clients registered: {}", guard.db.clients.len()));
    for (uuid, client) in &guard.db.clients {
        lines.push(format!(
            "    {} hostname={} platform={} last_seen={}",
            uuid, client.hostname, client.platform, client.last_seen_at
        ));
    }
    lines.push(String::new());

    // File watcher status
    lines.push("--- File Watcher ---".to_string());
    lines.push("  (event tracking not yet implemented — watcher is active if started at boot)".to_string());
    lines.push(String::new());

    lines.push("=== End Debug Export ===".to_string());

    Ok(lines.join("\n"))
}

/// Get the last 20 validation rejection events per project (Phase 7.3).
#[tauri::command]
async fn get_validation_history(
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<HashMap<String, Vec<ValidationRejection>>, String> {
    let guard = app_state.lock().await;
    let mut result: HashMap<String, Vec<ValidationRejection>> = HashMap::new();

    for (project_id, rejections) in &guard.validation_rejections {
        result.insert(
            project_id.as_str().to_string(),
            rejections.iter().cloned().collect(),
        );
    }

    Ok(result)
}

/// Mark a validation rejection event as resolved (Phase 7.3).
///
/// Finds the rejection at the given timestamp for the given project and marks it resolved.
/// The rejection remains in history but is flagged as acknowledged.
#[tauri::command]
async fn mark_rejection_resolved(
    project_id: String,
    timestamp: u64,
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<bool, String> {
    let mut guard = app_state.lock().await;
    let pid = ProjectId(project_id);

    if let Some(rejections) = guard.validation_rejections.get_mut(&pid) {
        for rejection in rejections.iter_mut() {
            if rejection.timestamp == timestamp {
                rejection.resolved = true;
                return Ok(true);
            }
        }
    }

    Ok(false) // No matching rejection found
}

// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // --- Phase 7.1: Structured logging setup ---
    init_tracing();

    // --- Startup sequence (Phase 2.0) ---
    // 1. Load settings
    let settings = load_dashboard_settings().unwrap_or_else(|_| default_settings());

    // 2. Load db.json into AppState
    let db = db_persistence::load_db_json();
    let mut app_state = AppState::default();
    app_state.db = db;
    app_state.hlc_counter = app_state.db.hlc_counter;
    app_state.history_buffer_size = settings.state_history_buffer_size;

    // 2.1 Ensure client identity (Phase 6.4)
    if app_state.db.clients.is_empty() {
        let (uuid, hostname) = sync::ensure_client_identity();
        let platform = sync::get_platform();
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        app_state.client_uuid = uuid.clone();
        app_state.db.clients.insert(
            uuid.clone(),
            state::DbClient {
                hostname: hostname.clone(),
                platform: platform.clone(),
                last_seen_at: now_ms,
            },
        );
        app_state.dirty = true;
        // Write system context (best-effort)
        let _ = sync::write_system_context(&uuid, &hostname, &platform);
    } else {
        // Client already registered — load existing UUID
        app_state.client_uuid = app_state
            .db
            .clients
            .keys()
            .next()
            .cloned()
            .unwrap_or_default();
    }

    // Note: Launch sync is handled by the sync_local_launch Tauri command,
    // invoked by TypeScript after the app is ready. Not duplicated here.

    let shared_state: SharedAppState = Arc::new(tokio::sync::Mutex::new(app_state));

    // 3. Start debounced DB flush
    let flush_handle: SharedFlushHandle = Arc::new(
        db_persistence::DbFlushHandle::start(shared_state.clone()),
    );

    // Create clones for the closures that need them
    let state_for_setup = shared_state.clone();
    let state_for_events = shared_state.clone();
    let shared_state_for_ready = shared_state.clone();
    let flush_for_setup = flush_handle.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_fs::init())
        .manage(shared_state.clone())
        .manage(flush_handle.clone())
        .setup(move |app| {
            migrate_data_directories();
            run_migrations();

            // 4. Start file watcher (Phase 2.3)
            let scan_paths = settings.scan_paths.clone();
            let watcher_state = state_for_setup.clone();
            let watcher_flush = flush_for_setup.clone();
            let app_handle = app.handle().clone();

            // Start watcher in a thread so setup doesn't block
            std::thread::spawn(move || {
                match watcher::start_watching(
                    app_handle.clone(),
                    watcher_state,
                    watcher_flush,
                    scan_paths,
                ) {
                    Ok(_watcher) => {
                        tracing::info!("File watcher started");
                        // Keep the watcher alive — it will be dropped when this thread exits
                        // We park the thread to keep the watcher alive for the app lifetime
                        std::thread::park();
                    }
                    Err(e) => {
                        tracing::warn!("Failed to start file watcher: {}", e);
                        let _ = app_handle.emit(
                            "watcher-error",
                            serde_json::json!({
                                "error": format!("File watcher failed to start: {}. Changes to state.json files will not be detected automatically.", e)
                            }),
                        );
                    }
                }
            });

            // 5. Emit clawchestra-ready event
            let ready_handle = app.handle().clone();
            let ready_state = shared_state_for_ready.clone();
            tauri::async_runtime::spawn(async move {
                // Small delay to let frontend mount event listeners
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                let project_count = {
                    let guard = ready_state.lock().await;
                    guard.db.projects.len()
                };
                let _ = ready_handle.emit(
                    "clawchestra-ready",
                    serde_json::json!({
                        "projectCount": project_count,
                        "migratedCount": 0,
                        "syncStatus": "ok"
                    }),
                );
            });

            Ok(())
        })
        .on_window_event(move |_window, event| {
            // Crash-safe flush: flush db.json on window close/destroy + sync-on-close (Phase 6.6)
            match event {
                tauri::WindowEvent::CloseRequested { .. }
                | tauri::WindowEvent::Destroyed => {
                    // Synchronous flush — block with timeout to prevent deadlock
                    // if another async task holds the mutex
                    let state_for_flush = state_for_events.clone();
                    let flush_result = tauri::async_runtime::block_on(async {
                        match tokio::time::timeout(
                            std::time::Duration::from_secs(3),
                            db_persistence::flush_if_dirty(&state_for_flush),
                        )
                        .await
                        {
                            Ok(result) => result,
                            Err(_) => {
                                tracing::warn!("Crash-safe flush timed out after 3s — data may not be persisted");
                                Err("Flush timed out".to_string())
                            }
                        }
                    });
                    match flush_result {
                        Ok(()) => tracing::info!("Crash-safe db.json flush completed on window close"),
                        Err(e) => tracing::warn!("Crash-safe flush failed on window close: {}", e),
                    }

                    // Sync-on-close: write to OpenClaw data directory (local mode only,
                    // remote mode is handled by TypeScript with a 3s timeout)
                    let state_for_sync = state_for_flush;
                    let sync_result = tauri::async_runtime::block_on(async {
                        match tokio::time::timeout(
                            std::time::Duration::from_secs(3),
                            async {
                                let guard = state_for_sync.lock().await;
                                sync::sync_local_on_close(&guard.db)
                            },
                        )
                        .await
                        {
                            Ok(result) => result,
                            Err(_) => sync::SyncResult {
                                success: false,
                                message: "Sync-on-close timed out after 3s".to_string(),
                                warnings: vec![],
                                fields_from_remote: 0,
                                fields_from_local: 0,
                            },
                        }
                    });
                    if sync_result.success {
                        tracing::info!("Sync-on-close: {}", sync_result.message);
                    } else {
                        tracing::warn!("Sync-on-close failed: {}", sync_result.message);
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_dashboard_settings,
            update_dashboard_settings,
            scan_projects,
            read_file,
            write_file,
            delete_file,
            remove_path,
            resolve_path,
            path_exists,
            create_directory,
            pick_folder,
            get_openclaw_gateway_config,
            openclaw_ping,
            openclaw_chat,
            // Git commands (commands/git.rs)
            commands::git::probe_repo,
            commands::git::get_git_status,
            commands::git::git_fetch,
            commands::git::git_get_branch_states,
            commands::git::git_commit,
            commands::git::git_push,
            commands::git::git_sync_lock_acquire,
            commands::git::git_sync_lock_release,
            commands::git::git_checkout_branch,
            commands::git::git_stash_push,
            commands::git::git_pop_stash,
            commands::git::git_cherry_pick_commit,
            commands::git::git_abort_cherry_pick,
            commands::git::git_pull_current,
            commands::git::git_get_conflict_context,
            commands::git::git_apply_conflict_resolution,
            commands::git::git_validate_branch_sync_resume,
            commands::git::git_init_repo,
            commands::git::git_read_file_at_ref,
            // Update commands (commands/update.rs)
            commands::update::check_for_update,
            commands::update::get_app_update_lock_state,
            commands::update::run_app_update,
            // Slash commands
            list_slash_commands,
            // Chat commands (commands/chat.rs)
            commands::chat::chat_messages_load,
            commands::chat::chat_message_save,
            commands::chat::chat_messages_clear,
            commands::chat::chat_messages_count,
            commands::chat::chat_pending_turn_save,
            commands::chat::chat_pending_turn_remove,
            commands::chat::chat_pending_turns_load,
            commands::chat::chat_flush,
            commands::chat::chat_recovery_cursor_get,
            commands::chat::chat_recovery_cursor_advance,
            commands::chat::chat_recovery_cursor_clear,
            // Phase 2 commands
            ensure_clawchestra_dir,
            write_state_json,
            get_all_projects,
            get_project,
            // Phase 3 migration commands
            get_migration_status,
            run_migration,
            run_all_migrations,
            rename_project_md,
            get_project_migration_step,
            // Phase 4 injection commands
            injection::inject_agent_guidance,
            // Phase 6 sync commands
            install_openclaw_extension,
            get_openclaw_extension_version,
            is_openclaw_extension_stale,
            get_extension_content,
            sync_local_launch,
            sync_merge_remote,
            sync_local_close,
            get_db_json_for_sync,
            ensure_sync_identity,
            write_openclaw_system_context,
            get_openclaw_bearer_token,
            // Phase 7 logging & debug commands
            export_debug_info,
            get_validation_history,
            mark_rejection_resolved,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod hardening_tests {
    use super::*;
    use crate::commands::git::*;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    #[test]
    fn mutation_lock_times_out_when_contended() {
        let dir = test_dir("lock-timeout");
        let lock_path = dir.join("catalog-mutation.lock");

        let guard = acquire_mutation_lock_at(
            &lock_path,
            Duration::from_millis(50),
            Duration::from_secs(60),
        )
        .expect("first lock should succeed");

        let err = acquire_mutation_lock_at(
            &lock_path,
            Duration::from_millis(80),
            Duration::from_secs(60),
        )
        .expect_err("second lock should time out");
        assert!(err.contains("mutationLocked"));

        drop(guard);
        acquire_mutation_lock_at(
            &lock_path,
            Duration::from_millis(50),
            Duration::from_secs(60),
        )
        .expect("lock should be reacquired after release");

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn stale_mutation_lock_is_recovered() {
        let dir = test_dir("lock-stale");
        let lock_path = dir.join("catalog-mutation.lock");
        fs::write(&lock_path, "stale-lock").expect("write stale lock");

        acquire_mutation_lock_at(
            &lock_path,
            Duration::from_millis(100),
            Duration::from_secs(0),
        )
        .expect("stale lock should be removed and replaced");

        let _ = fs::remove_dir_all(dir);
    }

    // -----------------------------------------------------------------------
    // categorize_dirty_file
    // -----------------------------------------------------------------------

    #[test]
    fn categorize_project_md_as_metadata() {
        assert_eq!(categorize_dirty_file("PROJECT.md"), FileCategory::Metadata);
    }

    #[test]
    fn categorize_roadmap_changelog_as_code() {
        // Post-migration: ROADMAP.md and CHANGELOG.md are no longer in DOCUMENT_FILES
        assert_eq!(categorize_dirty_file("ROADMAP.md"), FileCategory::Code);
        assert_eq!(
            categorize_dirty_file("CHANGELOG.md"),
            FileCategory::Code
        );
    }

    #[test]
    fn categorize_spec_plan_roadmap_dirs_as_documents() {
        assert_eq!(
            categorize_dirty_file("docs/specs/git-sync-spec.md"),
            FileCategory::Documents
        );
        assert_eq!(
            categorize_dirty_file("docs/plans/git-sync-plan.md"),
            FileCategory::Documents
        );
        assert_eq!(
            categorize_dirty_file("roadmap/git-sync.md"),
            FileCategory::Documents
        );
    }

    #[test]
    fn categorize_code_files() {
        assert_eq!(categorize_dirty_file("src/App.tsx"), FileCategory::Code);
        assert_eq!(categorize_dirty_file("package.json"), FileCategory::Code);
        assert_eq!(categorize_dirty_file("Cargo.toml"), FileCategory::Code);
        assert_eq!(categorize_dirty_file("README.md"), FileCategory::Code);
    }

    // -----------------------------------------------------------------------
    // categorize_all_dirty_files
    // -----------------------------------------------------------------------

    /// Helper: create a test entry with "modified" status
    fn e(path: &str) -> DirtyFileEntry {
        DirtyFileEntry {
            path: path.to_string(),
            status: "modified".to_string(),
        }
    }

    /// Helper: create a test (path, status) tuple
    fn t(path: &str) -> (String, &'static str) {
        (path.to_string(), "modified")
    }

    fn init_git_repo_with_commit(name: &str) -> (PathBuf, String) {
        let dir = test_dir(name);
        let repo_path = dir.to_string_lossy().to_string();
        run_git_capture(&repo_path, &["init"]).expect("git init");
        run_git_capture(&repo_path, &["config", "user.email", "test@example.com"]).expect("set email");
        run_git_capture(&repo_path, &["config", "user.name", "Test User"]).expect("set name");
        fs::write(dir.join("README.md"), "seed\n").expect("write file");
        run_git_capture(&repo_path, &["add", "README.md"]).expect("git add");
        run_git_capture(&repo_path, &["commit", "-m", "seed"]).expect("git commit");
        let head_output = run_git_capture(&repo_path, &["rev-parse", "--short", "HEAD"]).expect("head hash");
        (dir, head_output.stdout)
    }

    #[test]
    fn categorize_all_mixed_dirty_files() {
        let entries = vec![
            t("PROJECT.md"),
            t("ROADMAP.md"),
            t("src/App.tsx"),
            t("docs/specs/new-spec.md"),
            t("package.json"),
        ];
        let cats = categorize_all_dirty_files(entries);
        assert_eq!(cats.metadata, vec![e("PROJECT.md")]);
        assert_eq!(
            cats.documents,
            vec![e("docs/specs/new-spec.md")]
        );
        // ROADMAP.md is now categorized as code post-migration
        assert_eq!(cats.code, vec![e("ROADMAP.md"), e("src/App.tsx"), e("package.json")]);
    }

    #[test]
    fn categorize_all_empty() {
        let cats = categorize_all_dirty_files(vec![]);
        assert!(cats.metadata.is_empty());
        assert!(cats.documents.is_empty());
        assert!(cats.code.is_empty());
    }

    #[test]
    fn categorize_all_code_only() {
        let entries = vec![t("src/main.rs"), t(".gitignore")];
        let cats = categorize_all_dirty_files(entries);
        assert!(cats.metadata.is_empty());
        assert!(cats.documents.is_empty());
        assert_eq!(cats.code, vec![e("src/main.rs"), e(".gitignore")]);
    }

    #[test]
    fn categorize_handles_renames_to_document_dir() {
        let entries = vec![t("roadmap/renamed.md")];
        let cats = categorize_all_dirty_files(entries);
        assert_eq!(cats.documents, vec![e("roadmap/renamed.md")]);
    }

    // -----------------------------------------------------------------------
    // validate_commit_path
    // -----------------------------------------------------------------------

    #[test]
    fn validate_commit_path_allows_relative_paths() {
        assert!(validate_commit_path("PROJECT.md").is_ok());
        assert!(validate_commit_path("src/App.tsx").is_ok());
        assert!(validate_commit_path("docs/specs/new-spec.md").is_ok());
    }

    #[test]
    fn validate_commit_path_rejects_absolute_paths() {
        let err = validate_commit_path("/etc/passwd").unwrap_err();
        assert!(err.contains("Absolute path"));

        let err = validate_commit_path("\\Windows\\System32\\config").unwrap_err();
        assert!(err.contains("Absolute path"));
    }

    #[test]
    fn validate_commit_path_rejects_traversal() {
        let err = validate_commit_path("../secret.txt").unwrap_err();
        assert!(err.contains("traversal"));

        let err = validate_commit_path("src/../../etc/passwd").unwrap_err();
        assert!(err.contains("traversal"));
    }

    #[test]
    fn validate_commit_path_rejects_empty() {
        let err = validate_commit_path("").unwrap_err();
        assert!(err.contains("Empty"));
    }

    #[test]
    fn validate_commit_path_rejects_null_bytes() {
        let err = validate_commit_path("file\0.txt").unwrap_err();
        assert!(err.contains("Invalid characters"));
    }

    #[test]
    fn branch_sync_lock_blocks_concurrent_acquire_for_same_repo() {
        let repo = test_dir("branch-sync-lock");
        let repo_path = repo.to_string_lossy().to_string();

        let first_token =
            git_sync_lock_acquire(repo_path.clone()).expect("first acquire should succeed");
        let second = git_sync_lock_acquire(repo_path.clone());
        assert!(second.is_err());
        assert!(second.unwrap_err().contains("branchSyncLocked"));

        let wrong_release = git_sync_lock_release(repo_path.clone(), "wrong-token".to_string());
        assert!(wrong_release.is_err());
        assert!(wrong_release
            .unwrap_err()
            .contains("branchSyncLockTokenMismatch"));

        git_sync_lock_release(repo_path.clone(), first_token).expect("release should succeed");
        let second_token = git_sync_lock_acquire(repo_path.clone())
            .expect("acquire should succeed again after release");
        git_sync_lock_release(repo_path, second_token).expect("final release should succeed");

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn resume_validation_succeeds_for_matching_repo_state() {
        let (repo, head) = init_git_repo_with_commit("resume-valid");
        let repo_path = repo.to_string_lossy().to_string();
        let source_output = run_git_capture(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).expect("source branch");
        let source_branch = source_output.stdout;
        run_git_capture(&repo_path, &["branch", "staging"]).expect("create staging branch");

        let validation = git_validate_branch_sync_resume(
            repo_path.clone(),
            source_branch,
            head,
            vec!["staging".to_string()],
        )
        .expect("validation should run");
        assert!(validation.valid);
        assert!(validation.reasons.is_empty());
        assert!(validation.missing_targets.is_empty());

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn resume_validation_flags_missing_target_branch() {
        let (repo, head) = init_git_repo_with_commit("resume-missing-target");
        let repo_path = repo.to_string_lossy().to_string();
        let source_output = run_git_capture(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).expect("source branch");
        let source_branch = source_output.stdout;

        let validation = git_validate_branch_sync_resume(
            repo_path.clone(),
            source_branch,
            head,
            vec!["nonexistent-target".to_string()],
        )
        .expect("validation should run");
        assert!(!validation.valid);
        assert_eq!(
            validation.missing_targets,
            vec!["nonexistent-target".to_string()]
        );
        assert!(validation
            .reasons
            .iter()
            .any(|reason| reason.contains("missing")));

        let _ = fs::remove_dir_all(repo);
    }

    #[test]
    fn combine_git_output_prefers_available_streams() {
        let only_stdout = GitCommandOutput {
            success: true,
            stdout: "ok".to_string(),
            stderr: String::new(),
        };
        assert_eq!(combine_git_output(&only_stdout), "ok");

        let only_stderr = GitCommandOutput {
            success: false,
            stdout: String::new(),
            stderr: "error".to_string(),
        };
        assert_eq!(combine_git_output(&only_stderr), "error");
    }
}
