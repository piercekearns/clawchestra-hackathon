---
status: complete
priority: p2
issue_id: "019"
tags: [code-review, correctness, architecture-direction-v2]
dependencies: []
---

# unwrap() in production merge.rs code (4 sites)

## Problem Statement

`merge.rs` has four `unwrap()` calls on HashMap `get_mut()` operations in production code. While logically safe today (each is preceded by an insert or contains_key check), they are fragile under refactoring. A HashMap mutation between the check and the unwrap would cause a panic, crashing the watcher's merge path silently.

## Findings

- `merge.rs:113` — `app_state.db.projects.get_mut(project_id).unwrap()` (safe: line 91 inserts if missing)
- `merge.rs:183` — `app_state.db.projects.get_mut(project_id).unwrap()` (safe: same entry)
- `merge.rs:225` — `db_entry.roadmap_items.get_mut(&incoming_item.id).unwrap()` (safe: inserted at 219)
- `merge.rs:231` — `db_entry.roadmap_items.get_mut(&incoming_item.id).unwrap()` (safe: same key)

## Proposed Solutions

### Option A: Replace with `.expect("context message")`
- **Pros:** Better panic message if it ever fires; documents the invariant
- **Cons:** Still panics
- **Effort:** Small
- **Risk:** None

### Option B: Replace with `if let Some(entry) = get_mut()` + log + return on None
- **Pros:** Graceful degradation; watcher continues processing other events
- **Cons:** Slightly more verbose; masks logical errors
- **Effort:** Small
- **Risk:** None

## Technical Details

**Affected files:** `src-tauri/src/merge.rs` (lines 113, 183, 225, 231)

## Acceptance Criteria

- [ ] No bare `unwrap()` in merge.rs production code
- [ ] `cargo test` — all pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Pattern Recognition agent |
