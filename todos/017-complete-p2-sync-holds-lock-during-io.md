---
status: complete
priority: p2
issue_id: "017"
tags: [code-review, performance, architecture-direction-v2]
dependencies: []
---

# Sync commands hold AppState lock during file I/O

## Problem Statement

Unlike `flush_if_dirty` (which was fixed in #007 to serialize under lock then release before I/O), two sync commands still hold the `tokio::sync::Mutex<AppState>` while performing file reads and writes:

1. **`sync_local_launch`** (lib.rs:1728) — calls `sync_local_on_launch` which reads `db.json` from disk, merges, and writes two copies, all under lock
2. **`sync_merge_remote`** (lib.rs:1747) — serializes the full merged DB under lock for HTTP response, plus `merge_remote_db` writes to disk under the caller's lock

During these operations, all Tauri commands that need AppState are blocked.

## Findings

- `lib.rs:1728-1742` — `sync_local_launch` acquires lock, calls `sync_local_on_launch` which does 2 reads + 2 writes
- `lib.rs:1747-1769` — `sync_merge_remote` serializes merged DB under lock (`serde_json::to_string`)
- `sync.rs:570-633` — `sync_local_on_launch` reads files, merges, calls `flush_db_json` + `write_local_openclaw_db` — all I/O
- Estimated lock hold: 5-50ms depending on DB size (50 projects → ~100KB JSON)
- Frontend impact: blank dashboard during startup sync; UI freeze during remote sync

## Proposed Solutions

### Option A: Clone data under lock, do I/O after release (same pattern as flush_if_dirty fix)
- **Pros:** Proven pattern; minimal architectural change
- **Cons:** Requires cloning merged DbJson (or serializing under lock like flush_if_dirty)
- **Effort:** Medium
- **Risk:** Low

## Technical Details

**Affected files:** `src-tauri/src/lib.rs` (sync_local_launch, sync_merge_remote), `src-tauri/src/sync.rs` (sync_local_on_launch, merge_remote_db)

## Acceptance Criteria

- [ ] No file I/O operations while AppState mutex is held in sync commands
- [ ] `cargo test` — all pass
- [ ] `cargo check` — 0 warnings

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Performance agent |
