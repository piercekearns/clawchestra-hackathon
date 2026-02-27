---
title: Flexible Layout Orientation
id: flexible-layout-orientation
status: pending
tags: [ux, layout, panels, customisation]
icon: "⊞"
nextAction: "Design orientation toggle + panel swap; decide on control placement and persistence"
lastActivity: "2026-02-27"
---

# Flexible Layout Orientation

Let users choose both the **orientation** (horizontal vs vertical stacking) and the **order** (which panel is on which side/edge) of the secondary chat drawer and the kanban board.

## Current Layout (fixed)

```
[ Thin strip | Sidebar ] | [ Secondary drawer ] | [ Kanban board ]
                           ←— horizontal only —→
```

Chat drawer is always left of the board. No vertical option exists.

## Target Layouts

### Orientation: Horizontal (default, current)
```
[ Sidebar ] | [ Chat drawer ] | [ Kanban board ]
[ Sidebar ] | [ Kanban board ] | [ Chat drawer ]   ← panel swap
```

### Orientation: Vertical
```
[ Sidebar ] | [ Chat drawer    ]
             [ Kanban board    ]

[ Sidebar ] | [ Kanban board   ]   ← panel swap
             [ Chat drawer     ]
```

In vertical mode the chat drawer and kanban share the full height, stacked top-to-bottom. The thin strip and main sidebar remain on the left as always.

---

## Design Decisions Needed

### 1 — Controls: Where and What?
Options to explore:
- **TitleBar icon** — a small layout toggle button (e.g. `LayoutGrid`, `Columns`, `Rows` from Lucide) in the top bar, cycles or opens a picker
- **Right-click on the divider/resize handle** — contextual, less discoverable
- **Settings page** — persistent but buried
- **Keyboard shortcut** — power users only, but composable with the above

Recommended: TitleBar button that opens a small 4-option picker (2 orientations × 2 panel orders = 4 layouts). Show a tiny diagram for each option so it's visually obvious.

### 2 — Panel Swap (independent of orientation)
The panel swap (chat left vs chat right, or chat top vs chat bottom) should be independently toggleable from orientation. These are orthogonal settings:
- `layoutOrientation`: `'horizontal' | 'vertical'`
- `layoutPanelOrder`: `'chat-first' | 'board-first'`

### 3 — When is vertical useful?
- Wide monitors: both panels can be full-width and still tall enough to be useful
- When the kanban board has many columns — vertical gives the board full width
- When the chat needs more vertical reading space than horizontal

Vertical mode probably only makes sense when the secondary drawer is open. When drawer is closed, orientation is irrelevant (just the kanban at full width).

### 4 — Resize handles
- **Horizontal mode**: existing vertical drag handle between chat drawer and board stays
- **Vertical mode**: needs a horizontal drag handle between the stacked panels; min/max heights to prevent crushing either panel

---

## Implementation Notes

### Store changes
Add to `useDashboardStore`:
```ts
layoutOrientation: 'horizontal' | 'vertical'   // default: 'horizontal'
layoutPanelOrder: 'chat-first' | 'board-first'  // default: 'chat-first'
setLayoutOrientation: (o: LayoutOrientation) => void
setLayoutPanelOrder: (o: LayoutPanelOrder) => void
```
Both should persist (add to persisted keys alongside `sidebarWidth`, `columnOrder`, etc.).

### App.tsx layout region
The main content area (right of sidebar) currently uses a horizontal flex. In vertical mode it switches to a vertical flex within the right-panel area:

```tsx
<div className={cn(
  "flex flex-1 overflow-hidden",
  orientation === 'vertical' ? "flex-col" : "flex-row"
)}>
  {panelOrder === 'chat-first' ? (
    <> <SecondaryDrawer ... /> <KanbanBoard ... /> </>
  ) : (
    <> <KanbanBoard ... /> <SecondaryDrawer ... /> </>
  )}
</div>
```

### Resize handle
- Horizontal mode: existing `SecondaryDrawer` left/right drag — no change
- Vertical mode: replace with a horizontal resize handle; store `hubDrawerHeight` alongside `hubDrawerWidth`; apply `min-height: 200px` on both panels

### Tauri `setMinSize`
In vertical mode, the min window height may need increasing to accommodate both stacked panels. Dynamic `setMinSize` call on orientation change (similar to how it's done for panel width constraints).
