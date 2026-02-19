# OpenClaw Chat Integration — Architectural Review

**Date**: 2026-02-18
**Reviewer**: Claude (Opus 4.6)
**Scope**: Full review of the chat integration between Pipeline Dashboard (Tauri v2 desktop app) and OpenClaw (local AI orchestration gateway)
**Goal**: Evaluate whether the current architecture is optimal for reliable, production-quality chat UX with no message drops, clear activity state, and smooth streaming

---

## 1. What Was Built

The Pipeline Dashboard includes a chat drawer that connects to a local OpenClaw gateway instance over WebSocket (via `@tauri-apps/plugin-websocket` to bypass browser CORS). The chat allows the user to send natural language instructions to OpenClaw, which orchestrates AI agents that can execute code, manage bots, and work on projects autonomously.

### Core Components

| File | Lines | Responsibility |
|------|-------|---------------|
| `src/lib/gateway.ts` | ~3,008 | Transport resolution, 4 send modes, turn registry, event bus, history extraction, message dedup, activity detection, recovery — **everything** |
| `src/lib/tauri-websocket.ts` | 487 | `TauriOpenClawConnection` singleton class — WS state machine, keepalive, reconnection, RPC request/response, event subscriptions |
| `src/lib/chat-normalization.ts` | 101 | Strips "User workspace path:" / "User request:" context wrappers from echoed messages |
| `src/lib/store.ts` | 549 | Zustand store — `addChatMessage()` with dedup, `collapseChatDuplicates()`, SQLite persistence, paginated loading |
| `src/components/chat/ChatShell.tsx` | ~700 | Main drawer UI — `displayMessages` memo merging streaming + persisted, image attachments, auto-close threshold |
| `src/components/chat/ChatBar.tsx` | 336 | Input textarea with auto-grow, slash command dropdown, queue display, send state |
| `src/components/chat/MessageList.tsx` | 232 | Infinite scroll, auto-scroll, "new messages" pill, reading indicator (bouncing dots) |
| `src/components/chat/MessageBubble.tsx` | 159 | Markdown rendering (react-markdown + remark-gfm), copy buttons |
| `src/components/chat/types.ts` | ~40 | `ChatMessage`, `ChatConnectionState`, `PendingTurn` type definitions |
| `src/App.tsx` | ~1,500 | `sendChatMessage()` orchestration, `reconcileRecentHistory()`, system event handling, connection state bubbles, queue drain |

### Feature Set

- **4 transport modes**: `http-openai`, `openclaw-ws`, `tauri-openclaw` (primary), `tauri-ws`
- **Streaming responses**: Delta/final/error/aborted event states rendered progressively
- **Turn management**: `PendingTurn` records track lifecycle: queued → running → awaiting_output → completed/failed/timed_out
- **Message persistence**: SQLite via Tauri commands, paginated loading (50/page)
- **Message deduplication**: Multiple layers (store-level, display-level, recovery reconciliation)
- **Context wrapping**: User messages prefixed with "User workspace path:" or "User is viewing project:" for agent context
- **Activity detection**: idle/typing/working states from WebSocket event interpretation
- **Recovery system**: `recoverRecentSessionMessages()` backfills from gateway history after reconnection
- **Process polling**: `process.poll` RPC checks if agent process is still running (completion detection fallback)
- **Content block stitching**: Handles multi-tool-call responses where content blocks restart after tool use
- **Message queue**: Messages queued during agent work, drained on completion
- **Keepalive**: `chat.history` probe every 20s to prevent idle WebSocket drops
- **Auto-reconnection**: Exponential backoff, max 5 attempts
- **Image attachments**: Resize/compress (max 1920px, 150KB/image, 300KB total)

---

## 2. What the Architecture Is Trying to Achieve

The goal is a **first-class chat experience** where:

1. The user sends natural language to OpenClaw and sees streaming responses in real-time
2. Activity state (idle/working/typing) is always accurate — the user knows when work is happening
3. Messages are never dropped or duplicated
4. The connection self-heals (reconnects, recovers missed messages)
5. The full conversation persists across app restarts (SQLite)
6. Context about what the user is viewing is automatically injected into messages

This is significantly more complex than a typical chat UI because:
- OpenClaw agents can run for **minutes** (not seconds) — tool use, code execution, multi-step reasoning
- The WebSocket connection can drop mid-response and needs to recover without losing content
- The server can send events for **other sessions/processes** that shouldn't affect the current chat
- Content arrives as incremental deltas that need to be stitched into coherent messages
- The same message can appear via streaming AND via history recovery, requiring dedup

---

## 3. Root Cause Analysis — Why Bugs Keep Recurring

Git log shows 20+ commits specifically fixing chat bugs over the project's lifetime. The bugs cluster around three architectural root causes:

### Root Cause 1: `gateway.ts` Is a 3,008-Line God Module

This single file handles:
- Transport selection logic (which of 4 send modes to use)
- WebSocket connection lifecycle management
- RPC request/response framing
- Server event subscription and routing
- Turn (send lifecycle) state management
- Message history extraction and normalization
- Message deduplication (one of 4+ layers)
- Activity state detection (idle/working/typing)
- Recovery/reconciliation after reconnection
- Process polling for completion detection
- Content block stitching for multi-tool responses
- Context wrapping for user messages
- Timeout management
- Error classification and retry logic

**Impact**: Every change risks unintended interaction with other concerns. A fix to activity detection can break turn management. A fix to dedup can cause message drops in recovery. The cognitive load of holding ~3,000 lines in mind makes confident changes nearly impossible.

**Evidence from git log**:
- Multiple commits fix "stuck working animation" — unscoped agent events from other sessions triggered activity state
- Multiple commits fix "duplicate messages" — different dedup layers interact unpredictably
- Multiple commits fix "premature completion" — empty/spurious `final` events misinterpreted

### Root Cause 2: `sendViaTauriWs` Is ~700 Lines with 20+ Boolean Flags

The primary send function (`sendViaTauriWs` in gateway.ts) manages the entire send-stream-settle-complete lifecycle through a collection of boolean flags rather than an explicit state machine. Identified flags include:

```
gotFirstDelta, gotFinal, doneViaProcessPoll, didRecoverHistory,
isAborted, needsSettlePass, settlePassComplete, hasPendingToolUse,
wasInterrupted, didTimeout, isRetrying, gotEmptyFinal,
hasStreamContent, didReceiveError, isWaitingForProcess,
recoveryAttempted, historyReconciled, ...
```

**Impact**: These flags interact combinatorially. The function has to handle every possible ordering of: first delta, empty delta, tool use block, content restart, final event, empty final, error event, abort, timeout, process poll result, keepalive failure, WebSocket close, reconnection — all while maintaining UI consistency. The number of possible states is exponential in the number of flags, but only a handful of paths are tested.

**Evidence from git log**:
- Commits adding "guard against empty final when we already have content"
- Commits adding "don't finalize if process poll says still running"
- Commits adding "handle content block restart after tool use"
- Each fix adds more flags/conditions rather than simplifying the state space

### Root Cause 3: Message Deduplication Happens at 4+ Competing Layers

Messages are deduplicated at these independent layers:

1. **Store-level** (`addChatMessage` in store.ts): Checks by message ID and by content+timestamp proximity
2. **Store-level collapse** (`collapseChatDuplicates` in store.ts): Progressive prefix matching within 10-minute windows, collapses trailing assistant runs
3. **Display-level** (`displayMessages` memo in ChatShell.tsx): Merges streaming content with persisted messages, suppresses duplicates during streaming overlay
4. **Recovery reconciliation** (`recoverRecentSessionMessages` / `reconcileRecentHistory` in App.tsx + gateway.ts): Backfills from gateway history, attempts to merge with existing messages

**Impact**: Each layer has different rules for what constitutes a "duplicate." When a message passes through multiple layers, the interactions are unpredictable:
- Layer 1 might accept a message, but layer 2 collapses it with a neighbor
- Layer 3 might show streaming content, then layer 4 adds the same content from recovery
- Layer 2's prefix matching can incorrectly merge distinct messages that happen to start similarly
- Fixing a duplicate in one layer can cause a drop in another

**Evidence from git log**:
- Repeated commits adjusting dedup thresholds and matching logic
- Commits specifically named "fix recovery creating duplicate bubbles"
- Commits fixing "context-wrapped user messages showing raw prefix text" (normalization layer not applied consistently)

---

## 4. Additional Architectural Concerns

### 4a. Event Scoping

The WebSocket event subscription receives ALL events from the gateway, including events for other sessions and background processes. The current code filters by `sessionKey` and `runId`, but this filtering is scattered throughout the event handling code rather than centralized. Unscoped events have caused:
- Stuck "working" animation when a background session's agent is active
- Premature completion when another session's `final` event arrives

### 4b. Completion Detection Is Heuristic

There is no single authoritative signal for "the agent is done responding." Instead, the code uses a combination of:
- `final` event (but can be empty/spurious)
- `process.poll` RPC (but adds latency and can race with late events)
- Timeout (300s, but some agent runs are legitimately long)
- Heuristic "settle pass" that checks for unclosed code fences, trailing punctuation
- Absence of new deltas for N seconds

This multi-signal approach means completion detection is inherently probabilistic, leading to either premature finalization (cuts off content) or stuck "working" state (user waits forever).

### 4c. Turn State Leaks

`PendingTurn` records track the send lifecycle but can get stuck in intermediate states (`running`, `awaiting_output`) if the finalization code path is skipped due to an unexpected event ordering. Stuck turns cause:
- The message queue to stall (next message waits for previous turn to complete)
- Activity indicator to show "working" indefinitely
- Retry logic to not trigger (it checks turn state)

### 4d. Recovery Can Fight Streaming

When a WebSocket drops mid-stream and reconnects, the recovery system fetches full history from the gateway and attempts to reconcile with what's already displayed. But if streaming was partially shown, the reconciliation has to figure out which streamed content maps to which history entry. This is a fundamentally hard problem with the current architecture because:
- Streaming content is accumulated in a local ref (`streamingContent`), not persisted until `final`
- History entries have different IDs than the streaming run
- Content may be truncated differently (streaming shows raw deltas, history shows processed final)

---

## 5. Is the Current Approach Optimal?

**No.** The current architecture has grown organically to handle increasingly complex edge cases, but each fix adds complexity without simplifying the overall design. The result is a system that is:

- **Fragile**: Changes in one area create regressions in others
- **Opaque**: The actual state of the system at any moment requires reasoning about 20+ flags
- **Untestable**: The 700-line send function can't be unit tested because it mixes transport, state, UI updates, and persistence
- **Hard to debug**: When a bug occurs, it's unclear which of the 4 dedup layers, which event ordering, or which flag combination caused it

The fundamental insight is that this is a **distributed systems problem** (client + gateway + agent process) being solved with **single-threaded procedural code**. The correct architectural pattern is an explicit state machine with well-defined transitions.

---

## 6. Recommended Architecture

### 6a. Module Decomposition

Break `gateway.ts` (~3,008 lines) into focused modules:

```
src/lib/chat/
  transport.ts        — Transport selection, WS/HTTP send primitives
  turn-machine.ts     — State machine for send lifecycle (see 6b)
  event-router.ts     — Subscribe to WS events, filter by session/run, dispatch
  history.ts          — Fetch, extract, normalize gateway history
  dedup.ts            — Single canonical dedup layer (see 6c)
  activity.ts         — Derive idle/working/typing from turn state
  recovery.ts         — Reconnection recovery, history reconciliation
  context.ts          — User message context wrapping/unwrapping
  types.ts            — Shared types (move from components/chat/types.ts)
```

Each module has a single responsibility, clear inputs/outputs, and can be tested independently.

### 6b. Explicit State Machine for Send Lifecycle

Replace the 20+ boolean flags with a typed state machine:

```typescript
type TurnState =
  | { phase: 'idle' }
  | { phase: 'sending'; messageId: string; sentAt: number }
  | { phase: 'streaming'; runId: string; content: string; lastDeltaAt: number }
  | { phase: 'settling'; content: string; settleStartAt: number }
  | { phase: 'complete'; content: string; finalizedAt: number }
  | { phase: 'error'; error: string; partialContent?: string }
  | { phase: 'aborted'; reason: string; partialContent?: string };

// Transitions are explicit and exhaustive
function transition(state: TurnState, event: TurnEvent): TurnState {
  switch (state.phase) {
    case 'sending':
      switch (event.type) {
        case 'first_delta': return { phase: 'streaming', ... };
        case 'error': return { phase: 'error', ... };
        case 'timeout': return { phase: 'error', error: 'send timeout' };
        // Every other event type is explicitly handled or ignored
      }
    case 'streaming':
      switch (event.type) {
        case 'delta': return { ...state, content: state.content + event.text };
        case 'final': return { phase: 'settling', ... };
        case 'error': return { phase: 'error', ... };
        case 'ws_close': return { phase: 'error', error: 'connection lost', partialContent: state.content };
        // ...
      }
    // ...
  }
}
```

**Benefits**:
- Every possible state is enumerable and inspectable
- Invalid transitions are compile-time errors
- The current state is always a single value, not a combination of 20 flags
- Testing is straightforward: feed events, assert state transitions
- Debugging is trivial: log state transitions, not flag changes

### 6c. Single Dedup Layer

Consolidate the 4 dedup layers into one canonical layer in `dedup.ts`:

```typescript
interface MessageStore {
  // Returns true if message was added (not a duplicate)
  addIfNew(msg: ChatMessage): boolean;

  // Merge streaming content with final persisted message
  finalizeStreaming(runId: string, finalContent: string): void;

  // Reconcile history batch (e.g., after recovery)
  reconcileHistory(history: ChatMessage[]): { added: ChatMessage[]; updated: ChatMessage[] };
}
```

Rules:
- Messages are identified by `(runId, role, contentHash)` tuple
- Streaming content is tracked by `runId` and merged on finalization
- History reconciliation uses `runId` matching first, content similarity second
- One layer, one set of rules, one place to fix bugs

### 6d. Server-Side Completion Authority

Instead of heuristic completion detection, use `process.poll` as the **authoritative** signal:

```typescript
// After receiving a 'final' event, confirm with process.poll
async function confirmCompletion(runId: string): Promise<boolean> {
  const status = await connection.request('process.poll', { runId });
  return status.state === 'completed' || status.state === 'idle';
}
```

- `final` event = "stop streaming, show content"
- `process.poll` = "agent is actually done"
- If `final` arrives but `process.poll` says still running → stay in 'streaming', poll again
- If `process.poll` says done but no `final` → force finalize with current content

This eliminates the "settle pass" heuristic and the guessing around empty finals.

---

## 7. OpenClaw Gateway Protocol Reference

Based on review of the running instance at `~/.openclaw/` and integration code:

### Connection

- **Address**: `ws://127.0.0.1:18789` (local gateway, port from `openclaw.json`)
- **Auth**: Bearer token from `openclaw.json` → `gateway.auth.token`
- **Protocol version**: 3 (both min and max)
- **Allowed origins**: `http://localhost:1420`, `tauri://localhost`

### RPC Methods

| Method | Purpose | Key Params |
|--------|---------|------------|
| `connect` | Authenticate + establish session | `minProtocol`, `maxProtocol`, `auth.token`, `role`, `scopes` |
| `chat.send` | Send user message | `sessionKey`, `message`, `deliver`, `idempotencyKey` |
| `chat.history` | Fetch conversation history | `sessionKey`, `limit` |
| `process.poll` | Check agent process status | `sessionKey` or `runId` |

### Event Types

| Event | Payload | States |
|-------|---------|--------|
| `chat` | `{ runId, state, message, errorMessage }` | `delta`, `final`, `error`, `aborted` |
| `agent` | `{ action, ... }` | Various agent lifecycle events |
| `connect.challenge` | Auth challenge data | — |

### Message Format

```json
// Client → Server (RPC request)
{ "type": "req", "id": "req-1-1708300000", "method": "chat.send", "params": { ... } }

// Server → Client (RPC response)
{ "type": "res", "id": "req-1-1708300000", "result": { ... } }

// Server → Client (Event)
{ "type": "event", "event": "chat", "payload": { "runId": "...", "state": "delta", "message": { ... } } }

// Server → Client (Error)
{ "type": "err", "id": "req-1-1708300000", "error": { "message": "..." } }
```

---

## 8. Pragmatic Next Steps (If Full Rewrite Is Not Feasible)

If a full restructure isn't practical right now, these targeted changes would address the highest-impact issues:

### Step 1: Extract Turn State Machine (Highest Impact)

Extract the send lifecycle from `sendViaTauriWs` into a standalone `TurnStateMachine` class. This doesn't require changing any other code — just wrapping the existing flag logic in a class with explicit state transitions. The 700-line function becomes:

```typescript
const turn = new TurnStateMachine(runId);
turn.onTransition((from, to) => { /* update UI, log */ });

// In event handler:
turn.handleEvent({ type: 'delta', content: '...' });
// turn.state is now { phase: 'streaming', ... }
```

### Step 2: Centralize Event Filtering

Add a single `EventRouter` that filters all incoming events by `sessionKey` and `runId` before dispatching. This eliminates the scattered filtering logic and prevents unscoped events from affecting the wrong chat.

### Step 3: Merge Dedup Layers

Keep the store-level `addChatMessage` dedup but remove the display-level and recovery-level dedup. Instead, make `addChatMessage` the single source of truth and have display always render what's in the store (plus active streaming overlay).

### Step 4: Use `process.poll` as Completion Authority

After any `final` event, confirm with `process.poll` before finalizing the turn. This is a ~20 line change that eliminates the settle pass heuristic.

---

## 9. Risk Assessment

| Risk | Current | After Recommended Changes |
|------|---------|--------------------------|
| Message drops | Medium-High (dedup layer conflicts) | Low (single dedup layer) |
| Duplicate messages | Medium (4 competing layers) | Low (single layer) |
| Stuck activity state | Medium (unscoped events + flag leaks) | Low (state machine + event routing) |
| Premature completion | Medium (heuristic detection) | Low (server-side authority) |
| Recovery data loss | Medium (streaming/history conflict) | Low (runId-based reconciliation) |
| Regression from fixes | High (god module coupling) | Low (module isolation) |

---

## 10. Summary

The Pipeline Dashboard chat integration is **feature-complete and ambitious** — it handles streaming, recovery, persistence, context injection, multi-transport, and queue management. The engineering effort is substantial and the feature set is exactly right for the use case.

However, the architecture has reached a complexity ceiling where **the cost of each bug fix exceeds the cost of structural improvement**. The three root causes (god module, flag-based state, competing dedup) create a combinatorial explosion of edge cases that procedural patches can't sustainably address.

The recommended path is:
1. **Short-term**: Extract turn state machine + centralize event filtering (2 targeted changes, biggest bang for buck)
2. **Medium-term**: Consolidate dedup, use process.poll as completion authority
3. **Long-term**: Full module decomposition of gateway.ts

Each step is independently valuable and can be done incrementally without a risky big-bang rewrite.
