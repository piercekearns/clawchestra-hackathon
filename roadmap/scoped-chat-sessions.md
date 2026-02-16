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

## Spec

See `docs/specs/scoped-chat-sessions-spec.md` for full analysis including three implementation approaches (session keys, surface tags, hybrid), surface-specific modalities, and phased implementation plan.
