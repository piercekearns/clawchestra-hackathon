---
status: pending
priority: p1
issue_id: "003"
tags: [code-review, data-integrity, architecture-direction-v2]
dependencies: []
---

# TOCTOU gap in own-write detection for state.json

## Problem Statement

When the app writes a state.json file, there is a time window between the file hitting disk and the SHA-256 hash being stored in `AppState.content_hashes`. During this window, the file watcher could detect the change, compute the hash, find no matching entry, and treat it as an **external** edit — triggering a spurious merge.

The READ side is atomic (Fix #3 consolidated hash-check + merge into one lock acquisition). But the WRITE side has the gap:
1. `write_state_json` writes file to disk
2. Watcher detects change, reads file, computes hash
3. Watcher checks `content_hashes` — hash not yet stored
4. Watcher treats it as external change, runs merge
5. `write_state_json` finally stores hash in `content_hashes`

## Findings

- **Source:** data-integrity-guardian agent
- **Location:** `src-tauri/src/lib.rs` (write_state_json command) + `src-tauri/src/watcher.rs:310`
- **Impact:** Spurious merge on own writes. Could result in merge warnings or unexpected state resets if the merge logic encounters differences.
- **Likelihood:** Low due to 100ms watcher debounce, but non-zero under load.

## Proposed Solutions

### Option A: Store hash BEFORE writing file
Pre-compute the hash from the serialized content, store it in content_hashes under the lock, then write the file. If the watcher fires, it sees the hash already stored and skips.

**Pros:** Closes the gap completely. Simple change.
**Cons:** If the write fails, the hash is stale (points to content not on disk). Need to remove hash on write failure.
**Effort:** Small
**Risk:** Low

### Option B: Pause watcher during writes
Temporarily suppress watcher events for the specific file path during writes.

**Pros:** Eliminates the race entirely.
**Cons:** Complex — requires watcher coordination, risk of missing real external edits.
**Effort:** Medium
**Risk:** Medium

## Recommended Action
Option A — store hash before writing, remove on failure.

## Technical Details
- **Affected files:** `src-tauri/src/lib.rs` (write_state_json), possibly `src-tauri/src/sync.rs` (write_state_json_sync)
- **Components:** State write path, content hash tracking

## Acceptance Criteria
- [ ] Hash is stored in content_hashes before file write
- [ ] Hash is removed if file write fails
- [ ] Watcher correctly skips own writes even under rapid successive writes
- [ ] Existing tests pass

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Found by data-integrity-guardian |

## Resources
- watcher.rs:309-316 (hash check)
- lib.rs write_state_json command
