use std::collections::{HashMap, HashSet};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

// Embedded at compile time by build.rs
const BUILD_COMMIT: &str = env!("BUILD_COMMIT");
const SKIP_FILE_NAMES: [&str; 11] = [
    "PIPELINE.md",
    "SPEC.md",
    "OVERVIEW.md",
    "SCHEMA.md",
    "USAGE.md",
    "README.md",
    "REVIEW-FIXES.md",
    "PROJECT.md",
    "CHANGELOG.md",
    "ROADMAP.md",
    "AGENTS.md",
];
const LEGACY_SKIP_DIR_NAMES: [&str; 8] = [
    "node_modules",
    ".git",
    "target",
    "dist",
    "todos",
    "docs",
    "src",
    "src-tauri",
];
const HOME_REPO_EXCLUSIONS: [&str; 14] = [
    "repos",
    "clawdbot-sandbox",
    "Library",
    "Desktop",
    "Documents",
    "Downloads",
    "Movies",
    "Music",
    "Pictures",
    "Public",
    "Applications",
    "node_modules",
    "heroku-cli",
    "tmp",
];

#[derive(Serialize)]
struct GitStatus {
    state: String,
    branch: Option<String>,
    details: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RepoProbe {
    is_git_repo: bool,
    git_branch: Option<String>,
    git_remote: Option<String>,
    is_working_tree_dirty: Option<bool>,
    dirty_paths: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MigrationReport {
    moved_entries: Vec<String>,
    skipped_entries: Vec<String>,
    warnings: Vec<String>,
    settings_updated: bool,
    catalog_entries_dir: String,
}

#[derive(Serialize)]
struct OpenClawGatewayConfig {
    ws_url: String,
    token: Option<String>,
    session_key: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct TrustedPathApproval {
    approved_path: String,
    approved_at: String,
    approved_by: String,
    expires_at: String,
    operations: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DashboardSettings {
    #[serde(default = "default_settings_version")]
    settings_version: u32,
    #[serde(default = "default_migration_version")]
    migration_version: u32,
    #[serde(default = "default_catalog_root")]
    catalog_root: String,
    #[serde(default = "default_workspace_roots")]
    workspace_roots: Vec<String>,
    #[serde(default = "default_openclaw_workspace_path")]
    openclaw_workspace_path: Option<String>,
    #[serde(default = "default_app_source_path")]
    app_source_path: Option<String>,
    #[serde(default = "default_update_mode")]
    update_mode: String,
    #[serde(default = "default_openclaw_context_policy")]
    openclaw_context_policy: String,
    #[serde(default)]
    approved_external_paths: Vec<TrustedPathApproval>,
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
    0
}

fn default_catalog_root() -> String {
    if let Ok(path) = std::env::var("PIPELINE_PROJECTS_DIR") {
        return path;
    }

    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    if cfg!(target_os = "macos") {
        Path::new(&home)
            .join("Library")
            .join("Application Support")
            .join("Pipeline Dashboard")
            .join("catalog")
            .to_string_lossy()
            .to_string()
    } else if cfg!(target_os = "windows") {
        if let Ok(appdata) = env::var("APPDATA") {
            Path::new(&appdata)
                .join("Pipeline Dashboard")
                .join("catalog")
                .to_string_lossy()
                .to_string()
        } else {
            Path::new(&home)
                .join("AppData")
                .join("Roaming")
                .join("Pipeline Dashboard")
                .join("catalog")
                .to_string_lossy()
                .to_string()
        }
    } else {
        Path::new(&home)
            .join(".config")
            .join("pipeline-dashboard")
            .join("catalog")
            .to_string_lossy()
            .to_string()
    }
}

fn default_workspace_roots() -> Vec<String> {
    let home = env::var("HOME").unwrap_or_else(|_| ".".to_string());
    let mut roots = Vec::new();
    let preferred = [
        Path::new(&home).join("repos").to_string_lossy().to_string(),
        Path::new(&home)
            .join("clawdbot-sandbox")
            .join("projects")
            .to_string_lossy()
            .to_string(),
    ];

    for root in preferred {
        if Path::new(&root).exists() {
            roots.push(root);
        }
    }

    if roots.is_empty() {
        roots.push(default_catalog_root());
    }

    roots
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

fn settings_file_path() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("PIPELINE_SETTINGS_PATH") {
        return expand_tilde(&path);
    }

    let home = env::var("HOME").map_err(|error| error.to_string())?;
    let path = if cfg!(target_os = "macos") {
        Path::new(&home)
            .join("Library")
            .join("Application Support")
            .join("Pipeline Dashboard")
            .join("settings.json")
    } else if cfg!(target_os = "windows") {
        if let Ok(appdata) = env::var("APPDATA") {
            Path::new(&appdata)
                .join("Pipeline Dashboard")
                .join("settings.json")
        } else {
            Path::new(&home)
                .join("AppData")
                .join("Roaming")
                .join("Pipeline Dashboard")
                .join("settings.json")
        }
    } else {
        Path::new(&home)
            .join(".config")
            .join("pipeline-dashboard")
            .join("settings.json")
    };

    Ok(path)
}

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

fn normalize_path(path: &str) -> Result<String, String> {
    let expanded = expand_tilde(path)?;
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        std::env::current_dir()
            .map_err(|error| error.to_string())?
            .join(expanded)
    };

    let normalized = if absolute.exists() {
        fs::canonicalize(&absolute).map_err(|error| error.to_string())?
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

fn directory_contains_markdown(dir: &Path) -> bool {
    fs::read_dir(dir)
        .ok()
        .into_iter()
        .flat_map(|entries| entries.filter_map(Result::ok))
        .map(|entry| entry.path())
        .any(|path| path.is_file() && path.extension().is_some_and(|ext| ext == "md"))
}

fn resolve_catalog_entries_dir(
    settings: &DashboardSettings,
    create_if_missing: bool,
) -> Result<PathBuf, String> {
    let catalog_root = PathBuf::from(&settings.catalog_root);
    let entries_dir = catalog_root.join("projects");

    let has_legacy_layout = catalog_root.exists()
        && !entries_dir.exists()
        && directory_contains_markdown(&catalog_root);

    if has_legacy_layout {
        return Ok(catalog_root);
    }

    if create_if_missing {
        fs::create_dir_all(&entries_dir).map_err(|error| error.to_string())?;
    }

    Ok(entries_dir)
}

fn sanitize_settings(mut settings: DashboardSettings) -> Result<DashboardSettings, String> {
    settings.settings_version = 1;
    if settings.migration_version > 1 {
        settings.migration_version = 1;
    }
    settings.catalog_root = normalize_path(&settings.catalog_root)?;

    let mut workspace_roots: Vec<String> = settings
        .workspace_roots
        .into_iter()
        .filter_map(|root| {
            let trimmed = root.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(normalize_path(trimmed))
            }
        })
        .collect::<Result<Vec<_>, _>>()?;

    if workspace_roots.is_empty() {
        workspace_roots.push(settings.catalog_root.clone());
    }
    workspace_roots.sort();
    workspace_roots.dedup();
    settings.workspace_roots = workspace_roots;

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

    settings.approved_external_paths = settings
        .approved_external_paths
        .into_iter()
        .map(|mut approval| {
            approval.approved_path = normalize_path(&approval.approved_path)?;
            Ok::<TrustedPathApproval, String>(approval)
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(settings)
}

fn default_settings() -> DashboardSettings {
    let settings = DashboardSettings {
        settings_version: default_settings_version(),
        migration_version: 1,
        catalog_root: default_catalog_root(),
        workspace_roots: default_workspace_roots(),
        openclaw_workspace_path: default_openclaw_workspace_path(),
        app_source_path: default_app_source_path(),
        update_mode: default_update_mode(),
        openclaw_context_policy: default_openclaw_context_policy(),
        approved_external_paths: vec![],
    };

    sanitize_settings(settings).unwrap_or_else(|_| DashboardSettings {
        settings_version: 1,
        migration_version: 1,
        catalog_root: default_catalog_root(),
        workspace_roots: vec![default_catalog_root()],
        openclaw_workspace_path: None,
        app_source_path: default_app_source_path(),
        update_mode: default_update_mode(),
        openclaw_context_policy: default_openclaw_context_policy(),
        approved_external_paths: vec![],
    })
}

fn write_file_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Invalid settings path".to_string())?;
    let temp_suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let temp_path = path.with_file_name(format!("{file_name}.tmp-{temp_suffix}"));

    fs::write(&temp_path, content).map_err(|error| error.to_string())?;
    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })
}

fn write_dashboard_settings_file(settings: &DashboardSettings) -> Result<(), String> {
    let path = settings_file_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let payload = serde_json::to_string_pretty(settings).map_err(|error| error.to_string())?;
    write_file_atomic(&path, &payload)
}

fn load_dashboard_settings() -> Result<DashboardSettings, String> {
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

#[tauri::command]
fn get_dashboard_settings() -> Result<DashboardSettings, String> {
    load_dashboard_settings()
}

#[tauri::command]
fn update_dashboard_settings(settings: DashboardSettings) -> Result<DashboardSettings, String> {
    let sanitized = sanitize_settings(settings)?;
    write_dashboard_settings_file(&sanitized)?;
    Ok(sanitized)
}

#[tauri::command]
fn get_projects_dir() -> Result<String, String> {
    if let Ok(override_dir) = std::env::var("PIPELINE_PROJECTS_DIR") {
        return normalize_path(&override_dir);
    }

    let settings = load_dashboard_settings()?;
    let entries_dir = resolve_catalog_entries_dir(&settings, true)?;
    Ok(entries_dir.to_string_lossy().to_string())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|error| error.to_string())
}

#[tauri::command]
fn write_file(path: String, content: String) -> Result<(), String> {
    if let Some(parent) = Path::new(&path).parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    fs::write(&path, content).map_err(|error| error.to_string())
}

#[tauri::command]
fn list_files(dir: String) -> Result<Vec<String>, String> {
    let dir_path = PathBuf::from(&dir);
    let mut file_paths = Vec::new();
    let legacy_mode = is_legacy_catalog_entries_dir(&dir_path);
    collect_markdown_files_recursive(&dir_path, legacy_mode, &mut file_paths)?;

    let mut files: Vec<String> = file_paths
        .into_iter()
        .map(|path| path.to_string_lossy().to_string())
        .collect();
    files.sort();
    Ok(files)
}

fn is_legacy_catalog_entries_dir(dir: &Path) -> bool {
    let settings = match load_dashboard_settings() {
        Ok(value) => value,
        Err(_) => return false,
    };
    let catalog_root = PathBuf::from(&settings.catalog_root);
    let entries_dir = catalog_root.join("projects");
    catalog_root == dir && catalog_root.exists() && !entries_dir.exists()
}

fn collect_markdown_files_recursive(
    dir: &Path,
    legacy_mode: bool,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();

        if path.is_dir() {
            let dir_name = path.file_name().and_then(|value| value.to_str());
            let should_skip = dir_name.is_some_and(|name| LEGACY_SKIP_DIR_NAMES.contains(&name));
            if should_skip {
                continue;
            }
            collect_markdown_files_recursive(&path, legacy_mode, files)?;
            continue;
        }

        if path.extension().is_none_or(|ext| ext != "md") {
            continue;
        }
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if SKIP_FILE_NAMES.contains(&file_name) {
            continue;
        }
        files.push(path);
    }
    Ok(())
}

#[tauri::command]
fn delete_file(path: String) -> Result<(), String> {
    fs::remove_file(path).map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_path(path: String) -> Result<(), String> {
    let expanded = expand_tilde(&path)?;
    if expanded.is_file() {
        fs::remove_file(expanded).map_err(|error| error.to_string())
    } else if expanded.is_dir() {
        fs::remove_dir_all(expanded).map_err(|error| error.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
fn resolve_path(path: String) -> Result<String, String> {
    let expanded = expand_tilde(&path)?;

    fs::canonicalize(expanded)
        .map(|resolved| resolved.to_string_lossy().to_string())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn path_exists(path: String) -> Result<bool, String> {
    let expanded = expand_tilde(&path)?;
    Ok(expanded.exists())
}

#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    let expanded = expand_tilde(&path)?;
    fs::create_dir_all(expanded).map_err(|error| error.to_string())
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
        session_key: "agent:main:main".to_string(),
    })
}

fn run_command_with_output(command: &str, args: &[&str]) -> Result<String, String> {
    // Build full command string to run through login shell (to get PATH with node)
    let full_cmd = if args.is_empty() {
        command.to_string()
    } else {
        let escaped_args: Vec<String> = args
            .iter()
            .map(|arg| {
                if arg.contains(' ') || arg.contains('"') {
                    format!("\"{}\"", arg.replace('"', "\\\""))
                } else {
                    arg.to_string()
                }
            })
            .collect();
        format!("{} {}", command, escaped_args.join(" "))
    };

    let output = Command::new("/bin/sh")
        .args(["-l", "-c", &full_cmd])
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
        .unwrap_or_else(|| "agent:main:main".to_string())
        .trim()
        .to_string();

    if session.is_empty() || session == "main" {
        "agent:main:main".to_string()
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
    format!("pipeline-dashboard-{nanos}")
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

fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn parse_dirty_paths(status_porcelain: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut paths = Vec::new();

    for line in status_porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let trimmed = line[3..].trim();
        let path = trimmed
            .split(" -> ")
            .last()
            .unwrap_or(trimmed)
            .trim()
            .to_string();
        if !path.is_empty() && seen.insert(path.clone()) {
            paths.push(path);
        }
    }

    paths
}

#[tauri::command]
fn probe_repo(repo_path: String) -> Result<RepoProbe, String> {
    let repo = expand_tilde(&repo_path)?;
    if !repo.is_dir() {
        return Err("Selected path is not a directory".to_string());
    }
    let repo_str = repo.to_string_lossy().to_string();

    let is_git_repo = run_git(&repo_str, &["rev-parse", "--is-inside-work-tree"]).is_ok();
    if !is_git_repo {
        return Ok(RepoProbe {
            is_git_repo: false,
            git_branch: None,
            git_remote: None,
            is_working_tree_dirty: None,
            dirty_paths: vec![],
        });
    }

    let git_branch = run_git(&repo_str, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let git_remote = run_git(&repo_str, &["config", "--get", "remote.origin.url"]).ok();
    let status_porcelain = run_git(&repo_str, &["status", "--porcelain"]).unwrap_or_default();
    let dirty_paths = parse_dirty_paths(&status_porcelain);

    Ok(RepoProbe {
        is_git_repo: true,
        git_branch,
        git_remote,
        is_working_tree_dirty: Some(!status_porcelain.trim().is_empty()),
        dirty_paths,
    })
}

#[tauri::command]
fn get_git_status(repo_path: String) -> Result<GitStatus, String> {
    let branch = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let status_porcelain = run_git(&repo_path, &["status", "--porcelain"]).unwrap_or_default();

    if !status_porcelain.is_empty() {
        return Ok(GitStatus {
            state: "uncommitted".to_string(),
            branch,
            details: Some("Repository has uncommitted changes".to_string()),
        });
    }

    let upstream = run_git(
        &repo_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    );
    if upstream.is_err() {
        return Ok(GitStatus {
            state: "clean".to_string(),
            branch,
            details: Some("No upstream configured".to_string()),
        });
    }

    let behind_count = run_git(&repo_path, &["rev-list", "--count", "HEAD..@{u}"])
        .unwrap_or_else(|_| "0".to_string())
        .parse::<u32>()
        .unwrap_or(0);

    if behind_count > 0 {
        return Ok(GitStatus {
            state: "behind".to_string(),
            branch,
            details: Some(format!("Behind upstream by {} commit(s)", behind_count)),
        });
    }

    let ahead_count = run_git(&repo_path, &["rev-list", "--count", "@{u}..HEAD"])
        .unwrap_or_else(|_| "0".to_string())
        .parse::<u32>()
        .unwrap_or(0);

    if ahead_count > 0 {
        return Ok(GitStatus {
            state: "unpushed".to_string(),
            branch,
            details: Some(format!("Ahead of upstream by {} commit(s)", ahead_count)),
        });
    }

    Ok(GitStatus {
        state: "clean".to_string(),
        branch,
        details: Some("Working tree clean".to_string()),
    })
}

#[tauri::command]
fn git_commit(repo_path: String, message: String, files: Vec<String>) -> Result<(), String> {
    if files.is_empty() {
        return Err("No files supplied for commit".to_string());
    }

    let add_output = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .arg("add")
        .args(files.iter())
        .output()
        .map_err(|error| error.to_string())?;

    if !add_output.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        ));
    }

    let commit_output = run_git(&repo_path, &["commit", "-m", &message]);
    match commit_output {
        Ok(_) => Ok(()),
        Err(error) => {
            if error.contains("nothing to commit") {
                Ok(())
            } else {
                Err(format!("git commit failed: {}", error))
            }
        }
    }
}

#[tauri::command]
fn git_push(repo_path: String) -> Result<(), String> {
    run_git(&repo_path, &["push"])
        .map(|_| ())
        .map_err(|error| format!("git push failed: {}", error))
}

#[tauri::command]
fn git_init_repo(
    repo_path: String,
    initial_commit: bool,
    files: Vec<String>,
) -> Result<(), String> {
    let resolved_repo = expand_tilde(&repo_path)?;
    if !resolved_repo.exists() {
        return Err("Repository path does not exist".to_string());
    }
    if !resolved_repo.is_dir() {
        return Err("Repository path is not a directory".to_string());
    }
    let repo = resolved_repo.to_string_lossy().to_string();

    let has_git = run_git(&repo, &["rev-parse", "--is-inside-work-tree"]).is_ok();
    if !has_git {
        run_git(&repo, &["init"])?;
    }

    if !initial_commit {
        return Ok(());
    }

    let has_commits = run_git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok();
    if has_commits {
        return Ok(());
    }

    let candidate_files: Vec<String> = files
        .into_iter()
        .filter(|file| !file.trim().is_empty())
        .filter(|file| resolved_repo.join(file).exists())
        .collect();

    if candidate_files.is_empty() {
        return Ok(());
    }

    let add_output = Command::new("git")
        .arg("-C")
        .arg(&repo)
        .arg("add")
        .args(candidate_files.iter())
        .output()
        .map_err(|error| error.to_string())?;
    if !add_output.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        ));
    }

    let commit_output = run_git(&repo, &["commit", "-m", "Initial project setup"]);
    match commit_output {
        Ok(_) => Ok(()),
        Err(error) => {
            if error.contains("nothing to commit") {
                Ok(())
            } else {
                Err(format!("git commit failed: {}", error))
            }
        }
    }
}

fn expand_tilde(path: &str) -> Result<PathBuf, String> {
    if let Some(rest) = path.strip_prefix("~/") {
        let home = std::env::var("HOME").map_err(|error| error.to_string())?;
        return Ok(Path::new(&home).join(rest));
    }

    Ok(PathBuf::from(path))
}

fn get_current_git_head(repo_root: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", &repo_root, "rev-parse", "HEAD"])
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout)
                    .ok()
                    .map(|s| s.trim().to_string())
            } else {
                None
            }
        })
}

#[derive(Serialize)]
struct UpdateStatus {
    update_available: bool,
    build_commit: String,
    current_commit: Option<String>,
}

#[tauri::command]
fn check_for_update() -> Result<UpdateStatus, String> {
    let settings = load_dashboard_settings().unwrap_or_else(|_| default_settings());
    if settings.update_mode != "source-rebuild" {
        return Ok(UpdateStatus {
            update_available: false,
            build_commit: BUILD_COMMIT.to_string(),
            current_commit: None,
        });
    }

    let current_commit = settings
        .app_source_path
        .as_deref()
        .and_then(get_current_git_head);
    let update_available = match &current_commit {
        Some(current) => current != BUILD_COMMIT && BUILD_COMMIT != "unknown",
        None => false, // Can't determine, don't show button
    };

    Ok(UpdateStatus {
        update_available,
        build_commit: BUILD_COMMIT.to_string(),
        current_commit,
    })
}

#[tauri::command]
async fn run_app_update() -> Result<String, String> {
    let settings = load_dashboard_settings()?;
    if settings.update_mode != "source-rebuild" {
        return Err("updateSourceUnavailable: updateMode is set to none".to_string());
    }

    let project_dir = settings
        .app_source_path
        .ok_or_else(|| "updateSourceUnavailable: appSourcePath is not configured".to_string())?;
    let update_script = Path::new(&project_dir).join("update.sh");

    if !update_script.exists() {
        return Err("updateSourceUnavailable: update.sh not found in appSourcePath".to_string());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = fs::metadata(&update_script)
            .map_err(|error| error.to_string())?
            .permissions()
            .mode();
        if mode & 0o111 == 0 {
            return Err("updateSourceUnavailable: update.sh is not executable".to_string());
        }
    }

    let escaped_project_dir = project_dir.replace('\'', "'\\''");
    let _ = Command::new("/bin/sh")
        .args([
            "-c",
            &format!(
                r#"cd '{}' && ./update.sh > /tmp/pipeline-update.log 2>&1"#,
                escaped_project_dir
            ),
        ])
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok("Update started - app will restart when build completes".to_string())
}

fn unix_timestamp_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}

fn create_legacy_symlink(source: &Path, target: &Path) -> Result<(), String> {
    if source.exists() {
        return Ok(());
    }

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        symlink(target, source).map_err(|error| {
            format!(
                "Failed to create symlink `{}` -> `{}`: {}",
                source.to_string_lossy(),
                target.to_string_lossy(),
                error
            )
        })
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::symlink_dir;
        symlink_dir(target, source).map_err(|error| {
            format!(
                "Failed to create symlink `{}` -> `{}`: {}",
                source.to_string_lossy(),
                target.to_string_lossy(),
                error
            )
        })
    }
}

fn is_home_repo_candidate(path: &Path, entry_name: &str) -> bool {
    if HOME_REPO_EXCLUSIONS.contains(&entry_name) || entry_name.starts_with('.') {
        return false;
    }
    path.is_dir() && path.join(".git").exists()
}

fn move_home_repositories_to_repos_root(
    home: &Path,
    repos_root: &Path,
    warnings: &mut Vec<String>,
) -> Result<HashMap<String, String>, String> {
    fs::create_dir_all(repos_root).map_err(|error| error.to_string())?;
    let mut moved = HashMap::new();

    for entry in fs::read_dir(home).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if !is_home_repo_candidate(&path, name) {
            continue;
        }

        let target = repos_root.join(name);
        if target.exists() {
            warnings.push(format!(
                "Skipped moving `{}` because `{}` already exists",
                path.to_string_lossy(),
                target.to_string_lossy()
            ));
            continue;
        }

        fs::rename(&path, &target).map_err(|error| {
            format!(
                "Failed moving repository `{}` to `{}`: {}",
                path.to_string_lossy(),
                target.to_string_lossy(),
                error
            )
        })?;

        if let Err(error) = create_legacy_symlink(&path, &target) {
            let rollback_error = match fs::rename(&target, &path) {
                Ok(()) => "rollback ok".to_string(),
                Err(err) => format!("rollback failed: {err}"),
            };
            return Err(format!(
                "{}. Move rolled back for `{}` ({})",
                error,
                path.to_string_lossy(),
                rollback_error
            ));
        }

        moved.insert(
            path.to_string_lossy().to_string(),
            target.to_string_lossy().to_string(),
        );
    }

    Ok(moved)
}

fn rollback_moved_repositories(moved_repos: &HashMap<String, String>, warnings: &mut Vec<String>) {
    for (source, target) in moved_repos {
        let source_path = Path::new(source);
        let target_path = Path::new(target);

        if source_path.exists() {
            let source_is_symlink = fs::symlink_metadata(source_path)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false);
            if source_is_symlink {
                if let Err(error) = fs::remove_file(source_path) {
                    warnings.push(format!(
                        "Rollback warning: failed to remove symlink `{}`: {}",
                        source, error
                    ));
                    continue;
                }
            } else {
                warnings.push(format!(
                    "Rollback warning: source `{}` already exists and is not a symlink",
                    source
                ));
                continue;
            }
        }

        if !target_path.exists() {
            continue;
        }

        if let Err(error) = fs::rename(target_path, source_path) {
            warnings.push(format!(
                "Rollback warning: failed to move `{}` back to `{}`: {}",
                target, source, error
            ));
        }
    }
}

fn copy_directory_recursive(
    source: &Path,
    target: &Path,
    skip_dir_names: &[&str],
) -> Result<(), String> {
    if !source.exists() {
        return Err(format!(
            "Cannot copy missing source directory `{}`",
            source.to_string_lossy()
        ));
    }

    fs::create_dir_all(target).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let src_path = entry.path();
        let dst_path = target.join(entry.file_name());

        if src_path.is_dir() {
            let skip = src_path
                .file_name()
                .and_then(|value| value.to_str())
                .is_some_and(|name| skip_dir_names.contains(&name));
            if skip {
                continue;
            }
            copy_directory_recursive(&src_path, &dst_path, skip_dir_names)?;
        } else {
            fs::copy(&src_path, &dst_path).map_err(|error| {
                format!(
                    "Failed copying `{}` to `{}`: {}",
                    src_path.to_string_lossy(),
                    dst_path.to_string_lossy(),
                    error
                )
            })?;
        }
    }

    Ok(())
}

fn ensure_git_repository_with_head(path: &Path, warnings: &mut Vec<String>) -> Result<(), String> {
    let repo = path.to_string_lossy().to_string();
    if run_git(&repo, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        run_git(&repo, &["init"])?;
    }

    if run_git(&repo, &["rev-parse", "--verify", "HEAD"]).is_ok() {
        return Ok(());
    }

    // Configure a local identity only when missing to keep bootstrap commits deterministic.
    if run_git(&repo, &["config", "--get", "user.name"]).is_err() {
        let _ = run_git(&repo, &["config", "user.name", "Pipeline Dashboard"]);
    }
    if run_git(&repo, &["config", "--get", "user.email"]).is_err() {
        let _ = run_git(
            &repo,
            &["config", "user.email", "pipeline-dashboard@local.invalid"],
        );
    }

    run_git(&repo, &["add", "-A"])?;
    if let Err(error) = run_git(
        &repo,
        &["commit", "-m", "chore: bootstrap standalone pipeline-dashboard repo"],
    ) {
        warnings.push(format!(
            "Failed to create initial commit in `{}`: {}",
            repo, error
        ));
    }
    Ok(())
}

fn looks_like_catalog_entry(path: &Path) -> bool {
    let Ok(raw) = fs::read_to_string(path) else {
        return false;
    };
    if !raw.trim_start().starts_with("---") {
        return false;
    }
    let has_title = raw.lines().any(|line| line.trim_start().starts_with("title:"));
    let has_status = raw.lines().any(|line| line.trim_start().starts_with("status:"));
    let has_local_path = raw
        .lines()
        .any(|line| line.trim_start().starts_with("localPath:"));
    let has_tracking_mode = raw
        .lines()
        .any(|line| line.trim_start().starts_with("trackingMode:"));
    has_title && (has_status || has_local_path || has_tracking_mode)
}

fn legacy_layout_for_catalog_root(catalog_root: &Path) -> bool {
    let entries_dir = catalog_root.join("projects");
    catalog_root.exists() && !entries_dir.exists() && directory_contains_markdown(catalog_root)
}

fn resolve_entries_dir_from_catalog_root(
    catalog_root: &Path,
    create_if_missing: bool,
) -> Result<PathBuf, String> {
    if legacy_layout_for_catalog_root(catalog_root) {
        return Ok(catalog_root.to_path_buf());
    }

    let entries_dir = catalog_root.join("projects");
    if create_if_missing {
        fs::create_dir_all(&entries_dir).map_err(|error| error.to_string())?;
    }
    Ok(entries_dir)
}

fn migrate_catalog_entries(
    source_entries_dir: &Path,
    source_is_legacy: bool,
    target_entries_dir: &Path,
    moved_entries: &mut Vec<String>,
    skipped_entries: &mut Vec<String>,
    warnings: &mut Vec<String>,
) -> Result<(), String> {
    let mut files = Vec::new();
    collect_markdown_files_recursive(source_entries_dir, source_is_legacy, &mut files)?;
    files.sort();

    for source_path in files {
        if !looks_like_catalog_entry(&source_path) {
            continue;
        }

        let relative = source_path
            .strip_prefix(source_entries_dir)
            .map_err(|error| error.to_string())?;
        let relative_str = relative.to_string_lossy().to_string();
        let target_path = target_entries_dir.join(relative);

        if target_path.exists() {
            skipped_entries.push(relative_str.clone());
            warnings.push(format!(
                "Skipped `{}` because destination `{}` already exists",
                relative_str,
                target_path.to_string_lossy()
            ));
            continue;
        }

        if let Some(parent) = target_path.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }

        fs::copy(&source_path, &target_path).map_err(|error| {
            format!(
                "Failed to copy `{}` to `{}`: {}",
                source_path.to_string_lossy(),
                target_path.to_string_lossy(),
                error
            )
        })?;
        moved_entries.push(relative_str);
    }

    Ok(())
}

#[tauri::command]
fn run_architecture_v2_migration() -> Result<MigrationReport, String> {
    let mut settings = load_dashboard_settings()?;
    let original_settings = settings.clone();
    let home = env::var("HOME")
        .map(PathBuf::from)
        .map_err(|error| error.to_string())?;

    let mut warnings = Vec::new();

    let repos_root = home.join("repos");
    let moved_repos = move_home_repositories_to_repos_root(&home, &repos_root, &mut warnings)?;
    let migration_result = (|| -> Result<MigrationReport, String> {
        let mut moved_entries = Vec::new();
        let mut skipped_entries = Vec::new();

        // Establish a standalone app source path at ~/repos/pipeline-dashboard.
        let target_app_source = repos_root.join("pipeline-dashboard");
        if !target_app_source.exists() {
            if let Some(current_source) = settings
                .app_source_path
                .as_deref()
                .map(PathBuf::from)
                .filter(|path| path.exists())
            {
                let skip_dirs = ["node_modules", "dist", "target", ".next"];
                copy_directory_recursive(&current_source, &target_app_source, &skip_dirs)?;
                warnings.push(format!(
                    "Copied app source from `{}` to `{}`",
                    current_source.to_string_lossy(),
                    target_app_source.to_string_lossy()
                ));
            }
        }

        if target_app_source.exists() {
            ensure_git_repository_with_head(&target_app_source, &mut warnings)?;
            settings.app_source_path = Some(target_app_source.to_string_lossy().to_string());
        }

        // Move catalog into the canonical app-support location and import legacy entries recursively.
        let previous_catalog_root = PathBuf::from(&settings.catalog_root);
        let target_catalog_root = PathBuf::from(default_catalog_root());
        let target_entries_dir = resolve_entries_dir_from_catalog_root(&target_catalog_root, true)?;

        let source_entries_dir = resolve_entries_dir_from_catalog_root(&previous_catalog_root, false)
            .unwrap_or_else(|_| previous_catalog_root.clone());
        let source_is_legacy = source_entries_dir == previous_catalog_root;

        if source_entries_dir.exists() && source_entries_dir != target_entries_dir {
            migrate_catalog_entries(
                &source_entries_dir,
                source_is_legacy,
                &target_entries_dir,
                &mut moved_entries,
                &mut skipped_entries,
                &mut warnings,
            )?;
        }

        settings.catalog_root = target_catalog_root.to_string_lossy().to_string();
        let mut workspace_roots = settings.workspace_roots.clone();
        workspace_roots.push(repos_root.to_string_lossy().to_string());
        let legacy_projects_root = home.join("clawdbot-sandbox").join("projects");
        if legacy_projects_root.exists() {
            workspace_roots.push(legacy_projects_root.to_string_lossy().to_string());
        }
        settings.workspace_roots = workspace_roots;
        settings.migration_version = 1;

        settings = sanitize_settings(settings.clone())?;
        write_dashboard_settings_file(&settings)?;

        let migration_state_path = target_catalog_root.join("migration-state.json");
        let payload = json!({
            "version": 2,
            "migratedAt": unix_timestamp_secs(),
            "sourceCatalogRoot": previous_catalog_root.to_string_lossy(),
            "targetCatalogRoot": target_catalog_root.to_string_lossy(),
            "movedEntries": moved_entries,
            "skippedEntries": skipped_entries,
            "warnings": warnings,
            "movedRepos": moved_repos,
            "appSourcePath": settings.app_source_path,
            "migrationVersion": settings.migration_version,
        });
        write_file_atomic(
            &migration_state_path,
            &serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?,
        )?;

        Ok(MigrationReport {
            moved_entries: payload["movedEntries"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_str().map(|text| text.to_string()))
                .collect(),
            skipped_entries: payload["skippedEntries"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_str().map(|text| text.to_string()))
                .collect(),
            warnings: payload["warnings"]
                .as_array()
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|value| value.as_str().map(|text| text.to_string()))
                .collect(),
            settings_updated: true,
            catalog_entries_dir: target_entries_dir.to_string_lossy().to_string(),
        })
    })();

    match migration_result {
        Ok(report) => Ok(report),
        Err(error) => {
            rollback_moved_repositories(&moved_repos, &mut warnings);
            if let Err(restore_error) = write_dashboard_settings_file(&original_settings) {
                warnings.push(format!(
                    "Rollback warning: failed to restore settings file: {}",
                    restore_error
                ));
            }

            if warnings.is_empty() {
                Err(error)
            } else {
                Err(format!(
                    "{}. Rollback notes: {}",
                    error,
                    warnings.join(" | ")
                ))
            }
        }
    }
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

    // 3. Load skills from ~/.config/opencode/skills/
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

    // 4. Add built-in session commands
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
// Chat Persistence (SQLite)
// =============================================================================

use rusqlite::{Connection, params};
use std::sync::Mutex;
use once_cell::sync::Lazy;

// Global database connection (thread-safe)
static CHAT_DB: Lazy<Mutex<Option<Connection>>> = Lazy::new(|| Mutex::new(None));

fn get_chat_db_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_dir()
        .ok_or_else(|| "Could not find app data directory".to_string())?;
    let app_dir = data_dir.join("pipeline-dashboard");
    fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    Ok(app_dir.join("chat.db"))
}

fn init_chat_db() -> Result<Connection, String> {
    let db_path = get_chat_db_path()?;
    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;
    
    // Enable WAL mode for better concurrent read performance
    conn.execute_batch("PRAGMA journal_mode=WAL;").map_err(|e| e.to_string())?;
    
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
    ).map_err(|e| e.to_string())?;
    
    // Create index for timestamp queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp DESC)",
        [],
    ).map_err(|e| e.to_string())?;
    
    Ok(conn)
}

fn get_or_init_chat_db() -> Result<std::sync::MutexGuard<'static, Option<Connection>>, String> {
    let mut guard = CHAT_DB.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        *guard = Some(init_chat_db()?);
    }
    Ok(guard)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatMessage {
    id: String,
    role: String,
    content: String,
    timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    metadata: Option<String>,
}

#[tauri::command]
fn chat_messages_load(
    before_timestamp: Option<i64>,
    limit: Option<i64>,
) -> Result<Vec<ChatMessage>, String> {
    let limit = limit.unwrap_or(50);
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    
    let mut messages: Vec<ChatMessage> = Vec::new();
    
    let mut stmt = match before_timestamp {
        Some(ts) => {
            // Use <= to avoid skipping messages with same timestamp
            // ORDER BY timestamp DESC, id DESC ensures consistent ordering
            let mut stmt = conn.prepare(
                "SELECT id, role, content, timestamp, metadata FROM messages 
                 WHERE timestamp <= ?1 ORDER BY timestamp DESC, id DESC LIMIT ?2"
            ).map_err(|e| e.to_string())?;
            
            let rows = stmt.query_map(params![ts, limit], |row| {
                Ok(ChatMessage {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    timestamp: row.get(3)?,
                    metadata: row.get(4)?,
                })
            }).map_err(|e| e.to_string())?;
            
            for row in rows {
                messages.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
            }
            return Ok(messages.into_iter().rev().collect());
        },
        None => {
            conn.prepare(
                "SELECT id, role, content, timestamp, metadata FROM messages 
                 ORDER BY timestamp DESC LIMIT ?1"
            ).map_err(|e| e.to_string())?
        }
    };
    
    let rows = stmt.query_map(params![limit], |row| {
        Ok(ChatMessage {
            id: row.get(0)?,
            role: row.get(1)?,
            content: row.get(2)?,
            timestamp: row.get(3)?,
            metadata: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    
    for row in rows {
        messages.push(row.map_err(|e: rusqlite::Error| e.to_string())?);
    }
    
    // Reverse to get chronological order (oldest first)
    messages.reverse();
    
    Ok(messages)
}

#[tauri::command]
fn chat_message_save(message: ChatMessage) -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    
    conn.execute(
        "INSERT OR REPLACE INTO messages (id, role, content, timestamp, metadata)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            message.id,
            message.role,
            message.content,
            message.timestamp,
            message.metadata,
        ],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn chat_messages_clear() -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    
    conn.execute("DELETE FROM messages", []).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
fn chat_messages_count() -> Result<i64, String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM messages", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    
    Ok(count)
}

// =============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_dashboard_settings,
            update_dashboard_settings,
            get_projects_dir,
            read_file,
            write_file,
            list_files,
            delete_file,
            remove_path,
            resolve_path,
            path_exists,
            create_directory,
            pick_folder,
            get_openclaw_gateway_config,
            openclaw_ping,
            openclaw_chat,
            probe_repo,
            get_git_status,
            git_commit,
            git_push,
            git_init_repo,
            check_for_update,
            run_app_update,
            run_architecture_v2_migration,
            list_slash_commands,
            chat_messages_load,
            chat_message_save,
            chat_messages_clear,
            chat_messages_count,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
