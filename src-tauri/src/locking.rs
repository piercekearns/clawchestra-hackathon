//! locking.rs — Filesystem-based mutation locking.
//!
//! Extracted from lib.rs (Phase 1.3). Provides the create-new file lock
//! pattern used for serializing Clawchestra's own writes. This is NOT
//! a cooperative lock with agents (see D1 in the plan) — agents write
//! files via their tool infrastructure which does not call any lock API.
//!
//! The lock uses `OpenOptions::create_new(true)` (atomic file creation)
//! with PID+timestamp stale detection. Cross-platform (no flock on Windows).

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use super::{append_hardening_log, unix_timestamp_secs, app_support_dir};

/// Default timeout for acquiring the mutation lock (milliseconds).
pub(crate) const MUTATION_LOCK_TIMEOUT_MS: u64 = 5_000;
/// Default stale threshold for lock files (seconds).
pub(crate) const MUTATION_LOCK_STALE_SECS: u64 = 300;

/// RAII guard that removes the lock file on drop.
#[derive(Debug)]
pub(crate) struct MutationLockGuard {
    path: PathBuf,
}

impl Drop for MutationLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Acquire a mutation lock at the given path using the create-new file pattern.
///
/// - `lock_path`: The path to the lock file (e.g., `.clawchestra/state.json.lock`).
/// - `timeout`: Maximum time to wait for the lock before failing.
/// - `stale_after`: If the lock file is older than this, it is considered stale and removed.
///
/// Returns a `MutationLockGuard` that releases the lock on drop.
pub(crate) fn acquire_mutation_lock_at(
    lock_path: &Path,
    timeout: Duration,
    stale_after: Duration,
) -> Result<MutationLockGuard, String> {
    if let Some(parent) = lock_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let start = Instant::now();
    loop {
        match OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(lock_path)
        {
            Ok(mut file) => {
                let _ = writeln!(
                    file,
                    "pid={} at={}",
                    std::process::id(),
                    unix_timestamp_secs()
                );
                return Ok(MutationLockGuard {
                    path: lock_path.to_path_buf(),
                });
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let stale = fs::metadata(lock_path)
                    .and_then(|meta| meta.modified())
                    .ok()
                    .and_then(|modified| modified.elapsed().ok())
                    .is_some_and(|elapsed| elapsed >= stale_after);

                if stale {
                    let _ = fs::remove_file(lock_path);
                    append_hardening_log(
                        "stale_mutation_lock_removed",
                        &format!("lock_path={}", lock_path.to_string_lossy()),
                    );
                    continue;
                }

                if start.elapsed() >= timeout {
                    return Err(
                        "mutationLocked: another write operation is in progress. retry shortly"
                            .to_string(),
                    );
                }
                thread::sleep(Duration::from_millis(50));
            }
            Err(error) => {
                return Err(format!(
                    "Failed to acquire mutation lock at `{}`: {}",
                    lock_path.to_string_lossy(),
                    error
                ));
            }
        }
    }
}

/// Acquire the global catalog mutation lock.
pub(crate) fn acquire_mutation_lock() -> Result<MutationLockGuard, String> {
    let lock_path = app_support_dir()?.join("catalog-mutation.lock");
    acquire_mutation_lock_at(
        &lock_path,
        Duration::from_millis(MUTATION_LOCK_TIMEOUT_MS),
        Duration::from_secs(MUTATION_LOCK_STALE_SECS),
    )
}

/// Sweep stale branch-sync lock files.
///
/// Reads `{app_support_dir}/branch-sync-locks/` and removes any `.lock` file
/// whose PID is no longer alive. Called at sync entry points to prevent
/// leftover locks from blocking future syncs.
pub(crate) fn sweep_stale_branch_sync_locks() {
    let locks_dir = match app_support_dir() {
        Ok(d) => d.join("branch-sync-locks"),
        Err(_) => return,
    };
    let entries = match fs::read_dir(&locks_dir) {
        Ok(e) => e,
        Err(_) => return, // Directory doesn't exist — nothing to sweep
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("lock") {
            continue;
        }
        // Read PID from file content (format: "pid=12345 at=...")
        let content = match fs::read_to_string(&path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let pid = content
            .split_whitespace()
            .find_map(|token| {
                token.strip_prefix("pid=")?.parse::<i32>().ok()
            });
        if let Some(pid) = pid {
            if !crate::util::is_pid_alive(pid) {
                let _ = fs::remove_file(&path);
                append_hardening_log(
                    "stale_branch_sync_lock_removed",
                    &format!("lock_path={} dead_pid={}", path.display(), pid),
                );
            }
        }
    }
}

/// Execute an action while holding the global mutation lock.
///
/// Acquires the lock, runs `action`, releases the lock on drop.
/// Logs failures to the hardening log.
pub(crate) fn with_mutation_lock<T>(
    operation: &str,
    action: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let _guard = acquire_mutation_lock()?;
    let result = action();
    if let Err(error) = &result {
        append_hardening_log(
            "mutation_failed",
            &format!("operation={} error={}", operation, error),
        );
    }
    result
}
