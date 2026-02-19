---
title: Cmd+K Search Modal
status: complete
type: deliverable
parent: pipeline-dashboard
lastActivity: 2026-02-12
shippedDate: 2026-02-12
planDoc: docs/plans/2026-02-12-feat-cmd-k-search-plan.md
tags: [ui, search, keyboard]
---

# Cmd+K Search Modal

Command palette style search for quick navigation.

## Features

- `Cmd+K` opens a modal overlay
- Search bar with focus
- As you type, shows matching project cards
- Enter/click to navigate to project
- Escape to close

## Similar To

- Spotlight
- Raycast
- VS Code command palette
- Linear

## Implementation Notes

- Use dialog/modal component from shadcn
- Fuzzy search across title, tags, nextAction
- Keyboard navigation in results (arrow keys)
