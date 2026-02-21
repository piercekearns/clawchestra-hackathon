---
status: pending
priority: p2
issue_id: "006"
tags: [code-review, data-integrity, architecture-direction-v2]
dependencies: []
---

# No state.json write-back after partial merge rejection

## Problem Statement

When the watcher detects an external state.json change and merges it, some fields may be rejected (e.g., invalid status values). After the merge, the in-memory state reflects the merged result, but the on-disk state.json still contains the rejected values. This means:

1. The file on disk and in-memory state are out of sync
2. If the app restarts, it re-reads the stale file and re-attempts the same rejected merge
3. Agents see their rejected changes persisted on disk, thinking they succeeded

## Findings

- **Source:** architecture-strategist, data-integrity-guardian
- **Location:** `src-tauri/src/watcher.rs:handle_state_json_change` (no write-back after merge)
- **Impact:** Divergence between on-disk and in-memory state; agents may not realize their changes were rejected

## Proposed Solutions

### Option A: Write back merged state.json after partial rejection
After merge with rejections, write the corrected state.json back to disk. Use hash pre-registration (todo #003) to prevent the watcher from re-triggering.

**Effort:** Medium
**Risk:** Medium (write-back could fail; need to handle gracefully)

### Option B: Accept divergence, document behavior
The frontend already receives the `state-json-merged` event with `rejected_fields`. Agents can check the event to know what was rejected.

**Effort:** None
**Risk:** Low (agents may not check rejection events)

## Recommended Action
Option A — write back merged state to keep disk and memory in sync.

## Acceptance Criteria
- [ ] After merge with rejections, corrected state.json is written to disk
- [ ] Write-back uses hash pre-registration to avoid watcher loop
- [ ] Agents see the corrected file on next read

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Found by architecture-strategist + data-integrity-guardian |
