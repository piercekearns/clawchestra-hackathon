---
title: Sidebar Enhancements
id: sidebar-enhancements
status: pending
tags: [ui, navigation, orchestration]
icon: "🗂️"
nextAction: "Define which panel(s) to build first"
lastActivity: "2026-02-18"
---

# Sidebar Enhancements

Populate the collapsible sidebar with useful content. The sidebar shell is built (see `collapsible-sidebar`) — this item covers what goes inside it.

## Candidate Panels

### Settings (already shipped)
- ⚙ Settings button pinned to sidebar bottom — opens existing SettingsDialog
- **Status:** Done (Phase 1 shell)

### Active Sessions Panel
- List of active sub-agent and coding agent sessions
- Shows: label, runtime, status (running/complete/failed)
- Quick actions: view log, stop, send message
- Wraps OpenClaw `/subagents list/log/stop` commands
- **When it makes sense:** When regularly running 3+ parallel background agents

### Coding Agent Status
- Named sessions (Claude Code's double-barrel names, Codex session IDs)
- Progress indicators tied to specific roadmap items
- Live state updates (thinking/executing/writing)
- tmux instance monitoring — how many, which tool, which deliverable
- **When it makes sense:** When orchestrating builds against multiple deliverables simultaneously

### Build Actions on Roadmap Items
- "Hammer" button on roadmap item cards to kick off plan/build workflows
- Connects a deliverable's spec/plan to a coding agent invocation
- Status indicator on the card showing if a build is running against it
- **When it makes sense:** When the confidence chain (spec → plan → review → build) is proven reliable

### Navigation / Quick Access
- Project quick-switch (like Codex's thread list in the sidebar)
- Recent items / pinned projects
- Bookmarked roadmap items

## Dependencies

- Collapsible sidebar shell (done)
- Chat Infrastructure Phase A + B should be solid before orchestration panels
- OpenClaw sub-agent APIs needed for session monitoring

## Open Questions

- Which panel first? Agent sessions or navigation?
- Should panels be toggleable/configurable, or a fixed layout?
- Should the sidebar have tabs/sections, or a single scrollable list?
