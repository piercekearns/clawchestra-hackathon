# Git Branch Sync Operations Guide

> Decision tree and non-destructive command policy for multi-branch sync.

## Summary

This guide defines how Clawchestra executes branch sync safely: commit on source branch, cherry-pick onto selected targets, and recover explicitly on failures. It standardizes operator behavior across local-only and upstream-tracking branches so failures are predictable and reversible.

---

**Roadmap Item:** `git-branch-sync`
**Status:** Ready
**Created:** 2026-02-20

---

## Decision Tree

1. Start on source branch with selected dirty files.
2. If user enabled Pull First and source has upstream + behind commits:
   - Run `git pull --ff-only`.
   - On failure: stop and show actionable error.
3. Commit selected files on source branch.
4. For each selected target branch:
   - `git stash push --include-untracked` before checkout.
   - `git checkout <target>`.
   - `git cherry-pick --no-edit <commit>`.
   - If conflict: pause, keep context, generate/edit AI proposal in-dialog, explicit approve, apply, `git cherry-pick --continue`.
   - If success and target has upstream + target push selected: `git push`.
   - `git checkout <source>`.
   - Restore stash (`git stash pop`) if one was created.
5. Release operation lock and remain on source branch.

## Cherry-Pick vs Merge/Rebase

1. Use cherry-pick for scoped propagation of one sync commit.
2. Do not use merge/rebase in Sync dialog flow.
3. Merge/rebase remain explicit operator workflows outside Sync dialog.

## Local-Only Branch Policy

1. Local-only branches (`(local)`) are valid branch targets for checkout/cherry-pick.
2. Pull/push controls are disabled when upstream is missing.
3. Source commit and cross-branch propagation still run locally.

## Conflict Handling Policy

1. Detect conflicts via `CHERRY_PICK_HEAD` and unresolved (`U`) paths.
2. Keep cherry-pick paused for explicit resolve/apply/continue; abort only on explicit hard failure path.
3. Keep execution state so users can resume/cancel intentionally.
4. Provide both:
   - AI prefill context for OpenClaw-assisted resolution.
   - Manual fallback commands for operator-led recovery.

## Locking

1. Branch sync lock is both in-process and cross-process (file lock under app support directory).
2. Stale lock files are removed when owning process is dead or lock age exceeds stale threshold.

## Failure Handling

1. Stash failure: stop immediately, keep source branch, report explicit recovery guidance.
2. Checkout failure: return to source branch attempt, mark target failed.
3. Cherry-pick non-conflict failure: abort cherry-pick, mark target failed, stop run.
4. Stash restore failure: stop run, keep attention-required state.
5. Push failure: mark push failed for that branch while preserving commit success.

## Rerere Policy

`git rerere` is not enabled automatically. Keep behavior deterministic and explicit until conflict patterns are stable enough to justify opt-in reuse.
