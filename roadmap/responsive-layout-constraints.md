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
6. **Terminal rendering breaks below a certain column count** — Claude Code (and likely other TUI tools) has a minimum column requirement to render without visual errors; the secondary drawer's current 280px proposed floor may be narrower than what Claude Code needs to display correctly

## Target Behaviour

### Per-container minimums (proposed)
| Container | Min width | Min height | Behaviour below min |
|---|---|---|---|
| Thin strip | 44px (fixed) | — | Never resizable |
| Sidebar | 220px open / 44px collapsed | — | Snap to collapsed below 160px |
| Secondary chat drawer (chat only) | 280px | 200px | Auto-hide when total space < threshold |
| Secondary chat drawer (terminal active) | TBD — pending terminal research | 200px | Enforce wider floor; block drag below minimum |
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

## Terminal Rendering Requirements

Claude Code and other TUI tools (Codex, htop, etc.) have a minimum column count to render without visual errors. When running inside the secondary chat drawer's terminal pane, the drawer being too narrow can break Claude Code's layout — text wraps incorrectly, panels overlap, or the interface becomes unusable.

### Open question: rendering bug vs. hard width requirement?

Before deciding on an enforcement approach, the core question needs answering:

**Option A — It's a fixable rendering bug:** xterm.js or the PTY is not correctly signalling the terminal size to the running process (i.e., `TIOCSWINSZ` not being sent on drawer resize). Claude Code thinks it has more columns than it does. Fix: ensure xterm.js `.fit()` is called on every drawer resize and the SIGWINCH signal propagates correctly to the running process.

**Option B — It's a hard width floor:** Claude Code genuinely needs N columns to render its UI correctly, and anything narrower is always going to look broken regardless of signal accuracy. Fix: enforce a minimum drawer width when a terminal tab is active, and if the drawer can't reach that width, auto-hide it as a slideover at a fixed wider size.

Both may be partially true — the signal propagation should be correct regardless, and even with correct signalling there may still be a minimum usable column count.

### Proposed behaviour once floor is determined

- When a terminal tab is open in the secondary drawer: apply the terminal-aware minimum (wider than the chat-only 280px floor)
- When the window is too narrow to accommodate both board and drawer at the terminal minimum: drawer auto-hides to slideover mode (same cascade as the general concertina logic, but triggered sooner)
- The minimum should be expressed in pixels derived from the column requirement, not just hardcoded — e.g. `min_cols × char_width_px + scrollbar_width`

## Research Tasks

- [ ] Install and inspect Claude Code desktop: how it handles narrow windows, what collapses first, any keyboard shortcuts for panel visibility
- [ ] Inspect Codex desktop: same audit
- [ ] Measure actual minimum usable widths for the kanban board (how many columns, card width floor)
- [ ] Check if Tauri `window-resized` event is reliable enough for reactive constraint updates
- [ ] **Terminal floor research:** Measure the minimum column count at which Claude Code renders without visual errors; test with Codex and other TUI tools
- [ ] **Signal propagation check:** Verify xterm.js `.fit()` is called on every drawer resize and SIGWINCH is correctly forwarded to the running process — rule out Option A before enforcing a hard floor

## Relation to Other Items

- **embedded-agent-terminals** (p2, in-progress) — terminal minimum width requirements (Claude Code column floor) directly inform the drawer min-width values here; coordinate on xterm.js `.fit()` + SIGWINCH propagation correctness
- **flexible-layout-orientation** (p4, up-next) — vertical stacking mode adds height constraint requirements; coordinate min-height logic
- **hub-session-pairing** (p1, in-progress) — terminal tabs live in the drawer this spec constrains; minimum drawer width affects pairing UX
- **sidebar-position-rethink** (p14, pending) — if sidebar moves to right side, concertina order changes
- **pre-release-hardening** — layout bugs are user-visible; constraint system should ship before first public sharing
