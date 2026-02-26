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
- **Archive** (`Archive` from Lucide) — moves the item to `archived` status; card disappears from the board
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

## Show Archived Toggle — Interaction Model

Archived items are hidden by default. The toggle to reveal them is surfaced via hover on the item count in the top-right of the board header — it replaces (not augments) that text, keeping zero ambient clutter.

### States

#### Default state
```
                                              37 roadmap item(s)
```
Item count shown top-right, no toggle visible.

#### Hover state (mouse over item count)
```
                                         Show archive  [○ toggle off]
```
Item count text is **replaced** by "Show archive" with an off-state toggle. If the mouse leaves without clicking, the item count returns.

#### Archive-on state (toggle clicked)
```
                                         Show archive  [● toggle on]
```
The "Show archive" label with toggle **stays rendered** (no longer hover-dependent) — gives the user a persistent mode indicator and a visible way to turn it off. The Archived column appears on the board.

#### Returning to default
Either:
- Click the toggle again from top-right (toggle turns off → item count returns, column disappears), or
- Press **Hide** in the Archived column's header (same result — both exit paths are equivalent)

---

## Archived Column

When archive is on, a dedicated **Archived** column appears at the far right of the board.

### Column Header

The Archived column header is stripped of controls that don't apply:
- ❌ No collapse/expand chevron (it's a temporary view, not a persistent column)
- ❌ No drag handle (it can't be reordered — always sits at the far right)
- ✅ Column title: `Archive` (with `Archive` icon from Lucide)
- ✅ Item count badge
- ✅ **Hide button** — clicking it collapses the column and resets the toggle (equivalent to toggling off from the top-right)

```
[ Archive icon ]  Archived  (N)  ————————————————  [ Hide ]
```

### Archived Card Appearance

- Muted visual treatment: slightly reduced opacity, title with `line-through`
- Cards are **not draggable** out of this column (restoring via hover action only)
- On hover: single **Restore** action button (`ArchiveRestore` or `RotateCcw` from Lucide) on the right side of the card — moves item back to its previous status/column

### Toggle State

Ephemeral — resets when the user navigates away from the project's roadmap view. Not persisted.

---

## Technical Notes

### Icon Imports

```tsx
import { Archive, ArchiveRestore, CircleCheckBig, Trash2 } from 'lucide-react';
```

### Status Value

`archived` must be added to the `RoadmapStatus` union in `src/lib/schema.ts`. Archived items are excluded from all `ROADMAP_COLUMNS` definitions — they only surface in the dedicated Archived column when the toggle is on.

### Undo Implementation

Use the existing toast system. Store previous status in a closure when the action fires. On Undo click, call `updateRoadmapItemStatus(itemId, previousStatus)`.

### "Show Archived" State

`showArchived: boolean` — ephemeral local state in the roadmap board component (or App.tsx alongside `selectedRoadmapItemId`). Not persisted, resets on navigation.

### Item Count Hover Replace

The top-right item count element needs a hover state that swaps its content to the "Show archive" toggle. Can be implemented as a single element with two rendered children — the count text and the toggle — with CSS transitions between them on hover. When `showArchived` is true, force the toggle view regardless of hover state.

---

## Phases

### Phase 1: Complete Action Only
- Add `CircleCheckBig` button to right side of card hover area
- Toast + Undo
- Ship this first — minimal surface area, most immediately useful

### Phase 2: Archive Action + Archived Column
- Add `Archive` button to card hover area (alongside Complete)
- Item count hover → "Show archive" toggle replace interaction
- Archived column renders at far right when toggle is on
- Archived column header: title + count + Hide button (no chevron, no drag)
- Archived status added to `RoadmapStatus` union

### Phase 3: Restore on Archived Cards
- Hover Restore button (`ArchiveRestore` or `RotateCcw`) on archived cards
- Moves item back to its pre-archive status

### Phase 4: Delete from Archive
- Per-card delete and Delete All — see section below

---

## Delete from Archive

The Archived column surfaces two delete paths — one per-card, one nuclear. Archive is soft removal; delete is permanent.

### Delete All (column-level)

A `Trash2` icon sits in the Archived column header, to the left of the Hide button.

```
[ Archive icon ]  Archived  (N)  ————————  [ 🗑 ]  [ Hide ]
```

- On hover: tooltip reads **"Delete all archived items"**
- On click: opens a **destructive confirmation modal**

#### Destructive Confirmation Modal

```
┌─────────────────────────────────────────┐
│  Delete all archived items?             │
│                                         │
│  This will permanently delete N         │
│  archived items. This action cannot     │
│  be undone.                             │
│                                         │
│              [ Cancel ]  [ Delete all ] │
└─────────────────────────────────────────┘
```

- Modal uses destructive styling: red/danger border, "Delete all" button in `bg-status-danger text-white`
- Default focus on **Cancel** (safe default)
- "Delete all" requires a deliberate click — no keyboard shortcut that could fire accidentally
- On confirm: all archived items removed from state.json; Archived column closes; toggle resets to off; item count updates

### Delete Individual (per-card)

Each archived card surfaces a `Trash2` icon on hover, in the same position and style as other lifecycle hover buttons.

```
[ Restore ]  title / metadata  [ 🗑 ]
```

- On click: item is immediately removed from state.json
- **No confirmation modal** — the toast provides the recovery window
- Toast fires: **"Item deleted"** + **Undo** button
- Undo TTL: matches the existing toast auto-dismiss duration (typically 5–8s); after dismissal, deletion is permanent
- Undo re-inserts the item at its previous position in the archived column

### What "Delete" Means for Files on Disk

> **Deliberate decision**: deleting a roadmap item removes it from `state.json` only.  
> Associated doc files (`docs/specs/item-spec.md`, `docs/plans/item-plan.md`) are **not touched**.

Rationale: spec and plan docs are often useful reference material even after an item is gone. Deleting files is a higher-stakes, harder-to-undo operation. If the user wants to clean up files too, they can do so manually or via a future "Deep Clean" feature.

This applies to both per-card delete and Delete All.
