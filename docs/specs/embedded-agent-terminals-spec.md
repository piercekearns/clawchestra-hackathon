# Embedded Agent Terminals

> Give Clawchestra users direct, visible access to coding agent sessions tied to projects and roadmap items — from embedded terminals (Phase 1) through managed sessions (Phase 2) to native protocol integration (Phase 3) — without removing OpenClaw from the loop.

**Status:** Draft (comprehensive spec, Model D chosen, key decisions captured)
**Created:** 2026-02-21
**Last Updated:** 2026-02-26
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
11. [Decisions](#decisions)
12. [Open Questions](#open-questions)

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

1. User clicks "New chat" on a project card or roadmap item card → selects a terminal type (Claude Code, Codex, Cursor, generic terminal)
2. Clawchestra creates a tmux session:
   - Named: `clawchestra:{project-id}:{uuid}` (or similar unique pattern)
   - Working directory set to project's `localPath`
   - Shell spawned (user's default shell)
3. If agent-specific type was selected:
   - Auto-send the launch command: `claude` or `codex` or `cursor` or `opencode`
   - Wait for TUI initialization
4. xterm.js connects to the tmux session via the PTY bridge
5. Terminal renders in the sidebar panel (same area as OpenClaw chats)
6. User interacts directly — full keyboard input, full terminal output
7. Session tracked in the conversation hub's chat list (with agent-specific icon)

### Pre-Configuration Options

When launching from a specific context, Clawchestra can pre-configure the session:

| Launch Context | Pre-Configuration |
|---------------|-------------------|
| Project card | `cd` to project dir, set `CLAWCHESTRA_PROJECT` env var |
| Roadmap item card | Same as project + `CLAWCHESTRA_ITEM` env var + optionally feed initial prompt referencing spec/plan |
| Generic "Open terminal" | User's default shell in workspace root |
| Agent-specific button | Same as above + auto-launch the agent CLI |

### UI Layout

- Terminal occupies the same sidebar/panel area as OpenClaw chats (conversation hub)
- Chat list shows terminal sessions alongside OpenClaw chats with distinguishing icons
- Terminal header bar: agent icon, session name, project/item scope, status indicator, controls (end session, detach, fullscreen)
- Multiple terminals can exist per project — switch between them via the chat list
- Terminal persists when switching to other views (runs in background via tmux)

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
- User can rename via the `⋯` hover menu (inline edit in place — same pattern as conversation hub chat entries)
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
First-time experience should detect which agent CLIs are available on the user's machine (claude, codex, cursor, opencode) and present them as launch options. If none are found, offer a generic terminal. Don't force the user to configure anything.

### 6. Session naming: auto-generate from context
Default name format: "{agent} — {scope}" (e.g., "Claude Code — git-sync"). Enhanced with first prompt if identifiable. User can rename anytime. No prompt to name on creation — that adds friction.

### 7. Notification threshold: configurable, default to approvals + errors
Notifications fire for approval requests and errors by default. The user can configure: all events, approvals + errors only, errors only, or off. System notifications (macOS) are opt-in.

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

### Layout (shared with `project-conversation-hub` — must resolve before planning)
8. **Chat drawer vs sidebar for terminal panel** — See `project-conversation-hub-spec.md` OQ-1. Terminal sessions live in the same container as OpenClaw chats, so the spatial layout decision there governs terminal rendering too. Key terminal-specific angle: terminal panels likely need more horizontal real estate than chat bubbles — a resizable drawer that can be made wide is more important for terminals than for text chats. The drawer width floor for a usable terminal (80 columns minimum, ideally 120+) should inform the minimum drawer width in the hub spec.

### Longer-term (design context, not Phase 1 blockers)
9. **Claude Code remote control handoff** — If Claude Code is launched via embedded terminal and later controlled remotely (cloud handoff), does Clawchestra's project planning/kanban stay up to date with the remote changes? Needs workflow + sync implications testing.
10. **Claude Code protocol** — Will Anthropic publish a protocol for Claude Code? This determines whether Phase 3 covers the most-used agent. Monitor but don't block on.
11. **ACP stability** — Is ACP stable enough to build against for Phase 3, or will it change significantly? Same — monitor, don't block.
12. **Conversation context portability** — How to bridge the context gap between terminal sessions and OpenClaw. Phase 1 accepts manual bridging. Phase 2 adds filesystem-based awareness. Future: automated session summaries. This is the most important longer-term question for the feature's utility.
13. **Minimum usable terminal width** — Terminal panels need ≥80 columns to be usable (120+ preferred). The chat drawer minimum width in the hub spatial layout should be driven by this constraint, not arbitrary UI preference. Feed into OQ-1 resolution.

## Relationship to Other Specs

- **`project-conversation-hub-spec.md`** — provides the thread/container model. Terminal sessions are a chat type within the conversation hub, alongside OpenClaw chats.
- **`distributed-ai-surfaces-spec.md`** — agent sessions are the most advanced form of distributed AI surface.
- **`scoped-chat-sessions-spec.md`** — session isolation principles. Terminal sessions are separate from OpenClaw chat sessions.
- **`roadmap-item-quick-add-spec.md`** — example of a distributed AI surface; different pattern (chat-based creation vs terminal-based coding) but same conversation hub home.
