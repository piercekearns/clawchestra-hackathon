# Live Git Status Freshness

> Make project-card git badges converge quickly after external commits and pushes without needing manual refresh.

## Summary

Clawchestra can show stale git branch status on project cards after an external or agent-driven commit/push happens outside the app. The canonical example is a project card continuing to show `master ↑4` in the blue "unpushed" state even after the branch has been fully pushed to GitHub, until the user manually hits Refresh. This is a real UX bug: the app is showing incorrect operational state at exactly the moment the user expects the board to reflect recent work.

The fix should not be "poll git constantly." The right solution is a freshness strategy that invalidates cached branch-state aggressively when likely-to-matter events occur, while keeping the steady-state cost low. The recommended direction is a hybrid: immediate targeted refresh after known app-driven git operations, lightweight refresh on app-focus regain, and a low-frequency visible-project backstop.

---

**Roadmap Item:** `live-git-status-freshness`
**Status:** Draft
**Created:** 2026-03-06

---

## Problem

A project card can display stale git branch metadata after the underlying repo state has changed.

Observed behavior:

1. An agent committed and pushed recent work to GitHub from the local repo.
2. The repo was actually clean and in sync with `origin/master`.
3. The project card still showed the blue GitHub badge with `master ↑4`.
4. The badge only corrected after the user manually triggered Refresh.

This means the UI can temporarily disagree with real git state even when the underlying repository is already correct.

## Why This Matters

1. It undermines trust in the board's operational badges.
2. It creates avoidable confusion right after agent work completes.
3. It makes the user think a push failed when it did not.
4. It weakens the usefulness of Clawchestra as a live control surface for repo state.

## Likely Cause

The app is caching or holding branch-state snapshots in memory longer than it should, and the current invalidation triggers are not sufficient for externally-driven git changes.

Most likely contributing factors:

1. File watching is stronger for project/state/doc changes than for git branch-state recalculation.
2. External git operations do not reliably trigger the same UI refresh path as in-app git operations.
3. Branch status may only be recomputed during explicit refresh or selected workflows, not on the small set of events that imply "git state probably changed."
4. Watching `.git` passively is not sufficient by itself because ref/file changes are not always a clean proxy for "the UI should recompute project git status now."

## Goal

Make project-card git status converge quickly after repo changes, especially commits/pushes, without turning the app into a constant full-repo polling loop.

## Non-Goals

1. Perfect sub-second git-state accuracy under every possible external repo mutation.
2. Continuous heavy polling across every tracked repo, even when the app is backgrounded.
3. Re-architecting the entire project refresh model just to solve this badge bug.

## User-Facing Outcome

When a repo's ahead/behind/dirty state changes, the project card should update soon enough that the user rarely needs manual Refresh for git-status correctness.

Target outcome:

1. App-driven git actions update the card almost immediately.
2. External git actions update the card on natural app interaction boundaries.
3. Manual Refresh remains available as a fallback, not the normal path.

## Candidate Fixes

### Option A: Aggressive Polling

Continuously poll git status for all tracked repos on a short interval.

Pros:

1. Simple mental model.
2. Likely to catch most stale states.

Cons:

1. Wasteful across many repos.
2. Expensive when the app is backgrounded.
3. Unnecessary churn for a bug that is event-shaped, not constant-state-shaped.

Recommendation: reject.

### Option B: Pure `.git` Watcher Strategy

Watch `.git/HEAD`, refs, and fetch metadata and trigger refreshes from those filesystem events.

Pros:

1. More reactive than manual refresh.
2. Less polling than Option A.

Cons:

1. Git internal file changes are not always a reliable, portable signal.
2. Different operations touch different files.
3. Risk of platform-specific watcher edge cases.
4. Still may not capture all practical cases cleanly.

Recommendation: useful as a supplement, not enough alone.

### Option C: Event-Driven Invalidation Only

Refresh git status only after app-known git actions such as commit, push, pull, fetch, checkout, and branch sync.

Pros:

1. Cheap and precise for in-app operations.
2. Directly addresses the most common agent/app workflows.

Cons:

1. Does not catch external terminal/git operations.
2. Still leaves stale state if the repo changes while the app is open but idle.

Recommendation: necessary, but insufficient alone.

### Option D: Hybrid Freshness Model

Use three layers:

1. Immediate targeted refresh after known in-app git actions.
2. Lightweight refresh for visible repos when the app regains focus.
3. Low-frequency backstop refresh for visible git repos only, skipped while backgrounded.

Optional fourth layer:

4. Best-effort `.git` watcher hooks where reliable.

Pros:

1. Fast where the app has direct knowledge.
2. Corrects stale external changes at natural interaction points.
3. Avoids expensive always-on polling across all repos.
4. Keeps Refresh as fallback instead of primary recovery path.

Cons:

1. Slightly more implementation complexity than a single trigger.
2. Requires clear ownership of branch-status cache invalidation.

Recommendation: adopt this option.

## Recommended Implementation

### Phase 1: Known-Action Invalidation

After these app-driven operations, trigger a targeted branch-state refresh for the affected repo:

1. commit
2. push
3. pull
4. fetch
5. checkout branch
6. branch sync / cherry-pick flow completion
7. successful update workflow operations that mutate the repo

### Phase 2: Focus-Regain Refresh

When the app window regains focus or visibility:

1. refresh git status for visible project cards only
2. skip full project rescans
3. debounce so rapid focus churn does not spam git commands

### Phase 3: Low-Frequency Safety Net

While the app is foregrounded:

1. refresh visible git repos on a slow cadence, e.g. every 60-120 seconds
2. do not poll hidden/backgrounded windows
3. do not scan non-git projects

### Optional Phase 4: `.git` Signal Hooks

Investigate whether watching these files improves freshness without noise:

1. `.git/HEAD`
2. `.git/FETCH_HEAD`
3. refs under `.git/refs`
4. packed refs where relevant

This should be additive, not the primary correctness mechanism.

## Technical Notes

Likely implementation areas:

1. git branch-state refresh/invalidation logic in the frontend git/project store
2. places where app-driven git workflows complete successfully
3. window focus / visibility event handling
4. optional watcher integration for `.git` paths

## Acceptance Criteria

1. After an app-driven push, the project card no longer remains stale in an ahead/unpushed state.
2. After an external commit/push while the app is open, the card converges without manual Refresh once the user naturally returns focus to the app.
3. The app does not continuously poll every repo on a tight interval.
4. Git status remains performant with multiple tracked repos.
5. Manual Refresh still works as a fallback but is rarely needed for git-status freshness.

## Open Questions

1. What exact store/cache currently owns branch-state freshness?
2. Should focus-regain refresh cover all tracked git repos or only visible cards?
3. Should the sidebar/hub surfaces share the same freshness trigger path as the main board?
