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
**Targeting:** Phase 5 onwards (Phases 1–4 + hardening sprint complete)
**Research agents used:** Pattern Recognition, Simplicity Reviewer, Architecture Strategist, Kieran TypeScript, Security Sentinel, Agent-Native Reviewer, Data Migration Expert, Performance Oracle, Race Condition Reviewer, Data Integrity Guardian (11 agents total)

### Critical Findings

1. **Roadmap data pipeline not addressed (CRITICAL).** Phase 5 is missing migration of `openRoadmapView()`, `persistRoadmapChanges()`, and `allSearchableRoadmapItems` in App.tsx — all still read/write ROADMAP.md directly. Without this, the entire migration is broken at the UI layer. Added as Phase 5.16.
2. **`getProjects()` rewrite missing (CRITICAL).** The plan's Phase 2.8 describes the Zustand store migration but never lists concrete implementation steps for switching `loadProjects()` from file-scanning to Tauri commands. Added as Phase 5.17.
3. **Injection content contradicts plan schema.** `injection.rs` lines 28-31 tell agents to include `_schemaVersion`, `_generatedAt`, `_generatedBy` — the plan's `AgentStateJsonInputSchema` strips these. Must resolve before Phase 5.4.
4. **Agent injection has no agent-accessible path.** `inject_agent_guidance` is Tauri-only. Agents on new branches cannot trigger it. Added mitigation to Phase 5.4.
5. **Migration.rs has 2 HIGH issues.** No git commits (leaves dirty state) and field-level verification is non-blocking (plan says it should block). Added as Pre-Phase 5 prerequisites.

### Already Completed (skip during build)

- **5.5** Auto-commit + store updates — already done in hardening sprint
- **5.9** Lifecycle prompts — `deliverable-lifecycle.ts` already references state.json
- **5.11** Old TypeScript watcher — already deleted

### Simplification Recommendations Applied

- **5.15** Settings Dialog sync UI → deferred to Phase 6 (not needed for core alignment)
- **6.6** `_syncFailedOnClose` flag → removed (unnecessary complexity)
- **7.1** Per-project + global log files → single `~/.clawchestra/app.log`
- **7.3** Validation rejection history viewer → badge-only (click shows last rejection)

### Recommended Execution Order (from Kieran TypeScript + Data Integrity reviews)

```
Group 1 (constants, no deps):     5.1, 5.5✓, 5.13
Group 2 (file references):        5.6, 5.8, 5.3, 5.19 (dual-filename warning)
Group 3 (components + data):      5.2, 5.7, 5.16 (roadmap pipeline), 5.17 (loadProjects), 5.18 (useProjectModal)
Group 4 (agent guidance):         5.4, 5.9✓, 5.10
Group 5 (cleanup + verification): 5.11✓, 5.12 (AFTER all Group 3 consumers redirected), 5.14
```

**Atomic cutover strategy (from Data Integrity Finding 1 — CRITICAL):**
All write operations across 5.7, 5.16, 5.17, 5.18 must check a per-project `stateJsonMigrated` flag:
- `true` → Tauri command path (state.json)
- `false` → existing `writeRoadmap()` path (ROADMAP.md)
This prevents partial cutover and data divergence during transition.

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
Agents write plain JSON without timestamps. Clawchestra sets `updatedAt` on each changed field during the validate-merge cycle. This keeps the agent-facing schema simple and timestamps accurate (reflect when Clawchestra processed the change). Timestamps use hybrid logical clocks (HLC): `max(wall_clock, last_seen_timestamp) + 1`. This guarantees monotonicity within each device and across sync boundaries, preventing clock-skew-induced data loss between devices with unsynchronized clocks. On ties: the client with the lexicographically higher `client_uuid` wins. Arbitrary but deterministic and consistent across all devices — no additional state tracking required.

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

Establish the migration function pattern now:
```typescript
const schemaMigrations: Record<number, (doc: unknown) => unknown> = {
  // 1 -> 2: add example field
  // 2: (doc) => ({ ...doc, newField: defaultValue, _schemaVersion: 2 }),
};
```

Pre-schema-migration safety: before running any schema migration function, back up the current state to `.clawchestra/backup/pre-schema-v{from}-{timestamp}.json`. This provides a rollback point specific to each schema upgrade. If a migration function ships with a bug, the backup enables recovery even after the version number has been bumped.

Settings > Advanced: add a "Force re-migrate" command that re-runs all migration functions from `_schemaVersion: 1`. Nuclear option for recovery from migration bugs.

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
          "completedAt": null,
          "completedAt__updatedAt": 1708531200000
        }
      }
    }
  },
  "clients": {
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890": {
      "hostname": "pierces-macbook",
      "platform": "darwin",
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
- `clients` map tracks known devices for the OpenClaw system prompt
- Expected size: ~20KB for 10 projects with 10 items each, ~200KB for 50 projects (per spec Section 10)

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
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  completedAt__updatedAt: z.number().optional(),
});

export const DbProjectSchema = z.object({
  projectPath: z.string(),
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
└── locking.rs          # flock/LockFile, MutationLockGuard (extracted from lib.rs)
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
2. Load db.json from `~/.openclaw/clawchestra/db.json` into `AppState`
3. Run migrations for all tracked projects (sequentially, per Phase 3)
4. Start file watcher (Phase 2.3)
5. Pull from OpenClaw and merge (Phase 6.6) — if sync enabled
6. Emit `clawchestra-ready` event to frontend
7. Frontend calls `get_all_projects` and renders

The watcher starts AFTER migrations complete to prevent migration writes from triggering merge cycles on a mid-migration DB.

### 2.1 `.clawchestra/` directory management

New Tauri command: `ensure_clawchestra_dir(project_path: String) -> Result<String, String>`
- Creates `.clawchestra/` in project root if it doesn't exist
- Returns the full path to the directory
- Does NOT modify `.gitignore` yet (that's Phase 3)

### 2.2 state.json writer

New Tauri command: `write_state_json(project_path: String, state: StateJson) -> Result<(), String>`
- Acquires flock on `.clawchestra/state.json.lock`
- Serializes `StateJson` to pretty-printed JSON
- Writes atomically (write to `.tmp`, rename)
- Computes and stores SHA-256 of written content (for change detection per D8) — **hash MUST be stored BEFORE releasing flock**, so that if the watcher fires between write and hash storage, the hash is already current and the watcher correctly ignores the self-write
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

### 2.6 Clawchestra-side flock

Implement locking in Rust for Clawchestra's own concurrent access.

The existing codebase uses a **create-new file lock pattern** (`OpenOptions::new().create_new(true)` in `acquire_mutation_lock_at`, lib.rs lines 280–349) with PID+timestamp stale detection. The new state.json lock reuses this proven pattern — NOT `flock()` via `fs2`/`libc`. The create-new pattern is already cross-platform (no `flock()` on Windows) and battle-tested in production.

- Lock file: `.clawchestra/state.json.lock` (same pattern as `catalog-mutation.lock`)
- Stale detection: reuse `stale_after` parameter (default 60s) from existing `acquire_mutation_lock_at`
- Use canonical paths (`fs::canonicalize()`) per institutional learnings
- **Fail-closed**: try → wait 50ms → retry → up to 5 seconds → return error with user-visible message "Another Clawchestra instance is writing. Please try again." (matches existing `acquire_mutation_lock_at` behavior)

### 2.7 State history buffer

Maintain a circular buffer of state snapshots in the DB (per-project). Default size: 20 entries, configurable via `DashboardSettings.stateHistoryBufferSize`. On each merge, store the pre-merge state with metadata:

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

**Memory impact (from performance review):** Each history entry stores a full `StateJson` snapshot. Estimated memory per project: ~100KB (10 items) to ~4MB (500 items) for the full 20-entry buffer. At 50 projects with 30 items each, total buffer memory is ~15MB — acceptable for a desktop app. Log buffer size at startup (`tracing::info!`) for diagnostics. The configurable `stateHistoryBufferSize` in `DashboardSettings` is the escape hatch for memory-constrained machines.

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

## Pre-Phase 5 Prerequisites (from Migration Review)

Before starting Phase 5, resolve these migration.rs gaps discovered during the deepen-plan review. Both are HIGH severity and affect the integrity of the Phase 3 → Phase 5 handoff.

### P5-PRE-1: Add git commit operations to migration.rs

**Issue:** migration.rs performs all filesystem changes (backup, state.json write, .gitignore update, ROADMAP.md deletion, PROJECT.md rename) but never commits them. Every migrated project will have uncommitted changes that confuse git status displays.

**Location:** Not present in `src-tauri/src/migration.rs` — needs adding.

**Fix:** Add git commit calls matching the pattern already used in `injection.rs` (shell out to git via `Command::new("git").args(...)`):
- After gitignore + state.json write: `git commit -m "chore: add .clawchestra to gitignore and create state projection"`
- After ROADMAP.md deletion + rename: `git commit -m "chore: migrate orchestration data to Clawchestra database"`
- Include git stash safety protocol: check `git status --porcelain` for unrelated staged files, stash them first.

### P5-PRE-2: Make field-level verification blocking in migration.rs

**Issue:** At `migration.rs:1030-1035`, field-level mismatches produce warnings but do NOT block deletion. The plan explicitly requires all migrated fields to match before deletion proceeds.

**Fix:** Change the verification logic to return `Err` if any field mismatches exist between backup and DB. The backup is the safety net — if verification fails, keep ROADMAP.md and surface an error: "Migration verification failed for {project}: {mismatched_fields}. Source files retained."

### P5-PRE-3: Resolve injection content contradiction

**Issue:** `injection.rs` lines 28-31 tell agents to include `_schemaVersion`, `_generatedAt`, `_generatedBy` as required fields. The plan's `AgentStateJsonInputSchema` (Phase 1.2) strips these via `.omit()`. These cannot both be correct.

**Fix:** Update `injection.rs` `CLAUDE_MD_SECTION` to remove the "Required envelope fields" paragraph. Agents should NOT include metadata — Clawchestra sets these on ingest. Also remove the `last-rejection.json` reference (line 41) since Phase 7 replaces this with structured logging.

---

## Phase 5: Frontend Alignment & Cleanup

**Goal:** Bring the entire frontend into alignment with the architecture direction. Update all constants, file references, UI components, and flows to use the new data layer (db.json → state.json → CLAWCHESTRA.md). Remove dead code. Wire up missing connections. This is the "sweep" phase (per institutional learnings lesson #3).

**Audit reference:** `docs/plans/architecture-direction-audit.md` — line-by-line catalogue of ~35 updates and ~25 removals.

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
- `DESIGN_PRINCIPLES.md` line 32 still references ROADMAP.md — update during 5.12 sweep.

**Data Integrity findings (CRITICAL):**
- **Dual-write path:** During Phase 5 implementation, kanban drags still write to ROADMAP.md (via `writeRoadmap()` in App.tsx:1128, useProjectModal.ts:158) while agents write to state.json. Both paths active simultaneously = data divergence. **Solution:** Implement a per-project `stateJsonMigrated: boolean` flag in the Zustand store (derived from whether db.json has the project entry). ALL write operations check this flag: `true` → Tauri command to state.json, `false` → existing `writeRoadmap()` path. Naturally transitions per-project as migration completes. Phase 5 cleanup removes the `false` branch after all projects are confirmed migrated.
- **`useProjectModal.ts` not listed in Phase 5:** This hook is a PRIMARY ROADMAP.md read/write consumer (lines 65-108: `readRoadmap()` on every project change; lines 145-161: `writeRoadmap()` on reorder; lines 175-197: `migrateCompletedItem()` cross-file mutation). Added as Phase 5.18.
- **`migrateCompletedItem()` has no new-architecture equivalent:** This function atomically moves an item from ROADMAP.md to CHANGELOG.md. In the new architecture, setting `status: complete` + `completedAt` on the item in state.json IS the equivalent — no cross-file migration needed. But `useProjectModal.updateRoadmapItemStatus` (lines 175-197) must be rewritten BEFORE `changelog.ts` is deleted.
- **Non-atomic project creation:** Phase 5.3 adds 4 steps (mkdir, write state.json, append .gitignore, register in db.json). If Tauri IPC fails between file creation and db.json registration, state is inconsistent. **Solution:** Either register in db.json FIRST (compensating command on file failure) or create a single `create_project_with_state` Tauri command that does all 4 operations atomically on the Rust side.
- **`updateProjectFromEvent` discards roadmap items:** store.ts lines 586-618 — the handler updates project-level fields but NOT `roadmapItems` data. Agent changes to items are merged into the Rust DB but never reach the frontend until full reload. Must be fixed in Phase 5.17.

**Data Migration edge cases for Phase 5:**
- Projects without ROADMAP.md skip migration and get status `Complete` but NO state.json (`migration.rs:172-173`). Phase 5.3/5.17 must handle missing state.json gracefully.
- `run_all_migrations` (`lib.rs:1684-1698`) only processes projects already in db.json — projects discovered by `scan_projects` but not yet registered will be missed. The startup sequence needs: scan → register → migrate.
- Migration history entries use `changed_fields: vec!["*"]` — Phase 7.3 UI must handle the wildcard.

### 5.1 Update constants (Rust + TypeScript)

**Already done in hardening sprint:**
- `METADATA_FILES` in `src-tauri/src/commands/git.rs`: `["CLAWCHESTRA.md", "PROJECT.md"]` ✓
- `DOCUMENT_FILES` in `src-tauri/src/commands/git.rs`: `[]` ✓
- `METADATA_FILES` in `src/lib/git-sync-utils.ts`: `['CLAWCHESTRA.md', 'PROJECT.md']` ✓
- `DOCUMENT_FILES` in `src/lib/git-sync-utils.ts`: `[]` ✓

**Remaining (lib.rs):**
- `METADATA_FILES` in `src-tauri/src/lib.rs` line 1444: verify matches git.rs constants
- `DOCUMENT_FILES` in `src-tauri/src/lib.rs` line 1447: verify matches git.rs constants

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

**Labels to update:**
- Line 263: "Create ROADMAP.md" → remove
- Line 364: "PROJECT.md:" → "CLAWCHESTRA.md:"
- Line 365: "ROADMAP.md:" → remove
- Line 418: "Create PROJECT.md if missing" → "Create CLAWCHESTRA.md"
- Line 436: "Create ROADMAP.md when missing" → remove

### 5.3 Project creation flow (`src/lib/project-flows.ts`)

`createNewProjectFlow` creates the wrong files:

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
4. Register project in db.json

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

> **Status:** Done in hardening sprint. Verify only — no implementation needed.

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

### 5.7 App.tsx auto-commit references

- Line 1081: `'No ROADMAP.md found for ...'` → remove (dead code)
- Line 1138: `autoCommitIfLocalOnly(..., ['ROADMAP.md'], ...)` → remove
- Line 1140: `withOptimisticDirtyFile(..., 'ROADMAP.md', 'documents')` → remove
- Line 1231: `autoCommitIfLocalOnly(..., ['PROJECT.md'], ...)` → `['CLAWCHESTRA.md']`
- Line 1245: `withOptimisticDirtyFile(..., 'PROJECT.md', 'metadata')` → `'CLAWCHESTRA.md'`

### 5.8 Template updates (`src/lib/templates.ts`)

- Line 32: `readTemplate('docs/templates/PROJECT.md')` → `CLAWCHESTRA.md` template
- Line 36: `readTemplate('docs/templates/ROADMAP.md')` → remove
- Line 44: `writeIfMissing(..., projectTemplate)` for `PROJECT.md` → `CLAWCHESTRA.md`
- Line 45: `writeIfMissing(resolvedRepoPath + '/ROADMAP.md', ...)` → remove

Create or update `docs/templates/CLAWCHESTRA.md` template (human-readable, no YAML frontmatter, per D5 document format rules).

### 5.9 Update lifecycle prompts ✅ ALREADY COMPLETE

> **Status:** `deliverable-lifecycle.ts` already references `.clawchestra/state.json` in all five lifecycle action prompts (spec, plan, review, deliver, build). Verify only.

In `src/lib/deliverable-lifecycle.ts`:
- Replace all "update ROADMAP.md" references with "update .clawchestra/state.json"
- Replace all "read PROJECT.md" references with "read .clawchestra/state.json"
- Update prompt templates to reference the new schema

### 5.10 Update AGENTS.md compliance block

In `AGENTS.md` (the Clawchestra project's own AGENTS.md):
- File Structure section: add `.clawchestra/state.json` entry
- Remove `ROADMAP.md` and `CHANGELOG.md` references (post-migration)
- Update Roadmap Item YAML Shape to reference state.json JSON shape instead

**Additional scope (from agent-native review):**
- Rewrite "Adding Projects" section (lines 296-309) — currently describes catalog `.md` file creation, must describe state.json + db.json registration
- Rewrite "Projects (Top-Level Board)" operations table — currently references a fundamentally different data model
- Fix "Rule Zero" (line 84) — still says "Pipeline Dashboard", must say "Clawchestra"
- Add "Registering an Existing Project" section documenting agent steps (create `.clawchestra/`, write state.json, update `.gitignore`)
- Add Clawchestra Integration section template that agents can self-inject on branches where `inject_agent_guidance` hasn't run

### 5.11 Remove old TypeScript watcher ✅ ALREADY COMPLETE

> **Status:** `src/lib/watcher.ts` already deleted in hardening sprint. Verify no stale imports remain.

Delete `src/lib/watcher.ts` (replaced by unified Rust watcher in Phase 2). Update all imports.

### 5.12 Dead code sweep

```bash
npx tsc --noEmit      # Catch type errors from removals
cargo clippy -- -W dead_code  # Catch unused Rust functions
```

**ORDERING CONSTRAINT (from data integrity review):** Do NOT delete `roadmap.ts` or `changelog.ts` until ALL consumers are redirected (5.7, 5.16, 5.18) AND `npx tsc --noEmit` confirms zero imports remain.

Specific targets:
- `src/lib/roadmap.ts` — `readRoadmap()`, `writeRoadmap()` become dead code. **Before deletion:** move `resolveDocFiles()` and `enrichItemsWithDocs()` to `src/lib/doc-resolution.ts` — these resolve spec/plan doc file paths and are storage-format-independent.
- `src/lib/changelog.ts` — entire module dead post-migration. `migrateCompletedItem()` must be replaced in useProjectModal FIRST (5.18) — in new architecture, completion is a status change, not a cross-file move.
- `src/lib/auto-commit.ts` — kanban-drag trigger code path
- `lib.rs` — any functions only called for ROADMAP.md/CHANGELOG.md parsing

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
4. **Keep `resolveDocFiles()` and `enrichItemsWithDocs()`:** These resolve spec/plan doc file paths — independent of storage format. Move to `src/lib/doc-resolution.ts` before deleting `roadmap.ts` in Phase 5.12.

**Atomic cutover (from Data Integrity Finding 1):**
All write operations in useProjectModal must check `stateJsonMigrated` flag per project:
- `true` → Tauri command path (state.json)
- `false` → existing `writeRoadmap()` path (ROADMAP.md)

This prevents partial cutover during the transition period.

### 5.19 Dual-filename warning (NEW — from data integrity review)

If BOTH `CLAWCHESTRA.md` AND `PROJECT.md` exist in the same project directory, surface a warning:
- In `checkExistingProjectCompatibility` (project-flows.ts line 134): check for CLAWCHESTRA.md FIRST, fall back to PROJECT.md. If both exist, include a warning: "Both CLAWCHESTRA.md and PROJECT.md found. CLAWCHESTRA.md takes precedence. Delete PROJECT.md to resolve."
- In `getProjects` (projects.ts): log warning if both exist during scan.
- Do NOT create PROJECT.md if CLAWCHESTRA.md already exists (currently, `addExistingProjectFlow` line 172-177 would create PROJECT.md even when CLAWCHESTRA.md exists).

### 5.15 Settings Dialog sync UI → DEFERRED TO PHASE 6

> **Simplification:** Per simplicity review, sync UI is not needed for core frontend alignment. Defer to Phase 6 where it belongs alongside sync implementation. Phase 5 should focus on the data pipeline migration.

### 5.16 Roadmap data pipeline migration (NEW — CRITICAL)

> **Source:** Architecture Strategist + Pattern Recognition agents. This was the single most critical gap in the original plan.

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

**Note:** Roadmap data currently lives in App.tsx local React state, NOT in the Zustand store. The migration must either: (a) move roadmap data into Zustand alongside project data, or (b) keep it in local state but source it from the Tauri backend instead of ROADMAP.md. Option (a) is preferred — it enables event-driven updates via `state-json-merged`.

### 5.17 `loadProjects()` → event-driven updates (NEW — CRITICAL)

> **Source:** Architecture Strategist + Pattern Recognition agents.

`loadProjects()` is called from 18+ locations across the codebase. It's a full-reload anti-pattern that re-scans the filesystem every time. Post-migration, project data comes from db.json via Tauri commands.

**Implementation:**
1. `loadProjects()` switches to calling `get_all_projects` Tauri command (returns typed data from in-memory db.json)
2. Generalize `updateProjectFromEvent()` pattern (already exists in store) for all project mutations
3. Subscribe to `state-json-merged` and `clawchestra-ready` Tauri events using the `setupTauriEventListeners` pattern in `tauri-events.ts`
4. Reduce `loadProjects()` call sites — most should be replaced with event listeners that call `updateProjectFromEvent()` for targeted updates instead of full reloads
5. Keep `loadProjects()` as a "nuclear refresh" called only on initial load and manual refresh button click

**`performSyncOnLaunch` / `performSyncOnClose` wiring:**
These functions exist in sync.rs but have NO frontend wiring. Wire them:
- `performSyncOnLaunch`: call after `clawchestra-ready` event if sync mode is not Disabled
- `performSyncOnClose`: call in the Tauri `on_window_event` handler for `CloseRequested`

**Race condition fixes (from race condition review):**

**RACE 1 — `clawchestra-ready` fires before frontend subscribes (MEDIUM):**
The Rust side uses a 100ms `tokio::time::sleep` before emitting `clawchestra-ready`. The frontend subscribes via `setupTauriEventListeners` inside an async `useEffect`. On cold launches or slow machines, 100ms may not be enough. **Fix:** Replace the timer with a request-response pattern. Frontend calls `signal_frontend_ready` Tauri command once listeners are attached. Backend emits `clawchestra-ready` in response. Alternatively (simpler): keep `loadProjects()` on mount unconditionally and treat `clawchestra-ready` as advisory (sync status only, not data trigger).

**RACE 4 — `loadProjects()` called instead of `updateProjectFromEvent` (MEDIUM):**
The `state-json-merged` event handler calls `void loadProjects()` (full rescan) instead of the purpose-built `updateProjectFromEvent()`. Two agent writes 200ms apart trigger two overlapping `loadProjects()` calls — the first can overwrite the second's results, causing UI flicker. **Fix:** Use `updateProjectFromEvent()` (already exists in store.ts line 586) for `state-json-merged` events. Reserve `loadProjects()` for initial mount and manual refresh only.

**RACE 6 — Kanban drag on unmigrated project (MEDIUM):**
If Phase 5 code deploys and migration hasn't completed for all projects, a drag on an unmigrated project hits the new code path expecting state.json which doesn't exist yet. The drag appears to succeed (optimistic update) but persistence fails. **Fix:** Check migration state before the drag write. If project is not `Complete` in migration state, either refuse with a toast ("Migrating project data, please wait") or fall back to the old write path. (See also: the `stateJsonMigrated` flag from Data Integrity Finding 1 — same mechanism.)

**DATA INTEGRITY — Push history before write (MEDIUM, from data integrity review):**
The merge logic pushes a history entry AFTER the merge completes (merge.rs line 396). If a UI drag writes state.json and an agent's stale write arrives in the same 100ms debounce window, the stale detection has no UI history entry to compare against. **Fix:** UI-initiated writes via Tauri commands must push a history entry with `source: Ui` BEFORE writing state.json, so stale detection has a reference point.

### Verification gate

- `npx tsc --noEmit` clean
- `cargo clippy` clean (no dead code warnings)
- `bun test` — all tests pass with updated fixtures
- `pnpm build` success
- `npx tauri build --no-bundle` success (full release build)
- Manual test: Add a new project → verify CLAWCHESTRA.md created (not PROJECT.md), `.clawchestra/` created, state.json projected, injection triggered
- Manual test: Add an existing project → verify compatibility check scans CLAWCHESTRA.md, migration prompted if needed

---

## Phase 6: OpenClaw Data Endpoint & Sync

**Goal:** Create the OpenClaw plugin extension, implement client identity, and build sync triggers. Combines v1 Phases 7+8 — they are small and tightly coupled.

**Now includes:** Settings Dialog sync UI (deferred from Phase 5.15) and extension auto-install (from cloud-agent-sync spec).

### Research Insights (Phase 6)

**Security Sentinel findings (2 CRITICAL, 3 HIGH):**

1. **CRITICAL: `fs.mkdir` creates arbitrary directories.** The extension's `fs.mkdir(path.dirname(resolved), { recursive: true })` on PUT allows attackers to create directories anywhere under `DATA_ROOT`. Combined with a crafted path, this could write files outside the expected location. **Fix:** Restrict PUT to known filenames only (allowlist: `db.json`, `settings.json`). Reject any path that resolves to a non-allowlisted filename.

2. **CRITICAL: Full-document PUT allows cross-project tampering.** Any client with a valid bearer token can modify ANY project's data via PUT. A compromised agent token could tamper with all projects. **Fix:** For v1, this is acceptable (single-user product, bearer token is the trust boundary). Document as a known limitation. For multi-user: add project-scoped tokens.

3. **HIGH: Symlink bypass.** `path.resolve()` follows symlinks. If an attacker creates a symlink inside `DATA_ROOT` pointing outside, the path traversal check passes but the write targets an arbitrary location. **Fix:** After `path.resolve()`, call `fs.realpath()` and verify the result is still under `DATA_ROOT`.

4. **HIGH: Bearer token in git history.** The CLAUDE.md injection includes the bearer token. Once committed, it lives in git history forever. **Fix:** For private repos, this is acceptable (standard practice, same as `.env` files). For public repos, the plan already uses a placeholder. Add to injection logic: check if repo is public before injecting token.

5. **HIGH: Fail-open auth.** If `settings.json` is missing or unreadable, the catch block returns `'{}'` — no `bearerToken` → auth check is skipped → endpoint is open. **Fix:** Fail-closed: if settings.json is unreadable, return 500, not open access.

**Agent-Native findings for Phase 6:**
- `performSyncOnLaunch` / `performSyncOnClose` wiring belongs here (moved from Phase 5.17)
- Settings Dialog sync UI (deferred from Phase 5.15) should be implemented alongside sync wiring

### 6.1 Extension file content

Generate `~/.openclaw/extensions/clawchestra-data-endpoint.ts`:

```typescript
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
      const settings = JSON.parse(
        await fs.readFile(path.join(DATA_ROOT, 'settings.json'), 'utf-8').catch(() => '{}')
      );
      // Fail-closed auth (security finding: fail-open if settings.json missing)
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
        const body = JSON.stringify(req.body);
        if (body.length > MAX_BODY_SIZE) {
          return res.status(413).json({ error: 'Payload too large' });
        }
        // Security: verify resolved path after realpath (symlink bypass prevention)
        const realResolved = await fs.realpath(path.dirname(resolved)).catch(() => null);
        const realDataRoot = await fs.realpath(DATA_ROOT).catch(() => DATA_ROOT);
        if (!realResolved || !realResolved.startsWith(realDataRoot)) {
          return res.status(403).json({ error: 'Path traversal blocked' });
        }
        await fs.mkdir(path.dirname(resolved), { recursive: true });
        await fs.writeFile(resolved, JSON.stringify(req.body, null, 2));
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
- **Extension versioning:** embed a `const EXTENSION_VERSION = '1.0.0';` at the top of the extension file. On every app launch, read the installed extension's version. If stale (older than current Clawchestra's expected version), surface an update prompt: "Your OpenClaw extension is outdated. Update now?" Auto-update for local installs; manual instructions for remote.
- **Auto-detection on launch:** on app launch, auto-detect if extension is missing or version-stale. Auto-install for local OpenClaw. Show a one-time "OpenClaw extension installed/updated" toast. Settings page shows current extension version + "Update" button.
- **Module system:** the extension uses `require()` (CJS). Verify that OpenClaw's extension system uses CJS before shipping. If OpenClaw uses ESM, switch to `import()` syntax. Document this dependency in the extension file header.
- For local OpenClaw: direct filesystem write
- For remote OpenClaw: manual installation documented in 3 steps (v2 removes the "AI self-setup" flow — too fragile for a product)
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

### 6.6 Sync triggers

Implement in `src/lib/sync.ts`:

**On launch:**
1. Read local DB
2. If sync mode is `Local`: read `~/.openclaw/clawchestra/db.json`
3. If sync mode is `Remote`: GET `{remote_url}/clawchestra/data/db.json` (with bearer token). On read failure from remote: do NOT merge — keep local state, surface warning: "Remote sync data could not be read. Using local data only."
4. Merge: for each field, keep the one with the newer HLC timestamp (per D3). On ties: lexicographic `client_uuid` comparison.
5. Update `_hlcCounter` to `max(local_counter, remote_counter) + 1`
6. Write merged result to both local DB and remote
7. **Clock skew detection:** compare `Date.now()` between local and remote. If difference exceeds 5 seconds, surface a non-blocking warning: "Clock difference detected between devices. Sync results may be unexpected."

**On close:**

**RACE 2 — Watcher shutdown required (HIGH, from race condition review):**
The watcher thread (`watcher.rs` line 128) runs in a `loop {}` with no shutdown signal. It can spawn `handle_state_json_change` tasks that contend for the mutex during shutdown, causing the 3s timeout to be consumed by merge tasks instead of sync. **The plan asks for drain, the code does not implement it.**

**Fix — add watcher shutdown signal:**
1. Add `Arc<AtomicBool>` shutdown flag to the watcher. Check it at the top of each event loop iteration.
2. Add an in-flight task counter (`Arc<AtomicUsize>` incremented on task spawn, decremented on completion, with `Notify` when it hits zero).
3. Before the on-close handler begins:
   a. Set the watcher shutdown flag (`shutdown.store(true, Ordering::SeqCst)`)
   b. Wait for in-flight counter to reach zero (with 1s sub-timeout)
   c. Only then proceed to flush and sync

**On-close sequence (with watcher drain):**
1. **Stop watcher** — set shutdown flag, wait for in-flight tasks to complete (1s sub-timeout)
2. **Flush** — `flush_if_dirty(&state)` — acquires mutex, serializes, writes to disk
3. **Sync** — write to OpenClaw location (local filesystem or HTTP)
4. 3-second total timeout — do NOT block app shutdown. For local sync, flush completes in <10ms. For remote sync over LAN, 200-500ms. 3s provides adequate headroom.
5. If sync fails: log warning, close anyway — data safe in local DB, will sync on next launch automatically.

Deferred to v2 of the product (not this plan):
- Continuous sync (debounced 2-second trigger on every state change)
- Sync status indicator UI in the header
- Offline queue with reconnect retry

**Known limitation:** without continuous sync, db.json on OpenClaw can be stale for the duration of a session. If a user asks OpenClaw "what's my roadmap status?" mid-session, OpenClaw reads stale data. The OpenClaw system prompt (6.5) should include: "Note: Data reflects the last time Clawchestra synced. For real-time status, check the Clawchestra app directly."

**Simplification (from simplicity review):** Remove `_syncFailedOnClose` flag. If on-close sync fails, data is safe in local db.json and will sync on next launch automatically. The flag adds complexity for a recovery path that already works without it.

### 6.7 Settings Dialog sync UI (moved from Phase 5.15)

`SettingsDialog` needs sync configuration (belongs alongside sync implementation, not in Phase 5):
- Add sync mode selector (Local / Remote / Disabled)
- Add remote URL field (when sync mode is Remote)
- Bearer token is now managed via OS keychain (show "Token: configured" / "Token: not set")
- Show client UUID (read-only, copyable) in Advanced section
- "Rotate bearer token" button in Advanced section (generate new UUID v4, store in keychain, re-inject)
- Extension version display + "Update" button (from cloud-agent-sync spec)

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
9. App closes → final sync fires → app shuts down within 3s
10. Corrupt state.json → last-known-good restored → warning shown
11. Schema version too high → user-visible error, no processing

Final dead-code sweep:
```bash
cargo clippy -- -W dead_code
npx tsc --noEmit
```
Grep for any remaining references to ROADMAP.md/CHANGELOG.md in source code (not docs/specs).

---

## Phase 7: Structured Logging & Error Reporting

**Goal:** Consolidate fragmented logging into a single structured log system. Provide user-facing debug export for support.

### Research Insights (Phase 7)

**Simplification recommendations applied:**
- Single log file (`~/.clawchestra/app.log`) instead of per-project + global. Per-project logs add complexity without proportional debugging value — the global log already includes project IDs in each entry.
- Validation rejection history viewer → simplified to badge-only with click-to-expand showing the last rejection. No scrollable history list — that's over-engineering for a rare event.

**Data migration edge case:**
- Migration history entries use `changed_fields: vec!["*"]` (wildcard). The validation UI must handle this — display as "Full import — all fields" rather than trying to parse it as a dot-path.

### 7.1 Structured logging (Rust)

Attach the `tracing` subscriber (crate introduced in Phase 1.6, used throughout Phases 2–6):
- JSON-structured log entries: `{ timestamp, level, event_type, details }`
- Categories already defined in Phase 1.6: `migration`, `validation`, `sync`, `watcher`, `injection`
- **Single log file:** `~/.clawchestra/app.log` (all events, includes `project_id` field for filtering)
- Log rotation: cap at 1MB, rotate to `.log.1`

### 7.2 User-facing debug export

Settings > Advanced > "Copy debug info":
- Migration state (derived) for all projects
- Last 20 validation results
- Last 10 sync events
- Last 10 file watcher events
- App version, OS, client UUID
- Copies to clipboard as formatted text

### 7.3 Validation status in UI

When partial-apply rejects fields:
- Small warning badge on the project card: "1 agent write was partially rejected"
- Click to expand: shows which fields were rejected and why (last rejection only — no scrollable history list)
- Badge persists until user dismisses it (do NOT auto-dismiss on next successful write)
- **Agent feedback file:** Write validation rejections to `.clawchestra/last-rejection.json` so agents can detect their writes were partially rejected. Format: `{ "timestamp": ..., "rejectedFields": [...], "reasons": [...] }`. This gives agents a detection + retry path without relying on UI notifications. (Note: the existing reference in `injection.rs` line 41 already points to this file — keep it aligned.)

### Verification gate

- `tracing` integrated and producing JSON output
- Debug export produces useful output
- Validation status renders correctly
- All previous tests still pass

---

## Dependencies Between Phases

```
Phases 1–4 ✅ COMPLETE (+ 17-fix hardening sprint)
     │
     ├── P5-PRE (Prerequisites: git commits in migration, verification blocking, injection fix)
     │        │
     │        └── Phase 5 (Frontend Alignment + 5.16/5.17 critical additions)
     │                 │
     │                 └── Phase 6 (OpenClaw + Sync + Settings UI from 5.15)
     │                          │
     │                          └── Phase 7 (Logging & Error Reporting)
```

**Phase 5 internal dependencies:**
- Groups 1-2 (constants, file references) have no internal dependencies — can start immediately after P5-PRE
- Group 3 (components: 5.2, 5.7, 5.16, 5.17) depends on Groups 1-2
- Group 4 (agent guidance: 5.4, 5.10) depends on Group 3 (needs to know final data model)
- Group 5 (cleanup: 5.12, 5.14) depends on all previous groups

**IMPORTANT constraint (from agent-native review):** ROADMAP.md deletion (Phase 3.4 step 4) must NOT proceed on any branch until injection (Phase 4) has completed for that branch. The plan previously allowed Phases 3 and 4 to run in parallel — this is still true for most steps, but the deletion substep is now gated on injection completion for that specific branch.

Phase 7 (logging finalization) depends on Phase 6, but the `tracing` crate is introduced in Phase 1.6 and used throughout all subsequent phases — Phase 7 only adds the subscriber, log rotation, and debug export UI.

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Migration data loss | Low | Critical | Per-project transactional migration; pre-migration backup for all projects; verify before delete; P5-PRE-2 makes verification blocking |
| Agent writes invalid JSON | Medium | Low | Graceful parse failure; partial-apply; revert to last-known-good from state history buffer |
| Agent ignores new guidance (old branch) | Medium | Low | Creates phantom ROADMAP.md; Clawchestra ignores it; auto-commit updated to not commit it. **Risk:** silent failure window between ROADMAP.md deletion and injection — agent writes to ROADMAP.md with no error signal. Mitigate: constrain deletion to post-injection per branch. |
| OpenClaw extension breaks after update | Low | Medium | Extension is simple; version-pinned; test on launch; bearer token auth |
| File watcher misses changes | Very Low | Medium | FSEvents/inotify are kernel-level; manual refresh button as cheap fallback |
| Sync conflict loses data | Low | Medium | Per-field timestamps with millisecond precision; fail-open to "show both"; no silent overwrites |
| Two Clawchestra instances race | Low | Medium | Flock (fail-closed); single-instance recommendation in docs |
| Schema version mismatch | Low | Medium | Forward-compat check; clear user-facing error; migration functions for upgrades |
| Clock skew between devices | Medium | Medium | Hybrid logical clocks (D3); clock skew detection warning on sync; deterministic UUID tiebreaker |
| Stale agent write reverts recent changes | Medium | Medium | Stale write detection via state history buffer comparison (2.5); "read before write" guidance in CLAUDE.md |
| Windows watcher misses events | Low | Low | Manual refresh button; on-launch integrity check; `ReadDirectoryChangesW` limitations documented |
| Schema migration ships with bug | Low | High | Pre-migration backup; force re-migrate command; migration manifest for audit trail |
| **NEW: Extension fail-open auth** | Medium | High | If settings.json missing, extension was open. **Fixed:** fail-closed auth in 6.1 (return 500 if no bearer token configured) |
| **NEW: Symlink bypass in extension** | Low | High | `path.resolve()` follows symlinks. **Fixed:** add `fs.realpath()` check after resolve in 6.1 |
| **NEW: Agent cannot trigger injection** | High | Medium | Agents on new/un-injected branches have no state.json guidance. **Fixed:** scripts/inject-current-branch.sh + AGENTS.md template (5.4) |
| **NEW: Roadmap data pipeline not migrated** | — | Critical | `openRoadmapView()`, `persistRoadmapChanges()`, `allSearchableRoadmapItems` still read/write ROADMAP.md. **Fixed:** added 5.16 |
| **NEW: Migration leaves dirty git state** | High | Medium | migration.rs has no git commits. **Fixed:** P5-PRE-1 adds git commit operations |
| **NEW: Watcher contends with on-close handler** | High | Medium | No watcher shutdown signal — watcher tasks consume the 3s timeout budget. **Fixed:** add `AtomicBool` shutdown + in-flight counter in 6.6 |
| **NEW: `clawchestra-ready` fires before listeners** | Medium | Medium | 100ms timer is a hope. **Fixed:** replace with request-response pattern or keep `loadProjects()` unconditional (5.17) |
| **NEW: Overlapping `loadProjects()` from events** | Medium | Low | `state-json-merged` triggers full rescan instead of surgical update. **Fixed:** use `updateProjectFromEvent()` (5.17) |
| **NEW: Dual-write path during transition** | High | Critical | ROADMAP.md and state.json writes active simultaneously during Phase 5. **Fixed:** per-project `stateJsonMigrated` flag gates all writes (Enhancement Summary) |
| **NEW: useProjectModal.ts not in Phase 5** | — | High | Primary ROADMAP.md consumer not listed. **Fixed:** added 5.18 |
| **NEW: Non-atomic project creation** | Medium | High | IPC boundary between file creation and db.json registration. **Fixed:** single `create_project_with_state` Tauri command (5.3) |
| **NEW: Drag loss in debounce window** | Low | Medium | Stale agent write can revert UI drag if history entry not yet pushed. **Fixed:** push history with `source: Ui` before write (5.17) |

---

## Files Modified (estimated)

| Category | Files | Change Type |
|----------|-------|-------------|
| **New modules** | `src/lib/state-json.ts`, `src/lib/sync.ts`, `src/lib/db-json.ts` | Create |
| **New Rust modules** | `src-tauri/src/state.rs`, `src-tauri/src/migration.rs`, `src-tauri/src/watcher.rs` | Create |
| **Rust backend** | `src-tauri/src/lib.rs` | Moderate (delegate to new modules, settings) |
| **Rust migration fix** | `src-tauri/src/migration.rs` | P5-PRE: add git commits, blocking verification |
| **Rust injection fix** | `src-tauri/src/injection.rs` | P5-PRE: fix metadata contradiction, remove last-rejection ref |
| **Schema/types** | `src/lib/schema.ts`, `src/lib/settings.ts`, `src/lib/tauri.ts` | Moderate |
| **State management** | `src/lib/store.ts`, `src/lib/projects.ts` | Significant (5.17: event-driven updates) |
| **App core** | `src/App.tsx` | **Significant** (5.16: roadmap data pipeline migration — openRoadmapView, persistRoadmapChanges, allSearchableRoadmapItems) |
| **Removed** | `src/lib/watcher.ts` | Already deleted ✅ |
| **Removed/reduced** | `src/lib/roadmap.ts`, `src/lib/changelog.ts`, `src/lib/auto-commit.ts` | Partial removal |
| **Hooks** | `src/hooks/useProjectModal.ts` | **Significant** (5.18: full ROADMAP.md read/write rewrite) |
| **New module** | `src/lib/doc-resolution.ts` | Create (extracted from roadmap.ts: resolveDocFiles, enrichItemsWithDocs) |
| **Components** | `src/components/Header.tsx`, `src/components/AddProjectDialog.tsx` | Moderate |
| **Git sync** | `src/lib/git-sync-utils.ts` | Moderate (constants) |
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
- state.json changes appear in Clawchestra UI within 200ms
- All existing projects migrated with zero data loss
- Pre-migration backups exist for all migrated projects
- CLAUDE.md on all branches points to state.json
- db.json syncs to OpenClaw filesystem within 2 seconds of change
- Content-hash change detection correctly distinguishes own vs external writes
- Partial-apply correctly accepts valid fields and rejects invalid ones
- Schema version mismatch produces clear user-facing error
- Clean release build passes
- All existing tests pass (with updated fixtures)
- Validation rejections visible in UI with rejection history
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

---

## Performance Profile (from Performance Oracle review)

Architecture scales linearly with project count. Single `Arc<tokio::sync::Mutex<AppState>>` is the contention point but merge times are sub-5ms per project.

| Metric | 10 Projects | 50 Projects | 100 Projects |
|--------|-------------|-------------|--------------|
| Startup load (`get_all_projects`) | <5ms | <20ms | <50ms |
| History buffer memory | ~1 MB | ~15 MB | ~30 MB |
| db.json file size | ~20 KB | ~200 KB | ~400 KB |
| db.json flush time | <1ms | <5ms | <10ms |
| Merge cycle per project | <5ms | <5ms | <5ms |
| Mutex contention (serial merge) | <10ms | <50ms | <100ms |

**No performance changes needed.** All debounce intervals (100ms watcher, 200ms state.json write, 500ms db.json persistence) are appropriate. The 200ms state.json write does NOT affect UI responsiveness — UI updates are immediate via the in-memory DB; the 200ms only affects on-disk state visible to agents. The 500ms db.json data-loss window on process kill is acceptable for a desktop app — crash-safe flush on window close handles the common case.

**HLC counter note:** `next_ts!()` macro pre-allocates `10 + N*15` timestamps per merge (where N = roadmap item count). Counter advances by hundreds per merge — expected behavior, no functional impact, but can look surprising during debugging.
