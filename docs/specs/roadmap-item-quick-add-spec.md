# Roadmap Item Quick-Add (AI Chat-First)

> Add roadmap items via an embedded AI chat where users describe what they want in natural language and OpenClaw structures it into a schema-compliant deliverable — the first proof-of-concept for distributed AI surfaces.

**Status:** Draft
**Created:** 2026-02-21
**Roadmap Item:** `roadmap-item-quick-add`
**Depends On:** `architecture-direction` (app-layer foundation)
**Proves:** `distributed-ai-surfaces` (first consumer of the pattern)

---

## Problem

Today, roadmap items can only be created by:

1. **Telling OpenClaw in the general chat drawer** — "Add a roadmap item to project X in column Y to do Z." The user has to state the project, the column, and the content all in one message, in a chat that's shared with every other conversation.
2. **Manually editing YAML files** — writing frontmatter in `ROADMAP.md` or creating a file in `roadmap/`. Requires knowing the schema.

There's no UI affordance for "I'm looking at this project's kanban board and I want to add an item to this column." The spatial context (which project, which column) is lost because the only input is a general-purpose text box.

## What Success Looks Like

- **A "+" button on kanban columns** (or a similar affordance) that says "Add a roadmap item here."
- **Clicking it opens a new card** with an AI chat box as the primary input method.
- **The user just describes the item** — what it covers, what the goals are, any context. No need to specify project, column, priority, or schema fields.
- **OpenClaw structures the output** — turns the natural language description into a schema-compliant roadmap item with proper frontmatter (title, status, priority, tags, nextAction, etc.).
- **Optional manual fields** are exposed below the chat for users who prefer to fill fields directly or want to override what the AI generated.
- **The item appears on the board** immediately after creation — no page refresh needed.

## How It Works

### User Flow

1. User is viewing Project X's kanban board
2. Clicks "+" on the "pending" column
3. A new card appears in-place (or a sidebar/modal opens) with:
   - **AI chat box** (primary) — "Describe what this roadmap item should cover..."
   - **Manual fields** (secondary, collapsed by default) — title, tags, priority, nextAction
4. User types: "I want to track the work needed to add a dark mode theme system with user-selectable palettes and automatic OS detection"
5. OpenClaw receives this with auto-injected context:
   - `project: project-x`
   - `targetColumn: pending`
   - `existingItems: [list of current items in pending with priorities]`
   - `schema: [roadmap item schema reference]`
6. OpenClaw responds with a structured preview:
   ```
   Here's what I'd create:

   **Title:** Dark Mode & Theme System
   **Status:** pending
   **Priority:** 4 (after App Customisation, before Clawchestra Apps)
   **Tags:** ui, theming, ux
   **Next Action:** Spec needed — define theme palette structure, OS detection integration, and user preference persistence
   **Icon:** 🎨

   Want me to go ahead, or any changes?
   ```
7. User confirms (or adjusts via chat: "make it priority 3 actually")
8. OpenClaw creates the item — writes to ROADMAP.md, creates roadmap detail file if needed
9. Board updates in real-time

### Context Injection

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
  "instruction": "The user wants to create a new roadmap item. They will describe it in natural language. Structure it into a schema-compliant deliverable. Ask for confirmation before creating."
}
```

This means OpenClaw knows:
- It's creating a roadmap item (not having a general conversation)
- Which project and column
- What priority numbers are already taken
- What the schema requires

The user never has to state any of this.

### Manual Fields (Secondary Input)

Below the chat box, expandable fields for direct editing:

| Field | Input Type | Default |
|-------|-----------|---------|
| Title | Text input | AI-generated from chat |
| Status | Dropdown (read-only — pre-set from column clicked) | From column |
| Priority | Number input | AI-suggested based on existing items |
| Tags | Tag chips / text input | AI-suggested |
| Icon | Emoji picker | AI-suggested |
| Next Action | Text area | AI-generated |

These fields update live as the AI generates the item. The user can override any field directly.

## Proof-of-Concept Value

This is the first distributed AI surface — the first time an AI chat component exists outside the general chat drawer. It proves:

1. **Context injection works** — the surface provides structured context without the user typing it
2. **Scoped interaction works** — the chat is about one thing (creating an item), not everything
3. **AI-structured output works** — natural language in, schema-compliant YAML out
4. **State sync works** — the kanban board updates when the item is created

Every subsequent distributed AI surface (git sync inline chat, project card chat, etc.) follows the same pattern established here.

## Phased Delivery

### Phase 1: UI Affordance + Manual Fields
- "+" button on kanban columns
- New card / modal with manual input fields only (no AI chat yet)
- Creates a schema-compliant roadmap item from field values
- Validates against schema before writing

### Phase 2: AI Chat Integration
- Add the `<AiChat>` component (from distributed-ai-surfaces) to the creation UI
- Context injection: project, column, existing items, schema
- AI generates field values from natural language description
- Preview → confirm → create flow

### Phase 3: Polish
- Live field updates as AI generates
- Override any AI-generated field manually
- Multi-turn refinement ("actually make it priority 2", "add a spec doc")
- Inline creation (card appears in-place on the board) vs modal creation

## Non-Goals

- Bulk item creation ("add 5 items at once")
- Template-based creation (predefined item templates — could be future enhancement)
- Creating items for projects not currently visible on the board

## Open Questions

1. **Confirmation flow** — Should OpenClaw always ask for confirmation before creating? Or can the user opt into "just create it" mode?
2. **Spec/plan auto-generation** — Should OpenClaw offer to write an initial spec for the new item as part of creation? Or is that a separate action?
3. **Priority negotiation** — When the AI suggests a priority, should it explain why ("I put it at P4 because it's less urgent than Rate Limit Resilience but more concrete than Clawchestra Apps")?
4. **Session lifecycle** — Does the creation chat use an ephemeral session (destroyed after creation) or persist in case the user wants to revisit what was discussed during creation?
