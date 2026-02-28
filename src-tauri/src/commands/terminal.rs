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

/// Resolve the user's login shell (defaults to /bin/zsh on macOS).
fn user_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string())
}

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
