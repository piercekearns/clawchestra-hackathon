---
title: Chat Infrastructure Overhaul
id: chat-infrastructure
status: pending
tags: [chat, infra, openclaw, architecture]
icon: "🔧"
specDoc: docs/specs/scoped-chat-sessions-spec.md
---

# Chat Infrastructure Overhaul

Combined deliverable covering the core chat reliability and isolation improvements. These are tightly coupled — all three improve the chat experience and share implementation surface area (`gateway.ts`, `lib.rs`, chat components).

## Scope

### 1. WebSocket Auto-Reconnection
- Reliable reconnection when gateway drops or restarts
- Previous attempt reverted (commit `36fbc72`) — suspected Tauri WebSocket plugin issue
- Need: exponential backoff, connection state tracking, message delivery guarantee post-reconnect
- Includes: updating default scan path from `~/clawdbot-sandbox/projects/` to `~/projects/` (leftover from architecture overhaul)

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

## Why Combined

These three are the "make the chat actually reliable and contextually correct" bundle. WebSocket reconnection ensures messages arrive. Scoped sessions ensure they arrive in the right conversation. Compaction UI ensures the user understands when the conversation is being summarized. All three touch `gateway.ts` and the chat component suite.

## Predecessors

Absorbs and replaces:
- `websocket-reconnection` (was P6)
- `scoped-chat-sessions` (was P8)
