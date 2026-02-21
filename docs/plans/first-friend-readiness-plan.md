# First Friend Readiness — Plan

> Make Clawchestra installable and usable by a new developer on macOS/Linux/Windows with guided setup.

## Summary

This plan operationalizes the First Friend Readiness spec into a phased implementation sequence. It assumes Git Sync Phase 2/3 and Deep Rename baselines are in place, including identifier/session defaults. The plan focuses on reducing first-run friction, enabling remote OpenClaw connectivity, and making lifecycle actions/tooling adaptive without regressing current single-user workflows.

---

**Roadmap Item:** `first-friend-readiness`
**Spec:** `docs/specs/first-friend-readiness-spec.md`
**Status:** Ready
**Created:** 2026-02-19

---

## Delivery Strategy

1. Ship in thin vertical slices that remain usable after each phase.
2. Keep all new behavior behind explicit settings/first-run gates until verified.
3. Prefer additive migration paths over destructive rewrites.
4. Preserve existing Pierce workflows as default compatibility mode.

---

## Preconditions

1. Deep Rename baseline is accepted:
   - identifier: `io.github.piercekearns.clawchestra`
   - default session key: `agent:main:clawchestra`
2. Git Sync dependency gates are satisfied:
   - Phase 2 (scope expansion) merged and stable:
     - all-file dirty detection + Metadata/Documents/Code grouping
     - trigger-based local-only Kanban structural auto-commit boundaries
   - Phase 3 (branch management) at least API/flow-stable for branch-aware sync orchestration
3. Existing chat reliability fixes stay in place (no regressions in active/idle/streaming state).

---

## Phase 1 — Cross-Platform Foundation

### Goals

1. Remove platform assumptions that block non-macOS friend onboarding.
2. Make update/build path behavior deterministic across macOS/Linux/Windows.

### Work

1. Replace remaining `env::var("HOME")` path logic in Rust with `dirs`-based paths where applicable.
2. Add platform-conditional shell handling in `run_command_with_output`.
3. Make title-bar/platform chrome handling conditional (macOS-only traffic-light assumptions removed elsewhere).
4. Update cross-platform update flow:
   - keep `update.sh` for macOS/Linux
   - add Windows update script path (`.bat` or `.ps1`)
   - remove hard macOS gate in update command flow
5. Update docs/README build instructions for first-friend setup.

### Cross-Platform Updater Contract (Required)

1. Shared contract:
   - input: current install path + app source path
   - output: updated app at same install target + restart attempt + log artifact path
2. macOS contract:
   - `.app` replacement preserves LaunchServices behavior
   - old lock path migration handled safely
3. Linux contract:
   - binary/appimage replacement strategy documented and deterministic
4. Windows contract:
   - script selects safe stop/replace/restart flow
   - PowerShell execution policy failure has actionable error output
5. Failure behavior (all OS):
   - if update fails, app remains runnable from pre-update build
   - user gets deterministic failure reason and log location

### Implementation Map

1. Rust backend:
   - `src-tauri/src/lib.rs`
     - `run_command_with_output`
     - `run_app_update`
     - path helpers currently using `env::var("HOME")`
2. Update scripts:
   - `update.sh`
   - new `update.bat` or `update.ps1` under repo root
3. UI/platform config:
   - `src/components/TitleBar.tsx`
   - `src-tauri/tauri.conf.json`
4. Documentation:
   - `README.md` (or equivalent onboarding/install doc)

### Exit Criteria

1. `cargo check` and `pnpm build` pass on local baseline.
2. Update command no longer hard-fails purely due to OS check.
3. Build/run instructions are complete for macOS/Linux/Windows.
4. No regression in current macOS update flow.
5. Updater contract validated with one passing smoke run per target OS.

---

## Phase 2 — OpenClaw Gateway Configuration

### Goals

1. Make OpenClaw transport/session runtime-configurable from app settings.
2. Support local and remote gateway setups with explicit connection testing.

### Work

1. Extend settings model with:
   - `gatewayWsUrl`
   - `gatewayToken`
   - `gatewaySessionKey` (default `agent:main:clawchestra`)
2. Update gateway config resolution in Rust and frontend to read settings first, then fallback.
3. Add explicit connection test command + UI status feedback.
4. Add validation rules for ws/wss URL and token presence.
5. Define token handling policy:
   - no token echo in UI except masked form
   - no plaintext token in logs/error bubbles
   - token redaction in transport/debug logging
6. Add settings schema/version migration for gateway fields:
   - old settings file loads safely with defaults
   - unknown/legacy fields round-trip without destructive loss
7. Resolve existing inert settings UX gap:
   - clearly separate prompt-context settings (`openclawWorkspacePath`, `openclawContextPolicy`) from transport/session routing settings
   - ensure runtime routing uses gateway fields (not legacy prompt-context fields)

### Implementation Map

1. Settings model and persistence:
   - `src-tauri/src/lib.rs` (`DashboardSettings`, sanitize/load/update)
   - `src/lib/settings.ts`
2. Gateway transport resolution:
   - `src/lib/gateway.ts` (`resolveTransport`, default transport selection)
   - `src/lib/tauri.ts` bridge calls
3. Commands/APIs:
   - reuse or extend `openclaw_ping` and config commands in `src-tauri/src/lib.rs`
4. Settings UI:
   - `src/components/SettingsDialog.tsx` (interim)
   - later sidebar settings panel (Phase 5)
5. Settings migration/versioning:
   - versioned settings shape in Rust + TS
   - migration tests for backward compatibility

### Exit Criteria

1. Friend can configure remote gateway without editing local files.
2. Connection test reports actionable failure reason.
3. Existing local OpenClaw workflows still work with fallback behavior.
4. Invalid gateway settings do not break app startup.
5. Token is redacted everywhere except explicit edit input.
6. Legacy settings files migrate without manual intervention.
7. Prompt-context settings are not misrepresented as transport routing controls.

---

## Phase 3 — First-Run Onboarding Wizard

> **IMPORTANT — Architecture Direction dependency:** The architecture-direction spec
> (`docs/specs/architecture-direction-spec.md`) defines extensive onboarding requirements
> that were descoped from the architecture-direction plan (v2) into this FFR deliverable.
> This phase MUST be deepened to cover all of the following before implementation.
> Source sections: spec Sections 6, 12, 15, Q1-Q3, and decisions #28, #30-#35.

### Goals

1. Replace silent default setup with guided onboarding.
2. Ensure first launch always produces a valid, user-owned configuration.

### Work

1. Add first-run detection (missing settings => wizard).
2. Build multi-step onboarding:
   - Step 1: OpenClaw connection path (local/remote)
   - Step 2: Scan paths/project discovery
   - Step 3: Tool detection + lifecycle action guidance
3. Persist settings from onboarding and hand off to dashboard.
4. Add “Re-run setup” action in settings.

### Architecture Direction requirements to absorb when deepening this phase

The following are fully specified in the architecture-direction spec and must be incorporated
into this phase at deepening time. They are listed here to prevent scope loss.

**OpenClaw setup wizard (spec Section 6, Q2, Q3):**
- “Where is your OpenClaw?” branch: “On this machine” / “On a remote server”
- 3-tier remote setup: (1) OpenClaw self-setup via AI — user sees “Setting up data sync... done”, (2) one-command fallback shown in wizard — not in a README, (3) local-mode via port forwarding explained in plain language
- Local OpenClaw: Clawchestra writes `~/.openclaw/extensions/data-endpoint.ts` directly during onboarding — user does nothing
- Remote OpenClaw: plain-language connection details (URL, token) with copy-paste commands
- All setup instructions live in the wizard, never in a README (spec decision #33)

**Access rights transparency (spec Section 6):**
- Explicit “WILL do / WILL NOT do” screen during onboarding
- WILL: chat with AI agent, read/write project orchestration data in `~/.openclaw/clawchestra/`
- WILL NOT: access files outside that directory, send data to external services, modify OpenClaw core config, act without confirmation during setup

**Branch injection during project add (spec Section 12, decisions #28, #34):**
- When user adds a GitHub-connected project (during onboarding OR later), trigger branch injection
- Front-load injection behind other wizard steps (decision #28): start in background, present next questions while injection runs, show subtle progress indicator
- Injection uses git CLI only — does not require OpenClaw to be connected yet
- Wizard order: Connect OpenClaw → Discover Projects → Inject Guidance (but injection works even without OpenClaw)
- Progress must be visible, not silent (decision #34): “Setting up agent guidance... 8/15 branches”

**Non-developer skill bar (spec decision #30):**
- Bar: “someone who has OpenClaw running but has zero developer skills beyond that can get through onboarding”
- No step should require understanding SSH, port forwarding, or filesystems
- Every user action is a single copy-paste command at most
- Wizard explains WHY each step is needed, not just WHAT to do

**OpenClaw system prompt injection (spec Section 6):**
- After connecting, inject `~/.openclaw/clawchestra/system-context.md` teaching OpenClaw about Clawchestra, the DB location, schema rules, and the connected client
- This happens during onboarding so OpenClaw is immediately useful for project chat

**Design principle (spec Section 15):**
- By the time onboarding finishes, user has a working AI agent connection — so even if something needs debugging later, they can ask their AI for help

### Implementation Map

1. First-run state source:
   - `src-tauri/src/lib.rs` settings existence/read path
2. Frontend orchestration:
   - `src/App.tsx`
   - `src/components/chat/ChatShell.tsx` only where onboarding gates chat affordances
3. New UI:
   - `src/components/` onboarding module(s)
4. Settings integration:
   - `src/lib/store.ts` initialization flow
   - `src/lib/tauri.ts` settings commands

### Exit Criteria

1. Fresh install reaches usable state without manual file edits.
2. User can re-run setup post-install.
3. Failed setup states provide clear recovery path.
4. Existing installs bypass onboarding automatically.
5. Non-developer user can complete onboarding without terminal knowledge.
6. Access rights are explicitly communicated before OpenClaw connection is established.
7. Branch injection runs and reports progress during project add flow.

---

## Phase 4 — Project Scaffolding

> **Architecture Direction dependency:** Post-migration, projects use `CLAWCHESTRA.md`
> (not `PROJECT.md`) and `.clawchestra/state.json` (not `ROADMAP.md`). Scaffolding
> must reflect the new file structure. See architecture-direction plan v2, Phase 3.

### Goals

1. Help friends import existing repos that lack dashboard metadata.
2. Reduce manual prep needed before board becomes useful.

### Work

1. Detect git repos in scan paths without `CLAWCHESTRA.md` (or legacy `PROJECT.md`).
2. Offer scaffold flow for `CLAWCHESTRA.md`. `.clawchestra/state.json` is auto-created by the state.json infrastructure (architecture-direction Phase 2) — no manual scaffolding needed.
3. Ensure generated files follow schema and priority rules.
4. Optionally scaffold `.clawchestra/schema.json` (JSON Schema for agent self-validation, from architecture-direction Phase 1.5).

### Implementation Map

1. Discovery and flow logic:
   - `src/lib/project-flows.ts`
   - `src/lib/projects.ts`
2. Backend folder helpers:
   - `src-tauri/src/lib.rs` (`pick_folder`, scan helpers)
3. Schema generation:
   - reuse existing project/roadmap conventions from `AGENTS.md`

### Exit Criteria

1. Repos can be onboarded from UI without raw markdown hand-editing.
2. Generated files are schema-compliant and recognized immediately.
3. Priority uniqueness rules are preserved when scaffolding roadmap items.
4. Scaffolding produces `CLAWCHESTRA.md` (not `PROJECT.md`).

---

## Phase 5A — Settings Sidebar MVP

### Goals

1. Move critical settings into persistent in-app sidebar content.
2. Reach parity with current SettingsDialog behavior in a stable sidebar surface.

### Work

1. Add sidebar settings surface with sections:
   - Connection
   - Projects
   - Tools
2. Migrate existing settings controls into sidebar while preserving current command paths.
3. Keep lifecycle actions at current default behavior in this phase (no advanced customization yet).

### Implementation Map

1. Sidebar/settings shell:
   - `src/components/sidebar/Sidebar.tsx` (current sidebar container)
   - `src/components/SettingsDialog.tsx` (migration or shared form primitives)
2. Settings persistence:
   - `src/lib/settings.ts`
   - `src-tauri/src/lib.rs` settings serialization/sanitization

### Exit Criteria

1. Sidebar can fully replace SettingsDialog for core configuration.
2. Existing Pierce workflow remains unchanged.
3. No chat/gateway regression from settings-surface migration.

---

## Phase 5B — Lifecycle Action Configuration (Advanced)

### Goals

1. Make lifecycle actions adaptable to available tools and user preferences.
2. Keep action execution safe and predictable.

### Work

1. Implement lifecycle actions configuration model:
   - enable/disable actions
   - order and label
   - prompt template source
2. Replace hardcoded lifecycle prompt assumptions with configuration-driven behavior.
3. Add presets and reset-to-default behavior.

### Implementation Map

1. Lifecycle config source:
   - `src/lib/deliverable-lifecycle.ts`
   - `src/components/LifecycleActionBar.tsx`
2. Settings integration:
   - sidebar settings actions section from Phase 5A

### Exit Criteria

1. Friend can configure lifecycle actions without editing code.
2. No action buttons displayed when none are configured.
3. Lifecycle prefill behavior still routes through editable chat prefill (never auto-send).
4. Existing default preset remains one-click recoverable.

---

## Validation Matrix

1. Platform: macOS, Linux, Windows smoke validation.
2. Gateway modes: local, SSH tunnel, direct remote.
3. First run: empty machine, preconfigured machine, malformed settings recovery.
4. Project discovery: repos with metadata, repos without metadata.
5. Lifecycle: default preset, custom preset, disabled actions.
6. Security: token redaction in logs/UI/error states.
7. Settings migration: older settings files load and persist correctly.

## Test Gates

1. Unit/integration:
   - `pnpm test`
   - targeted gateway/settings/onboarding tests
2. Type/build:
   - `pnpm build`
   - `cargo check`
3. End-to-end smoke:
   - first-run onboarding happy path
   - remote gateway config + test
   - scaffold flow creating visible project entry
4. Regression:
   - existing chat send/stream/recovery behavior
   - local-only Kanban structural auto-commit semantics
   - update button flow on macOS
   - no duplicate user-message rendering or stale active-turn states in chat
   - no regression in settings round-trip across Rust/TS schemas

## Phase Boundaries (Go/No-Go)

1. Do not start Phase 3 before Phase 2 connection test path is stable.
2. Do not start Phase 5A before onboarding stores/reads settings reliably.
3. Do not start Phase 5B before 5A ships and remains stable for one validation cycle.
4. If a phase misses exit criteria, pause and harden before proceeding.

## Key Design Decisions (Locked)

1. Keep legacy `openclawWorkspacePath` / `openclawContextPolicy` behavior as prompt-context controls unless explicitly migrated by a separate scoped change.
2. Gateway transport/session routing must use explicit gateway fields (`gatewayWsUrl`, `gatewayToken`, `gatewaySessionKey`) once Phase 2 lands.
3. First-run wizard writes via existing `update_dashboard_settings` command path (single source of truth).
4. Transport/session routing settings are distinct from prompt-context settings in both UI copy and runtime behavior.
5. Settings model is versioned and backward-compatible.

---

## Risks and Mitigations

1. Risk: onboarding complexity increases regressions in existing flows.
Mitigation: gate onboarding by first-run detection and keep fallback settings path.

2. Risk: remote gateway setup fails silently.
Mitigation: explicit connection-test API with user-visible error states.

3. Risk: cross-platform updater behavior diverges.
Mitigation: per-OS scripts with shared contract and common verification checklist.

4. Risk: settings model drift between Rust and TypeScript.
Mitigation: keep a single schema contract and add validation tests for round-trip serialization.

5. Risk: onboarding introduces duplicate or stale config paths.
Mitigation: onboarding writes through the same `update_dashboard_settings` pathway used by settings UI.

6. Risk: gateway token leaks in logs or UI.
Mitigation: enforce redaction/masking policy and add explicit token-leak regression tests.
