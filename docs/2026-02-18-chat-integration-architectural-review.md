# Chat Integration Reliability Plan (Clawchestra)

> Practical, staged plan to eliminate dropped/duplicate/stale chat behavior and restore trust in chat state.

## Summary

This document converts the prior architecture review into an execution plan with corrected assumptions and objective release gates. The core diagnosis still holds: reliability issues come from lifecycle complexity, scattered event filtering, and overlapping dedupe/recovery paths. The implementation below prioritizes deterministic turn state, scoped event handling, single-source message identity, explicit failure behavior, and measurable pass/fail criteria.

---

**Roadmap Item:** `chat-integration-reliability`
**Status:** Ready
**Created:** 2026-02-19
**Last Updated:** 2026-02-19

---

## Corrected Findings Baseline

### Confirmed

1. `src/lib/gateway.ts` is an overgrown integration surface and a regression hotspot.
2. `sendViaTauriWs` contains high lifecycle complexity and too many interacting conditions.
3. Message duplication/drop risk is amplified by multiple dedupe/reconciliation layers.
4. Event scoping and lifecycle finalization remain the highest-impact reliability concerns.

### Corrected from prior review

1. Primary runtime transport is `tauri-ws`, not `tauri-openclaw`.
2. `process.poll` cannot be treated as authoritative today because scope/capability is not guaranteed for all sessions.
3. Current testability is limited but not absent; gateway unit tests already cover key parsing/anchoring heuristics.
4. Settings fields `openclawWorkspacePath` / `openclawContextPolicy` are currently context controls, not transport routing controls.

## Reliability Goals

1. No silent message loss during long tool-use turns.
2. No duplicate user/assistant bubbles caused by context wrapping, recovery, or streaming overlay.
3. No stale “Working/Typing/…” state after run completion or transport failure.
4. Every failed send has an explicit, user-visible terminal outcome.
5. Recovery is deterministic and idempotent.

## Non-Goals (for this plan)

1. Replacing OpenClaw gateway protocol.
2. Full rewrite of chat UI components.
3. Bundling product-level feature changes unrelated to reliability.
4. Introducing runtime transport-routing settings UI in this reliability cycle.

## Rollout Controls (Required)

1. Add feature flag: `RELIABILITY_V2_TURN_ENGINE` for lifecycle-engine extraction and related behavior changes.
2. Keep legacy path callable for one release cycle after enabling V2.
3. Add rollback procedure:
   - disable `RELIABILITY_V2_TURN_ENGINE`
   - clear in-memory turn registry
   - force reconnect websocket
   - emit one system bubble indicating fallback mode is active.
4. Release gate: no Phase 2/3 rollout to default-on without passing Phase 6 criteria.

## `process.poll` Capability Contract (Deterministic)

### Capability states

1. **Available**: poll calls succeed and return parseable process state.
2. **Unavailable: scope**: gateway returns scope errors (`missing scope`, `operator.admin`).
3. **Unavailable: transient**: temporary transport/poll failures below retry threshold.
4. **Unavailable: degraded**: repeated failures exceed retry threshold.

### Required behavior by state

1. **Available**: use poll as a completion enhancer only (not sole authority).
2. **Unavailable: scope**: stop retrying poll for that run; use time-based no-final fallback with explicit logging reason.
3. **Unavailable: transient**: retry within bounded count/window.
4. **Unavailable: degraded**: treat as unavailable for run; continue deterministic no-final flow.

### Logging reason taxonomy

1. `process_poll_available`
2. `process_poll_unavailable_scope`
3. `process_poll_unavailable_transient`
4. `process_poll_unavailable_degraded`
5. `resolved_via_final`
6. `resolved_via_poll_stability`
7. `resolved_via_force_window`
8. `failed_unacked_send`
9. `failed_timeout_no_output`

## Implementation Plan

### Phase 0 — Baseline Observability and Repro Harness

Owner: Chat Reliability
Estimate: 0.5-1 day
Depends On: None
Purpose: make failures diagnosable before deeper refactors.

Work:
1. Add a per-send correlation key (`sendId`) propagated through send start, ack/no-ack, delta, final, recovery, cleanup, and queue drain logs.
2. Emit structured terminal reason codes for every turn closure path.
3. Add a reproducible local scenario matrix script/doc for:
   - mid-run websocket close
   - no-final but ongoing tool activity
   - recovery after reconnect
   - long sub-agent runs with delayed text output
4. Add a compact “chat reliability diagnostics” section in developer docs.

Exit criteria:
1. Every send has exactly one terminal reason code.
2. Repro steps can deterministically trigger each known failure class.

### Phase 1 — Transport/Capability Contract Hardening

Owner: Chat Reliability
Estimate: 1-1.5 days
Depends On: Phase 0
Purpose: prevent implicit assumptions about process polling and send acceptance.

Work:
1. Add capability gate for process polling (detected once per connection/session/run).
2. Keep `process.poll` as optional enhancement; do not block correctness on it.
3. Separate semantics clearly:
   - `chat.send` ack state
   - user-turn acceptance in history
   - run completion
4. Define explicit behavior for unacked sends:
   - bounded wait for acceptance evidence
   - clear failure bubble when acceptance cannot be proven.

Exit criteria:
1. No code path assumes process polling is always available.
2. Unacked send outcomes are deterministic and visible.

### Phase 4 — Activity State Truth Model

Owner: Chat Reliability
Estimate: 1 day
Depends On: Phase 0, Phase 1
Purpose: prevent stale “working/typing” and missing-live-state behavior quickly.

Work:
1. Derive activity primarily from active turn/session registry and scoped events.
2. Enforce hard terminal clear when no active turns and no active background sessions remain.
3. Add stale-state sweeper on hydration/reconnect for orphaned active turns.
4. Ensure queued-message UI state reflects actual send eligibility and blocked-queue reason.

Exit criteria:
1. Activity indicator clears within a bounded window after terminal completion.
2. No persistent phantom working state without active run evidence.

### Phase 2 — Turn Lifecycle Engine Extraction

Owner: Chat Reliability
Estimate: 2-3 days
Depends On: Phase 0, Phase 1
Purpose: reduce flag interaction risk without requiring a big-bang rewrite.

Work:
1. Extract send lifecycle into a dedicated turn engine module with explicit phases:
   - `queued`, `sending`, `streaming`, `awaiting_output`, `settling`, `completed`, `failed`, `timed_out`.
2. Move transition conditions into a pure transition function where possible.
3. Keep current external API (`sendMessage`, `sendMessageWithContext`) stable.
4. Add transition-focused tests for ordering edge cases.

Exit criteria:
1. Lifecycle transitions are explicit and logged.
2. No new lifecycle booleans added to the legacy path.
3. Existing chat behavior remains functionally compatible.

### Phase 3 — Message Identity, Dedupe, and Recovery Consolidation

Owner: Chat Reliability
Estimate: 2-3 days
Depends On: Phase 0, Phase 1, Phase 2
Purpose: eliminate duplicate/drop behavior from overlapping reconciliation logic.

Work:
1. Define canonical message identity hierarchy:
   - stable message `_id` (preferred)
   - run-scoped identity fallback
   - normalized content+time fallback (bounded window)
2. Keep one canonical persisted dedupe path in the store.
3. Restrict `ChatShell` overlay logic to transient streaming presentation only.
4. Make recovery reconciliation idempotent and explicitly suppress during active streaming unless run-complete criteria are met.
5. Tighten recovery bubble emission to one bubble per recovery cycle/signature.

Exit criteria:
1. No duplicate context-wrapped user echoes.
2. No duplicate progressive assistant bubbles from streaming+history overlap.
3. Recovery bubbles are deduped and semantically accurate.

### Phase 5 — Settings and UX Contract Clarity

Owner: Chat Reliability
Estimate: 0.5 day
Depends On: Phase 1
Purpose: align UI expectations with actual runtime behavior.

Work:
1. Keep current settings copy explicit: context fields do not route transport.
2. Add docs + tests for context wrapping/normalization behavior.
3. Defer runtime-routing settings UI to a separate roadmap item unless reliability work explicitly requires it.

Exit criteria:
1. No ambiguity that context settings are prompt-context only.
2. User-visible behavior matches settings labels.

### Phase 6 — Reliability Verification and Release Gate

Owner: Chat Reliability + Human verifier
Estimate: 1-2 days
Depends On: Phases 0, 1, 4, 2, 3, 5
Purpose: ship only when failure modes are demonstrably reduced.

Work:
1. Run scenario matrix against long tool-use turns, reconnect events, and sub-agent sessions.
2. Validate with production-like manual trials using Clawchestra + OpenClaw dashboard side-by-side.
3. Capture before/after reliability metrics:
   - duplicate bubble rate
   - stale activity incidents
   - recovered-message bubble frequency
   - send failure visibility (silent vs explicit)
4. Ship only if acceptance criteria below are met.

Exit criteria:
1. All acceptance criteria pass.
2. No regressions in core send/receive behavior.

## Acceptance Criteria (Must Pass)

1. **No silent send loss**: 100% of sends in scenario matrix end in either assistant output or explicit terminal failure bubble.
2. **No duplicate user send bubble**: 0 duplicate context-wrapped user bubbles across 30-run matrix.
3. **No duplicate assistant response bubble**: 0 streaming/recovery duplicate assistant bubbles across 30-run matrix.
4. **No stale working state**: activity indicator clears to non-working within `<= 10s` of terminal completion when no active sessions remain.
5. **Recovery correctness**: reconnect backfill re-add count for already-rendered messages is 0 across matrix runs.
6. **Queue correctness**: FIFO preserved in all queued-run tests; eligible queue item begins processing within `<= 3s` after prior terminal state.
7. **Deterministic reason coding**: 100% of terminal send paths emit one and only one terminal reason code.

## Risk Controls

1. Keep API compatibility while extracting lifecycle internals.
2. Roll out by phase, with validation after each phase.
3. Avoid introducing new heuristics without explicit transition/state ownership.
4. Prefer additive instrumentation before behavioral changes.
5. Gate high-risk behavioral changes behind `RELIABILITY_V2_TURN_ENGINE` until criteria pass.

## Canonical Execution Order

1. Phase 0
2. Phase 1
3. Phase 4
4. Phase 2
5. Phase 3
6. Phase 5
7. Phase 6

## Immediate Next Build Slice

Start with:
1. Phase 0 instrumentation
2. Phase 1 capability gating for `process.poll`
3. Phase 4 hard terminal clear path for activity state

This is the fastest path to visible trust improvements while preparing safer structural changes.

## Build Progress

### Cycle 1 (2026-02-19)

- [x] Phase 0: Added `sendId`-correlated tauri-ws send logs for key lifecycle transitions.
- [x] Phase 0: Added structured terminal reason emission for every finalized turn (`[Gateway][terminal]` payload).
- [x] Phase 0: Added scenario matrix document at `docs/plans/chat-reliability-scenario-matrix.md`.
- [x] Phase 1: Added explicit `process.poll` capability classification (`available`, `unavailable_scope`, `unavailable_transient`, `unavailable_degraded`).
- [x] Phase 1: Added reason-coded `process.poll` fallback logging in no-final resolution path.
- [x] Phase 4: Added hard stale-activity clear safeguard in app shell (`<= 10s` terminal clear window when no active work remains).
- [x] Phase 0: Add compact diagnostics how-to section in developer docs (`docs/AGENTS.md`/ops runbook) for reason-code triage.

### Cycle 2 (2026-02-19)

- [x] Phase 2: Added dedicated turn lifecycle engine module (`src/lib/chat-turn-engine.ts`) and transition tests.
- [x] Phase 2: Wired lifecycle transitions into `sendViaTauriWs` for send/stream/finalize/fail/timeout paths with send-scoped logs.
- [x] Phase 3: Added shared message identity helpers (`src/lib/chat-message-identity.ts`) for canonical normalization and signatures.
- [x] Phase 3: Consolidated store dedupe and user-context unwrapping through shared identity helpers.
- [x] Phase 3: Tightened recovery reconciliation in app shell to suppress assistant backfill while active runs are in flight.
- [x] Phase 5: Clarified Settings UX copy that workspace/context controls affect prompt context, not transport routing.
- [x] Phase 6: Executed automated verification gates (`typecheck`, targeted reliability tests, production build) and captured passing results.
