---
status: pending
priority: p2
issue_id: "005"
tags: [code-review, architecture, code-duplication, architecture-direction-v2]
dependencies: []
---

# Deduplicate write_json_atomic (2 copies)

## Problem Statement

`write_json_atomic<T: Serialize>` is defined identically in two files:
- `src-tauri/src/db_persistence.rs:111`
- `src-tauri/src/sync.rs:227`

Both use the same pattern: serialize to pretty JSON, write to `.tmp-{millis}` file, rename. Any bugfix in one must be manually duplicated to the other.

## Findings

- **Source:** pattern-recognition-specialist, architecture-strategist
- **Location:** `db_persistence.rs:111`, `sync.rs:227`

## Proposed Solutions

### Option A: Extract to shared utility module
Create `src-tauri/src/util.rs` with `pub fn write_json_atomic<T: Serialize>(...)` and import from both.

**Effort:** Small
**Risk:** Low

## Acceptance Criteria
- [ ] Single definition of write_json_atomic
- [ ] Both db_persistence.rs and sync.rs import from shared location
- [ ] All tests pass

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | 2 copies confirmed via grep |
