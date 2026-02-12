# Plan: Cmd+K Search Modal

**Feature:** Global command palette for quick navigation and actions  
**Created:** 2026-02-12  
**Status:** Ready for implementation

---

## Goals

1. Open search modal with `Cmd+K` (Mac) / `Ctrl+K` (Windows/Linux)
2. Fuzzy search across projects (title, tags, nextAction, status)
3. Keyboard navigation (arrow keys, Enter to select, Escape to close)
4. Navigate to selected project (opens detail view)
5. Fast, responsive, feels native (like Spotlight/Raycast)

---

## Non-Goals (v1)

- Command execution (just navigation for now)
- Recent items / history
- Actions beyond navigation (edit, delete, etc.)
- Search across deliverables (only top-level projects)

---

## Technical Design

### Component Structure

```
src/components/search/
├── SearchModal.tsx       # Dialog wrapper + keyboard handling
├── SearchInput.tsx       # Input with icon, clear button
├── SearchResults.tsx     # Results list with keyboard nav
├── SearchResultItem.tsx  # Individual result row
└── index.ts              # Exports
```

### State Management

```typescript
interface SearchState {
  isOpen: boolean;
  query: string;
  selectedIndex: number;
  results: ProjectViewModel[];
}
```

- State lives in `SearchModal` (local, not Zustand)
- Results computed via `useMemo` with fuzzy matching
- No debounce needed (client-side filtering is instant)

### Fuzzy Search

Use `fuse.js` for fuzzy matching:

```typescript
const fuse = new Fuse(projects, {
  keys: [
    { name: 'title', weight: 2 },
    { name: 'tags', weight: 1.5 },
    { name: 'nextAction', weight: 1 },
    { name: 'id', weight: 0.5 },
  ],
  threshold: 0.4,
  includeScore: true,
});
```

### Keyboard Handling

| Key | Action |
|-----|--------|
| `Cmd+K` / `Ctrl+K` | Open modal |
| `Escape` | Close modal |
| `↑` / `↓` | Navigate results |
| `Enter` | Select highlighted result |
| `Cmd+Enter` | Select + open in new... (future) |

Global listener in `App.tsx`:
```typescript
useEffect(() => {
  const handler = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      setSearchOpen(true);
    }
  };
  window.addEventListener('keydown', handler);
  return () => window.removeEventListener('keydown', handler);
}, []);
```

### UI Design

```
┌─────────────────────────────────────────────┐
│ 🔍 Search projects...                     ✕ │
├─────────────────────────────────────────────┤
│ ▶ Revival Fightwear          in-flight  P1 │
│   ClawOS                     in-flight  P2 │
│   Pipeline Dashboard         in-flight  P3 │
│   Memestr                    up-next    P1 │
│   ...                                       │
├─────────────────────────────────────────────┤
│ ↑↓ to navigate · Enter to open · Esc close │
└─────────────────────────────────────────────┘
```

- Modal centered, max-width 640px
- Dark backdrop with blur
- Results show status badge + priority
- Highlighted item has accent background
- Footer shows keyboard hints

### Integration Points

1. **App.tsx** — Add global `Cmd+K` listener, render `<SearchModal />`
2. **useDashboardStore** — Access `projects` for search
3. **setSelectedProjectId** — Navigate to selected project

---

## Implementation Steps

### Phase 1: Core Modal (~30 min)
- [ ] Create `SearchModal.tsx` with dialog overlay
- [ ] Add `SearchInput.tsx` with focus management
- [ ] Add global `Cmd+K` listener in App.tsx
- [ ] Basic open/close with Escape

### Phase 2: Search + Results (~30 min)
- [ ] Install `fuse.js` dependency
- [ ] Implement fuzzy search over projects
- [ ] Create `SearchResults.tsx` with result list
- [ ] Create `SearchResultItem.tsx` with status/priority badges

### Phase 3: Keyboard Navigation (~20 min)
- [ ] Arrow key navigation with `selectedIndex`
- [ ] Enter to select and navigate
- [ ] Scroll selected item into view
- [ ] Auto-select first result

### Phase 4: Polish (~20 min)
- [ ] Empty state ("No results")
- [ ] Keyboard hints in footer
- [ ] Focus trap inside modal
- [ ] Animation (fade in/out)

---

## Dependencies

| Package | Purpose | Install |
|---------|---------|---------|
| `fuse.js` | Fuzzy search | `pnpm add fuse.js` |

---

## Testing Checklist

- [ ] `Cmd+K` opens modal
- [ ] `Escape` closes modal
- [ ] Clicking backdrop closes modal
- [ ] Typing filters results in real-time
- [ ] Arrow keys navigate results
- [ ] Enter opens selected project
- [ ] Works with 0 results (shows empty state)
- [ ] Works with many results (scrollable)
- [ ] Focus returns to previous element on close

---

## Estimate

**Total: ~2 hours**

| Phase | Time |
|-------|------|
| Core Modal | 30 min |
| Search + Results | 30 min |
| Keyboard Navigation | 20 min |
| Polish | 20 min |
| Testing + Fixes | 20 min |

---

## Open Questions

None — ready to implement.
