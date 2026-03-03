# Chat Stop Button

> Give the user a persistent stop button while OpenClaw is working, plus a separate queue button when they've typed a message — so they can always abort the current run without losing the ability to queue follow-up messages.

## Summary

When OpenClaw is mid-run (thinking, streaming, tool-calling), the chat bar should show a **Stop button** that cancels the active run. This button is always visible during work — it doesn't disappear when the user types or queues a message. The send/queue button is a separate control that appears when the user has typed content.

## Current State

- Send button shows `ArrowUp` icon when idle, `Clock` icon when `sending` is true
- During `sending`, clicking the button queues the typed message
- Clawchestra registers `/abort` in `src/lib/commands.ts` — sent as a regular chat message
- OpenClaw's canonical command is `/stop` (not `/abort`); internally calls `chat.abort` RPC
- Gateway supports `aborted`, `cancelled`, `error-stop` terminal states
- No direct `chat.abort` RPC call exists in Clawchestra — all commands go via `chat.send`

### Queue mechanism analysis

**Main chat (ChatShell / sidebar):** Has a proper client-side queue. When `isAgentWorking` is true, `submit()` calls `onQueueMessage(payload)` which adds the message to a `chatQueue` array in `App.tsx`. The message is held locally and only sent to OpenClaw after the current run completes.

**Hub scoped chats (useScopedChatSession):** No queue at all. `handleSend` hard-returns: `if (!text || sending) return;`. The `Clock` icon and "Queue message" label in the UI are misleading — the submit is silently dropped.

**Critical implication for natural language stop:** Because both paths either queue or drop messages during active work, a user typing "please stop" or "stop openclaw" will **never reach OpenClaw while the run is active**. The natural language stop detection in OpenClaw is completely bypassed by Clawchestra's client-side gating. The Stop button is the **only** way to abort a run from Clawchestra's UI.

## OpenClaw Stop Architecture (Research)

### How OpenClaw handles stop phrases server-side

OpenClaw detects stop phrases at **ingress** — before the message enters the session lane queue. The function `tryFastAbortFromMessage` (in `dispatch-from-config.ts`) runs as step 2 of the dispatch pipeline:

```
Inbound Message
    → shouldSkipDuplicateInbound()     (dedup)
    → tryFastAbortFromMessage()        ← STOP PHRASES CAUGHT HERE (pre-queue)
    → Send policy validation
    → resolveActiveRunQueueAction()    ← normal messages enter queue here
    → Session lane → Agent execution
```

If `tryFastAbortFromMessage` detects a stop phrase, it:
1. Clears the session queue
2. Marks the active run as terminated
3. Recursively stops spawned sub-agent runs
4. Returns an abort reply — the message **never enters the queue**

### Detection: `isAbortTrigger` and the 51-phrase vocabulary

The normalizer (`normalizeAbortTriggerText`) strips punctuation, collapses whitespace, lowercases. The `ABORT_TRIGGERS` set contains **51 phrases** across 10+ languages:

- **English:** stop, esc, abort, wait, exit, interrupt, halt, stop openclaw, stop action, stop run, stop agent, please stop, stop please, do not do that
- **German:** anhalten, aufhoren, stopp
- **Spanish:** detente, deten
- **French:** arrete
- **Portuguese:** pare
- **Japanese:** yamete, tomete (+ kanji)
- **Hindi:** ruko
- **Chinese, Arabic, Russian:** native stop words

All accept trailing punctuation: `STOP OPENCLAW!!!` and `please stop...` both match.

### Why this doesn't help Clawchestra (the gap)

OpenClaw's pre-queue detection works perfectly — **but Clawchestra prevents messages from reaching it.** Our client-side queue (`App.tsx`) and hard gate (`useScopedChatSession.ts`) block messages before they're sent via `chat.send`. OpenClaw's `tryFastAbortFromMessage` never fires because the message never arrives at the gateway.

### OpenClaw's queue modes (context for future architecture)

OpenClaw's `messages.queue.mode` offers five server-side queue behaviours:

| Mode | Behaviour |
|------|-----------|
| `collect` (default) | Coalesce queued messages into a single followup turn |
| `followup` | Enqueue for next turn after current run completes |
| `steer` | Inject at tool boundaries; skip remaining tool calls |
| `steer-backlog` | Steer immediately AND preserve for followup |
| `interrupt` (legacy) | Abort active run, execute newest message |

None of these apply to stop phrases (they're caught upstream). But they're relevant to the broader question of whether Clawchestra should delegate queue policy to OpenClaw entirely (see Architectural Alternative below).

### Commands

**`/stop`:** Canonical stop command. Aborts current run, clears queued followup, terminates sub-agents, returns count of stopped operations.

**`/kill <id|#|all>`:** Immediately terminates sub-agent runs (no confirmation).

### Known issues

- **#12141:** `/stop` sent as `chat.send` was queuing behind active runs in the session lane. Fixed with a "fast lane" (`applyInlineDirectivesFastLane`) that bypasses the session lane for control commands.
- **#22063:** Stopping clears the chat input field — our implementation should preserve input text.
- **#11423:** `/stop` can fail with `no_active_run` between tool calls. Our UI should handle this gracefully.
- **#30827 (open):** Priority Interrupt Channel — requesting a general-purpose mechanism for steering running agents beyond just abort (mid-execution course correction).

**No TUI stop button exists** — Clawchestra would be the first OpenClaw UI with a dedicated stop button.

## Proposed Behaviour

### Two-button model during work

When OpenClaw is working, the chat bar has **two independent controls:**

1. **Stop button** — always visible while a run is active, regardless of input state
2. **Send/Queue button** — appears when the user has typed content (queues the message)

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

### Natural language stop interception (enhancement)

OpenClaw has a 51-phrase pre-queue abort vocabulary, but Clawchestra's client-side gating prevents it from ever firing. Two approaches to restore this:

**Path 1 (targeted): Client-side stop phrase detection**

Mirror OpenClaw's `isAbortTrigger` logic in Clawchestra. Before a message enters our client-side queue:

1. User types "please stop" and presses Enter while OpenClaw is working
2. Clawchestra normalizes text (lowercase, strip punctuation, collapse whitespace)
3. Checks against a subset of OpenClaw's 51-phrase `ABORT_TRIGGERS` set (at minimum the English phrases)
4. If matched: fire `chat.abort` RPC directly, clear input, don't add to chat history
5. If not matched: queue as normal

Pro: Simple, contained change. Con: Maintains a separate copy of OpenClaw's phrase list that could drift.

**Path 2 (architectural): Delegate queue policy to OpenClaw**

Stop gating messages client-side entirely. Send all messages via `chat.send` immediately and let OpenClaw's server-side queue modes (`collect`, `followup`, `steer`) handle queuing. This means:

- `tryFastAbortFromMessage` works naturally — stop phrases are caught at ingress
- OpenClaw's `steer` queue mode becomes available (inject at tool boundaries — much more powerful than our client-side "hold until done" queue)
- Clawchestra no longer duplicates queue logic that OpenClaw already handles
- The `Clock` / "Queue message" UI would reflect OpenClaw's actual queue state, not a client-side hold

Pro: Correct architecture long-term; unlocks OpenClaw's advanced queue modes. Con: Larger change to our chat flow; needs careful handling of the UI feedback loop (how does Clawchestra know a message was queued vs processed?).

**Recommendation:** Path 1 for the stop button MVP. Path 2 as a follow-on architectural item (potentially its own roadmap item: "Server-Side Message Queue Delegation").

### Button layout

The Stop button occupies the **same position** as the existing send button (bottom-right of the input area). When the user types content during a working state, a second button (queue/send) appears next to it.

**Option A (recommended): Stop replaces send; queue appears as secondary**
- Stop button: `Square` icon, same `h-7 w-7` size, same position as `ArrowUp`
- Queue button: `Clock` icon, appears to the left of Stop when input has content
- No colour change — same styling as the current send button (neutral, not red)

**Option B: Side by side**
- Both buttons at `h-7 w-7`, separated by a small gap
- Stop on right (primary position), Queue on left

### Visual

- Stop icon: `Square` from lucide-react (solid filled square = universal stop symbol)
- Same button size and styling as the current send button — no red/destructive colouring
- Abort only cancels the current run/turn, not the session — it's a normal control, not a panic button
- Smooth icon transition (no layout shift)

## Implementation Approach

### Mechanism: Direct RPC vs chat message

**Preferred: Direct `chat.abort` RPC**
```ts
// Bypass the message queue — stop takes effect immediately
await connection.request('chat.abort', { sessionKey });
```

This avoids issue #12141 where `/stop` sent as `chat.send` queues behind pending messages. The WebSocket `connection.request` infrastructure already exists in `gateway.ts`.

**Fallback: Send `/stop` as chat message**
If `chat.abort` RPC isn't available or fails, fall back to sending `/stop` via `chat.send`. This is less reliable but works on older OpenClaw versions.

### Changes needed

| File | Change |
|------|--------|
| `src/components/chat/ChatBar.tsx` | Add stop button logic; two-button rendering during `sending` state |
| `src/lib/gateway.ts` | Export a `stopActiveRun(sessionKey)` function that calls `chat.abort` RPC |
| `src/lib/commands.ts` | Update `/abort` → `/stop` to match OpenClaw's canonical command |
| `src/hooks/useScopedChatSession.ts` | Expose `stopRun` callback; fix misleading queue behaviour (currently silently drops) |
| `src/components/hub/ScopedChatShell.tsx` | Pass `onStop` to chat bar |
| `src/components/chat/ChatShell.tsx` | Pass `onStop` to chat bar |

### Hub scoped chat queue fix

`useScopedChatSession.ts` currently hard-blocks sends during work (`if (sending) return`). This needs fixing regardless of the stop button — the UI says "Queue message" but the message is silently dropped. Either:
- **Option A:** Implement a proper queue (like ChatShell has) for hub scoped chats
- **Option B:** Remove the misleading "Queue message" label and disable the send button during work

This is a prerequisite for the two-button model to work correctly in hub chats.

### Input preservation

Per issue #22063, OpenClaw's own stop mechanism clears the chat input. Since we're calling `chat.abort` directly (not through the input field), this shouldn't affect us — but we should verify that the input `<textarea>` value is preserved after stop fires.

## Edge Cases

- **Abort during tool execution:** Gateway handles interruption → `aborted` terminal state
- **Abort race condition:** Run completes naturally at the same moment user clicks Stop → abort is a no-op, button returns to idle. No error shown.
- **`no_active_run` response:** If OpenClaw returns this (issue #11423), silently ignore — the run already finished. Button returns to idle.
- **Multiple rapid clicks:** Debounce — ignore clicks within 500ms of a previous abort
- **Queued message + abort:** Both actions are independent. Aborting the current run doesn't discard the queued message. The queued message will be sent once the abort completes and OpenClaw is ready.
- **Network failure during abort:** If the RPC fails, show a brief toast ("Stop failed — try again") and keep the stop button visible
- **Natural language stop phrase while idle:** If the user types "please stop" when no run is active, it should be sent as a normal message (OpenClaw will respond naturally — nothing to stop)

## Open Questions

1. **Button layout when both Stop + Queue are visible:** Side-by-side? Stacked? Stop replaces send and queue goes left?
2. **Should the stop button show in the main ChatPanel bar too, or only hub scoped chats?** (Likely both)
3. **Keyboard shortcut:** Cmd+. or Escape to stop? (Future scope, but worth noting)
4. **Natural language stop interception:** Path 1 (client-side phrase matching) or Path 2 (delegate queue to OpenClaw)? Path 1 for MVP, Path 2 as follow-on?
5. **Hub scoped chat queue:** Fix the silent-drop bug as part of this work, or as a separate item?
6. **Server-side queue delegation:** Should we create a separate roadmap item for moving from client-side to server-side message queuing? This would unlock OpenClaw's `steer` mode and make stop phrases work natively.

## Scope

- **In scope:** Stop button in hub chat bars (scoped chats) and main chat bar; direct `chat.abort` RPC; input preservation; two-button layout
- **Out of scope:** Keyboard shortcut, abort confirmation dialog, sub-agent kill UI, natural language stop interception (enhancement, separate pass)
