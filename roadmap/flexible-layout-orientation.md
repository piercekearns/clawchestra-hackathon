# Flexible Layout Orientation

> Let users toggle between horizontal (side-by-side) and vertical (stacked) arrangement of the secondary chat drawer and kanban board, with a fixed left-side sidebar.

## Summary

Add an orientation toggle that switches the drawer + board from side-by-side (horizontal) to stacked (vertical). Lock the sidebar to the left side permanently — remove sidebar side-switching. Repurpose the thin sidebar's conversations button to toggle the secondary drawer open/closed. Panel swap (reversing drawer/board order within an orientation) is a planned Phase 2 addition.

---

**Roadmap Item:** `flexible-layout-orientation`
**Status:** In Progress
**Created:** 2026-02-27
**Updated:** 2026-03-04

---

## Decision: Sidebar Always Left

Other tools (Claude Code, Codex) don't offer sidebar side-switching — they impose a fixed left sidebar. Our side-switching feature created confusion: the secondary drawer could end up on one side, the thin strip on the other, and the mental model became unclear.

**Decision:** Sidebar + thin strip are always on the left. Remove the `ArrowLeftRight` switch-side button from the thin sidebar. Remove the right-side sidebar toggle from the title bar. Remove the `sidebarSide` store field and all side-conditional rendering logic.

This simplifies the layout model and makes the orientation toggle less confusing — there's one fixed anchor (sidebar, left) and one variable axis (drawer + board arrangement).

**Subsumes:** `sidebar-position-rethink` roadmap item — that item asked "should we revisit sidebar side-switching once layout orientation ships?" The answer is: we're removing it as part of this work. No separate evaluation needed.

---

## Layouts

### Horizontal (default — current behaviour)

```
[ Thin strip | Sidebar ] | [ Secondary drawer ] | [ Kanban board ]
```

Drawer is left of board. Existing vertical drag handle between them.

### Vertical (new)

```
[ Thin strip | Sidebar ] | [ Kanban board      ]
                            [ Secondary drawer  ]
```

Board on top, drawer on bottom. Both panels get the full remaining width (after sidebar). A horizontal drag handle between them controls the height split.

When the drawer is closed, orientation is irrelevant — the board takes full space regardless.

---

## Phase 1 — Orientation Toggle + Sidebar Lock-Down

### 1.1 — Remove sidebar side-switching

- Remove `sidebarSide` from the Zustand store
- Remove `ArrowLeftRight` button from `ThinSidebar.tsx`
- Remove the right-side sidebar toggle from `TitleBar.tsx`
- Remove all `side === 'right'` conditional rendering in `App.tsx`, `ThinSidebar.tsx`, `SecondaryDrawer.tsx`
- Sidebar + thin strip always render on the left

### 1.2 — Repurpose conversations button in thin sidebar

The `MessageSquare` "Conversations" button in the thin sidebar currently opens the full sidebar (same as the sidebar toggle — redundant). Repurpose it to toggle the secondary drawer open/closed instead.

- Change `onToggleHub` handler to call `setHubDrawerOpen(!hubDrawerOpen)` (toggle the secondary drawer)
- Update the tooltip: "Toggle chat drawer" or similar
- Keep the unread badge — it's more useful here than ever, since the button now directly reveals the chat
- The user gets quick access to their last active chat/terminal without needing to expand the full sidebar first

### 1.3 — Orientation toggle button

Add a toggle button in the title bar, to the right of the existing left sidebar toggle:

- **When in horizontal mode:** show `Rows2` icon (indicates "click to switch to stacked/rows")
- **When in vertical mode:** show `Columns2` icon (indicates "click to switch to side-by-side/columns")
- Tooltip on hover: "Stack vertically" / "Arrange side by side" (describes what clicking will do)
- Single click toggles between the two orientations

### 1.4 — Vertical layout mode

The main content area (right of sidebar) switches flex direction:

```tsx
<div className={cn(
  "flex flex-1 overflow-hidden",
  orientation === 'vertical' ? "flex-col" : "flex-row"
)}>
  {orientation === 'vertical' ? (
    <> <KanbanBoard /> <SecondaryDrawer /> </>
  ) : (
    <> <SecondaryDrawer /> <KanbanBoard /> </>
  )}
</div>
```

Default panel order: horizontal = drawer-left/board-right, vertical = board-top/drawer-bottom.

### 1.5 — Vertical resize handle

In vertical mode, the SecondaryDrawer's drag handle switches from width-adjustment to height-adjustment:

- Same visual style as the existing vertical drag handle (notches, hover highlight, cursor change)
- Cursor: `row-resize` instead of `col-resize`
- Drag adjusts `hubDrawerHeight` instead of `hubDrawerWidth`
- Min height: 200px per panel (both drawer and board)
- Double-click resets to 50/50 split

### 1.6 — Store changes

Add to `useDashboardStore`:

```ts
layoutOrientation: 'horizontal' | 'vertical'   // default: 'horizontal'
hubDrawerHeight: number                         // default: 400 (or 50% of available)
setLayoutOrientation: (o: 'horizontal' | 'vertical') => void
setHubDrawerHeight: (h: number) => void
```

Remove from store:
```ts
sidebarSide   // no longer needed — always 'left'
```

Both `layoutOrientation` and `hubDrawerHeight` should persist (add to persisted keys alongside `hubDrawerWidth`, `sidebarWidth`, etc.).

### 1.7 — Dynamic Tauri `setMinSize`

Recalculate minimum window size on orientation change:

**Horizontal mode (drawer open):**
- `minWidth = thinStrip(44) + sidebar(220) + drawer(280) + board(480)` = 1024px
- `minHeight = 600px`

**Vertical mode (drawer open):**
- `minWidth = thinStrip(44) + sidebar(220) + max(drawer_min, board_min)` = ~744px
- `minHeight = titleBar + drawer(200) + board(200)` = ~440px (review if 600px floor is still appropriate)

Call `setMinSize` on: orientation change, drawer open/close, sidebar collapse toggle.

---

## Phase 2 — Panel Swap (Later)

Add a "flip" control that reverses the two panels within whichever orientation is active:

- Horizontal: drawer-left/board-right vs board-left/drawer-right
- Vertical: board-top/drawer-bottom vs drawer-top/board-bottom

Store:
```ts
layoutPanelOrder: 'chat-first' | 'board-first'   // default: 'chat-first'
setLayoutPanelOrder: (o: 'chat-first' | 'board-first') => void
```

Control placement TBD — could be a secondary toggle near the orientation button, or a right-click option on the drag handle between panels.

---

## Relationship to Responsive Layout Constraints

Vertical stacking directly addresses the terminal width pressure problem identified in `responsive-layout-constraints`. In horizontal mode, terminal + board compete for width (~1260px minimum). In vertical mode, both get full width (~744px minimum).

This opens a potential concertina strategy: when horizontal width becomes insufficient for terminal + board, auto-flip to vertical rather than collapsing panels to slideovers. The responsive-layout-constraints spec should be updated to consider this as a cascade step.

However, vertical orientation doesn't replace responsive constraints — horizontal mode still needs proper concertina logic, and vertical mode introduces its own height constraints. The two specs complement each other.

---

## Implementation Notes

### Terminal-aware height minimum

When a terminal tab is active in the secondary drawer and the layout is vertical, the drawer's minimum height should be taller than the generic 200px — terminals need vertical space to be useful. Consider 300-400px as the terminal-active floor in vertical mode (mirroring the 560px terminal-active width floor in horizontal mode).

### Drawer closed state

When the secondary drawer is closed, orientation is irrelevant — the board takes full space. The orientation toggle should still be visible and functional (setting persists for when the drawer is next opened).

### Keyboard shortcut

Consider a keyboard shortcut for orientation toggle (e.g. `Cmd+Shift+L` or similar). Power users switching frequently between terminal work (vertical) and overview work (horizontal) would benefit.
