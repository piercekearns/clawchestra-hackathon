---
title: UI Tweaks
id: ui-tweaks
status: pending
tags: [ui, polish, sidebar, ux]
icon: "✨"
nextAction: "Implement in priority order — start with divider notch (smallest lift)"
lastActivity: "2026-02-22"
---

# UI Tweaks

A holding item for UI/UX improvements that are too small for their own roadmap items but too specific to leave undocumented.

---

## 1 — Sidebar Divider Notch

Add a visual notch/handle in the middle of the divider bar between the sidebar and the board.

- **Style reference:** Claude Code's drag handle — a visible affordance that makes the resizeable bar discoverable without requiring a hover
- Currently the drag affordance is only visible on hover, which isn't obvious enough
- The notch should be static (always visible, not just on hover)
- Keep it subtle — a small pill/grip icon centred on the bar

---

## 2 — Right-Side Sidebar Toggle (Title Bar)

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

The theme colour controls currently sit in the title bar. Adding a right-side toggle button (item 2) requires that space.

- Move theme colour controls into the sidebar, either at the top level or inside the Settings section
- Exact placement TBD at implementation time (Pierce to decide)
- Do not remove them — just relocate

---

## 4 — Settings as Full Board Page (Not Modal)

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

Surface the currently active OpenClaw model somewhere in the Clawchestra UI, with optional context usage visibility.

**What to show:**
- Active model name (e.g. `claude-sonnet-4-6`, or a friendly alias)
- Optionally: context window usage — tokens used / total (e.g. `42k / 200k`) or a progress bar

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
- Context window usage may need polling or a WebSocket event — check what the gateway surfaces
- Fallback: derive from `openclaw.json` `agents.defaults.model.primary` if live session data isn't available

**Open questions:**
- Where exactly does it live? (Decide at implementation time — Pierce to call)
- Model selector or read-only first?
- Show context usage as a number, a bar, or both?
- Should it show the *session-pinned* model or the *configured default*? (Could differ if a session override is active)

---

## 8 — Live Reload: File Watcher on state.json

Currently, external writes to `.clawchestra/state.json` (by agents, the CLI, or tools like this one) aren't reflected in the board until the user navigates away and back. The app reads `state.json` on mount/route change only — no live watching.

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

**Goal:** Success confirmations should feel like they belong to the same design language as the user message bubbles.

**Notes:**
- Only apply to the **success state** (not errors or in-progress states)
- Use the **same background + border/outline color** as *user* messages (not assistant responses)
- If the Git Sync modal uses a banner or toast, mirror the same style tokens

---

## 10 — Git Sync File Lists: Stack Vertically

In the Git Sync modal, file names can wrap horizontally on a single line, which makes it hard to scan when multiple files are listed.

**Change:**
- Render each file on its **own line** (vertical stack)
- Avoid horizontal wrapping or inline lists
- Keep indentation consistent so categories remain easy to read

---

## Priority Order (suggested)

1. Pending column card clipping — ✅ done (1px gutter)
2. Git Sync success styling — tiny polish, low risk
3. Git Sync file lists stack — tiny polish, low risk
4. Divider notch — small lift, high discoverability gain
5. Live state.json watcher — small lift, but touches infra/state sync
6. Active model indicator (read‑only) — low risk once data is available
7. Modal scoping — medium risk (portal/container changes)
8. Right sidebar toggle — medium risk (state + layout)
9. Theme colour relocation — depends on item 8
10. Settings as page — larger UI change
11. Model selector (if/when) — higher risk, depends on item 6
12. Context window usage — higher risk, depends on item 6
