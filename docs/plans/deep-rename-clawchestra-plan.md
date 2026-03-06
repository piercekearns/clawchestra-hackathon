# Deep Rename to Clawchestra — Plan

> Rename internal `pipeline-dashboard` identities to `clawchestra` with safe data migration, while preserving Git Sync behavior and First Friend Readiness compatibility.

## Summary

This plan executes the internal rename as a controlled migration, not a broad textual replace. It prioritizes runtime/build identity consistency, safe settings/chat data continuity, and non-regression for Git Sync (including local-only UI-triggered auto-commit behavior). Risky/non-essential changes such as repo folder rename are explicitly deferred.

---

**Roadmap Item:** `deep-rename-clawchestra`
**Spec:** `docs/specs/deep-rename-clawchestra-spec.md`
**Status:** Ready
**Created:** 2026-02-19

---

## Phase 0 — Decision Lock and Preconditions

### Goals

1. Lock rename boundaries before editing code.
2. Avoid hidden scope creep into First Friend Readiness and Git Sync phases.

### Work

1. Confirm session key baseline: `agent:main:clawchestra`.
2. Confirm final Tauri identifier target: `ai.clawchestra.desktop`.
3. Confirm repo folder rename is out of scope for this implementation.
4. Confirm migration policy:
   - migrate settings/chat directories idempotently
   - do not attempt WebKit/localStorage migration
5. Confirm Git Sync compatibility policy:
   - local-only UI structural auto-commit semantics must remain unchanged
   - no category-based policy coupling

### Exit Criteria

1. Boundaries are explicit in docs/spec/plan.
2. No unresolved decision blockers remain.

---

## Phase 1 — Core Runtime Identity Rename

### Goals

1. Rename build/runtime identity without breaking compile/start paths.
2. Keep backend/frontend session defaults consistent.

### Work

1. Update Cargo/lib naming:
   - `src-tauri/Cargo.toml` package/lib names + description
   - `src-tauri/src/main.rs` lib entry rename
2. Update Tauri identity/config strings:
   - `src-tauri/tauri.conf.json` identifier (`ai.clawchestra.desktop`)
   - capability descriptions
3. Update session key constants in:
   - `src-tauri/src/lib.rs`
   - frontend gateway constants/tests
4. Update package naming metadata (`package.json` + lockfile as needed).

### Exit Criteria

1. `cargo check` passes.
2. `pnpm build` passes.
3. Frontend/backend session key defaults are aligned to `clawchestra`.

---

## Phase 2 — Data Path Migration and Idempotency

### Goals

1. Preserve existing user settings/chat DB across rename.
2. Ensure migration can run safely more than once.

### Work

1. Implement startup migration routine in Rust:
   - old settings path -> new settings path
   - old chat-db dir -> new chat-db dir
2. Use idempotent guards:
   - only rename when old exists and new does not
3. Add best-effort cleanup for stale cache/prefs artifacts where safe.
4. Keep WebKit/localStorage migration out of scope (expected preference reset if identifier changes storage bucket).
5. Add explicit migration test matrix:
   - old exists + new missing -> migrate once
   - old missing + new exists -> no-op
   - old exists + new exists -> no-op
   - forced rename failure -> warning + continue startup

### Exit Criteria

1. Existing settings/chat history survive first launch post-rename.
2. Second launch migration is a no-op.

---

## Phase 3 — Script/Env/Operational String Rename

### Goals

1. Remove old env/lock naming from update/runtime scripts.
2. Keep update flow behavior intact.

### Work

1. Update env vars and lock paths:
   - `PIPELINE_DASHBOARD_*` -> `CLAWCHESTRA_*`
   - `/tmp/pipeline-dashboard-update.lock` -> `/tmp/clawchestra-update.lock`
2. Update `update.sh` references to new naming.
3. Keep one-release compatibility fallbacks for legacy app/process naming, then remove in a follow-up cleanup PR.

### Exit Criteria

1. Update flow still works with new env names.
2. No active runtime path relies on `PIPELINE_DASHBOARD_*`.

---

## Phase 4 — Documentation and Project Content Alignment

### Goals

1. Align active project docs with new name.
2. Preserve historical docs as historical records.

### Work

1. Update active docs/content:
   - `PROJECT.md`, `OVERVIEW.md`
   - relevant roadmap parent references that are meant to be current
2. Do not rewrite historical plan/changelog content.
3. Update roadmap item state metadata (`nextAction`) to reflect plan execution state.

### Exit Criteria

1. Current-facing docs reflect Clawchestra naming.
2. Historical context remains intact.

---

## Phase 5 — Regression Validation (Git Sync + FFR Touchpoints)

### Goals

1. Ensure deep rename does not regress in-progress Git Sync behavior.
2. Ensure readiness path for first-friend onboarding remains coherent.

### Work

1. Validate Git Sync compatibility:
   - local-only UI structural moves still auto-commit
   - Sync dialog dirty-state behavior unchanged except naming
2. Validate FFR alignment:
   - renamed session key default matches FFR expected default
   - no new platform-specific hardcoding introduced during rename
3. Run test/build gates:
   - `cargo check`
   - `pnpm test` (relevant suites)
   - `pnpm build`
   - optional `npx tauri build --no-bundle`

### Exit Criteria

1. Rename is operationally complete with no major behavior regressions.
2. Git Sync and FFR dependent tracks remain unblocked.

---

## Risks and Mitigations

1. Risk: identifier/path rename causes partial state loss.
Mitigation: explicit migration + idempotent guards + clear expectation around WebKit/localStorage.

2. Risk: rename unintentionally changes Git Sync behavior.
Mitigation: dedicated regression checks for local-only auto-commit and Sync dirty detection.

3. Risk: over-expansion into unrelated refactors (folder rename, broad path rewrites).
Mitigation: strict out-of-scope enforcement in Phase 0.

---

## Rollback Procedure

If migration causes partial state movement on a machine:

1. Stop app process.
2. Compare old/new settings and chat-db directories.
3. If new directory is partial and old is intact, restore old as source of truth and move partial new aside.
4. Re-launch once and verify migration outcome.
5. If repeat failure, keep install on pre-migration path behavior until a patch lands (do not repeatedly rewrite directories).
