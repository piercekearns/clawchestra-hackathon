# Quick Delete

Roadmap item deletion from the UI and via IPC command.

## Status: pending

Paired with quick-add. Requires careful handling of merge semantics
(immutable-append pattern means deletion needs an explicit signal).

## Key decisions needed

- Tombstone vs direct removal for sync propagation
- Undo support (time-limited restore after deletion?)
- Agent access: should agents be able to delete items via state.json?

## Dependencies

- Quick-add (shared card interaction patterns)
- Merge logic changes (if tombstone approach chosen)

## Hardening Review Finding (2026-02-21)

During the architecture-direction-v2 hardening sprint (4 rounds of multi-agent holistic
review on the Rust backend), the following gap was surfaced by both the Architecture
Strategist and Data Integrity Guardian review agents:

**Grow-only merge — no tombstones or deletion propagation**

`merge_db_json` in `sync.rs` starts with `let mut merged = local.clone()` and only *adds*
from remote — it never removes. Items present in local but absent from remote are always
kept. This means:

- If Device A deletes a project/item and Device B still has it, the item reappears after sync.
- Over time, the database accumulates stale projects and items with no way to prune them.
- Users cannot permanently remove data without manual intervention on all devices.

The `merge.rs` state.json merge has the same design intentionally (agents removing items
is treated as "I didn't include it", not "delete it"). But at the `db.json` cross-device
sync layer this becomes a monotonically growing dataset.

**Recommendation:** Design tombstone semantics (e.g., `deleted_at` timestamp + GC policy)
alongside the delete UX. This is the right vehicle because:

1. Tombstone design is tightly coupled to how deletion surfaces in the UI (undo support,
   confirmation dialogs, "deleted on another device" notifications)
2. Sync propagation of deletes requires the merge layer to understand deletion signals —
   cannot be bolted on after the fact
3. Getting deletion wrong (e.g., accidental mass-deletion propagation) is worse than the
   current grow-only behavior

This finding should be treated as a **required deliverable** within quick-delete, not a
separate item.

## Spec

See `docs/specs/quick-delete-spec.md`
