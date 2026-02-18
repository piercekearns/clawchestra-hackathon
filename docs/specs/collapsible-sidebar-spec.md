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

The sidebar provides a **persistent but collapsible** home for this secondary UI. It's collapsed by default and slides in from the left when toggled. The chat bar stays at the **bottom** of the app at all times — it does **not** become a right-hand panel when the sidebar opens.

### Design Principles

1. **Board-first** — The sidebar never steals focus from the kanban. It's a utility panel.
2. **Collapsed by default** — Users who don't need it never see it. Zero cognitive cost.
3. **Chat stays at the bottom** — The chat bar is always a bottom bar, never a side panel. Opening the sidebar does not affect its position.
4. **Build the container first** — Phase 1 is the sidebar shell + toggle. Content decisions come later.

---

## Architecture

### Layout: Sidebar Open

```
┌─────┬──────────────────────────────────────────────────────┐
│●●●  │ ◧  Clawchestra  [Update]              [⌘K] [⚙] ... │  ← Title bar (deepened)
├─────┴──────────────────────────────────────────────────────┤
│          │                                                 │
│ SIDEBAR  │              KANBAN BOARD                       │
│ (left)   │                                                 │
│          │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   │
│          │  │IN FLGHT│ │UP NEXT │ │SIMMER  │ │SHIPPED │   │
│          │  │        │ │        │ │        │ │        │   │
│ ┌──────┐ │  │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │        │   │
│ │      │ │  │ │Card│ │ │ │Card│ │ │ │Card│ │ │        │   │
│ │(TBD) │ │  │ └────┘ │ │ └────┘ │ │ └────┘ │ │        │   │
│ │      │ │  │ ┌────┐ │ │        │ │        │ │        │   │
│ └──────┘ │  │ │Card│ │ │        │ │        │ │        │   │
│          │  │ └────┘ │ │        │ │        │ │        │   │
│ ⚙ Settn │  └────────┘ └────────┘ └────────┘ └────────┘   │
│          │                                                 │
├──────────┴─────────────────────────────────────────────────┤
│  [Chat input bar — always at the bottom, full width]       │
└────────────────────────────────────────────────────────────┘
```

### Layout: Sidebar Closed

```
┌─────┬──────────────────────────────────────────────────────┐
│●●●  │ ◨  Clawchestra  [Update]              [⌘K] [⚙] ... │  ← Title bar
├─────┴──────────────────────────────────────────────────────┤
│                                                            │
│                     KANBAN BOARD                           │
│                                                            │
│  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐              │
│  │IN FLGHT│ │UP NEXT │ │SIMMER  │ │SHIPPED │              │
│  │        │ │        │ │        │ │        │              │
│  │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │        │              │
│  │ │Card│ │ │ │Card│ │ │ │Card│ │ │        │              │
│  │ └────┘ │ │ └────┘ │ │ └────┘ │ │        │              │
│  │ ┌────┐ │ │        │ │        │ │        │              │
│  │ │Card│ │ │        │ │        │ │        │              │
│  │ └────┘ │ │        │ │        │ │        │              │
│  └────────┘ └────────┘ └────────┘ └────────┘              │
│                                                            │
├────────────────────────────────────────────────────────────┤
│  [Chat input bar — always at the bottom, full width]       │
└────────────────────────────────────────────────────────────┘
```

**Key constraint:** The chat bar spans the full width at the bottom in both states. It is never repositioned to the right side. Opening the sidebar compresses the board horizontally, not the chat bar.

---

## Title Bar & Toggle Button

The sidebar toggle lives in the **title bar** (the draggable area alongside the macOS traffic lights ●●●). This follows the Codex pattern where the toggle sits immediately to the right of the traffic lights.

### Codex-Inspired Title Bar Layout

```
┌─────┬──────────────────────────────────────────────────────┐
│●●●  │ ◧  Clawchestra  [Update]              [⌘K] [⚙] ... │
└─────┴──────────────────────────────────────────────────────┘
 ↑        ↑      ↑          ↑
 traffic   toggle  title     update badge
 lights    btn
```

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

Changes:
- **Title bar height:** Increase if needed to fit the toggle icon comfortably (aim for ~36-40px draggable region)
- **"Clawchestra" title:** Moves right to sit after the toggle button
- **"Update" badge:** Stays next to the Clawchestra title (same relative position, just shifted right with it)
- **Right-side controls** (⌘K search, settings gear, theme toggle, etc.): Stay on the right, no change

### Title Bar Drag Region

The title bar area must remain draggable for window movement. The toggle button is a non-draggable island within the drag region (same as how Codex handles it). Tauri supports `data-tauri-drag-region` for this.

---

## Layout & Behavior

### Toggle

- **Trigger:** Sidebar toggle icon in title bar (see above)
- **Shortcut:** `Cmd+B`
- **Default state:** Collapsed (width 0, sidebar content not rendered)
- **Animation:** CSS `transform: translateX` + `width` transition, 200ms ease-out
- **Persistence:** Sidebar open/closed state saved to Tauri settings (survives restart)

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

- The chat bar is **always at the bottom**. It never moves.
- Opening the sidebar compresses the **board** horizontally, not the chat bar.
- The chat bar spans the full app width regardless of sidebar state.
- The layout is a CSS grid: sidebar + board in the middle row, chat bar spanning full width in the bottom row.

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
| Sidebar open/closed | Tauri settings DB | Survives restart |

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
├── TitleBar (deepened, contains traffic lights region + toggle + title)
│   ├── SidebarToggle (◧/◨ icon button)
│   ├── AppTitle ("Clawchestra" + Update badge)
│   └── HeaderActions (search, settings gear, theme, etc.)
├── MainLayout (CSS grid: sidebar? + board, full-width chat below)
│   ├── Sidebar                          ← NEW
│   │   ├── (placeholder / empty state for Phase 1)
│   │   └── ⚙ Settings button (bottom, Codex-style)
│   ├── Board
│   │   ├── Column[]
│   │   │   └── Card[]
│   │   └── ProjectModal
│   └── ChatBar (always at the bottom, full width)
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
| `src/components/Header.tsx` | Restructure into title bar layout, add toggle, shift title right |
| `src/App.tsx` | Add sidebar to layout grid, enforce chat-bar-at-bottom layout |
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
- Title bar deepened to accommodate toggle alongside traffic lights
- "Clawchestra" title shifted right, "Update" badge stays next to it
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

> **⚠️ These are ideas only — not committed for any build phase.** They represent potential uses for the sidebar once the shell exists. Pierce will decide what goes in there after the core is built and tested.

### Settings Panel

Move app configuration (gateway URL, theme, etc.) from the modal dialog into the sidebar as an inline panel. The Settings button at the bottom of the sidebar (built in Phase 1) would expand an inline settings area rather than opening a dialog.

Settings groups that could live here:
- **Connection:** Gateway URL, token, session key, auto-connect
- **Appearance:** Theme (system/light/dark), accent color
- **Projects:** Scan paths, refresh interval, show shipped toggle
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

---

## Open Questions

1. **Title bar implementation** — Is the current header already using Tauri's title bar API, or is it a content-area element with custom styling? This affects how we add the toggle alongside traffic lights.
2. **Resizable sidebar?** — MVP uses fixed 280px. Resizable (drag handle) is a nice-to-have but adds complexity. Defer.
3. **Settings migration** — Current settings are scattered (theme in localStorage, gateway URL in env/settings). Should the Settings button in Phase 1 just open the existing dialog, or should we start migrating? (Spec says: just open existing dialog.)
4. **Sidebar content priority** — After Phase 1, which content panel would be most useful first? Settings inline? Agent activity? Session manager?

---

*Spec is a living document. Update as decisions are made during build.*
