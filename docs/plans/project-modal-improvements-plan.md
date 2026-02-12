# Project Modal Improvements — Implementation Plan

> **Spec:** `docs/specs/project-modal-improvements-spec.md` (LOCKED)  
> **Date:** 2026-02-12  
> **Status:** Ready for build  
> **Review:** Applied fixes from 3-reviewer pass (simplicity, TypeScript, architecture)

---

## Overview

Major rewrite of `CardDetail.tsx` into a multi-component modal that puts roadmap items front-and-centre, replaces form-style fields with inline status badges, and adds doc discovery with tabbed rendering.

**Current state:** Single 280-line `CardDetail` component with flat form layout (select dropdowns, text inputs, save button).

**Target state:** 8 new components, inline-optimistic status updates, DnD reordering within modal, doc badge resolution, tabbed doc viewer, and a two-view system (roadmap list ↔ item detail).

---

## Architecture

### Component Tree

```
ProjectModal (orchestrator — manages view state via useProjectModal hook)
├── ProjectModalHeader (compact header: icon + title + status badge + close + blocker)
├── RoadmapItemList (DnD vertical list with P-labels, status badges, doc badges)
│   └── RoadmapItemRow (single sortable row: drag handle + P-label + title + status + doc badges)
│       └── DocBadge (conditional pill: 📄 spec / 📋 plan)
├── RoadmapItemDetail (back button + item summary + doc tabs with rendered markdown)
├── ProjectDetails (collapsible section: fields, metadata, action buttons)
└── StatusBadge<T> (shared generic: clickable badge → dropdown → optimistic save)
```

### New Files

| File | Purpose |
|------|---------|
| `src/components/modal/ProjectModalHeader.tsx` | Compact header with inline status |
| `src/components/modal/RoadmapItemList.tsx` | DnD vertical list of roadmap items |
| `src/components/modal/RoadmapItemRow.tsx` | Single sortable row |
| `src/components/modal/RoadmapItemDetail.tsx` | Item detail view with doc tabs |
| `src/components/modal/ProjectDetails.tsx` | Collapsible details section |
| `src/components/modal/StatusBadge.tsx` | Generic reusable clickable status dropdown |
| `src/components/modal/DocBadge.tsx` | Small badge linking to spec/plan docs |
| `src/components/modal/index.ts` | Barrel export |
| `src/hooks/useProjectModal.ts` | Hook encapsulating modal state, roadmap loading, doc resolution |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/CardDetail.tsx` | Renamed to `ProjectModal.tsx` — thin shell that uses `useProjectModal` hook and renders sub-components |
| `src/App.tsx` | Replace `CardDetail` import with `ProjectModal`. Remove roadmap loading logic from App — now lives in `useProjectModal` hook. Pass grouped `actions` object instead of 11+ individual callbacks |
| `src/lib/schema.ts` | Add `RoadmapItemWithDocs` extended type |
| `src/lib/roadmap.ts` | Add `resolveDocFiles()` — doc path resolution using frontmatter fields first, convention fallback second |
| `src/lib/projects.ts` | No changes needed — existing `updateProject` handles inline saves |

### Tauri Backend

No new commands needed initially. Use existing `pathExists()` pattern (try `readFile`, catch → false) called in parallel for doc resolution. The number of checks is small (2-4 per project) so batch optimisation is premature. Add `check_files_exist` later only if measured as slow.

---

## Key Design Decisions (from review)

### 1. `useProjectModal` Hook (prevents App.tsx bloat)
All modal orchestration — view state, roadmap loading, doc resolution, optimistic status updates — lives in a custom hook rather than `App.tsx`. App.tsx just passes the project and a grouped actions object.

### 2. Generic `StatusBadge<T>`
```ts
interface StatusBadgeProps<T extends string> {
  value: T;
  options: readonly T[];
  labels?: Partial<Record<T, string>>;
  variant?: (status: T) => BadgeVariant;
  onChange: (next: T) => void;
}
```
Works for both `ProjectStatus` and `RoadmapStatus` without hardcoding either.

### 3. Grouped Actions Prop
Instead of 11+ individual callback props, `ProjectModal` receives:
```ts
interface ProjectModalActions {
  onSave: (project: ProjectViewModel, updates: ProjectUpdate) => Promise<void>;
  onDelete: (project: ProjectViewModel) => Promise<void>;
  onMarkReviewed: (project: ProjectViewModel) => Promise<void>;
  onRequestUpdate: (project: ProjectViewModel) => Promise<void>;
  onCommitRepo: (project: ProjectViewModel) => Promise<void>;
  onPushRepo: (project: ProjectViewModel) => Promise<void>;
  onOpenLinkedProject: (projectId: string) => void;
}
```
Sub-components receive only the callbacks they need, destructured from this object.

### 4. Doc Resolution: Frontmatter First, Convention Fallback
1. Check `specDoc` / `planDoc` fields already in `ProjectFrontmatter` (schema.ts already has these!)
2. If not set, fall back to convention: `SPEC.md`, `PLAN.md` in project root, then `docs/specs/`, `docs/plans/`
3. Resolve once on modal open, cache results in hook state

### 5. Single Roadmap State Source
The `useProjectModal` hook reads roadmap data when the modal opens. If the user is already on the roadmap Kanban view, the hook reads from the same `readRoadmap()` function but manages its own copy for modal-specific mutations (reordering within modal). On close/save, the main board refreshes via `loadProjects()`.

### 6. DnD Context Nesting (⚠️ Must Test)
The modal's `RoadmapItemList` creates its own `DndContext` which renders on top of the board's `DndContext` in `Board.tsx`. This is safe because:
- The modal overlay (`fixed inset-0 z-50`) blocks pointer events to the board
- `@dnd-kit` scopes sensors to their own context
- **Must verify:** add an integration test or manual test that dragging in the modal doesn't trigger board drag events

### 7. Optimistic State Pattern
Follow the existing `CardDetail` pattern: local state synced from props via `useEffect`, optimistic updates applied to local state, errors revert to prop values. The `useProjectModal` hook owns this state and exposes `updateStatus(newStatus)` / `reorderItems(newOrder)` which handle the optimistic → persist → revert-on-error flow internally.

---

## Phases

### Phase 1: Foundation (StatusBadge + ProjectModalHeader + useProjectModal hook)

**Goal:** Replace the select dropdown with a clickable inline status badge. Establish the hook + actions pattern.

**Steps:**
1. Create `useProjectModal` hook:
   - Accepts: `project`, `actions` (grouped callbacks)
   - Manages: `localStatus` (synced from project prop), `modalView` state, loading flags
   - Exposes: `updateProjectStatus(newStatus)` — optimistic local update + background `actions.onSave(project, { status })`
   - This hook grows in later phases (roadmap loading, doc resolution)

2. Create `StatusBadge.tsx` — generic `StatusBadge<T extends string>`:
   - Clickable badge that opens a small dropdown/popover of status options
   - On select: calls `onChange(newStatus)` and closes
   - Visual: uses existing `Badge` component variants, adds a chevron indicator and hover state
   - Accepts `options: readonly T[]`, optional `labels` map, optional `variant` function for colour mapping

3. Create `ProjectModalHeader.tsx`:
   - Renders icon + title + `StatusBadge<ProjectStatus>` + close button
   - Below title: conditional blocker alert (`⚠️ Blocked by: ...`) only when `blockedBy` is set

4. Rename `CardDetail.tsx` → `ProjectModal.tsx`:
   - Uses `useProjectModal` hook
   - Renders `ProjectModalHeader` for the header
   - Keeps existing form body temporarily (replaced in Phase 5)
   - Receives `ProjectModalActions` grouped object instead of individual callbacks

5. Update `App.tsx`:
   - Build `ProjectModalActions` object, pass to `ProjectModal`
   - Remove individual callback props

**Test:** Click status badge → dropdown appears → select new status → badge updates instantly → file persists.

### Phase 2: Roadmap Data Loading + Doc Resolution

**Goal:** Load roadmap items when the modal opens. Resolve doc file paths for badges.

**Steps:**
1. Add `RoadmapItemWithDocs` to `schema.ts`:
   ```ts
   interface RoadmapItemDocs {
     spec?: string;  // resolved file path if exists
     plan?: string;  // resolved file path if exists
   }
   
   interface RoadmapItemWithDocs extends RoadmapItem {
     docs: RoadmapItemDocs;
   }
   ```

2. Create `resolveDocFiles()` in `roadmap.ts`:
   - Takes project `localPath` and roadmap items
   - For each item: check `specDoc`/`planDoc` from project frontmatter first
   - Fallback: check convention paths using existing `pathExists()` pattern (parallel `Promise.all`)
   - Convention paths: `{localPath}/SPEC.md`, `{localPath}/PLAN.md`, `{localPath}/docs/specs/SPEC.md`, `{localPath}/docs/plans/PLAN.md`
   - Also item-specific: `{localPath}/docs/specs/{item-id}-spec.md`, `{localPath}/docs/plans/{item-id}-plan.md`
   - Returns `Map<string, RoadmapItemDocs>`

3. Extend `useProjectModal` hook:
   - When `project` changes and `hasRoadmap`: auto-call `readRoadmap()` + `resolveDocFiles()`
   - Store `roadmapItems: RoadmapItemWithDocs[]` and `roadmapLoading: boolean`
   - Expose these to `ProjectModal` for rendering

**Test:** Open a project modal with roadmap → items load automatically without clicking "View Roadmap". Doc badges appear for items with existing spec/plan files.

### Phase 3: RoadmapItemList + RoadmapItemRow + DnD Reordering

**Goal:** Render roadmap items as a priority-ordered vertical list with drag-to-reorder.

**Steps:**
1. Create `DocBadge.tsx`:
   - Small pill component: icon + label (`📄 spec`, `📋 plan`)
   - Only rendered when doc path exists
   - Clickable — in list view, clicking navigates to item detail with that doc tab active

2. Create `RoadmapItemRow.tsx`:
   - Layout: `[drag-handle ⋮⋮] [P-label] [title] [StatusBadge<RoadmapStatus>] [DocBadge(s)]`
   - P-label: `P1`, `P2`, etc. — derived from array index, not stored value
   - Uses `useSortable` from `@dnd-kit/sortable` (already installed)
   - `StatusBadge` for roadmap statuses (`pending` / `in-progress` / `complete`)
   - Click on row (excluding badge/handle) → `onItemClick(item)`
   - Receives `fetchDoc` callback for doc badge clicks (not direct `readFile` — keeps component testable)

3. Create `RoadmapItemList.tsx`:
   - Wraps items in `DndContext` + `SortableContext` (vertical list strategy)
   - On drag end: reorder items, update P-labels, call `onReorder(newItems)`
   - Shared sensor config: extract `DRAG_SENSORS` constant from `Board.tsx` pattern — `PointerSensor` with `activationConstraint: { distance: 6 }` — reuse in both Board and modal
   - `DragOverlay` for visual feedback during drag (same pattern as `Board.tsx`)

4. Extend `useProjectModal` hook:
   - Add `reorderRoadmapItems(newItems)` — optimistic local reorder + background `writeRoadmap()` persist
   - Add `updateRoadmapItemStatus(itemId, newStatus)` — optimistic + persist
   - On error: revert + surface error for toast

5. Wire into `ProjectModal`:
   - If project `hasRoadmap` and items loaded → render `RoadmapItemList`
   - If no roadmap → render project markdown content (existing `ReactMarkdown` pattern)
   - Pass reorder + status change handlers from hook

**Test:** Drag P3 item above P1 → labels update to P1/P2/P3 → file persists new order. Click status badge on row → changes and persists.

### Phase 4: RoadmapItemDetail View + Doc Tabs

**Goal:** Clicking a roadmap item row shows its detail view with tabbed doc rendering.

**Steps:**
1. Create `RoadmapItemDetail.tsx`:
   - **Back button:** `← Back to {projectTitle}` — returns to list view
   - **Status badge** for the item (same `StatusBadge<RoadmapStatus>`)
   - **Item title + summary:** the roadmap item's content (extend `RoadmapItem` to carry markdown body, or fetch on click via `readFile` on the roadmap file and extract per-item content)
   - **Doc tabs:** horizontal tab bar, only shown if at least one doc exists. Each available doc type gets a tab. Active tab renders fetched markdown via `ReactMarkdown`.
   - **Tab state:** local state tracking `activeTab: 'spec' | 'plan' | null`
   - **Doc content cache:** `Map<string, string>` in hook state — once fetched, don't re-fetch on tab switches
   - **Loading state:** skeleton placeholder while fetching doc content
   - No animation on view swap (per spec decision)

2. Add view state to `useProjectModal` hook:
   ```ts
   type ModalView = 
     | { kind: 'list' }
     | { kind: 'detail'; itemId: string };
   ```
   - Default: `{ kind: 'list' }`
   - Expose `openItemDetail(itemId)` and `backToList()`
   - Derive `selectedItem` via `useMemo` from `roadmapItems` + `modalView.itemId`

3. Extend `useProjectModal` for doc fetching:
   - `fetchDocContent(path: string): Promise<string>` — calls `readFile`, caches result
   - `docContentCache: Record<string, string>` in hook state
   - Expose `getDocContent(path)` and `docLoading` flag

4. Wire into `ProjectModal`:
   - When `modalView.kind === 'detail'`: render `RoadmapItemDetail` instead of `RoadmapItemList`
   - Pass `fetchDoc` callback (from hook), cached content, and `backToList` handler

**Test:** Click "Auth Flow" row → see detail view with summary + spec tab → click spec tab → see rendered markdown → switch to plan tab → renders plan → click back → see list again. Re-opening same item shows cached docs instantly.

### Phase 5: ProjectDetails (Collapsible Section)

**Goal:** Move all secondary fields into a collapsible "Details" section below the roadmap.

**Steps:**
1. Create `ProjectDetails.tsx`:
   - Collapsible container (collapsed by default): click `▸ Details` to expand
   - Uses CSS `grid-template-rows: 0fr → 1fr` transition for smooth expand/collapse
   - Contains:
     - Next Action (editable input)
     - Tags (editable, comma-separated)
     - Blocked By (editable — also surfaced in header when set)
     - Last Reviewed date (read-only display)
     - Git status + branch badge
     - Sub-projects (clickable buttons → `actions.onOpenLinkedProject`)
     - Parent link (clickable → `actions.onOpenLinkedProject`)
     - File paths (dashboard file, repo file)
     - Repo-linked / dashboard-only badge
   - Action buttons: Save, Delete, Mark Reviewed, Commit Planning Docs, Push Repo
   - Commit/Push only shown for projects with `localPath`
   - Receives subset of `ProjectModalActions` — only the callbacks it needs

2. Local editable state:
   - `nextAction`, `tags`, `blockedBy` — local state synced from project prop (same pattern as current CardDetail)
   - Save button calls `actions.onSave(project, { nextAction, tags, blockedBy })`

3. Wire into `ProjectModal`:
   - Renders below `RoadmapItemList` (or below markdown content for non-roadmap projects)
   - Always present regardless of view (list or detail)

4. Remove old form fields from `ProjectModal` — they now live entirely in `ProjectDetails`

**Test:** Open modal → details collapsed → click to expand → edit Next Action → Save → persists. Sub-project buttons open their modals. Collapse/expand animates smoothly.

### Phase 6: Polish + Responsive + Edge Cases

**Goal:** Ensure the modal works at narrow widths, handles all edge cases, and looks cohesive.

**Steps:**
1. **Responsive layout:**
   - At narrow widths (<640px): full-width modal, reduced padding
   - Roadmap rows: stack P-label + title above status + badges on very narrow screens
   - Doc tabs: horizontal scroll if overflowing
   - ProjectDetails: single-column layout at narrow widths

2. **Visual polish:**
   - Consistent spacing between sections (header → roadmap list/detail → details)
   - Status badge colours: map to existing Tailwind theme colours from `tailwind.config.js`
   - Drag overlay for roadmap items (already added in Phase 3)
   - Focus rings on interactive elements

3. **Keyboard navigation:**
   - Escape from detail view → back to list (before closing modal)
   - Escape from list view → close modal (existing behaviour)
   - Tab navigation through roadmap items
   - Enter on focused roadmap item → open detail

4. **Edge cases:**
   - Projects without roadmap: show markdown content + details (no roadmap section)
   - Projects with empty roadmap (0 items): show "No roadmap items yet" placeholder
   - Loading states: skeleton for roadmap items while loading, skeleton for doc content while fetching
   - Error handling: toast on failed doc fetch, failed status save (with optimistic revert)
   - Roadmap file missing/corrupt: graceful fallback to "Could not load roadmap" message

5. **DnD context nesting verification:**
   - Manual test: open modal over board, drag items in modal, verify no board drag events fire
   - If issues found: scope droppable IDs with `modal-` prefix

---

## Data Flow

```
User opens project modal
  → App.tsx sets selectedProjectId
  → useProjectModal hook initialises
  → If hasRoadmap: auto-load readRoadmap() + resolveDocFiles() (async)
  → Hook exposes project, roadmapItems, modalView, actions

User clicks status badge (project)
  → StatusBadge<ProjectStatus> shows dropdown
  → User selects new status
  → Hook: optimistic local status update
  → Hook: background actions.onSave(project, { status })
  → On error: revert local state, surface error for toast

User clicks status badge (roadmap item)
  → StatusBadge<RoadmapStatus> shows dropdown
  → Hook: optimistic local update to roadmapItems
  → Hook: background writeRoadmap() with updated item
  → On error: revert + toast

User reorders roadmap items
  → DnD drag end fires in RoadmapItemList
  → Hook: reorderRoadmapItems(newOrder)
  → Optimistic: update local items, recompute P-labels
  → Background: writeRoadmap() with new order
  → On error: revert + toast

User clicks roadmap item row
  → Hook: openItemDetail(itemId)
  → modalView → { kind: 'detail', itemId }
  → ProjectModal renders RoadmapItemDetail instead of RoadmapItemList
  → If docs exist: first available doc auto-fetched

User clicks doc tab
  → Check docContentCache for cached content
  → If cached: render immediately
  → If not: fetch via readFile(), cache result, render with ReactMarkdown

User clicks back
  → Hook: backToList()
  → modalView → { kind: 'list' }
  → RoadmapItemList rendered again (state preserved)
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

| Risk | Impact | Mitigation |
|------|--------|------------|
| DnD context nesting — modal DndContext over board DndContext | 🔴 Could break drag | Modal overlay blocks pointer events to board; test explicitly in Phase 6. Fallback: scope droppable IDs with prefix |
| Roadmap auto-load adds latency to modal open | 🟢 Low | Load async after modal renders; show skeleton placeholder |
| Optimistic status save fails | 🟡 Moderate | Revert local state on error; show toast. Follow existing CardDetail sync pattern |
| Doc content fetch fails or file moves | 🟡 Moderate | Graceful error state in tab ("Could not load document"); don't crash detail view |
| Convention-based doc paths don't match project structure | 🟢 Low | Frontmatter fields (`specDoc`/`planDoc`) are primary; convention is fallback only. Retrofit deliverable will standardise |
| `useProjectModal` hook grows too large | 🟡 Moderate | Split into sub-hooks (`useRoadmapData`, `useDocContent`) if it exceeds ~150 lines |

---

## Build Order

```
Phase 1 → Phase 5 → Phase 2 → Phase 3 → Phase 4 → Phase 6
```

**Rationale:** Phase 1 (StatusBadge + Header + hook) and Phase 5 (Details) restructure the existing modal into the new layout without needing roadmap data. This produces a working improved modal early. Then Phases 2-4 layer in roadmap functionality incrementally. Phase 6 is polish + edge cases.

Each phase produces a testable, shippable increment.

---

## Estimated Effort

| Phase | Scope | Files |
|-------|-------|-------|
| Phase 1 | StatusBadge + Header + hook + rename | `StatusBadge.tsx`, `ProjectModalHeader.tsx`, `useProjectModal.ts`, `ProjectModal.tsx`, `index.ts` |
| Phase 2 | Roadmap data loading + doc resolution | `schema.ts` (extend), `roadmap.ts` (extend), `useProjectModal.ts` (extend) |
| Phase 3 | RoadmapItemList + Row + DocBadge + DnD | `RoadmapItemList.tsx`, `RoadmapItemRow.tsx`, `DocBadge.tsx` |
| Phase 4 | RoadmapItemDetail + doc tabs | `RoadmapItemDetail.tsx`, `useProjectModal.ts` (extend) |
| Phase 5 | ProjectDetails collapsible | `ProjectDetails.tsx` |
| Phase 6 | Polish + responsive + edge cases | All files (CSS + behaviour tweaks) |
