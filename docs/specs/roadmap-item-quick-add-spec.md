# Roadmap Item Quick-Add (AI Chat-First)

> Add roadmap items via an embedded AI chat where users describe what they want in natural language and OpenClaw structures it into a schema-compliant deliverable — the first proof-of-concept for distributed AI surfaces.

**Status:** Draft
**Created:** 2026-02-21
**Updated:** 2026-02-26
**Roadmap Item:** `roadmap-item-quick-add`
**Depends On:** `architecture-direction` (app-layer foundation)
**Proves:** `distributed-ai-surfaces` (first consumer of the pattern)

---

## Problem

Today, roadmap items can only be created by:

1. **Telling OpenClaw in the general chat drawer** — "Add a roadmap item to project X in column Y to do Z." The user has to state the project, the column, and the content all in one message, in a chat that's shared with every other conversation.
2. **Manually editing YAML files** — writing frontmatter in `ROADMAP.md` or editing the project's data directly. Requires knowing the schema.

There's no UI affordance for "I'm looking at this project's kanban board and I want to add an item to this column." The spatial context (which project, which column) is lost because the only input is a general-purpose text box.

## What Success Looks Like

- **A lightweight "+ Add roadmap item" card** at the bottom of each roadmap kanban column — hollow, dashed stroke, secondary CTA. Uses the same `QuickAddCard` component already built for `board-project-quick-add` (shipped `86b15b6`).
- **Clicking opens a modal** with two creation paths:
  - **AI path (primary):** An AI chat box — user describes the item in natural language, OpenClaw creates it directly, the card appears on the board.
  - **Manual path (secondary):** Plain input fields with placeholders. User fills in what they want and submits.
- **AI path creates without preview or confirmation** — the user describes what they want, OpenClaw creates the item, it appears on the board. If they want to review or edit the details, they click the card.
- **The item appears on the board** immediately after creation — no refresh needed.

## How It Works

### Two Creation Paths

#### Path A: AI Chat (Primary)

1. User is viewing Project X's roadmap kanban
2. Clicks "+ Add roadmap item" in the "pending" column
3. Modal opens showing an AI chat input as the primary affordance
4. User types: "I want to track the work needed to add a dark mode theme system with user-selectable palettes and automatic OS detection"
5. OpenClaw receives this with auto-injected context (invisible to user):
   - `project: project-x`
   - `targetStatus: pending`
   - `existingItemsInColumn: [...]`
   - `schema: [roadmap item schema]`
6. OpenClaw creates the item directly — no preview, no confirmation step
7. Modal closes, the new card appears in the "pending" column
8. User can click the card to view and edit all generated fields

#### Path B: Manual Fields

1. User clicks "+ Add roadmap item" in any column
2. Modal opens — user selects the "Fill in manually" path (or it may be a tab/toggle)
3. Blank input fields with placeholders — no defaults, no AI-suggested values:
   - Title (text input)
   - Status (dropdown — pre-set to the column clicked, not editable here)
   - Priority (number input)
   - Tags (tag chips / text input)
   - Icon (emoji picker)
   - Next Action (text area)
4. User fills in what they want and submits
5. Item is created, card appears in the column

### Context Injection (AI Path)

The chat component auto-injects (invisible to user):

```json
{
  "surface": "roadmap-item-quick-add",
  "project": "clawchestra",
  "targetStatus": "pending",
  "existingItemsInColumn": [
    { "id": "ai-commit-messages", "title": "AI Commit Messages", "priority": 1 },
    { "id": "rate-limit-resilience", "title": "Rate Limit Resilience", "priority": 2 }
  ],
  "schema": {
    "requiredFields": ["title", "status", "type", "priority", "parent", "lastActivity"],
    "optionalFields": ["specDoc", "planDoc", "tags", "icon", "nextAction"]
  },
  "instruction": "The user wants to create a new roadmap item. They will describe it in natural language. Structure it into a schema-compliant deliverable and create it immediately — do not ask for confirmation or show a preview."
}
```

OpenClaw knows:
- It's creating a roadmap item (not having a general conversation)
- Which project and column
- What priority numbers are already taken
- What the schema requires

The user never has to state any of this.

### Storage

Roadmap items are written to the project's state/database (not to `ROADMAP.md` directly — that file-based approach is superseded by the JSON/state store). The board reflects the new item immediately via the existing state sync mechanism.

## Proof-of-Concept Value

This is the first distributed AI surface — the first time an AI chat component exists outside the general chat drawer. It proves:

1. **Context injection works** — the surface provides structured context without the user typing it
2. **Scoped interaction works** — the chat is about one thing (creating an item), not everything
3. **AI-structured output works** — natural language in, schema-compliant item out
4. **State sync works** — the kanban board updates when the item is created

Every subsequent distributed AI surface (git sync inline chat, project card chat, etc.) follows the same pattern established here.

## Build Order & Dependencies

`QuickAddCard` — the shared in-column CTA card component — **is already built** (commit `86b15b6`, shipped as part of `board-project-quick-add`). It accepts `label` and `onClick` props and renders a dashed hollow card.

Remaining build sequence:

1. **Phase 1 (this spec)** — Wire `QuickAddCard` into roadmap board columns with label "+ Add roadmap item". Clicking opens `AddRoadmapItemDialog` with manual fields only.
2. **Phase 2** — Add the AI chat tab/path to `AddRoadmapItemDialog`.

## Phased Delivery

### Phase 1: UI Affordance + Manual Fields ✅ Component exists, wiring needed
- Add `onQuickAdd` + `quickAddLabel` props to the roadmap `Board` → `Column` render path (same pattern as project board)
- Clicking opens `AddRoadmapItemDialog` — a new modal with blank manual input fields and status pre-selected from the column
- Creates a schema-compliant roadmap item on submit
- Board updates immediately

### Phase 2: AI Chat Integration
- Add an AI chat tab/mode to `AddRoadmapItemDialog` as the primary creation path
- Context injection: project, column, existing items, schema
- AI creates the item immediately on receiving the user's description — no preview step
- Modal closes on creation; user sees the card on the board and can click to review details

### Phase 3: Polish
- Multi-turn refinement before creation ("actually focus it on mobile first")
- Inline creation vs modal (card appears in-place on the board)

## Non-Goals

- Preview/confirmation step in the AI path — OpenClaw creates directly; edits happen post-creation by clicking the card
- Bulk item creation ("add 5 items at once")
- Template-based creation (predefined item templates — could be future enhancement)
- Creating items for projects not currently visible on the board
- Spec/plan auto-generation at creation time — that's a separate action triggered from the card after it exists

## Decisions

- **Two-path UI:** AI-first. The chat input is the primary affordance; a "Fill in manually" link sits below it for users who prefer direct input.
- **Spec/plan auto-generation:** Out of scope for this feature. Offered post-creation from the card, not during quick-add.
- **Session lifecycle:** Ephemeral. The chat session is destroyed after the item is created — it's a scoped task with a clear end state.
