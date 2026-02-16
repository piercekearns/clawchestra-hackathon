---
title: Scoped Chat Sessions
id: scoped-chat-sessions
status: pending
tags: [architecture, openclaw, chat]
icon: "🧵"
specDoc: docs/specs/scoped-chat-sessions-spec.md
---

# Scoped Chat Sessions

Per-surface conversational isolation for OpenClaw integrations. Each app/surface (Pipeline Dashboard, Telegram, future clients) maintains its own conversation thread while sharing global memory, identity, and tools.

## Why

Today all surfaces share one conversation stream. Replying in the dashboard may get a response that's continuing a Telegram thread. The agent can't distinguish which conversation you're continuing.

## Key Idea

**Session scope ≠ memory scope.** Conversations are isolated per surface; memory (MEMORY.md, files, tools) remains global. The agent is one entity with separate threads, not separate agents.

## Phases

1. ✅ **Investigation** — OpenClaw natively supports custom session keys. No gateway changes needed.
2. **Session Key + Clean Slate** — Change `agent:main:main` → `agent:main:pipeline-dashboard` in lib.rs. Clear chat.db (clean slate, old history preserved in gateway JSONL).
3. **Compaction Awareness UI** — Surface compaction/memory-flush events as system bubbles in chat. Reference Control UI's approach, match dashboard theme.
4. **Context Enrichment** — Richer per-message context injection (selected project, AGENTS.md auto-load, session preamble).
5. *(Future)* Surface Profiles — Generalised surface definition pattern for any app integration.
6. *(Future)* Cross-Session Awareness — Shared state bus for significant events across surfaces.

## Spec

See `docs/specs/scoped-chat-sessions-spec.md` for full analysis, investigation results, confirmed behaviors, and decisions log.
