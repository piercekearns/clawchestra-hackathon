---
status: pending
priority: p2
issue_id: "026"
tags: [data-integrity, multi-device, sync, architecture-direction-v2]
dependencies: ["024"]
---

# Multi-device sync correctness bundle

## Problem Statement

Three related issues in the sync/merge pipeline that become important when scaling beyond 2 devices or when remote sync goes live. None are bugs in the current 2-device scenario, but all would cause incorrect behavior at scale.

## Findings

### A) UUID tie-breaking non-deterministic with 3+ devices

**Location:** `src-tauri/src/sync.rs` lines 360-367

```rust
let remote_uuid = remote.clients.keys()
    .find(|k| k.as_str() != local_client_uuid)
    .cloned().unwrap_or_default();
```

`find` on a `HashMap` returns an arbitrary non-local client. With 3+ devices, different devices pick different "remote UUIDs" for tie-breaking, violating convergence. The merge result becomes non-deterministic.

**Identified by:** Architecture Strategist (R2), Security Sentinel (#11), Data Integrity Guardian (observation)

### B) Sync merge bypasses business rule validation

**Location:** `src-tauri/src/sync.rs` lines 350-534

`merge_db_json` performs pure HLC timestamp comparison without checking coupled field invariants (status+completedAt), valid status enums, or priority uniqueness. A remote device with bugs or an older version can inject invalid state that the local merge path (merge.rs) would have rejected.

**Identified by:** Data Integrity Guardian (#5, MEDIUM)

### C) HLC timestamp pool growth bypasses wall-clock

**Location:** `src-tauri/src/merge.rs` lines 63-73

The `next_ts!()` growth path generates timestamps as `last + i` without consulting the wall clock. If significant time passes between pool allocation and growth, the grown timestamps fall behind wall time. These fields will always lose in a subsequent sync merge against a device using real wall-clock HLC values.

Post-merge sync at lines 357-362 mitigates by advancing the counter, but the timestamps already assigned to fields remain behind.

**Identified by:** Data Integrity Guardian (#2, HIGH), Security Sentinel (#10, MEDIUM)

## Proposed Solutions

### For A) UUID tie-breaking
Tie-break using the owning client UUID per field (not a single "remote UUID" for the whole merge). On a tie, the field value from the lexicographically greater UUID wins, regardless of local/remote. Requires storing per-field client UUID alongside timestamps.

- Effort: Medium-Large (schema change to per-field client tracking)
- Trigger: Before 3+ device sync

### For B) Sync business rules
Run `validate_state_json` on the projected state after sync merge, rejecting fields that violate invariants. Or add a lightweight validation pass within `merge_db_json` for critical invariants (coupled fields, valid statuses).

- Effort: Small-Medium
- Trigger: Before remote sync goes live

### For C) HLC growth path
Compute growth base as `max(last, wall_clock_ms)` before adding offsets:
```rust
let now = SystemTime::now()...as_millis() as u64;
let base = std::cmp::max(last, now);
let extra: Vec<u64> = (1..=16).map(|i| base + i).collect();
```

- Effort: Small (one-line change)
- Trigger: Now (low risk, high value)

## Recommended Action

Fix C immediately (trivial). Fix B before remote sync. Defer A until 3+ device sync is on the roadmap.

## Acceptance Criteria

- [ ] (C) Growth path uses `max(last, wall_clock)` as base
- [ ] (B) Sync merge validates coupled field invariants
- [ ] (A) UUID tie-breaking produces deterministic results regardless of device count

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | From review round 3 — cross-agent findings |
