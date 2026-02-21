---
status: complete
priority: p2
issue_id: "016"
tags: [code-review, correctness, architecture-direction-v2]
dependencies: []
---

# Coupled field rejection drops entire item, violating D4 partial-apply

## Problem Statement

When `status+completedAt` validation fails (e.g., `status: "complete"` without valid `completedAt`), the `continue` statement in validation.rs skips the entire roadmap item. This means **all other valid field changes** on that same item (title, nextAction, tags, icon, etc.) are silently dropped.

This violates the plan's D4 design principle: "valid fields accepted, invalid fields rejected." The current behavior is "one invalid coupled pair → entire item rejected."

**Flagged by 2 agents** (Architecture, Agent-Native).

## Findings

- `validation.rs:169-193` — Three `continue` statements skip the item on coupled field failure
- `merge.rs:171-179` — Merge checks rejected fields by `starts_with("roadmapItems.{id}.")` prefix, which also causes full-item skip
- Example: Agent sets `status: "complete"` (missing completedAt) AND `nextAction: "Deploy to prod"` → both changes lost
- Not documented in AGENTS.md — agents have no way to know this behavior

## Proposed Solutions

### Option A: Only reject the status+completedAt pair, continue validating other fields
- **Pros:** True partial-apply per D4; other valid fields still merge
- **Cons:** More complex validation logic; merge must handle per-field rejection within an item
- **Effort:** Medium
- **Risk:** Low

### Option B: Document the behavior and keep current design
- **Pros:** No code change; simpler mental model ("invalid item = skip item")
- **Cons:** Violates D4; agent UX suffers
- **Effort:** Small (documentation only)
- **Risk:** None

## Technical Details

**Affected files:** `src-tauri/src/validation.rs` (lines 169-193), `src-tauri/src/merge.rs` (lines 171-179)

## Acceptance Criteria

- [ ] Valid field changes on an item with invalid status+completedAt are still applied
- [ ] OR behavior is documented in AGENTS.md compliance block
- [ ] `cargo test` — all pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Architecture + Agent-Native agents |
