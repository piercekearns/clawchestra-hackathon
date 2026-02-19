# Git Sync — Implementation Plan (Phase 1: Sync Dialog)

> Phased build plan for the Git Sync feature. Phase 1 only: dirty state detection, card indicators, header button, and Sync Dialog UI.

## Summary

This plan adds visibility into uncommitted dashboard-managed file changes and a batch commit+push workflow via a Sync Dialog. It builds on the existing `GitStatus` infrastructure from Local Git Intelligence (commit `7184c60`) — `aheadCount` and `behindCount` already exist. Only two new fields are needed: `dashboardDirty` and `dirtyFiles`.

---

**Spec:** `docs/specs/git-sync-spec.md`
**Roadmap Item:** `git-sync`
**Created:** 2026-02-19

---

## Phases

1. **Rust backend** — extend `get_git_status` + new commit/push commands
2. **TypeScript types + bindings** — extend `GitStatus` interface + Tauri invoke wrappers
3. **Store + project loading** — wire dirty count into Zustand
4. **Card indicators** — orange dot on dirty project cards
5. **Header button** — Sync button with badge count
6. **Sync Dialog** — modal with project list, branch indicators, commit/push controls
7. **Tests** — unit tests for backend + frontend logic

---

## Phase 1: Rust Backend

### 1.1 Extend `get_git_status` with dirty file detection

**File:** `src-tauri/src/lib.rs` (GitStatus struct, ~line 17)

Add two fields to the `GitStatus` struct:

```rust
// Add after behindCount field (~line 35)
/// True when dashboard-managed files have uncommitted changes
pub dashboard_dirty: bool,
/// List of dashboard-managed files with uncommitted changes  
pub dirty_files: Vec<String>,
```

**In `get_git_status` function (~line 1125):**

After the existing git status logic, add dashboard dirty detection:

```rust
// Dashboard-managed file patterns
const DASHBOARD_FILES: &[&str] = &[
    "PROJECT.md",
    "ROADMAP.md", 
    "CHANGELOG.md",
];
const DASHBOARD_DIRS: &[&str] = &[
    "roadmap/",
    "docs/specs/",
    "docs/plans/",
];

// Check unstaged + staged changes against dashboard files
// git diff --name-only (unstaged)
// git diff --name-only --cached (staged)
// Filter results against DASHBOARD_FILES (exact match) and DASHBOARD_DIRS (prefix match)
```

- [ ] Add `dashboard_dirty: bool` to GitStatus struct
- [ ] Add `dirty_files: Vec<String>` to GitStatus struct
- [ ] Implement dashboard file filtering in `get_git_status`
- [ ] `dashboard_dirty = !dirty_files.is_empty()`

### 1.2 Add `git_commit_project` command

**File:** `src-tauri/src/lib.rs`

New Tauri command to commit specific files in a project:

```rust
#[tauri::command]
fn git_commit_project(
    project_path: String,
    files: Vec<String>,
    message: String,
) -> Result<String, String> {
    // 1. Validate project_path exists and is a git repo
    // 2. For each file in files: git add <file> (only if file exists)
    // 3. git commit -m <message>
    // 4. Return commit hash on success
}
```

- [ ] Implement `git_commit_project` command
- [ ] Register in `.invoke_handler()` (~line 2215)
- [ ] Only stage files from the provided list (never `git add -A`)

### 1.3 Add `git_push_project` command

**File:** `src-tauri/src/lib.rs`

```rust
#[tauri::command]
fn git_push_project(project_path: String) -> Result<(), String> {
    // 1. git push origin <current-branch>
    // 2. Fast-forward only — if push fails, return the error message
    // No --force, no branch creation
}
```

- [ ] Implement `git_push_project` command
- [ ] Register in `.invoke_handler()`

### Test gate

- [ ] `cargo check` passes
- [ ] Existing tests still pass

---

## Phase 2: TypeScript Types + Tauri Bindings

### 2.1 Extend GitStatus interface

**File:** `src/lib/schema.ts` (~line 82)

```typescript
// Add after behindCount field
/** True when dashboard-managed files have uncommitted changes */
dashboardDirty?: boolean;
/** List of dashboard-managed files with uncommitted changes */
dirtyFiles?: string[];
```

- [ ] Add `dashboardDirty` to GitStatus interface
- [ ] Add `dirtyFiles` to GitStatus interface

### 2.2 Add Tauri invoke wrappers

**File:** `src/lib/tauri.ts`

```typescript
export async function commitProject(
  projectPath: string,
  files: string[],
  message: string,
): Promise<string> {
  return invoke<string>('git_commit_project', { projectPath, files, message });
}

export async function pushProject(projectPath: string): Promise<void> {
  return invoke<void>('git_push_project', { projectPath });
}
```

- [ ] Add `commitProject` wrapper
- [ ] Add `pushProject` wrapper

### Test gate

- [ ] `npx tsc --noEmit` passes

---

## Phase 3: Store + Project Loading

### 3.1 Add dirty count to Zustand store

**File:** `src/lib/store.ts`

```typescript
// Add to DashboardState interface
dirtyProjectCount: number;
setDirtyProjectCount: (count: number) => void;
```

Initial value: `0`. Not persisted (derived from filesystem on every scan).

- [ ] Add `dirtyProjectCount` to store state
- [ ] Add `setDirtyProjectCount` action

### 3.2 Compute dirty count during project loading

**File:** `src/lib/projects.ts`

In `loadAllProjects()`, after all projects are loaded, compute and return the dirty count:

```typescript
// After project loading loop
const dirtyCount = projects.filter(
  (p) => p.gitStatus?.dashboardDirty
).length;
```

**File:** `src/lib/store.ts` or `src/App.tsx`

Where `loadProjects()` is called, update the dirty count:

```typescript
// After loadAllProjects resolves
setDirtyProjectCount(dirtyCount);
```

- [ ] Compute dirty count from loaded projects
- [ ] Update store after each `loadProjects()` call

### Test gate

- [ ] `bun test` passes
- [ ] `npx tsc --noEmit` passes

---

## Phase 4: Card Indicators

### 4.1 Orange dot on project cards

**File:** `src/components/ProjectCard.tsx` (or wherever project cards render git indicators)

When a project has `gitStatus?.dashboardDirty === true`, show an orange dot indicator:

```tsx
{project.gitStatus?.dashboardDirty && (
  <Tooltip content="Uncommitted dashboard changes">
    <div className="h-2 w-2 rounded-full bg-orange-400" />
  </Tooltip>
)}
```

Place this in the card's metadata/indicator area, near existing git status indicators.

- [ ] Add orange dot indicator to project cards
- [ ] Add tooltip explaining the indicator
- [ ] Only shows when `dashboardDirty` is true (not for general repo dirtiness)

### Test gate

- [ ] `npx tsc --noEmit` passes
- [ ] Visual check: cards with dirty dashboard files show orange dot

---

## Phase 5: Header Sync Button

### 5.1 Create SyncButton component

**File:** `src/components/SyncButton.tsx` (new)

```tsx
interface SyncButtonProps {
  dirtyCount: number;
  onClick: () => void;
}

export function SyncButton({ dirtyCount, onClick }: SyncButtonProps) {
  if (dirtyCount === 0) return null; // Hidden when clean
  
  return (
    <button onClick={onClick} className="...">
      <GitCommitHorizontal className="h-4 w-4" />
      <span>Sync</span>
      <span className="badge">{dirtyCount}</span>
    </button>
  );
}
```

- Lucide icon: `GitCommitHorizontal` or `Upload`
- Badge shows count of dirty projects
- Hidden when count is 0
- Style consistent with existing Refresh and Add Project buttons

### 5.2 Wire into Header

**File:** `src/components/Header.tsx`

Add SyncButton between Refresh and Add Project:

```tsx
<SyncButton dirtyCount={dirtyProjectCount} onClick={() => setSyncDialogOpen(true)} />
```

- [ ] Create `SyncButton` component
- [ ] Add to Header layout
- [ ] Add `syncDialogOpen` state (boolean) to manage dialog visibility

### Test gate

- [ ] `npx tsc --noEmit` passes
- [ ] Visual check: button appears with correct count, hidden when 0

---

## Phase 6: Sync Dialog

This is the largest phase. Build incrementally.

### 6.1 Create SyncDialog component shell

**File:** `src/components/SyncDialog.tsx` (new)

Use the existing Dialog pattern from shadcn/ui (consistent with SettingsDialog, project modals):

```tsx
interface SyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projects: ProjectViewModel[];
}
```

- [ ] Create dialog shell with title "Sync Changes"
- [ ] Wire open/close state

### 6.2 Build dirty project list

Inside the dialog, list all projects with `dashboardDirty`:

```tsx
interface SyncProjectRow {
  project: ProjectViewModel;
  selected: boolean;          // checkbox state (default: true)
  pushEnabled: boolean;       // push toggle (smart defaults)
  action: 'commit-push' | 'commit-only';
}
```

For each dirty project row:
- Checkbox (all checked by default)
- Project name + icon
- Branch indicator: `main ✓` / `main ↑2` / `dev ↓3 ⚠` / `main (no remote)`
- Per-project action button: [Commit & Push] or [Commit only]
- Expandable change list: dirty files grouped as Metadata vs Documents
- Warning for behind/diverged branches with "Ask agent to help" link

Branch indicator logic (derive from existing GitStatus fields):
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

Smart push defaults:
- `safe: true` → push enabled by default
- `safe: false` → push disabled by default (commit only)

- [ ] Build project row component with checkbox, branch indicator, action button
- [ ] Group dirty files into Metadata vs Documents categories
- [ ] Implement smart push defaults based on branch state
- [ ] Add warning badges for risky branches

### 6.3 Commit message input

Editable text field with auto-generated default:

```typescript
const dirtyNames = dirtyProjects.map(p => p.title);
const defaultMessage = `chore: sync project metadata (${dirtyNames.join(', ')})`;
```

- [ ] Add commit message input with auto-generated default
- [ ] Message shared across all batch-synced projects

### 6.4 Sync execution

**"Sync All Selected" button** and per-project action buttons:

```typescript
async function syncProject(
  project: ProjectViewModel,
  message: string,
  push: boolean,
): Promise<SyncResult> {
  try {
    const hash = await commitProject(project.dirPath, project.gitStatus!.dirtyFiles!, message);
    if (push && project.gitStatus?.remote) {
      await pushProject(project.dirPath);
    }
    return { projectId: project.id, success: true, hash };
  } catch (error) {
    return { projectId: project.id, success: false, error: String(error) };
  }
}
```

For batch: iterate selected projects sequentially (each in its own repo).

After sync:
- Update row status: ✅ success / ❌ failed with error message
- Failed commits show error + "Ask agent to help" link
- On close/success: trigger project refresh to update indicators

- [ ] Implement per-project sync function
- [ ] Implement batch "Sync All Selected"
- [ ] Show per-row success/failure status after sync
- [ ] "Ask agent to help" link: opens chat drawer with pre-filled context message
- [ ] Trigger `loadProjects()` refresh after dialog closes

### 6.5 "Ask agent to help" chat integration

When clicked, pre-fills the chat composer (same mechanism as lifecycle button prompts):

```typescript
const helpMessage = `${project.title} is on branch \`${git.branch}\`, which is ${git.behindCount} commits behind \`origin/${git.branch}\`. The following dashboard files have uncommitted changes: ${git.dirtyFiles?.join(', ')}. Can you help me sync these?`;
```

Uses existing `prefillChatMessage` mechanism from `deliverable-lifecycle.ts` / `ChatShell`.

- [ ] Wire "Ask agent to help" to chat pre-fill
- [ ] Include branch state and dirty file list in the pre-filled message

### Test gate

- [ ] `npx tsc --noEmit` passes
- [ ] `bun test` passes
- [ ] Visual check: dialog opens, shows dirty projects, commit/push works

---

## Phase 7: Tests

### 7.1 Rust tests

**File:** `src-tauri/src/lib.rs` (in `hardening_tests` module)

- Test `dashboard_dirty` detection: create a temp git repo, modify PROJECT.md, verify `dashboard_dirty: true`
- Test that non-dashboard files (e.g., `src/main.rs`) don't trigger `dashboard_dirty`
- Test `git_commit_project`: commit specific files, verify only those files are committed
- Test `git_push_project`: verify error message when no remote configured

### 7.2 TypeScript tests

**File:** `src/lib/git-sync.test.ts` (new)

- Test `getBranchIndicator` logic (all 5 branch states)
- Test smart push defaults (safe vs unsafe)
- Test default commit message generation
- Test dirty file categorization (Metadata vs Documents)

- [ ] Add Rust tests for dirty detection + commit/push commands
- [ ] Add TypeScript tests for branch indicator + sync logic
- [ ] All tests pass: `bun test` + `cargo test`

---

## Phase 8: Roadmap + Docs Update

- [ ] Update `ROADMAP.md` item `nextAction` to reflect build state
- [ ] Update `docs/AGENTS.md` if new UI operations need documenting
- [ ] Run compliance sync: `scripts/sync-agent-compliance.sh`

---

## File Manifest

| File | Action | Phase |
|------|--------|-------|
| `src-tauri/src/lib.rs` | Modify — GitStatus struct + 2 new commands | 1 |
| `src/lib/schema.ts` | Modify — add 2 fields to GitStatus | 2 |
| `src/lib/tauri.ts` | Modify — add 2 invoke wrappers | 2 |
| `src/lib/store.ts` | Modify — add dirtyProjectCount | 3 |
| `src/lib/projects.ts` | Modify — compute dirty count | 3 |
| `src/components/ProjectCard.tsx` | Modify — add orange dot | 4 |
| `src/components/SyncButton.tsx` | **New** | 5 |
| `src/components/Header.tsx` | Modify — add SyncButton | 5 |
| `src/components/SyncDialog.tsx` | **New** — largest new file | 6 |
| `src/lib/git-sync.ts` | **New** — sync logic helpers | 6 |
| `src/lib/git-sync.test.ts` | **New** — tests | 7 |
| `src/App.tsx` | Modify — wire dialog state | 5-6 |

**Estimated new code:** ~600-800 lines across 4 new files + ~150 lines of modifications to existing files.

---

## Verification Checklist

- [ ] `cargo check` passes
- [ ] `bun test` passes (all existing + new tests)
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm build` succeeds
- [ ] Sync button hidden when all projects clean
- [ ] Sync button shows correct dirty count
- [ ] Orange dots appear on dirty project cards
- [ ] Sync Dialog shows dirty projects with correct branch indicators
- [ ] Commit works (creates commit with only dashboard files)
- [ ] Push works (fast-forward to upstream)
- [ ] Push disabled by default for behind/diverged branches
- [ ] "Ask agent to help" opens chat with context
- [ ] After sync, indicators refresh (dots disappear, count updates)
- [ ] Projects without git: no indicators shown
- [ ] Projects with git but no remote: commit available, push disabled
