---
status: pending
priority: p2
issue_id: "008"
tags: [code-review, security, architecture-direction-v2]
dependencies: []
---

# CSP disabled in tauri.conf.json

## Problem Statement

`tauri.conf.json` has `"csp": null`, which disables Content Security Policy entirely. While this is common during development, it means any injected script (via a compromised dependency or XSS in rendered markdown) runs with full privileges.

## Findings

- **Source:** security-sentinel
- **Location:** `src-tauri/tauri.conf.json:30-31`
- **Impact:** No defense-in-depth against XSS. A desktop Tauri app has lower attack surface than a web app, but CSP is still a meaningful layer.

## Proposed Solutions

### Option A: Add restrictive CSP
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ipc: http://ipc.localhost"
```

**Effort:** Small
**Risk:** Medium (may break features that load external resources; needs testing)

### Option B: Defer until pre-release hardening
CSP null is acceptable during active development. Add to pre-release checklist.

**Effort:** None now

## Recommended Action
Option B — add to pre-release hardening checklist.

## Acceptance Criteria
- [ ] CSP is set before any public release
- [ ] All app functionality works with CSP enabled

## Work Log
| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-21 | Created from holistic review | Found by security-sentinel |
