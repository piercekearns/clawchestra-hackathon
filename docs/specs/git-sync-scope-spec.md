# Git Sync: Scope Expansion — Spec

> Expand Git Sync from dashboard-managed files only to all dirty files in a project, with three-category grouping and full commit/push support for any change.

**Status:** up-next
**Depends on:** git-sync (phase 1) completion
**Roadmap ID:** git-sync-scope

---

## Context

Git Sync phase 1 only detects and offers to commit "dashboard-managed files" — a hardcoded list of files that Clawchestra directly writes to (`PROJECT.md`, `ROADMAP.md`, `CHANGELOG.md`, `roadmap/`, `docs/specs/`, `docs/plans/`).

However, Clawchestra is also used to make code changes via the AI chat interface. When a user asks OpenClaw to refactor a component or update CSS, those changes happen in `src/` or other code directories. Currently, those changes are **detected** (the git status icon turns amber) but the Sync dialog doesn't offer to commit them.

Additionally, changes made by external tools (VS Code, Codex, Claude Code) to repos that Clawchestra tracks are also detected but not actionable through the Sync dialog.

## Problem

- Users make code changes through Clawchestra's AI chat but can't commit them through Git Sync
- Users make changes in external editors to tracked repos and see the amber icon but can't act on it
- The current "dashboard-managed files" scope is an artificial limitation that doesn't match how the app is actually used

## Proposed Solution

### Three-Category File Grouping

Expand the Sync dialog to show ALL dirty files, grouped into three categories:

| Category | Files | Trigger |
|---|---|---|
| **Metadata** | `PROJECT.md` | Moving cards between columns, editing project details, changing priority/tags |
| **Documents** | `ROADMAP.md`, `CHANGELOG.md`, `roadmap/*.md`, `docs/specs/*.md`, `docs/plans/*.md` | Adding/editing/reordering roadmap items, writing specs/plans |
| **Code** | Everything else (`src/`, configs, tests, assets, etc.) | AI chat code changes, external editor changes, any other modification |

### UI Changes

1. **Sync dialog file list:** Show all three groups with collapsible headers, file counts per group
2. **Per-category selection:** Users can toggle entire categories on/off (e.g., commit metadata + docs but not code)
3. **Per-file selection (stretch):** Individual file checkboxes within categories for granular control
4. **Sync button visibility:** Trigger when ANY file is dirty, not just dashboard-managed files
5. **Commit message:** Auto-generated message reflects which categories and files are included

### Backend Changes

1. **Remove `filter_dashboard_dirty_files`** — or make it one of three category filters
2. **`dashboardDirty` → `hasDirtyFiles`** — boolean for "any dirty files exist"
3. **Categorize files in Rust:** Return `dirtyFiles` grouped by category: `{ metadata: string[], documents: string[], code: string[] }`
4. **File count in header badge:** Show total dirty file count across all categories

### Considerations

- **Code changes are riskier** — the UI should make it clear when you're committing code vs metadata. Metadata commits are "safe" (no build impact), code commits could break things.
- **Large file lists** — repos with many dirty code files could produce long lists. Collapsible groups + file counts handle this.
- **Commit message convention** — metadata-only commits use `chore: sync project metadata (...)`, mixed commits might use `chore: sync project changes (...)` or let the user decide.
- **Staged vs unstaged** — currently we show all dirty files regardless of git staging state. We should consider whether to respect existing staging or always stage-then-commit selected files.

## Out of Scope

- Branch management (separate roadmap item: git-branch-sync)
- Pull/merge operations (detecting "behind remote" is existing, acting on it is branch-sync territory)
- Diff preview (useful but can be a later enhancement)
- `.gitignore` management

## Success Criteria

- [ ] All dirty files in a repo appear in the Sync dialog, grouped by category
- [ ] Users can select/deselect entire categories
- [ ] Commit message updates dynamically to reflect selection
- [ ] Sync button appears for any dirty files, not just dashboard-managed ones
- [ ] External changes (made in VS Code/Codex) are visible and committable through Sync
