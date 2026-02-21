---
status: pending
priority: p3
issue_id: "010"
tags: [code-review, cleanup, architecture-direction-v2]
dependencies: []
---

# Dead validation diff-tracking code

## Problem Statement

The code-simplicity-reviewer identified ~112 lines of validation diff-tracking code that may be unused or only partially used. This includes `ValidationDiff` struct(s) and related tracking logic that was scaffolded but never fully wired up.

## Findings

- **Source:** code-simplicity-reviewer
- **Impact:** Dead code increases maintenance burden and confuses readers.
- **Effort:** Small (delete unused code)

## Acceptance Criteria
- [ ] Identify all unused validation diff types/functions
- [ ] Remove dead code
- [ ] All tests pass
