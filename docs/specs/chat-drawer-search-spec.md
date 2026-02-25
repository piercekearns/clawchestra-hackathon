# Chat Drawer Search

> Add Cmd+F search inside the open chat drawer with a small, top‑right search bar.

## Summary

When the chat drawer is open, pressing **Cmd+F** should reveal a compact search input in the **top-right corner of the chat bar**. Typing a query searches within the current chat history, highlights matches, and lets the user jump between results. The search UI should be lightweight and consistent with shadcn/tailwind styling.

---

**Roadmap Item:** `chat-drawer-search`
**Status:** Draft
**Created:** 2026-02-25

---

## Desired Behavior

- **Cmd+F only when drawer is open** → shows search input in the chat bar’s top-right corner.
- Search input auto‑focuses when opened.
- **Esc closes** the search bar and clears highlights.
- Querying **highlights matches** in the message list and shows a subtle match count.
- **Enter / Shift+Enter** (or up/down controls) jump between matches.
- If the drawer is closed, Cmd+F should fall back to normal behavior (no custom search).

## UI Notes

- Use a small shadcn input (or equivalent) with an inline clear (×) affordance.
- Position: top‑right of the chat bar (aligned with existing controls).
- Styling should match existing chat bar typography and spacing.

## Non‑Goals

- Global project/roadmap search (only chat history).
- Server-side search (client‑side only).

## Open Questions

- Should the search bar persist between drawer opens or reset each time?
- Should we show a “no results” state inline or just a 0 count?
