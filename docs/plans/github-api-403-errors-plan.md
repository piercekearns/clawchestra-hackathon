# Local Git Intelligence — Implementation Plan

> Spec: `docs/specs/github-api-403-errors-spec.md`

## Build Order

Steps are sequential unless noted. Each step ends in a commit with passing tests and clean TypeScript.

---

### Step 1: Extend Rust `GitStatus` struct and `get_git_status` command

**Files:** `src-tauri/src/lib.rs`

**What:**
- Add `#[serde(rename_all = "camelCase")]` to the existing `GitStatus` struct. Existing fields are single-word so this is a no-op for them, but it's required for new multi-word fields to serialize correctly to JavaScript (e.g. `last_commit_date` → `lastCommitDate`).
- Add new fields to the existing `GitStatus` struct (don't create a separate struct — keep the single `get_git_status` command):
  ```rust
  #[derive(Serialize)]
  #[serde(rename_all = "camelCase")]
  struct GitStatus {
      // Existing fields (unchanged)
      state: String,
      branch: Option<String>,
      details: Option<String>,
      remote: Option<String>,
      
      // New fields
      last_commit_date: Option<String>,    // git log -1 --format=%aI
      last_commit_message: Option<String>, // git log -1 --format=%s
      last_commit_author: Option<String>,  // git log -1 --format=%an
      commits_this_week: Option<u32>,      // git rev-list --count --since="7 days ago" HEAD
      latest_tag: Option<String>,          // git describe --tags --abbrev=0
      stash_count: u32,                    // git stash list | wc -l (0 when empty, not None)
      ahead_count: Option<u32>,            // already computed, just expose explicitly
      behind_count: Option<u32>,           // already computed, just expose explicitly
  }
  ```
- Populate the new fields inside the existing `get_git_status` function by calling `run_git` with the appropriate arguments
- Use `Option<T>` for fields where the git command can legitimately fail (no commits, no tags, no upstream). Use plain `u32` for `stash_count` (repos with no stash have count 0, not absent).
- The `ahead_count` and `behind_count` are already being computed (lines ~1155–1173) to determine the `state` string — capture the parsed values into the struct fields instead of discarding them.
- Combine the log queries into a single call where possible: `git log -1 --format=%aI%n%s%n%an` returns date, subject, author in one invocation (split on newlines).

**Why extend rather than create new command:**
- `get_git_status` is already called per-project in `loadAllProjects`
- One invoke per project is better than two
- All git queries are sub-millisecond, so bundling them doesn't create a performance concern

**Edge cases:**
- Repos with no commits: `git log` will fail → `None` for all three log fields
- Repos with no tags: `git describe --tags` will fail → `None`
- Repos with no upstream: `ahead_count`/`behind_count` remain `None`
- Repos with no stash: `stash_count` is `0`
- `commits_this_week` uses `--since="7 days ago"` which is relative to current time; empty repos return `None`

**Risk:** Low. Additive change to existing function. The `serde(rename_all)` is a no-op for existing single-word fields.

---

### Step 2: Add `git_fetch` Tauri command

**Files:** `src-tauri/src/lib.rs`

**What:**
- Add a new synchronous Tauri command `git_fetch` (same pattern as existing git commands — no `spawn_blocking`, no `async`):
  ```rust
  #[tauri::command]
  fn git_fetch(repo_path: String) -> Result<String, String> {
      run_git(&repo_path, &["fetch", "origin"])
  }
  ```
- Register in the `.invoke_handler(tauri::generate_handler![...])` list
- No `--prune` flag — this is a read-only status dashboard, not a branch manager. Pruning is opinionated and can be added as an option later if Git Sync needs it.

**Why synchronous (not async/spawn_blocking):** All existing git commands in `lib.rs` (`get_git_status`, `git_commit`, `git_push`, `probe_repo`) use the same synchronous `run_git` helper. Stay consistent. The frontend calls this with `Promise.allSettled` so the Tauri main thread isn't blocked from the JS perspective.

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
- Add the exported wrapper function in `tauri.ts`:
  ```typescript
  export async function gitFetch(repoPath: string): Promise<string> {
    return typedInvoke('git_fetch', { repoPath });
  }
  ```

**Note:** Not adding `branches: BranchInfo[]` to the schema in this step. Branch listing is a nice-to-have for Git Sync but not needed to fix the 403 issue. Can be added later without breaking changes.

**Risk:** None. Type additions are backwards-compatible (all optional).

---

### Step 4: Replace GitHub API calls with local git data in project loading

**Files:** `src/lib/projects.ts`

**What:**
1. In `loadAllProjects()` (projects.ts), **remove** the entire GitHub API block (lines ~165-179):
   ```typescript
   // DELETE: the fetchCommitActivity import
   // DELETE: the withRepoSlug filter + Promise.all loop
   ```
2. In the per-project loop (around line ~118 where `gitStatus` is already fetched), **derive `commitActivity` from `gitStatus`**:
   ```typescript
   // After: const gitStatus = hasGit ? await fetchGitStatus(dirPath) : undefined;
   // Add:
   const commitActivity = gitStatus ? {
     lastCommit: gitStatus.lastCommitDate?.split('T')[0],
     commitsThisWeek: gitStatus.commitsThisWeek ?? 0,
   } : undefined;
   ```
3. Assign `commitActivity` to the project model in the same place it's constructed:
   ```typescript
   project.commitActivity = commitActivity;
   ```
4. Update the staleness check to use `gitStatus.lastCommitDate` directly:
   ```typescript
   const lastActivity = frontmatter.lastActivity ?? gitStatus?.lastCommitDate?.split('T')[0];
   project.isStale = isStale(lastActivity);
   ```

**Why keep `commitActivity` on the model:** `App.tsx` (line ~1415) renders `project.commitActivity.commitsThisWeek` for the "X/wk" badge. `ProjectDetails.tsx` (line ~104) shows "X commit(s)/week". Populating `commitActivity` from `gitStatus` avoids cascading changes to those UI components. The field now comes from local git rather than GitHub API — same shape, different source.

**Risk:** Medium. This is the core behavioral change. But the replacement data comes from the already-called `get_git_status`, so no new async operations are added.

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
   - **App startup**: After the initial `loadProjects()` completes, fire-and-forget `fetchAllRepos` then `loadProjects()` again to pick up updated remote refs
   - **Manual refresh**: In the `onRefresh` handler (Header refresh button)
3. Use `Promise.allSettled` so one repo's network failure doesn't block others
4. After fetch completes, call `loadProjects()` again to refresh ahead/behind with updated remote refs

**What NOT to do in this step:**
- No background interval yet (keep it simple, add in a follow-up if needed)
- No UI indication of fetch-in-progress (can add later with a subtle spinner)
- No Git Sync dialog integration (that's the `git-sync` roadmap item)

**Risk:** Low. Additive calls at known trigger points. `allSettled` ensures fault tolerance.

---

### Step 6: Delete `github.ts` and clean up dead code

**Files:** `src/lib/github.ts` (delete), `src/lib/projects.ts`

**What:**
- **Delete `src/lib/github.ts` entirely.** After Step 4 removes the `fetchCommitActivity` call, there are zero remaining consumers. The `extractGitHubSlug` function lives in `projects.ts` (line 24), not `github.ts`, so `hasRepo` detection is unaffected.
- Remove the `commitActivityCache`, `CACHE_TTL_MS`, `invalidateCommitActivityCache` (stopgap from commit `98a1189`) — these are all in `github.ts` and go away with the file.
- Verify no remaining imports of `github.ts` anywhere in the codebase.
- The `CommitActivity` interface shape is already defined on `ProjectViewModel.commitActivity` in `schema.ts` — no need to re-export it.

**Why delete instead of keep:** Three reviewers agreed: keeping an empty module "for future use" is dead code. If/when we need authenticated GitHub API features, we'll create a new module purpose-built for that.

**Risk:** None. Dead code removal. Run `grep -r "from.*github" src/` to confirm no remaining imports.

---

### Step 7: Update tests

**Files:** `src/lib/projects.test.ts` (if exists), `src/lib/schema.test.ts` (if exists)

**What:**
- Run full `bun test` to confirm no breakage from the above changes
- Verify `extractGitHubSlug` tests still pass (function is unchanged, just no longer in `github.ts` import path — it was always in `projects.ts`)
- Add a test for `commitActivity` derivation logic: given a `gitStatus` with `lastCommitDate` and `commitsThisWeek`, verify the derived `commitActivity` has the correct `lastCommit` (date-only string) and `commitsThisWeek`
- Add edge case tests:
  - `gitStatus` with `lastCommitDate: undefined` → `commitActivity.lastCommit` is `undefined`
  - `gitStatus` with `commitsThisWeek: undefined` → `commitActivity.commitsThisWeek` is `0` (fallback)
  - Project with `hasGit: false` → `commitActivity` is `undefined`
- Verify clean TypeScript compilation (`npx tsc --noEmit`)

**Risk:** None.

---

## Dependency Graph

```
Step 1 (Rust struct + serde) ──┐
                               ├── Step 3 (TS types) ── Step 4 (replace API) ── Step 6 (delete github.ts)
Step 2 (git fetch cmd) ────────┘                                │
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
- **Extracting git module from `lib.rs`** — `lib.rs` is large (2,277 lines) and would benefit from a `git.rs` module extraction, but that's a refactor orthogonal to this feature. Can be done as a separate cleanup.
