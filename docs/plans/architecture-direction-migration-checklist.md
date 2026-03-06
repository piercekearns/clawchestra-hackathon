# Deployment Checklist: Phase 4 Migration -- ROADMAP.md & CHANGELOG.md to Database

> Go/No-Go checklist for the destructive data migration that imports YAML frontmatter
> from ROADMAP.md and CHANGELOG.md into the Clawchestra SQLite database, creates
> `.clawchestra/state.json` projections, modifies `.gitignore` files, and deletes source
> files from disk. Per-project transactional state machine with 7 states.

**Date:** 2026-02-21
**Risk Level:** HIGH -- source files are deleted after import; partially irreversible
**Scope:** Every tracked project with a ROADMAP.md or CHANGELOG.md
**Special Case:** Revival Fightwear files are preserved (backup exception per spec decision #38)

---

## Table of Contents

1. [Data Invariants](#1-data-invariants)
2. [Pre-Migration Verification](#2-pre-migration-verification)
3. [Migration Steps and State Machine](#3-migration-steps-and-state-machine)
4. [Post-Migration Verification](#4-post-migration-verification)
5. [Rollback Procedure](#5-rollback-procedure)
6. [Data Integrity Verification](#6-data-integrity-verification)
7. [Manual Testing Checklist](#7-manual-testing-checklist)
8. [Monitoring and Ongoing Verification](#8-monitoring-and-ongoing-verification)

---

## 1. Data Invariants

These conditions MUST remain true before, during, and after migration. Any violation is a STOP signal.

### Hard Invariants (violation = abort migration for that project)

- [ ] **I-1:** Every roadmap item in ROADMAP.md YAML `items:` array with a valid status MUST appear in the database after import. Zero silent drops.
- [ ] **I-2:** Every changelog entry in CHANGELOG.md YAML `entries:` array with a valid `id`, `title`, and `completedAt` MUST appear in the database after import.
- [ ] **I-3:** Item `id` values are preserved exactly (case-sensitive, kebab-case). No ID transformation.
- [ ] **I-4:** Item `status` values are preserved or intentionally sanitized (e.g., `shipped` -> `complete`). Every sanitization is logged.
- [ ] **I-5:** `completedAt` date strings are preserved exactly as-is from the source YAML (no timezone conversion, no reformatting).
- [ ] **I-6:** `specDoc` and `planDoc` relative paths are preserved exactly. The referenced files themselves are NOT touched.
- [ ] **I-7:** `priority` ordering within each status column is preserved from the YAML array order.
- [ ] **I-8:** Source files (ROADMAP.md, CHANGELOG.md) are NOT deleted until the database import is verified AND state.json is written AND .gitignore is updated.
- [ ] **I-9:** Revival Fightwear project files are NEVER deleted regardless of migration state.
- [ ] **I-10:** `.gitignore` modifications only APPEND `.clawchestra/` -- never overwrite or remove existing entries.
- [ ] **I-11:** The `roadmap/` directory and all `roadmap/{item-id}.md` detail files are NOT touched by migration.
- [ ] **I-12:** `docs/specs/` and `docs/plans/` directories and their files are NOT touched by migration.

### Soft Invariants (violation = log warning, continue)

- [ ] **I-13:** Items with invalid/unrecoverable status values are imported as `status: pending` with an `_importWarning` flag.
- [ ] **I-14:** Items missing an `id` field receive a generated ID (`roadmap-{index+1}`) -- logged as warning.
- [ ] **I-15:** CHANGELOG.md entries missing `summary` field are imported with `summary: undefined` -- not rejected.

---

## 2. Pre-Migration Verification

### 2.1 Source File Inventory (Run BEFORE first app launch with migration code)

For each tracked project, capture baseline data. Save these results to a file for post-migration comparison.

**Script: Capture Baseline Counts**

```bash
#!/bin/bash
# Run from each project root. Outputs baseline to stdout.
# Save output: ./capture-baseline.sh > /tmp/migration-baseline-$(basename $PWD).txt

echo "=== PROJECT: $(basename $PWD) ==="
echo "=== TIMESTAMP: $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="

# 1. Check ROADMAP.md exists and count items
if [ -f ROADMAP.md ]; then
  echo "ROADMAP.md: EXISTS"
  # Count items by counting '- id:' lines in YAML frontmatter
  ITEM_COUNT=$(sed -n '/^---$/,/^---$/p' ROADMAP.md | grep -c '^\s*- id:')
  echo "ROADMAP_ITEM_COUNT: $ITEM_COUNT"

  # List all item IDs
  echo "ROADMAP_ITEM_IDS:"
  sed -n '/^---$/,/^---$/p' ROADMAP.md | grep '^\s*- id:' | sed 's/.*- id:\s*/  /'

  # Count by status
  echo "ROADMAP_STATUS_COUNTS:"
  sed -n '/^---$/,/^---$/p' ROADMAP.md | grep '^\s*status:' | sort | uniq -c | sed 's/^/  /'

  # Capture file hash for exact comparison
  echo "ROADMAP_SHA256: $(shasum -a 256 ROADMAP.md | awk '{print $1}')"
else
  echo "ROADMAP.md: MISSING"
fi

# 2. Check CHANGELOG.md exists and count entries
if [ -f CHANGELOG.md ]; then
  echo "CHANGELOG.md: EXISTS"
  ENTRY_COUNT=$(sed -n '/^---$/,/^---$/p' CHANGELOG.md | grep -c '^\s*- id:')
  echo "CHANGELOG_ENTRY_COUNT: $ENTRY_COUNT"

  echo "CHANGELOG_ENTRY_IDS:"
  sed -n '/^---$/,/^---$/p' CHANGELOG.md | grep '^\s*- id:' | sed 's/.*- id:\s*/  /'

  echo "CHANGELOG_SHA256: $(shasum -a 256 CHANGELOG.md | awk '{print $1}')"
else
  echo "CHANGELOG.md: MISSING (acceptable -- not all projects have one)"
fi

# 3. Check .gitignore state
if [ -f .gitignore ]; then
  echo "GITIGNORE: EXISTS"
  echo "GITIGNORE_HAS_CLAWCHESTRA: $(grep -c '.clawchestra' .gitignore || echo 0)"
  echo "GITIGNORE_SHA256: $(shasum -a 256 .gitignore | awk '{print $1}')"
else
  echo "GITIGNORE: MISSING"
fi

# 4. Check .clawchestra/ directory state
if [ -d .clawchestra ]; then
  echo "CLAWCHESTRA_DIR: EXISTS (unexpected pre-migration)"
  ls -la .clawchestra/
else
  echo "CLAWCHESTRA_DIR: DOES_NOT_EXIST (expected)"
fi

# 5. Check roadmap/ detail files (should be untouched)
if [ -d roadmap ]; then
  echo "ROADMAP_DETAIL_FILES:"
  ls roadmap/*.md 2>/dev/null | sed 's/^/  /'
  echo "ROADMAP_DETAIL_COUNT: $(ls roadmap/*.md 2>/dev/null | wc -l | tr -d ' ')"
fi

# 6. Check docs/ files (should be untouched)
echo "SPEC_FILES: $(ls docs/specs/*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "PLAN_FILES: $(ls docs/plans/*.md 2>/dev/null | wc -l | tr -d ' ')"

# 7. Git state
if [ -d .git ]; then
  echo "GIT_BRANCH: $(git branch --show-current)"
  echo "GIT_CLEAN: $(git status --porcelain | wc -l | tr -d ' ') dirty files"
  echo "GIT_LAST_COMMIT: $(git log -1 --format='%h %s')"
fi
```

**Expected Results for Clawchestra project itself (based on current ROADMAP.md):**

| Metric | Expected Value |
|--------|---------------|
| ROADMAP_ITEM_COUNT | 19 |
| Items with status `in-progress` | 2 (git-branch-sync, chat-infrastructure) |
| Items with status `up-next` | 3 (architecture-direction, first-friend-readiness, clawchestra-ai-website) |
| Items with status `pending` | 5 (ai-commit-messages, rate-limit-resilience, app-customisation, roadmap-item-quick-add, clawchestra-apps) |
| Items with status `complete` | 9 (deep-rename-clawchestra through git-sync-scope) |
| CHANGELOG.md format | Markdown-only (no YAML frontmatter entries array) |
| .clawchestra/ directory | Does not exist |

### 2.2 Pre-Migration Code Verification

Before deploying the build with migration code:

- [ ] **C-1:** `npx tsc --noEmit` passes clean
- [ ] **C-2:** `cargo check` passes clean
- [ ] **C-3:** `bun test` all existing tests pass
- [ ] **C-4:** `pnpm build` succeeds
- [ ] **C-5:** `npx tauri build --no-bundle` succeeds
- [ ] **C-6:** Migration tests exist and pass:
  - Test: Import ROADMAP.md with all valid items -> all items in DB
  - Test: Import ROADMAP.md with one invalid status -> 1 item imported as `pending` with warning, rest imported normally
  - Test: Import CHANGELOG.md with valid entries -> all entries in DB with correct `completedAt`
  - Test: Import empty CHANGELOG.md -> no crash, zero entries imported
  - Test: Import ROADMAP.md with missing CHANGELOG.md -> succeeds (CHANGELOG is optional)
  - Test: Revival Fightwear ID detection -> files NOT deleted
  - Test: State machine persistence -> crash at any state -> resumes from that state
  - Test: `.gitignore` append -> existing entries preserved, `.clawchestra/` added
  - Test: `.gitignore` creation -> new file created with `.clawchestra/` if no .gitignore exists

### 2.3 Pre-Migration Git Safety

For each tracked project:

- [ ] **G-1:** Working tree is clean (`git status --porcelain` returns empty). If dirty, stash or commit first.
- [ ] **G-2:** All changes are committed and pushed (no risk of losing uncommitted work during the migration commits).
- [ ] **G-3:** Git HEAD is on a named branch (not detached HEAD).
- [ ] **G-4:** No rebase, merge, or cherry-pick in progress.

### 2.4 Backup Creation

- [ ] **B-1:** For each tracked project, create a backup of ROADMAP.md:
  ```bash
  cp ROADMAP.md /tmp/migration-backup-$(basename $PWD)-ROADMAP.md
  ```
- [ ] **B-2:** For each tracked project with CHANGELOG.md, create a backup:
  ```bash
  cp CHANGELOG.md /tmp/migration-backup-$(basename $PWD)-CHANGELOG.md
  ```
- [ ] **B-3:** Capture the current git commit hash for each project:
  ```bash
  git rev-parse HEAD > /tmp/migration-backup-$(basename $PWD)-HEAD.txt
  ```
- [ ] **B-4:** Verify backups are readable:
  ```bash
  head -5 /tmp/migration-backup-*-ROADMAP.md
  ```

---

## 3. Migration Steps and State Machine

### Per-Project State Machine

Each project progresses through these states independently. Failure at any state leaves the project at that state for retry. No cross-project atomicity.

```
NotStarted -> Importing -> Imported -> StateJsonCreated -> GitignoreUpdated -> SourceDeleted -> Complete
```

### Step-by-Step with Verification Points

| Step | State Transition | Operation | Estimated Runtime | Rollback |
|------|-----------------|-----------|-------------------|----------|
| 1 | NotStarted -> Importing | Set migration state; read ROADMAP.md YAML frontmatter + CHANGELOG.md YAML frontmatter | < 1 sec per project | Set state back to NotStarted |
| 2 | Importing -> Imported | Parse items via `sanitizeRoadmapItem()` and `sanitizeChangelogEntry()`; write all valid items to DB | < 1 sec per project | Delete imported rows from DB; set state to NotStarted |
| 3 | Imported -> StateJsonCreated | Write `.clawchestra/state.json` projection from DB data | < 1 sec per project | Delete `.clawchestra/` directory; set state to Imported |
| 4 | StateJsonCreated -> GitignoreUpdated | Append `.clawchestra/` to `.gitignore`; git commit | < 5 sec per project | `git revert HEAD`; set state to StateJsonCreated |
| 5 | GitignoreUpdated -> SourceDeleted | Delete ROADMAP.md and CHANGELOG.md from disk; git commit | < 5 sec per project | Restore from backup or `git revert HEAD`; set state to GitignoreUpdated |
| 6 | SourceDeleted -> Complete | Verify state.json matches DB; mark migration complete | < 1 sec per project | Set state to SourceDeleted (retry verification) |

### Critical Decision Points

**At Step 2 (Import):**
- If ROADMAP.md has zero parseable items: STOP. Log error. Do not proceed. This likely means the YAML parser failed entirely.
- If any item has `status: shipped`: auto-convert to `complete` (per existing `sanitizeRoadmapItem` logic at `<repo-root>/src/lib/roadmap.ts` line 20).
- If CHANGELOG.md exists but has no YAML frontmatter (like the current Clawchestra CHANGELOG.md which is markdown-only): Treat as zero entries. Do not fail.

**At Step 4 (Gitignore):**
- If `.gitignore` does not exist: CREATE it with `.clawchestra/\n` as sole content.
- If `.gitignore` exists and already contains `.clawchestra`: SKIP the append. Still create the git commit with an empty change (or skip commit).

**At Step 5 (Source Deletion):**
- If project ID is `revival-fightwear`: SKIP deletion entirely. Transition directly to Complete.
- The git commit message must be: `chore: migrate orchestration data to Clawchestra database`

---

## 4. Post-Migration Verification

### 4.1 Immediate Verification (Within 30 Seconds of Each Project Completing)

For each project that reaches `Complete` state:

**Database Item Count Verification:**

```typescript
// Pseudocode -- run in Clawchestra console or as automated test
const dbItems = await db.getRoadmapItems(projectId);
const dbCompletedItems = await db.getCompletedItems(projectId);
const totalDbItems = dbItems.length + dbCompletedItems.length;

// Compare against baseline
assert(totalDbItems === BASELINE_ROADMAP_ITEM_COUNT + BASELINE_CHANGELOG_ENTRY_COUNT,
  `Item count mismatch: DB has ${totalDbItems}, baseline was ${BASELINE_ROADMAP_ITEM_COUNT + BASELINE_CHANGELOG_ENTRY_COUNT}`
);
```

**Item-by-Item Field Verification:**

```typescript
// For each item from the ROADMAP.md baseline:
for (const expectedItem of baselineItems) {
  const dbItem = await db.getRoadmapItem(projectId, expectedItem.id);

  assert(dbItem !== null, `Missing item: ${expectedItem.id}`);
  assert(dbItem.title === expectedItem.title, `Title mismatch for ${expectedItem.id}`);
  assert(dbItem.status === expectedItem.status, `Status mismatch for ${expectedItem.id}`);

  // Priority: verify ordering is preserved within each status group
  if (expectedItem.priority !== undefined) {
    assert(dbItem.priority === expectedItem.priority,
      `Priority mismatch for ${expectedItem.id}: got ${dbItem.priority}, expected ${expectedItem.priority}`
    );
  }

  // Optional fields preserved when present
  if (expectedItem.specDoc) {
    assert(dbItem.specDoc === expectedItem.specDoc,
      `specDoc mismatch for ${expectedItem.id}`
    );
  }
  if (expectedItem.planDoc) {
    assert(dbItem.planDoc === expectedItem.planDoc,
      `planDoc mismatch for ${expectedItem.id}`
    );
  }
  if (expectedItem.nextAction) {
    assert(dbItem.nextAction === expectedItem.nextAction,
      `nextAction mismatch for ${expectedItem.id}`
    );
  }
  if (expectedItem.tags) {
    assert(JSON.stringify(dbItem.tags) === JSON.stringify(expectedItem.tags),
      `tags mismatch for ${expectedItem.id}`
    );
  }
}
```

### 4.2 state.json Verification

```typescript
// Read the generated state.json
const stateJson = JSON.parse(
  await readFile(`${projectPath}/.clawchestra/state.json`)
);

// Schema version present
assert(stateJson._schemaVersion === 1);
assert(typeof stateJson._generatedAt === 'number');
assert(stateJson._generatedBy === 'clawchestra');

// Project metadata present
assert(stateJson.project.id === projectId);
assert(typeof stateJson.project.title === 'string');
assert(['in-progress', 'up-next', 'pending', 'dormant', 'archived']
  .includes(stateJson.project.status));

// Roadmap items match DB
assert(stateJson.roadmapItems.length === dbItems.length);

for (const item of stateJson.roadmapItems) {
  assert(typeof item.id === 'string' && item.id.length > 0);
  assert(typeof item.title === 'string' && item.title.length > 0);
  assert(['pending', 'up-next', 'in-progress', 'complete'].includes(item.status));

  if (item.status === 'complete') {
    assert(typeof item.completedAt === 'string',
      `Complete item ${item.id} missing completedAt`
    );
  }
}
```

### 4.3 Filesystem Verification

```bash
#!/bin/bash
# Run from each project root after migration

echo "=== POST-MIGRATION: $(basename $PWD) ==="

# 1. Source files deleted (except Revival Fightwear)
if [ "$(basename $PWD)" = "revival-fightwear" ]; then
  echo "REVIVAL_FIGHTWEAR_EXCEPTION:"
  echo "  ROADMAP.md: $([ -f ROADMAP.md ] && echo 'EXISTS (correct)' || echo 'MISSING (ERROR!)')"
  echo "  CHANGELOG.md: $([ -f CHANGELOG.md ] && echo 'EXISTS (correct)' || echo 'MISSING (acceptable)')"
else
  echo "ROADMAP.md: $([ -f ROADMAP.md ] && echo 'EXISTS (ERROR -- should be deleted!)' || echo 'DELETED (correct)')"
  echo "CHANGELOG.md: $([ -f CHANGELOG.md ] && echo 'EXISTS (ERROR -- should be deleted!)' || echo 'DELETED (correct)')"
fi

# 2. state.json exists and is valid JSON
if [ -f .clawchestra/state.json ]; then
  echo "STATE_JSON: EXISTS"
  # Validate JSON
  if python3 -c "import json; json.load(open('.clawchestra/state.json'))" 2>/dev/null; then
    echo "STATE_JSON_VALID: YES"
    # Check schema version
    echo "STATE_JSON_SCHEMA_VERSION: $(python3 -c "import json; d=json.load(open('.clawchestra/state.json')); print(d.get('_schemaVersion', 'MISSING'))")"
    echo "STATE_JSON_ITEM_COUNT: $(python3 -c "import json; d=json.load(open('.clawchestra/state.json')); print(len(d.get('roadmapItems', [])))")"
  else
    echo "STATE_JSON_VALID: NO (ERROR!)"
  fi
else
  echo "STATE_JSON: MISSING (ERROR!)"
fi

# 3. .gitignore updated
if [ -f .gitignore ]; then
  if grep -q '.clawchestra' .gitignore; then
    echo "GITIGNORE_UPDATED: YES"
  else
    echo "GITIGNORE_UPDATED: NO (ERROR!)"
  fi
else
  echo "GITIGNORE: MISSING (ERROR if project has git)"
fi

# 4. roadmap/ detail files untouched
if [ -d roadmap ]; then
  POST_COUNT=$(ls roadmap/*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "ROADMAP_DETAIL_COUNT: $POST_COUNT"
  echo "  (compare with pre-migration baseline -- must be identical)"
fi

# 5. docs/ files untouched
echo "SPEC_FILES: $(ls docs/specs/*.md 2>/dev/null | wc -l | tr -d ' ')"
echo "PLAN_FILES: $(ls docs/plans/*.md 2>/dev/null | wc -l | tr -d ' ')"

# 6. Git commits created
echo "RECENT_COMMITS:"
git log --oneline -5 | sed 's/^/  /'
echo "  (expect: 'chore: migrate orchestration data...' and 'chore: add .clawchestra to gitignore')"

# 7. Git state clean after migration
echo "GIT_DIRTY_FILES: $(git status --porcelain | wc -l | tr -d ' ')"
```

### 4.4 Clawchestra-Specific Verification for ROADMAP.md of This Repo

The Clawchestra project's own ROADMAP.md (at `<repo-root>/ROADMAP.md`) has 19 items. After migration, verify all 19 appear in the database:

| Item ID | Status | Must Be In DB |
|---------|--------|---------------|
| git-branch-sync | in-progress | YES |
| chat-infrastructure | in-progress | YES |
| architecture-direction | up-next | YES |
| first-friend-readiness | up-next | YES |
| clawchestra-ai-website | up-next | YES |
| ai-commit-messages | pending | YES |
| rate-limit-resilience | pending | YES |
| app-customisation | pending | YES |
| roadmap-item-quick-add | pending | YES |
| clawchestra-apps | pending | YES |
| deep-rename-clawchestra | complete | YES |
| git-sync | complete | YES |
| github-api-403-errors | complete | YES |
| collapsible-kanban-columns | complete | YES |
| project-card-opens-kanban | complete | YES |
| draggable-kanban-columns | complete | YES |
| collapsible-sidebar | complete | YES |
| deliverable-lifecycle-orchestration | complete | YES |
| app-ux-review | complete | YES |
| git-sync-scope | complete | YES |

**NOTE:** The Clawchestra CHANGELOG.md does NOT use YAML frontmatter (it is plain markdown). The migration must handle this gracefully -- zero entries imported, no crash.

---

## 5. Rollback Procedure

### 5.1 Rollback Decision Matrix

| Migration State When Failure Occurs | Data at Risk | Rollback Complexity | Procedure |
|--------------------------------------|-------------|---------------------|-----------|
| `Importing` (reading files) | None | Trivial | Reset state to NotStarted. Source files untouched. |
| `Imported` (data in DB) | DB has new rows | Simple | Delete imported rows; reset state to NotStarted. |
| `StateJsonCreated` (.clawchestra/ written) | DB + filesystem | Simple | Delete `.clawchestra/` dir; delete imported rows; reset state. |
| `GitignoreUpdated` (.gitignore committed) | DB + filesystem + git history | Moderate | `git revert HEAD` (reverts gitignore commit); delete `.clawchestra/`; delete imported rows; reset state. |
| `SourceDeleted` (ROADMAP.md deleted, committed) | SOURCE FILES GONE FROM DISK | **Complex** | Restore from backup or `git revert HEAD`; restore from backup files; delete `.clawchestra/`; revert gitignore commit; delete imported rows; reset state. |
| `Complete` (verified) | N/A | N/A | Migration succeeded -- no rollback needed. |

### 5.2 Full Rollback Procedure (Worst Case: State = SourceDeleted)

If migration fails at the final verification step after source files have been deleted:

```bash
#!/bin/bash
# FULL ROLLBACK for a single project
# Run from the project root
# Requires: backup files exist in /tmp/migration-backup-*

PROJECT=$(basename $PWD)
echo "=== ROLLING BACK: $PROJECT ==="

# Step 1: Revert the source deletion commit
echo "Reverting source deletion commit..."
git revert HEAD --no-edit
# This creates a new commit that undoes the deletion
# If ROADMAP.md and CHANGELOG.md were deleted in one commit, one revert restores both

# Step 2: Verify files are back
if [ ! -f ROADMAP.md ]; then
  echo "WARNING: git revert did not restore ROADMAP.md"
  echo "Restoring from backup..."
  cp /tmp/migration-backup-${PROJECT}-ROADMAP.md ROADMAP.md
fi

if [ -f /tmp/migration-backup-${PROJECT}-CHANGELOG.md ] && [ ! -f CHANGELOG.md ]; then
  echo "Restoring CHANGELOG.md from backup..."
  cp /tmp/migration-backup-${PROJECT}-CHANGELOG.md CHANGELOG.md
fi

# Step 3: Revert the gitignore commit
echo "Reverting gitignore commit..."
git revert HEAD --no-edit
# HEAD is now the revert of deletion; HEAD~1 is the gitignore commit
# Actually need to revert HEAD~1 (the gitignore commit from the original migration)
# This is tricky -- may need to identify the exact commit hash
# Safer: just manually remove .clawchestra/ from .gitignore

# Step 3 (safer alternative): Manually fix .gitignore
sed -i '' '/.clawchestra/d' .gitignore
git add .gitignore
git commit -m "chore: rollback -- remove .clawchestra from gitignore"

# Step 4: Remove .clawchestra/ directory
rm -rf .clawchestra/

# Step 5: Verify rollback
echo "Verifying rollback..."
echo "ROADMAP.md: $([ -f ROADMAP.md ] && echo 'RESTORED' || echo 'MISSING -- CRITICAL ERROR')"
echo "CHANGELOG.md: $([ -f CHANGELOG.md ] && echo 'RESTORED' || echo 'NOT PRESENT (may be expected)')"
echo ".clawchestra/: $([ -d .clawchestra ] && echo 'STILL EXISTS -- ERROR' || echo 'REMOVED')"
echo ".gitignore .clawchestra entry: $(grep -c '.clawchestra' .gitignore 2>/dev/null || echo 0)"

# Step 6: Verify file contents match baseline
echo "Comparing ROADMAP.md with backup..."
diff ROADMAP.md /tmp/migration-backup-${PROJECT}-ROADMAP.md && echo "MATCH" || echo "DIFFERS -- investigate"
```

### 5.3 Database Rollback

The Clawchestra app must also reset the migration state in its DB:

```typescript
// In the migration module -- to be called by "Retry" button or manual rollback
async function rollbackMigration(projectId: string): Promise<void> {
  // 1. Delete all roadmap items imported during migration for this project
  await db.deleteImportedItems(projectId, { source: 'migration' });

  // 2. Delete all changelog entries imported during migration for this project
  await db.deleteImportedEntries(projectId, { source: 'migration' });

  // 3. Reset migration state
  await db.setMigrationState(projectId, 'NotStarted');

  // 4. Log the rollback
  console.warn(`[migration] Rolled back migration for project: ${projectId}`);
}
```

### 5.4 Nuclear Rollback (Restore to Pre-Migration State Entirely)

If the entire migration system needs to be abandoned:

1. For each project: restore ROADMAP.md and CHANGELOG.md from `/tmp/migration-backup-*` files
2. For each project: `rm -rf .clawchestra/`
3. For each project: remove `.clawchestra/` line from `.gitignore`
4. Deploy a Clawchestra build WITHOUT the migration code (revert the migration PR)
5. The app will resume reading from ROADMAP.md/CHANGELOG.md as before

**Time estimate for nuclear rollback:** 5-10 minutes for 7 projects (mostly manual git operations).

### 5.5 What Cannot Be Rolled Back

| Aspect | Reversible? | Notes |
|--------|-------------|-------|
| DB rows added | YES | Delete by project ID + migration source tag |
| state.json created | YES | Delete `.clawchestra/` directory |
| .gitignore modified | YES | Remove the appended line |
| Git commits created | YES | `git revert` creates inverse commits |
| ROADMAP.md deleted | **PARTIALLY** | Restorable via `git revert` or backup files. If both the backup AND git history are lost, the data is GONE. |
| CHANGELOG.md deleted | **PARTIALLY** | Same as ROADMAP.md |
| Migration state in DB | YES | Reset to NotStarted |

**The critical risk window is between the `SourceDeleted` state and `Complete` verification.** During this window, source files are deleted from disk and from git's working tree. They remain in git history (recoverable via `git log` / `git show` / `git revert`), and in the `/tmp/` backup. The data is only truly irrecoverable if:
1. Git history is rewritten (force push, rebase that drops the commit), AND
2. Backup files in `/tmp/` are deleted (e.g., system reboot clears `/tmp/`)

**Mitigation:** The verification step (`SourceDeleted` -> `Complete`) runs immediately after deletion. If it fails, the project stays at `SourceDeleted` and the user sees a "Retry" button. The files are still in git history at this point.

---

## 6. Data Integrity Verification

### 6.1 Cross-Reference Check: YAML Source vs. Database

For each project, after migration reaches `Imported` state (but before source file deletion):

```typescript
// This should be an automated test in the migration module

async function verifyImportIntegrity(
  projectPath: string,
  projectId: string,
): Promise<{ passed: boolean; failures: string[] }> {
  const failures: string[] = [];

  // 1. Read source ROADMAP.md (still on disk at this point)
  const roadmapPath = `${projectPath}/ROADMAP.md`;
  const roadmapExists = await pathExists(roadmapPath);

  if (!roadmapExists) {
    return { passed: true, failures: [] }; // No ROADMAP.md = nothing to migrate
  }

  const roadmapDoc = await readRoadmap(roadmapPath);
  const dbItems = await db.getAllItemsForProject(projectId);

  // 2. Every valid source item must be in DB
  for (const sourceItem of roadmapDoc.items) {
    const dbItem = dbItems.find(i => i.id === sourceItem.id);
    if (!dbItem) {
      failures.push(`MISSING: Item '${sourceItem.id}' not found in DB`);
      continue;
    }

    // 3. Field-by-field comparison
    if (dbItem.title !== sourceItem.title) {
      failures.push(`TITLE_MISMATCH: '${sourceItem.id}' -- source: '${sourceItem.title}', db: '${dbItem.title}'`);
    }
    if (dbItem.status !== sourceItem.status) {
      // Check if this is an expected sanitization
      if (sourceItem.status === 'shipped' && dbItem.status === 'complete') {
        // Expected -- shipped -> complete migration
      } else {
        failures.push(`STATUS_MISMATCH: '${sourceItem.id}' -- source: '${sourceItem.status}', db: '${dbItem.status}'`);
      }
    }
    if (sourceItem.specDoc && dbItem.specDoc !== sourceItem.specDoc) {
      failures.push(`SPECDOC_MISMATCH: '${sourceItem.id}' -- source: '${sourceItem.specDoc}', db: '${dbItem.specDoc}'`);
    }
    if (sourceItem.planDoc && dbItem.planDoc !== sourceItem.planDoc) {
      failures.push(`PLANDOC_MISMATCH: '${sourceItem.id}' -- source: '${sourceItem.planDoc}', db: '${dbItem.planDoc}'`);
    }
  }

  // 4. No extra items in DB that weren't in source
  const sourceIds = new Set(roadmapDoc.items.map(i => i.id));
  const extraDbItems = dbItems.filter(i => !sourceIds.has(i.id) && i.source === 'migration');
  if (extraDbItems.length > 0) {
    failures.push(`EXTRA_ITEMS: DB has ${extraDbItems.length} items not in source ROADMAP.md: ${extraDbItems.map(i => i.id).join(', ')}`);
  }

  // 5. Read CHANGELOG.md if it exists
  const changelogPath = `${projectPath}/CHANGELOG.md`;
  const changelogExists = await pathExists(changelogPath);

  if (changelogExists) {
    try {
      const changelogDoc = await parseChangelog(changelogPath);
      const dbEntries = await db.getCompletedItemsFromMigration(projectId);

      for (const sourceEntry of changelogDoc.entries) {
        const dbEntry = dbEntries.find(e => e.id === sourceEntry.id);
        if (!dbEntry) {
          failures.push(`MISSING_CHANGELOG: Entry '${sourceEntry.id}' not found in DB`);
          continue;
        }
        if (dbEntry.completedAt !== sourceEntry.completedAt) {
          failures.push(`COMPLETEDAT_MISMATCH: '${sourceEntry.id}' -- source: '${sourceEntry.completedAt}', db: '${dbEntry.completedAt}'`);
        }
      }
    } catch {
      // CHANGELOG.md exists but has no YAML frontmatter (markdown-only)
      // This is expected for some projects (like Clawchestra itself)
      // Verify zero entries were imported
      const dbEntries = await db.getCompletedItemsFromMigration(projectId);
      if (dbEntries.length > 0) {
        failures.push(`PHANTOM_CHANGELOG: ${dbEntries.length} entries imported from non-YAML CHANGELOG.md`);
      }
    }
  }

  return {
    passed: failures.length === 0,
    failures,
  };
}
```

### 6.2 state.json Round-Trip Verification

After state.json is written, verify it can be read back and matches the DB:

```typescript
async function verifyStateJsonRoundTrip(
  projectPath: string,
  projectId: string,
): Promise<boolean> {
  const stateJsonPath = `${projectPath}/.clawchestra/state.json`;
  const raw = await readFile(stateJsonPath);

  // 1. Valid JSON
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`[migration] state.json is not valid JSON: ${stateJsonPath}`);
    return false;
  }

  // 2. Schema version
  if (parsed._schemaVersion !== 1) {
    console.error(`[migration] Unexpected schema version: ${parsed._schemaVersion}`);
    return false;
  }

  // 3. Item count matches DB
  const dbItems = await db.getAllItemsForProject(projectId);
  if (parsed.roadmapItems.length !== dbItems.length) {
    console.error(`[migration] state.json has ${parsed.roadmapItems.length} items, DB has ${dbItems.length}`);
    return false;
  }

  // 4. Every DB item appears in state.json
  const stateIds = new Set(parsed.roadmapItems.map((i: any) => i.id));
  for (const dbItem of dbItems) {
    if (!stateIds.has(dbItem.id)) {
      console.error(`[migration] DB item '${dbItem.id}' missing from state.json`);
      return false;
    }
  }

  return true;
}
```

### 6.3 Referential Integrity: specDoc and planDoc Paths Still Valid

After migration, verify that all `specDoc` and `planDoc` paths referenced by imported items still point to existing files:

```bash
#!/bin/bash
# Run from project root after migration
# Checks that all doc references in the DB still resolve to real files

echo "=== DOC REFERENCE INTEGRITY CHECK ==="

# This would be done programmatically in the app, but here's the shell equivalent
# Read state.json and check each specDoc/planDoc reference

python3 -c "
import json, os

with open('.clawchestra/state.json') as f:
    data = json.load(f)

broken = []
for item in data.get('roadmapItems', []):
    for field in ['specDoc', 'planDoc']:
        path = item.get(field)
        if path and not os.path.exists(path):
            broken.append(f\"{item['id']}.{field}: {path}\")

if broken:
    print('BROKEN REFERENCES:')
    for b in broken:
        print(f'  {b}')
else:
    print('ALL REFERENCES VALID')
"
```

---

## 7. Manual Testing Checklist

### 7.1 Happy Path (Run on a Staging/Test Project First)

- [ ] **M-1:** Launch Clawchestra with migration code for the first time
- [ ] **M-2:** Observe migration toast/banner appears: "Migrating project data..."
- [ ] **M-3:** Per-project progress is visible (X/Y projects complete)
- [ ] **M-4:** All projects reach `Complete` state without errors
- [ ] **M-5:** Toast/banner auto-dismisses on full success
- [ ] **M-6:** Open the kanban board -- verify same items appear as before migration
- [ ] **M-7:** Verify kanban column counts match pre-migration counts:
  - In Progress column: same item count
  - Up Next column: same item count
  - Pending column: same item count
  - Complete column: same item count (may include items from CHANGELOG.md)
- [ ] **M-8:** Click on a roadmap item that has a specDoc -- verify the doc link still works
- [ ] **M-9:** Click on a roadmap item that has a planDoc -- verify the doc link still works
- [ ] **M-10:** Drag a kanban item from one column to another -- verify the drag updates state.json (not ROADMAP.md, which no longer exists)
- [ ] **M-11:** Verify `.clawchestra/state.json` exists on disk for each project
- [ ] **M-12:** Verify `.clawchestra/` is listed in `.gitignore` for each project
- [ ] **M-13:** Verify `git status` does NOT show `.clawchestra/state.json` as untracked
- [ ] **M-14:** Verify ROADMAP.md is gone from each project (except Revival Fightwear)
- [ ] **M-15:** Verify CHANGELOG.md is gone from each project (except Revival Fightwear)
- [ ] **M-16:** Verify git log shows exactly 2 new commits per migrated project:
  - `chore: add .clawchestra to gitignore`
  - `chore: migrate orchestration data to Clawchestra database`

### 7.2 Revival Fightwear Exception

- [ ] **R-1:** Revival Fightwear project reaches `Complete` state
- [ ] **R-2:** Revival Fightwear ROADMAP.md still exists on disk
- [ ] **R-3:** Revival Fightwear CHANGELOG.md still exists on disk (if it had one)
- [ ] **R-4:** Revival Fightwear `.clawchestra/state.json` was created
- [ ] **R-5:** Revival Fightwear `.gitignore` was updated
- [ ] **R-6:** Revival Fightwear items appear correctly on the kanban board
- [ ] **R-7:** Git log shows only 1 commit (gitignore update), NOT a deletion commit

### 7.3 Error/Edge Cases

- [ ] **E-1:** Kill the app mid-migration (during `Importing` state) -- relaunch -- verify migration resumes from correct state
- [ ] **E-2:** Kill the app mid-migration (during `StateJsonCreated` state) -- relaunch -- verify migration resumes
- [ ] **E-3:** Test with a project that has ROADMAP.md but NO CHANGELOG.md -- verify clean import
- [ ] **E-4:** Test with a project that has a CHANGELOG.md with NO YAML frontmatter (markdown-only) -- verify zero entries imported, no crash
- [ ] **E-5:** Test with a project that has items with `status: shipped` -- verify converted to `complete`
- [ ] **E-6:** Test with a project that has a roadmap item missing an `id` field -- verify auto-generated ID
- [ ] **E-7:** Test with a project with no `.gitignore` -- verify one is created
- [ ] **E-8:** Test with a project that already has `.clawchestra/` in `.gitignore` -- verify no duplicate entry
- [ ] **E-9:** Verify `Retry` button appears if any project fails migration
- [ ] **E-10:** Click `Retry` on a failed project -- verify migration resumes from the failed state (not from the beginning)

### 7.4 Post-Migration Ongoing Behavior

- [ ] **O-1:** After migration, drag a kanban item -- verify NO git dirty state (state.json is gitignored)
- [ ] **O-2:** After migration, verify the git sync badge does NOT appear for kanban drags (no more auto-commit noise)
- [ ] **O-3:** Open the project detail modal -- verify all roadmap items display correctly
- [ ] **O-4:** Verify the app does NOT try to re-migrate on subsequent launches (checks `Complete` state)
- [ ] **O-5:** Verify the deliverable lifecycle buttons still work (spec/plan/build prompts reference state.json, not ROADMAP.md)

---

## 8. Monitoring and Ongoing Verification

### 8.1 Migration Log Review

After migration completes, review the migration log at `.clawchestra/migration.log` for each project:

- [ ] Check for any `_importWarning` entries (items imported with sanitized values)
- [ ] Check for any parse errors that were handled gracefully
- [ ] Check for any items that were skipped (and why)
- [ ] Verify the log confirms the exact number of items imported matches the baseline

### 8.2 First 24 Hours After Migration

| Check | When | How | Expected |
|-------|------|-----|----------|
| Kanban item counts unchanged | +1 hour | Compare with pre-migration baseline | Exact match |
| No phantom ROADMAP.md recreation | +1 hour | Check each project for ROADMAP.md | File does not exist (except Revival Fightwear) |
| state.json stays in sync after drags | +1 hour | Drag an item, read state.json | Updated status/priority reflected |
| No error toasts during normal use | +4 hours | Use app normally | Zero unexpected errors |
| Agent (Claude Code) can read state.json | +4 hours | Ask agent to describe project state | Agent reads from .clawchestra/state.json |
| state.json survives branch checkout | +4 hours | Checkout different branch | state.json unchanged (gitignored = branch-independent) |
| App launch speed unchanged | +24 hours | Launch app, time to kanban render | Within 500ms of pre-migration baseline |

### 8.3 What to Watch For (Failure Modes)

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Kanban board is empty after migration | Import failed silently; DB has zero items | Check migration state in DB; re-run migration or restore from backup |
| Items appear with wrong status | `sanitizeRoadmapItem` converted an unexpected status | Check migration log for warnings; manually correct in DB |
| specDoc/planDoc links broken | Relative path resolution changed | Verify paths are stored as relative to project root, not absolute |
| "File not found" errors in console | Code still references ROADMAP.md or CHANGELOG.md | Grep codebase for stale references; this is a Phase 6 cleanup bug |
| `.clawchestra/state.json` appears in git status | `.gitignore` update failed | Manually add `.clawchestra/` to `.gitignore` |
| Migration runs again on second launch | Migration state not persisted correctly in DB | Check DB schema for migration_state column; verify write succeeded |
| Duplicate items on kanban | Both ROADMAP.md (somehow still exists) and DB items loaded | Verify ROADMAP.md was deleted; check that code no longer reads ROADMAP.md |

---

## Summary: Go/No-Go Decision Points

### RED: Pre-Migration (All Required Before Starting)

- [ ] Baseline data captured for all tracked projects
- [ ] Backup copies of all ROADMAP.md and CHANGELOG.md files created
- [ ] Git working trees clean for all projects
- [ ] All build/test gates pass (tsc, cargo, bun test, pnpm build, tauri build)
- [ ] Migration tests exist and pass
- [ ] Rollback procedure reviewed and understood
- [ ] Revival Fightwear exception confirmed in code

### YELLOW: Migration Execution

1. [ ] Build and install Clawchestra with migration code
2. [ ] Launch app -- observe migration progress
3. [ ] All projects reach `Imported` state (data in DB, source files still on disk)
4. [ ] Run integrity verification (Section 6.1) before proceeding
5. [ ] All projects reach `StateJsonCreated` state
6. [ ] Run state.json round-trip verification (Section 6.2)
7. [ ] All projects reach `GitignoreUpdated` state
8. [ ] Verify .gitignore changes are correct
9. [ ] All projects reach `SourceDeleted` state (POINT OF NO EASY RETURN)
10. [ ] All projects reach `Complete` state

### GREEN: Post-Migration (Within 5 Minutes)

- [ ] Run post-migration filesystem verification (Section 4.3)
- [ ] Run post-migration item count comparison (Section 4.4)
- [ ] Kanban board displays correctly
- [ ] Drag a test item -- verify state.json updates, not ROADMAP.md
- [ ] specDoc/planDoc links work
- [ ] No error toasts

### BLUE: Monitoring (24 Hours)

- [ ] Review migration logs
- [ ] Verify behavior at +1h, +4h, +24h (Section 8.2)
- [ ] Confirm agent (Claude Code) can read state.json
- [ ] Confirm branch checkout does not affect state.json

### ROLLBACK: If Needed at Any Point

1. [ ] Identify which state each project is in
2. [ ] Follow state-specific rollback procedure (Section 5.2)
3. [ ] Restore backup files if source deletion occurred
4. [ ] Reset migration state in DB
5. [ ] Deploy previous Clawchestra build (without migration code)
6. [ ] Verify app reads from ROADMAP.md/CHANGELOG.md again

---

*This checklist covers the Phase 4 migration only. Phases 1-3 and 5-9 have their own verification gates defined in `<repo-root>/docs/plans/architecture-direction-plan.md`.*
