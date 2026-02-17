# Chat Infrastructure Phase A: Plan Review

Reviewed files:
- `docs/plans/chat-infrastructure-phase-a-plan.md`
- `docs/specs/chat-infrastructure-phase-a-spec.md`
- `src-tauri/src/lib.rs`
- `src/lib/gateway.ts`
- `src/App.tsx`

## Executive Summary
The plan is directionally good, but it has several high-impact mismatches with the current codebase. The biggest issue is that the spec/plan assumes CLI (`openclaw_chat`) is the primary chat transport, while the app currently defaults to `tauri-ws`. That makes some proposed reliability work (CLI retries) less impactful than described and invalidates parts of the manual test matrix.

## Findings (Ordered by Severity)

### 1. Critical: Current transport model in spec/plan is inaccurate
- Spec claims current chat flow is CLI-first (`openclaw_chat` + polling): `docs/specs/chat-infrastructure-phase-a-spec.md:59`.
- Current app path is WS-first by default:
  - `App` sends through `sendMessageWithContext(...)`: `src/App.tsx:532`.
  - Default transport resolves to `tauri-ws` when Tauri config is available: `src/lib/gateway.ts:258`, `src/lib/gateway.ts:269`.
  - `tauri-ws` path uses `sendViaTauriWs(...)`: `src/lib/gateway.ts:989`, `src/lib/gateway.ts:994`.
- Impact:
  - Step 4 (`gateway_call()` retries in Rust) helps `tauri-openclaw` mode and backend command paths, but not the default frontend send path.
  - Spec assertions about current architecture and expected resilience gains are overstated unless transport strategy changes.

### 2. High: Session key isolation changes are incomplete in frontend
- Plan Step 1 lists 3 replacements in `src/lib/gateway.ts` (`:627`, `:631`, `:1043`), but misses `src/lib/gateway.ts:572` (`'main'` fallback in `sendViaOpenClawWs`).
- Impact:
  - If `openclaw-ws` transport is used, it can still hit shared/default session semantics.
- Recommendation:
  - Update all session-key fallbacks consistently across all transports, not only `tauri-ws` checks.

### 3. High: Retry button proposal conflicts with current ChatBar structure
- In floating mode, the header is already a `<button>` wrapper: `src/components/chat/ChatBar.tsx:161`.
- Plan Step 7c inserts another `<button>` inside that header (`docs/plans/chat-infrastructure-phase-a-plan.md:321`).
- Impact:
  - Nested button is invalid HTML and can break click/keyboard behavior.
- Recommendation:
  - Refactor floating header container to a non-button element or place retry action outside the clickable header button.

### 4. High: Reconnect bootstrap/manual retry gap when initial connect fails
- Plan removes polling effect and does one initial `checkGatewayConnection()`: `docs/plans/chat-infrastructure-phase-a-plan.md:264`, `docs/plans/chat-infrastructure-phase-a-plan.md:270`.
- Proposed retry path calls `getConnectionInstance()?.retryManually()` (`docs/plans/chat-infrastructure-phase-a-plan.md:248`), which is a no-op if no instance exists.
- Current `checkGatewayConnection` returns `false` on connection failure and does not establish a long-lived reconnect loop by itself: `src/lib/gateway.ts:1037`, `src/lib/gateway.ts:1049`.
- Impact:
  - If startup connect fails before singleton creation stabilizes, app can stay stuck without actual retries.

### 5. High: Chat DB migration is non-atomic and failure handling is unsafe
- Plan migration sequence: clear DB then write `chatSessionKey` in settings (`docs/plans/chat-infrastructure-phase-a-plan.md:74`).
- `clearChatHistory()` swallows clear errors (logs only, does not throw): `src/lib/store.ts:209`, `src/lib/store.ts:216`.
- Impact:
  - If DB clear fails, migration may still mark success and stale history persists forever.
  - If settings update fails after clear, app may re-clear on every startup (or repeatedly attempt migration).
- Recommendation:
  - Make clear/update transactional from one authority (prefer backend command) with explicit success/failure signaling.

### 6. Medium: Reconnection state machine details are underspecified for in-flight requests
- Current WS request lifecycle uses callback map + 30s timeout: `src/lib/tauri-websocket.ts:29`, `src/lib/tauri-websocket.ts:163`.
- Plan reconnect snippet handles `Close` by nulling socket + scheduling reconnect, but does not define what happens to pending callbacks.
- Impact:
  - In-flight requests can hang until timeout or resolve unpredictably during reconnect churn.
- Recommendation:
  - Explicitly reject all pending callbacks on disconnect/reconnect transitions, and document this contract.

### 7. Medium: CLI retry policy conflicts with spec and may block command threads
- Spec says exponential backoff `1s, 2s, 4s, max 10s`: `docs/specs/chat-infrastructure-phase-a-spec.md:72`.
- Plan code summary says `1s -> 2s -> fail`: `docs/plans/chat-infrastructure-phase-a-plan.md:122`.
- Proposed `thread::sleep` in `gateway_call()` retries can compound blocking in `openclaw_chat` polling paths: `src-tauri/src/lib.rs:995` (already sleeps per poll loop).
- Impact:
  - Retry behavior differs from spec and can materially increase worst-case latency.

### 8. Medium: Manual test #6 in plan does not match current behavior
- Plan test #6 expects: “WS down but CLI alive -> messages still send/receive via polling fallback”: `docs/plans/chat-infrastructure-phase-a-plan.md:364`.
- Current default send path is `tauri-ws`; there is no automatic fallback to `tauri-openclaw` CLI mode in `sendMessage(...)`: `src/lib/gateway.ts:945`.
- Impact:
  - This validation criterion will fail unless explicit transport fallback is added.

### 9. Medium: Spec says `StatusBadge` needs reconnecting state, but it already exists
- Spec says add reconnecting state: `docs/specs/chat-infrastructure-phase-a-spec.md:90`.
- Current `StatusBadge` already supports `reconnecting` and `connecting`: `src/components/chat/StatusBadge.tsx:13`, `src/components/chat/StatusBadge.tsx:18`.
- Impact:
  - Some planned UI work is redundant or should be reframed around wiring state, not adding badge variants.

## Line-Number Audit (Plan Claims vs Current Source)

The explicit line references in the plan are mostly accurate as of this review:
- `src-tauri/src/lib.rs`: `667`, `775`, `780`, `786-834`, `81-88`, `384-403` all align.
- `src/lib/gateway.ts`: `627`, `631`, `1043` align.
- `src/App.tsx`: `172-174`, `176-193`, `195-213`, `137-141` align.

Notable omission:
- Additional session fallback exists at `src/lib/gateway.ts:572` and is not accounted for in Step 1.

## Migration and Rollback Concerns

- Migration is destructive (chat history wipe) without backup/confirm path.
- No explicit rollback behavior documented for users who downgrade after migration.
- `chatSessionKey` field should be backward-compatible (old Rust struct likely ignores unknown JSON field), but data loss from wipe is not reversible.
- Migration currently planned in React startup effect, not backend migration boundary; this increases race/failure surface.

## Missing Test Scenarios

1. Startup with gateway down from first launch: verify automatic recovery without existing WS instance.
2. Manual retry when connection singleton does not yet exist.
3. In-flight WS request during disconnect/reconnect: callback rejection/cleanup guarantees.
4. Multiple reconnect cycles: ensure no duplicate listeners/timers/state bridge leaks.
5. Migration failure paths:
   - DB clear fails.
   - settings update fails after clear.
   - both fail.
6. First-launch migration race: user sends message before migration completes.
7. `openclaw-ws` transport session isolation (`'main'` fallback path).
8. UI interaction test for retry control in floating header (avoid nested button regression).
9. Verify no regressions in `tauri-openclaw` mode after session key + retry changes.

## Underspecified Implementation Details

- Where migration authority lives (frontend effect vs backend command) and atomicity guarantees.
- Exact retryable/non-retryable error taxonomy for `gateway_call()`.
- Reconnect trigger matrix: only `Close` frames vs also request failures/timeouts.
- State bridge lifecycle for recreated connection instances.
- Source of truth for `gatewayConnected` vs WS state (currently both app-level and transport-level flags exist).
- Whether `checkGatewayConnection()` remains periodic, one-shot, or replaced by explicit backoff loop.

## Suggested Adjustments Before Implementation

1. Update spec/plan to reflect real current transport architecture (`tauri-ws` default).
2. Expand session-key updates to include all transport fallbacks (`src/lib/gateway.ts:572` included).
3. Redesign retry UI placement to avoid nested interactive elements.
4. Move chat-session migration into a backend command with explicit success/failure and idempotency.
5. Define reconnect behavior for initial-connect-failure and no-instance manual retry.
6. Add explicit transport fallback rules if “WS down, CLI still works” is a requirement.
