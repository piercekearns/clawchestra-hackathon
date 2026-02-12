# Project Modal Improvements — Implementation Plan

> **Spec:** `docs/specs/project-modal-improvements-spec.md` (LOCKED)  
> **Date:** 2026-02-12  
> **Status:** Ready for build

---

## Overview

Major rewrite of `CardDetail.tsx` into a multi-component modal that puts roadmap items front-and-centre, replaces form-style fields with inline status badges, and adds convention-based doc discovery.

**Current state:** Single 280-line `CardDetail` component with flat form layout (select dropdowns, text inputs, save button).

**Target state:** 5 new components, inline-optimistic status updates, DnD reordering within modal, doc badge resolution, and a two-view system (roadmap list ↔ item detail).

---

## Architecture

### Component Tree

```
CardDetail (orchestrator — manages view state, data loading)
├── ProjectModalHeader (compact header: icon + title + status badge + close + blocker)
├── RoadmapItemList (DnD vertical list with P-labels, status badges, doc badges)
│   └── RoadmapItemRow (single row: drag handle + P-label + title + status + doc badges)
├── RoadmapItemDetail (back button + item summary + doc tabs with rendered markdown)
├── ProjectDetails (collapsible section: fields, metadata, action buttons)
└── StatusBadge (shared: clickable badge → dropdown → optimistic save)
```

### New Files

| File | Purpose |
|------|---------|
| `src/components/modal/ProjectModalHeader.tsx` | Compact header with inline status |
| `src/components/modal/RoadmapItemList.tsx` | DnD vertical list of roadmap items |
| `src/components/modal/RoadmapItemRow.tsx` | Single sortable row |
| `src/components/modal/RoadmapItemDetail.tsx` | Item detail view with doc tabs |
| `src/components/modal/ProjectDetails.tsx` | Collapsible details section |
| `src/components/modal/StatusBadge.tsx` | Reusable clickable status dropdown |
| `src/components/modal/DocBadge.tsx` | Small badge linking to spec/plan docs |
| `src/components/modal/index.ts` | Barrel export |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/CardDetail.tsx` | Gutted and rebuilt as orchestrator — delegates to sub-components |
| `src/App.tsx` | Pass `readRoadmap` data into `CardDetail` on open; add new callbacks for inline status save and roadmap reorder |
| `src/lib/schema.ts` | Add `docFiles` to `RoadmapItem` type; add `RoadmapItemDocFiles` interface |
| `src/lib/roadmap.ts` | Extend to support doc file resolution |
| `src/lib/tauri.ts` | Add `checkFilesExist` binding (batch file existence check) |
| `src/lib/projects.ts` | No changes needed — existing `updateProject` handles inline saves |

### Tauri Backend

| Command | Purpose |
|---------|---------|
| `check_files_exist` | Takes `Vec<String>` paths, returns `Vec<bool>` — needed for doc badge resolution without N serial roundtrips |

---

## Phases

### Phase 1: Foundation (StatusBadge + ProjectModalHeader)

**Goal:** Replace the select dropdown with a clickable inline status badge that saves immediately.

**Steps:**
1. Create `StatusBadge.tsx` — a clickable badge that opens a small dropdown/popover of status options. On select: calls `onStatusChange(newStatus)` and closes. Visual: uses existing `Badge` component variants, adds a chevron indicator and hover state.
2. Create `ProjectModalHeader.tsx` — renders icon + title + `StatusBadge` + close button. Below title: conditional blocker alert (`⚠️ Blocked by: ...`) only when `blockedBy` is set.
3. Wire into `CardDetail.tsx` — replace the header `<div>` and status `<select>` with `ProjectModalHeader`. Status changes call `onSave(project, { status })` directly (optimistic — update local state immediately, fire save in background).

**Test:** Click status badge → dropdown appears → select new status → badge updates instantly → file persists.

### Phase 2: Roadmap Data Loading

**Goal:** Load roadmap items when the modal opens (instead of requiring "View Roadmap" navigation).

**Steps:**
1. Add Tauri command `check_files_exist` in `src-tauri/src/lib.rs` — accepts a list of paths, returns which exist.
2. Add `checkFilesExist` wrapper in `tauri.ts`.
3. Add `RoadmapItemDocFiles` interface to `schema.ts`:
   ```ts
   interface RoadmapItemDocFiles {
     spec?: string;  // resolved path if exists
     plan?: string;  // resolved path if exists
   }
   ```
4. Create `resolveDocFiles` function in `roadmap.ts` — for a given project `localPath`, checks convention paths (`docs/specs/SPEC.md`, `docs/plans/PLAN.md`, `SPEC.md`, `PLAN.md`) using `checkFilesExist`. Returns a map of item ID → `RoadmapItemDocFiles`.
   - Convention: look for `docs/specs/<item-id>-spec.md`, `docs/plans/<item-id>-plan.md` first (item-specific), then fallback to project-level `SPEC.md` / `PLAN.md`.
   - Since roadmap items don't have their own directories yet, use the project's `localPath` + item ID as lookup key.
5. In `App.tsx`, when `selectedProjectId` changes and the project `hasRoadmap`: auto-call `readRoadmap()` + `resolveDocFiles()`. Store results in local state alongside `selectedProject`. Pass to `CardDetail`.

**Test:** Open a project modal with roadmap → items load automatically without clicking "View Roadmap".

### Phase 3: RoadmapItemList + DnD Reordering

**Goal:** Render roadmap items as a priority-ordered vertical list with drag-to-reorder.

**Steps:**
1. Create `RoadmapItemRow.tsx`:
   - Layout: `[drag-handle] [P-label] [title] [StatusBadge] [DocBadge(s)]`
   - P-label: `P1`, `P2`, etc. — derived from array index, not stored value
   - Uses `useSortable` from `@dnd-kit/sortable` (already installed)
   - `StatusBadge` for roadmap statuses (`pending` / `in-progress` / `complete`)
   - `DocBadge` components: small pills (`📄 spec`, `📋 plan`) shown only if doc exists
   - Click on row (excluding badge/handle) → `onItemClick(item)`
   
2. Create `RoadmapItemList.tsx`:
   - Wraps items in `DndContext` + `SortableContext` (vertical list strategy)
   - On drag end: reorder items, update P-labels, call `onReorder(newItems)` which persists via `writeRoadmap()`
   - **Reuse pattern from `Board.tsx`** — same sensor config, same `closestCorners` collision detection, simplified to single-column vertical only (no cross-column moves)
   
3. Wire into `CardDetail.tsx`:
   - If project `hasRoadmap` and roadmap items loaded → render `RoadmapItemList`
   - If no roadmap items → render project markdown content (same `ReactMarkdown` render as current)
   - Reorder callback persists via existing `writeRoadmap()`

**Test:** Drag P3 item above P1 → labels update to P1/P2/P3 → file persists new order.

### Phase 4: RoadmapItemDetail View

**Goal:** Clicking a roadmap item row shows its detail view (replaces the list).

**Steps:**
1. Create `RoadmapItemDetail.tsx`:
   - Back button: `← Back to {projectTitle}` — returns to list view
   - Status badge (for the item)
   - Item title + summary (item's markdown content — need to extend `RoadmapItem` to carry content, or fetch on click)
   - Doc tabs: only shown if docs exist. Tab bar with available doc types. Clicking a tab fetches file via `readFile()` and renders with `ReactMarkdown`.
   - No animation on view swap (per spec decision)

2. Add view state to `CardDetail.tsx`:
   ```ts
   type ModalView = 
     | { kind: 'list' }
     | { kind: 'detail'; itemId: string };
   ```
   Default: `{ kind: 'list' }`. Clicking a row → `{ kind: 'detail', itemId }`. Back → `{ kind: 'list' }`.

3. Handle doc content loading:
   - On entering detail view, if doc files exist, fetch the first available one
   - Cache fetched doc content in local state to avoid re-fetches
   - Show loading skeleton while fetching

**Test:** Click "Auth Flow" row → see detail view with summary + spec tab → click spec tab → see rendered markdown → click back → see list again.

### Phase 5: ProjectDetails (Collapsible Section)

**Goal:** Move all secondary fields into a collapsible "Details" section below the roadmap.

**Steps:**
1. Create `ProjectDetails.tsx`:
   - Collapsible container (collapsed by default): click `▸ Details` to expand
   - Contains: Next Action (editable input), Tags (editable), Blocked By (editable), Last Reviewed date, Git status + branch, Sub-projects (clickable buttons), Parent link, File paths, Repo-linked badge
   - Action buttons: Save, Delete, Mark Reviewed, Commit Planning Docs, Push Repo
   - Save button only needed for editable fields (Next Action, Tags, Blocked By)
   - Commit/Push only shown for projects with `localPath`
   
2. Wire callbacks through from `CardDetail` (same as current — `onSave`, `onDelete`, `onMarkReviewed`, `onCommitRepo`, `onPushRepo`, `onOpenLinkedProject`)

3. Remove old form fields from `CardDetail` — they now live in `ProjectDetails`

**Test:** Open modal → details collapsed → click to expand → edit Next Action → Save → persists. Sub-project buttons open their modals.

### Phase 6: Polish + Responsive

**Goal:** Ensure the modal works at narrow widths and looks cohesive.

**Steps:**
1. **Responsive layout:**
   - At narrow widths (<640px): full-width modal, reduced padding
   - Roadmap rows: stack P-label + title above status + badges on very narrow screens
   - Doc tabs: horizontal scroll if many tabs
   
2. **Visual polish:**
   - Consistent spacing between sections (header → roadmap list → details)
   - Smooth collapse/expand animation on Details section (CSS `grid-template-rows` transition)
   - Status badge colours: match existing column header colours from `tailwind.config.js`
   - Drag overlay for roadmap items (same pattern as `Board.tsx` DragOverlay)

3. **Keyboard:**
   - Escape closes modal (already works)
   - Escape from detail view → back to list (before closing modal)

4. **Edge cases:**
   - Projects without roadmap: show markdown content + details (no roadmap section)
   - Projects with empty roadmap (0 items): show "No roadmap items" placeholder
   - Loading states: skeleton for roadmap items while loading
   - Error handling: toast on failed doc fetch, failed status save

---

## Data Flow

```
User opens project modal
  → App.tsx sets selectedProjectId
  → If hasRoadmap: auto-load readRoadmap() + resolveDocFiles()
  → Pass project + roadmapItems + docFiles to CardDetail

User clicks status badge (project or roadmap item)
  → StatusBadge shows dropdown
  → User selects new status
  → Optimistic: update local state immediately
  → Background: call onSave(project, { status }) or writeRoadmap()
  → On error: revert local state + show toast

User reorders roadmap items
  → DnD drag end fires
  → Recompute P-labels from new order
  → Optimistic: update local items state
  → Background: writeRoadmap() with new order
  → On error: revert + toast

User clicks roadmap item row
  → Set modalView to { kind: 'detail', itemId }
  → Fetch doc files if available
  → Render RoadmapItemDetail

User clicks doc tab
  → Fetch file content via readFile()
  → Render with ReactMarkdown
  → Cache content for tab switching
```

---

## Dependencies

All already installed — no new packages needed:
- `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` — DnD (already used in Board)
- `react-markdown` — markdown rendering (already used)
- `class-variance-authority` — badge variants (already used)
- `lucide-react` — icons (already used)
- `gray-matter` — frontmatter parsing (already used in roadmap.ts)

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| DnD within modal conflicts with modal scroll | Use `PointerSensor` with `activationConstraint: { distance: 6 }` (same as Board) — prevents accidental drags from scroll |
| Doc badge resolution is slow (many file checks) | Batch into single `check_files_exist` Tauri command; resolve once on modal open, cache results |
| Inline status save fails silently | Show error toast on failure; revert optimistic update |
| Roadmap auto-load adds latency to modal open | Load async after modal renders; show skeleton placeholder |
| Convention-based doc paths don't match project structure | Start with simple convention (`SPEC.md`, `PLAN.md` in project root + `docs/` subdir); extend later in Retrofit deliverable |

---

## Build Order (recommended)

```
Phase 1 → Phase 5 → Phase 2 → Phase 3 → Phase 4 → Phase 6
```

Rationale: Phase 1 (StatusBadge + Header) and Phase 5 (Details) can be built first to restructure the existing modal without needing roadmap data. Then Phases 2-4 layer in the roadmap functionality. Phase 6 is polish.

This order means you get a working (improved) modal after Phase 1+5, before roadmap features land.

---

## Estimated Effort

| Phase | Scope | Estimate |
|-------|-------|----------|
| Phase 1 | StatusBadge + Header | Small — 2 new components, straightforward |
| Phase 2 | Data loading + Tauri command | Small — plumbing, one new Tauri command |
| Phase 3 | RoadmapItemList + DnD | Medium — DnD setup, but pattern exists in Board.tsx |
| Phase 4 | RoadmapItemDetail | Medium — new view, doc fetching, tab system |
| Phase 5 | ProjectDetails collapsible | Small — mostly moving existing fields into new wrapper |
| Phase 6 | Polish + responsive | Small-medium — CSS + edge cases |

**Total:** ~6 focused build phases. Each phase produces a testable increment.
