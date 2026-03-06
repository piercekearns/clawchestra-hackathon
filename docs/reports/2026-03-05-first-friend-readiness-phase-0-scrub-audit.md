# First Friend Readiness Phase 0 Scrub Audit

> Record what was cleaned up for public-alpha publication and what still remains for Phase 1.

## Summary

This audit started as a leak-and-assumptions review of the repo and shipped product surface. Several Phase 0 cleanup items have now been fixed directly in the repo: the app identifier is non-personal, bundle metadata is non-personal, user-facing path placeholders are generic, test fixtures no longer use owner-specific paths, and the public repo posture is explicit at the root.

What remains is Phase 1 work, not publication hygiene work: release artifacts, cross-platform runtime validation, packaged-update posture, and terminal dependency remediation.

---

**Roadmap Item:** `first-friend-readiness`
**Status:** Ready
**Created:** 2026-03-05
**Updated:** 2026-03-05

---

## Scope

Audit scope covered:

1. shipped product configuration
2. user-facing settings and terminal UX
3. update/distribution posture
4. public repo hygiene in docs, tests, and root metadata

## Phase 0 Cleanup Landed

The following publication-hygiene fixes are now in the repo:

1. Tauri identifier changed to `ai.clawchestra.desktop`
   - file: `src-tauri/tauri.conf.json`
2. Rust package author metadata changed to `Clawchestra`
   - file: `src-tauri/Cargo.toml`
3. settings placeholders no longer point at owner-specific paths
   - file: `src/components/SettingsForm.tsx`
4. default OpenClaw workspace path no longer silently hardcodes a personal directory
   - file: `src-tauri/src/lib.rs`
5. terminal disabled-state copy no longer hardcodes Homebrew
   - file: `src/components/hub/TypePickerMenu.tsx`
6. current tests no longer use owner-specific workspace paths
   - files under `src/lib/*.test.ts`
7. root README now states the source-visible public alpha legal posture
   - file: `README.md`
8. package/domain claim inventory exists and records actual claimed surfaces
   - file: `docs/plans/first-friend-readiness-claim-ledger.md`

## Remaining Non-Phase-0 Gaps

These are still real gaps, but they belong to later work rather than publication cleanup:

1. Bundle targets are still macOS-only
   - current targets: `["app", "dmg"]`
   - file: `src-tauri/tauri.conf.json`
2. Window chrome config still has macOS-centric assumptions that need cross-platform validation
   - file: `src-tauri/tauri.conf.json`
3. End-user packaged updates are not implemented yet
   - current update flow is still `source-rebuild`-oriented and macOS-only
   - file: `src-tauri/src/commands/update.rs`
4. Terminal dependency remediation is not yet one-click or cross-platform
   - current UX is still a disabled state, not a remediation flow
5. Roadmap lifecycle prompts still assume Claude Code via tmux
   - file: `src/lib/deliverable-lifecycle.ts`

## Public Repo Hygiene Status

Publication posture is now:

1. root repo posture is explicit
2. package namespace claims are recorded
3. current public-facing docs are identified
4. historical docs are classified separately from the primary public path

See:

1. `README.md`
2. `docs/reports/2026-03-05-public-repo-doc-inventory.md`
3. `docs/plans/first-friend-readiness-manual-actions.md`
4. `docs/plans/first-friend-readiness-phase-0-checklist.md`

## Recommendation

Phase 0 publication hygiene is now in a state where the remaining known issues are Phase 1 productization work rather than repo-publication blockers.

The handoff into Phase 1 should be:

1. treat publication hygiene as complete enough for first public push preparation
2. treat artifact production, cross-platform runtime hardening, packaged updates, and terminal remediation as Phase 1 implementation work
3. keep the release/distribution matrix and claim ledger as the source of truth while Phase 1 is built
