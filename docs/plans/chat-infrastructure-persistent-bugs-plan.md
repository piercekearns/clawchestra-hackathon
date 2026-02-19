# Chat Reliability: Persistent Bugs - Deepened Fix Plan (Final Review Candidate)

> Execution-grade plan to close BUG-001 through BUG-007 with deterministic state handling, update-safe durability, and measurable validation gates.

## Summary

This revision incorporates plan-review feedback and adds concrete implementation contracts, prerequisite decisions, rollback controls, and reproducible verification procedures. The first priority remains eliminating update-time loss and stuck activity deadlocks. Recovery and compaction work follows once lifecycle correctness is stable and measurable.

---

**Roadmap Item:** `chat-infrastructure`
**Spec:** `docs/specs/chat-infrastructure-phase-a-spec.md`
**Status:** Ready for implementation (`ROADMAP.md` item remains `in-progress`)
**Created:** 2026-02-19
**Last Updated:** 2026-02-19

---

## Inputs Used

1. Roadmap bug log: `roadmap/chat-infrastructure.md`
2. App send/recovery/lifecycle code:
`src/App.tsx`, `src/lib/gateway.ts`, `src/lib/store.ts`, `src/lib/tauri-websocket.ts`
3. Update lifecycle code:
`src/components/TitleBar.tsx`, `src/hooks/useAppUpdate.ts`, `src-tauri/src/lib.rs`, `update.sh`
4. OpenClaw runtime behavior from installed package:
`docs/web/webchat.md`, `docs/gateway/index.md`
5. Live session transcript evidence:
`~/.openclaw/agents/main/sessions/*.jsonl`

## Bug-to-Root-Cause Mapping

1. `BUG-001` and `BUG-002`:
Optimistic append plus async persistence intersects with force-kill update path.

2. `BUG-003`:
Message-level recovery append and aggressive dedupe without turn boundary model.

3. `BUG-004`:
No-final/poll-stability can settle on partial state around compaction/tool gaps.

4. `BUG-005`:
Compaction states are collapsed into one terminal-looking UI message.

5. `BUG-006`:
Activity source mixing includes text-derived session heuristics and causes false-active state.

6. `BUG-007` app-side overlap:
Upstream failure states are not always surfaced clearly when output payload is empty.

## Blocking Decisions (Must Be Set Before Phase 1)

1. Update policy decision:
`BLOCK` (no update while active turns exist) or `ALLOW_FORCE` (show explicit warning and allow override).
Recommended default: `BLOCK`.

2. Recovery policy decision:
`STRICT_CURSOR` (only newer-than-cursor) or `CURSOR_PLUS_BOUNDED_FALLBACK`.
Recommended default: `CURSOR_PLUS_BOUNDED_FALLBACK`.

3. Failure bubble verbosity:
`MINIMAL` (short actionable) or `DIAGNOSTIC` (includes run/session ids).
Recommended default: `MINIMAL`.

## Decision Record (Locked for This Plan Revision)

1. Update policy: `BLOCK`
2. Recovery policy: `CURSOR_PLUS_BOUNDED_FALLBACK`
3. Failure bubble verbosity: `MINIMAL`
4. Locked on: `2026-02-19`
5. Change rule: any change requires updating this section and rerunning plan review before implementation continues.

## Data Contract: Recovery Cursor (Concrete Storage Spec)

## Storage

1. New SQLite table in chat DB:
`chat_recovery_cursor(session_key TEXT PRIMARY KEY, last_message_id TEXT, last_timestamp INTEGER NOT NULL, updated_at INTEGER NOT NULL)`

2. Cursor update rule:
advance only after message successfully merged into local transcript state and persisted.

3. Reset rules:
manual clear only via explicit command or full chat DB reset.
no auto-reset on reconnect.

4. Corruption fallback:
if cursor row parse fails, log warning and fall back to bounded timestamp-only recovery for one run, then rewrite clean row.

## Phase 0 - Baseline Instrumentation and Repro Harness

## Scope

1. Add structured logs that correlate each send lifecycle end-to-end.
2. Add deterministic repro steps for each high-severity bug.

## File Touchpoints

1. `src/lib/gateway.ts`
2. `src/App.tsx`
3. `src/hooks/useAppUpdate.ts`

## Tasks

1. Add log keyset for each turn:
`sendId`, `runId`, `sessionKey`, `reason`, `completedAt`, `recoveryApplied`.
2. Add update log keyset:
`updateRequestedAt`, `flushStartAt`, `flushEndAt`, `restartIssuedAt`.
3. Add compaction transition logs for all compaction states.
4. Add upstream grounding task:
locate/pin OpenClaw source snapshot for correlation during BUG-007 investigation.
5. Record upstream provenance in validation artifacts:
source path or commit hash used for each run.

## Exit Gate

1. Each repro trace contains one terminal reason and one lifecycle timeline.

## Phase 1 - Update-Safe Durability (BUG-001, BUG-002)

## Scope

Guarantee message and pending-turn durability before update-triggered restart.

## File Touchpoints

1. `src/lib/store.ts`
2. `src/lib/tauri.ts`
3. `src-tauri/src/lib.rs`
4. `src/hooks/useAppUpdate.ts`
5. `src/components/TitleBar.tsx`
6. `update.sh`

## Tasks

1. Add explicit `chat_flush` Tauri command for durable write completion.
2. Ensure send path can await persistence completion for latest user and assistant messages.
3. Update update flow to call flush before `run_app_update`.
4. Enforce chosen update policy from blocking decisions.
5. Add telemetry for update-block and update-force cases.

## Test Additions

1. `src/lib/store.test.ts` (create file if absent):
persisted message exists after simulated update request.
2. `src/hooks/useAppUpdate.test.ts` (create file if absent):
update request during active turn is blocked by default.
3. `src/hooks/useAppUpdate.test.ts` (create file if absent):
update request after idle proceeds.

## Exit Gate

1. 20 update-mid-session cycles show zero missing user/assistant turns.

## Phase 2 - Activity Truth and Queue Unblock (BUG-006)

## Scope

Remove false-positive activity sources and guarantee queue unblock on terminal states.

## File Touchpoints

1. `src/App.tsx`
2. `src/lib/gateway.ts`

## Tasks

1. Remove content-derived background session parsing from assistant message text.
2. Drive background activity only from structured announce/process events.
3. Add fallback for missing structured events:
bounded passive probe window, then terminal timeout-to-idle behavior.
4. Maintain single authority for queue unblock conditions.

## Test Additions

1. `src/App.test.tsx` (create file if absent):
assistant text containing `agent:...` does not activate background session.
2. `src/App.test.tsx` (create file if absent):
queue drains after terminal transition.
3. `src/App.test.tsx` (create file if absent):
no persistent Working label after completion.

## Exit Gate

1. No send-blocking stuck states across reconnect, compaction, and long tool-use flows.

## Phase 3 - Recovery Cursoring and Ordered Merge (BUG-003, BUG-004)

## Scope

Make recovery deterministic, turn-aware, and chronologically correct.

## File Touchpoints

1. `src/App.tsx`
2. `src/lib/gateway.ts`
3. `src/lib/store.ts`
4. `src/lib/chat-message-identity.ts`
5. `src-tauri/src/lib.rs`

## Tasks

1. Implement cursor table and read/write commands.
2. Recover only messages beyond cursor (plus chosen bounded fallback mode).
3. Merge recovered messages by timestamp before dedupe and render.
4. Add turn-aware grouping so narration fragments are not promoted to standalone bubbles.
5. Replay deferred assistant recovery immediately after turn terminalization.

## Test Additions

1. `src/lib/gateway.test.ts`:
stale narration fragment cannot reappear after later update.
2. `src/App.test.tsx` (create file if absent):
recovered messages remain ordered.
3. `src/lib/gateway.test.ts`:
reconnect loops do not duplicate recovery.

## Exit Gate

1. 20 reconnect/update recovery runs with zero stale-fragment and ordering regressions.

## Phase 4 - Compaction Event Semantics (BUG-005)

## Scope

Separate compaction in-progress and completion states in UI and metadata.

## File Touchpoints

1. `src/lib/gateway.ts`
2. `src/App.tsx`
3. `src/lib/store.ts`

## Tasks

1. Map `compacting` to in-progress state (`Compacting conversation...` + loading).
2. Map `compacted` and `compaction_complete` to terminal state (`Conversation compacted`).
3. Update existing compaction bubble rather than creating misleading duplicates.

## Test Additions

1. `src/lib/gateway.test.ts`:
compaction state transitions are monotonic and semantically correct.
2. `src/App.test.tsx` (create file if absent):
terminal compaction bubble not shown before completion state.

## Exit Gate

1. Manual compaction runs always show progress first, then completion.

## Phase 5 - Upstream Failure Visibility (BUG-007 app-side overlap)

## Scope

Surface upstream runtime/model failures deterministically even with empty final content.

## File Touchpoints

1. `src/lib/gateway.ts`
2. `src/App.tsx`

## Tasks

1. Promote repeated upstream error-stop entries to explicit failure bubbles.
2. Add rate-limit-specific user message path.
3. Add anti-spam strategy for repeated failures:
dedupe by `(error type + runId/sessionKey)` and cooldown window.
4. Ensure no-empty-output terminal path always emits failure summary.

## Test Additions

1. `src/lib/gateway.test.ts`:
repeated 429 bursts produce one deduped actionable bubble per cooldown window.
2. `src/lib/gateway.test.ts`:
empty-content terminal state cannot end silently.

## Exit Gate

1. No silent failures during synthetic rate-limit and transport instability runs.

## Feature Flags and Rollback

## Flag Contract

1. Source of truth:
`src/lib/chat-reliability-flags.ts` (new file). No hidden runtime-only flags.
2. Backend mirror for update guard:
`src-tauri/src/lib.rs` checks frontend-provided flag state before `run_app_update`.
3. Default values for this rollout:
`chat.update_flush_guard=true`
`chat.activity_strict_sources=true`
`chat.recovery_cursoring=true`
`chat.compaction_semantic_states=true`
4. Change control:
flag default changes require commit + runbook entry.

## Flag Definitions

1. `chat.update_flush_guard`:
controls update-time flush enforcement and update blocking.
2. `chat.activity_strict_sources`:
disables content-derived background activity.
3. `chat.recovery_cursoring`:
enables cursored recovery merge path.
4. `chat.compaction_semantic_states`:
enables distinct compaction progress/completion mapping.

Rollback rule:
if any phase introduces send deadlock, duplicate replay, or queue starvation in matrix runs, disable newest flag and revert to last passing phase.

## Validation Matrix

## Automated Commands

1. `bun test src/lib/gateway.test.ts src/lib/chat-turn-engine.test.ts src/lib/chat-message-identity.test.ts src/lib/chat-normalization.test.ts`
2. `bun test`
3. `npx tsc --noEmit`
4. `pnpm build`

## Manual Scenarios

1. Update during active short turn.
2. Update during heavy tool-use turn.
3. Mid-run reconnect with queued follow-up.
4. Compaction during active run.
5. Recovery after forced app restart.
6. Synthetic rate-limit burst visibility.

## Validation Runbook (Reproducibility Requirement)

Artifact root for this item:
`docs/validation/chat-reliability/`

Directory and file convention per cycle:
`docs/validation/chat-reliability/YYYY-MM-DD/<scenario-id>/`
`cycle-summary.md` (required)
`gateway.log` (required)
`app-console.log` (required)

For each cycle, record:
1. build commit
2. scenario id
3. decision profile (`BLOCK`/`ALLOW_FORCE`, cursor mode, verbosity mode)
4. start/end timestamps
5. trace ids (`sendId`, `runId`, `sessionKey`)
6. pass/fail and reason

Required artifacts per cycle:
1. gateway logs
2. app console trace
3. summary row in runbook table

## Acceptance Criteria

1. `BUG-001` closed: no assistant messages lost across update restart.
2. `BUG-002` closed: no user messages lost across update restart.
3. `BUG-003` closed: no stale narration fragments as standalone bubbles.
4. `BUG-004` closed: no missing post-compaction final response.
5. `BUG-005` closed: compaction progress/completion states are distinct and correct.
6. `BUG-006` closed: no stuck Working state that blocks sends.
7. `BUG-007` app-side overlap closed: upstream failures are always surfaced.

## Risks and Mitigations

1. Risk: strict cursoring may hide legitimate late events.
Mitigation: bounded fallback pass after terminal state with duplicate-safe merge.

2. Risk: update guard may feel restrictive.
Mitigation: explicit force-override path if `ALLOW_FORCE` is selected.

3. Risk: lifecycle changes may regress queue behavior.
Mitigation: queue-focused tests and manual matrix gate before release.

## Dependencies and Constraints

1. OpenClaw source tree is currently not available in `clawdbot-sandbox/repos`; current grounding uses installed runtime/dist and session artifacts until source is pinned.
2. Some `BUG-007` behavior depends on upstream provider limits and is outside app code.
3. Gateway events are not replayed; app recovery must remain idempotent and cursor-based.

## Rollout Sequence

1. Implement Phases 1 and 2 with feature flags and run matrix.
2. If gates pass, implement Phases 3 through 5 and rerun matrix.
3. Keep roadmap item `in-progress` until human verification confirms closure.

## Completion Checklist

1. All acceptance criteria satisfied with artifacts.
2. Rollback flags verified and documented.
3. Rule Zero check completed:
does this implementation change agent operations/rules requiring updates to `AGENTS.md`.
