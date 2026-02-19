# Local Git Intelligence — Implementation Plan

> Spec: `docs/specs/github-api-403-errors-spec.md`

## Build Order

Steps are sequential unless noted. Each step ends in a commit with passing tests and clean TypeScript.

---

### Step 1: Extend Rust `GitStatus` struct and `get_git_status` command

**Files:** `src-tauri/src/lib.rs`

**What:**
- Add new fields to the existing `GitStatus` struct (don't create a separate struct — keep the single `get_git_status` command):
  ```rust
  // Add to existing GitStatus struct:
  last_commit_date: Option<String>,    // git log -1 --format=%aI
  last_commit_message: Option<String>, // git log -1 --format=%s
  last_commit_author: Option<String>,  // git log -1 --format=%an
  commits_this_week: Option<u32>,      // git rev-list --count --since="7 days ago" HEAD
  latest_tag: Option<String>,          // git describe --tags --abbrev=0
  stash_count: Option<u32>,            // git stash list | wc -l
  ahead_count: Option<u32>,            // already computed, just expose explicitly
  behind_count: Option<u32>,           // already computed, just expose explicitly
  ```
- Populate the new fields inside the existing `get_git_status` function by calling `run_git` with the appropriate arguments
- Use `Option<T>` for all new fields — any individual git command failure should not fail the whole status check
- The `ahead_count` and `behind_count` are already being computed (lines ~1155–1173) to determine the `state` string — just capture the values explicitly

**Why extend rather than create new command:**
- `get_git_status` is already called per-project in `loadAllProjects`
- One invoke per project is better than two
- All git queries are sub-millisecond, so bundling them doesn't create a performance concern

**Edge cases:**
- Repos with no commits: `git log` will fail → `None`
- Repos with no tags: `git describe --tags` will fail → `None`
- Repos with no upstream: `ahead_count`/`behind_count` remain `None`
- Repos with no stash: count is 0, not `None`
- `commits_this_week` uses `--since="7 days ago"` which is relative to current time

**Risk:** Low. Additive change to existing function, all new fields are `Option`.

---

### Step 2: Add `git_fetch` Tauri command

**Files:** `src-tauri/src/lib.rs`

**What:**
- Add a new Tauri command `git_fetch`:
  ```rust
  #[tauri::command]
  async fn git_fetch(repo_path: String) -> Result<String, String> {
      // Run git fetch --prune origin
      // --prune removes stale remote-tracking branches
      // Returns stdout (typically empty on success)
  }
  ```
- Make it `async` so it doesn't block the Tauri main thread (network operation, 1-2s per repo)
- Register in the `.invoke_handler(tauri::generate_handler![...])` list
- Use `tokio::task::spawn_blocking` to run the synchronous `Command::new("git")` off the async executor

**Why `--prune`:** Removes stale remote-tracking branches that no longer exist on the remote. Keeps local refs clean without extra commands.

**Why separate command (not bundled into `get_git_status`):** `git fetch` is a network operation (1-2s). `get_git_status` is purely local (sub-ms). Bundling them would make every project refresh wait for network. They need different trigger strategies.

**Error handling:** Return `Err(String)` with the stderr output. Frontend handles gracefully (log warning, don't block UI).

**Risk:** Low. New command, no changes to existing code.

---

### Step 3: Update TypeScript types and Tauri invoke bindings

**Files:** `src/lib/schema.ts`, `src/lib/tauri.ts`

**What:**
- Extend the `GitStatus` interface in `schema.ts` with the new fields:
  ```typescript
  interface GitStatus {
    // Existing (unchanged)
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
  }
  ```
- Add the `git_fetch` command to the `TauriCommands` map in `tauri.ts`:
  ```typescript
  git_fetch: { args: { repoPath: string }; return: string };
  ```
- Add the exported wrapper function:
  ```typescript
  export async function gitFetch(repoPath: string): Promise<string> {
    return typedInvoke('git_fetch', { repoPath });
  }
  ```

**Note:** Not adding `branches: BranchInfo[]` to the schema in this step. Branch listing is a nice-to-have for Git Sync but not needed to fix the 403 issue. Can be added later without breaking changes.

**Risk:** None. Type additions are backwards-compatible (all `Optional`).

---

### Step 4: Replace GitHub API calls with local git data in project loading

**Files:** `src/lib/projects.ts`, `src/lib/github.ts`

**What:**
1. In `loadAllProjects()` (projects.ts), **remove** the `fetchCommitActivity` loop (lines ~165-179):
   ```typescript
   // DELETE this entire block:
   const withRepoSlug = projects.filter((project) => project.hasRepo);
   await Promise.all(
     withRepoSlug.map(async (project) => { ... })
   );
   ```
2. Instead, populate `commitActivity` from the already-fetched `gitStatus`:
   ```typescript
   // After the existing gitStatus fetch (line ~118):
   // Derive commitActivity from local git data (replaces GitHub API)
   if (gitStatus) {
     project.commitActivity = {
       lastCommit: gitStatus.lastCommitDate?.split('T')[0],
       commitsThisWeek: gitStatus.commitsThisWeek ?? 0,
     };
   }
   ```
3. Update the staleness check to use `gitStatus.lastCommitDate` directly:
   ```typescript
   const lastActivity = frontmatter.lastActivity ?? gitStatus?.lastCommitDate?.split('T')[0];
   project.isStale = isStale(lastActivity);
   ```
4. **Remove** the `import { fetchCommitActivity } from './github'` line
5. **Keep** `github.ts` file and `extractGitHubSlug` — they're still used for `hasRepo` detection and will be needed for future authenticated API features

**Why keep `commitActivity` on the model:** The `ProjectViewModel.commitActivity` field is consumed by `App.tsx` and `ProjectDetails.tsx` for the "X/wk" badge. Keeping the same shape avoids touching the UI components in this step. The field is now derived from local git data rather than GitHub API.

**Risk:** Medium. This is the core behavioral change — removing the API calls. But the replacement data comes from the already-called `get_git_status`, so no new async operations are added to the load path.

---

### Step 5: Add `git fetch` integration to frontend

**Files:** `src/lib/git.ts`, `src/App.tsx`

**What:**
1. Add fetch function to `git.ts`:
   ```typescript
   export async function fetchAllRepos(projects: ProjectViewModel[]): Promise<void> {
     const gitProjects = projects.filter((p) => p.hasGit && p.gitStatus?.remote);
     await Promise.allSettled(
       gitProjects.map((p) => gitFetch(p.dirPath).catch((err) =>
         console.warn(`[Git] fetch failed for ${p.id}:`, err)
       ))
     );
   }
   ```
2. In `App.tsx`, call `fetchAllRepos` on:
   - **App startup**: In the existing `useEffect(() => { void loadProjects(); }, [...])` — fetch AFTER load completes, then reload to pick up updated refs
   - **Manual refresh**: In the `onRefresh` handler
3. Use `Promise.allSettled` so one repo's network failure doesn't block others
4. After fetch completes, call `loadProjects()` again to refresh the status with updated remote refs

**What NOT to do in this step:**
- No background interval yet (keep it simple, add in a follow-up if needed)
- No UI indication of fetch-in-progress (can add later with a subtle spinner)
- No Git Sync dialog integration (that's the `git-sync` roadmap item)

**Risk:** Low. Additive calls at known trigger points. `allSettled` ensures fault tolerance.

---

### Step 6: Remove in-memory GitHub API cache

**Files:** `src/lib/github.ts`

**What:**
- Remove the `commitActivityCache`, `CACHE_TTL_MS`, and `invalidateCommitActivityCache` that were added as a stopgap fix (commit `98a1189`)
- Remove the `fetchCommitActivity` function entirely
- Keep `github.ts` as a module with just the `CommitActivity` interface export (for type compatibility) and any future authenticated API functions
- If `github.ts` becomes empty/trivial, it can be deleted and the interface moved to `schema.ts`

**Why last:** Ensures the cache removal doesn't break anything — Steps 4-5 already eliminated all callers.

**Risk:** None. Dead code removal.

---

### Step 7: Update tests

**Files:** `src/lib/projects.test.ts` (if exists), new test file if needed

**What:**
- Verify `extractGitHubSlug` tests still pass (function is unchanged)
- Add test for `commitActivity` derivation from `gitStatus` fields
- Verify that projects without git repos still load correctly (no regression)
- Run full `bun test` to confirm no breakage

**Risk:** None.

---

## Dependency Graph

```
Step 1 (Rust struct) ──┐
                       ├── Step 3 (TS types) ── Step 4 (replace API) ── Step 6 (remove cache)
Step 2 (git fetch cmd) ┘                                │
                                                        └── Step 5 (fetch integration)
                                                                         │
                                                                    Step 7 (tests)
```

Steps 1 and 2 can be done in parallel.
Steps 4 and 5 are independent of each other but both depend on Step 3.
Step 6 depends on Step 4.
Step 7 is final.

## What This Does NOT Cover

- **Branch listing UI** — useful for Git Sync but not needed for 403 fix. Add to `git-sync` scope.
- **Background fetch interval** — can be added later if manual fetch + startup fetch proves insufficient.
- **GitHub authenticated API** — separate future roadmap item for PRs/CI/issues.
- **Git operations** (commit, push, pull) — covered by `git-sync` roadmap item.
- **Multi-remote support** — only `origin` for now.
- **UI changes to display new data** (last commit message, author, tag, stash) — the data will be available on the model for future UI work. This plan only updates existing displays (X/wk badge, staleness indicator).
