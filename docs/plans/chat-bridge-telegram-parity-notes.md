# Chat Bridge Telegram Parity Notes

> Telegram-style reliability lessons translated into Clawchestra's Tauri chat bridge.

## Summary

OpenClaw's Telegram bridge is generally perceived as smoother because it keeps progress visible, sequencing deterministic, and retries controlled. This note extracts the transferable patterns and maps them to Clawchestra's local WS + drawer UX without copying channel-specific UI assumptions.

---

**Roadmap Item:** `chat-infrastructure`
**Status:** Ready
**Created:** 2026-02-24
**Last Updated:** 2026-02-24

---

## Patterns To Emulate

1. Preview-first confidence:
- Show immediate pending acknowledgement after user send.
- Replace preview with real streamed content at first meaningful chunk.

2. Deterministic per-turn routing:
- Keep strong anchoring by turn token/run id + history anchor user message.
- Avoid cross-run contamination when events are unscoped/noisy.

3. Edit/append discipline:
- Progress display can evolve, but convergence to final output must be deterministic.

4. Retry discipline:
- Retry once for transient dispatch failures.
- Preserve idempotency key across retries.

5. Failure explicitness:
- Concise actionable failures beat silent pending states.

## Patterns Not To Copy Directly

1. Channel-specific transport assumptions:
- Telegram update semantics are not identical to local tauri-ws event flow.

2. UI affordances that do not map to drawer/chat-bar composition.

3. Provider features unavailable in desktop local runtime.

## Clawchestra Mapping

1. Pending bubble + activity label:
- Pending bubble appears immediately and clears only on first visible output or failure.
- Activity label persists through entire run lifecycle.

2. Stream/final recovery:
- Deltas drive live preview.
- History polling remains final source of truth for missed-final/noisy-event cases.

3. Queue reliability:
- FIFO queue with one-shot retry and explicit terminal failure on retry exhaustion.

4. Runtime model truth:
- Prefer run-level model/provider extraction.
- Fallback to exact-session snapshot only.
- Connected state without stale model is preferable to incorrect model badge.

## Validation Heuristics

1. User should never wonder if send was accepted.
2. User should see visible progression for long turns where content exists.
3. Completion should not require app restart or nudging follow-up prompt.
4. Rare duplicate is acceptable; missing real output is not.
