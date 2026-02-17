# Deliverable Lifecycle Orchestration: Implementation Plan

> Add deterministic lifecycle state and one guided action that opens chat with an editable, context-rich prompt.

## Summary

This plan implements a roadmap-item lifecycle assistant in the detail dialog, based on file-backed artifact detection and roadmap status. It introduces a small domain layer for lifecycle and prompt generation, adds lifecycle badges and a single CTA in `RoadmapItemDetail`, and wires that CTA to chat drawer prefill through `App` and `ChatShell`. The implementation keeps behavior deterministic on reload by deriving state from existing `resolveDocFiles` output and item status, with no manual sync state.

---

**Roadmap Item:** `deliverable-lifecycle-orchestration`
**Status:** Ready
**Created:** 2026-02-17

---

## Existing Pattern References

- Roadmap item detail is rendered in `src/components/modal/RoadmapItemDetail.tsx` and already receives `RoadmapItemWithDocs`, status update callbacks, and lazy doc loading hooks.
- Dialog-level enrichment for docs is centralized in `src/components/modal/RoadmapItemDialog.tsx` using `resolveDocFiles(...)` plus `enrichItemsWithDocs(...)`.
- Artifact resolution rules live in `src/lib/roadmap.ts` and already establish deterministic precedence: item `specDoc`/`planDoc`, then convention paths, then missing.
- Chat composer input currently lives inside `src/components/chat/ChatShell.tsx` (`const [input, setInput] = useState('')`) and has no external prefill API.
- `src/App.tsx` controls roadmap dialog selection and chat drawer open/close state, so it is the orchestration point for lifecycle CTA to chat prefill.

## Phase 1: Lifecycle Domain and Prompt Builder

### Files to create

- `src/lib/deliverable-lifecycle.ts`
- `src/lib/deliverable-lifecycle.test.ts`

### Files to modify

- `src/lib/schema.ts` (only if a shared type export is needed)

### Work

- Add pure lifecycle helpers so UI stays declarative and testable.
- Derive spec state from `item.docs.spec` presence.
- Derive plan state from `item.docs.plan` presence.
- Derive build state from roadmap status: `pending|up-next` => `not-started`, `in-progress` => `in-progress`, `complete` => `complete`.
- Derive exactly one `primaryAction`: `create-spec`, `create-plan`, `run-build`, `continue-build`.
- Add prompt template builders for each action.
- Include project title/id, roadmap item title/id, known artifact paths (`specDoc`, `planDoc`), and explicit requested action in each prompt.

### Exit criteria

- Lifecycle output is deterministic for the same `(item.docs, item.status)` input.
- Prompt builder returns non-empty editable plain text for all primary actions.
- Unit tests cover the full action matrix and path fallback behavior.

## Phase 2: Roadmap Detail Lifecycle UI

### Files to modify

- `src/components/modal/RoadmapItemDetail.tsx`
- `src/components/modal/RoadmapItemDialog.tsx`

### Work

- In `RoadmapItemDetail`, render lifecycle badges under title/next action.
- Show `Spec: Present|Missing`.
- Show `Plan: Present|Missing`.
- Show `Build: Not Started|In Progress|Complete`.
- Add one primary CTA button whose label maps to lifecycle action (`Create Spec`, `Create Plan`, `Run Build`, `Continue Build`).
- Add a callback prop on `RoadmapItemDetail` and `RoadmapItemDialog` for lifecycle CTA clicks, passing item plus derived action.
- Keep existing doc-tab behavior and status badge behavior unchanged.

### Exit criteria

- Exactly one primary lifecycle CTA is visible at a time.
- Badge values match resolved docs and status without local toggle state.
- Existing doc tabs and status changes continue to work.

## Phase 3: Chat Prefill Plumbing (App to ChatShell)

### Files to modify

- `src/App.tsx`
- `src/components/chat/types.ts`
- `src/components/chat/ChatShell.tsx`

### Work

- Add a typed prefill request payload (for example `{ id: string; text: string }`) so prefill application is event-based.
- In `App.tsx`, implement a lifecycle action handler that builds prompt text using Phase 1 helpers, opens chat drawer, and sends prefill request into `ChatShell`.
- Thread the new `prefillRequest` prop from `App` into `ChatShell`.

### Exit criteria

- Clicking lifecycle CTA always opens the chat drawer and injects the generated prompt.
- Prefill is not auto-submitted.
- Existing manual chat send and queue flow remains unchanged.

## Phase 4: Composer Prefill Behavior in ChatShell

### Files to modify

- `src/components/chat/ChatShell.tsx`
- `src/components/chat/ChatBar.tsx` (only if focus or selection behavior requires minor prop additions)

### Work

- Add `useEffect` in `ChatShell` keyed by prefill request id to set internal `input`.
- Focus textarea after prefill.
- Place cursor at end for immediate editing.
- Keep prefill logic isolated from send state, streaming state, and queue logic.

### Exit criteria

- Prefilled text appears in composer in both collapsed and expanded chat modes.
- User can edit text before sending.
- No automatic send side effects are introduced.

## Phase 5: Integration, QA, and Documentation Sync

### Files to modify

- `AGENTS.md` (implementation follow-up, required because this feature adds a new roadmap-item capability)
- `docs/specs/deliverable-lifecycle-orchestration-spec.md` (only if implementation clarifications are needed)
- `ROADMAP.md` (during implementation progress updates)

### Work

- Add a manual QA checklist for the four lifecycle states.
- Confirm behavior after full reload to validate file-backed derivation.
- Update `AGENTS.md` operation references after code lands to document lifecycle CTA behavior and chat prefill action.
- Keep roadmap `nextAction` updated through build and verification per project rules.

### Exit criteria

- Feature is documented in `AGENTS.md` once implemented.
- Lifecycle state and CTA remain correct after refresh or reload.
- No regression in roadmap detail rendering or chat interaction.

## File Change Summary

- `src/lib/deliverable-lifecycle.ts` (new)
- `src/lib/deliverable-lifecycle.test.ts` (new)
- `src/components/modal/RoadmapItemDetail.tsx`
- `src/components/modal/RoadmapItemDialog.tsx`
- `src/App.tsx`
- `src/components/chat/types.ts`
- `src/components/chat/ChatShell.tsx`
- `src/components/chat/ChatBar.tsx` (optional/minimal)
- `AGENTS.md` (implementation follow-up)

## Acceptance Criteria

- Roadmap item detail shows deterministic lifecycle badges for spec, plan, and build.
- Exactly one lifecycle CTA is shown per item state.
- CTA opens chat drawer and prepopulates editable prompt text.
- Prompt includes project, roadmap item, requested action, and artifact paths.
- No manual artifact toggles are introduced.
- Lifecycle state is correct after refresh or reload.
- Existing status update, doc tab loading, and chat queueing remain functional.

## Testing Strategy

### Automated

- Run `bun test src/lib/deliverable-lifecycle.test.ts` for lifecycle and prompt template logic.
- Run full unit suite with `bun test`.
- Run type and build checks with `pnpm build`.

### Manual

- Scenario 1: missing spec and plan. Badges show missing/missing/not started, CTA is `Create Spec`.
- Scenario 2: spec present and plan missing. CTA is `Create Plan`.
- Scenario 3: spec and plan present with status `pending` or `up-next`. CTA is `Run Build`.
- Scenario 4: spec and plan present with status `in-progress`. CTA is `Continue Build`.
- Scenario 5: status `complete`. Build badge is `Complete` and CTA behavior matches chosen UX (`Continue Build` or intentionally hidden).
- For each scenario, click CTA and verify drawer opens, prompt is populated, and text is editable before send.
- Reload app and re-open item to confirm lifecycle badges and CTA are unchanged without manual synchronization.

## Risks and Mitigations

- Risk: prompt path formatting is inconsistent between absolute and repo-relative paths.
- Mitigation: centralize path normalization in Phase 1 helper and test it.
- Risk: prefill could overwrite in-progress drafts unexpectedly.
- Mitigation: define explicit prefill behavior in implementation (replace vs append) and cover with manual QA.
- Risk: lifecycle logic diverges from file resolution rules.
- Mitigation: derive from `item.docs` produced by existing `resolveDocFiles(...)` instead of duplicating resolution logic.
