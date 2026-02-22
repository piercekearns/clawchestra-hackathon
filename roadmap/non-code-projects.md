# Non-Code Projects

Support projects without a git repo — personal planning, writing, business projects. All kanban/roadmap/chat features work; GitSync, auto-commit, branch injection, and git status are disabled. db.json becomes the sole content store for these projects (no git backing).

## Key Deliverables
- `is_git_repo: bool` field in `DbProjectData` (local-only, not synced)
- `probe_repo()` detection on folder selection in Add Project dialog
- Graceful disabling of git-dependent features for non-git projects
- Migration state machine shortcut: NotStarted → Projected directly (skip git steps)
- Add Project dialog handles non-git folders without errors
- db.json as canonical content store — `specDocContent`/`planDocContent` fields are the primary store, not synced copies of git files
- Markdown editor in Clawchestra UI for creating/editing spec and plan docs directly (non-git projects have no IDE/editor to fall back to)
- "Create new project" flow without folder selection — pure db.json project, no filesystem dependency
- Trello-like card detail editing — text fields, checklists, and other structured data on roadmap items (future enhancement)

## Vision

Clawchestra becomes a general-purpose AI-powered project tracking tool, not just a coding project tracker. Users can track weddings, business plans, writing projects, or anything else using kanban boards with AI assistance via OpenClaw. The `specDocContent`/`planDocContent` fields (introduced in the architecture-direction Phase 5.21) already provide the data infrastructure — this item adds the non-git project flows and editing UI.

## Spec
See `docs/specs/non-code-projects-spec.md` for full analysis.

## Status
pending

## Priority
Phase 8+ — implement after architecture-direction Phases 5-7 are complete. The content field infrastructure and continuous sync (delivered in Phases 5-7) are prerequisites.

## Dependencies
- Architecture-direction Phases 5-7 complete (content fields in db.json, continuous sync, write-back mechanism)
- Phase 5 frontend alignment (Add Project dialog must be updated)
