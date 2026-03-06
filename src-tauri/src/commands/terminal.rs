use crate::util::lookup_command;
#[cfg(target_os = "windows")]
use serde::Deserialize;
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DetectedAgent {
    pub agent_type: String,
    pub command: String,
    pub path: Option<String>,
    pub available: bool,
    pub prefers_shell: bool,
    pub shell_path: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TerminalDependencyStatus {
    pub platform: String,
    pub tmux_available: bool,
    pub tmux_path: Option<String>,
    pub shell_path: Option<String>,
    pub installer_label: Option<String>,
    pub installer_command: Option<String>,
    pub installer_note: String,
}

#[derive(Debug, Clone)]
struct CommandResolution {
    path: Option<String>,
    available: bool,
    prefers_shell: bool,
    shell_path: Option<String>,
}

impl CommandResolution {
    fn missing(shell_path: Option<String>) -> Self {
        Self {
            path: None,
            available: false,
            prefers_shell: false,
            shell_path,
        }
    }
}

#[cfg(target_os = "windows")]
#[derive(Deserialize)]
struct PowerShellCommandInfo {
    kind: String,
    path: Option<String>,
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

#[cfg(not(target_os = "windows"))]
fn shell_name(shell_path: &str) -> String {
    Path::new(shell_path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

#[cfg(not(target_os = "windows"))]
fn shell_command_args(shell_path: &str, script: &str) -> Vec<String> {
    let shell = shell_name(shell_path);
    if matches!(shell.as_str(), "sh" | "dash") {
        vec!["-i".to_string(), "-c".to_string(), script.to_string()]
    } else {
        vec![
            "-i".to_string(),
            "-l".to_string(),
            "-c".to_string(),
            script.to_string(),
        ]
    }
}

#[cfg(not(target_os = "windows"))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
}

#[cfg(not(target_os = "windows"))]
fn run_shell_command(shell_path: &str, script: &str) -> Option<String> {
    let output = Command::new(shell_path)
        .args(shell_command_args(shell_path, script))
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .rev()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

#[cfg(not(target_os = "windows"))]
fn detect_command_resolution(cmd: &str) -> CommandResolution {
    let shell_path = user_shell();
    let script = format!("command -v -- {} 2>/dev/null", shell_quote(cmd));

    match run_shell_command(&shell_path, &script) {
        Some(value) if value.starts_with('/') => CommandResolution {
            path: Some(value),
            available: true,
            prefers_shell: false,
            shell_path: Some(shell_path),
        },
        Some(value) if !value.is_empty() => CommandResolution {
            path: None,
            available: true,
            prefers_shell: true,
            shell_path: Some(shell_path),
        },
        _ => CommandResolution::missing(Some(shell_path)),
    }
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

#[cfg(target_os = "windows")]
fn powershell_candidates() -> Vec<String> {
    let mut candidates = Vec::new();
    for cmd in ["powershell.exe", "powershell", "pwsh.exe", "pwsh"] {
        if let Some(path) = lookup_command(cmd) {
            let value = path.to_string_lossy().to_string();
            if !candidates.contains(&value) {
                candidates.push(value);
            }
        }
    }
    candidates
}

#[cfg(target_os = "windows")]
fn preferred_windows_shell() -> Option<String> {
    powershell_candidates().into_iter().next()
}

#[cfg(target_os = "windows")]
fn inspect_powershell_command(shell_path: &str, cmd: &str) -> Option<PowerShellCommandInfo> {
    let escaped = cmd.replace('\'', "''");
    let script = format!(
        "$command = Get-Command -Name '{escaped}' -ErrorAction SilentlyContinue | Select-Object -First 1 CommandType, Path; \
if ($null -eq $command) {{ exit 1 }}; \
$kind = if ($command.CommandType -in @('Alias', 'Function', 'Filter', 'Configuration')) {{ 'shell' }} elseif ($command.Path) {{ 'path' }} else {{ 'shell' }}; \
[PSCustomObject]@{{ kind = $kind; path = $command.Path }} | ConvertTo-Json -Compress"
    );

    let output = Command::new(shell_path)
        .args(["-NoLogo", "-Command", &script])
        .stderr(Stdio::null())
        .output()
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let line = stdout.lines().rev().map(str::trim).find(|line| !line.is_empty())?;
    serde_json::from_str(line).ok()
}

#[cfg(target_os = "windows")]
fn detect_command_resolution(cmd: &str) -> CommandResolution {
    let default_shell = preferred_windows_shell();
    let direct_path = login_which(cmd);

    for shell_path in powershell_candidates() {
        if let Some(info) = inspect_powershell_command(&shell_path, cmd) {
            if info.kind == "shell" {
                return CommandResolution {
                    path: None,
                    available: true,
                    prefers_shell: true,
                    shell_path: Some(shell_path),
                };
            }

            if let Some(path) = info.path {
                return CommandResolution {
                    path: Some(path),
                    available: true,
                    prefers_shell: false,
                    shell_path: default_shell,
                };
            }
        }
    }

    if let Some(path) = direct_path {
        return CommandResolution {
            path: Some(path),
            available: true,
            prefers_shell: false,
            shell_path: default_shell,
        };
    }

    CommandResolution::missing(default_shell)
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
            let resolution = if *cmd == "tmux" {
                match login_which(cmd) {
                    Some(path) => CommandResolution {
                        path: Some(path),
                        available: true,
                        prefers_shell: false,
                        shell_path: None,
                    },
                    None => CommandResolution::missing(None),
                }
            } else {
                detect_command_resolution(cmd)
            };
            DetectedAgent {
                agent_type: agent_type.to_string(),
                command: cmd.to_string(),
                path: resolution.path,
                available: resolution.available,
                prefers_shell: resolution.prefers_shell,
                shell_path: resolution.shell_path,
            }
        })
        .collect()
}

#[tauri::command]
pub(crate) fn terminal_dependency_status() -> TerminalDependencyStatus {
    let platform = std::env::consts::OS.to_string();
    let tmux_path = login_which("tmux");
    let tmux_available = tmux_path.is_some();
    #[cfg(target_os = "windows")]
    let shell_path = preferred_windows_shell();
    #[cfg(not(target_os = "windows"))]
    let shell_path = Some(user_shell());

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
        shell_path,
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
