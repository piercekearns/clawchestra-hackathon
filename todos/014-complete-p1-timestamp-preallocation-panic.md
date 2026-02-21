---
status: complete
priority: p1
issue_id: "014"
tags: [code-review, correctness, architecture-direction-v2]
dependencies: []
---

# HLC timestamp pre-allocation can panic (index out of bounds) in merge.rs

## Problem Statement

`merge_state_json` pre-allocates HLC timestamps with formula `10 + incoming.roadmap_items.len() * 15`. The `next_ts!()` macro indexes into this vector with `timestamps[ts_idx]`. However, priority conflict resolution (lines 211-218) shifts **all existing DB items** in the same status column, consuming one timestamp per shifted item. These existing items are NOT counted in the pre-allocation formula.

If a project has many existing items in the DB and an incoming change triggers a priority conflict that shifts more items than the formula accounts for, `timestamps[ts_idx]` panics with index out of bounds.

## Findings

- `merge.rs:54-67` — Pre-allocation formula: `10 + incoming.roadmap_items.len() * 15`
- `merge.rs:211-218` — Priority shift loop: one `next_ts!()` per existing item in the same column
- The shift can affect items NOT in the incoming set (only in DB), so their count is unbounded by `incoming.roadmap_items.len()`
- Example: 50 items in DB column "pending", incoming changes one item's priority → shifts 49 items → needs 49 extra timestamps beyond what was pre-allocated

## Proposed Solutions

### Option A: Use a Vec that grows on demand (push instead of pre-allocate)
- **Pros:** Cannot panic; simple
- **Cons:** Slightly more allocations (negligible for this scale)
- **Effort:** Small
- **Risk:** None

### Option B: Fix the formula to include existing DB items
- **Pros:** Keeps the pre-allocation pattern
- **Cons:** Formula becomes complex; fragile if merge logic changes
- **Effort:** Small
- **Risk:** Low (but formula may need updating with future changes)

## Technical Details

**Affected files:** `src-tauri/src/merge.rs` (lines 54-67, 211-218)

## Acceptance Criteria

- [ ] No panic possible from timestamp indexing regardless of DB size
- [ ] `cargo test` — all pass
- [ ] `cargo check` — 0 warnings

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Architecture agent |
