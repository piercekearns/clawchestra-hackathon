# Embedded Agent Terminals

> Give Clawchestra users direct, visible access to coding agent sessions tied to projects and roadmap items — from embedded terminals (Phase 1) through managed sessions (Phase 2) to native protocol integration (Phase 3) — without removing OpenClaw from the loop.

**Status:** Draft (comprehensive spec, Model D chosen)
**Created:** 2026-02-21
**Last Updated:** 2026-02-21
**Roadmap Item:** `embedded-agent-terminals`
**Depends On:** `project-conversation-hub` (thread/container model)
**Direction:** Model D (Parallel Tracks) — phased progression

---

## Table of Contents

1. [Problem](#problem)
2. [Direction: Model D (Non-Destructive Parallel Tracks)](#direction-model-d)
3. [Current State: How OpenClaw Interacts with Coding Agents](#current-state)
4. [Landscape: How Other Tools Work](#landscape)
5. [Phase 1: Embedded Terminals](#phase-1-embedded-terminals)
6. [Phase 2: Enhanced Terminal + Session Management](#phase-2-enhanced-terminal--session-management)
7. [Phase 3: Protocol Integration (ACP / JSON-RPC)](#phase-3-protocol-integration)
8. [OpenClaw's Role Across Phases](#openclaws-role-across-phases)
9. [Session Lifecycle Management](#session-lifecycle-management)
10. [Alternative Architectural Models](#alternative-models)
11. [Open Questions](#open-questions)

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
| **Phase 1** | Embedded terminals | Direct agent access, project multiplexing, no more separate terminal windows | Terminal emulator in Tauri |
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

<a name="phase-1-embedded-terminals"></a>
## Phase 1: Embedded Terminals

### What It Is

A terminal emulator inside Clawchestra. User clicks a button on a project card or roadmap item → terminal opens → pre-loaded with the coding agent CLI already running in the project's working directory. Multiple terminals, one per project/item, managed in the conversation hub sidebar.

### What the User Gets

Exactly what they'd get opening iTerm and typing `claude` or `codex` — but inside Clawchestra, tied to a project, without needing separate terminal windows. This is the Conductor model but integrated with project management.

The user who prefers the Claude Code CLI experience keeps that experience. The user who prefers Codex's GUI-like project view gets something similar via the conversation hub sidebar (project → sessions → click to open). Both without leaving Clawchestra.

### Terminal Emulator Options

xterm.js is the most common web-based terminal emulator but not the only option:

| Option | Description | Tauri Compatibility | Trade-offs |
|--------|-------------|-------------------|------------|
| **xterm.js** | Industry standard web terminal emulator. Used by VS Code, Theia, many others. | ✅ Works in webview. `tauri-plugin-pty` provides native PTY bridge. | Most mature, largest ecosystem. WebGL renderer for performance. Canvas fallback. |
| **tauri-plugin-pty** | Tauri-specific plugin that bridges PTY allocation with the frontend. Provides Rust-side PTY management + JS API for xterm.js integration. | ✅ Purpose-built for Tauri. | Simplifies the PTY ↔ xterm.js wiring. Handles spawn, resize, data transport. |
| **portable-pty (Rust)** | Rust crate for cross-platform PTY operations. Used by WezTerm and others. | ✅ Can be used directly in Tauri's Rust backend. | More control, but need to build the frontend bridge yourself. |
| **Tauri shell plugin** | Tauri's built-in `shell` plugin for spawning child processes. | ✅ Native. | Not a real terminal — no PTY, no TUI support. Captures stdout/stderr as text. Only useful for non-interactive commands. |
| **Native terminal view** | Embed an actual native terminal view (e.g., SwiftUI Terminal view on macOS). | ⚠️ Platform-specific, not in webview. Would require Tauri plugin with native rendering. | Best performance, but platform-locked and complex. |

**Recommended approach:** `tauri-plugin-pty` + xterm.js. This is the most proven path:
- `tauri-plugin-pty` handles PTY allocation and lifecycle in Rust
- xterm.js renders the terminal in the webview
- The plugin already provides the bridge (spawn, data transport, resize)
- Production-proven (VS Code uses xterm.js, WezTerm uses portable-pty)

**Validation needed before committing:**
- xterm.js performance in Tauri v2 webview (especially with WebGL renderer)
- Key handling (modifier keys, special sequences) pass through correctly
- Resize behavior when sidebar changes width
- Memory footprint with multiple terminals open
- ANSI escape / color rendering with Claude Code's TUI output

### Agent Launch Flow

1. User clicks "Open terminal" (or agent-specific button like "Claude Code" / "Codex") on a project card or roadmap item
2. Clawchestra creates a terminal session:
   - PTY allocated via `tauri-plugin-pty`
   - Working directory set to project's `localPath`
   - Shell spawned (user's default shell)
3. If agent-specific button was clicked:
   - Auto-send the launch command: `claude` or `codex` or `opencode`
   - Wait for TUI initialization
4. Terminal renders in the sidebar panel (same area as chat threads)
5. User interacts directly — full keyboard input, full terminal output
6. Session tracked in the conversation hub's thread list

### Pre-Configuration Options

When launching from a specific context, Clawchestra can pre-configure the session:

| Launch Context | Pre-Configuration |
|---------------|-------------------|
| Project card | `cd` to project dir, set `CLAWCHESTRA_PROJECT` env var |
| Roadmap item card | Same as project + `CLAWCHESTRA_ITEM` env var + optionally feed initial prompt referencing spec/plan |
| Generic "Open terminal" | User's default shell in workspace root |
| Agent-specific button | Same as above + auto-launch the agent CLI |

### UI Layout

- Terminal occupies the same sidebar/panel area as chat threads
- Thread list shows terminal sessions alongside OpenClaw chats
- Terminal header bar: agent icon, session name, project/item scope, status indicator, controls (kill, detach, fullscreen)
- Multiple terminals can exist per project — switch between them via the thread list
- Terminal persists when switching to other views (runs in background)

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

Not just "terminals in the app" but "managed coding sessions." The experience Pierce described: a session list in a sidebar where each project has its sessions (both OpenClaw chats and terminal sessions), with the ability to name sessions, see status at a glance, get notifications when something needs attention, and persistent scrollback across app restarts.

### Session Dashboard

The conversation hub sidebar (from `project-conversation-hub` spec) expands to include terminal sessions:

```
Project A
├── 💬 OpenClaw Chat (general)
├── 💬 OpenClaw Chat (roadmap item: git-sync)
├── 🖥️ Claude Code — "implementing git-sync Phase 2" [active]
├── 🖥️ Codex — "fixing auth module" [waiting for approval]
└── 🖥️ Claude Code — "yesterday's refactor" [completed]

Project B
├── 💬 OpenClaw Chat (general)
└── 🖥️ Claude Code — "initial setup" [active]
```

Each terminal session shows:
- **Agent icon** — Claude Code, Codex, OpenCode, generic terminal
- **Session name** — user-named or auto-generated from first prompt
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
| **Agent exit** | PTY process exit event | Mark as completed |

**Important caveat:** Output parsing is heuristic. It will work for ~80% of cases and miss edge cases. This is explicitly acceptable — the user can always look at the terminal directly. The parsing adds convenience, not reliability. When Phase 3 protocols are available, structured events replace heuristic parsing for supported agents.

### Notifications

When a terminal session needs attention (detected via output parsing):

- **Card badge** — the project card or roadmap item card shows a notification indicator
- **Sidebar indicator** — the session in the thread list shows the relevant status
- **Optional system notification** — macOS notification if the app is backgrounded (configurable)
- **OpenClaw awareness** — optionally surface a system event to OpenClaw's session so it knows "Claude Code session for project X is waiting for approval"

### Session Naming

- Auto-generated from first prompt or launch context: "Claude Code — git-sync Phase 2"
- User can rename via right-click or inline edit
- Name persists across app restarts

### Scrollback Persistence

- Terminal scrollback saved to disk periodically (and on session end)
- When user reopens Clawchestra, completed sessions show their scrollback (read-only)
- Active sessions reconnect to the running PTY (if the process is still alive)
- Storage: local file per session, keyed by session ID

### Session History

- Completed sessions remain in the thread list (greyed out / archived section)
- User can review what happened, see the scrollback, see the final status
- Sessions can be deleted/archived by the user
- History is filterable: by project, by agent type, by date, by status

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
| **Planning, thinking, chat** | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged |
| **Small tasks via exec/tmux** | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged |
| **Roadmap management** | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged | ✅ Unchanged |
| **Awareness of direct sessions** | N/A | Via filesystem (git diff, changed files) | + Session status (knows what's running) | + Structured summaries |
| **Visibility of own exec/tmux work** | Surface in UI | Same | Same | Same |
| **User asks "what happened?"** | OpenClaw checks git log | Same + session scrollback | Same + session history + parsed events | Same + structured event log |

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
| **Created** | PTY allocated, shell starting | Spinner | — |
| **Launching** | Agent CLI initializing (5-10s for TUI startup) | Spinner + "Starting Claude Code..." | — |
| **Active** | Agent is processing (output flowing) | Green pulse | — |
| **Idle** | Agent at prompt, no output for N seconds | Grey / dimmed | Auto-sleep after configurable timeout? |
| **Waiting for Input** | Agent needs approval/decision (detected via output parsing) | Amber indicator | Notification to user |
| **Errored** | Error detected in output or process crashed | Red indicator | Notification to user |
| **Completed** | Agent or shell process exited | Checkmark (greyed) | Move to history section |
| **Killed by User** | User explicitly killed the session | X mark | Remove from active list |

### Resource Awareness

The UI must surface resource usage so users don't accidentally overload their machine:

- **Active session count** — visible in sidebar header: "3 active sessions"
- **Resource warning** — if system memory is low (detectable via Tauri system info), warn before launching new sessions
- **Session age** — long-running idle sessions highlighted with "Running for 2h, still needed?"
- **Quick kill** — one-click kill for any session, with confirmation for active ones
- **Kill all** — "Kill all sessions" action for when things go wrong

### Persistence Across App Restarts

Two approaches depending on implementation:

**If using tmux backend:**
- tmux sessions survive app closure
- On app reopen, detect existing tmux sessions and reconnect
- Sessions continue running even if Clawchestra is closed
- Pros: true persistence. Cons: tmux dependency.

**If using direct PTY (tauri-plugin-pty):**
- PTY processes are children of the Tauri app
- When app closes, child processes get SIGHUP (may die)
- Options: (a) detach to background on close, (b) warn user about active sessions before close, (c) use tmux as a persistence layer behind the PTY
- Recommended: warn user on close if active sessions exist, offer to kill or detach

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

<a name="open-questions"></a>
## Open Questions

### Technical Validation (Phase 1 blockers)
1. **xterm.js + Tauri v2 performance** — Does `tauri-plugin-pty` work reliably with Tauri v2? WebGL renderer performance? Needs a spike.
2. **Key handling** — Do modifier keys (Ctrl-C, Ctrl-D, Ctrl-Z, Meta/Cmd) pass through correctly from webview → PTY?
3. **Resize** — When the sidebar changes width, does the terminal resize gracefully? Column count recalculation?
4. **Memory** — What's the memory footprint of N concurrent xterm.js + PTY instances?
5. **Claude Code TUI rendering** — Does Claude Code's rich TUI (syntax highlighting, diffs, progress bars) render correctly in xterm.js within a webview?

### Architecture Decisions
6. **tmux vs direct PTY** — Should sessions use tmux for persistence (survive app close) or direct PTY (simpler, but tied to app lifecycle)?
7. **Session storage** — Where do scrollback/session history files live? Alongside project files? In Clawchestra's app data?
8. **OpenClaw integration depth** — Should OpenClaw be notified when a direct session starts/ends? Or just discover changes via filesystem?

### Ecosystem
9. **Claude Code protocol** — Will Anthropic publish a protocol for Claude Code? This determines whether Phase 3 covers the most-used agent.
10. **ACP stability** — Is ACP stable enough to build against, or will it change significantly?

### UX
11. **Default experience** — Should the first-time experience be a terminal, or should we detect available agents and suggest a launch?
12. **Session naming** — Auto-generate from context, or always ask the user to name?
13. **Notification threshold** — How aggressively should we notify? Every approval request? Only errors? Configurable?

## Relationship to Other Specs

- **`project-conversation-hub-spec.md`** — provides the thread/container model. Terminal sessions are threads alongside OpenClaw chats.
- **`distributed-ai-surfaces-spec.md`** — agent sessions are the most advanced form of distributed AI surface.
- **`scoped-chat-sessions-spec.md`** — session isolation principles. Terminal sessions are separate from OpenClaw chat sessions.
- **`roadmap-item-quick-add-spec.md`** — example of a distributed AI surface; different pattern (chat-based creation vs terminal-based coding) but same conversation hub home.
