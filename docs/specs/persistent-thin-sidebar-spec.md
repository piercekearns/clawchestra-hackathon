# Persistent Thin Sidebar

> Add a persistent, icon-only sidebar that expands into the full sidebar panel when toggled.

## Summary

Introduce a thin, always-visible sidebar that hosts core actions as icons (search, add project, refresh, git sync, switch side, settings). Existing sidebar toggles expand this thin bar into the full sidebar panel, with the thin bar collapsing back when the panel closes. This lets us remove the search/refresh/add/git sync row from the main board surface while keeping those actions discoverable.

---

**Roadmap Item:** `persistent-thin-sidebar`
**Status:** Draft
**Created:** 2026-02-25

---

## Goals

- Provide a **persistent, thin sidebar** as the default state.
- Consolidate core actions into icon-only affordances.
- Keep the full sidebar behavior intact — the thin bar simply expands into it.
- Remove the top search/refresh/add/git sync row from the board surface after this ships.

## Core Behavior

- **Default state:** thin icon-only sidebar is always visible.
- **Toggle behavior:** existing left/right sidebar toggles expand the thin bar into the full sidebar panel.
- **Side switching:** thin bar can switch between left/right sides.
- **Mutual exclusivity:** when the full sidebar is open on one side, the thin bar on the opposite side disappears; it returns on close.

## Thin Sidebar Icons

**Top stack (in order):**
1. **Search** — opens search (tooltip: “Search projects and roadmaps” + subtle ⌘K hint).
2. **Add Project** — opens add/new project modal (tooltip: “Add project”).
3. **Refresh** — triggers refresh (tooltip: “Refresh Clawchestra”).
4. **Git Sync** — opens Git Sync (tooltip: “Manage Git Syncs”) and shows badge when needed.
5. **Switch Side** — moves thin sidebar left/right (tooltip updates based on current side).

**Bottom:**
- **Settings** — opens settings (tooltip: “Settings”).

## Full Sidebar Expansion

- Expanding the sidebar shows **icon + label tiles** for the same actions.
- Settings remains pinned to the bottom of the expanded sidebar.

## UI Implications

- Remove the search/refresh/add/git sync row from the board surface once this is live.
- Ensure tooltips are consistent with existing app tooltip styling.

## Open Questions

- **Git Sync icon:** use the GitHub octocat icon from Lucide (thin `github` icon), with a small notification badge.
- **Cmd+K hint:** subtle inline text in the tooltip (no chip).
- **Thin sidebar width:** not user-configurable.
