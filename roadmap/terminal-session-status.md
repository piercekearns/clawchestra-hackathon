---
title: Terminal Session Status Indicator
id: terminal-session-status
status: pending
tags: [terminal, ux, hub, status]
icon: "🟢"
nextAction: "Implement red terminal icon on dead sessions; default all to dead on app launch; transition to alive on PTY spawn"
lastActivity: "2026-02-27"
---

# Terminal Session Status Indicator

Show when a terminal session is dead — for any reason, at any time.

## Design

**Binary state, not multi-state:**
- **Alive** — PTY is running. Normal appearance. No special indicator needed.
- **Dead** — PTY is gone for any reason (user pressed stop, process crashed, machine rebooted, app quit). Terminal icon turns red.

The absence of red means the session is fine. Red means something ended it.

## The startup rule (solves reboot case)

On every app launch, **all terminal chats start as dead**. This is the only reliable approach — since the OS kills PTY processes when the app exits (including on reboot), we can never assume a session from a previous app lifecycle is still alive. There's no way to carry PTY state across a process boundary.

The transition to alive only happens when the user opens a terminal chat and a new PTY is successfully spawned. Until then: red.

This means:
- Fresh install: all terminals red ✓
- After reboot: all terminals red ✓  
- After app crash: all terminals red ✓
- After user presses stop: terminal goes red ✓
- After process inside terminal exits on its own: terminal goes red ✓
- User opens terminal → new PTY starts: goes back to normal ✓

## Visual

In `ChatEntryRow`, for terminal-type chats where status is `dead`:
- Swap the terminal icon colour to red/danger (e.g. `text-status-danger` or `text-red-500`)
- Keep the icon itself the same — just the colour changes
- No dot, no badge — the icon itself communicates the state

## Implementation

### Store (ephemeral — not persisted)
```ts
// In store.ts
terminalStatuses: Map<string, 'alive' | 'dead'>  // ephemeral, not persisted

// All terminal chats default to 'dead' on app init (no initialisation needed —
// absence from map = dead, presence with 'alive' = alive)
setTerminalAlive: (chatId: string) => void
setTerminalDead: (chatId: string) => void
isTerminalAlive: (chatId: string) => boolean
```

### TerminalShell.tsx
```ts
// On PTY spawn success:
useDashboardStore.getState().setTerminalAlive(chat.id);

// On PTY exit (any exit code, any reason):
pty.onExit(() => {
  useDashboardStore.getState().setTerminalDead(chat.id);
});
```

### ChatEntryRow.tsx
```tsx
const isAlive = useDashboardStore(s => s.isTerminalAlive(chat.id));
const isDeadTerminal = chat.kind === 'terminal' && !isAlive;

// On the terminal icon:
<Terminal className={cn("h-3.5 w-3.5", isDeadTerminal ? "text-red-500" : "text-neutral-400")} />
```

## Files Affected
| File | Change |
|------|--------|
| `src/lib/store.ts` | Add `terminalStatuses` map + `setTerminalAlive` / `setTerminalDead` / `isTerminalAlive` (ephemeral) |
| `src/components/hub/TerminalShell.tsx` | Call `setTerminalAlive` on PTY spawn, `setTerminalDead` on exit |
| `src/components/hub/ChatEntryRow.tsx` | Red icon when `isDeadTerminal` |
