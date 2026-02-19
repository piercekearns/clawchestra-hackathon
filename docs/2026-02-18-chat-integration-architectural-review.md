# Chat Integration Reliability Plan (Clawchestra)

> Practical, staged plan to eliminate dropped/duplicate/stale chat behavior and restore trust in chat state.

## Summary

This document converts the prior architecture review into an execution plan with corrected assumptions. The core diagnosis still holds: reliability issues come from lifecycle complexity, scattered event filtering, and overlapping dedupe/recovery paths. The implementation below prioritizes deterministic turn state, scoped event handling, single-source message identity, and explicit failure behavior so users always know whether work is active, complete, or failed.

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

## Implementation Plan

### Phase 0 — Baseline Observability and Repro Harness

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

Purpose: prevent implicit assumptions about process polling and send acceptance.

Work:
1. Add a capability gate for process polling (detected once per connection/session).
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

### Phase 2 — Turn Lifecycle Engine Extraction

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

### Phase 4 — Activity State Truth Model

Purpose: prevent stale “working/typing” and missing-live-state behavior.

Work:
1. Derive activity primarily from active turn/session registry and scoped events.
2. Enforce hard terminal clear when no active turns and no active background sessions remain.
3. Add stale-state sweeper on hydration/reconnect for orphaned active turns.
4. Ensure queued-message UI state reflects actual send eligibility and blocked-queue reason.

Exit criteria:
1. Activity indicator clears within bounded time after terminal completion.
2. No persistent phantom working state without active run evidence.

### Phase 5 — Settings and UX Contract Clarity

Purpose: align UI expectations with actual runtime behavior.

Work:
1. Keep current settings copy explicit: context fields do not route transport.
2. Add optional “Advanced (future)” placeholder if runtime routing settings are later introduced.
3. Ensure context wrapping/normalization behavior is documented and test-covered.

Exit criteria:
1. No ambiguity that context settings are prompt-context only.
2. User-visible behavior matches settings labels.

### Phase 6 — Reliability Verification and Release Gate

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

1. **No silent send loss**: every send results in either assistant output or explicit terminal failure bubble.
2. **No duplicate user send bubble** caused by context wrapping.
3. **No duplicate assistant response bubble** from streaming/recovery overlap in the same turn.
4. **No stale working state** persisting beyond bounded timeout after terminal completion with no active sessions.
5. **Recovery correctness**: reconnect backfill does not re-add already rendered messages.
6. **Queue correctness**: queued messages drain FIFO when eligible; blocked queue remains explainable.

## Risk Controls

1. Keep API compatibility while extracting lifecycle internals.
2. Roll out by phase, with validation after each phase.
3. Avoid introducing new heuristics without explicit transition/state ownership.
4. Prefer additive instrumentation before behavioral changes.

## Execution Order Recommendation

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6

## Immediate Next Build Slice

If we execute in thin vertical slices, start with:
1. Phase 0 instrumentation
2. Phase 1 capability gating for `process.poll`
3. Phase 4 hard terminal clear path for activity state

This gives fast user-visible reliability gains before deeper structural extraction.
