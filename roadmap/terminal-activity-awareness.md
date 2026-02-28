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

**Caveats:**
- This is intentionally heuristic — it will have false positives/negatives
- Pattern list should be easy to extend as new agent types are added
- A false positive (showing ⚠️ when no action is needed) is annoying but not harmful
- A false negative (missing a permission prompt) is worse — tune patterns conservatively

---

## Visual: sidebar icon states

Extends p19's alive/dead binary into a richer set. All communicated via the terminal chat icon in the sidebar — no separate badges or dots:

| State | Icon treatment | When |
|-------|---------------|------|
| Alive, idle, no unread | Normal colour | Default when session is live and quiet |
| Alive, **active** | Subtle pulse animation | Bytes currently flowing |
| Alive, **unread** | Filled/brighter icon | New output since last viewed |
| Alive, **action required** | Amber/yellow icon (`text-amber-400`) | Prompt pattern detected, process idle |
| Dead | Red icon (`text-red-500`) | PID gone (from p19) |

The amber "action required" state takes priority over unread if both are true.

**No new UI elements** — the icon itself carries all state. No dots, no counters, no badges. Users learn: "terminal icon colour = what's happening."

---

## Relationship to other items

- **p19 (terminal-session-status):** p19 establishes alive/dead via PID probe. This item adds activity signals on top — they compose. The dead (red) state from p19 remains; this adds states between "alive-idle" and "dead."
- **p20 (hub-session-pairing):** the tab strip in the DrawerHeader can surface the same state — if the terminal tab is amber, there's an action waiting. Clicking the tab navigates there.

---

## Open Questions

1. **Buffer persistence**: keep in memory only (lost on app restart) or persist to disk? In-memory is simpler; persisted means unread state survives app restarts.
2. **Buffer size**: 200 lines in memory is lightweight. Tune based on observed Claude Code output volume.
3. **Push vs poll**: backend emits Tauri events on state change (push) vs frontend polls on a timer. Push is cleaner but requires wiring Tauri event emission from the PTY data handler.
4. **Codex-specific patterns**: Codex has its own approval/confirmation prompts — need to audit and add its patterns to the matcher.
</content>
