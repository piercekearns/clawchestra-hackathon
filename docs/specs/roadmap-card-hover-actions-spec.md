# Roadmap Card Hover Actions: Archive & Complete

> Roadmap item cards grow two lifecycle action buttons on hover — Complete (CircleCheckBig) on the right side, Archive (Archive icon) beside it — so items can be finished or archived directly from the board without opening their detail modal.

**Status:** Draft
**Created:** 2026-02-26
**Roadmap Item:** `roadmap-card-hover-actions`
**Status:** `up-next` · Priority 3

---

## Problem

Moving a roadmap item to "complete" or removing it from view currently requires:
1. Opening the item's detail modal
2. Changing the status dropdown
3. Closing the modal

That's three interactions for what should be a one-click board operation. Archive has no UI path at all.

## What Success Looks Like

- Hovering a roadmap item card reveals two action buttons on the **right** side of the card
- **Complete** (`CircleCheckBig` from Lucide) — moves the item to `complete` status
- **Archive** (`Archive` from Lucide) — moves the item to `archived` status (see open design question below)
- Both buttons appear/disappear with the same hover behaviour as existing lifecycle buttons (which sit on the **left** side of the card)
- Both actions show a **toast notification** with an **Undo** button
- Undo fully restores the item to its previous status/column
- Complete always moves the card to the "completed" column, even if that column is currently collapsed

---

## UI Behaviour

### Card Layout on Hover

```
[ left lifecycle buttons ]  ←  title / metadata  →  [ Archive ] [ Complete ]
```

- Left side: existing lifecycle buttons (unchanged)
- Right side: two new buttons, `Archive` then `CircleCheckBig`, left-to-right
- Same icon size, padding, and hover style as existing lifecycle buttons
- Buttons are invisible when not hovered — no layout shift

### Hover Style

Reuse the existing Proton Mail-inspired pattern: bare icon at rest, subtle container + shadow appears on hover. Match the colour/size of existing lifecycle icon buttons exactly.

### Complete Action

1. User clicks `CircleCheckBig`
2. Item status set to `complete`
3. Card animates out of its current column
4. Card appears in the "complete" column (scroll/expand that column if collapsed — see note below)
5. Toast fires: **"Item completed"** + **Undo** button
6. Undo: restores item to previous status, moves card back

**Collapsed complete column**: If the complete column is collapsed, expand it (or scroll it into view) so the card landing is visible. If auto-expand is complex to implement, simply set status and let the card disappear — the Undo toast is the recovery path.

### Archive Action

1. User clicks `Archive`
2. Item status set to `archived`
3. Card disappears from the board (archived items are hidden by default)
4. Toast fires: **"Item archived"** + **Undo** button
5. Undo: restores item to previous status, card reappears

---

## Show Archived Toggle

Archived items are hidden from the roadmap board by default. A toggle in the project roadmap header lets the user reveal them.

### Placement

A small **"Show archived"** toggle button sits in the roadmap board's header area — right-aligned, in the same horizontal band as the column controls. Uses the `Archive` icon from Lucide.

**When inactive (default):** Icon-only button, muted/secondary style  
**When active:** Icon button with filled/highlighted treatment (e.g. `text-neutral-800 dark:text-neutral-100`, subtle bg)

### Archived Item Appearance (when toggle is on)

- Archived cards appear at the **bottom of their original column**, below active items
- Separated from active items by a thin rule (`border-t border-neutral-200 dark:border-neutral-700`)
- Muted visual treatment: `opacity-50`, title with `line-through`
- No hover actions (or: only Restore action — see below)

### Restore from Archive

When "Show archived" is on, archived cards could show a **Restore** button on hover (opposite of Archive). This is a nice-to-have; the Undo toast covers the immediate case.

---

## Open Design Question: Archive Behaviour

> **⚠️ Unresolved — decision needed before implementation.**

What does "archived" mean in the context of the roadmap board? Options:

| Option | Description | Trade-offs |
|--------|-------------|------------|
| **A: Hidden with filter toggle** | Archived items hidden by default; toggle in header reveals them in-column with muted style | Simple, consistent with Linear/GitHub pattern |
| **B: Separate "Archived" column** | A collapsed-by-default column at the far right of the board | More visible, but pollutes the column layout |
| **C: Soft-delete with global archive view** | Archived items visible only in a dedicated "Archive" view (e.g. sidebar nav item) | Most powerful, most work |
| **D: Hard delete with undo only** | Item is deleted; Undo (30s window) is the only recovery | Simplest, but permanent |

**Recommended starting point: Option A** (hidden with filter toggle). Matches the spec above. Easiest to retrofit into Option C later if a global archive view is added.

---

## Technical Notes

### Icon Imports

```tsx
import { Archive, CircleCheckBig } from 'lucide-react';
```

### Status Value

The `archived` status must be added to the `RoadmapStatus` union in `src/lib/schema.ts` if not already present. The board's `ROADMAP_COLUMNS` definition would need a corresponding column definition — or archived items are excluded from all columns (filter-only approach, Option A).

### Undo Implementation

Use the existing toast system. Store previous status in a ref or closure when the action fires. On Undo click, call `updateRoadmapItemStatus(itemId, previousStatus)`.

### "Show Archived" State

Ephemeral (not persisted) — resets when the user navigates away from the project's roadmap view. Stored in local component state or a non-persisted store field.

---

## Phases

### Phase 1: Complete Action Only
- Add `CircleCheckBig` button to right side of hover area
- Toast + Undo
- Ship this first — minimal surface area, most immediately useful

### Phase 2: Archive Action + Show Archived Toggle
- Add `Archive` button alongside Complete
- Hidden-by-default + toggle in roadmap header
- Resolve the open design question before starting this phase

### Phase 3: Restore on Archived Cards
- Hover Restore button when "Show archived" is active
- Nice-to-have, can ship separately
