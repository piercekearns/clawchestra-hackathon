---
title: Ask OpenClaw from Selection
id: ask-openclaw-selection
status: pending
tags: [chat, ux, selection]
icon: "❝"
---

# Ask OpenClaw from Selection

Surface an **app‑wide selection affordance** so that selecting text anywhere in the UI offers a quick “Ask OpenClaw” action. Clicking the action should prefill the chat bar with a quoted excerpt, making it easy to ask follow‑up questions about specific text.

## Desired Behavior

- When the user **selects text anywhere in the app**, show a small tooltip near the selection:
  - Quote icon + label: **“Ask OpenClaw”**
  - Tooltip appears only while the selection is active
- Clicking the tooltip:
  - Inserts the selected text into the chat composer as a **reference snippet**
  - Optionally opens the chat drawer if closed
  - Makes it visually obvious the message references the selection (quoted block or reference chip)

## Scope & Safety

- Apply app‑wide, but **ignore selections inside editable inputs** (textareas, input fields) to avoid interfering with typing.
- Tooltip should not appear for zero‑length or whitespace‑only selections.
- No global selection polling — rely on selection events within the app shell.

## Notes / Open Questions

- Should long selections be truncated in the UI (but keep full text)?
- Should the tooltip appear only after mouse‑up or also during drag?
- Should it work inside modals and popovers (likely yes, if selection is inside the app surface)?
