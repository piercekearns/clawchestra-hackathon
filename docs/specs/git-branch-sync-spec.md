# Git Sync: Branch Management — Spec

> Multi-branch sync with AI-assisted conflict resolution, enabling users to commit and push changes across multiple branches from the Sync dialog.

**Status:** pending
**Depends on:** git-sync-scope completion
**Roadmap ID:** git-branch-sync

---

## Context

Git Sync (phase 1) commits to whichever branch is currently checked out. Git Sync Scope Expansion (phase 2) lets you commit any file. But many users maintain changes across multiple branches — for example, keeping `ROADMAP.md` in sync between `main` and `staging` even when code differs between them.

Currently, syncing across branches requires manual git operations (cherry-pick, checkout, merge) or asking an AI coding agent to do it. This feature brings that capability into the Clawchestra Sync dialog with AI-assisted conflict resolution.

## Problem

- Users who maintain multiple branches (e.g., main + staging) have no way to sync files across them from the dashboard
- Cherry-picking structured files (ROADMAP.md, PROJECT.md) across branches that have diverged can cause conflicts
- Manual branch management requires git expertise or AI assistance outside the app
- No guidance exists for AI agents on how to safely resolve branch sync conflicts for project metadata files

## Proposed Solution

### Phase 3A: Branch Selection UI

1. **Branch awareness in Sync dialog:** Show current branch (already done), add a "Also sync to:" section with other local branches listed
2. **Branch checkboxes:** Toggle which additional branches receive the commit
3. **Branch status indicators:** Show if target branches are ahead/behind/diverged relative to current
4. **Push per branch:** Independent push toggles per branch

### Phase 3B: Cherry-Pick Execution

When syncing to additional branches, the sequence is:

```
1. Commit selected files on current branch
2. For each selected target branch:
   a. git stash (save any unrelated WIP)
   b. git checkout <target-branch>
   c. git cherry-pick <commit-hash>
   d. If conflict → invoke AI resolution
   e. git checkout <original-branch>
   f. git stash pop (restore WIP)
3. Push to selected branches (if push enabled)
```

**Terminology for non-git-experts:**
- **Stash** = temporarily save uncommitted work so you can switch branches cleanly
- **Checkout** = switch to a different branch
- **Cherry-pick** = take a specific commit and replay it on the current branch
- **Conflict** = two branches changed the same lines differently; needs human or AI decision

### Phase 3C: AI-Assisted Conflict Resolution

When a cherry-pick conflicts:

1. **Detect conflict type:**
   - Structured file (ROADMAP.md, PROJECT.md) → semantic resolution possible
   - Code file → needs careful review
2. **Send to OpenClaw agent** with context:
   - The conflicting file content (both versions + conflict markers)
   - Which branches are involved
   - What the user intended to sync
   - Git branch sync skill/guide for resolution patterns
3. **Agent resolves and reports:**
   - "Merged ROADMAP.md — kept both branches' items, resolved ordering conflict"
   - Or: "Conflict in src/App.tsx — both branches modified the same function. Here's the diff. Which version do you want?"
4. **User approves or overrides** in the Sync dialog

### Git Branch Management Skill

Create a skill (or AGENTS.md guidance) that provides AI agents with:

- **When to cherry-pick vs merge:** Cherry-pick for specific files, merge for full branch sync
- **Structured file resolution:** ROADMAP.md and PROJECT.md are YAML frontmatter + markdown — conflicts can be resolved semantically (merge item lists, keep both, deduplicate)
- **Code file resolution:** Prefer the version from the "source" branch (the one the user explicitly changed), flag for review if both branches have unique changes
- **Non-destructive principles:** Never delete content without explicit user confirmation, always preserve both sides' additions, use `git rerere` for recurring conflict patterns
- **Remote sync order:** Check ahead/behind before pushing, suggest `git pull --ff-only` if behind, warn if force-push would be needed

**Source material for the skill:**
- [GitHub Docs: Resolving merge conflicts via CLI](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/resolving-a-merge-conflict-using-the-command-line)
- [Git SCM: git-cherry-pick](https://git-scm.com/docs/git-cherry-pick)
- [Git SCM: git-rerere](https://git-scm.com/docs/git-rerere)
- Practical patterns from Clawchestra's structured file formats

**Delivery:** Could be a standalone skill file, AGENTS.md section, or both. If Git Sync becomes a core Clawchestra feature, the guidance should ship with the app (injected into agent context when branch sync is triggered).

## Scenarios

### Scenario 1: Keep ROADMAP.md in sync across main + staging
- User edits ROADMAP.md via dashboard (adds a new deliverable)
- Opens Sync dialog → selects "Also sync to: staging"
- Commits to main, cherry-picks to staging
- No conflict (staging's ROADMAP.md is identical to main's) → clean sync
- Pushes both branches

### Scenario 2: Branches have diverged
- Main has ROADMAP.md with items A, B, C
- Staging has ROADMAP.md with items A, B, D (D was added on staging only)
- User adds item E via dashboard on main
- Cherry-pick to staging conflicts (different content after item B)
- AI resolves: merge to produce A, B, C, D, E — preserves both branches' additions
- User reviews and approves

### Scenario 3: Cloud Codex merged a PR, local is behind
- GitHub remote has new commits from a cloud Codex run
- User's local repo is behind (rose icon)
- Before syncing, Clawchestra warns: "main is 3 commits behind remote"
- Offers: "Pull first?" → runs `git pull --ff-only`
- If pull succeeds → proceed with sync
- If pull conflicts → invoke AI resolution

## Out of Scope

- Creating new branches from the Sync dialog
- Rebasing workflows (cherry-pick is safer for this use case)
- PR creation from the Sync dialog (future enhancement)
- Remote branch management (delete, protect, etc.)

## Dependencies

- git-sync (phase 1) — base commit/push infrastructure ✅
- git-sync-scope (phase 2) — all-file detection and categorization
- OpenClaw agent integration — already built into Clawchestra chat

## Success Criteria

- [ ] Branch selector appears in Sync dialog showing local branches
- [ ] Users can select additional branches to sync to
- [ ] Cherry-pick executes cleanly for non-conflicting cases
- [ ] AI agent resolves conflicts with user-reviewable output
- [ ] Git branch management skill/guide exists and is loaded during branch sync operations
- [ ] Behind-remote detection warns user before sync and offers pull
