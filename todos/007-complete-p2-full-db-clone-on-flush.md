---
status: pending
priority: p2
issue_id: "007"
tags: [code-review, performance, architecture-direction-v2]
dependencies: []
---

# Full DbJson clone on every flush

## Problem Statement

`flush_if_dirty` clones the entire `DbJson` struct to release the lock before doing I/O:

```rust
let db_clone = guard.db.clone();
guard.dirty = false;
drop(guard);
flush_db_json(&db_clone)?;
```

For a desktop app managing dozens of projects, each with roadmap items and per-field `__updatedAt` timestamps, this clone grows with the dataset. The clone happens on every 500ms debounced flush when dirty.

## Findings

- **Source:** performance-oracle
- **Location:** `src-tauri/src/db_persistence.rs:68`
- **Impact:** Memory spike and CPU cost proportional to DB size on every write. Currently manageable but scales poorly.

## Proposed Solutions

### Option A: Serialize under lock, write outside lock
Serialize to a `String` while holding the lock (fast for serde), then write the string outside the lock. No clone needed.

```rust
let serialized = {
    let mut guard = state.lock().await;
    if !guard.dirty { return Ok(()); }
    guard.dirty = false;
    serde_json::to_string_pretty(&guard.db).map_err(|e| e.to_string())?
};
// Write serialized string to disk (no lock held)
```

**Effort:** Small
**Risk:** Low (serialization is fast, lock held slightly longer but for CPU-only work)

### Option B: Leave as-is, monitor
Desktop app with ~50 projects won't have a measurably large DB. Clone cost is negligible.

**Effort:** None
**Risk:** Low for current scale

## Recommended Action
Option A when combined with dirty-flag fix (#002).

## Acceptance Criteria
- [ ] No full DbJson clone during flush
- [ ] Lock only held for serialization, not I/O
- [ ] All tests pass

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Found by performance-oracle |
