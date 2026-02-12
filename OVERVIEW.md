---
title: Pipeline Dashboard
status: up-next
type: project
priority: 1
tags: [tooling, productivity, agent-native]
icon: 📊
---

# Pipeline Dashboard

*Visual, interactive project pipeline with embedded OpenClaw.*

**Status:** Spec Complete — Ready for Build  
**Spec:** [SPEC.md](./SPEC.md)

---

## What It Is

A Tauri + Vite + React desktop app that:
- Visualizes all projects as a kanban board
- Reads/writes directly to markdown files (no database)
- Has OpenClaw chat embedded in a sidebar
- Becomes agent-native (I can modify the dashboard itself)

---

## Why

Current state: projects live in markdown files, require Q&A or opening files to see status. No quick visual overview, no drag-and-drop, no central hub.

Future state: Open the app, see everything at a glance, drag to reorder, chat with me to make changes. The dashboard becomes the cockpit.

---

## Build Plan

1. **Phase 1:** Tauri + Core Board with Repo Reading (kanban, drag & drop, repo merging, write routing)
2. **Phase 2:** Detail & Edit (card detail modal, inline editing, CRUD)
3. **Phase 3:** Chat Integration (OpenClaw embedded, context injection)
4. **Phase 4:** Polish + Git Sync (search, staleness indicators, dark mode, commit/push)
5. **Phase 5:** Project SDK + GitHub Integration (templates, commit tracking)
6. **Phase 6:** Hierarchical Navigation (drill into project roadmaps)

---

## Handoff

Spec is detailed enough for a coding agent to build without clarifying questions. Located at:

```
/Users/piercekearns/clawdbot-sandbox/projects/pipeline-dashboard/SPEC.md
```

---

## Post-Build

Once live, create a skill (`skills/pipeline-dashboard/`) so I can interact with/modify the dashboard efficiently.
