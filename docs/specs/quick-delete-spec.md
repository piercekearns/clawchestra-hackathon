# Quick Delete

> Enable users and agents to delete roadmap items from the UI and via IPC.

## Why deletion isn't trivial

Clawchestra uses immutable-append merge semantics: when a state.json is written by
an agent, items present in the DB but absent from state.json are **not deleted**
(treated as "I didn't include it", not "delete it"). This design prevents accidental
data loss from partial agent writes.

Implementing real deletion therefore requires:

1. An explicit delete signal (not just omission)
2. Propagation through the sync layer (local + remote db.json)
3. Correct interaction with the history buffer (stale detection must not resurrect deleted items)

## Frontend

- **Delete button** on each roadmap item card (icon, not text — hover/focus reveal)
- **Confirmation dialog** before deletion (brief, no checkbox — one click to confirm)
- Keyboard shortcut: `Backspace` or `Delete` when a card is focused

## Backend

New Tauri command:

```rust
#[tauri::command]
async fn delete_roadmap_item(
    project_id: String,
    item_id: String,
    app_state: tauri::State<'_, SharedAppState>,
) -> Result<(), String>
```

Behavior:
- Removes the item from `db.projects[project_id].roadmap_items`
- Advances HLC
- Marks DB dirty
- Writes back state.json (so agents see the deletion)

## Sync propagation

Two options (decide during implementation):

1. **Tombstone**: Add a `_deleted: true` field to the item. Merge logic skips tombstoned items
   when projecting state.json. Tombstones are garbage-collected after a configurable TTL.
2. **Direct removal**: Remove from db.json entirely. Relies on both sides syncing before either
   re-introduces the item. Simpler but risks resurrection on slow-syncing devices.

Recommendation: start with direct removal (option 2) for MVP, add tombstones if resurrection
becomes a real problem.

## Trigger

Implement alongside or immediately after the quick-add feature (they share the same
card interaction patterns and state mutation paths).
