# Chat Reliability Scenario Matrix

> Deterministic reproduction and validation matrix for chat send/stream/recovery reliability.

## Summary

This matrix defines repeatable scenarios for validating chat reliability behavior in Clawchestra. It is designed to verify that each send reaches a deterministic terminal state, that activity indicators are trustworthy, and that recovery logic is idempotent during reconnects and long-running tool-use turns.

---

**Roadmap Item:** `chat-infrastructure`
**Status:** Ready
**Created:** 2026-02-19
**Last Updated:** 2026-02-24

---

## Preconditions

1. Run Clawchestra in Tauri runtime with `tauri-ws` transport enabled.
2. Open OpenClaw Gateway dashboard side-by-side for cross-verification.
3. Clear old noise where practical (restart gateway session or start a fresh thread).
4. Capture browser console logs during each run.

## Scenario Matrix

### Scenario 1: Mid-run WebSocket close

Goal: prove send lifecycle recovers deterministically after disconnect.

Steps:
1. Send a prompt expected to trigger long tool-use work.
2. While run is active, interrupt websocket connectivity (gateway restart or transport interruption).
3. Wait for reconnect and observe whether activity indicator resumes and terminal output appears.

Expected:
1. No silent drop: turn ends with output or explicit failure bubble.
2. Terminal reason code emitted exactly once.
3. No duplicate assistant bubbles from reconnect recovery.

### Scenario 2: No-final with ongoing tool activity

Goal: validate no-final fallback without premature truncation.

Steps:
1. Trigger a run with long tool calls and delayed text output.
2. Observe behavior when no `chat.final` appears promptly.
3. Let no-final polling path settle or force-resolve window elapse.

Expected:
1. Activity remains truthful while work is active.
2. If `process.poll` is unavailable by scope, fallback remains bounded and deterministic.
3. Output is not prematurely finalized while run evidence remains active.

### Scenario 3: Recovery after reconnect

Goal: validate idempotent history reconciliation.

Steps:
1. Start a run and allow partial streaming content to appear.
2. Disconnect/reconnect transport mid-stream.
3. Allow recovery/backfill to run.

Expected:
1. No duplicate user bubble from context wrapping.
2. No duplicate assistant bubble from stream+recovery overlap.
3. Recovery bubble appears at most once per recovery signature window.

### Scenario 4: Long sub-agent run with delayed content

Goal: validate stale activity prevention and eventual terminal state.

Steps:
1. Trigger a workflow known to spawn sub-agents and long background activity.
2. Observe chat activity indicator through low-output intervals.
3. Wait for terminal condition.

Expected:
1. Activity does not drop to idle while active evidence exists.
2. After true completion, activity clears within <= 10 seconds.
3. Queue behavior remains FIFO and unblocked when prior turn is terminal.

### Scenario 5: Unacked send fallback

Goal: validate behavior when `chat.send` ack is not received.

Steps:
1. Trigger an induced send failure path (connection drop around send).
2. Observe acceptance probing and fallback logic.

Expected:
1. If accepted user turn is found in history, run continues.
2. If acceptance cannot be proven within bounded window, explicit failure bubble appears.
3. No silent pending state.

### Scenario 6: Queued send auto-retry

Goal: validate one-shot queue retry semantics and deterministic failure surfacing.

Steps:
1. Queue at least one message while an active run is in progress.
2. Induce transient dispatch failure on first queued attempt.
3. Observe retry behavior and final queue state.

Expected:
1. First queued failure triggers exactly one automatic retry.
2. Retry uses the same idempotency key as the first attempt.
3. If retry fails, user gets explicit failure notification and queue unblocks.

### Scenario 7: Legacy pending-turn hydration migration

Goal: ensure startup hydration cannot leave phantom-active blockers.

Steps:
1. Seed pending turn records with legacy/unknown statuses.
2. Launch app and allow hydration path to run.
3. Observe active turn count and queue behavior.

Expected:
1. Deterministic legacy status mapping to active states when valid.
2. Incompatible records terminalized and removed from active blockers.
3. App reports concise recovery notice and remains send-capable.

### Scenario 8: Runtime model/provider truth

Goal: validate badge truth under fallback and missing run metadata.

Steps:
1. Run a turn where provider/model fallback occurs.
2. Run a turn where runtime model metadata is sparse/missing.
3. Observe badge updates during and after send.

Expected:
1. Run-level truth is reflected when available.
2. Snapshot fallback updates truth when exact session data is available.
3. If neither is available, badge does not show stale configured model.

## Required Log Artifacts

Capture at minimum:
1. `sendId`
2. `runId`
3. `sessionKey`
4. terminal reason code
5. `process.poll` capability reason transitions (if encountered)
6. runtime model/provider source (`run` or `session`, when available)

## Pass/Fail Gates

1. 100% of matrix runs produce exactly one terminal reason code.
2. 0 duplicate user bubbles caused by context wrapping.
3. 0 duplicate assistant bubbles from stream/recovery overlap.
4. Activity clears within <= 10 seconds after verified terminal completion with no active sessions.
5. FIFO queue ordering preserved in queued-message tests.
6. 0 queue stalls after retry-exhausted queued sends.
7. 0 startup phantom-active blockers from legacy pending turns.
8. 0 stale-config model badges shown as active truth in fallback tests.

## Notes for Regression Tracking

For each scenario run, record:
1. build commit
2. scenario id
3. pass/fail
4. observed reason code
5. user-visible anomalies (if any)

Use this data for before/after comparison across reliability iterations.

## Validation Run (Cycle 2)

Automated gates executed on 2026-02-19:

1. `pnpm -s typecheck` — pass
2. `bun test src/lib/gateway.test.ts src/lib/chat-turn-engine.test.ts src/lib/chat-message-identity.test.ts src/lib/chat-normalization.test.ts` — pass (46 tests)
3. `pnpm -s build` — pass

Manual scenario validation for Scenarios 1-8 remains a runtime verification step in Clawchestra + OpenClaw dashboard.

## Validation Run (Cycle 3)

Automated gates executed on 2026-02-24:

1. `bun test src/lib/gateway.test.ts src/lib/store.test.ts src/App.test.tsx` — pass
2. `bun test` — pass
3. `npx tsc --noEmit` — pass
4. `pnpm build` — pass
5. `cargo check` (from `src-tauri/`) — pass

Manual scenario validation for Scenarios 1-8 remains required.
