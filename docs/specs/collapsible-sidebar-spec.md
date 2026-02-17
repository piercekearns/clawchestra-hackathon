# Collapsible Sidebar — Technical Specification

*A toggleable sidebar panel for secondary UI, agent activity, and app configuration.*

**Status:** Spec Draft
**Created:** 2026-02-17
**Author:** Clawdbot
**Roadmap Item:** `roadmap/collapsible-sidebar.md`

---

## Table of Contents

1. [Vision](#vision)
2. [Architecture](#architecture)
3. [Layout & Behavior](#layout--behavior)
4. [Sidebar Sections](#sidebar-sections)
5. [Agent Activity Panel](#agent-activity-panel)
6. [Session Manager](#session-manager)
7. [Settings Panel](#settings-panel)
8. [Profile & Distribution](#profile--distribution)
9. [Data Flow](#data-flow)
10. [Component Hierarchy](#component-hierarchy)
11. [State Management](#state-management)
12. [Build Phases](#build-phases)
13. [Dependencies](#dependencies)

---

## Vision

The main board is the dashboard's core. Everything else — settings, agent activity, session management, configuration — is secondary UI that shouldn't fight for space with the kanban board.

The sidebar provides a **persistent but collapsible** home for this secondary UI. It's collapsed by default and slides in from the left when toggled. It coexists with the chat drawer on the right — they're independent panels.

### Design Principles

1. **Board-first** — The sidebar never steals focus from the kanban. It's a utility panel.
2. **Collapsed by default** — Users who don't need it never see it. Zero cognitive cost.
3. **Accordion sections** — Each panel collapses independently. Open what you need, close the rest.
4. **Live data** — Agent activity and session status update in real-time via existing WS events.
5. **Ship-ready thinking** — Design for a user who downloaded this app and plugged in their own OpenClaw instance. No hardcoded assumptions about Pierce's setup.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  ┌────────┐                                                 ┌────┐ │
│  │ ☰      │  📋 Pipeline Dashboard          [⌘K] [⚙]      │ 💬 │ │
│  └────────┘                                                 └────┘ │
├──────────┬───────────────────────────────────────────────┬──────────┤
│          │                                               │          │
│ SIDEBAR  │              KANBAN BOARD                     │  CHAT    │
│ (left)   │                                               │  DRAWER  │
│          │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ │  (right) │
│ ┌──────┐ │  │IN FLGHT│ │UP NEXT │ │SIMMER  │ │SHIPPED │ │          │
│ │Agent │ │  │        │ │        │ │        │ │        │ │ ┌──────┐ │
│ │Activ.│ │  │ ┌────┐ │ │ ┌────┐ │ │ ┌────┐ │ │        │ │ │      │ │
│ │      │ │  │ │Card│ │ │ │Card│ │ │ │Card│ │ │        │ │ │ Chat │ │
│ └──────┘ │  │ └────┘ │ │ └────┘ │ │ └────┘ │ │        │ │ │ Msgs │ │
│ ┌──────┐ │  │ ┌────┐ │ │        │ │        │ │        │ │ │      │ │
│ │Sessns│ │  │ │Card│ │ │        │ │        │ │        │ │ └──────┘ │
│ │      │ │  │ └────┘ │ │        │ │        │ │        │ │ ┌──────┐ │
│ └──────┘ │  │        │ │        │ │        │ │        │ │ │ [>_] │ │
│ ┌──────┐ │  └────────┘ └────────┘ └────────┘ └────────┘ │ └──────┘ │
│ │Settngs│ │                                               │          │
│ └──────┘ │                                               │          │
│          │                                               │          │
└──────────┴───────────────────────────────────────────────┴──────────┘
```

The sidebar is on the **left**. The chat drawer stays on the **right**. Both can be open simultaneously. The board fills the remaining center space and reflows.

---

## Layout & Behavior

### Toggle

- **Trigger:** Hamburger icon (☰) in the top-left of the header bar
- **Shortcut:** `Cmd+B` (mirrors VS Code sidebar toggle — muscle memory)
- **Default state:** Collapsed (width 0, no DOM rendering of content)
- **Animation:** CSS `transform: translateX` + `width` transition, 200ms ease-out
- **Persistence:** Sidebar open/closed state saved to Tauri settings (survives restart)

### Dimensions

| Property | Value |
|----------|-------|
| Width (open) | 280px (fixed, not resizable in MVP) |
| Width (collapsed) | 0px |
| Min board width | 600px (sidebar auto-collapses below this) |
| Z-index | Below modal overlays, above board content |
| Background | `neutral-50` (light) / `neutral-900` (dark) |
| Border | Right border: `neutral-200` (light) / `neutral-700` (dark) |

### Responsive Behavior

| Breakpoint | Sidebar Behavior |
|------------|------------------|
| `xl+` (1280+) | Sidebar pushes board content (inline layout) |
| `lg` (1024-1279) | Sidebar overlays board (absolute positioned) |
| `md` and below | Sidebar becomes full-width slide-over |

### Coexistence with Chat Drawer

- Both panels are independent. Opening one does not close the other.
- On narrow screens (`< 1024px`), only one can be open at a time — opening the sidebar closes the chat drawer and vice versa.
- The board always gets the remaining horizontal space.

---

## Sidebar Sections

The sidebar uses an **accordion pattern** — each section has a header that toggles its content open/closed. Multiple sections can be open simultaneously.

### Section Order (top to bottom)

1. **Agent Activity** — What's happening right now
2. **Sessions** — Background/sub-agent sessions  
3. **Settings** — App configuration
4. **About** — Version, links (collapsed, bottom)

Each section's open/closed state is persisted independently.

---

## Agent Activity Panel

Shows what the connected OpenClaw agent is doing right now. This replaces the simple "Working..." / "Typing..." label with richer context.

### Activity States

The panel maps SSE `state` values from the gateway into human-readable activity:

| SSE State | Display | Icon |
|-----------|---------|------|
| `thinking` | Thinking... | 🧠 |
| `reasoning` | Reasoning... | 🧠 |
| `tool_call` | Using tools... | 🔧 |
| `reading` | Reading files... | 📖 |
| `writing` | Writing files... | ✏️ |
| `searching` | Searching... | 🔍 |
| `executing` | Running command... | ⚡ |
| `content` / `delta` | Typing response... | 💬 |
| `compacting` | Compacting memory... | 📦 |
| idle | Idle | ● (green dot) |
| disconnected | Disconnected | ● (red dot) |

### Layout

```
┌─────────────────────────────┐
│ ▾ Agent Activity            │
├─────────────────────────────┤
│ ● Connected                 │
│                             │
│ 🧠 Thinking...              │
│ ├ Duration: 12s             │
│ └ Context: collapsible-     │
│   sidebar spec              │
│                             │
│ Recent:                     │
│  📖 Read 3 files       4s  │
│  🔧 Edit gateway.ts    2s  │
│  💬 Sent response     18s  │
└─────────────────────────────┘
```

### Data Source

- **Connection status:** From `TauriOpenClawConnection.state` (already in Zustand via bridge)
- **Activity state:** From SSE `chat` events — `state` field (already parsed in `gateway.ts`)
- **Duration:** Timestamp each state transition, show elapsed time
- **Context:** Extract from the SSE event's context/metadata if available, or from the most recent user message
- **Recent activity log:** Ring buffer of last ~10 state transitions with timestamps

### Implementation Notes

- The activity data is already flowing through the WS event handler in `gateway.ts`. Currently it's reduced to just `'working' | 'typing' | 'idle'` for the activity label. The sidebar can consume the raw state values for richer display.
- Add a `rawActivityState` field to the Zustand store alongside the existing `agentActivity` field.
- Keep the existing simplified activity label in the header (for when sidebar is closed).

---

## Session Manager

Lists active and recent background sessions — sub-agents spawned via `sessions_spawn`, coding agent instances, etc.

### Session List

```
┌─────────────────────────────┐
│ ▾ Sessions (2 active)       │
├─────────────────────────────┤
│ ┌─────────────────────────┐ │
│ │ 🟢 spec-writer          │ │
│ │ Runtime: 2m 34s         │ │
│ │ Writing sidebar spec... │ │
│ │ [View Log] [Stop]       │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ 🟢 claude-code          │ │
│ │ Runtime: 8m 12s         │ │
│ │ Building Phase B...     │ │
│ │ [View Log] [Stop]       │ │
│ └─────────────────────────┘ │
│                             │
│ ── Recent ──                │
│ ┌─────────────────────────┐ │
│ │ ✅ plan-review    3m ago │ │
│ │ │ Completed (45s)       │ │
│ │ └ [View Result]         │ │
│ └─────────────────────────┘ │
│ ┌─────────────────────────┐ │
│ │ ❌ build-agent   12m ago│ │
│ │ │ Failed (OOM)          │ │
│ │ └ [View Log]            │ │
│ └─────────────────────────┘ │
└─────────────────────────────┘
```

### Data Source

- **Active sessions:** Poll `sessions_list` via WS RPC (already available). Filter for non-main sessions.
- **Session details:** `sessions_history` for logs/transcripts
- **Status updates:** Listen for `announce` events in the WS event stream (already parsed in `gateway.ts` via `parseAnnounceMetadata`)
- **tmux sessions:** For coding agent instances running in tmux, check process status

### Session Actions

| Action | Implementation |
|--------|----------------|
| View Log | Fetch `sessions_history(sessionKey, limit: 50)`, display in a slide-over panel or modal |
| Stop | Send kill signal via `sessions_send` with stop instruction |
| View Result | Show the announce message content (already captured) |
| Send Message | Open an input to send a message to the session via `sessions_send` |

### Polling Strategy

- **Active sessions:** Poll every 15s when sidebar is open, every 60s when closed
- **On announce event:** Immediately refresh the session list
- **On session spawn (from chat):** Immediately add to the list

---

## Settings Panel

App configuration for the user. Designed for someone who downloaded this app and is setting it up for the first time.

### Settings Groups

#### Connection
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Gateway URL | text | `ws://localhost:18789` | OpenClaw gateway WebSocket URL |
| Gateway Token | password | (empty) | Authentication token for the gateway |
| Session Key | text | `agent:main:pipeline-dashboard` | Session identifier for this dashboard instance |
| Auto-connect | toggle | true | Connect to gateway on app launch |

#### Appearance
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Theme | select | System | System / Light / Dark |
| Accent Color | color | `#DFFF00` | Primary accent color (future) |

#### Projects
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Scan Paths | list | `~/projects` | Directories to scan for `PROJECT.md` files |
| Refresh Interval | select | 30s | How often to re-scan for project changes |
| Show Shipped | toggle | true | Whether to display shipped/completed projects |

#### Chat
| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| Send on Enter | toggle | true | Enter sends message (vs Shift+Enter) |
| Show Timestamps | toggle | false | Display timestamps on chat messages |
| Toast Duration | select | Stay | How long response toasts stay visible |

### Storage

Settings persist via Tauri's `tauri-plugin-store` or the existing settings table in `chat.db`. On change, settings are written immediately (no Save button).

### Layout

```
┌─────────────────────────────┐
│ ▾ Settings                  │
├─────────────────────────────┤
│                             │
│ CONNECTION                  │
│ Gateway URL                 │
│ ┌─────────────────────────┐ │
│ │ ws://localhost:18789    │ │
│ └─────────────────────────┘ │
│ Token  ┌────────────────┐   │
│        │ ••••••••       │   │
│        └────────────────┘   │
│ Session Key                 │
│ ┌─────────────────────────┐ │
│ │ agent:main:pipeline-... │ │
│ └─────────────────────────┘ │
│ [Test Connection]  ● Green  │
│                             │
│ APPEARANCE                  │
│ Theme  [System ▼]           │
│                             │
│ PROJECTS                    │
│ Scan Paths                  │
│  ~/projects         [×]    │
│  ~/repos             [×]    │
│  [+ Add Path]               │
│                             │
└─────────────────────────────┘
```

---

## Profile & Distribution

This section considers what's needed if the app is distributed to other users.

### Current State (Personal Tool)

- No auth required — runs entirely local
- Gateway URL hardcoded in settings
- Projects directory hardcoded in Rust
- No user identity concept

### For Distribution (Future)

The app doesn't need traditional auth (no server, no accounts). But it needs **identity** for:

1. **Multi-device sync** (future) — knowing which settings belong to which install
2. **Shared dashboards** (future) — knowing who made changes
3. **Update notifications** — opt-in to version announcements

#### Proposed Approach: Local Profile

```
┌─────────────────────────────┐
│ ▾ About                     │
├─────────────────────────────┤
│                             │
│ Pipeline Dashboard v0.1.0   │
│                             │
│ Name: Pierce                │
│ Install ID: pd_a1b2c3      │
│                             │
│ [Check for Updates]         │
│ [GitHub] [Docs] [Discord]   │
│                             │
└─────────────────────────────┘
```

- **Install ID:** Auto-generated UUID on first launch. Not sent anywhere unless user opts in.
- **Name:** Optional, used only for display in the header or potential future shared features.
- **No login, no signup, no email** — purely local. This is a differentiator from Notion/Trello/Cursor.
- **Updates:** Check GitHub releases API for new versions. Show badge if update available. Download is manual (no auto-update in MVP).

### Key Differentiator

> "Every other tool requires a login. This one doesn't. Your projects, your machine, your data."

This should be a conscious design choice, not a missing feature. The About section should communicate it clearly.

---

## Data Flow

### Sidebar ↔ Zustand Store

```typescript
// New store fields for sidebar
interface SidebarState {
  // Panel state
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;

  // Section accordion state
  sidebarSections: Record<string, boolean>;  // { agentActivity: true, sessions: false, ... }
  toggleSidebarSection: (section: string) => void;

  // Agent activity (enriched — replaces simple agentActivity)
  rawActivityState: string | null;           // Raw SSE state value
  activityContext: string | null;            // What the agent is working on
  activityStartedAt: number | null;          // Timestamp of current state
  activityLog: ActivityLogEntry[];           // Ring buffer, last 10

  // Sessions
  backgroundSessions: SessionInfo[];
  refreshSessions: () => Promise<void>;
}

interface ActivityLogEntry {
  state: string;
  icon: string;
  label: string;
  startedAt: number;
  duration: number;  // ms
}

interface SessionInfo {
  sessionKey: string;
  label?: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  runtime: number;
  lastMessage?: string;
  announceMessage?: string;
}
```

### Event Flow

```
WS Event (chat state)
  │
  ├──→ gateway.ts eventHandler
  │     ├──→ setAgentActivity('working'|'typing'|'idle')  [existing, for header label]
  │     └──→ setRawActivityState(state)                    [new, for sidebar detail]
  │           └──→ pushActivityLog(state)                  [new, ring buffer]
  │
  ├──→ parseAnnounceMetadata
  │     └──→ updateBackgroundSession(announce)             [new, for session list]
  │
  └──→ onStreamDelta (unchanged)
```

---

## Component Hierarchy

```
App.tsx
├── Header
│   ├── SidebarToggle (☰ button)
│   ├── Breadcrumb
│   ├── SearchTrigger
│   └── ChatToggle
├── Sidebar                          ← NEW
│   ├── SidebarSection (Agent Activity)
│   │   ├── ConnectionBadge
│   │   ├── CurrentActivity
│   │   └── ActivityLog
│   ├── SidebarSection (Sessions)
│   │   ├── ActiveSessionCard[]
│   │   └── RecentSessionCard[]
│   ├── SidebarSection (Settings)
│   │   ├── ConnectionSettings
│   │   ├── AppearanceSettings
│   │   ├── ProjectSettings
│   │   └── ChatSettings
│   └── SidebarSection (About)
│       ├── VersionInfo
│       └── UpdateChecker
├── Board
│   ├── Column[]
│   │   └── Card[]
│   └── ProjectModal
└── ChatShell (existing, right side)
```

### New Files

| File | Purpose |
|------|---------|
| `src/components/sidebar/Sidebar.tsx` | Container, handles open/close animation |
| `src/components/sidebar/SidebarSection.tsx` | Reusable accordion section wrapper |
| `src/components/sidebar/AgentActivityPanel.tsx` | Real-time agent state display |
| `src/components/sidebar/SessionManager.tsx` | Session list + actions |
| `src/components/sidebar/SessionCard.tsx` | Individual session card |
| `src/components/sidebar/SettingsPanel.tsx` | Settings form groups |
| `src/components/sidebar/AboutPanel.tsx` | Version, links, profile |

---

## State Management

### Persistence

| State | Storage | Notes |
|-------|---------|-------|
| Sidebar open/closed | Tauri settings DB | Survives restart |
| Section accordion states | Tauri settings DB | Survives restart |
| Connection settings | Tauri settings DB | Gateway URL, token, session key |
| Appearance settings | Tauri settings DB | Theme preference |
| Project settings | Tauri settings DB | Scan paths, refresh interval |
| Chat settings | Tauri settings DB | Send behavior, timestamps |
| Agent activity | Zustand (memory only) | Ephemeral, rebuilt from WS events |
| Session list | Zustand (memory only) | Ephemeral, polled from gateway |

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Cmd+B` | Toggle sidebar |
| `Cmd+J` | Toggle chat drawer (existing) |
| `Escape` | Close whichever panel has focus (sidebar or chat) |

---

## Build Phases

### Phase 1: Shell & Settings (MVP)

**Goal:** Sidebar opens/closes, settings panel works.

- Sidebar container with slide animation
- Hamburger toggle in header
- `Cmd+B` shortcut
- Settings panel with Connection + Appearance groups
- Migrate existing settings (gateway URL, theme) from current locations into sidebar
- Persist sidebar state

**Files:** ~5 new, ~3 modified
**Estimate:** Medium build

### Phase 2: Agent Activity

**Goal:** Rich activity display replaces simple "Working..." label.

- Agent activity panel with current state, duration, icon
- Activity log (ring buffer of recent states)
- Raw state tracking in Zustand store
- Wire into existing WS event handler

**Files:** ~3 new, ~2 modified
**Estimate:** Small-medium build

### Phase 3: Session Manager

**Goal:** See and manage background sessions.

- Session list with active/recent sections
- Poll `sessions_list` via WS RPC
- Session cards with status, runtime, actions
- View Log action (slide-over or modal with transcript)
- Listen for announce events to update session status

**Files:** ~4 new, ~2 modified
**Estimate:** Medium build

### Phase 4: About & Polish

**Goal:** Ship-ready about section, responsive behavior, edge cases.

- About panel with version, links
- Update checker (GitHub releases API)
- Local profile (install ID, optional name)
- Responsive behavior (overlay on narrow screens)
- Mutual exclusion with chat drawer on mobile
- Accessibility (focus trap when overlay, ARIA labels)

**Files:** ~2 new, ~3 modified
**Estimate:** Small build

---

## Dependencies

| Dependency | Status | Notes |
|------------|--------|-------|
| Chat Infrastructure Phase A | ✅ Complete | WS connection, scoped sessions |
| Chat Infrastructure Phase B | ✅ Complete | System bubbles, announce parsing, activity indicator |
| Streaming reconnect fix | ✅ Complete | Reliable WS event delivery |
| Tauri settings persistence | ✅ Exists | `dashboard_settings` table in chat.db |
| `sessions_list` RPC | ✅ Available | Via OpenClaw WS protocol |
| `sessions_history` RPC | ✅ Available | Via OpenClaw WS protocol |

No new external dependencies required. Everything builds on existing infrastructure.

---

## Open Questions

1. **Resizable sidebar?** — MVP uses fixed 280px. Resizable (drag handle) is a nice-to-have but adds complexity. Defer?
2. **Session log viewer** — Inline in sidebar (scrollable), or separate modal/panel? Modal is simpler but breaks flow.
3. **Settings migration** — Current settings are scattered (theme in localStorage, gateway URL in env/settings). Should we migrate all at once or incrementally?
4. **Build actions on roadmap items** — The existing roadmap item mentions a "hammer button" to kick off builds. Is that sidebar scope or a separate deliverable?

---

*Spec is a living document. Update as decisions are made during build.*
