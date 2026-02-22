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

## Priority Order (suggested)

1. Pending column card clipping — one-liner fix, pure visual bug
2. Divider notch — smallest lift, highest discoverability gain
3. Modal scoping — functional, affects everyday use
4. Right sidebar toggle — medium effort (needs mirrored icon + state logic)
5. Theme colour relocation — depends on item 4
6. Settings as page — most effort, revisit when settings content grows
