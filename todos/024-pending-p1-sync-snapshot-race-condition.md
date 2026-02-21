---
status: pending
priority: p1
issue_id: "024"
tags: [data-integrity, multi-device, sync, architecture-direction-v2]
dependencies: []
---

# Sync snapshot race condition (data loss vector)

## Problem Statement

`sync_local_launch` and `sync_merge_remote` in `lib.rs` follow a snapshot-release-merge-reacquire pattern: clone the DB under the lock, release, run the merge (with I/O), then re-acquire the lock and overwrite the DB with `guard.db = merged`. Any changes applied by the file watcher between the snapshot and the reapply are **silently lost**.

This was the #1 finding across all 4 review agents (Architecture Strategist, Security Sentinel, Performance Oracle, Data Integrity Guardian).

## Findings

**Location:** `src-tauri/src/lib.rs` lines 1718-1731 (sync_local_launch), 1746-1764 (sync_merge_remote)

**Concrete scenario:**
1. Sync command takes snapshot at T1 (lock released)
2. Agent writes state.json at T2
3. Watcher merges agent's change into DB at T3 (e.g., sets item status to "in-progress")
4. Sync command re-acquires lock at T4 and does `guard.db = merged` — computed from T1 snapshot
5. Agent's status change is silently lost

**Probability:** Low in normal operation (the window is narrow — typically a few ms for merge plus disk I/O), but non-zero under rapid agent writes during sync. Higher probability on launch when the watcher is first starting up and sync_local_launch fires.

**Identified by:** Architecture Strategist (R1, HIGH), Data Integrity Guardian (#1, CRITICAL)

## Proposed Solutions

### Option A: Compare-and-swap on HLC counter (Recommended)
After re-acquiring the lock, check if `guard.db.hlc_counter` has advanced beyond the snapshot's counter. If it has, re-merge with the current state rather than overwriting.

- Pros: Minimal code change, preserves the lock-release-for-I/O pattern
- Cons: Rare case of needing a second merge pass
- Effort: Small
- Risk: Low

### Option B: Hold the lock across entire sync
Keep the lock held during the entire sync operation, including file I/O.

- Pros: Simplest, eliminates the race entirely
- Cons: Blocks all other operations during sync (which includes HTTP for remote sync). Unacceptable latency for remote sync mode.
- Effort: Small
- Risk: Medium (latency impact)

### Option C: Generation counter with retry loop
Add a generation counter to AppState that increments on every mutation. On re-acquire, if generation has changed, retry the entire sync.

- Pros: General-purpose, catches any mutation type
- Cons: More complex, potential infinite retry under heavy write load
- Effort: Medium
- Risk: Low

## Recommended Action

Option A. Straightforward, minimal change, preserves performance.

## Technical Details

**Affected files:** `src-tauri/src/lib.rs` (sync_local_launch, sync_merge_remote)

## Acceptance Criteria

- [ ] After re-acquiring the lock, stale snapshot is detected via HLC counter comparison
- [ ] If stale, merge is re-run against current DB state (not the stale snapshot)
- [ ] Unit test: concurrent watcher merge during sync does not lose changes

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | From review round 3 — flagged by 3/4 agents as top finding |
