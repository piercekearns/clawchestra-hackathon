# Collapsible Kanban Columns

> Click a column header to collapse it. Click again to expand. No extra UI clutter in the default state.

## Summary

Kanban columns can be collapsed to reclaim board space. Clicking a column header toggles between expanded (full card list) and collapsed (thin bar with title + count). Expanded is the default — no arrows or toggles visible until a column is collapsed. Collapse state persists across sessions via Tauri settings. Works on both the project board and roadmap board.

---

**Roadmap Item:** `collapsible-kanban-columns`
**Status:** Up Next
**Created:** 2026-02-17

---

## Interaction Model

### Toggle

- **Trigger:** Click anywhere on the column header (title + count area)
- **Default state:** All columns expanded (no collapse indicators visible)
- **Animation:** Column width transitions over 200ms ease-out

### Expanded State (default)

```
┌──────────────────────┐
│ Up Next          (5) │  ← click to collapse
├──────────────────────┤
│ ┌──────────────────┐ │
│ │ Card 1           │ │
│ └──────────────────┘ │
│ ┌──────────────────┐ │
│ │ Card 2           │ │
│ └──────────────────┘ │
│ ...                  │
└──────────────────────┘
```

- Looks exactly like today — no arrows, no toggles, no extra chrome
- Header has `cursor: pointer` and subtle hover highlight (background tint) as the only discoverability hint
- Cards are fully visible and interactive

### Collapsed State

```
┌────┐
│ ▾  │
│ Up │
│ Ne │
│ xt │
│    │
│(5) │
└────┘
```

- Column shrinks to ~44px wide
- Title displayed vertically (rotated 90° or stacked characters)
- Item count badge visible at the bottom
- Small chevron-down (▾) at the top — the only collapse indicator, only shown in this state
- Cards are hidden (not rendered — saves DOM)
- Click anywhere on the collapsed bar to expand

### Hover Behaviour

| State | Hover Effect |
|-------|-------------|
| Expanded header | Subtle background tint (`neutral-100` / `neutral-800` dark) + `cursor: pointer` |
| Collapsed bar | Slightly brighter tint + `cursor: pointer` |

No tooltips needed — the click-to-toggle pattern is discoverable enough with the cursor change, and the chevron on collapsed columns makes it obvious they can be expanded.

## Visual Design

### Expanded column header

```
┌─────────────────────────────┐
│  Up Next                (5) │
└─────────────────────────────┘
```

- Left: column title (text, medium weight)
- Right: item count in parentheses or badge
- No arrow/chevron — clean default
- Full-width clickable area

### Collapsed column

```
┌──────┐
│  ▾   │   ← chevron indicates "expandable"
│      │
│  U   │
│  p   │   ← vertical title
│      │
│  N   │
│  e   │
│  x   │
│  t   │
│      │
│ (5)  │   ← count at bottom
└──────┘
```

- Width: 44px (fixed)
- Background: slightly different shade to distinguish from expanded columns
- Chevron-down (▾) at top — signals expandability
- Title: CSS `writing-mode: vertical-lr` with `text-orientation: mixed` for clean vertical text
- Count: horizontal at bottom

### Responsive to column count

When multiple columns are collapsed, the reclaimed space is distributed to the remaining expanded columns. Flex layout handles this naturally — collapsed columns get `flex: 0 0 44px`, expanded columns keep `flex: 1`.

## Data Model

### Storage

```typescript
// In Tauri settings (persisted)
interface CollapsedColumnsSettings {
  // Key: board identifier ("projects" | "roadmap:{projectId}")
  // Value: set of collapsed status strings
  collapsedColumns: Record<string, string[]>;
}
```

### Example

```json
{
  "collapsedColumns": {
    "projects": ["archived", "paused"],
    "roadmap:pipeline-dashboard": ["complete"]
  }
}
```

### Resolution

1. Check settings for collapsed columns for this board
2. Filter out any statuses that no longer exist
3. All unmentioned columns default to expanded

## Implementation

### Existing infrastructure

- **Column rendering:** Driven by column order arrays — add a collapsed check before rendering card list
- **Settings persistence:** Tauri settings DB already in use
- **Flex layout:** Columns already use flex — collapsed columns just get a smaller flex basis

### New code

| File | Change |
|------|--------|
| `src/lib/store.ts` | Add `collapsedColumns` state + `toggleColumnCollapse` action |
| `src/lib/settings.ts` | Read/write `collapsedColumns` from Tauri settings |
| `src/components/KanbanColumn.tsx` (or equivalent) | Collapsed/expanded rendering variants, click handler on header |
| `src/styles` | CSS for vertical text, collapsed column width, transition |

### Component logic

```typescript
function KanbanColumn({ status, items, collapsed, onToggle }: Props) {
  if (collapsed) {
    return (
      <div 
        className="flex-shrink-0 cursor-pointer ..." 
        style={{ width: 44 }}
        onClick={onToggle}
      >
        <ChevronDown className="h-3 w-3" />
        <span className="writing-vertical">{status}</span>
        <span>({items.length})</span>
      </div>
    );
  }

  return (
    <div className="flex-1 min-w-0 ...">
      <div className="cursor-pointer hover:bg-neutral-100 ..." onClick={onToggle}>
        <span>{status}</span>
        <span>({items.length})</span>
      </div>
      {items.map(item => <Card key={item.id} {...item} />)}
    </div>
  );
}
```

### Drag interaction with collapsible columns

When **Draggable Kanban Columns** is also implemented:
- Collapsed columns can still be drag targets (reorder by dragging the thin bar)
- Card drag-and-drop onto a collapsed column: auto-expand on hover (after 500ms delay), then allow card drop
- These are additive — collapsible works standalone without draggable

## Edge Cases

| Scenario | Behaviour |
|----------|-----------|
| All columns collapsed | Allowed — board shows a row of thin bars. User can expand any. |
| Column with 0 items collapsed | Shows count as (0) — still collapsible |
| New status added (not in saved state) | Defaults to expanded |
| Card dragged to collapsed column | Column auto-expands on 500ms hover, then accepts drop |
| Window resize with collapsed columns | Collapsed columns stay at 44px, expanded ones reflow |

## Build Estimate

**Small build.** Straightforward toggle with CSS transitions:
- ~1 store change (collapsed state + toggle action)
- ~1 component update (column collapsed/expanded variants)
- ~1 settings read/write
- Minor CSS additions (vertical text, width transition)

Pairs well with **Draggable Kanban Columns** — both operate on column headers and could share the same build cycle.

---

*Spec is a living document. Update as decisions are made during build.*
