# Git Sync: Scope Expansion — Spec

> Expand Git Sync from dashboard-managed files only to all dirty files in a project, with three-category grouping and full commit/push support for any change.

**Status:** up-next
**Depends on:** git-sync (phase 1) completion
**Roadmap ID:** git-sync-scope

---

## Context

Git Sync phase 1 only detects and offers to commit "dashboard-managed files" — a hardcoded list of files that Clawchestra directly writes to (`PROJECT.md`, `ROADMAP.md`, etc.).

However, Clawchestra is also used to make code changes via the AI chat interface, and it tracks repos where changes are made by external tools (VS Code, Codex, Claude Code). Currently those changes are **detected** (git status icons turn amber/blue/rose) but the Sync dialog doesn't offer to commit them.

## The Three Categories

Files are grouped by their relationship to Clawchestra:

### Metadata — Clawchestra-exclusive
- **Files:** `PROJECT.md`
- **What triggers changes:** Dragging cards between columns, editing project details, changing priority/tags/icon
- **Relationship:** Only Clawchestra reads or writes these. Committing them is "selfish" — it's for Clawchestra's own continuity. If you deleted the local repo and re-cloned from GitHub, the PROJECT.md would restore the app's knowledge of that project's status.
- **Risk level:** Zero — these changes can never break a build or affect the project's actual functionality.

### Documents — Clawchestra + external relevance
- **Files:** `ROADMAP.md`, `CHANGELOG.md`, `roadmap/*.md`, `docs/specs/*.md`, `docs/plans/*.md`
- **What triggers changes:** Adding/removing/reordering roadmap items, marking deliverables complete, writing or updating specs and plans
- **Relationship:** Clawchestra creates and manages these, but they're useful outside the app too. If you're working on a project in VS Code or with a coding agent, the ROADMAP.md tells you what to work on next. These are planning documentation that happens to be managed through Clawchestra's UI.
- **Risk level:** Low — structured markdown files, no build impact, but represent planning decisions that matter.

### Code — everything else
- **Files:** `src/`, `package.json`, config files, tests, assets, etc.
- **What triggers changes:** AI chat code changes via OpenClaw, OR external tools (VS Code, Codex, Claude Code, cloud Codex instances)
- **Relationship:** Not Clawchestra-specific at all. These are the actual project files. Clawchestra can detect their dirty state and help commit them, but it didn't create the changes.
- **Risk level:** Variable — code changes can break builds, introduce bugs, cause merge conflicts. The Sync dialog should make it clear when you're committing code vs metadata.

### How detection already works

The app already tracks all of this on every Refresh:
- `git status --porcelain` → detects ALL uncommitted changes (any tool, any file)
- `git rev-list --count @{u}..HEAD` → unpushed local commits
- `git rev-list --count HEAD..@{u}` → remote is ahead (e.g., cloud Codex merged a PR)

The git status icons already reflect this:
- 🟢 Green = clean | 🟠 Amber = uncommitted | 🔵 Blue = unpushed | 🔴 Rose = behind remote

**Expanding Git Sync scope makes these icons more actionable** — amber means "open Sync to commit", not just "something changed somewhere."

## Proposed Changes

### Backend (Rust)

1. **Return all dirty files with categories:**
   ```rust
   struct DirtyFiles {
       metadata: Vec<String>,
       documents: Vec<String>,
       code: Vec<String>,
   }
   ```
2. **Replace `dashboardDirty: bool`** with `hasDirtyFiles: bool` (true when any category has files)
3. **Keep `is_dashboard_file()` logic** but expand to categorize: `categorize_dirty_file(path) -> "metadata" | "documents" | "code"`

### Frontend (Sync Dialog)

1. **Three collapsible groups** with file counts: `Metadata (1)`, `Documents (3)`, `Code (7)`
2. **Per-category toggle** — check/uncheck entire category
3. **Per-file selection (stretch)** — individual checkboxes within categories
4. **Visual risk indicator** — subtle warning when Code category is selected ("Code changes included — review before committing")
5. **Sync button triggers on any dirty files**, not just dashboard-managed

### Commit Message

Auto-generated message adapts to what's selected:
- Metadata only: `chore: sync project metadata (ProjectName) — PROJECT.md`
- Documents only: `docs: update roadmap (ProjectName) — ROADMAP.md, roadmap/feature.md`
- Code only: `chore: sync code changes (ProjectName) — src/App.tsx, +2 more`
- Mixed: `chore: sync project changes (ProjectName) — 3 files across metadata, docs, code`

## Out of Scope

- Branch management (git-branch-sync)
- Pull/merge operations
- Diff preview
- `.gitignore` management

## Success Criteria

- [ ] All dirty files appear in the Sync dialog, grouped by category
- [ ] Users can toggle entire categories on/off
- [ ] Code category has a subtle risk indicator
- [ ] Commit message updates dynamically to reflect selection and categories
- [ ] Sync button appears for any dirty files, not just dashboard-managed ones
- [ ] External changes (VS Code, Codex) are visible and committable through Sync
