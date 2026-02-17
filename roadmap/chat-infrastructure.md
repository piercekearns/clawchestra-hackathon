---
title: Chat Infrastructure Overhaul
id: chat-infrastructure
status: in-progress
tags: [chat, infra, openclaw, architecture]
icon: "🔧"
specDoc: docs/specs/scoped-chat-sessions-spec.md
---

# Chat Infrastructure Overhaul

Make the dashboard chat a reliable command center for orchestrating project work. The goal is confidence: confident messages arrive, confident they're in the right thread, confident sub-agent work completes and reports back, confident decisions aren't made invisibly.

## The Confidence Chain

Pierce's framing: "I can't orchestrate work through the chat because I'm not confident that..."

1. **...agents will actually run** → WebSocket reliability
2. **...if they run, they'll complete** → Failure surfacing
3. **...if they complete, I'll see the output** → Completion delivery + scoped sessions
4. **...if decisions need to be made, I'll see them** → Decision surfacing

Each link in the chain must work before the next one matters.

---

## Phase A: Reliability (Build First)

The foundation. Without this, nothing else works.

### WebSocket Auto-Reconnection
- Reliable reconnection when gateway drops or restarts
- Exponential backoff, connection state tracking, message delivery guarantee post-reconnect
- Previous attempt reverted (`36fbc72`) — suspected Tauri WebSocket plugin issue
- Includes: fix default scan path to `~/projects/`

### Scoped Chat Sessions
- Change session key from `agent:main:main` to `agent:main:pipeline-dashboard`
- Clear SQLite chat.db (clean slate)
- Dashboard gets own conversation thread — sub-agent announces route here, not Telegram
- This alone fixes a huge part of the "I never see the output" problem
- See `docs/specs/scoped-chat-sessions-spec.md`

---

## Phase B: Awareness (Build Second)

Make the invisible visible. The user should always know what's happening.

### Completion Delivery Guarantees
- Sub-agent announce results must reliably arrive in the dashboard session
- Scoped sessions (Phase A) handles routing — this phase validates it works end-to-end
- Test: spawn sub-agent from dashboard, verify announce arrives in dashboard chat (not webchat/Telegram)
- Test: coding agent (Claude Code/Codex) background session completes, result surfaces in dashboard
- Wake trigger pattern (`openclaw system event --mode now`) for immediate notification

### Failure Alerts
- Proactive notification when sub-agents OOM, timeout, or error
- Currently: failures are silent until user asks "what happened?"
- Needed: system bubble in chat when a spawned task fails — with context (what task, what error, which project)
- Monitor `process` sessions for crash/timeout, surface alerts immediately
- Priority over status cards — knowing something broke is more important than watching it work

### Compaction Awareness
- Surface compaction/memory-flush events as system bubbles
- Reference Control UI for event names
- Add to `stateLabels` in `gateway.ts`

### Decision Surfacing (Critical)
- When sub-agents or coding agents surface decisions that need human input, those decisions must be pulled up to the dashboard chat — not resolved invisibly by the orchestrating agent
- **The problem:** In a multi-tier hierarchy (user → OpenClaw → Claude Code → sub-agents), decisions can get swallowed at any layer. The orchestrating agent might just pick an option without asking.
- **Initial approach (conservative):** Surface ALL decisions to the user. Err on the side of asking too much rather than too little.
- **What a decision looks like in chat:**
  - Context: which project, which deliverable, which command/workflow produced it
  - The decision itself: what's being asked, what the options are
  - Ability to respond inline (reply in chat with the choice)
- **Examples:**
  - Plan review recommends changes → surface "Plan review for [deliverable] has 3 recommendations: ..."
  - Claude Code hits an ambiguous architecture choice → surface "Claude Code asks: should X use approach A or B?"
  - Sub-agent encounters an error and has recovery options → surface the options
- **Not in scope (yet):** Structured decision UI (option cards, buttons). That's Phase C / future. For now, natural language in chat is fine — the key is that decisions *reach* the user at all.

---

---

*Phase C (orchestration UI: session panel, status cards, coding agent integration, build buttons) has been de-scoped and moved to the Collapsible Sidebar roadmap item as expansion ideas. See `roadmap/collapsible-sidebar.md`.*

---

## Research Findings

### What OpenClaw Already Provides
- `sessions_spawn` — non-blocking, returns `{ status, runId, childSessionKey }` immediately
- `sessions_list` — list active sessions with optional last N messages
- `sessions_history` — fetch transcript for any session
- `/subagents list/log/stop/info/send` — slash commands for management
- Announce step — results announced back to requester chat session
- Dedicated `subagent` queue lane (concurrency: 8, separate from main)
- Auto-archive after 60 min (configurable)
- `coding-agent` skill — PTY, background mode, process monitoring, wake triggers

### The Gap
The gateway has all the plumbing. The gap is:
1. **Routing** (fixed by scoped sessions) — announces go to the right session
2. **UI** — the dashboard doesn't render sub-agent lifecycle events or decision requests
3. **Agent discipline** — the orchestrating agent (me) needs clear rules about when to escalate decisions vs. act autonomously

### Decision Surfacing — Agent-Side Rules
This isn't just a UI problem. The agent (OpenClaw) needs behavioral rules:
- **Always surface:** Architecture decisions, approach choices (A vs B), plan review recommendations, error recovery options, anything that changes scope or direction
- **Can act autonomously:** File naming, formatting, ordering of independent tasks, mechanical execution of an already-approved plan
- **Rule of thumb:** If the decision would change what gets built or how, surface it. If it's execution detail within an approved scope, proceed.
- These rules should be codified in AGENTS.md and/or SOUL.md so they persist across sessions.

---

## Predecessors

Absorbs and replaces:
- `websocket-reconnection` (was P6)
- `scoped-chat-sessions` (was P8)
