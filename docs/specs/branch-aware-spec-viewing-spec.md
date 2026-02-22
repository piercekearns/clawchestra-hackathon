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

Already exists (added during Phases 1-4, confirmed at state.rs:162-169):
```rust
pub spec_doc_branch: Option<String>,
pub plan_doc_branch: Option<String>,
```

### db.json Zod schema (TypeScript)

Already exists in `DbRoadmapItemSchema` (confirmed at db-json.ts:57-60):
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

## Document Types Covered

The `git show` mechanism applies to all git-tracked document types referenced by roadmap items:

| Document | Location | Affected call |
|----------|----------|---------------|
| Spec doc | `docs/specs/{item}-spec.md` | `fetchDocContent()` in useProjectModal.ts / RoadmapItemDialog.tsx |
| Plan doc | `docs/plans/{item}-plan.md` | `fetchDocContent()` in useProjectModal.ts / RoadmapItemDialog.tsx |
| Detail file | `roadmap/{item-id}.md` | Detail file reader (same fallback pattern) |
| CLAWCHESTRA.md | project root | Lower priority — could show "newer version on branch X" |

## Document Content Freshness (Phase 5.21 — extends this spec)

The `git show` fallback (above) solves "file doesn't exist here." A harder problem: the file exists locally but is *stale* — a newer version exists on another branch. `readFile()` succeeds, so the fallback never fires, and the user sees an outdated document.

### Solution — Git blob SHA comparison

Git stores a content hash (blob SHA) for every file on every branch. `git rev-parse branch:path` returns the blob SHA in ~10ms with zero file I/O:

```bash
git rev-parse main:docs/plans/auth-plan.md        # → ca141b77...
git rev-parse feature/auth:docs/plans/auth-plan.md # → 3f8a92e1...
# Different SHAs → content differs → local copy is stale
```

### New Rust command: `git_get_doc_freshness`

Three-tier approach (only does expensive work when needed):

1. **Tier 1:** Get local blob SHA for each file (~10ms each)
2. **Tier 2:** Get all branch names (~12ms total)
3. **Tier 3:** For each file × each branch, compare blob SHAs (~10ms each). Track the newest commit timestamp.

Returns `Vec<DocFreshnessEntry>` with: `localBlobSha`, `freshestBlobSha`, `freshestBranch`, `freshestCommitEpoch`, `isStale`.

### Freshness-aware fetch flow

Updated `fetchDocContent()`:
1. `readFile(path)` → success
2. `gitGetDocFreshness(repoPath, [relPath])` → check staleness
3. If `isStale === false` → render local content (done)
4. If `isStale === true` → `gitReadFileAtRef(repoPath, freshestBranch, relPath)` → render fresh content
5. Banner: "A newer version exists on branch: X"

### Continuous polling (Phase 6.8)

Background task polls every 30 seconds:
- Calls `git_get_doc_freshness` for all specDoc/planDoc paths in db.json
- Emits `doc-content-stale` Tauri event when staleness detected
- Frontend invalidates cached content and shows indicators

### Schema additions

`specDocBlobSha` and `planDocBlobSha` fields (+ `__updatedAt` siblings) in `DbRoadmapItem` — recorded during merge when `specDoc`/`planDoc` changes. Available to all sync participants via db.json.

## Cross-Device Document Access (extends this spec)

The `git show` fallback and blob SHA freshness mechanisms solve cross-branch access on the same machine. A harder problem: accessing documents from a device that doesn't have the git repo at all (e.g., mobile phone accessing via OpenClaw on a VPS).

### Solution — Content fields in db.json

`specDocContent` and `planDocContent` fields (+ `__updatedAt` siblings) in `DbRoadmapItem` store the full markdown content as a synced snapshot. When a document changes (detected during merge or freshness check), the content is captured into db.json. Any device with db.json access (via OpenClaw sync) can read the document — no git repo needed.

### fetchDocContent priority chain

1. Local file (`readFile(path)`) — fastest, for devices with the repo
2. db.json content field (`item.specDocContent`) — cross-device fallback
3. `gitReadFileAtRef` with branch hint — cross-branch on same machine
4. Branch scan — try all local branches
5. "Document not found on any branch / device"

### Continuous sync (Phase 6.6)

Content fields sync via the same continuous sync mechanism as all other db.json fields:
- 2-second debounced trigger after any mutation
- Delta sync — only changed fields transmit
- Offline queue with reconnect retry

### Write-back mechanism (simplified in Round 4 review)

When content changes arrive via sync on a device with the git repo:
- Auto-write to the git file if the local file hasn't been modified (non-conflict case)
- If both sides edited: last-writer-wins via HLC `__updatedAt` timestamps (same as all other fields)
- No conflict notification UI for v1 — deferred to Phase 8+ if real users report lost edits
- No auto-commit — user reviews and commits write-back changes when ready

### Progressive loading (backend only for v1)

OpenClaw extension supports `?fields=index` query parameter — strips content fields from the response. Frontend does NOT use progressive loading for v1 (always fetches full db.json). The param exists for future use or direct API consumers.

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
