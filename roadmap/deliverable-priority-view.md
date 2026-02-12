---
title: Deliverable Priority View
status: up-next
type: deliverable
priority: 4
parent: pipeline-dashboard
lastActivity: 2026-02-11
tags: [ui, roadmap, hierarchy]
---

# Deliverable Priority View

When clicking into a project, show its roadmap items (deliverables) as a priority-sorted list, not a full Kanban.

## Features

- Vertical list sorted by priority
- Status shown as badge on each card (not columns)
- Drag to reorder → updates priority in .md file
- Status dropdown on card → change status without opening
- Click card → see details (spec, plan docs)

Note: Done items don't appear because they're removed from `roadmap/` and moved to CHANGELOG when completed. No filtering needed.

## Card Display

```
┌────────────────────────────────────────────┐
│ Chat Drawer UI                      [P1]   │
│ Redesign the OpenClaw chat...              │
│ 🟡 In Progress ▾     📄 Spec              │
└────────────────────────────────────────────┘
```

## Behavior

- Drag to reorder → updates `priority` in file
- Click status dropdown → updates `status` in file  
- Click card → opens detail view with spec/plan docs

## Notes

This is the "Level 2" view in the hierarchy:
- Level 1: Projects (full Kanban)
- Level 2: Deliverables (priority list)
- Level 3: Spec/Plan docs (markdown view)
