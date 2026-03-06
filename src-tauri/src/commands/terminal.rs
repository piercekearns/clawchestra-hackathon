use crate::util::lookup_command;
use serde::Serialize;
use std::process::{Command, Stdio};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetectedAgent {
    pub agent_type: String,
    pub command: String,
    pub path: Option<String>,
    pub available: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalDependencyStatus {
    pub platform: String,
    pub tmux_available: bool,
    pub tmux_path: Option<String>,
    pub installer_label: Option<String>,
    pub installer_command: Option<String>,
    pub installer_note: String,
}

#[cfg(not(target_os = "windows"))]
/// Resolve the user's login shell (defaults to /bin/zsh on macOS, /bin/sh elsewhere).
fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(target_os = "macos") {
            "/bin/zsh".to_string()
        } else {
            "/bin/sh".to_string()
        }
    })
}

#[cfg(target_os = "windows")]
fn login_which(cmd: &str) -> Option<String> {
    let output = Command::new("where")
        .arg(cmd)
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

#[cfg(not(target_os = "windows"))]
/// Run `which <cmd>` inside the user's login shell to resolve its absolute path.
///
/// Tries two strategies:
/// 1. `-lc` (login shell) — sources `.zprofile` / `.bash_profile`
/// 2. `-lic` (login + interactive) — also sources `.zshrc` / `.bashrc`, which
///    catches tools installed via nvm/fnm/volta that only set PATH in rc files.
///
/// For `-lic`, takes the last stdout line starting with `/` to skip any
/// prompt/banner output that `.zshrc` may emit.
fn login_which(cmd: &str) -> Option<String> {
    let shell = user_shell();

    // Strategy 1: login shell (fast, no .zshrc noise)
    if let Ok(output) = Command::new(&shell)
        .args(["-lc", &format!("which {}", cmd)])
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if !path.is_empty() && path.starts_with('/') {
                return Some(path);
            }
        }
    }

    // Strategy 2: interactive login shell (sources .zshrc/.bashrc for nvm etc.)
    if let Ok(output) = Command::new(&shell)
        .args(["-lic", &format!("which {}", cmd)])
        .stderr(Stdio::null())
        .output()
    {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // Take the last line starting with / to skip .zshrc banner output
            if let Some(path) = stdout.lines().rev().find(|l| l.trim().starts_with('/')) {
                return Some(path.trim().to_string());
            }
        }
    }

    None
}

/// Resolve tmux's absolute path via login shell.
/// Used by all tmux commands so they work when the app is launched from
/// Dock/Spotlight where PATH lacks /opt/homebrew/bin.
pub(crate) fn tmux_bin() -> String {
    login_which("tmux").unwrap_or_else(|| "tmux".to_string())
}

/// Detect which coding agents and tmux are available on the system.
/// Uses a login shell so tools installed via npm/homebrew/cargo are found.
#[tauri::command]
pub(crate) fn detect_agents() -> Vec<DetectedAgent> {
    let agents = [
        ("claude-code", "claude"),
        ("codex", "codex"),
        ("opencode", "opencode"),
        ("openclaw-tui", "openclaw"),
        ("tmux", "tmux"),
    ];

    agents
        .iter()
        .map(|(agent_type, cmd)| {
            match login_which(cmd) {
                Some(path) => DetectedAgent {
                    agent_type: agent_type.to_string(),
                    command: cmd.to_string(),
                    path: Some(path),
                    available: true,
                },
                None => DetectedAgent {
                    agent_type: agent_type.to_string(),
                    command: cmd.to_string(),
                    path: None,
                    available: false,
                },
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) fn terminal_dependency_status() -> TerminalDependencyStatus {
    let platform = std::env::consts::OS.to_string();
    let tmux_path = login_which("tmux");
    let tmux_available = tmux_path.is_some();

    let (installer_label, installer_command, installer_note) = match platform.as_str() {
        "macos" => {
            if let Some(brew) = lookup_command("brew") {
                let brew = brew.to_string_lossy().to_string();
                (
                    Some("Install tmux with Homebrew".to_string()),
                    Some(format!("\"{brew}\" install tmux")),
                    "tmux-backed terminals keep sessions alive when you close the drawer or relaunch the app.".to_string(),
                )
            } else {
                (
                    None,
                    None,
                    "tmux is missing and Homebrew was not found, so Clawchestra cannot do a one-click tmux install on this Mac yet.".to_string(),
                )
            }
        }
        "linux" => {
            let sudo_prefix = lookup_command("sudo")
                .map(|path| format!("\"{}\" ", path.to_string_lossy()))
                .unwrap_or_default();

            let linux_installer = if let Some(apt_get) = lookup_command("apt-get") {
                let apt_get = apt_get.to_string_lossy().to_string();
                Some((
                    "Install tmux with apt".to_string(),
                    format!("{sudo_prefix}\"{apt_get}\" update && {sudo_prefix}\"{apt_get}\" install -y tmux"),
                ))
            } else if let Some(dnf) = lookup_command("dnf") {
                let dnf = dnf.to_string_lossy().to_string();
                Some((
                    "Install tmux with dnf".to_string(),
                    format!("{sudo_prefix}\"{dnf}\" install -y tmux"),
                ))
            } else if let Some(yum) = lookup_command("yum") {
                let yum = yum.to_string_lossy().to_string();
                Some((
                    "Install tmux with yum".to_string(),
                    format!("{sudo_prefix}\"{yum}\" install -y tmux"),
                ))
            } else if let Some(pacman) = lookup_command("pacman") {
                let pacman = pacman.to_string_lossy().to_string();
                Some((
                    "Install tmux with pacman".to_string(),
                    format!("{sudo_prefix}\"{pacman}\" -Sy --noconfirm tmux"),
                ))
            } else if let Some(zypper) = lookup_command("zypper") {
                let zypper = zypper.to_string_lossy().to_string();
                Some((
                    "Install tmux with zypper".to_string(),
                    format!("{sudo_prefix}\"{zypper}\" install -y tmux"),
                ))
            } else if let Some(apk) = lookup_command("apk") {
                let apk = apk.to_string_lossy().to_string();
                Some((
                    "Install tmux with apk".to_string(),
                    format!("{sudo_prefix}\"{apk}\" add tmux"),
                ))
            } else {
                None
            };

            match linux_installer {
                Some((label, command)) => (
                    Some(label),
                    Some(command),
                    "tmux-backed terminals keep sessions alive when you close the drawer or relaunch the app.".to_string(),
                ),
                None => (
                    None,
                    None,
                    "tmux is missing and Clawchestra could not detect a supported package manager for one-click remediation.".to_string(),
                ),
            }
        }
        "windows" => (
            None,
            None,
            "Windows terminals currently fall back to direct PowerShell sessions. tmux-backed persistence is not wired on Windows yet.".to_string(),
        ),
        _ => (
            None,
            None,
            "Clawchestra could not determine a supported tmux remediation path for this platform.".to_string(),
        ),
    };

    TerminalDependencyStatus {
        platform,
        tmux_available,
        tmux_path,
        installer_label,
        installer_command,
        installer_note,
    }
}

/// List tmux sessions belonging to Clawchestra.
///
/// tmux sanitizes colons to underscores in stored session names, so a session
/// created as `clawchestra:proj:chat` is listed as `clawchestra_proj_chat`.
/// We match both prefixes for robustness.
/// Returns an empty vec if tmux is not running or not installed.
#[tauri::command]
pub(crate) fn tmux_list_clawchestra_sessions() -> Vec<String> {
    let result = Command::new(tmux_bin())
        .args(["-L", "clawchestra", "list-sessions", "-F", "#{session_name}"])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .filter(|line| line.starts_with("clawchestra:") || line.starts_with("clawchestra_"))
                .map(|s| s.to_string())
                .collect()
        }
        _ => vec![],
    }
}

/// Kill all clawchestra tmux sessions by stopping the entire server socket.
#[tauri::command]
pub(crate) fn tmux_kill_all_clawchestra_sessions() -> Result<(), String> {
    let _ = Command::new(tmux_bin())
        .args(["-L", "clawchestra", "kill-server"])
        .output();
    Ok(())
}

/// Capture the last N lines from a tmux pane's scrollback buffer.
///
/// Used for terminal activity awareness — lets the frontend detect unread
/// output, active agents, and action-required prompts without having a PTY
/// attached. The `-e` flag preserves ANSI escapes (stripped on the TS side).
#[tauri::command]
pub(crate) fn tmux_capture_pane(session_name: String, lines: u32) -> Result<String, String> {
    let sanitized = session_name.replace(':', "_");
    let start_line = format!("-{}", lines);
    let result = Command::new(tmux_bin())
        .args([
            "-L", "clawchestra",
            "capture-pane", "-t", &sanitized,
            "-p",
            "-e",
            "-S", &start_line,
        ])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        }
        Ok(output) => {
            Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
        }
        Err(e) => Err(format!("Failed to run tmux: {}", e)),
    }
}

/// Kill a tmux session by name.
///
/// Sanitizes colons to underscores for the `-t` target, since tmux replaces
/// colons in stored session names and also interprets them as session:window:pane.
#[tauri::command]
pub(crate) fn tmux_kill_session(session_name: String) -> Result<(), String> {
    let sanitized = session_name.replace(':', "_");
    let result = Command::new(tmux_bin())
        .args(["-L", "clawchestra", "kill-session", "-t", &sanitized])
        .output();

    match result {
        Ok(output) if output.status.success() => Ok(()),
        Ok(output) => {
            let stderr = String::from_utf8_lossy(&output.stderr);
            Err(format!("tmux kill-session failed: {}", stderr.trim()))
        }
        Err(e) => Err(format!("Failed to run tmux: {}", e)),
    }
}
