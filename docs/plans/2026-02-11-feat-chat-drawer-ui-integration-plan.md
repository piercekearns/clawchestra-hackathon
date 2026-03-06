---
title: "feat: Chat Drawer UI Integration"
type: feat
date: 2026-02-11
roadmapItem: roadmap/chat-drawer-ui.md
specDoc: docs/CHAT-DRAWER-SPEC.md
---

# feat: Chat Drawer UI Integration

## Overview

Replace the current floating `OpenClawComposer` with a drawer-based chat UI that keeps the board usable while making responses easier to inspect.

This plan is scoped to the current transport and state model, so we can ship reliable improvements now without blocking on protocol changes.

## Problem Statement / Motivation

Current behavior is a compact composer plus a transient strip above it. It works, but it does not provide:

- A stable, expandable conversation view
- A durable "response complete" notification pattern
- A clear split between connection status and active work state
- A path to richer response rendering when transport data improves

Goal: make Pipeline Dashboard chat good enough to replace day-to-day OpenClaw dashboard usage for app maintenance tasks.

## Research Summary (workflows-plan local pass)

- No relevant brainstorm found in `docs/brainstorms/`
- No project learnings found in `docs/solutions/`
- Strong local context exists in current implementation and spec docs, so external research is not required for this pass

## Proposed Solution

Implement a new chat surface under `src/components/chat/` with:

- Persistent two-row `ChatBar` at bottom
- `StatusBadge` (connected/error/disconnected) and `ActivityIndicator`
- `ResponseToast` that appears on completed assistant responses and does not auto-dismiss
- `ChatDrawer` for message history with scroll-to-bottom behavior
- `MessageBubble` rendering for user/assistant/system messages
- Transport-aware behavior:
  - `tauri-openclaw` (default): generic activity state (`Thinking...`), no tool timeline
  - `openclaw-ws` (future-compatible): optional richer activity mapping when events are available

Preserve existing attachment behavior (drag/drop, paste, remove, max count) from `OpenClawComposer`.

## Technical Considerations

### Data and State

- Keep `gateway.ts` transport API unchanged for MVP.
- Introduce UI-local chat state in `App.tsx`:
  - `drawerOpen`
  - `drawerHeightPx` (or vh-based number)
  - `pendingResponseToast`
  - `isWorking`
  - `activityLabel`
- Keep store `chatMessages` as `role + content` for now.
- Defer structured `thinking/toolCall/toolResult` parsing until transport provides stable blocks in default runtime path.

### Transport Constraints

- Default transport resolves to `tauri-openclaw`, which currently does not stream deltas.
- Plan must not depend on streaming-only behaviors for MVP correctness.
- For non-streaming replies:
  - Start working state on send
  - End working state when promise resolves/rejects
  - Create toast on assistant success response

### UX and Interaction Decisions (resolved for this plan)

- Backdrop click closes drawer
- `Escape` closes drawer first, then existing overlays keep current priority
- Drawer height is fully free-drag (no snap points)
- Drag range: 5% to 95% viewport height with a minimum 56px floor
- Default drawer height: 60%

### Non-Regression Requirements

- Sending text still works in all views
- Attachment upload and send behavior remains intact
- Existing global toasts (success/error) remain unchanged
- Existing keyboard navigation for board remains unchanged when drawer is closed

## SpecFlow Gap Fixes (must be reflected in implementation)

- Reconcile spec's rich message model with current plain-text message model
- Explicitly gate `ThinkingSummary` and `ToolStep` behind available data
- Avoid introducing dependencies on prompt-kit/framer-motion unless required by implementation quality
- Define toast lifecycle state machine to avoid duplicate or stale toasts
- Render markdown in safe mode only (no raw HTML execution)

## Plan-Review Findings to Address In Scope

- Enforce drawer clamp with both relative and absolute lower bound (`max(5vh, 56px)`)
- Define explicit `Escape` precedence contract:
  - 1) close chat drawer
  - 2) existing modal/detail/roadmap escape handling
- Keep component extraction pragmatic (avoid one-off over-fragmentation during implementation)
- Keep rich-thinking UI behind capability checks so MVP does not stall on transport limitations

## Implementation Phases

### Phase 1: Foundation and Shell

- Add `src/components/chat/` components:
  - `ChatShell.tsx` (or `ChatBar.tsx` + `ChatDrawer.tsx`)
  - `StatusBadge.tsx`
  - `ActivityIndicator.tsx`
  - `MessageBubble.tsx`
  - `MessageList.tsx`
  - `ResponseToast.tsx`
  - `index.ts`
- Integrate new shell in `App.tsx` behind current chat data flow.
- Preserve current send pipeline (`sendChatMessage`) and attachment payload path.

Deliverable:
- Drawer opens/closes from row 1 interaction.
- Message list shows existing chat history.

### Phase 2: Toast and Activity

- Add response-complete toast logic:
  - Trigger on successful assistant response append
  - No auto-dismiss
  - Click body opens drawer and dismisses toast
  - Click close dismisses toast only
- Add activity label logic:
  - `Thinking...` while request in flight
  - Hidden when idle

Deliverable:
- User can stay in board context and still notice completion immediately.

### Phase 3: Drawer Behavior and Keyboard

- Implement backdrop and height handling.
- Implement drag handle with continuous height resizing (no snap points).
- Clamp drag height between 5% and 95% viewport height with a 56px minimum floor.
- Wire `Escape` to close drawer without regressing existing escape behaviors.
- Ensure focus management returns to input when opening drawer from toast.

Deliverable:
- Drawer interaction feels stable and predictable.

### Phase 4: Rich Rendering and Safe Enhancements

- Add markdown rendering for assistant message text.
- Add optional placeholder for future `ThinkingSummary` when structured data is unavailable.
- Keep tool timeline UI disabled unless required data is present.

Deliverable:
- Improved readability now, richer internals later without re-architecture.

### Phase 5: Verification and Cleanup

- Remove or retire `OpenClawComposer` usage from `App.tsx`.
- Verify no dead code paths remain.
- Validate behavior across:
  - project board view
  - roadmap view
  - selected card detail open/closed

Deliverable:
- Production-ready replacement with no functional regressions.

## Acceptance Criteria

### Functional

- [ ] Bottom chat bar remains visible in app main views.
- [ ] Clicking row 1 opens drawer; toggle indicates expanded/collapsed state.
- [ ] Drawer resizing is continuous free-drag (no snap points), clamped to 5%-95% viewport height.
- [ ] Drawer lower clamp respects both 5% and a 56px minimum floor.
- [ ] Sending messages still works and appends user + assistant messages.
- [ ] Response toast appears on completed assistant responses and does not auto-dismiss.
- [ ] Toast body click opens drawer; close icon dismisses toast only.
- [ ] Drawer displays conversation history with user/assistant/system role styling.
- [ ] Attachment workflow (drag/drop/paste/remove/send) still works.

### Non-Functional

- [ ] No degradation in board drag/drop interactions while drawer is closed.
- [ ] Keyboard `Escape` behavior remains coherent with existing modal/roadmap interactions.
- [ ] `Escape` precedence is deterministic: drawer closes before existing modal/detail/roadmap handlers.
- [ ] No added dependency is required for MVP delivery.

### Quality Gates

- [ ] Build passes (`pnpm build` and/or existing local app build path).
- [ ] Existing gateway tests remain green.
- [ ] Manual QA checklist completed for chat UX and attachments.

## Success Metrics

- Reduced need to switch to external OpenClaw dashboard for routine project updates
- Faster operator feedback loop (message send -> visible completion -> inspect full response)
- No increase in gateway error reports caused by UI integration changes

## Dependencies and Risks

### Dependencies

- Existing gateway functions in `src/lib/gateway.ts`
- Existing chat state in `src/lib/store.ts`
- Existing Tauri commands in `src-tauri/src/lib.rs`

### Risks

- Transport mismatch if implementation assumes streaming details not available in default mode
- Keyboard handling conflicts with existing Escape listeners
- UI layering conflicts with board interactions and existing fixed toasts

### Mitigations

- Gate rich behavior behind capability checks
- Add explicit key handling precedence
- Keep global toasts separate from chat response toast state

## Out of Scope (for this plan)

- Migrating default transport from `tauri-openclaw` to websocket
- Full tool timeline rendering from structured OpenClaw run events
- Persisting full chat history to disk beyond current runtime behavior

## References and Internal Context

- `<legacy-project-root>/docs/CHAT-DRAWER-SPEC.md`
- `<legacy-project-root>/roadmap/chat-drawer-ui.md`
- `<legacy-project-root>/src/App.tsx`
- `<legacy-project-root>/src/components/OpenClawComposer.tsx`
- `<legacy-project-root>/src/lib/gateway.ts`
- `<legacy-project-root>/src/lib/store.ts`
- `<legacy-project-root>/src-tauri/src/lib.rs`
