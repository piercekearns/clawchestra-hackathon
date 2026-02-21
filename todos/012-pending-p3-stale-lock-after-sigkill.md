---
status: pending
priority: p3
issue_id: "012"
tags: [code-review, reliability, architecture-direction-v2]
dependencies: []
---

# Stale lock file persistence after SIGKILL

## Problem Statement

If the app is killed via SIGKILL (force quit, OOM killer), lock files or temporary files may persist on disk. On next launch, these stale artifacts could cause confusing behavior or prevent normal operation.

## Findings

- **Source:** data-integrity-guardian
- **Impact:** On next launch after abnormal termination, stale state could cause issues.
- **Current mitigation:** Atomic writes use timestamped `.tmp-{millis}` suffixes, so stale temp files don't collide. Lock files (if any) are the main concern.

## Acceptance Criteria
- [ ] Startup cleans up any stale .tmp files
- [ ] Or: document that SIGKILL may leave artifacts
