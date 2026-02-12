# Project Modal Improvements — Spec

> **Status:** DRAFT — awaiting final scope confirmation  
> **Deliverable:** `roadmap/project-modal-improvements.md`  
> **Date:** 2026-02-12

---

## Problem

The current project modal is a flat form. Status, priority, next action, tags, and action buttons dominate the viewport. The project's roadmap items — the thing you actually care about — are hidden behind a "View Roadmap" button that navigates away to a separate Kanban view. There's no way to see or reorder roadmap items inline, no doc badges, and no quick access to spec/plan documents.

When you click a project card, you want to see **status + blockers at a glance** and **roadmap items front and centre**. The current modal doesn't do either well.

## Design Principles

1. **Status at a glance** — compact header with title, clickable status badge, inline blocker alert
2. **Roadmap items are the main content** — reorderable list with dynamic priority labels, not buried behind a button
3. **Docs are discoverable** — small badges per roadmap item indicating presence of spec/plan/other docs
4. **Details don't disappear** — secondary info (next action, tags, git, sub-projects, parent, actions) moves to a collapsible section, not removed
5. **Horizontal density** — each roadmap card is a single row: priority label + title + status badge + doc badges + drag handle

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
- **Status badge** — clickable dropdown to change status inline (replaces the full-width select)
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

- **P1, P2, P3...** — dynamic priority labels that update on reorder (not stored priority, but visual position)
- **Drag handle** (⋮⋮) on right for reordering
- **Status badge** per item — small, coloured, clickable to change
- **Doc badges** — `📄 spec`, `📋 plan`, etc. — only shown if the doc exists (derived from `specDoc`, `planDoc` fields in roadmap item frontmatter or file existence in `docs/`)
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
- **Status badge** — clickable, for the roadmap item (not the parent project)
- **Summary** — the roadmap item's own markdown content, always shown even when docs exist
- **Doc tabs/toggles** — only shown if docs exist. Tabs for each available doc type (spec, plan, roadmap doc). Clicking a tab fetches and renders the markdown file
- **If no docs exist** — summary section is the sole content; no empty tabs

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
- Contains everything that currently exists in the modal but Pierce didn't prioritise:
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

---

## Data Requirements

### Existing (no changes needed)
- `ProjectViewModel` already has: `title`, `status`, `blockedBy`, `tags`, `nextAction`, `hasRoadmap`, `roadmapFilePath`, `children`, `frontmatter.parent`, `frontmatter.localPath`, `gitStatus`, `commitActivity`, `content`
- `RoadmapItem` already has: `id`, `title`, `status`, `priority`, `nextAction`, `blockedBy`, `tags`
- `readRoadmap()` / `writeRoadmap()` handle reading and persisting roadmap items

### New / Extended
- **Doc badges on roadmap items** — need to resolve whether a roadmap item has associated docs. Options:
  - (a) Add `specDoc` / `planDoc` fields to roadmap item frontmatter (like projects already have)
  - (b) Convention-based: check if `docs/specs/{item-id}*.md` or `docs/plans/{item-id}*.md` exists
  - **TBD** — leaning toward (a) for explicitness, with (b) as fallback
- **Fetching doc content** — when a user clicks a doc tab in the detail view, we need to read the file. This uses existing `readFile` Tauri command
- **Inline status change** — currently status is a `<select>` in a form. Needs to become a clickable badge with a small dropdown/popover. Same for roadmap item statuses

---

## Interaction Patterns

| Action | Trigger | Behaviour |
|--------|---------|-----------|
| Change project status | Click status badge in header | Dropdown appears, selection saves immediately |
| Reorder roadmap items | Drag via handle (⋮⋮) | P-labels update live, persist on drop |
| View roadmap item detail | Click item row (not badge/handle) | List slides out, detail view slides in |
| Return to roadmap list | Click "← Back" | Detail slides out, list slides back |
| Change roadmap item status | Click status badge on item row or detail view | Dropdown, saves immediately |
| View doc | Click doc badge on row OR tab in detail view | In detail view: renders markdown in tab area |
| Edit project fields | Expand Details section | Fields are editable, Save button persists |
| Open sub-project | Click sub-project button in Details | Opens that project's modal (or replaces current) |
| Open parent project | Click parent button in Details | Opens parent's modal |

---

## Open Questions

1. **Roadmap item reordering library** — current board uses a Kanban DnD setup. For a vertical reorderable list inside the modal, do we use the same library or something lighter (e.g. `@dnd-kit/sortable`)?
2. **Doc badge resolution** — frontmatter fields (a) vs convention-based file lookup (b)? Leaning (a).
3. **Slide animation** — item list → detail view transition. Simple crossfade, or horizontal slide?
4. **Inline status save** — should clicking a status badge save immediately (optimistic) or require the Save button? Leaning immediate for both project and roadmap item status.
5. **Mobile/narrow viewport** — any considerations? The dashboard is a Tauri desktop app, so probably not critical.

---

## Out of Scope

- Kanban boards for roadmap items (explicitly ruled out — it's a priority-ordered list)
- Creating new roadmap items from within the modal (use chat or file system)
- Editing roadmap item markdown content inline (read-only render for now)
- Full project markdown editing in the modal

---

## Implementation Notes

- The `CardDetail` component (`src/components/CardDetail.tsx`) gets a major rewrite
- May split into sub-components: `ProjectModalHeader`, `RoadmapItemList`, `RoadmapItemDetail`, `ProjectDetails`
- Roadmap data loading: currently `openRoadmapView` in `App.tsx` reads the roadmap. The modal will need to trigger this on open for projects with roadmaps
- Reuse existing `readRoadmap` / `writeRoadmap` for persistence
- Status badge component: new shared component used in header and on each roadmap item row
