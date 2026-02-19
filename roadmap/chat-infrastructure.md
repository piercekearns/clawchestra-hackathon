# Chat Reliability: Persistent Bugs

Post-audit bug log. The Chat Infrastructure audit was delivered via Codex (commit `605f056`, 2026-02-19) with 650+ lines of reliability improvements including `chat-message-identity.ts`, `chat-turn-engine.ts`, gateway hardening, and dedupe fixes. The following bugs persist or have appeared during testing.

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

### BUG-003: Streaming delta fragments as separate messages (from 2026-02-18)
**Reported:** 2026-02-18 ~23:52
**Severity:** Medium
**Status:** Open — may be addressed by Codex audit, needs retest

**Symptoms:**
- Final reply appeared first, then intermediate tool-call narration fragments appeared as separate message bubbles below it
- "Recovered N" system bubble appeared at bottom
- User messages missing between assistant replies

**Likely area:** `reconcileRecentHistory` surfacing gateway history fragments that should be collapsed into a single turn. `collapseChatDuplicates` not merging same-turn content blocks.

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
