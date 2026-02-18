# Collapsible Sidebar — Implementation Plan

**Spec:** `docs/specs/collapsible-sidebar-spec.md`
**Roadmap Item:** `roadmap/collapsible-sidebar.md`
**Created:** 2026-02-18
**Reviewed:** 2026-02-18 (`/plan_review` — 3 sub-agents: DHH, Kieran, Code Simplicity)
**Review corrections applied:** 2026-02-18

---

## Executive Summary

Build a resizable collapsible sidebar: a left panel with Codex-style title bar toggle, drag-to-resize handle, and persisted width. Simultaneously streamline the header by promoting theme controls to the title bar, removing the status filter, and moving Settings into the sidebar. No sidebar *content* beyond a Settings button — that's a future decision.

---

## Pre-Build: Resolved Questions

### Q1: Title bar — Tauri decorations or custom?

**Answer:** Use Tauri's overlay title bar mode to keep native traffic lights while rendering custom content in the title bar region:

```json
{
  "decorations": true,
  "titleBarStyle": "overlay",
  "hiddenTitle": true
}
```

> ⚠️ **Critical:** `decorations` must be `true`, not `false`. In Tauri v2, `titleBarStyle: "overlay"` is only meaningful when decorations are enabled. Setting `decorations: false` removes ALL native chrome including traffic lights.

**Cross-platform note:** `titleBarStyle: "overlay"` is macOS-specific. Windows/Linux will need different handling (custom window controls). This is a macOS-first app — defer cross-platform title bar to a future pass.

### Q2: Settings persistence path

**Answer:** Sidebar state (`sidebarOpen`, `sidebarWidth`) goes in the Zustand persist store (localStorage) alongside `collapsedColumns` and `columnOrder`.

> Note: The spec says "Tauri settings DB" — update spec to say "Zustand persist (localStorage)".

### Q3: Does SearchModal use status filtering?

**Answer:** No. `SearchModal` has no status filter dependency — it only sorts by status priority when there's no query. The `statusFilter` state can be removed entirely.

> ⚠️ **Behavior change:** Removing `statusFilter` means the board always shows all statuses. Currently nobody uses it (the dropdown defaults to "all"), but document this removal explicitly in the commit message.

---

## Step-by-Step Build Order

### Step 1: Tauri Config — Title Bar + Min Dimensions

**Files:** `src-tauri/tauri.conf.json`

```json
{
  "title": "Clawchestra",
  "width": 1440,
  "height": 900,
  "minWidth": 960,
  "minHeight": 600,
  "resizable": true,
  "decorations": true,
  "titleBarStyle": "overlay",
  "hiddenTitle": true,
  "dragDropEnabled": false
}
```

**Verify:** App launches with traffic lights visible but no native title text. Content extends to the top of the window behind the traffic lights.

---

### Step 1.5: Extract `useAppUpdate` Hook

**New file:** `src/hooks/useAppUpdate.ts`

Extract the Update check/install logic from `Header.tsx` (lines ~40-80) into a reusable hook:

```typescript
export function useAppUpdate(): {
  updateAvailable: boolean;
  updating: boolean;
  handleUpdate: () => Promise<void>;
}
```

**Rationale:** The app is being built with multi-consumer architecture in mind. Even though TitleBar is the only consumer today, future features (e.g., settings panel, system tray) may need update state. Extract the hook now to establish the pattern.

---

### Step 2: TitleBar Component

**New file:** `src/components/TitleBar.tsx`

A thin, full-width bar at the very top of the app. Uses `data-tauri-drag-region` for window dragging.

```
┌────────────────────────────────────────────────────────────────┐
│ (traffic light inset)  ◧  🦞 Clawchestra  [Update]   [☀🌙⚙️] │
└────────────────────────────────────────────────────────────────┘
```

**Contents (left to right):**
1. **Left padding** (~70px on macOS) to clear the traffic lights
2. **Sidebar toggle** (inline, not a separate component) — `PanelLeft` / `PanelLeftClose` icons from lucide-react. Reads `sidebarOpen` from Zustand directly, calls `setSidebarOpen(!sidebarOpen)`.
3. **Logo** (existing `logo.png` / `logo-dark.png`, scaled to ~20px height)
4. **"Clawchestra"** text (`text-sm font-semibold`)
5. **Update badge** (via `useAppUpdate` hook — same chartreuse pill)
6. **(spacer)**
7. **Theme toggle** (moved from Header — same 3-button group, slightly smaller)

**Styling:**
- Height: 38px
- Background: match page background (transparent/blur so it feels native)
- `data-tauri-drag-region` on the container
- Toggle button and theme buttons: `pointer-events-auto` (non-draggable islands)
- Non-Tauri fallback: render as a normal fixed bar

**Accessibility:**
- Sidebar toggle: `aria-expanded={sidebarOpen}`, `aria-controls="sidebar"`, `aria-label="Toggle sidebar"`
- Theme buttons: existing `aria-label` attributes carry over

---

### Step 3: Zustand Store — Sidebar State

**File:** `src/lib/store.ts`

Add to `DashboardState`:

```typescript
sidebarOpen: boolean;
sidebarWidth: number;       // current width in px
setSidebarOpen: (open: boolean) => void;
setSidebarWidth: (width: number) => void;
```

Defaults:
- `sidebarOpen: false`
- `sidebarWidth: 280` (default width when first opened)

Constants (can live in the store file or a constants file):
- `SIDEBAR_MIN_WIDTH = 200`
- `SIDEBAR_MAX_WIDTH = 480`
- `SIDEBAR_DEFAULT_WIDTH = 280`

**Critical:** Add both `sidebarOpen` and `sidebarWidth` to the `partialize` function (currently at `store.ts:345-349`):

```typescript
partialize: (state) => ({
  themePreference: state.themePreference,
  collapsedColumns: state.collapsedColumns,
  columnOrder: state.columnOrder,
  sidebarOpen: state.sidebarOpen,
  sidebarWidth: state.sidebarWidth,
}),
```

No `toggleSidebar` convenience — callers use `setSidebarOpen(!current)` directly. One setter per state value keeps the store clean.

---

### Step 4: Sidebar Container

**New file:** `src/components/sidebar/Sidebar.tsx`

The sidebar reads its own state from Zustand directly (no props for open/width):

```typescript
const sidebarOpen = useDashboardStore(s => s.sidebarOpen);
const sidebarWidth = useDashboardStore(s => s.sidebarWidth);
const setSidebarWidth = useDashboardStore(s => s.setSidebarWidth);
```

**Layout:**
- Width: `sidebarWidth` when open, `0` when closed
- Animation: 200ms ease-out on `width` and `transform`
- Border-right: `neutral-200` / `neutral-700`
- Background: `neutral-50` / `neutral-900`

**Drag handle (right edge):**
- A 4–6px hit area on the right border of the sidebar
- Cursor: `col-resize` on hover
- On `mousedown`: attach `mousemove` + `mouseup` listeners to `document`
- `mousemove`: `setSidebarWidth(clamp(e.clientX, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH))`
- `mouseup`: remove listeners
- Subtle visual indicator: slightly thicker/lighter border on hover, or a small grip icon

**Content (Phase 1 — minimal):**
```
┌─────────────────────┬──┐
│                     │▐▐│  ← drag handle (right edge)
│   (empty space)     │▐▐│
│                     │▐▐│
├─────────────────────┤  │
│ ⚙ Settings          │  │  ← bottom-pinned, opens existing SettingsDialog
└─────────────────────┴──┘
```

The Settings button calls the existing `SettingsDialog` open handler (passed as a callback or via a Zustand action).

**Accessibility:**
- Container: `id="sidebar"`, `role="complementary"`, `aria-label="Sidebar"`
- Drag handle: `role="separator"`, `aria-orientation="vertical"`, `aria-valuenow={sidebarWidth}`, `aria-valuemin={SIDEBAR_MIN_WIDTH}`, `aria-valuemax={SIDEBAR_MAX_WIDTH}`

---

### Step 5: Simplify Header

**File:** `src/components/Header.tsx`

Major reduction. Remove:
- Logo + "Clawchestra" title (→ TitleBar)
- Update badge (→ TitleBar via `useAppUpdate` hook)
- Theme toggle (→ TitleBar)
- Settings gear button (→ Sidebar)
- Status filter dropdown (removed entirely — **behavior change**: board always shows all statuses; search results panel visibility condition may reference this, document explicitly)

What remains — **a single row**:

```
┌──────────────────────────────────────────────────────────────┐
│ [🔍 Search by title, id, tag...              ⌘K] [↻] [+ Add]│
└──────────────────────────────────────────────────────────────┘
```

**Simplified prop interface:**
```typescript
interface HeaderProps {
  errors: DashboardError[];
  onRefresh: () => Promise<void>;
  onAddProject: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
}
```

**In `App.tsx`:** Remove `statusFilter` state (`useState<string>('all')`) and the `statusFilter` comparison in the `searchResults` memo.

---

### Step 6: App Layout Restructure

**Files:** `src/App.tsx`, `src/components/chat/ChatShell.tsx`

Current layout:
```
<div className="h-screen ... px-4 pb-32 pt-4">  ← pb-32 compensates for fixed ChatShell
  <div className="flex h-full flex-col">
    <Header />
    <Breadcrumb />
    <main> <Board /> </main>
  </div>
  <ChatShell />  <!-- fixed inset-x-0 bottom-0 -->
</div>
```

New layout:
```
<div className="h-screen flex flex-col">
  <TitleBar />                              ← fixed height ~38px
  <div className="flex flex-1 min-h-0">    ← horizontal split
    <Sidebar />                             ← 0 or sidebarWidth px
    <div className="flex flex-1 flex-col min-w-0">  ← content column
      <Header />                            ← simplified single row
      <Breadcrumb />
      <main className="flex-1 overflow-auto"> <Board /> </main>
      <ChatShell />                         ← bottom of content column
    </div>
  </div>
</div>
```

**Key changes:**
1. `TitleBar` is the first child, always full width
2. Below it, a horizontal flex container holds `Sidebar` + content column
3. The content column is a vertical flex: header → breadcrumb → board → chat
4. **Sidebar width is dynamic** — driven by `sidebarWidth` from Zustand. The flex layout responds naturally; no hardcoded offsets.
5. The sidebar spans full height of the middle section

#### ChatShell Repositioning (highest-risk change)

Current ChatShell uses:
- **Line ~394:** `fixed inset-x-0 bottom-0` on the outer wrapper
- **Line ~412:** `fixed inset-0` on the backdrop overlay

Required changes:
1. **Remove `fixed inset-x-0 bottom-0`** from the outer wrapper. Make it a normal flex child at the bottom of the content column.
2. **Keep `fixed inset-0`** on the backdrop overlay — this is modal-style and should remain fixed/fullscreen.
3. **Remove `pb-32`** from `App.tsx` (~line 1109) — this padding only existed to compensate for the fixed ChatShell.
4. **Test the drawer expand/collapse animation** — currently slides up from fixed bottom. In the new layout, the expanded drawer may need `position: absolute` + `bottom: 0` + full height relative to the content column, or a different approach. Test thoroughly.

**Why full restructure over conditional offset:** With a *resizable* sidebar, the content column's width changes dynamically via flexbox. A fixed-position ChatShell with `left: sidebarWidth` would need to subscribe to width changes and re-render on every drag frame. Putting ChatShell in the flex flow means it automatically responds to sidebar width without extra logic.

---

### Step 7: Keyboard Shortcut — Cmd+B

**File:** `src/App.tsx` (in the existing `keydown` handler)

```typescript
if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
  event.preventDefault();
  const current = useDashboardStore.getState().sidebarOpen;
  useDashboardStore.getState().setSidebarOpen(!current);
  return;
}
```

**Escape key:** Add sidebar close to the existing priority chain, after modals/search/chatDrawer but before roadmapView exit:

```
search > chatDrawer > selectedProject > addDialog > settingsDialog > SIDEBAR > roadmapView
```

---

### Step 8: Resizable Sidebar Polish

**Files:** `src/components/sidebar/Sidebar.tsx`

This step is about refining the drag-to-resize behavior from Step 4:

1. **Double-click to reset** — Double-clicking the drag handle resets width to `SIDEBAR_DEFAULT_WIDTH` (280px)
2. **Snap to close** — If the user drags below `SIDEBAR_MIN_WIDTH - 40` (i.e., below 160px), snap the sidebar closed entirely (`setSidebarOpen(false)`). Reset width to default so next toggle opens at 280px.
3. **Smooth dragging** — Ensure `mousemove` handler uses `requestAnimationFrame` to avoid janky redraws during drag
4. **Disable text selection during drag** — Add `user-select: none` to `<body>` during drag, remove on `mouseup`
5. **Visual feedback** — Drag handle gets a subtle highlight color during active drag

**No responsive breakpoints.** This is a desktop Tauri app with `minWidth: 960`. One mode: sidebar pushes content. The resizable handle gives users all the flexibility they need.

---

## File Summary

### New Files (3)

| File | Purpose |
|------|---------|
| `src/hooks/useAppUpdate.ts` | Extract Update check/install logic from Header |
| `src/components/TitleBar.tsx` | Custom title bar with drag region, inline toggle, title, Update, theme |
| `src/components/sidebar/Sidebar.tsx` | Sidebar container with resize handle + Settings button |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Strip to single row: search + Refresh + Add Project |
| `src/App.tsx` | New layout structure, Cmd+B shortcut, remove `statusFilter` + `pb-32` |
| `src/lib/store.ts` | Add `sidebarOpen`, `sidebarWidth`, `setSidebarOpen`, `setSidebarWidth` + `partialize` |
| `src-tauri/tauri.conf.json` | `minWidth/minHeight`, `decorations: true`, `titleBarStyle: "overlay"`, `hiddenTitle: true` |
| `src/components/chat/ChatShell.tsx` | Remove fixed positioning on outer wrapper |

### Removed (from Header)

- Logo + title (→ TitleBar)
- Update badge (→ TitleBar via `useAppUpdate` hook)
- Theme toggle (→ TitleBar)
- Settings gear (→ Sidebar)
- Status filter (→ removed entirely; behavior change documented)

---

## Build Order Dependency Graph

```
Step 1  (Tauri config)
  └─→ Step 1.5 (useAppUpdate hook)
        └─→ Step 2 (TitleBar) ───────────────┐
Step 3  (Store: sidebar state + width)        │
  └─→ Step 4 (Sidebar + drag handle)         │
        └─→ Step 6 (App layout) ←────────────┘
              └─→ Step 5 (Simplify Header)
                    └─→ Step 7 (Cmd+B + Escape)
                          └─→ Step 8 (Resize polish)
```

Steps 1/1.5 and 3/4 can be built in parallel. Step 6 is the integration point. Step 5 should happen during or after Step 6 since the layout change and header change are tightly coupled.

---

## Risk Areas

1. **ChatShell repositioning (Step 6)** — Highest risk. Moving from fixed-position to flex child affects the drawer animation, backdrop, and z-index stacking. Test expanded drawer, collapsed bar, and all modal interactions.

2. **Tauri title bar on non-macOS** — `titleBarStyle: "overlay"` is macOS-specific. Defer cross-platform title bar handling. The app is macOS-first.

3. **Traffic light inset** — macOS traffic lights with `titleBarStyle: "overlay"` sit at a system-defined offset (~70px). Need to measure and add matching left padding. May vary with macOS version.

4. **Drag handle performance** — Resizing the sidebar on every `mousemove` could cause reflow jank if the board has many items. Mitigate with `requestAnimationFrame` throttling in Step 8.

---

## Verification Checklist

- [ ] App launches with native traffic lights, no native title text
- [ ] Custom title bar shows: toggle, logo, "Clawchestra", Update badge, theme toggle
- [ ] Title bar is draggable for window movement
- [ ] Clicking toggle opens/closes sidebar with smooth animation
- [ ] Sidebar opens to default width (280px)
- [ ] Drag handle on right edge resizes sidebar between 200px–480px
- [ ] Sidebar width persists across app restarts
- [ ] Double-click drag handle resets to default width
- [ ] Dragging below ~160px snaps sidebar closed
- [ ] Cmd+B toggles sidebar
- [ ] Escape closes sidebar (when no modal/search/drawer is open)
- [ ] Sidebar has Settings button at bottom that opens Settings dialog
- [ ] Board and chat bar compress when sidebar opens/resizes
- [ ] Chat bar stays at the bottom, never becomes a side panel
- [ ] Chat drawer still expands/collapses correctly
- [ ] Header is a single row: search bar + Refresh + Add Project
- [ ] Status filter is gone (board shows all statuses always)
- [ ] Settings gear is gone from header
- [ ] Theme toggle is gone from header (lives in title bar)
- [ ] Window cannot be resized below 960×600
- [ ] Sidebar open/closed state persists across app restarts
- [ ] All existing functionality still works (search, board drag, chat, modals)
- [ ] Sidebar toggle has correct aria-expanded attribute
- [ ] Drag handle has correct ARIA separator attributes

---

*Plan reviewed by 3 sub-agents, corrections applied per user decisions. Ready for build.*
