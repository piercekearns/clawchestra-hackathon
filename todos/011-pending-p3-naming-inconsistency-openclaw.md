---
status: pending
priority: p3
issue_id: "011"
tags: [code-review, cleanup, architecture-direction-v2]
dependencies: []
---

# Naming inconsistency: openclaw vs OpenClaw

## Problem Statement

Mixed casing across the codebase: `openclaw`, `OpenClaw`, `open_claw` used inconsistently in variable names, comments, paths, and function names. Not a functional issue but reduces discoverability and grep-ability.

## Findings

- **Source:** pattern-recognition-specialist
- **Impact:** Minor readability/consistency concern

## Acceptance Criteria
- [ ] Consistent casing convention documented and applied
