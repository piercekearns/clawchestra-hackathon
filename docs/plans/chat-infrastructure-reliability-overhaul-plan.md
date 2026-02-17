# Chat Infrastructure Reliability Overhaul: Implementation Plan

> Consolidate patchwork chat fixes into one deterministic send/stream/persist/reconnect architecture for OpenClaw in Pipeline Dashboard.

---

**Roadmap Item:** `chat-infrastructure`  
**Status:** Draft  
**Created:** 2026-02-17  
**Focus:** End-to-end OpenClaw WebSocket reliability, completion semantics, history integrity, and reconnect recovery

---

## Summary

Recent fixes improved individual failures but left mixed completion logic across transport events, polling fallbacks, and local persistence. The result is intermittent "gateway error", dropped assistant replies, and false "no response received" states during long tool-heavy runs.

This plan replaces heuristic completion with a run-scoped state machine, adds durable reconciliation on restart/reconnect, hardens connection behavior for idle `1006` drops, and introduces deterministic tests so regressions are caught before shipping.

## Problems To Solve

1. Send completion can resolve on the wrong or premature terminal signal.
2. Tool-heavy runs can be marked failed before textual output arrives.
3. Restart/reconnect loses in-flight context because no session backfill occurs.
4. History stitching relies on fragile content matching and lossy dedupe keys.
5. Idle websocket drops (`1006`) surface as user-visible instability.
6. Current coverage is insufficient for run lifecycle edge cases.

## Success Criteria

1. A send resolves only for its own run and only after valid completion conditions.
2. Tool-only interim frames never trigger false final failure.
3. Restarting during an active run recovers final assistant output from OpenClaw history.
4. No message loss from pagination/dedupe across load more and reconnect paths.
5. Idle websocket interruptions auto-recover without losing user turn state.
6. Automated tests cover terminal, reconnect, and late-output scenarios.

## Non-Goals

1. Redesigning the visual chat UI beyond reliability-related feedback.
2. Changing OpenClaw gateway protocol semantics.
3. Building advanced analytics dashboards before core reliability is stable.

## Target Architecture

### A. Run-Scoped Send Lifecycle

Introduce a strict run lifecycle in `gateway.ts` keyed by `{sessionKey, runId|turnToken}`.

States:

1. `queued`
2. `awaiting-run`
3. `running`
4. `tooling`
5. `awaiting-text`
6. `completed`
7. `failed`
8. `timed_out`

Rules:

1. Never complete on `final` alone.
2. Require run ownership and terminal guard conditions.
3. Treat tool events as progress, not completion.
4. Use a quiet window only after terminal + candidate output.

### B. Deterministic Completion Contract

A turn is complete only when one of these is true:

1. A terminal event for the same run is observed and assistant content exists for that run.
2. A terminal event is observed and history backfill confirms assistant content after the user turn.
3. Hard timeout reached with explicit recoverable error metadata.

### C. Reconciliation As First-Class Path

On app startup and reconnect:

1. Pull recent OpenClaw session history for active session key.
2. Reconcile local pending turns by runId/turnToken.
3. Persist recovered assistant messages into local chat DB.

### D. Transport Resilience

1. Add keepalive strategy for idle periods.
2. Preserve send queue and pending turn map across reconnect attempts.
3. Distinguish connection status from send status in UI state.

### E. Persistence Integrity

1. Replace substring user message matching with stable turn identity.
2. Replace lossy dedupe keys with `{id}` or `{timestamp,id}` tuple cursor semantics.
3. Prevent pagination duplicates at DB query boundary.

## Workstreams

### WS1: Completion Engine Rewrite

Files:

1. `src/lib/gateway.ts`
2. `src/lib/tauri-websocket.ts`

Tasks:

1. Add `turnToken` generated client-side per send.
2. Track run ownership map from initial send through terminal events.
3. Replace `final` debounce resolver with state machine reducer.
4. Gate resolution on run ownership + output confirmation.
5. Preserve informative intermediate state transitions for UI.

Acceptance:

1. No send resolves on unrelated terminal events.
2. Tool-only runs do not resolve empty unless true timeout/error.

### WS2: History Reconstruction And Backfill

Files:

1. `src/lib/gateway.ts`
2. `src/lib/store.ts`
3. `src-tauri/src/lib.rs`

Tasks:

1. Remove content-substring lookup for user/assistant pairing.
2. Attach and persist turn metadata (`turnToken`, `runId`, `sessionKey`) where available.
3. Add gateway history backfill API path in startup/reconnect flow.
4. Update DB pagination cursor to deterministic boundary (`timestamp,id`) instead of `<= timestamp`.
5. Align frontend dedupe to stable message identity.

Acceptance:

1. Reload/reconnect after active run restores missing assistant output.
2. Load-more does not duplicate or silently drop valid messages.

### WS3: WebSocket Reliability And Idle Drop Handling

Files:

1. `src/lib/tauri-websocket.ts`
2. `src/lib/gateway.ts`
3. `src/components/chat/ChatShell.tsx`

Tasks:

1. Add keepalive ping/pong schedule suitable for Tauri websocket behavior.
2. Separate websocket state machine from turn processing state machine.
3. Ensure reconnect does not clear pending turn context.
4. Improve gateway error surfacing: non-blocking toast + recovery messaging.
5. Keep transport error UI independent from turn lifecycle state.

Acceptance:

1. Idle `1006` disconnect auto-recovers without dropping in-flight turn state.
2. User does not see false hard failures when reconnect succeeds.

### WS4: Observability And Debuggability

Files:

1. `src/lib/gateway.ts`
2. `src/lib/tauri-websocket.ts`
3. `src/lib/store.ts`

Tasks:

1. Add structured logs with turnToken/runId/sessionKey correlation.
2. Add explicit reason codes for completion path selection.
3. Record reconciliation actions and recovered message counts.
4. Add lightweight diagnostics panel payload (dev-only) for active/pending turns.

Acceptance:

1. Every failed send has a traceable terminal reason in logs.
2. "No assistant response" errors include actionable subtype.

### WS5: Test Harness And Regression Coverage

Files:

1. `src/lib/gateway.test.ts` (or create if missing)
2. `src/lib/store.test.ts`
3. `src/lib/tauri-websocket.test.ts`

Scenarios:

1. Terminal before textual output, then delayed assistant text.
2. Multiple concurrent events with missing runId.
3. Reconnect during active run with eventual successful completion.
4. Idle disconnect/reconnect while pending queue exists.
5. Pagination boundary duplicates and dedupe correctness.
6. Restart and backfill reconciliation.

Acceptance:

1. All reliability-critical scenarios are deterministic and green in CI/local.
2. Regressions in completion logic fail tests immediately.

## Implementation Sequence

1. WS1 completion state machine
2. WS2 identity + backfill + cursor fixes
3. WS3 keepalive + reconnect resilience
4. WS4 observability improvements
5. WS5 full regression harness

Rationale:

1. Correct completion semantics first to stop false failures.
2. Then fix persistence/recovery so failures are recoverable.
3. Then harden transport and improve diagnostics.
4. Finally lock behavior with tests.

## Rollout Strategy

1. Ship behind a `chatReliabilityV2` feature flag in app config.
2. Run dual-path logging in dev: legacy completion vs V2 decision (no dual-send).
3. Validate against real OpenClaw sessions before defaulting on.
4. Remove legacy completion path after one stable cycle.

## Risks And Mitigations

1. Risk: state machine complexity increases maintenance burden.
   Mitigation: pure reducer + explicit transition table + tests per transition.
2. Risk: gateway events may still omit `runId`.
   Mitigation: `turnToken` fallback and strict ownership heuristics.
3. Risk: reconciliation could duplicate messages.
   Mitigation: stable IDs and DB-level uniqueness where possible.
4. Risk: keepalive interval could be too aggressive.
   Mitigation: tune interval and backoff with config constants.

## Plan Review Prompts

Use these checks during `/plan_review`:

1. Is the completion contract strict enough to avoid premature resolve but permissive enough for missing runId cases?
2. Are WS and send lifecycle concerns cleanly separated?
3. Is the persistence identity model sufficient to eliminate substring matching?
4. Is rollout safe with feature-flagged fallback and measurable success metrics?
5. Are any gateway/Tauri protocol changes required that this repo cannot implement alone?

---

This plan is the consolidation point for all current OpenClaw chat reliability findings. Build work should execute against this document, not ad hoc patches.
