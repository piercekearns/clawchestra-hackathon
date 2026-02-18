# Git Sync — Technical Specification

> Surface uncommitted changes and let users commit + push project metadata to GitHub on demand — without auto-pushing.

The dashboard writes to PROJECT.md frontmatter when users drag kanban cards, update priorities, or change roadmap item statuses. These changes exist only locally until explicitly committed and pushed. This spec adds visibility into that drift and a safe, deliberate sync workflow.

**Status:** Spec Draft
**Created:** 2026-02-18
**Author:** Clawdbot
**Roadmap Item:** `roadmap/git-sync.md`

---

## Table of Contents

1. [Problem](#problem)
2. [Design Principles](#design-principles)
3. [Dirty State Detection](#dirty-state-detection)
4. [UI: Card-Level Indicators](#ui-card-level-indicators)
5. [UI: Global Sync Action](#ui-global-sync-action)
6. [Commit Strategy](#commit-strategy)
7. [Push Behavior](#push-behavior)
8. [Edge Cases](#edge-cases)
9. [What This Does NOT Do](#what-this-does-not-do)
10. [Component Hierarchy](#component-hierarchy)
11. [State Management](#state-management)
12. [Build Scope](#build-scope)

---

## Problem

When you drag a card from "Up Next" to "In Progress" on the kanban board, Clawchestra writes the status change to the project's `PROJECT.md` frontmatter. But that's a local file write only. If the project is a GitHub repo, the change is:

- ✅ Written to the local file
- ❌ Not staged or committed in git
- ❌ Not pushed to GitHub

There's no visibility into this drift, and no way to sync it short of opening a terminal. Users accumulate invisible uncommitted changes across multiple projects without realizing.

---

## Design Principles

1. **Never auto-push** — committing to a remote repo is a deliberate act. The dashboard is not a CI pipeline.
2. **Visibility first** — show users what's drifted before offering to fix it.
3. **Batch over granular** — one commit per sync action, not one commit per drag. Noisy git history helps no one.
4. **Safe by default** — only commit files the dashboard knows it wrote to (PROJECT.md, ROADMAP.md, CHANGELOG.md). Never commit unrelated changes.
5. **Leverage existing infrastructure** — the app already scans `gitStatus` with state `clean | uncommitted | unpushed | behind | unknown`. Build on that, don't duplicate it.

---

## Dirty State Detection

### What exists today

The Tauri backend already runs `git status` during project scanning and exposes:

```typescript
interface GitStatus {
  state: 'clean' | 'uncommitted' | 'unpushed' | 'behind' | 'unknown';
  branch?: string;
  details?: string;
  remote?: string;
}
```

### What needs to change

The current `state` is coarse-grained — it tells us "this repo has uncommitted changes" but not *which files* changed or *whether those changes were from the dashboard*.

**Enhancement**: Add a `dashboardDirty` flag to `GitStatus`:

```typescript
interface GitStatus {
  state: GitStatusState;
  branch?: string;
  details?: string;
  remote?: string;
  /** True when PROJECT.md / ROADMAP.md / CHANGELOG.md have uncommitted changes */
  dashboardDirty?: boolean;
  /** List of dashboard-managed files with uncommitted changes */
  dirtyFiles?: string[];
}
```

The Tauri backend checks `git diff --name-only` for the project directory and filters for known dashboard-managed files:
- `PROJECT.md`
- `ROADMAP.md`
- `CHANGELOG.md`
- `roadmap/*.md` (roadmap item files)
- `docs/specs/*.md` and `docs/plans/*.md` (lifecycle artifacts)

If any of these have uncommitted changes, `dashboardDirty = true`.

---

## UI: Card-Level Indicators

### Project Cards (Board View)

When a project has `dashboardDirty: true`, show a small indicator on the project card:

```
┌─────────────────────────────┐
│  ClawOS               ●     │  ← orange dot = uncommitted dashboard changes
│  In Progress          3/wk  │
└─────────────────────────────┘
```

- **Orange dot** (or subtle git icon) in the card's metadata area
- Tooltip: "Uncommitted changes to PROJECT.md"
- Only shows for projects with `dashboardDirty: true` — not for general repo dirtiness (user's code changes are their business)

### Roadmap Item Rows

When a roadmap item's parent project has uncommitted changes to ROADMAP.md:

- Subtle indicator on the roadmap item row (same orange dot pattern)
- Tooltip: "ROADMAP.md has uncommitted changes"

---

## UI: Global Sync Action

### Header Button

Add a sync button to the Header bar (alongside Refresh and Add Project):

```
[🔍 Search]                    [↻ Refresh]  [⬆ Sync (3)]  [+ Add Project]
```

- **Icon**: `GitCommitHorizontal` or `Upload` from lucide-react
- **Badge**: Shows count of projects with `dashboardDirty: true`
- **Hidden when count is 0** — don't clutter the header when everything is clean
- **Click**: Opens the Sync Dialog

### Sync Dialog

A modal listing all projects with uncommitted dashboard changes:

```
┌──────────────────────────────────────────────┐
│  Sync Changes to GitHub                      │
│                                              │
│  3 projects have uncommitted changes:        │
│                                              │
│  ☑ ClawOS                                    │
│    PROJECT.md — status: active → in-progress │
│                                              │
│  ☑ Memestr                                   │
│    ROADMAP.md — 2 items updated              │
│                                              │
│  ☑ piercekearns.com                          │
│    PROJECT.md — priority: 3 → 1              │
│                                              │
│  ☐ Pipeline Dashboard  (no remote)           │
│    PROJECT.md — modified                     │
│                                              │
│  Commit message:                             │
│  ┌────────────────────────────────────────┐  │
│  │ chore: sync project metadata           │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  ☑ Push after commit                         │
│                                              │
│  [Cancel]                      [Commit (3)]  │
└──────────────────────────────────────────────┘
```

**Features:**
- Checkbox per project (all checked by default, except repos without a remote)
- Brief description of what changed per project (from `dirtyFiles` + `git diff --stat`)
- Editable commit message with sensible default: `"chore: sync project metadata"`
- "Push after commit" toggle (on by default for repos with a remote)
- Projects without a GitHub remote shown but disabled for push — can still commit locally
- Commit button shows count of selected projects

---

## Commit Strategy

### What gets committed

**Only dashboard-managed files** in each selected project:
- `PROJECT.md`
- `ROADMAP.md`
- `CHANGELOG.md`
- `roadmap/*.md`
- `docs/specs/*.md`
- `docs/plans/*.md`

This is a targeted `git add <specific-files>` followed by `git commit`, NOT `git add -A`. User code changes, untracked files, and other modifications are left alone.

### Commit message

Default: `"chore: sync project metadata"`

The user can edit this in the dialog. If syncing multiple projects, each project gets its own commit in its own repo with the same message.

### Execution

For each selected project:
1. `git add PROJECT.md ROADMAP.md CHANGELOG.md roadmap/ docs/specs/ docs/plans/` (only files that exist and have changes)
2. `git commit -m "<message>"`
3. If push enabled and remote exists: `git push origin <current-branch>`

All via Tauri `Command` — not through the chat/OpenClaw. This is a direct Tauri backend operation.

---

## Push Behavior

- **Push is optional** — the toggle defaults to on, but the user can commit without pushing
- **Only pushes to current branch's upstream** — no force-push, no branch creation
- **Fast-forward only** — if the push would require a merge/rebase, show an error and suggest resolving manually
- **Auth**: Uses whatever git credentials are configured locally (SSH keys, credential helper, etc.) — the app does not manage git auth

### Error Handling

| Scenario | Behavior |
|---|---|
| Commit succeeds, push fails | Show warning: "Committed locally but push failed: {error}. Changes are saved — push manually when ready." |
| No remote configured | Commit locally only, skip push silently |
| Merge conflict on push | Show error: "Remote has changes not in your local branch. Pull and resolve before pushing." |
| Nothing to commit | Skip project, don't show error |

---

## Edge Cases

### Project without git
- No indicator shown. Dashboard writes still work (PROJECT.md exists), but there's no git context to track.

### Project with git but no remote
- `dashboardDirty` indicator still shows (uncommitted local changes exist)
- Commit available, push disabled in Sync Dialog
- Tooltip clarifies: "Local repo only — no remote configured"

### Multiple scan paths
- Each project resolves to its own git repo. A single Sync action can commit+push across multiple repos.

### Concurrent edits
- If a project's files are modified between opening the Sync Dialog and clicking Commit, the dialog should re-check `git status` before committing and warn if the diff has changed.

### ROADMAP.md lives in a different repo than PROJECT.md
- Not a concern today — all roadmap files live in the same project directory. If this changes, the spec should be revisited.

---

## What This Does NOT Do

- ❌ **Auto-commit or auto-push** — ever
- ❌ **Commit user code** — only dashboard-managed metadata files
- ❌ **Create branches** — commits to the current branch only
- ❌ **Resolve merge conflicts** — that's manual work
- ❌ **Manage git credentials** — uses whatever's configured locally
- ❌ **Track per-field diffs** — the diff description is file-level, not "status changed from X to Y" (that's a nice-to-have for later)

---

## Component Hierarchy

```
Header.tsx
  └── SyncButton (new) — badge + click handler
        └── SyncDialog (new) — modal with project list, commit message, push toggle

Tauri Backend
  └── git_sync commands (new):
        ├── get_dirty_projects() → DirtyProject[]
        ├── commit_projects(projectIds, message) → CommitResult[]
        └── push_projects(projectIds) → PushResult[]
```

---

## State Management

### New Zustand state

```typescript
interface DashboardState {
  // ... existing ...
  
  /** Count of projects with uncommitted dashboard-managed file changes */
  dirtyProjectCount: number;
  setDirtyProjectCount: (count: number) => void;
}
```

`dirtyProjectCount` is updated during the existing `loadProjects()` scan — no separate polling needed. The Tauri backend already runs `git status` per project; it just needs to additionally check `git diff --name-only` against the dashboard file allowlist.

### No persistence needed

Dirty state is derived from the filesystem on every scan. Nothing to persist.

---

## Build Scope

### Phase 1 — Visibility
- Extend Tauri git status scanning to detect `dashboardDirty`
- Add orange dot indicator to project cards
- Add Sync button with badge count to Header
- Basic Sync Dialog (list dirty projects, default commit message, commit + push)

### Phase 2 — Polish (deferred)
- Per-field diff descriptions ("status: active → in-progress")
- Commit history view per project (last N syncs)
- Keyboard shortcut for Sync (e.g., `Cmd+Shift+S`)
- Roadmap item dirty indicators
- Pre-commit re-check for concurrent modifications

---

## Open Questions

1. **Should `docs/specs/` and `docs/plans/` be included in the dirty check?** These are written by agents during lifecycle orchestration, and may be large. Including them means agent-written specs get synced too, which is probably desirable but worth confirming.
2. **Should the commit message auto-include which projects were synced?** e.g., `"chore: sync metadata (ClawOS, Memestr)"` — more useful git history but longer messages for many-project syncs.
3. **Should there be a per-project commit option?** The current spec batches all selected projects into one action per repo. Some users might want to review and commit one at a time.
