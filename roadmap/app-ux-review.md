---
title: App UX Review & Improvements
id: app-ux-review
status: pending
tags: [ui, ux, roadmap]
icon: "🎨"
---

# App UX Review & Improvements

Hands-on review of the dashboard UX — what works, what doesn't, what's missing. Captures improvements discovered through daily use of the app.

## Why

The modal build (6 phases) and architecture overhaul are shipped. Now it's time to live in the app and identify friction points. This is a "sharpen the saw" item — not a single feature but a collection of UX improvements that emerge from real use.

## Known Ideas (to evaluate)

### Roadmap Kanban View
- Currently roadmap items are vertically stacked in the modal
- Idea: offer a Kanban board view for roadmap items within a project (same board metaphor as top-level projects)
- Should be toggleable: vertical priority list (current) vs Kanban columns
- Kanban columns would map to roadmap item statuses (pending, in-progress, complete)

### General UI Polish
- Reserved for items discovered during a proper hands-on review
- Examples: layout tweaks, interaction patterns, missing affordances, visual hierarchy

### Tier Badges
- 💡 Idea (PROJECT.md only, no git)
- 📁 Local (has `.git/`)
- 🔗 GitHub (has `repo:` field)
- Where: project cards + modal header
- Filterable? TBD

## Process

The project owner will do a structured walkthrough:
1. Open the app, use every view
2. Note what feels good, what feels bad, what's missing
3. Capture as sub-items here
4. Prioritize and build

## Dependencies

Should be done **after** Chat Infrastructure Overhaul (P1) — chat reliability is more impactful than UI polish.
