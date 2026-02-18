# Collapsible Sidebar — Implementation Plan

**Spec:** `docs/specs/collapsible-sidebar-spec.md`
**Roadmap Item:** `roadmap/collapsible-sidebar.md`
**Created:** 2026-02-18
**Reviewed:** 2026-02-18 (Claude Code `/review` — corrections applied)

---

## Executive Summary

Build the sidebar shell: a collapsible left panel with Codex-style title bar toggle. Simultaneously streamline the header by promoting theme controls to the title bar, removing the unused status filter, and moving Settings into the sidebar. No sidebar *content* beyond a Settings button — that's a future decision.

---

## Pre-Build: Resolve Open Questions

### Q1: Title bar — Tauri decorations or custom?

**Answer:** The current app has **no custom title bar**. Tauri renders native macOS decorations (traffic lights). The `Header` component is a normal content-area `<header>` element. There is no `data-tauri-drag-region` anywhere.

**Implication:** Use Tauri's overlay title bar mode to keep native traffic lights while rendering custom content in the title bar region:

```json
{
  "decorations": true,
  "titleBarStyle": "overlay",
  "hiddenTitle": true
}
```

> ⚠️ **Critical:** `decorations` must be `true`, not `false`. In Tauri v2, `titleBarStyle: "overlay"` is only meaningful when decorations are enabled. Setting `decorations: false` removes ALL native chrome including traffic lights, making `titleBarStyle` a no-op. With `decorations: true` + `titleBarStyle: "overlay"`, macOS keeps the traffic lights but hides the title text and lets us render into the title bar area.

### Q2: Settings persistence path

**Answer:** Settings are in `dashboard_settings` table via `getDashboardSettings()` / `updateDashboardSettings()` in `lib/tauri.ts`. Theme preference is in Zustand with `persist` middleware (localStorage). Sidebar open/closed state goes in the same Zustand persist store alongside `collapsedColumns` and `columnOrder`.

> Note: The spec says "Tauri settings DB" — this should be updated to say "Zustand persist (localStorage)" for consistency with how `collapsedColumns` and `columnOrder` are stored.

### Q3: Does SearchModal use status filtering?

**Answer:** No. `SearchModal` has no status filter usage — it only sorts by status priority when there's no query. The `statusFilter` state in `App.tsx` can be removed entirely along with the dropdown.

---

## Step-by-Step Build Order

### Step 1: Tauri Config — Title Bar + Min Dimensions

**Files:** `src-tauri/tauri.conf.json`

Update the window config:

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

**Key:** `decorations: true` + `titleBarStyle: "overlay"` keeps native macOS traffic lights while hiding the title text. We render our own title bar content and mark it as a drag region with `data-tauri-drag-region`.

**Verify:** App launches with traffic lights visible but no native title text. Content extends to the top of the window behind the traffic lights.

---

### Step 1.5: Extract `useAppUpdate` Hook

**New file:** `src/hooks/useAppUpdate.ts`

Extract the Update check/install logic from `Header.tsx` (lines ~40-80) into a reusable hook. This logic includes state (`updateAvailable`, `updating`), an effect (polling every 30s), and a ref (`updateTriggeredRef`).

```typescript
export function useAppUpdate(): {
  updateAvailable: boolean;
  updating: boolean;
  handleUpdate: () => Promise<void>;
}
```

This hook is consumed by both the new `TitleBar` (Step 2) and simplifies the Header teardown (Step 5). Extracting it first avoids duplicating code or creating a hidden dependency between Steps 2 and 5.

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
5. **Update badge** (via `useAppUpdate` hook — same chartreuse pill)
6. **(spacer)**
7. **Theme toggle** (moved from Header — same 3-button group, slightly smaller)

**Styling:**
- Height: 38px (enough for toggle + theme buttons without feeling cramped)
- Background: match page background (transparent/blur so it feels native)
- `data-tauri-drag-region` on the container
- Toggle button and theme buttons: `pointer-events-auto` (non-draggable islands in the drag region)
- Non-Tauri fallback: render as a normal fixed bar (no drag region attr needed)

**Accessibility:**
- SidebarToggle: `aria-expanded={sidebarOpen}`, `aria-controls="sidebar"`, `aria-label="Toggle sidebar"`
- Theme buttons: existing `aria-label` attributes carry over

**Implementation notes:**
- The `SidebarToggle` reads `sidebarOpen` from the store and calls `toggleSidebar()`
- Update logic comes from the extracted `useAppUpdate()` hook (Step 1.5)
- Theme toggle JSX moves from `Header.tsx` — same markup, potentially slightly smaller sizing

---

### Step 3: Zustand Store — Sidebar State

**File:** `src/lib/store.ts`

Add to the `DashboardState` interface:

```typescript
sidebarOpen: boolean;
toggleSidebar: () => void;
setSidebarOpen: (open: boolean) => void;
```

Default: `sidebarOpen: false`

**Critical:** Add `sidebarOpen` to the `partialize` function (currently at `store.ts:345-349`) so it's actually persisted:

```typescript
partialize: (state) => ({
  themePreference: state.themePreference,
  collapsedColumns: state.collapsedColumns,
  columnOrder: state.columnOrder,
  sidebarOpen: state.sidebarOpen, // ← ADD THIS
}),
```

Without this, `sidebarOpen` won't survive restarts despite the `persist` middleware being present. Zustand's `partialize` controls which fields are serialized — missing fields are silently dropped.

> Note: Zustand handles missing keys gracefully on hydration (the default value applies), so adding a new field to an existing persisted store has no migration issues.

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

**Accessibility:**
- Container: `id="sidebar"`, `role="complementary"`, `aria-label="Sidebar"`

**Content (Phase 1 — minimal):**
- Empty main area (or a subtle placeholder — optional)
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
- Logo + "Clawchestra" title (→ TitleBar)
- Update badge (→ TitleBar, via `useAppUpdate` hook)
- Theme toggle (→ TitleBar)
- Settings gear button (→ Sidebar)
- Status filter dropdown (removed entirely — confirmed SearchModal doesn't use it)
- The entire top row of buttons (Refresh, Add Project, Settings, Theme)

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

**In `App.tsx`:** Remove `statusFilter` state (`useState<string>('all')`) and the `statusFilter` comparison in the `searchResults` memo. The filter always passes since we're removing the dropdown.

---

### Step 6: App Layout Restructure

**File:** `src/App.tsx`, `src/components/chat/ChatShell.tsx`

Current layout (simplified):
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
  <TitleBar />                          ← NEW (fixed height ~38px)
  <div className="flex flex-1 min-h-0"> ← horizontal split
    <Sidebar />                         ← NEW (0 or 280px, full height)
    <div className="flex flex-1 flex-col min-w-0"> ← content column
      <Header />                        ← simplified single row
      <Breadcrumb />
      <main> <Board /> </main>
      <ChatShell />                     ← bottom of content column (NOT fixed-position)
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

#### ChatShell Repositioning (required changes)

This is the highest-risk part of the build. The current ChatShell uses:
- **Line 394:** `fixed inset-x-0 bottom-0` on the outer wrapper (the collapsed bar + drawer)
- **Line 412:** `fixed inset-0` on the backdrop overlay (when drawer is expanded)

Required changes:
1. **Remove `fixed inset-x-0 bottom-0`** from the outer wrapper. Make it a normal flex child with no fixed positioning. It sits at the bottom of the content column naturally via flexbox.
2. **Keep `fixed inset-0`** on the backdrop overlay — this is a modal-style overlay and should remain fixed/fullscreen.
3. **Remove `pb-32`** from `App.tsx:1109` — this padding only existed to compensate for the fixed ChatShell. With ChatShell in-flow, it's no longer needed.
4. **Test the drawer expand/collapse animation** — currently the drawer slides up from the fixed bottom. In the new layout, it needs to expand upward within (or on top of) the content column. May need `position: absolute` + `bottom: 0` on the expanded drawer relative to the content column.

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

**Escape key handling:** Add sidebar close to the existing Escape priority chain. Insert it **after** modals/search/chatDrawer but **before** roadmapView exit (closing the sidebar is a lighter action than exiting a view):

```typescript
// Current chain: search > chatDrawer > selectedProject > addDialog > settingsDialog > roadmapView
// New chain:     search > chatDrawer > selectedProject > addDialog > settingsDialog > SIDEBAR > roadmapView
```

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

### New Files (5)

| File | Purpose |
|------|---------|
| `src/hooks/useAppUpdate.ts` | Extract Update check/install logic from Header (shared by TitleBar) |
| `src/components/TitleBar.tsx` | Custom title bar with drag region, toggle, title, Update, theme |
| `src/components/sidebar/Sidebar.tsx` | Sidebar container with animation + Settings button |
| `src/components/sidebar/SidebarToggle.tsx` | Toggle button component (◧/◨ icon states) |

### Modified Files (5)

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Strip to single row: search + Refresh + Add Project. Remove update/theme/settings/status-filter. |
| `src/App.tsx` | New layout structure (TitleBar → sidebar + content column), Cmd+B shortcut, remove `statusFilter` state, remove `pb-32` |
| `src/lib/store.ts` | Add `sidebarOpen`, `toggleSidebar`, `setSidebarOpen` to persisted state + `partialize` |
| `src-tauri/tauri.conf.json` | `minWidth`, `minHeight`, `decorations: true`, `titleBarStyle: "overlay"`, `hiddenTitle: true` |
| `src/components/chat/ChatShell.tsx` | Remove fixed positioning on outer wrapper, keep fixed on backdrop overlay |

### Removed (from Header)

- Logo + title (→ TitleBar)
- Update badge (→ TitleBar via `useAppUpdate` hook)
- Theme toggle (→ TitleBar)
- Settings gear (→ Sidebar)
- Status filter (→ removed entirely, SearchModal confirmed not dependent)
- Top button row (→ Refresh + Add Project move next to search bar)

---

## Build Order Dependency Graph

```
Step 1  (Tauri config)
  └─→ Step 1.5 (useAppUpdate hook extraction)
        └─→ Step 2 (TitleBar) ───────────────┐
Step 3  (Store: sidebar state)                │
  └─→ Step 4 (Sidebar container)             │
        └─→ Step 6 (App layout) ←────────────┘
              └─→ Step 5 (Simplify Header)
                    └─→ Step 7 (Cmd+B + Escape)
                          └─→ Step 8 (Responsive)
```

Steps 1/1.5 and 3/4 can be built in parallel. Step 6 is the integration point. Step 5 should happen during or immediately after Step 6 since the layout change and header change are tightly coupled.

---

## Risk Areas

1. **ChatShell repositioning** — Highest risk. Currently fixed-position with specific z-index stacking. Moving to flex layout will require careful testing of: collapsed bar position, drawer expand animation, backdrop overlay, and z-index relative to modals. Detailed sub-plan in Step 6.

2. **Tauri title bar on non-macOS** — `titleBarStyle: "overlay"` is macOS-specific. On Windows/Linux, different approach needed (custom window controls). For now this is a macOS-first app, acceptable to defer. Note for future.

3. **Traffic light inset** — The macOS traffic lights with `titleBarStyle: "overlay"` are positioned at a system-defined offset (~70px). Need to measure and add matching left padding. This offset can vary with macOS version.

---

## Verification Checklist

- [ ] App launches with native traffic lights, no native title text
- [ ] Custom title bar shows: toggle, logo, "Clawchestra", Update badge, theme toggle
- [ ] Title bar is draggable for window movement
- [ ] Clicking toggle opens/closes sidebar with smooth animation
- [ ] Cmd+B toggles sidebar
- [ ] Escape closes sidebar (when no modal/search/drawer is open)
- [ ] Sidebar has Settings button at bottom that opens existing Settings dialog
- [ ] Board and chat bar compress when sidebar opens
- [ ] Chat bar stays at the bottom, never becomes a side panel
- [ ] Chat drawer still expands/collapses correctly
- [ ] Header is a single row: search bar + Refresh + Add Project
- [ ] Status filter is gone
- [ ] Settings gear is gone from header
- [ ] Theme toggle is gone from header (lives in title bar)
- [ ] Window cannot be resized below 960×600
- [ ] Sidebar state persists across app restarts
- [ ] On narrow window (< 1024px), sidebar overlays instead of pushing content
- [ ] All existing functionality still works (search, board drag, chat, modals)
- [ ] Sidebar toggle has correct aria-expanded attribute

---

*Plan reviewed and corrected. Ready for build.*
