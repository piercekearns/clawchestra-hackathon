---
status: pending
priority: p2
issue_id: "009"
tags: [code-review, data-integrity, architecture-direction-v2]
dependencies: []
---

# Migration uses wall-clock timestamps instead of HLC

## Problem Statement

The migration module creates `__updatedAt` values using `SystemTime::now()` (wall-clock milliseconds) instead of the HLC counter. If migration runs on two machines with clock skew, the resulting `__updatedAt` values could conflict during sync, causing unexpected field-level merge outcomes.

## Findings

- **Source:** architecture-strategist, data-integrity-guardian
- **Location:** `src-tauri/src/migration.rs` (timestamp generation)
- **Impact:** Potential merge conflicts on first sync after migration if clocks differ. One-time event per project.
- **Likelihood:** Low — migration runs once per project, and clock skew would need to be significant.

## Proposed Solutions

### Option A: Use HLC counter for migration timestamps
Pass the AppState's HLC counter to migration and use `advance_hlc()` for each `__updatedAt` value.

**Effort:** Medium
**Risk:** Low

### Option B: Accept wall-clock for migration (one-time event)
Migration only runs once per project. The merge tiebreaker (UUID-based) handles equal timestamps. Practical risk is minimal.

**Effort:** None
**Risk:** Low (edge case with clock skew)

## Recommended Action
Option B — accept for now. Migration is one-time; the tiebreaker handles conflicts.

## Acceptance Criteria
- [ ] Document that migration uses wall-clock timestamps
- [ ] Or: migrate to HLC counter if clock skew issues observed

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Found by architecture-strategist + data-integrity-guardian |
