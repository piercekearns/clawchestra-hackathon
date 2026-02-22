# Architecture Direction: Implementation Plan (v2)

> End-to-end implementation plan for Clawchestra's evolution from file-based state to database-backed, OpenClaw-synced architecture. Covers all phases from audit through programmatic sync.
>
> **v2 revision** incorporates findings from 3 parallel reviews (DHH, Kieran/TypeScript, Simplicity) re-evaluated through a product lens (shipping to real users, not a personal tool).

**Spec:** `docs/specs/architecture-direction-spec.md` (41 decisions, 19 sections)
**Date:** 2026-02-21
**Type:** feat
**Institutional reference:** `docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`
**Reviews round 1:** `/tmp/claude/plan-review-{dhh,kieran,simplicity}-v2.md`
**Reviews round 2:** `/tmp/claude/plan-review-v2-{dhh,architecture,data-integrity,kieran}.md`
**Reviews round 3:** `/tmp/claude/plan-review-v3-{dhh,kieran,architecture,data-integrity}.md`

---

## Enhancement Summary (Deepen-Plan Pass)

**Deepened on:** 2026-02-21
**Targeting:** Phases 5–7 (self-contained — all remaining work. Phases 1–4 + hardening sprint complete)
**Research agents used:** Pattern Recognition, Simplicity Reviewer, Architecture Strategist, Kieran TypeScript, Security Sentinel, Agent-Native Reviewer, Data Migration Expert, Performance Oracle, Race Condition Reviewer, Data Integrity Guardian (11 agents total)

### Critical Findings

1. **Roadmap data pipeline not addressed (CRITICAL).** Phase 5 is missing migration of `openRoadmapView()`, `persistRoadmapChanges()`, and `allSearchableRoadmapItems` in App.tsx — all still read/write ROADMAP.md directly. Without this, the entire migration is broken at the UI layer. Added as Phase 5.16.
2. **`getProjects()` rewrite missing (CRITICAL).** The plan's Phase 2.8 describes the Zustand store migration but never lists concrete implementation steps for switching `loadProjects()` from file-scanning to Tauri commands. Added as Phase 5.17.
3. **Injection content contradicts plan schema.** `injection.rs` lines 28-31 tell agents to include `_schemaVersion`, `_generatedAt`, `_generatedBy` — the plan's `AgentStateJsonInputSchema` strips these. Must resolve before Phase 5.4.
4. **Agent injection has no agent-accessible path.** `inject_agent_guidance` is Tauri-only. Agents on new branches cannot trigger it. Added mitigation to Phase 5.4.
5. **Migration.rs has 2 HIGH issues.** No git commits (leaves dirty state) and field-level verification is non-blocking (plan says it should block). Added as Phase 5.0 built-code fixes.

### Already Completed (skip during build)

- **5.5** Auto-commit + store updates — already done in hardening sprint
- **5.9** Lifecycle prompts — `deliverable-lifecycle.ts` already references state.json
- **5.11** Old TypeScript watcher — already deleted

### Simplification Recommendations Applied

- **5.15** Settings Dialog sync UI → deferred to Phase 6 (not needed for core alignment)
- **6.6** `_syncFailedOnClose` flag → removed (unnecessary complexity)
- **7.1** Per-project + global log files → single `{app_support_dir}/app.log`
- **7.3** Validation rejection history viewer → badge-only (click shows last rejection)

### Architectural Decisions (Post-Review, 2026-02-22)

Applied after Round 3 plan review + multi-device architectural session. All three reviewers (DHH, Kieran, Simplicity) approved the base plan — these are refinements:

| Decision | What changed | Why |
|----------|-------------|-----|
| **Cut Phase 5.21 blob SHA** | Replaced three-tier `git_get_doc_freshness` with content field `__updatedAt` timestamp comparison | Unanimous reviewer consensus: over-engineering. Content fields + timestamps are simpler and work cross-device |
| **Cut Phase 6.8** | Continuous freshness polling removed entirely | Depended on cut blob SHA infrastructure. Content sync + file watcher provides sufficient freshness |
| **Cut Phase 7.4** | Document freshness UI indicators removed | Depended on 6.8 events. Fetch-time banners (5.21.3) sufficient for v1 |
| **Simplify Phase 6.6** | Removed offline queue + exponential backoff. ~~CAS added then cut in Round 4~~ | Local db.json is durable store — failed syncs self-heal on next trigger. CAS cut: create-new lock + debounce already handle races |
| **Promote continuous sync** | Moved from "deferred to v2" into Phase 6.6 | Multi-device is core product vision — launch/close-only sync makes OpenClaw queries return stale data |
| **Keep content fields** | `specDocContent`/`planDocContent` in db.json | Cross-device document access — devices without git repo can read specs/plans |
| **Keep write-back (simplified)** | Auto-write db.json content to git file on sync arrival. Conflict UI cut — LWW for v1 | Completes the bi-directional sync loop. Conflict notification deferred to Phase 8+ |
| **Keep `?fields=index` (backend only)** | Extension supports query param; frontend doesn't use progressive loading for v1 | Backend-only optionality — frontend always fetches full db.json |
| **Fold Pre-Phase 5 into Phase 5.0** | Built-code fixes (migration.rs, injection.rs) are now Phase 5.0 | Phases 5-7 must be self-contained — builders won't be directed to Phases 1-4 |
| **Cut CAS** (Round 4) | Removed compare-and-swap for local db.json writes from Phase 6.6 | Create-new file lock + 2s debounce already handle races; remaining edge case is rare + self-healing |
| **Cut Phase 7.5** (Round 4) | Device/location transparency banners moved to Phase 8+ | Good UX feature, wrong phase — belongs with project creation redesign |
| **Simplify write-back** (Round 4) | Cut conflict notification UI; LWW via HLC for conflicts | Conflict UI is disproportionate to frequency; auto-commit rejected (wrong-branch risk, noisy git history) |
| **Simplify extension versioning** (Round 4) | Always-overwrite on launch replaces version tracking | Eliminates version comparison edge cases; extension is always current |
| **Cut frontend progressive loading** (Round 4) | Extension `?fields=index` kept; frontend always fetches full db.json | Premature optimisation; perf is acceptable at expected scale |
| **Cut clock skew detection** (Round 5) | No NEW `Date.now()` comparison mechanism added. Existing `detect_clock_skew` in sync.rs stays as-is | Proposed mechanism unimplementable — remote doesn't expose wall clock. Existing code is harmless; HLC handles drift by design |
| **Cut force re-migrate button** (Round 5) | Removed from Settings > Advanced | Deterministic migration; fix is code update not retry. One-time migration for current instance only |
| **Cut LRU cache** (Round 5) | Removed from `fetchDocContent()` 5.21.3 | YAGNI — documents fetched on demand, db.json is kilobytes |
| **Extension PUT body validation** (Round 5) | Added structural validation before write | Prevents malformed payload from corrupting db.json |
| **specDocBranch verified, not added** (Round 5) | Changed "add" to "verify existing" in Phase 5.20 | Fields already exist in built code (state.rs and db-json.ts — search for `spec_doc_branch`) |
| **200ms → 500ms success criterion** (Round 5) | Relaxed UI update latency target | 200ms too tight for file I/O + HLC comparison on slower machines |
| **stateJsonMigrated in Zod schema** (Round 6) | Added `stateJsonMigrated: z.boolean().default(false)` to `DbProjectSchema` | Flag was in plan text but missing from the concrete Zod definition — needed for runtime validation |
| **D3 tiebreaker: content-based** (Round 6) | Changed tie-breaking from `client_uuid` to lexicographic value comparison | Matches built code in `sync.rs`; simpler — no client identity dependency |
| **Content fields in sync merge** (Round 6) | Added `merge_optional_field!` note to 5.21.1 for content fields in `sync.rs` | Without this, content snapshots arriving via remote sync are silently discarded |
| **BoardItem mapper extraction** (Round 6) [superseded by Round 7 — extraction moved to 5.17] | Added `roadmap-item-mapper.ts` extraction to 5.12 | `RoadmapItemState` → `BoardItem` conversion must survive `roadmap.ts` deletion |
| **Hardcode buffer size** (Round 6) | Fixed history buffer at 20 entries, removed configurable `stateHistoryBufferSize` | YAGNI — no settings UI for buffer size; change the constant if needed |
| **Extension overwrite in startup** (Round 6) | Added step 2 (extension overwrite) to startup sequence | Phase 6.2 says "always-overwrite on launch" but it wasn't in the startup sequence |
| **Sync-on-launch ownership** (Round 6) | Sync-on-launch owned by Rust startup sequence (step 8), not TypeScript | Prevents duplication — backend handles it before emitting `clawchestra-ready` |
| **D3 tiebreaker in 6.6 + Risk** (Round 7) | Fixed stale `client_uuid` tiebreaker references in Phase 6.6 and Risk Analysis to match D3 content-based | Consistency — D3 was updated in Round 6 but downstream references were missed |
| **5.3 moved to Group 3** (Round 7) | Project creation flow depends on Group 1-2 constants/paths; moved from Group 2 to Group 3 | 5.3 depends on constants/paths from Groups 1-2 and creates Tauri commands consumed by other Group 3 steps |
| **stateJsonMigrated in built code** (Round 7) | Added Phase 5.0.7 — flag missing from `DbProjectEntry` (Rust) and `DbProjectSchema` (TS) | Runtime check (`if stateJsonMigrated`) cannot be implemented without the field existing |
| **Extension fail-open elevated** (Round 7) | Moved fail-open auth fix from Phase 6.1 to Phase 5.0.6 (built-code fix) | Extension is already deployed — security fix cannot wait until Phase 6 |
| **Tauri mutation commands explicit** (Round 7) | Added prerequisite block to Phase 5.16 listing `update_roadmap_item`, `reorder_item`, `create_project_with_state` | Referenced throughout Group 3 but no implementation step existed |
| **`get_all_projects` must return items** (Round 7) | Note in 5.17 — built command returns only `roadmap_item_count`, must be extended | Zustand store needs actual roadmap items, not just counts |
| **Doc extraction ownership** (Round 7) | `doc-resolution.ts` extracted in 5.18 (consumer); `roadmap-item-mapper.ts` extracted in 5.17 (consumer); 5.12 only deletes | Extractions belong in the phase that needs the code, not in the cleanup phase |
| **RACE 1: unconditional loadProjects** (Round 7) | Picked option 2 — `loadProjects()` on mount unconditionally, `clawchestra-ready` is advisory | Eliminates race entirely — simpler than request-response pattern |
| **`?fields=index` test cut** (Round 7) | Removed dedicated test scenario, success criterion, and perf table row (code stays) | YAGNI for v1 — extension code exists but no consumer; verifying an unused param wastes build time |
| **Startup sequence renumbered** (Round 7) | Renumbered from "1, 1b, 2-7" to sequential "1-8" | Clean numbering after Round 6 added step 1b |
| **history_buffer_size removal** (Round 7) | Added Phase 5.0.5 — remove configurable buffer size fields from built code | Round 6 hardcoded at 20 but the configurable fields still existed in AppState/DashboardSettings |
| **stateJsonMigrated backfill** (Round 8) | Phase 5.0.7 must backfill `stateJsonMigrated: true` for projects migrated before the flag existed | Projects with `roadmap_items` in db.json but `state_json_migrated: false` were migrated before Phase 5.0.7 |
| **Content fields via Tauri call** (Round 8) | `fetchDocContent()` reads content fields via separate `get_project` Tauri call, not from Zustand store | Content fields are large (full markdown); should not transit through every `state-json-merged` event payload |
| **Sync-on-launch Rust restructuring** (Round 8) | Phase 6.6 requires lib.rs startup restructuring — sync-on-launch from TS-invoked command to inline Rust | TS `sync_local_launch` call eliminated; sync is internal to Rust startup sequence |
| **`detect_clock_skew` stays** (Round 8) | "Cut clock skew detection" means no new mechanism — existing `detect_clock_skew` in sync.rs unchanged | Existing code is harmless; "cut" refers to the proposed `Date.now()` comparison, not existing code |
| **5.12 dead code scope expanded** (Round 8) | Remove dead functions from both definitions AND `generate_handler!` macro, plus TS callers | Incomplete cleanup leaves orphaned handler registrations and TypeScript wrappers |
| **5.20 git_read_file_at_ref verify-only** (Round 8) | Command already exists in built code — Phase 5.20 verifies presence, does not re-add | Avoids duplicate command registration |
| **Group 5 serial constraint** (Round 8) | 5.20 → 5.21 must execute serially within Group 5 | 5.21 depends on 5.20's `gitReadFileAtRef` infrastructure |
| **Priority default in mapper** (Round 8) | `RoadmapItemState` → `BoardItem` conversion must default `priority ?? Infinity` | Optional field in state schema becomes required in UI sort/render logic |
| **HLC vs mtime incomparable** (Round 9) | Removed staleness check from 5.21.3; local file is authoritative when it exists. Write-back (6.6) uses `_lastSyncedAt` not HLC | HLC is a monotonic counter, not wall-clock — comparing against filesystem mtime is meaningless |
| **Content fields excluded from event** (Round 9) | 5.0.4 explicitly excludes `specDocContent`/`planDocContent` from `StateJsonMergedPayload` | Content fields are full markdown documents — too large for every event broadcast; fetched on demand via `get_project` |
| **fetchDocContent single spec** (Round 9) | 5.21.3 is the single authoritative spec for `fetchDocContent()` priority chain; 5.18 and 5.20 cross-reference it | Three places described the same function differently — single source of truth eliminates drift |
| **5.0.3 deferral removed** (Round 9) | Removed "deferral option" paragraph from 5.0.3 | Group 0 items cannot be deferred to Group 4 — contradicts execution ordering constraint |
| **5.0.7 backfill heuristic refined** (Round 9) | Backfill requires BOTH `roadmap_items` in db.json AND `state.json` on disk | Either condition alone is ambiguous; both together confirm a pre-flag migration |
| **On-close 4s timeout** (Round 9) | Standardized shutdown budget at 4s (1s drain + 3s sync), enforced via `tokio::time::timeout` | RACE 2 said 3s, integration test said 3s, but actual budget is 4s — inconsistency fixed |
| **Extension JSON.parse try/catch** (Round 9) | Added explicit error handling for `JSON.parse(settingsRaw)` and consistent serialization | Malformed settings.json could crash extension; double-serialization wasted work |
| **`detect_clock_skew` dead code candidate** (Round 9) | Added to 5.12 sweep targets — evaluate after 6.6 wiring | Function stays per Round 5/8, but may become unreachable after continuous sync replaces launch-only sync |
| **client_uuid scope clarified** (Round 9) | Added note to 6.4 — UUID is for device identity, NOT HLC tiebreaking (D3 is content-based) | Prevents confusion between client_uuid and D3 tiebreaker mechanism |
| **RACE numbering explained** (Round 9) | Added note explaining non-contiguous RACE numbering (1, 2, 4, 6) | RACE 3 and 5 were triaged out; numbering preserved to avoid breaking cross-references |
| **`_lastSyncedAt` is wall-clock** (Round 10) | Explicitly defined as `Date.now()`, NOT HLC. Added to db.json schema notes and write-back mechanism | HLC and mtime are incomparable units (Round 9); `_lastSyncedAt` must be wall-clock to compare with filesystem mtime |
| **`get_project` verification** (Round 10) | Added prerequisite to verify `get_project` exists and returns content + branch fields. Defined `ProjectWithContent` TypeScript interface | `fetchDocContent()` needs content fields via `get_project` but no Phase 5 step defined or verified the command |
| **Content auto-capture local guard** (Round 10) | 5.21.2 auto-capture runs only for local (watcher) merges; remote sync merges use `merge_optional_field!` | Filesystem reads during remote merge silently fail — project may not exist locally |
| **Extension PUT type validation** (Round 10) | Added type checks for `_schemaVersion`, `_hlcCounter`, `projects` beyond key existence | Garbage JSON overwrites db.json on disk before Rust reads it — type checks are last line of defense |
| **Write-back echo prevention** (Round 10) | Store SHA-256 of written content; skip content re-capture if hash matches on watcher fire | Prevents watcher→merge→content-capture→sync feedback loop after write-back |
| **Startup ↔ 6.6.0 cross-references** (Round 10) | Forward reference in startup sequence to 6.6.0; backward reference in 6.6.0 to update startup docs | Builder reads startup sequence first, implements as written, then 6.6.0 requires restructuring |
| **5.21.1 verify-only** (Round 10) | Changed "Add corresponding fields" to "Verify corresponding fields already exist" for content Zod schema | Fields already exist — "add" instruction would confuse builder (same pattern as 5.20 `specDocBranch`) |
| **5.16/5.17 store ownership** (Round 10) | 5.16 consumes Zustand store field; 5.17 creates it. Removed (a)/(b) choice from 5.16 | Two phases described the same structural change independently — single ownership prevents duplication |
| **`rolling-file` crate** (Round 10) | Replaced ambiguous `tracing-appender` + alternatives with concrete `rolling-file` crate for size-based rotation | `tracing-appender` only supports time-based rotation; plan must pick one approach |
| **clients map write path** (Round 10) | Added upsert step to Phase 6.4 — register client in db.json on launch | `clients` map was referenced (6.5 system prompt) but no phase described when/how it is written |
| **5.12 → Phase 6 gate for `detect_clock_skew`** (Round 10) | Moved evaluation from Phase 5 sweep to Phase 6 verification gate | Phase 5.12 runs before Phase 6 — cannot evaluate dead code before 6.6 is built |
| **5.0.7 backfill idempotent** (Round 10) | Run backfill during startup sequence (idempotent, every launch). No completion flag needed | Desktop app has no "deployment" event; idempotent check is O(N) and ~1ms |
| **`get_all_projects` must include items** (Round 11) | Removed either/or — extend `get_all_projects` to return `roadmapItems` per project (excluding content fields) | Store needs items from backend; single command is simpler than two-step fetch |
| **`get_project` as Phase 5.0.8** (Round 11) | Added to Group 0 as a built-code verification step + added to 5.16 prerequisites | `fetchDocContent()` depends on `get_project` returning content + branch fields; no execution group owned this |
| **migration.rs sets `stateJsonMigrated`** (Round 11) | Added explicit instruction to 5.0.7 Fix for migration.rs to set flag after successful migration | Backfill heuristic catches old projects; forward path for new migrations needed explicit instruction |
| **5.17 before 5.16 in Group 3** (Round 11) | Reordered to 5.17 → 5.16 (5.17 creates Zustand store field, 5.16 consumes it) | Dependency was documented but execution order didn't reflect it |
| **Startup sequence Phase 6 steps** (Round 11) | Added steps 6 (client UUID registration) and 7 (system-context.md regeneration) | Steps were defined in 6.4/6.5 but missing from the startup sequence |
| **6.4 Rust equivalents** (Round 11) | Added concrete Rust code for client registration in startup | Pseudocode was platform-agnostic; Rust code ensures correct API usage |
| **specDocBranch source path** (Round 11) | Clarified: `get_project` → `ProjectWithContent` → threaded to DocBadge | Data flow from Tauri call to UI component was unclear |
| **Content capture 500KB cap** (Round 11) | Added `MAX_CONTENT_SIZE` guard to 5.21.2 auto-capture | Prevents db.json bloat from binary/generated files accidentally referenced as spec/plan docs |
| **rolling-file Mutex wrapper** (Round 11) | Corrected: `RollingFileAppender` needs `Mutex` wrapper for `MakeWriter` | Direct `MakeWriter` claim was incorrect — `Mutex<W: Write>` blanket impl is the actual path |
| **specDocBranch in Zod schema** (Round 11) | Added `specDocBranch`/`planDocBranch` + `__updatedAt` siblings to `DbRoadmapItemSchema` | Fields existed in built code and JSON example but were missing from the Zod schema definition in the plan |
| **Echo prevention suppresses event** (Round 11) | Write-back echo detection also suppresses `state-json-merged` event emission | Without suppression, frontend re-renders for a write that originated from db.json itself |
| **Store holds `RoadmapItemState[]`** (Round 11) | Clarified: Zustand store holds backend shape; `BoardItem` mapper runs at UI boundary only | Prevents `Infinity` default from leaking into persisted data |
| **History buffer excludes content** (Round 11) | Content fields stripped from history buffer entries | Full markdown documents in every history entry wastes memory; content not needed for undo/debug |
| **Integration test 15 semantics** (Round 11) | Write-back is SKIPPED when local file newer (not "proceeds with LWW") | Test description contradicted write-back step 3 |
| **`_lastSyncedAt: 0` semantics** (Round 11) | Added note: 0 means "never synced" — write-back skipped until first sync completes | Prevents write-back from overwriting local files on first launch |
| **5.3 line numbers approximate** (Round 11) | Added "search by content" caveat to 5.3 line references | Same pattern as 5.2 and 5.7 — prevents confusion when earlier steps shift positions |

### Recommended Execution Order (from Kieran TypeScript + Data Integrity reviews)

```
Group 0 (built-code fixes):       5.0.1, 5.0.2, 5.0.3, 5.0.4, 5.0.5, 5.0.6, 5.0.7, 5.0.8 (no deps — fixes to Phases 1-4 built code)
Group 1 (constants, no deps):     5.1, 5.5✓, 5.13
Group 2 (file references):        5.6, 5.8, 5.19 (dual-filename warning)
Group 3 (components + data):      5.2, 5.3, 5.7, 5.17 (loadProjects — creates Zustand store field), 5.16 (roadmap pipeline — consumes store field), 5.18 (useProjectModal)
Group 4 (agent guidance):         5.4, 5.9✓, 5.10
Group 5 (cross-branch + content):  5.20 → 5.21 (serial within Group 5). Prerequisite: 5.18 (Group 3) must be complete — 5.21 wires into 5.18's fetchDocContent rewrite
Group 6 (cleanup + verification): 5.11✓, 5.12 (AFTER all Group 3 consumers redirected), 5.14
```

**Atomic cutover strategy (from Data Integrity Finding 1 — CRITICAL):**
All write operations across 5.7, 5.16, 5.17, 5.18 must check a per-project `stateJsonMigrated` flag:
- `true` → Tauri command path (state.json)
- `false` → existing `writeRoadmap()` path (ROADMAP.md)
This prevents partial cutover and data divergence during transition.

**`stateJsonMigrated` lifecycle (from DHH M2 + Simplicity):**
- **Location:** Per-project field in db.json (`stateJsonMigrated: boolean`). NOT in state.json (state.json may not exist pre-migration). Derived into the Zustand store alongside project data.
- **Initial state:** `false` (or absent — treat missing as `false`).
- **Set to `true`:** After migration.rs completes successfully AND field-level verification passes (5.0.2). Set atomically with the migration completion in db.json.
- **Never set back to `false`:** Migration is one-way. If migration fails, the flag stays `false` and the project continues on the ROADMAP.md path. The user sees an error ("Migration verification failed") and can retry.
- **Error recovery:** If `stateJsonMigrated` is `true` but state.json is missing (corrupt state), fall back to restoring from the pre-migration backup in `.clawchestra/backup/`.
- **Deletion:** After ALL projects are confirmed migrated and Phase 5 is fully deployed, the flag becomes dead weight. It can be left indefinitely (harmless boolean) or cleaned up in a future schema migration. No urgency — the `if (stateJsonMigrated)` checks add zero performance cost.

---

## Changes from v1

| Area | v1 | v2 | Rationale |
|------|----|----|-----------|
| Phases | 9 | 7 | Merge Phase 3 (Rename) into Phase 4 (Migration); fold Phase 9 (Integration Testing) into Phase 7 verification gate |
| Migration state machine | 7-state enum persisted in DB | Derived state from filesystem | Same recoverability, zero persistence overhead |
| TypeScript types | Mentioned but undefined | Concrete Zod schemas as source of truth | Runtime validation non-negotiable for untrusted agent input |
| Change detection | Write-flag to distinguish own vs external writes | Content-hash (SHA-256) comparison | Write-flag races under FSEvents coalescing (~75ms) |
| Lock behavior | Fail-open after 100ms | Fail-closed with user-visible error | Fail-open loses data |
| Stale lock detection | PID + timestamp in lock file | Reuse existing create-new file lock pattern from `acquire_mutation_lock_at` | Proven cross-platform pattern already in codebase |
| Branch injection | Full InjectionOptions/InjectionResult/DB persistence | Single Tauri command, idempotent, no DB state | Idempotency check is sufficient |
| OpenClaw extension | No auth, no input validation, sync fs ops | Bearer token check, size limit, async fs | Product-grade endpoint |
| File watcher | Two independent systems (TS + Rust) | Unified in Rust (notify crate) | Non-deterministic event ordering otherwise |
| Revival Fightwear exception | Hardcoded project ID check | Pre-migration backup for ALL projects | Product-grade migration |
| `_instructions` field | In state.json | Removed | Dead weight — agents learn schema from CLAUDE.md |
| Polling fallback | 5s polling if watcher misses | Removed | FSEvents/inotify do not miss changes on macOS/Linux |
| Pre-migration backup | None beyond git | Automatic backup to `.clawchestra/backup/` | Users may not have pushed; git is not sufficient |
| Schema versioning | `_schemaVersion: 1` declared, no upgrade path | Forward-compat check + migration function pattern | Required for ongoing product evolution |
| Error recovery UX | Validation errors only in `last-validation.json` | User-visible validation status + state history buffer | Users cannot read log files |
| Validation feedback | `last-validation.json` file | Log to app structured log | Agents do not proactively read validation files |
| Timestamp model | Wall-clock milliseconds | Hybrid logical clocks (HLC) | Prevents clock-skew data loss between devices |
| db.json schema | Undefined — referenced but never specified | Concrete JSON example + Zod schema | Required for sync implementation |
| Stale agent write handling | No detection — last write wins | Compare incoming values against state history buffer | Prevents silent data loss from two-agent races |
| Runtime DB layer | Implicit — "the DB" referenced but unspecified | Explicit: `Arc<Mutex<AppState>>` in Rust, Tauri commands for frontend | Blocks Phase 2 without definition |
| db.json Zod schema | `z.record(z.unknown())` — validation black hole | Concrete per-field schemas with `__updatedAt` siblings | Corrupt values must not pass validation and propagate via sync |
| Lock mechanism | "flock()" referenced but not in codebase | Reuse existing create-new file lock pattern (`acquire_mutation_lock_at`) | Proven cross-platform pattern already battle-tested in production |
| Tauri event payloads | Untyped — `state-json-merged` payload undefined | Typed `StateJsonMergedPayload` + `ClawchestraReadyPayload` interfaces | Frontend merge into `ProjectViewModel` requires known shape |
| db.json persistence | 500ms debounce only | Debounce + crash-safe flush on window close | Prevents in-memory mutation loss on unexpected termination |

---

## Critical Design Decisions (resolved from spec gaps)

**D1: Agent file locking is unenforceable — use merge-on-change instead.**
Agents (Claude Code, Cursor) write files via their tool infrastructure, which does not call `flock()`. True mutual exclusion between Clawchestra and agents is impossible. Instead: Clawchestra watches state.json for external changes, reads the full file, validates, and merges into the DB. The "lock" is Clawchestra's atomic read-validate-merge cycle, not a filesystem lock. Clawchestra still uses file locking internally (create-new pattern, matching existing `acquire_mutation_lock_at` in lib.rs) for its own writes and potential multi-instance races, but does not depend on agents cooperating.

**D2: state.json is per-project. db.json is global.**
Each project has `.clawchestra/state.json` in its root (agent-facing, per-project scope). OpenClaw has `~/.openclaw/clawchestra/db.json` (global, all projects). Clawchestra translates: on DB change → write per-project state.json projections; on state.json external change → merge project-scoped changes into global DB.

**D3: Per-field timestamps are set by Clawchestra on ingest, not by agents.**
Agents write plain JSON without timestamps. Clawchestra sets `updatedAt` on each changed field during the validate-merge cycle. This keeps the agent-facing schema simple and timestamps accurate (reflect when Clawchestra processed the change). Timestamps use hybrid logical clocks (HLC): `max(wall_clock, last_seen_timestamp) + 1`. This guarantees monotonicity within each device and across sync boundaries, preventing clock-skew-induced data loss between devices with unsynchronized clocks. On ties: content-based tiebreaker — the lexicographically higher serialized value wins. Arbitrary but deterministic and consistent across all devices — no additional state tracking or client identity required.

**D4: Validation uses partial-apply, not full-revert.**
If an agent writes 5 field changes where 4 are valid and 1 is invalid, the 4 valid changes are applied and the 1 invalid field is reverted to its previous value. This avoids losing valid work due to one bad field. Validation rejections are logged to Clawchestra's structured log and surfaced in the UI via a validation status indicator on the project card.

**D5: AGENTS.md IS part of the branch injection loop.**
AGENTS.md is the primary operations reference (18KB, extensive ROADMAP.md references). Injecting only CLAUDE.md leaves a massive guidance gap. The injection loop updates both files on every branch.

**D6: Migration is per-project, transactional, and derived.**
Each project migrates independently. Migration state is derived from the filesystem (does ROADMAP.md exist? does state.json exist? is .gitignore updated?) rather than persisted as an enum in the DB. Each step is individually retriable and checks preconditions before acting.

**D7: Auto-commit for kanban drags is removed entirely.**
Post-migration, kanban drags write to state.json (gitignored) → no git changes → no auto-commit needed. The `auto-commit.ts` AUTO_COMMIT_ALLOWED set is updated to `CLAWCHESTRA.md` only. The kanban-drag auto-commit code path becomes dead code and is removed.

**D8: External changes detected by content hash, not write flag.** *(new in v2)*
After every Clawchestra write to state.json, store the SHA-256 of what was written. When the file watcher fires, hash the current file. If the hash differs from the last-written hash, it is an external change. This is deterministic and does not race under FSEvents coalescing.

**D9: Single unified file watcher in Rust.** *(new in v2)*
All file watching uses the Rust `notify` crate. The existing TypeScript watcher (`src/lib/watcher.ts`) is removed. Rust emits typed Tauri events for different change categories (project file changed, state.json changed, git status changed). The frontend subscribes to specific events. This prevents non-deterministic event ordering from two independent watcher systems on overlapping paths.

---

## state.json Schema (concrete definition)

Per-project file at `{project_root}/.clawchestra/state.json`:

```json
{
  "_schemaVersion": 1,
  "_generatedAt": 1708531200000,
  "_generatedBy": "clawchestra",
  "project": {
    "id": "revival-fightwear",
    "title": "Revival Fightwear",
    "status": "in-progress",
    "description": "Shopify Fabric theme for combat sports brand",
    "parentId": null,
    "tags": ["shopify", "ecommerce"]
  },
  "roadmapItems": [
    {
      "id": "auth-system",
      "title": "Authentication System",
      "status": "in-progress",
      "priority": 1,
      "nextAction": "Implement OAuth flow",
      "tags": ["feature", "auth"],
      "icon": "🔐",
      "blockedBy": null,
      "specDoc": "docs/specs/auth-system-spec.md",
      "planDoc": "docs/plans/auth-system-plan.md",
      "completedAt": null
    }
  ]
}
```

Notes:
- `_` prefixed fields are metadata, not editable by agents
- `_instructions` field removed (v2) — agents learn schema from CLAUDE.md, not embedded comments
- No `updatedAt` timestamps in the per-project file (agents don't need them)
- Timestamps live in the global db.json only (Clawchestra manages them)
- `roadmap/` detail files, `docs/specs/`, `docs/plans/` remain git-tracked — referenced by relative path

### Schema version handling

When reading state.json:
- If `_schemaVersion` equals current version: process normally
- If `_schemaVersion` is higher than current: refuse to process, surface user-visible error: "This project's state was written by a newer version of Clawchestra. Please update."
- If `_schemaVersion` is lower than current: run migration functions (`migrateV1ToV2`, etc.) in sequence
- If `_schemaVersion` is missing: treat as v1 (backwards compat with initial release)

Establish the migration function pattern now (runs in Rust — TypeScript-like pseudocode for readability):
```rust
// In state.rs or a schema_migrations.rs module:
fn migrate_state_json(doc: &mut serde_json::Value, from_version: u32) -> Result<(), String> {
    // Each migration bumps _schemaVersion
    // if from_version < 2 { add_new_field(doc); set_version(doc, 2); }
    Ok(())
}
```

Pre-schema-migration safety: before running any schema migration function, back up the current state to `.clawchestra/backup/pre-schema-v{from}-{timestamp}.json`. This provides a rollback point specific to each schema upgrade. If a migration function ships with a bug, the backup enables recovery even after the version number has been bumped.

~~Settings > Advanced: "Force re-migrate" command~~ — **CUT (Round 5 review).** Migration is deterministic — re-running it produces the same output. If migration ships with a bug, the fix is a code update, not a retry button. The pre-schema-migration backup (above) provides the rollback point. Additionally, ROADMAP.md → db.json migration is a one-time upgrade path for the current instance only — no new user will need this.

Settings > Project detail: add a "Reset state.json" button that re-projects state.json from the DB, overwriting whatever the agent wrote (handles agent-written future `_schemaVersion` permanently blocking processing).

---

## db.json Schema (concrete definition)

Global file at `~/.openclaw/clawchestra/db.json`:

```json
{
  "_schemaVersion": 1,
  "_lastSyncedAt": 1708531200000,
  "_hlcCounter": 42,
  "projects": {
    "revival-fightwear": {
      "projectPath": "/Users/pierce/repos/revival-fightwear",
      "stateJsonMigrated": true,
      "project": {
        "id": "revival-fightwear",
        "title": "Revival Fightwear",
        "status": "in-progress",
        "status__updatedAt": 1708531100000,
        "description": "Shopify Fabric theme for combat sports brand",
        "description__updatedAt": 1708531100000,
        "parentId": null,
        "parentId__updatedAt": 1708531100000,
        "tags": ["shopify", "ecommerce"],
        "tags__updatedAt": 1708531100000
      },
      "roadmapItems": {
        "auth-system": {
          "id": "auth-system",
          "title": "Authentication System",
          "title__updatedAt": 1708531200000,
          "status": "in-progress",
          "status__updatedAt": 1708531200000,
          "priority": 1,
          "priority__updatedAt": 1708531200000,
          "nextAction": "Implement OAuth flow",
          "nextAction__updatedAt": 1708531200000,
          "tags": ["feature", "auth"],
          "tags__updatedAt": 1708531200000,
          "icon": "🔐",
          "icon__updatedAt": 1708531200000,
          "blockedBy": null,
          "blockedBy__updatedAt": 1708531200000,
          "specDoc": "docs/specs/auth-system-spec.md",
          "specDoc__updatedAt": 1708531200000,
          "planDoc": "docs/plans/auth-system-plan.md",
          "planDoc__updatedAt": 1708531200000,
          "specDocBranch": "main",
          "specDocBranch__updatedAt": 1708531200000,
          "planDocBranch": "main",
          "planDocBranch__updatedAt": 1708531200000,
          "specDocContent": "# Authentication System\n\nSpec content here...",
          "specDocContent__updatedAt": 1708531200000,
          "planDocContent": "# Auth Plan\n\nPlan content here...",
          "planDocContent__updatedAt": 1708531200000,
          "completedAt": null,
          "completedAt__updatedAt": 1708531200000
        }
      }
    }
  },
  "clients": {
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
      "hostname": "pierces-macbook",
      "platform": "macos",
      "lastSeenAt": 1708531200000
    }
  }
}
```

Notes:
- Projects keyed by `project.id` (not filesystem path — paths differ between devices)
- `projectPath` stored per-project for local projection target (not synced — local-only)
- Roadmap items keyed by `id` within their project — O(1) lookup for merge operations
- Per-field `__updatedAt` timestamps enable field-level conflict resolution during sync
- `_hlcCounter` is the hybrid logical clock counter for this device (see D3)
- `_schemaVersion` enables forward-compat check and migration functions (same pattern as state.json)
- `_lastSyncedAt` is wall-clock milliseconds (`Date.now()` / `SystemTime::now()`) — NOT an HLC timestamp. It records when the last sync completed. This distinction matters because HLC and wall-clock are incomparable units (see Round 9/10 decisions)
- `clients` map tracks known devices for the OpenClaw system prompt
- Expected size (index only): ~20KB for 10 projects with 10 items each, ~200KB for 50 projects (per spec Section 10)
- Expected size (with content): ~600KB–3MB for 5 projects (spec/plan content ~15KB avg per doc). Delta sync ensures only changed fields transmit after initial load. Content fields are fetched as part of the full db.json. Documents are read on demand when the user opens them.

### db.json Zod schema (TypeScript)

```typescript
// Per-field __updatedAt sibling convention: every mutable field "foo" has a
// sibling "foo__updatedAt" (HLC timestamp). This schema encodes both explicitly
// so that corrupt values are caught at validation time, not at sync time.

// Flattened: { status: z.enum(...), status__updatedAt: z.number(), ... }
export const DbProjectDataSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  title__updatedAt: z.number(),
  status: z.enum(['in-progress', 'up-next', 'pending', 'dormant', 'archived']),
  status__updatedAt: z.number(),
  description: z.string(),
  description__updatedAt: z.number(),
  parentId: z.string().nullable(),
  parentId__updatedAt: z.number(),
  tags: z.array(z.string()),
  tags__updatedAt: z.number(),
});

export const DbRoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  title__updatedAt: z.number(),
  status: z.enum(['pending', 'up-next', 'in-progress', 'complete']),
  status__updatedAt: z.number(),
  priority: z.number().int(),
  priority__updatedAt: z.number(),
  nextAction: z.string().optional(),
  nextAction__updatedAt: z.number().optional(),
  tags: z.array(z.string()).optional(),
  tags__updatedAt: z.number().optional(),
  icon: z.string().optional(),
  icon__updatedAt: z.number().optional(),
  blockedBy: z.string().nullable().optional(),
  blockedBy__updatedAt: z.number().optional(),
  specDoc: z.string().optional(),
  specDoc__updatedAt: z.number().optional(),
  planDoc: z.string().optional(),
  planDoc__updatedAt: z.number().optional(),
  specDocBranch: z.string().optional(),
  specDocBranch__updatedAt: z.number().optional(),
  planDocBranch: z.string().optional(),
  planDocBranch__updatedAt: z.number().optional(),
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completedAt__updatedAt: z.number().optional(),
  specDocContent: z.string().optional(),
  specDocContent__updatedAt: z.number().optional(),
  planDocContent: z.string().optional(),
  planDocContent__updatedAt: z.number().optional(),
});

export const DbProjectSchema = z.object({
  projectPath: z.string(),
  stateJsonMigrated: z.boolean().default(false),  // Per-project migration gate (see lifecycle in Enhancement Summary)
  project: DbProjectDataSchema,
  roadmapItems: z.record(DbRoadmapItemSchema),
});

export const DbJsonSchema = z.object({
  _schemaVersion: z.number().int(),
  _lastSyncedAt: z.number(),
  _hlcCounter: z.number().int(),
  projects: z.record(DbProjectSchema),
  clients: z.record(z.object({
    hostname: z.string(),
    platform: z.string(),
    lastSeenAt: z.number(),
  })),
});

export type DbJson = z.infer<typeof DbJsonSchema>;
```

**Sibling invariant:** every mutable, synced field MUST have a corresponding `__updatedAt` sibling in the schema. Immutable keys (`id`) and local-only fields (`projectPath`) are exempt — they do not participate in sync conflict resolution. When adding new fields to `DbProjectDataSchema` or `DbRoadmapItemSchema`, always add the `__updatedAt` companion. The schema itself enforces this — a missing sibling is a type error at compile time and a validation error at runtime.

---

## Phase 1: Codebase Audit, Schema Types & Runtime Validation

**Goal:** Map every reference to PROJECT.md, ROADMAP.md, CHANGELOG.md across the entire codebase. Define TypeScript and Rust types for the new schema. Establish runtime validation. No behavioral changes — types and validation only.

### 1.1 Grep audit

Search all source files for references to the three files being migrated:

```
PROJECT.md, project.md, PROJECT_MD
ROADMAP.md, roadmap.md, ROADMAP_MD
CHANGELOG.md, changelog.md, CHANGELOG_MD
```

Scope: `src/**/*.{ts,tsx}`, `src-tauri/**/*.rs`, `scripts/**`, `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, test files.

Classify each reference as: **update** (change to new path), **remove** (dead after migration), or **keep** (still valid).

Output: `docs/plans/architecture-direction-audit.md` — a table of every reference with file, line, classification, and notes.

Additional audit targets (from review):
- `store.ts` line 567: hardcodes `['PROJECT.md']` as auto-commit target — needs updating
- `git-sync-utils.ts`: `METADATA_FILES`/`DOCUMENT_FILES` constants — needs updating
- `watcher.ts`: entire module — will be replaced by unified Rust watcher (D9)

### 1.2 TypeScript types via Zod

Create new file `src/lib/state-json.ts` as the single source of truth for the state.json schema:

```typescript
import { z } from 'zod';

export const RoadmapItemSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: z.enum(['pending', 'up-next', 'in-progress', 'complete']),
  priority: z.number().int().optional(),
  nextAction: z.string().optional(),
  tags: z.array(z.string()).optional(),
  icon: z.string().optional(),
  blockedBy: z.string().nullable().optional(),
  specDoc: z.string().optional(),
  planDoc: z.string().optional(),
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});

export const StateJsonDocumentSchema = z.object({
  _schemaVersion: z.number().int(),
  _generatedAt: z.number(),
  _generatedBy: z.literal('clawchestra'),
  project: z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    status: z.enum(['in-progress', 'up-next', 'pending', 'dormant', 'archived']),
    description: z.string(),
    parentId: z.string().nullable(),
    tags: z.array(z.string()),
  }),
  roadmapItems: z.array(RoadmapItemSchema),
});

export type StateJsonDocument = z.infer<typeof StateJsonDocumentSchema>;
export type RoadmapItemState = z.infer<typeof RoadmapItemSchema>;

// For agent-written input (metadata fields stripped, partial allowed).
// .strip() enforces Section 2.4: "unknown top-level fields: warn and strip."
// Unknown fields are silently removed during parsing — warnings are logged
// separately in the merge logic (2.5) by comparing raw keys against schema keys.
export const AgentStateJsonInputSchema = StateJsonDocumentSchema.omit({
  _generatedAt: true,
  _generatedBy: true,
}).partial({
  _schemaVersion: true,
}).strip();

export type AgentStateJsonInput = z.infer<typeof AgentStateJsonInputSchema>;

export function parseStateJson(raw: unknown):
  | { ok: true; data: StateJsonDocument }
  | { ok: false; error: z.ZodError } {
  const result = StateJsonDocumentSchema.safeParse(raw);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, error: result.error };
}
```

Note: the existing `schema.ts` exports a `ValidationResult` type at line 259. The new state.json validation type is `StateJsonValidationResult` in a separate module to avoid collision.

Agent input constraint: agents MUST include both `project` and `roadmapItems` in every write. The `AgentStateJsonInputSchema` requires both fields. Partial documents (e.g., only `roadmapItems` without `project`) are rejected. This is documented in the CLAUDE.md injection (Phase 4.1).

Schema migration execution: all schema migrations (`migrateV1ToV2`, etc.) run in Rust (authoritative). The TypeScript Zod schema is always current-version-only. When Rust encounters an older `_schemaVersion`, it runs migration functions in sequence before sending data to the frontend. This keeps migration logic in one place.

### 1.3 Rust types

lib.rs is 3665 lines — must split. Target module boundaries:

```
src-tauri/src/
├── lib.rs              # App setup, Tauri command registration, settings, existing commands
├── state.rs            # StateJson/GlobalDb structs, serde derives, branded newtypes
├── migration.rs        # Derived state machine, migration trigger, backup, manifest
├── watcher.rs          # Unified notify-based file watcher, event categorization
├── validation.rs       # Zod-equivalent Rust validation, partial-apply, merge logic
├── sync.rs             # OpenClaw sync triggers, HLC, db.json persistence
└── locking.rs          # create-new file lock, MutationLockGuard (extracted from lib.rs)
```

**`state.rs`** contents:
- `StateJson` struct with serde derive
- `GlobalDb` struct with per-field timestamp maps
- `AppState` struct (the `Arc<Mutex<...>>` inner type)
- `MigrationStep` — not persisted, derived from filesystem checks
- `StateJsonValidationError` enum — exhaustive, wired end-to-end to TypeScript
- Branded newtypes: `struct ProjectId(String)`, `struct ProjectPath(PathBuf)`
- `HistoryEntry` struct

Existing code that moves out of lib.rs: `MutationLockGuard`, `acquire_mutation_lock_at`, `with_mutation_lock` → `locking.rs`. File categorization (`FileCategory`, `METADATA_FILES`, etc.) stays in lib.rs (small, used by existing commands).

### 1.4 Settings expansion

Add new fields to `DashboardSettings` in lib.rs with `#[serde(default)]`:

```rust
#[serde(default)]
client_uuid: Option<String>,
#[serde(default)]
openclaw_sync_mode: SyncMode,  // enum, not String
#[serde(default)]
openclaw_remote_url: Option<String>,
#[serde(default)]
openclaw_bearer_token: Option<String>,  // TODO: move to OS keychain before wider distribution
```

```rust
#[derive(Serialize, Deserialize, Default, Clone)]
enum SyncMode {
    #[default]
    Local,
    Remote,
    Disabled,
    #[serde(other)]
    Unknown,  // catch-all for future variants — prevents deserialization crash on downgrade
}
```

### 1.5 JSON Schema export for agents

Generate `.clawchestra/schema.json` from the Zod definition using `zod-to-json-schema`. Agents can reference this to self-validate before writing. Written alongside state.json during projection.

### 1.6 Introduce `tracing` crate

Add the `tracing` crate to `src-tauri/Cargo.toml` alongside the type definitions. Define event categories as spans: `migration`, `validation`, `sync`, `watcher`, `injection`. The `tracing` crate is zero-cost when no subscriber is attached, so Phases 2–6 use `tracing::info!` / `tracing::warn!` from the start. Phase 7 then becomes "attach the subscriber, add log rotation, build the debug export UI" — no retrofitting pass needed.

### Verification gate

- `npx tsc --noEmit` — types compile
- `cargo check` — Rust types compile
- Zod schemas parse example state.json correctly
- Audit document complete and reviewed
- No runtime changes (nothing deployed)

---

## Phase 2: state.json Infrastructure

**Goal:** Build the core new system — writing, watching, validating, and merging state.json. This is the architectural linchpin.

### 2.0 Runtime database layer

The "DB" referenced throughout this plan is an in-memory Rust struct behind `Arc<Mutex<AppState>>` (standard Tauri managed state pattern). This is the canonical runtime state.

```rust
struct AppState {
    db: DbJson,                          // global DB (all projects, per-field timestamps)
    content_hashes: HashMap<ProjectId, String>,  // SHA-256 of last-written state.json per project
    state_history: HashMap<ProjectId, VecDeque<HistoryEntry>>,  // circular buffer per project
    hlc_counter: u64,                    // hybrid logical clock counter
}
```

**Persistence:** `db.json` is written to `~/.openclaw/clawchestra/db.json` on every DB mutation (debounced at 500ms) and on app close. Uses atomic write (write to `.tmp`, rename) — same pattern as state.json. **Crash-safe flush:** register a Tauri `on_window_event` handler for `WindowEvent::CloseRequested` AND `WindowEvent::Destroyed` that flushes the debounce timer immediately (bypassing the 500ms wait). This closes the crash-window where in-memory mutations could be lost on unexpected process termination. Additionally, the on-close sync (Phase 6.6) drains pending merges before reading the DB.

**Frontend reads:** Tauri commands returning typed data (`get_project`, `get_roadmap_items`, `get_all_projects`). The frontend does NOT read db.json directly.

**Frontend writes:** Tauri commands accepting typed data (`update_project_status`, `update_roadmap_item`, `reorder_item`). Each command acquires the Mutex, mutates the DB, writes affected state.json projection(s), and releases the Mutex.

**Concurrency:** `Arc<Mutex<AppState>>` for all shared state. The file watcher thread, Tauri command handlers, and sync operations all acquire this Mutex. Per-project locking is deferred unless profiling shows contention (unlikely with <100 projects). Use `tokio::sync::Mutex` (not `std::sync::Mutex`) to avoid blocking the async runtime.

### Startup sequence

On app launch, operations execute in this order:

1. Load settings from disk
2. Overwrite OpenClaw extension file (Phase 6.2 — always-overwrite on launch, ensures extension is current)
3. Load db.json from `~/.openclaw/clawchestra/db.json` into `AppState`. If db.json does not exist (first launch), create it with empty schema defaults: `{ _schemaVersion: 1, _lastSyncedAt: 0, _hlcCounter: 0, projects: {}, clients: {} }`. **`_lastSyncedAt: 0` means "never synced"** — the write-back mechanism (6.6) treats 0 as "all git files are newer than last sync," so write-back is skipped for all documents until the first successful sync completes.
3b. Backfill `stateJsonMigrated` flag (Phase 5.0.7) — for projects with `roadmap_items` in db.json AND `.clawchestra/state.json` on disk, set `stateJsonMigrated: true` if not already set. Idempotent, ~1ms.
4. Run migrations for all tracked projects (sequentially, per Phase 3)
5. Start file watcher (Phase 2.3)
6. Register client UUID in db.json (Phase 6.4) — upsert `db.json.clients[client_uuid]` with hostname, platform, `lastSeenAt: Date.now()`
7. Regenerate `~/.openclaw/clawchestra/system-context.md` (Phase 6.5) — reflects current clients map and schema rules
8. Pull from OpenClaw and merge (Phase 6.6) — if sync enabled. **Note:** Phase 6.6.0 restructures this step from a TS-invoked command to inline Rust execution. See 6.6.0 for the concrete change.
9. Emit `clawchestra-ready` event to frontend
10. Frontend calls `get_all_projects` unconditionally on mount (does NOT wait for `clawchestra-ready` — see RACE 1 fix in 5.17). `clawchestra-ready` is advisory (sync status display only)

The watcher starts AFTER migrations complete to prevent migration writes from triggering merge cycles on a mid-migration DB.

### 2.1 `.clawchestra/` directory management

New Tauri command: `ensure_clawchestra_dir(project_path: String) -> Result<String, String>`
- Creates `.clawchestra/` in project root if it doesn't exist
- Returns the full path to the directory
- Does NOT modify `.gitignore` yet (that's Phase 3)

### 2.2 state.json writer

New Tauri command: `write_state_json(project_path: String, state: StateJson) -> Result<(), String>`
- Acquires file lock on `.clawchestra/state.json.lock` (create-new pattern per D1/2.6)
- Serializes `StateJson` to pretty-printed JSON
- Writes atomically (write to `.tmp`, rename)
- Computes and stores SHA-256 of written content (for change detection per D8) — **hash MUST be stored BEFORE releasing lock**, so that if the watcher fires between write and hash storage, the hash is already current and the watcher correctly ignores the self-write
- Read-verify: after rename, read the file back and verify it parses against the Zod schema. If verification fails, immediately restore from the in-memory state and log an error. This catches serialization bugs before they propagate through the state history buffer.
- Releases lock

Frontend integration: after any DB write that changes project/roadmap state, call `write_state_json` for affected project(s). Debounce at 200ms **per-project** for rapid changes (e.g., dragging multiple items). Per-project debounce ensures editing project A does not delay project B's state.json write.

### 2.3 Unified file watcher (Rust)

Replace the existing TypeScript watcher (`src/lib/watcher.ts`) with a unified Rust watcher using the `notify` crate (per D9):

- `start_watching(scan_paths: Vec<String>)` — watches all scan paths recursively
- Categorizes events and emits typed Tauri events:
  - `project-file-changed` — CLAWCHESTRA.md or PROJECT.md modified
  - `state-json-changed` — `.clawchestra/state.json` modified
  - `git-status-changed` — git-tracked files modified
- On `state-json-changed`:
  1. Check file size — reject files > 1MB with a user-visible warning ("state.json exceeds 1MB limit — likely a bug. File ignored."). This prevents memory exhaustion from malicious or buggy agent writes. (The spec estimates <500KB for 1000 roadmap items, so 1MB is generous.)
  2. Read the file
  3. Compute SHA-256
  4. Compare against last-written hash (D8) — if match, ignore (our own write)
  5. If different (external change): parse JSON, validate, diff, merge
  6. Log validation results to structured log (`tracing::info!`)
  7. Emit `state-json-merged` event to frontend with the updated project data inline (NOT a full reload — the event carries the affected project's current state, avoiding the cost of re-scanning all projects)
  8. Frontend updates the Zustand store for the affected project and re-renders

Debounce: 100ms (coalesce rapid writes from agents). This exceeds FSEvents coalescing latency (~75ms on macOS). Note: the merge cycle (read → parse → validate → diff → merge → write-back) must complete faster than the debounce interval to avoid falling behind during rapid agent writes. For typical state.json files (<100KB), this is easily met.

**Frontend subscription pattern:** Components switch from calling `watchProjects()` (which returns an unsubscribe callback from the TypeScript watcher) to calling Tauri's `listen()` API:
```typescript
import { listen } from '@tauri-apps/api/event';
const unlisten = await listen('state-json-merged', (event) => {
  useStore.getState().updateProjectFromEvent(event.payload);
});
```

**Manual refresh button:** Add a refresh icon button in the project header bar. Clicking it re-reads all state.json files and re-projects from the DB. This is a cheap fallback for the rare case where the watcher misses an event (especially on Windows where `ReadDirectoryChangesW` can silently drop events under high file activity or on network drives).

**Windows watcher note:** The `notify` crate on Windows uses `ReadDirectoryChangesW` which has known buffer overflow limitations under high file activity. The manual refresh button and the on-launch integrity check (see Startup Sequence) provide recovery paths.

### 2.4 Schema validation

New Rust function: `validate_state_json(incoming: &StateJson, current: &StateJson) -> StateJsonValidationResult`

Validates:
- `_schemaVersion` — forward-compat check (refuse if higher than current)
- `project.status` ∈ `{in-progress, up-next, pending, dormant, archived}`
- `roadmapItems[].status` ∈ `{pending, up-next, in-progress, complete}`
- If `status == complete`, `completedAt` must be present (ISO date string)
- `priority` is a number
- `id` fields are non-empty strings
- Unknown top-level fields: warn and strip (do not reject)

Returns: `StateJsonValidationResult { applied_changes: Vec<Change>, rejected_fields: Vec<RejectedField>, warnings: Vec<String> }`

TypeScript side: validate all data crossing the Tauri bridge using the Zod schemas from Phase 1. This is the second validation layer — Rust validates on ingest, TypeScript validates on receipt. Belt and suspenders for a product.

### 2.5 Merge logic

When an external change is detected, diff field-by-field:
- For each field in the incoming state.json that differs from DB:
  - **Stale write detection:** compare the incoming value against the state history buffer's previous entry (the state BEFORE the most recent Clawchestra-initiated change). If the incoming value equals the previous DB value for a field, it is likely a stale echo from an agent that read before the last change — skip that field. If the incoming value differs from BOTH the current AND previous DB values, it is a genuine new change — apply it. This prevents two-agent races where Agent B's stale snapshot silently reverts Agent A's changes.
  - Validate the new value
  - **Coupled field validation:** fields that are semantically coupled must be validated as a unit. If the unit is invalid, reject all fields in the unit:
    - `status: "complete"` requires valid `completedAt` (YYYY-MM-DD) — reject both if `completedAt` is missing/invalid
    - `completedAt` present but `status` is not `complete`: accept (preserves historical context), log a warning
  - If valid: update DB, set `updatedAt` using HLC timestamp (per D3)
  - If invalid: keep DB value, log rejection
- For new roadmap items (id not in DB): add them (validate all required fields)
- For removed roadmap items (id in DB but not in state.json): do NOT delete — agents removing items from state.json is treated as "I didn't include it" not "delete it". Deletion requires explicit action via UI or OpenClaw chat.
- **Priority conflict resolution:** if an incoming change sets a `priority` that already exists within the same status column, auto-resolve by shifting existing items down (increment their priorities). Log the shift as an info event.

**Ingest-time ordering limitation:** because timestamps reflect when Clawchestra processed the change (not when the agent wrote it), a delayed watcher event from an old agent write can appear newer than a recent user action. The state history buffer (2.7) is the designed recovery path — users can "undo last agent change" to restore their intended state.

### 2.6 Clawchestra-side file lock

Implement locking in Rust for Clawchestra's own concurrent access.

The existing codebase uses a **create-new file lock pattern** (`OpenOptions::new().create_new(true)` in `acquire_mutation_lock_at`, lib.rs lines 280–349) with PID+timestamp stale detection. The new state.json lock reuses this proven pattern — NOT `flock()` via `fs2`/`libc`. The create-new pattern is already cross-platform (no `flock()` on Windows) and battle-tested in production.

- Lock file: `.clawchestra/state.json.lock` (same pattern as `catalog-mutation.lock`)
- Stale detection: reuse `stale_after` parameter (default 60s) from existing `acquire_mutation_lock_at`
- Use canonical paths (`fs::canonicalize()`) per institutional learnings
- **Fail-closed**: try → wait 50ms → retry → up to 5 seconds → return error with user-visible message "Another Clawchestra instance is writing. Please try again." (matches existing `acquire_mutation_lock_at` behavior)

### 2.7 State history buffer

Maintain a circular buffer of state snapshots in the DB (per-project). Fixed size: 20 entries. On each merge, store the pre-merge state with metadata:

```typescript
interface HistoryEntry {
  timestamp: number;          // HLC timestamp
  source: 'agent' | 'ui' | 'sync' | 'migration';
  changedFields: string[];    // e.g., ["roadmapItems.auth-system.status"]
  state: StateJsonDocument;   // full snapshot
}
```

This enables:
- "Undo last agent change" in the UI — with context about WHAT changed and WHO changed it
- Debugging when an agent write produces unexpected results
- Graceful recovery from corrupted state.json (revert to last-known-good)
- Stale write detection in merge logic (compare against previous entry, see 2.5)

**Permanent entries:** migration creates a permanent entry (outside the circular buffer) storing the pre-migration state. This can never be overwritten by subsequent buffer rotation, ensuring the user can always revert to the original imported data.

**Memory impact (from performance review):** Each history entry stores a full `StateJson` snapshot. **Exclude content fields (`specDocContent`, `planDocContent`) from history buffer entries** — they are large (full markdown documents) and not needed for undo/debug purposes. The history buffer tracks structural changes (status, priority, nextAction), not document content. This reduces per-entry size significantly. Estimated memory per project (without content): ~100KB (10 items) to ~4MB (500 items) for the full 20-entry buffer. At 50 projects with 30 items each, total buffer memory is ~15MB — acceptable for a desktop app. Log buffer size at startup (`tracing::info!`) for diagnostics. The fixed size of 20 is sufficient for undo/debug purposes; if memory pressure becomes real, reduce the constant.

When state.json is unreadable (corrupt JSON, partial write): keep last-known-good state in memory, surface a non-blocking warning in the UI, write the last-known-good state back to state.json. Use a "read, wait 50ms, read again, compare" strategy for suspected corrupt files before triggering auto-repair — this prevents overwriting an in-progress agent write.

### 2.8 Zustand store migration

The Zustand store (`src/lib/store.ts`) currently manages all project state via `loadProjects()` which calls `scanProjects()` → parses PROJECT.md + ROADMAP.md from disk → populates `ProjectViewModel[]`.

Post-migration:
- `loadProjects()` switches to calling Tauri command `get_all_projects` which returns typed data from the in-memory DB
- Store actions (`updateProject`, `reorderItem`, etc.) call Tauri commands instead of writing markdown files
- The store subscribes to `state-json-merged` and `clawchestra-ready` Tauri events for reactive updates
- `ProjectViewModel` retains all existing UI-facing fields. Fields that become obsolete post-migration (`roadmapFilePath`, `hasRoadmap`, `changelogFilePath`, `hasChangelog`) are removed in Phase 5 after all consumers are updated — the DB is now the source of truth for roadmap/changelog data
- Persisted UI preferences (sidebar state, selected project, etc.) remain in the existing Zustand persist middleware — no change

### 2.9 Tauri event payload types

Define typed payloads for all Tauri events emitted by the Rust backend:

```typescript
/** Payload for 'state-json-merged' event (emitted after watcher merge cycle) */
export interface StateJsonMergedPayload {
  projectId: string;
  project: {
    id: string;
    title: string;
    status: 'in-progress' | 'up-next' | 'pending' | 'dormant' | 'archived';
    description: string;
    parentId: string | null;
    tags: string[];
  };
  roadmapItems: RoadmapItemState[];  // full list for this project
  appliedChanges: string[];          // e.g., ["roadmapItems.auth-system.status"]
  rejectedFields: string[];          // e.g., ["roadmapItems.auth-system.completedAt"]
}

/** Payload for 'clawchestra-ready' event (emitted after startup sequence completes) */
export interface ClawchestraReadyPayload {
  projectCount: number;
  migratedCount: number;
  syncStatus: 'ok' | 'failed' | 'disabled';
}
```

**`updateProjectFromEvent` merge strategy:** When the store receives a `state-json-merged` event:
1. Find the existing `ProjectViewModel` by `projectId`
2. Update data fields from the payload (`project.*`, `roadmapItems`)
3. Preserve UI-only fields that do not come from state.json: `filePath`, `dirPath`, `content`, `frontmatter`, `hasGit`, `gitStatus`, `children`, `isStale`, `needsReview`, `hasRepo`
4. If no existing `ProjectViewModel` found (new project detected by watcher): create one with default UI field values and add it to the store

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add tests for: Zod schema validation, Rust validation logic, merge logic, state.json round-trip, content-hash change detection, state history buffer, stale write detection, coupled field validation
- Manual test: write a state.json manually in a project dir, verify Clawchestra picks it up

---

## Phase 3: Migration — ROADMAP.md & CHANGELOG.md → Database (includes rename)

**Goal:** Import existing ROADMAP.md and CHANGELOG.md data into the DB, create state.json projections, rename PROJECT.md → CLAWCHESTRA.md, delete source files. Phase 3 from v1 (rename) is merged here since the rename is part of migration.

### 3.1 Dual-filename support

Before migration runs, add dual-filename scan:
- `scan_projects` in lib.rs: scan for `CLAWCHESTRA.md` first, fall back to `PROJECT.md`
- `readProject()` in projects.ts: accepts either filename
- `METADATA_FILES` constant: includes both during transition
- This is prerequisite infrastructure for migration, not a separate phase

### 3.2 Derived migration state machine

Migration state is derived from the filesystem rather than persisted as an enum in the DB. Each step checks preconditions before acting:

```
Derived state:              Condition:
─────────────               ──────────
NotStarted                  ROADMAP.md exists AND no DB rows for this project
Imported                    DB rows exist AND no .clawchestra/state.json
Projected                   state.json exists AND .clawchestra/ not in .gitignore
GitignoreUpdated            .gitignore updated AND ROADMAP.md still exists
SourceDeleted               ROADMAP.md does not exist AND state.json exists
Complete                    All of the above resolved
```

5 derived states (condensed from v1's 7 — `StateJsonCreated` and `GitignoreUpdated` collapse into `Projected` since both are non-destructive and can be done together).

Each step is individually retriable. If any step fails, the next launch re-derives the state and picks up where it left off.

### 3.3 Pre-migration backup

Before any destructive operation, automatically backup to `.clawchestra/backup/` for ALL projects:
- Copy `ROADMAP.md` → `.clawchestra/backup/ROADMAP.md.bak`
- Copy `CHANGELOG.md` → `.clawchestra/backup/CHANGELOG.md.bak`
- Copy `PROJECT.md` → `.clawchestra/backup/PROJECT.md.bak`
- Backup directory is gitignored along with the rest of `.clawchestra/`
- **Migration backups are retained permanently** (not subject to 30-day cleanup). They are small files (<50KB total) and represent an irreversible one-time event. Ongoing state history backups follow normal retention.

**Migration manifest:** write `.clawchestra/backup/migration-manifest.json` listing:
- Every item migrated (id, title, original status)
- Every field modified during sanitization (original value → new value)
- Every warning generated (missing completedAt, generated id, etc.)
- Fields removed during migration that exist in ROADMAP.md but not in state.json schema
- Markdown body of ROADMAP.md preserved in backup only (not migrated to database)
- CHANGELOG.md entries: preserved in backup only unless a `changelogEntries` array is added to the DB schema in a future version

This replaces the v1 Revival Fightwear hardcoded exception. All projects get backups.

### 3.4 Migration trigger

On app launch, for each tracked project:

1. Derive migration state from filesystem
2. If `NotStarted` and project has `ROADMAP.md`:
   - Create backups (3.3)
   - Read ROADMAP.md YAML frontmatter (`items:` array). Wrap YAML parsing in try/catch — on parse failure: log the error with specific failure location, surface user-visible error ("ROADMAP.md in {project} has invalid YAML. Migration skipped — check backup."), do NOT proceed with deletion, allow retry after user fixes the file.
   - Read CHANGELOG.md YAML frontmatter (`entries:` array) if present
   - Import all items into DB with correct statuses and `completedAt` dates
   - **completedAt handling:** items with `status: complete` and no `completedAt` (common in existing data — e.g., `deep-rename-clawchestra`, `git-sync`): set `completedAt` to the migration date (YYYY-MM-DD) and log a warning: "Item '{id}' was complete but had no completedAt — set to migration date". Items with `status: complete` and existing `completedAt`: preserve the original date. Items with `completedAt` but status != `complete`: keep `completedAt` as-is (historical context), log a warning.
   - Use a migration-specific sanitizer (NOT the existing `sanitizeRoadmapItem` which returns `null` for invalid items — migration should import with `status: pending` and a warning flag instead)
   - **Id generation:** items with no `id` get a stable id based on content (`slugify(title)`) rather than position index. Check for id collisions after generation; suffix duplicates: `{id}-2`, `{id}-3`, etc. Log warnings for each generated/deduplicated id.
   - Log import results to structured log; write migration manifest (3.3)
3. If `Imported` (DB rows exist, no state.json):
   - Ensure `.clawchestra/` directory
   - Write `.clawchestra/state.json` projection
   - Append `.clawchestra/` to project's `.gitignore` (create if needed). **Ensure a trailing newline exists before appending** to prevent the last existing pattern and `.clawchestra/` from ending up on the same line.
   - **Git safety:** before committing, check `git status --porcelain` for the specific files being committed. If unrelated files are staged, stash them first (matching the pattern in Phase 4.2). Use `git stash create` + `git stash store` so the stash entry persists even if the process crashes.
   - Commit: "chore: add .clawchestra to gitignore and create state projection"
4. If `Projected` (state.json + gitignore done, ROADMAP.md still exists):
   - **Verify against BACKUP, not DB:** parse the backup ROADMAP.md (`.clawchestra/backup/ROADMAP.md.bak`). For every item in the backup, verify a corresponding item exists in the DB with ALL migrated fields matching (not just `id`, `title`, `status`, `completedAt` — check every field present in the backup: `priority`, `nextAction`, `tags`, `specDoc`, `planDoc`, `icon`, `blockedBy`). The cost of checking all fields is zero (same iteration) and it catches sanitization bugs that affect non-critical fields. Log any field-level differences as warnings. Require that item count matches (no items silently dropped). Only proceed with deletion if this integrity check passes.
   - If verification passes: delete ROADMAP.md, delete CHANGELOG.md
   - Rename PROJECT.md → CLAWCHESTRA.md (if PROJECT.md exists)
   - Git stash protocol (same as step 3)
   - Commit: "chore: migrate orchestration data to Clawchestra database"
5. Derive state again — should be `Complete`

### 3.5 Migration UI

- Show a toast/banner: "Migrating project data... (3/7 projects complete)"
- Per-project status in the project detail modal (derived from filesystem)
- If all projects complete: dismiss automatically
- If any fail: persistent notification with "Retry" button

### 3.6 Handle `roadmap/` detail files

These files (`roadmap/{item-id}.md`) are NOT migrated into the DB. They stay git-tracked. state.json items reference them by relative path. No change needed.

### 3.7 Handle schema drift during import

When importing ROADMAP.md YAML:
- Use a migration-specific sanitizer (NOT the existing `sanitizeRoadmapItem` which drops invalid items)
- **Unrecoverable data** is defined as: item is not an object, or item has no `title` AND no `id` (nothing to identify it by). These are logged as errors and skipped.
- **Recoverable invalid data:** missing `status` → default to `pending`. Invalid `status` value → default to `pending`. Missing `id` → generate from `slugify(title)`. Missing `title` → use `id` as title. Invalid `priority` → strip (optional field). All recoveries are logged as warnings in the migration manifest.
- Items with recoverable invalid data are imported with corrected values and logged as warnings
- Log all import warnings to structured log

### 3.8 Auto-rename offer (post-migration)

In the project detail modal:
- If a project still uses `PROJECT.md` (migration didn't rename, or migration was skipped): show "Using legacy filename"
- One-click rename button: renames file, commits "chore: rename PROJECT.md → CLAWCHESTRA.md"

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add migration tests: import → verify DB → verify state.json → verify deletion → verify backup exists
- `pnpm build` success
- Manual test: open app with existing projects, verify migration runs, verify kanban board shows same data, verify ROADMAP.md/CHANGELOG.md deleted, verify `.clawchestra/backup/` contains originals

---

## Phase 4: CLAUDE.md & AGENTS.md Branch Injection

**Goal:** Inject updated agent guidance (pointing to state.json instead of ROADMAP.md) into CLAUDE.md and AGENTS.md on all branches of all tracked projects.

### 4.1 Injection content

The injected CLAUDE.md section:

```markdown
## Clawchestra Integration

Project orchestration state lives in `.clawchestra/state.json` (gitignored, always on disk).

**Read:** Open `.clawchestra/state.json` to see project status, roadmap items, priorities. Always read immediately before writing — do not cache contents across operations.
**Write:** Edit `.clawchestra/state.json` to update status, add items, change priorities. Include BOTH `project` and `roadmapItems` in every write. Clawchestra validates and syncs automatically.

**Schema:** See `.clawchestra/schema.json` for the full JSON Schema definition.

**Schema rules:**
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- When setting status: complete, always set completedAt: YYYY-MM-DD
- Priorities are unique per column
- Do NOT delete items from state.json — removal requires explicit action via Clawchestra UI
- Items you omit from `roadmapItems` are NOT deleted — Clawchestra restores them on next projection

**Do NOT edit:** CLAWCHESTRA.md (human documentation only), any files in `.clawchestra/` other than state.json.

**Remote access (cloud environments):**
If `.clawchestra/state.json` is not available (cloud agent, CI, different device),
access the project database via the OpenClaw data API:
- GET  {openclaw_url}/clawchestra/data/db.json
- PUT  {openclaw_url}/clawchestra/data/db.json (full document replace)
- Authorization: Bearer {bearer_token}

When writing via PUT: read first, modify only this project's entry
(projects.{project_id}.*), increment _hlcCounter by 1, set __updatedAt
to Date.now() for each changed field, then PUT the full document back.
```

Injection logic additions for cloud agent access:
- `{openclaw_url}` = `settings.openclaw_remote_url` or `http://127.0.0.1:18789`
- `{bearer_token}` = from keychain; if public repo, use `[Contact project owner]`
- Public repo detection: `git remote get-url origin` → call GitHub API → check `"private"` field

The AGENTS.md section updates use exact string replacements (not broad content replacement):
- `ROADMAP.md` → `.clawchestra/state.json` (all occurrences in "edit ROADMAP.md" / "read ROADMAP.md" contexts)
- `PROJECT.md` → `CLAWCHESTRA.md` (all occurrences referencing the project file)
- `"read PROJECT.md"` → `"read CLAWCHESTRA.md for documentation, .clawchestra/state.json for machine-readable state"`
- `YAML frontmatter` → `JSON` (in schema shape descriptions)
- Keep all other AGENTS.md content untouched — no broad find-and-replace beyond these exact patterns

### 4.2 Injection command (simplified)

Single Tauri command:

```rust
fn inject_agent_guidance(project_path: String) -> Result<Vec<BranchResult>, String>

struct BranchResult {
    name: String,
    success: bool,
    skip_reason: Option<String>, // "already_injected" | "worktree_checked_out" | "dirty" | "detached" | "submodules"
}
```

No `InjectionOptions` struct. No dry-run mode. No retry-only mode. No per-branch DB persistence.

Logic:
1. Stash current changes if working tree is dirty (use `git stash create` + `git stash store` so the stash entry persists even if the process crashes — safer than `git stash push`)
2. Record original branch (including whether HEAD is detached — if detached, record the commit SHA for restoration via `git checkout <sha>` instead of `git checkout <branch>`)
3. Detect worktree-checked-out branches and skip them (prevents git checkout failures)
4. Detect projects with git submodules (`.gitmodules` exists) and skip them with `skip_reason: "submodules"` — submodule state changes across branches can cause unexpected failures
5. For each local branch (with a 60-second timeout per branch and a cancel button in the UI):
   a. Check if already injected (idempotency — look for "Clawchestra Integration" section header)
   b. If already injected: skip
   c. `git checkout "$branch"`
   d. Update CLAUDE.md (append or replace section)
   e. Update AGENTS.md (find-and-replace ROADMAP.md/PROJECT.md references)
   f. `git add CLAUDE.md AGENTS.md`
   g. `git commit -m "chore: update agent guidance for Clawchestra architecture"`
   h. Record success
5. Restore original branch
6. Apply stash if exists
7. Return results

Frontend shows progress via Tauri events (one event per branch). Toast with summary on completion. "Retry" button simply re-runs the command — idempotency check skips already-done branches.

### 4.3 Update sync-agent-compliance.sh

Update `scripts/sync-agent-compliance.sh` to:
- Reference state.json instead of ROADMAP.md
- Reference CLAWCHESTRA.md instead of PROJECT.md
- Keep the compliance block sync mechanism intact

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add injection tests: mock git operations, verify CLAUDE.md content, verify idempotency
- Manual test: run injection on a multi-branch project, verify CLAUDE.md on each branch

---

---

## Phase 5: Frontend Alignment, Cleanup & Built-Code Fixes

**Goal:** Bring the entire frontend into alignment with the architecture direction. Update all constants, file references, UI components, and flows to use the new data layer (db.json → state.json → CLAWCHESTRA.md). Remove dead code. Wire up missing connections. Fix built-code gaps from Phases 1-4 discovered during reviews. This is the "sweep" phase (per institutional learnings lesson #3).

**Self-contained scope:** Phases 5-7 encompass ALL remaining work. Builders should NOT be directed to Phases 1-4 — any fixes to built code are captured here in Phase 5.0.

**Document ordering note:** Substeps in this document are numbered for reference, NOT for execution order. The authoritative execution order is the "Recommended Execution Order" table in the Enhancement Summary (Groups 0–6). For example, 5.18 appears after 5.14 in this document but is built in Group 3 alongside 5.16 and 5.17.

**Audit reference:** `docs/plans/architecture-direction-audit.md` — line-by-line catalogue of ~35 updates and ~25 removals.

### Phase 5 at a Glance

| Group | Steps | What it does |
|-------|-------|-------------|
| **0 — Built-code fixes** | 5.0.1–5.0.7 | Fix migration.rs (git commits, blocking verification), injection.rs (metadata contradiction), event payload types, remove configurable buffer size, fix extension fail-open auth, add stateJsonMigrated flag |
| **1 — Constants** | 5.1, 5.5✓, 5.13 | Update file constants, status enums, schema comments. 5.5 already complete |
| **2 — File references** | 5.6, 5.8, 5.19 | Update PROJECT.md→CLAWCHESTRA.md paths, templates, dual-filename warning |
| **3 — Components + data** | 5.2, 5.3, 5.7, 5.16, 5.17, 5.18 | Core migration: AddProjectDialog, project creation flow, App.tsx roadmap pipeline, loadProjects→event-driven, useProjectModal rewrite |
| **4 — Agent guidance** | 5.4, 5.9✓, 5.10 | Wire injection trigger, update AGENTS.md. 5.9 already complete |
| **5 — Cross-branch + content** | 5.20 → 5.21 (serial) | `git show` fallback for branch-locked docs, content fields for cross-device access |
| **6 — Cleanup** | 5.11✓, 5.12, 5.14 | Dead code sweep, test fixture updates. 5.11 already complete |

**Key mechanism:** All write operations gated by per-project `stateJsonMigrated` flag during transition (see lifecycle below).

### 5.0 Built-code fixes (formerly Pre-Phase 5 Prerequisites)

> **Source:** Migration review + deepen-plan review + Round 3 reviewer findings. These fix gaps in Phases 1-4 built code. All are HIGH severity and must be completed before proceeding with Phase 5.1+.

#### 5.0.1 Add git commit operations to migration.rs

**Issue:** migration.rs performs all filesystem changes (backup, state.json write, .gitignore update, ROADMAP.md deletion, PROJECT.md rename) but never commits them. Every migrated project will have uncommitted changes that confuse git status displays.

**Location:** `src-tauri/src/migration.rs` — needs adding.

**Fix:** Add git commit calls matching the pattern already used in `injection.rs` (shell out to git via `Command::new("git").args(...)`):
- After gitignore + state.json write: `git commit -m "chore: add .clawchestra to gitignore and create state projection"`
- After ROADMAP.md deletion + rename: `git commit -m "chore: migrate orchestration data to Clawchestra database"`
- Do NOT stash user's staged files. Instead, use `git add` on only the specific migration-created files (`.clawchestra/state.json`, `.gitignore`, `CLAWCHESTRA.md`) and commit with `git commit -- <specific files>` to avoid touching the user's staging area. This is the same approach used by `injection.rs` which commits only its own changes.

#### 5.0.2 Make field-level verification blocking in migration.rs

**Issue:** In `migration.rs`, field-level mismatches produce warnings but do NOT block deletion. The plan explicitly requires all migrated fields to match before deletion proceeds.

**Fix:** Change the verification logic to return `Err` if any field mismatches exist between backup and DB. The backup is the safety net — if verification fails, keep ROADMAP.md and surface an error: "Migration verification failed for {project}: {mismatched_fields}. Source files retained."

#### 5.0.3 Resolve injection content contradiction

**Issue:** `injection.rs` lines 28-31 tell agents to include `_schemaVersion`, `_generatedAt`, `_generatedBy` as required fields. The plan's `AgentStateJsonInputSchema` (Phase 1.2) strips these via `.omit()`. These cannot both be correct.

**Fix:** Update `injection.rs` `CLAUDE_MD_SECTION` to remove ONLY the "Required envelope fields" paragraph (the paragraph that tells agents to include `_schemaVersion`, `_generatedAt`, `_generatedBy`). The rest of the CLAUDE_MD_SECTION is updated holistically via Phase 5.4's re-injection. Agents should NOT include metadata — Clawchestra sets these on ingest. **Regarding `last-rejection.json`:** the watcher already writes this file (`watcher.rs`), so the injection reference to it is correct and should remain. Verify that the `last-rejection.json` path in `injection.rs` matches the actual write path in `watcher.rs`. Phase 7.3 adds the UI display of rejection data — the file itself already exists at runtime.

**Note on previously-injected branches:** Branches that were injected before this fix will have the stale "Required envelope fields" paragraph in their CLAUDE.md. This is handled naturally: the watcher's `write_back_current_state` recovery re-projects state.json on each branch visit, and agents that include metadata fields will simply have them stripped by `AgentStateJsonInputSchema.omit()` — no data loss, just a benign schema mismatch that self-heals when injection re-runs (idempotency check looks for section header, not content equality, so re-injection requires deleting the old section first or using `--force`).

#### 5.0.4 Event payload type definitions (from Kieran M4)

**Issue:** `state-json-merged` and `clawchestra-ready` events have untyped payloads. The plan (Phase 2) defines `StateJsonMergedPayload` and `ClawchestraReadyPayload` TypeScript interfaces, but these must be verified against what the Rust backend actually emits.

**Fix:** Verify the typed interfaces in `src/lib/state-json.ts` match the Rust structs in `watcher.rs`. The built code already defines:

```typescript
// state-json.ts (already built — verify, don't duplicate)
interface StateJsonMergedPayload {
  projectId: string;
  project: {
    id: string;
    title: string;
    status: 'in-progress' | 'up-next' | 'pending' | 'dormant' | 'archived';
    description: string;
    parentId: string | null;
    tags: string[];
  };
  roadmapItems: RoadmapItemState[];  // Array, NOT keyed map
  appliedChanges: string[];
  rejectedFields: string[];
}

interface ClawchestraReadyPayload {
  projectCount: number;
  migratedCount: number;
  syncStatus: 'ok' | 'failed' | 'disabled';
}
```

These match the Rust `StateJsonMergedEventPayload` and `StateJsonProjectPayload` structs in `watcher.rs`. Key shape notes: `roadmapItems` is an array (not `Record<string, DbRoadmapItem>`), `project` is a simplified projection (not full `DbProjectData`), and merge source tracking uses `appliedChanges`/`rejectedFields` (not a `mergeSource` enum).

If any NON-CONTENT fields are missing from the Rust struct, add them to BOTH the Rust payload struct and the TypeScript interface. **Content fields (`specDocContent`, `planDocContent` and their `__updatedAt` siblings) are explicitly excluded from the event payload** per Phase 5.21.3 — they are large (full markdown documents) and fetched on demand via a separate `get_project` Tauri call, not broadcast through every `state-json-merged` event.

#### 5.0.5 Remove configurable `history_buffer_size` from built code

**Issue:** `AppState` still has a `history_buffer_size: usize` field and `DashboardSettings` has `state_history_buffer_size`. Round 6 decision hardcoded buffer size to 20 but the configurable fields remain in built code.

**Fix:** Remove `history_buffer_size` from `AppState` and `state_history_buffer_size` from `DashboardSettings`. Also remove the assignment in `lib.rs` startup code (search for `history_buffer_size`). Add `const HISTORY_BUFFER_SIZE: usize = 20;` in the module where the buffer is managed. Update all references.

#### 5.0.6 Fix extension fail-open auth (SECURITY — elevated from Phase 6.1)

**Issue:** The built extension (`clawchestra-data-endpoint.ts`) has fail-open auth — if `settings.json` is missing or unreadable, the catch block returns `'{}'` → no `bearerToken` → auth check is skipped → endpoint is open. The extension is already deployed and running.

**Fix:** Apply the fail-closed auth pattern from Phase 6.1 to the CURRENTLY DEPLOYED extension file. If settings.json is unreadable or has no `bearerToken`, return 500 ("Extension not configured"), not open access. This is a one-line change to the existing extension file on disk. **Note:** This is an interim fix for the currently deployed extension. Phase 6.1 replaces the entire extension file — the fail-closed pattern is built into the new code. Phase 6.2's always-overwrite-on-launch will keep the fix current thereafter.

#### 5.0.7 Add `stateJsonMigrated` flag to built code

**Issue:** The `stateJsonMigrated` flag is described extensively in the plan (Enhancement Summary lifecycle, Phase 5.3, 5.16, 5.17, 5.18) but does not exist in the built Rust `DbProjectEntry` struct or the TypeScript `DbProjectSchema` Zod schema. Without it, the runtime check (`if stateJsonMigrated → Tauri commands; else → writeRoadmap()`) cannot be implemented.

**Fix:**
- **Rust:** Add `pub state_json_migrated: bool` with `#[serde(default)]` to `DbProjectEntry` in `state.rs`. The `default` attribute ensures existing db.json files without the field deserialize correctly (`false`).
- **TypeScript:** Add `stateJsonMigrated: z.boolean().default(false)` to `DbProjectSchema` in `db-json.ts`.
- **Zustand store:** Derive `stateJsonMigrated` into the project model so frontend components can check it.
- **migration.rs forward path:** After successful migration AND field-level verification (5.0.2), `migration.rs` must set `state_json_migrated = true` on the project's `DbProjectEntry` in the in-memory DB. This ensures newly-migrated projects get the flag set during the same migration run, not just via the backfill heuristic.
- **Backfill for already-migrated projects:** If a project has `roadmap_items` in db.json AND `.clawchestra/state.json` exists on disk, but `state_json_migrated` is `false` (or absent), it was migrated before the flag existed. Both conditions must be met — `roadmap_items` alone is insufficient (projects discovered by scan may have items without being fully migrated). **Trigger:** Run during the Rust startup sequence (after db.json load, before migrations — between steps 3 and 4). The backfill is idempotent (setting `true` on a field that's already `true` is a no-op), so running it on every launch is harmless and avoids the need for a separate completion flag. O(N) over projects, ~1ms total.

#### 5.0.8 Verify `get_project` Tauri command returns content + branch fields

**Issue:** `fetchDocContent()` (Phase 5.21.3) reads content fields via a separate `get_project(project_id)` Tauri call (not from `get_all_projects` or the Zustand store). The built `get_project` must return the full `DbProjectEntry` including content fields (`specDocContent`, `planDocContent`) and branch fields (`specDocBranch`, `planDocBranch`). If the built command returns a subset that omits these fields, extend it.

**Fix:**
- **Rust:** Verify `get_project` in `lib.rs` returns `DbProjectEntry` (or equivalent) with all fields including content and branch. If it returns a trimmed struct, extend it.
- **TypeScript:** Define `ProjectWithContent` interface in `state-json.ts` — includes content fields, branch fields, and `__updatedAt` siblings. Distinct from `StateJsonMergedPayload` (which excludes content) and `RoadmapItemState` (which excludes `__updatedAt` siblings).
- **Registration:** Verify `get_project` is registered in `generate_handler!` in `lib.rs`.

### Research Insights (Phase 5)

**Pattern Recognition findings:**
- `loadProjects()` is called from 18+ locations across the codebase — this is a full-reload anti-pattern. Phase 5.17 must replace this with event-driven updates via `updateProjectFromEvent()`.
- `updateProjectFromEvent()` pattern already exists in the Zustand store and should be generalized for all project mutations.
- `tauri-events.ts` (`setupTauriEventListeners`) provides a clean handler pattern that should be the model for all new event subscriptions.
- Roadmap data lives in App.tsx local state (not Zustand) — the `openRoadmapView()`, `persistRoadmapChanges()`, and `allSearchableRoadmapItems` functions all operate on ROADMAP.md directly. This MUST be migrated (see 5.16).

**Agent-Native findings:**
- 11/15 UI capabilities are agent-accessible post-Phase-5. The 2 critical gaps (inject guidance, add existing project) need agent paths added.
- AGENTS.md "Adding Projects" section (lines 296-309) is stale — still describes catalog `.md` file creation. Must be rewritten in 5.10.
- AGENTS.md "Rule Zero" (line 84) still says "Pipeline Dashboard" — fix in 5.10.
- `DESIGN_PRINCIPLES.md` line 32 still references ROADMAP.md — update during 5.10 (documentation update, not dead code).

**Data Integrity findings (CRITICAL):**
- **Dual-write path:** During Phase 5 implementation, kanban drags still write to ROADMAP.md (via `writeRoadmap()` in App.tsx:1128, useProjectModal.ts:158) while agents write to state.json. Both paths active simultaneously = data divergence. **Solution:** Implement a per-project `stateJsonMigrated: boolean` flag in the Zustand store (derived from whether db.json has the project entry). ALL write operations check this flag: `true` → Tauri command to state.json, `false` → existing `writeRoadmap()` path. Naturally transitions per-project as migration completes. Phase 5 cleanup removes the `false` branch after all projects are confirmed migrated.
- **`useProjectModal.ts` not listed in Phase 5:** This hook is a PRIMARY ROADMAP.md read/write consumer (lines 65-108: `readRoadmap()` on every project change; lines 145-161: `writeRoadmap()` on reorder; lines 175-197: `migrateCompletedItem()` cross-file mutation). Added as Phase 5.18.
- **`migrateCompletedItem()` has no new-architecture equivalent:** This function atomically moves an item from ROADMAP.md to CHANGELOG.md. In the new architecture, setting `status: complete` + `completedAt` on the item in state.json IS the equivalent — no cross-file migration needed. But `useProjectModal.updateRoadmapItemStatus` (lines 175-197) must be rewritten BEFORE `changelog.ts` is deleted.
- **Non-atomic project creation:** Phase 5.3 adds 4 steps (mkdir, write state.json, append .gitignore, register in db.json). If Tauri IPC fails between file creation and db.json registration, state is inconsistent. **Solution:** Either register in db.json FIRST (compensating command on file failure) or create a single `create_project_with_state` Tauri command that does all 4 operations atomically on the Rust side.
- **`updateProjectFromEvent` discards roadmap items:** store.ts lines 586-618 — the handler updates project-level fields but NOT `roadmapItems` data. Agent changes to items are merged into the Rust DB but never reach the frontend until full reload. Must be fixed in Phase 5.17.

**Data Migration edge cases for Phase 5:**
- Projects without ROADMAP.md skip migration and get status `Complete` but NO state.json (see `migration.rs` skip logic). Phase 5.3/5.17 must handle missing state.json gracefully.
- `run_all_migrations` (in `lib.rs`) only processes projects already in db.json — projects discovered by `scan_projects` but not yet registered will be missed. The startup sequence needs: scan → register → migrate.
- Migration history entries use `changed_fields: vec!["*"]` — Phase 7.3 UI must handle the wildcard.

### 5.1 Update constants (Rust + TypeScript)

**Already done in hardening sprint:**
- `METADATA_FILES` in `src-tauri/src/commands/git.rs`: `["CLAWCHESTRA.md", "PROJECT.md"]` ✓
- `DOCUMENT_FILES` in `src-tauri/src/commands/git.rs`: `[]` ✓
- `METADATA_FILES` in `src/lib/git-sync-utils.ts`: `['CLAWCHESTRA.md', 'PROJECT.md']` ✓
- `DOCUMENT_FILES` in `src/lib/git-sync-utils.ts`: `[]` ✓

**Remaining (lib.rs):**
- `METADATA_FILES` in `src-tauri/src/lib.rs`: verify matches git.rs constants (search for `METADATA_FILES`)
- `DOCUMENT_FILES` in `src-tauri/src/lib.rs`: verify matches git.rs constants (search for `DOCUMENT_FILES`)

**Status enum extraction (from Kieran S-NEW-1):**
- Extract roadmap item status values (`"pending" | "up-next" | "in-progress" | "complete"`) to a shared constant in `src/lib/constants.ts` (TypeScript) and a `const` array or enum in `state.rs` (Rust). Currently repeated inline across multiple files — extract once, import everywhere.

### 5.2 AddProjectDialog overhaul (`src/components/AddProjectDialog.tsx`)

The Add Project dialog is entirely pre-architecture-direction. Update to align:

**For new projects:**
- Replace "Create PROJECT.md if missing" checkbox → "Create CLAWCHESTRA.md"
- Remove "Create ROADMAP.md when missing" checkbox entirely (roadmap lives in db.json)
- Remove "Add PROJECT.md frontmatter" checkbox → CLAWCHESTRA.md has no YAML frontmatter
- Add: create `.clawchestra/` directory with state.json projection
- Add: add `.clawchestra/` to `.gitignore`
- Add: register project in db.json

**For existing projects (Add Existing):**
- Compatibility check: scan for `CLAWCHESTRA.md` first, fall back to `PROJECT.md`
- Remove `ROADMAP.md` from compatibility scan
- Add detection of `.clawchestra/state.json` (already set up vs needs migration)
- If project has ROADMAP.md but no state.json: surface migration prompt

**Agent-accessible project registration (from agent-native review — CRITICAL):**
Phase 5.2 creates a significant new capability with no agent equivalent. Document in AGENTS.md (Phase 5.10) the steps an agent must take to register an existing project:
1. Create `.clawchestra/` directory
2. Write initial `state.json` (project metadata + empty roadmapItems)
3. Append `.clawchestra/` to `.gitignore`
This makes "Add Existing Project" achievable by both humans and agents.

**Labels to update (line numbers are approximate — search by content rather than line number, as earlier Phase 5 steps may shift positions):**
- Line 263: "Create ROADMAP.md" → remove
- Line 364: "PROJECT.md:" → "CLAWCHESTRA.md:"
- Line 365: "ROADMAP.md:" → remove
- Line 418: "Create PROJECT.md if missing" → "Create CLAWCHESTRA.md"
- Line 436: "Create ROADMAP.md when missing" → remove

### 5.3 Project creation flow (`src/lib/project-flows.ts`)

`createNewProjectFlow` creates the wrong files:

**Note:** Line numbers below are approximate — search by content (e.g., `PROJECT.md`, `ROADMAP.md`) rather than line number, as earlier Phase 5 steps may shift positions.

- Line 134: `PROJECT.md` path → change to `CLAWCHESTRA.md`
- Line 135: `ROADMAP.md` path → remove entirely
- Lines 174-189: Compatibility checks for `PROJECT.md` → check `CLAWCHESTRA.md`
- Line 341: Write `PROJECT.md` → write `CLAWCHESTRA.md`
- Line 342: Push `'PROJECT.md'` to createdFiles → push `'CLAWCHESTRA.md'`
- Lines 345-346: Write + push `ROADMAP.md` → remove
- Line 395: Error message "PROJECT.md frontmatter is invalid" → update
- Line 429: `PROJECT.md` path → `CLAWCHESTRA.md`
- Line 455: Write `ROADMAP.md` → remove
- Lines 463-464: Git add `'ROADMAP.md'` → remove

**New steps to add to the creation flow:**

**Preferred (from data integrity review):** Create a single Tauri command `create_project_with_state` that performs all 4 operations atomically on the Rust side (eliminates IPC boundary in the middle of the transaction):
1. Create `.clawchestra/` directory
2. Write initial `.clawchestra/state.json` (empty roadmap, project metadata)
3. Append `.clawchestra/` to `.gitignore`
4. Register project in db.json with `stateJsonMigrated: true` (new projects start fully migrated)

**`stateJsonMigrated` implementation:** See lifecycle in Enhancement Summary. Phase 5.3 sets `true` for new projects; Phase 5.0.7 ensures migration.rs sets `true` after successful migration (backfill for already-migrated projects + code fix for future migrations); Phases 5.16, 5.17, 5.18 implement the runtime check.

**Alternative (if single command is too large):** Register in db.json FIRST (in-memory, fast), then create files. If file creation fails, unregister via compensating Tauri command. The existing rollback mechanism in `createNewProjectFlow` (lines 323-374) only tracks files — it must also track the db.json registration for rollback.

### 5.4 Inject agent guidance trigger

`inject_agent_guidance` is fully implemented in Rust (`injection.rs`) but has NO frontend trigger. Wire it up:

- Add a button in the project detail modal: "Inject Agent Guidance" (with explanation tooltip)
- Automatically trigger injection after project creation (new projects)
- Automatically trigger injection after migration completes (existing projects)
- Show progress in a modal/toast (one line per branch processed)
- Show results summary: "Injected 5/7 branches (2 already done)"

**Agent-accessible injection path (from agent-native review — CRITICAL):**
Agents (Claude Code, Cursor) cannot call Tauri commands. Without an agent path, agents on new branches have no way to ensure the Clawchestra Integration section exists in CLAUDE.md. Two mitigations:
1. Add a `scripts/inject-current-branch.sh` script that applies single-branch injection (simpler than the all-branch Rust version). Agents can run this directly.
2. Include the exact CLAUDE.md section template in AGENTS.md so agents can self-inject on branches where injection hasn't run.
Both should be implemented. The script is the primary path; the template is the fallback.

### 5.5 Auto-commit and store updates ✅ ALREADY COMPLETE

> **Status:** Done in hardening sprint. Verify the following are already done:

In `src/lib/auto-commit.ts`:
- Update `AUTO_COMMIT_ALLOWED` to `new Set(['CLAWCHESTRA.md'])`
- Remove the code path that triggers auto-commit on kanban drag (kanban writes to state.json now, which is gitignored)
- Update comment: "Only commits CLAWCHESTRA.md changes"

In `src/lib/store.ts`:
- Line 566: hardcoded `['PROJECT.md']` → `['CLAWCHESTRA.md']`

In `src/lib/git.ts`:
- Line 36: `files: string[] = ['PROJECT.md', 'ROADMAP.md']` → `['CLAWCHESTRA.md']`

### 5.6 Project file paths (`src/lib/projects.ts`)

- Line 57-59: `PROJECT.md` path construction → scan `CLAWCHESTRA.md` first, fall back to `PROJECT.md`
- Line 76: Error `'Could not read PROJECT.md'` → update message
- Line 107: `ROADMAP.md` file path → remove (state from DB)
- Line 108: `CHANGELOG.md` file path → remove
- Line 208: `PROJECT.md` write path → `CLAWCHESTRA.md`

### 5.7 App.tsx: remove ROADMAP.md write paths, update file references

**Atomic cutover:** Auto-commit changes in 5.7 are gated by `stateJsonMigrated`. For migrated projects, the ROADMAP.md auto-commit code paths are dead and should be removed. For unmigrated projects, the existing auto-commit paths remain active until migration completes. Removal of the `false` branch happens during Phase 5.12 cleanup.

**Note:** Line numbers below are approximate — search by content (e.g., `autoCommitIfLocalOnly`) rather than line number, as earlier Phase 5 steps may shift positions.

- `'No ROADMAP.md found for ...'` → remove (dead code)
- `autoCommitIfLocalOnly(..., ['ROADMAP.md'], ...)` → remove
- `withOptimisticDirtyFile(..., 'ROADMAP.md', 'documents')` → remove
- `autoCommitIfLocalOnly(..., ['PROJECT.md'], ...)` → `['CLAWCHESTRA.md']`
- `withOptimisticDirtyFile(..., 'PROJECT.md', 'metadata')` → `'CLAWCHESTRA.md'`

### 5.8 Template updates (`src/lib/templates.ts`)

- Line 32: `readTemplate('docs/templates/PROJECT.md')` → `CLAWCHESTRA.md` template
- Line 36: `readTemplate('docs/templates/ROADMAP.md')` → remove
- Line 44: `writeIfMissing(..., projectTemplate)` for `PROJECT.md` → `CLAWCHESTRA.md`
- Line 45: `writeIfMissing(resolvedRepoPath + '/ROADMAP.md', ...)` → remove

Create or update `docs/templates/CLAWCHESTRA.md` template (human-readable, no YAML frontmatter, per D5 document format rules).

### 5.9 Update lifecycle prompts ✅ ALREADY COMPLETE

> **Status:** `deliverable-lifecycle.ts` already references `.clawchestra/state.json` in all five lifecycle action prompts (spec, plan, review, deliver, build). Verify the following are already done:

In `src/lib/deliverable-lifecycle.ts`:
- Replace all "update ROADMAP.md" references with "update .clawchestra/state.json"
- Replace all "read PROJECT.md" references with "read .clawchestra/state.json"
- Update prompt templates to reference the new schema

### 5.10 Update AGENTS.md compliance block

In `AGENTS.md` (the Clawchestra project's own AGENTS.md):
- File Structure section: add `.clawchestra/state.json` entry
- Remove `ROADMAP.md` and `CHANGELOG.md` references (post-migration). Also remove CHANGELOG.md from the compliance block's File Structure table and from the Build & Test Commands section if referenced
- Update CLAUDE.md Key Paths table to remove the CHANGELOG.md row
- Update Roadmap Item YAML Shape to reference state.json JSON shape instead

**Additional scope (from agent-native review):**
- Rewrite "Adding Projects" section (lines 296-309) — currently describes catalog `.md` file creation, must describe state.json + db.json registration
- Rewrite "Projects (Top-Level Board)" operations table — currently references a fundamentally different data model
- Fix "Rule Zero" (line 84) — still says "Pipeline Dashboard", must say "Clawchestra"
- Add "Registering an Existing Project" section documenting agent steps (create `.clawchestra/`, write state.json, update `.gitignore`)
- Add Clawchestra Integration section template that agents can self-inject on branches where `inject_agent_guidance` hasn't run
- Add note: spec/plan docs and detail files may live on non-current branches. When writing a `specDoc` or `planDoc` field, agents should be on the branch where the document lives (Clawchestra records the branch automatically via `spec_doc_branch`/`plan_doc_branch`). Clawchestra uses `git show` to read the document cross-branch if needed (Phase 5.20)

### 5.11 Remove old TypeScript watcher ✅ ALREADY COMPLETE

> **Status:** `src/lib/watcher.ts` already deleted in hardening sprint. Verify no stale imports remain.

Delete `src/lib/watcher.ts` (replaced by unified Rust watcher in Phase 2). Update all imports.

### 5.12 Dead code sweep

```bash
npx tsc --noEmit      # Catch type errors from removals
cargo clippy -- -W dead_code  # Catch unused Rust functions
```

**ORDERING CONSTRAINT (from data integrity review):** Do NOT delete `roadmap.ts` or `changelog.ts` until ALL consumers are redirected (5.7, 5.16, 5.17, 5.18) AND `npx tsc --noEmit` confirms zero imports remain.

Specific targets:
- `src/lib/roadmap.ts` — `readRoadmap()`, `writeRoadmap()` become dead code. **Before deletion:** verify that `resolveDocFiles()` and `enrichItemsWithDocs()` were extracted to `src/lib/doc-resolution.ts` in Phase 5.18, and `RoadmapItemState` → `BoardItem` conversion logic was extracted to `src/lib/roadmap-item-mapper.ts` in Phase 5.17. These extractions happen in their consuming phases — 5.12 only deletes the original after confirming zero remaining imports.
- `src/lib/changelog.ts` — entire module dead post-migration. `migrateCompletedItem()` must be replaced in useProjectModal FIRST (5.18) — in new architecture, completion is a status change, not a cross-file move.
- `src/lib/auto-commit.ts` — kanban-drag trigger code path
- `lib.rs` — any functions only called for ROADMAP.md/CHANGELOG.md parsing
- `lib.rs` — `get_installed_extension_version`, `is_extension_stale` (dead after Round 4 decision to always-overwrite extension on launch — version tracking eliminated). **Remove from both function definitions AND `generate_handler!` macro invocation.** Also remove TypeScript callers in `tauri.ts` and any Settings component references to these functions
- `sync.rs` — **skip `detect_clock_skew` during Phase 5 sweep** (cannot evaluate until Phase 6.6 continuous sync is wired up). Defer evaluation to Phase 6 verification gate's "Final dead-code sweep" — if the function is never called after 6.6, remove it then

### 5.13 Schema comments (`src/lib/schema.ts`)

- Line 164: Comment "Absolute path to the PROJECT.md file" → update
- Line 166: Comment "parent of PROJECT.md" → update

### 5.14 Test fixture updates

Update all test files (see audit for complete list):
- Replace `PROJECT.md` fixtures with `CLAWCHESTRA.md`
- Replace `ROADMAP.md` YAML fixtures with state.json JSON fixtures
- Remove `CHANGELOG.md` fixtures
- `src/lib/git-sync.test.ts`: update categorization assertions
- `src/lib/hierarchy.test.ts`: update `filePath` template
- `src/lib/project-flows.rollback.test.ts`: update file assertions
- Add new tests for: state.json validation, migration, merge logic

### 5.18 Rewrite useProjectModal.ts (NEW — from data integrity review)

> **Source:** Data Integrity Guardian. `useProjectModal.ts` is a PRIMARY ROADMAP.md consumer not listed in any Phase 5 sub-step.

`/src/hooks/useProjectModal.ts` directly calls `readRoadmap()`, `writeRoadmap()`, `resolveDocFiles()`, `enrichItemsWithDocs()`, and `migrateCompletedItem()`. All must be redirected:

1. **Replace `readRoadmap()` (lines 65-108):** Read roadmap items from the Zustand store (already loaded via `get_all_projects`), not from ROADMAP.md on disk.
2. **Replace `writeRoadmap()` (lines 145-161):** Call Tauri command (`update_roadmap_item` / `reorder_item`) which updates db.json and writes state.json projection.
3. **Replace `migrateCompletedItem()` (lines 175-197):** Call Tauri command that sets `status: complete` + `completedAt` on the item. The ROADMAP→CHANGELOG cross-file migration is eliminated — in the new architecture, completion is a status change, not a file move.
4. **Extract `resolveDocFiles()` and `enrichItemsWithDocs()`:** These resolve spec/plan doc file paths — independent of storage format. Extract to `src/lib/doc-resolution.ts` NOW (5.18 is the consuming phase). Phase 5.12 verifies zero remaining `roadmap.ts` imports before deletion.
5. **Wire `git show` fallback + content fields (Phases 5.20 + 5.21):** `fetchDocContent()` implements the priority chain defined in Phase 5.21.3 (the single authoritative spec for this function). Exposes `getSourceBranch` for UI branch indicators.

**Atomic cutover:** All write operations gated by `stateJsonMigrated` (see lifecycle in Enhancement Summary).

### 5.19 Dual-filename warning (NEW — from data integrity review)

If BOTH `CLAWCHESTRA.md` AND `PROJECT.md` exist in the same project directory, surface a warning:
- In `checkExistingProjectCompatibility` (project-flows.ts line 134): check for CLAWCHESTRA.md FIRST, fall back to PROJECT.md. If both exist, include a warning: "Both CLAWCHESTRA.md and PROJECT.md found. CLAWCHESTRA.md takes precedence. Delete PROJECT.md to resolve."
- In `getProjects` (projects.ts): log warning if both exist during scan.
- Do NOT create PROJECT.md if CLAWCHESTRA.md already exists (currently, `addExistingProjectFlow` line 172-177 would create PROJECT.md even when CLAWCHESTRA.md exists).

### 5.20 Cross-branch document access via `git show` (NEW — from branch-aware-spec-viewing spec)

> **Source:** branch-aware-spec-viewing spec. Spec/plan docs are git-tracked and may live on feature branches. db.json items are global — clicking a DocBadge on `main` for a spec that only exists on `feature/x` should still show the content.

**Rust command:** `git_read_file_at_ref(repo_path, git_ref, file_path)` already exists in `commands/git.rs` (added during Phases 1-4). Verify it uses existing `validate_commit_path` and `validate_branch_name` validators, passes args via `Command::new("git").args(...)`, and is registered in `lib.rs` `generate_handler!`. Do not re-add.

**Schema additions:**
- `state.rs`: verify `spec_doc_branch: Option<String>` and `plan_doc_branch: Option<String>` already exist on `DbRoadmapItem` (with `__updatedAt` siblings) — these were added during Phases 1-4 (confirmed — search for `spec_doc_branch` in state.rs)
- `db-json.ts`: verify `specDocBranch`, `planDocBranch` fields already exist on `DbRoadmapItemSchema` (with `__updatedAt` siblings) — confirmed at db-json.ts:57-60

**Auto-detection:** During the merge cycle (`merge.rs`), when `spec_doc` or `plan_doc` changes on an item, the current branch is read via `git rev-parse --abbrev-ref HEAD` and stored as `spec_doc_branch`/`plan_doc_branch`.

**TypeScript wrapper:** `gitReadFileAtRef()` in `tauri.ts` with `TauriCommands` type map entry.

**Frontend fallback (wired in 5.18):** `fetchDocContent()` in `useProjectModal.ts` and `RoadmapItemDialog.tsx` follows the priority chain defined in Phase 5.21.3 (the single authoritative spec). Phase 5.20 provides the `gitReadFileAtRef` infrastructure; 5.21.3 defines how it is used in the chain.

**UI indicators:**
- `DocBadge.tsx`: optional `sourceBranch` prop — shows "(branch: X)" in muted text. The `sourceBranch` value comes from `item.specDocBranch` / `item.planDocBranch` accessed via the `get_project` Tauri call (returns `ProjectWithContent` — see Phase 5.0.8). The parent component (`RoadmapItemDetail` or `useProjectModal`) fetches via `get_project` and threads the branch field to `DocBadge`.
- `RoadmapItemDetail.tsx`: `getSourceBranch` prop — renders "Viewing from branch: X" amber banner when content is sourced cross-branch

### 5.21 Content fields for cross-device document access (REVISED — replaces blob SHA freshness design)

> **Source:** Multi-device architectural review. Phase 5.20 solves "document not found on current branch." This step solves cross-device document access — devices without the git repo can still read spec/plan docs via content snapshots in db.json. Staleness detection uses simple `__updatedAt` timestamp comparison, replacing the originally-proposed blob SHA three-tier mechanism (cut as redundant — content fields + continuous sync provide a simpler, more comprehensive solution).

**What was cut and why:** The original Phase 5.21 proposed a `git_get_doc_freshness` Rust command using blob SHA comparison across branches (~400 lines, 8 schema fields, three-tier detection logic, supporting Phase 6.8 polling and Phase 7.4 UI). All three plan reviewers (DHH, Kieran, Simplicity) unanimously flagged this as over-engineering. The insight: content fields with `__updatedAt` timestamps provide staleness detection that is (a) simpler, (b) works cross-device (not just cross-branch), and (c) requires one line of comparison instead of an entire subsystem.

#### 5.21.1 Schema additions to db.json

Add to `DbRoadmapItem` in `state.rs`:

```rust
pub spec_doc_content: Option<String>,
pub spec_doc_content_updated_at: Option<u64>,
pub plan_doc_content: Option<String>,
pub plan_doc_content_updated_at: Option<u64>,
```

Verify corresponding fields already exist in `DbRoadmapItemSchema` in `db-json.ts` (with `__updatedAt` siblings — same "verify existing" pattern as 5.20 for `specDocBranch`):
```typescript
specDocContent: z.string().optional(),
specDocContent__updatedAt: z.number().optional(),
planDocContent: z.string().optional(),
planDocContent__updatedAt: z.number().optional(),
```

**Content fields as cross-device distribution layer:** These fields are one-way synced from the git file (canonical source) to db.json. The git file is always the editing surface for git-backed projects. The content fields are read-only snapshots for distribution to devices without the git repo. On devices with the repo, `fetchDocContent()` reads the local file first. On devices without the repo, the content field provides the document.

**Sync merge support:** `sync.rs::merge_roadmap_item` must include `merge_optional_field!` calls for `spec_doc_content`, `spec_doc_content_updated_at`, `plan_doc_content`, and `plan_doc_content_updated_at` — same pattern as existing optional fields. Without this, content snapshots arriving via remote sync are silently discarded during merge.

#### 5.21.2 Auto-capture content during merge

In `merge.rs`, when `spec_doc` or `plan_doc` changes on a roadmap item (already the site where `spec_doc_branch` is recorded):

```rust
// After setting spec_doc_branch...
const MAX_CONTENT_SIZE: usize = 500 * 1024; // 500KB per document — prevents db.json bloat from binary/generated files

if let Some(ref spec_path) = incoming_item.spec_doc {
    // Capture content snapshot for cross-device access
    let full_path = std::path::Path::new(project_dir).join(spec_path);
    if let Ok(content) = std::fs::read_to_string(&full_path) {
        if content.len() <= MAX_CONTENT_SIZE {
            db_item.spec_doc_content = Some(content);
            db_item.spec_doc_content_updated_at = Some(ts);
        } else {
            tracing::warn!("Skipping content capture for {} — exceeds 500KB limit ({} bytes)", spec_path, content.len());
        }
    }
}
// Same pattern for plan_doc → plan_doc_content
```

This runs at merge time (~1ms overhead for file read). The content snapshot is now in db.json, available to all sync participants via OpenClaw.

**Local-only guard:** Content auto-capture runs only for local merges (watcher-triggered, where the project exists on the local filesystem). For remote sync merges (content arriving from another device via Phase 6.6), content fields flow through `merge_optional_field!` in `sync.rs` (5.21.1) — do NOT attempt filesystem reads during remote merge, as the project may not exist locally or the file may not be on the current branch. The merge context (watcher vs sync) determines which path runs.

#### 5.21.3 Simplified fetchDocContent priority chain

Update the fetch flow in `useProjectModal.ts` and `RoadmapItemDialog.tsx` (wired in 5.18 step 5). The full priority chain:

1. `readFile(path)` → success → render local content. Local file is authoritative when it exists — no staleness check against HLC timestamps (HLC and filesystem mtime are incomparable units)
2. If `readFile` fails → try db.json content field (`item.specDocContent` / `item.planDocContent`)
3. If content field available → render, show banner: "Viewing synced snapshot — last updated [timestamp]"
4. If no content field → try `gitReadFileAtRef(repoPath, item.specDocBranch, relPath)` (Phase 5.20 fallback)
5. Still fails → scan all local branches
6. Not found anywhere → show "Document not available"

~~**Cache:** LRU cache~~ — **CUT (Round 5 review, YAGNI).** Document content is fetched on demand when the user opens a document — no caching layer needed. db.json is kilobytes; projects are <100. If memory pressure becomes real, add caching then.

**Content field access:** `fetchDocContent()` reads `item.specDocContent` / `item.planDocContent` via a separate `get_project` Tauri call, NOT from the Zustand store. Content fields should not transit through every `state-json-merged` event payload — they are large (full markdown documents) and only needed on demand when the user opens a document viewer. The `StateJsonMergedPayload` carries `RoadmapItemState[]` (metadata only); content fields are fetched separately.

**`get_project` verification (Phase 5 prerequisite):** Verify that `get_project(project_id)` Tauri command exists in built code and returns the full `DbProjectEntry` including content fields (`specDocContent`, `planDocContent`) and branch fields (`specDocBranch`, `planDocBranch`). If the built `get_project` returns a subset that omits these fields, extend it. Define a `ProjectWithContent` TypeScript interface in `state-json.ts` for the return type — distinct from `StateJsonMergedPayload` (which excludes content) and `RoadmapItemState` (which excludes `__updatedAt` siblings). `fetchDocContent()` uses this type to access content and branch fields without `any` casts.

**Key simplification vs original design:** Steps 1-2 replace the three-tier blob SHA comparison by treating local files as authoritative (step 1) and falling back to db.json content snapshots with informational banners (step 2). No comparison logic is needed — the local file always wins when it exists. This is simpler and catches both cross-branch AND cross-device access (blob SHAs only caught cross-branch on the same machine). The content field's `__updatedAt` timestamp is set during merge (5.21.2) and synced via continuous sync (Phase 6.6), so it's always current.

**Dependencies:** Phase 5.20 (needs `git_read_file_at_ref` and `specDocBranch` infrastructure). Phase 5.18 (wired into `fetchDocContent`).

### 5.15 Settings Dialog sync UI → DEFERRED TO PHASE 6

> **Simplification:** Per simplicity review, sync UI is not needed for core frontend alignment. Defer to Phase 6 where it belongs alongside sync implementation. Phase 5 should focus on the data pipeline migration.

### 5.16 Roadmap data pipeline migration (NEW — CRITICAL)

> **Source:** Architecture Strategist + Pattern Recognition agents. This was the single most critical gap in the original plan.

**Prerequisite — Tauri commands:** Phases 5.16, 5.17, and 5.18 depend on four Tauri commands that must exist in `lib.rs` (registered in `generate_handler!`):
- `update_roadmap_item(project_id, item_id, changes)` — applies field-level updates to a roadmap item in db.json, sets HLC timestamps, writes state.json projection
- `reorder_item(project_id, item_id, new_priority, new_status)` — updates priority + status atomically (kanban drag)
- `create_project_with_state(project_path, project_data)` — atomic project creation (see 5.3)
- `get_project(project_id)` — returns full `DbProjectEntry` including content + branch fields (verified in Phase 5.0.8; consumed by `fetchDocContent()` in 5.21.3)

The mutation commands are referenced in Phase 2.0 ("Frontend writes") and consumed throughout Group 3. If they don't already exist in the built code, implement them as the first task of Group 3. Each mutation command acquires the `AppState` Mutex, mutates db.json, writes the affected state.json projection, and emits `state-json-merged`.

App.tsx contains three functions that read/write ROADMAP.md directly, bypassing the entire new data layer:

**`openRoadmapView()` (App.tsx):**
Currently reads ROADMAP.md YAML frontmatter to populate roadmap items in the UI. Must switch to reading from the Zustand store (which is fed by `get_all_projects` Tauri command → db.json).

**`persistRoadmapChanges()` (App.tsx):**
Currently writes changes back to ROADMAP.md YAML frontmatter. Must switch to calling Tauri mutation commands (`update_roadmap_item`, `reorder_item`) which write to db.json → project state.json.

**`allSearchableRoadmapItems` (App.tsx):**
Currently derives searchable items from ROADMAP.md parsing. Must derive from the Zustand store's project data.

**Implementation:**
1. Identify all callers of `openRoadmapView()` — trace the render path
2. Replace ROADMAP.md reads with store selectors (projects already loaded via `get_all_projects`)
3. Replace `persistRoadmapChanges()` writes with Tauri command calls
4. Replace `allSearchableRoadmapItems` derivation with a computed selector from the store
5. Remove the ROADMAP.md read/write code paths

**Note:** Roadmap data currently lives in App.tsx local React state, NOT in the Zustand store. Move roadmap data into Zustand (concrete shape defined in Phase 5.17: `roadmapItems: Record<string, RoadmapItemState[]>` keyed by project ID). Phase 5.16 consumes this store field; Phase 5.17 creates it and wires event-driven updates via `state-json-merged`.

**Atomic cutover:** All write operations gated by `stateJsonMigrated` (see lifecycle in Enhancement Summary).

### 5.17 `loadProjects()` → event-driven updates (NEW — CRITICAL)

> **Source:** Architecture Strategist + Pattern Recognition agents.

`loadProjects()` is called from 18+ locations across the codebase. It's a full-reload anti-pattern that re-scans the filesystem every time. Post-migration, project data comes from db.json via Tauri commands.

**Implementation:**
1. `loadProjects()` switches to calling `get_all_projects` Tauri command (returns typed data from in-memory db.json). **Important:** The built `get_all_projects` returns `ProjectSummary` with only `roadmap_item_count` — it does NOT return actual roadmap items. **Extend `get_all_projects` to include `roadmapItems: Vec<RoadmapItemState>` per project** (change the return type from `ProjectSummary` to include the items array). Content fields (`specDocContent`, `planDocContent`) are excluded from this response — they are fetched on demand via `get_project` (see Phase 5.0.8). The store must receive roadmap items from the backend, not derive them from ROADMAP.md.
2. Generalize `updateProjectFromEvent()` pattern (already exists in store) for all project mutations
3. Subscribe to `state-json-merged` and `clawchestra-ready` Tauri events using the `setupTauriEventListeners` pattern in `tauri-events.ts`
4. Reduce `loadProjects()` call sites — most should be replaced with event listeners that call `updateProjectFromEvent()` for targeted updates instead of full reloads
5. Keep `loadProjects()` as a "nuclear refresh" called only on initial load and manual refresh button click

**Sync wiring:** See Phase 6.6 for all sync trigger details (on-launch, continuous, on-close). Sync-on-launch is owned by the Rust startup sequence (step 8). Sync-on-close is owned by Phase 6.6's on-close sequence. Phase 5.17 does NOT implement sync — it consumes sync results via `clawchestra-ready` and `state-json-merged` events.

**Race condition fixes (from race condition review):**

> **RACE numbering:** RACE 1, 4, 6 are the surviving race conditions after triage. RACE 2 is in Phase 6.6 (watcher shutdown). RACE 3 and RACE 5 were triaged out during the deepen-plan pass (RACE 3 was a duplicate of RACE 1; RACE 5 was mitigated by the unconditional `loadProjects()` fix). The numbering is non-contiguous by design — renumbering would break cross-references.

**RACE 1 — `clawchestra-ready` fires before frontend subscribes (MEDIUM):**
The Rust side uses a 100ms `tokio::time::sleep` before emitting `clawchestra-ready`. The frontend subscribes via `setupTauriEventListeners` inside an async `useEffect`. On cold launches or slow machines, 100ms may not be enough. **Fix (chosen):** Keep `loadProjects()` unconditional on mount — do NOT gate initial data load on `clawchestra-ready`. Treat `clawchestra-ready` as advisory (sync status display only, not a data trigger). This eliminates the race entirely — `loadProjects()` always runs on mount, and `state-json-merged` events handle incremental updates after that.

**RACE 4 — `loadProjects()` called instead of `updateProjectFromEvent` (MEDIUM):**
The `state-json-merged` event handler calls `void loadProjects()` (full rescan) instead of the purpose-built `updateProjectFromEvent()`. Two agent writes 200ms apart trigger two overlapping `loadProjects()` calls — the first can overwrite the second's results, causing UI flicker. **Fix:** Use `updateProjectFromEvent()` (already exists in store.ts — search for the function name) for `state-json-merged` events. Reserve `loadProjects()` for initial mount and manual refresh only.

**FIX: `updateProjectFromEvent` must propagate roadmap items (from Kieran M3):**
The built `updateProjectFromEvent()` (store.ts:586-618) updates project-level fields (title, status, tags) but discards `payload.roadmapItems` — it only uses the array for a `hasRoadmap` boolean check. Agent changes to roadmap items are merged in the Rust DB but never reach the frontend until a full `loadProjects()` reload. **Fix:** Extend `updateProjectFromEvent()` to merge `payload.roadmapItems` into the store. The store must hold roadmap items per project. Concrete approach:
1. Add a `roadmapItems: Record<string, RoadmapItemState[]>` field to the Zustand store (keyed by project ID)
2. In `updateProjectFromEvent()`, set `roadmapItems[payload.projectId] = payload.roadmapItems`
3. All UI consumers that currently derive roadmap items from ROADMAP.md (5.16) should read from this store field instead
4. This aligns with 5.16's recommendation to move roadmap data into Zustand (option a)

**Type conversions (from Round 5 review):**
- **Event payload → store:** `updateProjectFromEvent()` receives `RoadmapItemState[]` from the event payload and stores it keyed by `projectId` in the Zustand store. No conversion needed — the array is stored as-is under the project key. **Shape clarification:** The Rust backend converts db.json's keyed map (`Record<string, DbRoadmapItem>`) to an array in the event payload. The frontend store holds the array form (keyed by project ID). The db.json keyed-map shape is only relevant to the Rust merge layer, not the frontend.
- **`RoadmapItemState` → `BoardItem`:** The UI uses `BoardItem` (from store.ts) as its rendering type. `BoardItem` is a UI projection of `RoadmapItemState` — the conversion already exists in `loadRoadmapFromFile()` and the same mapping applies to items from the event payload. **Extract this conversion to `src/lib/roadmap-item-mapper.ts`** as part of 5.17 (the consuming phase). Phase 5.12 verifies zero remaining `roadmap.ts` imports before deletion. **Important: the Zustand store holds `RoadmapItemState[]` (the backend shape), NOT `BoardItem[]`.** The `roadmap-item-mapper.ts` conversion from `RoadmapItemState` → `BoardItem` runs at the UI boundary only — in components that render the kanban board. `updateProjectFromEvent()` stores `RoadmapItemState[]` as-is; the mapper runs downstream. **Priority must be defaulted during conversion** (e.g., `item.priority ?? Infinity`) — the `priority` field is optional in `RoadmapItemState` but required by the UI's sort/render logic. `Infinity` is a UI-sort-only default that MUST NOT be written back to state.json or db.json (it is not valid JSON or `z.number().int()`) — it exists only for sorting items without an explicit priority to the bottom of their column.
- **Typed payload — no `as` casts:** `updateProjectFromEvent()` must use the typed `StateJsonMergedPayload` interface (defined in `state-json.ts`). Remove any existing `as any` or `as unknown` casts on the payload.

**RACE 6 — Kanban drag on unmigrated project (MEDIUM):**
If Phase 5 code deploys and migration hasn't completed for all projects, a drag on an unmigrated project hits the new code path expecting state.json which doesn't exist yet. The drag appears to succeed (optimistic update) but persistence fails. **Fix:** The `stateJsonMigrated` flag (see lifecycle in Enhancement Summary) handles this — unmigrated projects use the `writeRoadmap()` path, not Tauri commands.

**DATA INTEGRITY — Push history before write (MEDIUM, from data integrity review):**
The merge logic pushes a history entry AFTER the merge completes (see `merge.rs` post-merge block). If a UI drag writes state.json and an agent's stale write arrives in the same 100ms debounce window, the stale detection has no UI history entry to compare against. **Fix:** UI-initiated writes via Tauri commands must push a history entry with `source: Ui` BEFORE writing state.json, so stale detection has a reference point.

### Verification gate

- `npx tsc --noEmit` clean
- `cargo clippy` clean (no dead code warnings)
- `bun test` — all tests pass with updated fixtures
- `pnpm build` success
- `npx tauri build --no-bundle` success (full release build)
- Manual test: Add a new project → verify CLAWCHESTRA.md created (not PROJECT.md), `.clawchestra/` created, state.json projected, injection triggered
- Manual test: Add an existing project → verify compatibility check scans CLAWCHESTRA.md, migration prompted if needed

**Smoke test checklist (run after all Phase 5 substeps):**
1. Launch app → projects load from db.json via `get_all_projects` (not filesystem scan)
2. Drag a kanban card → `.clawchestra/state.json` updates (NOT ROADMAP.md) — verify with `cat .clawchestra/state.json`
3. Add a new project → CLAWCHESTRA.md created, `.clawchestra/` directory created, project appears in kanban, `stateJsonMigrated: true` in db.json for the new project
4. Agent writes to `.clawchestra/state.json` → UI updates within 500ms (verify `state-json-merged` event fires)
5. Open a spec doc that only exists on a feature branch → content renders with "Viewing from branch: X" banner
6. Verify `stateJsonMigrated` flag: for a migrated project, confirm db.json has `stateJsonMigrated: true`; for an unmigrated project, confirm drag writes to ROADMAP.md (not state.json)
7. Verify CHANGELOG.md is removed from CLAUDE.md File Structure table (5.10 scope)

**Rollback plan (if Phase 5 breaks the app):**
1. `git revert` all Phase 5 code changes (frontend + Rust)
2. Restore pre-migration backups from `.clawchestra/backup/` (created in Phase 3) for any migrated projects
3. Set `stateJsonMigrated` to `false` for all affected projects in db.json (or remove the field)
4. App reverts to ROADMAP.md read/write path — all data is safe in backups

---

## Phase 6: OpenClaw Data Endpoint & Sync

**Goal:** Create the OpenClaw plugin extension, implement client identity, build continuous sync, and enable cross-device document access. Combines v1 Phases 7+8 — they are small and tightly coupled.

**Now includes:** Settings Dialog sync UI (deferred from Phase 5.15), extension auto-install (from cloud-agent-sync spec), continuous sync with delta transport (promoted from v2, simplified — no offline queue/backoff, no CAS), simplified write-back mechanism for git file sync (no conflict UI), and `?fields=index` extension param (backend only — no frontend progressive loading for v1). ~~Phase 6.8 (continuous freshness polling)~~ was cut — see note in 6.8. ~~CAS~~ was cut — see note in 6.6.

### Research Insights (Phase 6)

**Security Sentinel findings (2 CRITICAL, 3 HIGH):**

1. **CRITICAL: `fs.mkdir` creates arbitrary directories.** The extension's `fs.mkdir(path.dirname(resolved), { recursive: true })` on PUT allows attackers to create directories anywhere under `DATA_ROOT`. Combined with a crafted path, this could write files outside the expected location. **Fix:** Restrict PUT to known filenames only (allowlist: `db.json`, `settings.json`). Reject any path that resolves to a non-allowlisted filename.

2. **CRITICAL: Full-document PUT allows cross-project tampering.** Any client with a valid bearer token can modify ANY project's data via PUT. A compromised agent token could tamper with all projects. **Fix:** For v1, this is acceptable (single-user product, bearer token is the trust boundary). Document as a known limitation. For multi-user: add project-scoped tokens.

3. **HIGH: Symlink bypass.** `path.resolve()` follows symlinks. If an attacker creates a symlink inside `DATA_ROOT` pointing outside, the path traversal check passes but the write targets an arbitrary location. **Fix:** After `path.resolve()`, call `fs.realpath()` and verify the result is still under `DATA_ROOT`.

4. **HIGH: Bearer token in git history.** The CLAUDE.md injection includes the bearer token. Once committed, it lives in git history forever. **Fix:** For private repos, this is acceptable (standard practice, same as `.env` files). For public repos, the plan already uses a placeholder. Add to injection logic: check if repo is public before injecting token.

5. **HIGH: Fail-open auth.** If `settings.json` is missing or unreadable, the catch block returns `'{}'` — no `bearerToken` → auth check is skipped → endpoint is open. **Fix:** Fail-closed: if settings.json is unreadable, return 500, not open access.

**Agent-Native findings for Phase 6:**
- All sync triggers (on-launch, continuous, on-close) owned by Phase 6.6 — Phase 5.17 cross-references here
- Settings Dialog sync UI (deferred from Phase 5.15) should be implemented alongside sync wiring
- ~~Phase 6.8 (continuous freshness polling) was cut~~ — see 6.8 note

### 6.1 Extension file content

Generate `~/.openclaw/extensions/clawchestra-data-endpoint.ts`:

```typescript
// OpenClaw extension API does not publish TypeScript types.
// This file runs in OpenClaw's runtime, not ours — `any` usage is intentional.
export default function (api: any) {
  const path = require('path');
  const fs = require('fs/promises');
  const os = require('os');

  const DATA_ROOT = path.join(os.homedir(), '.openclaw', 'clawchestra');
  const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB limit

  api.registerHttpRoute({
    path: '/clawchestra/data/*',
    handler: async (req: any, res: any) => {
      // Bearer token auth
      const settingsRaw = await fs.readFile(path.join(DATA_ROOT, 'settings.json'), 'utf-8').catch(() => null);
      if (!settingsRaw) {
        return res.status(500).json({ error: 'Extension not configured — settings.json missing or unreadable' });
      }
      let settings;
      try {
        settings = JSON.parse(settingsRaw);
      } catch {
        return res.status(500).json({ error: 'Extension configuration invalid — settings.json is malformed JSON' });
      }
      // Fail-closed auth: require valid bearer token
      if (!settings.bearerToken) {
        return res.status(500).json({ error: 'Extension not configured — missing bearer token' });
      }
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${settings.bearerToken}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Path validation — use path.sep suffix to prevent prefix confusion
      // (e.g., DATA_ROOT="/foo/bar" must not match "/foo/bar-evil/secret")
      const requestedPath = req.params[0] || 'db.json';
      const resolved = path.resolve(DATA_ROOT, requestedPath);
      if (resolved !== DATA_ROOT && !resolved.startsWith(DATA_ROOT + path.sep)) {
        return res.status(403).json({ error: 'Path traversal blocked' });
      }

      if (req.method === 'GET') {
        try {
          const content = await fs.readFile(resolved, 'utf-8');
          res.setHeader('Content-Type', 'application/json');
          // Progressive loading: ?fields=index strips content fields for fast initial paint
          if (req.query?.fields === 'index') {
            const data = JSON.parse(content);
            const CONTENT_FIELDS = ['specDocContent', 'specDocContent__updatedAt', 'planDocContent', 'planDocContent__updatedAt'];
            if (data.projects) {
              for (const proj of Object.values(data.projects) as any[]) {
                if (proj.roadmapItems) {
                  for (const item of Object.values(proj.roadmapItems) as any[]) {
                    for (const f of CONTENT_FIELDS) delete item[f];
                  }
                }
              }
            }
            return res.send(JSON.stringify(data));
          }
          return res.send(content);
        } catch {
          return res.status(404).json({ error: 'Not found' });
        }
      }

      if (req.method === 'PUT') {
        // Security: restrict PUT to allowlisted filenames only (prevents arbitrary file creation)
        const ALLOWED_FILES = new Set(['db.json', 'settings.json']);
        const basename = path.basename(resolved);
        if (!ALLOWED_FILES.has(basename)) {
          return res.status(403).json({ error: `Cannot write to '${basename}' — only ${[...ALLOWED_FILES].join(', ')} allowed` });
        }
        const serialized = JSON.stringify(req.body, null, 2);
        if (serialized.length > MAX_BODY_SIZE) {
          return res.status(413).json({ error: 'Payload too large' });
        }
        // Body validation: for db.json, validate structure and types before writing.
        // This is the last line of defense — a malformed PUT overwrites the file on disk
        // before Rust reads it, so Rust deserialization cannot catch corruption in time.
        if (basename === 'db.json') {
          if (!req.body || typeof req.body !== 'object') {
            return res.status(422).json({ error: 'Invalid db.json — body must be a JSON object' });
          }
          if (typeof req.body._schemaVersion !== 'number') {
            return res.status(422).json({ error: 'Invalid db.json — _schemaVersion must be a number' });
          }
          if (typeof req.body._hlcCounter !== 'number') {
            return res.status(422).json({ error: 'Invalid db.json — _hlcCounter must be a number' });
          }
          if (typeof req.body.projects !== 'object' || req.body.projects === null) {
            return res.status(422).json({ error: 'Invalid db.json — projects must be an object' });
          }
        }
        // Security: ensure target directory exists before realpath check (first-run fix)
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        // Security: verify resolved path after realpath (symlink bypass prevention)
        const realResolved = await fs.realpath(path.dirname(resolved)).catch(() => null);
        const realDataRoot = await fs.realpath(DATA_ROOT).catch(() => DATA_ROOT);
        if (!realResolved || !realResolved.startsWith(realDataRoot)) {
          return res.status(403).json({ error: 'Path traversal blocked' });
        }
        await fs.writeFile(resolved, serialized);
        return res.json({ ok: true });
      }

      res.status(405).json({ error: 'Method not allowed' });
    }
  });
}
```

Changes from v1: bearer token authentication, async filesystem operations, request size limit.

### 6.2 Extension installation

New Tauri command: `install_openclaw_extension(openclaw_path: String) -> Result<(), String>`
- Writes the extension file to `{openclaw_path}/extensions/clawchestra-data-endpoint.ts`
- **Always-overwrite on launch (simplified — Round 4 review):** On every app launch, for local OpenClaw installs, overwrite the extension file unconditionally. If the content is identical, this is a no-op write. No version constant, no version comparison, no staleness detection, no toast. This eliminates version tracking edge cases (comparison bugs, false staleness) while ensuring the extension is always current.
- **Module system:** the extension uses `require()` (CJS). Verify that OpenClaw's extension system uses CJS before shipping. If OpenClaw uses ESM, switch to `import()` syntax. Document this dependency in the extension file header.
- For local OpenClaw: direct filesystem write (always-overwrite on launch)
- For remote OpenClaw: manual installation documented in 3 steps. Settings > Advanced shows a "Reinstall Extension" button that regenerates the extension file content for manual copying. (v2 removes the "AI self-setup" flow — too fragile for a product.)
- **`?fields=index` query param support:** The extension supports a `?fields=index` query parameter on GET requests (code already in 6.1). When present, strips `specDocContent`, `planDocContent`, and their `__updatedAt` siblings from the response. This is a backend-only optimisation — the frontend does NOT use two-phase loading for v1 (always fetches full db.json). The param exists for future use or direct API consumers.
- Verify installation by hitting `GET /clawchestra/data/db.json`

### 6.3 Local filesystem sync path

When OpenClaw is on the same machine (`sync_mode: Local`):
- Skip the HTTP endpoint entirely
- Read/write directly to `~/.openclaw/clawchestra/db.json`
- This is the default

### 6.4 Client UUID

On first launch (or if `client_uuid` is None in settings):
- Generate UUID v4
- Store in `DashboardSettings.client_uuid`
- Auto-detect human-readable name from OS hostname
- Display in Settings > Advanced (copyable, for debugging)

**Clarification:** `client_uuid` is used for device identification in sync contexts (e.g., "Known clients" in 6.5 system prompt, Settings > Advanced display). It is NOT used for HLC tiebreaking — D3 uses content-based lexicographic comparison (see Architectural Decisions table, "D3 tiebreaker: content-based").

**Registration in db.json (Rust — startup sequence step 6):** On launch, after generating or loading `client_uuid`, upsert the client entry in the in-memory `AppState`:

```rust
// In lib.rs startup sequence, after loading db.json into AppState:
let hostname = gethostname::gethostname().to_string_lossy().to_string();
let platform = std::env::consts::OS.to_string(); // "macos", "linux", "windows"
let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as u64;
db.clients.insert(client_uuid.clone(), ClientEntry { hostname, platform, last_seen_at: now });
```

Update `lastSeenAt` on every app launch. This populates the `clients` map consumed by Phase 6.5's system prompt template.

### 6.5 OpenClaw system prompt injection

Write to `~/.openclaw/clawchestra/system-context.md`:
```
You are integrated with Clawchestra, a project orchestration tool.

Database: ~/.openclaw/clawchestra/db.json
Format: JSON (schema below)

Known clients:
- {uuid}: {hostname} ({platform})

Schema rules:
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- completedAt required when status is complete
- Priorities unique per column

When asked about projects, roadmap items, or task status, read the database.
When making changes, write to the database. Sync is automatic.
```

### 6.6 Sync triggers — continuous sync

> **Previously deferred to v2, now promoted into this plan.** Multi-device awareness requires continuous sync — launch-and-close sync leaves db.json on OpenClaw stale for the entire session, making cross-device access unreliable and OpenClaw queries return outdated data.

Implement in `src/lib/sync.ts` (TypeScript — exports `SyncStatus` type, `formatLastSyncTime()` helper, and `getSyncStatusForDisplay()` selector consumed by Settings Dialog and Header sync indicator; NO sync trigger logic — all sync operations are Rust-side) and `src-tauri/src/sync.rs` (Rust — all sync operations including on-launch, continuous, and on-close):

**Prerequisite — lib.rs startup restructuring (6.6.0):** Sync-on-launch (startup sequence step 8) must be moved from a TS-invoked Tauri command (`sync_local_launch`) to inline Rust execution within the startup sequence. The existing TypeScript `sync_local_launch` call must be removed — sync is now internal to the Rust startup, not triggered by the frontend. This is the first task of Phase 6.6. **After restructuring, update the startup sequence documentation (Phase 2 section, line "step 8") to reflect the new ownership.**

**On launch (full sync — runs in Rust startup sequence step 8):**
1. Read local DB
2. If sync mode is `Local`: read `~/.openclaw/clawchestra/db.json`
3. If sync mode is `Remote`: GET `{remote_url}/clawchestra/data/db.json` (with bearer token). On read failure from remote: do NOT merge — keep local state, surface warning: "Remote sync data could not be read. Using local data only."
4. Merge: for each field, keep the one with the newer HLC timestamp (per D3). On ties: content-based tiebreaker (per D3).
5. Update `_hlcCounter` to `max(local_counter, remote_counter) + 1`
6. Write merged result to both local DB and remote
7. ~~**Clock skew detection**~~ — **CUT (Round 5 review).** Unimplementable as described: the remote doesn't expose its wall clock — there's nothing to compare `Date.now()` against. HLC timestamps already handle clock drift by design (that's their purpose). The HLC max-drift guard catches extreme cases. No additional detection mechanism needed.

**Continuous sync (debounced — NEW):**

After every db.json mutation (kanban drag, status change, agent write merge, content snapshot update):
1. Debounce for 2 seconds — if another mutation arrives within 2s, reset the timer
2. On debounce fire: compute delta — which fields changed since the last successful sync
3. **Delta sync (local):** Read remote db.json, per-field HLC merge (same as on-launch), write merged result back. Only changed fields are semantically significant; the full file is read/written each time (v1: full GET/PUT; field-level delta transport deferred).
4. **Delta sync (remote HTTP):** GET remote db.json, merge, PUT back. v1 uses full GET/merge/PUT — db.json reads are fast even at 3MB. A future PATCH endpoint could reduce transport size but is not needed at expected scale.
5. On success: update `_lastSyncedAt`, clear pending changes
6. On failure: log warning, retry on next mutation trigger (no queue — changes are already in the local DB and will merge on next successful sync or on-launch full sync)

**~~CAS (Compare-and-Swap)~~ — CUT:**
> **Cut during Round 4 review.** The create-new file lock already prevents multi-instance concurrent writes. The 2-second debounce prevents multi-task-within-process races. The remaining edge case (file change during read-write window) is extremely rare and self-heals on the next sync cycle. CAS added ~15 lines of mtime comparison + retry logic for a scenario that is already covered.

**Sync status indicator (header):**
- Small icon in the app header showing sync state: synced (green dot), syncing (spinner), error (amber dot)
- Click to expand: last sync time, connection status
- On sync failure: show "Sync failed — will retry on next change" (auto-clears on success)

**Simplification note (from reviewer consensus):** Offline queue with exponential backoff was cut. The local db.json is the durable store — if sync fails, changes persist locally and merge on the next successful sync trigger or on-launch full sync. No in-memory queue, no retry timer, no backoff logic. This eliminates ~100 lines of state management for a scenario (persistent network failure during an active desktop session) that is rare and self-healing.

**Write-back mechanism (git file sync — simplified in Round 4 review):**

When continuous sync delivers a content change (`specDocContent`/`planDocContent`) to a Clawchestra instance that has the git repo on its filesystem:
0. Check if the current branch matches `item.specDocBranch` / `item.planDocBranch`. If the branches differ, skip write-back for this document — the content belongs on a different branch. Prevents cross-branch content leakage (e.g., writing a `feature/x` spec to the `main` working tree).
1. Compare the local git file's mtime against `_lastSyncedAt`. **`_lastSyncedAt` is wall-clock milliseconds (`Date.now()` / `SystemTime::now()`) — NOT an HLC timestamp.** It records when the last sync completed, not a logical ordering. This makes it comparable with filesystem mtime (both wall-clock).
2. If the local git file mtime is OLDER than `_lastSyncedAt` (file has not been modified since the last sync) → auto-write the db.json content to the git file. This creates an unstaged git change (normal developer workflow — same as when an AI agent edits a file). No auto-commit — the user reviews and commits when ready. Store the SHA-256 of the written content (see echo prevention below).
3. If the local git file mtime is NEWER than `_lastSyncedAt` (user is actively editing) → skip the write-back. The local file is more recent than the last sync, so the local version is authoritative. The content field in db.json will be re-captured from the local file during the next merge cycle (5.21.2), at which point HLC timestamps reflect the latest edit. No conflict notification UI for v1.

**Write-back echo prevention:** After writing content to a git file, store the SHA-256 of the written content in memory (keyed by file path). When the file watcher fires and the merge cycle encounters this file, compare the file content hash against the stored write-back hash. If they match, skip content re-capture AND suppress the `state-json-merged` event emission for this cycle — it is the echo of our own write-back, not a new user edit. Suppressing the event prevents the frontend from doing a redundant re-render for a write that originated from db.json itself. This mirrors the D8 self-write detection pattern but for the write-back→watcher path. Clear the stored hash after one successful match.

**Simplification note (Round 4 review):** The original design included a conflict notification UI ([Keep mine] / [Use theirs] / [View diff]) for the case where both sides edit the same document simultaneously. This was cut: (a) the scenario is rare for v1 (most editing happens on the machine with the repo), (b) LWW is the resolution strategy for all other fields — applying it here is consistent, (c) conflict UI requires notification components, diff rendering, and resolution state management that are disproportionate to the frequency of the problem. Deferred to Phase 8+ if real users report lost edits. Auto-commit was also rejected — it risks committing on the wrong branch, creating noisy git history, and removing the user's chance to review before committing.

**On close:**

**RACE 2 — Watcher shutdown required (HIGH, from race condition review):**
The watcher thread (in `watcher.rs`) runs in a `loop {}` with no shutdown signal. It can spawn `handle_state_json_change` tasks that contend for the mutex during shutdown, causing the 4s shutdown budget to be consumed by merge tasks instead of sync. **The plan asks for drain, the code does not implement it.**

**Fix — add watcher shutdown signal:**
1. Add `Arc<AtomicBool>` shutdown flag to the watcher. Check it at the top of each `recv_timeout` loop iteration.
2. Add an in-flight task counter (`Arc<AtomicUsize>` incremented on task spawn, decremented on completion, with `Notify` when it hits zero).
3. **Concrete shutdown:** Drop the `RecommendedWatcher` to stop producing events. Drop the `mpsc::Sender` to unblock any `recv_timeout` call in the loop (the receiver will return `Disconnected`, breaking the loop). Check `AtomicBool` at loop top as a fast-path exit.
4. Before the on-close handler begins:
   a. Set the watcher shutdown flag (`shutdown.store(true, Ordering::SeqCst)`)
   b. Drop watcher + sender
   c. Wait for in-flight counter to reach zero (with 1s sub-timeout)
   d. Only then proceed to flush and sync

**On-close sequence (with watcher drain):**
1. **Stop watcher** — set shutdown flag, wait for in-flight tasks to complete (1s sub-timeout)
2. **Stop continuous sync** — cancel pending debounce timer
3. **Flush** — `flush_if_dirty(&state)` — acquires mutex, serializes, writes to disk
4. **Final sync** — write current db.json to OpenClaw location (local filesystem or HTTP)
5. **Timeout budget:** All on-close work runs within `tokio::time::timeout(Duration::from_secs(4), ...)` in the `on_window_event` handler. Step 1 (watcher drain) has a 1s sub-timeout. Steps 2-4 execute within the remaining 3-second envelope. For local sync, steps 2-4 complete in <10ms. For remote sync over LAN, 200-500ms. Do NOT block app shutdown beyond the 4s budget. If sync fails: log warning, close anyway — data safe in local DB, will sync on next launch automatically.

### 6.7 Settings Dialog sync UI (moved from Phase 5.15)

`SettingsDialog` needs sync configuration (belongs alongside sync implementation, not in Phase 5):
- Add sync mode selector (Local / Remote / Disabled)
- Add remote URL field (when sync mode is Remote)
- Bearer token is now managed via OS keychain (show "Token: configured" / "Token: not set")
- Show client UUID (read-only, copyable) in Advanced section
- "Rotate bearer token" button in Advanced section (generate new UUID v4, store in keychain, re-inject)
- Extension install status indicator: "Installed" / "Not installed" (no version display — always-overwrite on launch eliminates version tracking per Round 4 decision)

### ~~6.8 Continuous document freshness polling~~ — CUT

> **Cut during architectural review.** All three reviewers (DHH, Kieran, Simplicity) unanimously flagged Phase 5.21's blob SHA mechanism as over-engineering. Phase 6.8 depended entirely on Phase 5.21's `git_get_doc_freshness` command for its polling loop — with that infrastructure cut, 6.8 has no foundation. The replacement: content field `__updatedAt` timestamps (Phase 5.21 revised) combined with continuous sync (Phase 6.6) provide sufficient freshness. Documents update when content is captured during merge and synced — no polling needed. The existing file watcher already detects local filesystem changes instantly.

### Verification gate (includes integration testing)

Core verification:
- Extension file generates correctly
- `cargo check` clean
- `npx tsc --noEmit` clean
- `bun test` — add sync tests: merge logic with timestamps, timestamp tie resolution
- `pnpm build` success
- `npx tauri build --no-bundle` success (full release build)

Integration test scenarios (folded in from v1's Phase 9):
1. Fresh install → add project → state.json created
2. Existing user → migration runs → ROADMAP.md imported → deleted → backup exists
3. Kanban drag → state.json updated → sync to OpenClaw
4. Agent writes state.json → Clawchestra validates → DB updated → UI reflects
5. Agent writes invalid data → partial-apply → validation logged → UI shows indicator
6. Concurrent: user drag + agent write → content-hash detection → per-field merge resolves
7. Branch injection → all branches get CLAUDE.md + AGENTS.md
8. Injection retry → previously done branches skipped (idempotent)
9. App closes → final sync fires → app shuts down within 4s (1s watcher drain + 3s sync envelope)
10. Corrupt state.json → last-known-good restored → warning shown
11. Schema version too high → user-visible error, no processing
12. Agent updates spec doc on feature branch → user opens item detail → `fetchDocContent()` falls back to `gitReadFileAtRef` → fresh content rendered via `git show` with branch banner
13. Kanban drag on device A → continuous sync fires within 2s → device B (running Clawchestra) sees updated status without manual refresh
14. User edits spec doc on mobile via OpenClaw → db.json `specDocContent` updated → continuous sync delivers to laptop → Clawchestra auto-writes content to git file (non-conflict) → `git diff` shows the change
15. ~~Conflict notification~~ — cut (LWW via HLC for v1). Verify: if local git file mtime is NEWER than `_lastSyncedAt`, write-back is SKIPPED (local file is authoritative per 6.6 write-back step 3) — no error, no data loss
16. Sync fails mid-session → changes persist in local db.json → next mutation trigger or app relaunch syncs automatically → no data loss

Final dead-code sweep:
```bash
cargo clippy -- -W dead_code
npx tsc --noEmit
```
Grep for any remaining references to ROADMAP.md/CHANGELOG.md in source code (not docs/specs).
**Deferred from Phase 5.12:** Evaluate `detect_clock_skew` in `sync.rs` — now that Phase 6.6 continuous sync is wired up, check if the function is still called. If unreachable, remove it (per Round 5/8 decisions, existing code is harmless but dead code should be cleaned up).

---

## Phase 7: Structured Logging & Error Reporting

**Goal:** Consolidate fragmented logging into a single structured log system. Provide user-facing debug export for support.

### Research Insights (Phase 7)

**Simplification recommendations applied:**
- Single log file (`{app_support_dir}/app.log`) instead of per-project + global. Per-project logs add complexity without proportional debugging value — the global log already includes project IDs in each entry.
- Validation rejection history viewer → simplified to badge-only with click-to-expand showing the last rejection. No scrollable history list — that's over-engineering for a rare event.

**Data migration edge case:**
- Migration history entries use `changed_fields: vec!["*"]` (wildcard). The validation UI must handle this — display as "Full import — all fields" rather than trying to parse it as a dot-path.

### 7.1 Structured logging (Rust)

Attach the `tracing` subscriber (crate already added in Phase 1.6 — verify presence, do not duplicate):
- **Cargo.toml dependencies (from Kieran S5):** `tracing = "0.1"` and `tracing-subscriber = { version = "0.3", features = ["json", "env-filter"] }`. The `json` feature is required for structured log output; `env-filter` enables runtime log level control via `RUST_LOG`.
- JSON-structured log entries: `{ timestamp, level, event_type, details }`
- Categories already defined in Phase 1.6: `migration`, `validation`, `sync`, `watcher`, `injection`
- **Single log file:** `{app_support_dir}/app.log` (all events, includes `project_id` field for filtering)
- Log rotation: cap at 1MB, single backup file (`.log.1` overwritten on each rotation, max 2MB disk usage). Use `rolling-file` crate as the writer layer — it supports size-based rotation. **Note:** `rolling-file`'s `RollingFileAppender` does NOT directly implement `tracing-subscriber`'s `MakeWriter` trait — wrap it in `Mutex<RollingFileAppender>` which does (via the blanket impl for `Mutex<W: Write>`). `tracing-appender`'s built-in rolling is time-based only (daily/hourly) and does not support size-based rotation

### 7.2 User-facing debug export

Settings > Advanced > "Copy debug info":
- Migration state (derived) for all projects
- Last 20 validation events from the structured log file (7.1)
- Last 10 sync events
- Last 10 file watcher events
- App version, OS, client UUID
- Copies to clipboard as formatted text

### 7.3 Validation status in UI

When partial-apply rejects fields:
- Small warning badge on the project card: "1 agent write was partially rejected"
- Click to expand: shows which fields were rejected and why (last rejection only — no scrollable history list)
- Badge persists until user dismisses it (do NOT auto-dismiss on next successful write)
- **Agent feedback file:** Surface existing `.clawchestra/last-rejection.json` data (already written by `watcher.rs`) in the UI via the badge. Format: `{ "timestamp": ..., "rejectedFields": [...], "reasons": [...] }`. This gives agents a detection + retry path without relying on UI notifications. (The `injection.rs` reference to this file path is correct and should remain.)

### ~~7.4 Document freshness status in UI~~ — CUT

> **Cut during architectural review.** Depended on Phase 6.8 (continuous polling) and Phase 5.21's blob SHA infrastructure — both cut. The replacement is simpler: Phase 5.21.3's priority chain shows a banner when db.json content is newer than the local file (step 2) or when content is sourced from db.json (step 4) or from another branch (step 5, via Phase 5.20). These banners are shown at fetch time, which is sufficient — no persistent UI indicators needed for v1.

### ~~7.5 Project creation UX — device/location transparency~~ — CUT

> **Cut during Round 4 review.** Good UX feature but wrong phase — Phase 7's purpose is structured logging and error reporting. Device/location banners in `AddProjectDialog` belong with project creation UX improvements. Moved to Phase 8+ (non-code-projects roadmap item), where project creation flows are holistically redesigned for both git and non-git projects.

### Verification gate

Phase 7 verification (structured logging and error reporting ONLY — Phase 6 features are verified in the Phase 6 gate):
- `tracing` integrated and producing JSON output
- Log rotation: write >1MB to `app.log`, verify `.log.1` is created and `app.log` is reset
- Debug export produces useful output
- Validation status badge + click-to-expand renders correctly
- Migration wildcard (`changed_fields: ["*"]`) displays as "Full import — all fields"
- ~~Project creation UX~~ — cut (Phase 7.5)
- All previous tests still pass

---

## Dependencies Between Phases

```
Phases 1–4 ✅ COMPLETE (+ 17-fix hardening sprint)
     │
     └── Phase 5 (Frontend Alignment + Built-Code Fixes + 5.16/5.17 critical additions)
              │   └── 5.0: Built-code fixes (formerly Pre-Phase 5 Prerequisites)
              │   └── 5.1-5.21: Frontend alignment, cross-branch docs, content fields
              │
              └── Phase 6 (OpenClaw + Sync + Settings UI from 5.15. ~~6.8 cut~~)
                       │
                       └── Phase 7 (Logging & Error Reporting. ~~7.4, 7.5 cut~~)
```

**Phase 5 internal dependencies:**
- Group 0 (built-code fixes) has no internal dependencies — start here
- Groups 1-2 (constants, file references) have no internal dependencies — can start immediately after Group 0
- Group 3 (components: 5.2, 5.3, 5.7, 5.17, 5.16, 5.18) depends on Groups 1-2. Within Group 3: 5.17 before 5.16 (5.17 creates the Zustand store field that 5.16 consumes)
- Group 4 (agent guidance: 5.4, 5.10) depends on Group 3 (needs to know final data model)
- Group 5 (5.20 → 5.21 — serial within group; cross-branch access + content fields) depends on Group 3 (needs `fetchDocContent` rewrite in 5.18). 5.21 depends on 5.20's `gitReadFileAtRef` infrastructure
- Group 6 (cleanup: 5.12, 5.14) depends on all previous groups

**IMPORTANT constraint (from agent-native review):** ROADMAP.md deletion (Phase 3.4 step 4) must NOT proceed on any branch until injection (Phase 4) has completed for that branch. The plan previously allowed Phases 3 and 4 to run in parallel — this is still true for most steps, but the deletion substep is now gated on injection completion for that specific branch.

Phase 7 (logging finalization) depends on Phase 6, but the `tracing` crate is introduced in Phase 1.6 and used throughout all subsequent phases — Phase 7 only adds the subscriber, log rotation, and debug export UI.

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Migration data loss | Low | Critical | Per-project transactional migration; pre-migration backup for all projects; verify before delete; 5.0.2 makes verification blocking |
| Agent writes invalid JSON | Medium | Low | Graceful parse failure; partial-apply; revert to last-known-good from state history buffer |
| Agent ignores new guidance (old branch) | Medium | Low | Creates phantom ROADMAP.md; Clawchestra ignores it; auto-commit updated to not commit it. **Risk:** silent failure window between ROADMAP.md deletion and injection — agent writes to ROADMAP.md with no error signal. Mitigate: constrain deletion to post-injection per branch. |
| OpenClaw extension breaks after update | Low | Medium | Extension is simple; always-overwritten on launch (per Round 4 decision); bearer token auth |
| File watcher misses changes | Very Low | Medium | FSEvents/inotify are kernel-level; manual refresh button as cheap fallback |
| Sync conflict loses data | Low | Medium | Per-field timestamps with millisecond precision; last-writer-wins via HLC (conflict notification UI deferred to Phase 8+); no silent overwrites |
| Two Clawchestra instances race | Low | Medium | Create-new file lock (fail-closed); single-instance recommendation in docs |
| Schema version mismatch | Low | Medium | Forward-compat check; clear user-facing error; migration functions for upgrades |
| Clock skew between devices | Medium | Medium | Hybrid logical clocks (D3) handle drift by design; HLC max-drift guard catches extreme cases; deterministic content-based tiebreaker (per D3). ~~Clock skew detection warning~~ cut (Round 5 — unimplementable without server clock endpoint) |
| Stale agent write reverts recent changes | Medium | Medium | Stale write detection via state history buffer comparison (2.5); "read before write" guidance in CLAUDE.md |
| Windows watcher misses events | Low | Low | Manual refresh button; on-launch integrity check; `ReadDirectoryChangesW` limitations documented |
| Schema migration ships with bug | Low | High | Pre-migration backup; migration manifest for audit trail. ~~Force re-migrate~~ cut (Round 5 — deterministic migration produces same output on re-run; fix is a code update, not retry) |
| **NEW: Extension fail-open auth** | Medium | High | If settings.json missing, extension was open. **Fixed:** fail-closed auth in 6.1 (return 500 if no bearer token configured) |
| **NEW: Symlink bypass in extension** | Low | High | `path.resolve()` follows symlinks. **Fixed:** add `fs.realpath()` check after resolve in 6.1 |
| **NEW: Agent cannot trigger injection** | High | Medium | Agents on new/un-injected branches have no state.json guidance. **Fixed:** scripts/inject-current-branch.sh + AGENTS.md template (5.4) |
| **NEW: Roadmap data pipeline not migrated** | — | Critical | `openRoadmapView()`, `persistRoadmapChanges()`, `allSearchableRoadmapItems` still read/write ROADMAP.md. **Fixed:** added 5.16 |
| **NEW: Migration leaves dirty git state** | High | Medium | migration.rs has no git commits. **Fixed:** 5.0.1 adds git commit operations |
| **NEW: Watcher contends with on-close handler** | High | Medium | No watcher shutdown signal — watcher tasks consume the 4s shutdown budget. **Fixed:** add `AtomicBool` shutdown + in-flight counter in 6.6 |
| **NEW: `clawchestra-ready` fires before listeners** | Medium | Medium | 100ms timer is a hope. **Fixed:** `loadProjects()` unconditional on mount (5.17 RACE 1 fix) |
| **NEW: Overlapping `loadProjects()` from events** | Medium | Low | `state-json-merged` triggers full rescan instead of surgical update. **Fixed:** use `updateProjectFromEvent()` (5.17) |
| **NEW: Dual-write path during transition** | High | Critical | ROADMAP.md and state.json writes active simultaneously during Phase 5. **Fixed:** per-project `stateJsonMigrated` flag gates all writes (Enhancement Summary) |
| **NEW: useProjectModal.ts not in Phase 5** | — | High | Primary ROADMAP.md consumer not listed. **Fixed:** added 5.18 |
| **NEW: Non-atomic project creation** | Medium | High | IPC boundary between file creation and db.json registration. **Fixed:** single `create_project_with_state` Tauri command (5.3) |
| **NEW: Drag loss in debounce window** | Low | Medium | Stale agent write can revert UI drag if history entry not yet pushed. **Fixed:** push history with `source: Ui` before write (5.17) |
| **NEW: Stale document content shown without warning** | Medium | Medium | File exists locally but newer version on another branch/device. **Mitigated:** `fetchDocContent()` priority chain (5.21.3) treats local files as authoritative (no staleness check — HLC and mtime are incomparable). If local file is missing, falls back to db.json content field (with informational banner) or `git show` (with branch banner). Continuous sync (6.6) keeps content fields current. Less aggressive than the cut blob SHA approach, but sufficient for v1. |
| **NEW: Content sync conflict (both sides edited)** | Low | Medium | User edits doc on mobile (db.json), developer edits git file on laptop simultaneously. **Resolution:** Last-writer-wins via HLC `__updatedAt` timestamps, same as all other fields. No conflict notification UI for v1 (cut in Round 4 review). If real users report lost edits, add [Keep mine] / [Use theirs] / [View diff] in Phase 8+. |
| **NEW: Write-back creates unexpected git dirty state** | Medium | Low | When content arrives via sync and auto-writes to git file, the working tree has an unstaged change. This is normal developer workflow (identical to AI agent file edits). Users familiar with git expect this. For non-developer users, this scenario doesn't arise (future non-git projects use db.json directly). |
| **NEW: db.json grows large with content fields** | Low | Medium | 5 projects × 40 docs × 15KB avg = ~3MB. Delta sync ensures only changed fields transmit after initial load. Extension supports `?fields=index` for future optimisation (not used by frontend for v1). Content gzips ~4:1 for HTTP transport. Extreme case (20 projects, 800 items): ~25MB — still loads in 2-6 seconds, comparable to Notion workspace. |
| **NEW: Continuous sync network overhead** | Low | Low | 2-second debounce limits sync frequency. v1 uses full GET/merge/PUT (semantically, only changed fields matter for merge). No offline queue — failed syncs retry on next mutation trigger. Local sync mode (filesystem) has zero network overhead. |

---

## Files Modified (estimated)

| Category | Files | Change Type |
|----------|-------|-------------|
| **Existing TS modules** | `src/lib/state-json.ts`, `src/lib/db-json.ts` | Modify (built in Phases 1-4) |
| **New TS module** | `src/lib/sync.ts` | Create (Phase 6.6) |
| **Existing Rust modules** | `src-tauri/src/state.rs`, `src-tauri/src/migration.rs`, `src-tauri/src/watcher.rs` | Modify (built in Phases 1-4) |
| **Rust backend** | `src-tauri/src/lib.rs` | Moderate (delegate to new modules, settings) |
| **Rust migration fix** | `src-tauri/src/migration.rs` | 5.0.1-5.0.2: add git commits, blocking verification |
| **Rust injection fix** | `src-tauri/src/injection.rs` | 5.0.3: fix metadata contradiction (keep last-rejection ref — watcher already writes it) |
| **Event payload types** | `src/lib/tauri-events.ts`, `src/lib/state-json.ts` | 5.0.4: verify existing typed payload interfaces match Rust structs; extend for new fields |
| **Schema/types** | `src/lib/schema.ts`, `src/lib/settings.ts`, `src/lib/tauri.ts` | Moderate |
| **State management** | `src/lib/store.ts`, `src/lib/projects.ts` | Significant (5.17: event-driven updates) |
| **App core** | `src/App.tsx` | **Significant** (5.16: roadmap data pipeline migration — openRoadmapView, persistRoadmapChanges, allSearchableRoadmapItems) |
| **Removed** | `src/lib/watcher.ts` | Already deleted ✅ |
| **Removed/reduced** | `src/lib/roadmap.ts`, `src/lib/changelog.ts`, `src/lib/auto-commit.ts` | Partial removal |
| **Hooks** | `src/hooks/useProjectModal.ts` | **Significant** (5.18: full ROADMAP.md read/write rewrite) |
| **New module** | `src/lib/doc-resolution.ts` | Create (extracted from roadmap.ts in 5.18: resolveDocFiles, enrichItemsWithDocs) |
| **New module** | `src/lib/roadmap-item-mapper.ts` | Create (extracted from roadmap.ts in 5.17: RoadmapItemState → BoardItem conversion) |
| **Components** | `src/components/Header.tsx`, `src/components/AddProjectDialog.tsx` | Moderate |
| **Git sync** | `src/lib/git-sync-utils.ts` | Moderate (constants) |
| **Cross-branch docs** | `src/components/modal/DocBadge.tsx`, `RoadmapItemDetail.tsx` | Branch banner + `sourceBranch` indicator (5.20) |
| **Content fields** | `src-tauri/src/merge.rs` | Auto-capture content during merge (5.21.2) |
| **Continuous sync** | `src/lib/sync.ts`, `src-tauri/src/sync.rs` | Debounced sync trigger, delta sync (6.6) |
| **Sync status UI** | `src/components/Header.tsx` | Sync indicator: synced/syncing/offline (6.6) |
| **Write-back** | `src-tauri/src/sync.rs` or new `src-tauri/src/writeback.rs` | Auto-write db.json content to git file on sync arrival, LWW for conflicts (6.6) |
| **Lifecycle** | `src/lib/deliverable-lifecycle.ts` | Already done ✅ |
| **Agent guidance** | `AGENTS.md`, `CLAUDE.md`, `scripts/sync-agent-compliance.sh` | Significant (5.10: full rewrite of Adding Projects + ops table) |
| **New script** | `scripts/inject-current-branch.sh` | Create (5.4: agent-accessible injection) |
| **Tests** | `*.test.ts` | Update fixtures + add new tests |
| **OpenClaw** | New: `~/.openclaw/extensions/clawchestra-data-endpoint.ts` | Create (with security hardening) |
| **Dependencies** | `package.json` | Add `zod`, `zod-to-json-schema` |

---

## Success Criteria

- Kanban drag updates state.json, NOT ROADMAP.md
- AI agent reads/writes state.json successfully
- state.json changes appear in Clawchestra UI within 500ms
- All existing projects migrated with zero data loss
- Pre-migration backups exist for all migrated projects
- CLAUDE.md on all branches points to state.json
- db.json syncs to OpenClaw filesystem within 2 seconds of change
- SHA-256 self-write detection correctly distinguishes own vs external writes
- Partial-apply correctly accepts valid fields and rejects invalid ones
- Schema version mismatch produces clear user-facing error
- Clean release build passes
- All existing tests pass (with updated fixtures)
- Validation rejections visible in UI with last-rejection badge (click-to-expand per 7.3 simplification)
- Debug export produces useful support information
- Stale agent writes detected and handled without silent data loss
- Migration manifest generated for every migrated project
- HLC timestamps prevent clock-skew-induced data loss during sync
- db.json schema defined and versioned alongside state.json
- **NEW:** `openRoadmapView()`, `persistRoadmapChanges()`, `allSearchableRoadmapItems` read/write via DB, not ROADMAP.md
- **NEW:** `loadProjects()` calls Tauri `get_all_projects`, not filesystem scan
- **NEW:** Agent on a new branch can self-inject Clawchestra guidance (via script or AGENTS.md template)
- **NEW:** Agent can register an existing project via documented AGENTS.md steps
- **NEW:** Migration commits its filesystem changes (no dirty git state post-migration)
- **NEW:** OpenClaw extension uses fail-closed auth (500 if no bearer token, not open access)
- **NEW:** Injection content matches plan schema (no metadata field contradiction)
- **NEW:** `useProjectModal.ts` reads/writes via Tauri commands, not `readRoadmap()`/`writeRoadmap()`
- **NEW:** No dual-write path — all write operations gated by `stateJsonMigrated` flag during transition
- **NEW:** Project creation is atomic — single Tauri command or compensating rollback for db.json registration
- **NEW:** `resolveDocFiles()` and `enrichItemsWithDocs()` preserved in `src/lib/doc-resolution.ts` after `roadmap.ts` deletion
- **NEW:** Continuous sync — db.json changes visible on OpenClaw within 2-second debounce window
- **NEW:** Sync status indicator in header shows synced/syncing/error state
- **NEW:** Content fields (`specDocContent`, `planDocContent`) populated during merge (5.21.2)
- **NEW:** Cross-device document access — devices without git repo can read documents via db.json content fields
- **NEW:** Write-back mechanism — content edits via mobile auto-update git files on the machine with the repo (non-conflict case; LWW for conflicts)

---

## Performance Profile (from Performance Oracle review)

Architecture scales linearly with project count. Single `Arc<tokio::sync::Mutex<AppState>>` is the contention point but merge times are sub-5ms per project.

| Metric (assumes ~10 items per project) | 10 Projects | 50 Projects | 100 Projects |
|--------|-------------|-------------|--------------|
| Startup load (`get_all_projects`) | <5ms | <20ms | <50ms |
| History buffer memory | ~1 MB | ~15 MB | ~30 MB |
| db.json file size (index only) | ~20 KB | ~200 KB | ~400 KB |
| db.json file size (with content) | ~600 KB | ~3 MB | ~6 MB |
| db.json flush time | <1ms | <5ms | <15ms |
| Merge cycle per project | <5ms | <5ms | <5ms |
| Mutex contention (serial merge) | <10ms | <50ms | <100ms |
| Initial remote sync (full fetch) | <200ms | <1s | <2s |
| Delta sync (single field change) | <50ms | <50ms | <50ms |

**No performance changes needed.** All debounce intervals (100ms watcher, 200ms state.json write, 500ms db.json persistence) are appropriate. The 200ms state.json write does NOT affect UI responsiveness — UI updates are immediate via the in-memory DB; the 200ms only affects on-disk state visible to agents. The 500ms db.json data-loss window on process kill is acceptable for a desktop app — crash-safe flush on window close handles the common case.

**HLC counter note:** `next_ts!()` macro pre-allocates `10 + N*15` timestamps per merge (where N = roadmap item count). Counter advances by hundreds per merge — expected behavior, no functional impact, but can look surprising during debugging.
