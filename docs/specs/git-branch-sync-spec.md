# Git Sync: Branch Management — Spec

> Multi-branch sync with AI-assisted conflict resolution, enabling users to commit and push changes across multiple branches from the Sync dialog.

**Status:** pending
**Depends on:** git-sync-scope (phase 2) completion
**Roadmap ID:** git-branch-sync

---

## Context

Git Sync phases 1-2 commit to whichever branch is currently checked out. But many users maintain changes across multiple branches — for example, keeping `ROADMAP.md` in sync between `main` and `staging` even when code differs between them.

Additionally, repos can fall behind their remote when changes are pushed from elsewhere (cloud Codex, collaborators, merged PRs on GitHub). The app detects this (rose icon = behind remote) but doesn't help you act on it.

This feature brings multi-branch commit, pull, and AI-assisted conflict resolution into the Sync dialog.

## Problem

- Users who maintain multiple branches have no way to sync files across them from the dashboard
- Cherry-picking structured files across diverged branches can cause conflicts that need expertise to resolve
- When a repo is behind remote (cloud Codex merged a PR), there's no way to pull from the dashboard
- No standardized guidance exists for AI agents on how to safely handle branch sync operations

## Proposed Solution

### Phase 3A: Branch Selection UI

1. **Branch list in Sync dialog:** Below the current branch indicator, show "Also sync to:" with checkboxes for other local branches
2. **Branch status indicators:** Each branch shows its relationship to remote: `✓ in sync`, `↑2 ahead`, `↓3 behind`, `⚠ diverged`
3. **Independent push toggles per branch**
4. **Pull option:** When current branch is behind remote, offer "Pull first?" before sync
5. **No-remote branch behavior:** show `(local)` and allow commit/cherry-pick flow, but hide/disable push+pull actions

### Phase 3B: Multi-Branch Execution

**For non-conflicting cases (cherry-pick):**

The sequence when syncing to additional branches:
1. Commit selected files on current branch
2. For each selected target branch:
   - Stash any unrelated work-in-progress
   - Switch to the target branch
   - Cherry-pick the commit (applies just that one commit's changes)
   - Switch back to the original branch
   - Restore stashed work
3. Push to selected branches if push enabled

**Local-only branches (no upstream):**
- Allow commit + cross-branch cherry-pick operations locally
- Do not offer pull/push controls
- Keep branch sync useful even without GitHub linkage

**What these git operations mean in plain English:**
- **Stash** = "save my uncommitted work in a drawer so I can switch branches cleanly"
- **Cherry-pick** = "take that specific commit and replay it on this branch" (unlike merge, which brings ALL commits)
- This is the right approach because you want the same file change on multiple branches, not a full branch merge

### Phase 3C: AI-Assisted Conflict Resolution

When a cherry-pick conflicts (the same file was changed differently on both branches):

1. **Detect conflict type:**
   - Structured file (ROADMAP.md, PROJECT.md) → semantic resolution possible (merge item lists, deduplicate)
   - Code file → needs careful review, present both versions
2. **Send to OpenClaw agent** with conflict context + git management skill loaded
3. **Agent resolves and reports** — e.g., "Merged ROADMAP.md: kept items from both branches, resolved ordering"
4. **User reviews and approves or overrides** in the Sync dialog

### Git Management Skill / Agent Guidance

**Research findings:** No existing ClawHub skill covers holistic branch management. GitHub Docs cover conflict resolution mechanics but not strategy. Atlassian's Git Tutorials are the best holistic reference (Gitflow, trunk-based, cherry-pick patterns). No single authoritative "how to think about branch management" guide exists.

**What we need to build:**

A git management skill/guide synthesized from:
- [Atlassian: Comparing Git Workflows](https://www.atlassian.com/git/tutorials/comparing-workflows)
- [Atlassian: Git Cherry Pick](https://www.atlassian.com/git/tutorials/cherry-pick)
- [GitHub Docs: Resolving merge conflicts via CLI](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/addressing-merge-conflicts/resolving-a-merge-conflict-using-the-command-line)
- [Git SCM: git-cherry-pick](https://git-scm.com/docs/git-cherry-pick)
- [Git SCM: git-rerere](https://git-scm.com/docs/git-rerere) (reuse recorded resolution)
- Practical patterns specific to Clawchestra's structured file formats

**The skill should cover:**
- When to cherry-pick vs merge vs rebase
- How to resolve conflicts in structured markdown files (ROADMAP.md, PROJECT.md) — these have YAML frontmatter and can be merged semantically
- How to resolve code file conflicts — prefer source branch, flag ambiguous cases
- Non-destructive principles: never delete content without explicit user confirmation
- Remote sync order: check ahead/behind before pushing, suggest pull if behind
- `git rerere` configuration for recurring conflict patterns
- All feasible git commands and their purposes (must stay current with git/GitHub CLI updates)

**Delivery options:**
1. **Standalone skill** — loaded when branch sync is triggered
2. **AGENTS.md section** — always-available guidance for any git operations
3. **Both** — skill for detailed reference, AGENTS.md summary for quick access
4. If Git Sync becomes a core Clawchestra feature, the guidance should ship with the app context

**Pre-build research phase:** Before writing the skill, do a deeper review of:
- ClawHub directory for any git-related skills published since last check
- GitHub's `gh` CLI capabilities for branch operations
- Whether `git rerere` is practical for automated resolution
- Atlassian's full workflow comparison guide for distillable decision trees

## Scenarios

### Scenario 1: Keep ROADMAP.md in sync across main + staging
- User updates ROADMAP.md via dashboard → Sync dialog shows "Also sync to: staging"
- Commits to main, cherry-picks to staging → clean (identical ROADMAP.md on both)
- Pushes both

### Scenario 2: Branches have diverged
- Main: ROADMAP items A, B, C. Staging: items A, B, D (D added on staging only)
- User adds item E on main → cherry-pick to staging conflicts
- AI resolves: produce A, B, C, D, E — preserves both branches' additions
- User reviews and approves

### Scenario 3: Remote is ahead (cloud Codex merged a PR)
- Rose icon on project card: "3 commits behind remote"
- Sync dialog warns: "main is behind remote — pull first?"
- Pull succeeds → proceed with sync
- Pull conflicts → AI resolution

### Scenario 4: Code change across branches
- User changes `src/theme.css` via AI chat on main
- Wants same change on staging (staging has different code but same CSS structure)
- Cherry-pick may conflict if staging modified the same CSS
- AI agent reviews both versions, merges non-destructively

## Out of Scope

- Creating new branches from the Sync dialog
- Rebasing workflows
- PR creation from the Sync dialog
- Remote branch management (delete, protect)
- Full git GUI (this is targeted sync, not a replacement for VS Code's git panel)
- Changing the Phase 2 auto-commit boundary policy (local-only Kanban structure changes only)

## Dependencies

- git-sync (phase 1) ✅ — base commit/push infrastructure
- git-sync-scope (phase 2) — all-file detection and categorization
- OpenClaw agent integration — already built into Clawchestra chat

## Success Criteria

- [ ] Branch selector in Sync dialog showing local branches with status
- [ ] Cherry-pick executes cleanly for non-conflicting cases
- [ ] AI agent resolves conflicts with user-reviewable output
- [ ] Git management skill/guide exists and is loaded during branch sync
- [ ] Behind-remote detection warns and offers pull before sync
- [ ] Pre-build research phase completed (ClawHub, gh CLI, rerere, Atlassian guides)
