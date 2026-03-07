# Ask OpenClaw from Selection

> Surface a contextual “Ask OpenClaw” tooltip on text selection that prefills the chat with the referenced excerpt.

## Summary

When the user highlights text anywhere in the app, show a small tooltip near the selection containing a **quote icon** and **“Ask OpenClaw”** label. Clicking it should insert the selected text into the chat bar/drawer as a referenced excerpt so the user can ask a question about it. The UI must make it obvious that the outgoing message is referencing the highlighted text.

---

**Roadmap Item:** `ask-openclaw-selection`
**Status:** Draft
**Created:** 2026-02-25

---

## Desired Behavior

- **Selection affordance:** When the user selects text anywhere in the app UI (non‑editable surfaces), show a tooltip near the selection with:
  - Quote icon
  - “Ask OpenClaw” label
- **Click action:** Clicking the tooltip inserts the selected text into the chat composer as a **reference snippet**.
- **Reference clarity (user):** The composer should visually distinguish referenced text (e.g. quoted block, chip, or “Referenced text” pill) so it’s obvious the message relates to that selection.
- **Reference clarity (OpenClaw):** The referenced text **must be included in the actual prompt payload** sent to OpenClaw, so the model sees the highlighted context (not just the user’s reply).
- **Chat focus:** Optionally open the drawer and focus the input after insertion.
- **Dismissal:** Tooltip hides when selection clears or on click.

## UI Reference Handling

Pick one of:
- **Quoted block** inserted into the composer (e.g. `> selected text`), or
- **Reference chip** above the composer showing the excerpt (tap × to remove).

## Guardrails

- **Ignore selections inside editable fields** (inputs, textareas, contenteditable) to avoid interference while typing.
- **Ignore empty/whitespace selections.**
- **Long selection handling:** truncate in the UI (still store full text), or enforce a max length.

## Key Surfaces (beyond chat drawer)

The selection tooltip should work **everywhere text is selectable** in the app, including:

| Surface | Example use case |
|---------|-----------------|
| **Roadmap card modals** | Highlight part of a spec or plan, ask OpenClaw to explain or critique it |
| **Spec / plan documents** | Select a section of a rendered markdown doc, ask "how should we implement this?" |
| **Settings page** | Highlight an error message, ask "what does this mean?" |
| **Chat messages** | Highlight a previous AI response, ask a follow-up about that specific part |
| **Terminal output** | Select error output, ask "what went wrong?" (if terminal text selection is feasible) |

This makes "Ask OpenClaw" a universal interaction pattern — the user can get AI help from any readable surface without manually copying text into a chat input.

## Non‑Goals

- Global search.
- Server‑side ingestion of selection metadata.

## Context-Aware Routing (future direction — not Phase 1)

The current spec routes all "Ask OpenClaw" queries to the **general chat**. This is the correct Phase 1 default — simple, always works.

But as the Project Conversation Hub matures (scoped project and item chats), the routing should become **context-aware**: where the query goes depends on where in the app the user is highlighting text.

| User location | Routing destination | Rationale |
|--------------|--------------------|-----------| 
| Inside a **roadmap item modal** | That item's scoped chat (create if none exists) | User is clearly working on that item — the question should live in that context |
| On a **project dashboard** | That project's thread-level chat | User is in project context — question belongs there |
| In the **general kanban board** (no specific project open) | General chat | No specific context — general chat is correct |
| Anywhere else / ambiguous | General chat | Safe default |

### UX implications

- The tooltip label could reflect the destination: `"Ask OpenClaw"` (general) vs `"Ask in project chat"` vs `"Ask in item chat"` — though this adds complexity. Phase 1 can keep a static label; routing adapts silently in the background.
- If routing creates a new item-level or project-level chat on the fly, it should auto-open the hub secondary drawer to that chat so the user sees where their question went.
- This is the "pre-scoped AI surfaces" pattern from `distributed-ai-surfaces-spec.md` applied to the selection feature — the context of WHERE determines WHICH AI session receives the query.

**Phase 1:** Route to general chat always. No context awareness.
**Phase 2 (post-hub):** Add context-aware routing once project and item chats exist and have stable session keys.

## Decisions

- The tooltip should appear **app‑wide** (including modals) when selecting non‑editable text.
- The action should make it **obvious** the message references the selection (quoted block or reference chip).
- **Phase 1 routing:** general chat only. Context-aware routing is a Phase 2 addition (see section above).
