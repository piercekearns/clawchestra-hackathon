# Project Onboarding Target-State Alignment Plan

> Align Create New and Add Existing flows so every newly tracked project lands directly in the post-migration architecture.

## Summary

This plan closes the onboarding gap between desired architecture and current UI behavior. Infrastructure for migrated state already exists (`create_project_with_state`, migration commands, guidance injection), but Project Wizard create/add flows still run legacy/bridge paths (`PROJECT.md` write path, optional frontmatter patching, no guaranteed immediate state registration). The goal is deterministic onboarding plus fleet alignment: canonical `CLAWCHESTRA.md`, canonical `.clawchestra/state.json`, `.gitignore` hygiene, in-flow guidance injection outcome reporting, and a one-time reconciliation of currently tracked projects.

## Enhancement Summary

**Deepened on:** 2026-02-24  
**Sections enhanced:** 12  
**Research lenses used:** `repo-research-analyst`, `learnings-researcher`, `architecture-strategist`, `agent-native-reviewer`, `security-sentinel`, `performance-oracle`, `data-integrity-guardian`, `code-simplicity-reviewer`, plus Tauri v2 command/event documentation.

### Key Improvements

1. Added a strict onboarding decision matrix (modern repo vs legacy roadmap vs legacy filename only) so Create New/Add Existing follow deterministic command sequences.
2. Added explicit command-level sequencing around `run_migration`, `create_project_with_state`, `rename_project_md`, and `inject_agent_guidance`.
3. Added concrete rollback/idempotence rules to prevent mixed canonical/legacy outcomes after partial failure.
4. Added phase-level test requirements tied to specific files/functions, including non-fatal injection behavior and migration-order assertions.

### New Considerations Discovered

- `create_project_with_state` is canonical for state registration, but current modal flows do not call it directly.
- `run_migration` does not cover all modern existing-project cases by itself (`derive_migration_step` returns `Complete` when no `ROADMAP.md` and no DB rows).
- Guidance injection exists and is robust, but onboarding currently depends on manual invocation paths.

---

**Roadmap Item:** `architecture-direction-part-two`  
**Status:** Draft  
**Created:** 2026-02-24  
**Type:** `fix`

---

## Section Manifest

Section 1: `Current Gaps` - reconcile actual create/add-existing behavior against target architecture.  
Section 2: `Target End State` - define invariants that must be true immediately after onboarding.  
Section 3: `Decision Matrix` - define exact sequence per onboarding scenario.  
Section 4: `Proposed Solution` - define one deterministic orchestration path for both wizard modes.  
Section 5: `Technical Approach` - frontend/backend contracts, ordering, idempotence, rollback, and safety rails.  
Section 6: `Implementation Plan` - phased execution for code changes and verification.  
Section 7: `Acceptance Criteria` - measurable functional/non-functional outcomes.  
Section 8: `Risks and Mitigations` - migration/data-loss and partial-failure containment.  
Section 9: `Manual Test Matrix` - concrete do-this-then-that validation.  
Section 10: `References and Research` - internal grounding and official docs.

## Research Consolidation

### Architecture Direction Anchors

This plan directly executes unresolved Phase 5 intent from `docs/plans/architecture-direction-plan-v2.md`:
- 5.2 AddProjectDialog overhaul (canonical file semantics, migration-aware add-existing).
- 5.3 project creation flow cutover to `create_project_with_state`.
- 5.4 guidance injection trigger in onboarding.
- 5.19 dual-filename canonical precedence and warning behavior.

### Code Reality (Current)

1. `createNewProjectFlow` still writes `PROJECT.md` and does not call state registration (`src/lib/project-flows.ts:339`).
2. `addExistingProjectFlow` performs file patching and optional git init, but no guaranteed DB/state registration (`src/lib/project-flows.ts:383`).
3. Wizard submit handlers call those flows directly (`src/components/AddProjectDialog.tsx:286`, `src/components/AddProjectDialog.tsx:468`).
4. `create_project_with_state` already performs atomic registration + projection and updates `.gitignore` (`src-tauri/src/lib.rs:2039`).
5. `run_migration` only imports/registers when legacy roadmap artifacts require migration; it is not a generic “register existing modern repo” command (`src-tauri/src/migration.rs:128`).
6. startup migration sweep is currently a backstop and still performs late repair work (`src-tauri/src/lib.rs:686`).

### Institutional Learnings Applied

1. Phase-gated rollout with explicit validation checkpoints (`docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`).
2. Keep loops bounded and avoid speculative over-expansion; focus on high-certainty execution details (`docs/solutions/high-token-usage-lessons-opus46-2026-02-20.md`).

## Current Gaps

1. Create New flow still writes `PROJECT.md` and does not directly register state via `create_project_with_state`.
2. Add Existing flow can patch files and init git, but does not guarantee immediate canonical `.clawchestra/state.json` registration.
3. `CLAUDE.md` integration is available but not integrated into onboarding modal success path.
4. Startup migration sweep is acting as a safety net for some onboarding outcomes that should be completed in-flow.

### Research Insights

**Best Practices:**
- Onboarding should end in a complete target state, not rely on next-launch repair.
- Registration paths should be idempotent so retries are safe after partial failures.
- Keep one canonical path for state registration to avoid hidden divergence.

**Implementation Details:**
- Existing create flow currently writes legacy filename (`PROJECT.md`) and optional `AGENTS.md` plus `.gitignore`.
- Existing add-existing flow can create `CLAWCHESTRA.md` and patch frontmatter but does not enforce immediate state registration.
- `create_project_with_state` already provides DB + `.clawchestra/state.json` + `.gitignore` semantics.

**Institutional Learnings Applied:**
- Phase-gated execution and explicit validation checkpoints from `docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`.
- Loop-budgeting and batched verification discipline from `docs/solutions/high-token-usage-lessons-opus46-2026-02-20.md`.

## Target End State

After a user clicks **Create Project** or **Add to Dashboard**, all invariants below must be true before success toast:

1. `CLAWCHESTRA.md` exists and is parse-valid.
2. `.clawchestra/state.json` exists and is registered in runtime/DB state.
3. `.gitignore` includes `.clawchestra/`.
4. Legacy `ROADMAP.md`/`CHANGELOG.md` are not created by onboarding flows.
5. For git repos, guidance injection is attempted and result is surfaced (non-fatal if skipped/partial).

### Artifact Contract by Flow

| Flow | Must exist on success | Must not be created by onboarding |
| --- | --- | --- |
| Create New | `CLAWCHESTRA.md`, `.clawchestra/state.json`, `.gitignore` containing `.clawchestra/`, optional `AGENTS.md` | `PROJECT.md`, `ROADMAP.md`, `CHANGELOG.md` |
| Add Existing (modern) | Existing/created `CLAWCHESTRA.md`, `.clawchestra/state.json`, registered DB entry, `.gitignore` containing `.clawchestra/` | New legacy roadmap/changelog artifacts |
| Add Existing (legacy roadmap) | migrated `.clawchestra/state.json`, preserved migrated roadmap items in DB, canonical `CLAWCHESTRA.md` | New legacy artifacts post-migration |
| Add Existing (pre-existing local state) | existing `.clawchestra/state.json` preserved + backed up, then validated/imported and registered | Destructive overwrite with empty/new projected state |

### Research Insights

**Best Practices:**
- Define success by invariants, not by “command returned ok”.
- Treat guidance injection as post-registration enrichment, never as a blocker for project creation.

**Edge Cases:**
- Existing repo with `PROJECT.md` only and no `ROADMAP.md` must still be canonicalized (rename path + registration).
- Existing repo with legacy roadmap files must migrate before canonical registration to avoid data-loss.
- Dirty repo override should not bypass data-safety checks for migration operations.

## Decision Matrix

| Scenario | Detection signal | Required sequence |
| --- | --- | --- |
| Create New | Wizard mode = create-new | `mkdir/files` -> `create_project_with_state` -> optional git init -> optional injection |
| Add Existing: modern canonical | no `ROADMAP.md`; may already have `CLAWCHESTRA.md` | ensure canonical metadata -> `create_project_with_state` (registration) -> optional rename cleanup -> optional git init -> optional injection |
| Add Existing: legacy roadmap | `ROADMAP.md` present or migration step != `Complete` with legacy signals | ensure compatibility guardrails -> `run_migration` first -> registration/idempotence check -> rename cleanup -> optional git init -> optional injection |
| Add Existing: legacy filename only | `PROJECT.md` present, no `CLAWCHESTRA.md` | ensure metadata validity -> registration -> `rename_project_md` -> optional injection |
| Add Existing: pre-existing `.clawchestra/state.json` | state file exists before onboarding registration | backup existing state -> validate -> import/register from existing state -> canonicalize filename if needed -> optional injection |
| Add Existing: dirty repo + no override | compatibility reports dirty | fail fast before file/registration mutation |
| Create Project retry | same target clicked again after prior success/timeout | idempotent success/no-op if same id+path |
| Add Existing retry | same folder clicked again after prior success/timeout | idempotent success/no-op if same id+path |
| Identity conflict | same id different path OR same path different id | hard error with explicit conflict reason; do not mutate tracked data |

## Scope

### In Scope

1. `src/components/AddProjectDialog.tsx`
2. `src/lib/project-flows.ts`
3. `src/lib/tauri.ts` onboarding command usage
4. Tauri onboarding registration behavior (`create_project_with_state` and migration orchestration)
5. Onboarding-time guidance injection behavior
6. Rollback and flow tests for create/add-existing behavior
7. One-time fleet reconciliation for all currently tracked projects (db + `.clawchestra/state.json` + canonical filename/ignore invariants)

### Out of Scope

1. Full visual redesign of Project Wizard
2. New roadmap lifecycle features unrelated to onboarding
3. Unrelated broad feature refactors outside onboarding + migration alignment

## Proposed Solution

Introduce a single onboarding orchestrator path used by both Create New and Add Existing:

1. Run a one-time fleet reconciliation pass across currently tracked projects and bring them to target invariants.
2. Normalize metadata files first (`CLAWCHESTRA.md` canonical file, frontmatter validity).
3. Determine migration mode for Add Existing:
- If legacy roadmap artifacts exist: run migration first.
- Otherwise: direct canonical registration.
4. Ensure canonical registration through state command path.
5. Ensure `PROJECT.md` legacy filename is renamed where needed.
6. Attempt guidance injection for git repos and report branch-level outcome.

### Research Insights

**Architecture Considerations:**
- Prefer a single high-level function per onboarding mode that sequences low-level steps with explicit rollback boundaries.
- Minimize duplicate write paths between frontend file mutation code and backend state registration commands.

**Data Integrity Considerations:**
- Migration and registration should be ordered to preserve legacy roadmap items when present.
- Duplicate-ID and duplicate-registration handling should be deterministic and idempotent.

## Technical Approach

### Frontend File-Level Changes

1. `src/lib/project-flows.ts`
- Update create flow to write `CLAWCHESTRA.md` only.
- Import/use `createProjectWithState`, `runMigration`, `renameProjectMd`, `injectAgentGuidance`.
- Add explicit scenario branch logic for add-existing (legacy roadmap, modern canonical, legacy filename only).
- Extend rollback to include post-file registration failures without deleting user pre-existing files in add-existing.

2. `src/components/AddProjectDialog.tsx`
- Keep UI simple but align copy to canonical outcomes.
- Preserve existing toggles for git/agents; add explicit injection behavior messaging (automatic non-fatal).
- Ensure compatibility report language maps to decision matrix above.

3. `src/lib/tauri.ts`
- Reuse existing typed wrappers; no new command required unless idempotent registration helper is needed after implementation review.

### Frontend Orchestration

1. Keep modal UX simple, but align labels with actual outcomes.
2. On submit, run an explicit sequenced operation with typed outcomes and actionable error messages.
3. Keep current rollback behavior for file writes; extend to include state registration and guidance injection outcomes.

### Backend Contract

1. Reuse `create_project_with_state` for canonical registration.
2. Reuse `run_migration` for legacy-roadmap projects.
3. Reuse `rename_project_md` for legacy filename canonicalization when migration does not rename by itself.
4. Reuse `inject_agent_guidance` for branch-wide guidance update.
5. Use migration status/reconciliation commands to audit and repair currently tracked projects before declaring completion.

### Fleet Reconciliation Protocol (Current Tracked Projects)

1. Build inventory of currently tracked projects from DB and migration status.
2. For each tracked project, evaluate invariants:
- `CLAWCHESTRA.md` exists (or is safely renamed from `PROJECT.md`).
- `.clawchestra/state.json` exists and is consistent with DB projection.
- `.gitignore` contains `.clawchestra/`.
- Legacy roadmap/changelog artifacts are either migrated or intentionally preserved only in backup path.
3. For projects requiring migration, run migration and verify terminal step and warnings.
4. For projects requiring canonical filename/ignore fix, apply repair steps and re-verify.
5. Emit a deterministic reconciliation report: project id, before/after step, actions taken, warnings/errors, final invariant status.

### Ordering Rules

Add Existing must follow this order:

1. Ensure metadata file/fm validity (`CLAWCHESTRA.md` preferred).
2. If legacy roadmap artifacts exist, run migration.
3. Ensure project is registered in canonical state path.
4. Ensure legacy filename rename (`PROJECT.md` -> `CLAWCHESTRA.md`) if still present.
5. Initialize git if requested and missing.
6. Inject guidance if repo is git.

### Critical Ordering Note

`run_migration` cannot be used as generic registration for modern repos with no legacy roadmap data. For that path, explicit `create_project_with_state` registration is mandatory.

### Pre-existing State Handling (Locked)

1. If `.clawchestra/state.json` already exists before `Add Existing`, treat it as Clawchestra-owned local state.
2. Create backup first: `.clawchestra/backup/state.pre-onboarding.<timestamp>.json`.
3. Validate existing state; if valid, import/register from this state rather than replacing with empty projected state.
4. If import/register detects identity conflict (same id different path OR same path different id), stop with explicit error and keep existing state untouched.
5. Do not attempt automatic field-level merge between competing unknown state sources in this phase.

### Idempotence Strategy

1. `Create Project` retry for same id+path should return success/no-op (not duplicate creation).
2. `Add Existing` retry for same id+path should return success/no-op (not duplicate registration).
3. Same id + different path should return hard conflict error.
4. Same path + different id should return hard conflict error.
5. Registration step should be safe to retry (via explicit duplicate semantics in flow/command behavior).
6. Migration step should be no-op safe when already complete.
7. Rename step should be no-op safe when already canonical.
8. Injection step should remain non-fatal and report per-branch skip reasons (`already_injected`, `worktree_checked_out`, etc.).

### Rollback Strategy

1. Create New:
- If registration fails after file creation, remove newly created files/folder (current create rollback semantics).
- Do not leave orphaned directory with partial scaffold.

2. Add Existing:
- Never delete pre-existing user files.
- Revert only files created/edited by this flow and only when safe backups exist.
- If registration fails after metadata normalization, restore modified metadata from backup and report actionable error.

### Security and Safety

1. Preserve absolute-path validation and scan-path policy checks.
2. Keep dirty-repo override explicit for add-existing.
3. Keep guidance injection non-fatal and transparent to user.
4. Enforce scan-path policy in backend onboarding commands (not just UI checks), rejecting out-of-scope paths even if command is called directly.
5. Keep command input validation explicit and path-safe for all filesystem mutations.

### Research Insights

**Performance Considerations:**
- Keep onboarding operations bounded and sequential; avoid unnecessary re-scans in the middle of flow.
- Trigger a single project reload after successful flow completion.

**Implementation Details:**
```ts
// Target orchestration shape (frontend)
await normalizeProjectMetadata();
if (hasLegacyRoadmapArtifacts) {
  await runMigration(projectId, projectPath, projectTitle);
}
await ensureCanonicalRegistration();
await renameProjectMd(projectPath); // no-op if already canonical
if (isGitRepo) {
  const injection = await injectAgentGuidance(projectPath); // non-fatal
  showInjectionSummary(injection);
}
```

**Documentation-grounded command handling:**
- Tauri commands should continue using `Result<T, String>` and frontend `try/catch` handling to keep error boundaries explicit.
- Structured progress/outcome payloads should remain typed and serializable for UI-friendly feedback.

## Implementation Plan

### Phase 0: Fleet Migration and Reconciliation (Current Projects)

Tasks:

- [x] Run migration/status audit for all currently tracked projects.
- [x] Produce per-project reconciliation matrix (`before step`, `actions`, `after step`, `warnings`, `invariants pass/fail`).
- [x] For projects not in target state, apply required migration/repair steps.
- [x] Verify each tracked project satisfies canonical invariants post-reconciliation.
- [x] Keep reconciliation idempotent: rerun produces no destructive changes and stable status.

Acceptance:

- [x] Every currently tracked project is either canonicalized or explicitly flagged with actionable remediation.
- [x] Reconciliation report exists and is reviewable in-repo.
- [x] Rerunning reconciliation does not regress already canonical projects.

### Phase 1: Canonical Create-New Registration

Tasks:

- [x] Update `createNewProjectFlow` to write `CLAWCHESTRA.md` (not `PROJECT.md`).
- [x] Keep optional `AGENTS.md` creation and optional git init behavior.
- [x] Register project through `createProjectWithState(...)` so `.clawchestra/state.json` and DB entry are created immediately.
- [x] Extend rollback to include registration failure after file creation.
- [x] Ensure `.gitignore` result contains `.clawchestra/` after create flow completes.

Acceptance:

- [x] Create New produces `CLAWCHESTRA.md` + `.clawchestra/state.json` in one flow.
- [x] Create New never writes `PROJECT.md`.
- [x] Create flow remains retry-safe for transient mutation lock errors.

### Phase 2: Add-Existing Deterministic Cutover

Tasks:

- [x] Detect legacy migration need from compatibility scan (`ROADMAP.md`/legacy indicators).
- [x] For legacy roadmap repos: run `runMigration(...)` before canonical registration checks.
- [x] For modern repos: register directly via state command path.
- [x] For repos with pre-existing `.clawchestra/state.json`: backup, validate, and import/register from existing state (no destructive overwrite).
- [x] Ensure registration/idempotence behavior is deterministic when migration already inserted DB rows.
- [x] Implement explicit conflict outcomes:
  - [x] same id + same path => success/no-op
  - [x] same id + different path => hard error
  - [x] same path + different id => hard error
- [x] Ensure `.gitignore` includes `.clawchestra/` on completion.
- [x] Ensure add-existing modern path does not silently rely on startup migration sweep.
- [x] Add explicit migration success gate (`error == null` and acceptable terminal step) before continuing to registration/finalization.

Acceptance:

- [x] Add Existing results in immediate canonical tracked state (no restart dependency).
- [x] Legacy roadmap-bearing projects migrate without roadmap data loss.
- [x] Modern repos without `ROADMAP.md` are still registered in DB/state during onboarding.
- [x] Existing `.clawchestra/state.json` is preserved and imported when present.

### Phase 3: Legacy Filename Canonicalization

Tasks:

- [x] Ensure onboarding flow calls `renameProjectMd(...)` where `PROJECT.md` remains.
- [x] Ensure modal success semantics require canonical filename presence.
- [x] Add explicit non-fatal warning path if rename cannot be completed.
- [x] Preserve dual-filename warning behavior when both files exist.

Acceptance:

- [x] Projects onboarded through UI end with `CLAWCHESTRA.md` canonical filename.
- [x] No new `PROJECT.md` files are authored by onboarding code.

### Phase 4: Guidance Injection In-Flow

Tasks:

- [x] Add onboarding behavior for guidance injection on git repos.
- [x] Use automatic non-fatal injection with concise result summary (recommended default).
- [x] Invoke `injectAgentGuidance(projectPath)` after successful onboarding.
- [x] Surface skipped branch outcomes (`already_injected`, `worktree_checked_out`) clearly.

Acceptance:

- [x] Git repos onboarded via wizard attempt guidance injection in the same flow.
- [x] Injection issues do not corrupt project onboarding success state.

### Phase 5: UX Copy and Guardrail Cleanup

Tasks:

- [x] Update modal labels and helper text to match canonical outcomes.
- [x] Remove stale wording that implies legacy roadmap/changelog setup.
- [x] Ensure compatibility report language references canonical + migration semantics.
- [x] Clarify that `Create AGENTS.md` is independent of CLAUDE guidance injection (which is automatic/non-fatal for git repos).

Acceptance:

- [x] UI copy is consistent with actual filesystem/runtime behavior.
- [x] User can infer expected artifacts from modal copy without architecture context.

### Phase 6: Tests and Verification

Tasks:

- [x] Update `src/lib/project-flows.rollback.test.ts` for canonical create/add behavior.
- [x] Add/adjust tests for:
  - [x] Create New writes canonical files and registers state.
  - [x] Create Project retry on same target is success/no-op.
  - [x] Add Existing legacy-roadmap path migrates before registration.
  - [x] Add Existing modern path registers immediately.
  - [x] Add Existing retry on same folder is success/no-op.
  - [x] Add Existing with pre-existing `.clawchestra/state.json` backs up + preserves/imports state.
  - [x] identity conflict matrix (same id different path / same path different id) returns explicit hard errors.
  - [x] Legacy filename rename path is exercised.
  - [x] Guidance injection call path is exercised (mocked).
- [x] Add/adjust Rust tests where command semantics changed:
  - [x] migration ordering assertions remain valid.
  - [x] registration command path assertions for onboarding flow expectations.
- [x] Add/adjust backend command tests to enforce scan-path policy for onboarding mutation commands.
- [x] Add/adjust reconciliation tests:
  - [x] tracked-project audit discovers non-canonical states.
  - [x] reconciliation transitions projects to canonical invariants.
  - [x] reconciliation rerun is idempotent.
- [x] Run baseline validation gates.

Acceptance:

- [x] `npx tsc --noEmit` passes.
- [x] `bun test` passes.
- [x] `cargo test --manifest-path src-tauri/Cargo.toml` passes.
- [x] `pnpm build` passes.
- [x] `npx tauri build --no-bundle` passes.

## Acceptance Criteria

### Functional

- [x] Create New and Add Existing produce identical canonical onboarding end-state invariants.
- [x] Legacy data-bearing repos are migrated safely before canonical registration.
- [x] Guidance injection behavior is integrated and user-visible in onboarding flow.
- [x] Startup migration sweep is no longer required to make newly onboarded projects canonical.
- [x] Existing `.clawchestra/state.json` is preserved/imported on Add Existing.
- [x] `Create Project` and `Add Existing` retries are idempotent for same id+path.
- [x] Conflict scenarios (same id different path, same path different id) fail safely with explicit errors.
- [x] All currently tracked projects are reconciled to desired target state or explicitly flagged.

### Non-Functional

- [x] Onboarding remains responsive (<2s for modern local repo path, excluding migration-heavy repos).
- [x] Retrying onboarding after failure is idempotent and does not duplicate DB rows.
- [x] No new dependency on startup migration sweep for projects created/added via wizard.
- [x] Error messages remain actionable (path, guardrail, and next-step clarity).
- [x] Backend rejects onboarding mutation paths outside configured scan roots.
- [x] Fleet reconciliation is safe to rerun and does not degrade canonical projects.

### Quality Gates

- [x] `npx tsc --noEmit`
- [x] `bun test`
- [x] `cargo test --manifest-path src-tauri/Cargo.toml`
- [x] `pnpm build`
- [x] `npx tauri build --no-bundle`

## Risks and Mitigations

1. Migration-order bug may drop legacy roadmap data.
Mitigation: enforce migration-first ordering for legacy roadmap-bearing repos; verify item counts before/after.

2. Duplicate registration and ID collisions during add-existing.
Mitigation: enforce deterministic id strategy (`canonicalSlugify`) and idempotent registration handling.

3. Partial failure leaves mixed canonical/legacy files.
Mitigation: extend rollback envelope and add explicit post-step invariant checks.

4. Guidance injection failures in multi-worktree repos create noisy false failures.
Mitigation: treat injection as non-fatal enrichment, with explicit skip reason reporting.

5. Registration command semantics drift from frontend assumptions.
Mitigation: lock expected behavior with tests and keep wrappers typed in `src/lib/tauri.ts`.

## Manual Test Matrix

1. Create New (git on, agents on):
Expected: `CLAWCHESTRA.md`, `.clawchestra/state.json`, `.gitignore` contains `.clawchestra/`, optional `AGENTS.md`, guidance injection attempted.

2. Add Existing modern repo (`CLAWCHESTRA.md`, no legacy roadmap):
Expected: immediate canonical registration and successful dashboard tracking without restart.

3. Add Existing legacy repo (`PROJECT.md` + `ROADMAP.md`):
Expected: migration runs first, roadmap data preserved, canonical registration complete.

4. Add Existing legacy filename only (`PROJECT.md`, no `ROADMAP.md`):
Expected: canonical registration plus rename path, ending with `CLAWCHESTRA.md`.

5. Guidance injection edge cases:
Expected: branch skips are surfaced (`already_injected`, `worktree_checked_out`) and do not fail onboarding.

6. App relaunch after each scenario:
Expected: no corrective startup migration needed for newly onboarded projects.

7. Create New failure injection (simulated registration failure after file write):
Expected: flow rolls back created files/folder, no orphan project directory remains.

8. Add Existing failure injection (simulated late failure):
Expected: existing user files restored from backups, no destructive delete of pre-existing files.

9. Add Existing with pre-existing `.clawchestra/state.json`:
Expected: backup created under `.clawchestra/backup/`, existing state preserved/imported, no empty-state overwrite.

10. `Create Project` duplicate submit (same target):
Expected: no duplicate project; second action returns success/no-op semantics.

11. `Add Existing` duplicate submit (same folder):
Expected: no duplicate registration; second action returns success/no-op semantics.

12. Conflict matrix checks:
Expected: same id + different path => hard error; same path + different id => hard error.

13. Current tracked-project fleet reconciliation:
Expected: reconciliation report shows each tracked project with final invariant status; non-canonical projects are repaired or clearly flagged with next actions.

## References and Research

### Internal References

- `src/lib/project-flows.ts:295`
- `src/lib/project-flows.ts:383`
- `src/components/AddProjectDialog.tsx:113`
- `src/components/AddProjectDialog.tsx:282`
- `src/lib/tauri.ts:673`
- `src/lib/tauri.ts:685`
- `src/lib/tauri.ts:762`
- `src/lib/tauri.ts:808`
- `src-tauri/src/lib.rs:2039`
- `src-tauri/src/lib.rs:2591`
- `src-tauri/src/lib.rs:2620`
- `src-tauri/src/lib.rs:2704`
- `src-tauri/src/lib.rs:3251`
- `src-tauri/src/lib.rs:686`
- `src-tauri/src/migration.rs:1160`
- `src-tauri/src/migration.rs:128`
- `src-tauri/src/injection.rs:21`
- `src-tauri/src/injection.rs:375`
- `src/lib/store.ts:661`
- `docs/plans/architecture-direction-plan-v2.md:1218`
- `docs/plans/architecture-direction-plan-v2.md:1250`
- `docs/plans/architecture-direction-plan-v2.md:1279`
- `docs/DESIGN_PRINCIPLES.md`
- `docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`
- `docs/solutions/high-token-usage-lessons-opus46-2026-02-20.md`

### External References

- Tauri v2 Rust command invocation docs: https://v2.tauri.app/develop/calling-rust/
- Tauri v2 events docs: https://v2.tauri.app/develop/calling-frontend/
