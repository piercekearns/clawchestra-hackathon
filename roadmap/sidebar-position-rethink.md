---
title: Reconsider Sidebar Side Positioning
id: sidebar-position-rethink
status: pending
priority: 14
tags: [ux, layout, sidebar, customisation]
icon: "⇄"
nextAction: "Revisit once flexible-layout-orientation ships; decide whether sidebar side-switching adds value or just adds confusion given panel reordering capabilities"
lastActivity: "2026-03-01"
---

# Reconsider Sidebar Side Positioning

A UX flag — not necessarily a change. As we add more layout flexibility to the app, we should periodically revisit whether letting users toggle **which side of the app the sidebar lives on** is worth building.

## The Question

Should the user be able to move the sidebar (and thin strip) from the left to the right?

Currently the sidebar is always on the left:

```
[ Thin strip | Sidebar ] | [ Content panels ]
```

A right-side version would look like:

```
[ Content panels ] | [ Sidebar | Thin strip ]
```

## Why It Might Be Worth Building

- Some users strongly prefer navigation on the right (e.g. right-handed trackpad users, certain monitor setups)
- As we allow panel reordering (`flexible-layout-orientation`), the sidebar starts to feel like the one thing that isn't movable — which can feel arbitrary
- On ultra-wide monitors, having the sidebar on the right might pair better with certain workflows

## Why It Might Not Be Worth It

- Once you can reorder the chat drawer and kanban board, the "which side is everything on" question becomes somewhat moot — the user is already composing their own layout
- Adding sidebar-side toggle increases implementation complexity significantly (thin strip, sidebar, and all panel-awareness code need to be side-aware)
- The UX sometimes feels confusing already — adding another axis of variation might make that worse, not better
- There may be no consistent "right answer" here — just personal preference, and we risk building a rarely-used feature that adds surface area for bugs

## What to Watch For

- **When `flexible-layout-orientation` ships:** does the panel reordering make sidebar placement feel irrelevant, or does the asymmetry become more noticeable?
- **User feedback:** does anyone actually ask for this, or is the confusion the original developer noticed points to something else?
- **The thin strip:** if the sidebar moves, does the thin strip move with it? That's the more technically complex question. Independent movement seems wrong UX-wise but may be what some users want.

## Related Items

- `flexible-layout-orientation` — panel swap and orientation toggle (ships first, informs this decision)
- `sidebar-enhancements` — sidebar contents
- `collapsible-sidebar` — sidebar shell (shipped)

---

*Added 2026-03-01. This is a "reconsider later" item, not a committed feature. Evaluate after flexible-layout-orientation lands.*
