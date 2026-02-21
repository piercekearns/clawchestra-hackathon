---
status: complete
priority: p1
issue_id: "013"
tags: [code-review, architecture, performance, architecture-direction-v2]
dependencies: []
---

# block_on + tokio::sync::Mutex deadlock risk in watcher thread

## Problem Statement

The file watcher runs in a `std::thread::spawn` thread and calls `tauri::async_runtime::block_on(async { state.lock().await })` to acquire the `tokio::sync::Mutex<AppState>`. This is the textbook anti-pattern for tokio deadlocks: `block_on` parks a tokio worker thread while waiting for a mutex that may be held by another task on the same worker.

**Flagged by 3 independent agents** (Architecture, Performance, Pattern Recognition).

## Findings

- `watcher.rs:310` — `block_on` acquires mutex for merge (holds through full merge computation)
- `watcher.rs:405` — second `block_on` in error recovery path (hash cleanup on write failure)
- Tauri's default runtime is multi-threaded, which reduces but does not eliminate the risk
- Under load (many agent writes triggering frequent watcher events), the probability of hitting the contention window increases
- The plan explicitly chose `tokio::sync::Mutex` (Phase 2.0) to "avoid blocking the async runtime" — but `block_on` circumvents this

## Proposed Solutions

### Option A: Switch AppState to std::sync::Mutex
- **Pros:** Watcher can lock directly without block_on; simpler mental model
- **Cons:** All async Tauri commands must use `.lock().unwrap()` (blocking); no `.await` on lock
- **Effort:** Medium — cascading change to all 20+ async commands
- **Risk:** Could block the async runtime if a command holds the std mutex too long

### Option B: Spawn merge work as a tokio task from the watcher
- **Pros:** No block_on; watcher sends paths via channel, tokio task does the async lock
- **Cons:** Restructures the watcher loop; need to handle backpressure
- **Effort:** Medium
- **Risk:** Low — standard async pattern

### Option C: Use a dedicated tokio::sync::mpsc channel from watcher to an async consumer
- **Pros:** Clean separation; watcher never touches the mutex
- **Cons:** More moving parts
- **Effort:** Medium-Large
- **Risk:** Low

## Technical Details

**Affected files:** `src-tauri/src/watcher.rs` (lines 310, 405), `src-tauri/src/lib.rs` (watcher setup)

## Acceptance Criteria

- [ ] No `block_on` calls in the watcher event processing thread
- [ ] `cargo test` — 64 pass, 0 fail
- [ ] `cargo check` — 0 warnings
- [ ] File watcher still processes state.json changes correctly

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by 3 agents |
