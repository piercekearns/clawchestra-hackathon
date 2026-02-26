# Board Project Quick-Add

> Add a lightweight "+ Add Project" card inside each kanban column to create projects directly in place and pre-assign them to that column.

## Summary

Today, creating a project requires using the header button and then selecting a status inside the modal. This spec adds an inline affordance inside each kanban column so users can add projects exactly where they're looking. Clicking the card opens the existing Add Project modal, preselects the target column, and keeps the rest of the flow unchanged.

---

**Roadmap Item:** `board-project-quick-add`
**Status:** Draft
**Created:** 2026-02-23

---

## Build Order Note

This spec gets **built first** among the quick-add family. The inline "+ Add Project" card established here becomes the shared affordance reused by `roadmap-item-quick-add` (which adds a "+ Add roadmap item" card to roadmap columns with the same visual treatment). Build the card component to be reusable from the start.

Sequence:
1. **This spec** — shared add card component + project board wiring → opens existing `AddProjectDialog` with status pre-selected. Done.
2. **`roadmap-item-quick-add` Phase 1** — wire same card component into roadmap columns → opens `AddRoadmapItemDialog` (manual fields). Done.
3. **`roadmap-item-quick-add` Phase 2** — AI chat layer on top.

## Problem

- Project creation is divorced from the board context.
- The "Add Project" button at the top is visually noisy and not spatially aligned with the target column.
- Users already think in columns (status) when adding projects — we should meet them there.

## Goals

- Allow **in-column project creation** with a clear, lightweight CTA.
- **Preselect the status** based on the column clicked.
- Keep the existing Add Project modal and flows (create new / add existing) intact.
- Preserve the existing project priority tracking (just don't require the user to think about it).

## Non-Goals

- Replacing the Add Project modal with a new UI.
- Changing how priorities are stored.
- Enabling drag-to-create or inline editing (for now).

## UX / Interaction

### Placement
- **When a column has items:** show a thin, dashed "+ Add Project" card at the **bottom** of the column.
- **When a column is empty:** show the same card at the **top** of the column (so it's immediately visible).

### Styling
- Hollow card with **dashed stroke**, subtle hover background.
- Text: "+ Add Project".
- Should feel like a **secondary CTA**, not a primary card.

### Click Behavior
- Clicking the card opens the **existing Add Project modal**.
- The modal's **Status** is preselected to the column.
- If the user completes the wizard, the project appears in that column.

### Priority Behavior
- Priority is still tracked, but **not shown** on project cards.
- If the user leaves priority blank, the project should land at the **bottom of the column** (max + 1).

## Edge Cases

- **Collapsed columns:** don't show the quick-add card when a column is collapsed.
- **Add Existing flow:** still allowed; if the project already exists, it should just be assigned the chosen status.

## Implementation Notes (suggested)

- Render an "Add Project" CTA card in `Column` (non-draggable).
- Add an optional `initialStatus` prop to `AddProjectDialog` (preselect status input).
- For empty columns, render the CTA card first; otherwise render it last.
- Keep the header "Add Project" button for now (optional removal later once this feels solid).

## Open Questions

- Do we remove the top "Add Project" button after this ships, or keep it as a secondary entry point?
- Should the inline card be hidden when the column is filtered / searched?

