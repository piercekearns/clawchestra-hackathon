---
title: Collapsible Sidebar
id: collapsible-sidebar
status: pending
tags: [ui, navigation]
icon: "📐"
specDoc: docs/specs/collapsible-sidebar-spec.md
---

# Collapsible Sidebar

Toggleable sidebar panel — collapsed by default, slides in/out. Provides a home for secondary UI that shouldn't clutter the main board view.

## Core Features

- Hamburger icon toggle
- Collapsed by default, slides in/out smoothly
- Contains: Settings, navigation, quick actions

## Expansion Ideas (from Phase C de-scope)

These are optional extras that could live in the sidebar if/when the need arises. They come from the de-scoped Chat Infrastructure Phase C (orchestration UI). None are required for the sidebar MVP — they're ideas for what the sidebar could eventually host.

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
- **When it makes sense:** When orchestrating builds against multiple deliverables simultaneously

### Build Actions on Roadmap Items
- "Hammer" button on roadmap item cards to kick off plan/build workflows
- Connects a deliverable's spec/plan to a coding agent invocation
- Status indicator on the card showing if a build is running against it
- **When it makes sense:** When the confidence chain (Phase A + B) is solid and orchestration through the chat is proven reliable

## Dependencies

- Spec needed before build
- Phase C ideas depend on Chat Infrastructure Phase A + B being complete
