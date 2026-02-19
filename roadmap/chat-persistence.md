---
title: Chat Persistence
status: complete
type: deliverable
parent: pipeline-dashboard
lastActivity: 2026-02-12
shippedDate: 2026-02-12
specDoc: docs/chat-persistence/SPEC.md
tags: [chat, persistence]
reviewed: true
reviewedDate: 2026-02-12
---

# Chat Persistence

Persist chat history locally (SQLite via Tauri) so conversations survive app restarts.

## Deliverables

**Phase 1: Basic Persistence (~2-3h)**
- SQLite storage layer (single `messages` table, no sessions)
- Tauri commands: `chat_messages_load`, `chat_message_save`, `chat_messages_clear`
- Save messages on send/receive
- Load all messages on startup

**Phase 2: Lazy Loading (~1-2h)**
- Paginated loading (50 at a time, cursor-based)
- Scroll-to-top triggers loadMore
- Loading indicator

## Deferred (Post-MVP)

- Virtualization (not needed for <500 messages)
- Sessions table + session management UI
- Encryption at rest

## Estimate

~4-5 hours total (reviewed 2026-02-12)
