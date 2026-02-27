---
title: Terminal Session Status Indicator
id: terminal-session-status
status: pending
tags: [terminal, ux, hub, status, tmux]
icon: "🟢"
nextAction: "Route all terminal sessions through named tmux sessions; query tmux on app launch for accurate alive/dead state"
lastActivity: "2026-02-27"
---

# Terminal Session Status Indicator

The app always knows the accurate alive/dead state of every terminal — no assumptions, no stale state.

## The key insight: tmux as the backing runtime

A raw PTY is a child of the app process — it dies when the app exits, and there's no way to query its state after restart. **tmux is a daemon** — it runs independently and survives app restarts. This makes it the right backing runtime for terminal sessions that need queryable state.

By routing all terminal sessions through **named tmux sessions**, the app can determine accurate state at any time by simply asking tmux.

## How it works

### Session naming
Each terminal chat gets a tmux session named after its chat ID:
```
clawchestra-{chatId}
```

### On app launch (state reconciliation)
Run `tmux list-sessions` once at startup, cross-reference with all known terminal chat IDs:
- Session found → **alive**
- Session not found → **dead**

This is accurate for all scenarios:
- **App restart** — tmux server still running → sessions found if still alive ✓
- **Machine reboot** — tmux server gone → all sessions "not found" = dead ✓
- **User pressed stop** — session was killed → not found = dead ✓
- **Process inside terminal exited** — session still exists in tmux until explicitly closed → depends on tmux configuration (can configure `remain-on-exit` or detect via `#{pane_dead}`)

### During a session
- PTY spawns inside tmux → emit alive
- `tmux kill-session` (stop button) → emit dead
- Process exits inside pane → tmux pane enters "dead" state, queryable via `tmux display -p '#{pane_dead}'`

## Visual

In `ChatEntryRow`, for terminal-type chats:
- **Alive**: normal appearance, no indicator
- **Dead**: terminal icon turns red (`text-status-danger`)

No dots, no badges — just the icon colour. Clean.

## What about non-tmux terminal types? (Claude Code, Codex, Shell)

These should also be routed through tmux as the underlying transport — tmux handles the PTY, and the agent (Claude Code, Codex, etc.) runs inside the tmux pane. This is already the recommended pattern in the coding-agent skill (tmux for reliable long-running sessions). Making it universal means:
- Consistent state tracking across all terminal types
- Sessions survive app restarts (user can pick up a Claude Code session after restarting the app)
- Single query path for status

## Implementation

### On startup
```ts
// In store init or app startup hook:
const liveSessions = await invoke('tmux_list_sessions'); // returns string[]
// liveSessions = ['clawchestra-abc123', 'clawchestra-def456', ...]
for (const chat of allTerminalChats) {
  const alive = liveSessions.includes(`clawchestra-${chat.id}`);
  store.setTerminalStatus(chat.id, alive ? 'alive' : 'dead');
}
```

### Tauri backend
```rust
// New command: tmux_list_sessions
// Runs: tmux list-sessions -F '#{session_name}' 2>/dev/null
// Returns: Vec<String> of session names (empty if tmux not running)
```

### TerminalShell.tsx
- Spawn: `tmux new-session -d -s clawchestra-{chatId}` then attach with tauri-pty or via `tmux attach-session`
- Stop: `tmux kill-session -t clawchestra-{chatId}`

## Files Affected
| File | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Add `tmux_list_sessions` Tauri command |
| `src/lib/store.ts` | `terminalStatuses` map + setters; populate on app launch |
| `src/components/hub/TerminalShell.tsx` | Use named tmux sessions; update status on spawn/exit |
| `src/components/hub/ChatEntryRow.tsx` | Red terminal icon when dead |
| `src/lib/App.tsx` | Run tmux reconciliation on app init |

## Open Questions
1. What happens if tmux isn't installed? Graceful fallback to raw PTY (status always unknown, no indicator shown)?
2. Should sessions `remain-on-exit` so the user can scroll back through output even after the process exits? Or kill the session on process exit?
3. Namespace collision: ensure `clawchestra-{chatId}` is unique and doesn't clash with the user's own tmux sessions.
