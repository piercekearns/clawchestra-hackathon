---
title: UI Tweaks
id: ui-tweaks
status: in-progress
tags: [ui, polish, sidebar, ux]
icon: "✨"
nextAction: "Remaining: item 1 title bar error details modal, item 2 chat bar height shell removal. Model selector (3) deferred."
lastActivity: "2026-02-25"
---

# UI Tweaks

A holding item for UI/UX improvements that are too small for their own roadmap items but too specific to leave undocumented.

---

## 1 — Title Bar Error Details: Click for Copyable Modal

Top-bar error messages (e.g., build failures) are hard to copy. Replace full error text with a compact “X happened — click for details” affordance that opens a small modal containing the full error details for easy copy/paste.

**Status:** ⏳ Pending (added 2026‑02‑24)

**Notes:**
- Keep the title bar concise; avoid long error strings.
- Modal should allow easy text selection + copy.
- OK to reuse existing modal styles.

---

## 2 — Chat Bar Height: Remove Inner Field Shell

The bottom chat bar currently has a nested inner field; instead, the **outer container should be the input**, so the default chat bar height matches the input height. This should reduce the overall bar height and tighten the UI.

**Status:** ⏳ Pending (added 2026‑02‑24)

**Notes:**
- The outer chat bar should align to the input’s default height.
- Keep the same focus/hover styling; just remove the extra shell layer.

---

## 3 — Model Selector (If/When)

Potential evolution of the model badge from read‑only to selectable. Clicking could allow changing the **primary model**, but must respect the fallback chain (primary + fallback). Higher‑risk and depends on item 6 (active model indicator).

**Status:** ⏳ Deferred

**Open questions:**
- Session‑pinned vs default model?
- How to represent fallbacks and overrides in the UI?

---

## Priority Order (suggested)

1. Title bar error details modal — ⏳ pending
2. Chat bar height: remove inner field shell — ⏳ pending
3. Model selector (if/when) — ⏳ deferred
