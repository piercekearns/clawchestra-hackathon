# Project Card Opens Kanban Directly

> Click a project card → see its roadmap as a kanban board. No intermediate modal.

## Summary

Today, clicking a project card opens a `ProjectModal` that shows a list-style roadmap with item details, status controls, and completed items. This changes the default behaviour: clicking a project card switches the main board to that project's roadmap kanban view — the same view you'd get from the current "View Roadmap" flow. The modal is deprecated (not deleted — kept as fallback for projects without a roadmap). This gives a faster, more direct path into a project's deliverables.

---

**Roadmap Item:** `project-card-opens-kanban`
**Status:** Up Next
**Created:** 2026-02-17

---

## Current Flow

```
Project card click
  → ProjectModal opens (overlay)
    → Shows: header, roadmap item list, completed items, project details
    → Click item → RoadmapItemDetail (within modal)
    → Click "View Roadmap" (from card) → switches to kanban view, closes modal
```

**Problems:**
- Extra click to get to the kanban (the most useful view)
- Modal is an overlay — can't interact with the board behind it
- "View Roadmap" button on project cards is a separate action from clicking the card itself
- The modal's roadmap list duplicates what the kanban already shows, but in a less useful format

## Proposed Flow

```
Project card click
  → Board switches to project roadmap kanban (full board view)
  → Back button / Escape / breadcrumb returns to project dashboard
```

**What this removes:**
- ProjectModal no longer opens on card click
- "View Roadmap" button on project cards is no longer needed (click the card itself)

**What this keeps:**
- ProjectModal still exists in code — used as fallback for projects without a roadmap (shows raw markdown content)
- RoadmapItemDialog (the standalone dialog from kanban item clicks) is unchanged
- All roadmap item interactions (status change, reorder, detail view) work in the kanban as they do today

## Implementation

### Card click handler

Currently in `App.tsx` (~line 948):
```typescript
onClick={() => setSelectedProjectId(project.id)}
```

This opens the `ProjectModal`. Change to:
```typescript
onClick={() => {
  if (project.hasRoadmap) {
    setViewContext(projectRoadmapView(project.id, project.title));
  } else {
    setSelectedProjectId(project.id);  // fallback: open modal for non-roadmap projects
  }
}}
```

The `projectRoadmapView` function and the kanban rendering for roadmap views already exist — this is the same code path that "View Roadmap" uses today.

### Remove "View Roadmap" button from project cards

The button that currently triggers `projectRoadmapView` from the card UI becomes redundant. Remove it or hide it — the card click itself now does the same thing.

### Back navigation

Already implemented — the roadmap kanban view has breadcrumb navigation and Escape key support that returns to the main project dashboard. No changes needed here.

### ProjectModal retention

Keep `ProjectModal` in the codebase:
- Opens for projects where `hasRoadmap === false` (shows raw markdown content)
- Could be repurposed later as a quick-info panel or settings view for a project
- No need to delete code — just disconnect it from the card click for roadmap projects

### Affected files

| File | Change |
|------|--------|
| `src/App.tsx` | Card click handler: `projectRoadmapView` for roadmap projects, `setSelectedProjectId` fallback for non-roadmap |
| `src/components/card/ProjectCard.tsx` (or equivalent) | Remove "View Roadmap" button |
| `src/components/modal/ProjectModal.tsx` | No changes — retained for fallback |

### What stays the same

- Kanban column rendering, item reordering, status changes — all unchanged
- RoadmapItemDialog (click item in kanban → detail overlay) — unchanged
- Keyboard navigation (arrow keys between projects, Escape to go back) — unchanged
- Breadcrumb navigation in roadmap view — unchanged
- Add Project button — unchanged

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| Project with no roadmap | Opens ProjectModal (current behaviour, fallback) |
| Project with empty roadmap (0 items) | Opens kanban view with empty columns — shows "No items" placeholder |
| Deep-linked project (URL/state restore) | If saved view state is a project roadmap, restore directly to kanban |
| Keyboard: Enter on focused card | Same as click — opens kanban |

## Build Estimate

**Tiny build.** This is essentially changing one click handler and removing one button:
- ~1 line change in `App.tsx` (card click logic)
- ~1 component edit (remove "View Roadmap" button from cards)
- Possible minor cleanup of unused modal-related props

The infrastructure (kanban view, `projectRoadmapView`, back navigation) all exists already.

---

*Spec is a living document. Update as decisions are made during build.*
