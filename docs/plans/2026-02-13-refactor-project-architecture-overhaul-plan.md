---
title: "Project Architecture Overhaul"
type: refactor
date: 2026-02-13
status: draft
phases: 3
estimated_files_changed: ~22
reviewed_by: [dhh-rails-reviewer, kieran-typescript-reviewer, code-simplicity-reviewer]
---

# Project Architecture Overhaul

Replace catalog-based project discovery with scan-based discovery, introduce the CHANGELOG lifecycle, improve the project modal UI, and clean up legacy code.

## Overview

The Pipeline Dashboard currently discovers projects via catalog stubs in `~/Library/Application Support/Pipeline Dashboard/catalog/projects/`. This creates duplication between stubs and actual repos, unclear source of truth, and no proper home for idea-stage projects. This overhaul replaces that system with a scan-based discovery model where the dashboard walks configured folders looking for `PROJECT.md` files.

The overhaul is structured as 3 phases (2 sequential + 1 parallel UI phase):

1. **Phase A: CHANGELOG Lifecycle** — Types, changelog module, migration logic, UI integration, docs
2. **Phase A.5: Project Modal Improvements** — UI overhaul (parallel to Phase A)
3. **Phase B: Scan Migration** — Data retrofit, scanner, settings migration, cleanup

## Problem Statement

**Current pain points:**
- Projects live in two places: catalog stubs in app support dir AND actual code in `~/repos/`
- Catalog stubs go stale — status in stub vs repo PROJECT.md can diverge
- Ideas without repos have no structured home (random .md files in catalog)
- Completed roadmap items have no archive — they just sit with `status: complete` forever
- The `trackingMode` concept (`linked` vs `catalog-only`) adds complexity without value
- AGENTS.md still documents the old `roadmap/*.md` individual file pattern

**Target state:**
- Dashboard scans `~/repos/` and `~/projects/` for `PROJECT.md` files
- Every project follows the same minimal structure regardless of maturity
- Completed roadmap items auto-migrate from ROADMAP.md to CHANGELOG.md
- Project modal shows roadmap items front-and-centre, not buried behind a button
- UI adapts based on what files exist (progressive feature unlocking)

## Technical Approach

### Architecture

```
Before (catalog-based):
  Settings → catalogRoot → list_files() → parse .md stubs → merge with repo PROJECT.md

After (scan-based):
  Settings → scanPaths[] → scan_projects() → find PROJECT.md → parse frontmatter directly
```

The key architectural shift is from **stub resolution** (dashboard owns project identity, repos are optional overlays) to **direct discovery** (filesystem is the source of truth, dashboard renders what it finds).

### Convention Over Configuration

- A project is a folder with `PROJECT.md`. No configuration needed.
- If `ROADMAP.md` exists, show roadmap features. No flag, no toggle.
- If `CHANGELOG.md` exists, show completed items. No auto-creation at runtime.
- If `.git/` exists, show git features.
- If `repo:` is in frontmatter, show GitHub features.
- `~/repos` and `~/projects` are scanned by default. Configurable, but the defaults work.

---

## Phase A: CHANGELOG Lifecycle

**Goal:** Implement the ROADMAP → CHANGELOG auto-migration with types, code, docs, and UI landing together. Works within the current catalog system.

### A.1 Schema Types

**File:** `src/lib/schema.ts`

Add new types:

```typescript
export interface ChangelogEntry {
  id: string;           // Copied from RoadmapItem.id at migration time
  title: string;
  completedAt: string;  // ISO date — validated during parsing
  summary?: string;     // Defaults to item's nextAction or title
}

export interface ChangelogDocument {
  filePath: string;
  entries: ChangelogEntry[];
}
```

Extend existing types:

- Add `'archived'` to `ProjectStatus` union
- **One-step rename:** Do NOT add `archived` alongside `shipped` — the rename happens in Phase B's data work. Phase A only adds the type so Phase B can use it.
- Add to `ProjectViewModel`:
  - `changelogFilePath?: string`
  - `hasChangelog?: boolean`
  - `hasGit?: boolean` (used for tier derivation in Phase B)
- **Decouple `VALID_STATUSES` from `PROJECT_COLUMNS`:** `VALID_STATUSES` is for validation (includes `archived`), `PROJECT_COLUMNS` is for board rendering (excludes `archived`). These must be separate arrays.
- Update `isProjectStatus()` type guard
- Remove `'deliverable'` from `ProjectType` union (dead type — clean up now, not later)

**Pattern:** Use `as const satisfies readonly ProjectStatus[]` for both arrays.

### A.2 Changelog Module

**New file:** `src/lib/changelog.ts`

```typescript
export function sanitizeChangelogEntry(raw: unknown): ChangelogEntry | null
// Reject entries with empty/missing id. Validate completedAt as ISO date.
// Follow sanitizeRoadmapItem() pattern from src/lib/roadmap.ts:14-39.

export async function parseChangelog(filePath: string): Promise<ChangelogDocument>
// Defensive parsing: handle missing 'entries' field, non-array entries,
// entries with missing required fields. Uses sanitizeChangelogEntry().
// Notes/markdown body is ignored (not stored).

export async function writeChangelog(filePath: string, doc: ChangelogDocument): Promise<void>
// Uses gray-matter stringify. Explicit field list (no extra properties).

export async function appendChangelogEntry(filePath: string, entry: ChangelogEntry): Promise<void>
// Reads existing, appends entry to front (reverse-chronological), writes.
// Idempotent: checks if entry with same ID already exists before appending.

export async function migrateCompletedItem(
  roadmapPath: string,
  changelogPath: string,
  itemId: string
): Promise<void>
// 1. If CHANGELOG.md does not exist at changelogPath, create it (empty scaffold)
// 2. Read ROADMAP.md, find item by id
// 3. Check if CHANGELOG already has entry with this id (idempotency guard)
// 4. If not in CHANGELOG: append entry with completedAt = today, summary = nextAction || title
// 5. Remove item from ROADMAP.md items array
// 6. Write CHANGELOG first, then ROADMAP (best-effort ordering)
// 7. If ROADMAP write fails: the item exists in both files; next call is idempotent
// 8. MUST use withMutationRetry pattern from src/lib/project-flows.ts:30-46
```

**Key patterns:**
- The migration function MUST be idempotent. If called twice on the same item, the second call is a no-op.
- MUST use `withMutationRetry` for file-level locking (existing pattern in `project-flows.ts`).
- `sanitizeChangelogEntry()` is a first-class deliverable, not a comment — the idempotency guard depends on valid `id` fields.

### A.3 Wire Into Project Loading

**File:** `src/lib/projects.ts`

In `getProjects()`, after checking for ROADMAP.md, also check for CHANGELOG.md:

```typescript
const changelogPath = `${resolvedPath}/CHANGELOG.md`;
const hasChangelog = await pathExists(changelogPath);
// Populate changelogFilePath and hasChangelog on the view model
```

### A.4 Completed Items in Project Modal

**File:** `src/components/modal/ProjectModal.tsx`

Add a collapsible "Completed (N)" section below the roadmap item list, collapsed by default. When expanded, shows changelog entries in reverse-chronological order.

- Empty state: section hidden (not shown with "0 items")
- Each entry shows: title, completedAt date, summary
- Read-only — no editing from the UI
- No new `ModalView` variant needed — this is inline content, not navigation

### A.5 Status Change Integration

**File:** `src/hooks/useProjectModal.ts`

When a roadmap item's status badge is clicked to `complete`:

1. Call `migrateCompletedItem()` immediately
2. On success: toast "Moved to changelog"
3. On failure: error toast, item stays in roadmap list

No undo window. No optimistic UI. No watcher suppression flag. The filesystem write is single-digit milliseconds — just do it and refresh. The existing 150ms debounce in `watcher.ts` already handles the two-file write without flicker.

**Bifurcation of `updateRoadmapItemStatus`:**
- Status changes to `pending` or `in-progress`: immediate persist (current behavior)
- Status change to `complete`: call `migrateCompletedItem()` instead of `updateRoadmapItemStatus()`

### A.6 Backfill Existing Completed Items

One-time task during Phase A implementation:
- Audit `~/repos/pipeline-dashboard/ROADMAP.md` for items with `status: complete`
- Migrate them to CHANGELOG.md using the new `migrateCompletedItem()` function
- Verify CHANGELOG.md has the expected entries after backfill

### A.7 Documentation Updates

**Files:** `docs/SCHEMA.md`, `AGENTS.md`

Update docs to match the new reality (not speculatively — only document what now works):

- **SCHEMA.md:** Add ROADMAP.md format, CHANGELOG.md format, lifecycle (`pending → in-progress → complete → auto-migrate`)
- **AGENTS.md:** Rewrite roadmap ops for frontmatter format, add mark-done workflow, add CHANGELOG read-only ops

### Phase A Deliverables

- [ ] `src/lib/schema.ts` — ChangelogEntry, ChangelogDocument, archived status, VALID_STATUSES/PROJECT_COLUMNS decoupled, deliverable type removed, hasGit added to ProjectViewModel
- [ ] `src/lib/changelog.ts` — sanitizeChangelogEntry, parseChangelog, writeChangelog, appendChangelogEntry, migrateCompletedItem (with withMutationRetry)
- [ ] `src/lib/changelog.test.ts` — Tests for parsing, sanitization, idempotent migration, edge cases
- [ ] Project loading wired to detect CHANGELOG.md
- [ ] Collapsible "Completed" section in project modal
- [ ] Status change to `complete` triggers immediate migration
- [ ] Backfilled existing completed items
- [ ] `docs/SCHEMA.md` updated with lifecycle docs
- [ ] `AGENTS.md` updated for frontmatter format
- [ ] `pnpm validate` passes

### Phase A Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/lib/schema.ts` | Modify | Add types, decouple VALID_STATUSES/PROJECT_COLUMNS, remove deliverable |
| `src/lib/changelog.ts` | Create | Changelog parsing, sanitization, writing, migration |
| `src/lib/changelog.test.ts` | Create | Tests for parsing, idempotent migration, sanitization |
| `src/lib/projects.ts` | Modify | Wire CHANGELOG detection into project loading |
| `src/hooks/useProjectModal.ts` | Modify | Bifurcate status change: complete triggers migration |
| `src/components/modal/ProjectModal.tsx` | Modify | Collapsible completed items section |
| `docs/SCHEMA.md` | Rewrite | Add lifecycle and format documentation |
| `AGENTS.md` | Rewrite | Update roadmap ops for frontmatter format |
| `ROADMAP.md` | Modify | Backfill completed items to CHANGELOG |
| `CHANGELOG.md` | Modify | Receive backfilled entries |

---

## Phase A.5: Project Modal Improvements

**Goal:** Overhaul the project modal UI to put roadmap items front-and-centre. Runs in parallel with Phase A.

**Reference spec:** `docs/specs/project-modal-improvements-spec.md`

**Coordination note:** Phase A adds a collapsible "Completed" section to the modal. Phase A.5 restructures the modal layout. If Phase A.5 lands after Phase A, it should incorporate the completed section into the new layout. If it lands before, Phase A adds the section to the new layout. Either ordering works — the completed section is self-contained inline content, not a navigation state.

### A.5.1 Compact Header

**File:** `src/components/modal/ProjectModalHeader.tsx`

- Icon + Title
- Clickable status badge (dropdown, saves immediately via optimistic update)
- Close button (top right)
- Blocker alert: shown inline beneath title only if `blockedBy` is set

### A.5.2 Roadmap Items as Main Content

**File:** `src/components/modal/RoadmapItemList.tsx`

Reorderable vertical list:
- P1, P2, P3... dynamic priority labels (visual position, not stored value)
- Status badge per item (clickable, saves immediately)
- Doc badges per item (convention-based: spec, plan) — only shown if doc exists
- Drag handle on right — vertical reorder only, using existing `@dnd-kit` setup
- Click row (not badge/handle) → opens detail view
- Reordering persists to ROADMAP.md via existing `writeRoadmap()`

**Doc badge resolution:** Use existing `resolveDocFiles()` from `src/lib/roadmap.ts:97-210` — it already handles frontmatter overrides, convention paths, and item-specific docs. Do NOT simplify this; the existing resolution is correct and tested.

### A.5.3 Roadmap Item Detail View

**File:** `src/components/modal/RoadmapItemDetail.tsx`

- Back button → returns to list
- Item title + clickable status badge
- Item summary markdown (rendered via react-markdown)
- Doc tabs: only shown if docs exist; clicking a tab fetches and renders the file content via `readFile` Tauri command
- No animation on view transitions

### A.5.4 Collapsible Details Section

**File:** `src/components/modal/ProjectDetails.tsx`

Collapsed by default. Contains:
- Next Action (editable)
- Tags (editable)
- Blocked By (editable — also surfaced in header when set)
- Last Reviewed date
- Git status + commit activity
- Sub-projects (clickable → open their modal)
- Parent link (clickable → open parent modal)
- File paths
- Action buttons: Save, Delete, Mark Reviewed, Commit, Push

### A.5.5 Projects Without Roadmaps

When `hasRoadmap` is false:
- Skip roadmap list entirely
- Show project's markdown content (rendered from `ProjectViewModel.content`)
- Show collapsible details section as usual

### Phase A.5 Deliverables

- [ ] Compact header with clickable status badge
- [ ] Roadmap items as reorderable main content with doc badges
- [ ] Roadmap item detail view with doc tabs
- [ ] Collapsible details section (collapsed by default)
- [ ] Projects without roadmaps show description content
- [ ] Responsive in narrow windows
- [ ] `pnpm validate` passes

### Phase A.5 Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/modal/ProjectModalHeader.tsx` | Modify | Compact header, clickable status badge, blocker alert |
| `src/components/modal/RoadmapItemList.tsx` | Modify | Main content: reorderable list with doc badges |
| `src/components/modal/RoadmapItemRow.tsx` | Modify | Row: P-label + title + status + doc badges + drag handle |
| `src/components/modal/RoadmapItemDetail.tsx` | Modify | Detail view with doc tabs |
| `src/components/modal/ProjectDetails.tsx` | Modify | Collapsible section, collapsed by default |
| `src/components/modal/ProjectModal.tsx` | Modify | Layout orchestration, no-roadmap fallback |
| `src/components/modal/StatusBadge.tsx` | Modify | Clickable dropdown with immediate save |
| `src/hooks/useProjectModal.ts` | Modify | ModalView state management |

---

## Phase B: Scan Migration

**Goal:** Standardize all project data, replace catalog with scan-based discovery, and remove all legacy code. Data retrofit and code migration happen together — no awkward coexistence period.

### B.1 Data Retrofit (prerequisite work)

Before writing scanner code, standardize all project data so the scanner has clean inputs.

#### B.1.1 Create PROJECT.md in Every Repo

For each repo in `~/repos/`:

| Repo | Catalog Source | Notes |
|------|---------------|-------|
| `pipeline-dashboard` | `catalog/projects/pipeline-dashboard.md` | Already has ROADMAP + CHANGELOG |
| `ClawOS` | `catalog/projects/nostr/clawos/CONTEXT.md` | Has IDEAS.md — keep as content |
| `memestr` | `catalog/projects/nostr/memestr.md` | Live on DigitalOcean |
| `Shopify-Fabric-Theme` | `catalog/projects/revival/REVIVAL.md` | Revival Fightwear store |
| `piercekearns.com` | No catalog entry | Needs fresh PROJECT.md |
| `clawd` | `catalog/projects/nostr/clawd.md` | OpenClaw/Clawd bot |

For each:
- Create `PROJECT.md` with frontmatter from catalog stub (title, status, tags, icon, repo, priority)
- Add `type: project`
- Set `lastActivity` to today
- Write brief description in markdown body

#### B.1.2 Convert ROADMAP.md Files to Frontmatter Format

4 repos need conversion from markdown index → YAML frontmatter `items:` array:
- `ClawOS/ROADMAP.md`
- `memestr/ROADMAP.md`
- `Shopify-Fabric-Theme/ROADMAP.md`
- `piercekearns.com/ROADMAP.md`

For each:
1. Read existing markdown content, identify items and their statuses
2. Convert to frontmatter `items:` array matching pipeline-dashboard's format
3. Assign sequential priorities (P1, P2, P3...)
4. Preserve notes as markdown body below frontmatter
5. Items that don't map cleanly to `pending | in-progress | complete` default to `pending`

#### B.1.3 Create CHANGELOG.md Files

For every repo with ROADMAP.md but no CHANGELOG.md:
- Create empty `CHANGELOG.md` with `entries: []` frontmatter
- If old ROADMAP had completed/shipped items, backfill using Phase A's tooling

#### B.1.4 Rename `shipped` → `archived`

One-step rename across all data files:
- Find all PROJECT.md files with `status: shipped`
- Change to `status: archived`
- Done. No coexistence period.

#### B.1.5 Migrate Ideas to `~/projects/`

Create `~/projects/` directory, then for each idea/pre-repo catalog entry:

| Catalog Entry | Target Folder |
|--------------|---------------|
| `ideas/bitchat-research.md` | `~/projects/bitchat-research/PROJECT.md` |
| `ideas/bitcoin-time-machine.md` | `~/projects/bitcoin-time-machine/PROJECT.md` |
| `ideas/btc-folio.md` | `~/projects/btc-folio/PROJECT.md` |
| `nostr/botfather.md` | `~/projects/nostr-botfather/PROJECT.md` |
| `nostr/dating.md` | `~/projects/nostr-dating/PROJECT.md` |
| `nostr/commerce.md` | `~/projects/nostr-commerce/PROJECT.md` |
| `nostr/decentralized-reputation.md` | `~/projects/decentralized-reputation/PROJECT.md` |
| `nostr/distributed-cloudflare.md` | `~/projects/distributed-cloudflare/PROJECT.md` |
| `nostr/miniclip.md` | `~/projects/nostr-miniclip/PROJECT.md` |
| `nostr/white-noise-bots.md` | `~/projects/white-noise-bots/PROJECT.md` |
| `openclaw-browser-extension.md` | `~/projects/openclaw-browser-extension/PROJECT.md` |
| `openclaw-sdk.md` | `~/projects/openclaw-sdk/PROJECT.md` |
| `revival/redbird-app.md` | `~/projects/redbird-app/PROJECT.md` |
| `revival/revival-running.md` | `~/projects/revival-running/PROJECT.md` |
| `the-restricted-section/*.md` | `~/projects/the-restricted-section/PROJECT.md` |

For each: create directory, create `PROJECT.md` with frontmatter from catalog stub, move substantial markdown content into the body.

#### B.1.6 Data Validation

After all data work, run a quick validation:
- [ ] Every repo in `~/repos/` has `PROJECT.md` with valid frontmatter
- [ ] Every `ROADMAP.md` uses frontmatter `items:` format
- [ ] Every `ROADMAP.md` has a paired `CHANGELOG.md`
- [ ] Every idea has a folder in `~/projects/` with `PROJECT.md`
- [ ] No duplicate project IDs between `~/repos/` and `~/projects/`
- [ ] Dashboard still works with existing catalog system (sanity check before cutover)

### B.2 Settings Schema

**Files:** `src/lib/settings.ts`, `src-tauri/src/lib.rs`

- Add `scanPaths: string[]` to `DashboardSettings`
- Default: `["/Users/piercekearns/repos", "/Users/piercekearns/projects"]`
- `scanPaths` replaces `catalogRoot`, `workspaceRoots`, AND `approvedExternalPaths`
- Write operations permitted within any scan path
- **One-step migration:** Update `sanitize_settings()` in Rust — if `scanPaths` is empty/missing, populate from `workspaceRoots` (if present) or fall back to defaults. Remove `catalogRoot`, `workspaceRoots`, `approvedExternalPaths` from the settings struct. No deprecated fields.
- Delete `TrustedPathApproval` interface entirely — unnecessary permissions model for a single-user desktop app

### B.3 New Rust Scanner

**File:** `src-tauri/src/lib.rs`

New Tauri command: `scan_projects(scan_paths: Vec<String>) -> ScanResult`

```rust
struct ScanResult {
    projects: Vec<String>,          // Absolute paths to directories containing PROJECT.md
    skipped: Vec<SkippedDirectory>, // Directories without PROJECT.md (for debugging)
}

struct SkippedDirectory {
    path: String,
    reason: String, // "no PROJECT.md", "permission denied", "not a directory"
}
```

Scanner behaviour:
1. Walk each scan path **one level deep** (direct children only)
2. For each child directory: check for `PROJECT.md` in root
3. If found: include path in `projects`
4. If not found: include in `skipped` with reason
5. Handle gracefully: symlinks (follow), permission denied (skip with warning), non-existent scan path (skip with warning)

**Design decisions (from review):**
- Scanner returns raw directory paths — NO metadata detection (has_git, has_roadmap, has_changelog). That already happens in the frontend `getProjects()`. Single responsibility.
- Scanner returns raw folder names — NO ID normalization in Rust. Frontend `canonicalSlugify()` is the single source of truth for normalization. Prevents divergent implementations.
- Skipped directories are returned for UX debugging ("Why isn't my project showing up?" in settings UI).

Remove: `get_projects_dir()`, `resolve_catalog_entries_dir()`, catalog-specific `list_files()`.

**Tests:** Unit tests in Rust for one-level-deep scanning, permission-denied handling, symlink following, non-existent scan path handling.

### B.4 DashboardError New Variants

**File:** `src/lib/errors.ts`

Add to the discriminated union:

```typescript
| { type: 'duplicate_project_id'; id: string; paths: string[] }
| { type: 'scan_path_missing'; path: string }
| { type: 'scan_path_permission_denied'; path: string }
```

Remove `repo_status_missing` (obsolete — no more catalog stubs with `localPath`).

### B.5 Frontend: Project Loading Rewrite

**File:** `src/lib/projects.ts`

Rewrite `getProjects()`:
1. Call `scan_projects(scanPaths)` to get directory paths
2. For each directory: read `PROJECT.md`, parse frontmatter
3. Normalize folder name via `canonicalSlugify()` → project ID
4. Detect duplicates: if two directories produce the same ID, surface `DashboardError` with type `duplicate_project_id`
5. Check for ROADMAP.md, CHANGELOG.md, `.git/` in each directory
6. Tier derivation in the component (not a stored field):
   ```typescript
   // In Card.tsx — derive, don't store
   const tier = project.hasRepo ? 'github' : project.hasGit ? 'local' : 'idea';
   ```

Remove: `trackingMode`, `catalog-only` concept, `linked` concept, `REPO_OWNED_FIELDS`, catalog stub merging, `cachedStatus`/`cachedNextAction`/`cachedGitStatus`/`cachedBranch`/`cacheUpdatedAt`, `localPath` from `ProjectFrontmatter`.

### B.6 Rewrite `validateProject()`

**File:** `src/lib/schema.ts`

This is a **core migration task**, not cleanup. The current validator calls `resolveTrackingMode()` which no longer exists. Rewrite to validate scan-discovered projects:
- Require: `title`, `type`, `status`
- Validate `status` against `VALID_STATUSES` (which now includes `archived`)
- `in-flight` still requires `priority`
- `sub-project` still requires `parent`
- Remove: `trackingMode` validation, `catalog-only` vs `linked` branches, `localPath` requirement

Remove from schema: `trackingMode`, `ProjectTrackingMode`, `catalogVersion`, all cache fields, `shipped` from `ProjectStatus` union, `shipped` from `VALID_STATUSES`.

### B.7 Tier Badges on Cards

**File:** `src/components/Card.tsx`

Replace current "Repo-linked" / "Dashboard-only" badges. Derive tier inline:

```typescript
const tier = project.hasRepo ? 'github' : project.hasGit ? 'local' : 'idea';
// Render: "Idea" | "Local" | "GitHub"
```

No `ProjectTier` type, no `tier` field on `ProjectViewModel`. Derive in the component from `hasRepo` and `hasGit`.

### B.8 Settings UI for Scan Paths

**File:** `src/components/SettingsDialog.tsx`

- Replace `catalogRoot` / `workspaceRoots` inputs with `scanPaths` list
- Add/remove scan paths with folder picker
- Reorder via drag or up/down arrows
- Show skipped directories from last scan (for debugging)
- Changes trigger `loadProjects()` reload

### B.9 File Watcher Update

**File:** `src/lib/watcher.ts`

Replace single-directory watch with multi-path watch:
- Watch each scan path with `recursive: true`
- Filter out noise: `node_modules`, `.git`, `target`, `dist` directories
- Same 150ms debounce pattern
- Cleanup function unwatches all paths

### B.10 Cleanup

- Delete all catalog project files: `~/Library/Application Support/Pipeline Dashboard/catalog/projects/`
- Delete old `roadmap/*.md` individual files from catalog
- Remove from Rust backend: `catalogRoot`, `catalog_entries_dir`, `resolve_catalog_entries_dir()`, legacy mode detection, `migration-state.json` handling
- Remove from projects.ts: `REPO_OWNED_FIELDS`, merge logic, catalog stub parsing, `pathExists()` function (scanner provides this info)
- Update all documentation references
- Delete `clawdbot-sandbox/projects/` stubs

### Phase B Deliverables

- [ ] All 6 repos have valid `PROJECT.md`
- [ ] 4 ROADMAP.md files converted to frontmatter format
- [ ] 5 CHANGELOG.md files created (paired with ROADMAP)
- [ ] `shipped` renamed to `archived` across all data files
- [ ] `~/projects/` directory created with all idea folders
- [ ] Settings schema: `scanPaths` replaces catalogRoot + workspaceRoots + approvedExternalPaths (one-step migration, no deprecated fields)
- [ ] `TrustedPathApproval` deleted
- [ ] New Rust `scan_projects` command with skipped directory reporting
- [ ] Rust scanner unit tests
- [ ] `DashboardError` new variants (duplicate_project_id, scan_path_missing, scan_path_permission_denied)
- [ ] `getProjects()` rewritten for scan-based loading with frontend-side ID normalization and duplicate detection
- [ ] `validateProject()` rewritten (no trackingMode, no localPath)
- [ ] `shipped` removed from `ProjectStatus`, "Shipped" column removed
- [ ] Tier badges on board cards (derived inline, not stored)
- [ ] Settings UI for scanPaths with skipped directory feedback
- [ ] File watcher updated for multi-path watching
- [ ] All catalog + legacy code removed
- [ ] `pnpm validate` passes, all projects visible from scan paths

### Phase B Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src-tauri/src/lib.rs` | Modify | New scanner command, remove catalog code, update settings, delete TrustedPathApproval |
| `src/lib/settings.ts` | Modify | scanPaths replaces catalogRoot + workspaceRoots + approvedExternalPaths |
| `src/lib/projects.ts` | Rewrite | Scan-based loading, frontend ID normalization, remove merge logic |
| `src/lib/schema.ts` | Modify | Remove trackingMode, cache fields, shipped, localPath; rewrite validateProject |
| `src/lib/schema.test.ts` | Modify | Update validation tests for new schema |
| `src/lib/errors.ts` | Modify | Add duplicate_project_id, scan_path_missing, scan_path_permission_denied; remove repo_status_missing |
| `src/lib/project-flows.ts` | Modify | Update workspace boundary checks to use scanPaths |
| `src/lib/watcher.ts` | Modify | Multi-path watching |
| `src/components/Card.tsx` | Modify | Tier badges (derived inline) |
| `src/components/SettingsDialog.tsx` | Modify | scanPaths UI with skipped dir feedback |
| `src/components/Header.tsx` | Modify | Remove catalog-specific UI if any |
| `src/lib/store.ts` | Modify | Remove catalog-related state if any |
| `AGENTS.md` | Modify | Update for scan-based discovery |
| `docs/SCHEMA.md` | Modify | Remove trackingMode, document tiers |

---

## Acceptance Criteria

### Functional Requirements

- [ ] Projects appear on the board after each phase (no regressions)
- [ ] Roadmap items render correctly in the modal
- [ ] Status badge click on roadmap item → `complete` → immediate migration to CHANGELOG → success toast
- [ ] Completed items section shows entries in reverse-chronological order
- [ ] Empty ROADMAP/CHANGELOG show appropriate empty states (no crashes)
- [ ] DnD reordering works for roadmap items in the modal
- [ ] (Phase B) All 6 repos have valid `PROJECT.md`
- [ ] (Phase B) All ROADMAP.md files parse in frontmatter format
- [ ] (Phase B) Ideas in `~/projects/` have valid `PROJECT.md`
- [ ] (Phase B) Projects discovered from both `~/repos/` and `~/projects/`
- [ ] (Phase B) Tier badges render correctly (Idea/Local/GitHub)
- [ ] (Phase B) No references to catalog remain in code
- [ ] (Phase B) `archived` replaces `shipped` across all data and UI

### Non-Functional Requirements

- [ ] All file write operations use mutation locking (existing pattern preserved)
- [ ] Migration function is idempotent (safe to call twice on same item)
- [ ] `migrateCompletedItem` uses `withMutationRetry` pattern
- [ ] File watcher 150ms debounce prevents thrashing during multi-file writes (no additional suppression needed)
- [ ] Parallel I/O via `Promise.all` for independent reads (existing pattern preserved)
- [ ] Scanner performance: acceptable with 50+ directories across scan paths

### Quality Gates

- [ ] `pnpm validate` passes after each phase (typecheck + test + build)
- [ ] New tests for: changelog parsing/sanitization, migration idempotency, Rust scanner
- [ ] Existing tests still pass (schema, hierarchy, gateway, project-flows)
- [ ] No `as` type casts on untrusted data (validate first — per REVIEW-FIXES.md Fix #4)

---

## Dependencies & Prerequisites

### Phase Dependencies

```
Phase A (Changelog Lifecycle)     Phase A.5 (Modal Improvements)
  ↓ (lifecycle working)              ↓ (modal redesigned)
  ↓                                   ↓
Phase B (Scan Migration)          ← Uses Phase A's tooling for backfill
                                  ← Incorporates Phase A.5's layout
```

Phase A and A.5 can run in parallel. Phase B depends on both being complete.

### Technical Dependencies

- `gray-matter` — Frontmatter parsing/writing (no change needed)
- `@dnd-kit/core` + `@dnd-kit/sortable` — Existing DnD for modal reordering (reuse)
- Tauri 2.8 — Rust backend for scanner and file ops (no version change needed)

### External Dependencies

None. This is entirely internal refactoring.

---

## Risk Analysis & Mitigation

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Data loss during Phase B conversion | High | Low | All repos have git history; catalog preserved until cleanup step |
| CHANGELOG migration half-completes | Medium | Low | Idempotent migration with withMutationRetry; check-before-append |
| Scanner misses projects due to ID normalization | Medium | Medium | Frontend canonicalSlugify() is single source of truth; scanner returns skipped dirs for debugging |
| `shipped` → `archived` one-step rename misses a file | Low | Low | Validation checklist catches it; git grep to verify |
| Performance regression with multi-path scanning | Low | Low | One-level-deep scan is O(N) directory entries, very fast |

---

## Resolved Design Decisions

| # | Decision | Resolution |
|---|----------|------------|
| 1 | `shipped` → `archived` transition | One-step rename in Phase B data work. No coexistence. |
| 2 | `archived` board column | No — filtered from board, visible via search |
| 3 | Partial migration failure | Idempotent migration with withMutationRetry |
| 4 | Folder name → project ID normalization | Frontend canonicalSlugify() only — Rust returns raw paths |
| 5 | Accidental `complete` click | Immediate migration, no undo window. Deliberate click is sufficient. |
| 6 | Completed items placement in modal | Collapsible section below roadmap list, not a tab bar |
| 7 | Settings migration | One-step: scanPaths replaces catalogRoot + workspaceRoots. No deprecated fields. |
| 8 | File watcher after Phase B | Watch each scan path with recursive: true, skip noise dirs. 150ms debounce sufficient. |
| 9 | ROADMAP conversion method | Manual, one-off conversion by developer |
| 10 | Missing CHANGELOG at migration time | Create on the fly in migrateCompletedItem(). No runtime auto-scaffolding on load. |
| 11 | `type: deliverable` | Remove in Phase A. Don't ship new tech debt. |
| 12 | Priority requirement for in-flight | Keep existing validation rule |
| 13 | Changelog entry editability | Read-only in UI |
| 14 | Watcher suppression during migration | Not needed — 150ms debounce handles it |
| 15 | `localPath` after Phase B | Removed from ProjectFrontmatter — scanner provides directory path |
| 16 | `TrustedPathApproval` | Deleted entirely — unnecessary for single-user app |
| 17 | `ChangelogEntry.tags` | Omitted — not actionable in the UI |
| 18 | `ChangelogDocument.notes` | Omitted — markdown body carries no semantic content |
| 19 | Changelog entry validation | sanitizeChangelogEntry() is a first-class deliverable |
| 20 | `VALID_STATUSES` vs `PROJECT_COLUMNS` | Decoupled — separate arrays for validation vs rendering |

---

## Non-Goals

- Changing Kanban board columns or project-level statuses (beyond shipped→archived)
- Git operations from dashboard beyond what exists
- GitHub repo creation from dashboard
- Nested/monorepo scanning (future consideration)
- Moving repos between `~/projects/` and `~/repos/` automatically
- Creating new roadmap items from within the modal
- Editing roadmap item markdown content inline

---

## References

### Internal References

- **Overhaul spec:** `docs/specs/project-architecture-overhaul-spec.md`
- **Scan paths spec:** `docs/specs/scan-paths-architecture-spec.md`
- **Modal improvements spec:** `docs/specs/project-modal-improvements-spec.md`
- **Schema types:** `src/lib/schema.ts`
- **Project loading:** `src/lib/projects.ts`
- **Roadmap parsing:** `src/lib/roadmap.ts`
- **Validation:** `src/lib/schema.ts` (validateProject)
- **Mutation locking:** `src-tauri/src/lib.rs` (acquire_mutation_lock_at)
- **Mutation retry:** `src/lib/project-flows.ts` (withMutationRetry)
- **Settings:** `src-tauri/src/lib.rs` (DashboardSettings, sanitize_settings)
- **Errors:** `src/lib/errors.ts` (DashboardError discriminated union)
- **Review fixes:** `REVIEW-FIXES.md`
- **File watcher:** `src/lib/watcher.ts`
- **Hierarchy builder:** `src/lib/hierarchy.ts`
- **Project flows:** `src/lib/project-flows.ts` (canonicalSlugify)

### Key Patterns to Preserve

- `BoardItem` generic contract (Board/Column/Card are agnostic)
- `ValidationResult` discriminated union
- Mutation locking on all write operations (`withMutationRetry`)
- Read-parse-mutate-validate-write cycle via gray-matter
- `Promise.all` for parallel independent I/O
- `as const satisfies` for compile-time enum safety
- Debounced file watching (150ms)
- `typedInvoke` type-safe Tauri command invocation
- `sanitize*()` pattern for defensive parsing of untrusted data
