# Architecture V2 — Specification

**Status:** MVP shipped (Phases 1-5); V2.1 hardening shipped with non-critical follow-ups  
**Created:** 2026-02-11  
**Last Updated:** 2026-02-12 (rev N+1)

---

## Overview

Decouple the Pipeline Dashboard from `clawdbot-sandbox` so it can:
- Live as a standalone repo/app
- Track projects across multiple workspace locations
- Still integrate with OpenClaw for chat/agent features
- Provide robust "Create New" and "Add Existing" project flows

Non-goal for this document: app rename and brand changes. Keep rename as a separate follow-up RFC after V2 migration ships.

## Delivery Snapshot (2026-02-12)

- MVP scope (settings foundation, catalog separation, Create New, Add Existing, migration cutover) is shipped.
- Runtime paths are settings-backed with repos-first operation.
- V2.1 hardening baseline (mutation locks, retries, rollback/migration tests, path-failure telemetry) is shipped; advanced CAS/recovery-gate items remain as non-critical follow-ups.
- Authoritative roadmap state is tracked in `roadmap/architecture-v2.md` and `roadmap/architecture-v2-1-hardening.md`.

---

## 1. The Four-Path Model

### 1.1 Path Definitions

| Setting | Purpose | Example |
|---------|---------|---------|
| `catalogRoot` | Where project catalog entries (markdown records) live | `~/Library/Application Support/Pipeline Dashboard/catalog` |
| `workspaceRoots[]` | Allowed locations for creating/selecting project folders | `["~/repos"]` |
| `openclawWorkspacePath` | OpenClaw's operating context (for chat commands, optional) | `~/openclaw-workspace` |
| `appSourcePath` | Where Pipeline Dashboard source lives (for source-based self-update) | `<repo-root>` |

### 1.2 Why This Model

**Current state:** Everything is hardcoded to `<legacy-project-root>`. App lives inside the sandbox. Paths are baked into `lib.rs` and `update.sh`.

**Problems:**
- Can't move app without breaking update feature
- Can't track projects outside sandbox
- Hardcoded paths don't work on other machines
- No clear separation between "where we track" vs "where projects live"

**Target state:** App is location-agnostic. Catalog can live anywhere. Projects can live in multiple workspaces. All paths are configurable.

### 1.3 Path Resolution Rules

1. All settings paths support `~` expansion and are normalized before save.
2. Non-null settings paths (`catalogRoot`, entries in `workspaceRoots[]`, `openclawWorkspacePath`, `appSourcePath`) must be absolute after normalization.
3. For existing paths, canonical form is `realpath`; for non-existent paths, use lexical normalization (`~` expansion + absolute path + `.`/`..` collapse) until path materializes.
4. Persisted catalog entries with `trackingMode=linked` store `localPath` as an absolute canonical path.
5. `workspaceRoot` + `folderName` are UI input helpers only; they are resolved into `localPath` before write.
6. Relative `localPath` values from legacy entries are tested against all `workspaceRoots[]`.
7. If a legacy relative path maps to exactly one root, it is rewritten as absolute.
8. If it maps to zero roots, entry is marked orphaned and write actions are blocked.
9. If it maps to multiple roots, entry is marked ambiguous and write actions are blocked until user resolves explicitly.
10. All path normalization occurs in one shared utility in Rust, surfaced to TS via invoke.
11. First-run wizard initializes required settings if missing.
12. Overlapping `workspaceRoots[]` are normalized to a non-overlapping canonical set for legacy-path resolution only (ancestor root supersedes child root for ambiguity checks).
13. Trust/approval checks are never broadened by overlap normalization; operation-scoped approvals still apply to the exact resolved path boundary.

---

## 2. Settings System

### 2.1 Settings File Location

Canonical settings file (single source):

```
{appConfigDir}/settings.json
```

Examples by platform (resolved from `appConfigDir`):

| Platform | Example settings path |
|----------|------------------------|
| macOS | `~/Library/Application Support/Pipeline Dashboard/settings.json` |
| Linux | `~/.config/pipeline-dashboard/settings.json` |
| Windows | `%APPDATA%\\Pipeline Dashboard\\settings.json` |

`catalogRoot` never stores a second copy of settings.

### 2.2 Settings Schema

```typescript
interface TrustedPathApproval {
  approvedPath: string; // canonical realpath
  approvedAt: string;   // ISO timestamp
  approvedBy: 'user';
  expiresAt: string;    // ISO timestamp
  operations: Array<'openclaw-read' | 'openclaw-mutate' | 'catalog-mutate' | 'source-rebuild'>;
}

interface Settings {
  settingsVersion: 1;

  // Core paths
  catalogRoot: string;
  workspaceRoots: string[];
  openclawWorkspacePath: string | null;
  appSourcePath: string | null;
  
  // Runtime behavior
  openclawContextPolicy: 'selected-project-first' | 'workspace-default';
  updateMode: 'none' | 'source-rebuild';
  approvedExternalPaths: TrustedPathApproval[];
  
  // Display preferences
  theme: 'light' | 'dark' | 'system';
  
  // Feature flags
  enableGitIntegration: boolean;
  enableOpenClawChat: boolean;
  cacheTtlMinutes: number;
  
  // Cache
  lastProjectId?: string;
  windowBounds?: { x: number; y: number; width: number; height: number };
}
```

Defaults note:
1. The JSON above is a seed template and may include `~` for readability.
2. Persisted settings must store normalized absolute paths for all non-null path fields.
3. First write after bootstrap expands `~` and persists normalized absolute paths; existing paths are upgraded to `realpath` canonical form.

### 2.3 Defaults

```json
{
  "settingsVersion": 1,
  "catalogRoot": "~/Library/Application Support/Pipeline Dashboard/catalog",
  "workspaceRoots": ["~/projects"],
  "openclawWorkspacePath": null,
  "appSourcePath": null,
  "openclawContextPolicy": "selected-project-first",
  "updateMode": "none",
  "approvedExternalPaths": [],
  "theme": "system",
  "enableGitIntegration": true,
  "enableOpenClawChat": true,
  "cacheTtlMinutes": 10
}
```

Settings migration rule:
1. On load, if `settingsVersion` is missing, treat as `0`, migrate to `1`, and persist atomically.
2. If `openclawWorkspacePath` is null, mutating OpenClaw actions are allowed only when selected-project context resolves to a trusted/approved path; otherwise block.
3. If `approvedExternalPaths` is missing, initialize to `[]`.
4. During migration, canonicalize any stored `approvedPath` values to `realpath`; drop entries that fail canonicalization.

### 2.4 Settings UI

Add a Settings panel (roadmap item P1 in pending):
- Editable paths with folder picker buttons
- Add/remove workspace roots
- Test connection to OpenClaw
- OpenClaw context policy selector
- Update mode selector (`none` vs `source-rebuild`)
- Theme toggle (already exists in header, move to settings)

---

## 3. Catalog System

### 3.1 Catalog Structure

```
catalogRoot/
├── projects/
│   ├── pipeline-dashboard.md
│   ├── clawos.md
│   ├── memestr.md
│   └── ...
├── index/
│   ├── localpath-index.json
│   ├── id-index.json
│   └── column-snapshots.json
└── templates/
    ├── PROJECT.md
    ├── ROADMAP.md
    └── AGENTS.md
```

### 3.1.1 Index File Schemas

`localpath-index.json`:

```json
{
  "version": 1,
  "entries": {
    "/absolute/canonical/path": "project-id"
  }
}
```

`id-index.json`:

```json
{
  "version": 1,
  "entries": {
    "project-id": {
      "trackingMode": "linked",
      "localPath": "/absolute/canonical/path"
    },
    "idea-id": {
      "trackingMode": "catalog-only",
      "localPath": null
    }
  }
}
```

`column-snapshots.json`:

```json
{
  "version": 1,
  "columns": {
    "in-progress": { "columnSnapshotVersion": 1 },
    "up-next": { "columnSnapshotVersion": 1 },
    "pending": { "columnSnapshotVersion": 1 },
    "dormant": { "columnSnapshotVersion": 1 },
    "shipped": { "columnSnapshotVersion": 1 }
  }
}
```

Rules:
1. `version` is required and monotonic.
2. `localpath-index.json` keys must be canonical absolute paths and values must be valid catalog `id`s.
3. `id-index.json` keys must be valid catalog `id`s and values must include `trackingMode`.
4. For `id-index.json` entries where `trackingMode=linked`, `localPath` is required and must be canonical absolute.
5. For `id-index.json` entries where `trackingMode=catalog-only`, `localPath` must be `null`.
6. `localpath-index.json` must include only `trackingMode=linked` entries and must round-trip to `id-index.json`.
7. `column-snapshots.json` must include all `BoardStatus` keys.
8. Recovery rebuild uses deterministic ordering; missing snapshot columns are initialized to `1`.

### 3.2 Catalog Entry Schema

Each `.md` file in `catalogRoot/projects/` is a catalog entry:

```yaml
---
# Required
id: pipeline-dashboard
title: Pipeline Dashboard
type: project
trackingMode: linked  # linked | catalog-only
catalogVersion: 1

# Location
# Required when trackingMode=linked
localPath: <repo-root>  # Absolute canonical path

# Optional
priority: 1  # If omitted, coordinator assigns max+1 in target column
tags: [tauri, react, dashboard]
repo: owner/repo     # GitHub slug
icon: "🚀"
lastActivity: "2026-02-11"
parent: pipeline-dashboard                # Optional relationship
dependsOn: [chat-persistence]             # Optional relationship list
children: [architecture-v2]               # Optional relationship list

# For catalog-only projects (ideas/not-linked), localPath is omitted and status is required in catalog
# status: pending

# Cached status (updated on scan)
cachedStatus: in-progress
cachedNextAction: "Implement chat drawer"
cachedGitStatus: clean
cachedBranch: main
cacheUpdatedAt: "2026-02-11T22:15:00Z"
---

# Pipeline Dashboard

Optional body content, notes, etc.
```

### 3.2.1 Conditional Validation Rules

For `trackingMode=linked`:
1. `localPath` is required and must be canonical absolute.
2. Catalog `status` is optional/non-authoritative if present.
3. `cachedStatus` is allowed but treated as cache only.

For `trackingMode=catalog-only`:
1. `localPath` must be absent.
2. Catalog `status` is required and authoritative.
3. `cachedStatus` may exist but cannot override catalog `status`.
4. `repo` is optional metadata only.

For relationship fields (all tracking modes):
1. `parent` is optional and must reference a valid catalog `id` when present.
2. `dependsOn` and `children` are optional arrays of valid catalog `id` values.
3. Unknown relationship ids are validation errors for normal writes and migration conflicts during V2 migration.

### 3.2.2 Catalog File Naming Invariant

1. Canonical catalog filename is `catalogRoot/projects/<id>.md`.
2. Frontmatter `id` must match filename stem exactly.
3. Any `id` change must run as one transaction:
   - Rename catalog file atomically to `<new-id>.md`.
   - Update frontmatter `id`.
   - Update `id-index.json` and `localpath-index.json` as needed.
4. Any filename/frontmatter mismatch detected during load is a validation error and blocks mutation until repaired.

### 3.3 Catalog vs Project Files

**Catalog entry** (in `catalogRoot/projects/`):
- Lightweight pointer
- Cached status for fast dashboard rendering
- May duplicate some info for performance

**Project files** (in `localPath`):
- `PROJECT.md` — Source of truth for project details
- `ROADMAP.md` — Deliverables and priorities
- `AGENTS.md` — Agent instructions for this project

**Sync behavior:**
- Dashboard reads catalog entries for board-level rendering
- When project is selected, dashboard reads full details from `localPath/PROJECT.md`
- "Refresh" updates cache-only fields in catalog (`cachedStatus`, `cachedNextAction`, `cachedGitStatus`, `cachedBranch`, `cacheUpdatedAt`)
- Detail edits write to `localPath/PROJECT.md` first, then refresh catalog cache
- Refresh detects linked status-column drift and runs a reconcile transaction (reindex old/new columns) before persisting new cache snapshot

### 3.4 Source-of-Truth Contract

| Field Category | Source of Truth | Notes |
|---------------|------------------|-------|
| Identity + organization (`id`, `title`, `priority`, tags, dashboard ordering) | Catalog entry | Dashboard-owned metadata |
| Operational status for `trackingMode=linked` (`status`, `nextAction`, blockers, roadmap details) | `localPath/PROJECT.md` and `ROADMAP.md` | Repo/project-owned data |
| Operational status for `trackingMode=catalog-only` | Catalog entry | Used for local ideas and non-linked records |
| Runtime cache (`cachedStatus`, `cachedNextAction`, `cachedGitStatus`, `cachedBranch`, `cacheUpdatedAt`) | Catalog cache writer | Cache only, never authoritative for linked projects |

Required rules:
1. Cache fields are never written into `PROJECT.md`.
2. For `trackingMode=linked`, repo-owned operational fields are never sourced from catalog cache when project files are available.
3. For `trackingMode=linked`, board rendering uses `cachedStatus`/`cachedNextAction` with freshness based on `cacheUpdatedAt` + `cacheTtlMinutes`.
4. If linked cache is stale, show stale indicator and trigger background refresh; do not block board render.
5. If linked cache is missing at render time, lazily read `PROJECT.md` for transient board placement and mark entry `cachePending`.
6. If lazy read fails, place entry in `HealthState=orphaned` (no special board column) and block mutating actions until refresh succeeds; if no prior/cached board status exists, use deterministic fallback `BoardStatus=pending`.
7. Project detail view always reads repo source-of-truth (`PROJECT.md`/`ROADMAP.md`) when reachable.
8. For `trackingMode=linked`, catalog `status` is ignored if present.
9. Missing/unreachable `localPath` shows an orphan warning and blocks write actions until re-linked.
10. Ambiguous legacy path mappings show an ambiguity warning and block write actions until resolved.
11. For `trackingMode=catalog-only`, `localPath` must be absent and catalog `status` is authoritative.
12. Before any linked-project status mutation or linked-project priority mutation, run reconciliation: read latest `PROJECT.md` status for affected linked entries, refresh cache, and abort with `staleLinkedStatus` if planned column membership changed.
13. In V2.1 hardening, priority/status writes must operate on reconciled `columnSnapshotVersion` tokens from `catalogRoot/index/column-snapshots.json`; if a token changes before commit, reject and retry.
14. Any linked-project status mutation writes `PROJECT.md` first (authoritative), then updates catalog cache projection in the same journaled transaction.
15. Linked mutations that write repo files (`PROJECT.md`, `ROADMAP.md`, `AGENTS.md` when in mutation scope) must run dirty-target-file preflight and require explicit override before write when dirty.

### 3.5 Concurrency and Write Safety

V2 is explicitly single-user/local-machine, delivered in two profiles:
- Everything in **MVP launch profile** is MVP-required.
- Everything in **Hardening profile** is V2.1-only and deferred from MVP pilot.

MVP launch profile (required before migration pilot):
1. Single app instance mode (process-local mutation queue).
2. Atomic per-file writes (`.tmp` + fsync + rename).
3. Durable transaction journal + recovery for Create New / Add Existing and status/priority column mutations.
4. Deterministic priority assignment and reindexing.
5. Dirty-repo mutation guardrails for Add Existing.

Hardening profile (required before broad rollout):
1. OS-level interprocess file locks on settings and catalog writes (with timeout + explicit error path).
2. Compare-and-set version check (`catalogVersion` monotonic integer per entry).
3. Conflict error on stale write attempts with retry prompt.
4. Read-your-writes refresh after successful commit.
5. On first V2 migration, entries without `catalogVersion` are initialized to `1`.
6. Enforce global `localPath` uniqueness for `trackingMode=linked` entries under a catalog-wide index lock.
7. Multi-entry status/priority writes must run as one column transaction under a column-level lock.
8. Lock acquisition order is mandatory: global index lock -> column lock (if needed) -> per-entry locks (sorted by deterministic `entryLockKey`).
9. Multi-file mutations must use durable transaction journals in `catalogRoot/.transactions/`.
10. Recovery runs before normal reads/writes: unfinished journals are rolled back or finalized before accepting new mutations.
11. Column priority/status writes must compare/update `columnSnapshotVersion` tokens per affected column.

Scope boundary:
1. V2 migration pilot requires MVP profile only.
2. Hardening profile is explicitly deferred to V2.1 broad rollout and must be feature-flagged off during pilot.
3. `columnSnapshotVersion` conflict checks are V2.1-only; MVP uses single-instance serialization and journal recovery without snapshot token conflicts.
4. `catalogVersion` CAS conflict checks are V2.1-only for pilot scope; MVP serial queue avoids concurrent CAS races.
5. Implementations should expose distinct coordinator interfaces (`MvpMutationCoordinator`, `HardeningMutationCoordinator`) selected by feature flag.
6. Any step explicitly marked `V2.1 hardening only` is a no-op in MVP and must not block MVP commits.

### 3.6 Write Protocols

All mutations must flow through a single `CatalogMutationCoordinator` API. Direct ad-hoc entry writes are forbidden in app flows.
Lock ownership rule: only `CatalogMutationCoordinator` acquires/releases global, column, and per-entry locks. Low-level CAS helpers must not acquire locks (no re-entrant lock grabs).
`entryLockKey` definition:
- `trackingMode=linked` -> `path:${canonicalLocalPath}`
- `trackingMode=catalog-only` -> `id:${id}`

Coordinator guarantees:
1. Enforces lock acquisition order and uniqueness checks for every mutation.
2. Runs pre-write reconciliation for linked status writes and linked priority writes (including mixed status+priority moves that change column membership).
3. Opens/closes durable transaction journals for multi-file updates.
4. Passes lock tokens to low-level CAS writers; CAS without a valid lock token is invalid.
5. Assigns priority automatically when unset (`max+1` in target column), then reindexes before commit.
6. Reads and validates `columnSnapshotVersion` tokens for affected columns before commit (V2.1 hardening).
7. Runs linked dirty-target-file preflight for linked file-writing mutations (`PROJECT.md`, `ROADMAP.md`, `AGENTS.md` when in scope) and blocks writes unless explicit override is present.
8. Enforces trusted-path policy before any linked target write by calling `assertTrustedPath(localPath, operation)`.
9. Captures expected file hash/mtime for linked target files and rechecks before authoritative file write.
10. Runtime reads of mutable catalog/index state are serialized through the mutation queue and must observe committed state only (no mixed in-progress snapshots).

Catalog entry write (CAS):
1. Validate caller lock token from `CatalogMutationCoordinator`.
2. Confirm coordinator already holds required per-entry lock.
3. Read entry with current `catalogVersion = N`.
4. Compare with caller-expected version.
5. If mismatch, reject with conflict (V2.1 hardening).
6. If match, write updated entry with `catalogVersion = N + 1` using atomic rename.
7. Return write result to coordinator (coordinator owns lock release).

Settings write:
1. Acquire settings lock (`process-local` in MVP, `interprocess` in V2.1 hardening).
2. Read settings, migrate schema if needed.
3. Apply update and write atomically.
4. Release lock.

Catalog uniqueness write:
1. Acquire global catalog index lock.
2. Validate `id` is unique across all entries.
3. For `trackingMode=linked`, validate `localPath` is unique across linked entries.
4. Reserve/update `id-index.json` record (`id -> { trackingMode, localPath|null }`) for all entries.
5. For `trackingMode=linked`, reserve/update `localpath-index.json` record (`localPath -> id`).
6. For `trackingMode=catalog-only`, ensure no `localpath-index.json` record exists for that `id`.
7. Perform entry write transaction.
8. Commit index updates and release lock.

Column priority/status write:
1. Acquire global index lock, then all affected column locks (source + destination) in deterministic lexical order.
2. Resolve affected entry set and acquire per-entry locks in sorted `entryLockKey` order.
3. Reconcile linked status from `PROJECT.md` for affected linked entries; abort on drift with `staleLinkedStatus`.
4. If mutation performs linked repo-file writes, assert trusted path for each linked `localPath` using operation `catalog-mutate`; abort with `untrustedPath` if any fail.
5. If mutation performs linked repo-file writes, run dirty-target-file preflight for linked entries (`PROJECT.md`, `ROADMAP.md`, `AGENTS.md` when in scope) and require explicit override if dirty.
6. Read all affected entries in the reconciled target column(s).
7. Read expected `columnSnapshotVersion` tokens for each affected column (V2.1 hardening only).
8. Reindex priorities deterministically.
9. Open durable transaction journal with pre-images and expected versions.
10. For linked entries with repo-file writes: verify expected target file hash/mtime unchanged (`PROJECT.md`, `ROADMAP.md`, `AGENTS.md` in scope); if changed, abort with `linkedFileChanged`.
11. For linked entries with status change: update `PROJECT.md` status first (authoritative write), then stage cache projection updates.
12. Write all affected catalog entries as one tracked batch.
13. In V2.1 hardening, verify snapshot tokens unchanged, then increment tokens atomically in `column-snapshots.json`.
14. Mark journal committed (fsync), then finalize (cleanup journal/pre-images).
15. Release locks in reverse order.
16. For priority-only mutations with no linked status change, skip linked repo-file write steps (4, 5, 10, 11) and run as catalog-only transaction.

### 3.6.1 Conflict Matrix and Precedence (V2.1 Hardening)

Error codes:
1. `untrustedPath` — linked target path is not trusted/approved for the requested operation.
2. `dirtyTargetFiles` — target repo files are dirty and override was not granted.
3. `columnSnapshotConflict` — snapshot token changed before commit.
4. `entryVersionConflict` — per-entry `catalogVersion` CAS mismatch.
5. `staleLinkedStatus` — linked repo status changed versus planned mutation set.
6. `linkedFileChanged` — linked repo file hash/mtime changed after preflight and before write.

Precedence:
1. If `untrustedPath` is detected, abort immediately with `untrustedPath`.
2. If dirty-target-file preflight fails without override, abort with `dirtyTargetFiles`.
3. If `staleLinkedStatus` detected during reconciliation, abort immediately with `staleLinkedStatus`.
4. If snapshot token mismatch is detected before writes, abort with `columnSnapshotConflict`.
5. If entry CAS mismatch occurs during batch write, roll back journal and return `entryVersionConflict`.
6. If linked file optimistic-lock check fails, roll back journal and return `linkedFileChanged`.
7. If multiple conflicts are detected in one attempt, return highest-precedence code above and include secondary causes in diagnostics.

Retry guidance:
1. `untrustedPath` -> add workspace root or approve path for `catalog-mutate`, then retry.
2. `dirtyTargetFiles` -> clean/stash target files or explicitly grant override, then retry.
3. `staleLinkedStatus` -> force refresh and retry with updated column mapping.
4. `columnSnapshotConflict` -> reread affected columns and retry transaction.
5. `entryVersionConflict` -> reread conflicting entries and retry with updated expected versions.
6. `linkedFileChanged` -> reload linked repo files, show diff to user, require explicit retry.

### 3.6.2 MVP Conflict Model (Pilot)

1. Single-instance mutation queue serializes writes and eliminates concurrent writer races in MVP.
2. MVP returns `untrustedPath`, `dirtyTargetFiles`, `staleLinkedStatus`, `linkedFileChanged`, and file validation errors.
3. MVP does not emit `columnSnapshotConflict` or `entryVersionConflict`.
4. Journal recovery remains mandatory in MVP for crash consistency.
5. MVP API contract must expose only MVP error codes; V2.1-only conflict codes remain behind hardening feature flags.

### 3.7 Priority Invariants

Rules:
1. Priorities are unique within a given status column.
2. Insert/update that collides reindexes affected entries deterministically.
3. Reindex strategy: contiguous sequence starting at `1` in display order.
4. Any write that changes status or priority must run reindex before commit.
5. Reindex writes guarantee journaled consistency across all affected entries (no partial committed state after recovery), not cross-filesystem atomicity.
6. If incoming priority is missing/null, assign `max(existingPriorityInColumn) + 1` before invariant checks.

### 3.7.1 Status Enums

BoardStatus (column placement):
1. `in-progress`
2. `up-next`
3. `pending`
4. `dormant`
5. `shipped`

HealthState (non-column operational state):
1. `healthy`
2. `cachePending`
3. `orphaned`
4. `ambiguous`

Rules:
1. `orphaned` is represented as prior `BoardStatus` + `HealthState=orphaned` (not a board column); if prior `BoardStatus` is unavailable, fallback to `BoardStatus=pending`.
2. `BoardStatus` is the canonical status type name in TS/Rust interfaces; avoid `ProjectStatus` in new contracts.

### 3.8 Durable Transactions and Recovery

Journal storage:
- Path: `catalogRoot/.transactions/{txId}.json`
- Pre-images: `catalogRoot/.transactions/{txId}/preimages/*`

Journal lifecycle:
1. `prepared` (persist + fsync): includes target files, expected versions, and pre-image paths.
2. `applying`: file writes execute with atomic rename per file.
3. `committed` (persist + fsync): logical commit marker written only after all writes succeed.
4. `finalized`: cleanup pre-images + journal, then release transaction state.

Runtime read consistency:
1. During `applying`, readers must not observe partial transaction state.
2. MVP behavior: queue-gate reads behind the mutation queue until the transaction reaches `committed`/`finalized`.
3. V2.1 may replace queue-gated reads with committed snapshots, but mixed-state reads remain forbidden.

Crash recovery (startup and before accepting any catalog read/write operation):
1. Scan `catalogRoot/.transactions/` for non-finalized journals.
2. If state is `prepared`/`applying` without `committed`, restore pre-images and mark rolled back.
3. If state is `committed` but not `finalized`, complete finalize cleanup.
4. Block new reads and writes until recovery completes.
5. If recovery fails, enter read-only mode with actionable error.
6. Verify `localpath-index.json` integrity against catalog entries; rebuild index deterministically on mismatch before enabling reads/writes.
7. Verify `id-index.json` integrity against catalog entries; rebuild index deterministically on mismatch before enabling reads/writes.
8. If V2.1 hardening is enabled, verify `column-snapshots.json` integrity and required column keys; rebuild deterministically on mismatch before enabling reads/writes.
9. If any required index/snapshot rebuild fails, remain read-only and surface recovery action.
10. Recovery gate precedence: until recovery completes, render may show a startup/loading state only; normal non-blocking stale-cache rendering resumes after recovery.

Atomicity note:
- Filesystem atomicity is per-file (`rename`), not cross-root.
- Cross-root workflows (catalog + repo files) rely on journaled consistency and deterministic recovery.

---

## 4. Create New Project Flow

### 4.1 User Flow

```
┌─────────────────────────────────────────────────────┐
│  Create New Project                            [X]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Project Title: [Shopping App_________________]    │
│  Folder Name:   [shopping-app_________________]    │
│                                                     │
│  Location:                                          │
│  ┌─────────────────────────────────────────────┐   │
│  │ ~/projects                              [▼] │   │
│  └─────────────────────────────────────────────┘   │
│  Full path: ~/projects/shopping-app                │
│                                                     │
│  ☑ Initialize git repository                       │
│  ☑ Create PROJECT.md (required), ROADMAP.md, AGENTS.md │
│  ☑ Open in VS Code after creation                  │
│                                                     │
│  Status: [In Progress ▼]   Priority: [Auto (end) ▼] │
│                                                     │
│              [Cancel]  [Create Project]             │
└─────────────────────────────────────────────────────┘
```

### 4.2 Steps

1. **Validate inputs**
   - `title` is required and human-readable (no slug-only constraint)
   - `folderName` is required and slug-friendly
   - Default `folderName` is canonical slugify of `title`, editable by user
   - Derive canonical `id` from `folderName` using the shared slugify algorithm (same normalization as Add Existing `inferredId`)
   - Not already in catalog
   - Folder doesn't already exist at target path
   - Resolve target as `realpath(parentWorkspaceRoot) + folderName`; reject path separators in `folderName`
   - Verify target remains under approved workspace root after canonicalization

2. **Create folder**
   - Verify parent exists, is canonical, and is not a symlink escape
   ```bash
   mkdir ~/projects/shopping-app
   ```

3. **Record git bootstrap intent** (if checked; defer execution until post-transaction finalize)
   - Queue finalize action to run `git init` only after core transaction commit

4. **Bootstrap templates**
   - Always create `PROJECT.md` for linked projects (minimum required template if optional bootstrapping is otherwise disabled)
   - Copy and fill `ROADMAP.md` and `AGENTS.md` when selected
   - Create `.gitignore` with sensible defaults

5. **Create catalog entry**
   - Write `catalogRoot/projects/shopping-app.md`
   - Set `localPath` to the new folder as absolute canonical path

6. **Initial commit** (if git enabled; post-transaction finalize)
   ```bash
   cd ~/projects/shopping-app
   git init
   git add -- PROJECT.md .gitignore
   [ -f ROADMAP.md ] && git add -- ROADMAP.md
   [ -f AGENTS.md ] && git add -- AGENTS.md
   git commit -m "Initial project setup"
   ```

7. **Open in editor** (if checked)
   ```bash
   code ~/projects/shopping-app
   ```

8. **Refresh dashboard**
   - New project appears in selected status column

Status-write rule:
1. For `trackingMode=linked`, selected status from Create New is written into generated `PROJECT.md` frontmatter and treated as authoritative there.
2. For `trackingMode=catalog-only`, status is written to the catalog entry and is authoritative in catalog.
3. Linked project catalog entries may store `cachedStatus` only; catalog `status` is not authoritative.
4. If priority is not explicitly set, assign `max+1` in the selected status column before commit.

### 4.3 Transaction Guarantees (Create New)

Create New runs as a transactional pipeline with rollback journal:

1. Preflight validation (name/path/catalog uniqueness) with no writes.
2. Open and fsync transaction journal in `prepared` state before first filesystem write.
3. Execute write steps while recording compensating actions.
4. On failure, apply compensating actions in reverse order:
   - Remove newly created catalog entry.
   - Remove newly created files from target folder (never remove pre-existing files).
   - Remove newly created folder only if created by this operation and still empty.
5. Run git-init/commit finalize only after core transaction succeeds.
6. Return structured failure report with what was rolled back and any manual cleanup needed.
7. Persist journal state to `catalogRoot/.transactions/` with fsync at `prepared` and `committed`.
8. Startup recovery replays/rolls back unfinished Create New journals before new writes.
9. If post-commit finalize action fails (`git init`, staged commit), keep core create committed and return `finalizeWarnings[]` with failed step, stderr, and retry guidance.
10. Persist failed finalize actions in `catalogRoot/.transactions/finalize/<transaction-id>.json` for explicit retry.
11. Finalize retries must be idempotent:
   - `git init` is skipped if `.git/` already exists.
   - Initial commit step is skipped if repository already has at least one commit.

### 4.4 Template Placeholders

Templates support these placeholders:

| Placeholder | Value |
|-------------|-------|
| `{{PROJECT_TITLE}}` | Project title (e.g., "Shopping App") |
| `{{PROJECT_ID}}` | Slug (e.g., "shopping-app") |
| `{{TODAY}}` | ISO date (e.g., "2026-02-11") |
| `{{YEAR}}` | Year (e.g., "2026") |

### 4.5 ID Derivation Rule (Create New)

1. Create New derives `id` from `folderName` using the same canonical slugify algorithm as Add Existing.
2. If derived `id` collides with an existing catalog `id`, block create and require user-edited name/slug before enabling Create.
3. Final `id` must pass uniqueness check under the global catalog index lock before write.

### 4.6 Canonical Slugify Algorithm

Used by Create New (`folderName` default + `id`) and Add Existing (`inferredId`):
1. Normalize input to Unicode NFKD.
2. Strip combining marks (diacritics).
3. Lowercase using locale-insensitive mapping.
4. Replace any non `[a-z0-9]` run with a single `-`.
5. Trim leading/trailing `-`.
6. Collapse repeated `-` to one.
7. If empty after normalization, fallback to `project`.
8. Enforce max length `63` characters; trim trailing `-` after truncation.
9. Reserved ids are rejected: `index`, `projects`, `templates`, `con`, `prn`, `aux`, `nul`.

Reference test vectors:
- `"Shopping App"` -> `shopping-app`
- `"  Déjà Vu!  "` -> `deja-vu`
- `"foo___bar"` -> `foo-bar`
- `"---"` -> `project`
- `"A".repeat(80)` -> first 63 chars, lowercase, no trailing `-`

---

## 5. Add Existing Project Flow

### 5.1 User Flow

```
┌─────────────────────────────────────────────────────┐
│  Add Existing Project                          [X]  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Select folder:                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │ ~/repos/my-old-project               [📁]   │   │
│  └─────────────────────────────────────────────┘   │
│                                                     │
│  ─────────────── Compatibility Check ─────────────  │
│                                                     │
│  ✅ Git repository detected (main branch)          │
│  ✅ Has README.md                                   │
│  ❌ Missing PROJECT.md                              │
│     → Will create from template                     │
│  ❌ Missing ROADMAP.md                              │
│     → Will create empty skeleton                   │
│  ⚠️  No status defined                              │
│     → Will default to "pending"                  │
│                                                     │
│  Title: [My Old Project__________________]         │
│  (inferred from folder name, editable)             │
│                                                     │
│              [Cancel]  [Add to Dashboard]           │
└─────────────────────────────────────────────────────┘
```

### 5.2 Compatibility Checker

When a folder is selected, run these checks:

```typescript
interface CompatibilityReport {
  folderPath: string;
  folderName: string;
  
  // Git
  isGitRepo: boolean;
  gitBranch?: string;
  gitRemote?: string;
  
  // Required files
  hasProjectMd: boolean;
  projectMdStatus?: 'valid' | 'missing-frontmatter' | 'invalid-frontmatter';
  
  hasRoadmapMd: boolean;
  hasAgentsMd: boolean;
  hasReadme: boolean;
  
  // Inferred data
  inferredTitle: string;        // From folder name or README
  inferredId: string;           // Canonical slug from title/folder name
  inferredStatus: BoardStatus; // Default: 'pending'
  detectedStatus?: BoardStatus; // Parsed from PROJECT.md when valid
  inferredRepo?: string;         // From git remote

  // Catalog collisions
  catalogIdConflict: boolean;
  localPathConflict: boolean;
  conflictingEntryId?: string;

  // Workspace policy
  insideWorkspaceRoots: boolean;
  matchedWorkspaceRoot?: string;
  requiresWorkspaceApproval: boolean;

  // Repo safety
  isWorkingTreeDirty?: boolean;
  dirtyPaths?: string[];
  
  // Actions needed
  actions: CompatibilityAction[];
}

interface CompatibilityAction {
  type: 'create' | 'update' | 'prompt';
  file: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
}
```

### 5.3 Retrofit Actions

| Check | If Missing/Invalid | Action |
|-------|-------------------|--------|
| `PROJECT.md` | Missing | Create from template with inferred title |
| `PROJECT.md` | No frontmatter | Add frontmatter block |
| `PROJECT.md` | Invalid frontmatter | Show error, require manual fix |
| `ROADMAP.md` | Missing | Create empty skeleton |
| `AGENTS.md` | Missing | Create from template |
| Git repo | Not initialized | Offer to `git init` |
| Status | Valid in `PROJECT.md` | Preserve detected status by default |
| Status | Missing in valid `PROJECT.md` frontmatter | Default to "pending" |
| Title | Not defined | Infer from folder name |
| Catalog id | Not defined | Infer slug using canonical id algorithm |
| Catalog `id` already exists | Conflict | Block add; require explicit rename/new id |
| `localPath` already tracked | Conflict | Block add; offer open existing entry |
| Folder outside `workspaceRoots[]` | Policy | Allow read-only compatibility preview; block mutations until explicit trusted-path approval or workspace-root add |
| Dirty working tree touching target files | Safety | Block mutation unless user confirms override |
| Target file resolves outside selected repo or through symlink escape | Security | Block mutation and require manual fix |

### 5.4 Steps

1. **Select folder** via native folder picker
   - Folder must be under `workspaceRoots[]` by default
   - If outside, allow read-only compatibility preview with policy warning
   - Require explicit unexpired trusted-path approval for `catalog-mutate` (stored in `approvedExternalPaths[]`) or explicit add-workspace-root action before any write/confirm step

2. **Run compatibility check**
   - Scan for git, required files, frontmatter
   - Parse `PROJECT.md` status into `detectedStatus` when valid
   - If `PROJECT.md` frontmatter is invalid, mark retrofit as blocking and skip auto-frontmatter mutation
   - Resolve `realpath` + `lstat` for target files and verify containment under selected repo root
   - Generate report, collision detection, id inference, dirty-state detection, and actions list

3. **Display report**
   - Show what's good, what's missing, what will be fixed
   - Allow editing inferred title
   - Allow editing inferred id (slug validation enforced)
   - If `detectedStatus` is present, show it as default status
   - Allow changing default status only when `detectedStatus` is missing
   - If invalid `PROJECT.md` frontmatter exists, disable "Add to Dashboard" until manual fix
   - Show any catalog collisions and block "Add" until resolved

4. **Preview retrofit plan (no writes)**
   - Default mode is non-destructive preview
   - Preview is allowed even for out-of-root folders
   - User explicitly opts into file mutations in existing repo

5. **Confirm retrofit**
   - User reviews actions and confirms write scope
   - Clicks "Add to Dashboard"
   - If repo is dirty in target files (`PROJECT.md`, `ROADMAP.md`, `AGENTS.md`), require explicit "override dirty repo" confirmation

6. **Execute actions transactionally**
   - Create missing files from templates
   - Update frontmatter only for missing frontmatter cases (never auto-rewrite invalid frontmatter payloads)
   - Revalidate trusted-path approval scope/expiry at commit time (`catalog-mutate`) before any linked-file write
   - Enforce symlink-safe writes: target must not escape selected repo root after `realpath`
   - Create pre-image backups for any modified existing files before write
   - Write/update catalog entry in same transaction scope
   - Roll back created files and restore pre-image backups on failure
   - If catalog write fails, roll back repo mutations from this transaction journal
   - Persist journal with fsync at `prepared` and `committed`; recover unfinished journals on startup

7. **Optional commit safety rules (post-transaction finalize only)**
   - Stage only files created/modified by this workflow (explicit path list)
   - Never run broad `git add -A`
   - Skip commit if unrelated dirty files exist unless user explicitly confirms scoped commit

8. **Refresh dashboard**
   - Project appears in appropriate column

ID derivation rule:
1. `inferredId` is generated by canonical slugify of `inferredTitle`; fallback to folder name.
2. Slug rules must exactly match Section 4.6 canonical slugify algorithm.
3. If inferred id collides, require user-edited id before enabling "Add to Dashboard".
4. Final id must pass uniqueness check under global catalog index lock.

---

## 6. Migration Plan

### 6.1 Current State

```
~/openclaw-workspace/
├── projects/
│   ├── pipeline-dashboard/     ← App source lives here
│   │   ├── src/
│   │   ├── src-tauri/
│   │   ├── docs/
│   │   ├── roadmap/
│   │   └── ...
│   ├── nostr/
│   │   └── clawos/
│   └── ...
└── ...
```

### 6.2 Target State

```
<repo-root>/          ← App source (standalone)
├── src/
├── src-tauri/
├── docs/
└── ...

~/Library/Application Support/Pipeline Dashboard/
├── settings.json
└── catalog/
    ├── projects/
    │   ├── pipeline-dashboard.md   ← Points to <repo-root>
    │   ├── clawos.md               ← Points to ~/ClawOS
    │   └── ...
    └── templates/
        └── ...

~/openclaw-workspace/                  ← OpenClaw workspace (unchanged)
├── projects/                        ← Can still be a workspace root
└── ...
```

### 6.3 Migration Steps

0. **Preflight source safety**
   - Check source app repo dirty state (uncommitted/untracked files)
   - If dirty, hard-stop migration until user stashes/commits/cleans source state

1. **Create new app repo**
   ```bash
   git clone <current-remote-or-local> <repo-root>
   # Preserves tracked history/remotes; local-only artifacts (stashes, hooks, worktree metadata) are not preserved
   ```

2. **Initialize settings**
   - Create settings file with paths
   - Set `appSourcePath` to new location
   - Add `~/repos` to `workspaceRoots` as default
   - Legacy roots (for example `~/openclaw-workspace/projects`) are transitional and optional
   - Broader roots (for example `~/openclaw-workspace`) require explicit user approval in settings

3. **Migrate catalog entries**
   - For each existing project in old location:
     - Create catalog entry in new `catalogRoot`
     - If project folder moved, set `localPath` to new location
     - Else set `localPath` to existing location
   - Special case: `pipeline-dashboard` entry must point to `<repo-root>` after app move
   - Initialize `catalogVersion: 1` for all migrated entries
   - Projects don't move, just the tracking
   - Apply deterministic migration conflict policy:
     - Duplicate `id`: generate deterministic `idRemap`; rewrite catalog-entry frontmatter allowlist only (`id`, `parent`, `dependsOn`, `children`); any non-allowlist reference becomes blocking conflict until manually resolved
     - Missing status: set `status: pending` for `catalog-only`; for linked, leave status in repo source
     - Invalid frontmatter in linked repo: mark entry `migrationWarning: invalid-frontmatter`, skip status import, and set placement fallback `cachedStatus: pending` for migration ordering (migration-only leniency; Add Existing remains blocking for invalid frontmatter)
     - Missing priority: assign `max+1` per target column (for linked with skipped status import, use fallback column `pending`), then normalize contiguous ordering
     - Unresolvable path or parse failure: move entry to migration quarantine report and block migration completion until resolved/explicitly accepted

4. **Update hardcoded paths**
   - `lib.rs`: Read from settings instead of hardcoded
   - `update.sh`: Use `appSourcePath` from settings
   - Remove all owner-specific absolute path references

5. **Test**
   - All projects still appear
   - Create new project works
   - Add existing project works
   - Update feature works
   - OpenClaw chat works
   - Migration report contains no unresolved critical skips

6. **Clean up**
   - Manual cleanup gate (explicit confirmation required):
     - Verify new app runs correctly after restart
     - Verify backups exist and restore dry-run is valid
     - Verify old source has no uncommitted/untracked changes
   - Remove old app source from sandbox only after gate passes
   - Update any documentation

### 6.4 Rollback Plan

Migration writes must be reversible via explicit backup artifacts.
V2 migration scope mutates catalog/settings/app artifacts only; it does not rewrite linked project repo files.

Before migration:
1. Backup settings to `settings.pre-v2.{timestamp}.json`.
2. Backup catalog directory to `catalog.pre-v2.{timestamp}.tar.gz`.
3. Backup app source/app binary artifacts (`app.pre-v2.{timestamp}.tar.gz` or installer bundle copy).
4. Write `migration-state.json` with step markers, timestamps, and persisted `idRemap`.

If issues:
1. Restore app from `app.pre-v2...`.
2. Restore settings from `settings.pre-v2...`.
3. Restore catalog from `catalog.pre-v2...`.
4. Clear partial migration markers and restart in legacy mode.

Migration step runners must be idempotent (safe to re-run after partial failure).
On retry, migration must load and reuse the previously persisted `idRemap` from `migration-state.json` (never regenerate a different mapping mid-migration).

---

## 7. Runtime Behavior Rules

### 7.1 Self-Update Modes

Two explicit modes:

1. `none` (default): hide update action in-app.
2. `source-rebuild`: show update action only when `appSourcePath` is set and valid.

Guardrails:
- If `updateMode=source-rebuild` but `appSourcePath` is missing/unreadable, disable update with a clear error in settings.
- Source rebuild flow is development/power-user behavior; production auto-update is a separate future track.
- `source-rebuild` execution requires `appSourcePath` to be trusted (inside `workspaceRoots[]` or explicitly approved for `source-rebuild`).

Acceptance criteria:
1. Update command resolves script path from `appSourcePath` only (no fallback to hardcoded repo path).
2. If `appSourcePath/update.sh` is missing or non-executable, return structured `updateSourceUnavailable` error.
3. No update-path behavior depends on `DEFAULT_PROJECTS_DIR`.
4. Settings UI surfaces fix actions when update source is unavailable.

### 7.2 OpenClaw Context Precedence

Default policy: `selected-project-first`.

Resolution order for chat actions (`selected-project-first`):
1. Canonicalize candidate path via `realpath`.
2. If a project is selected and has `localPath`, use as active context only if canonical path is under a canonical `workspaceRoots[]` boundary (or explicitly approved for the required operation and stored).
3. Else use `openclawWorkspacePath` if canonical path is under a canonical `workspaceRoots[]` boundary (or explicitly approved for the required operation and stored).
4. Boundary check must use path-segment-safe prefix logic (not raw string prefix).
5. If neither resolves to a trusted path for the requested operation, block the requested action (read or mutate) and show configuration error.

Resolution order for chat actions (`workspace-default`):
1. Canonicalize candidate path via `realpath`.
2. Use `openclawWorkspacePath` first when present and trusted for the required operation.
3. If `openclawWorkspacePath` is absent/untrusted for the required operation, fall back to selected project `localPath` when trusted for the required operation.
4. Boundary check must use path-segment-safe prefix logic (not raw string prefix).
5. If neither resolves to a trusted path for the requested operation, block the requested action (read or mutate) and show configuration error.

Operation scope for trust checks:
1. Read-only chat/context actions require `openclaw-read`.
2. Mutating chat/actions require `openclaw-mutate`.

UI requirement:
- Chat surface shows active context path so the user can see where commands will run.

### 7.3 Trusted Path Approval Policy

Approval record schema:
1. `approvedPath`
2. `approvedAt`
3. `approvedBy` (`user`)
4. `expiresAt` (default 7 days)
5. `operations` (`openclaw-read`, `openclaw-mutate`, `catalog-mutate`, `source-rebuild`)

Rules:
1. Approval is subtree-scoped to canonical `approvedPath` plus descendants using path-segment-safe matching; wildcard patterns are not supported.
2. Approval is visible and revocable in Settings.
3. Expired approvals are ignored until renewed.
4. Requested operations are disabled for untrusted/unapproved paths (read requires `openclaw-read`, mutate requires `openclaw-mutate`).
5. Any linked repo file mutation from dashboard flows (`PROJECT.md`, `ROADMAP.md`, `AGENTS.md`) requires `catalog-mutate` trust.
6. Approved paths are stored and compared in canonical `realpath` form only.
7. Approvals are operation-scoped; `openclaw-read` does not imply `openclaw-mutate`.

---

## 8. App Rename (Out of Scope for V2)

Rename is intentionally excluded from V2 delivery.
Track rename decisions in a separate RFC after V2 migration ships.

---

## 9. Implementation Phases

### Rebased Execution Plan (2026-02-12)

Note:
- This checklist is a planning artifact and not the canonical shipped-state tracker.
- Canonical delivery status lives in `roadmap/architecture-v2.md` and `roadmap/architecture-v2-1-hardening.md`.

1. Implement settings foundation with canonical path persistence and trusted-operation model (`catalog-mutate` included).
2. Build `CatalogMutationCoordinator` MVP path with trusted-path assertions on all linked repo writes.
3. Implement recovery gate before any catalog read/write and include snapshot verification/rebuild logic (hardening-flag aware).
4. Deliver catalog separation + migration with persisted/reused deterministic `idRemap`.
5. Deliver Create New / Add Existing flows on top of coordinator guarantees (journal + rollback + trust checks).
6. Cut over update path + OpenClaw context resolution to settings-backed paths, then run full non-regression checks.

### Phase 1: Settings System
- [x] Create settings file structure
- [x] Add settings read/write to Rust backend
- [x] Make paths configurable (but default to current behavior)
- [x] Settings panel UI (basic)
- [ ] First-run wizard for required paths + initial trust policy
- [ ] Add `settingsVersion` migration path and tests

### Phase 2: Catalog Separation
- [ ] Move catalog logic to read from `catalogRoot`
- [ ] Update project loading to use catalog entries
- [ ] Maintain backward compatibility with current structure

### Phase 3: Create New Flow
- [ ] Folder picker integration
- [ ] Git init support
- [ ] Enhanced bootstrap (full template set)
- [ ] Uniqueness validation

### Phase 4: Add Existing Flow
- [ ] Folder picker for existing
- [ ] Compatibility checker
- [ ] Retrofit UI
- [ ] Retrofit actions
- [ ] Dirty-repo preflight + explicit override flow
- [ ] Canonical `inferredId` generation + editable id UI

### Phase 5: Migration
- [ ] Move app source to standalone repo
- [ ] Migrate existing projects to catalog
- [ ] Update all hardcoded paths
- [ ] Test everything
- [ ] MVP safety suite (rollback recovery, id collisions, default priority assignment, trusted-path approvals)
- [ ] Enforce single-instance mutation mode for V2 launch

### Phase 6: V2.1 Hardening + Broad Rollout
- [ ] Finalize orphan-handling UX and relink flow
- [ ] Add migration smoke tests
- [ ] Add telemetry/logging for path resolution failures
- [ ] Enable full interprocess locking/CAS profile
- [ ] Add conflict-handling tests (`catalogVersion`, lock contention)
- [ ] Add transactional rollback tests for Create New/Add Existing
- [ ] Add interprocess lock contention tests (two app instances)

---

## 10. Open Questions

1. **Catalog git tracking** — Should `catalogRoot` be a git repo? Useful for syncing across machines, but adds complexity.

2. **Multi-machine sync** — If user has machines with different folder structures, how do we handle `localPath` differences?

3. **Project deletion** — Delete from catalog only, or also delete folder? Probably catalog-only with confirmation.

4. **Orphaned entries** — If `localPath` no longer exists, show warning badge and offer to remove or re-link.

5. **Collaborative mode scope** — Do we support multi-user shared catalogs in V2, or explicitly single-user only with lock-based protection?
6. **Agent context mechanism** — Currently using "User is viewing:" text prefix to signal context to agents. Future improvement: structured metadata in message payload so OpenClaw gateway can automatically inject project-specific AGENTS.md into agent context. Part of broader OpenClaw SDK / embedding standard.

---

## 11. Success Criteria

- [ ] App runs from standalone location outside sandbox
- [ ] Can track projects across multiple workspace roots
- [ ] "Create New" bootstraps fully congruent project
- [ ] "Add Existing" detects and fixes incongruencies
- [ ] Settings persist and are editable in-app
- [ ] Settings have one canonical source location (no duplicate settings files)
- [ ] Update feature still works
- [ ] OpenClaw chat still works
- [ ] OpenClaw context path is visible and predictable
- [ ] No hardcoded paths in codebase
- [ ] Existing projects migrate seamlessly
- [ ] No ambiguous legacy `localPath` entries can execute writes
- [ ] Add Existing blocks duplicate `id`/`localPath` collisions
- [ ] Create New/Add Existing have tested rollback behavior on mid-flow failures
- [ ] Guardrail tests explicitly verify `untrustedPath`, `staleLinkedStatus`, and `linkedFileChanged` behaviors
- [ ] Recovery gate tests verify reads/writes are blocked until recovery completion
