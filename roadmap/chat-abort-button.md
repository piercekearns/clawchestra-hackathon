# Chat Stop Button

> Give the user a dedicated stop button while OpenClaw is working — using OpenClaw's official `chat.abort` RPC to immediately cancel the active run.

## Summary

When OpenClaw is mid-run (thinking, streaming, tool-calling), the chat bar should show a **Stop button** that cancels the active run via the `chat.abort` RPC. This button is always visible during work — it doesn't disappear when the user types. A separate send/queue button appears when the user has typed content.

Natural language stop detection (e.g. "please stop" triggering an abort), queue architecture changes, and the scoped chat queue fix are **out of scope** for this item — see [Chat Queue Refactor](docs/specs/chat-queue-refactor-spec.md).

## Current State

- Send button shows `ArrowUp` icon when idle, `Clock` icon when `sending` is true
- During `sending`, clicking the button queues the typed message (main chat) or silently drops it (scoped chats — known bug, addressed in Chat Queue Refactor)
- No `chat.abort` RPC call exists in Clawchestra — all commands go via `chat.send`
- OpenClaw's canonical stop command is `/stop`; internally uses `chat.abort`
- Gateway supports `aborted`, `cancelled`, `error-stop` terminal states
- Our gateway.ts already handles `aborted` events (transitions to `awaiting_output`, recovers via history)

## OpenClaw's `chat.abort` RPC

`chat.abort` is OpenClaw's **official, documented RPC** for stopping active runs. It is the same mechanism used by OpenClaw's own webchat stop button, the TUI's Escape key, and messaging channel `/stop` commands. Evidence:

- **openclaw/openclaw#30558** (open, Mar 2026): Bug report that `chat.abort` doesn't work for OpenResponses HTTP API tasks. Reporter uses `openclaw gateway call chat.abort --params '{"runId": "resp_xxx"}'`. Expected response: `{"aborted": true, "runIds": ["resp_xxx"]}`.
- **openclaw/openclaw#3052** (closed): Feature request for `/stop` in messaging channels. States: *"The backend already supports `chat.abort` by sessionKey alone (without runId), so this should be straightforward to implement at the channel handler level."*
- **Webchat** has a stop button (#1906 reports visibility issues). **TUI** has Escape for abort (#1296 reports race conditions). Clawchestra would use the same underlying mechanism.

### Call signature

```ts
// By sessionKey — stops whatever is running in this session
const result = await connection.request('chat.abort', { sessionKey });
// Returns: { aborted: true, runIds: ['run_xxx', ...] }

// By runId — targeted stop of a specific run
const result = await connection.request('chat.abort', { runId: 'run_xxx' });
```

`sessionKey`-only is the right approach for the stop button — stop whatever the current session is doing.

### Known issues

- **#12141:** `/stop` sent as `chat.send` was queuing behind active runs. Fixed server-side with a "fast lane." Not relevant to us — we call `chat.abort` directly, not sending a message.
- **#11423:** `/stop` can fail with `no_active_run` between tool calls. Our button should handle this gracefully (silent no-op, return to idle).
- **#30558:** `chat.abort` doesn't work for OpenResponses HTTP API tasks. Shouldn't affect us — we use WebSocket sessions, not HTTP API tasks.

## Proposed Behaviour

### Two-button model during work

When OpenClaw is working, the chat bar has **two independent controls:**

1. **Stop button** — always visible while a run is active, regardless of input state
2. **Send/Queue button** — appears when the user has typed content

These are not mutually exclusive. The user can queue a message AND still stop the current run.

### State table

| OpenClaw State | Input Empty? | Buttons Shown | Button Actions |
|----------------|-------------|---------------|----------------|
| **Idle** | Yes | Send (disabled) | — |
| **Idle** | No | Send | Send message |
| **Working** | Yes | Stop | Abort current run |
| **Working** | No | Stop + Send | Stop aborts run; Send queues message |
| **Working (msg queued)** | — | Stop | Abort current run (queue already submitted) |

### Interaction flows

**Flow 1: Simple stop**
1. User sends message → OpenClaw starts working
2. Stop button appears (replaces `ArrowUp` in the send button position)
3. User clicks Stop → `chat.abort` RPC fires → run transitions to `aborted` → button returns to `ArrowUp`

**Flow 2: Queue then stop**
1. OpenClaw is working
2. User types a follow-up message → Send button appears (as queue, `Clock` icon) alongside Stop
3. User presses Enter / clicks Send → message queued, Send button disappears
4. Stop button still visible → user can still abort if needed

**Flow 3: Stop then type**
1. OpenClaw is working
2. User clicks Stop → run aborts
3. User types a new message → normal send flow

### Button layout

**Stop replaces send; queue appears as secondary:**
- Stop button: `Square` icon, same `h-7 w-7` size, same position as `ArrowUp`
- Queue button: `Clock` icon, appears to the left of Stop when input has content
- No colour change — same styling as the current send button (neutral, not red)
- Abort only cancels the current run/turn, not the session — it's a normal control, not a panic button
- Smooth icon transition (no layout shift)

## Implementation Approach

### Mechanism: Direct `chat.abort` RPC

```ts
// Bypass the message queue — stop takes effect immediately
await connection.request('chat.abort', { sessionKey });
```

This avoids issue #12141 where `/stop` sent as `chat.send` queues behind pending messages. The WebSocket `connection.request` infrastructure already exists in `gateway.ts`.

**Fallback:** If `chat.abort` RPC isn't available or fails, fall back to sending `/stop` via `chat.send`. Less reliable but works on older OpenClaw versions.

### Changes needed

| File | Change |
|------|--------|
| `src/components/chat/ChatBar.tsx` | Add stop button logic; two-button rendering during `sending` state |
| `src/lib/gateway.ts` | Export a `stopActiveRun(sessionKey)` function that calls `chat.abort` RPC |
| `src/lib/commands.ts` | Update `/abort` → `/stop` to match OpenClaw's canonical command |
| `src/hooks/useScopedChatSession.ts` | Expose `stopRun` callback |
| `src/components/hub/ScopedChatShell.tsx` | Pass `onStop` to chat bar |
| `src/components/chat/ChatShell.tsx` | Pass `onStop` to chat bar |

### Input preservation

Since we call `chat.abort` directly (not through the input field), the user's typed text should be preserved. Verify no side effects in the store.

## Edge Cases

- **Abort during tool execution:** Gateway handles interruption → `aborted` terminal state
- **Abort race condition:** Run completes naturally at the same moment user clicks Stop → abort is a no-op, button returns to idle. No error shown.
- **`no_active_run` response:** If OpenClaw returns this (#11423), silently ignore — the run already finished. Button returns to idle.
- **Multiple rapid clicks:** Debounce — ignore clicks within 500ms of a previous abort
- **Queued message + abort:** Both actions are independent. Aborting the current run doesn't discard the queued message.
- **Network failure during abort:** If the RPC fails, show a brief toast ("Stop failed — try again") and keep the stop button visible

## Open Questions

1. **Button layout when both Stop + Queue are visible:** Side-by-side? Stop on right (primary), Queue on left?
2. **Keyboard shortcut:** Cmd+. or Escape to stop? (Future scope, but worth noting)

## Scope

- **In scope:** Stop button in both main chat bar and hub scoped chat bars; direct `chat.abort` RPC; input preservation; two-button layout; `no_active_run` graceful handling
- **Out of scope:** Natural language stop detection, queue architecture changes, scoped chat queue fix, keyboard shortcuts — see [Chat Queue Refactor](docs/specs/chat-queue-refactor-spec.md)

## Related Items

- **[Chat Queue Refactor](docs/specs/chat-queue-refactor-spec.md)** — Follows this item. Delegates queue to OpenClaw server-side modes, adds visual queue UI with steer promotion, enables natural language stop. The stop button ships first and works independently; the queue refactor builds on it.
