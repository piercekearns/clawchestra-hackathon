---
title: Pipeline Dashboard Changelog
---

# Pipeline Dashboard — Changelog

Completed features and fixes, most recent first.

---

## 2026-02-12

### Chat UX Overhaul (MVP) ✅
- Fixed message truncation (final content no longer cut off)
- Activity indicator stays visible throughout entire response cycle
- Message queue system (type while agent works, auto-sends on completion)
- Dynamic slash commands (49 total: workflows, skills, OpenClaw TUI)
- Escape closes command dropdown without closing drawer
- Arrow key scroll works both directions in command list

### Chat Drawer UI ✅
- Resizable drawer with drag handle
- Unified drawer (history + composer in one panel)
- Response toast with manual dismiss
- Status badge and activity indicator in header
- Backdrop click to close

### Improve Markdown Rendering ✅
- react-markdown with remark-gfm for GitHub-flavored markdown
- Tailwind typography plugin for prose styling
- Code blocks, tables, lists properly styled
- Dark/light theme support

---

## 2026-02-11

### Smart Update Button ✅
- Yellow pill badge next to "Pipeline Dashboard" title
- Only appears when git HEAD differs from build commit (i.e., code changes pending)
- Checks every 30s (lightweight `git rev-parse`)
- Click → app closes → rebuilds in background → reopens with changes
- No manual drag-to-Applications required

### OpenClaw Chat Integration
- Chat bar with gateway connection
- Image attachments via drag-drop or paste
- Multi-image support (writes to temp file for large payloads)
- Responses displayed inline

### Stale Project Indicators
- Visual indicators for projects that haven't been touched recently
- Indicators positioned left of priority badges for column alignment

### Core Dashboard
- Kanban board with drag-and-drop
- Project cards from markdown files
- Git status integration
- Theme switching (light/dark/system)
- Search and filter

---

*Older entries would go here as we ship more.*
