---
status: complete
priority: p3
issue_id: "021"
tags: [code-review, quality, architecture-direction-v2]
dependencies: []
---

# Code duplication: run_git, write_file_atomic, is_pid_alive

## Problem Statement

Three utility functions are duplicated across modules:

1. **`run_git`** — identical function in `commands/git.rs:164` (private) and `commands/update.rs:60` (private copy)
2. **`write_file_atomic`** in `lib.rs:346` duplicates `write_str_atomic` in `util.rs:14` (different temp suffix: nanos vs millis)
3. **`is_pid_alive`** — identical logic in `commands/git.rs:268` and inline in `commands/update.rs:97-115`

## Proposed Solutions

### Option A: Consolidate all three
- Make `run_git` pub(crate) in git.rs, remove the copy in update.rs
- Replace `write_file_atomic` in lib.rs with call to `util::write_str_atomic`
- Extract `is_pid_alive` to a shared location (util.rs or locking.rs)
- **Effort:** Small
- **Risk:** None

## Technical Details

**Affected files:** `commands/git.rs`, `commands/update.rs`, `lib.rs`, `util.rs`

## Acceptance Criteria

- [ ] No duplicate implementations of run_git, write_file_atomic, or is_pid_alive
- [ ] `cargo test` — all pass
- [ ] `cargo check` — 0 warnings

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Pattern Recognition + Simplicity agents |
