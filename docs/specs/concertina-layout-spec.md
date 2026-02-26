# Concertina Layout — Minimum Widths + Coordinated Resize

> Enforce per-panel minimum widths and coordinated resize so no panel ever becomes unusably narrow, with the app's minimum window width dynamically matching the sum of visible panels' floors.

**Roadmap Item:** `concertina-layout`
**Status:** Draft
**Created:** 2026-02-26
**Depends On:** None (standalone layout concern)

---

## Problem

The current layout has no enforced minimum widths at the coordination layer:

- The **main board** has `min-w-0`, meaning it can shrink to zero if panels are wide
- The **sidebar** and **secondary drawer** have `shrink-0`, so they never give up space — they just push the board into uselessness
- The **Tauri window** has a static `minWidth: 960px` in config, which doesn't reflect how many panels are currently visible
- Panel resize handles (sidebar, drawer) have no awareness of remaining available space, so a user can drag the sidebar wide enough to crush the board below usable width

The result: the chat bar's header row can compress to the point where elements overlap; the kanban board can shrink to a sliver; the app has no coherent minimum.

---

## What "Correct" Looks Like

Each visible panel has a **defined minimum width floor** it will never go below. When the window narrows (or a panel is resized wider):

1. The **board shrinks first** — it's the most spacious and has the most tolerance
2. When the board hits its floor, the **secondary drawer** gives up space next
3. When the drawer hits its floor, the **sidebar** gives up space next
4. When all visible panels are at their floors, the window cannot go narrower (Tauri enforces the summed minimum)

On panel resize (user dragging a handle): the handle is clamped so it cannot push any other panel below its floor.

---

## Panel Minimum Widths

| Panel | Min Width | Notes |
|-------|-----------|-------|
| Thin sidebar | `44px` | Fixed, never changes |
| Full sidebar (open) | `220px` | `SIDEBAR_MIN_WIDTH` — already defined |
| Full sidebar (closed) | `0px` | Collapses to nothing |
| Secondary drawer | `280px` | `MIN_WIDTH` — already defined in SecondaryDrawer.tsx |
| Main board | `480px` | New — enough to render the chat bar header without compression |

**Summed minimum** (all panels open, left-sidebar config):
`44 + 220 + 280 + 480 = 1024px`

---

## Implementation: Three Coordinated Layers

### Layer 1 — CSS `min-width` (floor enforcement)

Remove `shrink-0` from panels that should be able to give up space (sidebar and secondary drawer). Add `minWidth` to their `style` prop:

- `SecondaryDrawer`: `style={{ width, minWidth: MIN_WIDTH }}` — CSS guarantees it never shrinks below 280px
- `Sidebar`: `style={{ width: sidebarOpen ? sidebarWidth : 0, minWidth: sidebarOpen ? SIDEBAR_MIN_WIDTH : 0 }}`
- Main board: `min-w-[480px]` instead of `min-w-0`

With `flex-1` on the board and `flex-shrink: 1` allowed on panels, the browser will naturally compress toward minimums in the right order. This layer alone handles the **window narrowing** case correctly via CSS.

**Limitation:** CSS does not prevent a user from *dragging* a resize handle to an invalid width. If the sidebar is dragged very wide, the board CSS `min-width` is not enforced by the flex engine when the sibling has an explicit pixel `width` — the board overflows behind the sidebar rather than clamping. This is why Layer 2 is needed.

---

### Layer 2 — JS Resize Coordinator (handle clamping)

A `useLayoutEffect`-based coordinator, or a shared utility function called by both the Sidebar and SecondaryDrawer resize handlers, that:

1. Knows the current **total available width** (`containerRef.current.offsetWidth`)
2. Knows the widths of **all other visible panels** (thin sidebar + the other resizable panel)
3. Computes the **maximum allowed width** for the panel being dragged:
   ```
   maxAllowed = totalWidth - otherPanelWidths - BOARD_MIN_WIDTH
   ```
4. **Clamps** `onWidthChange` to `Math.min(maxAllowed, Math.max(MIN_WIDTH, newWidth))`

This prevents the board from ever going below 480px regardless of how the user drags.

**Implementation options:**

**A — Pass state down via App.tsx (simplest)**
App.tsx computes `availableForResize = totalWidth - thinSidebarWidth - (otherPanel || 0) - BOARD_MIN_WIDTH` and passes it as `maxWidth` props to both Sidebar and SecondaryDrawer. Each panel clamps to this max in its resize handler.

**B — Shared layout store (cleanest)**
Add `layoutConstraints` to the Zustand store: `{ totalWidth, thinSidebarWidth, sidebarWidth, drawerWidth, boardMinWidth }`. Sidebar and SecondaryDrawer read from the store when computing clamping. App.tsx writes `totalWidth` via a `ResizeObserver` on the main row container.

Option B is recommended — it avoids prop drilling and makes the constraint logic testable and centralised.

---

### Layer 3 — Dynamic Tauri Window Minimum

The Tauri window has a static `minWidth: 960px` in `tauri.conf.json`. This should be updated dynamically when panel visibility changes using the Tauri window API:

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';

// Called whenever sidebarOpen, hubDrawerOpen, showThinSidebar change
async function updateWindowMinWidth() {
  const minW = BOARD_MIN_WIDTH
    + (showThinSidebar ? THIN_SIDEBAR_WIDTH : 0)
    + (sidebarOpen ? SIDEBAR_MIN_WIDTH : 0)
    + (hubDrawerOpen ? DRAWER_MIN_WIDTH : 0);

  await getCurrentWindow().setMinSize({ type: 'Logical', width: minW, height: 600 });
}
```

This ensures the OS-level window resize grip cannot drag the window narrower than the current layout requires.

**Note:** `setMinSize` is a Tauri v2 API. Confirm it's available in the current Tauri version before implementing.

---

## Order of Implementation

1. **Layer 1 (CSS)** — low risk, 15 min. Immediately prevents board from going to zero and gives panels some CSS-level floor. Does not fully solve resize handle clamping but is a meaningful improvement.
2. **Layer 2 (JS coordinator)** — medium effort, 1–2h. Requires adding `totalWidth` to the store and updating both resize handlers.
3. **Layer 3 (Tauri)** — small effort once Layer 2 is done, 30 min. Just the API call triggered on visibility changes.

Do all three in one build, not incrementally shipped — partial implementation (Layer 1 only) was reverted because CSS alone looks fixed but breaks on drag.

---

## Constants Reference

Define in a shared `layout-constants.ts` file imported by all affected components:

```ts
export const THIN_SIDEBAR_WIDTH = 44;
export const SIDEBAR_MIN_WIDTH = 220;    // already in store
export const DRAWER_MIN_WIDTH = 280;     // already in SecondaryDrawer.tsx
export const BOARD_MIN_WIDTH = 480;
```

---

## Non-Goals

- Per-column kanban board minimum widths (separate concern — kanban can scroll horizontally if there are many columns)
- Responsive breakpoints for mobile (this is a desktop app)
- Animated transitions when min-width is hit (could be added later)
