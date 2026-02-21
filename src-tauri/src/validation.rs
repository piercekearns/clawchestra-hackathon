//! validation.rs — Schema validation for state.json documents.
//!
//! Implements Phase 2.4: validate incoming state.json against schema rules.
//! Uses partial-apply (D4): valid fields accepted, invalid fields rejected.

use crate::state::{
    AppliedChange, RejectedField, StateJson, StateJsonRoadmapItem, StateJsonValidationResult,
};
use regex::Regex;
use std::collections::HashSet;

/// Current schema version supported by this version of Clawchestra.
pub const CURRENT_SCHEMA_VERSION: u32 = 1;

/// Maximum allowed file size for state.json (1MB).
pub const MAX_STATE_JSON_SIZE: u64 = 1_048_576;

/// Valid project statuses.
const VALID_PROJECT_STATUSES: &[&str] =
    &["in-progress", "up-next", "pending", "dormant", "archived"];

/// Valid roadmap item statuses.
const VALID_ROADMAP_STATUSES: &[&str] = &["pending", "up-next", "in-progress", "complete"];

// --- Field length limits ---
const MAX_PROJECT_TITLE_LEN: usize = 500;
const MAX_PROJECT_DESCRIPTION_LEN: usize = 20_000;
const MAX_PROJECT_PARENT_ID_LEN: usize = 128;
const MAX_PROJECT_TAGS: usize = 50;
const MAX_TAG_LEN: usize = 100;
const MAX_PROJECT_ID_LEN: usize = 128;
const MAX_ITEM_ID_LEN: usize = 128;
const MAX_ITEM_TITLE_LEN: usize = 500;
const MAX_ITEM_NEXT_ACTION_LEN: usize = 2_000;
const MAX_ITEM_STRING_FIELD_LEN: usize = 1_000; // specDoc, planDoc, blockedBy, icon
const MAX_ROADMAP_ITEMS: usize = 500;

/// Validate an incoming state.json document.
///
/// Returns a `StateJsonValidationResult` with lists of applied changes,
/// rejected fields, and warnings. The caller is responsible for applying
/// the changes to the DB.
pub fn validate_state_json(
    incoming: &StateJson,
    current: Option<&StateJson>,
) -> StateJsonValidationResult {
    let mut applied = Vec::new();
    let mut rejected = Vec::new();
    let mut warnings = Vec::new();

    // 1. Schema version check
    if incoming.schema_version > CURRENT_SCHEMA_VERSION {
        rejected.push(RejectedField {
            field: "_schemaVersion".to_string(),
            value: incoming.schema_version.to_string(),
            reason: format!(
                "Schema version {} is higher than max supported {}",
                incoming.schema_version, CURRENT_SCHEMA_VERSION
            ),
        });
        // Return early — cannot process a future schema
        return StateJsonValidationResult {
            applied_changes: applied,
            rejected_fields: rejected,
            warnings,
        };
    }

    // 2. Validate project.status
    if !VALID_PROJECT_STATUSES.contains(&incoming.project.status.as_str()) {
        rejected.push(RejectedField {
            field: "project.status".to_string(),
            value: incoming.project.status.clone(),
            reason: format!(
                "Invalid project status. Expected one of: {}",
                VALID_PROJECT_STATUSES.join(", ")
            ),
        });
    } else if let Some(curr) = current {
        if incoming.project.status != curr.project.status {
            applied.push(AppliedChange {
                field: "project.status".to_string(),
                old_value: Some(curr.project.status.clone()),
                new_value: incoming.project.status.clone(),
            });
        }
    }

    // 2b. Validate project.id format
    if !incoming.project.id.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_')
        || incoming.project.id.len() > MAX_PROJECT_ID_LEN
        || incoming.project.id.contains('\0')
    {
        rejected.push(RejectedField {
            field: "project.id".to_string(),
            value: incoming.project.id.clone(),
            reason: format!(
                "Project ID must be alphanumeric/hyphens/underscores and at most {} chars",
                MAX_PROJECT_ID_LEN
            ),
        });
    }

    // 3. Validate project.title
    if incoming.project.title.is_empty() {
        rejected.push(RejectedField {
            field: "project.title".to_string(),
            value: String::new(),
            reason: "Project title must not be empty".to_string(),
        });
    } else if incoming.project.title.len() > MAX_PROJECT_TITLE_LEN {
        rejected.push(RejectedField {
            field: "project.title".to_string(),
            value: format!("({} chars)", incoming.project.title.len()),
            reason: format!("Project title exceeds {} char limit", MAX_PROJECT_TITLE_LEN),
        });
    } else if let Some(curr) = current {
        if incoming.project.title != curr.project.title {
            applied.push(AppliedChange {
                field: "project.title".to_string(),
                old_value: Some(curr.project.title.clone()),
                new_value: incoming.project.title.clone(),
            });
        }
    }

    // 4. Validate project.description
    if incoming.project.description.len() > MAX_PROJECT_DESCRIPTION_LEN {
        rejected.push(RejectedField {
            field: "project.description".to_string(),
            value: format!("({} chars)", incoming.project.description.len()),
            reason: format!("Project description exceeds {} char limit", MAX_PROJECT_DESCRIPTION_LEN),
        });
    } else if let Some(curr) = current {
        if incoming.project.description != curr.project.description {
            applied.push(AppliedChange {
                field: "project.description".to_string(),
                old_value: Some(curr.project.description.clone()),
                new_value: incoming.project.description.clone(),
            });
        }
    }

    // 5. Validate project.tags
    if incoming.project.tags.len() > MAX_PROJECT_TAGS {
        rejected.push(RejectedField {
            field: "project.tags".to_string(),
            value: format!("{} tags", incoming.project.tags.len()),
            reason: format!("Tags array exceeds {} item limit", MAX_PROJECT_TAGS),
        });
    } else if incoming.project.tags.iter().any(|t| t.len() > MAX_TAG_LEN) {
        rejected.push(RejectedField {
            field: "project.tags".to_string(),
            value: "tag too long".to_string(),
            reason: format!("Each tag must be at most {} chars", MAX_TAG_LEN),
        });
    } else if let Some(curr) = current {
        if incoming.project.tags != curr.project.tags {
            applied.push(AppliedChange {
                field: "project.tags".to_string(),
                old_value: Some(format!("{:?}", curr.project.tags)),
                new_value: format!("{:?}", incoming.project.tags),
            });
        }
    }

    // 6. Validate project.parentId
    if incoming.project.parent_id.as_ref().is_some_and(|p| p.len() > MAX_PROJECT_PARENT_ID_LEN) {
        rejected.push(RejectedField {
            field: "project.parentId".to_string(),
            value: format!("({} chars)", incoming.project.parent_id.as_ref().unwrap().len()),
            reason: format!("parentId exceeds {} char limit", MAX_PROJECT_PARENT_ID_LEN),
        });
    } else if let Some(curr) = current {
        if incoming.project.parent_id != curr.project.parent_id {
            applied.push(AppliedChange {
                field: "project.parentId".to_string(),
                old_value: curr.project.parent_id.clone(),
                new_value: incoming
                    .project
                    .parent_id
                    .clone()
                    .unwrap_or_else(|| "null".to_string()),
            });
        }
    }

    // 7. Validate roadmap items
    if incoming.roadmap_items.len() > MAX_ROADMAP_ITEMS {
        rejected.push(RejectedField {
            field: "roadmapItems".to_string(),
            value: format!("{} items", incoming.roadmap_items.len()),
            reason: format!("Roadmap items exceed {} item limit", MAX_ROADMAP_ITEMS),
        });
        return StateJsonValidationResult {
            applied_changes: applied,
            rejected_fields: rejected,
            warnings,
        };
    }

    let date_re = Regex::new(r"^\d{4}-\d{2}-\d{2}$").expect("date regex");
    let mut seen_ids: HashSet<String> = HashSet::new();

    for item in &incoming.roadmap_items {
        // Empty id check
        if item.id.is_empty() {
            rejected.push(RejectedField {
                field: "roadmapItems[].id".to_string(),
                value: String::new(),
                reason: "Roadmap item id must not be empty".to_string(),
            });
            continue;
        }

        // Duplicate id check
        if !seen_ids.insert(item.id.clone()) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.id", item.id),
                value: item.id.clone(),
                reason: "Duplicate roadmap item id".to_string(),
            });
            continue;
        }

        // Item ID length check
        if item.id.len() > MAX_ITEM_ID_LEN {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.id", item.id),
                value: format!("({} chars)", item.id.len()),
                reason: format!("Item id exceeds {} char limit", MAX_ITEM_ID_LEN),
            });
            continue;
        }

        // Item field length checks
        if item.title.len() > MAX_ITEM_TITLE_LEN {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.title", item.id),
                value: format!("({} chars)", item.title.len()),
                reason: format!("Item title exceeds {} char limit", MAX_ITEM_TITLE_LEN),
            });
            continue;
        }
        if item.next_action.as_ref().is_some_and(|v| v.len() > MAX_ITEM_NEXT_ACTION_LEN) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.nextAction", item.id),
                value: format!("({} chars)", item.next_action.as_ref().unwrap().len()),
                reason: format!("nextAction exceeds {} char limit", MAX_ITEM_NEXT_ACTION_LEN),
            });
            continue;
        }
        if item.spec_doc.as_ref().is_some_and(|v| v.len() > MAX_ITEM_STRING_FIELD_LEN) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.specDoc", item.id),
                value: format!("({} chars)", item.spec_doc.as_ref().unwrap().len()),
                reason: format!("specDoc exceeds {} char limit", MAX_ITEM_STRING_FIELD_LEN),
            });
            continue;
        }
        if item.plan_doc.as_ref().is_some_and(|v| v.len() > MAX_ITEM_STRING_FIELD_LEN) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.planDoc", item.id),
                value: format!("({} chars)", item.plan_doc.as_ref().unwrap().len()),
                reason: format!("planDoc exceeds {} char limit", MAX_ITEM_STRING_FIELD_LEN),
            });
            continue;
        }
        if item.blocked_by.as_ref().is_some_and(|v| v.len() > MAX_ITEM_STRING_FIELD_LEN) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.blockedBy", item.id),
                value: format!("({} chars)", item.blocked_by.as_ref().unwrap().len()),
                reason: format!("blockedBy exceeds {} char limit", MAX_ITEM_STRING_FIELD_LEN),
            });
            continue;
        }
        if item.icon.as_ref().is_some_and(|v| v.len() > MAX_ITEM_STRING_FIELD_LEN) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.icon", item.id),
                value: format!("({} chars)", item.icon.as_ref().unwrap().len()),
                reason: format!("icon exceeds {} char limit", MAX_ITEM_STRING_FIELD_LEN),
            });
            continue;
        }
        // Item tags
        if let Some(tags) = &item.tags {
            if tags.len() > MAX_PROJECT_TAGS {
                rejected.push(RejectedField {
                    field: format!("roadmapItems.{}.tags", item.id),
                    value: format!("{} tags", tags.len()),
                    reason: format!("Tags array exceeds {} item limit", MAX_PROJECT_TAGS),
                });
                continue;
            }
            if tags.iter().any(|t| t.len() > MAX_TAG_LEN) {
                rejected.push(RejectedField {
                    field: format!("roadmapItems.{}.tags", item.id),
                    value: "tag too long".to_string(),
                    reason: format!("Each tag must be at most {} chars", MAX_TAG_LEN),
                });
                continue;
            }
        }

        // Validate status
        if !VALID_ROADMAP_STATUSES.contains(&item.status.as_str()) {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.status", item.id),
                value: item.status.clone(),
                reason: format!(
                    "Invalid roadmap item status. Expected one of: {}",
                    VALID_ROADMAP_STATUSES.join(", ")
                ),
            });
            continue;
        }

        // Coupled field validation: status + completedAt (D4)
        // On rejection, only the coupled fields (status + completedAt) are blocked from merge.
        // Other fields on the same item (title, tags, etc.) are still merged normally.
        if item.status == "complete" {
            match &item.completed_at {
                Some(date) if date_re.is_match(date) => {
                    // Valid complete + date pair
                }
                Some(bad_date) => {
                    rejected.push(RejectedField {
                        field: format!("roadmapItems.{}.status+completedAt", item.id),
                        value: format!("status=complete, completedAt={}", bad_date),
                        reason: "completedAt must be YYYY-MM-DD when status is complete"
                            .to_string(),
                    });
                }
                None => {
                    rejected.push(RejectedField {
                        field: format!("roadmapItems.{}.status+completedAt", item.id),
                        value: "status=complete, completedAt=null".to_string(),
                        reason: "completedAt is required when status is complete".to_string(),
                    });
                }
            }
        }

        // completedAt present but status is not complete: accept but warn
        if item.completed_at.is_some() && item.status != "complete" {
            warnings.push(format!(
                "roadmapItems.{}: completedAt is set but status is '{}' (not 'complete')",
                item.id, item.status
            ));
        }

        // Validate completedAt format (even if not coupled with complete status).
        // Only the completedAt field is rejected; other fields on the same item merge normally.
        if let Some(date) = &item.completed_at {
            if !date_re.is_match(date) {
                rejected.push(RejectedField {
                    field: format!("roadmapItems.{}.completedAt", item.id),
                    value: date.clone(),
                    reason: "completedAt must be in YYYY-MM-DD format".to_string(),
                });
            }
        }

        // Title must not be empty
        if item.title.is_empty() {
            rejected.push(RejectedField {
                field: format!("roadmapItems.{}.title", item.id),
                value: String::new(),
                reason: "Roadmap item title must not be empty".to_string(),
            });
            continue;
        }

        // Compare against current state for field-level diffs
        if let Some(curr) = current {
            let curr_item = curr.roadmap_items.iter().find(|i| i.id == item.id);
            record_item_changes(item, curr_item, &mut applied);
        } else {
            // No current state — all fields are new
            applied.push(AppliedChange {
                field: format!("roadmapItems.{}", item.id),
                old_value: None,
                new_value: format!("new item: {}", item.title),
            });
        }
    }

    StateJsonValidationResult {
        applied_changes: applied,
        rejected_fields: rejected,
        warnings,
    }
}

/// Record field-level changes between an incoming item and its current counterpart.
fn record_item_changes(
    incoming: &StateJsonRoadmapItem,
    current: Option<&StateJsonRoadmapItem>,
    applied: &mut Vec<AppliedChange>,
) {
    let Some(curr) = current else {
        // New item
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}", incoming.id),
            old_value: None,
            new_value: format!("new item: {}", incoming.title),
        });
        return;
    };

    let id = &incoming.id;

    if incoming.title != curr.title {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.title", id),
            old_value: Some(curr.title.clone()),
            new_value: incoming.title.clone(),
        });
    }
    if incoming.status != curr.status {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.status", id),
            old_value: Some(curr.status.clone()),
            new_value: incoming.status.clone(),
        });
    }
    if incoming.priority != curr.priority {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.priority", id),
            old_value: curr.priority.map(|p| p.to_string()),
            new_value: incoming
                .priority
                .map(|p| p.to_string())
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.next_action != curr.next_action {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.nextAction", id),
            old_value: curr.next_action.clone(),
            new_value: incoming
                .next_action
                .clone()
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.tags != curr.tags {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.tags", id),
            old_value: curr.tags.as_ref().map(|t| format!("{:?}", t)),
            new_value: incoming
                .tags
                .as_ref()
                .map(|t| format!("{:?}", t))
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.icon != curr.icon {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.icon", id),
            old_value: curr.icon.clone(),
            new_value: incoming
                .icon
                .clone()
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.blocked_by != curr.blocked_by {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.blockedBy", id),
            old_value: curr.blocked_by.clone(),
            new_value: incoming
                .blocked_by
                .clone()
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.spec_doc != curr.spec_doc {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.specDoc", id),
            old_value: curr.spec_doc.clone(),
            new_value: incoming
                .spec_doc
                .clone()
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.plan_doc != curr.plan_doc {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.planDoc", id),
            old_value: curr.plan_doc.clone(),
            new_value: incoming
                .plan_doc
                .clone()
                .unwrap_or_else(|| "null".to_string()),
        });
    }
    if incoming.completed_at != curr.completed_at {
        applied.push(AppliedChange {
            field: format!("roadmapItems.{}.completedAt", id),
            old_value: curr.completed_at.clone(),
            new_value: incoming
                .completed_at
                .clone()
                .unwrap_or_else(|| "null".to_string()),
        });
    }
}
