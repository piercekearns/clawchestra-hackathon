# Non-Code Projects

> Support projects without a git repository — personal, writing, and business planning projects where all kanban and chat features work but git-dependent features are disabled.

## Summary

Clawchestra is a universal project tracker, not just a code project tracker. Users should be able to add any folder as a project — even one without a git repo. This enables tracking personal projects, writing projects, business planning, and other non-code work alongside code projects.

## Detection

### `probe_repo()` on folder selection

When the user selects a folder in the Add Project dialog:
1. Run `git rev-parse --is-inside-work-tree` in the selected directory
2. If the command fails or returns false: set `is_git_repo: false`
3. If the command succeeds: set `is_git_repo: true` (existing behavior)

### Schema addition

Add `is_git_repo: bool` to `DbProjectData`:
- Local-only field (not synced via db.json — git status is device-specific)
- Set during project creation/discovery
- Re-probed if project path changes

## Disabled Features for Non-Git Projects

### GitSync
- SyncDialog disabled
- Sync button shows tooltip: "No git repository"
- No sync badge on project card

### Auto-commit
- All `autoCommitIfLocalOnly` calls skip if `!isGitRepo`
- No auto-commit triggers fire

### Branch injection
- `inject_agent_guidance` command skips if no git
- No CLAUDE.md injection (no branches to inject into)
- Agents can still read `.clawchestra/state.json` directly

### Git status badge
- No git status badge on project card
- No ahead/behind indicators
- No dirty file count

## Unchanged Features

### state.json watcher
Works on any folder — watches `.clawchestra/state.json` regardless of git status.

### Kanban board + roadmap items
Full functionality. Items can be created, moved, edited, completed.

### Spec/plan docs
Reference files in the folder by relative path. Files are read directly from disk (no git show needed since there are no branches).

### OpenClaw chat
Scoped chat sessions work normally. OpenClaw can read/write state.json.

### db.json sync
No `projectPath` git operations during sync. Sync operates on db.json only.

## Migration State Machine

For non-git projects, the migration path is simplified:
- `NotStarted` → `Projected` directly
- Skip `GitignoreUpdated` step (no .gitignore to update)
- Skip `SourceDeleted` step (no git-tracked ROADMAP.md to delete)
- `.clawchestra/` directory is created, state.json is written
- `.gitignore` update is skipped

## Add Project Dialog UI

After folder selection, run `probe_repo`:

### If `is_git_repo: false`:
- Hide git-specific sections (branch injection, GitSync config)
- Show info message: "This project has no git repository. GitSync and auto-commit will be unavailable."
- All other fields work normally (title, status, tags, description)
- "Create Project" button still works

### If `is_git_repo: true`:
- Existing behavior (show all git options)

## state.json for Non-Git Projects

- `.clawchestra/` directory is created in the project folder
- `state.json` is written with project metadata and roadmap items
- `.gitignore` update is skipped (no git to ignore from)
- Agents working in the folder can still find and use state.json

## Tests

### Add non-git folder
1. Create a folder without `git init`
2. Add it as a project via Add Project dialog
3. Verify kanban board renders with no errors
4. Verify no git-related errors in console
5. Verify GitSync button is disabled with tooltip

### Drag item
1. Drag a roadmap item to a new column
2. Verify state.json is updated
3. Verify no auto-commit is attempted
4. Verify no git operations are called

### Project card
1. Verify no git status badge appears
2. Verify no sync badge appears
3. Verify project card renders cleanly without git indicators
