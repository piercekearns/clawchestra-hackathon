---
title: Chat UX Overhaul (MVP)
status: complete
type: deliverable
parent: clawchestra
lastActivity: 2026-02-12
specDoc: docs/plans/2026-02-12-feat-chat-ux-overhaul-plan.md
tags: [chat, ux, bugs, slash-commands]
reviewed: true
shippedDate: 2026-02-12
---

# Chat UX Overhaul (MVP)

Fix critical chat bugs and add basic slash commands. Deliberately minimal scope based on multi-agent review.

## Deliverables

### Phase 1: Bug Fixes (~4h)
- [x] Fix multiple messages bug (only last message showing) — already fixed in gateway.ts
- [x] Fix activity indicator (stays visible during tool calls) — already working
- [x] Disable input while agent working

### Phase 2: Slash Commands (~2-3h)
- [x] Simple command dropdown (6 commands)
- [x] Trigger on `/` at start of message
- [x] Click to select + keyboard nav (arrows, Enter, Escape)

## Out of Scope (Deferred)
- SQLite persistence → JSON file if needed
- Virtualization → Not needed for <1000 messages
- Session management → Single session is fine
- cmdk command palette → Simple dropdown sufficient

## Estimate
~6-8 hours total

## Review Status
✅ Reviewed by 4 parallel agents (architecture, performance, simplicity, data-integrity)
