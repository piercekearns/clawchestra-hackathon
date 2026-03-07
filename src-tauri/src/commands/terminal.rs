use crate::util::lookup_command;
#[cfg(target_os = "windows")]
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, PtyPair, PtySize};
#[cfg(target_os = "windows")]
use serde::Deserialize;
use serde::Serialize;
#[cfg(target_os = "windows")]
use serde_json::{json, Value};
use std::collections::HashMap;
#[cfg(target_os = "windows")]
use std::ffi::OsString;
#[cfg(target_os = "windows")]
use std::io::Read;
#[cfg(target_os = "windows")]
use std::io::{BufRead, BufReader, Write};
#[cfg(target_os = "windows")]
use std::net::{TcpListener, TcpStream};
use std::path::Path;
#[cfg(target_os = "windows")]
use std::path::PathBuf;
use std::process::{Command, Stdio};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "windows")]
use std::sync::Arc;
#[cfg(target_os = "windows")]
use std::sync::Mutex;
#[cfg(target_os = "windows")]
use std::time::{Duration, Instant};

#[cfg(target_os = "windows")]
const WINDOWS_PERSISTENT_SCROLLBACK_LIMIT: usize = 512 * 1024;
#[cfg(target_os = "windows")]
const WINDOWS_PERSISTENT_PENDING_LIMIT: usize = 128 * 1024;

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

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PersistentTerminalSnapshot {
    pub data: String,
    pub exited: bool,
    pub exit_code: Option<u32>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
#[derive(Default)]
pub(crate) struct PersistentTerminalSessionManager {
    #[cfg(target_os = "windows")]
    sessions: Mutex<HashMap<String, Arc<WindowsPersistentTerminalSession>>>,
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
impl PersistentTerminalSessionManager {
    pub(crate) fn active_session_ids(&self) -> Vec<String> {
        #[cfg(target_os = "windows")]
        {
            let sessions = self.sessions.lock().expect("persistent session lock poisoned");
            return sessions
                .iter()
                .filter_map(|(chat_id, session)| {
                    if session.is_active() {
                        Some(chat_id.clone())
                    } else {
                        None
                    }
                })
                .collect();
        }

        #[cfg(not(target_os = "windows"))]
        {
            Vec::new()
        }
    }

    pub(crate) fn kill_all(&self) {
        #[cfg(target_os = "windows")]
        {
            let sessions = self
                .sessions
                .lock()
                .expect("persistent session lock poisoned")
                .values()
                .cloned()
                .collect::<Vec<_>>();
            for session in sessions {
                session.kill();
            }
        }
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn ensure_session(
        &self,
        chat_id: String,
        file: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        if let Some(existing) = sessions.get(&chat_id) {
            if existing.is_active() {
                let _ = existing.resize(cols, rows);
                return Ok(());
            }
        }

        let session = spawn_windows_persistent_session(file, args, cwd, env, cols, rows)?;
        sessions.insert(chat_id, session);
        Ok(())
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn attach_session(
        &self,
        chat_id: &str,
        lines: usize,
    ) -> Result<PersistentTerminalSnapshot, String> {
        let sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        let session = sessions
            .get(chat_id)
            .ok_or_else(|| "Persistent terminal session not found.".to_string())?;
        Ok(session.attach_snapshot(lines))
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn drain_session(
        &self,
        chat_id: &str,
    ) -> Result<PersistentTerminalSnapshot, String> {
        let sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        let session = sessions
            .get(chat_id)
            .ok_or_else(|| "Persistent terminal session not found.".to_string())?;
        Ok(session.drain_pending())
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn capture_session(&self, chat_id: &str, lines: usize) -> Result<String, String> {
        let sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        let session = sessions
            .get(chat_id)
            .ok_or_else(|| "Persistent terminal session not found.".to_string())?;
        Ok(session.capture_snapshot(lines))
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn write_session(&self, chat_id: &str, data: &str) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        let session = sessions
            .get(chat_id)
            .ok_or_else(|| "Persistent terminal session not found.".to_string())?;
        session.write(data)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn resize_session(
        &self,
        chat_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        let session = sessions
            .get(chat_id)
            .ok_or_else(|| "Persistent terminal session not found.".to_string())?;
        session.resize(cols, rows)
    }

    #[cfg(target_os = "windows")]
    pub(crate) fn kill_session(&self, chat_id: &str) -> Result<(), String> {
        let sessions = self
            .sessions
            .lock()
            .expect("persistent session lock poisoned");
        let session = sessions
            .get(chat_id)
            .ok_or_else(|| "Persistent terminal session not found.".to_string())?;
        session.kill();
        Ok(())
    }
}

#[cfg(target_os = "windows")]
struct WindowsPersistentTerminalSession {
    pair: Mutex<PtyPair>,
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    state: Mutex<WindowsPersistentTerminalState>,
}

#[cfg(target_os = "windows")]
#[derive(Default)]
struct WindowsPersistentTerminalState {
    pending_output: Vec<u8>,
    scrollback: Vec<u8>,
    exited: bool,
    exit_code: Option<u32>,
}

#[cfg(target_os = "windows")]
impl WindowsPersistentTerminalSession {
    fn is_active(&self) -> bool {
        !self.state.lock().expect("persistent terminal state lock poisoned").exited
    }

    fn append_output(&self, chunk: &[u8]) {
        let mut state = self
            .state
            .lock()
            .expect("persistent terminal state lock poisoned");
        state.pending_output.extend_from_slice(chunk);
        if state.pending_output.len() > WINDOWS_PERSISTENT_PENDING_LIMIT {
            let overflow = state.pending_output.len() - WINDOWS_PERSISTENT_PENDING_LIMIT;
            state.pending_output.drain(0..overflow);
        }
        state.scrollback.extend_from_slice(chunk);
        if state.scrollback.len() > WINDOWS_PERSISTENT_SCROLLBACK_LIMIT {
            let overflow = state.scrollback.len() - WINDOWS_PERSISTENT_SCROLLBACK_LIMIT;
            state.scrollback.drain(0..overflow);
        }
    }

    fn mark_exited(&self, exit_code: Option<u32>) {
        let mut state = self
            .state
            .lock()
            .expect("persistent terminal state lock poisoned");
        state.exited = true;
        state.exit_code = exit_code.or(state.exit_code);
    }

    fn attach_snapshot(&self, lines: usize) -> PersistentTerminalSnapshot {
        let mut state = self
            .state
            .lock()
            .expect("persistent terminal state lock poisoned");
        let mut combined = state.scrollback.clone();
        state.pending_output.clear();
        PersistentTerminalSnapshot {
            data: tail_lines(&mut combined, lines),
            exited: state.exited,
            exit_code: state.exit_code,
        }
    }

    fn drain_pending(&self) -> PersistentTerminalSnapshot {
        let mut state = self
            .state
            .lock()
            .expect("persistent terminal state lock poisoned");
        let data = String::from_utf8_lossy(&state.pending_output).to_string();
        state.pending_output.clear();
        PersistentTerminalSnapshot {
            data,
            exited: state.exited,
            exit_code: state.exit_code,
        }
    }

    fn capture_snapshot(&self, lines: usize) -> String {
        let mut copy = self
            .state
            .lock()
            .expect("persistent terminal state lock poisoned")
            .scrollback
            .clone();
        tail_lines(&mut copy, lines)
    }

    fn write(&self, data: &str) -> Result<(), String> {
        self.writer
            .lock()
            .expect("persistent terminal writer lock poisoned")
            .write_all(data.as_bytes())
            .map_err(|error| error.to_string())
    }

    fn resize(&self, cols: u16, rows: u16) -> Result<(), String> {
        self.pair
            .lock()
            .expect("persistent terminal pair lock poisoned")
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| error.to_string())
    }

    fn kill(&self) {
        let _ = self
            .killer
            .lock()
            .expect("persistent terminal killer lock poisoned")
            .kill();
    }
}

#[cfg(target_os = "windows")]
fn tail_lines(bytes: &mut Vec<u8>, lines: usize) -> String {
    if lines == 0 {
        return String::new();
    }

    let text = String::from_utf8_lossy(bytes);
    let collected = text.lines().collect::<Vec<_>>();
    let start = collected.len().saturating_sub(lines);
    collected[start..].join("\n")
}

#[cfg(target_os = "windows")]
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct WindowsTerminalHostStateFile {
    port: u16,
    token: String,
    pid: u32,
}

#[cfg(target_os = "windows")]
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "command", rename_all = "camelCase")]
enum WindowsTerminalHostCommand {
    Ping,
    SessionIds,
    Ensure {
        chat_id: String,
        file: String,
        args: Vec<String>,
        cwd: Option<String>,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
    },
    Attach { chat_id: String, lines: usize },
    Drain { chat_id: String },
    Capture { chat_id: String, lines: usize },
    Write { chat_id: String, data: String },
    Resize { chat_id: String, cols: u16, rows: u16 },
    Kill { chat_id: String },
    KillAll,
    Shutdown,
}

#[cfg(target_os = "windows")]
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct WindowsTerminalHostRequest {
    token: String,
    #[serde(flatten)]
    command: WindowsTerminalHostCommand,
}

#[cfg(target_os = "windows")]
#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
struct WindowsTerminalHostResponse {
    ok: bool,
    data: Option<Value>,
    error: Option<String>,
}

#[cfg(target_os = "windows")]
fn windows_terminal_host_state_path() -> PathBuf {
    let root = dirs::data_local_dir()
        .or_else(dirs::config_dir)
        .unwrap_or_else(std::env::temp_dir)
        .join("Clawchestra");
    let _ = std::fs::create_dir_all(&root);
    root.join("windows-terminal-host.json")
}

#[cfg(target_os = "windows")]
fn read_windows_terminal_host_state() -> Option<WindowsTerminalHostStateFile> {
    let content = std::fs::read_to_string(windows_terminal_host_state_path()).ok()?;
    serde_json::from_str(&content).ok()
}

#[cfg(target_os = "windows")]
fn write_windows_terminal_host_state(state: &WindowsTerminalHostStateFile) -> Result<(), String> {
    let path = windows_terminal_host_state_path();
    let content = serde_json::to_string_pretty(state).map_err(|error| error.to_string())?;
    std::fs::write(path, content).map_err(|error| error.to_string())
}

#[cfg(target_os = "windows")]
fn remove_windows_terminal_host_state() {
    let _ = std::fs::remove_file(windows_terminal_host_state_path());
}

#[cfg(target_os = "windows")]
fn host_ok(data: Option<Value>) -> WindowsTerminalHostResponse {
    WindowsTerminalHostResponse {
        ok: true,
        data,
        error: None,
    }
}

#[cfg(target_os = "windows")]
fn host_err(message: String) -> WindowsTerminalHostResponse {
    WindowsTerminalHostResponse {
        ok: false,
        data: None,
        error: Some(message),
    }
}

#[cfg(target_os = "windows")]
fn send_windows_terminal_host_request(
    state: &WindowsTerminalHostStateFile,
    command: WindowsTerminalHostCommand,
) -> Result<Value, String> {
    let mut stream = TcpStream::connect(("127.0.0.1", state.port)).map_err(|error| error.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| error.to_string())?;

    let request = WindowsTerminalHostRequest {
        token: state.token.clone(),
        command,
    };
    let payload = serde_json::to_vec(&request).map_err(|error| error.to_string())?;
    stream.write_all(&payload).map_err(|error| error.to_string())?;
    stream.write_all(b"\n").map_err(|error| error.to_string())?;
    stream.flush().map_err(|error| error.to_string())?;

    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let bytes = reader.read_line(&mut line).map_err(|error| error.to_string())?;
    if bytes == 0 {
        return Err("Windows terminal host closed the connection.".to_string());
    }

    let response: WindowsTerminalHostResponse =
        serde_json::from_str(line.trim()).map_err(|error| error.to_string())?;
    if response.ok {
        Ok(response.data.unwrap_or(Value::Null))
    } else {
        Err(response
            .error
            .unwrap_or_else(|| "Windows terminal host returned an unknown error.".to_string()))
    }
}

#[cfg(target_os = "windows")]
fn try_windows_terminal_host_command(command: WindowsTerminalHostCommand) -> Result<Value, String> {
    let Some(state) = read_windows_terminal_host_state() else {
        return Err("Windows terminal host is not running.".to_string());
    };

    match send_windows_terminal_host_request(&state, command) {
        Ok(value) => Ok(value),
        Err(error) => {
            remove_windows_terminal_host_state();
            Err(error)
        }
    }
}

#[cfg(target_os = "windows")]
fn spawn_windows_terminal_host_process() -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const DETACHED_PROCESS: u32 = 0x00000008;
    const CREATE_NEW_PROCESS_GROUP: u32 = 0x00000200;
    const CREATE_NO_WINDOW: u32 = 0x08000000;

    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    Command::new(current_exe)
        .arg("--terminal-host")
        .creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_windows_terminal_host_state() -> Result<WindowsTerminalHostStateFile, String> {
    if let Some(state) = read_windows_terminal_host_state() {
        if send_windows_terminal_host_request(&state, WindowsTerminalHostCommand::Ping).is_ok() {
            return Ok(state);
        }
        remove_windows_terminal_host_state();
    }

    spawn_windows_terminal_host_process()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline {
        if let Some(state) = read_windows_terminal_host_state() {
            if send_windows_terminal_host_request(&state, WindowsTerminalHostCommand::Ping).is_ok() {
                return Ok(state);
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }

    Err("Timed out waiting for the Windows terminal host to start.".to_string())
}

#[cfg(target_os = "windows")]
fn ensure_windows_terminal_host_command(command: WindowsTerminalHostCommand) -> Result<Value, String> {
    let state = ensure_windows_terminal_host_state()?;
    send_windows_terminal_host_request(&state, command)
}

#[cfg(target_os = "windows")]
fn handle_windows_terminal_host_connection(
    stream: TcpStream,
    manager: Arc<PersistentTerminalSessionManager>,
    token: &str,
    shutdown: Arc<AtomicBool>,
) {
    let mut reader = BufReader::new(stream);
    let mut line = String::new();
    let reply = match reader.read_line(&mut line) {
        Ok(0) => host_err("Empty request".to_string()),
        Ok(_) => match serde_json::from_str::<WindowsTerminalHostRequest>(line.trim()) {
            Ok(request) if request.token == token => {
                let result = match request.command {
                    WindowsTerminalHostCommand::Ping => Ok(json!({ "pong": true })),
                    WindowsTerminalHostCommand::SessionIds => Ok(json!(manager.active_session_ids())),
                    WindowsTerminalHostCommand::Ensure {
                        chat_id,
                        file,
                        args,
                        cwd,
                        env,
                        cols,
                        rows,
                    } => manager
                        .ensure_session(chat_id, file, args, cwd, env, cols, rows)
                        .map(|_| Value::Null),
                    WindowsTerminalHostCommand::Attach { chat_id, lines } => manager
                        .attach_session(&chat_id, lines)
                        .and_then(|snapshot| serde_json::to_value(snapshot).map_err(|error| error.to_string())),
                    WindowsTerminalHostCommand::Drain { chat_id } => manager
                        .drain_session(&chat_id)
                        .and_then(|snapshot| serde_json::to_value(snapshot).map_err(|error| error.to_string())),
                    WindowsTerminalHostCommand::Capture { chat_id, lines } => {
                        manager.capture_session(&chat_id, lines).map(Value::String)
                    }
                    WindowsTerminalHostCommand::Write { chat_id, data } => manager
                        .write_session(&chat_id, &data)
                        .map(|_| Value::Null),
                    WindowsTerminalHostCommand::Resize { chat_id, cols, rows } => manager
                        .resize_session(&chat_id, cols, rows)
                        .map(|_| Value::Null),
                    WindowsTerminalHostCommand::Kill { chat_id } => manager
                        .kill_session(&chat_id)
                        .map(|_| Value::Null),
                    WindowsTerminalHostCommand::KillAll => {
                        manager.kill_all();
                        Ok(Value::Null)
                    }
                    WindowsTerminalHostCommand::Shutdown => {
                        manager.kill_all();
                        shutdown.store(true, Ordering::SeqCst);
                        Ok(Value::Null)
                    }
                };

                match result {
                    Ok(data) => host_ok(Some(data)),
                    Err(error) => host_err(error),
                }
            }
            Ok(_) => host_err("Invalid Windows terminal host token.".to_string()),
            Err(error) => host_err(error.to_string()),
        },
        Err(error) => host_err(error.to_string()),
    };

    let mut stream = reader.into_inner();
    let payload = serde_json::to_string(&reply)
        .unwrap_or_else(|_| "{\"ok\":false,\"data\":null,\"error\":\"Serialization failure\"}".to_string());
    let _ = stream.write_all(format!("{payload}\n").as_bytes());
    let _ = stream.flush();
}

#[cfg(target_os = "windows")]
pub(crate) fn maybe_run_windows_terminal_host_from_args() -> bool {
    if !std::env::args().any(|arg| arg == "--terminal-host") {
        return false;
    }

    let listener = match TcpListener::bind(("127.0.0.1", 0)) {
        Ok(listener) => listener,
        Err(_) => return true,
    };
    let _ = listener.set_nonblocking(true);

    let state = WindowsTerminalHostStateFile {
        port: listener.local_addr().map(|addr| addr.port()).unwrap_or_default(),
        token: uuid::Uuid::new_v4().to_string(),
        pid: std::process::id(),
    };
    if write_windows_terminal_host_state(&state).is_err() {
        return true;
    }

    let manager = Arc::new(PersistentTerminalSessionManager::default());
    let shutdown = Arc::new(AtomicBool::new(false));
    let mut last_request_at = Instant::now();

    while !shutdown.load(Ordering::SeqCst) {
        if manager.active_session_ids().is_empty()
            && Instant::now().duration_since(last_request_at) > Duration::from_secs(120)
        {
            break;
        }

        match listener.accept() {
            Ok((stream, _)) => {
                last_request_at = Instant::now();
                let manager = manager.clone();
                let token = state.token.clone();
                let shutdown = shutdown.clone();
                std::thread::spawn(move || {
                    handle_windows_terminal_host_connection(stream, manager, &token, shutdown);
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(75));
            }
            Err(_) => {
                std::thread::sleep(Duration::from_millis(150));
            }
        }
    }

    remove_windows_terminal_host_state();
    true
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn maybe_run_windows_terminal_host_from_args() -> bool {
    false
}

#[cfg(target_os = "windows")]
pub(crate) fn persistent_terminal_active_session_count() -> usize {
    try_windows_terminal_host_command(WindowsTerminalHostCommand::SessionIds)
        .ok()
        .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
        .map(|ids| ids.len())
        .unwrap_or(0)
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn persistent_terminal_active_session_count() -> usize {
    0
}

#[cfg(target_os = "windows")]
pub(crate) fn persistent_terminal_kill_all_sessions() {
    let _ = try_windows_terminal_host_command(WindowsTerminalHostCommand::KillAll);
    let _ = try_windows_terminal_host_command(WindowsTerminalHostCommand::Shutdown);
    remove_windows_terminal_host_state();
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn persistent_terminal_kill_all_sessions() {}

#[cfg(target_os = "windows")]
pub(crate) fn persistent_terminal_shutdown_if_idle() {
    if persistent_terminal_active_session_count() == 0 {
        let _ = try_windows_terminal_host_command(WindowsTerminalHostCommand::Shutdown);
        remove_windows_terminal_host_state();
    }
}

#[cfg(not(target_os = "windows"))]
pub(crate) fn persistent_terminal_shutdown_if_idle() {}

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
            "Windows terminals now stay alive while the app remains open. Full relaunch persistence still needs a detached host process.".to_string(),
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

#[cfg(target_os = "windows")]
fn spawn_windows_persistent_session(
    file: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
) -> Result<Arc<WindowsPersistentTerminalSession>, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;
    let writer = pair.master.take_writer().map_err(|error| error.to_string())?;
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;

    let mut cmd = CommandBuilder::new(file);
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.cwd(OsString::from(cwd));
    }
    for (key, value) in env {
        cmd.env(OsString::from(key), OsString::from(value));
    }
    let mut child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| error.to_string())?;
    let killer = child.clone_killer();

    let session = Arc::new(WindowsPersistentTerminalSession {
        pair: Mutex::new(pair),
        writer: Mutex::new(writer),
        killer: Mutex::new(killer),
        state: Mutex::new(WindowsPersistentTerminalState::default()),
    });

    let reader_session = Arc::clone(&session);
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => {
                    reader_session.mark_exited(None);
                    break;
                }
                Ok(n) => reader_session.append_output(&buffer[..n]),
                Err(_) => {
                    reader_session.mark_exited(None);
                    break;
                }
            }
        }
    });

    let wait_session = Arc::clone(&session);
    std::thread::spawn(move || {
        let exit_code = child.wait().ok().map(|status| status.exit_code());
        wait_session.mark_exited(exit_code);
    });

    Ok(session)
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_ensure(
    chat_id: String,
    file: String,
    args: Vec<String>,
    cwd: Option<String>,
    env: HashMap<String, String>,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        ensure_windows_terminal_host_command(WindowsTerminalHostCommand::Ensure {
            chat_id,
            file,
            args,
            cwd,
            env,
            cols,
            rows,
        })
        .map(|_| ())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (chat_id, file, args, cwd, env, cols, rows);
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_attach(
    chat_id: String,
    lines: Option<u32>,
) -> Result<PersistentTerminalSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        let lines = lines.unwrap_or(4000) as usize;
        let value = try_windows_terminal_host_command(WindowsTerminalHostCommand::Attach { chat_id, lines })?;
        serde_json::from_value(value).map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (chat_id, lines);
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_drain(
    chat_id: String,
) -> Result<PersistentTerminalSnapshot, String> {
    #[cfg(target_os = "windows")]
    {
        let value = try_windows_terminal_host_command(WindowsTerminalHostCommand::Drain { chat_id })?;
        serde_json::from_value(value).map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = chat_id;
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_capture(
    chat_id: String,
    lines: Option<u32>,
) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
        let lines = lines.unwrap_or(50) as usize;
        let value = try_windows_terminal_host_command(WindowsTerminalHostCommand::Capture { chat_id, lines })?;
        serde_json::from_value(value).map_err(|error| error.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (chat_id, lines);
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_write(
    chat_id: String,
    data: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        try_windows_terminal_host_command(WindowsTerminalHostCommand::Write { chat_id, data }).map(|_| ())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (chat_id, data);
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_resize(
    chat_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        try_windows_terminal_host_command(WindowsTerminalHostCommand::Resize {
            chat_id,
            cols,
            rows,
        })
        .map(|_| ())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (chat_id, cols, rows);
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_kill(
    chat_id: String,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        try_windows_terminal_host_command(WindowsTerminalHostCommand::Kill { chat_id }).map(|_| ())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = chat_id;
        Err("Persistent terminal sessions are only available on Windows.".to_string())
    }
}

#[tauri::command]
pub(crate) fn persistent_terminal_session_ids() -> Vec<String> {
    #[cfg(target_os = "windows")]
    {
        try_windows_terminal_host_command(WindowsTerminalHostCommand::SessionIds)
            .ok()
            .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok())
            .unwrap_or_default()
    }

    #[cfg(not(target_os = "windows"))]
    {
        Vec::new()
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
