---
title: UI Tweaks
id: ui-tweaks
status: in-progress
tags: [ui, polish, sidebar, ux]
icon: "✨"
nextAction: "Remaining: item 17 title bar error details modal, item 18 chat bar height shell removal. Model selector (20) deferred."
lastActivity: "2026-02-25"
---

# UI Tweaks

A holding item for UI/UX improvements that are too small for their own roadmap items but too specific to leave undocumented.

---

## 1 — Sidebar Divider Notch

Add a visual notch/handle in the middle of the divider bar between the sidebar and the board.

**Status:** ✅ Fixed (2026‑02‑22)

- **Style reference:** Claude Code's drag handle — a visible affordance that makes the resizeable bar discoverable without requiring a hover
- Currently the drag affordance is only visible on hover, which isn't obvious enough
- The notch should be static (always visible, not just on hover)
- Keep it subtle — a small pill/grip icon centred on the bar

---

## 2 — Right-Side Sidebar Toggle (Title Bar)

**Status:** ✅ Fixed (2026‑02‑23)

Add a mirrored sidebar toggle icon to the **top-right** of the title bar, so the sidebar can be opened on either side.

**Behaviour (current scope — single sidebar):**
- Only one sidebar can be open at a time
- Clicking the right toggle when the left sidebar is open → closes left, opens right
- Clicking the left toggle when the right sidebar is open → closes right, opens left
- Each toggle button reflects the state of its respective side (active/inactive)

**Icon:**
- Mirror the existing left-aligned sidebar icon for the right button
- Prefer a proper mirrored version if available in the icon set; fall back to CSS `transform: scaleX(-1)`

**Future consideration (two sidebars):**
- If a second independent sidebar is added later, the toggle logic will need revisiting
- At that point: each button independently controls its side; both can be open simultaneously
- Flag this in the component comment so it's easy to find when the time comes

---

## 3 — Theme Colour Controls → Move to Sidebar / Settings

**Status:** ✅ Fixed (2026‑02‑23)

The theme colour controls currently sit in the title bar. Adding a right-side toggle button (item 2) requires that space.

- Move theme colour controls into the sidebar, either at the top level or inside the Settings section
- Exact placement TBD at implementation time (Pierce to decide)
- Do not remove them — just relocate

---

## 4 — Settings as Full Board Page (Not Modal)

**Status:** ✅ Fixed (2026‑02‑23)

When the sidebar is open and Settings is clicked, replace the board area with a full settings page instead of opening a modal.

**Layout:**
- Sidebar remains open on the left (as normal)
- Board area becomes the settings page
- A **← Back to Clawchestra** button appears — either in the sidebar or at the top of the settings page (TBD at implementation)

**Initial scope:**
- All current settings options appear on this page (same content as the modal, just laid out as a page)
- No tabs or sections required initially — flat list is fine
- Revisit structure when settings content grows

**Why:** Modals on top of a complex board feel heavy. A page feels more intentional for a settings context.

---

## 5 — Modals Scoped to Board Area

**Status:** ✅ Fixed (2026‑02‑23)

When the sidebar is open, modals triggered from the board section should be constrained to the board area only — not the full app width.

**Current behaviour:** Modal takes up X% of the full app viewport (sidebar + board).

**Desired behaviour:** Modal takes up X% of the *board* viewport only, so it doesn't bleed into or over the sidebar.

**Notes:**
- The sidebar should remain fully interactive while a board modal is open
- This likely requires the modal portal/container to be scoped to the board's DOM node rather than `document.body`
- If the sidebar is closed, behaviour stays unchanged (modal uses full viewport as before)

---

## 6 — Pending Column: Card Right Edge Clipping

Kanban cards in the Pending column have their right border/stroke clipped at certain app widths.

**Status:** ✅ Fixed (1px gutter, 2026‑02‑22)

**Symptoms:**
- The rightmost edge of Pending column cards is cut off — the border line is partially or fully invisible
- Dragging the app window wider/narrower makes the edge flicker in and out of view
- Only affects the Pending column (rightmost column, or at least the one most likely to overflow)

**Likely cause:**
- A missing or insufficient `padding-right` / `overflow: hidden` on the column container, or the column width calculation doesn't account for card border width
- Could also be a scrollbar appearing/disappearing at certain widths causing a reflow that clips the last column

**Fix approach:**
- Inspect `.column` / `.kanban-column` container padding — ensure there's enough room for the card's full border box
- Check for `overflow: hidden` on any ancestor that might be cutting the painted border
- Test at multiple app widths (min 960px through ~1800px) to confirm edge stays visible throughout

---

## 7 — Active Model Indicator (+ Context Window Usage)

**Status:** ✅ Fixed (2026‑02‑25)

Surface the currently active OpenClaw model somewhere in the Clawchestra UI, with optional context usage visibility.

**What to show:**
- Active model name (e.g. `claude-sonnet-4-6`, or a friendly alias)
- Optional: context window usage as a **ring loader inside the model badge** (only when connected and usage > 0)

**Placement — TBD, candidates:**
- Title bar (compact — model name only, maybe with a small usage bar on hover)
- Sidebar footer / status area (more room for both model + usage)
- Chat drawer (contextually relevant when in a session)

**Interaction — TBD:**
- Read-only indicator to start (just shows what's active)
- Potentially evolves into a model selector (click to change primary model) if feasible via the OpenClaw API
- If it becomes a selector: should respect the fallback chain (show primary + fallback)

**Data source:**
- OpenClaw exposes current model via `session_status` tool and gateway config
- **Context window usage is NOT reliably surfaced today** in chat events. Gateway events only include `tokens` on announce metadata (background jobs), not per‑turn usage.
- Options if we want live usage:
  - Add a **gateway event** that includes per‑session usage/limit on `chat.final` (ideal)
  - Poll the OpenClaw CLI `usage` command (heavier, not per‑turn)
- Fallback: hide the ring unless usage data is present
- Implemented: use `sessions.list` totals (`totalTokens` / `contextTokens`) for the ring (matches Gateway dashboard).

**Open questions:**
- Where exactly does it live? (Decide at implementation time — Pierce to call)
- Model selector or read-only first?
- **Ring vs number vs both?** (proposal: ring inside badge only when connected + usage present)
- Should it show the *session-pinned* model or the *configured default*? (Could differ if a session override is active)
- Do we want usage per **session key** or global account usage?

---

## 8 — Live Reload: File Watcher on state.json

Currently, external writes to `.clawchestra/state.json` (by agents, the CLI, or tools like this one) aren't reflected in the board until the user navigates away and back. The app reads `state.json` on mount/route change only — no live watching.

**Status:** ✅ Fixed (2026‑02‑23)

**Fix:** Add a Tauri file watcher on `.clawchestra/state.json`. When a write is detected, re-read the file and sync the store — no navigation required.

**Implementation notes:**
- Tauri supports this natively via `tauri-plugin-fs-watch` (or `@tauri-apps/plugin-fs` watch API in v2)
- Watch `.clawchestra/state.json` specifically (not the whole dir, to avoid noise from git operations)
- Debounce the re-read slightly (e.g. 200–300ms) to avoid thrashing during rapid sequential writes
- The watcher should be set up once on app init and torn down on unmount

**Why it matters:** As agents take on more of the roadmap management (adding items, updating nextAction, marking progress), the board needs to reflect those changes without user intervention. Without a watcher, the human has to manually refresh to see what the agent just did — breaks the flow.

---

## 9 — Git Sync Success Styling Match

When a Git Sync **commit/push succeeds**, the modal uses a dark green success color. Match that treatment to the style of **user chat messages** in the chat drawer (background + outline), for visual consistency.

**Status:** ✅ Fixed (2026‑02‑22)

**Goal:** Success confirmations should feel like they belong to the same design language as the user message bubbles.

**Notes:**
- Only apply to the **success state** (not errors or in-progress states)
- Use the **same background + border/outline color** as *user* messages (not assistant responses)
- If the Git Sync modal uses a banner or toast, mirror the same style tokens

---

## 10 — Git Sync File Lists: Stack Vertically

In the Git Sync modal, file names can wrap horizontally on a single line, which makes it hard to scan when multiple files are listed.

**Status:** ✅ Fixed (2026‑02‑22)

**Change:**
- Render each file on its **own line** (vertical stack)
- Avoid horizontal wrapping or inline lists
- Keep indentation consistent so categories remain easy to read

---

## 11 — Column Card List Collapse (Not Column Collapse)

Add dual header controls so each column can:
- hide/reveal the **card list** (up/down arrow), and
- minimize/restore the **entire column** (`chevrons-right-left`) to a narrow vertical pill.

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Card-list collapse remains independent from full-column minimization.
- Minimization is per-column and persisted under a dedicated key (separate from `collapsedColumns`).
- Header keeps draggable hand cursor while removing drag-dot visuals.
- Full-size header keeps title + count + both controls visible.
- Minimized state renders as a vertical pill with restore affordance.
- Keep the hand cursor on the header to preserve the draggable affordance even without the dots.

---

## 12 — Sticky Modal Close Button (Hover Only)

Keep the modal close **X** button pinned to the top-right of the modal viewport while scrolling, so it’s always reachable without scrolling back to the top.

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Show the X button on hover/focus of the modal (or when the modal is active), so it doesn’t obscure content when idle.
- Ensure it stays in the same relative position as the user scrolls within the modal.
- Applies to all board-scoped modals.

---

## 13 — Chat Toast Preview: Basic Markdown Rendering

Allow limited markdown formatting in the **chat toast preview bubble** (e.g., bold/italic) so `**All fixed**` renders as bold instead of showing the asterisks.

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Keep it lightweight — support inline styles only (bold, italic, inline code), no block elements.
- Avoid layout growth; keep the toast compact.
- Sanitise output (no links or images in toast).

---

## 14 — Sidebar/Settings Background Uses App Default

Remove the special dark-grey background from sidebars and the settings page so the **global app background** shows through. Boundaries should be defined only by divider lines.

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Sidebars and settings should feel like part of one continuous canvas, not separate panels.
- Use dividers/shadows sparingly; no additional background blocks.

---

## 15 — Sidebar Divider Notch Hidden Under Modal Overlay

When a board-scoped modal is open with the sidebar visible, the divider notch/line gets visually cut in half (overlay/blur sits on top of the board side). Ensure the notch renders **above** the modal overlay so the divider is continuous.

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Likely z-index / stacking context issue with the modal blur container.
- Divider + notch should remain visible across both sidebar + board sides.

---

## 16 — Chat Drawer: Remove All Tooltips

Remove all chat drawer/tooltips (resize, open, dismiss, queue actions). Icons and hover states are sufficient and no tooltip should appear in any drawer state.

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Remove hover titles entirely for chat drawer interactions.
- Applies to resize handle, queue actions, and preview toast.

---

## 17 — Title Bar Error Details: Click for Copyable Modal

Top-bar error messages (e.g., build failures) are hard to copy. Replace full error text with a compact “X happened — click for details” affordance that opens a small modal containing the full error details for easy copy/paste.

**Status:** ⏳ Pending (added 2026‑02‑24)

**Notes:**
- Keep the title bar concise; avoid long error strings.
- Modal should allow easy text selection + copy.
- OK to reuse existing modal styles.

---

## 18 — Chat Bar Height: Remove Inner Field Shell

The bottom chat bar currently has a nested inner field; instead, the **outer container should be the input**, so the default chat bar height matches the input height. This should reduce the overall bar height and tighten the UI.

**Status:** ⏳ Pending (added 2026‑02‑24)

**Notes:**
- The outer chat bar should align to the input’s default height.
- Keep the same focus/hover styling; just remove the extra shell layer.

---

## 19 — Chat Send Button: Up Arrow + Bottom-Right Anchor

Replace the paper‑plane send icon with an **up arrow**, slightly reduce the rounded‑square button size, and keep it anchored to the **bottom‑right** of the chat field as the textarea grows (so it visually rides with the bottom edge, not centered vertically).

**Status:** ✅ Fixed (2026‑02‑24)

**Notes:**
- Use a simple up‑arrow icon (lucide).
- Button stays inset from the right and bottom edges as the input grows.
- Keep hover/active styling consistent with current send button.

---

## Priority Order (suggested)

1. Pending column card clipping — ✅ done (1px gutter)
2. Git Sync success styling — ✅ done (match user bubble)
3. Git Sync file lists stack — ✅ done (stacked rows)
4. Divider notch — ✅ done (visible handle)
5. Live state.json watcher — ✅ done (instant updates)
6. Active model indicator (read‑only) — ✅ done (2026‑02‑25)
7. Modal scoping — ✅ done (2026‑02‑23)
8. Right sidebar toggle — ✅ done (2026‑02‑23)
9. Theme colour relocation — ✅ done (2026‑02‑23)
10. Settings as page — ✅ done (2026‑02‑23)
11. Column card list collapse / column minimization — ✅ done (dual controls, persisted)
12. Sticky modal close button (hover only) — ✅ done (2026‑02‑24)
13. Chat toast preview: basic markdown — ✅ done (2026‑02‑24)
14. Sidebar/settings background uses app default — ✅ done (2026‑02‑24)
15. Sidebar divider notch above modal overlay — ✅ done (2026‑02‑24)
16. Chat drawer tooltips removed — ✅ done (2026‑02‑24)
17. Title bar error details modal — ⏳ pending
18. Chat bar height: remove inner field shell — ⏳ pending
19. Chat send button: up arrow + bottom-right anchor — ✅ done (2026‑02‑24)
20. Model selector (if/when) — higher risk, depends on item 6
21. Context window usage — ✅ done (2026‑02‑25)
