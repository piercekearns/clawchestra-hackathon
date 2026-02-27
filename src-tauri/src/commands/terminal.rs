use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetectedAgent {
    pub agent_type: String,
    pub command: String,
    pub path: Option<String>,
    pub available: bool,
}

/// Detect which coding agents and tmux are available on the system.
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
            let result = Command::new("which").arg(cmd).output();
            match result {
                Ok(output) if output.status.success() => {
                    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
                    DetectedAgent {
                        agent_type: agent_type.to_string(),
                        command: cmd.to_string(),
                        path: Some(path),
                        available: true,
                    }
                }
                _ => DetectedAgent {
                    agent_type: agent_type.to_string(),
                    command: cmd.to_string(),
                    path: None,
                    available: false,
                },
            }
        })
        .collect()
}

/// List tmux sessions with the `clawchestra:` prefix.
/// Returns an empty vec if tmux is not running or not installed.
#[tauri::command]
pub(crate) fn tmux_list_clawchestra_sessions() -> Vec<String> {
    let result = Command::new("tmux")
        .args(["list-sessions", "-F", "#{session_name}"])
        .output();

    match result {
        Ok(output) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            stdout
                .lines()
                .filter(|line| line.starts_with("clawchestra:"))
                .map(|s| s.to_string())
                .collect()
        }
        _ => vec![],
    }
}

/// Kill a tmux session by name.
#[tauri::command]
pub(crate) fn tmux_kill_session(session_name: String) -> Result<(), String> {
    let result = Command::new("tmux")
        .args(["kill-session", "-t", &session_name])
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
