# Git Sync — Technical Specification

> Surface uncommitted changes and let users commit + push project metadata to GitHub on demand. For the common case, a simple Sync Dialog. For complex git situations, the AI handles it through chat.

The dashboard writes to PROJECT.md frontmatter when users drag kanban cards, update priorities, or change roadmap item statuses. These changes exist only locally until explicitly committed and pushed. This spec adds visibility into that drift and a safe, deliberate sync workflow — with an AI-assisted layer for anything beyond the basics.

**Status:** Spec Draft
**Created:** 2026-02-18
**Updated:** 2026-02-19
**Author:** Clawdbot
**Roadmap Item:** `roadmap/git-sync.md`

---

## Table of Contents

1. [Problem](#problem)
2. [Design Principles](#design-principles)
3. [Two-Layer Architecture](#two-layer-architecture)
4. [Dirty State Detection](#dirty-state-detection)
5. [UI: Card-Level Indicators](#ui-card-level-indicators)
6. [UI: Global Sync Action](#ui-global-sync-action)
7. [Branch Awareness](#branch-awareness)
8. [Change Categories](#change-categories)
9. [Commit Strategy](#commit-strategy)
10. [Push Behavior](#push-behavior)
11. [Edge Cases](#edge-cases)
12. [What Phase 1 Does NOT Do](#what-phase-1-does-not-do)
13. [Component Hierarchy](#component-hierarchy)
14. [State Management](#state-management)
15. [Build Scope](#build-scope)
16. [Future: AI-Assisted Git Management](#future-ai-assisted-git-management)

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
4. **Safe by default** — only commit files the dashboard knows it wrote to. Never commit unrelated changes.
5. **All selected by default** — every dirty project is checked on by default. Users uncheck what they want to skip, rather than having to opt-in per project.
6. **Smart defaults, manual overrides** — push defaults to on for clean branches, off for risky ones. User can always override.
7. **Leverage existing infrastructure** — the app already scans `gitStatus` with state `clean | uncommitted | unpushed | behind | unknown`. Build on that, don't duplicate it.
8. **Simple UI for common cases, AI for complex ones** — the Sync Dialog handles commit + push to current branch. Branch management, conflict resolution, and cross-branch sync go through the chat agent.

---

## Two-Layer Architecture

Git operations in Clawchestra span two layers:

### Layer 1: Sync Dialog (Phase 1)

A mechanical, UI-driven tool for the 80% case:
- See which projects have uncommitted dashboard changes
- Commit selected projects with one click
- Push to current branch's upstream
- No branch switching, no merging, no conflict resolution

### Layer 2: AI-Assisted Git Management (Phase 2+)

For everything the Sync Dialog can't handle, the chat agent steps in. The agent already has full project context, can see git state, and can run commands. Examples:

- *"ClawOS is 3 commits behind origin/main — want me to rebase and push?"*
- *"Memestr has diverged. Here's the diff — I can merge or rebase, your call."*
- *"You have uncommitted spec changes on a feature branch. Want me to cherry-pick them to main?"*

The Sync Dialog surfaces problems it can't solve (branch behind, diverged, no upstream) with a **"Ask agent to help"** action that pre-fills the chat with context.

This is the key insight: **you don't need to build a git client UI because the AI already is one.** The dashboard provides visibility and handles the easy cases; the agent handles the hard ones.

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

**What already exists (from Local Git Intelligence build, commit `7184c60`):**

```typescript
interface GitStatus {
  state: 'clean' | 'uncommitted' | 'unpushed' | 'behind' | 'unknown';
  branch?: string;
  details?: string;
  remote?: string;
  lastCommitDate?: string;
  lastCommitMessage?: string;
  lastCommitAuthor?: string;
  commitsThisWeek?: number;
  latestTag?: string;
  stashCount: number;
  aheadCount?: number;    // ← already tracks commits ahead of upstream
  behindCount?: number;   // ← already tracks commits behind upstream
}
```

`aheadCount` and `behindCount` already exist — no new fields needed for branch tracking. `diverged` is simply `aheadCount > 0 && behindCount > 0`, derived at display time.

**New fields needed (dashboard-specific dirty tracking):**

```typescript
interface GitStatus {
  // ... all existing fields ...

  /** True when dashboard-managed files have uncommitted changes */
  dashboardDirty?: boolean;
  /** List of dashboard-managed files with uncommitted changes */
  dirtyFiles?: string[];
}
```

The Tauri backend checks `git diff --name-only` (unstaged) and `git diff --name-only --cached` (staged) for the project directory, filtering for dashboard-managed files:
- `PROJECT.md`
- `ROADMAP.md`
- `CHANGELOG.md`
- `roadmap/*.md` (roadmap item files)
- `docs/specs/*.md` (spec documents)
- `docs/plans/*.md` (plan documents)

If any of these have uncommitted changes, `dashboardDirty = true`.

Branch tracking already handled by `get_git_status` — uses `git rev-list --left-right --count HEAD...@{upstream}` to populate `aheadCount`/`behindCount`.

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

A modal listing all projects with uncommitted dashboard changes. Each project row includes branch context and per-project actions:

```
┌──────────────────────────────────────────────────────────────┐
│  Sync Changes                                                │
│                                                              │
│  3 projects have uncommitted changes                         │
│                                                              │
│  ☑ ClawOS                       main ↑2        [Commit & Push]
│    ┊ Metadata: PROJECT.md — status changed                   │
│    ┊ Documents: docs/specs/new-feature-spec.md (new)         │
│                                                              │
│  ☑ Memestr                      main ✓         [Commit & Push]
│    ┊ Metadata: ROADMAP.md — 2 items updated                  │
│                                                              │
│  ☑ piercekearns.com             dev ↓3 ⚠       [Commit only]
│    ┊ Metadata: PROJECT.md — priority changed                 │
│    ┊ ⚠ Branch is behind remote — push may fail               │
│    ┊ [Ask agent to help]                                     │
│                                                              │
│  ☑ Pipeline Dashboard           main (no remote)  [Commit]  │
│    ┊ Metadata: PROJECT.md — modified                         │
│                                                              │
│  Commit message:                                             │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ chore: sync project metadata (ClawOS, Memestr, ...)  │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  [Cancel]                              [Sync All Selected]   │
└──────────────────────────────────────────────────────────────┘
```

**Features:**

- **All checked by default** — users uncheck projects they want to skip, rather than opting in per project. Exception: projects where push would likely fail default to "Commit only" (not unchecked — still committed, just not pushed).
- **Per-project action button** — each row has its own [Commit & Push] / [Commit only] button for granular control. Click one project at a time when you want to be selective.
- **"Sync All Selected" button** — batch action at the bottom for when everything looks good.
- **Branch indicator** per project:
  - `main ✓` — in sync with upstream
  - `main ↑2` — 2 commits ahead (will push fine)
  - `dev ↓3 ⚠` — 3 commits behind (push risky)
  - `main (no remote)` — local only, commit available, push disabled
- **Change categories** — dirty files grouped as "Metadata" vs "Documents" (see [Change Categories](#change-categories))
- **Warning badges** for risky branches (behind, diverged) with "Ask agent to help" link
- **Editable commit message** with auto-generated default including project names: `"chore: sync project metadata (ClawOS, Memestr)"`
- Commit message applies to all batch-synced projects. Per-project commits use the same message.

---

## Branch Awareness

The Sync Dialog shows branch context to help users make informed decisions, but does **not** manage branches.

### Branch Status Indicators

| Indicator | Meaning | Default Action |
|---|---|---|
| `main ✓` | In sync with upstream | Commit & Push |
| `main ↑2` | 2 commits ahead, clean fast-forward | Commit & Push |
| `dev ↓3 ⚠` | 3 commits behind remote | Commit only (push disabled by default) |
| `main ↑1 ↓2 ⚠` | Diverged (`aheadCount > 0 && behindCount > 0`) | Commit only + warning |
| `main (no remote)` | No upstream configured | Commit only |
| `feature-x` | On a non-default branch | Commit & Push (to feature-x) |

### What the dialog does NOT do

- Switch branches
- Create branches
- Merge or rebase
- Handle multiple remotes
- Determine which branch "should" have the changes

These are git workflow decisions that belong in [Layer 2 (AI-assisted)](#future-ai-assisted-git-management).

---

## Change Categories

Dirty files are grouped into two visual categories in the Sync Dialog:

### Metadata Changes (low risk)
- `PROJECT.md` — status, priority, tags, frontmatter fields
- `ROADMAP.md` — item ordering, status changes, priority
- `CHANGELOG.md` — completed item entries

These are small, mechanical changes made by the dashboard. Always safe to commit.

### Document Changes (review-worthy)
- `docs/specs/*.md` — spec documents (often agent-written)
- `docs/plans/*.md` — plan documents (often agent-written)
- `roadmap/*.md` — roadmap item detail files

These can be large and may be drafts. Still included in the dirty check and committed by default, but the visual distinction lets users quickly identify whether a sync is "just metadata" or includes substantive document changes they might want to review first.

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

Default: `"chore: sync project metadata (ClawOS, Memestr)"` — auto-includes the names of synced projects.

The user can edit this in the dialog. If syncing multiple projects, each project gets its own commit in its own repo with the same message.

### Per-project vs batch commit

Both are available:
- **Per-project**: Click the action button on a single row. That project is committed immediately with the current commit message. The row updates to show success.
- **Batch**: Click "Sync All Selected". All checked projects are committed sequentially, each in its own repo.

In both cases, each project gets exactly one commit in its own git repository.

### Execution

For each selected project:
1. `git add PROJECT.md ROADMAP.md CHANGELOG.md roadmap/ docs/specs/ docs/plans/` (only files that exist and have changes)
2. `git commit -m "<message>"`
3. If push enabled and remote exists: `git push origin <current-branch>`

All via Tauri `Command` — not through the chat/OpenClaw. This is a direct Tauri backend operation.

---

## Push Behavior

- **Push is optional** — defaults to on for clean branches, off for risky ones
- **Only pushes to current branch's upstream** — no force-push, no branch creation
- **Fast-forward only** — if the push would require a merge/rebase, show an error and offer "Ask agent to help"
- **Auth**: Uses whatever git credentials are configured locally (SSH keys, credential helper, etc.) — the app does not manage git auth

### Smart Push Defaults

| Branch State | Push Default | Rationale |
|---|---|---|
| In sync or ahead | ✅ Push enabled | Safe fast-forward |
| Behind remote | ❌ Push disabled | Would fail or require force |
| Diverged | ❌ Push disabled | Needs merge/rebase first |
| No remote | ❌ Push disabled | Nowhere to push |
| No upstream | ❌ Push disabled | Needs upstream set first |

Users can override any of these — the defaults just protect against accidental failures.

### Error Handling

| Scenario | Behavior |
|---|---|
| Commit succeeds, push fails | Show warning: "Committed locally but push failed: {error}. Changes are saved." + offer "Ask agent to help" |
| No remote configured | Commit locally only, push button disabled |
| Merge conflict on push | Show error + "Ask agent to help" link |
| Nothing to commit | Skip project silently, don't show error |
| Branch behind remote | Push disabled by default, warning shown |

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

## Cross-Platform Note

Git Sync ships before First Friend Readiness in the delivery sequence (Git Sync → Deep Rename → FFR). All git commands go through the existing `run_command_with_output` helper, which is currently macOS/Unix-only. FFR Phase 1 (Cross-Platform Foundation) makes this helper cross-platform (Windows `cmd`/`powershell` support). Git Sync inherits that automatically — no cross-platform work needed within this spec.

---

## What Phase 1 Does NOT Do

- ❌ **Auto-commit or auto-push** — ever
- ❌ **Commit user code** — only dashboard-managed metadata files
- ❌ **Create or switch branches** — commits to the current branch only
- ❌ **Merge or rebase** — that's Layer 2 (AI-assisted)
- ❌ **Resolve merge conflicts** — that's Layer 2 (AI-assisted)
- ❌ **Manage git credentials** — uses whatever's configured locally
- ❌ **Track per-field diffs** — the diff description is file-level for now ("PROJECT.md — modified"). Per-field diffs ("status: active → in-progress") are Phase 2 polish.

---

## Component Hierarchy

```
Header.tsx
  └── SyncButton (new) — badge + click handler
        └── SyncDialog (new) — project list, branch indicators, commit controls

Tauri Backend
  └── git_sync commands (new):
        ├── get_dirty_projects() → DirtyProject[]
        ├── get_branch_status(projectId) → BranchStatus
        ├── commit_project(projectId, message, files) → CommitResult
        └── push_project(projectId) → PushResult
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

`dirtyProjectCount` is updated during the existing `loadProjects()` scan — no separate polling needed. The Tauri backend already runs `get_git_status` per project (enriched with `aheadCount`, `behindCount`, etc. from Local Git Intelligence); it just needs to additionally check `git diff --name-only` against the dashboard file allowlist to populate the new `dashboardDirty` and `dirtyFiles` fields.

### No persistence needed

Dirty state is derived from the filesystem on every scan. Nothing to persist.

---

## Build Scope

### Phase 1 — Sync Dialog
- Extend Tauri `get_git_status`: add `dashboardDirty` and `dirtyFiles` fields (`aheadCount`/`behindCount` already exist from Local Git Intelligence)
- Add orange dot indicator to project cards
- Add Sync button with badge count to Header (hidden when 0)
- Sync Dialog: project list with branch indicators, change categories, per-project + batch commit, push toggle with smart defaults
- Auto-generated commit message including project names
- Error handling with clear feedback

### Phase 2 — AI-Assisted Git Management
- "Ask agent to help" actions that pre-fill chat with git context
- Agent can see branch status, suggest and execute: rebase, merge, cherry-pick, upstream setup
- Agent proactively flags sync issues during heartbeats ("3 projects have unpushed changes")
- Agent-initiated sync suggestions after completing work ("I updated the spec — want me to commit and push?")

### Phase 3 — Polish
- Per-field diff descriptions ("status: active → in-progress")
- Commit history view per project (last N syncs)
- Keyboard shortcut for Sync (`Cmd+Shift+S`)
- Roadmap item dirty indicators
- Pre-commit re-check for concurrent modifications
- Branch overview panel in sidebar (future sidebar content candidate)

---

## Future: AI-Assisted Git Management

The Sync Dialog solves the common case. But real git workflows are messy — diverged branches, stale feature branches, repos that haven't been pushed in weeks, upstream conflicts. Building UI for all of this is a git client. We don't want to build a git client.

Instead, the AI agent handles complex git operations through the existing chat interface. The dashboard provides the context (which repos are dirty, which branches are behind, what diverged) and the agent provides the intelligence.

### How it connects

1. **Sync Dialog → Chat handoff**: When the Sync Dialog encounters a situation it can't handle (branch behind, diverged, no upstream), it shows an "Ask agent to help" link. Clicking it opens the chat drawer with a pre-filled message like: *"ClawOS is on branch `dev`, which is 3 commits behind `origin/dev`. The following dashboard files have uncommitted changes: PROJECT.md, ROADMAP.md. Can you help me sync these?"*

2. **Agent proactive checks**: During heartbeats, the agent can scan project git status and proactively alert: *"Heads up — 3 projects have unpushed dashboard changes. Want me to open Sync, or should I handle it?"*

3. **Post-work sync offers**: After the agent completes work that modifies project files (writing specs, updating roadmap items), it can offer: *"I updated the ClawOS spec. Want me to commit and push that?"*

4. **Git context in project data**: The agent already receives project context when chatting. Extending that context with branch status and dirty state means the agent can give informed git advice without the user having to explain the situation.

### Why this works

- The AI already knows how to run git commands (commit, push, rebase, merge, cherry-pick)
- The AI already has project context from the dashboard
- Natural language is actually better than UI for complex git decisions ("rebase this onto main but skip the migration commit")
- The user stays in control — the agent proposes, the user approves
- No complex branch management UI to build or maintain
