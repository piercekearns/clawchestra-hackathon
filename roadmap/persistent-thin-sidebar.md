---
title: Persistent Thin Sidebar
id: persistent-thin-sidebar
status: pending
tags: [ui, sidebar, navigation, feature]
icon: "🧭"
lastActivity: "2026-02-25"
---

# Persistent Thin Sidebar

Introduce a **persistent, thin sidebar** that is always visible and contains only icons. The existing left/right sidebar toggles would expand this thin bar into the full sidebar panel (and collapse back to the thin bar).

## Core Behavior

- Default state: a **thin icon-only sidebar** is always present.
- Existing sidebar toggles expand the thin bar into the **full sidebar panel**.
- When the full sidebar is open on one side, the thin sidebar on the opposite side should disappear; it should return when the full sidebar is closed.

## Icon Set (Thin Sidebar)

**Top (stacked):**
- **Search** — opens search (tooltip: “Search projects and roadmaps” + subtle ⌘K hint)
- **Add Project** — opens add/new project modal (tooltip: “Add project”)
- **Refresh** — triggers refresh (tooltip: “Refresh Clawchestra”)
- **Git Sync** — opens Git Sync panel/modal + badge (tooltip: “Manage Git Syncs”)
- **Switch Side** — swaps thin sidebar between left/right (tooltip reflects current side)

**Bottom:**
- **Settings** — opens settings (tooltip: “Settings”)

## Full Sidebar Expansion

When expanded, the same actions become **icon + label tiles** (or similar), with the Settings action remaining pinned to the bottom.

## Implied Cleanup

Once this ships, remove the **search/refresh/add/git sync row** from the board surface.

## Open Questions

- Exact icon set (Git Sync: GitHub mark vs custom icon)?
- How to surface Cmd+K hint in the search tooltip (chip vs subtle text)?
- Should the thin sidebar width be user‑configurable?
