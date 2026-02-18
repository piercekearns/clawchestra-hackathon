---
title: Git Sync
id: git-sync
status: pending
tags: [git, github, sync, workflow]
icon: "🔄"
nextAction: "Spec written — ready for plan/build"
lastActivity: "2026-02-18"
specDoc: docs/specs/git-sync-spec.md
---

# Git Sync

Surface uncommitted dashboard changes and let users commit + push project metadata to GitHub on demand.

## Problem

When you drag kanban cards or update roadmap items, Clawchestra writes to PROJECT.md / ROADMAP.md locally. But those changes aren't committed or pushed. There's no visibility into what's drifted and no way to sync without opening a terminal.

## Solution

- **Dirty indicators** on project cards when dashboard-managed files have uncommitted changes
- **Sync button** in the header with a badge count
- **Sync Dialog** to review, commit, and optionally push changes across all dirty projects
- Only commits dashboard-managed files (PROJECT.md, ROADMAP.md, CHANGELOG.md, roadmap/, docs/) — never user code
- Never auto-pushes — user explicitly triggers sync

## Key Design Decisions

- Commit is explicit, not automatic
- Push is optional (toggle in dialog, on by default for repos with remotes)
- Fast-forward only — no force push, no branch creation
- Leverages existing git status scanning in Tauri backend
- One commit per repo per sync action (not per-file)

## Dependencies

- Existing `GitStatus` scanning in Tauri backend (already has `clean | uncommitted | unpushed | behind | unknown`)
- Tauri `Command` for git operations (new commands needed)
