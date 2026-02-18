# Chat Infrastructure Phase C: Live Run Lifecycle Reliability Plan

## Context

Phase A and Phase B improved connection handling and chat UI signaling, but the core user-visible reliability failures still occur under real tool-heavy runs:

1. Activity animation drops while OpenClaw is still actively running.
2. Final assistant outputs can exist in gateway history/dashboard but never surface in the app chat.
3. `NO_REPLY`/gateway error can surface even when the run actually completed.
4. Reconnect/restart recovery is inconsistent and often late.

The current implementation still relies on per-send listeners and mixed completion heuristics in `src/lib/gateway.ts`, while UI activity is partly driven by local send state in `src/App.tsx`.

## Goal

Make chat turn lifecycle deterministic so users always get:

1. Accurate "still running vs done" state.
2. Final assistant output without manual refresh/restart.
3. Reliable recovery across websocket reconnects and app restarts.

## Non-Goals

1. Rebuilding chat UI visuals beyond reliability/status correctness.
2. Changing OpenClaw gateway protocol semantics.
3. Removing existing system bubbles unless they conflict with reliability logic.

## Architecture Direction

### 1) Turn Registry (Source of Truth)

Introduce a first-class in-app turn registry keyed by `turnToken` (client-generated per user send), with optional `runId` once known.

Each turn tracks:

1. `turnToken`
2. `sessionKey`
3. `runId` (nullable)
4. `status` (`queued`, `running`, `awaiting_output`, `completed`, `failed`, `timed_out`)
5. `submittedAt`, `lastSignalAt`, `completedAt`
6. `hasAssistantOutput`
7. `completionReason` (enum for diagnostics)

### 2) Persistent Event Ingest (Not Per-Send Only)

Replace "single send owns listener lifecycle" with a durable event ingest path:

1. One global subscription for `chat` + `agent` events.
2. Events normalized into reducer actions.
3. Reducer updates turn registry and message-store consistently.
4. Sends attach to existing registry rather than creating fragile local-only state.

### 3) Concurrency and Ownership Contract (Locked)

To prevent ambiguous completion/mis-association:

1. Enforce one active `running|awaiting_output` turn per `sessionKey`.
2. Additional user sends for that session remain FIFO in `queued`.
3. Event ownership precedence is fixed:
   1. `runId` exact match
   2. `turnToken` exact match
   3. strict fallback only when exactly one unresolved turn exists for the session
4. If fallback is ambiguous, do not resolve or fail the turn from live events; mark event as `ambiguous_unowned_event` and rely on backfill correlation.

### 4) Active Backfill Worker

For any non-terminal turn, run a backfill loop against `chat.history`:

1. Poll while unresolved turns exist (locked cadence + jitter).
2. Correlate messages by `turnToken`/`runId` and strict temporal boundaries.
3. Resolve late/missed final outputs even when terminal event was missed.
4. On reconnect/startup, immediately backfill unresolved turns before declaring idle.

Cadence policy:

1. 0s-30s since submit: poll every 1s.
2. 30s-120s: poll every 2s.
3. 2m-10m: poll every 5s.
4. 10m+: poll every 15s (max).
5. Add +/-20% jitter to avoid synchronized bursts.

### 5) Strict Completion Contract

A turn is complete only when:

1. Terminal signal is observed for the same turn and assistant output is present, or
2. Backfill confirms assistant output and no newer activity remains for that turn, or
3. Hard timeout is reached and a structured failure reason is recorded.

`final` without output is never sufficient on its own.

### 6) Activity State From Registry, Not From Send Promise

UI `Thinking/Working` state becomes:

1. `working` if any turn is `queued|running|awaiting_output` or recovery/backfill is active.
2. `idle` only when no active turns remain and no reconnect-recovery pass is pending.

This removes dependence on local `finally` paths that can flip idle prematurely.

## Build Order

### Step 1: Introduce Turn Registry + Types

Files:

1. `src/lib/gateway.ts`
2. `src/lib/store.ts`
3. `src-tauri/src/lib.rs`

Changes:

1. Add `TurnStatus`, `CompletionReason`, and `PendingTurn` types.
2. Add registry map and reducer helpers.
3. Generate `turnToken` per send before dispatch.
4. Persist `turnToken`/`runId` metadata with stored messages.
5. Add durable pending-turn ledger in SQLite (for crash/restart recovery), including:
   1. `turnToken` (unique)
   2. `sessionKey`
   3. `runId` (nullable)
   4. `status`
   5. `submittedAt`, `lastSignalAt`, `completedAt`
   6. `completionReason` (nullable)

Acceptance:

1. Every user send has a stable `turnToken`.
2. Pending turns survive restart/crash via ledger replay.
3. Registry remains coherent across temporary connection drops.

### Step 2: Replace Per-Send Completion Heuristics With Reducer-Driven Lifecycle

Files:

1. `src/lib/gateway.ts`

Changes:

1. Move event handling into centralized reducer path.
2. Remove/disable completion paths that can resolve unrelated `final` events.
3. Gate terminal transition by turn ownership precedence:
   1. `runId` exact match
   2. `turnToken` exact match
   3. strict fallback only when unambiguous single unresolved turn exists
4. Add reason-coded completion/failure transitions.
5. Treat ambiguous ownership as non-terminal and defer to backfill.

Acceptance:

1. No turn resolves from unrelated terminal events.
2. No empty completion when later assistant text arrives for same run.

### Step 3: Add Active Backfill Worker for Unresolved Turns

Files:

1. `src/lib/gateway.ts`

Changes:

1. Maintain unresolved-turn set.
2. Poll `chat.history` while unresolved set is non-empty.
3. Reconcile assistant outputs missed by event stream.
4. Stop polling only when unresolved set is empty.
5. Use locked polling cadence and jitter policy.

Acceptance:

1. If gateway dashboard has final output, app chat eventually shows it without restart.
2. `NO_REPLY` only emitted after true timeout boundary.

### Step 4: Reconnect/Startup Recovery Pipeline

Files:

1. `src/lib/tauri-websocket.ts`
2. `src/lib/gateway.ts`
3. `src/App.tsx`
4. `src-tauri/src/lib.rs`

Changes:

1. On reconnect success, trigger reconciliation pass for unresolved turns.
2. On app startup, replay pending-turn ledger and reconcile unresolved state before showing idle.
3. Keep activity indicator alive during reconnect recovery.

Acceptance:

1. Temporary websocket drop (`1006` or equivalent) does not lose pending turn context.
2. Recovery path updates chat without requiring manual refresh.
3. Restart during active run recovers outstanding turns and final output.

### Step 5: Tighten Message Persistence Correlation

Files:

1. `src/lib/store.ts`
2. `src-tauri/src/lib.rs`

Changes:

1. Remove substring-based user/assistant pairing from live resolution paths.
2. Use metadata identity (`turnToken`/`runId`/stable id) for reconciliation.
3. Ensure load-more dedupe does not drop valid messages with similar prefixes.
4. Implement deterministic pagination boundary (`timestamp,id`) and matching query semantics.

Acceptance:

1. No assistant message loss due to content-prefix collisions.
2. Reload/load-more behavior is stable and idempotent.
3. No duplicate boundary rows across pagination pages.

### Step 6: Instrumentation + Regression Tests

Files:

1. `src/lib/gateway.test.ts` (create/expand)
2. `src/lib/tauri-websocket.test.ts` (create/expand)
3. `src/lib/store.test.ts` (create/expand)

Scenarios:

1. Long-running tool chain where terminal arrives before final text.
2. Missing `runId` events with valid later output.
3. Reconnect during active run with final output after reconnect.
4. `NO_REPLY` suppression while run remains active in history.
5. Fast short replies should clear working state quickly.
6. Ambiguous unowned events never close the wrong turn.
7. Crash/restart during active run recovers pending turn and final output.

Acceptance:

1. User-reported failure pattern is reproducible in tests and then green.
2. No regression in normal quick-turn responses.

## Rollout and Safety

1. Introduce `chatLifecycleV3` feature flag (default off initially).
2. Ship single-path V3 implementation behind flag (no long-lived dual decision engine).
3. Validate on internal/dev sessions with structured lifecycle reason logs.
4. Enable by default after validation checklist passes.
5. Keep fast rollback switch for one release cycle.

## Timeout Policy (Locked Defaults)

1. `NO_EVENTS_AFTER_SEND`: hard timeout at 180s (reason: `timeout_no_events`).
2. `EVENTS_ACTIVE_NO_FINAL`: hard timeout at 12m total turn age (reason: `timeout_active_no_final`).
3. `FINAL_WITHOUT_OUTPUT`: wait up to 25s of backfill before fail (reason: `timeout_final_without_output`).
4. If any new signal/output arrives, reset relevant soft timers and continue.
5. Timeouts must include reason code + timestamps in logs and stored turn metadata.

## Validation Checklist (Manual)

1. Start a long OpenClaw tool-heavy task from chat.
2. Confirm `Working...` remains until turn truly resolves.
3. Observe final message appears in app without refresh/restart.
4. Force temporary gateway disconnect and verify recovery resumes same turn.
5. Confirm no duplicate or missing messages after restart + recovery bubble.

## Open Questions for Plan Review

1. Is a dedicated "recovering" activity label useful, or should it remain under `Working...`?
2. Should the unresolved-turn ledger have a retention cap (for example, prune terminal rows older than 7 days)?
