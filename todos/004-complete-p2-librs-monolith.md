---
status: pending
priority: p2
issue_id: "004"
tags: [code-review, architecture, architecture-direction-v2]
dependencies: []
---

# Split lib.rs monolith (4548 lines, ~69 commands)

## Problem Statement

`src-tauri/src/lib.rs` is 4,548 lines containing ~69 Tauri command handlers plus setup, state management, and helper functions. Multiple review agents flagged this as the single biggest maintainability concern. Finding a specific command requires extensive scrolling, and changes risk unintended side effects due to the file's density.

## Findings

- **Source:** architecture-strategist, pattern-recognition-specialist, code-simplicity-reviewer
- **Location:** `src-tauri/src/lib.rs`
- **Impact:** Developer productivity, review difficulty, merge conflict risk
- **Existing modules already extracted:** `state.rs`, `sync.rs`, `watcher.rs`, `db_persistence.rs`, `merge.rs`, `validation.rs`, `injection.rs`, `migration.rs` — the command handlers remain in lib.rs

## Proposed Solutions

### Option A: Group commands into domain modules
Extract command handlers into modules by domain:
- `commands/project.rs` — project CRUD commands
- `commands/roadmap.rs` — roadmap item commands
- `commands/sync.rs` — sync trigger commands
- `commands/migration.rs` — migration commands
- `commands/debug.rs` — debug/export commands
- `commands/openclaw.rs` — OpenClaw extension commands

Keep `lib.rs` as the thin setup/router file (~200 lines).

**Pros:** Clear domain boundaries, easy to navigate.
**Cons:** Significant refactor, many file moves.
**Effort:** Large
**Risk:** Low (pure refactor, no behavior change)

### Option B: Incremental extraction
Move the largest command groups first (project + roadmap = ~60% of lib.rs), leave the rest for later.

**Pros:** Lower risk per step, can be done incrementally.
**Cons:** Intermediate state still has a large lib.rs.
**Effort:** Medium per step
**Risk:** Low

## Recommended Action
Option B — incremental extraction, starting with project and roadmap commands.

## Technical Details
- **Affected files:** `src-tauri/src/lib.rs`, new `src-tauri/src/commands/*.rs`

## Acceptance Criteria
- [ ] lib.rs is under 500 lines
- [ ] All Tauri commands still registered and working
- [ ] All tests pass
- [ ] No behavior changes

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Flagged by 3 agents |

## Resources
- lib.rs (4548 lines)
