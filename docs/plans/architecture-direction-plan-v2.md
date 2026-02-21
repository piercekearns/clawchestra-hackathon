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

---

## Changes from v1

| Area | v1 | v2 | Rationale |
|------|----|----|-----------|
| Phases | 9 | 7 | Merge Phase 3 (Rename) into Phase 4 (Migration); fold Phase 9 (Integration Testing) into Phase 7 verification gate |
| Migration state machine | 7-state enum persisted in DB | Derived state from filesystem | Same recoverability, zero persistence overhead |
| TypeScript types | Mentioned but undefined | Concrete Zod schemas as source of truth | Runtime validation non-negotiable for untrusted agent input |
| Change detection | Write-flag to distinguish own vs external writes | Content-hash (SHA-256) comparison | Write-flag races under FSEvents coalescing (~75ms) |
| Lock behavior | Fail-open after 100ms | Fail-closed with user-visible error | Fail-open loses data |
| Stale lock detection | PID + timestamp in lock file | Removed — flock auto-releases on process death | Over-engineering for advisory locks |
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

---

## Critical Design Decisions (resolved from spec gaps)

**D1: Agent file locking is unenforceable — use merge-on-change instead.**
Agents (Claude Code, Cursor) write files via their tool infrastructure, which does not call `flock()`. True mutual exclusion between Clawchestra and agents is impossible. Instead: Clawchestra watches state.json for external changes, reads the full file, validates, and merges into the DB. The "lock" is Clawchestra's atomic read-validate-merge cycle, not a filesystem lock. Clawchestra still uses `flock()` internally (for its own writes and potential multi-instance races), but does not depend on agents cooperating.

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
export const DbTimestampedField = <T extends z.ZodType>(valueSchema: T) =>
  z.object({ value: valueSchema, updatedAt: z.number() });

export const DbProjectSchema = z.object({
  projectPath: z.string(),
  project: z.record(z.unknown()), // per-field timestamps make this a flat record
  roadmapItems: z.record(z.record(z.unknown())),
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
  completedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
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

// For agent-written input (metadata fields stripped, partial allowed)
export const AgentStateJsonInputSchema = StateJsonDocumentSchema.omit({
  _generatedAt: true,
  _generatedBy: true,
}).partial({
  _schemaVersion: true,
});

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

Add a new `src-tauri/src/state.rs` module (lib.rs already exceeds 25K tokens — must split):

- `StateJson` struct with serde derive
- `GlobalDb` struct with per-field timestamp maps
- `MigrationStep` — not persisted, derived from filesystem checks
- `StateJsonValidationError` enum — exhaustive, wired end-to-end to TypeScript
- Branded newtypes: `struct ProjectId(String)`, `struct ProjectPath(PathBuf)`

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

**Persistence:** `db.json` is written to `~/.openclaw/clawchestra/db.json` on every DB mutation (debounced at 500ms) and on app close. Uses atomic write (write to `.tmp`, rename) — same pattern as state.json.

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

Frontend integration: after any DB write that changes project/roadmap state, call `write_state_json` for affected project(s). Debounce at 200ms for rapid changes (e.g., dragging multiple items).

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

Implement flock in Rust for Clawchestra's own concurrent access:
- `flock()` on Unix (macOS/Linux) — auto-releases on process death, no stale detection needed
- `LockFile` on Windows with timestamp-only stale detection (if lock file timestamp > 60s old, delete and re-acquire — no PID checking)
- Lock file: `.clawchestra/state.json.lock`
- Use canonical paths (`fs::canonicalize()`) per institutional learnings
- **Fail-closed**: try → wait 1ms → retry → up to 5 seconds → return error with user-visible message "Another Clawchestra instance is writing. Please try again." (matches existing `acquire_mutation_lock_at` pattern in lib.rs)

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

When state.json is unreadable (corrupt JSON, partial write): keep last-known-good state in memory, surface a non-blocking warning in the UI, write the last-known-good state back to state.json. Use a "read, wait 50ms, read again, compare" strategy for suspected corrupt files before triggering auto-repair — this prevents overwriting an in-progress agent write.

### 2.8 Zustand store migration

The Zustand store (`src/lib/store.ts`) currently manages all project state via `loadProjects()` which calls `scanProjects()` → parses PROJECT.md + ROADMAP.md from disk → populates `ProjectViewModel[]`.

Post-migration:
- `loadProjects()` switches to calling Tauri command `get_all_projects` which returns typed data from the in-memory DB
- Store actions (`updateProject`, `reorderItem`, etc.) call Tauri commands instead of writing markdown files
- The store subscribes to `state-json-merged` and `clawchestra-ready` Tauri events for reactive updates
- `ProjectViewModel` retains all existing UI-facing fields. Deprecated fields (`roadmapFileItems`, `changelogEntries`) are removed in Phase 5 after all consumers are updated
- Persisted UI preferences (sidebar state, selected project, etc.) remain in the existing Zustand persist middleware — no change

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
   - **Verify against BACKUP, not DB:** parse the backup ROADMAP.md (`.clawchestra/backup/ROADMAP.md.bak`). For every item in the backup, verify a corresponding item exists in the DB with the same `id`, `title`, `status`, and `completedAt`. Log any field-level differences as warnings. Require that item count matches (no items silently dropped). Only proceed with deletion if this integrity check passes.
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
```

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

## Phase 5: Cleanup & Constants

**Goal:** Remove dead code, update all constants, update all templates. This is the "sweep" phase (per institutional learnings lesson #3).

### 5.1 Update constants in lib.rs

- `METADATA_FILES`: remove `ROADMAP.md`, `CHANGELOG.md`. Add `CLAWCHESTRA.md` (keep `PROJECT.md` during transition).
- `DOCUMENT_FILES`: no change (specs/plans still tracked)
- `DOCUMENT_DIR_PREFIXES`: no change

### 5.2 Remove kanban auto-commit trigger

In `src/lib/auto-commit.ts`:
- Update `AUTO_COMMIT_ALLOWED` to `new Set(['CLAWCHESTRA.md'])`
- Remove the code path that triggers auto-commit on kanban drag
- Also update `store.ts` line 567 (hardcoded `['PROJECT.md']`)

### 5.3 Update lifecycle prompts

In `src/lib/deliverable-lifecycle.ts`:
- Replace all "update ROADMAP.md" references with "update .clawchestra/state.json"
- Replace all "read PROJECT.md" references with "read .clawchestra/state.json"
- Update prompt templates to reference the new schema

### 5.4 Update AGENTS.md compliance block

In `AGENTS.md` (the Clawchestra project's own AGENTS.md):
- File Structure section: add `.clawchestra/state.json` entry
- Remove `ROADMAP.md` and `CHANGELOG.md` references (post-migration)
- Update Roadmap Item YAML Shape to reference state.json JSON shape instead

### 5.5 Remove old TypeScript watcher

Delete `src/lib/watcher.ts` (replaced by unified Rust watcher in Phase 2). Update all imports.

### 5.6 Dead code sweep

```bash
npx tsc --noEmit      # Catch type errors from removals
cargo clippy -- -W dead_code  # Catch unused Rust functions
```

Specific targets:
- `src/lib/roadmap.ts` — `readRoadmap()`, `writeRoadmap()` become dead code. Keep `enrichItemsWithDocs()` if state.json items still reference spec/plan docs.
- `src/lib/changelog.ts` — entire module likely dead post-migration
- `src/lib/auto-commit.ts` — kanban-drag trigger code path
- `lib.rs` — any functions only called for ROADMAP.md/CHANGELOG.md parsing

### 5.7 Test fixture updates

Update all test files:
- Replace `PROJECT.md` fixtures with `CLAWCHESTRA.md`
- Replace `ROADMAP.md` YAML fixtures with state.json JSON fixtures
- Remove `CHANGELOG.md` fixtures
- Add new tests for: state.json validation, migration, merge logic

### Verification gate

- `npx tsc --noEmit` clean
- `cargo clippy` clean (no dead code warnings)
- `bun test` — all tests pass with updated fixtures
- `pnpm build` success
- `npx tauri build --no-bundle` success (full release build)

---

## Phase 6: OpenClaw Data Endpoint & Sync

**Goal:** Create the OpenClaw plugin extension, implement client identity, and build sync triggers. Combines v1 Phases 7+8 — they are small and tightly coupled.

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
      if (settings.bearerToken) {
        const auth = req.headers.authorization;
        if (!auth || auth !== `Bearer ${settings.bearerToken}`) {
          return res.status(401).json({ error: 'Unauthorized' });
        }
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
        const body = JSON.stringify(req.body);
        if (body.length > MAX_BODY_SIZE) {
          return res.status(413).json({ error: 'Payload too large' });
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
1. **Drain pending watcher events and complete any in-progress merges** before initiating the final sync flush — prevents race where a mid-merge state.json change is lost because sync reads the DB before the merge completes
2. Flush current DB state to remote (no debounce). Use atomic write for remote db.json (write to `.tmp`, rename) to prevent partial-transfer corruption.
3. 3-second timeout — do NOT block app shutdown on sync
4. If sync fails: log warning, set a `_syncFailedOnClose: true` flag in local settings so that on next launch, sync is attempted with higher priority (before showing UI). Close anyway — data safe in local DB, will sync on next launch.

Deferred to v2 of the product (not this plan):
- Continuous sync (debounced 2-second trigger on every state change)
- Sync status indicator UI in the header
- Offline queue with reconnect retry

**Known limitation:** without continuous sync, db.json on OpenClaw can be stale for the duration of a session. If a user asks OpenClaw "what's my roadmap status?" mid-session, OpenClaw reads stale data. The OpenClaw system prompt (6.5) should include: "Note: Data reflects the last time Clawchestra synced. For real-time status, check the Clawchestra app directly."

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

### 7.1 Structured logging (Rust)

Attach the `tracing` subscriber (crate introduced in Phase 1.6, used throughout Phases 2–6):
- JSON-structured log entries: `{ timestamp, level, event_type, details }`
- Categories already defined in Phase 1.6: `migration`, `validation`, `sync`, `watcher`, `injection`
- Log to `.clawchestra/activity.log` (per-project for project events) and `~/.clawchestra/app.log` (global for app events)
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
- Click to expand: shows which fields were rejected and why
- **Validation rejection history:** keep the last 20 rejection events per project in a viewable list (accessible from the project detail modal). Do NOT auto-dismiss the current status after the next successful agent write — instead, mark it as resolved but keep it in the history. This way, if an agent misbehaves at 2 AM and then writes valid data before the user opens the app, the user can still see what happened.

### Verification gate

- `tracing` integrated and producing JSON output
- Debug export produces useful output
- Validation status renders correctly
- All previous tests still pass

---

## Dependencies Between Phases

```
Phase 1 (Audit, Types, Validation) ──┐
                                      │
                                      ├── Phase 2 (state.json Infrastructure)
                                      │        │
                                      │        ├── Phase 3 (Migration + Rename)
                                      │        │
                                      │        └── Phase 4 (Branch Injection)
                                      │
                                      └── Phase 5 (Cleanup) ── requires Phase 3 + 4
                                               │
                                               └── Phase 6 (OpenClaw + Sync)
                                                        │
                                                        └── Phase 7 (Logging & Error Reporting)
```

Phases 3 and 4 can run in parallel after Phase 2 completes. Phase 5 waits for both. Phase 6 requires Phase 5. Phase 7 (logging finalization) depends on Phase 6, but the `tracing` crate is introduced in Phase 1.6 and used throughout all subsequent phases — Phase 7 only adds the subscriber, log rotation, and debug export UI.

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Migration data loss | Low | Critical | Per-project transactional migration; pre-migration backup for all projects; verify before delete |
| Agent writes invalid JSON | Medium | Low | Graceful parse failure; partial-apply; revert to last-known-good from state history buffer |
| Agent ignores new guidance (old branch) | Medium | Low | Creates phantom ROADMAP.md; Clawchestra ignores it; auto-commit updated to not commit it |
| OpenClaw extension breaks after update | Low | Medium | Extension is simple; version-pinned; test on launch; bearer token auth |
| File watcher misses changes | Very Low | Medium | FSEvents/inotify are kernel-level; manual refresh button as cheap fallback |
| Sync conflict loses data | Low | Medium | Per-field timestamps with millisecond precision; fail-open to "show both"; no silent overwrites |
| Two Clawchestra instances race | Low | Medium | Flock (fail-closed); single-instance recommendation in docs |
| Schema version mismatch | Low | Medium | Forward-compat check; clear user-facing error; migration functions for upgrades |
| Clock skew between devices | Medium | Medium | Hybrid logical clocks (D3); clock skew detection warning on sync; deterministic UUID tiebreaker |
| Stale agent write reverts recent changes | Medium | Medium | Stale write detection via state history buffer comparison (2.5); "read before write" guidance in CLAUDE.md |
| Windows watcher misses events | Low | Low | Manual refresh button; on-launch integrity check; `ReadDirectoryChangesW` limitations documented |
| Schema migration ships with bug | Low | High | Pre-migration backup; force re-migrate command; migration manifest for audit trail |

---

## Files Modified (estimated)

| Category | Files | Change Type |
|----------|-------|-------------|
| **New modules** | `src/lib/state-json.ts`, `src/lib/sync.ts`, `src/lib/db-json.ts` | Create |
| **New Rust modules** | `src-tauri/src/state.rs`, `src-tauri/src/migration.rs`, `src-tauri/src/watcher.rs` | Create |
| **Rust backend** | `src-tauri/src/lib.rs` | Moderate (delegate to new modules, settings) |
| **Schema/types** | `src/lib/schema.ts`, `src/lib/settings.ts`, `src/lib/tauri.ts` | Moderate |
| **State management** | `src/lib/store.ts`, `src/lib/projects.ts` | Significant |
| **Removed** | `src/lib/watcher.ts` | Delete (replaced by Rust watcher) |
| **Removed/reduced** | `src/lib/roadmap.ts`, `src/lib/changelog.ts`, `src/lib/auto-commit.ts` | Partial removal |
| **Components** | `src/App.tsx`, `src/components/Header.tsx` | Moderate |
| **Git sync** | `src/lib/git-sync-utils.ts` | Moderate (constants) |
| **Lifecycle** | `src/lib/deliverable-lifecycle.ts` | Moderate (prompt templates) |
| **Agent guidance** | `AGENTS.md`, `CLAUDE.md`, `scripts/sync-agent-compliance.sh` | Significant |
| **Tests** | `*.test.ts` | Update fixtures + add new tests |
| **OpenClaw** | New: `~/.openclaw/extensions/clawchestra-data-endpoint.ts` | Create |
| **Dependencies** | `package.json` | Add `zod` (or `valibot`), `zod-to-json-schema` |

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
