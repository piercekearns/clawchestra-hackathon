# Branch-Aware Spec/Plan Viewing

> Enable viewing spec and plan documents from any branch without checking it out, using `git show`.

## Problem

`resolveDocFiles()` in `roadmap.ts` calls `pathExists()` — if the file is not on the current branch, the path returns empty and DocBadge doesn't render. The user knows the spec exists (it's referenced in db.json) but can't view it.

This is common when specs are written on feature branches but the user is viewing the kanban from `main`.

## Solution — New Rust Command

```rust
#[tauri::command]
pub fn git_read_file_at_ref(
    repo_path: String,
    git_ref: String,     // branch name, tag, or commit SHA
    file_path: String,   // repo-relative path
) -> Result<String, String> {
    validate_commit_path(&file_path)?;         // existing — rejects "..", backslash, null bytes
    validate_branch_name(&repo_path, &git_ref)?; // existing — safe branch name check
    let spec = format!("{}:{}", git_ref, file_path);
    let output = run_git_capture(&repo_path, &["show", &spec])?;
    if output.success {
        Ok(output.stdout)
    } else {
        Err(format!("File not found on ref '{}': {}", git_ref, output.stderr))
    }
}
```

Both `validate_commit_path` and `validate_branch_name` are reused from existing code. Shell injection is not possible — args are passed via `Command::new("git").args(...)`.

## Branch Scanning Fallback

When `specDocBranch` is absent (field not set or legacy data):

1. Get all local branches via `git branch --list`
2. For each branch, try `git_read_file_at_ref(repo, branch, path)`
3. Return first match with the branch name that contained it
4. Cache the result by setting `specDocBranch` on the item (avoids re-scanning)

## Schema Additions

### state.rs (Rust)

```rust
pub spec_doc_branch: Option<String>,
pub plan_doc_branch: Option<String>,
```

### db.json Zod schema (TypeScript)

Add to `DbRoadmapItemSchema`:
```typescript
specDocBranch: z.string().optional(),
specDocBranch__updatedAt: z.number().optional(),
planDocBranch: z.string().optional(),
planDocBranch__updatedAt: z.number().optional(),
```

### When fields are set

During the merge cycle, when `spec_doc` or `plan_doc` field changes on a roadmap item:
- Read current branch via `git rev-parse --abbrev-ref HEAD`
- Store as `spec_doc_branch` / `plan_doc_branch`
- If HEAD is detached, store the commit SHA instead

## Frontend Changes

### `useProjectModal.ts` — `fetchDocContent()`

Current flow:
1. `readFile(path)` → success → render content

New flow:
1. `readFile(path)` → success → render content (no change for happy path)
2. If `readFile` fails (file not on current branch):
   a. If `item.specDocBranch` is set: try `gitReadFileAtRef(repoPath, item.specDocBranch, path)`
   b. If that fails or `specDocBranch` is absent: scan all branches
   c. On success: set `sourceBranch` state, render content
   d. On failure: show "Document not found on any branch"

### `DocBadge.tsx`

Add optional `sourceBranch?: string` prop:
- When set, show "(branch: X)" indicator next to the badge
- Use a muted color to distinguish from the primary badge

### `RoadmapItemDetail.tsx`

When content is sourced from a non-current branch:
- Show banner: "Viewing from branch: X"
- Optionally show "Checkout this branch" action button

## Security

- Shell injection is not possible — arguments passed via `Command::new("git").args(...)`
- `validate_commit_path` rejects `..`, backslash, null bytes (prevents path traversal)
- `validate_branch_name` ensures safe branch name characters (prevents ref injection)
- Both validators already exist in the codebase and are battle-tested

## Tests

### Rust unit tests
- Valid ref returns file content
- Invalid ref returns `Err`
- Path traversal (`../secret`) is blocked by `validate_commit_path`
- Branch name with special chars blocked by `validate_branch_name`

### Frontend tests
- Mock `readFile` to fail, verify fallback to `gitReadFileAtRef` fires
- Mock `gitReadFileAtRef` to succeed, verify `sourceBranch` state is set
- Mock both to fail, verify "Document not found" message shown
- Verify DocBadge renders "(branch: X)" when `sourceBranch` is provided
