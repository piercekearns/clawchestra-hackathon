---
title: "Project Architecture Overhaul"
status: draft
type: spec
created: 2026-02-13
phases: 3
---

# Project Architecture Overhaul

Three-phase deliverable that aligns schema, introduces the CHANGELOG lifecycle, and migrates from catalog to scan-based discovery.

## Why This Is One Deliverable

These three pieces are conditional on each other:
- Phase 1 defines the types and docs that Phase 2 implements
- Phase 2 introduces the CHANGELOG pattern that Phase 3 needs for migration (completed items must survive the move)
- Phase 3 eliminates the catalog system entirely

Each phase is independently shippable — the app works after each one — but they must be built in order.

## Reference Documents

- **Scan Paths Architecture Spec**: `docs/specs/scan-paths-architecture-spec.md` (folder layout, PROJECT.md standard, CHANGELOG.md standard, migration plan, tier system)
- **Current AGENTS.md**: Root `AGENTS.md` (needs rewriting — documents old `roadmap/*.md` pattern)
- **Current SCHEMA.md**: `docs/SCHEMA.md` (needs CHANGELOG types, roadmap lifecycle docs)
- **Current schema.ts**: `src/lib/schema.ts` (source of truth for types)
- **Current projects.ts**: `src/lib/projects.ts` (project loading, will need scanner rewrite in Phase 3)
- **Current Rust backend**: `src-tauri/src/lib.rs` (catalog resolution, `get_projects_dir`, `list_files`, legacy mode)
- **Settings**: `~/Library/Application Support/Pipeline Dashboard/settings.json`
- **Catalog**: `~/Library/Application Support/Pipeline Dashboard/catalog/projects/`

---

## Phase 1: Schema & Docs Alignment

**Goal**: Define the target state. No runtime code changes — just types, docs, and validation.

### 1.1 schema.ts Updates

- Add `ChangelogEntry` type:
  ```typescript
  export interface ChangelogEntry {
    id: string;
    title: string;
    completedAt: string; // ISO date
    summary?: string;
    tags?: string[];
  }

  export interface ChangelogDocument {
    filePath: string;
    entries: ChangelogEntry[];
    notes: string;
  }
  ```
- Add `'archived'` to `ProjectStatus` (replaces the concept of "shipped" for projects that are done-done)
- Confirm `RoadmapStatus` stays as `'pending' | 'in-progress' | 'complete'` — no `'shipped'` value
- Add `changelogFilePath?: string` and `hasChangelog?: boolean` to `ProjectViewModel`
- Keep `'shipped'` in `ProjectStatus` for now (board column still exists) but document that roadmap items never use it

### 1.2 SCHEMA.md Rewrite

Sync with schema.ts changes. Add sections for:
- **ROADMAP.md format**: Frontmatter `items:` array (current format), field definitions, valid statuses
- **CHANGELOG.md format**: Frontmatter `entries:` array, field definitions
- **Lifecycle**: `pending → in-progress → complete → (auto-migrate to CHANGELOG)`
- **Paired files rule**: ROADMAP.md and CHANGELOG.md always co-exist
- **Document conventions**: Keep existing spec/plan doc conventions, add CHANGELOG

### 1.3 AGENTS.md Rewrite

Update to reflect current reality:
- **Roadmap operations**: Rewrite for ROADMAP.md frontmatter format (items array in single file, not individual `roadmap/*.md` files)
- **Mark done workflow**: Item status → `complete` → auto-migrated to CHANGELOG.md (not "change status to shipped")
- **Add item workflow**: Add to `items:` array in ROADMAP.md frontmatter
- **Reorder workflow**: Change `priority:` values in ROADMAP.md frontmatter
- **Remove item workflow**: Delete from `items:` array (not a file deletion)
- **CHANGELOG operations**: Read-only for agents unless explicitly asked to edit
- **Paired creation rule**: Document that ROADMAP + CHANGELOG must co-exist
- Keep project operations (catalog CRUD) as-is — Phase 3 changes those

### 1.4 Validation

- No existing functionality should break
- Types are additive (new interfaces, extended existing ones)
- Docs reflect both current state AND target state (mark Phase 2/3 items as "coming soon" or similar)

### Deliverables
- [ ] `schema.ts` — new types + extended interfaces
- [ ] `docs/SCHEMA.md` — rewritten with ROADMAP/CHANGELOG/lifecycle sections
- [ ] `AGENTS.md` — rewritten for ROADMAP.md frontmatter format + CHANGELOG lifecycle
- [ ] Build passes, existing tests pass

---

## Phase 2: CHANGELOG Lifecycle

**Goal**: Implement the ROADMAP → CHANGELOG lifecycle. Works within the current catalog system.

### 2.1 CHANGELOG Parsing

- New file: `src/lib/changelog.ts`
  - `parseChangelog(filePath: string): Promise<ChangelogDocument>`
  - `writeChangelog(filePath: string, doc: ChangelogDocument): Promise<void>`
  - `appendChangelogEntry(filePath: string, entry: ChangelogEntry): Promise<void>`
- Wire into project loading: when `hasRoadmap` is true, also check for CHANGELOG.md in same directory
- Populate `changelogFilePath` and `hasChangelog` on `ProjectViewModel`

### 2.2 Auto-Migration Logic

- New function: `migrateCompletedItem(roadmapPath: string, changelogPath: string, itemId: string): Promise<void>`
  - Reads ROADMAP.md, finds item by id
  - Removes it from `items:` array
  - Appends to CHANGELOG.md `entries:` array with `completedAt: today`
  - `summary` defaults to item's `nextAction` or `title`
  - Writes both files atomically (CHANGELOG first, then ROADMAP)
- Expose as Tauri command or handle in frontend — depends on where status changes happen

### 2.3 Paired Scaffolding

- When creating a ROADMAP.md → also create empty CHANGELOG.md:
  ```yaml
  ---
  entries: []
  ---
  ```
- When ROADMAP.md exists but CHANGELOG.md doesn't → auto-create on first load (or warn in UI)
- Dashboard should surface a gentle warning if the pair is incomplete

### 2.4 Changelog Tab in Project Modal

- New component or extension to `RoadmapItemDetail` / `ProjectModal`
- Tab or section in the modal showing CHANGELOG entries (reverse-chronological)
- Read-only — no editing from the UI
- Shows: title, completedAt date, summary, tags
- Empty state: "No completed items yet"

### 2.5 Status Change Integration

- When a roadmap item's status badge is clicked to `complete`:
  1. Trigger auto-migration
  2. Item disappears from roadmap list
  3. Appears in changelog tab
  4. Toast: "✅ {title} moved to changelog"
- The `useProjectModal` hook needs to handle this state transition

### 2.6 Backfill Existing Completed Items

- Audit current roadmap files for any items already marked as `complete` or `shipped`
- Migrate them to CHANGELOG.md
- For Pipeline Dashboard specifically: move shipped items (Chat UX Overhaul, Chat Drawer UI, etc.) from wherever they are into CHANGELOG.md

### Deliverables
- [ ] `src/lib/changelog.ts` — parse, write, append
- [ ] Auto-migration function
- [ ] Paired scaffolding logic
- [ ] Changelog tab/section in project modal
- [ ] Status change → auto-migrate integration
- [ ] Backfill existing completed items
- [ ] Build passes

---

## Phase 3: Scan Paths Migration

**Goal**: Replace catalog with scan-based discovery. See `docs/specs/scan-paths-architecture-spec.md` for full details.

### 3.1 Settings Schema

- Add `scanPaths: string[]` to settings
- Default: `["/Users/piercekearns/repos", "/Users/piercekearns/projects"]`
- Keep `catalogRoot` temporarily for migration, mark deprecated
- Update `sanitize_settings()` in Rust backend

### 3.2 New Scanner (Rust)

- Replace `get_projects_dir()` + `list_files()` with new scanner:
  - Walk each scan path one level deep
  - For each child directory: look for `PROJECT.md`
  - If found: return the directory path
  - If not found: skip
- Project ID = folder name (not filename)
- Handle duplicate IDs across scan paths (error)
- Detect `.git/` presence for tier inference

### 3.3 Frontend: Project Loading

- Update `getProjects()` in `projects.ts`:
  - No more `catalogRoot` / `getProjectsDir()`
  - Scanner returns list of project directories
  - Read `PROJECT.md` from each (replaces current frontmatter parsing of catalog stubs)
  - Read `ROADMAP.md` + `CHANGELOG.md` from same directory
  - Tier detection: Idea (no .git) / Local (.git, no repo:) / GitHub (has repo:)
- Remove `trackingMode`, `catalog-only`, `linked` concepts — everything is scan-discovered

### 3.4 Physical File Migration

- Create `~/projects/` directory
- For each idea/pre-repo project in catalog:
  - Create `~/projects/{name}/PROJECT.md` with migrated frontmatter
  - Move related content into the folder
- For each repo in `~/repos/`:
  - Create `PROJECT.md` in repo root (if not exists)
  - Ensure ROADMAP.md is in frontmatter format
  - Ensure CHANGELOG.md exists if ROADMAP.md exists
- This can be a migration script or manual + agent-assisted

### 3.5 Frontend: Tier Badges

- Replace current project card badges with tier indicators:
  - 💡 Idea (no .git)
  - 📁 Local (.git, no remote)
  - 🔗 GitHub (has `repo:` field)
- Settings UI for managing scan paths

### 3.6 Cleanup

- Delete all catalog project files (`~/Library/Application Support/Pipeline Dashboard/catalog/projects/`)
- Remove `catalogRoot`, `catalog_entries_dir`, legacy mode from Rust backend
- Remove `trackingMode` from schema
- Remove migration-state.json handling
- Update all documentation references
- Delete `clawdbot-sandbox/projects/` stubs (no longer needed)

### Deliverables
- [ ] Settings schema + UI for `scanPaths`
- [ ] New Rust scanner (one-level-deep PROJECT.md discovery)
- [ ] Updated `getProjects()` for scan-based loading
- [ ] PROJECT.md created in all repos
- [ ] Ideas migrated from catalog to `~/projects/`
- [ ] Tier badges on board cards
- [ ] Catalog + legacy code removed
- [ ] Build passes, all projects visible

---

## Testing Checklist (All Phases)

- [ ] Existing projects still visible on board after each phase
- [ ] Roadmap items render correctly in modal
- [ ] Status badge click → complete → auto-migrates to changelog
- [ ] Changelog tab shows completed items
- [ ] Empty ROADMAP shows "no items" not a crash
- [ ] Empty CHANGELOG shows "no completed items" not a crash
- [ ] DnD reordering still works for roadmap items
- [ ] New project creation scaffolds ROADMAP + CHANGELOG together
- [ ] (Phase 3) Projects discovered from both scan paths
- [ ] (Phase 3) Tier badges render correctly
- [ ] (Phase 3) No references to catalog remain in code

---

## Non-Goals

- Changing the Kanban board columns or project-level statuses (that's separate)
- Git operations from the dashboard beyond what exists
- GitHub repo creation from the dashboard
- Nested/monorepo scanning (future consideration)
