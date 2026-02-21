---
status: complete
priority: p2
issue_id: "015"
tags: [code-review, agent-native, architecture-direction-v2]
dependencies: []
---

# Agent feedback loop broken: validation_rejections never populated + no file-based feedback

## Problem Statement

Two related issues make it impossible for agents to learn from validation errors:

1. **`validation_rejections` never populated**: `AppState.validation_rejections` is declared (state.rs:251) and queried by `get_validation_history` and `mark_rejection_resolved` Tauri commands, but **no code path ever inserts into it**. The watcher logs rejections and writes back corrected state.json but never records a ValidationRejection entry.

2. **No file-based feedback**: Agents interact only via the filesystem (read/write state.json). Rejections are communicated via Tauri IPC events (inaccessible to agents) and tracing logs (also inaccessible). The only signal an agent gets is that state.json was silently overwritten.

AGENTS.md acknowledges this: "HARD — app rejects invalid values silently." This is the core design gap in the agent-native architecture.

## Findings

- `watcher.rs:320-361` — merge result has `rejected_fields` but they are only sent via Tauri event and logged
- `state.rs:251` — `validation_rejections: HashMap<ProjectId, VecDeque<ValidationRejection>>` — never populated
- `lib.rs:2044-2060` — `get_validation_history` command reads from empty map
- `lib.rs:2062-2081` — `mark_rejection_resolved` command operates on empty map

## Proposed Solutions

### Option A: Write .clawchestra/last-rejection.json sidecar file
- **Pros:** Agents can read it after writes; simple file-based protocol
- **Cons:** Another file to manage; agents need to be told to check it
- **Effort:** Small-Medium
- **Risk:** Low

### Option B: Populate validation_rejections + add rejection info to state.json under `_lastRejection` key
- **Pros:** Single file for agents; UI also gets history via existing commands
- **Cons:** Adds non-data fields to state.json that agents might try to edit
- **Effort:** Medium
- **Risk:** Low

### Option C: Just populate validation_rejections (fix the wiring gap)
- **Pros:** Minimal change; UI feedback works
- **Cons:** Still no feedback to agents (they can't call Tauri commands)
- **Effort:** Small
- **Risk:** None

## Technical Details

**Affected files:** `src-tauri/src/watcher.rs` (handle_state_json_change), `src-tauri/src/state.rs` (validation_rejections)

## Acceptance Criteria

- [ ] After a validation rejection, `get_validation_history` returns non-empty results
- [ ] Agents have a discoverable way to learn what was rejected and why
- [ ] `cargo test` — all pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Agent-Native agent |
