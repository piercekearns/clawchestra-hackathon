# Project Modal Improvements — Spec

> **Status:** LOCKED  
> **Deliverable:** `roadmap/project-modal-improvements.md`  
> **Date:** 2026-02-12

---

## Problem

The current project modal is a flat form. Status, priority, next action, tags, and action buttons dominate the viewport. The project's roadmap items — the thing you actually care about — are hidden behind a "View Roadmap" button that navigates away to a separate Kanban view. There's no way to see or reorder roadmap items inline, no doc badges, and no quick access to spec/plan documents.

When you click a project card, you want to see **status + blockers at a glance** and **roadmap items front and centre**. The current modal doesn't do either well.

## Design Principles

1. **Status at a glance** — compact header with title, clickable status badge, inline blocker alert
2. **Roadmap items are the main content** — reorderable list with dynamic priority labels, not buried behind a button
3. **Docs are discoverable** — small badges per roadmap item indicating presence of spec/plan docs
4. **Details don't disappear** — secondary info (next action, tags, git, sub-projects, parent, actions) moves to a collapsible section, not removed
5. **Horizontal density** — each roadmap card is a single row: priority label + title + status badge + doc badges + drag handle
6. **Responsive** — must remain usable in narrow windows (mobile-width on desktop)

---

## Layout

### 1. Compact Header (always visible)

```
┌────────────────────────────────────────────────────────┐
│ 🏃 Revival Running          [in-flight ▼]         [×] │
│ ⚠️ Blocked by: Waiting on API credentials              │
└────────────────────────────────────────────────────────┘
```

- **Icon + Title** — project icon (if set) and title
- **Status badge** — clickable dropdown to change status inline. Saves immediately (optimistic). Replaces the full-width select.
- **Close button** — top right
- **Blocker** — shown inline beneath title only if `blockedBy` is set; small alert style, not a full form field

### 2. Roadmap Items (main content area — reorderable vertical list)

```
┌────────────────────────────────────────────────────────┐
│  P1  Auth Flow          [up-next] [📄 spec] [📋 plan] ⋮⋮│
│  P2  User Dashboard     [simmering] [📄 spec]        ⋮⋮│
│  P3  Payment Integration [dormant]                   ⋮⋮│
│  P4  Email Notifications [up-next] [📋 plan]          ⋮⋮│
└────────────────────────────────────────────────────────┘
```

- **P1, P2, P3...** — dynamic priority labels that update on reorder (visual position, not stored value)
- **Drag handle** (⋮⋮) on right — same vertical drag-to-reorder behaviour as the Kanban board. No horizontal/column-to-column movement needed. Just vertical reordering within the list.
- **Status badge** per item — small, coloured, clickable to change. Saves immediately (optimistic).
- **Doc badges** — `📄 spec`, `📋 plan`, etc. — only shown if the doc exists. Resolution is **convention-based**: look for `SPEC.md`, `ROADMAP.md`, `PLAN.md` (uppercase) in the project's directory structure. See §Data Requirements.
- **Clicking the item row** → opens the roadmap item detail view (see §3)
- Reordering persists priorities back to the roadmap file (same mechanism as current Kanban reorder)

**For projects without roadmap items:** This section is omitted entirely. The project's own markdown content is shown instead (see §5).

### 3. Roadmap Item Detail View (replaces list when an item is clicked)

```
┌────────────────────────────────────────────────────────┐
│ ← Back to Revival Running          [up-next ▼]        │
├────────────────────────────────────────────────────────┤
│ Auth Flow                                              │
│                                                        │
│ OAuth2-based authentication with JWT refresh tokens.   │
│ Users sign in via provider selection...                │
│ (item summary — the markdown body of the roadmap file) │
│                                                        │
├────────────────────────────────────────────────────────┤
│ [Spec Doc]  [Plan Doc]                                 │
│ ┌──────────────────────────────────────────────────┐   │
│ │ # Auth Flow Spec                                 │   │
│ │ ## Requirements                                  │   │
│ │ ...rendered markdown...                          │   │
│ └──────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────┘
```

- **Back button** — returns to the roadmap list
- **Status badge** — clickable, for the roadmap item (not the parent project). Saves immediately.
- **Summary** — the roadmap item's own markdown content, always shown even when docs exist
- **Doc tabs/toggles** — only shown if docs exist. Tabs for each available doc type (spec, plan). Clicking a tab fetches and renders the markdown file via existing `readFile` Tauri command.
- **If no docs exist** — summary section is the sole content; no empty tabs
- **No animation** — simple replace/swap between list view and detail view. No slide or crossfade for now.

### 4. Collapsible Details Section (below roadmap items)

```
┌────────────────────────────────────────────────────────┐
│ ▸ Details                                              │
├────────────────────────────────────────────────────────┤
│  Next Action: Finalize auth endpoints                  │
│  Tags: frontend, api, auth                             │
│  Last Reviewed: 2026-02-10                             │
│  Git: main (clean) · 3 commits this week               │
│  Sub-projects: [Revival CMS] [Revival Payments]        │
│  Parent: [Revival Fightwear]                           │
│  Files: projects/revival-running.md                    │
│                                                        │
│  [Save] [Delete] [Mark Reviewed] [Commit] [Push]      │
└────────────────────────────────────────────────────────┘
```

- **Collapsed by default** — just shows "▸ Details"
- Contains everything that currently exists in the modal but isn't the primary focus:
  - Next Action (editable)
  - Tags (editable)
  - Blocked By (editable — also surfaced in header when set)
  - Last Reviewed date
  - Git status + commit activity
  - Sub-projects (clickable buttons, open their own modal)
  - Parent link (clickable, opens parent modal)
  - File paths (dashboard file, repo file)
  - Repo-linked / dashboard-only badge
- **Action buttons** — Save, Delete, Mark Reviewed, Commit Planning Docs, Push Repo
  - Commit/Push only shown for projects with `localPath`

### 5. Projects Without Roadmaps

When a project has no roadmap items, the modal simplifies to:

```
┌────────────────────────────────────────────────────────┐
│ 📚 The Restricted Section    [up-next ▼]           [×] │
├────────────────────────────────────────────────────────┤
│ # The Restricted Section                               │
│ Academic outputs outside walled gardens...             │
│ (project's own markdown content rendered)              │
│                                                        │
├────────────────────────────────────────────────────────┤
│ ▸ Details                                              │
└────────────────────────────────────────────────────────┘
```

- Compact header (same as §1)
- Project markdown content (the body of the project's `.md` file, rendered)
- Collapsible details (same as §4)

A project without a roadmap is essentially pre-roadmap — it might just have an overview/ideas doc. The roadmap is what makes a project "real".

---

## Data Requirements

### Existing (no changes needed)
- `ProjectViewModel` already has: `title`, `status`, `blockedBy`, `tags`, `nextAction`, `hasRoadmap`, `roadmapFilePath`, `children`, `frontmatter.parent`, `frontmatter.localPath`, `gitStatus`, `commitActivity`, `content`
- `RoadmapItem` already has: `id`, `title`, `status`, `priority`, `nextAction`, `blockedBy`, `tags`
- `readRoadmap()` / `writeRoadmap()` handle reading and persisting roadmap items

### New / Extended
- **Doc badge resolution (convention-based):**
  - For each roadmap item, check if matching doc files exist in the project's directory
  - Look for uppercase filenames: `SPEC.md`, `ROADMAP.md`, `PLAN.md`
  - Could be at project root or in a `docs/` subdirectory
  - This needs a Tauri command (or extension of existing ones) to check file existence for a set of paths
- **Fetching doc content** — when a user clicks a doc tab in the detail view, read the file via existing `readFile` Tauri command
- **Inline status change** — currently status is a `<select>` in a form. Becomes a clickable badge with a small dropdown/popover. Saves immediately (optimistic). Same for roadmap item statuses.

---

## Decisions (locked)

| Question | Decision |
|----------|----------|
| Reordering library | Same vertical drag behaviour as Kanban board. No horizontal movement needed. |
| Doc badge resolution | Convention-based file lookup. Look for `SPEC.md`, `ROADMAP.md`, `PLAN.md` (uppercase). |
| Transition animation | None for now. Simple view swap. |
| Inline status save | Immediate/optimistic on badge click. |
| Mobile/narrow viewport | Yes — must remain usable in narrow windows. Desktop app but often used in small window sizes. |

---

## Interaction Patterns

| Action | Trigger | Behaviour |
|--------|---------|-----------|
| Change project status | Click status badge in header | Dropdown appears, selection saves immediately |
| Reorder roadmap items | Drag via handle (⋮⋮) | P-labels update live, persist on drop |
| View roadmap item detail | Click item row (not badge/handle) | List replaced by detail view |
| Return to roadmap list | Click "← Back" | Detail view replaced by list |
| Change roadmap item status | Click status badge on item row or detail view | Dropdown, saves immediately |
| View doc | Click doc badge on row OR tab in detail view | In detail view: renders markdown in tab area |
| Edit project fields | Expand Details section | Fields are editable, Save button persists |
| Open sub-project | Click sub-project button in Details | Opens that project's modal (or replaces current) |
| Open parent project | Click parent button in Details | Opens parent's modal |

---

## Out of Scope

- Kanban boards for roadmap items (explicitly ruled out — it's a priority-ordered list)
- Creating new roadmap items from within the modal (use chat or file system)
- Editing roadmap item markdown content inline (read-only render for now)
- Full project markdown editing in the modal

---

## Related: Project Convention Sync (→ Retrofit deliverable)

A broader concern surfaced during scoping: **all projects in the pipeline need to adhere to a consistent folder/file convention**, and that convention needs to stay in sync bidirectionally:

- **Project → Pipeline:** Each project should have agent guidance (e.g. in its own `AGENTS.md`) that ensures agents working on the project don't break pipeline conventions (file naming, frontmatter schema, doc locations).
- **Pipeline → Projects:** When pipeline conventions change (new schema fields, renamed docs), existing projects need to be updated to match.

This is the domain of the **"Retrofit Existing Projects to Schema" (P3)** deliverable, not this one. But this modal depends on conventions being followed — doc badges only work if docs are where we expect them.

---

## Implementation Notes

- The `CardDetail` component (`src/components/CardDetail.tsx`) gets a major rewrite
- Split into sub-components: `ProjectModalHeader`, `RoadmapItemList`, `RoadmapItemDetail`, `ProjectDetails`
- Roadmap data loading: currently `openRoadmapView` in `App.tsx` reads the roadmap. The modal will need to trigger this on open for projects with roadmaps
- Reuse existing `readRoadmap` / `writeRoadmap` for persistence
- Status badge component: new shared component used in header and on each roadmap item row
- Use existing DnD setup from Kanban board for vertical reordering
