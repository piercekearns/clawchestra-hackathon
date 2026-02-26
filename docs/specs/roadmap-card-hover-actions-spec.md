# Roadmap Card Hover Actions: Archive & Complete

> Quick-action buttons surfaced on hover that let users archive or complete a roadmap item in one click — with undo support.

**Status:** Draft
**Created:** 2026-02-26
**Roadmap Item:** `roadmap-card-hover-actions`

---

## Problem

Moving a roadmap item to "complete" or "archive" requires opening the card modal and changing the status via the status dropdown. For frequent, low-ceremony state transitions — "I finished this" or "I'm parking this" — that's too many steps. Users should be able to do it directly from the board without opening anything.

## What Success Looks Like

- Hovering over a roadmap item card reveals two action buttons on the **right side** of the lifecycle button row
- **Archive button** (trash/bin icon) and **Complete button** (check-circle icon) appear on hover, same visual style as the existing lifecycle buttons
- Clicking either fires the state change immediately and shows a **toast notification** with an **Undo** button
- Undo reverses the action and restores the card to its original column
- The complete action works even if the "complete" column is collapsed — the item goes there and the column count increments

## Layout

```
[lifecycle icon] [lifecycle icon]   ·   [✓ complete] [🗑 archive]
└─── left side ──────────────────┘   └── right side (hover only) ─┘
```

Same row, same icon size/style as lifecycle buttons. Left group = existing lifecycle icons. Right group = the two new action buttons, separated by a small gap or divider. Hidden until hover.

## Behaviour

### Complete
- Sets item status → `complete`
- Item moves to the `complete` column on the board
- If the `complete` column is collapsed/minimized, it still receives the item (count badge updates)
- Toast: **"Item completed"** with **Undo** button
- Undo: restores original status, item reappears in its original column

### Archive
- Sets item status → `archived`
- Toast: **"Item archived"** with **Undo** button
- Undo: restores original status

### Toast spec

**Stacking:** Multiple toasts stack vertically — new toasts appear above (or below) existing ones rather than replacing them. Each toast has its own independent 5s countdown. If the user archives three cards in quick succession, all three toasts are visible simultaneously and each is independently interactable until it times out.

**Dismissal animation:** When a toast's timer expires (or the user manually dismisses it), it fades out and slides away. The remaining toasts reflow into the vacated space with a smooth height animation — no jarring jumps.

**Undo window:** The Undo button on each toast is accessible until that specific toast dismisses. Rapid-firing archive/complete actions does not collapse or replace earlier toasts, so all undos are accessible in the window after the actions were taken.

**Specifics:**
- Each toast auto-dismisses after **5s** from the moment it appeared (independent timers, not shared)
- Toasts stack in reverse chronological order — newest on top (or configurable)
- Max visible stack: **5 toasts** — oldest silently dismissed if a 6th arrives before any have timed out (edge case)
- Undo button triggers immediate reversal and dismisses that toast instantly
- If the session ends or the user navigates away, undo is gone
- Toasts are scoped to the board view — they don't persist across page reloads

**Exit animation options (to be decided during implementation):**
- Fade out + collapse height (recommended — content shrinks away cleanly)
- Slide out to the right + collapse
- Scale down + fade

## Icons
- **Complete:** `CheckCircle2` (lucide) — same style as lifecycle buttons
- **Archive:** `Trash2` (lucide) — bin icon, universally understood as "remove"

## Build Order
1. Add hover button group to roadmap card component (right side of lifecycle row)
2. Wire click handlers to status update action (existing `updateRoadmapItemStatus`)
3. Build stacking toast system — an array of active toasts (id, message, undo callback, timestamp), each with its own independent timer; renders as a fixed stack in the corner; individual fade-out + height-collapse on dismiss
4. Wire Archive and Complete into the toast stack with Undo callbacks
5. Handle collapsed-column edge case for complete action

---

## ⚠️ Open Decision: What Does "Archived" Mean?

**This is an unresolved design question that must be decided before building the archive path.**

Currently `archived` is a valid project status but its treatment in the roadmap item context is undefined. Options:

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **Hidden by default** | Archived items filtered out of all columns; accessible via "Show archived" toggle | Clean board, easy to un-hide | Need toggle UI; items feel "lost" |
| **Separate archive column** | A non-draggable "Archived" column at the far right of the roadmap board | Visible; obvious | Clutters the board; grows unbounded |
| **Board-level archive view** | A separate board view (toggle) that shows only archived items | Clean separation | More UI surface area to build |
| **Soft-delete (hidden forever)** | Items removed from board entirely; only recoverable via undo or raw JSON | Simplest | Lossy; no recovery after toast dismissed |

**Recommendation (not yet accepted):** Hidden by default with a per-board "Show archived" toggle — consistent with how most kanban tools handle it, and keeps the board clean without discarding data.

**This decision needs to be made and recorded here before the archive path ships.**

---

## Non-Goals
- Bulk archive/complete (multiple items at once) — deferred
- Keyboard shortcuts for these actions — deferred
- Animation on card removal — nice to have, not required for v1
- Archive search or filtering beyond the basic "show archived" toggle
