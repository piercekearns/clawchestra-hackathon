# Git Sync — Implementation Plan (Phase 1: Sync Dialog)

> Phased build plan for the Git Sync feature. Phase 1 only: dirty state detection, card indicators, header button, and Sync Dialog UI.

## Summary

This plan adds visibility into uncommitted dashboard-managed file changes and a batch commit+push workflow via a Sync Dialog. It builds on the existing `GitStatus` infrastructure from Local Git Intelligence (commit `7184c60`) — `aheadCount` and `behindCount` already exist. Only two new fields are needed: `dashboardDirty` and `dirtyFiles`.

---

**Spec:** `docs/specs/git-sync-spec.md`
**Roadmap Item:** `git-sync`
**Created:** 2026-02-19
**Reviewed:** 2026-02-19 (3-agent /plan_review — DHH, Kieran, Code Simplicity)

---

## Review Corrections Applied

The following changes were made based on the 3-agent plan review:

1. **Use existing `git_commit`/`git_push` commands** — don't create duplicates. Modify existing `git_commit` to return commit hash.
2. **No `dirtyProjectCount` in Zustand** — compute via selector, not stored state. Phase 3 deleted.
3. **SyncButton inlined in Header.tsx** — no separate file for ~10 lines of JSX.
4. **Phases collapsed** from 8 → 4: Backend → Types+Store → UI → Tests.
5. **ProjectCard.tsx reference fixed** — orange dot goes in App.tsx `renderItemIndicators`.
6. **Dirty detection uses `git status --porcelain`** — filter existing output instead of extra `git diff` commands. Catches untracked files too.
7. **`getBranchIndicator` kept but inlined** in SyncDialog (no separate git-sync.ts helpers file). Enough branching logic to stay a function, not enough to warrant its own module.
8. **Sequential batch execution rationale documented** — each project is its own git repo; can't batch commits across repos.
9. **Metadata vs Documents grouping kept** — useful UX distinction, worth building now.
10. **"Ask agent to help" kept** — core functionality for Phase 1.
11. **Per-project + batch buttons kept** — modularity required (user may want to sync one project, not all).

---

## Phases

1. **Backend** — extend `get_git_status` dirty detection + modify existing commit/push commands
2. **Types + Store** — extend GitStatus interface, add Tauri bindings, computed dirty count
3. **UI** — card indicators, header button, Sync Dialog with branch awareness + commit/push
4. **Tests + Docs** — unit tests, verification, roadmap/AGENTS.md updates

---

## Phase 1: Backend

### 1.1 Extend `get_git_status` with dirty file detection

**File:** `src-tauri/src/lib.rs` (GitStatus struct, ~line 17)

Add two fields to the `GitStatus` struct:

```rust
// Add after behindCount field (~line 35)
/// True when dashboard-managed files have uncommitted changes
pub dashboard_dirty: bool,
/// Dashboard-managed files with uncommitted changes
pub dirty_files: Vec<String>,
```

**In `get_git_status` function (~line 1125):**

The function already runs `git status` — extend it to filter for dashboard-managed files. Use the existing `git status --porcelain` output (or add it) rather than running separate `git diff` commands. This catches both modified AND untracked dashboard files.

```rust
// Dashboard-managed file patterns
const DASHBOARD_FILES: &[&str] = &["PROJECT.md", "ROADMAP.md", "CHANGELOG.md"];
const DASHBOARD_DIR_PREFIXES: &[&str] = &["roadmap/", "docs/specs/", "docs/plans/"];

// Filter porcelain output: each line is " M path" or "?? path" etc.
// Match against DASHBOARD_FILES (exact) and DASHBOARD_DIR_PREFIXES (prefix, recursive)
// e.g. "roadmap/git-sync.md" matches prefix "roadmap/"
// e.g. "docs/specs/deep/nested.md" matches prefix "docs/specs/"
```

- [ ] Add `dashboard_dirty: bool` to GitStatus struct
- [ ] Add `dirty_files: Vec<String>` to GitStatus struct
- [ ] Filter `git status --porcelain` output against dashboard file patterns
- [ ] `dashboard_dirty = !dirty_files.is_empty()`
- [ ] Prefix matching is recursive (covers nested subdirectories)

### 1.2 Modify existing `git_commit` to return commit hash

**File:** `src-tauri/src/lib.rs`

The existing `git_commit` command currently returns `Result<(), String>`. Change to return `Result<String, String>` where the String is the short commit hash:

```rust
// After successful commit, get the hash:
// git rev-parse --short HEAD
```

Also ensure it accepts a `files: Vec<String>` parameter for targeted staging (only dashboard-managed files, never `git add -A`):

```rust
// For each file in files: git add <file> (only if file exists and has changes)
// git commit -m <message>
// Return short hash
```

- [ ] Modify `git_commit` return type to `Result<String, String>`
- [ ] Ensure `files` parameter for targeted staging exists
- [ ] Return short commit hash after successful commit

### 1.3 Verify existing `git_push` command

**File:** `src-tauri/src/lib.rs`

Check that the existing `git_push` command does:
- Push to current branch's upstream
- Fast-forward only (no `--force`)
- Return meaningful error on failure

If it doesn't exist or doesn't meet these requirements, create it.

- [ ] Verify `git_push` exists and pushes to current branch upstream
- [ ] Ensure it returns clear error messages on failure

### Test gate

- [ ] `cargo check` passes
- [ ] Existing Rust tests still pass

---

## Phase 2: Types + Store

### 2.1 Extend GitStatus interface

**File:** `src/lib/schema.ts` (~line 82)

```typescript
// Add after behindCount field
/** True when dashboard-managed files have uncommitted changes */
dashboardDirty?: boolean;
/** Dashboard-managed files with uncommitted changes */
dirtyFiles?: string[];
```

- [ ] Add `dashboardDirty` to GitStatus interface
- [ ] Add `dirtyFiles` to GitStatus interface

### 2.2 Update Tauri invoke wrappers

**File:** `src/lib/tauri.ts`

Update the existing `commitProject` wrapper (if it exists) to accept a `files` parameter and return the commit hash string. If wrappers don't exist, create them:

```typescript
export async function commitProject(
  projectPath: string,
  files: string[],
  message: string,
): Promise<string> {
  return invoke<string>('git_commit', { projectPath, files, message });
}

export async function pushProject(projectPath: string): Promise<void> {
  return invoke<void>('git_push', { projectPath });
}
```

- [ ] Ensure `commitProject` wrapper accepts files + returns hash
- [ ] Ensure `pushProject` wrapper exists

### 2.3 Computed dirty count (no Zustand field)

The dirty count is derived state — compute it inline wherever needed:

```typescript
// In any component that needs the count:
const dirtyProjectCount = useMemo(
  () => projects.filter((p) => p.gitStatus?.dashboardDirty).length,
  [projects],
);
```

No store field needed. No setter. No sync obligation.

- [ ] Use `useMemo` selector for dirty count (no store field)

### Test gate

- [ ] `npx tsc --noEmit` passes
- [ ] `bun test` passes

---

## Phase 3: UI

### 3.1 Orange dot on project cards

**File:** `src/App.tsx` — in `renderItemIndicators` (~line 1489, or wherever card indicators are rendered)

When a project has `gitStatus?.dashboardDirty === true`, show an orange dot:

```tsx
{project.gitStatus?.dashboardDirty && (
  <Tooltip content="Uncommitted dashboard changes">
    <div className="h-2 w-2 rounded-full bg-orange-400" />
  </Tooltip>
)}
```

- [ ] Add orange dot indicator in App.tsx card rendering
- [ ] Add tooltip explaining the indicator
- [ ] Only shows for `dashboardDirty` (not general repo dirtiness)

### 3.2 Sync button in Header (inlined)

**File:** `src/components/Header.tsx`

Add sync button between Refresh and Add Project. Inline — no separate component file:

```tsx
{dirtyProjectCount > 0 && (
  <button onClick={() => setSyncDialogOpen(true)} className="...">
    <GitCommitHorizontal className="h-4 w-4" />
    <span>Sync</span>
    <span className="badge">{dirtyProjectCount}</span>
  </button>
)}
```

- Lucide icon: `GitCommitHorizontal` or `Upload`
- Badge shows count of dirty projects
- Hidden when count is 0
- Style consistent with existing Refresh and Add Project buttons

- [ ] Add sync button inline in Header.tsx
- [ ] Pass `dirtyProjectCount` from parent via computed `useMemo`
- [ ] Add `syncDialogOpen` state to manage dialog visibility

### 3.3 Sync Dialog

**File:** `src/components/SyncDialog.tsx` (new)

Use existing shadcn/ui Dialog pattern (consistent with SettingsDialog):

```tsx
interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectViewModel[]; // only dirty projects
}
```

#### Project list

For each dirty project, render a row with:
- **Checkbox** (all checked by default) — managed via `Set<string>` state (selected project IDs)
- **Project name + icon**
- **Branch indicator** — computed by `getBranchIndicator()` function local to this file:

```typescript
function getBranchIndicator(git: GitStatus): { label: string; safe: boolean } {
  if (!git.remote) return { label: `${git.branch} (no remote)`, safe: false };
  const ahead = git.aheadCount ?? 0;
  const behind = git.behindCount ?? 0;
  if (ahead > 0 && behind > 0) return { label: `${git.branch} ↑${ahead} ↓${behind} ⚠`, safe: false };
  if (behind > 0) return { label: `${git.branch} ↓${behind} ⚠`, safe: false };
  if (ahead > 0) return { label: `${git.branch} ↑${ahead}`, safe: true };
  return { label: `${git.branch} ✓`, safe: true };
}
```

- **Per-project action button**: [Commit & Push] or [Commit only]
- **Push toggle** — managed via `Set<string>` state (project IDs with push enabled). Smart defaults: push enabled when `safe: true`, disabled when `safe: false`.
- **Change list** — dirty files grouped into two visual categories:
  - **Metadata** (low risk): `PROJECT.md`, `ROADMAP.md`, `CHANGELOG.md`
  - **Documents** (review-worthy): `docs/specs/*.md`, `docs/plans/*.md`, `roadmap/*.md`
- **Warning badge** for behind/diverged branches
- **"Ask agent to help" link** for risky branches — opens chat drawer with pre-filled context:

```typescript
const helpMessage = `${project.title} is on branch \`${git.branch}\`${
  git.behindCount ? `, which is ${git.behindCount} commits behind remote` : ''
}. The following dashboard files have uncommitted changes: ${
  git.dirtyFiles?.join(', ')
}. Can you help me sync these?`;
```

Uses existing chat pre-fill mechanism (same as lifecycle button prompts via `ChatShell`).

- [ ] Create SyncDialog.tsx with shadcn/ui Dialog
- [ ] Project list with checkboxes (all selected by default)
- [ ] Branch indicators via `getBranchIndicator()`
- [ ] Per-project action buttons ([Commit & Push] / [Commit only])
- [ ] Smart push defaults based on branch safety
- [ ] Dirty files grouped as Metadata vs Documents
- [ ] Warning badges for behind/diverged branches
- [ ] "Ask agent to help" link → pre-fills chat with context

#### Commit message

Editable text field with auto-generated default:

```typescript
const dirtyNames = dirtyProjects.filter(p => selectedIds.has(p.id)).map(p => p.title);
const defaultMessage = `chore: sync project metadata (${dirtyNames.join(', ')})`;
```

- [ ] Commit message input with auto-generated default
- [ ] Message shared across batch-synced projects

#### Sync execution

```typescript
interface SyncResult {
  projectId: string;
  success: boolean;
  hash?: string;    // commit hash on success
  error?: string;   // error message on failure
  pushed?: boolean; // whether push was attempted and succeeded
}

async function syncProject(
  project: ProjectViewModel,
  message: string,
  push: boolean,
): Promise<SyncResult> {
  try {
    const hash = await commitProject(project.dirPath, project.gitStatus!.dirtyFiles!, message);
    let pushed = false;
    if (push && project.gitStatus?.remote) {
      await pushProject(project.dirPath);
      pushed = true;
    }
    return { projectId: project.id, success: true, hash, pushed };
  } catch (error) {
    return { projectId: project.id, success: false, error: String(error) };
  }
}
```

**Per-project sync:** Click a project's action button → sync that project immediately.

**Batch sync ("Sync All Selected"):** Iterate selected projects **sequentially**. Each project is its own git repository — commits can't span repos, and sequential execution prevents resource contention from parallel git operations on the same machine.

After each sync:
- Update row status: ✅ committed (+ pushed) / ❌ failed with error
- Failed commits show error + "Ask agent to help" link
- On dialog close: trigger `loadProjects()` refresh to update indicators

- [ ] Implement per-project sync function with `SyncResult` type
- [ ] Implement batch "Sync All Selected" (sequential, rationale documented)
- [ ] Show per-row success/failure status
- [ ] "Ask agent to help" on failure → chat pre-fill
- [ ] Trigger `loadProjects()` refresh on dialog close

### Test gate

- [ ] `npx tsc --noEmit` passes
- [ ] `bun test` passes
- [ ] Visual check: indicators, dialog, commit, push all work

---

## Phase 4: Tests + Docs

### 4.1 TypeScript tests

**File:** `src/lib/git-sync.test.ts` (new) — or co-located in SyncDialog if tests are component-level

- Test `getBranchIndicator` logic (all 6 branch states: in-sync, ahead, behind, diverged, no remote, non-default branch)
- Test smart push defaults (safe → enabled, unsafe → disabled)
- Test default commit message generation (with 1 project, with 3 projects)
- Test dirty file categorization (Metadata vs Documents)
- Test `SyncResult` handling (success, failure, push attempted)

### 4.2 Rust tests (if new logic added)

If `get_git_status` dirty detection required significant new logic, add tests:
- Temp git repo with modified PROJECT.md → `dashboard_dirty: true`
- Temp git repo with modified `src/main.rs` only → `dashboard_dirty: false`
- Temp git repo with new untracked `roadmap/new-item.md` → `dashboard_dirty: true`

### 4.3 Docs update

- [ ] Update `docs/AGENTS.md` — add Sync operations to Operations Reference table
- [ ] Run `scripts/sync-agent-compliance.sh` if AGENTS.md compliance block changed
- [ ] Update ROADMAP.md `nextAction` to reflect build state

- [ ] TypeScript tests written and passing
- [ ] Rust tests written and passing (if applicable)
- [ ] `bun test` passes (all existing + new)
- [ ] `cargo test` passes
- [ ] Docs updated

---

## File Manifest

| File | Action | Phase |
|------|--------|-------|
| `src-tauri/src/lib.rs` | Modify — GitStatus struct + dirty detection + modify git_commit return type | 1 |
| `src/lib/schema.ts` | Modify — add 2 fields to GitStatus | 2 |
| `src/lib/tauri.ts` | Modify — update/add invoke wrappers | 2 |
| `src/App.tsx` | Modify — orange dot in renderItemIndicators + dialog state + dirty count memo | 3 |
| `src/components/Header.tsx` | Modify — inline sync button | 3 |
| `src/components/SyncDialog.tsx` | **New** — dialog with project list, branch indicators, commit/push | 3 |
| `src/lib/git-sync.test.ts` | **New** — tests for branch indicator, push defaults, file categorization | 4 |
| `docs/AGENTS.md` | Modify — add sync operations | 4 |

**Estimated new code:** ~500-700 lines across 2 new files + ~100 lines of modifications.

---

## Verification Checklist

- [ ] `cargo check` passes
- [ ] `bun test` passes (all existing + new tests)
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm build` succeeds
- [ ] Sync button hidden when all projects clean
- [ ] Sync button shows correct dirty count after dashboard edit (drag card, etc.)
- [ ] Orange dots appear on dirty project cards
- [ ] Sync Dialog shows dirty projects with correct branch indicators
- [ ] Dirty files grouped into Metadata vs Documents categories
- [ ] Commit works (creates commit with only dashboard-managed files)
- [ ] Push works (fast-forward to upstream)
- [ ] Push disabled by default for behind/diverged branches
- [ ] Per-project action button works independently
- [ ] Batch "Sync All Selected" works sequentially
- [ ] "Ask agent to help" opens chat with project-specific context
- [ ] After sync, indicators refresh (dots disappear, count updates)
- [ ] Projects without git: no indicators shown
- [ ] Projects with git but no remote: commit available, push disabled
- [ ] Warning badge shown for behind/diverged branches
