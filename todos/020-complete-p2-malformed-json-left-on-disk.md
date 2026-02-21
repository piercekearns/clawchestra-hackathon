---
status: complete
priority: p2
issue_id: "020"
tags: [code-review, agent-native, architecture-direction-v2]
dependencies: []
---

# Malformed JSON left on disk without restoration of last-known-good state

## Problem Statement

When an agent writes completely unparseable JSON to state.json, the watcher logs a warning and returns — leaving the broken file on disk. Unlike validation rejections (where the corrected state is written back), parse failures do not restore the last-known-good state.

The next time the agent (or another agent) reads state.json, it reads garbage. Since agents are told to "read immediately before writing," they may perpetuate the error.

## Findings

- `watcher.rs:288-298` — `serde_json::from_slice` fails → log warning → return (no writeback)
- `watcher.rs:365-375` — validation rejection path correctly writes back corrected state
- Asymmetry: broken JSON is ignored, invalid-but-parseable JSON is corrected
- An agent that writes `{"project": {}}` (missing required `id`, `title`, etc.) will fail parsing and the broken file persists

## Proposed Solutions

### Option A: Write back current projected state on parse failure
- **Pros:** Restores valid state.json for agents; symmetric with rejection writeback
- **Cons:** Agent's broken write is overwritten (same as rejection behavior)
- **Effort:** Small
- **Risk:** Low

### Option B: Leave current behavior, document it
- **Pros:** No code change
- **Cons:** Agent UX suffers
- **Effort:** None
- **Risk:** None

## Technical Details

**Affected files:** `src-tauri/src/watcher.rs` (handle_state_json_change, ~line 288)

## Acceptance Criteria

- [ ] After an agent writes unparseable JSON, state.json is restored to last-known-good state
- [ ] OR behavior is documented and accepted
- [ ] `cargo test` — all pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Agent-Native agent |
