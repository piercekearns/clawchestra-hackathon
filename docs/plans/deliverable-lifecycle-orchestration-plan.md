# Deliverable Lifecycle Orchestration: Implementation Plan

> Hover a kanban card to reveal five lifecycle action icons — Spec, Plan, Review, Deliver, Build — each prefilling chat with a contextual prompt.

## Summary

This plan implements lifecycle actions as hover-revealed icon buttons on roadmap kanban cards, inspired by Proton Mail's hover-action pattern. On hover, the card's nextAction text is replaced by five fixed-position icon buttons: Spec, Plan, Review, Deliver, and Build. Each button click opens the chat drawer with an editable, context-rich prompt. Spec and Plan icons show filled/outline states based on whether the artifact exists. Review, Deliver, and Build are always outline — they're pure action triggers with no artifact-backed state. The user can click any button at any time (including re-doing stages), append instructions like "do with codex", and send.

---

**Roadmap Item:** `deliverable-lifecycle-orchestration`
**Status:** Ready
**Created:** 2026-02-17
**Updated:** 2026-02-17

---

## Design Decisions

These decisions were made during design discussion and override the original spec where they differ:

1. **Five action icons, not a single dynamic CTA.** All five are always present in fixed positions. No subtractive logic — no icons appear or disappear based on state.

2. **Hover-reveal on kanban cards.** On hover, the nextAction text line is replaced by the five icon buttons, horizontally spaced across the card width. This avoids increasing card height.

3. **Spec and Plan have filled/outline states.** Filled = artifact file exists. Outline = artifact missing. This gives instant lifecycle progress at a glance on hover.

4. **Review, Deliver, and Build have no filled state.** They're always outline, always available. There's no reliable file-backed way to detect if a review or build has happened, so we don't try.

5. **All icons are always clickable.** Even if a Spec exists (filled), clicking it prefills a prompt to update/redo the spec. Nothing is disabled.

6. **Icons are icon-only, no text labels.** Small, Lucide-style line icons. Tooltips on hover for discoverability.

7. **Clicking prefills chat, never auto-submits.** User can edit the prompt and append context (e.g., "do with codex", "use claude code") before sending.

## Icon Mapping

| Position | Action | Icon (Lucide) | Filled state? | Prompt type |
|----------|--------|---------------|---------------|-------------|
| 1 | Spec | `FileText` | Yes — specDoc file exists | Create or update spec |
| 2 | Plan | `ListChecks` | Yes — planDoc file exists | Create or update plan |
| 3 | Review | `Search` | No — always outline | Run plan review |
| 4 | Deliver | `Hammer` | No — always outline | Build directly (agent does the work) |
| 5 | Build | Custom `CrossedHammers` SVG | No — always outline | Formal multi-agent build workflow |

**Deliver vs Build distinction:**
- **Deliver** = the agent (me) does the work directly. Suitable for small-medium features.
- **Build** = triggers a formal multi-agent workflow (`/build`, `/work`). Suitable for larger features. Icon is two crossed hammers to visually distinguish from single hammer.

## Existing Pattern References

- Kanban cards rendered in `src/components/Card.tsx` — generic `Card<T>` with `renderIndicators` and `renderActions` slots.
- Roadmap item enrichment via `resolveDocFiles(...)` in `src/lib/roadmap.ts` — deterministic spec/plan detection.
- `RoadmapItemDialog.tsx` uses `enrichItemsWithDocs(...)` for doc resolution.
- Chat composer input in `src/components/chat/ChatShell.tsx` (`const [input, setInput]`) — no external prefill API yet.
- `src/App.tsx` controls roadmap dialog selection and chat drawer open/close state.

## Phase 1: Lifecycle Domain and Prompt Builder

### Files to create

- `src/lib/deliverable-lifecycle.ts`
- `src/lib/deliverable-lifecycle.test.ts`

### Work

- Define lifecycle action types: `create-spec`, `update-spec`, `create-plan`, `update-plan`, `review-plan`, `deliver`, `build`.
- `getArtifactState(item)` — returns `{ spec: 'present' | 'missing', plan: 'present' | 'missing' }` derived from `item.docs`.
- Prompt template builders for each action type. Each prompt includes:
  - Project title/id
  - Roadmap item title/id
  - Known artifact paths (specDoc, planDoc) when they exist
  - Explicit requested action
- Spec prompt differs based on artifact state: "create spec for..." vs "update the spec at {path} for..."
- Plan prompt similarly adapts.
- Review prompt references the plan path.
- Deliver prompt includes spec + plan paths and a direct build instruction.
- Build prompt includes spec + plan paths and references formal workflow commands.

### Exit criteria

- Prompt builder returns non-empty editable plain text for all action types.
- Prompt adapts based on whether spec/plan artifacts exist.
- Unit tests cover all action types and both present/missing artifact combinations.

## Phase 2: Card Hover Action Bar

### Files to create

- `src/components/LifecycleActionBar.tsx`
- `src/components/icons/CrossedHammers.tsx` (custom SVG component)

### Files to modify

- `src/components/Card.tsx` (add hover state + action bar slot)
- `src/App.tsx` (pass lifecycle action handler to Board for roadmap views)

### Work

- **`CrossedHammers` icon**: Simple custom SVG — two hammers crossed. Same pattern as existing `GitHubMark` custom icon.
- **`LifecycleActionBar` component**: Renders 5 icon buttons in a horizontal row.
  - Props: `specExists: boolean`, `planExists: boolean`, `onAction: (action: ActionType) => void`
  - Spec icon: `FileText` — filled variant when `specExists`, outline when not. Use Lucide's fill prop or opacity/color difference.
  - Plan icon: `ListChecks` — filled variant when `planExists`, outline when not.
  - Review, Deliver, Build: always outline style.
  - Each button has a small tooltip on hover (e.g., "Create Spec", "Update Plan", "Plan Review", "Deliver", "Build").
  - Tooltip text adapts: "Create Spec" when missing, "Update Spec" when present. Same for Plan.
  - Icons are fixed position — always in the same horizontal slot regardless of state.
  - `stopPropagation` on click/pointerDown to prevent card click-through (same pattern as `GitHubStatusBadge`).
- **`Card.tsx` changes**: On hover, hide the nextAction text line and show `LifecycleActionBar` in its place. CSS transition for smooth swap. Only applies when a `renderHoverActions` prop is provided (so project cards are unaffected).
- **`App.tsx` changes**: When rendering the roadmap Board, pass `renderHoverActions` that creates `LifecycleActionBar` with the item's artifact state and an action handler.

### Exit criteria

- Hovering a roadmap kanban card replaces nextAction text with 5 icon buttons.
- Spec and Plan icons correctly show filled/outline based on artifact existence.
- Review, Deliver, Build are always outline.
- Clicking an icon does not trigger card click (open dialog).
- Mouse-out restores nextAction text.
- Icons are visually consistent with existing Lucide usage in the app.

## Phase 3: Chat Prefill Plumbing (App → ChatShell)

### Files to modify

- `src/App.tsx`
- `src/components/chat/types.ts`
- `src/components/chat/ChatShell.tsx`

### Work

- Add a typed prefill request: `{ id: string; text: string }` (id for dedup/effect keying).
- In `App.tsx`, implement lifecycle action handler:
  1. Receives action type + item from `LifecycleActionBar`
  2. Calls prompt builder from Phase 1
  3. Opens chat drawer (`setChatDrawerOpen(true)`)
  4. Sends prefill request into `ChatShell`
- Thread `prefillRequest` prop from `App` into `ChatShell`.

### Exit criteria

- Clicking any lifecycle icon opens the chat drawer and sends a prefill request.
- Prefill is not auto-submitted.
- Existing manual chat send and queue flow remains unchanged.

## Phase 4: Composer Prefill Behavior

### Files to modify

- `src/components/chat/ChatShell.tsx`
- `src/components/chat/ChatBar.tsx` (if focus/selection needs prop additions)

### Work

- Add `useEffect` in `ChatShell` keyed by `prefillRequest.id` to set internal `input`.
- Focus textarea after prefill.
- Place cursor at end for immediate editing.
- User can freely edit, append "do with codex", etc. before sending.
- Keep prefill logic isolated from send state, streaming state, and queue logic.

### Exit criteria

- Prefilled text appears in composer in both collapsed and expanded chat modes.
- User can edit text before sending.
- No automatic send side effects.

## Phase 5: Integration, QA, and Documentation Sync

### Files to modify

- `AGENTS.md` (new capability documentation)
- `docs/specs/deliverable-lifecycle-orchestration-spec.md` (update to reflect design decisions)
- `ROADMAP.md` (status/nextAction updates during build)

### Work

- Manual QA across lifecycle scenarios (see Testing Strategy below).
- Update `AGENTS.md` operation references: document lifecycle action bar behavior, chat prefill, icon meanings.
- Update spec to reflect final design decisions if any changed during build.
- Keep roadmap `nextAction` in sync per project conventions.

### Exit criteria

- Feature documented in `AGENTS.md`.
- Lifecycle icons and chat prefill work correctly after app reload.
- No regression in card click, roadmap detail dialog, or chat interaction.

## File Change Summary

| File | Change |
|------|--------|
| `src/lib/deliverable-lifecycle.ts` | New — lifecycle helpers + prompt builders |
| `src/lib/deliverable-lifecycle.test.ts` | New — unit tests |
| `src/components/LifecycleActionBar.tsx` | New — 5-icon hover action bar |
| `src/components/icons/CrossedHammers.tsx` | New — custom SVG icon |
| `src/components/Card.tsx` | Hover state + renderHoverActions slot |
| `src/components/chat/types.ts` | Prefill request type |
| `src/components/chat/ChatShell.tsx` | Prefill effect |
| `src/components/chat/ChatBar.tsx` | Optional focus/selection tweaks |
| `src/App.tsx` | Action handler, prefill wiring, renderHoverActions |
| `AGENTS.md` | Capability documentation |

## Acceptance Criteria

1. Hovering a roadmap kanban card reveals 5 lifecycle icon buttons in place of nextAction text.
2. Spec and Plan icons show filled when artifact exists, outline when missing.
3. Review, Deliver, Build icons are always outline.
4. All 5 icons are always in fixed positions, always clickable.
5. Clicking any icon opens the chat drawer with a contextual, editable prompt.
6. Prompt includes project context, item context, artifact paths, and requested action.
7. Prompt adapts based on artifact state (e.g., "create" vs "update").
8. User can edit prompt and append instructions before sending.
9. No auto-submit — user explicitly sends.
10. Lifecycle state (filled/outline) is correct after app reload without manual sync.
11. Existing card click (opens detail dialog), status changes, and chat functionality unaffected.

## Testing Strategy

### Automated

- `bun test src/lib/deliverable-lifecycle.test.ts` — all action types, prompt generation, artifact state derivation.
- `bun test` — full suite, no regressions.
- `pnpm build` — type check and build verification.

### Manual

| Scenario | Expected behavior |
|----------|-------------------|
| Item with no spec, no plan | Spec outline, Plan outline. Click Spec → "Create spec..." prompt |
| Item with spec, no plan | Spec filled, Plan outline. Click Plan → "Create plan for... referencing spec at {path}" |
| Item with spec and plan | Both filled. Click Review → plan review prompt. Click Deliver → direct build prompt. Click Build → formal workflow prompt |
| Click Spec when spec exists | "Update the spec at {path}..." prompt (not "create") |
| Click Deliver | Chat opens, prompt includes spec+plan paths, direct instruction |
| Click Build | Chat opens, prompt references formal `/build` or `/work` workflow |
| Mouse out during hover | Action bar disappears, nextAction text returns |
| Click icon (not card) | Chat prefills, card detail dialog does NOT open |
| Reload app, hover same card | Filled/outline states unchanged |

## Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Prompt paths inconsistent (absolute vs repo-relative) | Centralize path normalization in Phase 1 helper; test it |
| Prefill overwrites in-progress draft | Replace behavior by default; consider confirmation if composer has unsaved text |
| Hover action bar conflicts with card drag (dnd-kit) | `stopPropagation` on pointerDown; test drag still works from non-icon areas |
| Icons too small to distinguish at card scale | Test at real card widths; add tooltips for discoverability |
| CrossedHammers custom icon doesn't match Lucide style | Follow Lucide conventions (24×24 viewBox, 2px stroke, round caps) |

---

*Plan is a living document. Update as decisions are made during build.*
