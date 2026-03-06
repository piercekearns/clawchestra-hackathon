# Architecture Direction: Implementation Plan

> End-to-end implementation plan for Clawchestra's evolution from file-based state to database-backed, OpenClaw-synced architecture. Covers all phases from audit through programmatic sync.

**Spec:** `docs/specs/architecture-direction-spec.md` (41 decisions, 19 sections)
**Date:** 2026-02-21
**Type:** feat
**Institutional reference:** `docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`

---

## Overview

This plan implements the full Architecture Direction spec: moving orchestration data (projects, roadmap items, completed items) from git-tracked markdown files into Clawchestra's database, with a gitignored JSON projection for AI agents, and programmatic sync to OpenClaw for multi-device access.

The change touches every layer: Rust backend (lib.rs), TypeScript frontend (store, parsers, components), agent guidance files (CLAUDE.md, AGENTS.md), and introduces a new OpenClaw plugin extension.

---

## Critical Design Decisions (resolved from spec gaps)

These decisions were identified during SpecFlow analysis and institutional learnings review. Each is addressed in the relevant phase.

**D1: Agent file locking is unenforceable — use merge-on-change instead.**
Agents (Claude Code, Cursor) write files via their tool infrastructure, which does not call `flock()`. True mutual exclusion between Clawchestra and agents is impossible. Instead: Clawchestra watches state.json for external changes, reads the full file, validates, and merges into the DB. The "lock" is Clawchestra's atomic read-validate-merge cycle, not a filesystem lock. Clawchestra still uses `flock()` internally (for its own writes and potential multi-instance races), but does not depend on agents cooperating.

**D2: state.json is per-project. db.json is global.**
Each project has `.clawchestra/state.json` in its root (agent-facing, per-project scope). OpenClaw has `~/.openclaw/clawchestra/db.json` (global, all projects). Clawchestra translates: on DB change → write per-project state.json projections; on state.json external change → merge project-scoped changes into global DB.

**D3: Per-field timestamps are set by Clawchestra on ingest, not by agents.**
Agents write plain JSON without timestamps. Clawchestra sets `updatedAt` on each changed field during the validate-merge cycle. This keeps the agent-facing schema simple and timestamps accurate (reflect when Clawchestra processed the change).

**D4: Validation uses partial-apply, not full-revert.**
If an agent writes 5 field changes where 4 are valid and 1 is invalid, the 4 valid changes are applied and the 1 invalid field is reverted to its previous value. This avoids losing valid work due to one bad field. Validation errors are logged to `.clawchestra/last-validation.json` for agent inspection.

**D5: AGENTS.md IS part of the branch injection loop.**
AGENTS.md is the primary operations reference (18KB, extensive ROADMAP.md references). Injecting only CLAUDE.md leaves a massive guidance gap. The injection loop updates both files on every branch.

**D6: Migration is per-project and transactional.**
Each project migrates independently with a state machine: `not_started → importing → imported → state_json_created → roadmap_deleted → complete`. Migration status persists in the DB per-project. Partial failure leaves the project in pre-migration state for retry. No all-or-nothing across projects.

**D7: Auto-commit for kanban drags is removed entirely.**
Post-migration, kanban drags write to state.json (gitignored) → no git changes → no auto-commit needed. The `auto-commit.ts` AUTO_COMMIT_ALLOWED set is updated to `CLAWCHESTRA.md` only. The kanban-drag auto-commit code path becomes dead code and is removed.

---

## state.json Schema (concrete definition)

Per-project file at `{project_root}/.clawchestra/state.json`:

```json
{
  "_schemaVersion": 1,
  "_generatedAt": 1708531200000,
  "_generatedBy": "clawchestra",
  "_instructions": "AI agents: read this file for project state. Write changes back to this file. Clawchestra validates and syncs automatically. See CLAUDE.md for schema rules.",
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
      "specDoc": "docs/specs/auth-system-spec.md",
      "planDoc": "docs/plans/auth-system-plan.md",
      "completedAt": null
    }
  ]
}
```

Notes:
- `_` prefixed fields are metadata, not editable by agents
- No `updatedAt` timestamps in the per-project file (agents don't need them)
- Timestamps live in the global db.json only (Clawchestra manages them)
- `roadmap/` detail files, `docs/specs/`, `docs/plans/` remain git-tracked — referenced by relative path

---

## Phase 1: Codebase Audit & Schema Types

**Goal:** Map every reference to PROJECT.md, ROADMAP.md, CHANGELOG.md across the entire codebase. Define TypeScript and Rust types for the new schema. No code changes — research only.

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

### 1.2 TypeScript types

Add to `src/lib/schema.ts`:

- `StateJsonDocument` — the per-project state.json shape
- `GlobalDatabase` — the db.json shape (array of projects with roadmap items, per-field timestamps)
- `MigrationStatus` — per-project migration state enum
- `ValidationResult` — result of validating an agent write
- Update existing `ProjectViewModel` to support both old (PROJECT.md) and new (DB) data sources during transition

### 1.3 Rust types

Add to `lib.rs` (or a new `state.rs` module if lib.rs is too large):

- `StateJson` struct with serde derive
- `GlobalDb` struct
- `MigrationState` enum
- `ValidationError` enum — exhaustive, wired end-to-end to TypeScript (per institutional learnings lesson #2)
- Use branded newtypes where possible: `struct ProjectId(String)`, `struct ProjectPath(PathBuf)` (per lesson #1)

### 1.4 Settings expansion

Add new fields to `DashboardSettings` in lib.rs with `#[serde(default)]` (per institutional learnings lesson #4 — serde defaults handle migration gracefully):

```rust
#[serde(default)]
client_uuid: Option<String>,          // Generated on first launch
#[serde(default)]
openclaw_sync_mode: String,           // "local" | "remote" | "disabled"
#[serde(default)]
openclaw_remote_url: Option<String>,  // For remote sync
#[serde(default)]
openclaw_bearer_token: Option<String>, // For remote auth
```

### Verification gate

- `npx tsc --noEmit` — types compile
- `cargo check` — Rust types compile
- Audit document complete and reviewed
- No runtime changes (nothing deployed)

---

## Phase 2: state.json Infrastructure

**Goal:** Build the core new system — writing, watching, validating, and merging state.json. This is the architectural linchpin.

### 2.1 `.clawchestra/` directory management

New Tauri command: `ensure_clawchestra_dir(project_path: String) -> Result<String, String>`
- Creates `.clawchestra/` in project root if it doesn't exist
- Returns the full path to the directory
- Does NOT modify `.gitignore` yet (that's Phase 4)

### 2.2 state.json writer

New Tauri command: `write_state_json(project_path: String, state: StateJson) -> Result<(), String>`
- Acquires flock on `.clawchestra/state.json.lock` (Clawchestra's own writes)
- Serializes `StateJson` to pretty-printed JSON
- Writes atomically (write to `.tmp`, rename)
- Releases lock

Frontend integration: after any DB write that changes project/roadmap state, call `write_state_json` for affected project(s). Debounce at 200ms for rapid changes (e.g., dragging multiple items).

### 2.3 state.json watcher

Use Rust `notify` crate (cross-platform filesystem events) via a new Tauri command:
- `watch_state_json(project_path: String)` — starts watching `.clawchestra/state.json`
- On external change detected (not from our own write — track via write flag):
  1. Read the file
  2. Parse JSON (handle malformed gracefully)
  3. Validate against schema
  4. Diff against DB state
  5. Apply valid changes to DB (partial-apply per D4)
  6. Write validation result to `.clawchestra/last-validation.json`
  7. Emit Tauri event `state-json-changed` to frontend
  8. Frontend refreshes affected project data

Debounce: 100ms (coalesce rapid writes from agents).

### 2.4 Schema validation

New Rust function: `validate_state_json(incoming: &StateJson, current: &StateJson) -> ValidationResult`

Validates:
- `project.status` ∈ `{in-progress, up-next, pending, dormant, archived}`
- `roadmapItems[].status` ∈ `{pending, up-next, in-progress, complete}`
- If `status == complete`, `completedAt` must be present (ISO date string)
- `priority` is a number
- `id` fields are non-empty strings
- No unknown top-level fields (warn but don't reject)

Returns: `ValidationResult { applied_changes: Vec<Change>, rejected_fields: Vec<RejectedField>, warnings: Vec<String> }`

### 2.5 Merge logic

When an external change is detected, diff field-by-field:
- For each field in the incoming state.json that differs from DB:
  - Validate the new value
  - If valid: update DB, set `updatedAt` to now (per D3)
  - If invalid: keep DB value, log rejection
- For new roadmap items (id not in DB): add them (validate all required fields)
- For removed roadmap items (id in DB but not in state.json): do NOT delete — agents removing items from state.json is treated as "I didn't include it" not "delete it". Deletion requires explicit action via UI or OpenClaw chat.

### 2.6 Clawchestra-side flock

Implement flock in lib.rs for Clawchestra's own concurrent access:
- `flock()` on Unix (macOS/Linux)
- `LockFile` on Windows
- Lock file: `.clawchestra/state.json.lock`
- Use canonical paths (per institutional learnings lesson #6)
- Non-blocking with retry: try → wait 1ms → retry → up to 100ms → proceed without lock (fail-open)
- Stale lock detection: lock file includes PID + timestamp. If PID is dead and timestamp > 30s, clean up.

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add tests for: validation logic, merge logic, state.json round-trip
- Manual test: write a state.json manually in a project dir, verify Clawchestra picks it up

---

## Phase 3: Rename — PROJECT.md → CLAWCHESTRA.md

**Goal:** Support the new filename while maintaining backwards compatibility during transition.

### 3.1 Dual-filename scan in Rust

Update `scan_projects` in lib.rs:
- Scan for `CLAWCHESTRA.md` first
- If not found, fall back to `PROJECT.md`
- Return which filename was found (for migration tracking)

Update `load_project` / `read_file` calls to use the detected filename.

### 3.2 Frontend parsing

Update `src/lib/projects.ts`:
- `readProject()` receives the actual filename (not hardcoded)
- `enrichProject()` handles both filenames
- `writeProject()` writes to whichever filename the project currently uses (don't rename during a write)

### 3.3 Auto-rename offer

In the project detail modal or settings:
- If a project still uses `PROJECT.md`, show a subtle indicator: "Using legacy filename"
- Offer a one-click rename button: renames file, updates git, commits "chore: rename PROJECT.md → CLAWCHESTRA.md"
- This is optional — the user can leave PROJECT.md indefinitely during transition

### 3.4 Update METADATA_FILES constant

In lib.rs `categorize_dirty_file`:
- Add `CLAWCHESTRA.md` to METADATA_FILES
- Keep `PROJECT.md` in METADATA_FILES (still tracked during transition)
- These are for git sync categorization only

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — update test fixtures that reference PROJECT.md
- `pnpm build` success
- Manual test: rename a PROJECT.md to CLAWCHESTRA.md, verify app still discovers and displays the project

---

## Phase 4: Migration — ROADMAP.md & CHANGELOG.md → Database

**Goal:** Import existing ROADMAP.md and CHANGELOG.md data into the DB, create state.json projections, delete the source files.

### 4.1 Migration state machine

New Rust struct + Tauri commands:

```rust
enum MigrationState {
    NotStarted,
    Importing,       // Reading ROADMAP.md + CHANGELOG.md
    Imported,        // Data in DB, source files still exist
    StateJsonCreated,// .clawchestra/state.json written
    GitignoreUpdated,// .clawchestra/ added to .gitignore
    SourceDeleted,   // ROADMAP.md + CHANGELOG.md deleted
    Complete,        // Migration verified
}
```

Persisted in DB per-project. Checked on every app launch.

### 4.2 Migration trigger

On app launch, for each tracked project:
1. Check migration state in DB
2. If `NotStarted` and project has `ROADMAP.md`:
   - Set state to `Importing`
   - Read ROADMAP.md YAML frontmatter (`items:` array)
   - Read CHANGELOG.md YAML frontmatter (`entries:` array) if present
   - Import all items into DB with correct statuses and `completedAt` dates
   - Sanitize status values during import (use existing `sanitizeRoadmapItem` logic)
   - Set state to `Imported`
3. If `Imported`:
   - Write `.clawchestra/state.json` projection
   - Set state to `StateJsonCreated`
4. If `StateJsonCreated`:
   - Append `.clawchestra/` to project's `.gitignore` (create .gitignore if needed)
   - Commit: "chore: add .clawchestra to gitignore"
   - Set state to `GitignoreUpdated`
5. If `GitignoreUpdated`:
   - Check project id — if `revival-fightwear`: skip deletion (backup exception per spec decision #38)
   - Otherwise: delete ROADMAP.md, delete CHANGELOG.md
   - Commit: "chore: migrate orchestration data to Clawchestra database"
   - Set state to `SourceDeleted`
6. If `SourceDeleted`:
   - Verify state.json is readable and matches DB
   - Set state to `Complete`

Each step is individually retriable. If any step fails, the project stays at that state and is retried on next launch. User can also trigger retry from project settings.

### 4.3 Migration UI

During migration (which runs automatically on launch):
- Show a toast/banner: "Migrating project data... (3/7 projects complete)"
- Per-project status in the project detail modal
- If all projects complete: dismiss automatically
- If any fail: persistent notification with "Retry" button

### 4.4 Handle `roadmap/` detail files

These files (`roadmap/{item-id}.md`) are NOT migrated into the DB. They stay git-tracked. state.json items reference them by relative path (same as ROADMAP.md YAML did via `specDoc`/`planDoc`). No change needed.

### 4.5 Handle schema drift during import

When importing ROADMAP.md YAML:
- Use existing `sanitizeRoadmapItem()` logic (already handles invalid statuses)
- Items with invalid/unrecoverable data are imported with `status: pending` and a flag `_importWarning: "Original status 'in-flight' was invalid, defaulted to 'pending'"`
- Log all import warnings to console and `.clawchestra/migration.log`

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add migration tests: import → verify DB → verify state.json → verify deletion
- `pnpm build` success
- Manual test: open app with existing projects, verify migration runs, verify kanban board shows same data, verify ROADMAP.md/CHANGELOG.md deleted (except Revival Fightwear)

---

## Phase 5: CLAUDE.md & AGENTS.md Branch Injection

**Goal:** Inject updated agent guidance (pointing to state.json instead of ROADMAP.md) into CLAUDE.md and AGENTS.md on all branches of all tracked projects.

### 5.1 Injection content

The injected CLAUDE.md section:

```markdown
## Clawchestra Integration

Project orchestration state lives in `.clawchestra/state.json` (gitignored, always on disk).

**Read:** Open `.clawchestra/state.json` to see project status, roadmap items, priorities.
**Write:** Edit `.clawchestra/state.json` to update status, add items, change priorities. Clawchestra validates and syncs automatically.

**Schema rules:**
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- When setting status: complete, always set completedAt: YYYY-MM-DD
- Priorities are unique per column
- Do NOT delete items from state.json — removal requires explicit action via Clawchestra UI

**Do NOT edit:** CLAWCHESTRA.md (human documentation only), any files in `.clawchestra/` other than state.json.
```

The AGENTS.md section updates: replace all "edit ROADMAP.md" references with "edit .clawchestra/state.json". Replace "read PROJECT.md" with "read CLAWCHESTRA.md for documentation, .clawchestra/state.json for machine-readable state."

### 5.2 Injection loop (Rust)

New Tauri command: `inject_agent_guidance(project_path: String, options: InjectionOptions) -> Result<InjectionResult, String>`

```rust
struct InjectionOptions {
    dry_run: bool,        // Preview without committing
    branches: Vec<String>, // Specific branches, or empty for all
    retry_failed: bool,   // Only attempt previously failed branches
}

struct InjectionResult {
    total_branches: usize,
    injected: Vec<String>,
    skipped: Vec<SkippedBranch>,
}

struct SkippedBranch {
    name: String,
    reason: String, // "dirty_working_tree" | "detached_head" | "mid_rebase" | "already_injected"
}
```

Logic:
1. Stash current changes if working tree is dirty (restore after loop)
2. Record original branch
3. For each local branch (`git branch --format='%(refname:short)'`):
   a. Check if already injected (idempotency — look for "Clawchestra Integration" section header)
   b. If already injected: skip with reason `already_injected`
   c. `git checkout "$branch"`
   d. Update CLAUDE.md (append or replace section)
   e. Update AGENTS.md (find-and-replace ROADMAP.md/PROJECT.md references)
   f. `git add CLAUDE.md AGENTS.md`
   g. `git commit -m "chore: update agent guidance for Clawchestra architecture"`
   h. Record success
4. Restore original branch
5. Pop stash if needed
6. Return results

### 5.3 Progress reporting

Frontend integration:
- Show progress during injection: "Injecting agent guidance... 8/15 branches"
- Emit Tauri events per-branch for real-time progress
- Auto-dismiss on full success (3 second delay)
- Stay visible and interactive on partial failure

### 5.4 Retry mechanism

Persisted in DB per-project:
- `injection_results: Vec<BranchInjectionResult>` — tracks each branch's status
- Project settings panel shows: "Agent guidance: 13/15 branches (2 skipped)"
- "Retry Failed" button triggers `inject_agent_guidance` with `retry_failed: true`
- For dirty-branch retries: offer stash/inject/pop or skip

### 5.5 Update sync-agent-compliance.sh

Update `scripts/sync-agent-compliance.sh` to:
- Reference state.json instead of ROADMAP.md
- Reference CLAWCHESTRA.md instead of PROJECT.md
- Keep the compliance block sync mechanism intact

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add injection tests: mock git operations, verify CLAUDE.md content, verify idempotency
- Manual test: run injection on a multi-branch project, verify CLAUDE.md on each branch, verify git log shows injection commits

---

## Phase 6: Cleanup & Constants

**Goal:** Remove dead code, update all constants, update all templates. This is the "sweep" phase (per institutional learnings lesson #3).

### 6.1 Update constants in lib.rs

- `METADATA_FILES`: remove `ROADMAP.md`, `CHANGELOG.md`. Add `CLAWCHESTRA.md` (keep `PROJECT.md` during transition).
- `DOCUMENT_FILES`: no change (specs/plans still tracked)
- `DOCUMENT_DIR_PREFIXES`: no change

### 6.2 Remove kanban auto-commit trigger

In `src/lib/auto-commit.ts`:
- Update `AUTO_COMMIT_ALLOWED` to `new Set(['CLAWCHESTRA.md'])` (remove `PROJECT.md` and `ROADMAP.md`)
- Remove the code path that triggers auto-commit on kanban drag (state.json is gitignored, no git changes)
- The auto-commit module itself survives (still useful for CLAWCHESTRA.md changes on local-only repos)

### 6.3 Update lifecycle prompts

In `src/lib/deliverable-lifecycle.ts`:
- Replace all "update ROADMAP.md" references with "update .clawchestra/state.json"
- Replace all "read PROJECT.md" references with "read .clawchestra/state.json"
- Update prompt templates to reference the new schema

### 6.4 Update AGENTS.md compliance block

In `AGENTS.md` (the Clawchestra project's own AGENTS.md):
- File Structure section: add `.clawchestra/state.json` entry
- Remove `ROADMAP.md` and `CHANGELOG.md` references (post-migration)
- Update Roadmap Item YAML Shape to reference state.json JSON shape instead
- Update "How agents update roadmap items" section

### 6.5 Update check_for_update

In lib.rs `check_for_update()`:
- Remove ROADMAP.md from data-only commit suppression logic (if present)
- `.clawchestra/` is gitignored so it never appears in commit diffs — no change needed there
- Verify `categorize_dirty_file` handles CLAWCHESTRA.md correctly

### 6.6 Dead code sweep

Per institutional learnings lesson #3 — run explicitly:

```bash
# TypeScript
npx tsc --noEmit  # Catch type errors from removals
# Check for unused exports
grep -r "export " src/lib/roadmap.ts  # Any exports only used by removed code?
grep -r "export " src/lib/changelog.ts  # Same

# Rust
cargo clippy -- -W dead_code  # Catch unused functions/structs
```

Specific targets:
- `src/lib/roadmap.ts` — `readRoadmap()`, `writeRoadmap()`, `enrichItemsWithDocs()` may become dead code if all reads come from DB. Keep `enrichItemsWithDocs()` if state.json items still reference spec/plan docs.
- `src/lib/changelog.ts` — entire module likely dead post-migration
- `src/lib/auto-commit.ts` — kanban-drag trigger code path
- `lib.rs` — any functions only called for ROADMAP.md/CHANGELOG.md parsing

### 6.7 Test fixture updates

Update all test files:
- Replace `PROJECT.md` fixtures with `CLAWCHESTRA.md`
- Replace `ROADMAP.md` YAML fixtures with state.json JSON fixtures
- Remove `CHANGELOG.md` fixtures
- Add new tests for: state.json validation, migration state machine, merge logic

### Verification gate

- `npx tsc --noEmit` clean
- `cargo clippy` clean (no dead code warnings)
- `bun test` — all tests pass with updated fixtures
- `pnpm build` success
- `npx tauri build --no-bundle` success (full release build)

---

## Phase 7: OpenClaw Data Endpoint

**Goal:** Create the OpenClaw plugin extension that serves the global database over HTTP for remote sync.

### 7.1 Extension file content

Generate `~/.openclaw/extensions/clawchestra-data-endpoint.ts`:

```typescript
export default function (api: any) {
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  const DATA_ROOT = path.join(os.homedir(), '.openclaw', 'clawchestra');

  api.registerHttpRoute({
    path: '/clawchestra/data/*',
    handler: async (req: any, res: any) => {
      // Path validation: resolve and ensure within DATA_ROOT
      const requestedPath = req.params[0] || 'db.json';
      const resolved = path.resolve(DATA_ROOT, requestedPath);
      if (!resolved.startsWith(DATA_ROOT)) {
        return res.status(403).json({ error: 'Path traversal blocked' });
      }

      if (req.method === 'GET') {
        if (!fs.existsSync(resolved)) {
          return res.status(404).json({ error: 'Not found' });
        }
        const content = fs.readFileSync(resolved, 'utf-8');
        res.setHeader('Content-Type', 'application/json');
        return res.send(content);
      }

      if (req.method === 'PUT') {
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, JSON.stringify(req.body, null, 2));
        return res.json({ ok: true });
      }

      res.status(405).json({ error: 'Method not allowed' });
    }
  });
}
```

### 7.2 Extension installation

New Tauri command: `install_openclaw_extension(openclaw_path: String) -> Result<(), String>`
- Writes the extension file to `{openclaw_path}/extensions/clawchestra-data-endpoint.ts`
- For local OpenClaw: direct filesystem write
- For remote OpenClaw: sent via the self-setup flow (ask OpenClaw AI to write it — see spec Q2)
- Verify installation by hitting `GET /clawchestra/data/db.json` (expect 404 or valid JSON)

### 7.3 Local filesystem sync path

When OpenClaw is on the same machine (`openclaw_sync_mode: "local"`):
- Skip the HTTP endpoint entirely
- Read/write directly to `~/.openclaw/clawchestra/db.json`
- This is the default for the current single-machine setup

### Verification gate

- Extension file generates correctly
- Manual test: install extension, restart OpenClaw, hit `GET /clawchestra/data/db.json` via curl
- `cargo check` clean
- `npx tsc --noEmit` clean

---

## Phase 8: Client Identity & Programmatic Sync

**Goal:** Give each Clawchestra instance a unique identity, inject training into OpenClaw, and implement the sync triggers.

### 8.1 Client UUID

On first launch (or if `client_uuid` is None in settings):
- Generate UUID v4
- Store in `DashboardSettings.client_uuid`
- Display in Settings > Advanced (copyable, for debugging)

Human-readable name: auto-detect from OS hostname, stored alongside UUID. Editable in settings.

### 8.2 OpenClaw system prompt injection

New Tauri command: `inject_openclaw_training(openclaw_path: String, client_info: ClientInfo) -> Result<(), String>`

Writes to `~/.openclaw/clawchestra/system-context.md`:
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

This file is referenced in OpenClaw's system prompt configuration. The system prompt path is configurable — Clawchestra updates the OpenClaw config to include this file.

### 8.3 Sync triggers

Implement in a new `src/lib/sync.ts` module:

**On launch:**
1. Read local DB
2. If sync mode is `local`: read `~/.openclaw/clawchestra/db.json`
3. If sync mode is `remote`: GET `{remote_url}/clawchestra/data/db.json`
4. Merge: for each field, keep the one with the newer `updatedAt` timestamp
5. Write merged result to both local DB and remote

**On state change:**
1. After any DB write, schedule a sync (debounced 2 seconds)
2. The debounce resets on each new change (so rapid drags only trigger one sync)
3. Write to remote (local filesystem or HTTP PUT)

**On close:**
1. Flush any pending sync immediately (no debounce)
2. If sync fails: log warning, close anyway (data is safe in local DB, will sync on next launch)
3. Do NOT block app shutdown on sync — use a 3-second timeout

**If unreachable:**
1. Queue the latest state (not individual changes — just "here's the current DB")
2. On reconnect: sync the latest state
3. No operation log needed (per-field timestamps resolve conflicts)

### 8.4 Sync status indicator

Add to the Header component:
- Small icon next to the sync badge: cloud with checkmark (synced), cloud with arrow (syncing), cloud with X (offline/failed)
- Tooltip shows last sync time and status
- Only visible when sync mode is not `disabled`

### Verification gate

- `npx tsc --noEmit` clean
- `cargo check` clean
- `bun test` — add sync tests: merge logic with timestamps, debounce behavior
- `pnpm build` success
- `npx tauri build --no-bundle` success
- Manual test: change a kanban item, verify db.json updates on OpenClaw's filesystem within 2 seconds

---

## Phase 9: Integration Testing & Polish

**Goal:** End-to-end verification of all flows. Fix edge cases. Final dead-code sweep.

### 9.1 Integration test scenarios

1. **Fresh install → add project → state.json created** ✓
2. **Existing user → migration runs → ROADMAP.md imported → deleted** ✓
3. **Kanban drag → state.json updated → sync to OpenClaw** ✓
4. **Agent writes state.json → Clawchestra validates → DB updated** ✓
5. **Agent writes invalid data → partial-apply → validation log written** ✓
6. **Concurrent: user drag + agent write → merge-on-change resolves** ✓
7. **Branch injection → all branches get CLAUDE.md + AGENTS.md** ✓
8. **Injection retry → previously failed branches recovered** ✓
9. **App closes → final sync fires → app shuts down** ✓
10. **Offline changes → reconnect → sync resolves** ✓
11. **Revival Fightwear backup → files NOT deleted** ✓

### 9.2 Final dead-code sweep

Run:
```bash
cargo clippy -- -W dead_code
npx tsc --noEmit
```

Grep for any remaining references to ROADMAP.md/CHANGELOG.md in source code (not docs/specs).

### 9.3 Final builds

```bash
bun test                            # All tests pass
npx tsc --noEmit                    # Clean
pnpm build                          # Frontend builds
npx tauri build --no-bundle         # Full release build
```

### Verification gate

- All 11 integration scenarios pass
- Zero dead-code warnings
- Zero ROADMAP.md/CHANGELOG.md references in source code
- Clean release build

---

## Dependencies Between Phases

```
Phase 1 (Audit & Types) ──┐
                           ├── Phase 2 (state.json Infrastructure)
                           │        │
                           │        ├── Phase 3 (Rename)
                           │        │
                           │        ├── Phase 4 (Migration) ── requires Phase 2 + 3
                           │        │
                           │        └── Phase 5 (Injection) ── requires Phase 2
                           │
                           └── Phase 6 (Cleanup) ── requires Phase 3 + 4 + 5
                                    │
                                    ├── Phase 7 (Data Endpoint)
                                    │
                                    └── Phase 8 (Client Identity & Sync) ── requires Phase 7
                                             │
                                             └── Phase 9 (Integration Testing)
```

Phases 3, 4, and 5 can run in parallel after Phase 2 completes. Phase 6 waits for all three. Phases 7 and 8 are sequential. Phase 9 is the final pass.

---

## Risk Analysis

| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-----------|
| Migration data loss | Low | Critical | Per-project transactional migration; Revival Fightwear backup; verify before delete |
| Agent writes invalid JSON | Medium | Low | Graceful parse failure; revert to last-known-good; log error |
| Agent ignores new guidance (old branch) | Medium | Low | Creates phantom ROADMAP.md; Clawchestra ignores it; auto-commit updated to not commit it |
| OpenClaw extension breaks after update | Low | Medium | Extension is simple (~30 lines); version-pinned; test on launch |
| File watcher misses changes | Low | Medium | Polling fallback (check every 5s); manual refresh button |
| Sync conflict loses data | Low | Medium | Per-field timestamps; fail-open to "show both"; no silent overwrites |

---

## Files Modified (estimated)

| Category | Files | Change Type |
|----------|-------|-------------|
| **New modules** | `src/lib/state-json.ts`, `src/lib/sync.ts`, `src/lib/migration.ts` | Create |
| **Rust backend** | `src-tauri/src/lib.rs` | Major (new commands, settings, types) |
| **Schema/types** | `src/lib/schema.ts`, `src/lib/settings.ts`, `src/lib/tauri.ts` | Significant |
| **State management** | `src/lib/store.ts`, `src/lib/projects.ts` | Significant |
| **Removed/reduced** | `src/lib/roadmap.ts`, `src/lib/changelog.ts`, `src/lib/auto-commit.ts` | Partial removal |
| **Components** | `src/App.tsx`, `src/components/Header.tsx`, `src/components/SyncDialog.tsx` | Moderate |
| **Git sync** | `src/lib/git-sync-utils.ts` | Moderate (constants) |
| **Lifecycle** | `src/lib/deliverable-lifecycle.ts` | Moderate (prompt templates) |
| **Agent guidance** | `AGENTS.md`, `CLAUDE.md`, `scripts/sync-agent-compliance.sh` | Significant |
| **Tests** | `*.test.ts` | Update fixtures + add new tests |
| **OpenClaw** | New: `~/.openclaw/extensions/clawchestra-data-endpoint.ts` | Create |

---

## Success Criteria

- Kanban drag updates state.json, NOT ROADMAP.md
- AI agent reads/writes state.json successfully
- state.json changes appear in Clawchestra UI within 200ms
- All existing projects migrated with zero data loss
- CLAUDE.md on all branches points to state.json
- db.json syncs to OpenClaw filesystem within 2 seconds of change
- Clean release build passes
- All existing tests pass (with updated fixtures)
