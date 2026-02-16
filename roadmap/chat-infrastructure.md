---
title: Chat Infrastructure Overhaul
id: chat-infrastructure
status: pending
tags: [chat, infra, openclaw, architecture]
icon: "🔧"
specDoc: docs/specs/scoped-chat-sessions-spec.md
---

# Chat Infrastructure Overhaul

Combined deliverable covering chat reliability, session isolation, and coding agent orchestration. These are the foundational improvements that make the dashboard chat a reliable command center for project work.

## Scope

### 1. WebSocket Auto-Reconnection
- Reliable reconnection when gateway drops or restarts
- Previous attempt reverted (commit `36fbc72`) — suspected Tauri WebSocket plugin issue
- Need: exponential backoff, connection state tracking, message delivery guarantee post-reconnect
- Includes: fix default scan path from `~/clawdbot-sandbox/projects/` to `~/projects/`

### 2. Scoped Chat Sessions
- Change session key from `agent:main:main` to `agent:main:pipeline-dashboard`
- Clear SQLite chat.db (clean slate)
- Dashboard gets its own conversation thread, isolated from Telegram/webchat
- See `docs/specs/scoped-chat-sessions-spec.md` for full spec

### 3. Compaction Awareness UI
- Surface compaction/memory-flush events as system bubbles in chat
- Reference OpenClaw Control UI for event flow
- Add compaction states to `stateLabels` in `gateway.ts`
- Design system-style bubble (spinner + label, muted styling)

### 4. Sub-Agent & Coding Agent Orchestration
- **Status visibility:** Real-time status of spawned sub-agents and coding agent sessions (Claude Code, Codex CLI) directly in the chat UI
- **Progress tracking:** System bubbles or status cards showing active background work — agent name/label, runtime, current state (thinking/executing/etc)
- **Completion notifications:** Reliable delivery of sub-agent results into the dashboard chat session (not lost to Telegram or swallowed silently)
- **Failure surfacing:** Proactive notification when sub-agents OOM, timeout, or error — not discovered only when user asks
- **Session list panel:** UI to see active sub-agent sessions, their status, and ability to view logs or stop them (wraps `/subagents list/log/stop`)

### Research Findings (Sub-Agent Orchestration)

**What OpenClaw already provides:**
- `sessions_spawn` — non-blocking, returns `{ status, runId, childSessionKey }` immediately
- `sessions_list` — list active sessions with optional last N messages
- `sessions_history` — fetch transcript for any session
- `/subagents list/log/stop/info/send` — slash commands for managing sub-agents
- Announce step — sub-agent results are announced back to the requester chat session
- Dedicated `subagent` queue lane — sub-agents don't block main agent
- Auto-archive after 60 min (configurable)
- `coding-agent` skill — bash-first pattern with PTY, background mode, process monitoring

**What the dashboard needs to add:**
- **UI for gateway events** — the gateway already broadcasts chat events with state info. The dashboard needs to interpret sub-agent spawn/progress/completion events and render them as status cards.
- **Session panel** — a lightweight panel (maybe in the chat drawer or a separate tab) listing active sub-agents with status, runtime, and quick actions (view log, stop).
- **Coding agent wake triggers** — the `coding-agent` skill documents an `openclaw system event` trick for immediate notification when a background coding agent finishes. The dashboard should surface these events.
- **Failure detection** — monitor `process` sessions for OOM/timeout/crash and surface alerts in the chat. Currently this only happens if the main agent proactively checks.

**Key architectural insight:**
The gateway already has all the plumbing (session tools, events, queue lanes). The gap is purely **UI** — the dashboard doesn't render sub-agent lifecycle events. This is a frontend problem, not a backend one.

## Why Combined

These four areas are the "make the dashboard chat a reliable orchestration surface" bundle. WebSocket reconnection ensures messages arrive. Scoped sessions ensure they're in the right thread. Compaction UI keeps the user informed about session health. Sub-agent orchestration lets the user kick off and monitor background work.

## May Break Into Phases

This scope is large enough that it might split into sequential deliverables during implementation. Likely split:
1. **Phase A:** WebSocket reconnection + scoped sessions + scan path fix (reliability)
2. **Phase B:** Compaction UI + sub-agent status visibility (awareness)
3. **Phase C:** Session panel + coding agent orchestration UI (orchestration)

## Predecessors

Absorbs and replaces:
- `websocket-reconnection` (was P6)
- `scoped-chat-sessions` (was P8)
