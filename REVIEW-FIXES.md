# Pipeline Dashboard SPEC.md v4 — Review Fixes

*Generated 2026-02-11 after /plan_review with 3 parallel agents (DHH, Kieran TS, Code Simplicity)*
*Apply all fixes to SPEC.md, then delete this file.*

---

## How To Use This Document

After compacting, read this file and SPEC.md. Apply each fix to the spec's code samples and descriptions. Check off each item as completed. When all fixes are applied, update the spec version to v5 and delete this file.

---

## Fix 1: `list_files_recursive` Rust function — not defined
**Priority:** Build blocker (won't compile)
**Location:** SPEC.md Rust Commands section (~line 940-946)
**Issue:** `list_files` calls `list_files_recursive(&dir, &mut files)` but the function is never defined.
**Fix:** Add the implementation:

```rust
fn list_files_recursive(dir: &str, files: &mut Vec<String>) -> Result<(), String> {
    let entries = std::fs::read_dir(dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_dir() {
            list_files_recursive(&path.to_string_lossy(), files)?;
        } else if path.extension().map_or(false, |ext| ext == "md") {
            let name = path.file_name().unwrap().to_string_lossy();
            // Skip non-project reference files
            if !["PIPELINE.md", "SPEC.md", "OVERVIEW.md", "SCHEMA.md", "USAGE.md", "README.md", "REVIEW-FIXES.md"]
                .contains(&name.as_ref())
            {
                files.push(path.to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}
```

- [x] Applied

---

## Fix 2: Tauri `main.rs` and plugin registration — not shown
**Priority:** Build blocker (won't compile)
**Location:** SPEC.md Rust Commands section + Project Structure
**Issue:** No code showing how commands are registered with Tauri or how `@tauri-apps/plugin-fs` is configured. Missing `main.rs`, `Cargo.toml` dependency, and `tauri.conf.json` permissions.
**Fix:** Add `main.rs` code sample after the Rust commands section:

```rust
// src-tauri/src/main.rs
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            get_projects_dir,
            read_file,
            write_file,
            list_files,
            delete_file,
            resolve_path,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

Add a note about Cargo.toml requiring `tauri-plugin-fs` and `tauri.conf.json` needing fs plugin permissions.

- [x] Applied

---

## Fix 3: Frontmatter mutation during merge — data corruption risk
**Priority:** Bug (3/3 reviewers flagged)
**Location:** SPEC.md `getProjects()` in lib/projects.ts (~lines 1037-1042)
**Issue:** The merge logic mutates `frontmatter` (which is `result.data` from `validateProject`) in-place with repo values. Then `project.frontmatter` contains a hybrid of dashboard + repo data. If any code path serializes `project.frontmatter` back to the dashboard file, repo-owned values leak into the dashboard entry.
**Fix:** Keep `frontmatter` immutable. Create a separate merged view for BoardItem fields:

```typescript
const dashboardFrontmatter = result.data;  // NEVER mutated

// Merge for display only — doesn't touch dashboardFrontmatter
const mergedTitle = repoStatus?.title ?? dashboardFrontmatter.title;
const mergedStatus = repoStatus?.status ?? dashboardFrontmatter.status;
const mergedNextAction = repoStatus?.nextAction !== undefined ? repoStatus.nextAction : dashboardFrontmatter.nextAction;
const mergedBlockedBy = repoStatus?.blockedBy !== undefined ? (repoStatus.blockedBy ?? undefined) : dashboardFrontmatter.blockedBy;
const mergedLastActivity = repoStatus?.lastActivity ?? dashboardFrontmatter.lastActivity;

projects.push({
  id,
  filePath,
  frontmatter: dashboardFrontmatter,  // always reflects dashboard file only
  content: repoContent,
  repoStatus,
  repoFilePath,
  children: [],
  isStale: isStale(mergedLastActivity),
  needsReview: needsReview(dashboardFrontmatter.lastReviewed),
  hasRepo: !!dashboardFrontmatter.localPath && !!repoStatus,

  // BoardItem fields use MERGED values for display
  title: mergedTitle,
  status: mergedStatus,
  priority: dashboardFrontmatter.priority,
  icon: dashboardFrontmatter.icon,
  nextAction: mergedNextAction,
  blockedBy: mergedBlockedBy,
  tags: dashboardFrontmatter.tags,
});
```

- [x] Applied

---

## Fix 4: `RepoStatus` unvalidated — unsafe `as` cast
**Priority:** Bug (3/3 reviewers flagged)
**Location:** SPEC.md `readRepoStatus()` in lib/projects.ts (~line 992)
**Issue:** `data as RepoStatus` with zero validation. An agent typo like `status: "yolo"` flows through silently; the card renders in a non-existent column.
**Fix:** Add a lightweight `validateRepoStatus` to lib/schema.ts:

```typescript
export function validateRepoStatus(data: unknown): RepoStatus | null {
  if (typeof data !== 'object' || data === null) return null;
  const record = data as Record<string, unknown>;
  const result: RepoStatus = {};

  if (typeof record.title === 'string') result.title = record.title;
  if (typeof record.status === 'string') {
    if (!VALID_STATUSES.includes(record.status)) return null; // invalid status = reject entirely
    result.status = record.status as ProjectStatus;
  }
  if (typeof record.nextAction === 'string') result.nextAction = record.nextAction;
  if (record.blockedBy === null || typeof record.blockedBy === 'string') {
    result.blockedBy = record.blockedBy ?? undefined;
  }
  if (typeof record.lastActivity === 'string') result.lastActivity = record.lastActivity;

  return result;
}
```

Then in `readRepoStatus()`, replace `data as RepoStatus` with:

```typescript
const validated = validateRepoStatus(data);
if (!validated) return null;
return { status: validated, content, resolvedPath: filePath };
```

- [x] Applied

---

## Fix 5: `ProjectUpdate` with `NonNullable` prevents clearing optional fields
**Priority:** Bug (3/3 reviewers flagged)
**Location:** SPEC.md lib/projects.ts (~lines 1089-1091)
**Issue:** Can't set `blockedBy` to `null`/`undefined` to unblock a project. Can't clear `nextAction`.
**Fix:** Allow `null` as a sentinel for "clear this field":

```typescript
type ProjectUpdate = {
  [K in keyof ProjectFrontmatter]?: ProjectFrontmatter[K] | null;
};
```

Then in `updateProject`, handle the three cases:

```typescript
for (const [key, value] of Object.entries(updates)) {
  if (value === undefined) continue;       // skip untouched fields
  if (value === null) {
    delete newData[key];                    // clear the field
  } else {
    newData[key] = value;                   // set the field
  }
}
```

Replace the current `cleanUpdates` logic with this pattern in both the repo-updates and dashboard-updates branches.

- [x] Applied

---

## Fix 6: Falsy checks in merge logic drop empty strings
**Priority:** Bug (2/3 reviewers flagged)
**Location:** SPEC.md `getProjects()` merge logic (~lines 1038-1042)
**Issue:** `if (repoStatus.nextAction)` — if repo sets `nextAction: ""`, the falsy check skips it. Same for `title`. The `blockedBy` check uses `!== undefined` correctly but the others don't.
**Fix:** Use `!== undefined` consistently for all repo-owned field checks. (This is already addressed by Fix 3's rewrite, which uses `?? ` and `!== undefined` patterns.)

- [x] Applied (addressed by Fix 3's rewrite)

---

## Fix 7: File watcher has no debounce
**Priority:** Performance / UX (3/3 reviewers flagged)
**Location:** SPEC.md lib/watcher.ts (~lines 1254-1268)
**Issue:** Every file save fires multiple FS events. Drag-reorder of 8 items fires 8 events. Each triggers a full `getProjects()` reload. Without debounce, DnD causes visible UI thrashing.
**Fix:** Add debounce:

```typescript
export async function watchProjects(
  projectsDir: string,
  onChanged: () => void
): Promise<() => void> {
  let timeout: ReturnType<typeof setTimeout>;
  const unwatch = await watch(projectsDir, () => {
    clearTimeout(timeout);
    timeout = setTimeout(onChanged, 150);
  }, { recursive: true });

  return unwatch;
}
```

- [x] Applied

---

## Fix 8: `reorderProjects` is sequential I/O + has dead parameter
**Priority:** Performance (3/3 reviewers flagged)
**Location:** SPEC.md lib/projects.ts (~lines 1237-1249)
**Issue:** Each priority update does sequential `readFile` + `writeFile`. Dragging in a column with 8 items = 16+ sequential IPC calls. Also `columnStatus` parameter is accepted but never used.
**Fix:** Use `Promise.all` for independent writes and remove or use `columnStatus`:

```typescript
export async function reorderProjects(
  orderedIds: string[],
  allProjects: ProjectViewModel[]
): Promise<void> {
  const updates = orderedIds
    .map((id, i) => {
      const project = allProjects.find(p => p.id === id);
      if (project && project.frontmatter.priority !== i + 1) {
        return updateProject(project, { priority: i + 1 });
      }
      return null;
    })
    .filter(Boolean);

  await Promise.all(updates);
}
```

- [x] Applied

---

## Fix 9: `getProjects` reads all files sequentially
**Priority:** Performance (1/3 but valid)
**Location:** SPEC.md lib/projects.ts `getProjects()` (~lines 1007-1074)
**Issue:** 21 projects with some having `localPath` = 30-40+ sequential IPC round-trips on every reload.
**Fix:** Batch the initial file reads with `Promise.all`:

```typescript
const filePaths = await listFiles(projectsDir);
const rawFiles = await Promise.all(filePaths.map(fp => readFile(fp)));

for (let i = 0; i < filePaths.length; i++) {
  const filePath = filePaths[i];
  const raw = rawFiles[i];
  // ... rest of parsing logic
}
```

Note: repo status reads within the loop can also be collected and awaited in parallel, but the sequential approach is acceptable for MVP since repo reads are a smaller set.

- [x] Applied

---

## Fix 10: `REPO_OWNED_FIELDS` is `Set<string>` — typos compile fine
**Priority:** Type safety (1/3)
**Location:** SPEC.md lib/projects.ts (~lines 1094-1096)
**Issue:** `new Set(['nexAction'])` (missing 't') would compile without error.
**Fix:**

```typescript
const REPO_OWNED_FIELDS: ReadonlySet<keyof ProjectFrontmatter> = new Set([
  'title', 'status', 'nextAction', 'blockedBy', 'lastActivity'
] as const);
```

- [x] Applied

---

## Fix 11: `VALID_STATUSES` arrays can drift from union types
**Priority:** Type safety (1/3)
**Location:** SPEC.md lib/schema.ts (~lines 416-424)
**Issue:** Arrays are `readonly string[]` — adding a value to the union but forgetting the array produces no compiler error.
**Fix:**

```typescript
const VALID_STATUSES = [
  "in-flight", "up-next", "simmering", "dormant", "shipped"
] as const satisfies readonly ProjectStatus[];

const VALID_TYPES = [
  "project", "sub-project", "idea"
] as const satisfies readonly ProjectType[];

const VALID_COLORS = [
  "blue", "green", "yellow", "red", "purple", "gray"
] as const satisfies readonly ProjectColor[];
```

- [x] Applied

---

## Fix 12: `ViewContext` should be discriminated union
**Priority:** Type safety (1/3)
**Location:** SPEC.md lib/views.ts (~lines 1343-1352)
**Issue:** When `type === 'roadmap'`, `projectId` is semantically required but typed as optional. Every consumer must null-check even after narrowing.
**Fix:**

```typescript
export type ViewContext =
  | {
      breadcrumbs: Array<{ id: string; label: string }>;
      columns: ColumnDefinition[];
      type: 'projects';
    }
  | {
      breadcrumbs: Array<{ id: string; label: string }>;
      columns: ColumnDefinition[];
      type: 'roadmap';
      projectId: string;
    };
```

- [x] Applied

---

## Fix 13: `typedInvoke` accepts `args?` as optional for all commands
**Priority:** Type safety (1/3)
**Location:** SPEC.md lib/tauri.ts (~lines 881-886)
**Issue:** Can call `typedInvoke('read_file')` with no arguments and TypeScript won't complain.
**Fix:** Use conditional rest parameter:

```typescript
async function typedInvoke<T extends keyof TauriCommands>(
  cmd: T,
  ...args: TauriCommands[T]['args'] extends Record<string, never>
    ? []
    : [args: TauriCommands[T]['args']]
): Promise<TauriCommands[T]['return']> {
  return invoke<TauriCommands[T]['return']>(cmd, args[0]);
}
```

- [x] Applied

---

## Fix 14: `validateProject` — non-string `color` silently passes validation
**Priority:** Type safety (1/3)
**Location:** SPEC.md lib/schema.ts (~lines 470-473)
**Issue:** If `color: 42`, the `typeof === 'string'` check skips it and the cast produces a `ProjectFrontmatter` where `color` is `42` at runtime.
**Fix:** Reject non-string values explicitly:

```typescript
if (record.color !== undefined) {
  if (typeof record.color !== 'string' || !VALID_COLORS.includes(record.color)) {
    errors.push(`invalid color: ${String(record.color)}`);
  }
}

if (record.icon !== undefined && typeof record.icon !== 'string') {
  errors.push('icon must be a string');
}

if (record.tags !== undefined) {
  if (!Array.isArray(record.tags) || !record.tags.every(t => typeof t === 'string')) {
    errors.push('tags must be an array of strings');
  }
}

if (record.priority !== undefined && (typeof record.priority !== 'number' || !Number.isFinite(record.priority))) {
  errors.push('priority must be a finite number');
}
```

- [x] Applied

---

## Fix 15: `RoadmapItem` re-declares all `BoardItem` fields unnecessarily
**Priority:** Type cleanup (1/3)
**Location:** SPEC.md lib/schema.ts (~lines 396-404)
**Issue:** Every field listed is already on `BoardItem`. The interface adds nothing.
**Fix:** Remove redundant field declarations and narrow `status`:

```typescript
export type RoadmapStatus = 'pending' | 'in-progress' | 'complete';

export interface RoadmapItem extends BoardItem {
  status: RoadmapStatus;
}
```

- [x] Applied

---

## Fix 16: `sendMessage` sends no conversation history
**Priority:** Functionality (1/3 but very valid)
**Location:** SPEC.md lib/gateway.ts (~lines 800-825)
**Issue:** Every call sends a single-element `messages` array. OpenClaw has zero context about prior conversation.
**Fix:** Accept full message history:

```typescript
interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export async function sendMessage(messages: ChatMessage[]): Promise<string> {
  const response = await fetch(`${GATEWAY_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
  // ... rest unchanged
}
```

Update `sendMessageWithContext` accordingly to prepend context as a system message and pass the full history.

Also update the Zustand store description to include `chatMessages: ChatMessage[]` in the state.

- [x] Applied

---

## Fix 17: Invalid files should show error card, not disappear
**Priority:** UX (1/3)
**Location:** SPEC.md `getProjects()` and Error Handling section
**Issue:** When a previously-loaded file becomes invalid (e.g., OpenClaw writes bad YAML), the card silently disappears. Should show card in error state.
**Fix:** Add to the UI Error Responses table:

```
| Previously valid file becomes invalid | Show card in error state (red border, "Parse error" label) rather than removing it. Include file path so user can fix manually. |
```

In `getProjects()`, instead of just `continue` on validation failure, add the error to the store and optionally create a minimal error-state card.

- [x] Applied

---

## Fix 18: `updateProject` doesn't validate repo updates
**Priority:** Data integrity (1/3)
**Location:** SPEC.md lib/projects.ts repo-updates write path (~lines 1115-1123)
**Issue:** When writing repo-owned fields to PROJECT.md, there's no validation. A caller could pass `{ status: 'banana' as ProjectStatus }` and it writes without complaint.
**Fix:** Validate individual field values before writing to repo file. At minimum validate `status` against `VALID_STATUSES`:

```typescript
if (Object.keys(repoUpdates).length > 0 && project.repoFilePath) {
  // Validate status if being updated
  if (repoUpdates.status && !VALID_STATUSES.includes(repoUpdates.status as string)) {
    throw new Error(`Invalid status: ${repoUpdates.status}`);
  }
  const raw = await readFile(project.repoFilePath);
  // ... rest unchanged
}
```

- [x] Applied

---

## Fix 19: OVERVIEW.md still says "Next.js"
**Priority:** Documentation (2/3 — old unfixed from v3 review)
**Location:** `<legacy-project-root>/OVERVIEW.md`
**Issue:** Says "A Tauri-wrapped Next.js app" but spec uses Vite + React. Stale phase descriptions too.
**Fix:** Update OVERVIEW.md to say "Tauri + Vite + React app" and align phase descriptions with SPEC.md.

- [x] Applied

---

## Fix 20: Phase 6 function implementations in Phase 1 checklist
**Priority:** Scope clarity (1/3)
**Location:** SPEC.md Build Phases, Phase 1 checklist (~line 1525)
**Issue:** Phase 1 checklist includes `projectRoadmapView()` and `ROADMAP_COLUMNS` which are Phase 6 functionality. Builder will write dead branching logic in Phase 1.
**Fix:** Change Phase 1 checklist item from:
```
- [ ] Frontend: `lib/views.ts` — `ViewContext`, `defaultView()`, column definitions, breadcrumb state (Phase 6 ready)
```
To:
```
- [ ] Frontend: `lib/views.ts` — `ViewContext` type, `defaultView()`, `PROJECT_COLUMNS`
```

Move `projectRoadmapView()` and `ROADMAP_COLUMNS` to Phase 6 checklist. Keep the type definitions (ViewContext discriminated union, RoadmapItem, RoadmapStatus) in Phase 1 since they're just types.

- [x] Applied

---

## Summary

| Category | Count | Items |
|----------|-------|-------|
| Build blockers | 2 | #1, #2 |
| Data integrity bugs | 4 | #3, #4, #5, #6 |
| Performance | 3 | #7, #8, #9 |
| Type safety | 5 | #10, #11, #12, #13, #14 |
| Type cleanup | 1 | #15 |
| Functionality | 1 | #16 |
| UX | 1 | #17 |
| Data validation | 1 | #18 |
| Documentation | 1 | #19 |
| Scope clarity | 1 | #20 |
| **Total** | **20** | |

---

*After all fixes are applied, update SPEC.md header to v5, delete this file, and proceed to build.*
