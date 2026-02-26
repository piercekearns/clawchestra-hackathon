---
title: UI Tweaks
id: ui-tweaks
status: in-progress
tags: [ui, polish, sidebar, ux]
icon: "✨"
nextAction: "Remaining: item 1 evolve ValidationBadge → header placement + build errors + copy support; item 2 chat bar height shell removal. Model selector (3) deferred."
lastActivity: "2026-02-25"
---

# UI Tweaks

A holding item for UI/UX improvements that are too small for their own roadmap items but too specific to leave undocumented.

---

## 1 — Title Bar Status Badge: Warnings + Build Errors (Evolved ValidationBadge)

Evolve the existing `ValidationBadge` (currently positioned near the search bar) into a unified status badge that lives permanently in the **TitleBar**, to the right of the Clawchestra logo + text — and to the right of the Update button if one is present.

**Status:** ⏳ Pending (updated 2026‑02‑26)

### What it Does

The badge consolidates two signal types:

| Signal type | Trigger | Badge colour |
|-------------|---------|--------------|
| Validation warnings | Agent write partially rejected (existing behaviour) | **Amber** |
| Build failures / errors | Tauri build error, TS error, any critical failure | **Red** |

- Only visible when there is at least one unresolved warning or error.
- Shows a count badge when there is more than one item.
- Clicking opens a compact popover (same pattern as today's `ValidationBadge`) listing all active items.
- Each item in the popover is **selectable text** and has a **"Copy" button** so errors can be pasted into a chat or terminal immediately.
- Errors can be individually dismissed.

### Layout

```
[🦞 Clawchestra]  [Update?]  [⚠ 2]       ← amber: warnings only
[🦞 Clawchestra]  [Update?]  [✕ 1]       ← red: at least one build error
[🦞 Clawchestra]  [Update?]  [⚠✕ 3]      ← mixed (or show highest severity)
```

### Implementation Notes

- `ValidationBadge` currently renders per-project inside card indicators (`renderItemIndicators` in `App.tsx`). The new badge is a **global, aggregated** version that lives in `TitleBar.tsx` — it collects warnings across all projects plus any build-level errors.
- Extend `ValidationBadge` (or create a sibling `StatusBadge`) to accept both `rejections: ValidationRejection[]` and `buildErrors: BuildError[]`.
- Move the TitleBar render into `TitleBar.tsx`; keep (or simplify) the per-card badge for per-project context if still useful, but the header badge is the primary copy/paste surface.
- Use `status-warning` colour tokens for warnings (amber), `status-danger` for errors (red).
- Popover items: timestamp, type label, message text (selectable), "Copy" button per item.
- "Copy all" button at the bottom of the popover for bulk copy.
- Build errors need to be surfaced via a new store slice or prop drilled from wherever build output is captured (likely `chat-reliability.ts` or `lib.rs`).

---

## 2 - Chat Bar Height: Remove Inner Field Shell

The bottom chat bar currently has a nested inner field; instead, the **outer container should be the input**, so the default chat bar height matches the input height. This should reduce the overall bar height and tighten the UI.

**Status:** ⏳ Pending (added 2026-02-24)

**Notes:**
- The outer chat bar should align to the input's default height.
- Keep the same focus/hover styling; just remove the extra shell layer.

---

## 3 - Model Selector (If/When)

Potential evolution of the model badge from read-only to selectable. Clicking could allow changing the **primary model**, but must respect the fallback chain (primary + fallback). Higher-risk and depends on item 6 (active model indicator).

**Status:** ⏳ Deferred

**Open questions:**
- Session-pinned vs default model?
- How to represent fallbacks and overrides in the UI?

---

## Priority Order (suggested)

1. Title bar error details modal - ⏳ pending
2. Chat bar height: remove inner field shell - ⏳ pending
3. Model selector (if/when) - ⏳ deferred
