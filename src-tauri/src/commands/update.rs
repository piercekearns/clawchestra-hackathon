use std::fs;
use std::path::Path;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

use crate::commands::git::{categorize_dirty_file, run_git, FileCategory};
use crate::util::is_pid_alive;
use crate::{
    default_settings, load_dashboard_settings, BUILD_COMMIT,
};

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

#[derive(Serialize)]
pub(crate) struct UpdateStatus {
    update_available: bool,
    build_commit: String,
    current_commit: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateLockState {
    lock_present: bool,
    process_alive: bool,
    stale: bool,
    age_secs: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateGuardInput {
    active_turn_count: i64,
    enforce_flush_guard: bool,
    allow_force: bool,
}

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

fn get_current_git_head(repo_root: &str) -> Option<String> {
    Command::new("git")
        .args(["-C", repo_root, "rev-parse", "HEAD"])
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

pub(crate) fn read_update_lock_state() -> UpdateLockState {
    let lock_dir = Path::new("/tmp/clawchestra-update.lock");
    if !lock_dir.exists() {
        return UpdateLockState {
            lock_present: false,
            process_alive: false,
            stale: false,
            age_secs: None,
        };
    }

    let age_secs = fs::metadata(lock_dir)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .map(|elapsed| elapsed.as_secs());

    let pid_path = lock_dir.join("pid");
    let pid = fs::read_to_string(pid_path)
        .ok()
        .and_then(|value| value.trim().parse::<i32>().ok());

    let process_alive = pid.map(is_pid_alive).unwrap_or(false);

    let stale = !process_alive;

    UpdateLockState {
        lock_present: true,
        process_alive,
        stale,
        age_secs,
    }
}

// -------------------------------------------------------------------------
// Tauri commands
// -------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn get_app_update_lock_state() -> Result<UpdateLockState, String> {
    Ok(read_update_lock_state())
}

#[tauri::command]
pub(crate) fn check_for_update() -> Result<UpdateStatus, String> {
    let settings = load_dashboard_settings().unwrap_or_else(|_| default_settings());
    if settings.update_mode != "source-rebuild" {
        return Ok(UpdateStatus {
            update_available: false,
            build_commit: BUILD_COMMIT.to_string(),
            current_commit: None,
        });
    }

    let repo_path = settings.app_source_path.as_deref();
    let current_commit = repo_path.and_then(get_current_git_head);
    let update_available = match (&current_commit, repo_path) {
        (Some(current), Some(repo)) if current != BUILD_COMMIT && BUILD_COMMIT != "unknown" => {
            run_git(repo, &["diff", "--name-only", &format!("{BUILD_COMMIT}..{current}")])
                .map(|output| {
                    output
                        .lines()
                        .filter(|line| !line.is_empty())
                        .any(|line| categorize_dirty_file(line) == FileCategory::Code)
                })
                .unwrap_or(true) // If diff fails, assume update needed (safe default)
        }
        _ => false,
    };

    Ok(UpdateStatus {
        update_available,
        build_commit: BUILD_COMMIT.to_string(),
        current_commit,
    })
}

#[tauri::command]
pub(crate) async fn run_app_update(
    app_handle: tauri::AppHandle,
    update_guard: Option<UpdateGuardInput>,
) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        return Err(
            "updateSourceUnavailable: source-rebuild update flow currently supports macOS only"
                .to_string(),
        );
    }

    let settings = load_dashboard_settings()?;
    if settings.update_mode != "source-rebuild" {
        return Err("updateSourceUnavailable: updateMode is set to none".to_string());
    }

    if let Some(guard) = update_guard {
        if guard.enforce_flush_guard && guard.active_turn_count > 0 && !guard.allow_force {
            return Err(format!(
                "updateBlocked: {} active chat turn(s). Wait for completion before updating.",
                guard.active_turn_count
            ));
        }
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

    let install_path = std::env::current_exe()
        .ok()
        .and_then(|exe| {
            let mut current = exe.as_path();
            loop {
                if current
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("app"))
                    .unwrap_or(false)
                {
                    return Some(current.to_string_lossy().to_string());
                }
                current = current.parent()?;
            }
        })
        .unwrap_or_else(|| "/Applications/Clawchestra.app".to_string());

    // Persist window size/position so the restart opens at the same geometry.
    let _ = app_handle.save_window_state(StateFlags::all());

    let log_path = format!(
        "/tmp/clawchestra-update-{}.log",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    );
    let _ = Command::new("/bin/sh")
        .current_dir(&project_dir)
        .env("CLAWCHESTRA_INSTALL_PATH", install_path)
        .env("CLAWCHESTRA_RESTART_AFTER_BUILD", "1")
        .args(["-c", &format!("./update.sh > {} 2>&1", log_path)])
        .spawn()
        .map_err(|error| error.to_string())?;

    Ok(format!(
        "Update started - app will restart after build completes (log: {log_path})"
    ))
}
