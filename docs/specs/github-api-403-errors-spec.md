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
    → Tauri invoke: get_git_status(dirPath)       [existing command, enriched]
      → Rust runs local git commands
      → Returns GitStatus struct (with new fields)
    → Frontend derives commitActivity from gitStatus
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

- **Synchronous Tauri command**: Same pattern as all other git commands in `lib.rs` (no `spawn_blocking`, no `async`)
- **Per-repo**: Each repo fetches independently via `Promise.allSettled` on the JS side
- **Failure-tolerant**: Network errors are logged but don't affect local data display
- **No `--prune`**: This is a status dashboard, not a branch manager. Pruning is opinionated — defer to Git Sync if needed.
- **No background interval initially**: Startup + manual refresh is sufficient. Background polling can be added later if needed.

## Schema Changes

### Rust: Extended `GitStatus` (same struct, no separate type)

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]  // Required for multi-word fields → JS
struct GitStatus {
    // Existing fields (unchanged)
    state: String,           // clean | uncommitted | unpushed | behind | unknown
    branch: Option<String>,
    details: Option<String>,
    remote: Option<String>,
    
    // New fields
    last_commit_date: Option<String>,    // ISO 8601 via git log -1 --format=%aI
    last_commit_message: Option<String>, // Subject line via git log -1 --format=%s
    last_commit_author: Option<String>,  // Author name via git log -1 --format=%an
    commits_this_week: Option<u32>,      // git rev-list --count --since="7 days ago" HEAD
    latest_tag: Option<String>,          // git describe --tags --abbrev=0
    stash_count: u32,                    // 0 when empty (not Option)
    ahead_count: Option<u32>,            // Explicit (currently derived from state)
    behind_count: Option<u32>,           // Explicit (currently derived from state)
}
```

**Note:** `serde(rename_all = "camelCase")` is a no-op for existing single-word fields but required for new multi-word fields to serialize correctly to JavaScript.

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

1. **Extend existing `get_git_status`**: Add new fields to the same Rust struct and command
2. **Add `git_fetch` command**: Separate Tauri command for network fetch (synchronous, same pattern as other git commands)
3. **Update TS types**: Extend `GitStatus` interface, add `gitFetch` invoke binding
4. **Replace GitHub API in load path**: Derive `commitActivity` from `gitStatus`, remove `fetchCommitActivity` loop
5. **Add `git fetch` to startup + refresh**: Fire-and-forget fetch, then reload projects
6. **Delete `github.ts`**: Entire module is dead code after migration (`extractGitHubSlug` is in `projects.ts`)
7. **Update tests**: Verify derivation logic, edge cases, no regressions

See `docs/plans/github-api-403-errors-plan.md` for detailed step-by-step implementation.

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
