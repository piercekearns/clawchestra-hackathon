use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};

use crate::{
    app_support_dir, append_hardening_log, expand_tilde, normalize_path, unix_timestamp_secs,
};

// -------------------------------------------------------------------------
// Types
// -------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirtyFileEntry {
    pub path: String,
    /// Git status: "modified", "added", "deleted", "renamed", "untracked"
    pub status: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirtyFileCategories {
    pub metadata: Vec<DirtyFileEntry>,
    pub documents: Vec<DirtyFileEntry>,
    pub code: Vec<DirtyFileEntry>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStatus {
    state: String,
    branch: Option<String>,
    details: Option<String>,
    remote: Option<String>,
    // New fields for local git intelligence
    last_commit_date: Option<String>,
    last_commit_message: Option<String>,
    last_commit_author: Option<String>,
    commits_this_week: Option<u32>,
    latest_tag: Option<String>,
    stash_count: u32,
    ahead_count: Option<u32>,
    behind_count: Option<u32>,
    /// True when any files in the repo have uncommitted changes
    has_dirty_files: bool,
    /// All dirty files categorized into metadata/documents/code
    all_dirty_files: DirtyFileCategories,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitBranchState {
    name: String,
    is_current: bool,
    has_upstream: bool,
    ahead_count: u32,
    behind_count: u32,
    diverged: bool,
    local_only: bool,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitStashResult {
    stashed: bool,
    stash_ref: Option<String>,
    summary: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitCherryPickResult {
    /// "applied" | "conflict" | "failed"
    status: String,
    message: String,
    conflicting_files: Vec<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitConflictFileContext {
    path: String,
    current_content: String,
    ours_content: String,
    theirs_content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitConflictResolutionInput {
    path: String,
    content: String,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitConflictApplyResult {
    /// "applied" | "conflict" | "failed"
    status: String,
    message: String,
    conflicting_files: Vec<String>,
    hash: Option<String>,
}

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GitResumeValidation {
    pub valid: bool,
    pub reasons: Vec<String>,
    pub current_branch: Option<String>,
    pub missing_targets: Vec<String>,
    pub cherry_pick_in_progress: bool,
    pub unresolved_conflicts: bool,
}

static BRANCH_SYNC_LOCKS: Lazy<Mutex<HashMap<String, String>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));
const BRANCH_SYNC_LOCK_STALE_SECS: u64 = 60 * 60 * 4;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepoProbe {
    is_git_repo: bool,
    git_branch: Option<String>,
    git_remote: Option<String>,
    is_working_tree_dirty: Option<bool>,
    dirty_paths: Vec<String>,
}

/// File category for dirty-file classification.
/// CROSS-REFERENCE: The TypeScript mirror lives in src/lib/git-sync-utils.ts
/// (METADATA_FILES, DOCUMENT_FILES, DOCUMENT_DIR_PREFIXES). Keep in sync.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileCategory {
    Metadata,
    Documents,
    Code,
}

/// Metadata files: Clawchestra-exclusive structural state (CLAWCHESTRA.md preferred, PROJECT.md legacy)
const METADATA_FILES: &[&str] = &["CLAWCHESTRA.md", "PROJECT.md"];

/// Document file names (exact match) -- planning artifacts with external relevance
/// NOTE: ROADMAP.md and CHANGELOG.md removed post-migration (data lives in .clawchestra/state.json and db.json now)
const DOCUMENT_FILES: &[&str] = &[];
/// Document directory prefixes (recursive match)
const DOCUMENT_DIR_PREFIXES: &[&str] = &["roadmap/", "docs/specs/", "docs/plans/"];

// -------------------------------------------------------------------------
// Git execution helpers
// -------------------------------------------------------------------------

pub(crate) fn run_git(repo_path: &str, args: &[&str]) -> Result<String, String> {
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

/// Like `run_git` but only trims trailing whitespace, preserving leading
/// spaces that are significant in column-formatted output (e.g. `git status --porcelain`).
fn run_git_preserving_columns(repo_path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim_end()
            .to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

#[derive(Debug)]
pub(crate) struct GitCommandOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

pub(crate) fn run_git_capture(repo_path: &str, args: &[&str]) -> Result<GitCommandOutput, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    Ok(GitCommandOutput {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).trim().to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).trim().to_string(),
    })
}

pub(crate) fn combine_git_output(output: &GitCommandOutput) -> String {
    match (output.stdout.is_empty(), output.stderr.is_empty()) {
        (true, true) => String::new(),
        (false, true) => output.stdout.clone(),
        (true, false) => output.stderr.clone(),
        (false, false) => format!("{}\n{}", output.stdout, output.stderr),
    }
}

// -------------------------------------------------------------------------
// Branch sync lock helpers
// -------------------------------------------------------------------------

fn branch_sync_lock_file_path(normalized_repo_path: &str) -> Result<PathBuf, String> {
    let mut hasher = DefaultHasher::new();
    normalized_repo_path.hash(&mut hasher);
    let lock_id = format!("{:016x}", hasher.finish());
    let lock_dir = app_support_dir()?.join("branch-sync-locks");
    fs::create_dir_all(&lock_dir).map_err(|error| error.to_string())?;
    Ok(lock_dir.join(format!("{lock_id}.lock")))
}

fn parse_lock_pid(lock_path: &Path) -> Option<i32> {
    fs::read_to_string(lock_path).ok().and_then(|content| {
        content.lines().find_map(|line| {
            line.strip_prefix("pid=")
                .and_then(|value| value.trim().parse::<i32>().ok())
        })
    })
}

fn parse_lock_token(lock_path: &Path) -> Option<String> {
    fs::read_to_string(lock_path).ok().and_then(|content| {
        content.lines().find_map(|line| {
            line.strip_prefix("token=")
                .map(|value| value.trim().to_string())
        })
    })
}

fn new_branch_sync_lock_token() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("bsl-{}-{}", std::process::id(), nanos)
}

use crate::util::is_pid_alive;

fn is_branch_sync_file_lock_stale(lock_path: &Path) -> bool {
    let elapsed = fs::metadata(lock_path)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|modified| modified.elapsed().ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(BRANCH_SYNC_LOCK_STALE_SECS + 1);

    if elapsed >= BRANCH_SYNC_LOCK_STALE_SECS {
        return true;
    }

    #[cfg(unix)]
    {
        parse_lock_pid(lock_path)
            .map(|pid| !is_pid_alive(pid))
            .unwrap_or(true)
    }
    #[cfg(not(unix))]
    {
        // Non-unix: treat recent lock as active and rely on age for staleness.
        false
    }
}

// -------------------------------------------------------------------------
// Dirty file parsing & categorization
// -------------------------------------------------------------------------

/// Parse porcelain status into (path, status_label) pairs.
pub(crate) fn parse_dirty_entries(status_porcelain: &str) -> Vec<(String, &'static str)> {
    let mut seen = HashSet::new();
    let mut entries = Vec::new();

    for line in status_porcelain.lines() {
        if line.len() < 4 {
            continue;
        }
        let xy = &line[..2];
        let trimmed = line[3..].trim();
        let path = trimmed
            .split(" -> ")
            .last()
            .unwrap_or(trimmed)
            .trim()
            .to_string();
        if path.is_empty() || !seen.insert(path.clone()) {
            continue;
        }
        let status = match xy.trim() {
            "M" | "MM" | "AM" => "modified",
            "A" => "added",
            "D" => "deleted",
            "R" | "RM" => "renamed",
            "??" => "untracked",
            "C" => "copied",
            _ => "modified", // safe default for uncommon statuses
        };
        entries.push((path, status));
    }

    entries
}

pub(crate) fn parse_dirty_paths(status_porcelain: &str) -> Vec<String> {
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

/// Categorize a dirty file path into metadata, documents, or code.
///
/// NOTE: Also used by check_for_update() to decide whether commits warrant
/// an update prompt. Adding paths to DOCUMENT_FILES or DOCUMENT_DIR_PREFIXES
/// will suppress update notifications for changes limited to those paths.
pub(crate) fn categorize_dirty_file(path: &str) -> FileCategory {
    if METADATA_FILES.contains(&path) {
        return FileCategory::Metadata;
    }
    if DOCUMENT_FILES.contains(&path)
        || DOCUMENT_DIR_PREFIXES
            .iter()
            .any(|prefix| path.starts_with(prefix))
    {
        return FileCategory::Documents;
    }
    FileCategory::Code
}

/// Categorize all dirty entries into the three-category struct.
/// Takes ownership to avoid cloning each path.
pub(crate) fn categorize_all_dirty_files(entries: Vec<(String, &str)>) -> DirtyFileCategories {
    let mut metadata = Vec::new();
    let mut documents = Vec::new();
    let mut code = Vec::new();

    for (path, status) in entries {
        let entry = DirtyFileEntry {
            status: status.to_string(),
            path: path.clone(),
        };
        match categorize_dirty_file(&path) {
            FileCategory::Metadata => metadata.push(entry),
            FileCategory::Documents => documents.push(entry),
            FileCategory::Code => code.push(entry),
        }
    }

    DirtyFileCategories {
        metadata,
        documents,
        code,
    }
}

// -------------------------------------------------------------------------
// Validation helpers
// -------------------------------------------------------------------------

fn validate_branch_name(repo_path: &str, branch: &str) -> Result<(), String> {
    if branch.trim().is_empty() {
        return Err("Branch name cannot be empty".to_string());
    }
    run_git(repo_path, &["check-ref-format", "--branch", branch])
        .map(|_| ())
        .map_err(|error| format!("Invalid branch name `{}`: {}", branch, error))
}

fn branch_upstream(repo_path: &str, branch: &str) -> Option<String> {
    run_git(
        repo_path,
        &[
            "rev-parse",
            "--abbrev-ref",
            "--symbolic-full-name",
            &format!("{branch}@{{upstream}}"),
        ],
    )
    .ok()
}

fn rev_count(repo_path: &str, range: &str) -> u32 {
    run_git(repo_path, &["rev-list", "--count", range])
        .ok()
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(0)
}

fn validate_commit_hash(repo_path: &str, commit_hash: &str) -> Result<(), String> {
    let candidate = commit_hash.trim();
    if candidate.is_empty() {
        return Err("Commit hash cannot be empty".to_string());
    }
    run_git(
        repo_path,
        &["rev-parse", "--verify", &format!("{candidate}^{{commit}}")],
    )
    .map(|_| ())
    .map_err(|error| format!("Invalid commit hash `{}`: {}", candidate, error))
}

fn unresolved_conflict_files(repo_path: &str) -> Vec<String> {
    run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])
        .unwrap_or_default()
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>()
}

fn git_show_stage_content(repo_path: &str, stage: u8, path: &str) -> String {
    run_git_capture(repo_path, &["show", &format!(":{stage}:{path}")])
        .map(|output| output.stdout)
        .unwrap_or_default()
}

/// Validate a repo-relative file path for safety.
/// Rejects absolute paths, directory traversal, and empty strings.
pub(crate) fn validate_commit_path(path: &str) -> Result<(), String> {
    if path.is_empty() {
        return Err("Empty file path".to_string());
    }
    if path.starts_with('/') || path.starts_with('\\') {
        return Err(format!("Absolute path not allowed: {}", path));
    }
    if path.contains("..") {
        return Err(format!("Path traversal not allowed: {}", path));
    }
    // Reject backslashes (prevent Windows-style path confusion)
    if path.contains('\\') {
        return Err(format!("Invalid characters in path: {}", path));
    }
    // Reject paths with null bytes
    if path.contains('\0') {
        return Err(format!("Invalid characters in path: {}", path));
    }
    Ok(())
}

// -------------------------------------------------------------------------
// Tauri commands
// -------------------------------------------------------------------------

#[tauri::command]
pub(crate) fn probe_repo(repo_path: String) -> Result<RepoProbe, String> {
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
    let status_porcelain =
        run_git_preserving_columns(&repo_str, &["status", "--porcelain"]).unwrap_or_default();
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
pub(crate) fn get_git_status(repo_path: String) -> Result<GitStatus, String> {
    let branch = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let remote = run_git(&repo_path, &["config", "--get", "remote.origin.url"]).ok();
    let status_porcelain =
        run_git_preserving_columns(&repo_path, &["status", "--porcelain"]).unwrap_or_default();

    // Collect enriched git data (combined log query: date, subject, author)
    let (last_commit_date, last_commit_message, last_commit_author) =
        match run_git(&repo_path, &["log", "-1", "--format=%aI%n%s%n%an"]) {
            Ok(output) => {
                let lines: Vec<&str> = output.splitn(3, '\n').collect();
                (
                    lines.first().map(|s| s.to_string()),
                    lines.get(1).map(|s| s.to_string()),
                    lines.get(2).map(|s| s.to_string()),
                )
            }
            Err(_) => (None, None, None),
        };

    let commits_this_week = run_git(
        &repo_path,
        &["rev-list", "--count", "--since=7 days ago", "HEAD"],
    )
    .ok()
    .and_then(|s| s.parse::<u32>().ok());

    let latest_tag = run_git(&repo_path, &["describe", "--tags", "--abbrev=0"]).ok();

    let stash_count = run_git(&repo_path, &["stash", "list"])
        .map(|s| {
            if s.is_empty() {
                0
            } else {
                s.lines().count() as u32
            }
        })
        .unwrap_or(0);

    // Always compute ahead/behind when upstream exists (needed for Sync Dialog branch awareness)
    let has_upstream = run_git(
        &repo_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .is_ok();

    let (ahead_count, behind_count) = if has_upstream {
        let behind = run_git(&repo_path, &["rev-list", "--count", "HEAD..@{u}"])
            .unwrap_or_else(|_| "0".to_string())
            .parse::<u32>()
            .unwrap_or(0);
        let ahead = run_git(&repo_path, &["rev-list", "--count", "@{u}..HEAD"])
            .unwrap_or_else(|_| "0".to_string())
            .parse::<u32>()
            .unwrap_or(0);
        (Some(ahead), Some(behind))
    } else {
        (None, None)
    };

    // Determine state
    let (state, details) = if !status_porcelain.is_empty() {
        (
            "uncommitted".to_string(),
            Some("Repository has uncommitted changes".to_string()),
        )
    } else if !has_upstream {
        (
            "clean".to_string(),
            Some("No upstream configured".to_string()),
        )
    } else {
        let behind = behind_count.unwrap_or(0);
        let ahead = ahead_count.unwrap_or(0);
        if behind > 0 {
            (
                "behind".to_string(),
                Some(format!("Behind upstream by {} commit(s)", behind)),
            )
        } else if ahead > 0 {
            (
                "unpushed".to_string(),
                Some(format!("Ahead of upstream by {} commit(s)", ahead)),
            )
        } else {
            ("clean".to_string(), Some("Working tree clean".to_string()))
        }
    };

    // Parse all dirty files once, then categorize (takes ownership to avoid cloning)
    let all_entries = parse_dirty_entries(&status_porcelain);
    let has_dirty_files = !all_entries.is_empty();
    let all_dirty_files = categorize_all_dirty_files(all_entries);

    Ok(GitStatus {
        state,
        branch,
        details,
        remote,
        last_commit_date,
        last_commit_message,
        last_commit_author,
        commits_this_week,
        latest_tag,
        stash_count,
        ahead_count,
        behind_count,
        has_dirty_files,
        all_dirty_files,
    })
}

#[tauri::command]
pub(crate) fn git_fetch(repo_path: String) -> Result<String, String> {
    run_git(&repo_path, &["fetch", "origin"])
}

#[tauri::command]
pub(crate) fn git_get_branch_states(repo_path: String) -> Result<Vec<GitBranchState>, String> {
    let current_branch = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();
    let all_branches = run_git(
        &repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )?;

    let mut states: Vec<GitBranchState> = all_branches
        .lines()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| {
            let upstream = branch_upstream(&repo_path, name);
            let (ahead_count, behind_count) = if let Some(upstream_ref) = upstream.as_deref() {
                (
                    rev_count(&repo_path, &format!("{upstream_ref}..{name}")),
                    rev_count(&repo_path, &format!("{name}..{upstream_ref}")),
                )
            } else {
                (0, 0)
            };
            let has_upstream = upstream.is_some();
            GitBranchState {
                name: name.to_string(),
                is_current: current_branch
                    .as_deref()
                    .map(|current| current == name)
                    .unwrap_or(false),
                has_upstream,
                ahead_count,
                behind_count,
                diverged: ahead_count > 0 && behind_count > 0,
                local_only: !has_upstream,
            }
        })
        .collect();

    states.sort_by(|left, right| {
        right
            .is_current
            .cmp(&left.is_current)
            .then_with(|| left.name.cmp(&right.name))
    });

    Ok(states)
}

#[tauri::command]
pub(crate) fn git_sync_lock_acquire(repo_path: String) -> Result<String, String> {
    let normalized = normalize_path(&repo_path)?;
    // Sweep stale locks from previous crashes before acquiring
    crate::locking::sweep_stale_branch_sync_locks();
    let lock_path = branch_sync_lock_file_path(&normalized)?;
    let token = new_branch_sync_lock_token();

    if lock_path.exists() && is_branch_sync_file_lock_stale(&lock_path) {
        let _ = fs::remove_file(&lock_path);
        append_hardening_log(
            "stale_branch_sync_lock_removed",
            &format!("repo={} lock={}", normalized, lock_path.to_string_lossy()),
        );
    }

    {
        let guard = BRANCH_SYNC_LOCKS
            .lock()
            .map_err(|_| "branchSyncLockPoisoned".to_string())?;
        if guard.contains_key(&normalized) {
            return Err("branchSyncLocked: another branch sync is already running".to_string());
        }
    }

    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&lock_path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "branchSyncLocked: another branch sync is already running".to_string()
            } else {
                format!(
                    "branchSyncLockFailed: could not create lock `{}`: {}",
                    lock_path.to_string_lossy(),
                    error
                )
            }
        })?;
    let _ = writeln!(file, "pid={}", std::process::id());
    let _ = writeln!(file, "token={}", token);
    let _ = writeln!(file, "repo={}", normalized);
    let _ = writeln!(file, "at={}", unix_timestamp_secs());

    let mut guard = BRANCH_SYNC_LOCKS
        .lock()
        .map_err(|_| "branchSyncLockPoisoned".to_string())?;
    if guard.contains_key(&normalized) {
        let _ = fs::remove_file(&lock_path);
        return Err("branchSyncLocked: another branch sync is already running".to_string());
    }
    guard.insert(normalized, token.clone());
    Ok(token)
}

#[tauri::command]
pub(crate) fn git_sync_lock_release(repo_path: String, token: String) -> Result<(), String> {
    let normalized = normalize_path(&repo_path)?;
    let lock_path = branch_sync_lock_file_path(&normalized)?;
    let mut guard = BRANCH_SYNC_LOCKS
        .lock()
        .map_err(|_| "branchSyncLockPoisoned".to_string())?;

    if token.trim().is_empty() {
        return Err("branchSyncLockTokenMissing".to_string());
    }

    if let Some(in_memory_token) = guard.get(&normalized) {
        if in_memory_token != &token {
            return Err("branchSyncLockTokenMismatch".to_string());
        }
    } else if lock_path.exists() {
        let on_disk_token = parse_lock_token(&lock_path);
        if on_disk_token.as_deref() != Some(token.as_str()) {
            return Err("branchSyncLockTokenMismatch".to_string());
        }
    } else {
        return Ok(());
    }

    guard.remove(&normalized);
    if lock_path.exists() {
        let on_disk_token = parse_lock_token(&lock_path);
        if on_disk_token.as_deref() == Some(token.as_str()) {
            let _ = fs::remove_file(&lock_path);
        } else {
            return Err("branchSyncLockTokenMismatch".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub(crate) fn git_checkout_branch(repo_path: String, branch: String) -> Result<(), String> {
    validate_branch_name(&repo_path, &branch)?;
    run_git(&repo_path, &["checkout", &branch])
        .map(|_| ())
        .map_err(|error| format!("git checkout failed for `{}`: {}", branch, error))
}

#[tauri::command]
pub(crate) fn git_stash_push(
    repo_path: String,
    include_untracked: bool,
    message: Option<String>,
) -> Result<GitStashResult, String> {
    let mut args: Vec<String> = vec!["stash".to_string(), "push".to_string()];
    if include_untracked {
        args.push("--include-untracked".to_string());
    }
    if let Some(value) = message
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        args.push("-m".to_string());
        args.push(value.to_string());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let output = run_git_capture(&repo_path, &arg_refs)?;
    let summary = combine_git_output(&output);
    if !output.success {
        return Err(format!("git stash push failed: {}", summary));
    }
    let stashed = !summary.contains("No local changes to save");
    Ok(GitStashResult {
        stashed,
        stash_ref: if stashed {
            Some("stash@{0}".to_string())
        } else {
            None
        },
        summary: if summary.is_empty() {
            "Stash completed".to_string()
        } else {
            summary
        },
    })
}

#[tauri::command]
pub(crate) fn git_pop_stash(repo_path: String, stash_ref: Option<String>) -> Result<(), String> {
    let reference = stash_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("stash@{0}")
        .to_string();
    // Validate stash ref format to prevent command injection -- must be stash@{N}
    if !reference.starts_with("stash@{") || !reference.ends_with('}') {
        return Err(format!("Invalid stash reference: `{}`", reference));
    }
    let output = run_git_capture(&repo_path, &["stash", "pop", &reference])?;
    if output.success {
        Ok(())
    } else {
        Err(format!(
            "git stash pop failed for `{}`: {}",
            reference,
            combine_git_output(&output)
        ))
    }
}

#[tauri::command]
pub(crate) fn git_cherry_pick_commit(
    repo_path: String,
    commit_hash: String,
) -> Result<GitCherryPickResult, String> {
    validate_commit_hash(&repo_path, &commit_hash)?;
    let output = run_git_capture(&repo_path, &["cherry-pick", "--no-edit", &commit_hash])?;
    let message = combine_git_output(&output);
    if output.success {
        return Ok(GitCherryPickResult {
            status: "applied".to_string(),
            message,
            conflicting_files: vec![],
        });
    }

    let cherry_pick_head_exists = Path::new(&repo_path).join(".git/CHERRY_PICK_HEAD").exists();
    let conflicting_files = unresolved_conflict_files(&repo_path);

    if cherry_pick_head_exists || !conflicting_files.is_empty() {
        Ok(GitCherryPickResult {
            status: "conflict".to_string(),
            message,
            conflicting_files,
        })
    } else {
        Ok(GitCherryPickResult {
            status: "failed".to_string(),
            message,
            conflicting_files: vec![],
        })
    }
}

#[tauri::command]
pub(crate) fn git_abort_cherry_pick(repo_path: String) -> Result<(), String> {
    let cherry_pick_head_exists = Path::new(&repo_path).join(".git/CHERRY_PICK_HEAD").exists();
    if !cherry_pick_head_exists {
        return Ok(());
    }
    run_git(&repo_path, &["cherry-pick", "--abort"])
        .map(|_| ())
        .map_err(|error| format!("git cherry-pick --abort failed: {}", error))
}

#[tauri::command]
pub(crate) fn git_pull_current(repo_path: String) -> Result<(), String> {
    let has_upstream = run_git(
        &repo_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .is_ok();
    if !has_upstream {
        return Err("Current branch has no upstream configured".to_string());
    }
    let output = run_git_capture(&repo_path, &["pull", "--ff-only"])?;
    if output.success {
        Ok(())
    } else {
        Err(format!("git pull failed: {}", combine_git_output(&output)))
    }
}

#[tauri::command]
pub(crate) fn git_get_conflict_context(
    repo_path: String,
) -> Result<Vec<GitConflictFileContext>, String> {
    let files = unresolved_conflict_files(&repo_path);
    let contexts = files
        .iter()
        .map(|path| {
            let absolute_path = Path::new(&repo_path).join(path);
            let current_content = fs::read_to_string(&absolute_path).unwrap_or_default();
            GitConflictFileContext {
                path: path.to_string(),
                current_content,
                ours_content: git_show_stage_content(&repo_path, 2, path),
                theirs_content: git_show_stage_content(&repo_path, 3, path),
            }
        })
        .collect::<Vec<_>>();
    Ok(contexts)
}

#[tauri::command]
pub(crate) fn git_apply_conflict_resolution(
    repo_path: String,
    resolutions: Vec<GitConflictResolutionInput>,
) -> Result<GitConflictApplyResult, String> {
    if resolutions.is_empty() {
        return Err("No conflict resolutions supplied".to_string());
    }

    let mut staged_paths: Vec<String> = Vec::with_capacity(resolutions.len());
    for resolution in resolutions {
        validate_commit_path(&resolution.path)?;
        let absolute = Path::new(&repo_path).join(&resolution.path);
        if let Some(parent) = absolute.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::write(&absolute, resolution.content).map_err(|error| {
            format!(
                "Failed writing resolved file `{}`: {}",
                absolute.to_string_lossy(),
                error
            )
        })?;
        staged_paths.push(resolution.path);
    }

    let mut add_command = Command::new("git");
    add_command
        .arg("-C")
        .arg(&repo_path)
        .arg("add")
        .arg("--")
        .args(staged_paths.iter());
    let add_output = add_command.output().map_err(|error| error.to_string())?;
    if !add_output.status.success() {
        return Err(format!(
            "git add failed during conflict apply: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        ));
    }

    // GIT_EDITOR=true prevents the editor from opening when user's .gitconfig
    // has commit.verbose=true or similar -- without this, cherry-pick --continue
    // would hang waiting for an interactive editor.
    let continue_raw = Command::new("git")
        .arg("-C")
        .arg(&repo_path)
        .args(["cherry-pick", "--continue"])
        .env("GIT_EDITOR", "true")
        .output()
        .map_err(|error| error.to_string())?;
    let continue_output = GitCommandOutput {
        success: continue_raw.status.success(),
        stdout: String::from_utf8_lossy(&continue_raw.stdout)
            .trim()
            .to_string(),
        stderr: String::from_utf8_lossy(&continue_raw.stderr)
            .trim()
            .to_string(),
    };
    if continue_output.success {
        let hash = run_git(&repo_path, &["rev-parse", "--short", "HEAD"]).ok();
        return Ok(GitConflictApplyResult {
            status: "applied".to_string(),
            message: combine_git_output(&continue_output),
            conflicting_files: vec![],
            hash,
        });
    }

    let conflicts = unresolved_conflict_files(&repo_path);
    let still_in_cherry_pick = Path::new(&repo_path).join(".git/CHERRY_PICK_HEAD").exists();
    if still_in_cherry_pick || !conflicts.is_empty() {
        Ok(GitConflictApplyResult {
            status: "conflict".to_string(),
            message: combine_git_output(&continue_output),
            conflicting_files: conflicts,
            hash: None,
        })
    } else {
        Ok(GitConflictApplyResult {
            status: "failed".to_string(),
            message: combine_git_output(&continue_output),
            conflicting_files: vec![],
            hash: None,
        })
    }
}

#[tauri::command]
pub(crate) fn git_validate_branch_sync_resume(
    repo_path: String,
    source_branch: String,
    commit_hash: String,
    remaining_targets: Vec<String>,
) -> Result<GitResumeValidation, String> {
    // Validate inputs before using them in git commands
    validate_branch_name(&repo_path, &source_branch)?;
    for target in &remaining_targets {
        validate_branch_name(&repo_path, target)?;
    }

    let mut reasons: Vec<String> = vec![];
    let current_branch = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"]).ok();

    if current_branch
        .as_deref()
        .map(|branch| branch != source_branch)
        .unwrap_or(true)
    {
        reasons.push(format!(
            "Current branch does not match source branch `{}`",
            source_branch
        ));
    }

    if run_git(
        &repo_path,
        &[
            "rev-parse",
            "--verify",
            &format!("{}^{{commit}}", commit_hash),
        ],
    )
    .is_err()
    {
        reasons.push(format!("Commit `{}` is no longer available", commit_hash));
    }

    let missing_targets = remaining_targets
        .iter()
        .filter_map(|target| {
            run_git(
                &repo_path,
                &["show-ref", "--verify", &format!("refs/heads/{target}")],
            )
            .err()
            .map(|_| target.to_string())
        })
        .collect::<Vec<_>>();
    if !missing_targets.is_empty() {
        reasons.push(format!(
            "Some target branches are missing: {}",
            missing_targets.join(", ")
        ));
    }

    let cherry_pick_in_progress = Path::new(&repo_path).join(".git/CHERRY_PICK_HEAD").exists();
    if cherry_pick_in_progress {
        reasons.push("A cherry-pick is already in progress".to_string());
    }

    let unresolved_conflicts = !unresolved_conflict_files(&repo_path).is_empty();
    if unresolved_conflicts {
        reasons.push("Repository has unresolved conflicts".to_string());
    }

    Ok(GitResumeValidation {
        valid: reasons.is_empty(),
        reasons,
        current_branch,
        missing_targets,
        cherry_pick_in_progress,
        unresolved_conflicts,
    })
}

#[tauri::command]
pub(crate) fn git_commit(
    repo_path: String,
    message: String,
    files: Vec<String>,
) -> Result<String, String> {
    if files.is_empty() {
        return Err("No files supplied for commit".to_string());
    }

    // Validate repo_path is a directory containing a git repo
    let repo = std::path::Path::new(&repo_path);
    if !repo.is_dir() {
        return Err("repo_path is not a directory".to_string());
    }
    if !repo.join(".git").exists() {
        return Err("repo_path is not a git repository".to_string());
    }

    // Path safety: reject absolute paths, traversal, empty, null bytes
    for file in &files {
        validate_commit_path(file)?;
    }

    // Snapshot validation: only commit files that are actually dirty right now.
    // This prevents committing arbitrary files that weren't in the dirty snapshot.
    let status_porcelain =
        run_git_preserving_columns(&repo_path, &["status", "--porcelain"]).unwrap_or_default();
    let currently_dirty: HashSet<String> =
        parse_dirty_paths(&status_porcelain).into_iter().collect();
    for file in &files {
        if !currently_dirty.contains(file.as_str()) {
            return Err(format!(
                "File is not in the current dirty snapshot: {}",
                file
            ));
        }
    }

    let mut add_cmd = Command::new("git");
    add_cmd
        .arg("-C")
        .arg(&repo_path)
        .arg("add")
        .arg("--")
        .args(files.iter());
    let add_output = add_cmd.output().map_err(|error| error.to_string())?;

    if !add_output.status.success() {
        return Err(format!(
            "git add failed: {}",
            String::from_utf8_lossy(&add_output.stderr).trim()
        ));
    }

    let commit_output = run_git(&repo_path, &["commit", "-m", &message]);
    match commit_output {
        Ok(_) => {
            // Return the short commit hash
            let hash = run_git(&repo_path, &["rev-parse", "--short", "HEAD"])
                .unwrap_or_else(|_| "unknown".to_string());
            Ok(hash)
        }
        Err(error) => {
            if error.contains("nothing to commit") {
                let hash = run_git(&repo_path, &["rev-parse", "--short", "HEAD"])
                    .unwrap_or_else(|_| "unchanged".to_string());
                Ok(hash)
            } else {
                Err(format!("git commit failed: {}", error))
            }
        }
    }
}

#[tauri::command]
pub(crate) fn git_push(repo_path: String) -> Result<(), String> {
    run_git(&repo_path, &["push"])
        .map(|_| ())
        .map_err(|error| format!("git push failed: {}", error))
}

#[tauri::command]
pub(crate) fn git_init_repo(
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
