# Chat Reliability: Persistent Bugs

Post-audit bug log. The Chat Infrastructure audit was delivered via Codex (commit `605f056`, 2026-02-19) with 650+ lines of reliability improvements including `chat-message-identity.ts`, `chat-turn-engine.ts`, gateway hardening, and dedupe fixes. The following bugs persist or have appeared during testing.

---

## Phase 2: Ongoing Bug Intake (User-Driven)

Validation matrix runs are optional for now. This roadmap item is the active tracker while you test by using Clawchestra chat in real feature delivery work.

### Intake workflow
1. Keep using chat in the app as normal while building roadmap work.
2. When a bug appears, append a new `BUG-###` entry in this document.
3. Use the same structure as existing bugs:
   - `Reported`, `Severity`, `Status`
   - `Symptoms`
   - `Reproduction pattern`
   - `Context`
   - `Likely area`
4. If the behavior overlaps an existing bug, add an `Update (HH:MM)` block under that bug instead of creating a duplicate ID.
5. Keep status values consistent: `Open`, `In progress`, `Needs retest`, `Closed (pending verification)`, `Verified`.

### Optional cross-reference to plan scenarios
When possible, tag each new bug with a matching scenario from:
- `docs/plans/chat-reliability-scenario-matrix.md`
- `docs/plans/chat-infrastructure-persistent-bugs-plan.md`

Use this format at the end of each bug:
- `Scenario links: update-mid-turn, reconnect-mid-run` (or `none yet`)

### Why this structure
This keeps your real-world bug reports directly comparable to the existing tracker and allows a later holistic review/fix pass without re-triaging from scratch.

---

## Bug Log

### BUG-001: Assistant messages not appearing after app update
**Reported:** 2026-02-19 ~02:01
**Severity:** High
**Status:** Open

**Symptoms:**
- Assistant response visible in OpenClaw Gateway Dashboard but not in Clawchestra chat UI
- Messages either never appear or only appear after app restart

**Reproduction pattern (confirmed 2x):**
1. User clicks Update button → app reloads with new code
2. Chat drawer reopened → messages from before the update are partially or fully missing
3. Recovery system fires ("Recovered N recent chat messages") but only retrieves fragments, not complete messages
4. Second occurrence (02:52): Full assistant response (17-file commit summary, bug docs, icon explanation) visible in Gateway Dashboard but entirely absent from Clawchestra. Recovery pulled 9 messages but skipped the substantive ones.

**Context:**
- Both occurrences happened immediately after app update via Update button
- First time: text-only reply missing
- Second time: large multi-section response with tool calls, code blocks, and markdown tables — none of it appeared

**Likely area:** Messages aren't being persisted to SQLite before the app reload triggered by Update. The recovery system (`reconcileRecentHistory`) then tries to backfill from gateway history but its dedup/collapse logic drops or truncates the messages during rehydration.

**Update (02:58):** Behaviour is NOT deterministic. Third Update in same session: this time recent messages (2:54–2:55 exchange) DID recover correctly. However, old tool-call narration fragments from 2:32 also surfaced at the bottom, out of chronological order (see BUG-003). So recovery sometimes works, sometimes doesn't, and when it does it can over-recover stale fragments.

**Update (03:26):** Another post-Update message drop. Multiple assistant messages (spec sufficiency discussion, plan vs spec explanation) visible in Gateway Dashboard but never appeared in Clawchestra chat after Update. Last visible message in drawer was from ~03:13. Consistent with Update-triggered pattern.

---

### BUG-002: User messages missing from chat history
**Reported:** 2026-02-19 ~02:01
**Severity:** High
**Status:** Open

**Symptoms:**
- When scrolling up in chat, large gaps in user message history
- Last visible user message was from 1:36, but user had sent multiple messages between 1:36 and 2:01
- Assistant messages from that period may also be missing or only partially visible
- Second occurrence (02:52): User's long voice-transcribed message (requesting column name fixes) completely absent from chat history after app update

**Reproduction pattern:** Same as BUG-001 — triggered by app update. User messages sent before the update disappear from the chat alongside assistant messages. Recovery system does not restore them.

**Context:**
- Heavy session with many back-and-forth messages
- Multiple compactions occurred (7+ compactions noted in session status)
- App updated mid-session via Update button (both occurrences)

**Likely area:** Chat message persistence (SQLite/store). Messages aren't flushed to persistent storage before the app reload triggered by Update. The recovery system fetches from gateway history but gateway may not store user messages (only assistant turns), so user messages are permanently lost. `collapseChatDuplicates` / `collapseTrailingAssistantRun` in `store.ts` may also be over-aggressively deduping what does get recovered.

**Key insight:** The Update button triggers an app reload without first persisting in-memory chat state. This is the common root cause for both BUG-001 and BUG-002.

---

### BUG-003: Streaming delta fragments as separate messages
**Reported:** 2026-02-18 ~23:52
**Severity:** Medium
**Status:** Open — may be addressed by Codex audit, needs retest

**Symptoms:**
- Final reply appeared first, then intermediate tool-call narration fragments appeared as separate message bubbles below it
- "Recovered N" system bubble appeared at bottom
- User messages missing between assistant replies

**Additional occurrence (02:58):** After app Update, recovery correctly pulled recent messages but ALSO surfaced two old tool-call narration fragments from 25 minutes earlier (2:32), appending them at the bottom out of chronological order. The fragments were "Now update the compliance block and AGENTS.md with the new status values:" and "Now sync compliance to CLAUDE.md and .cursorrules:" — these are pre-tool-call narration text, not standalone messages.

**Likely area:** `reconcileRecentHistory` surfacing gateway history fragments that should be collapsed into a single turn. `collapseChatDuplicates` not merging same-turn content blocks. The recovery system has no concept of turn boundaries — it treats every content block from the gateway as a potential standalone message, so narration fragments preceding tool calls get promoted to full message bubbles.

**Update (21:51):** Reproduced again during a long tool-heavy turn (~21:45–21:51). A single streaming message (agent reading files, running tests, writing bugs) was being received as one large chat bubble. Mid-stream, the typing animation stopped, the single bubble split into 7+ separate fragment bubbles (visible in screenshot: "Now update the tests to match:", "All passing. Let me run the full test suite...", "141 tests passing. Now let me check TypeScript compilation:", etc.). The final summary message ("Here's the summary: Done — three things handled...") was delivered to the gateway but never appeared in the chat drawer. Status badge still showed "Connected" throughout. Identical triple-symptom: fragment split + animation drop + message loss. No app update or compaction involved this time — pure streaming pipeline failure during a normal long turn.

---

### BUG-004: Post-compaction message drop
**Reported:** 2026-02-19 ~02:44
**Severity:** High
**Status:** Open

**Symptoms:**
- After conversation compaction, the last assistant message in Clawchestra chat was "Now let me check the tests and my own sandbox files:" (a mid-tool-call narration fragment)
- The actual final assistant message (ending with "Want me to fix all of these or just the critical and medium ones?") was visible in OpenClaw Gateway Dashboard but never appeared in Clawchestra
- The full column name drift audit response was delivered to Gateway but not to the app

**Context:**
- Compaction occurred mid-conversation during a heavy session
- The assistant continued working after compaction (memory flush, then audit response)
- Likely the compaction event disrupted the streaming/polling pipeline and the subsequent assistant turn's content was never picked up

**Likely area:** Compaction event handling in `gateway.ts` — all three states (`compacting`, `compacted`, `compaction_complete`) emit the same "Conversation compacted" bubble immediately. The compaction may interrupt an in-flight poll cycle or cause the send promise to resolve prematurely, dropping subsequent content. The `shouldSuppressForActiveSend` guard (line ~1437) may also be suppressing the post-compaction assistant message.

---

### BUG-005: Compaction bubble shows "compacted" before compaction finishes
**Reported:** 2026-02-19 ~02:44
**Severity:** Medium
**Status:** Open

**Symptoms:**
- "Conversation compacted" bubble appears as soon as the `compacting` state is received from the gateway
- User then sees "Thinking..." activity indicator for an extended period while compaction actually finishes
- Misleading UX: user thinks compaction is done and agent is just slow to reply, when actually compaction is still in progress

**Root cause:** `gateway.ts` line ~1444 treats all three states identically:
```ts
if (state === 'compacted' || state === 'compacting' || state === 'compaction_complete') {
  emit({ kind: 'compaction', sessionKey, runId, message: 'Conversation compacted' });
}
```

**Proposed fix:** 
- On `compacting` state: show bubble with spinner and text "Compacting conversation..."
- On `compacted` / `compaction_complete` state: update bubble to "Conversation compacted" (no spinner)
- Requires adding a `loading` state to `SystemBubbleMeta` or a new `compacting` SystemBubbleKind

---

### BUG-006: Stuck "Working..." animation after response completes
**Reported:** 2026-02-19 ~03:09
**Severity:** High
**Status:** Open (regression)

**Symptoms:**
- "Working..." text animation and "..." chat bubble continue playing after assistant has finished responding
- OpenClaw Gateway Dashboard shows no active work (no pulsing animation, response complete)
- Clawchestra chat never clears the activity state
- User cannot send follow-up messages (they queue instead of sending, because the app thinks a turn is still active)
- Workaround: restart the app

**Context:**
- Previously fixed in commit `98a1189` (process.poll error handling, WS error extraction, hydration stale window)
- Regression: same symptom has returned, possibly different trigger
- Observed after a normal text-only response (no tool calls, no streaming complexity)
- The response was fully received and displayed in the chat drawer — only the activity state failed to clear

**Likely area:** The turn lifecycle isn't reaching its terminal state. `gatewayActiveTurns` in the store may not be clearing, or the `final` / `completed` event from the gateway is being missed/suppressed. The `shouldSuppressForActiveSend` guard or the poll cycle may be dropping the terminal event.

**Impact:** High — blocks the user from sending any further messages without restarting. Effectively kills the chat session.

---

### BUG-007: Claude Code /plan hangs at "Beaming" / "Propagating" — never writes output
**Reported:** 2026-02-19 ~03:27
**Severity:** Medium (workflow blocker, not app bug)
**Status:** Open — workaround: write plans manually

**Symptoms:**
- Claude Code `/plan` command explored codebase thoroughly (3 Explore sub-agents, 26+ tool uses, read 10+ files)
- Reached "I now have a thorough understanding. Let me write the implementation plan."
- Then stuck on "Beaming..." / "Propagating..." for 5+ minutes with no token output progress (stayed at ↓1.4k/13.8k tokens)
- Plan file never written to disk
- Killed and retried — second attempt same result (different execution path, no sub-agents, but stuck at same "Beaming" write phase)
- Two orphan Claude Code processes from earlier sessions (PIDs 33942, 39045) were consuming resources — killed, but didn't unstick the hang

**Context:**
- 16GB MacBook Pro — multiple Claude Code processes competing for resources
- First attempt used `/plan` mode (sub-agents), second attempt used direct prompt in bypass mode
- Both reached 38% context, both stalled at the output writing phase
- The exploration and reading phases worked fine — only the large document write fails

**Impact on Clawchestra chat:**
- Last message received in Clawchestra chat drawer was: *"'I now have a thorough understanding. Let me write the implementation plan.' — it's about to write the file. 38% context."*
- After that, the Working... animation died and no further messages appeared in the chat
- User only learned about the /plan failure and subsequent retry/kill via OpenClaw Gateway Dashboard
- This is a combination of BUG-006 (stuck animation) and BUG-001 (messages not appearing) — the assistant continued working and sending messages, but none were delivered to the Clawchestra UI

**Likely cause:** Claude Code's output generation for very large documents (implementation plans are typically 500+ lines) may be hitting API timeouts or memory limits on constrained hardware. The sub-agent propagation mechanism appears particularly fragile.

**Workaround:** Write plans directly rather than via Claude Code `/plan` on 16GB machines.

---

## Successful Session Reference

### SUCCESS-001: /plan_review sub-agent run — chat stayed connected
**Observed:** 2026-02-19 ~03:43–03:53
**Significance:** Provides a working baseline for comparison with BUG-001/006/007 failures.

**What happened:**
- Claude Code `/plan_review docs/plans/git-sync-plan.md` launched via tmux at ~03:43
- 3 sub-agents spawned and completed: DHH (80.2k tokens, 16 tool uses), Kieran (99.2k tokens, 20 tool uses), Code Simplicity (47.7k tokens, 17 tool uses)
- Parent synthesized results and output full review (~14.9k output tokens)
- Total wall time: ~10 minutes
- **Clawchestra chat stayed Connected the entire time** — Working... animation behaved correctly, messages delivered, no drops

**Triggering message:** User sent structured /plan_review request at 03:43
**Final received message:** Full plan review synthesis with consensus issues, strong recommendations, minor issues, and praise sections — all rendered correctly in chat drawer

**Key differences from failed runs (BUG-007):**
- `/plan_review` (review existing doc) vs `/plan` (generate new doc) — review output is shorter than a full plan
- No app Update during the run
- Only one Claude Code process running (orphans killed beforehand)
- 26% context used (vs 38% on the hung /plan runs)

**Why this matters:** Future agents investigating chat reliability bugs should compare this successful run's gateway logs against failed runs to identify what differs in the event stream, polling, and activity state transitions.

---

### BUG-008: Post-compaction memory flush narration leaks to user
**Reported:** 2026-02-19 ~21:37
**Severity:** Medium
**Status:** Open

**Symptoms:**
- After compaction, the first message the user sees is NOT the direct reply to their message
- Instead, internal narration from the memory flush turn appears first: messages like "File exists with the morning build notes. I need to append the afternoon/evening session content." and "NO_REPLY"
- These are visible in the OpenClaw Gateway Dashboard as separate message bubbles
- The actual reply (responding to the user's post-compaction message) arrives later but initially gets buried under the narration noise
- User is confused: they sent a question but get tool-call narration about file operations instead of an answer

**Root cause analysis:**
- Before auto-compaction, OpenClaw runs a "silent memory flush" turn (documented in OpenClaw compaction docs)
- This memory flush is a regular agent turn with tool calls (reading/writing memory files)
- The narration of those tool calls ("File exists...", "Good, I have full context") gets streamed as chat events
- The final `NO_REPLY` token suppresses the turn's final output, but intermediate block-streamed narration has already been delivered to the chat
- The Clawchestra chat drawer (and gateway dashboard) render these intermediate narration fragments as user-visible messages

**Reproduction:**
1. Have a long session that triggers auto-compaction
2. Send a message after compaction completes
3. Observe: memory flush narration fragments appear before the actual reply

**Possible approaches:**
- **App-side:** Suppress or collapse messages that contain only tool narration + NO_REPLY within the same turn (turn-boundary awareness needed — relates to BUG-003's turn grouping)
- **OpenClaw-side:** The memory flush turn could emit with a "silent" or "internal" flag so downstream clients know to suppress narration
- **Hybrid:** Tag memory flush turns distinctly in the event stream; app filters them from display

**Scenario links:** recovery-cursoring, compaction-mid-run

---

### BUG-009: Typing animation persists during compaction — no distinct UX state
**Reported:** 2026-02-19 ~21:37
**Severity:** Medium
**Status:** Open — research complete, fix ready for implementation

**Symptoms:**
- After the agent sends its last pre-compaction message, the `typing…` animation persists for a long time
- This continues throughout the entire compaction process (visible as a blue bubble + spinner in the OpenClaw Gateway Dashboard)
- User sees `typing…` or `Working...` and expects another message, when actually the system is just compacting context
- Only after compaction finishes and the post-compaction turn completes does the animation stop
- Misleading: user waits for a response that isn't coming (it's infrastructure work, not a reply)

**Research findings (2026-02-19 ~21:45):**

1. **OpenClaw emits distinct `stream: "compaction"` events** with `{ phase: "start" }` and `{ phase: "end", willRetry }` — these are separate from `assistant` or `tool` streams (source: `pi-embedded-subscribe.handlers.compaction.ts` in dist)

2. **The OpenClaw Gateway Dashboard already handles this** — it has:
   - `compactionStatus` reactive state (`{active, startedAt, completedAt}`)
   - `compaction-indicator--active` and `compaction-indicator--complete` CSS classes
   - A "Compaction" divider in the message list for compaction entries
   - The `yg()` function processes `stream: "compaction"` events and updates state

3. **Clawchestra already handles compaction events partially** — the chat drawer:
   - Listens for `compacting` / `compacted` / `compaction_complete` chat states (gateway.ts lines ~1540-1555)
   - Emits `kind: 'compaction'` system events → shows "Compacting conversation..." or "Conversation compacted" system bubbles
   - Feature-flagged via `CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states` (currently `true`)
   - BUT: the `agentActivity` state does NOT change during compaction — it stays as `typing` or `working` from the pre-compaction turn

4. **The gap:** The `chatActivityLabel` in App.tsx drives the "Working..." / "Typing..." indicator, but has no `compacting` state. During compaction:
   - `agentActivity` remains `working` (set during the pre-compaction turn, never cleared until post-compaction turn finishes)
   - `isChatBusy` remains `true` (because `gatewayActiveTurns > 0` during compaction)
   - Result: `chatActivityLabel` shows "Working..." even though compaction has started

**Proposed fix:**
- Add `'compacting'` to the `agentActivity` union type: `'idle' | 'typing' | 'working' | 'compacting'`
- In `App.tsx` compaction event handler, set `setAgentActivity('compacting')` when `compactionState === 'compacting'`
- In `chatActivityLabel` useMemo, add: `if (agentActivity === 'compacting') return 'Compacting...';`
- On compaction complete, let the normal post-compaction turn lifecycle reset activity to `working` → `idle`
- Optionally: show a different animation/icon for compacting (e.g., the Layers icon already mapped in SystemBubble.tsx) vs the dots animation for typing/working

**Files to change:**
- `src/lib/store.ts` — add `'compacting'` to agentActivity type
- `src/App.tsx` — set activity to `'compacting'` in compaction event handler; add to chatActivityLabel
- `src/components/chat/ChatBar.tsx` — optionally different animation for compacting
- `src/components/chat/MessageList.tsx` — optionally different reading indicator for compacting

**Scenario links:** compaction-mid-run

---

## Audit Baseline

The Codex chat audit (commit `605f056`) delivered:
- `chat-message-identity.ts` — message identity signatures for dedup
- `chat-turn-engine.ts` — turn lifecycle state machine
- `gateway.ts` — 157 lines changed (hardened streaming, error handling, logging)
- `store.ts` — 54 lines changed (dedup logic)
- `gateway.test.ts` — 30 new test lines
- `chat-message-identity.test.ts` — 48 new test lines
- `chat-turn-engine.test.ts` — 40 new test lines
- `docs/plans/chat-reliability-scenario-matrix.md` — test scenarios

Prior fixes in this area:
- `98a1189` — GitHub 403 + stuck activity animation (process.poll error handling, WS error extraction, hydration stale window)
- `6d35643` — harden chat dedupe, queue drain, recovery reconciliation
- `b01dc48` — don't resolve send when process.poll fails
- `c45a682` — bound no-final waiting when process.poll scope unavailable
