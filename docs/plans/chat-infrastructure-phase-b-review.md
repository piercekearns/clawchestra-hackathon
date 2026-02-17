# Chat Infrastructure Phase B: Plan Review

## Scope
Reviewed against:
- `docs/plans/chat-infrastructure-phase-b-plan.md`
- `docs/specs/chat-infrastructure-phase-b-spec.md`
- `docs/plans/chat-infrastructure-phase-a-plan.md`
- `src/components/chat/MessageBubble.tsx`
- `src/components/chat/MessageList.tsx`
- `src/components/chat/ChatShell.tsx`
- `src/lib/gateway.ts`
- `src/lib/store.ts`
- `src-tauri/src/lib.rs`

## Findings (Ordered by Severity)

### Critical
1. **Phase B plan proposes a new `system_meta` DB column, but the codebase already has a generic `metadata` column and API path.**
- Plan: `docs/plans/chat-infrastructure-phase-b-plan.md:38` to `docs/plans/chat-infrastructure-phase-b-plan.md:43`
- Actual schema: `src-tauri/src/lib.rs:1694` to `src-tauri/src/lib.rs:1700`
- Actual Rust model: `src-tauri/src/lib.rs:1724` to `src-tauri/src/lib.rs:1733`
- Actual TS persistence type: `src/lib/tauri.ts:219` to `src/lib/tauri.ts:225`
- Impact: unnecessary migration risk, duplicated semantics (`metadata` vs `system_meta`), and likely divergence between read/write paths.
- Recommendation: reuse `metadata` as JSON envelope for `systemMeta` instead of introducing a new DB column.

2. **Plan does not fully wire `systemMeta` through real persistence boundaries.**
- Plan writes about DB changes but not full frontend persistence pipeline.
- Current save path drops metadata entirely: `src/lib/store.ts:123` to `src/lib/store.ts:128`
- Current load path drops metadata entirely: `src/lib/store.ts:146` to `src/lib/store.ts:150`, `src/lib/store.ts:190` to `src/lib/store.ts:193`
- Impact: system bubbles will disappear after reload, and older pagination will lose structured metadata.
- Recommendation: include metadata serialization/deserialization in store load/save code and `PersistedChatMessage` mapping.

3. **Phase B depends on Phase A prerequisites that are not present in current source.**
- Phase B prerequisite claim: `docs/plans/chat-infrastructure-phase-b-plan.md:5` and `docs/plans/chat-infrastructure-phase-b-plan.md:8`
- Session key is still old default in code: `src/lib/gateway.ts:627`, `src/lib/gateway.ts:631`, `src/lib/gateway.ts:1043`, `src-tauri/src/lib.rs:667`, `src-tauri/src/lib.rs:775`, `src-tauri/src/lib.rs:780`
- Reconnection state machine and `getConnectionInstance` are not implemented in current `tauri-websocket`: `src/lib/tauri-websocket.ts:26` to `src/lib/tauri-websocket.ts:253`
- Impact: completion/failure routing assumptions are unstable until Phase A is actually landed.
- Recommendation: gate Phase B implementation behind a concrete “Phase A landed” check list, not just a document dependency.

4. **Compaction detection design only observes events during active send flow, not globally.**
- Plan callback design inside `sendViaTauriWs`: `docs/plans/chat-infrastructure-phase-b-plan.md:224` to `docs/plans/chat-infrastructure-phase-b-plan.md:235`
- Current event subscription is local to each send call: `src/lib/gateway.ts:662` to `src/lib/gateway.ts:835`
- Impact: compaction events occurring outside active send are missed, violating awareness goal in spec (`docs/specs/chat-infrastructure-phase-b-spec.md:89` to `docs/specs/chat-infrastructure-phase-b-spec.md:106`).
- Recommendation: use a durable, app-lifetime subscription layer for system events.

### High
5. **Announce detection is too heuristic and likely false-positives/false-negatives.**
- Plan heuristic: `docs/plans/chat-infrastructure-phase-b-plan.md:299` to `docs/plans/chat-infrastructure-phase-b-plan.md:315`
- Impact: normal assistant text containing “task completed” or emoji can be misclassified; announces lacking these strings can be missed.
- Recommendation: parse structured gateway payload first, and only fallback to text heuristics with strict guards (session key, event source, explicit marker).

6. **Plan leaves duplicate rendering behavior unresolved (“or do — user preference”).**
- Ambiguity: `docs/plans/chat-infrastructure-phase-b-plan.md:340`
- Impact: inconsistent UX and testability (same event may show as both system bubble + assistant message or only one depending on ad hoc choice).
- Recommendation: choose one deterministic rule for Phase B and document it.

7. **Background error subscription proposal is under-specified for lifecycle and reconnect behavior.**
- Plan proposal: `docs/plans/chat-infrastructure-phase-b-plan.md:364` to `docs/plans/chat-infrastructure-phase-b-plan.md:385`
- Plan itself flags lifetime risk: `docs/plans/chat-infrastructure-phase-b-plan.md:536`
- Impact: silent failure if no active connection instance, stale subscriptions on reconnect, or duplicate listeners.
- Recommendation: define owner (App vs gateway module), subscription timing, reconnect rebind strategy, and dedupe policy.

8. **Spec/plan mismatch on process-session crash detection.**
- Spec requires polling `process action:poll`: `docs/specs/chat-infrastructure-phase-b-spec.md:73` to `docs/specs/chat-infrastructure-phase-b-spec.md:77`
- Plan says “no code change”: `docs/plans/chat-infrastructure-phase-b-plan.md:415` to `docs/plans/chat-infrastructure-phase-b-plan.md:418`
- Impact: Phase B plan does not satisfy stated detection source #2 in spec.

9. **MessageList unread indicator ignores system messages; system alerts can appear silently while user is scrolled up.**
- Current logic only marks new assistant messages: `src/components/chat/MessageList.tsx:116` to `src/components/chat/MessageList.tsx:120`
- Impact: failure/compaction bubbles can be missed in long threads.
- Recommendation: include `system` role (or critical system kinds) in new-message indicator policy.

### Medium
10. **SystemBubble accessibility design is weak for alert semantics.**
- Planned component uses plain `div/span` and color cues: `docs/plans/chat-infrastructure-phase-b-plan.md:108` to `docs/plans/chat-infrastructure-phase-b-plan.md:167`
- Gaps:
  - no `role="status"` or `role="alert"` for assistive tech
  - action hints are non-interactive text spans, not keyboard-usable controls (`docs/plans/chat-infrastructure-phase-b-plan.md:145` to `docs/plans/chat-infrastructure-phase-b-plan.md:155`)
  - very small text (`text-[10px]`, `text-[11px]`) harms readability

11. **SystemBubble responsiveness risks with long values.**
- Detail rows render as `flex` with no explicit wrapping strategy: `docs/plans/chat-infrastructure-phase-b-plan.md:127` to `docs/plans/chat-infrastructure-phase-b-plan.md:133`
- Likely overflow for long task labels/session keys/errors on narrow widths.
- Recommendation: add `break-words` / `min-w-0` / stacked layout on mobile.

12. **Planned body rendering suppresses `content` when `details` exist.**
- Conditional: `docs/plans/chat-infrastructure-phase-b-plan.md:138`
- Impact: loses supplemental context when both details and body are present.

13. **Type safety regression in SystemBubble maps.**
- Uses `Record<string, ...>` instead of `Record<SystemBubbleKind, ...>`: `docs/plans/chat-infrastructure-phase-b-plan.md:73`, `docs/plans/chat-infrastructure-phase-b-plan.md:81`, `docs/plans/chat-infrastructure-phase-b-plan.md:89`
- Impact: misses compile-time exhaustiveness when new bubble kinds are added.

14. **Plan references files/structures that do not exist as named.**
- `src/lib/chat-db.ts` is referenced but persistence is currently in `src/lib/tauri.ts` + `src/lib/store.ts` + Rust Tauri commands.
- `ChatMessageRow` is referenced in plan (`docs/plans/chat-infrastructure-phase-b-plan.md:45` to `docs/plans/chat-infrastructure-phase-b-plan.md:57`) but current Rust type is `ChatMessage` (`src-tauri/src/lib.rs:1724` to `src-tauri/src/lib.rs:1733`).

15. **Plan includes out-of-repo AGENTS.md modification as a build step.**
- `docs/plans/chat-infrastructure-phase-b-plan.md:453`
- Impact: not reviewable/reproducible in this repo’s CI, and easy to drift.

## Conflicts with Existing `MessageBubble` / `MessageList`
1. **Unread indicator behavior conflict:** currently assistant-only (`src/components/chat/MessageList.tsx:116` to `src/components/chat/MessageList.tsx:120`), but Phase B system alerts are high-signal and should probably trigger the indicator.
2. **Fallback behavior is compatible but incomplete:** plan says no `MessageBubble` changes (`docs/plans/chat-infrastructure-phase-b-plan.md:492`), but persistence drops metadata today (`src/lib/store.ts:146` to `src/lib/store.ts:150`), so many “systemMeta bubble” messages will degrade to plain bubbles after reload.
3. **Key strategy remains brittle:** current keys are content/timestamp slices (`src/components/chat/MessageList.tsx:170`); plan’s system key example can also collide under fast inserts. Prefer durable message IDs from persistence layer.

## Missing Test Scenarios
1. **Persistence round-trip for system bubble metadata** (save -> reload -> load more pagination).
2. **Migration compatibility** for existing `chat.db` with/without metadata fields.
3. **False-positive/false-negative announce classification tests** for `parseAnnounceMetadata`.
4. **Compaction event handling outside active `send` lifecycle** (idle/background).
5. **Background error listener reconnect behavior** (single listener, no duplicate bubbles).
6. **Unread indicator behavior for system bubbles while scrolled up.**
7. **Accessibility checks** (`role`, keyboard reachability, readable sizes, screen reader announcement behavior).
8. **Mobile overflow tests** with long `details` values and long action labels.
9. **Duplicate suppression tests** when same announce is observed via both event and history fetch.

## Underspecified Implementation Details
1. **Canonical metadata schema** for persisted system messages (`metadata` JSON shape, versioning, validation).
2. **Ordering policy** between system bubble and corresponding assistant message.
3. **Deduplication strategy** for repeated announces/errors across reconnects/history replays.
4. **Lifecycle owner** for long-lived gateway subscriptions.
5. **Failure taxonomy mapping** (`error`, `timeout`, `aborted`, process-killed) to bubble kinds/icons/actions.
6. **Action semantics** for `actions` strings (plain text only vs actionable controls).

## Cross-Check: Phase B Assumptions vs Phase A Plan
1. **Assumption:** `getConnectionInstance()` exists.
- Phase A plan includes this (`docs/plans/chat-infrastructure-phase-a-plan.md:226`).
- Current codebase does not yet have it (`src/lib/tauri-websocket.ts:218` to `src/lib/tauri-websocket.ts:253`).

2. **Assumption:** WS reconnection state machine is available for stable background subscriptions.
- Phase A includes it (`docs/plans/chat-infrastructure-phase-a-plan.md:126` to `docs/plans/chat-infrastructure-phase-a-plan.md:225`).
- Current codebase does not yet have state tracking APIs.

3. **Assumption:** scoped session key is `agent:main:pipeline-dashboard`.
- Phase A includes this (`docs/plans/chat-infrastructure-phase-a-plan.md:13` to `docs/plans/chat-infrastructure-phase-a-plan.md:24`).
- Current code still defaults to `agent:main:main` in TS and Rust.

4. **Assumption from Phase B not clearly covered in Phase A:** long-lived event subscription semantics across reconnect.
- Phase A defines connection state callbacks, but not a specific durable event-subscription abstraction for chat-system events.
- Phase B should explicitly define this contract instead of leaving it as a discovery item.

## What Phase B Plan Gets Wrong About Current Codebase
1. Persistence is not in `src/lib/chat-db.ts`; it is in `src/lib/tauri.ts`, `src/lib/store.ts`, and `src-tauri/src/lib.rs`.
2. SQLite already has `metadata` field, so `system_meta` as a new column is likely redundant.
3. Rust chat persistence struct is `ChatMessage`, not `ChatMessageRow`.
4. App send handler is `sendChatMessage`, not `handleSend`.
5. Current gateway/session defaults still use `agent:main:main`; Phase A assumptions are not reflected in current source yet.

## Recommended Plan Corrections (Concise)
1. Replace `system_meta` proposal with `metadata` JSON envelope and define exact shape.
2. Add explicit store + tauri mapping changes for metadata load/save.
3. Define a single durable gateway event bus in Phase B (not per-send callbacks) for compaction/failure/completion awareness.
4. Make announce detection deterministic and test-driven; remove unresolved “or do” branch.
5. Expand test plan to include persistence, reconnect, accessibility, and mobile overflow scenarios.
