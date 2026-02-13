---
title: "Project Architecture Overhaul"
status: draft
type: spec
created: 2026-02-13
phases: 4
---

# Project Architecture Overhaul

Three-phase deliverable that aligns schema, introduces the CHANGELOG lifecycle, and migrates from catalog to scan-based discovery.

## Why This Is One Deliverable

These four pieces are conditional on each other:
- Phase 1 defines the types and docs that Phase 2 implements
- Phase 2 introduces the CHANGELOG pattern that Phase 3 needs
- Phase 3 retrofits every existing project's data to match the schema (PROJECT.md, ROADMAP.md conversion, CHANGELOG pairing) — prep work for Phase 4
- Phase 4 replaces the catalog system with scan-based discovery

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

## Phase 3: Data Retrofit

**Goal**: Bring every existing project into compliance with the schema defined in Phase 1 and the CHANGELOG lifecycle built in Phase 2. This is the prep work that ensures Phase 4's scanner has clean data to discover.

### Current State (Audit: 2026-02-13)

**Repos in `~/repos/` (6):**
| Repo | PROJECT.md | ROADMAP.md | ROADMAP Format | CHANGELOG.md |
|------|-----------|-----------|----------------|-------------|
| pipeline-dashboard | ❌ | ✅ | ✅ frontmatter | ✅ (populated) |
| ClawOS | ❌ | ✅ | ❌ markdown | ❌ |
| memestr | ❌ | ✅ | ❌ markdown | ❌ |
| Shopify-Fabric-Theme | ❌ | ✅ | ❌ markdown | ❌ |
| piercekearns.com | ❌ | ✅ | ❌ markdown | ❌ |
| clawd | ❌ | ❌ | N/A | ❌ |

**Catalog entries (25 .md files):**
- 3 idea files (`ideas/bitchat-research.md`, `bitcoin-time-machine.md`, `btc-folio.md`)
- 11 nostr files (memestr, clawos, botfather, dating, reputation, etc.)
- 2 openclaw files (browser-extension, sdk)
- 1 pipeline-dashboard.md + 11 old `roadmap/*.md` individual files
- 3 revival files (REVIVAL.md, redbird-app.md, revival-running.md)
- 4 restricted-section files
- Frontmatter quality: generally good (title/status/type present)

### 3.1 Create PROJECT.md in Every Repo

For each repo in `~/repos/`, create `PROJECT.md` with frontmatter migrated from the corresponding catalog stub:

| Repo | Catalog Source | Notes |
|------|---------------|-------|
| `pipeline-dashboard` | `catalog/projects/pipeline-dashboard.md` | Already has ROADMAP + CHANGELOG |
| `ClawOS` | `catalog/projects/nostr/clawos/CONTEXT.md` | Has IDEAS.md too — keep as content |
| `memestr` | `catalog/projects/nostr/memestr.md` | Live on DigitalOcean |
| `Shopify-Fabric-Theme` | `catalog/projects/revival/REVIVAL.md` | Revival Fightwear store |
| `piercekearns.com` | No catalog entry found | Personal site, needs fresh PROJECT.md |
| `clawd` | `catalog/projects/nostr/clawd.md` or similar | OpenClaw/Clawd bot |

For each:
- Copy frontmatter fields (title, status, tags, icon, repo, priority)
- Add `type: project`
- Set `lastActivity` to today
- Write a brief description in the markdown body
- **Do not delete the catalog entry yet** — Phase 4 handles that

### 3.2 Convert ROADMAP.md Files to Frontmatter Format

4 repos need conversion from markdown index format → YAML frontmatter `items:` array:
- `ClawOS/ROADMAP.md`
- `memestr/ROADMAP.md`
- `Shopify-Fabric-Theme/ROADMAP.md`
- `piercekearns.com/ROADMAP.md`

For each:
1. Read existing markdown content, extract item names/statuses
2. Convert to frontmatter `items:` array format (matching pipeline-dashboard's format)
3. Assign sequential priorities
4. Preserve any notes as markdown body below frontmatter

### 3.3 Create Paired CHANGELOG.md Files

For every repo that has ROADMAP.md but no CHANGELOG.md (5 repos):
- Create `CHANGELOG.md` with empty entries array:
  ```yaml
  ---
  entries: []
  ---
  # {Project Name} — Changelog
  ```
- If the old ROADMAP.md had items marked as shipped/complete/done, migrate those to the new CHANGELOG.md using Phase 2's auto-migration tooling

### 3.4 Migrate Ideas to `~/projects/`

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
| `the-restricted-section/*.md` | `~/projects/the-restricted-section/PROJECT.md` (consolidate) |
| `nostr/botfather-architecture.md` | Merge into botfather's PROJECT.md as content |
| `nostr/RESEARCH.md` | Merge into decentralized-reputation or keep as docs |

For each:
- Create the `~/projects/{name}/` directory
- Create `PROJECT.md` with frontmatter migrated from catalog stub
- Move any substantial markdown content into the body
- Related files (architecture docs, research notes) go into `docs/` subfolder
- **Do not delete catalog entries yet** — Phase 4 handles that

### 3.5 Clean Up Old Roadmap Individual Files

The 11 old `catalog/projects/pipeline-dashboard/roadmap/*.md` files are superseded by the repo's `ROADMAP.md` frontmatter format. Verify no unique content is lost, then mark for deletion in Phase 4.

### 3.6 Validate

After all data work:
- Every repo in `~/repos/` has `PROJECT.md` with valid frontmatter
- Every `ROADMAP.md` uses frontmatter `items:` format
- Every `ROADMAP.md` has a paired `CHANGELOG.md`
- Every idea has a folder in `~/projects/` with `PROJECT.md`
- The existing catalog+dashboard still works (we haven't changed any code, just added files)
- No duplicate project IDs between `~/repos/` and `~/projects/`

### Deliverables
- [ ] `PROJECT.md` created in all 6 repos
- [ ] 4 ROADMAP.md files converted to frontmatter format
- [ ] 5 CHANGELOG.md files created (paired with ROADMAP)
- [ ] Shipped items backfilled into changelogs
- [ ] `~/projects/` directory created with all idea folders
- [ ] All PROJECT.md files validated against schema
- [ ] Old catalog still works (no code changes in this phase)
- [ ] Migration script or checklist for repeatability

---

## Phase 4: Scan Paths Migration

**Goal**: Replace catalog with scan-based discovery. See `docs/specs/scan-paths-architecture-spec.md` for full details. Phase 3's data work means the scanner has clean, validated data to find.

### 4.1 Settings Schema

- Add `scanPaths: string[]` to settings
- Default: `["/Users/piercekearns/repos", "/Users/piercekearns/projects"]`
- Keep `catalogRoot` temporarily for migration, mark deprecated
- Update `sanitize_settings()` in Rust backend

### 4.2 New Scanner (Rust)

- Replace `get_projects_dir()` + `list_files()` with new scanner:
  - Walk each scan path **one level deep** (direct children only)
  - For each child directory: look for `PROJECT.md`
  - If found: return the directory path
  - If not found: skip
- Project ID = folder name (not filename)
- Handle duplicate IDs across scan paths (error)
- Detect `.git/` presence for tier inference

### 4.3 Frontend: Project Loading

- Update `getProjects()` in `projects.ts`:
  - No more `catalogRoot` / `getProjectsDir()`
  - Scanner returns list of project directories
  - Read `PROJECT.md` from each (replaces current frontmatter parsing of catalog stubs)
  - Read `ROADMAP.md` + `CHANGELOG.md` from same directory
  - Tier detection: Idea (no .git) / Local (.git, no repo:) / GitHub (has repo:)
- Remove `trackingMode`, `catalog-only`, `linked` concepts — everything is scan-discovered

### 4.4 Frontend: Tier Badges

- Replace current project card badges with tier indicators:
  - 💡 Idea (no .git)
  - 📁 Local (.git, no remote)
  - 🔗 GitHub (has `repo:` field)
- Settings UI for managing scan paths

### 4.5 Cleanup

- Delete all catalog project files (`~/Library/Application Support/Pipeline Dashboard/catalog/projects/`)
- Delete old `roadmap/*.md` individual files from catalog
- Remove `catalogRoot`, `catalog_entries_dir`, legacy mode from Rust backend
- Remove `trackingMode` from schema
- Remove `migration-state.json` handling
- Update all documentation references
- Delete `clawdbot-sandbox/projects/` stubs (no longer needed)

### Deliverables
- [ ] Settings schema + UI for `scanPaths`
- [ ] New Rust scanner (one-level-deep PROJECT.md discovery)
- [ ] Updated `getProjects()` for scan-based loading
- [ ] Tier badges on board cards
- [ ] Catalog + legacy code removed
- [ ] Build passes, all projects visible from scan paths

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
- [ ] (Phase 3) All repos have valid PROJECT.md
- [ ] (Phase 3) All ROADMAP.md files parse correctly in frontmatter format
- [ ] (Phase 3) All ROADMAP.md files have paired CHANGELOG.md
- [ ] (Phase 3) Ideas in `~/projects/` have valid PROJECT.md
- [ ] (Phase 3) Existing dashboard still works with catalog (no code changes)
- [ ] (Phase 4) Projects discovered from both scan paths
- [ ] (Phase 4) Tier badges render correctly
- [ ] (Phase 4) No references to catalog remain in code

---

## Non-Goals

- Changing the Kanban board columns or project-level statuses (that's separate)
- Git operations from the dashboard beyond what exists
- GitHub repo creation from the dashboard
- Nested/monorepo scanning (future consideration)
