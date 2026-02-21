//! merge.rs — Field-by-field merge logic for state.json external changes.
//!
//! Implements Phase 2.5: merge incoming state.json into the DB.
//! - Stale write detection (compare against history buffer)
//! - Coupled field validation (status + completedAt as unit)
//! - New items: add. Removed items: do NOT delete.
//! - Priority conflict resolution: auto-shift
//! - HLC timestamps on every change

use std::collections::{HashMap, HashSet};
use std::time::SystemTime;

use crate::state::{
    AppState, AppliedChange, DbProjectData, DbProjectEntry, DbRoadmapItem, HistoryEntry,
    HistorySource, ProjectId, StateJson, StateJsonValidationResult,
};
use crate::validation::{validate_state_json, CURRENT_SCHEMA_VERSION};

/// Merge an externally-changed state.json into the in-memory DB.
///
/// This function:
/// 1. Validates the incoming state.json
/// 2. Compares field-by-field against current DB state
/// 3. Detects stale agent writes via history buffer
/// 4. Applies valid changes with HLC timestamps
/// 5. Pushes a history entry
/// 6. Returns the validation result
pub fn merge_state_json(
    app_state: &mut AppState,
    project_id: &str,
    project_dir: &str,
    incoming: StateJson,
) -> StateJsonValidationResult {
    let pid = ProjectId(project_id.to_string());

    // Get current projected state for comparison (also used as pre-merge snapshot for history)
    let current = app_state.project_state_json(project_id);
    let pre_merge_state = current.clone();

    // Validate the incoming document
    let validation = validate_state_json(&incoming, current.as_ref());

    // If schema version is too high, refuse entirely
    if incoming.schema_version > CURRENT_SCHEMA_VERSION {
        return validation;
    }

    // Track applied changes
    let mut applied: Vec<AppliedChange> = Vec::new();
    let mut warnings: Vec<String> = validation.warnings.clone();

    // Pre-allocate a batch of HLC timestamps to avoid borrow conflicts.
    // We need at most: 5 project fields + N roadmap items * ~12 fields each + some extras.
    // Over-allocating is fine — unused timestamps just advance the counter harmlessly.
    let num_timestamps = 10 + incoming.roadmap_items.len() * 15;
    let mut timestamps: Vec<u64> = (0..num_timestamps)
        .map(|_| app_state.next_hlc())
        .collect();
    let mut ts_idx: usize = 0;

    /// Get the next pre-allocated timestamp, growing the pool if exhausted.
    /// Growth path extends from the last value to avoid borrow conflicts
    /// with app_state (which is mutably borrowed via db_entry during merges).
    macro_rules! next_ts {
        () => {{
            if ts_idx >= timestamps.len() {
                let last = *timestamps.last().expect("timestamps vec is never empty");
                let wall_clock = SystemTime::now()
                    .duration_since(SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(last);
                let base = std::cmp::max(last, wall_clock);
                let extra: Vec<u64> = (1..=16).map(|i| base + i).collect();
                timestamps.extend(extra);
            }
            let t = timestamps[ts_idx];
            ts_idx += 1;
            t
        }};
    }

    // Get or create the project entry in the DB
    let entry_exists = app_state.db.projects.contains_key(project_id);
    if !entry_exists {
        let ts = next_ts!();
        let new_entry = DbProjectEntry {
            project_path: project_dir.to_string(),
            project: DbProjectData {
                id: project_id.to_string(),
                title: incoming.project.title.clone(),
                title_updated_at: ts,
                status: incoming.project.status.clone(),
                status_updated_at: ts,
                description: incoming.project.description.clone(),
                description_updated_at: ts,
                parent_id: incoming.project.parent_id.clone(),
                parent_id_updated_at: ts,
                tags: incoming.project.tags.clone(),
                tags_updated_at: ts,
            },
            roadmap_items: HashMap::new(),
        };
        app_state
            .db
            .projects
            .insert(project_id.to_string(), new_entry);
        applied.push(AppliedChange {
            field: "project".to_string(),
            old_value: None,
            new_value: format!("new project: {}", incoming.project.title),
        });
    }

    // Get the history buffer for stale write detection
    let prev_state = app_state.last_history(&pid).map(|h| h.state.clone());
    let prev_prev_state = app_state.history_at(&pid, 1).map(|h| h.state.clone());

    // Only merge validated fields (skip those in the rejected list)
    let rejected_fields_set: HashSet<String> = validation
        .rejected_fields
        .iter()
        .map(|r| r.field.clone())
        .collect();

    // --- Merge project-level fields ---
    {
        let db_entry = app_state.db.projects.get_mut(project_id)
            .expect("project entry must exist: inserted above if missing");

        // Macro that merges a single project field with stale detection
        macro_rules! merge_project_field {
            ($field:ident, $field_str:literal, $ts_field:ident) => {
                let incoming_val = &incoming.project.$field;
                let current_val = &db_entry.project.$field;
                if incoming_val != current_val {
                    let matches_last = prev_state
                        .as_ref()
                        .is_some_and(|prev| &prev.project.$field == incoming_val);
                    let is_stale = if matches_last {
                        // Check second-to-last: if value was stable before, this is
                        // an intentional revert, not a stale echo-back
                        let was_stable_before = prev_prev_state
                            .as_ref()
                            .is_some_and(|pp| &pp.project.$field == incoming_val);
                        !was_stable_before
                    } else {
                        false
                    };
                    if is_stale {
                        warnings.push(format!(
                            "Stale write detected for project.{}: incoming matches previous state",
                            $field_str
                        ));
                    } else {
                        let old = format!("{:?}", current_val);
                        db_entry.project.$field = incoming_val.clone();
                        db_entry.project.$ts_field = next_ts!();
                        applied.push(AppliedChange {
                            field: format!("project.{}", $field_str),
                            old_value: Some(old),
                            new_value: format!("{:?}", incoming_val),
                        });
                    }
                }
            };
        }

        if !rejected_fields_set.contains("project.title") {
            merge_project_field!(title, "title", title_updated_at);
        }
        if !rejected_fields_set.contains("project.status") {
            merge_project_field!(status, "status", status_updated_at);
        }
        if !rejected_fields_set.contains("project.description") {
            merge_project_field!(description, "description", description_updated_at);
        }
        if !rejected_fields_set.contains("project.parentId") {
            merge_project_field!(parent_id, "parentId", parent_id_updated_at);
        }
        if !rejected_fields_set.contains("project.tags") {
            merge_project_field!(tags, "tags", tags_updated_at);
        }
    }
    // db_entry borrow released here

    // --- Merge roadmap items ---
    // NOTE: Items in DB but NOT in incoming are kept (not deleted). Per plan 2.5:
    // "agents removing items from state.json is treated as 'I didn't include it' not 'delete it'"

    for incoming_item in &incoming.roadmap_items {
        if incoming_item.id.is_empty() {
            continue;
        }

        // Check which fields on this item were rejected.
        // Items with a bad status are fully skipped (can't merge any fields if status is invalid).
        // Coupled status+completedAt rejection only blocks those two fields; other fields merge normally.
        let status_rejected = rejected_fields_set
            .contains(&format!("roadmapItems.{}.status", incoming_item.id));
        if status_rejected {
            continue; // Invalid status → skip entire item (can't place in column)
        }
        let coupled_rejected = rejected_fields_set
            .contains(&format!("roadmapItems.{}.status+completedAt", incoming_item.id));

        let ts = next_ts!();
        let db_entry = app_state.db.projects.get_mut(project_id)
            .expect("project entry must exist: inserted above if missing");

        if db_entry.roadmap_items.contains_key(&incoming_item.id) {
            // Existing item — merge field by field
            let prev_item = prev_state.as_ref().and_then(|prev| {
                prev.roadmap_items.iter().find(|i| i.id == incoming_item.id)
            });

            // Priority merge with conflict resolution — check BEFORE mutating
            let incoming_priority = incoming_item
                .priority
                .unwrap_or_else(|| db_entry.roadmap_items[&incoming_item.id].priority);
            let current_priority = db_entry.roadmap_items[&incoming_item.id].priority;
            let priority_changed = incoming_priority != current_priority;
            let priority_is_stale =
                prev_item.is_some_and(|p| p.priority == Some(incoming_priority));

            if priority_changed && !priority_is_stale {
                // Check for conflict
                let conflict = db_entry.roadmap_items.values().any(|other| {
                    other.id != incoming_item.id
                        && other.status == incoming_item.status
                        && other.priority == incoming_priority
                });
                if conflict {
                    // Auto-resolve: shift existing items down
                    let item_id = incoming_item.id.clone();
                    let item_status = incoming_item.status.clone();
                    for other in db_entry.roadmap_items.values_mut() {
                        if other.id != item_id
                            && other.status == item_status
                            && other.priority >= incoming_priority
                        {
                            other.priority += 1;
                            other.priority_updated_at = ts;
                        }
                    }
                    warnings.push(format!(
                        "Priority conflict in column '{}': shifted items to accommodate {} at priority {}",
                        incoming_item.status, incoming_item.id, incoming_priority
                    ));
                }
                let db_item = db_entry.roadmap_items.get_mut(&incoming_item.id)
                    .expect("roadmap item must exist: checked via contains_key above");
                db_item.priority = incoming_priority;
                db_item.priority_updated_at = ts;
            }

            // Now merge scalar fields
            let db_item = db_entry.roadmap_items.get_mut(&incoming_item.id)
                .expect("roadmap item must exist: checked via contains_key above");

            // Second-to-last history item for improved stale detection
            let prev_prev_item = prev_prev_state.as_ref().and_then(|prev| {
                prev.roadmap_items.iter().find(|i| i.id == incoming_item.id)
            });

            // Helper: two-level stale check — if incoming matches last state but also
            // matched the state before that, treat it as an intentional revert, not stale.
            macro_rules! is_stale_item_field {
                ($field:ident) => {{
                    let matches_last = prev_item.is_some_and(|p| p.$field == incoming_item.$field);
                    if matches_last {
                        let was_stable_before = prev_prev_item
                            .is_some_and(|pp| pp.$field == incoming_item.$field);
                        !was_stable_before
                    } else {
                        false
                    }
                }};
            }

            if incoming_item.title != db_item.title {
                if !is_stale_item_field!(title) {
                    db_item.title = incoming_item.title.clone();
                    db_item.title_updated_at = ts;
                }
            }

            if !coupled_rejected && incoming_item.status != db_item.status {
                if !is_stale_item_field!(status) {
                    db_item.status = incoming_item.status.clone();
                    db_item.status_updated_at = ts;
                }
            }

            if incoming_item.next_action != db_item.next_action {
                if !is_stale_item_field!(next_action) {
                    db_item.next_action = incoming_item.next_action.clone();
                    db_item.next_action_updated_at = Some(ts);
                }
            }

            if incoming_item.tags != db_item.tags {
                if !is_stale_item_field!(tags) {
                    db_item.tags = incoming_item.tags.clone();
                    db_item.tags_updated_at = Some(ts);
                }
            }

            if incoming_item.icon != db_item.icon {
                if !is_stale_item_field!(icon) {
                    db_item.icon = incoming_item.icon.clone();
                    db_item.icon_updated_at = Some(ts);
                }
            }

            if incoming_item.blocked_by != db_item.blocked_by {
                if !is_stale_item_field!(blocked_by) {
                    db_item.blocked_by = incoming_item.blocked_by.clone();
                    db_item.blocked_by_updated_at = Some(ts);
                }
            }

            if incoming_item.spec_doc != db_item.spec_doc {
                if !is_stale_item_field!(spec_doc) {
                    db_item.spec_doc = incoming_item.spec_doc.clone();
                    db_item.spec_doc_updated_at = Some(ts);
                }
            }

            if incoming_item.plan_doc != db_item.plan_doc {
                if !is_stale_item_field!(plan_doc) {
                    db_item.plan_doc = incoming_item.plan_doc.clone();
                    db_item.plan_doc_updated_at = Some(ts);
                }
            }

            let completed_at_rejected = coupled_rejected
                || rejected_fields_set.contains(&format!("roadmapItems.{}.completedAt", incoming_item.id));
            if !completed_at_rejected && incoming_item.completed_at != db_item.completed_at {
                let is_stale = is_stale_item_field!(completed_at);
                if !is_stale {
                    db_item.completed_at = incoming_item.completed_at.clone();
                    db_item.completed_at_updated_at = Some(ts);
                }
            }
        } else {
            // New item — add to DB
            let new_db_item = DbRoadmapItem {
                id: incoming_item.id.clone(),
                title: incoming_item.title.clone(),
                title_updated_at: ts,
                status: incoming_item.status.clone(),
                status_updated_at: ts,
                priority: incoming_item.priority.unwrap_or(0),
                priority_updated_at: ts,
                next_action: incoming_item.next_action.clone(),
                next_action_updated_at: incoming_item.next_action.as_ref().map(|_| ts),
                tags: incoming_item.tags.clone(),
                tags_updated_at: incoming_item.tags.as_ref().map(|_| ts),
                icon: incoming_item.icon.clone(),
                icon_updated_at: incoming_item.icon.as_ref().map(|_| ts),
                blocked_by: incoming_item.blocked_by.clone(),
                blocked_by_updated_at: incoming_item.blocked_by.as_ref().map(|_| ts),
                spec_doc: incoming_item.spec_doc.clone(),
                spec_doc_updated_at: incoming_item.spec_doc.as_ref().map(|_| ts),
                plan_doc: incoming_item.plan_doc.clone(),
                plan_doc_updated_at: incoming_item.plan_doc.as_ref().map(|_| ts),
                completed_at: incoming_item.completed_at.clone(),
                completed_at_updated_at: incoming_item.completed_at.as_ref().map(|_| ts),
            };
            db_entry
                .roadmap_items
                .insert(incoming_item.id.clone(), new_db_item);
            applied.push(AppliedChange {
                field: format!("roadmapItems.{}", incoming_item.id),
                old_value: None,
                new_value: format!("new item: {}", incoming_item.title),
            });
        }
    }

    // Sync HLC counter if extra timestamps were generated beyond the initial batch
    // (the grow path extends from the last value without calling next_hlc)
    if let Some(&last_used) = timestamps.get(ts_idx.saturating_sub(1)) {
        if last_used > app_state.hlc_counter {
            app_state.hlc_counter = last_used;
            app_state.db.hlc_counter = last_used;
        }
    }

    // Mark DB as dirty for persistence
    app_state.mark_dirty();

    // Push pre-merge state into history for stale write detection.
    // History entries store the state BEFORE changes, so future merges can detect
    // when an agent's write is stale (matches a previous known state).
    if let Some(state) = pre_merge_state {
        let changed_fields: Vec<String> = applied.iter().map(|c| c.field.clone()).collect();
        let entry = HistoryEntry {
            timestamp: app_state.hlc_counter,
            source: HistorySource::Agent,
            changed_fields,
            state,
        };
        app_state.push_history(&pid, entry);
    }

    // Return merge results only (validation.applied_changes are informational diffs,
    // not actual mutations — including them would double-count changes)
    StateJsonValidationResult {
        applied_changes: applied,
        rejected_fields: validation.rejected_fields,
        warnings,
    }
}
