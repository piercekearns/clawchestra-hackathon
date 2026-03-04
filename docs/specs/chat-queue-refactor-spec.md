# Chat Queue Refactor

> Replace Clawchestra's client-side message queue with OpenClaw's server-side queue modes, add a visual queue UI with steer promotion, and enable natural language stop detection — so the chat works *with* OpenClaw's capabilities instead of around them.

## Summary

Clawchestra currently holds messages client-side during active runs, preventing them from reaching OpenClaw until the run completes. This blocks OpenClaw's native features: stop phrase detection (51-phrase vocabulary), `steer` mode (mid-run course correction), and `steer-backlog` (steer + preserve for followup). The main chat has a working but redundant queue; the scoped chats silently drop messages.

This item replaces the client-side hold with immediate `chat.send` delivery, letting OpenClaw's `messages.queue.mode` handle queuing server-side. It ships alongside a visual queue UI so the user can see, reorder, and promote queued messages to steer the running agent.

**Prerequisite:** [Chat Stop Button](roadmap/chat-abort-button.md) should ship first. The `chat.abort` RPC provides the explicit stop mechanism; this item adds the queue delegation and natural language stop on top.

## Research Required

This spec documents the architectural direction based on initial research. Before implementation, the following deep-dives are required:

1. **OpenClaw source code review** — Verify queue mode behavior in detail: How does `followup` process messages (one-per-turn sequentially, or something else)? What does the `chat.send` ack look like when a message is queued vs processed immediately? How does `steer` interact with tool boundaries — does it wait for the current tool to finish, or interrupt mid-tool?

2. **`chat.send` ack semantics** — When we send a message during an active run, what does OpenClaw return? We need to know: was this queued, steered, or processed? This determines how we show optimistic UI.

3. **Recent OpenClaw issues review** — Check for known bugs or regressions in queue modes, especially around the 2026.3.x releases, to avoid building on broken behavior. Key areas: `steer` mode reliability, queue ordering guarantees, interaction between queue modes and `chat.abort`.

4. **Codex/other client implementations** — Review how Codex and the OpenClaw webchat handle queued message visualization, reordering, and steer promotion. Use as reference for our UI.

## Current Architecture (What We're Replacing)

### Main chat queue (App.tsx / ChatShell.tsx)

A full client-side FIFO queue. When `isAgentWorking` is true, `submit()` calls `onQueueMessage(payload)` which adds the message to a `chatQueue` array in `App.tsx`. The message is held locally and only sent to OpenClaw after the current run completes.

- `isChatBusy` = `chatSending || gatewayActiveTurns > 0 || activeBackgroundSessions.size > 0`
- Queue drains via `processNextQueuedMessage()` — fires when `isChatBusy` becomes false
- One automatic retry on failure, then marks as `failed` for manual retry
- Messages shown in UI as "queued" with clock icon

### Scoped chat gate (useScopedChatSession.ts)

No queue at all. `handleSend` hard-returns: `if (!text || sending) return;`. The `Clock` icon and "Queue message" label in the UI are **misleading** — the submit is silently dropped. This is a known bug.

### Critical gap

Because both paths either hold or drop messages during active work, **OpenClaw's server-side features are completely bypassed:**

- **Stop phrases**: A user typing "please stop" gets queued locally (main chat) or dropped (scoped chats). OpenClaw's `tryFastAbortFromMessage` never fires because the message never arrives at the gateway.
- **Steer mode**: Impossible — messages never reach OpenClaw during a run.
- **Queue modes**: All five server-side modes (`collect`, `followup`, `steer`, `steer-backlog`, `interrupt`) are irrelevant because messages don't reach the gateway.

## OpenClaw Queue Modes

OpenClaw's `messages.queue.mode` offers five server-side queue behaviours. These control what happens to messages that arrive while a run is active:

| Mode | Behaviour |
|------|-----------|
| `collect` (default) | Coalesce all queued messages into a **single followup turn** after the run completes. Three messages = one combined turn. |
| `followup` | Each message becomes its own turn, processed **sequentially** after the run completes. Three messages = three separate turns, in order. |
| `steer` | Inject the message at the **next tool boundary** during the active run. The agent sees it mid-execution and can course-correct. Remaining queued tool calls are skipped. |
| `steer-backlog` | Same as `steer` (inject mid-run) **AND** preserve the message for the followup turn too. The agent processes it now and also has it as context for whatever it does next. |
| `interrupt` (legacy) | Hard abort. Kill the active run, execute the newest message immediately. Destructive. |

**Note:** None of these apply to stop phrases — those are caught upstream at ingress by `tryFastAbortFromMessage`, before the message enters the queue.

## OpenClaw Stop Phrase Architecture (Migrated from Stop Button spec)

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

### The 51-phrase vocabulary

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

### Why this works once we delegate the queue

Once Clawchestra sends messages via `chat.send` immediately (instead of holding them client-side), stop phrases reach OpenClaw's `tryFastAbortFromMessage` naturally. "Please stop" typed during a run goes straight to the gateway and kills the active run — no mirroring of phrase lists needed for the *functional* stop.

Client-side phrase detection is still needed for the **UI** — to avoid briefly showing "please stop" as a queued message in the visual queue before the server-side abort ack arrives.

## Proposed Architecture

### Core change: Immediate `chat.send`

When the user sends a message during an active run:

1. Call `chat.send` immediately (not held client-side)
2. OpenClaw's dispatch pipeline handles it:
   - If it's a stop phrase → `tryFastAbortFromMessage` catches it, run dies
   - Otherwise → `resolveActiveRunQueueAction` applies the queue mode (`followup` by default)
3. Show the message optimistically in the UI as "queued" (pending server confirmation)
4. Update UI state when the server ack confirms queuing

### Default queue mode: `followup`

`followup` is the right default — each message becomes its own turn, processed in order. This matches the Codex-like behavior where queued messages are visible, individually manageable, and processed turn-by-turn.

`collect` (OpenClaw's default) coalesces into a single turn, which loses the per-message visibility and reordering capability.

### Visual queue UI

When messages are queued (during an active run), show them in the chat as distinct visual elements:

- Each queued message is visible in the chat flow, styled distinctly (e.g. muted, with a clock badge)
- **Reorder**: Drag to reorder queued messages (changes the server-side queue order if supported, or re-sends in desired order)
- **Steer button**: Each queued message has a "Send now" / "Steer" button that promotes it — re-sends the message with `steer` or `steer-backlog` mode, injecting it at the next tool boundary
- **Remove**: Delete a queued message before it's processed
- Messages that aren't stop phrases appear in the queue; stop phrases are intercepted client-side and never shown

### Client-side stop phrase detection (UI only)

Mirror a subset of OpenClaw's `ABORT_TRIGGERS` (at minimum the English phrases) to detect stop phrases before showing them in the visual queue:

1. User types "please stop" and presses Enter while OpenClaw is working
2. Client-side normalizer checks against the phrase list
3. If matched: fire `chat.abort` RPC directly (from the Chat Stop Button item), clear input, don't show in queue UI
4. If not matched: send via `chat.send` immediately, show in visual queue

The server-side `tryFastAbortFromMessage` is the authoritative stop mechanism. Client-side detection is purely for UI cleanliness — preventing a "please stop" message from flashing in the queue before the server confirms the abort.

**Drift risk:** Our phrase subset could drift from OpenClaw's list. Mitigation: keep our list small (English only), document that it's a UI optimization not a functional gate, and periodically sync against OpenClaw's source.

### Scoped chat convergence

Both main chat and scoped chats converge on the same architecture:

- Remove the client-side `chatQueue` from `App.tsx`
- Remove the `if (sending) return` gate from `useScopedChatSession.ts`
- Both paths call `chat.send` immediately, both show the visual queue
- The `isChatBusy` flag is still used for UI state (showing "working" indicators, stop button) but **no longer gates sends**

## Open Questions

1. **`chat.send` ack for queued messages** — What does the response look like when a message is queued server-side? Do we get a queue position, message ID, or just a success ack? (Needs OpenClaw source research)
2. **Queue reordering** — Does OpenClaw support reordering queued messages via RPC, or would we need to cancel and re-send? (Needs research)
3. **Steer mode reliability** — Are there known issues with `steer` mode in recent versions? (Needs issue review)
4. **Queue state synchronization** — How do we keep the visual queue in sync with OpenClaw's server-side queue? Polling, events, or inferred from message acks?
5. **`collect` vs `followup` default** — Should this be configurable by the user, or always `followup`?
6. **Optimistic UI timing** — How long do we show a message as "queued" before the server confirms? What if the ack never arrives?
7. **Interaction with `chat.abort`** — When the user clicks Stop (from the Chat Stop Button item), what happens to queued messages? OpenClaw's `/stop` clears the queue — does `chat.abort` do the same?

## Related OpenClaw Issues

- **#30827 (open):** Priority Interrupt Channel — requesting a general-purpose mechanism for steering running agents beyond just abort. Directly relevant to `steer` mode usage.
- **#12141 (closed):** `/stop` sent as `chat.send` was queuing behind active runs. Fixed with `applyInlineDirectivesFastLane`. Validates that control commands need special handling in the session lane.
- **#22063 (closed):** Stopping clears the chat input field. Relevant to how we handle UI state after abort-via-stop-phrase.

## Scope

- **In scope:** Remove client-side queue, delegate to OpenClaw's server-side `followup` mode, visual queue UI (show/reorder/steer/remove), client-side stop phrase detection for UI, scoped chat silent-drop bug fix, convergence of main chat and scoped chat on same architecture
- **Out of scope:** Keyboard shortcuts for queue management, per-message queue mode selection UI (e.g. dropdown to choose steer vs followup), `interrupt` mode support

## Related Items

- **[Chat Stop Button](roadmap/chat-abort-button.md)** — Ships first. Provides the `chat.abort` RPC mechanism that this item's stop phrase detection delegates to.
