# Local Git Intelligence

> Replace GitHub REST API calls with local git commands — zero rate limits, richer data, works offline.

Eliminates the 403 rate-limit errors by removing all GitHub API calls from the project load path. Instead, uses native git commands via the Tauri Rust backend to provide the same data (and more) with no network dependency for routine operations.

**Status:** Specced  
**Roadmap ID:** `github-api-403-errors`  
**Related:** `git-sync` (will consume the enriched git data)

---

## Problem

The app calls GitHub's REST API (unauthenticated, 60 req/hr limit) for commit activity data on every `loadProjects()` call. With N GitHub-linked repos, each refresh makes 2N API calls (weekly commits + latest commit). `loadProjects()` fires on:

- App startup
- Every file watcher event (or every 15s via polling fallback)
- Manual refresh clicks
- Drag-and-drop card operations
- Chat command completions

With 4+ repos, the 60/hr limit is hit within minutes, causing persistent 403 errors.

## Solution: Local Git Commands

All data currently fetched from GitHub's API is available locally via git commands. The app's Rust backend already runs git commands (`git status`, `git rev-parse`, `git rev-list`). We extend it to provide richer data.

### What Changes

| Data Point | Current Source | New Source |
|---|---|---|
| Last commit date | GitHub REST API | `git log -1 --format=%aI` |
| Commits this week | GitHub REST API | `git rev-list --count --since="7 days ago" HEAD` |
| Ahead/behind remote | Already local (`git rev-list`) | No change |
| Dirty/clean status | Already local (`git status`) | No change |
| **New: Last commit message** | N/A | `git log -1 --format=%s` |
| **New: Last commit author** | N/A | `git log -1 --format=%an` |
| **New: Active branches** | N/A | `git branch -a --sort=-committerdate --format='%(refname:short) %(committerdate:iso)'` |
| **New: Latest tag** | N/A | `git describe --tags --abbrev=0 2>/dev/null` |
| **New: Stash count** | N/A | `git stash list \| wc -l` |

### Performance Characteristics

All local git commands are sub-millisecond filesystem reads. No network, no rate limits, no authentication needed. Scales to any number of repos.

The only command that touches the network is `git fetch`, which uses git's own protocol (SSH/HTTPS) — **not** the GitHub REST API, so it does not count against the 60/hr or 5,000/hr API limits.

## Architecture

### Data Flow

```
loadProjects()
  → For each project with hasGit:
    → Tauri invoke: get_enriched_git_status(dirPath)
      → Rust runs local git commands
      → Returns EnrichedGitStatus struct
    → Frontend populates ProjectViewModel.gitStatus (enriched)
    → No GitHub API call
```

### Storage

**In-memory only.** The enriched git data lives on the `ProjectViewModel` object, same as the current `gitStatus` and `commitActivity` fields. Recalculated on every refresh. No database, no files, no accumulation, no storage growth.

### When Commands Run

| Trigger | Local git queries | `git fetch` |
|---|---|---|
| App startup | ✅ | ✅ |
| File watcher event | ✅ | ❌ (local changes don't need remote check) |
| Manual refresh button | ✅ | ✅ |
| Card drag / project update | ✅ | ❌ |
| Git Sync dialog opens | ✅ | ✅ (ensure fresh remote state) |
| Background interval (5 min) | ❌ | ✅ (configurable, keeps remote refs fresh) |

Rationale: `git fetch` is the only command that hits the network (~1-2s per repo). It should run intentionally (user action or timed interval), never on every file change.

### `git fetch` Strategy

- **Non-blocking**: Runs in background, UI doesn't wait for it
- **Per-repo**: Each repo fetches independently (one slow repo doesn't block others)
- **Failure-tolerant**: Network errors are logged but don't affect local data display
- **Configurable interval**: Default 5 minutes, adjustable in settings. Set to 0 to disable background fetch.

## Schema Changes

### Rust: `EnrichedGitStatus`

```rust
struct EnrichedGitStatus {
    // Existing fields
    state: String,           // clean | uncommitted | unpushed | behind | unknown
    branch: Option<String>,
    details: Option<String>,
    remote: Option<String>,
    
    // New fields
    last_commit_date: Option<String>,    // ISO 8601
    last_commit_message: Option<String>, // Subject line only
    last_commit_author: Option<String>,
    commits_this_week: u32,
    latest_tag: Option<String>,
    stash_count: u32,
    ahead_count: u32,                    // Explicit (currently derived from state)
    behind_count: u32,                   // Explicit
    branches: Vec<BranchInfo>,           // Active branches with dates
}

struct BranchInfo {
    name: String,
    is_remote: bool,
    last_commit_date: Option<String>,
}
```

### TypeScript: Extended `GitStatus`

```typescript
interface GitStatus {
  // Existing
  state: GitStatusState;
  branch?: string;
  details?: string;
  remote?: string;
  
  // New
  lastCommitDate?: string;
  lastCommitMessage?: string;
  lastCommitAuthor?: string;
  commitsThisWeek?: number;
  latestTag?: string;
  stashCount?: number;
  aheadCount?: number;
  behindCount?: number;
  branches?: BranchInfo[];
}
```

### Frontend Impact

- `commitActivity` field on `ProjectViewModel` becomes redundant (data now in `gitStatus`)
- "X/wk" badge reads from `gitStatus.commitsThisWeek`
- Staleness uses `gitStatus.lastCommitDate` instead of GitHub API fallback
- Project cards can show last commit message for context
- Git Sync feature consumes `aheadCount`, `behindCount`, `branches`, `stashCount`

## Migration

1. **Add Rust command**: `get_enriched_git_status` returning the full struct
2. **Add Rust command**: `git_fetch_repo` for on-demand fetch
3. **Update `projects.ts`**: Call enriched status instead of `fetchCommitActivity`
4. **Remove GitHub API from load path**: Delete `fetchCommitActivity` call in `loadAllProjects`
5. **Keep `github.ts` module**: Will be used for future authenticated API features (PRs, CI)
6. **Update frontend**: Read from enriched `gitStatus` instead of `commitActivity`

## Future: GitHub REST API (Authenticated)

For data that only exists on GitHub (not in git):
- Pull request status and counts
- CI/CD run results
- Issue counts
- Contributor activity on uncloned branches

This requires a GitHub Personal Access Token (PAT) stored in app settings. Provides 5,000 req/hr — effectively unlimited for a dashboard. Could also support GitHub OAuth login flow for seamless setup. Deferred to a future roadmap item.

## Out of Scope

- GitHub OAuth login flow (future)
- PR/CI status display (future, needs authenticated API)
- Git operations (commit, push, pull) — covered by `git-sync` roadmap item
- Multi-remote support (only `origin` for now)
