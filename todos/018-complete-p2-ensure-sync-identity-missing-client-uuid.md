---
status: complete
priority: p2
issue_id: "018"
tags: [code-review, correctness, architecture-direction-v2]
dependencies: []
---

# ensure_sync_identity doesn't set AppState.client_uuid

## Problem Statement

The `ensure_sync_identity` Tauri command (lib.rs:1793-1854) creates a new client identity and inserts it into `guard.db.clients`, but never sets `guard.client_uuid`. The startup code (lib.rs:2109) correctly sets both. If `ensure_sync_identity` runs in a scenario where `db.clients` was empty (e.g., first-time setup via the UI rather than startup), `client_uuid` remains empty string.

Empty `client_uuid` breaks HLC tie-breaking in sync (`local_client_uuid >= remote_uuid.as_str()` — empty string loses every tie), meaning the local device always loses conflict ties.

## Findings

- `lib.rs:1799` — checks `guard.db.clients.is_empty()` to decide whether to create identity
- `lib.rs:1813-1839` — creates UUID, inserts into `guard.db.clients`, but **never sets `guard.client_uuid`**
- `lib.rs:2109` — startup code correctly does `app_state.client_uuid = uuid.clone()`
- `lib.rs:2123` — startup picks first key from `db.clients` HashMap (non-deterministic order)
- `sync.rs:461-462` — tie-breaking: `local_client_uuid >= remote_uuid.as_str()`

## Proposed Solutions

### Option A: Add `guard.client_uuid = uuid.clone()` in ensure_sync_identity
- **Pros:** One-line fix; matches startup behavior
- **Cons:** None
- **Effort:** Small
- **Risk:** None

## Technical Details

**Affected files:** `src-tauri/src/lib.rs` (ensure_sync_identity command, ~line 1813)

## Acceptance Criteria

- [ ] `ensure_sync_identity` sets `guard.client_uuid` when creating a new identity
- [ ] `cargo test` — all pass

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Holistic review round 2, flagged by Architecture agent |
