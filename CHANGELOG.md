---
title: Pipeline Dashboard Changelog
---

# Pipeline Dashboard — Changelog

Completed features and fixes, most recent first.

---

## 2026-02-16

### OpenClaw Platform Interaction Audit ✅
- Comprehensive audit of all 20 OpenClaw communication channels
- Per-platform capability breakdowns, cross-platform comparison matrix
- Tier system identified: Telegram/Discord (richest) → Nostr/Tlon (minimal)
- Output: `clawdbot-sandbox/projects/openclaw-platform-audit.md`

## 2026-02-13

### Project Architecture Overhaul ✅
- Phase 1: Schema & docs alignment — `schema.ts` types, `SCHEMA.md`, `ChangelogEntry`/`RoadmapItem` definitions
- Phase 2: CHANGELOG lifecycle — `changelog.ts` with auto-migration from ROADMAP → CHANGELOG on completion
- Phase 3: Data retrofit — PROJECT.md files standardized across all repos and `~/projects/`, CHANGELOG.md paired
- Phase 4: Scan paths — `scan_projects()` discovers PROJECT.md files from configurable scan paths, replaces old catalog system
- Note: default scan path still references `~/clawdbot-sandbox/projects/` — needs one-line update to `~/projects/` (tracked in Chat Infrastructure P1)

### Project Modal Improvements ✅
- Phase 1: Foundation — Generic `StatusBadge<T>`, `ProjectModalHeader`, `useProjectModal` hook, types
- Phase 2: Roadmap data loading + doc resolution with frontmatter-first strategy
- Phase 3: `RoadmapItemList` + `RoadmapItemRow` + `DocBadge` + DnD reordering
- Phase 4: `RoadmapItemDetail` view with doc tabs + view state + doc cache
- Phase 5: `ProjectDetails` collapsible section
- Phase 6: Polish — responsive layout, keyboard nav, edge cases
- 14 files, 1402 insertions. Old `CardDetail.tsx` removed.

## 2026-02-12

### Architecture V2.1 Hardening ✅
- Added mutation locking around catalog/filesystem write commands in Tauri runtime
- Added lock-contention retry handling in Create New/Add Existing project flows
- Added rollback-focused tests for create/add-existing late failures and migration smoke coverage
- Added hardening telemetry for path normalization/resolution failures

### Architecture V2 (MVP) ✅
- Shipped settings-backed four-path model (`catalogRoot`, `workspaceRoots`, `openclawWorkspacePath`, `appSourcePath`)
- Shipped Project Wizard flows for Create New and Add Existing with compatibility and retrofit logic
- Shipped V2 migration runner and cutover hooks; removed hardcoded app/repo path assumptions
- Finalized local cutover state to repos-first (`/Users/piercekearns/repos`) and retired legacy sandbox app copy
- Split deferred hardening into follow-up deliverable: `Architecture V2.1 Hardening`

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
