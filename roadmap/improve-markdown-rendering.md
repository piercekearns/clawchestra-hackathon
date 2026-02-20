---
title: Improve Markdown Rendering
status: complete
type: deliverable
parent: clawchestra
lastActivity: 2026-02-12
tags: [ui, markdown, p2]
shippedDate: 2026-02-12
---

# Improve Markdown Rendering

Make markdown documents render beautifully in the detail view, similar to Notion/Obsidian.

## Requirements

- Good typography and spacing (Tailwind prose/typography plugin)
- Interactive checkboxes (click to toggle, syncs back to file)
- Syntax highlighting for code blocks
- Collapsible sections (optional)
- Styled tables
- Link handling

## Dependencies

- react-markdown or similar renderer
- @tailwindcss/typography plugin
- Syntax highlighting library (shiki, prism, etc.)

## Use Cases

- Viewing spec documents
- Viewing plan documents with checkboxes
- General project documentation

## Notes

This enables rich interaction with Level 3 documents (specs, plans) without needing to open an external editor.
