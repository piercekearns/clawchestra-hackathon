---
title: Terminal Session Status Indicator
id: terminal-session-status
status: pending
tags: [terminal, ux, hub, status]
icon: "🟢"
nextAction: "Design alive/dead status dot on terminal chat entries; detect PTY exit event; handle stale sessions on app restart"
lastActivity: "2026-02-27"
---

# Terminal Session Status Indicator

Show whether a terminal session is alive or dead — without the user having to open it to find out.

## Problem

Terminal chats look identical whether the underlying PTY is actively running or has been killed. This creates confusion in two scenarios:

1. **Idle terminals** — user left a terminal open but hasn't used it in a while. Is it still alive? Is the process still running? No way to tell from the sidebar.
2. **Post-restart stale sessions** — when the app closes (including desktop shutdown), the OS kills all PTY child processes. When the app reopens, terminal chats still exist in the DB but their PTYs are gone. The chat opens to a blank terminal with no explanation.

## Proposed Solution

### Visual: Status dot on terminal chat entries
Add a small coloured dot to `ChatEntryRow` for terminal-type chats:
- 🟢 **Green** — PTY is running, process alive
- ⚫ **Grey** — PTY exited cleanly (user ran `exit`, process completed)
- 🔴 **Red** — PTY died unexpectedly (non-zero exit code, SIGKILL, etc.)
- ❓ **Unknown/dash** — App just started, status not yet determined (previous session)

The dot should be subtle — same visual weight as the unread indicator dot, positioned similarly in the row.

### Detection: PTY exit event
`tauri-pty` emits an exit/close event when the underlying process terminates. In `TerminalShell.tsx`, listen for this event and update a store state:
```ts
pty.onExit(({ exitCode }) => {
  useDashboardStore.getState().setTerminalStatus(chat.id, exitCode === 0 ? 'exited' : 'crashed');
});
```

Add `terminalStatuses: Map<string, 'running' | 'exited' | 'crashed' | 'unknown'>` to the store (ephemeral, not persisted).

### On app restart: stale session handling
When the app starts, any terminal chat that was `running` in a previous session is now stale — its PTY no longer exists. On startup, mark all terminal chats as `unknown`. When a terminal pane mounts and attempts to start a PTY, it transitions to `running`.

Optionally: show a "Session ended" notice inside the terminal pane itself when opening a stale chat, so the user knows what happened and can hit "Restart" to get a fresh shell.

## Implementation Scope

| Component | Change |
|-----------|--------|
| `src/lib/store.ts` | Add `terminalStatuses` map + setters (ephemeral) |
| `src/components/hub/TerminalShell.tsx` | Listen for PTY exit, update store |
| `src/components/hub/ChatEntryRow.tsx` | Show status dot for terminal-type chats |
| `src/components/hub/LiveTerminal.tsx` | Optional: "Session ended" notice + Restart button |

## Open Questions
1. Should the dot only appear on terminal chats, or also on OpenClaw chats that are actively streaming?
2. If a terminal is `crashed`, should the app auto-offer to restart it?
3. On desktop shutdown, the PTY exit event may not fire (OS kills the process tree hard) — the app won't record the exit. How do we handle this cleanly on next launch? (Likely: treat any session older than app's last known uptime as `unknown`)
