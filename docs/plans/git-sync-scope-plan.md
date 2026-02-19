# Git Sync: Scope Expansion (Phase 2) — Plan

> Expand Git Sync from dashboard-only files to full dirty-file scope with clear Metadata/Documents/Code grouping and explicit local-only auto-commit boundaries.

## Summary

This plan upgrades Git Sync so the Sync dialog can represent and commit all dirty files, not just dashboard-managed paths. It preserves the recent local-only Kanban auto-commit policy by keeping those structural status/priority moves automatic, while routing deeper edits through explicit Sync actions. The rollout is split into backend data expansion, frontend grouping/selection UX, and guarded commit execution.

---

**Roadmap Item:** `git-sync-scope`
**Spec:** `docs/specs/git-sync-scope-spec.md`
**Status:** Ready
**Created:** 2026-02-19

---

## Scope

In scope:
1. Detect all dirty files from git status and expose them to the frontend.
2. Group files in Sync UI into `Metadata`, `Documents`, and `Code`.
3. Support category-level (and optional per-file) selection for commits.
4. Keep local-only Kanban structure auto-commit behavior for `PROJECT.md`/`ROADMAP.md`.
5. Keep remote-linked repos explicit/manual for Sync commit/push.

Out of scope:
1. Multi-branch cherry-pick/pull/AI conflict workflows (Phase 3).
2. PR workflows and remote branch administration.

---

## Decision Checkpoint (Before Build)

1. **Taxonomy decision required:** classify `ROADMAP.md`/`CHANGELOG.md` as either:
   - Option A: `Metadata` (treat as app-structural state)
   - Option B: `Documents` (treat as planning artifacts alongside specs/plans)
2. **Recommendation:** Option B (`Documents`) for clearer mental model and lower ambiguity in risk messaging.
3. Lock this decision in:
   - `docs/specs/git-sync-scope-spec.md`
   - SyncDialog grouping code
   - tests (`src/lib/git-sync.test.ts`)

4. **Policy lock:** auto-commit eligibility is trigger-based (UI structural action), not category-based. Metadata/Documents grouping is for UX and selection semantics only.

---

## Implementation Phases

## Phase 1 — Backend Git Status/Data Contract

### Goals

1. Add all-dirty-file visibility to backend status payload.
2. Preserve existing dashboard-specific signals while introducing broader scope.

### Work

1. Extend `GitStatus` in `/Users/piercekearns/repos/pipeline-dashboard/src-tauri/src/lib.rs` with all-file dirtiness fields (for example `has_dirty_files`, `all_dirty_files`), keeping existing `dashboard_dirty`/`dirty_files` temporarily for compatibility during transition.
2. Update `get_git_status` to parse all dirty files from porcelain output once, then derive:
   - dashboard-only subset (current behavior)
   - full dirty file list (new behavior)
3. Add/update Rust tests for:
   - mixed dashboard + code dirty paths
   - rename/untracked handling
   - no dirty files

### Exit Criteria

1. Tauri command returns full dirty scope without regressing existing consumers.
2. Rust tests pass.

---

## Phase 2 — Frontend Types and Selection Model

### Goals

1. Move Sync decision-making to full dirty scope.
2. Keep type model explicit and migration-safe.

### Work

1. Extend `/Users/piercekearns/repos/pipeline-dashboard/src/lib/schema.ts` GitStatus fields to include full dirty scope.
2. Update `/Users/piercekearns/repos/pipeline-dashboard/src/lib/tauri.ts` typings for expanded status payload.
3. Refactor Sync dialog state to track selected categories and optional per-file selections.
4. Keep dirty-project detection logic in `/Users/piercekearns/repos/pipeline-dashboard/src/App.tsx` aligned to new all-dirty signal.

### Exit Criteria

1. TypeScript build passes with no `any` fallback for new fields.
2. Existing behavior for Phase 1 dashboard-managed changes remains intact.

---

## Phase 3 — Sync Dialog UX for 3 Categories

### Goals

1. Show `Metadata`, `Documents`, and `Code` groups with counts.
2. Make risk visible when Code is selected.

### Work

1. Update grouping logic in `/Users/piercekearns/repos/pipeline-dashboard/src/components/SyncDialog.tsx`:
   - Metadata: app-structural files (`PROJECT.md`, optionally `ROADMAP.md`/`CHANGELOG.md` per final taxonomy decision)
   - Documents: roadmap/spec/plan docs
   - Code: everything else
2. Add category-level selection toggles.
3. Add subtle code-risk indicator when `Code` is selected.
4. Update commit message generator to reflect selected categories and representative files.

### Exit Criteria

1. Users can commit selected groups across all dirty files.
2. Commit messages are category-aware and readable.

---

## Phase 4 — Commit Execution and Safety Rules

### Goals

1. Allow Sync commits for broader file scope.
2. Maintain explicit safety boundaries between auto and manual commit paths.

### Work

1. Update backend `git_commit` path validation in `/Users/piercekearns/repos/pipeline-dashboard/src-tauri/src/lib.rs` so explicit Sync commits can include non-dashboard files selected in UI.
2. Enforce strict file safety constraints at commit boundary:
   - allow only repo-relative paths (reject absolute paths)
   - reject traversal paths (`..`)
   - normalize and validate inside repo root
   - commit only files currently present in the latest dirty-file snapshot
3. Keep auto-commit helpers constrained to local-only structural Kanban paths (`PROJECT.md`, `ROADMAP.md`) and never broaden auto-commit to arbitrary code/docs.
4. Preserve push controls only where remotes exist.
5. Add explicit error messages when selections fail validation (for clear user recovery).
6. Add pre-existing-dirty guard for local-only UI auto-commit:
   - if `PROJECT.md`/`ROADMAP.md` already contain unrelated dirty edits, skip auto-commit and surface manual Sync path.

### Exit Criteria

1. Sync can commit user-selected code/doc changes.
2. Local-only Kanban auto-commit policy remains narrow and deterministic.
3. Unsafe file selections are blocked with actionable errors.
4. UI-triggered structural moves still auto-commit on local-only repos when no unrelated dirty edits are present.

---

## Phase 5 — Compatibility Cleanup

### Goals

1. Avoid permanent temporary dual-contract fields.

### Work

1. After frontend migration is complete and verified, remove legacy compatibility plumbing no longer needed for dashboard-only sync assumptions.
2. Update docs/tests to the final stable contract only.

### Exit Criteria

1. No unused transitional fields remain.
2. Final contract is documented once in spec + schema + tests.

---

## Verification Plan

1. Unit tests:
   - `/Users/piercekearns/repos/pipeline-dashboard/src/lib/git-sync.test.ts` grouping and messaging coverage.
   - Rust tests for status parsing and commit validation.
   - Rust tests for path safety validation (`absolute`, `..`, non-dirty-file rejection).
2. Build/test gates:
   - `pnpm test src/lib/git-sync.test.ts`
   - `pnpm build`
   - `cargo test` (or targeted Rust tests) for git helpers.
3. Manual scenarios:
   - Local-only repo: Kanban move auto-commits, no persistent Sync noise.
   - Local-only repo: AI edits to docs/code appear in Sync and require explicit commit.
   - Remote repo: no auto-commit; explicit commit/push flow still required.
   - Mixed dirty sets: Metadata/Documents/Code grouped and selectable.

---

## Risks and Mitigations

1. Risk: category taxonomy ambiguity (`ROADMAP.md` metadata vs documents).
Mitigation: resolve at Decision Checkpoint before implementation; lock in spec/code/tests.

2. Risk: accidental expansion of auto-commit scope.
Mitigation: keep auto-commit callsites explicit with fixed file lists; no wildcard inputs.

3. Risk: regressions in existing dashboard-dirty indicators.
Mitigation: maintain compatibility fields during transition and remove only after UI migration is complete.
