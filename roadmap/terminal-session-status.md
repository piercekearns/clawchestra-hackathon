---
title: Terminal Session Status Indicator + Quit Guard
id: terminal-session-status
status: pending
tags: [terminal, ux, hub, status, pid, quit-guard]
icon: "🟢"
nextAction: "Implement PID tracking at spawn, liveness probe on open/poll, red icon in ChatEntryRow, CloseRequested quit guard"
lastActivity: "2026-02-27"
---

# Terminal Session Status Indicator + Quit Guard

Two related features, one implementation:

1. **Red terminal icon** — when a terminal session is dead, its icon turns red in the sidebar/hub nav so the user immediately knows their work context is gone before opening it
2. **Quit guard** — when the user tries to quit the app (Cmd+Q or window close), warn them if any terminal sessions are currently alive

## Key behaviours confirmed via testing

- **Closing the terminal pane / switching to another chat** → PTY process keeps running. Process is alive.
- **Pressing the stop button (square)** → PTY is killed. Process is dead.
- **App restart via update** → PTY processes survive. Still alive.
- **Cmd+Q (app quit)** → PTY processes are killed. Dead.
- **PC restart / shutdown** → PTY processes are dead.
- **Process exits naturally** (Claude Code finishes, user types `exit`, etc.) → Dead.

**No tmux required.** The PTY is already somewhat detached from the app lifecycle (survives app restarts via update). Liveness is determined by asking the OS directly via PID probe — a zero-cost syscall.

## How it works

### 1. Store PID at spawn time

When a PTY is spawned, persist to the chat's metadata in state.json:

```json
{
  "terminalMeta": {
    "pid": 48291,
    "startedAt": 1709078400000
  }
}
```

`startedAt` is used to guard against **PID recycling** — after a reboot, a new unrelated process might inherit the same PID. Cross-checking start time ensures we don't false-positive a dead session as alive.

### 2. Liveness probe

```ts
// Node.js — sends no signal, just checks process existence
try {
  process.kill(pid, 0);
  return true; // alive
} catch {
  return false; // dead (ESRCH)
}
```

To guard PID recycling, additionally run:
```bash
ps -p <pid> -o lstart=
```
If the reported start time doesn't match `startedAt` within a small tolerance → treat as dead (recycled PID).

### 3. When to probe

| Trigger | Action |
|--------|--------|
| App launches | Probe all terminal chats with stored PIDs |
| Terminal chat opened/focused | Probe on demand |
| Background poll | Every 30s while app is open |
| `pty.onExit()` fires | Immediate flip to dead (real-time, while app is open) |

### 4. Visual: red terminal icon

In `ChatEntryRow`, for terminal-type chats:

- **Alive** (or no PID stored yet) → normal icon colour, no change
- **Dead** → terminal icon renders as `text-red-500` (or `text-status-danger`)

No dots, no badges, no extra chrome. Just the icon colour.

> Note: "Alive" includes sessions where the pane is closed but the process is still running in the background. Pane visibility is irrelevant — the probe result is the source of truth.

### 5. Dead session ribbon (in-pane restart)

When the terminal pane is open and the session is dead, render a thin ribbon **at the top of the terminal pane** — the same pattern as the `isLinkedItemComplete` ribbon in `DrawerHeader.tsx` (semi-transparent, slim, border-bottom).

Use red/danger palette instead of chartreuse:

```tsx
{terminalStatus === 'dead' && (
  <div className="flex items-center gap-2 border-b border-red-500/10 bg-red-500/5 px-4 py-1.5 md:px-6">
    <CircleX className="h-3.5 w-3.5 shrink-0 text-red-400/70" />
    <span className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">
      Session ended
    </span>
    <button
      type="button"
      onClick={handleRestartSession}
      className="rounded-full border border-red-500/30 px-2 py-0.5 text-[11px] text-neutral-500 transition-colors hover:bg-red-500/10 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
    >
      ↺ Restart
    </button>
  </div>
)}
```

**Placement:** rendered inside `DrawerHeader.tsx` immediately after the `isLinkedItemComplete` ribbon (same slot, same layout position — top of the content area, below the header bar controls).

**Restart behaviour:**
- Spawns a new PTY of the same type (shell / Claude Code / Codex) for this chat
- Writes a subtle separator into the xterm.js buffer: `─── session restarted ───` so the user can see where old output ends and new begins
- Updates stored `terminalMeta.pid` and `terminalMeta.startedAt`
- Flips status back to alive → ribbon disappears, icon returns to normal colour

The frozen scrollback from the dead session remains visible above the separator — useful context for what the previous session was doing.

### 5. Quit guard

Intercept `CloseRequested` before the app exits:

```ts
import { getCurrentWindow } from '@tauri-apps/api/window';

getCurrentWindow().onCloseRequested(async (event) => {
  const active = getActiveTerminalSessions(); // chats where probe = alive
  if (active.length > 0) {
    event.preventDefault();
    // show confirmation dialog
    const confirmed = await confirmQuit(active.length);
    if (confirmed) getCurrentWindow().close();
  }
  // else: no active sessions → close immediately, no prompt
});
```

**Dialog copy:**
> **"You have {n} active terminal session{s}"**
> Quitting Clawchestra will end them. Any running processes (Claude Code, Codex, etc.) will be stopped.
> **[Cancel]** &nbsp; **[Quit anyway]**

Dialog only appears when at least one session is alive. If all terminals are dead (all red), app quits without prompt.

## Files Affected

| File | Change |
|------|--------|
| `src/lib/store.ts` | `terminalMeta` per-chat map (`pid`, `startedAt`); `terminalStatuses` derived liveness map + setters |
| `src/components/hub/TerminalShell.tsx` | Write `terminalMeta` on PTY spawn; listen to `onExit` to flip status; expose restart handler |
| `src/lib/pty.ts` (or equivalent) | Expose `probeTerminalStatus(pid, startedAt)` — runs kill-0 + ps start time check |
| `src/components/hub/ChatEntryRow.tsx` | Red terminal icon when `terminalStatuses[chatId] === 'dead'` |
| `src/components/hub/DrawerHeader.tsx` | Dead session ribbon (same slot as `isLinkedItemComplete` ribbon); ↺ Restart button |
| `src/lib/App.tsx` | On mount: probe all terminal chats; register `CloseRequested` handler |

## Out of Scope

- Reconnecting to a live session after app restart — the PTY already survives restarts, so reattachment happens automatically
- Recovery suggestions (e.g. "claude --resume") — user's choice, not the app's job
- tmux — no dependency, no requirement
</content>
</invoke>