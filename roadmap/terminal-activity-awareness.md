---
title: Terminal Activity Awareness
id: terminal-activity-awareness
status: pending
tags: [terminal, ux, hub, activity, notifications, claude-code, pty]
icon: "🔔"
nextAction: "Implement PTY output buffer on backend; track lastViewedAt per chat; derive active/unread/attention-required states; surface in sidebar icon"
lastActivity: "2026-02-28"
---

# Terminal Activity Awareness

The app knows not just whether a terminal session is alive or dead (p19), but **what's happening inside it** — even when the pane is closed. Three distinct states surface in the sidebar without the user having to open the terminal to check.

## The three signals

### 1. Unread output
New content has been written to the terminal since the user last had the pane open.

**Example:** You switch away from a Claude Code session mid-task. It finishes and produces output. You should see that something happened without opening it.

### 2. Actively working
The agent/process is currently producing output — bytes are flowing in real time.

**Example:** You open another chat. You glance at the sidebar and see the terminal is still grinding away.

### 3. Action required ⚠️
The process has paused and is waiting for user input — specifically a prompt that requires a response to continue.

**Examples:**
- Claude Code permission request: `"Do you want to allow Claude to run..."`
- Claude Code plan mode: shows a plan, waits for approval/rejection
- Any Y/n or numbered-choice prompt where the process is blocked on stdin

This is the highest-value signal. Without it, the user has no way to know their agent has stalled waiting for them.

---

## Implementation

### Prerequisite: PTY output buffer on the backend

Currently, PTY data is piped directly to the xterm.js pane. When the pane is closed/detached, output is likely dropped. To enable all three signals, the backend must:

- Maintain a **rolling output buffer** per terminal chat (e.g. last 200 lines in memory, or persisted to a small file)
- This buffer is written to regardless of whether the pane is open
- When the pane opens, it receives: historical buffer (scrollback) + live stream going forward

This is the architectural change that enables everything else. Without it, there's nothing to inspect when the pane is closed.

### Signal 1: Unread tracking

```
lastViewedAt: timestamp  — set when the pane is opened/focused
lastOutputAt: timestamp  — set whenever any PTY data event fires
```

`unread = alive && lastOutputAt > lastViewedAt`

Reset `lastViewedAt` when the pane is opened.

### Signal 2: Active detection

```
lastDataAt: timestamp  — set on every PTY data event
isActive = alive && (Date.now() - lastDataAt) < 2000
```

Debounce: if no data for 2s, flip to idle. While data is flowing, `isActive = true`.

Implemented as a reactive flag updated on the PTY data event handler in the backend, pushed to the frontend via Tauri event emission.

**Claude Code spinner:** Claude Code emits a braille/progress spinner using `\r` (carriage return) to overwrite the current line at ~10–15fps while thinking. This produces constant PTY data → `isActive = true` → `…` shows throughout. Correct behaviour. When Claude Code finishes, data stops → debounce → `…` disappears.

**Codex spinner:** Codex CLI uses **ink** (React for terminals), which redraws screen regions using full ANSI cursor-positioning escape sequences (`ESC[A`, `ESC[B`, etc.) rather than simple `\r`. Still produces constant PTY data while working → `isActive = true` → same result. Both CLIs behave correctly for activity detection.

**UI animation debounce (prevents flickering):**
- Enter `…`: require ~500ms of sustained data before showing (filters brief one-line outputs)
- Exit `…`: require ~5–10s of silence (prevents flickering when Claude Code pauses briefly between steps)
The raw `isActive` flag updates at 2s granularity; the animation follows a smoother version of the same signal.

### Signal 3: Action required (heuristic)

Scan the **tail of the rolling buffer** (last 5–10 lines) whenever the process goes quiet (data stops for >500ms). Match against known patterns:

```ts
const ACTION_REQUIRED_PATTERNS = [
  /do you want to allow/i,              // Claude Code permission request
  /\[y\/n\]/i,                          // Generic Y/n prompt
  /\(y\/n\)/i,
  /press enter to continue/i,
  /^\s*\d+\.\s+.+\n\s*\d+\.\s+/m,     // Numbered choice list (2+ options)
  /approve|reject|cancel/i,             // Claude Code plan mode actions
];
```

If any pattern matches and the process is alive but idle → `status = 'attention-required'`.

**Buffer filtering — critical for correctness:**

Only buffer `\n`-terminated lines, not `\r`-overwritten frames:
- `\r⠋`, `\r⠙`, `\r⠹` → discard (Claude Code spinner frames, overwrite same line)
- `\nDo you want to allow Claude to run bash?\n` → buffer this

Anything ending in `\r` is an ephemeral animation frame. Anything ending in `\n` is committed output. Strip ANSI escape sequences on top of this. The pattern matcher only ever sees real lines.

**Codex caveat:** Codex uses ink's full-screen ANSI cursor-positioning for its UI, including permission/approval prompts. These may NOT emit clean `\n`-terminated lines — ink might rewrite an existing screen region instead of appending. Codex-specific action-required detection requires **empirical testing**: capture raw PTY output when a Codex approval prompt appears, inspect what survives the `\n`/ANSI filtering, then write patterns against actual output. May need a supplementary detection strategy (e.g., process alive + stdin in read-blocking state) for ink-based CLIs.

**Caveats:**
- This is intentionally heuristic — it will have false positives/negatives
- Pattern list should be easy to extend as new agent types are added
- A false positive (showing ⚠️ when no action is needed) is annoying but not harmful
- A false negative (missing a permission prompt) is worse — tune patterns conservatively

---

## Visual: sidebar icon states

Consistent with the existing chat icon pattern: chat already shows `…` while the agent is streaming and a notification bubble when there are unread messages. Terminal icons use the same decorators — the icons differ (Terminal, Claude, Codex, etc.) but the animation and bubble system is identical.

**State model:**

| State | Decoration | When |
|-------|-----------|------|
| Alive, idle, no unread | Normal icon, no decoration | Default |
| Alive, **active** | `…` animation on icon | PTY bytes flowing (debounced: 500ms enter, 5–10s exit) |
| Alive, **unread** | Notification bubble (neutral) | New `\n`-output since pane last opened |
| Alive, **action required** | Notification bubble (amber) | Prompt pattern matched, process idle |
| Dead | Red icon (from p19) | PID gone |

**Key design distinction:**
- `…` = "leave it alone, it's working" — no bubble, just animation
- Bubble = "it needs or has something for you" — no animation, process is idle
- These states don't overlap: `…` only shows while data is flowing; bubble only shows when data has stopped

**Amber bubble takes priority** over neutral unread bubble if both conditions are true simultaneously.

**No new UI elements invented** — reuses the existing chat notification bubble component with an amber colour variant. One implementation, applies to all chat types.

---

## Relationship to other items

- **p19 (terminal-session-status):** p19 establishes alive/dead via PID probe. This item adds activity signals on top — they compose. The dead (red) state from p19 remains; this adds states between "alive-idle" and "dead."
- **p20 (hub-session-pairing):** the tab strip in the DrawerHeader can surface the same state — if the terminal tab is amber, there's an action waiting. Clicking the tab navigates there.

---

## Open Questions

1. **Buffer persistence**: keep in memory only (lost on app restart) or persist to disk? In-memory is simpler; persisted means unread state survives app restarts.
2. **Buffer size**: 200 lines in memory is lightweight. Tune based on observed Claude Code output volume.
3. **Push vs poll**: backend emits Tauri events on state change (push) vs frontend polls on a timer. Push is cleaner but requires wiring Tauri event emission from the PTY data handler.
4. **Codex-specific patterns**: Codex uses ink's full-screen ANSI rendering — permission/approval prompts may not emit `\n`-terminated lines. Requires empirical testing (capture raw PTY output during a real Codex approval prompt) before patterns can be written. May need stdin-blocking state detection as a supplementary signal.
5. **`…` animation component**: reuse the existing chat `…` component or build a shared one — confirm the chat typing indicator is already componentised and reusable.
</content>
