# Auto-Abort on Sync Failure

> Sync failures should leave git in a clean state, surface what went wrong, and never block branch switching.

## Problem

When a branch sync cherry-pick hits a conflict, the app leaves git mid-cherry-pick on the target branch with conflict markers in the working tree. This blocks branch switching (via localStorage state check in BranchPopover) until the user resolves the conflict — even if they just want to abandon the sync and carry on.

The `failed` status (non-conflict failures) already aborts the cherry-pick in the executor, but still blocks branch switching via `isUnresolvedSyncStep()`.

## Design

### Principle

The app initiated the operation, so the app cleans up when it fails. Git should never be left in a dirty state from an app-initiated action. Conflict information is captured before aborting and stored for display/retry.

### Core fix: eliminate `pausedOnConflict`

The root cause is the `pausedOnConflict` flag (SyncDialog.tsx line 826). When set `true` on conflict (line 963), it causes both `finally` blocks to skip cleanup — the inner per-target one (line 1031) skips source branch checkout, and the outer one (line 1058) also skips. Coupled with `restoreStash = false` (line 964), this leaves git mid-cherry-pick on the wrong branch with an orphaned stash.

**Fix:** Remove `pausedOnConflict` entirely. Remove `restoreStash = false` from the conflict handler. Abort the cherry-pick in the conflict handler before returning. Both `finally` blocks then run normally — inner restores source branch + pops stash, outer releases lock.

### New behavior on conflict

1. Cherry-pick fails with conflicts
2. Capture conflict metadata: file list, error message, commit hash, target branch
3. `git cherry-pick --abort` — clean up git state
4. Return from conflict handler (do NOT set `pausedOnConflict`)
5. Inner `finally` runs: checkout source branch, pop stash
6. Outer `finally` runs: release sync lock
7. Execution state set to `'conflict'` with captured metadata
8. UI shows non-blocking notification with retry/dismiss options
9. Branch switching is NOT blocked

### `failed` path

Already aborts cherry-pick and cleans up correctly (inner+outer finally both run since `pausedOnConflict` is never set). Only change needed: stop blocking branch switching in BranchPopover.

### Retry flow (Resolve with AI)

When user clicks "Resolve with AI", the entire operation is atomic with full cleanup guarantees:

**`generateConflictDrafts` (capture context + get AI proposals):**
1. Acquire sync lock
2. Stash uncommitted work
3. Checkout target branch
4. Re-run cherry-pick (re-creates conflict — deterministic since same commit hash)
5. If cherry-pick succeeds (conflict resolved externally): treat as success, clear state, abort early
6. Capture fresh conflict context via `gitGetConflictContext()`
7. Abort cherry-pick, checkout source, pop stash, release lock
8. Send captured context to OpenClaw for resolution proposal
9. Store proposals in React state for user review/editing
10. On ANY error at steps 2-7: abort cherry-pick, restore source, pop stash, release lock

Git is clean after `generateConflictDrafts` returns. AI proposals are in React state. User can review/edit.

**`applyConflictDrafts` (apply AI proposals):**
1. Acquire sync lock
2. Stash uncommitted work
3. Checkout target branch
4. Re-run cherry-pick (re-creates conflict again)
5. Apply stored resolutions via `gitApplyConflictResolution()`
6. `git cherry-pick --continue`
7. Push if enabled
8. Checkout source, pop stash, release lock
9. If more targets remain: continue sync for remaining targets
10. Clear execution state on success
11. On ANY error: abort cherry-pick, restore source, pop stash, release lock, update execution state with new error

This means two cherry-pick-abort cycles (generate + apply), but git is always clean between user interactions.

### Dismiss flow

User clicks "Dismiss" → clear execution state. Done. No git cleanup needed (already clean).

---

## Changes

### File 1: `src/lib/git-sync-utils.ts`

**Rename `isUnresolvedSyncStep` → `isFailedSyncStep` (line 178-180):**

The function body stays identical — it identifies terminal failure states. The rename removes the "unresolved" framing which implied "must resolve before proceeding."

```typescript
// Before:
export function isUnresolvedSyncStep(step: BranchSyncStep): boolean {
  return step === 'conflict' || step === 'failed';
}

// After:
export function isFailedSyncStep(step: BranchSyncStep): boolean {
  return step === 'conflict' || step === 'failed';
}
```

No new functions. No function that returns `false`.

### File 2: `src/components/BranchPopover.tsx`

**Delete all branch-switching blocking code.** Since sync failures no longer leave git dirty, there is nothing to block.

Remove:
- Import of `isUnresolvedSyncStep` / `readExecutionState` from git-sync-utils (line 6) — only keep `getTargetBranchIndicator`
- The sync-check guard in `handleCheckout` (lines 115-120)
- The `hasSyncInProgress` computation (lines 134-137)
- The "Branch sync in progress" warning banner (lines 169-173)
- The `!hasSyncInProgress` conditions in branch list rendering (lines 175, 179)

Net result: BranchPopover no longer imports or knows about sync state. Pure deletion, no new code.

### File 3: `src/components/SyncDialog.tsx`

**3a. Eliminate `pausedOnConflict` variable:**

Remove declaration (line 826), remove `pausedOnConflict = true` (line 963), remove `restoreStash = false` (line 964).

**3b. Modify conflict handler (~lines 962-1000):**

Before returning from the conflict case, abort the cherry-pick:

```typescript
} else if (cherryPick.status === 'conflict') {
  const conflictInfo = {
    files: cherryPick.conflictingFiles,
    message: cherryPick.message,
  };

  // Abort cherry-pick — git returns to clean state on target branch
  await gitAbortCherryPick(project.dirPath).catch(() => undefined);

  // Do NOT set pausedOnConflict or restoreStash = false.
  // The inner finally will: checkout source branch + pop stash.

  updateExecutionState({
    sourceBranch,
    commitHash,
    currentStep: 'conflict',
    currentTarget: targetBranch,
    completedTargets,
    remainingTargets,
    targetPushBranches: [...targetPushBranches],
    sourcePushEnabled: sourcePushSelected,
    sourcePushed,
    pendingStashRef: stash.stashed ? stash.stashRef : undefined,
    errorMessage: conflictInfo.message,
    conflictFiles: conflictInfo.files,
  });

  const conflict: ConflictContext = { sourceBranch, targetBranch, commitHash, files: conflictInfo.files, details: conflictInfo.message };
  return { ok: false, error: `Cherry-pick to ${targetBranch} had conflicts — aborted automatically`, conflict };
}
```

Note: `pendingStashRef` is kept as a recovery mechanism in case the inner finally's stash pop fails.

**3c. Update inner `finally` block (line 1030-1037):**

Remove `!pausedOnConflict` guard:

```typescript
// Before:
} finally {
  if (checkoutTargetSucceeded && !pausedOnConflict) {
    await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
  }
  if (restoreStash && stash.stashed) {
    await gitPopStash(project.dirPath, stash.stashRef ?? null);
  }
}

// After:
} finally {
  if (checkoutTargetSucceeded) {
    await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
  }
  if (restoreStash && stash.stashed) {
    await gitPopStash(project.dirPath, stash.stashRef ?? null);
  }
}
```

`restoreStash` still defaults to `true` (line 919) and is no longer overridden in the conflict handler.

**3d. Update outer `finally` block (~lines 1057-1064):**

Remove `!pausedOnConflict` guard:

```typescript
// Before:
finally {
  if (!pausedOnConflict) {
    await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
  }
  if (branchSyncLockToken) {
    await gitSyncLockRelease(project.dirPath, branchSyncLockToken).catch(() => undefined);
  }
}

// After:
finally {
  await gitCheckoutBranch(project.dirPath, sourceBranch).catch(() => undefined);
  if (branchSyncLockToken) {
    await gitSyncLockRelease(project.dirPath, branchSyncLockToken).catch(() => undefined);
  }
}
```

**3e. Update `generateConflictDrafts` (~line 1091):**

Wrap the conflict context capture in a lock-protected, abort-on-failure block:

```typescript
const generateConflictDrafts = async (projectId: string) => {
  const execState = executionStateByProject.get(projectId);
  if (!execState || execState.currentStep !== 'conflict' || !execState.currentTarget || !execState.commitHash) return;

  const project = allProjects.find((p) => p.id === projectId);
  if (!project) return;

  let lockToken: string | null = null;
  let checkedOutTarget = false;
  let stashRef: string | null = null;

  try {
    // Acquire lock
    lockToken = await gitSyncLockAcquire(project.dirPath);

    // Stash + checkout target + re-cherry-pick
    const stash = await gitStashPush(project.dirPath, true, `clawchestra-conflict-resolve:${projectId}`);
    stashRef = stash.stashed ? (stash.stashRef ?? null) : null;
    await gitCheckoutBranch(project.dirPath, execState.currentTarget);
    checkedOutTarget = true;

    const cherryPick = await gitCherryPickCommit(project.dirPath, execState.commitHash);
    if (cherryPick.status !== 'conflict') {
      // Conflict resolved externally — cherry-pick succeeded or failed differently
      if (cherryPick.status === 'applied') {
        // Success! Continue with remaining targets...
        clearExecutionState(projectId);
      }
      return;
    }

    // Capture fresh context while mid-cherry-pick
    const context = await gitGetConflictContext(project.dirPath);
    if (context.length === 0) {
      throw new Error('Conflict detected but no files could be extracted');
    }

    // Abort cherry-pick — return to clean state
    await gitAbortCherryPick(project.dirPath).catch(() => undefined);
    checkedOutTarget = false; // Will be handled in finally

    // Now send to OpenClaw with captured context (git is clean)
    // ... existing OpenClaw call using captured `context`
    // Store proposals in React state

  } catch (err) {
    // Surface error to user
  } finally {
    // Always clean up
    if (checkedOutTarget) {
      await gitAbortCherryPick(project.dirPath).catch(() => undefined);
    }
    await gitCheckoutBranch(project.dirPath, execState.sourceBranch).catch(() => undefined);
    if (stashRef) {
      await gitPopStash(project.dirPath, stashRef).catch(() => undefined);
    }
    if (lockToken) {
      await gitSyncLockRelease(project.dirPath, lockToken).catch(() => undefined);
    }
  }
};
```

**3f. Update `applyConflictDrafts` (~line 1186):**

Same pattern: lock → stash → checkout target → re-cherry-pick → apply resolutions → continue → cleanup. Full abort-on-error in finally block. See `generateConflictDrafts` pattern above.

**3g. Update internal `isUnresolvedSyncStep` call sites:**

- Line 517 (syncProjects memo): rename to `isFailedSyncStep`
- Line 1606 (JSX conflict panel): rename to `isFailedSyncStep`

### File 4: `src/App.tsx`

**Update import:** Replace `isUnresolvedSyncStep` with `isFailedSyncStep`.

**Update scan callback (~line 336):**
```typescript
if (state && isFailedSyncStep(state.currentStep)) count++;
```

---

## Edge cases

- **Stash pop fails after abort**: Inner finally uses `.catch(() => undefined)`. Stash ref is saved in execution state as `pendingStashRef` for manual recovery.
- **Source branch checkout fails after abort**: Same `.catch(() => undefined)`. Rare.
- **`gitAbortCherryPick` fails**: `.catch(() => undefined)` — inner finally still attempts source checkout.
- **Retry: conflict no longer exists**: Cherry-pick succeeds → treat as success, clear state, continue.
- **Retry: target branch deleted**: Lock acquire succeeds but checkout fails → caught in try/catch → error surfaced.
- **Retry: commit force-pushed away**: Cherry-pick fails with non-conflict error → caught → error surfaced.
- **Retry: empty conflict file list**: Guard checks `context.length === 0` → surfaces error instead of sending empty prompt to AI.
- **Multiple targets fail**: First conflict aborts that target. User retries, which re-attempts from that target onward.
- **`failed` path**: Already aborts and cleans up correctly. Only change is removing the BranchPopover blocking.

## Verification

```bash
bun test
pnpm build
npx tauri build --no-bundle
```

Manual test:
1. Trigger a sync that will conflict (make conflicting changes on source and target branches)
2. Verify: cherry-pick is aborted, git is clean, on source branch
3. Verify: branch switching works (popover not blocked)
4. Verify: UI shows conflict notification with retry/dismiss options
5. Click "Retry with AI" → verify conflict is re-created, AI resolves, sync completes
6. Click "Dismiss" → verify state is cleared
