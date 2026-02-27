---
title: Chat Cycle Navigation
id: chat-cycle-navigation
status: pending
tags: [ux, hub, keyboard, navigation]
icon: "⬆️"
nextAction: "Design and implement up/down arrow buttons in secondary chat drawer header"
lastActivity: "2026-02-27"
---

# Chat Cycle Navigation

Add up/down arrow buttons to the **secondary chat drawer header** so the user can cycle through chats within the active project folder — without having to go back to the sidebar each time.

## Problem

Right now navigating between chats requires:
1. Clicking back into the sidebar
2. Finding the right folder
3. Clicking the target chat

This is friction-heavy when iterating through several chats in one project.

## Proposed Solution

In the `ScopedChatShell` / `SecondaryDrawer` header area, add two small chevron buttons (`↑` / `↓`) that cycle through the sibling chats in the same project thread (folder), in the same order they appear in the sidebar.

- Show current chat position e.g. `2 / 5` or just the chat title truncated
- Arrow up = previous chat in folder (wraps or stops at boundary)
- Arrow down = next chat in folder (wraps or stops at boundary)
- Disabled state when only one chat in folder

## Implementation Notes

- Chat order already computed in `HubNav` / `ThreadSection` (pinned first, then by `lastActivity` desc)
- Need to expose ordered sibling list to `ScopedChatShell` — either via store or prop drilling
- Consider also wiring keyboard shortcuts (Alt+↑/↓ or similar) for power users, guarded to only fire when the drawer is open and no input is focused
