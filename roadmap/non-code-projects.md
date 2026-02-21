# Non-Code Projects

Support projects without a git repo — personal planning, writing, business projects. All kanban/roadmap/chat features work; GitSync, auto-commit, branch injection, and git status are disabled.

## Key Deliverables
- `is_git_repo: bool` field in `DbProjectData` (local-only, not synced)
- `probe_repo()` detection on folder selection in Add Project dialog
- Graceful disabling of git-dependent features for non-git projects
- Migration state machine shortcut: NotStarted → Projected directly (skip git steps)
- Add Project dialog handles non-git folders without errors

## Spec
See `docs/specs/non-code-projects-spec.md` for full analysis.

## Status
pending

## Priority
Lowest priority of the four new roadmap items. Implement after branch-aware spec viewing, smart import, and cloud agent sync.

## Dependencies
- Phase 5 frontend alignment (Add Project dialog must be updated)
