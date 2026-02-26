# Project Diff Viewer

> Per-project visibility into uncommitted changes — a toggle diff panel showing staged vs unstaged files, branch-level diffs, and which embedded sessions have produced uncommitted work.

**Status:** Draft
**Created:** 2026-02-26
**Last Updated:** 2026-02-26
**Roadmap Item:** `project-diff-viewer`
**Depends On:** `project-conversation-hub` (sidebar container model), `embedded-agent-terminals` (session-to-change attribution)

---

## Problem

When multiple coding agents (Claude Code, Codex, etc.) are running across different roadmap items within a project — each in their own embedded terminal session — the user loses track of what's changed. Specifically:

1. **No change visibility** — there's no way to see uncommitted changes per project without switching to a terminal and running `git status`/`git diff` manually.
2. **No attribution** — when changes exist, there's no indication of *which session* produced them. Did Claude Code modify that file, or did the user edit it manually?
3. **No staging awareness** — staged vs unstaged vs untracked files aren't surfaced. The user can't make informed commit decisions from within Clawchestra.
4. **No branch context** — when working on a feature branch, there's no view of all changes since branching (committed + uncommitted) to understand the full scope of work.

## What Success Looks Like

- The user can toggle open a diff panel from any project context (project card, thread sidebar, or a specific session) and immediately see what files have changed.
- Staged, unstaged, and untracked files are clearly distinguished.
- File-level diffs are viewable inline (expand a file to see the diff).
- When embedded terminals exist for a project, the panel indicates which session likely produced each change (based on file modification timestamps vs session activity windows — heuristic, not perfect).
- The user can stage/unstage files directly from the panel.
- Branch-level view: "all changes since branching from main" including committed changes on the branch.

## UI Concept

### Toggle Diff Panel

The diff panel lives in the conversation hub sidebar, accessible from:
- A project thread's header (icon button showing change count)
- Individual chat/terminal session context menus
- Keyboard shortcut (TBD)

```
┌─ Diff: Clawchestra ──────────────────────┐
│ Branch: feat/conversation-hub (↑3 ahead)  │
│                                           │
│ Uncommitted Changes (7 files)             │
│ ┌─ Staged (2) ──────────────────────────┐ │
│ │ ✓ src/lib/gateway.ts         +12 -3   │ │
│ │ ✓ src/lib/store.ts           +4  -1   │ │
│ └────────────────────────────────────────┘ │
│ ┌─ Unstaged (4) ────────────────────────┐ │
│ │ ○ src/App.tsx                +45 -12  │ │
│ │   └─ 🤖 Claude Code — git-sync       │ │
│ │ ○ src/components/Sidebar.tsx +8  -2   │ │
│ │ ○ src-tauri/src/lib.rs       +22 -0   │ │
│ │   └─ 🤖 Claude Code — git-sync       │ │
│ │ ○ package.json               +1  -1   │ │
│ └────────────────────────────────────────┘ │
│ ┌─ Untracked (1) ───────────────────────┐ │
│ │ ? docs/specs/new-feature-spec.md      │ │
│ └────────────────────────────────────────┘ │
│                                           │
│ Branch Changes (3 commits + uncommitted)  │
│ ▸ Show committed changes on branch...     │
└───────────────────────────────────────────┘
```

### Inline Diff View

Clicking a file expands it to show the diff inline, using a syntax-highlighted unified diff view. The user can toggle between unified and side-by-side views.

### Session Attribution

Attribution is heuristic: if a file was modified during a terminal session's active window (session start → last activity), that session is shown as the likely author. Multiple sessions can claim the same file. Manual edits (outside any session) show no attribution.

This is best-effort and clearly labeled as such — not a blame/audit trail.

## Data Sources

All data comes from `git` commands run against the project's repository path (already known from the project's scan-path configuration):

| Data | Git Command |
|------|-------------|
| Staged files | `git diff --cached --stat` / `git diff --cached` |
| Unstaged files | `git diff --stat` / `git diff` |
| Untracked files | `git ls-files --others --exclude-standard` |
| Branch comparison | `git log main..HEAD --oneline` / `git diff main...HEAD` |
| File-level diff | `git diff [--cached] -- <path>` |

These are read-only operations. Staging/unstaging uses `git add`/`git restore --staged`.

## Refresh Strategy

- **On panel open** — full refresh
- **On file system events** — debounced (500ms) refresh via Tauri's file watcher, scoped to the project's repo path
- **After session activity** — when an embedded terminal session produces output (heuristic: PTY activity → likely file changes), trigger a refresh after a short delay
- **Manual refresh** — button in the panel header

## Interaction with Existing Git Sync

The existing Git Sync feature (commit + push dialog) is the *action* surface. The diff viewer is the *visibility* surface. They complement each other:

- Diff viewer shows what's changed → user decides to commit → opens Git Sync dialog
- Git Sync dialog could embed a simplified version of the diff viewer for commit-time review
- No duplication: the diff viewer doesn't have commit/push actions, Git Sync doesn't have persistent change monitoring

## Decisions

### 1. Sidebar panel, not separate window
The diff panel lives in the conversation hub sidebar, not a separate window or tab. It's contextual to the project thread.

### 2. Heuristic attribution, not tracking
Session-to-change attribution is heuristic (timestamp-based), not a tracked audit trail. This avoids complexity and is honest about its limitations.

### 3. Read-only by default, stage/unstage as stretch
Phase 1 is read-only (view diffs). Stage/unstage actions are Phase 2 — they require careful UX to avoid accidental staging of files the user didn't intend to include.

## Phased Delivery

### Phase 1: Basic Diff Panel
- Rust command to get git status (staged/unstaged/untracked) for a project path
- Basic panel UI in conversation hub sidebar
- File list with change stats (+/- lines)
- Click to expand inline diff view
- Manual refresh

### Phase 2: Live Updates + Actions
- File watcher integration for auto-refresh
- Stage/unstage individual files from the panel
- Branch comparison view (committed changes on branch)
- Session attribution (heuristic)

### Phase 3: Deep Integration
- Git Sync dialog embeds diff viewer for commit-time review
- Diff viewer links to specific terminal sessions ("jump to session that made this change")
- Conflict detection and visual indicators when multiple sessions modify the same file

## Non-Goals

- Replacing the Git Sync dialog (that stays for commit/push workflow)
- Full git blame or history exploration (this is about current uncommitted state)
- Merge conflict resolution UI (separate concern, possibly future roadmap item)
- Cross-project diff aggregation (each project's panel is independent)

## Open Questions

1. **Syntax highlighting engine** — What to use for rendering diffs with syntax highlighting in the Tauri webview? Options: Monaco editor (heavy), Shiki (light), custom with Prism.
2. **Worktree awareness** — If/when worktrees are introduced, the diff viewer needs to understand which worktree it's looking at. Not a Phase 1 concern but architecture should not prevent it.
