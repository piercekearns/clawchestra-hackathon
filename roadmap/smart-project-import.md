# Smart Project Import

AI-driven migration from external tools (Notion, Trello, Linear, scattered docs) into Clawchestra. All parsing is done by OpenClaw — Clawchestra provides file picker, prompt templates, and picks up the result via the state.json watcher. No custom parsers.

## Key Deliverables
- Three import paths: scan existing docs, upload export file, guided blank start
- Prompt templates for each path, pre-seeded with Clawchestra schema
- File picker integration for export file upload
- "Import existing planning data" section in Add Project dialog
- "Re-import / refresh from existing docs" option in project settings

## Spec
See `docs/specs/smart-project-import-spec.md` for full analysis.

## Status
pending

## Dependencies
- Phase 5 frontend alignment (Add Project dialog overhaul)
- Phase 6 (state.json watcher + OpenClaw chat wiring)

## Non-Goal
Clawchestra implements no proprietary format parsers. Format intelligence lives in OpenClaw.
