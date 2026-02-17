# Draggable Kanban Columns

> Drag column headers to reorder them. Pure UI preference — no schema or file changes.

## Summary

Columns in the kanban board (both project-level and roadmap-level) have a fixed display order today. This adds drag-and-drop reordering on column headers so users can arrange columns however they like. The custom order persists across sessions via Tauri settings. Zero impact on `PROJECT.md`, `ROADMAP.md`, or any status values — columns are just rendered in a different sequence.

---

**Roadmap Item:** `draggable-kanban-columns`
**Status:** Pending
**Created:** 2026-02-17

---

## Scope

### What it does

- Drag a column header left/right to reposition it among the other columns
- Custom order saved to Tauri settings (survives restart)
- Applies to both board levels: project kanban and roadmap kanban
- Each board level stores its own column order independently

### What it doesn't do

- No schema changes — `status` field values are unchanged
- No file writes — column order is a display preference, not data
- No new columns — this reorders existing status-based columns only
- No reset-to-default button — few enough columns that manual reorder is trivial

## Interaction Model

### Drag trigger

Column headers are the drag handle. Grab a header, drag horizontally, drop between other columns. Same visual language as card drag (highlight drop zone, shift columns apart).

### Visual feedback

| State | Visual |
|-------|--------|
| Idle | Normal column headers |
| Dragging | Dragged column at 50% opacity, follows cursor horizontally |
| Drop zone | 3px accent-colored divider between adjacent columns |
| Drop | Column snaps to new position, siblings reflow |

### Constraints

- Minimum 1 column visible (can't drag all columns off-screen)
- Drag is horizontal only (columns are side-by-side)
- Touch: long-press on column header to initiate (same as card drag)

## Data Model

### Storage

```typescript
// In Tauri settings (persisted)
interface ColumnOrderSettings {
  // Key: board identifier ("projects" | "roadmap:{projectId}")
  // Value: ordered array of status strings
  columnOrder: Record<string, string[]>;
}
```

### Example

```json
{
  "columnOrder": {
    "projects": ["active", "paused", "idea", "archived"],
    "roadmap:pipeline-dashboard": ["up-next", "in-progress", "pending", "complete"]
  }
}
```

### Resolution

1. Check settings for a saved order for this board
2. If saved order exists, use it (filtering out any statuses that no longer exist, appending any new ones at the end)
3. If no saved order, use the hardcoded default (`ROADMAP_COLUMNS` / `PROJECT_COLUMNS`)

## Implementation

### Existing infrastructure

- **DnD library:** Already used for card dragging — extend to column containers
- **Settings persistence:** Tauri settings DB already in use
- **Column rendering:** `ROADMAP_COLUMNS` / equivalent arrays drive column order — replace with a resolved order that checks settings first

### New code

| File | Change |
|------|--------|
| `src/lib/store.ts` | Add `columnOrder` state + `setColumnOrder` action |
| `src/lib/settings.ts` | Read/write `columnOrder` from Tauri settings |
| `src/components/board/KanbanBoard.tsx` (or equivalent) | Wrap column headers in DnD drag source, add drop zones between columns |
| `src/lib/columns.ts` (new) | `resolveColumnOrder(boardId, savedOrder, defaults)` — merges saved order with available statuses |

### DnD detail

The card DnD already uses a drag context. Column drag needs a separate drag type so the DnD library can distinguish between "dragging a card into a column" and "dragging a column to reorder."

```typescript
// Drag types
const DRAG_TYPE_CARD = 'card';
const DRAG_TYPE_COLUMN = 'column';
```

Column drops only accept `DRAG_TYPE_COLUMN`. Card drops only accept `DRAG_TYPE_CARD`. No cross-contamination.

## Build Estimate

**Small build.** The DnD infrastructure exists. This is:
- ~1 new utility file (column order resolution)
- ~2 modified files (board component + settings)
- ~1 store change (column order state)

Pairs well with **Collapsible Kanban Columns** — both are column-level controls on the same headers. Could be built in the same pass if desired.

---

*Spec is a living document. Update as decisions are made during build.*
