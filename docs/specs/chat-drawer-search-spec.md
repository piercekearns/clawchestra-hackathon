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

## Cross-Surface Search (Scope Expansion)

Beyond chat history, evaluate whether Cmd+F search can extend to other surfaces:

| Surface | Feasibility | Notes |
|---------|------------|-------|
| **Chat drawer** | Phase 1 — straightforward | Client-side text search over message list |
| **Roadmap item modals** | Likely feasible | Rendered markdown — search the DOM or source text |
| **Spec / plan documents** | Likely feasible | Same as modals — markdown rendered in a scrollable view |
| **Terminal windows** | Needs research | xterm.js has a search addon (`@xterm/addon-search`). Cmd+F in native terminals typically searches the scrollback buffer. Need to determine: does our xterm.js setup support this? Does it conflict with the shell's own Ctrl+F / Cmd+F? Ghostty and iTerm both handle this gracefully. |

### Cmd+F in Terminals — Compatibility Concerns

In native terminals, Cmd+F is intercepted by the terminal emulator (not sent to the shell). The search addon for xterm.js provides this behavior. However:
- If the user has Cmd+F bound to something in their shell (e.g. forward-char in zsh), intercepting it at the xterm.js level could break their workflow
- Consider: Cmd+F searches terminal scrollback, Ctrl+F is passed through to the shell (matching native terminal behavior on macOS)
- Alternative: a search icon button in the terminal tab header that opens a search bar, avoiding keybinding conflicts entirely

### Design Direction

Phase 1: Chat drawer Cmd+F only (as specced above).
Phase 2: Evaluate terminal search addon integration.
Phase 3: Unified search across visible surface (whichever panel/modal/drawer is focused gets the Cmd+F).

## Non‑Goals

- Global project/roadmap search (only the currently visible surface).
- Server-side search (client‑side only).

## Open Questions

- Should the search bar persist between drawer opens or reset each time?
- Should we show a “no results” state inline or just a 0 count?
- For terminal search: should we use xterm's search addon or roll our own against the buffer?
- Should Cmd+F behavior be context-aware (search whatever surface is focused) or always target chat?
