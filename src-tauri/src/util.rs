//! util.rs — Shared utility functions.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

static WRITE_SEQ: AtomicU64 = AtomicU64::new(0);

/// Check if a process with the given PID is still alive.
pub fn is_pid_alive(pid: i32) -> bool {
    #[cfg(unix)]
    {
        Command::new("kill")
            .arg("-0")
            .arg(pid.to_string())
            .status()
            .map(|status| status.success())
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// Resolve the current user's home directory.
pub fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())
}

/// Resolve the platform temp directory.
pub fn temp_dir() -> PathBuf {
    std::env::temp_dir()
}

/// Best-effort command lookup that works across Unix shells and Windows `where`.
pub fn lookup_command(command: &str) -> Option<PathBuf> {
    #[cfg(windows)]
    {
        let output = Command::new("where").arg(command).output().ok()?;
        if !output.status.success() {
            return None;
        }

        return String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|line| !line.is_empty())
            .map(PathBuf::from)
            .filter(|path| path.exists());
    }

    #[cfg(not(windows))]
    {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/sh".to_string()
            }
        });

        if let Ok(output) = Command::new(&shell)
            .args(["-lc", &format!("command -v {command}")])
            .output()
        {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(path) = stdout
                    .lines()
                    .rev()
                    .map(str::trim)
                    .find(|line| line.starts_with('/'))
                {
                    let path = PathBuf::from(path);
                    if path.exists() {
                        return Some(path);
                    }
                }
            }
        }

        let output = Command::new("which").arg(command).output().ok()?;
        if !output.status.success() {
            return None;
        }

        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .find(|line| line.starts_with('/'))
            .map(PathBuf::from)
            .filter(|path| path.exists())
    }
}

/// Write a serde-serializable value to a file atomically (`.tmp` + rename).
pub fn write_json_atomic<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content =
        serde_json::to_string_pretty(value).map_err(|e| format!("JSON serialize error: {}", e))?;
    write_str_atomic(path, &content)
}

/// Write a string to a file atomically (`.tmp` + rename).
pub fn write_str_atomic(path: &Path, content: &str) -> Result<(), String> {
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("file");
    let temp_suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let seq = WRITE_SEQ.fetch_add(1, Ordering::Relaxed);
    let temp_path = path.with_file_name(format!("{}.tmp-{}-{}", file_name, temp_suffix, seq));
    fs::write(&temp_path, content).map_err(|e| {
        format!(
            "Failed to write temp file {}: {}",
            temp_path.display(),
            e
        )
    })?;
    fs::rename(&temp_path, path).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "Failed to rename {} -> {}: {}",
            temp_path.display(),
            path.display(),
            e
        )
    })
}
