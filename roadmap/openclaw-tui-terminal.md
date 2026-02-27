---
title: OpenClaw TUI as Terminal Type Option
id: openclaw-tui-terminal
status: pending
tags: [terminal, openclaw, integration, hub]
icon: "🦞"
nextAction: "Investigate how openclaw TUI is launched; assess feasibility of embedding in terminal pane"
lastActivity: "2026-02-27"
---

# OpenClaw TUI as Terminal Type Option

Add `openclaw tui` as a selectable option in the terminal type picker (alongside Claude Code, Codex, Shell), so users can spin up an OpenClaw TUI session directly inside Clawchestra's terminal pane.

## Problem

The terminal type picker currently offers Claude Code, Codex, and a generic Shell. OpenClaw itself has a TUI mode (`openclaw tui` or similar) that would be a natural fit — it lets users interact with OpenClaw from a terminal without leaving the app context.

## Investigation Needed

Before implementation, confirm:
1. **How is OpenClaw TUI launched?** — `openclaw tui`? `openclaw chat`? Something else?
2. **Does it require a TTY?** — xterm.js provides a PTY, so this is likely fine, but confirm
3. **Is it installed alongside openclaw?** — check `which openclaw` / path detection
4. **Does it conflict with the existing OpenClaw session** running in the sidebar chat?

## Proposed Approach (if feasible)

1. Add `'openclaw'` to `HubAgentType` in `hub-types.ts`
2. Add to `AGENT_LABELS` and `AgentIcon` mappings in `terminal-utils.ts`
3. Add to the detected agents logic (check `which openclaw`)
4. Launch command: `openclaw tui` (or whatever the correct invocation is)
5. Show the Clawchestra lobster-claw icon next to the option in the picker

## Feasibility Note

If `openclaw tui` is interactive-only and doesn't play nicely in an embedded PTY, this may need to be a "open in system terminal" shortcut instead of a true embedded session.
