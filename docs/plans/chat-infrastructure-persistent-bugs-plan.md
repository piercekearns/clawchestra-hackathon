# Chat Bridge Reliability Program Plan (Deepened)

> Outcome-first program to deliver the best possible Clawchestra chat experience with OpenClaw: fast, truthful, durable, polished, and confidence-building in live use.

## Enhancement Summary

Deepened on: 2026-02-24  
Base plan: `docs/plans/chat-infrastructure-persistent-bugs-plan.md` (holistic draft)  
Plan sections deepened: 14  
Primary metric: experience quality, not bug-count closure

Research inputs applied:
1. OpenClaw docs (installed `2026.2.22-2`):
- `docs/channels/telegram.md`
- `docs/concepts/streaming.md`
- `docs/concepts/model-failover.md`
- `docs/concepts/typing-indicators.md`
- `docs/concepts/retry.md`
- `docs/concepts/queue.md`
- `docs/concepts/session.md`
- `docs/channels/troubleshooting.md`
2. Context7 official docs:
- Tauri v2 lifecycle/events/command error patterns
- Zustand selective subscription and render optimization patterns
3. Project learnings:
- `docs/solutions/refactoring/large-scale-tauri-architecture-overhaul.md`
- `docs/solutions/high-token-usage-lessons-opus46-2026-02-20.md`

Applied architecture/review lenses:
1. Agent-native parity and outcome-first behavior contracts.
2. Stateful UI truthfulness (single authority for lifecycle and model truth).
3. Performance under long-running/high-context runs.
4. Failure transparency and low-surprise UX.

---

**Roadmap Item:** `chat-infrastructure`  
**Status:** Ready  
**Created:** 2026-02-19  
**Last Updated:** 2026-02-24

---

## Locked Decisions (2026-02-24)

1. Legacy turn records on upgrade:
- Use a migration-first policy.
- Migrate legacy active/pending records into the new controller model when mapping is deterministic.
- If mapping is ambiguous, terminalize safely (never leave them active) and emit a concise notice.
- Legacy records must never be allowed to keep chat in a stuck-busy or queue-blocked state.

2. Badge/status fallback when model truth is temporarily unavailable:
- Because model badge and status are unified, show active model/provider when available.
- If model/provider cannot be resolved but transport/session is known healthy, show `Connected`.
- Do not show configured/default model as active truth in this state.
- Continue background refresh until active model/provider truth resolves.

---

## Section Manifest

Section 1: Product metric hierarchy — lock success criteria to optimal experience.  
Section 2: Experience contract — define non-negotiable user-visible behavior.  
Section 3: Source-of-truth architecture — remove conflicting lifecycle/model signals.  
Section 4: Streaming and pending semantics — align with OpenClaw transport realities.  
Section 5: Recovery/persistence determinism — eliminate restart/update/reconnect loss.  
Section 6: Model/provider truth pipeline — badge reflects active runtime truth.  
Section 7: Compaction and internal narration policy — explicit compaction, suppress leaks.  
Section 8: Queue/retry/failure policy — resilient dispatch with clear user feedback.  
Section 9: Observability and reason codes — measurable terminality and debugging.  
Section 10: Telegram parity extraction — copy the right integration patterns, not implementation details.  
Section 11: Workstreams and phased delivery — execution order with strict gates.  
Section 12: Validation and soak — prove quality in realistic runs.  
Section 13: Regression matrix mapping — historical bugs as secondary probes.  
Section 14: Definition of done and post-ship posture.

## Primary Metric Hierarchy (Locked)

This plan optimizes in this order:

1. Experience quality:
- Send feels immediate.
- Progress is visible and believable.
- Completion feels deterministic, not lucky.

2. Truthfulness:
- Activity label, pending bubble, stream state, and model badge all reflect reality.
- No stale/default state presented as active truth.

3. Durability:
- No silent turn loss under update/restart/reconnect.

4. Failure clarity:
- When failure happens, user gets concise cause + next action.

5. Regression confidence:
- Historical bugs are replayed as a final validation suite.

Decision rule:
- A change that closes a listed bug but degrades perceived experience is rejected.

## Product Contract (Locked Target UX)

1. Turn starts instantly:
- Pending assistant bubble (`...`) appears immediately on send.
- Lifecycle label runs continuously until terminal (`Typing...`, `Working...`, `Compacting...`).

2. Turn progresses visibly:
- If deltas are available, show chunked progress.
- Pending bubble is replaced by visible stream content at first meaningful chunk.
- If only final is available, keep pending + lifecycle truthfully until final.

3. Turn ends deterministically:
- Exactly one terminal outcome: `completed` or `failed`.
- On completion, final assistant output is visible in drawer history without restart/nudge.
- On failure, pending bubble clears and user gets reason + action.

4. Badge truth:
- Badge reflects active run/session reality, including provider/model fallback shifts.
- Requested-but-not-yet-active changes are shown as pending state, not active state.

5. Queue guarantees:
- If queued send dispatch fails, auto-retry once.
- If retry fails, emit concise failure with attempted message summary.
- Queue never stalls indefinitely behind phantom active state.

6. Compaction semantics:
- Show `Compacting...` during compaction.
- Show compacted completion explicitly.
- Suppress internal/silent memory-flush narration from user-visible assistant flow.

7. Dupes vs drops:
- Bias against drops; occasional duplicate is acceptable compared with missing real output.

## Current State Snapshot

Landed and useful:
1. OpenClaw runtime upgrade + scope hardening.
2. Broader chat event text extraction and improved poll behavior under noisy non-content events.
3. Chronological recovery merge ordering and id-aware dedupe hardening.
4. `[[reply_to_current]]` directive stripping across ingestion paths.
5. Pending bubble control and failed-send context messaging improvements.
6. Session-model stale clear when exact session snapshot is unavailable.

Still partial:
1. Startup recovery misses still reported intermittently.
2. Long-turn final surfacing can still feel delayed/intermittent.
3. Model/provider badge truth can still lag fallback transitions.
4. Compaction/internal narration policy not fully contract-enforced.
5. Queue retry and terminality consistency not fully unified.

## Architectural Direction (Deepened)

Core architectural decision:
- Introduce one foreground turn controller as the only authority for turn lifecycle state.

Why:
- Current behavior risks split authority between gateway lifecycle, app-level flags, store-derived active counts, and reconciliation side-effects.
- Split authority is the direct path to phantom activity, dropped final materialization, and queue starvation.

Controller responsibilities:
1. Accept user send and assign canonical turn id.
2. Manage state transitions.
3. Publish render-state signals (`pendingVisible`, `streamVisible`, `terminal`).
4. Publish queue eligibility state.
5. Publish terminal reason code exactly once.

State model (authoritative):
1. `queued`
2. `sending`
3. `awaiting_first_visible_output`
4. `streaming`
5. `awaiting_settle`
6. `completed`
7. `failed`

Key invariant:
- UI components do not infer lifecycle by heuristic if controller state is available.

## Streaming and Pending Semantics (Deepened)

OpenClaw channel streaming reality:
- Streaming may be chunk/block/preview style, not guaranteed token-level deltas.
- Telegram-style smoothness comes from robust preview/edit/final discipline, not assuming token events always arrive.

Bridge strategy:
1. Maintain synthetic pending bubble until first visible assistant content.
2. Stream renderer consumes meaningful chunks only (ignore empty/noise/control fragments).
3. If no meaningful chunk arrives but final does, render final directly and terminate cleanly.
4. If neither meaningful chunk nor final arrives within bounded settle policy, fail explicitly with reason.

Anti-pattern to avoid:
- Treating agent chatter/tool noise as proof of user-visible content progress.

## Recovery and Persistence Determinism (Deepened)

Durability requirements:
1. Before update/restart, flush latest user/assistant writes and pending turn metadata.
2. Recovery cursor must advance only after merged + persisted message acceptance.
3. Reconciliation must be idempotent and monotonic over time.

Merge policy:
1. Strict ordering by timestamp/id before collapse.
2. Conservative dedupe (id-bearing assistant messages are never dropped as duplicates by content-time heuristic).
3. Deferred reconciliation while foreground turn active, then immediate reconcile at terminal.

Edge-case handling:
1. Missed final event but history contains authoritative final output.
2. Reconnect mid-stream with overlapping streamed and recovered content.
3. Startup after update where latest user/assistant turn exists upstream but not locally.

Upgrade compatibility policy (legacy persisted turns):
1. Treat legacy persisted turns as migration data, not disposable noise.
2. On first launch with new controller schema, migrate legacy active/pending turns into the new controller state model with deterministic mapping:
- legacy queued/running -> `awaiting_settle` with recovery probe
- legacy terminal-like states -> terminalized and removed from active set
3. If legacy record cannot be mapped safely, mark it terminal as `failed_session_unavailable`, remove it from active queue eligibility, and emit one concise system notice.
4. Never allow unmigrated legacy turns to hold the app in busy/queued-blocked state.

## Model/Provider Truth Pipeline (Deepened)

Truth precedence:
1. Run-level resolved provider/model (best truth).
2. Exact active session snapshot.
3. Explicit unknown state.

Never allowed:
- Displaying default/config provider-model as active truth when exact/run truth is unavailable.

Badge behavior contracts:
1. Active badge changes when fallback actually routes run to alternate provider/model.
2. Pending requested change is shown separately when applicable.
3. Unknown state is explicit and non-deceptive.

When run metadata is missing:
1. Keep last known run-truth for a short TTL (10s) while probing session snapshot.
2. If exact session snapshot confirms model/provider, adopt it.
3. If exact snapshot is unavailable/stale after TTL, surface explicit `Unknown (awaiting runtime truth)` state.
4. Never backfill from defaults/config for active badge truth.

Validation scenarios:
1. Anthropic primary -> Copilot fallback under primary quota exhaustion.
2. Same model across providers (provider changes while model label appears stable).
3. Requested model switch requiring new session before active.
4. Run completes without provider/model metadata payload; badge resolves via TTL + exact-session probe.

## Compaction and Internal Narration Policy (Deepened)

OpenClaw behavior reference:
- Compaction has explicit phases; silent memory flush can produce intermediate internal narration.

Bridge policy:
1. Compaction phase states are first-class UI states, not inferred from generic working.
2. Internal no-reply/memory-flush narration is suppressed from normal assistant timeline.
3. System bubbles communicate compaction progress/completion succinctly.

User trust rule:
- Compaction should feel like system maintenance, not like agent confusion.

## Queue, Retry, and Failure UX (Deepened)

Dispatch policy:
1. Foreground send failure -> immediate failure notification.
2. Queued dispatch failure -> one automatic retry.
3. Retry failure -> actionable failure with attempted message summary.
4. Retry uses the same idempotency key and turn id as the original queued send.
5. If retry detects upstream acceptance of original send, treat as accepted (not failed) and do not duplicate user turn.

Failure taxonomy (user-visible classes):
1. Connectivity/transport.
2. Upstream timeout/aborted monitoring.
3. Session unavailable or stale context.
4. Provider/model failover exhaustion.

Message shape (compact default):
- `Send failed` + one-line reason + single next action.

## Observability and Reason-Code Contract (Deepened)

Every turn logs:
1. `turnId`, `runId`, `sessionKey`.
2. start timestamp, first-visible-output timestamp, terminal timestamp.
3. terminal reason code.
4. whether final was sourced from stream, final event, or history fallback.

Required reason-code families:
1. `completed_from_stream_or_final`
2. `completed_from_history_reconcile`
3. `failed_transport`
4. `failed_timeout_no_visible_output`
5. `failed_upstream_abort`
6. `failed_session_unavailable`

Operational metrics:
1. p95 send-to-first-visible.
2. p95 send-to-terminal-visible.
3. rate of terminals requiring history fallback.
4. stuck-active incidents.
5. queue-retry failure rate.
6. badge mismatch incidents in fallback tests.

## Telegram Parity Extraction (What to Emulate)

Patterns to copy conceptually:
1. Preview-first confidence: user sees prompt acknowledgement and ongoing progress.
2. Edit/append finalization discipline: intermediate display converges cleanly to final message.
3. Per-session sequencing and deterministic routing to reduce race/drop behavior.
4. Retry discipline on outbound channel operations.

Patterns not to copy blindly:
1. Channel-specific UX assumptions where Tauri drawer semantics differ.
2. Provider/channel capabilities that do not exist in local desktop transport.

## Workstreams (Deepened)

### Workstream 0: Protocol Truth Audit

Deliverables:
1. `docs/plans/chat-bridge-protocol-contract.md`
2. `docs/plans/chat-bridge-telegram-parity-notes.md`

Tasks:
1. Enumerate authoritative events and payload shapes.
2. Define which events can and cannot drive visible-progress state.
3. Define authoritative terminal signals and fallback hierarchy.

Exit gate:
1. Signed contract for event semantics and terminal rules.

### Workstream 1: Single Turn Runtime Controller

Tasks:
1. Implement canonical state machine and remove split-terminal authority.
2. Route queue eligibility through controller state only.
3. Enforce one terminal transition per turn.
4. Add legacy pending-turn migration map and fallback terminalization rules for incompatible records.

Exit gate:
1. 100% of 200/200 controlled test turns emit exactly one terminal reason code.
2. 0/50 upgrade-restart runs produce queue-blocking phantom-active state from legacy records.

### Workstream 2: Rendering Contract Hardening

Tasks:
1. Pending bubble lifecycle fully detached from generic activity heuristics.
2. Stream/final materialization path guaranteed from controller transitions.
3. First-visible-output trigger standardized.

Exit gate:
1. 0/100 deterministic trace replays show upstream-complete/local-missing-final.
2. Pending bubble clear behavior is correct in 100% of send-failed and first-visible-stream transitions.

### Workstream 3: Recovery/Persistence Determinism

Tasks:
1. Strengthen cursor advancement semantics.
2. Enforce update-safe flush before restart path.
3. Stabilize reconcile ordering + dedupe invariants.

Exit gate:
1. 0 missing latest user/assistant turns across 100 update/restart cycles.
2. 0 queue starvation incidents after reconnect/update in the same cycle set.

### Workstream 4: Model/Provider Truth Pipeline

Tasks:
1. Wire run-level truth into badge pipeline.
2. Keep session snapshot fallback strict and explicit.
3. Add pending-change indicator state.

Exit gate:
1. 100% pass over 50 fallback-switch runs with badge truth matching run/snapshot contract.
2. 0 cases where defaults/config are shown as active truth without run or exact-session confirmation.

### Workstream 5: Compaction/Internal Narration Policy

Tasks:
1. Phase-accurate compaction UI state.
2. Suppress internal no-reply narration from assistant timeline.
3. Preserve explicit compacted confirmation event.

Exit gate:
1. Compaction-heavy runs show no internal narration leakage.

### Workstream 6: Queue/Retry/Failure Guarantees

Tasks:
1. Add one-shot retry policy for queued dispatch.
2. Standardize concise failure messaging format.
3. Guarantee queue unblock after terminal states.
4. Add idempotent retry contract with accepted-without-ack reconciliation path.

Exit gate:
1. 0 indefinite queued/stuck states in 100 induced failure tests.
2. 0 duplicate user-turn dispatches in 100 ack-loss/retry ambiguity tests.

### Workstream 7: Experience Validation and Soak

Tasks:
1. Expand scenario matrix with deterministic fixtures.
2. Run live soak with long turns, reconnects, compaction, fallback switches.
3. Execute user-flow acceptance checks.
4. Run historical bug scenarios as secondary regression suite.

Exit gate:
1. Outcome metrics pass for the full matrix over at least 7 consecutive daily soak sessions.
2. No high-severity regression remains unexplained.

## Validation Matrix (Outcome-First)

Primary acceptance runs:
1. Fast short-turn UX (snappy progression).
2. Long tool-heavy turn with sparse deltas.
3. Reconnect mid-run.
4. Update-mid-session.
5. Compaction during active workload.
6. Primary-provider quota exhaustion with fallback.
7. Queued sends under transient dispatch failure.
8. Ack lost but upstream accepted (no duplicate send, no false failure).

For each run record:
1. first-visible latency.
2. terminal visibility latency.
3. terminal reason code.
4. whether history fallback was required.
5. badge truth correctness.

Outcome thresholds (pass/fail):
1. p95 first-visible <= 2.0s for short-turn matrix runs.
2. p95 terminal-visible <= 30s for long-turn matrix runs (excluding explicitly long background tasks).
3. missing-final rate = 0%.
4. stuck-active rate = 0%.
5. badge mismatch rate = 0% in fallback/missing-metadata scenarios.

## Historical Bugs as Secondary Regression Probes

Use previous bug set as probes after experience contract validation:
1. BUG-001, BUG-002 -> startup/update/recovery continuity.
2. BUG-003, BUG-006, BUG-012 -> long-turn surfacing and stuck activity.
3. BUG-004, BUG-005, BUG-008 -> compaction semantics and narration suppression.
4. BUG-011 -> directive leak regression.
5. BUG-010 -> long monitoring timeout clarity.

## Learnings Integrated from Project Solutions

From architecture-overhaul learning:
1. Keep interface contracts explicit and type-safe across app/store/bridge boundaries.
2. Run phased validation gates after each major lifecycle change.
3. Use Rust-side lifecycle hooks for deterministic persistence/cleanup behaviors.

From high-token-usage learning:
1. Avoid excessive loop churn in diagnostics and reconciliation passes.
2. Prefer batched validation workflows and bounded retries.
3. Keep high-cost investigative paths controlled via strict loop budgets.

## Delivery Phasing and Governance

Phase A (Contract + Controller): Workstreams 0-1  
Phase B (Render + Durability): Workstreams 2-3  
Phase C (Truth + Policy): Workstreams 4-6  
Phase D (Soak + Regression): Workstream 7

Minimum acceptable experience checkpoint (replaces vague MVP):
1. After Phase B, run a checkpoint review:
- If first-visible/terminal continuity and no-loss gates are passing in live use, continue hardening in thin slices.
- If chat is still perceived as unreliable/unusable, pause feature expansion and continue focused reliability work only.
2. This checkpoint is qualitative + quantitative; it is not a scope-cut exercise.

Governance rules:
1. No phase progression without exit-gate evidence.
2. Feature flags for high-risk lifecycle transitions.
3. Fast rollback for any slice that regresses truthfulness or perceived reliability.

## Definition of Done

The chat bridge is considered fit-for-purpose when:
1. Users consistently experience immediate acknowledgement, visible progress, and deterministic completion.
2. UI truth (activity + badge) matches runtime behavior across normal and fallback paths.
3. Restart/update/reconnect no longer produce silent loss of latest user/assistant turns.
4. Failures are concise, actionable, and non-ambiguous.
5. Historical bug scenarios pass as regression checks under the new outcome-first architecture.

## Build Execution Status (2026-02-24)

Completed in this build cycle:
1. Workstream 0:
- Published protocol contract: `docs/plans/chat-bridge-protocol-contract.md`.
- Published Telegram parity notes: `docs/plans/chat-bridge-telegram-parity-notes.md`.
- Updated scenario matrix: `docs/plans/chat-reliability-scenario-matrix.md`.

2. Workstream 1:
- Added deterministic legacy pending-turn status migration map.
- Added terminalization/removal for incompatible legacy statuses.
- Added startup migration notice contract to surface hydration actions.

3. Workstream 2:
- Kept pending bubble explicit until first visible stream content.
- Preserved deterministic pending clear on failure/first-visible output.

4. Workstream 4:
- Added run-level model/provider extraction from send/event payloads.
- Added snapshot fallback probe when run metadata is absent.
- Added short retention of run truth before snapshot reconciliation.

5. Workstream 6:
- Added one-shot queued retry policy.
- Reused same idempotency key for queued retry attempts.
- Added retry-exhausted failed-row retention for manual retry/removal (no silent disappearance).

Automated validation executed in this cycle:
1. `bun test src/lib/gateway.test.ts src/lib/store.test.ts src/App.test.tsx` -> pass.
2. `bun test` -> pass.
3. `npx tsc --noEmit` -> pass.
4. `pnpm build` -> pass.
5. `cargo check` (in `src-tauri/`) -> pass.

Partially complete / needs runtime verification:
1. Workstream 3:
- Recovery ordering/dedupe hardening is in place, but update/restart soak evidence still needed.

2. Workstream 5:
- Compaction semantics and suppression logic are present, but compaction-heavy soak still needed.

3. Workstream 7:
- Scenario matrix expanded, but 7-day live soak evidence not yet collected.

## Remaining Phase-Gate Evidence

1. Run 7-day soak matrix with scenarios 1-8 and capture metrics.
2. Verify badge truth under real provider fallback transitions.
3. Verify no startup phantom-active blockers from seeded legacy pending-turn data across upgrade/restart cycles.
