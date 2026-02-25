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

## Non‑Goals

- Global search.
- Server‑side ingestion of selection metadata.

## Decisions

- The tooltip should appear **app‑wide** (including modals) when selecting non‑editable text.
- The action should make it **obvious** the message references the selection (quoted block or reference chip).
