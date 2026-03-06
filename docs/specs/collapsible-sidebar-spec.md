# Collapsible Sidebar — Technical Specification

*A toggleable left-hand sidebar panel. Build the shell first, decide what goes in it later.*

**Status:** Spec Draft
**Created:** 2026-02-17
**Updated:** 2026-02-18
**Author:** Clawdbot
**Roadmap Item:** `roadmap/collapsible-sidebar.md`

---

## Table of Contents

1. [Vision](#vision)
2. [Architecture](#architecture)
3. [Title Bar & Toggle Button](#title-bar--toggle-button)
4. [Layout & Behavior](#layout--behavior)
5. [Minimum Window Dimensions](#minimum-window-dimensions)
6. [State Management](#state-management)
7. [Component Hierarchy](#component-hierarchy)
8. [Build Scope (Phase 1 — Core Only)](#build-scope-phase-1--core-only)
9. [Ideas for Sidebar Content (Future)](#ideas-for-sidebar-content-future)
10. [Open Questions](#open-questions)

---

## Vision

The main board is the dashboard's core. Everything else — settings, agent activity, session management, configuration — is secondary UI that shouldn't fight for space with the kanban board.

The sidebar provides a **persistent but collapsible** home for this secondary UI. It's collapsed by default and slides in from the left when toggled. When the sidebar opens, the **entire app compresses from the left** — board, chat bar, everything. The chat bar stays at the bottom but gets narrower; it does **not** become a right-hand side panel.

### Design Principles

1. **Board-first** — The sidebar never steals focus from the kanban. It's a utility panel.
2. **Collapsed by default** — Users who don't need it never see it. Zero cognitive cost.
3. **Everything compresses, nothing relocates** — When the sidebar opens, the whole content area (board + chat bar) narrows from the left. The chat bar stays at the bottom — it never becomes a side drawer.
4. **Build the container first** — Phase 1 is the sidebar shell + toggle. Content decisions come later.

---

## Architecture

### Layout: Sidebar Open

```
┌──────────────────────────────────────────────────────────────┐
│ ●●● ◧  Clawchestra  [Update]                    [☀ 🌙 ⚙️]  │  ← Title bar
├──────────┬───────────────────────────────────────────────────┤
│          │ [🔍 Search...                    ⌘K] [↻] [+ Add] │  ← Header bar
│          ├───────────────────────────────────────────────────┤
│          │                                                   │
│ SIDEBAR  │              KANBAN BOARD                         │
│ (left)   │                                                   │
│          │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐     │
│          │  │IN FLGHT│ │UP NEXT │ │SIMMER  │ │SHIPPED │     │
│ ┌──────┐ │  │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │        │     │
│ │      │ │  │ │Card│ │ │ │Card│ │ │ │Card│ │ │        │     │
│ │(TBD) │ │  │ └────┘ │ │ └────┘ │ │ └────┘ │ │        │     │
│ │      │ │  │ ┌────┐ │ │        │ │        │ │        │     │
│ └──────┘ │  │ │Card│ │ │        │ │        │ │        │     │
│          │  │ └────┘ │ │        │ │        │ │        │     │
│ ⚙ Settn │  └────────┘ └────────┘ └────────┘ └────────┘     │
│          │                                                   │
│          ├───────────────────────────────────────────────────┤
│          │  [Chat bar — bottom, shares width with board]     │
└──────────┴───────────────────────────────────────────────────┘
```

### Layout: Sidebar Closed

```
┌──────────────────────────────────────────────────────────────┐
│ ●●● ◨  Clawchestra  [Update]                    [☀ 🌙 ⚙️]  │  ← Title bar
├──────────────────────────────────────────────────────────────┤
│ [🔍 Search by title, id, tag...              ⌘K] [↻] [+ Add]│  ← Header bar
├──────────────────────────────────────────────────────────────┤
│                                                              │
│                       KANBAN BOARD                           │
│                                                              │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                │
│  │IN FLGHT│ │UP NEXT │ │SIMMER  │ │SHIPPED │                │
│  │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │        │                │
│  │ │Card│ │ │ │Card│ │ │ │Card│ │ │        │                │
│  │ └────┘ │ │ └────┘ │ │ └────┘ │ │        │                │
│  │ ┌────┐ │ │        │ │        │ │        │                │
│  │ │Card│ │ │        │ │        │ │        │                │
│  │ └────┘ │ │        │ │        │ │        │                │
│  └────────┘ └────────┘ └────────┘ └────────┘                │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│  [Chat bar — bottom, full width]                             │
└──────────────────────────────────────────────────────────────┘
```

**Key constraint:** The sidebar compresses the **entire content area** to its right — board and chat bar alike. Everything shifts/narrows from the left. The chat bar stays at the bottom but shares width with the board (not the full window width when sidebar is open). The critical thing is that the chat bar never **relocates** — it doesn't become a right-side drawer or panel. It stays at the bottom, just narrower.

---

## Title Bar & Toggle Button

The sidebar toggle lives in the **title bar** (the draggable area alongside the macOS traffic lights ●●●). This follows the Codex pattern where the toggle sits immediately to the right of the traffic lights.

### Title Bar & Header Bar Layout

```
┌─────┬────────────────────────────────────────────────────────────┐
│●●●  │ ◧  Clawchestra  [Update]                      [☀] [🌙] [⚙️] │  ← Title bar (slightly taller)
├─────┴────────────────────────────────────────────────────────────┤
│ [🔍 Search by title, id, tag...              ⌘K]  [↻] [+ Add]  │  ← Header bar (simplified single row)
└──────────────────────────────────────────────────────────────────┘
```

The title bar and the header bar are **two separate rows**:

**Title bar** (top strip, draggable) contains:
- Traffic lights (●●●)
- Sidebar toggle (◧/◨)
- "Clawchestra" title + Update badge
- Theme toggle (☀/🌙/⚙️ for light/dark/system) — **promoted from the old header bar**

**Header bar** (below, single row) contains:
- Search bar with ⌘K hint (kept for discoverability — not all users know keyboard shortcuts)
- Refresh button (compact, icon-only or small)
- Add Project button

**Removed entirely:**
- Status filter dropdown ("All statuses") — unused, adds noise
- Settings gear — moves into sidebar (bottom, Codex-style)

This collapses what was previously a two-section header (buttons row + search row) into a single clean search row with minimal actions.

### Toggle Button

- **Position:** Immediately right of the macOS traffic lights, in the title bar region
- **Style:** Dedicated sidebar icon — **not** a hamburger (☰). Two distinct icon states:
  - **Sidebar closed:** `◧` / `PanelLeft` — indicates "open sidebar" (shows panel appearing from left)
  - **Sidebar open:** `◨` / `PanelLeftClose` — indicates "close sidebar" (shows panel collapsing)
- **Size:** ~16×16px icon area, visually balanced with the traffic lights
- **Shortcut:** `Cmd+B` (mirrors VS Code sidebar toggle — muscle memory)
- **Reference:** See Codex screenshots — clean, minimal, sits in the same visual row as traffic lights

### Title Bar Adjustments

The title bar may need to be **slightly deeper** to comfortably accommodate the toggle button alongside the traffic lights. Currently the header is a content-area element; the title bar (Tauri's decorations area) is minimal.

Changes to **title bar** (top strip):
- **Title bar height:** Slightly taller to comfortably fit the toggle icon, Update badge, and theme toggles (aim for ~36-40px draggable region)
- **Sidebar toggle:** Added immediately right of traffic lights
- **"Clawchestra" title + Update badge:** Moved into title bar, shifted right of toggle
- **Theme toggle (☀/🌙/⚙️):** Promoted from the old header bar to the title bar right side — these are global app-level controls that belong alongside the app title

Changes to **header bar** (below title bar):
- **Simplified to a single row.** Search bar with ⌘K hint on the left, Refresh + Add Project buttons on the right.
- **Status filter ("All statuses") removed** — unused, was adding noise
- **Settings gear removed** — moves into the sidebar (bottom, Codex-style)
- **Theme toggle removed** — promoted to title bar (see above)

### Title Bar Drag Region

The title bar area must remain draggable for window movement. The toggle button is a non-draggable island within the drag region (same as how Codex handles it). Tauri supports `data-tauri-drag-region` for this.

---

## Layout & Behavior

### Toggle

- **Trigger:** Sidebar toggle icon in title bar (see above)
- **Shortcut:** `Cmd+B`
- **Default state:** Collapsed (width 0, sidebar content not rendered)
- **Animation:** CSS `transform: translateX` + `width` transition, 200ms ease-out
- **Persistence:** Sidebar open/closed state and width saved to Zustand persist store (localStorage, survives restart)

### Dimensions

| Property | Value |
|----------|-------|
| Width (open) | 280px (fixed, not resizable in MVP) |
| Width (collapsed) | 0px |
| Z-index | Below modal overlays, above board content |
| Background | `neutral-50` (light) / `neutral-900` (dark) |
| Border | Right border: `neutral-200` (light) / `neutral-700` (dark) |

### Responsive Behavior

| Breakpoint | Sidebar Behavior |
|------------|------------------|
| `xl+` (1280+) | Sidebar pushes board content (inline layout) |
| `lg` (1024-1279) | Sidebar overlays board (absolute positioned) |
| `md` and below | Sidebar becomes full-width slide-over |

### Coexistence with Chat Bar

- The chat bar is **always at the bottom**. It never relocates to become a side panel.
- Opening the sidebar compresses the **entire content area** to the right — board and chat bar both get narrower.
- The sidebar spans the full height (below the title bar). The board + chat bar together fill the remaining width to its right.
- CSS layout: the sidebar is a full-height column on the left; the right column contains the board (flex-grow) above the chat bar (fixed height).

---

## Minimum Window Dimensions

To prevent the UI becoming unusable when the sidebar is open (e.g. chat bar too narrow, board columns crushed), enforce minimum window dimensions at the Tauri level.

### Minimums

| Dimension | Value | Rationale |
|-----------|-------|-----------|
| Min width | **960px** | 280px sidebar + 600px min board + 80px padding/borders |
| Min height | **600px** | Title bar + board with at least 2-3 visible cards + chat bar |

### Implementation

Set in `tauri.conf.json` under `windows[0]`:

```json
{
  "minWidth": 960,
  "minHeight": 600
}
```

### Sidebar Auto-Collapse

As an additional safeguard, if the window is resized below 1024px wide while the sidebar is open, the sidebar should auto-collapse (overlay mode) so the board isn't crushed. Below 960px, the sidebar cannot be opened inline at all — only as an overlay.

---

## State Management

### Zustand Store Additions

```typescript
interface SidebarState {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
}
```

### Persistence

| State | Storage | Notes |
|-------|---------|-------|
| Sidebar open/closed | Zustand persist (localStorage) | Consistent with `collapsedColumns` and `columnOrder` |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Toggle sidebar |
| `Cmd+J` | Toggle chat drawer (existing) |
| `Escape` | Close sidebar if it has focus |

---

## Component Hierarchy

```
App.tsx
├── TitleBar (slightly taller draggable strip)
│   ├── SidebarToggle (◧/◨ icon button)
│   ├── AppTitle ("Clawchestra" + Update badge)
│   └── ThemeToggle (☀/🌙/⚙️ — promoted from old header)
├── Header (simplified single row)
│   ├── SearchBar + ⌘K hint
│   ├── Refresh button (compact)
│   └── Add Project button
│   (Status filter REMOVED — unused)
│   (Settings gear REMOVED → sidebar)
│   (Theme toggle REMOVED → title bar)
├── MainLayout (sidebar + content column)
│   ├── Sidebar                          ← NEW
│   │   ├── (placeholder / empty state for Phase 1)
│   │   └── ⚙ Settings button (bottom, Codex-style)
│   └── ContentColumn
│       ├── Board
│       │   ├── Column[]
│       │   │   └── Card[]
│       │   └── ProjectModal
│       └── ChatBar (bottom of content column)
└── Overlays (modals, search, toasts)
```

### New Files

| File | Purpose |
|------|---------|
| `src/components/sidebar/Sidebar.tsx` | Container, handles open/close animation |
| `src/components/sidebar/SidebarToggle.tsx` | Toggle icon button (◧/◨ states) |

### Modified Files

| File | Change |
|------|--------|
| `src/components/Header.tsx` | Major simplification: remove settings gear, theme toggle, status filter. Collapse to single row (search + Refresh + Add Project). |
| `src/App.tsx` | Add title bar row above header (with toggle, title, Update badge, theme toggle), add sidebar to layout, enforce content-column structure |
| `tauri.conf.json` | Add `minWidth` / `minHeight` |
| Zustand store | Add `sidebarOpen` / `toggleSidebar` |

---

## Build Scope (Phase 1 — Core Only)

> **The goal is to build the sidebar shell and toggle. Content decisions come later.**

### In Scope

- Sidebar container with slide-in/out animation
- Dedicated toggle icon in title bar (Codex-style, not hamburger)
- Two icon states: open (◧) and close (◨)
- `Cmd+B` keyboard shortcut
- New title bar row (slightly taller) above the header, containing: traffic lights, sidebar toggle, "Clawchestra" title, Update badge, theme toggle (right side)
- Header bar simplified to single row: search bar (with ⌘K hint) + Refresh button + Add Project button
- Status filter ("All statuses") removed entirely — unused noise
- Settings gear moves from header bar into sidebar (bottom, Codex-style)
- Theme toggle promoted from header bar to title bar (right side)
- Sidebar persists open/closed state across restarts
- Chat bar remains at the bottom at all times
- Minimum window dimensions enforced via Tauri
- Sidebar auto-collapse on narrow windows
- **Settings button at the bottom of the sidebar** (Codex-style — see screenshots). Initially just opens the existing settings dialog; the settings UI doesn't move into the sidebar yet.
- Empty/placeholder state for the main sidebar content area

### Out of Scope (Phase 1)

These are explicitly **not** built in Phase 1. The sidebar content is TBD — these are ideas only.

- Inline settings panel (settings stay in their existing dialog for now)
- Sidebar section content (agent activity, sessions, about, etc.)
- Resizable sidebar width
- Any sidebar navigation or accordion sections

---

## Ideas for Sidebar Content (Future)

> **⚠️ These are ideas only — not committed for any build phase.** They represent potential uses for the sidebar once the shell exists. The project owner will decide what goes in there after the core is built and tested.

### Settings Panel

Move app configuration (gateway URL, theme, etc.) from the modal dialog into the sidebar as an inline panel. The Settings button at the bottom of the sidebar (built in Phase 1) would expand an inline settings area rather than opening a dialog.

Settings groups that could live here:
- **Connection:** Gateway URL, token, session key, auto-connect
- **Appearance:** Theme (system/light/dark), accent color
- **Projects:** Scan paths, refresh interval, show archived toggle
- **Chat:** Send on enter, timestamps, toast duration

### Agent Activity Panel

Rich display of what the connected OpenClaw agent is doing. Would replace the simple "Working..." / "Typing..." label with:
- Current state (thinking/reading/writing/executing) with icons
- Duration of current activity
- Context (what the agent is working on)
- Recent activity log (ring buffer of last ~10 state transitions)

Data already flows through the WS event handler — just needs a richer consumer.

### Session Manager

List and manage background sessions (sub-agents, coding agent instances):
- Active sessions with status, runtime, label
- Recent/completed sessions
- Actions: view log, stop, send message
- Auto-refresh on announce events

Uses existing `sessions_list` and `sessions_history` RPC.

### About / Profile

- Version info
- Install ID (local, auto-generated)
- Check for updates (GitHub releases)
- Links to docs, GitHub, Discord

### Navigation / Project Tree

Sidebar could serve as a project navigator (tree view of projects/deliverables) as an alternative to the kanban view.

### Configurable Panel Orientation

Give the user control over where panels live:
- **Sidebar orientation:** left (default) or right
- **Chat bar orientation:** bottom (default), left sidebar, or right sidebar

VS Code and Codex are useful references here — both support panel relocation (VS Code lets you move the panel between bottom/right/left, and the sidebar between left/right). Implications to consider:
- When sidebar and chat are on the same side, they'd need to stack or tab
- Minimum window dimensions may need to adapt based on orientation
- Keyboard shortcuts stay the same regardless of orientation

This would be a separate **"Sidebar Enhancements"** roadmap item — not part of the sidebar MVP or any current phase.

---

## Open Questions

1. **Title bar implementation** — Is the current header already using Tauri's title bar API, or is it a content-area element with custom styling? This affects how we add the toggle alongside traffic lights.
2. **Resizable sidebar?** — MVP uses fixed 280px. Resizable (drag handle) is a nice-to-have but adds complexity. Defer.
3. **Settings migration** — Current settings are scattered (theme in localStorage, gateway URL in env/settings). Should the Settings button in Phase 1 just open the existing dialog, or should we start migrating? (Spec says: just open existing dialog.)
4. **Sidebar content priority** — After Phase 1, which content panel would be most useful first? Settings inline? Agent activity? Session manager?

---

*Spec is a living document. Update as decisions are made during build.*
