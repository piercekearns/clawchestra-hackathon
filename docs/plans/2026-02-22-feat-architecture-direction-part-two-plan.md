# Architecture Direction Part Two: Implementation Plan

> Addresses 10 deferred items from Part One (Phases 1–7) — performance bugs, event cascades, dead code removal, migration auto-trigger, remote sync mode, debug tooling, and agent guidance. Multi-user, multi-device goals preserved throughout.

**Date:** 2026-02-22
**Type:** feat
**Predecessor:** `docs/plans/architecture-direction-plan-v2.md` (Phases 1–7, complete)
**Institutional reference:** `docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`

---

## Overview

Part One established the database-backed architecture: db.json with HLC timestamps, state.json projections, file watchers, merge semantics, validation, sync infrastructure, and migration from ROADMAP.md. All 7 phases are complete and deployed.

Part Two addresses 10 items discovered during Part One implementation and testing. These range from critical performance bugs (kanban drag lag, event cascade) to operational gaps (migration auto-trigger, remote sync mode) to cleanup (dead code, agent guidance).

**Multi-device context:** Clawchestra is a multi-user, multi-device project orchestration tool. Multiple clients sync via HLC timestamps through a shared db.json. Every change in this plan must preserve: (1) data integrity across concurrent device syncs, (2) reliable merge semantics, (3) agent-native design where agents are first-class citizens.

---

## Items

| # | Item | Priority | Category |
|---|------|----------|----------|
| 1 | Remote sync mode | P1 | Feature |
| 2 | Migration auto-trigger | P2 | Operational |
| 3 | Debug export: sync/watcher event ring buffers | P3 | Tooling |
| 4 | `get_migration_status` omits NotStarted projects | P2 | Bug |
| 5 | Sync interval not configurable | P3 | Config |
| 6 | PROJECT.md in AUTO_COMMIT_ALLOWED is dead code | P3 | Cleanup |
| 7 | Legacy `hasRoadmap`/`hasChangelog`/`roadmapFilePath`/`changelogFilePath` dead code | P3 | Cleanup |
| 8 | **PERFORMANCE BUG** — Kanban drag lag (N×IPC) | P1 | Bug |
| 9 | **EVENT CASCADE** — UI locks during active OpenClaw chat | P1 | Bug |
| 10 | **AGENT GUIDANCE** — OpenClaw agents re-create PROJECT.md/ROADMAP.md | P1 | Bug |

---

## Phase Structure

Phases are ordered by dependency graph and priority. Critical bugs first (unblock daily use), then features (unblock friend's VPS), then cleanup.

| Phase | Items | What |
|-------|-------|------|
| **Phase A** | 8, 9 | Performance: batch reorder + event debounce |
| **Phase B** | 10 | Agent guidance: injection template + AGENTS.md |
| **Phase C** | 2, 4 | Migration: auto-trigger on launch + NotStarted visibility |
| **Phase D** | 1, 5 | Remote sync: HTTP mode + configurable interval |
| **Phase E** | 6, 7 | Dead code cleanup |
| **Phase F** | 3 | Debug export: ring buffers for sync/watcher events |

---

## Phase A: Performance (Items 8, 9)

> Fix the two performance bugs that make the app unusable during normal workflows.

### A.1 — Batch reorder command (Item 8)

**Problem:** `persistRoadmap()` calls `reorderItem()` per item via `Promise.all`. For clawchestra (25 items), each drag triggers 25× (mutex lock → priority update → state.json disk write → db.json flush schedule → `state-json-merged` event → frontend re-render). Result: visible lag on every card drag.

**Root cause locations:**
- `src/hooks/useProjectModal.ts:200-208` — `persistRoadmap` calls `reorderItem` in `Promise.all` loop
- `src/App.tsx:1184-1186` — `persistRoadmapChanges` does the same loop
- `src-tauri/src/lib.rs:1965-2032` — `reorder_item` command: single-item, full write cycle per call

**Fix: Add `batch_reorder_items` Rust command**

```
Input: { project_id: String, items: Vec<{item_id, priority, status}> }
Output: Result<(), String>
```

Implementation:
1. Single mutex lock for the entire batch
2. Apply all priority + status updates in memory
3. Single state.json write at the end
4. Single db.json flush schedule
5. Single `state-json-merged` event emission with all changed fields

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `batch_reorder_items` command, register in `generate_handler!` |
| `src/lib/tauri.ts` | Add `batchReorderItems()` wrapper |
| `src/hooks/useProjectModal.ts` | Replace `Promise.all(reorderItem(...))` with single `batchReorderItems()` call |
| `src/App.tsx` | Replace `persistRoadmapChanges` loop with `batchReorderItems()` call |

**Acceptance criteria:**
- [ ] Dragging a card in a 25-item project produces exactly 1 IPC call, 1 state.json write, 1 event
- [ ] Kanban drag feels instant (< 100ms perceived)
- [ ] Existing `reorder_item` preserved for single-item mutations (used by agents)
- [ ] `bun test` passes, `cargo check` passes

### A.2 — Event cascade debounce (Item 9)

**Problem:** During active OpenClaw chat sessions, `loadProjects()` fires ~92× in rapid succession. Each call rescans all 20 projects from disk including git status. Causes UI lock/spinning.

**Root cause locations:**
- `src/App.tsx:951-985` — Tauri event listeners: `onStateJsonMerged`, `onClawchestraReady`, `onProjectFileChanged`, `onGitStatusChanged` all call `loadProjects()` unconditionally
- `src/lib/store.ts:340-380` — `loadProjects()` calls `getAllProjects()` which does full disk scan + git status for all projects

**Fix: Debounce + delta updates**

Two-layer approach:
1. **Debounce `loadProjects()` calls** — coalesce rapid-fire events into a single call with 300ms trailing debounce
2. **Delta update for `state-json-merged`** — the event already carries the project + roadmapItems payload. Use `updateProjectFromEvent()` (already exists in store.ts) instead of calling `loadProjects()`.

Implementation:
1. `onStateJsonMerged` → call `updateProjectFromEvent(payload)` directly (no `loadProjects`)
2. `onClawchestraReady`, `onProjectFileChanged`, `onGitStatusChanged` → debounced `loadProjects()` (300ms trailing)
3. Add debounce utility (simple trailing debounce, no library needed)
4. `refreshRoadmapDocsRef` also debounced on same timer

**Files to modify:**

| File | Change |
|------|--------|
| `src/App.tsx` | Use `updateProjectFromEvent` for `onStateJsonMerged`, debounce other handlers |
| `src/lib/store.ts` | Verify `updateProjectFromEvent` handles all fields correctly |
| `src/lib/debounce.ts` | New file: simple trailing debounce utility (~15 lines) |

**Acceptance criteria:**
- [ ] During active chat session, `loadProjects()` fires at most once per 300ms (not 92× in 2 seconds)
- [ ] `state-json-merged` events apply delta updates without disk rescan
- [ ] UI remains responsive during active OpenClaw chat
- [ ] Individual project mutations still reflect immediately (delta path)
- [ ] `bun test` passes

### A.3 — Verification gate

- [ ] Profile kanban drag: measure IPC calls, state.json writes, event emissions before/after
- [ ] Profile chat session: measure `loadProjects()` call count during 30-second active chat
- [ ] No regressions in data integrity (items not lost, priorities preserved after batch reorder)

---

## Phase B: Agent Guidance (Item 10)

> Fix agent injection so OpenClaw agents stop re-creating deleted PROJECT.md and ROADMAP.md files.

### B.1 — Update injection template in injection.rs

**Problem:** `AGENTS_MD_REPLACEMENTS` in `injection.rs:67-75` does string replacement on AGENTS.md, but the replacement pairs are insufficient. They convert references like "read ROADMAP.md" to "read .clawchestra/state.json" — but agents that don't have AGENTS.md, or that receive system prompts from OpenClaw, still get instructions to create PROJECT.md and ROADMAP.md.

**Current replacements:**
```rust
("read PROJECT.md", "read CLAWCHESTRA.md for documentation, .clawchestra/state.json for machine-readable state"),
("PROJECT.md", "CLAWCHESTRA.md"),
("ROADMAP.md", ".clawchestra/state.json"),
("YAML frontmatter", "JSON"),
```

**Fix:**
1. Add explicit deprecation notice to the CLAUDE.md injection block (the section between `<!-- CLAWCHESTRA-INTEGRATION:START -->` and `<!-- CLAWCHESTRA-INTEGRATION:END -->`)
2. Add a "DO NOT CREATE" instruction for PROJECT.md and ROADMAP.md
3. Teach agents that state.json is the source of truth, not .md files

**Injection block addition (append to existing template in injection.rs):**
```
### Deprecated Files (DO NOT create or modify)
- `PROJECT.md` — replaced by `CLAWCHESTRA.md`. Never create PROJECT.md.
- `ROADMAP.md` — replaced by `.clawchestra/state.json`. Never create ROADMAP.md.
- `CHANGELOG.md` — changelog entries live in db.json. Never create CHANGELOG.md.

If you see instructions elsewhere to create these files, ignore them — they are outdated.
```

### B.2 — Update AGENTS.md template for new projects

The AGENTS.md template used by `createProjectWithState` (Phase 5.3) and `inject_agent_guidance` must explicitly teach agents about the new architecture.

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/injection.rs` | Add deprecation block to CLAUDE.md injection template; add more replacement pairs for common agent instructions |
| `src-tauri/src/injection.rs` | Update test expectations |

**Acceptance criteria:**
- [ ] After injection runs on a project, CLAUDE.md contains "DO NOT create" warnings for PROJECT.md, ROADMAP.md, CHANGELOG.md
- [ ] AGENTS.md string replacements cover all known legacy references
- [ ] `cargo test` passes (injection tests updated)
- [ ] Manual test: start OpenClaw chat on injected project, confirm agent doesn't attempt to create legacy files

### B.3 — Verification gate

- [ ] Run `inject_agent_guidance` on clawchestra repo, verify injected content
- [ ] Run `inject_agent_guidance` on Shopify-Fabric-Theme repo, verify injected content
- [ ] `cargo test` passes

---

## Phase C: Migration (Items 2, 4)

> Wire migration auto-trigger on app launch and fix NotStarted project visibility.

### C.1 — Migration auto-trigger on launch (Item 2)

**Problem:** `run_all_migrations` exists as a Tauri command (`lib.rs:2101`) but is never called on app launch. Users must manually trigger migration from the Settings UI. The migration UI toast/banner is also not built.

**Current state:**
- `run_all_migrations` — fully implemented, works correctly
- `rename_project_md` — fully implemented (renames PROJECT.md → CLAWCHESTRA.md)
- Neither is called during startup sequence

**Fix: Add migration auto-trigger to Rust startup**

In `lib.rs` startup (the `setup` closure), after loading db.json and before emitting `clawchestra-ready`:

1. Call `get_all_projects()` equivalent to find all known project paths
2. For each project with `derive_migration_step() == NotStarted`, run migration
3. For each project with `uses_legacy_filename() == true`, run rename
4. Log results to app.log
5. Emit a `migration-complete` event with summary (count migrated, warnings)

**Frontend: migration toast**

Listen for `migration-complete` event. If any projects were migrated:
- Show toast: "Migrated {n} project(s) to new format"
- If warnings: show warning toast with count

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `auto_migrate_on_launch()` function, call from `setup` closure |
| `src/App.tsx` | Listen for `migration-complete` event, show toast |

**Acceptance criteria:**
- [ ] Fresh app launch auto-migrates any NotStarted projects
- [ ] Fresh app launch auto-renames any PROJECT.md → CLAWCHESTRA.md
- [ ] Already-migrated projects are untouched (idempotent)
- [ ] Migration results logged to app.log
- [ ] Toast shown in UI with migration summary
- [ ] `cargo check` passes

### C.2 — Fix `get_migration_status` NotStarted visibility (Item 4)

**Problem:** `get_migration_status` (`lib.rs:2050-2068`) iterates over `guard.db.projects` — but projects in NotStarted state have no db.json rows (that's the definition of NotStarted). So they're invisible to this command.

**Current code:**
```rust
for (id, entry) in &guard.db.projects {
    let step = derive_migration_step(project_dir, id, &guard);
    // ... only shows projects already in db.json
}
```

**Fix:** Also scan the filesystem for projects that have ROADMAP.md but no db.json entry. This requires knowing where to look — use the same project discovery logic that `loadProjects` uses (scan known parent directories).

**Simpler approach:** Since Phase C.1 auto-migrates on launch, NotStarted projects won't persist beyond first launch. The fix for C.2 is to ensure the migration auto-trigger catches them. The `get_migration_status` command can note that it only shows known projects and direct users to restart if they've added new projects.

**Minimal fix:**
1. Add a note to the `get_migration_status` response: `"note": "Only shows projects registered in db.json. New projects appear after app restart."`
2. The real fix is C.1 (auto-trigger) — once projects are auto-migrated, they're in db.json

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `note` field to `MigrationStatus` response |

**Acceptance criteria:**
- [ ] `get_migration_status` response includes a note about discovery scope
- [ ] Combined with C.1, no projects are invisible after app launch

### C.3 — Verification gate

- [ ] Add a project with ROADMAP.md to a test directory, restart app, confirm auto-migration
- [ ] Confirm existing migrated projects are untouched
- [ ] `cargo check` passes, `bun test` passes

---

## Phase D: Remote Sync (Items 1, 5)

> Enable HTTP sync mode for multi-device use. This is the highest priority feature — needed for friend's VPS setup and future mobile client.

### D.1 — Remote sync architecture (Item 1)

**Current state (what's already built):**
- `SyncMode` enum: `Local`, `Remote`, `Disabled`, `Unknown` — fully defined in `lib.rs:52-64`
- `SyncHandle::start()` in `sync.rs` — continuous sync loop, but only handles Local mode
- `perform_continuous_sync()` in `sync.rs` — reads/writes to local filesystem only
- `sync_local_launch()`, `sync_local_close()` — Tauri commands for sync triggers, Local only
- `sync_merge_remote()` — Tauri command that accepts a JSON payload and merges it (the merge side IS built)
- `get_db_json_for_sync()` — Tauri command to get current db.json for sending (the export side IS built)
- `get_openclaw_bearer_token()` — reads token from keyring (crate ready)
- Settings UI: sync mode selector built, bearer token input NOT built
- `performSyncOnLaunch()` / `performSyncOnClose()` in `src/lib/sync.ts` — TypeScript functions exist, never called from App.tsx
- `lastSyncedAt` — not wired to frontend display

**What needs building:**

#### D.1.1 — TypeScript HTTP sync client

The remote sync flow is:
1. GET `{remoteUrl}/api/clawchestra` → receives remote db.json
2. Call `sync_merge_remote(remoteDbJson)` → Rust merges and returns merged result
3. PUT `{remoteUrl}/api/clawchestra` → sends merged db.json back to remote

This is intentionally in TypeScript (not Rust) because the frontend has `fetch` built in and can handle auth headers.

**New file: `src/lib/remote-sync.ts`**

```typescript
export async function performRemoteSync(
  remoteUrl: string,
  bearerToken: string,
): Promise<SyncResult> {
  // 1. GET remote db.json
  const response = await fetch(`${remoteUrl}/api/clawchestra`, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!response.ok) throw new Error(`Remote sync GET failed: ${response.status}`);
  const remoteData = await response.json();

  // 2. Merge via Rust
  const mergeResult = await syncMergeRemote(JSON.stringify(remoteData));

  // 3. PUT merged result back
  const localData = await getDbJsonForSync();
  const putResponse = await fetch(`${remoteUrl}/api/clawchestra`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      'Content-Type': 'application/json',
    },
    body: localData,
  });
  if (!putResponse.ok) throw new Error(`Remote sync PUT failed: ${putResponse.status}`);

  return mergeResult;
}
```

#### D.1.2 — Wire sync triggers in App.tsx

Call `performSyncOnLaunch()` during startup and `performSyncOnClose()` on window close. Both functions already exist in `src/lib/sync.ts` but are never invoked.

Add to App.tsx startup effect (after `clawchestra-ready`):
```typescript
const settings = await getDashboardSettings();
if (settings.openclawSyncMode !== 'Disabled') {
  await performSyncOnLaunch(
    settings.openclawSyncMode,
    settings.openclawRemoteUrl,
    bearerToken, // from keyring via Tauri command
  );
}
```

Add beforeunload handler for sync on close.

#### D.1.3 — Wire `lastSyncedAt` to frontend

After each successful sync, update `lastSyncedAt` in dashboard settings and display in the sync indicator (Header component).

#### D.1.4 — Bearer token management UI

Add a bearer token input field to the Settings dialog, only visible when sync mode is `Remote`. Token stored via `get_openclaw_bearer_token` / a new `set_openclaw_bearer_token` Tauri command using the keyring crate.

**Files to modify:**

| File | Change |
|------|--------|
| `src/lib/remote-sync.ts` | New file: HTTP sync client |
| `src/lib/sync.ts` | Wire remote sync into `performSyncOnLaunch` / `performSyncOnClose` |
| `src/App.tsx` | Call sync triggers on startup/close |
| `src/components/SettingsDialog.tsx` | Add bearer token input for Remote mode |
| `src/components/Header.tsx` | Wire `lastSyncedAt` display |
| `src-tauri/src/lib.rs` | Add `set_openclaw_bearer_token` command (keyring write) |

**Acceptance criteria:**
- [ ] With Remote mode + valid URL + token: GET → merge → PUT cycle works
- [ ] With Remote mode + invalid URL: error surfaces in UI, doesn't crash
- [ ] With Local mode: no HTTP calls, behavior unchanged
- [ ] Bearer token stored in OS keyring, not in settings JSON
- [ ] `lastSyncedAt` visible in sync indicator after successful sync
- [ ] Sync on launch and sync on close both fire when configured
- [ ] `bun test` passes

### D.2 — Configurable sync interval (Item 5)

**Problem:** `SyncHandle::start()` in `sync.rs` uses a hardcoded 2-second polling interval. Fine for Local mode (filesystem), but Remote mode needs tuning (network latency, rate limits).

**Fix:** Make the interval configurable via dashboard settings.

1. Add `syncIntervalMs: number` to dashboard settings schema (default: 2000)
2. Pass interval to `SyncHandle::start()` from Rust startup
3. For Remote mode, suggest default of 10000ms (10s) in Settings UI

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/sync.rs` | Accept interval parameter in `SyncHandle::start()` |
| `src-tauri/src/lib.rs` | Read interval from settings, pass to SyncHandle |
| `src/components/SettingsDialog.tsx` | Add interval slider/input |
| `src/lib/settings.ts` | Add `syncIntervalMs` to settings type |

**Acceptance criteria:**
- [ ] Sync interval configurable from Settings UI
- [ ] Changing interval takes effect on next app restart (acceptable for v1)
- [ ] Default 2000ms for Local, 10000ms for Remote
- [ ] `cargo check` passes

### D.3 — Verification gate

- [ ] Set up Remote mode pointing to friend's VPS, confirm bidirectional sync
- [ ] Verify HLC merge semantics work across devices (concurrent edits resolve correctly)
- [ ] Verify bearer token persists across app restarts (keyring)
- [ ] Verify sync indicator shows accurate state

---

## Phase E: Dead Code Cleanup (Items 6, 7)

> Remove legacy code paths that no longer serve a purpose post-migration.

### E.1 — Remove PROJECT.md from AUTO_COMMIT_ALLOWED (Item 6)

**Problem:** `AUTO_COMMIT_ALLOWED` set includes `PROJECT.md` — dead code since dual-filename transition is complete. All projects now use CLAWCHESTRA.md.

**Fix:** Remove `PROJECT.md` from the allowed set. Search for all references.

**Files to modify:**

| File | Change |
|------|--------|
| Files referencing `AUTO_COMMIT_ALLOWED` or `PROJECT.md` in auto-commit logic | Remove PROJECT.md entries |
| `src-tauri/src/migration.rs` | Keep PROJECT.md references (migration needs to read it) |

**Acceptance criteria:**
- [ ] No auto-commit logic references PROJECT.md
- [ ] Migration code still handles PROJECT.md (reads during migration)
- [ ] `cargo check` passes, `bun test` passes

### E.2 — Remove legacy ViewModel fields (Item 7)

**Problem:** `ProjectViewModel` has legacy fields from pre-migration era:
- `hasRoadmap` — now derived from db.json roadmap items (store.ts:366-367), not from ROADMAP.md
- `hasChangelog` — no longer used (changelog entries in db.json)
- `roadmapFilePath` — ROADMAP.md no longer exists
- `changelogFilePath` — CHANGELOG.md no longer exists

**Approach:** These fields are still referenced in multiple places (project-flows.ts, store.ts, useProjectModal.ts, hierarchy.test.ts). Need to trace all usages and remove carefully.

**`hasRoadmap` special case:** This field is still actively used as a gate in `ProjectModal.tsx:65` to decide whether to show Kanban vs markdown. It was patched in store.ts to derive from db.json items. The field itself stays — but its derivation should be the db.json path only (remove any filesystem-based derivation).

**Fields to remove:** `hasChangelog`, `roadmapFilePath`, `changelogFilePath`
**Fields to keep (with updated derivation):** `hasRoadmap`

**Files to modify:**

| File | Change |
|------|--------|
| `src/lib/projects.ts` | Remove filesystem checks for ROADMAP.md, CHANGELOG.md paths |
| `src/lib/store.ts` | Remove `changelogFilePath`, `roadmapFilePath` from ProjectViewModel |
| `src/lib/hierarchy.test.ts` | Remove legacy fields from test fixtures |
| `src/hooks/useProjectModal.ts` | Remove references to `roadmapFilePath`, `changelogFilePath` |
| `src/App.tsx` | Remove any references to removed fields |

**Acceptance criteria:**
- [ ] `hasChangelog`, `roadmapFilePath`, `changelogFilePath` removed from codebase
- [ ] `hasRoadmap` still works (derived from db.json items)
- [ ] No TypeScript errors (`npx tsc --noEmit`)
- [ ] `bun test` passes

### E.3 — Verification gate

- [ ] `npx tsc --noEmit` passes (no type errors from removed fields)
- [ ] `bun test` passes
- [ ] App builds: `npx tauri build --no-bundle`
- [ ] Kanban still appears for projects with items

---

## Phase F: Debug Export Ring Buffers (Item 3)

> Add sync and watcher event tracking to the debug export.

### F.1 — Add ring buffers for sync and watcher events

**Problem:** `export_debug_info()` (`lib.rs:2507-2598`) has a placeholder for file watcher status: `"(event tracking not yet implemented)"`. Similarly, sync events (merges, conflicts, errors) are not tracked.

**Fix:** Add bounded ring buffers (20 entries each) to `AppState`:

```rust
pub sync_event_log: VecDeque<SyncEventLogEntry>,    // capacity 20
pub watcher_event_log: VecDeque<WatcherEventLogEntry>, // capacity 20
```

Populated by:
- `perform_continuous_sync()` → push sync event (success/fail, items merged, timestamp)
- Watcher event handler → push watcher event (file changed, type, timestamp)

Read by `export_debug_info()` → formatted as text.

**Files to modify:**

| File | Change |
|------|--------|
| `src-tauri/src/state.rs` | Add `SyncEventLogEntry`, `WatcherEventLogEntry` structs; add fields to `AppState` |
| `src-tauri/src/sync.rs` | Push to `sync_event_log` after each sync cycle |
| `src-tauri/src/watcher.rs` | Push to `watcher_event_log` on each categorized event |
| `src-tauri/src/lib.rs` | Update `export_debug_info()` to read from ring buffers instead of placeholder |

**Acceptance criteria:**
- [ ] Debug export shows last 20 sync events with timestamp, success/fail, merge count
- [ ] Debug export shows last 20 watcher events with timestamp, file, event type
- [ ] Ring buffers bounded at 20 entries (no memory growth)
- [ ] `cargo check` passes, `cargo test` passes

### F.2 — Verification gate

- [ ] Trigger some file changes, run debug export, verify watcher events appear
- [ ] Trigger a sync cycle, run debug export, verify sync events appear
- [ ] Verify old entries roll off after 20

---

## Dependency Graph

```
Phase A (Performance) ← no dependencies, highest priority
Phase B (Agent Guidance) ← no dependencies
Phase C (Migration) ← no dependencies
Phase D (Remote Sync) ← Phase A recommended first (event debounce prevents cascade during sync)
Phase E (Dead Code) ← Phase C recommended first (ensures migration handles all legacy refs)
Phase F (Debug) ← Phase A recommended first (ring buffers capture debounced events correctly)
```

**Recommended execution order:** A → B → C → D → E → F

Phases A and B can run in parallel (no shared files). Phases C and D can run in parallel after A.

---

## Risk Analysis

| Risk | Impact | Mitigation |
|------|--------|-----------|
| `batch_reorder_items` introduces priority ordering bug | Data loss (wrong priority order persisted) | Compare before/after state.json snapshots in tests; existing `reorder_item` tests as baseline |
| Event debounce masks legitimate updates | Stale UI | 300ms is conservative; delta updates for `state-json-merged` ensure immediate reflection for IPC mutations |
| Migration auto-trigger runs on corrupt project | Silent data loss | Pre-migration backup already exists; log warnings; skip projects that error |
| Remote sync bearer token leaked | Security | Keyring storage (OS-level encryption); never log token; never include in debug export |
| Dead code removal breaks unmigrated project path | Broken fallback | E.2 only removes fields after verifying all projects are migrated (post C.1 auto-migrate) |
| Injection changes break existing CLAUDE.md | Agent confusion | Injection is idempotent (replaces section between markers); test on multiple projects |

---

## Success Criteria

1. **Kanban drag:** Single card drag = 1 IPC call, < 100ms perceived latency
2. **Chat sessions:** `loadProjects()` fires ≤ 1× per 300ms during active chat
3. **Agent compliance:** OpenClaw agent on freshly-injected project does NOT create PROJECT.md or ROADMAP.md
4. **Migration auto-trigger:** New project with ROADMAP.md auto-migrates on next app launch
5. **Remote sync:** Two devices sync bidirectionally via HTTP with HLC merge
6. **Debug export:** Sync and watcher events visible in export (not placeholders)
7. **Clean code:** No references to `roadmapFilePath`, `changelogFilePath`, or `PROJECT.md` auto-commit

---

## Files Modified (Complete List)

| File | Phases |
|------|--------|
| `src-tauri/src/lib.rs` | A, C, D, F |
| `src-tauri/src/state.rs` | F |
| `src-tauri/src/sync.rs` | D, F |
| `src-tauri/src/watcher.rs` | F |
| `src-tauri/src/injection.rs` | B |
| `src-tauri/src/migration.rs` | C (read-only verification) |
| `src/App.tsx` | A, C, D |
| `src/lib/tauri.ts` | A, D |
| `src/lib/store.ts` | A, E |
| `src/lib/sync.ts` | D |
| `src/lib/remote-sync.ts` | D (new) |
| `src/lib/debounce.ts` | A (new) |
| `src/lib/projects.ts` | E |
| `src/lib/settings.ts` | D |
| `src/lib/hierarchy.test.ts` | E |
| `src/hooks/useProjectModal.ts` | A, E |
| `src/components/SettingsDialog.tsx` | D |
| `src/components/Header.tsx` | D |
| `src/components/modal/ProjectModal.tsx` | E (verification) |
