# Git Sync: Branch Management (Phase 3) — Plan

> Add controlled multi-branch sync to Git Sync using cherry-pick workflows, branch-state visibility, and AI-assisted conflict handling.

## Summary

This plan adds branch-aware sync operations after Phase 2 broadens dirty-file scope. It introduces explicit target-branch selection, guarded cherry-pick execution, and recovery paths for conflicts with AI assistance and user confirmation. Local-only branches are supported for commit/cherry-pick workflows while push/pull remains disabled when no upstream exists.

---

**Roadmap Item:** `git-branch-sync`
**Spec:** `docs/specs/git-branch-sync-spec.md`
**Status:** Ready
**Created:** 2026-02-19

---

## Scope

In scope:
1. Branch selection UX in Sync dialog.
2. Multi-branch commit propagation by cherry-pick.
3. Branch relationship indicators (ahead/behind/diverged/local).
4. Conflict capture + AI-assisted resolution workflow with explicit user approval.
5. Pull-first guidance when behind upstream.

Out of scope:
1. Creating/deleting/protecting remote branches.
2. Full Git GUI replacement.
3. PR authoring flows.

---

## Implementation Phases

## Phase 1 — Research and Operational Guardrails

### Goals

1. Lock branch operation rules before implementation.
2. Validate command choices against current git/gh capabilities.

### Work

1. Capture a concise branch-operations guide for this repo context:
   - cherry-pick vs merge/rebase decision boundaries
   - conflict strategy for structured files vs code files
   - non-destructive defaults and abort paths
2. Validate whether `git rerere` should be optional, off by default, or omitted.
3. Confirm local-only behavior policy: `(local)` branches allow commit/cherry-pick only, no pull/push controls.

### Exit Criteria

1. Branch command decision tree documented.
2. No ambiguous operator paths for failure handling.

---

## Phase 2 — Backend Branch Introspection + Commands

### Goals

1. Expose branch candidates and status.
2. Add command primitives for safe cherry-pick orchestration.

### Work

1. Extend Tauri backend (`<repo-root>/src-tauri/src/lib.rs`) with branch-list/status command returning:
   - branch name
   - upstream presence
   - ahead/behind/diverged flags
2. Add execution primitives:
   - stash/restore helpers for unrelated WIP (explicitly define handling for untracked files)
   - checkout target branch
   - cherry-pick specific commit
   - abort/recover on conflict
3. Keep all operations explicit and reversible (no destructive resets).
4. Add operation-lock primitives so only one branch sync can run per repo/session at a time.

### Exit Criteria

1. Backend can enumerate branch states and run isolated cherry-pick sequence steps.
2. Error payloads are structured enough for UI + AI conflict workflows.

---

## Phase 3 — Sync Dialog Branch UX

### Goals

1. Let users choose target branches and see risks before execution.
2. Keep local-only and remote-linked branches clearly differentiated.

### Work

1. Extend `<repo-root>/src/components/SyncDialog.tsx` with:
   - `Also sync to` branch selector
   - branch status badges (`✓`, `↑`, `↓`, `⚠`, `(local)`)
   - per-branch push toggle only when upstream exists
2. Add `Pull first?` guard when current branch is behind remote.
3. Add preview summary before execution:
   - source branch
   - target branches
   - push/pull implications

### Exit Criteria

1. Branch targets are explicit and understandable before running.
2. Local-only branches never expose pull/push controls.

---

## Phase 4 — Multi-Branch Execution Engine

### Goals

1. Execute deterministic multi-branch propagation.
2. Handle partial failures safely.

### Work

1. Execution flow:
   - commit on source branch
   - for each selected target: stash -> checkout -> cherry-pick -> restore
   - optional push where allowed and selected
2. Persist per-branch results in UI:
   - success hash
   - skipped
   - conflict
   - failed with reason
3. Ensure return to original branch even on failures.
4. Persist execution state (current branch, current step, completed targets) so interrupted runs can surface resume/cancel options.

### Exit Criteria

1. Non-conflicting cherry-picks complete across selected branches.
2. Partial failures are surfaced with actionable detail.
3. Concurrent execution attempts are blocked with clear UX feedback.

---

## Failure and Rollback Matrix (Required)

For each operation failure point, define exact behavior:

1. **Stash fails**
   - Stop run, remain on source branch, show error, no branch switches attempted.
2. **Checkout target fails**
   - Attempt return to source branch; keep stash intact; mark target failed.
3. **Cherry-pick conflicts**
   - Pause pipeline, collect conflict context, enter conflict-resolution flow (AI or manual fallback).
4. **Cherry-pick hard failure (non-conflict)**
   - Abort cherry-pick, return to source branch, continue to next target only if user approved partial continuation.
5. **Restore stash fails**
   - Do not continue silently; show explicit recovery guidance and keep run in attention-required state.
6. **Push fails**
   - Mark branch result as commit-success/push-failed, continue other selected branches unless user cancels.

---

## Phase 5 — AI Conflict Resolution Workflow

### Goals

1. Resolve branch conflicts with AI assistance but user control.
2. Avoid silent destructive merges.

### Work

1. On conflict, gather and package context:
   - source vs target file versions
   - conflict markers
   - file type (structured docs vs code)
2. Send resolution request through existing OpenClaw chat integration.
3. Present proposed resolution summary in UI for explicit user approve/reject.
4. Apply resolution only after approval, then continue cherry-pick completion.
5. Add non-AI fallback path when OpenClaw/Gateway is unavailable:
   - surface conflicting files and branch state
   - provide exact manual recovery commands
   - keep repository in safe paused state (no hidden destructive fallback)

### Exit Criteria

1. Conflicts can be resolved end-to-end without leaving app flow.
2. User approval is required before applying AI-generated resolution.
3. Conflict handling remains operable (manual fallback) even if AI transport is down.

---

## Verification Plan

1. Unit tests:
   - branch-state formatting and `(local)` handling
   - execution state machine transitions
2. Integration/manual tests:
   - clean cherry-pick to one branch
   - clean cherry-pick to multiple branches
   - behind-remote pull-first path
   - local-only branch path (no push/pull)
   - conflict + AI-assisted resolution path
3. Build/test gates:
   - `pnpm build`
   - targeted Rust command tests for branch/cherry-pick helpers.

---

## Risks and Mitigations

1. Risk: branch switching while unrelated work exists.
Mitigation: mandatory stash/restore wrapper with explicit failure recovery.

2. Risk: AI conflict resolution introduces unintended changes.
Mitigation: always show diff summary and require user approval before apply.

3. Risk: ambiguous behavior on local-only branches.
Mitigation: enforce and test `(local)` policy: commit/cherry-pick allowed, pull/push unavailable.
