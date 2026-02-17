# Deliverable Lifecycle Orchestration

> Hover a roadmap card to see five lifecycle actions — Spec, Plan, Review, Deliver, Build — each one click from a chat prompt.

## Summary

Working a roadmap item currently requires manual context-switching: check if artifacts exist, decide the next step, open chat, type a context-heavy prompt. This feature replaces that friction with a Proton Mail-style hover action bar on kanban cards. On hover, the card's nextAction text swaps for five fixed-position icon buttons. Spec and Plan icons show filled/outline states indicating whether the artifact exists. Clicking any icon opens the chat drawer with an editable, contextual prompt pre-filled. The user can append instructions (e.g., "do with codex") and send when ready.

---

**Roadmap Item:** `deliverable-lifecycle-orchestration`
**Status:** Ready
**Created:** 2026-02-17
**Updated:** 2026-02-17

---

## The Five Actions

| # | Action | Icon | Filled state? | What it does |
|---|--------|------|---------------|-------------|
| 1 | **Spec** | `FileText` (Lucide) | Yes — file exists | Prefills "create spec" or "update spec" prompt |
| 2 | **Plan** | `ListChecks` (Lucide) | Yes — file exists | Prefills "create plan" or "update plan" prompt |
| 3 | **Review** | `Search` (Lucide) | No — always outline | Prefills plan review prompt |
| 4 | **Deliver** | `Hammer` (Lucide) | No — always outline | Prefills direct build prompt (agent does the work) |
| 5 | **Build** | `CrossedHammers` (custom SVG) | No — always outline | Prefills formal multi-agent workflow prompt |

### Filled vs Outline

- **Spec**: Filled if `specDoc` resolves to an existing file. Outline if missing.
- **Plan**: Filled if `planDoc` resolves to an existing file. Outline if missing.
- **Review, Deliver, Build**: Always outline. No file-backed artifact to detect state.

### Always clickable

All five icons are always present and always clickable, even if the artifact exists. Clicking a filled Spec icon prefills an "update spec" prompt instead of "create spec". This lets the user redo any stage.

## UX: Hover Action Bar

**Trigger:** Mouse hover on a roadmap kanban card.

**Behavior:**
1. On hover, the nextAction text line fades out.
2. In its place, five icon buttons appear, horizontally spaced across the card width.
3. Icons are in fixed positions — they never shift based on state.
4. On mouse-out, icons disappear and nextAction text returns.
5. Clicking an icon fires the action. `stopPropagation` prevents card click-through.

**Inspiration:** Proton Mail email row hover actions — small icon buttons appear on hover, replacing inline text.

## Chat Prefill

Clicking any icon:
1. Opens the chat drawer.
2. Pre-fills the composer with an editable prompt.
3. User can edit, append context (e.g., "do with codex"), then send.
4. **Never auto-submits.** The user always has final control.

### Prompt content

Each prompt includes:
- Project title and ID
- Roadmap item title and ID
- Known artifact paths (specDoc, planDoc) when they exist
- Explicit requested action

Prompts adapt: "create spec for {item}" when none exists, "update the spec at {path}" when it does.

## Deliver vs Build

Two separate actions for different scales of work:

- **Deliver** (single hammer): The agent builds it directly. Suitable for small-medium features where the agent can handle the implementation in a single session.
- **Build** (crossed hammers): Triggers a formal multi-agent workflow — `/build`, `/work`, or similar compound-engineering commands. Suitable for larger features that benefit from structured multi-agent execution.

The user chooses which is appropriate and can append routing instructions to the prefilled prompt.

## Scope

**In scope:**
- Hover action bar on roadmap kanban cards (5 icons)
- Artifact state detection (spec/plan filled vs outline)
- Chat drawer open + composer prefill
- Prompt templates for all 5 actions
- Custom CrossedHammers SVG icon

**Out of scope:**
- Auto-submitting prompts
- Tracking review/build completion state
- Detail dialog changes (future enhancement)
- Lifecycle badges in the detail dialog (replaced by hover action bar on cards)

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| Item with no spec, no plan | Both outline. All actions available. |
| Click Spec when spec exists | Prefills "update spec" prompt (not "create") |
| Drag card from non-icon area | Normal drag behavior — icons use stopPropagation |
| Drag started, then hover icon area | Icons don't interfere with active drag |
| Composer has unsaved text when icon clicked | Prefill replaces current input |
| Card in "complete" status | All icons still available (can redo any stage) |

---

*Spec is a living document. Update as decisions are made during build.*
