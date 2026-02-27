# Embedded Agent Terminals

> Give Clawchestra users direct, visible access to coding agent sessions tied to projects and roadmap items — from embedded terminals (Phase 1) through managed sessions (Phase 2) to native protocol integration (Phase 3) — without removing OpenClaw from the loop.

**Status:** Draft (decisions captured — terminal launch UX, MIN_WIDTH approach, hub foundation confirmed; ready for plan)
**Created:** 2026-02-21
**Last Updated:** 2026-02-27
**Roadmap Item:** `embedded-agent-terminals`
**Depends On:** `project-conversation-hub` ✅ delivered — see [Hub Foundation](#hub-foundation) below
**Direction:** Model D (Parallel Tracks) — phased progression

---

## Table of Contents

1. [Problem](#problem)
2. [Direction: Model D (Non-Destructive Parallel Tracks)](#direction-model-d)
3. [Current State: How OpenClaw Interacts with Coding Agents](#current-state)
4. [Landscape: How Other Tools Work](#landscape)
5. [Hub Foundation — What Was Built](#hub-foundation)
6. [Phase 1: Embedded Terminals](#phase-1-embedded-terminals)
7. [Phase 2: Enhanced Terminal + Session Management](#phase-2-enhanced-terminal--session-management)
8. [Phase 3: Protocol Integration (ACP / JSON-RPC)](#phase-3-protocol-integration)
9. [OpenClaw's Role Across Phases](#openclaws-role-across-phases)
10. [Session Lifecycle Management](#session-lifecycle-management)
11. [Alternative Architectural Models](#alternative-models)
12. [Decisions](#decisions)
13. [Open Questions](#open-questions)

---

## Problem

Today, coding agent interaction goes through OpenClaw as an intermediary:

```
User → Clawchestra → OpenClaw → (exec/tmux) → Claude Code / Codex
                                                      ↓
                                  OpenClaw scrapes terminal output
                                                      ↓
                                  OpenClaw summarizes back to user
```

This works for small tasks but has significant trade-offs for substantial coding work:

1. **Token tax** — OpenClaw burns its own tokens orchestrating AND the coding agent burns its tokens doing the work. Double cost.
2. **Black box** — User can't see what Claude Code is actually doing. OpenClaw scrapes terminal output and summarizes it. Diffs, approval requests, progress — all filtered through OpenClaw's interpretation.
3. **Fragile** — tmux keystroke simulation, slash command Tab-completion timing, TUI initialization delays. Commands fail silently. Custom slash commands require specific Tab sequences.
4. **RAM pressure** — exec used to OOM on 16GB Mac. tmux mitigates this but doesn't eliminate it.
5. **No native UI** — Claude Code and Codex can surface structured output (diffs, approvals, progress bars) in their own TUIs. None of this renders in Clawchestra.
6. **Session blindness** — User can't see what sessions OpenClaw has created, what's running, or what state they're in.
7. **No project multiplexing** — User can't have multiple coding sessions open for different projects simultaneously without managing multiple terminal windows outside the app.

---

<a name="direction-model-d"></a>
## Direction: Model D (Non-Destructive Parallel Tracks)

### Core Principle

**Nothing is removed. A parallel capability is added.**

OpenClaw retains all its current capabilities — planning, thinking, roadmap management, small fixes via exec/tmux, context awareness, memory. What gets added is a direct lane where users can interact with coding agents from within Clawchestra, without routing through OpenClaw.

### The Workflow

1. User is in Clawchestra looking at a project's kanban board
2. They chat with OpenClaw about the project — "what should we work on next?", "let's create a roadmap item for X", "update the spec to reflect Y"
3. OpenClaw does what it's great at: planning, structuring, context management, small fixes
4. User decides: "this feature needs proper implementation work"
5. They click a button on that roadmap item → "Open coding session"
6. A coding agent session (Claude Code, Codex, OpenCode, etc.) opens **directly** in Clawchestra — no OpenClaw intermediary
7. User interacts with the coding agent themselves, with full visibility
8. When done, OpenClaw can see what happened (files changed, commits made, git state) because it shares the same workspace
9. User returns to OpenClaw: "implementation is done, update the roadmap item"

### Why Model D

- **Non-destructive** — OpenClaw stays for everything it's good at. Direct agent access is added, not substituted.
- **User choice** — For small tasks, ask OpenClaw to handle it (exec/tmux as usual). For big features, open a direct coding session.
- **Planning + delivery in one place** — The delivery vehicle (coding agent) lives in the same location as the planning view. No switching between Clawchestra for planning and a separate terminal for coding.
- **Multiple concurrent sessions** — Like Conductor, but integrated with project management. Multiple projects, multiple agent sessions, all in one sidebar.
- **OpenClaw awareness** — Even for direct sessions, OpenClaw has context (shared filesystem, git history, roadmap state). It doesn't need to orchestrate to stay informed.

### Phased Progression

| Phase | What | Value | Dependency |
|-------|------|-------|-----------|
| **Phase 1** | Embedded terminals (tmux-backed) | Direct agent access, project multiplexing, session persistence, no more separate terminal windows | Terminal emulator in Tauri + tmux |
| **Phase 2** | Enhanced session management | Session dashboard, status indicators, notifications, output parsing, named sessions | Phase 1 + UI work |
| **Phase 3** | Protocol integration (optional) | Native UI (diffs, approvals, progress cards) for agents that support ACP/JSON-RPC, terminal remains for others | Phase 2 + ecosystem maturity |

Each phase is independently valuable. Phase 2 may be the long-term endpoint if the terminal experience is sufficient. Phase 3 is an enhancement path, not a migration path — terminal stays as an option.

### Phase 0: OpenClaw Visibility (Quick Win, Parallel Track)

Separately from the main phases, surface data OpenClaw already produces about its own exec/tmux sessions:

- Show running exec/tmux sessions in a panel (what's running, which project, how long)
- Display sub-agent sessions and their status
- Surface when OpenClaw is waiting for input or has hit an error

This is useful regardless of Model D and makes OpenClaw's existing orchestration mode less black-box. However, it's a diagnostic improvement — it doesn't deliver the direct agent access that the main phases provide.

---

<a name="current-state"></a>
## Current State: How OpenClaw Interacts with Coding Agents

### exec tool (basic mechanism)
- Spawns shell commands with optional `pty: true` for TTY-required CLIs
- Default timeout: 30min (foreground), ~10min (background before auto-kill)
- Captures stdout/stderr, returns to the agent as tool results
- **Limitation:** Background sessions timeout and get killed for long-running agents

### tmux skill (current workaround)
- Community-contributed skill (not native to OpenClaw core)
- Creates named tmux sessions, sends keystrokes, reads output via `capture-pane`
- **Key insight:** This is simulating a human typing into a terminal. No structured data exchange — just raw terminal text.
- **Why tmux over exec:** Sessions survive the exec timeout and persist independently of OpenClaw

### sessions_spawn / subagents (OpenClaw-to-OpenClaw)
- Spawns isolated OpenClaw agent sessions (not coding agent sessions directly)
- The sub-agent is another OpenClaw run with its own context window
- Sub-agents can themselves use exec/tmux to drive coding agents
- Orchestrator pattern: main OpenClaw → sub-agent OpenClaw → exec/tmux → Claude Code
- Adds another layer of token cost and opacity

### OpenClaw ACP bridge (opposite direction)
- `openclaw acp` starts an ACP **server** — OpenClaw acts as the coding agent for IDEs
- IDEs (Zed, JetBrains, Neovim) connect to OpenClaw via ACP
- OpenClaw does **not** use ACP as a client to connect to other coding agents
- Direction: `IDE --ACP--> OpenClaw` (not `OpenClaw --ACP--> Claude Code`)

### What OpenClaw does NOT have
- No protocol-level client integration with Claude Code, Codex, or OpenCode
- No structured event stream from coding agents (only raw terminal text via tmux)
- No visibility into coding agent sessions from the UI layer
- No ACP client mode (only server mode)

---

<a name="landscape"></a>
## Landscape: How Other Tools Work

### Conductor (conductor.build)

**What it is:** Mac desktop app (proprietary) for running multiple Claude Code and Codex agents in parallel.

**Architecture:**
- Native Mac app (not Electron)
- Uses **git worktrees** for isolation — each agent works in a separate worktree (same repo, different branches, concurrent work)
- Dashboard shows all agent status and pending reviews
- Uses existing Claude Code / Codex subscriptions (your login, no extra cost)
- Local-first — all code stays on the Mac

**What it does well:**
- Simple UX for parallelism — add repo, deploy agents, review changes
- Git worktree isolation is clever (true isolation without multiple clones)
- Unified review interface for merging changes from multiple agents

**Limitations:**
- Mac-only, proprietary, no enterprise features
- Only Claude Code and Codex (no OpenCode, no open-source agents)
- No planning/project management — purely a coding agent runner
- No background execution (agents run while app is open)
- No issue tracker integration

**Relevance to Clawchestra:** Conductor validates the UX pattern (project sidebar → agent sessions → review). Clawchestra's advantage: planning + project management + agent sessions in one tool. Conductor only does the agent part.

### Codex CLI / Desktop App (OpenAI) — open source, Rust

**Architecture:** Protocol-based, layered.
- `codex-core` — embeddable agent engine library
- `codex-tui` — terminal UI (consumes core via protocol)
- `codex-exec` — headless execution mode
- **App Server + JSON-RPC API** — designed for IDE integrations
- **Desktop App** (macOS, Feb 2026) — runs multiple agents in parallel, grouped by project
- Open-source sandboxing (Seatbelt/macOS, Landlock/Linux)

**Integration points:**
- JSON-RPC app server (documented, designed for external clients)
- `codex-core` Rust library (embeddable in Tauri backend)
- ACP support (via broader ecosystem)

### OpenCode — open source (MIT)

- Terminal-native CLI + desktop app + VS Code extension
- Multi-session support — parallel agents on the same project
- LSP integration — auto-configures language servers for the LLM
- 75+ models (Claude, OpenAI, Gemini, local)
- ACP support — standardized editor/client communication
- **Foundation layer** — Kilo Code 1.0 is built on top of OpenCode

### Kilo Code

- VS Code extension + CLI (built on OpenCode foundation)
- Orchestrator mode — coordinated subtasks across planner/coder/debugger agents
- Cross-platform session sync (CLI → VS Code → Slack)
- 500+ models, BYO API key

### Agent Client Protocol (ACP)

- Created by Zed, adopted by JetBrains, GitHub Copilot CLI, Neovim, Emacs, Cline
- JSON-RPC based: client (IDE/UI) ↔ agent (coding tool)
- Like LSP but for coding agents
- OpenClaw already implements ACP **server** side
- ACP Agent Registry for discovering compatible agents
- Still maturing — spec evolving, not all agents support it yet

### Claude Code

- Proprietary CLI (Anthropic)
- No public protocol, no JSON-RPC API, no ACP support (as of Feb 2026)
- Excellent TUI — syntax-highlighted diffs, approval prompts, progress
- Desktop app exists but CLI is often preferred by power users
- **Key constraint:** Terminal embedding is the only integration path unless Anthropic publishes a protocol

---

<a name="hub-foundation"></a>
## Hub Foundation — What Was Built

The `project-conversation-hub` feature is fully delivered and provides the container infrastructure EAT builds into. This section documents the actual state of the codebase so implementers start from ground truth, not speculation.

### Data Model (Ready)

`src/lib/hub-types.ts` already contains:

```ts
type HubChatType = 'openclaw' | 'terminal';

type HubAgentType = 'claude-code' | 'codex' | 'cursor' | 'opencode' | 'generic';

interface HubChat {
  id: string;
  projectId: string;
  itemId: string | null;
  type: HubChatType;         // ← 'terminal' already in the type system
  agentType: HubAgentType | null;
  sessionKey: string | null; // ← null for terminal sessions
  // ... title, pinned, unread, archived, lastActivity, etc.
}
```

The SQLite `chats` table has `type` and `agentType` columns. Terminal sessions will use `type: 'terminal'`, `agentType: <agent>`, `sessionKey: null`. **No schema changes needed.**

### Spatial Layout (Resolved — Option B)

`SecondaryDrawer` is the container. Layout is:

```
[ThinSidebar] | [Main sidebar — HubNav] | [SecondaryDrawer — active chat/terminal] | [Board]
```

The drawer is resizable, side-aware, and independently dismissible. Both OpenClaw chats and terminal sessions render inside `SecondaryDrawer`. The hub nav (thread list, chat entries) lives in the main sidebar and persists regardless of drawer state.

**Current drawer dimensions:** `MIN_WIDTH = 280px`, `MAX_WIDTH = 1200px`. See Decision 8 for the terminal-specific minimum width handling.

### Components EAT Will Modify

EAT adds terminal rendering to the existing hub. These are the specific files to touch — no new top-level architecture needed:

| File | What changes |
|------|-------------|
| `src/components/hub/ScopedChatShell.tsx` | Branch on `chat.type === 'terminal'` → render xterm.js instead of `MessageList` + `ChatBar` |
| `src/components/hub/DrawerHeader.tsx` | Add terminal-specific control: **End Session** button (with confirmation). Closing the drawer via the existing X button is already the "detach" action — no additional Detach button needed. |
| `src/components/hub/ChatEntryRow.tsx` | Branch on `chat.type` for right-edge action: `⏹` End/Archive (context-sensitive) for terminals vs `🗄` Archive for chats |
| `src/components/hub/ThreadSection.tsx` | Remove `disabled` from the Terminal option in `TypePickerButton`; wire up tmux session creation logic |
| `src/components/hub/SecondaryDrawer.tsx` | Accept a `minWidth` prop (or derive from active chat type) to enforce terminal minimum width |

### Components That Already Work (Don't Rebuild)

| Component | Status |
|-----------|--------|
| `HubNav.tsx` | Full thread list, DnD reordering, collapse/expand, all CRUD — no changes needed |
| `ChatEntryRow.tsx` | Pin, rename (inline), archive, mark unread, delete, busy indicator — just needs terminal branching added |
| `QuickAccessPopover.tsx` | Hover popover on thin strip icon, top 5 entries, relative timestamps — no changes needed |
| `ChatTypeIcon.tsx` | Returns `<Terminal />` for `type === 'terminal'`, `<MessageSquare />` for openclaw — sufficient for Phase 1; agent-specific branding icons are Phase 2 |
| `hub-context.ts` | Context injection for OpenClaw chats — terminal sessions skip context injection |
| `hub-actions.ts` | `openOrCreateProjectChat`, `openOrCreateItemChat` — no changes needed |
| Card integration | `projectHasThread` and `itemHasChat` wired in `App.tsx` for both kanban cards and roadmap item rows — no changes needed |

### What Doesn't Exist Yet

Everything else in this spec. The hub provides the container and the plumbing; EAT provides the content — terminal emulation, tmux session management, PTY bridge, agent launch flow, status detection.

---

<a name="phase-1-embedded-terminals"></a>
## Phase 1: Embedded Terminals

### What It Is

A terminal emulator inside Clawchestra, backed by tmux for session persistence. User clicks a button on a project card or roadmap item → terminal session opens in the conversation hub sidebar → pre-loaded with the coding agent CLI already running in the project's working directory. Multiple terminals per project, managed alongside OpenClaw chats in the thread.

### What the User Gets

Exactly what they'd get opening iTerm and typing `claude` or `codex` — but inside Clawchestra, tied to a project, without needing separate terminal windows. Sessions persist across app restarts (thanks to tmux), matching the persistence behavior users expect from OpenClaw chat history. No surprise data loss.

### Why tmux for Phase 1 (Not Phase 2)

The user's experience must be consistent across all chat types in the conversation hub. OpenClaw chats persist their history — the user closes and reopens the app, and the conversation is still there. If terminal sessions died on app close, the experience would be jarring and inconsistent. Users might not even realize they're in a "terminal" vs an "OpenClaw chat" depending on how much the UI abstracts the difference.

tmux provides session persistence transparently:
- Sessions survive app closure (tmux runs independently)
- On app reopen, Clawchestra detects existing tmux sessions and reconnects
- The user's work continues from where they left off
- No "your session was lost" surprises

The UI must make session state obvious — visual indicators for active/idle/completed sessions, clear "End session" actions, and warnings if many sessions are running (resource/cost awareness).

### Terminal Emulator: Recommended Approach

**`tauri-plugin-pty` + xterm.js + tmux backend.** This is the most proven path:

| Component | Role |
|-----------|------|
| **tmux** | Holds the actual terminal session. Survives app restarts. |
| **tauri-plugin-pty** (or equivalent Rust PTY bridge) | Connects Clawchestra to the tmux session. Handles data transport between the webview and the tmux pane. |
| **xterm.js** | Renders the terminal in the webview. Handles keyboard input, ANSI rendering, scrollback. |

The flow: `xterm.js (webview) ↔ tauri-plugin-pty (Rust) ↔ tmux session ↔ agent CLI (claude/codex/etc.)`

**Validation spike needed before committing to this stack:**
- xterm.js performance in Tauri v2 webview (especially with WebGL renderer)
- Key handling (modifier keys, special sequences) pass through correctly from webview → tmux
- Resize behavior when sidebar changes width
- Memory footprint with multiple terminals open
- Claude Code TUI rendering (syntax highlighting, diffs, progress bars) in xterm.js within a webview

This spike validates the *rendering method*. The UX design (sidebar layout, chat-type selection, card entry points) can be planned and built independently — it doesn't depend on the spike outcome. If the spike reveals xterm.js issues, the UX stays the same but the rendering backend changes.

### Agent Launch Flow

**Option B (chosen):** Agent type is selected *before* the terminal opens, from an expanded type-picker. The add menu (`+` button on thread headers, already implemented in `TypePickerButton`) presents detected agents as primary options alongside Generic Terminal. Clawchestra auto-launches the chosen agent CLI when the session starts — no secondary picker needed after the terminal opens.

1. User clicks `+` on a project thread in HubNav
2. Type picker shows auto-detected agents + Generic Terminal:
   ```
   💬 OpenClaw Chat
   ─────────────────
   🖥️ Claude Code      [detected ✓]
   🖥️ Codex            [not installed]
   🖥️ Cursor           [not installed]
   🖥️ OpenCode         [detected ✓]
   🖥️ Generic Terminal
   ```
3. User selects an option → Clawchestra creates a `HubChat` with `type: 'terminal'`, `agentType: <selected>`
4. Clawchestra creates a tmux session:
   - Named: `clawchestra:{project-id}:{uuid}` (unique, avoids conflicts with user's own tmux sessions)
   - Working directory set to project's `localPath`
   - Shell spawned (user's default shell)
5. If agent-specific type was selected: auto-send the launch command (`claude`, `codex`, `opencode`, `cursor`) + wait for TUI initialization
6. xterm.js connects to the tmux session via the PTY bridge
7. `SecondaryDrawer` opens with `ScopedChatShell` rendering the xterm.js terminal
8. Session appears in the chat list with a terminal icon and `"Coming soon"` disabled state removed

**Agent detection:** Clawchestra runs `which claude`, `which codex`, `which cursor`, `which opencode` at app launch and caches results. Detected agents display as fully enabled options; undetected agents are either hidden or greyed with "not installed." Rescan triggered from Settings. Detection is trivial (single shell call per agent) and has no meaningful cost.

### Pre-Configuration Options

When launching from a specific context, Clawchestra can pre-configure the session:

| Launch Context | Pre-Configuration |
|---------------|-------------------|
| Project card | `cd` to project dir, set `CLAWCHESTRA_PROJECT` env var |
| Roadmap item card | Same as project + `CLAWCHESTRA_ITEM` env var + optionally feed initial prompt referencing spec/plan |
| Generic "Open terminal" | User's default shell in workspace root |
| Agent-specific button | Same as above + auto-launch the agent CLI |

### UI Layout

- Terminal occupies the same `SecondaryDrawer` as OpenClaw chats (conversation hub)
- Chat list shows terminal sessions alongside OpenClaw chats with distinguishing icons
- Terminal header bar (`DrawerHeader`): agent icon, session name, project/item scope, status indicator, and one terminal-specific control: **End Session** (see Input Model below for close vs end semantics)
- Multiple terminals can exist per project — switch between them via the chat list
- Terminal persists when switching to other views (runs in background via tmux)

### Drawer Width for Terminal Sessions

The current `SecondaryDrawer` has `MIN_WIDTH = 280px`, which is sufficient for OpenClaw chats but too narrow for productive terminal use. A 280px terminal causes severe TUI layout breakage — Claude Code's diff view, file trees, and approval prompts rely on horizontal space.

**Approach: context-sensitive minimum width**

- When an OpenClaw chat is the active entry → MIN_WIDTH stays at **280px** (no change)
- When a terminal session is the active entry → enforce a higher effective minimum of **560px**, and auto-expand the drawer to at least 560px if it's currently narrower

**Why 560px, not 640px:** 560px gives ~70 usable columns at standard terminal font sizes — enough for Claude Code's TUI to render without critical breakage. 640px (true 80-col standard) is ideal and should be the *default* opening width for a new terminal session, but 560px is the hard floor below which things genuinely break.

**Implementation:** Pass the effective minimum as a prop or derive it from the active chat type inside `SecondaryDrawer`. On terminal session open, if `hubDrawerWidth < 560`, auto-set to 640 (one-time snap, then the user controls it freely). The user can drag narrower than 560px if they choose — this is a soft guardrail on open, not a hard enforced constraint during resize.

### Terminal Input Model

This is meaningfully different from OpenClaw chat input and must be designed explicitly.

**No ChatBar.** For `type === 'terminal'`, `ScopedChatShell` renders only xterm.js — full height, no `ChatBar` at the bottom. The compose-and-send model is irrelevant to a terminal. xterm.js *is* the input surface; Claude Code's own TUI handles the prompt, cursor, and echo. The `ChatBar` being absent is the branch, not an afterthought.

**Input flow:**
```
User keystroke → xterm.js captures → encodes as terminal sequence
              → tauri-plugin-pty (Rust) → PTY → tmux pane → agent process
```
Character-by-character, real-time. No buffering, no submit action.

**Focus management:** The terminal captures all keyboard input when xterm.js is focused. Clawchestra global shortcuts (Cmd+K, Cmd+N, etc.) only fire when the terminal is *not* focused. The user explicitly clicks into the xterm.js canvas to give it focus, and clicks elsewhere (outside the drawer, on the hub nav) to return focus to Clawchestra. No implicit focus switching.

**Paste:** Cmd+V / Ctrl+V when the terminal is focused must paste into the PTY (as terminal paste), not trigger any Clawchestra paste handler. Bracketed paste mode should be forwarded correctly — Claude Code and most modern CLIs use it to safely handle multi-line pastes.

**Terminal sequence pass-through:** Common terminal sequences must pass through to the PTY uninterrupted when the terminal is focused:
- Ctrl+C — interrupt / kill foreground process
- Ctrl+D — EOF / exit shell
- Ctrl+Z — suspend process
- Escape — depends on the running TUI; must NOT close the drawer
- All function keys, arrow keys, modifier combos

xterm.js handles this correctly when focused. The spike should validate that Tauri v2's webview doesn't intercept any of these before they reach xterm.js.

**Close vs End Session — critical distinction:**

| Action | What happens | Warning? |
|--------|-------------|----------|
| **Close drawer (X button)** | xterm.js detaches from the tmux session. tmux keeps running. Agent process continues in the background. Session entry stays in the hub sidebar showing current status. Reopen the drawer and you're back where you left off. | **No warning.** Nothing bad is happening — this is a detach, not a stop. The user shouldn't feel anxious about closing the drawer. |
| **End Session (DrawerHeader button)** | Kills the tmux session. Agent process terminates. Scrollback is preserved (saved to disk before kill). Session moves to Completed state. | **Confirmation required:** *"End the [Claude Code] session? The agent process will stop."* Short, direct. One click to confirm. |

This distinction means the user can freely open and close the drawer as part of their normal workflow — switching contexts, looking at the board, returning to the terminal — without any risk of losing their session. The drawer close is explicitly a detach, and that framing should be visible in the UX: the sidebar entry continues to show a live status indicator (green pulse / amber wait) even when the drawer is closed, making it clear the session is still running.

Escape while the terminal is focused goes to the running process (as a raw Escape terminal sequence), not to Clawchestra. Escape is not a drawer-close shortcut when the terminal has focus.

### What This Doesn't Solve

- No structured data — it's still raw terminal output
- No approval notifications — user has to be watching the terminal
- No session summaries — just scrollback
- No output parsing — what you see is what you get

These limitations drive Phase 2.

---

<a name="phase-2-enhanced-terminal--session-management"></a>
## Phase 2: Enhanced Terminal + Session Management

### What It Is

Phase 1's terminals plus a management and intelligence layer on top. A session dashboard, status indicators, notifications, output parsing, named sessions, scrollback persistence, and session history.

### What the User Gets

Not just "terminals in the app" but "managed coding sessions." A session list in the sidebar where each project has its sessions (both OpenClaw chats and terminal sessions), with the ability to name sessions, see status at a glance, get notifications when something needs attention, and persistent scrollback across app restarts.

### Session Dashboard

The conversation hub sidebar (from `project-conversation-hub` spec) with enriched terminal entries:

```
Clawchestra (project thread)
├── 💬 Project chat
├── 💬 git-sync (roadmap item chat)
├── 🖥️ Claude Code — "implementing git-sync Phase 2" [active]
├── 🖥️ Codex — "fixing auth module" [waiting for approval]
└── 🖥️ Claude Code — "yesterday's refactor" [completed]

ClawOS (project thread)
├── 💬 Project chat
└── 🖥️ Claude Code — "initial setup" [active]
```

Each terminal session shows:
- **Agent icon** — Claude Code, Codex, OpenCode, Cursor, generic terminal
- **Session name** — user-named or auto-generated from first prompt/launch context
- **Status** — active (green), waiting for input/approval (amber), completed (checkmark), errored (red)
- **Duration** — how long it's been running
- **Last activity** — timestamp of last output

### Status Detection (Output Parsing)

Layer basic intelligence on top of terminal output to detect key moments:

| Detection | Method | Action |
|-----------|--------|--------|
| **Waiting for approval** | Pattern match on Claude Code's approval prompt ("Allow?" / "Yes/No") | Amber status indicator, optional notification |
| **Error / failure** | Pattern match on common error patterns (build failures, test failures, stack traces) | Red status indicator |
| **Completion** | Detect when agent returns to prompt (idle for N seconds after output burst) | Mark as idle, suggest summary |
| **Agent exit** | tmux pane exit / PTY process exit event | Mark as completed |

**Important caveat:** Output parsing is heuristic. It will work for ~80% of cases and miss edge cases. This is explicitly acceptable — the user can always look at the terminal directly. The parsing adds convenience, not reliability. When Phase 3 protocols are available, structured events replace heuristic parsing for supported agents.

### Notifications

When a terminal session needs attention (detected via output parsing):

- **Card badge** — the project card or roadmap item card shows a notification indicator
- **Sidebar indicator** — the session in the chat list shows the relevant status
- **Optional system notification** — macOS notification if the app is backgrounded (configurable per user preference — every approval request vs only errors vs off)
- **OpenClaw awareness** — surface a system event to OpenClaw's session so it knows "Claude Code session for project X is waiting for approval" (this enables OpenClaw to proactively mention it if the user asks what's happening)

### Session Naming

- **Default**: Auto-generated from launch context — "Claude Code — git-sync" (agent + scope)
- **First prompt enhancement**: If the user's first message to the agent is identifiable, append it — "Claude Code — git-sync — implementing Phase 2"
- User can rename via **double-click on the name** (primary) or the `⋯` hover menu (secondary) — inline edit in place, Enter to confirm, Escape to cancel
- Name persists across app restarts

### Scrollback Persistence

- Terminal scrollback saved to disk periodically (and on session end)
- Storage: Clawchestra's app data directory (`~/Library/Application Support/clawchestra/sessions/`), not alongside project files (avoids accidental git commits, protects secrets that may appear in terminal output)
- When user reopens Clawchestra, active sessions reconnect to the running tmux session
- Completed sessions show their scrollback (read-only)

### Session History

- Completed sessions remain in the chat list (greyed out / archived section)
- User can review what happened, see the scrollback, see the final status
- Sessions can be deleted/archived by the user
- History is filterable: by project, by agent type, by date, by status

### OpenClaw Conversation Context from Terminal Sessions

A key gap: when the user does deep-dive work in a terminal session, the conversation context (what was discussed, what decisions were made, what was tried and failed) doesn't port back to OpenClaw. OpenClaw can see the *outcomes* (git diff, commits, file changes) but not the *conversation*.

**Phase 2 approach:** OpenClaw discovers outcomes via filesystem (git log, uncommitted changes, roadmap state changes from Clawchestra's sync). The user manually bridges conversation context: "I just finished implementing X in Claude Code, here's what I changed and why."

**Future consideration (Phase 2+):** Automated session summaries. When a terminal session completes or is archived, Clawchestra could:
- Generate a summary of the session (using the scrollback + a cheap AI call)
- Store it as a note attached to the chat entry
- Make it available to OpenClaw as context (e.g., inject into the project's context profile)

This would close the context gap without requiring the user to manually bridge. But it adds complexity and cost (AI call per session summary) — defer until the basic terminal experience is validated.

### When Phase 2 Is "Good Enough"

Phase 2 may be the long-term endpoint. The terminal experience for Claude Code is already excellent — syntax-highlighted diffs, approval prompts, progress indicators — all rendered by Claude Code's own TUI. Phase 2 adds the management layer (which sessions are running, status, notifications, history) without trying to replace the terminal rendering itself.

**Signals that Phase 2 is sufficient:**
- Users are comfortable with the terminal experience
- Output parsing catches the important moments (approvals, errors, completion)
- Session management (sidebar, naming, status, history) is comprehensive enough
- No demand for structured UI beyond what the terminal TUI provides

**Signals that Phase 3 is needed:**
- Output parsing breaks too often (agents change their TUI format, edge cases accumulate)
- Users want to interact with agent output natively (click to approve, inline diff review) rather than through the terminal
- ACP adoption matures and most agents support it, making terminal-only a limiting factor
- Non-technical users need a more approachable interface than a terminal

---

<a name="phase-3-protocol-integration"></a>
## Phase 3: Protocol Integration (ACP / JSON-RPC)

### What It Is

For agents that support structured protocols, replace the terminal with a native UI powered by event data. Terminal stays as a fallback (and as a user preference option).

### What the User Gets

Instead of watching terminal text scroll, they see structured UI components: diff cards with syntax highlighting, approval buttons they can click, progress indicators, file change summaries, command execution cards. The agent session feels like a first-class part of Clawchestra.

But critically: **this is an option alongside terminal, not a replacement.** Users who prefer the terminal experience keep it. Users who prefer native UI get it. Per-session or per-agent-type preference.

### Integration Points

| Agent | Protocol | Status (Feb 2026) | Integration Path |
|-------|----------|-------------------|-----------------|
| **Codex** | JSON-RPC app server | Available, documented | Clawchestra implements JSON-RPC client |
| **OpenCode** | ACP | Available | Clawchestra implements ACP client |
| **Kilo Code** | ACP (inherited from OpenCode) | Available | Same ACP client |
| **Claude Code** | None | No public protocol | Terminal only (until Anthropic publishes a protocol) |
| **GitHub Copilot CLI** | ACP | Public preview | ACP client |
| **Future agents** | ACP (if ecosystem converges) | TBD | ACP client |

### Native UI Components

When a protocol provides structured events, Clawchestra renders them as:

| Agent Event | Native UI Component |
|-------------|-------------------|
| Text output (thinking, explanation) | Message bubble (like chat) |
| File edit (apply_patch / diff) | Inline diff view with syntax highlighting |
| Shell command execution | Command card with collapsible stdout/stderr |
| Approval request | Action buttons: Approve / Deny / Edit |
| Tool call (web search, file read) | Activity indicator with result summary |
| Error / failure | Error card with retry option |
| Session complete | Summary card: files changed, tests run, outcome |

### User Choice: Terminal vs Native

Per-session launch option:

```
[Open coding session]
├── 🖥️ Terminal (Claude Code)     ← always available
├── 🖥️ Terminal (Codex)           ← always available
├── 🖥️ Terminal (OpenCode)        ← always available
├── ⚡ Native UI (Codex)          ← if JSON-RPC available
├── ⚡ Native UI (OpenCode)       ← if ACP available
└── 🖥️ Terminal (generic)         ← any CLI tool
```

Default preference configurable per agent type. User can switch mid-session if the protocol supports it (reconnect via protocol while keeping the terminal session alive as backup).

### When to Build Phase 3

Phase 3 should only be built when:
1. ACP (or equivalent) is stable and widely adopted
2. There's clear user demand for native UI beyond what terminal provides
3. Claude Code gets a protocol (or users accept terminal-only for Claude Code while other agents get native UI)
4. The Phase 2 output parsing heuristics are demonstrably insufficient

Phase 3 is an enhancement, not a migration. Terminal remains a first-class option.

---

<a name="openclaws-role-across-phases"></a>
## OpenClaw's Role Across Phases

OpenClaw never loses anything. Its role evolves alongside the phases:

| Capability | Phase 0 | Phase 1 | Phase 2 | Phase 3 |
|------------|---------|---------|---------|---------|
| **Planning, thinking, chat** | Unchanged | Unchanged | Unchanged | Unchanged |
| **Small tasks via exec/tmux** | Unchanged | Unchanged | Unchanged | Unchanged |
| **Roadmap management** | Unchanged | Unchanged | Unchanged | Unchanged |
| **Awareness of direct sessions** | N/A | Via filesystem (git diff, changed files) | + Session status (knows what's running) + notifications | + Structured summaries |
| **Visibility of own exec/tmux work** | Surface in UI | Same | Same | Same |
| **User asks "what happened?"** | OpenClaw checks git log | Same + session scrollback | Same + session history + parsed events + optional summaries | Same + structured event log |

### When OpenClaw Orchestrates (Still Valuable)

Direct agent access doesn't eliminate the use case for OpenClaw-driven exec/tmux:

- **Small fixes** — "OpenClaw, fix the typo in the header component" → exec/tmux, done in 30 seconds, user doesn't need to watch
- **Automated tasks** — Cron-triggered builds, scheduled reviews, background tasks
- **Multi-step orchestration** — "Review the spec, run the tests, and update the roadmap" — OpenClaw coordinates multiple steps
- **Delegation** — User wants to hand off a task entirely and come back later

For these, the Phase 0 visibility layer makes OpenClaw's work less black-box. For everything else, direct agent sessions (Phases 1-3) provide the hands-on coding experience.

---

<a name="session-lifecycle-management"></a>
## Session Lifecycle Management

### The Problem

Power users understand terminal session lifecycle (open, running, idle, killed). But Clawchestra wraps terminals in a UI that needs to be user-friendly. If sessions are hidden and the user doesn't realize they have 8 Claude Code instances running, the app becomes unusable (memory, CPU, API costs).

### Lifecycle States

```
[Created] → [Launching] → [Active] → [Idle] → [Completed]
                                   ↘ [Waiting for Input]
                                   ↘ [Errored]
                                   ↘ [Killed by User]
```

| State | Meaning | Visual | Auto-Action |
|-------|---------|--------|------------|
| **Created** | tmux session created, shell starting | Spinner | — |
| **Launching** | Agent CLI initializing (5-10s for TUI startup) | Spinner + "Starting Claude Code..." | — |
| **Active** | Agent is processing (output flowing) | Green pulse | — |
| **Idle** | Agent at prompt, no output for N seconds | Grey / dimmed | Subtle "Still running" indicator after configurable timeout |
| **Waiting for Input** | Agent needs approval/decision (detected via output parsing) | Amber indicator | Notification to user |
| **Errored** | Error detected in output or process crashed | Red indicator | Notification to user |
| **Completed** | Agent or shell process exited | Checkmark (greyed) | Move to archived/history section |
| **Killed by User** | User explicitly ended the session | X mark | Remove from active list |

### Resource Awareness

The UI must surface resource usage so users don't accidentally overload their machine:

- **Active session count** — visible in sidebar header: "3 active sessions"
- **Resource warning** — if system memory is low (detectable via Tauri system info), warn before launching new sessions
- **Session age** — long-running idle sessions highlighted with "Running for 2h, still needed?"
- **Quick end** — one-click end for any session, with confirmation for active ones
- **End all** — "End all sessions" action for when things go wrong
- **Cost reminder** — "3 active agent sessions — API costs are accruing independently for each"

### Persistence Across App Restarts (tmux)

Since Phase 1 uses tmux as the session backend:

- tmux sessions survive app closure — the agent keeps running
- On app reopen, Clawchestra detects existing tmux sessions (by naming convention) and reconnects xterm.js to them
- The user sees their sessions exactly as they left them
- Completed sessions (where the tmux pane process has exited) show scrollback as read-only
- **App close behavior**: if active sessions exist, show a notification: "N sessions are still running in the background. They'll be here when you return." — no need to kill them

### Cost Awareness

Each coding agent session burns API tokens independently:

- If using Claude Code: burns against the user's Anthropic subscription/credits
- If using Codex: burns against OpenAI subscription
- Clawchestra should surface this: "3 active agent sessions — API costs are accruing independently for each"
- Future: per-session cost tracking (if agents expose cost data via their TUI or protocol)

---

<a name="alternative-models"></a>
## Alternative Architectural Models (For Reference)

Model D (Parallel Tracks) is the chosen direction. These alternatives are documented for context:

### Model A: Visibility Only (Status Quo + UI)

Keep OpenClaw as sole orchestrator, just add visibility in Clawchestra (surface running sessions, tmux output, sub-agent status). Cheapest, quickest, but doesn't solve the core problem of direct agent access.

### Model B: Clawchestra Direct (OpenClaw Out of the Loop)

Clawchestra connects directly to agents, OpenClaw reduced to project management only. Maximum visibility and control, but loses OpenClaw's orchestration for cases where it's valuable.

### Model C: OpenClaw Adopts ACP Client

OpenClaw gains protocol-level client integration with coding agents, replacing exec/tmux with ACP. Best of both worlds but requires upstream OpenClaw changes.

### Model E: Wait for Ecosystem

Monitor ACP adoption, Claude Code protocol status, OpenClaw roadmap. Build terminal visibility now, deeper integration later. Risk: waiting too long while the ecosystem moves.

---

<a name="decisions"></a>
## Decisions (Resolved)

### 1. tmux for Phase 1 (not Phase 2)
Terminal sessions use tmux as the backend from Phase 1. This ensures session persistence across app restarts, matching the persistence behavior users expect from OpenClaw chat history. Direct PTY (tauri-plugin-pty) would be simpler but sessions would die on app close — creating an inconsistent experience where OpenClaw chats persist but terminal sessions don't.

### 2. Session storage in app data directory
Scrollback and session history stored in `~/Library/Application Support/clawchestra/sessions/`, not alongside project files. Rationale: terminal output doesn't belong in git, may contain secrets, and is an app concern not a project concern.

### 3. OpenClaw integration: filesystem discovery for Phase 1, active notification for Phase 2
Phase 1: OpenClaw discovers outcomes of terminal sessions via git diff, uncommitted files, commit messages. No active notification.
Phase 2: Clawchestra notifies OpenClaw when sessions start/end/need attention, enabling OpenClaw to proactively reference what happened.
Future: Automated session summaries that close the conversation context gap.

### 4. Plan the UX independently of the xterm.js spike
The xterm.js + Tauri v2 validation spike determines the *rendering method*, not the *UX design*. The sidebar layout, chat-type selection, card entry points, and session management UI can all be planned and built independently. The spike runs in parallel.

### 5. Default experience: detect available agents
Clawchestra detects installed agent CLIs at app launch (`which claude`, `which codex`, `which cursor`, `which opencode`) and presents only detected agents as enabled options in the type-picker. Generic Terminal is always available. If no agents are detected, only Generic Terminal is shown. Rescan available from Settings. No user configuration required. See Decision 8 for the full terminal launch UX choice.

### 6. Session naming: auto-generate from context
Default name format: "{agent} — {scope}" (e.g., "Claude Code — git-sync"). Enhanced with first prompt if identifiable. User can rename anytime via double-click or `⋯` menu. No prompt to name on creation — that adds friction.

### 7. Notification threshold: configurable, default to approvals + errors
Notifications fire for approval requests and errors by default. The user can configure: all events, approvals + errors only, errors only, or off. System notifications (macOS) are opt-in.

### 8. Terminal launch UX: Option B (expanded type-picker with auto-detection)
Agent type is selected *before* the terminal opens, via an expanded `TypePickerButton` menu (already implemented in `ThreadSection.tsx` with Terminal as "Coming soon"). Clawchestra detects installed CLIs at app launch (`which claude`, `which codex`, etc.) and presents detected agents as enabled options; undetected agents are hidden or greyed. Generic Terminal is always available as a catch-all. This is chosen over "open generic shell first, pick agent after" (Option A) because it allows Clawchestra to configure the tmux session and auto-launch the agent CLI correctly from the start — no ambiguous "pending agent selection" session state to manage.

### 9. Drawer minimum width: context-sensitive (280px for chats, 560px floor for terminals)
The existing `SecondaryDrawer` MIN_WIDTH (280px) is preserved for OpenClaw chats. When a terminal session is the active entry, a higher effective minimum of 560px is enforced. On first open of a terminal session, the drawer auto-expands to 640px if currently narrower — a one-time snap, after which the user controls width freely. 560px is the hard floor (below which Claude Code's TUI breaks critically); 640px is the comfortable default. The user can drag below 560px by choice — this is a soft guardrail on session open, not a rigid resize constraint.

---

<a name="open-questions"></a>
## Open Questions

### Technical Validation (Phase 1 — spike needed)
1. **xterm.js + Tauri v2 performance** — Does xterm.js render reliably in Tauri v2's webview? WebGL renderer performance? This is the primary technical risk.
2. **Key handling** — Do modifier keys (Ctrl-C, Ctrl-D, Ctrl-Z, Meta/Cmd) pass through correctly from webview → tmux?
3. **Resize** — When the sidebar changes width, does the terminal resize gracefully? Column count recalculation?
4. **Memory** — What's the memory footprint of N concurrent xterm.js + tmux instances?
5. **Claude Code TUI rendering** — Does Claude Code's rich TUI (syntax highlighting, diffs, progress bars) render correctly in xterm.js within a webview?

### Architecture (decide during planning)
6. **tmux session naming convention** — What naming pattern ensures Clawchestra can reliably find its own sessions without conflicting with user's existing tmux sessions?
7. **tmux-to-xterm.js bridge** — Does `tauri-plugin-pty` support attaching to an existing tmux session, or do we need a custom Rust bridge?

### ~~Layout~~ → **Resolved** — see Decision 9

~~8. **Chat drawer vs sidebar for terminal panel**~~ — **Resolved.** Option B was implemented by the hub: `SecondaryDrawer` is the container for all chat types including terminals. Layout is `[ThinSidebar] | [HubNav sidebar] | [SecondaryDrawer] | [Board]`. Terminal-specific width handling is captured in Decision 9 (context-sensitive MIN_WIDTH: 280px for chats, 560px floor / 640px default for terminals). No longer a blocker.

### Longer-term (design context, not Phase 1 blockers)
9. **Claude Code remote control handoff** — If Claude Code is launched via embedded terminal and later controlled remotely (cloud handoff), does Clawchestra's project planning/kanban stay up to date with the remote changes? Needs workflow + sync implications testing.
10. **Claude Code protocol** — Will Anthropic publish a protocol for Claude Code? This determines whether Phase 3 covers the most-used agent. Monitor but don't block on.
11. **ACP stability** — Is ACP stable enough to build against for Phase 3, or will it change significantly? Same — monitor, don't block.
12. **Conversation context portability** — How to bridge the context gap between terminal sessions and OpenClaw. Phase 1 accepts manual bridging. Phase 2 adds filesystem-based awareness. Future: automated session summaries. This is the most important longer-term question for the feature's utility.
13. ~~**Minimum usable terminal width**~~ — **Resolved** via Decision 9. Context-sensitive MIN_WIDTH: 280px for OpenClaw chats (unchanged), 560px floor / 640px default for terminal sessions. Auto-expand on first open if drawer is currently narrower. User can drag below 560px by choice after open.

---

## Agent Branding Icons

Available via [Boxicons Brands (`bxl`)](https://icon-sets.iconify.design/bxl/) on Iconify (MIT licence). Use `@iconify/react` or any Iconify integration — same setup as other icons in the codebase.

| Agent | Iconify ID | Notes |
|-------|-----------|-------|
| **Claude Code** | `bxl:claude-ai` | Anthropic's Claude logo |
| **Codex (OpenAI)** | `bxl:openai` | No dedicated Codex icon — use the OpenAI logo |
| **Cursor** | `bxl:cursor-ai` | Cursor's own logo |
| **OpenCode** | — | No `bxl` icon as of Feb 2026; fall back to `lucide:terminal` or a generic agent glyph |

### Where to Use

Phase 1: `ChatTypeIcon.tsx` currently returns `<Terminal />` for all `type === 'terminal'` entries. In Phase 2 (agent-specific branding), branch on `agentType` to swap in the bxl icon:

```tsx
// ChatTypeIcon.tsx — Phase 2 enhancement
import { Icon } from '@iconify/react';

const AGENT_ICONS: Record<HubAgentType, string> = {
  'claude-code': 'bxl:claude-ai',
  'codex':       'bxl:openai',
  'cursor':      'bxl:cursor-ai',
  'opencode':    'lucide:terminal',   // fallback until bxl adds one
  'generic':     'lucide:terminal',
};
```

Phase 1 can keep `<Terminal />` for all terminal sessions — no need to pull in bxl for the first ship. Phase 2 is when these icons earn their place (session list, session dashboard, type-picker labels).

---

## Relationship to Other Specs

- **`project-conversation-hub-spec.md`** — provides the thread/container model. Terminal sessions are a chat type within the conversation hub, alongside OpenClaw chats.
- **`distributed-ai-surfaces-spec.md`** — agent sessions are the most advanced form of distributed AI surface.
- **`scoped-chat-sessions-spec.md`** — session isolation principles. Terminal sessions are separate from OpenClaw chat sessions.
- **`roadmap-item-quick-add-spec.md`** — example of a distributed AI surface; different pattern (chat-based creation vs terminal-based coding) but same conversation hub home.
