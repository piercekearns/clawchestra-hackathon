---
status: pending
priority: p1
issue_id: "002"
tags: [code-review, data-integrity, architecture-direction-v2]
dependencies: []
---

# Dirty flag cleared before I/O completes

## Problem Statement

In `db_persistence.rs:flush_if_dirty()`, the `dirty` flag is set to `false` and the lock is dropped **before** `flush_db_json()` writes to disk. If the write fails (disk full, permissions, etc.), the dirty flag is already cleared, so the data will never be retried — silent data loss.

```rust
// db_persistence.rs:65-75
pub async fn flush_if_dirty(state: &Arc<Mutex<AppState>>) -> Result<(), String> {
    let mut guard = state.lock().await;
    if guard.dirty {
        let db_clone = guard.db.clone();
        guard.dirty = false;    // <-- cleared BEFORE write
        drop(guard);            // <-- lock released
        flush_db_json(&db_clone)?;  // <-- write could fail
    }
    Ok(())
}
```

## Findings

- **Source:** data-integrity-guardian agent, performance-oracle agent
- **Location:** `src-tauri/src/db_persistence.rs:65-75`
- **Impact:** If `flush_db_json` fails, in-memory state believes it's clean (not dirty), and the debounce loop won't retry. Changes are lost.
- **Likelihood:** Low on normal operation, higher when disk is near-full or permissions change.

## Proposed Solutions

### Option A: Re-set dirty flag on failure
Set dirty = false optimistically, but restore it on error.

```rust
pub async fn flush_if_dirty(state: &Arc<Mutex<AppState>>) -> Result<(), String> {
    let db_clone = {
        let mut guard = state.lock().await;
        if !guard.dirty { return Ok(()); }
        guard.dirty = false;
        guard.db.clone()
    };
    if let Err(e) = flush_db_json(&db_clone) {
        let mut guard = state.lock().await;
        guard.dirty = true; // Restore on failure
        return Err(e);
    }
    Ok(())
}
```

**Pros:** Minimal change, retains lock-free I/O pattern.
**Cons:** Brief window where dirty=false but data isn't written (acceptable for desktop app).
**Effort:** Small
**Risk:** Low

### Option B: Only clear dirty after successful write
Hold the lock through the write (simpler but blocks other operations during I/O).

**Pros:** No TOCTOU gap at all.
**Cons:** Lock held during disk I/O could block Tauri commands.
**Effort:** Small
**Risk:** Medium (lock contention)

## Recommended Action
Option A — re-set dirty flag on failure.

## Technical Details
- **Affected files:** `src-tauri/src/db_persistence.rs`
- **Components:** DbFlushHandle debounce loop, flush_if_dirty

## Acceptance Criteria
- [ ] If flush_db_json fails, dirty flag is restored to true
- [ ] Debounce loop retries on next cycle after failure
- [ ] Existing tests still pass

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Found by data-integrity-guardian |

## Resources
- db_persistence.rs:65-75
