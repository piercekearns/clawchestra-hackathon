# Chat Bridge Protocol Contract

> Canonical event and terminality contract for Clawchestra's OpenClaw bridge.

## Summary

This contract defines which OpenClaw events can drive user-visible chat progression, how turn lifecycle state transitions are authorized, and how terminal outcomes are derived when event streams are partial or noisy. It is designed to keep chat truthfulness stable across reconnects, missing finals, fallback provider routing, and recovery replays.

---

**Roadmap Item:** `chat-infrastructure`
**Status:** Ready
**Created:** 2026-02-24
**Last Updated:** 2026-02-24

---

## Event Authority

1. `chat.delta|content|streaming`:
- Drives first-visible output and streaming progression.
- Can replace synthetic pending bubble only when extracted text is non-empty.

2. `chat.final`:
- Provisional terminal signal.
- Must still pass history settle checks to avoid premature finalization on sparse/noisy runs.

3. `chat.error|error-stop|aborted`:
- Immediate terminal failure for run-scoped events.

4. `agent`:
- Liveness signal only.
- May keep lifecycle active, but never authorizes visible-content transitions by itself.

5. `chat.history` polling:
- Authoritative fallback for final assistant materialization.
- Required for ack-loss and missed-final paths.

## Turn Lifecycle Contract

1. Active states: `queued`, `running`, `awaiting_output`.
2. Terminal states: `completed`, `failed`, `timed_out`.
3. Exactly one terminal transition per turn token.
4. Queue eligibility is derived only from active-state count.

## Idempotency Contract

1. Every send has a stable idempotency key.
2. Queued auto-retry reuses the same idempotency key.
3. If first attempt was accepted upstream but ack lost, retry must not create a duplicate user turn.

## Recovery and Hydration Contract

1. Persisted pending turns are treated as migration data.
2. Legacy statuses map deterministically into active states when possible.
3. Unknown/terminal legacy statuses are terminalized and removed from active queue blockers.
4. Recovery merge ordering is chronological before dedupe.

## Model/Provider Truth Contract

1. Truth order:
- Run-level metadata from send/chat events.
- Exact session snapshot (`sessions.list`) without defaults fallback.
- Unknown/Connected fallback state.

2. Never show defaults/config as active truth in connected runtime.
3. If run-level truth is present, retain briefly before snapshot reconciliation.

## Terminal Reason Families

1. `completed_from_final_or_history`
2. `completed_from_history_without_final`
3. `timeout_active_no_final`
4. `timeout_no_events`
5. `chat_error_event`
6. `chat_aborted_event`
7. `send_failed`

## Explicit Non-Authoritative Signals

1. Text content that happens to include `agent:` identifiers.
2. Unscoped agent chatter without run/session ownership.
3. Empty delta/final payloads.
4. Provider defaults in session config.
