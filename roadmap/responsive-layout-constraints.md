# Responsive Layout Constraints

Define and enforce min/max widths and heights for every major container in Clawchestra — sidebar, kanban board, secondary chat drawer, thin strip — and implement concertina logic so the window can't be crushed into broken states. At narrow widths, panels that can't usefully compress should hide or collapse to drawers rather than just breaking.

---

**Roadmap Item:** `responsive-layout-constraints`
**Status:** Pending
**Created:** 2026-03-03

---

## Context

Currently the app has partial CSS min-width enforcement but no holistic constraint system. You can drag the window narrow enough that the kanban board becomes unusable, the secondary chat drawer gets crushed, or multiple panels fight for space. The existing approach (CSS + limited JS clamping) was patched reactively — it needs a principled redesign.

Reference apps to study:
- **Claude Code desktop** — handles narrow windows by progressively hiding panels
- **Codex desktop** — similar drawer-first approach at constrained widths

## Problem

1. **No enforced minimum widths per panel** — drag handles and window resizing can crush any panel
2. **No concertina logic** — no rule for what happens when total available width < sum of minimums
3. **No responsive behaviour** — fixed containers (secondary chat drawer) just get narrower rather than hiding
4. **No minimum heights** — vertical resizing is entirely unconstrained
5. **Tauri `setMinSize` is only partially used** — not updated dynamically when panels open/close

## Target Behaviour

### Per-container minimums (proposed)
| Container | Min width | Min height | Behaviour below min |
|---|---|---|---|
| Thin strip | 44px (fixed) | — | Never resizable |
| Sidebar | 220px open / 44px collapsed | — | Snap to collapsed below 160px |
| Secondary chat drawer | 280px | 200px | Auto-hide when total space < threshold |
| Kanban board | 480px | — | Hard floor; window resize blocked before this |
| Project modal | 600px | 500px | Constrained by window; scrolls internally |

### Concertina logic (cascade order)
When the window is made narrower, panels should hide in this order:
1. Secondary chat drawer → auto-hides (becomes a floating/slideover drawer)
2. Sidebar → snaps to thin strip only
3. Kanban board → minimum window width enforced by Tauri `setMinSize`

### At narrow widths (< ~900px)
- Secondary chat drawer becomes a full-height **slideover** from the right (overlays the board, doesn't push it)
- Sidebar collapses to thin strip automatically
- Board gets full available width

### Height constraints
- App-level min height: 600px (current) — review if sufficient when panels stack vertically
- Vertical resize mode (from flexible-layout-orientation): min 200px per stacked panel

## Implementation Approach

### Layer 1 — CSS
- Audit and lock min-width/min-height via Tailwind on every panel root element
- Remove any conflicting `width` overrides that bypass CSS minimums

### Layer 2 — JS (Zustand coordinator)
- Drag handle math clamps to per-panel minimums before updating store
- When secondary drawer width is dragged below threshold: `setHubDrawerOpen(false)` (auto-hides)
- When window width (from Tauri `getCurrent().innerSize()`) drops below 900px: auto-collapse sidebar to thin strip

### Layer 3 — Tauri `setMinSize`
- Dynamic `setMinSize` updates when panels open/close:
  - Drawer open: `minWidth = 44 (thin) + 220 (sidebar) + 280 (drawer) + 480 (board)` = 1024px
  - Drawer closed: `minWidth = 44 + 480` = 524px, practically 800px for usability
  - Sidebar open vs collapsed affects the calc
- Call on: drawer open/close, sidebar collapse toggle, layout orientation change

### Layer 4 — Slideover mode
- When the secondary drawer is "hidden" due to width constraints, a small icon/tab remains visible to re-open it as a slideover (absolute-positioned overlay, not a layout participant)
- Slideover width: 380px fixed, overlays the board, backdrop click to dismiss
- Persist slideover preference vs layout-participant mode per window width band

## Research Tasks

- [ ] Install and inspect Claude Code desktop: how it handles narrow windows, what collapses first, any keyboard shortcuts for panel visibility
- [ ] Inspect Codex desktop: same audit
- [ ] Measure actual minimum usable widths for the kanban board (how many columns, card width floor)
- [ ] Check if Tauri `window-resized` event is reliable enough for reactive constraint updates

## Relation to Other Items

- **flexible-layout-orientation** (p4, up-next) — vertical stacking mode adds height constraint requirements; coordinate min-height logic
- **sidebar-position-rethink** (p14, pending) — if sidebar moves to right side, concertina order changes
- **pre-release-hardening** — layout bugs are user-visible; constraint system should ship before first public sharing
