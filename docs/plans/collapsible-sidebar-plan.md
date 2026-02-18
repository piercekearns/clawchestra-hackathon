# Collapsible Sidebar — Implementation Plan

**Spec:** `docs/specs/collapsible-sidebar-spec.md`
**Roadmap Item:** `roadmap/collapsible-sidebar.md`
**Created:** 2026-02-18

---

## Executive Summary

Build the sidebar shell: a collapsible left panel with Codex-style title bar toggle. Simultaneously streamline the header by promoting theme controls to the title bar, removing the unused status filter, and moving Settings into the sidebar. No sidebar *content* beyond a Settings button — that's a future decision.

---

## Pre-Build: Resolve Open Questions

Before writing code, answer these by inspecting the codebase:

### Q1: Title bar — Tauri decorations or custom?

**Answer:** The current app has **no custom title bar**. Tauri renders native macOS decorations (traffic lights). The `Header` component is a normal content-area `<header>` element. There is no `data-tauri-drag-region` anywhere.

**Implication:** We need to switch to Tauri's `decorations: false` mode and build a custom title bar with `data-tauri-drag-region`. The traffic lights need to be re-created or we use Tauri's `hiddenTitle` + transparent title bar approach. The cleanest path on macOS is:

```json
{
  "decorations": false,
  "titleBarStyle": "overlay",
  "hiddenTitle": true
}
```

This keeps native traffic lights but lets us render our own content in the title bar area. We add `data-tauri-drag-region` to the bar for window dragging.

### Q2: Settings persistence path

**Answer:** Settings are in `dashboard_settings` table via `getDashboardSettings()` / `updateDashboardSettings()` in `lib/tauri.ts`. Theme preference is in Zustand with `persist` middleware (localStorage). Sidebar open/closed state should go in the same Zustand persist store alongside `collapsedColumns` and `columnOrder`.

---

## Step-by-Step Build Order

### Step 1: Tauri Config — Title Bar + Min Dimensions

**Files:** `src-tauri/tauri.conf.json`

Add to the window config:

```json
{
  "title": "Clawchestra",
  "width": 1440,
  "height": 900,
  "minWidth": 960,
  "minHeight": 600,
  "resizable": true,
  "decorations": false,
  "titleBarStyle": "overlay",
  "hiddenTitle": true,
  "dragDropEnabled": false
}
```

**Key:** `decorations: false` removes the native title bar chrome but `titleBarStyle: "overlay"` keeps macOS traffic lights. We render our own title bar content and mark it as a drag region.

**Verify:** App launches with traffic lights visible but no native title text. Content extends to the top of the window.

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
2. **SidebarToggle** button — `PanelLeft` / `PanelLeftClose` icons from lucide-react
3. **Logo** (existing `logo.png` / `logo-dark.png`, scaled to ~20px height)
4. **"Clawchestra"** text (smaller than current — `text-sm font-semibold`)
5. **Update badge** (moved from Header — same logic, same chartreuse pill)
6. **(spacer)**
7. **Theme toggle** (moved from Header — same 3-button group, slightly smaller)

**Styling:**
- Height: 38px (enough for toggle + theme buttons without feeling cramped)
- Background: match page background (transparent/blur so it feels native)
- `data-tauri-drag-region` on the container
- Toggle button and theme buttons: `pointer-events-auto` (islands in the drag region)
- Non-Tauri fallback: render as a normal fixed bar (no drag region needed)

**Implementation notes:**
- Move the Update check/install logic from `Header.tsx` into `TitleBar.tsx` (or extract into a shared hook `useAppUpdate()`)
- Move the theme toggle JSX from `Header.tsx` into `TitleBar.tsx`
- The `SidebarToggle` reads `sidebarOpen` from the store and calls `toggleSidebar()`

---

### Step 3: Zustand Store — Sidebar State

**File:** `src/lib/store.ts`

Add to the persisted state (alongside `collapsedColumns`, `columnOrder`):

```typescript
// In DashboardState interface:
sidebarOpen: boolean;
toggleSidebar: () => void;
setSidebarOpen: (open: boolean) => void;
```

Default: `sidebarOpen: false`

Persisted via the existing Zustand `persist` middleware so it survives restarts.

---

### Step 4: Sidebar Container

**New file:** `src/components/sidebar/Sidebar.tsx`

The sidebar panel itself. Fixed 280px width, full height below the title bar.

```tsx
interface SidebarProps {
  open: boolean;
  onOpenSettings: () => void;
}
```

**Behaviour:**
- When `open`: renders at 280px width with slide-in animation (`transform: translateX(0)`)
- When closed: `width: 0`, content hidden (`overflow: hidden` + `translateX(-280px)`)
- Animation: 200ms ease-out on both `width` and `transform`
- Border-right: `neutral-200` / `neutral-700`
- Background: `neutral-50` / `neutral-900`

**Content (Phase 1 — minimal):**
- Empty main area (or a subtle "Sidebar content coming soon" placeholder — optional)
- **Settings button pinned to the bottom** (Codex-style):
  ```
  ┌─────────────────────┐
  │                     │
  │   (empty space)     │
  │                     │
  ├─────────────────────┤
  │ ⚙ Settings          │  ← bottom-pinned, opens existing SettingsDialog
  └─────────────────────┘
  ```

The Settings button calls `onOpenSettings` which triggers the existing `SettingsDialog`.

---

### Step 5: Simplify Header

**File:** `src/components/Header.tsx`

Major reduction. Remove:
- Logo + "Clawchestra" title (moved to TitleBar)
- Update badge (moved to TitleBar)
- Theme toggle (moved to TitleBar)
- Settings gear button (moved to Sidebar)
- Status filter dropdown (removed — unused)
- The entire top row of buttons (Refresh, Add Project, Settings, Theme)

What remains — **a single row**:

```
┌──────────────────────────────────────────────────────────────┐
│ [🔍 Search by title, id, tag...              ⌘K] [↻] [+ Add]│
└──────────────────────────────────────────────────────────────┘
```

**Implementation:**
- Remove the first `<div>` (the row with logo, title, Update, Refresh, Add Project, Settings, Theme)
- Keep the search `<Input>` and ⌘K hint
- Add compact Refresh icon button and Add Project button to the right of the search bar
- Remove the `<select>` status filter and its wrapper
- Remove props: `themePreference`, `onChangeTheme`, `statusFilter`, `onStatusFilterChange`, `statusOptions`, `onOpenSettings`
- Keep props: `errors`, `onRefresh`, `onAddProject`, `searchQuery`, `onSearchQueryChange`
- The `ErrorBadge` can stay in the header or move to the title bar — keep it in the header for now (errors are contextual to the board)

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

---

### Step 6: App Layout Restructure

**File:** `src/App.tsx`

Current layout (simplified):
```
<div className="h-screen ...">
  <div className="flex h-full flex-col">
    <Header />
    <Breadcrumb />
    <main> <Board /> </main>
  </div>
  <ChatShell />  <!-- fixed-position bottom bar -->
</div>
```

New layout:
```
<div className="h-screen flex flex-col">
  <TitleBar />                          ← NEW (fixed height ~38px)
  <div className="flex flex-1 min-h-0"> ← horizontal split
    <Sidebar />                         ← NEW (0 or 280px, full height)
    <div className="flex flex-1 flex-col min-w-0"> ← content column
      <Header />                        ← simplified single row
      <Breadcrumb />
      <main> <Board /> </main>
      <ChatShell />                     ← bottom of content column (not fixed-position)
    </div>
  </div>
</div>
```

**Key changes:**
1. `TitleBar` is the first child, always full width
2. Below it, a horizontal flex container holds `Sidebar` + content column
3. The content column is a vertical flex: header → breadcrumb → board → chat
4. `ChatShell` moves from a fixed-position overlay to the bottom of the content column (this is what makes it compress with the sidebar)
5. The sidebar spans the full height of this middle section

**ChatShell positioning:**
Currently `ChatShell` uses fixed positioning. It needs to become a flex child at the bottom of the content column instead. This may require changes to `ChatShell.tsx` or its wrapper — the collapsed bar needs to sit at the bottom of the content column, and the expanded drawer needs to expand upward from there.

**Padding adjustments:**
The current `px-4 pb-32 pt-4` on the root div accounts for the fixed ChatShell. With the new layout, the chat bar is in-flow, so the `pb-32` can be removed. The `pt-4` may need adjusting to account for the title bar height.

---

### Step 7: Keyboard Shortcut — Cmd+B

**File:** `src/App.tsx` (in the existing `keydown` handler)

Add before the existing `Cmd+K` handler:

```typescript
// Cmd+B toggles sidebar
if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
  event.preventDefault();
  toggleSidebar();
  return;
}
```

Also add Escape handling: if sidebar is open and no modal/dialog is active, close it.

---

### Step 8: Responsive Behaviour

**File:** `src/components/sidebar/Sidebar.tsx` + `src/App.tsx`

Add a window width listener:
- **≥ 1280px:** Sidebar is inline (pushes content)
- **1024–1279px:** Sidebar overlays content (`position: absolute`, `z-index` above board)
- **< 1024px:** Sidebar is a full-width slide-over

Implementation: a `useMediaQuery` hook or `useEffect` + `window.matchMedia`. The sidebar component accepts an `overlay` prop that switches between inline and absolute positioning.

Auto-collapse: if the window is resized to `< 1024px` while the sidebar is open, switch to overlay mode (don't force-close — just change positioning).

---

## File Summary

### New Files (4)

| File | Purpose |
|------|---------|
| `src/components/TitleBar.tsx` | Custom title bar with drag region, toggle, title, Update, theme |
| `src/components/sidebar/Sidebar.tsx` | Sidebar container with animation + Settings button |
| `src/components/sidebar/SidebarToggle.tsx` | Toggle button component (◧/◨ icon states) |
| `src/hooks/useAppUpdate.ts` | Extract Update check/install logic from Header (shared by TitleBar) |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Strip to single row: search + Refresh + Add Project |
| `src/App.tsx` | New layout structure (TitleBar → sidebar + content column), Cmd+B shortcut, remove status filter state |
| `src/lib/store.ts` | Add `sidebarOpen`, `toggleSidebar`, `setSidebarOpen` to persisted state |
| `src-tauri/tauri.conf.json` | `minWidth`, `minHeight`, `decorations: false`, `titleBarStyle: "overlay"`, `hiddenTitle: true` |
| `src/components/chat/ChatShell.tsx` | May need positioning changes (fixed → flex child) depending on current implementation |

### Removed (from Header)

- Logo + title (→ TitleBar)
- Update badge (→ TitleBar)
- Theme toggle (→ TitleBar)
- Settings gear (→ Sidebar)
- Status filter (→ removed entirely)
- Top button row (→ Refresh + Add Project move next to search bar)

---

## Build Order Dependency Graph

```
Step 1 (Tauri config)
  └─→ Step 2 (TitleBar) ─────────────────────┐
Step 3 (Store: sidebar state)                 │
  └─→ Step 4 (Sidebar container)             │
        └─→ Step 6 (App layout) ←────────────┘
              └─→ Step 5 (Simplify Header)
                    └─→ Step 7 (Cmd+B shortcut)
                          └─→ Step 8 (Responsive)
```

Steps 1-4 can be built somewhat independently, but Step 6 (App layout) is the integration point where everything comes together. Step 5 (Header simplification) should happen during or immediately after Step 6 since the layout change and header change are tightly coupled.

---

## Risk Areas

1. **ChatShell repositioning** — Currently fixed-position. Moving it into the flex layout may break the drawer expand/collapse animation or z-index stacking. Need to audit `ChatShell.tsx` before Step 6.

2. **Tauri title bar on non-macOS** — `titleBarStyle: "overlay"` is macOS-specific. On Windows/Linux, `decorations: false` removes all chrome. Need a platform check and fallback (show a custom close/minimize/maximize or keep decorations on non-macOS). For now this is a macOS-first app so acceptable, but note for future.

3. **Traffic light inset** — The macOS traffic lights with `titleBarStyle: "overlay"` are positioned at a system-defined offset. Need to measure and add matching left padding (~70px) to the TitleBar content. This offset can vary with macOS version.

4. **Existing search filter state** — `statusFilter` state and the `searchResults` memo in `App.tsx` filter by status. Removing the dropdown means always `statusFilter === 'all'`. Can simplify by removing the state variable entirely and the filter logic, but the `SearchModal` might also use status filtering — check before removing.

---

## Verification Checklist

- [ ] App launches with native traffic lights, no native title text
- [ ] Custom title bar shows: toggle, logo, "Clawchestra", Update badge, theme toggle
- [ ] Title bar is draggable for window movement
- [ ] Clicking toggle opens/closes sidebar with smooth animation
- [ ] Cmd+B toggles sidebar
- [ ] Sidebar has Settings button at bottom that opens existing Settings dialog
- [ ] Board and chat bar compress when sidebar opens
- [ ] Chat bar stays at the bottom, never becomes a side panel
- [ ] Header is a single row: search bar + Refresh + Add Project
- [ ] Status filter is gone
- [ ] Settings gear is gone from header
- [ ] Theme toggle is gone from header (lives in title bar)
- [ ] Window cannot be resized below 960×600
- [ ] Sidebar state persists across app restarts
- [ ] Escape closes sidebar when no modal is open
- [ ] On narrow window (< 1024px), sidebar overlays instead of pushing content
- [ ] All existing functionality still works (search, board drag, chat, modals)

---

*Plan is ready for build. No new dependencies required — everything uses existing packages (lucide-react icons, Zustand, Tauri APIs).*
