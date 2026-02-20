---
title: Chat Drawer UI
status: complete
type: deliverable
parent: clawchestra
specDoc: docs/CHAT-DRAWER-SPEC.md
planDoc: docs/plans/2026-02-11-feat-chat-drawer-ui-integration-plan.md
lastActivity: 2026-02-12
tags: [chat, ui, p1]
shippedDate: 2026-02-12
---

# Chat Drawer UI

Redesign the OpenClaw chat to a drawer-based UI.

## Components

- **ChatBar** — persistent bottom bar with status + input
- **StatusBadge** — connection indicator (connected/error/disconnected)
- **ActivityIndicator** — shows current work ("Thinking...", "Running tool...")
- **ResponseToast** — notification when response complete (click to open drawer)
- **ChatDrawer** — expandable panel with full conversation history
- **MessageBubble** — individual messages with markdown
- **ThinkingSummary** — collapsible "Thought Xs · N tools" header

## Key Behaviors

- Click anywhere on chat bar (Row 1) opens drawer
- Toggle arrow [▲] centered in bar
- Activity text appears right of badge while working
- Toast appears only when response fully complete
- Drawer draggable to resize (default ~50% height)
- All thinking/tool work collapsed by default

## Implementation Phases

1. Core structure (bar, drawer, messages)
2. Activity & toast system
3. Rich messages (thinking, tools, markdown)
4. Polish (animations, drag, backdrop)
