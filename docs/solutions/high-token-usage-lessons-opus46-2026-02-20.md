# High Token Usage Lessons (Opus 4.6)

> Incident review of rapid token burn in a single OpenClaw session and the concrete operating lessons for Clawchestra.

## Summary

On 2026-02-20, one `agent:main:pipeline-dashboard` session consumed about **22.8M tokens** and about **$89** (OpenClaw telemetry). The highest-cost part was a short `/build` tmux investigation that conceptually found a simple fix (Tab completion for custom command resolution), but still consumed about **7.0M tokens** and about **$24** because it ran many model/tool loops inside a near-full long-lived context.

This document captures what happened and the practical guardrails to prevent repeats.

---

**Session File:** `/Users/piercekearns/.openclaw/agents/main/sessions/7d4c90ef-da5d-4a4c-b9c8-134944ae8bb7.jsonl`  
**Window Reviewed:** `2026-02-20T01:18:39Z` to `2026-02-20T02:37:23Z`  
**Model:** `anthropic/claude-opus-4-6`  
**Thinking Level:** `high`  
**Context Ceiling:** `200000` tokens (session observed near ~173k scale)  
**Reviewed:** 2026-02-20

---

## What Happened

### Daily footprint (same session, 2026-02-20)

- User prompts: `14`
- Assistant model calls: `141`
- Tool-result turns: `127`
- Total tokens: `22,849,552`
- Cache read: `9,458,137`
- Cache write: `13,356,514`
- Cost: `$89.076426`

### Top expensive turns

1. Turn 13 (`/build` tmux command-resolution investigation)
   - `42` assistant calls, `41` tool calls
   - `6,976,623` tokens, `$24.16`
2. Turn 5 (Git Sync modified/added/deleted enhancement)
   - `35` assistant calls, `34` tool calls
   - `5,576,508` tokens, `$22.52`

Top 2 turns accounted for about **54.9%** of daily token usage.

### What was delivered in this window

- Added rate-limit resilience roadmap/spec (`3c17a90`)
- Sync Dialog UX fix (`4516ce0`)
- File-status display in Git Sync (`c2d9041`)
- Bug logging commit (`1b639fa`)
- AI commit-message roadmap/spec (`e919a64`)
- Verified Git Sync commits in both repos (`5fa507c`, `f2584bc3`)
- `/build` tmux command-resolution fix (`f40c557`)

---

## Why a “Short Investigation” Became Expensive

The `/build` investigation itself was short in wall-clock time, but expensive in inference pattern:

1. **High loop count:** many small probe steps (`tmux capture-pane`, `sleep`, `send-keys`, re-check).
2. **One model turn per probe:** each tool hop triggered another assistant call.
3. **Large context per call:** with a near-full session, each call carried a high baseline.
4. **High thinking + Opus:** good quality, high per-turn price.
5. **Compounding effect:** even “tiny” diagnostic probes were expensive at this context size.

Observed in this session: average assistant call on 2026-02-20 was roughly **162k tokens**.  
That means dozens of probe loops can burn millions of tokens even when the conceptual bug is simple.

---

## Lessons Learned

1. **Token burn is dominated by loop count at high context, not by problem complexity.**
2. **tmux is not the cost driver.** Repeated model-tool round trips are.
3. **Long-lived sessions need hard budgeting.** Near-context-cap operation makes each extra turn costly.
4. **Diagnostic work should default to batching, not interactive probing.**
5. **Use cheaper mode for exploration, premium mode for synthesis/final edits.**

---

## Guardrails to Use Going Forward

### A. Investigation loop budget

- Set a hard cap (for example `<= 8` tool loops) before forced summarize/replan.
- If unresolved after cap: switch strategy, don’t keep probing.

### B. Batch tmux diagnostics

- Prefer one scripted `exec` that does:
  - capture pane
  - send command
  - wait once
  - capture final state
- Avoid repeated single-step `sleep/capture/send` cycles unless strictly necessary.

### C. Session cost hygiene

- Rotate to a fresh session before deep debugging when context is high.
- Avoid doing long diagnostics in sessions already near ceiling.

### D. Model routing discipline

- Use lower-cost model / lower thinking for exploratory diagnostics.
- Reserve Opus + high thinking for final synthesis and code changes.

### E. Prompt-level efficiency

- Put full diagnostic objective in one prompt up front.
- Ask for a concrete multi-step plan first, then execute that plan in fewer tool batches.

---

## Practical Heuristic

When a session is large, assume each additional assistant/tool round can be expensive.  
Treat every incremental probe as billable budget, not “free debugging.”

If a task is “small but uncertain,” first optimize **method** (few batched turns), then optimize **content**.

---

## Follow-Up Candidates

1. Add a token-cost warning in Clawchestra when session context and loop count are high.
2. Add a “diagnostic mode” lifecycle path that enforces batched tmux probes.
3. Add automatic “summarize and reset session” suggestion once threshold is crossed.
4. Lower default thinking for non-build/non-review flows.

