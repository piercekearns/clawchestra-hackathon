# First Friend Readiness - Plan

> Ship the release, onboarding, connection, and dependency work needed for a real first-friend public alpha.

## Summary

This plan updates FFR to the current Clawchestra architecture and the current product goal: a new user should be able to install Clawchestra from a website-first flow, connect to OpenClaw whether it is local or remotely hosted, import projects, and use both chat and embedded terminals without owner-specific setup knowledge. The work is no longer just a cross-platform cleanup. It is a coordinated productization pass across release infrastructure, repo hygiene, OpenClaw runtime configuration, onboarding, and terminal dependency readiness.

The plan assumes we will reuse what already exists: the settings page, Add Existing compatibility flow, guidance injection, remote sync settings, extension installer primitive, system-context generation, and terminal infrastructure.

---

**Roadmap Item:** `first-friend-readiness`
**Spec:** `docs/specs/first-friend-readiness-spec.md`
**Status:** In Progress
**Created:** 2026-02-19
**Updated:** 2026-03-06

---

## Locked Goals

1. Website-first install flow backed by real release artifacts.
2. Native install support for macOS, Linux, and Windows.
3. Local and remote OpenClaw support.
4. Embedded terminals are part of default functionality, not an optional advanced mode.
5. Public-alpha repo/release hygiene is part of FFR, not a follow-up.
6. The website consumes release/distribution primitives; it does not invent them.

## Known Inputs

1. Website domain is `clawchestra.ai`.
2. GitHub repo is `piercekearns/clawchestra`.
3. Website-first distribution is required.
4. Embedded terminals are mandatory default functionality.
5. The app identifier should become non-personal and stable before the first public installable build.
6. `source-rebuild` is understood as a developer workflow, not the default friend workflow.

## Decision Notes

The following should be treated as locked or nearly locked by this plan:

1. **Application identifier:** lock to `ai.clawchestra.desktop`.
2. **End-user update posture:** default to release-artifact updates for end users; keep `source-rebuild` as a developer path.
3. **Artifact defaults:** macOS `.dmg`, Windows `.msi`, Linux `.AppImage` plus `.deb`.
4. **Package-name strategy:** actively claim namespace-level assets early where clean and cheap; avoid publishing fake placeholder packages solely to reserve names.
5. **Terminal readiness:** if tmux cannot be bundled, the app must offer one-click remediation from the terminal creation flow.
6. **Public repo posture:** public source-visible alpha with explicit docs and no implicit promise that the project remains open source long-term.
7. **Website/release topology:** `clawchestra.ai` fronts GitHub Releases on `piercekearns/clawchestra`.
8. **Bootstrap package rule:** do not block FFR on a CLI/bootstrap package; ship one only if it provides real install value and is not a placeholder wrapper.
9. **macOS alpha posture:** Phase 1 uses unsigned macOS public-alpha builds with explicit trust guidance; notarization is deferred.

## Claiming Support Model

Claiming and ownership management are part of FFR delivery, not side chores left to memory.

For every package/domain/channel claim, FFR should produce:

1. proposed name
2. target channel
3. whether it should be claimed now or deferred
4. whether the claim can be executed here or requires a user-owned web account
5. expected cost/billing posture
6. owner/account of record
7. renewal/recovery notes
8. current status

Execution model:

1. The agent prepares the recommendation and exact claiming steps.
2. The agent executes what can be done from the repo/CLI side.
3. The user performs account-bound web claims when required.
4. The result is recorded in a claim ledger with management notes so future maintenance is obvious.

## Execution Sequence

FFR should be delivered in this order:

1. **Phase 0:** lock public-alpha hygiene and distribution/claiming foundations.
2. **Phase 1:** make release artifacts and cross-platform runtime behavior credible.
3. **Phase 2:** align OpenClaw chat transport and sync setup with current architecture.
4. **Phase 3:** build the onboarding shell on top of the existing settings/import machinery.
5. **Phase 4:** finish terminal dependency readiness and one-click remediation.
6. **Phase 5:** connect the website to the release/distribution system already built underneath.

This order matters because the website and onboarding should sit on top of real release and runtime primitives, not mask missing productization work underneath.

## Phase 0 - Public-Alpha Hardening And Release Decisions

### Goals

1. Remove owner-specific assumptions from the public-facing product surface.
2. Lock the release/distribution decisions that later phases depend on.

### Work

1. Choose final non-personal Tauri identifier.
2. Audit shipped defaults and placeholders:
   - workspace path defaults
   - scan path placeholders
   - app source placeholders
   - terminal dependency hints
3. Audit docs/tests for public-repo path leakage and move internal-only material if needed.
4. Define public repo posture:
   - license or explicit non-open-source notice
   - README/release docs expectations
5. Claim or reserve package/domain names needed for:
   - website
   - GitHub Releases naming
   - optional CLI bootstrap channel
6. Claim namespace-level assets now where appropriate:
   - npm user/org scope
   - Homebrew tap repo
   - other clean namespace channels
7. Track registry package names that should wait for real artifacts rather than placeholder publication.
8. Write the release/distribution matrix that the website will later consume.
9. Create and maintain a claim ledger covering:
   - name
   - channel
   - claim timing
   - cost
   - owner
   - recovery/renewal notes
   - status
10. Guide or execute claims channel by channel, then record what was actually claimed and how it is managed.

### Exit Criteria

1. No shipped UI defaults assume one developer's filesystem layout.
2. Final app identifier is chosen before any public installable build ships.
3. Public repo posture is explicit.
4. Package/domain ownership decisions are recorded.
5. Public scrub checklist exists and passes.
6. Namespace claims that can be made cleanly now are either completed or explicitly waived.
7. A claim ledger exists with ownership, cost, and management notes for every relevant channel.

## Phase 1 - Release Plumbing

### Goals

1. Produce installable artifacts for macOS, Linux, and Windows.
2. Make GitHub Releases the canonical source of truth for first-friend distribution.
3. Remove the most important macOS-only runtime assumptions before treating non-macOS builds as valid.

### Work

1. Expand Tauri bundle targets by OS.
2. Add CI/release automation for:
   - macOS artifact(s)
   - Linux artifact(s)
   - Windows artifact(s)
3. Define artifact naming and release note structure.
4. Add root install documentation:
   - website-first path
   - GitHub Releases fallback path
   - advanced source-build path
   - explicit note that native installers are the primary paid-product install surface and CLI/package managers are secondary unless a real bootstrap product ships
5. If a thin CLI/bootstrap command is implemented in FFR, ensure it installs or launches a real release flow rather than existing only to hold a package name.
6. Perform cross-platform runtime hardening:
   - title bar / window chrome behavior
   - path and home-directory assumptions
   - shell/process execution assumptions
   - updater behavior split between dev `source-rebuild` and end-user installs
   - terminal dependency remediation copy and flows on each OS
7. Run a whole-codebase cross-platform audit so non-macOS validity is based on broad review, not only on the currently-known hotspot list.
8. Maintain a concrete audit artifact for the whole-codebase review:
   - `docs/plans/first-friend-readiness-phase-1-audit-checklist.md`
9. Maintain a concrete release operations artifact for public-alpha shipping:
   - `docs/plans/first-friend-readiness-release-playbook.md`

### Implementation Map

1. `src-tauri/tauri.conf.json`
2. repo release automation (`.github/`)
3. root `README.md`
4. website/download manifest or equivalent release metadata source
5. platform-sensitive runtime code in:
   - `src/components/TitleBar.tsx`
   - `src-tauri/src/lib.rs`
   - `src-tauri/src/commands/update.rs`
   - `src-tauri/src/commands/terminal.rs`
6. broad audit targets across the full app:
   - `src/`
   - `src-tauri/`
   - onboarding/settings/sync/chat/terminal flows end-to-end

### Exit Criteria

1. A release can be cut without manual OS-by-OS heroics.
2. GitHub Releases contains usable artifacts for all target OSes.
3. A new user has a documented install path without cloning the repo.
4. Source-build remains available as an advanced/developer option.
5. Windows/Linux packaged installs are not being treated as valid until the core runtime UX behaves correctly, not just until artifacts exist.
6. A whole-codebase cross-platform audit has been completed and recorded before first friend builds are handed off for non-macOS testing.
7. Real Windows/Linux installer validation is deferred to FFR verification/friend-testing and does not block the start of Phase 2 once the first draft prerelease exists.

## Phase 2 - OpenClaw Transport And Sync Alignment

### Goals

1. Separate chat transport settings from sync settings in both runtime behavior and UI copy.
2. Make local and remote OpenClaw setups first-class and testable.

**Status note (2026-03-06):** Built and validated locally. See `docs/reports/2026-03-06-first-friend-readiness-phase-2-closeout.md`.

### Work

1. Add explicit chat transport settings:
   - websocket URL
   - token
   - session key
2. Update default transport resolution so chat does not rely only on local `~/.openclaw/openclaw.json`.
3. Keep existing sync settings model, but productize it:
   - Local / Remote / Disabled semantics
   - remote URL and bearer token UX
4. Add connection and health testing for:
   - chat transport
   - sync transport
5. Integrate extension/system-context status into setup and troubleshooting flows.
6. Redact secrets in logs, error states, and debug output.

### Implementation Map

1. `src-tauri/src/lib.rs`
2. `src/lib/settings.ts`
3. `src/components/SettingsForm.tsx`
4. `src/lib/gateway.ts`
5. `src-tauri/src/sync.rs`

### Exit Criteria

1. A remote OpenClaw user can configure chat and sync without editing local files by hand.
2. Local OpenClaw continues to work with sensible auto-detection.
3. Connection failures are actionable.
4. Settings UI no longer implies that prompt-context controls are the same as transport controls.

## Phase 3 - Onboarding Shell

**Status note (2026-03-06):** Built and validated locally. See `docs/reports/2026-03-06-first-friend-readiness-phase-3-closeout.md`.

### Goals

1. Replace silent first launch with guided setup.
2. Reuse existing settings and project-import machinery instead of rebuilding it.

### Work

1. Add first-run/incomplete-setup detection.
2. Create an onboarding shell that orchestrates:
   - welcome/access transparency
   - OpenClaw connection and sync setup
   - extension/system-context readiness
   - scan path selection
   - Add Existing/import flow reuse
   - terminal dependency readiness
3. Add re-run onboarding entry point from settings.
4. Ensure existing installs bypass onboarding unless re-run is requested.

### Implementation Map

1. `src/App.tsx`
2. onboarding UI module(s) under `src/components/`
3. `src/components/SettingsPage.tsx` / `src/components/SettingsForm.tsx`
4. `src/lib/project-flows.ts`
5. `src/components/AddProjectDialog.tsx`

### Exit Criteria

1. Fresh install lands in a guided setup flow.
2. Onboarding ends in a usable board state, not a half-configured state.
3. Existing installs are not regressed.
4. Add Existing compatibility, migration, and guidance injection are preserved.

### Phase 3 carry-forward

1. Local OpenClaw support installation is now in-app, but remote OpenClaw extension installation is still manual/copy-based.
2. That remaining gap is part of FFR's remote onboarding bar and must be resolved before calling FFR complete.
3. Phase 4 should absorb this as part of first-friend runtime/setup productization so remote users have a supported path, not just raw copied content.

## Phase 4 - Terminal Readiness And Default Lifecycle Behavior

**Status note (2026-03-06):** Built and validated locally. See `docs/reports/2026-03-06-first-friend-readiness-phase-4-closeout.md`.

### Goals

1. Make embedded terminals actually first-friend ready.
2. Remove dead-end runtime dependency failures from the default product loop.
3. Finish the remaining remote OpenClaw setup productization required for first-friend onboarding.

### Work

1. Decide tmux strategy:
   - bundle tmux per OS, or
   - one-click install/remediation from within the app
2. Expand tool detection to supported OSes and supported CLIs.
3. Update terminal creation UX so missing dependencies route to remediation, not a dead disabled state.
4. Adjust default lifecycle behavior so it does not assume Claude Code everywhere.
5. Preserve a strong default preset while leaving room for later customization work.
6. Productize remote OpenClaw support installation:
   - prefer a single command the user runs on the remote OpenClaw host
   - keep manual extension-content install as fallback
   - verify the remote endpoint after setup from inside Clawchestra

### Implementation Map

1. `src-tauri/src/commands/terminal.rs`
2. `src/components/hub/TypePickerMenu.tsx`
3. `src/components/hub/TerminalShell.tsx`
4. `src/lib/deliverable-lifecycle.ts`
5. onboarding/settings support surfaces that present the remote-install method

### Exit Criteria

1. User can create a terminal immediately or remediate with one click.
2. Cross-platform dependency guidance is OS-appropriate.
3. Lifecycle defaults no longer hard-fail for non-Claude/tmux users.
4. Terminals remain part of the default Clawchestra product promise.
5. Remote OpenClaw users have an explicit supported setup path beyond raw manual file editing.

## Phase 5 - Website Integration

**Status note (2026-03-06):** Built and validated locally. See `docs/reports/2026-03-06-first-friend-readiness-phase-5-closeout.md`.

### Goals

1. Present the release system through a simple website flow.
2. Keep website work thin and dependent on already-functional release primitives.
3. Keep FFR website work scoped to install/distribution correctness, not the whole marketing site.

### Work

1. Build the website download surface around the real artifact matrix.
2. Detect OS and offer the preferred artifact first.
3. Link release notes and fallback install instructions.
4. If CLI bootstrap ships, expose it here as a secondary path.
5. Reuse the eventual `clawchestra-ai-website` implementation for shared website components/pages rather than building a separate install surface.
6. Treat broader storytelling, waitlist, and marketing pages as owned by `clawchestra-ai-website`, not by FFR.

### Exit Criteria

1. Website is a routing layer over working releases.
2. Users can install from the website without understanding the repo.
3. Website copy matches the actual release/update behavior.
4. The overlap with `clawchestra-ai-website` is explicit: FFR owns release/download correctness, while the website item owns broader site narrative and design.

### Relationship To `clawchestra-ai-website`

These two items should dovetail, not duplicate.

1. `first-friend-readiness` owns the install/download truth:
   - release artifacts
   - OS detection/routing
   - install instructions
   - update posture
   - download surface correctness
2. `clawchestra-ai-website` owns the broader public site:
   - marketing narrative
   - visual system
   - waitlist/private-alpha posture
   - non-install pages
3. If the production website build starts while FFR Phase 5 is active, the shared download/install work should be implemented once inside the website codebase and accepted against both items.
4. FFR should not depend on a fully realized marketing site to close its install/distribution requirements, but the final public website must consume the same release/download primitives FFR establishes.

## Phase 6 - Windows Parity And Final FFR Verification

**Status note (2026-03-06):** Research passes 1 and 2 are complete, the implementation plan is written, implementation pass 1 is built locally, and the detached-host relaunch path is now built locally as implementation pass 2. The remaining Phase 6 gaps are real-machine Windows/Linux validation, findings triage, and any fixes that validation surfaces. See `docs/reports/2026-03-06-first-friend-readiness-phase-6-research-pass-1.md`, `docs/reports/2026-03-06-first-friend-readiness-phase-6-research-pass-2-ecosystem-survey.md`, `docs/reports/2026-03-06-first-friend-readiness-phase-6-implementation-pass-1.md`, `docs/reports/2026-03-06-first-friend-readiness-phase-6-implementation-pass-2.md`, `docs/specs/windows-terminal-persistence-spec.md`, `docs/plans/first-friend-readiness-phase-6-windows-persistence-plan.md`, and `docs/plans/first-friend-readiness-phase-6-friend-testing-checklist.md`.

### Goals

1. Close the remaining gap between "usable on Windows" and "honestly ready on Windows."
2. Run the final cross-platform friend-testing and closeout pass before calling FFR complete.

### Work

1. Research Windows terminal persistence from primary sources and the supporting brief at `docs/specs/windows-terminal-persistence-spec.md`.
2. Choose the Windows persistence architecture and write the implementation plan inside FFR.
3. Keep the Phase 6 pass-1 backend session manager in place so Windows terminals survive drawer close/reopen inside the running app.
4. Keep the detached-host Windows persistence path as the new baseline for honest parity claims.
5. Run real-machine friend-testing for Windows and Linux installs, onboarding, chat, sync, and terminals.
6. Fix any blockers surfaced by that testing.
7. Do the final FFR completion pass only after those platform findings are resolved or explicitly narrowed in scope.

### Exit Criteria

1. Website/download flow exists and points to real artifacts.
2. Windows support claim is honest:
   - either Windows terminal persistence is materially comparable to macOS/Linux
   - or the Windows support claim is explicitly narrowed
3. Real Windows/Linux friend-testing has been run and findings triaged.
4. FFR completion language matches the actual shipped platform bar.

## Validation Matrix

1. Platform validation:
   - macOS install, launch, connect, terminal creation
   - Linux install, launch, connect, terminal creation
   - Windows install, launch, connect, terminal creation
2. OpenClaw modes:
   - local chat + local sync
   - remote chat + remote sync
   - remote chat with local-only code execution through terminals
3. Onboarding states:
   - fresh install
   - corrupt settings recovery
   - existing install re-run onboarding
4. Project import:
   - clean canonical project
   - legacy project requiring migration
   - repo without metadata
5. Dependency readiness:
   - tmux present
   - tmux missing
   - agent CLI present/absent combinations
6. Public-alpha hygiene:
   - no owner-shaped defaults in shipped UI
   - no accidental sensitive/personalized release notes or install docs

## Test Gates

1. Type/build:
   - `pnpm build`
   - `npx tsc --noEmit`
   - `cargo check`
2. App validation:
   - onboarding happy path
   - local OpenClaw setup
   - remote OpenClaw setup
   - Add Existing/import flow
   - terminal dependency remediation
3. Release validation:
   - CI produces expected artifacts
   - artifacts install on target OSes
   - release notes and website links point to valid assets

## Phase Boundaries

1. Do not start website implementation before release plumbing exists.
2. Do not ship onboarding before chat transport and sync settings are coherent.
3. Do not call FFR complete while embedded terminals still dead-end on missing tmux.
4. Do not ship a public installable build before the identifier and scrub checklist are resolved.
5. Do not call FFR complete while remote OpenClaw onboarding still requires unclear/manual extension installation without an explicit supported path.
