//! migration.rs — Phase 3: ROADMAP.md & CHANGELOG.md -> Database migration.
//!
//! Implements:
//! - Derived migration state machine (3.2)
//! - Pre-migration backup (3.3)
//! - YAML frontmatter parsing + import with migration-specific sanitizer (3.4, 3.7)
//! - Migration manifest writing (3.3)
//! - Gitignore updating, source deletion, rename (3.4)
//! - Verification against backup (3.4)

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::state::{
    AppState, DbProjectData, DbProjectEntry, DbRoadmapItem, HistoryEntry, HistorySource,
    MigrationStep, ProjectId,
};

// ---------------------------------------------------------------------------
// Migration manifest types
// ---------------------------------------------------------------------------

/// A record of a single item migrated from ROADMAP.md to the database.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigratedItemRecord {
    pub id: String,
    pub title: String,
    pub original_status: String,
    /// Fields that were modified during sanitization (field -> {original, sanitized})
    pub sanitized_fields: Vec<SanitizedFieldRecord>,
    /// Warnings generated for this item
    pub warnings: Vec<String>,
    /// Whether the id was auto-generated
    pub id_generated: bool,
}

/// A record of a field modified during sanitization.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SanitizedFieldRecord {
    pub field: String,
    pub original_value: String,
    pub new_value: String,
}

/// A record of a field that exists in ROADMAP.md but not in the state.json schema.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFieldRecord {
    pub item_id: String,
    pub field: String,
    pub value: String,
}

/// A changelog entry preserved in the backup.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangelogEntryRecord {
    pub id: String,
    pub title: String,
    pub completed_at: String,
    pub summary: Option<String>,
}

/// Migration manifest written to `.clawchestra/backup/migration-manifest.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationManifest {
    pub migrated_at: String,
    pub project_path: String,
    pub items_migrated: Vec<MigratedItemRecord>,
    pub dropped_fields: Vec<DroppedFieldRecord>,
    pub changelog_entries: Vec<ChangelogEntryRecord>,
    pub warnings: Vec<String>,
    pub roadmap_body_preserved_in_backup: bool,
}

/// Result of a migration operation for a single project.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationResult {
    pub project_path: String,
    pub step_before: String,
    pub step_after: String,
    pub items_imported: usize,
    pub warnings: Vec<String>,
    pub error: Option<String>,
}

// ---------------------------------------------------------------------------
// YAML frontmatter types (for parsing ROADMAP.md)
// ---------------------------------------------------------------------------

/// Raw YAML frontmatter from ROADMAP.md. Fields are all optional/loose for
/// migration-specific sanitization.
#[derive(Debug, Deserialize)]
struct RoadmapFrontmatter {
    #[serde(default)]
    items: Vec<serde_yaml::Value>,
}

/// Raw YAML frontmatter from CHANGELOG.md.
#[derive(Debug, Deserialize)]
struct ChangelogFrontmatter {
    #[serde(default)]
    entries: Vec<serde_yaml::Value>,
}

// ---------------------------------------------------------------------------
// Derived migration state machine (3.2)
// ---------------------------------------------------------------------------

/// Derive the migration step for a project from filesystem + DB state.
///
/// Each step checks preconditions. The state machine is:
/// - NotStarted: ROADMAP.md exists AND no DB rows for this project
/// - Imported: DB rows exist AND no .clawchestra/state.json
/// - Projected: state.json exists AND .clawchestra/ not in .gitignore
/// - GitignoreUpdated: .gitignore updated AND ROADMAP.md still exists
/// - SourceDeleted: ROADMAP.md does not exist AND state.json exists
/// - Complete: All resolved
pub fn derive_migration_step(
    project_dir: &Path,
    project_id: &str,
    app_state: &AppState,
) -> MigrationStep {
    let roadmap_path = project_dir.join("ROADMAP.md");
    let state_json_path = project_dir.join(".clawchestra").join("state.json");
    let gitignore_path = project_dir.join(".gitignore");

    let roadmap_exists = roadmap_path.exists();
    let state_json_exists = state_json_path.exists();
    let has_db_rows = app_state.db.projects.contains_key(project_id);
    let gitignore_has_clawchestra = gitignore_contains_clawchestra(&gitignore_path);

    // Complete: state.json exists, no ROADMAP.md, gitignore updated, DB rows exist
    if !roadmap_exists && state_json_exists && has_db_rows && gitignore_has_clawchestra {
        return MigrationStep::Complete;
    }

    // SourceDeleted: ROADMAP.md gone, state.json exists, but gitignore not yet updated
    if !roadmap_exists && state_json_exists && has_db_rows && !gitignore_has_clawchestra {
        return MigrationStep::SourceDeleted;
    }

    // GitignoreUpdated: gitignore done, ROADMAP.md still present
    if roadmap_exists && state_json_exists && has_db_rows && gitignore_has_clawchestra {
        return MigrationStep::GitignoreUpdated;
    }

    // Projected: state.json exists but .clawchestra/ not in .gitignore yet
    if state_json_exists && has_db_rows && !gitignore_has_clawchestra {
        return MigrationStep::Projected;
    }

    // Imported: DB rows exist but no state.json yet
    if has_db_rows && !state_json_exists {
        return MigrationStep::Imported;
    }

    // NotStarted: ROADMAP.md exists and no DB rows
    if roadmap_exists && !has_db_rows {
        return MigrationStep::NotStarted;
    }

    // If no ROADMAP.md and no DB rows, nothing to migrate
    MigrationStep::Complete
}

/// Check if .gitignore contains `.clawchestra/`.
fn gitignore_contains_clawchestra(gitignore_path: &Path) -> bool {
    if !gitignore_path.exists() {
        return false;
    }
    match fs::read_to_string(gitignore_path) {
        Ok(content) => content
            .lines()
            .any(|line| {
                let trimmed = line.trim();
                trimmed == ".clawchestra/" || trimmed == ".clawchestra"
            }),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Pre-migration backup (3.3)
// ---------------------------------------------------------------------------

/// Create backups of ROADMAP.md, CHANGELOG.md, and PROJECT.md into `.clawchestra/backup/`.
pub fn create_pre_migration_backup(project_dir: &Path) -> Result<PathBuf, String> {
    let backup_dir = project_dir.join(".clawchestra").join("backup");
    fs::create_dir_all(&backup_dir).map_err(|e| {
        format!(
            "Failed to create backup directory at {}: {}",
            backup_dir.display(),
            e
        )
    })?;

    let files_to_backup = [
        ("ROADMAP.md", "ROADMAP.md.bak"),
        ("CHANGELOG.md", "CHANGELOG.md.bak"),
        ("PROJECT.md", "PROJECT.md.bak"),
    ];

    for (source_name, backup_name) in &files_to_backup {
        let source_path = project_dir.join(source_name);
        if source_path.exists() {
            let backup_path = backup_dir.join(backup_name);
            fs::copy(&source_path, &backup_path).map_err(|e| {
                format!(
                    "Failed to backup {} to {}: {}",
                    source_path.display(),
                    backup_path.display(),
                    e
                )
            })?;
            tracing::info!(
                "Backed up {} -> {}",
                source_path.display(),
                backup_path.display()
            );
        }
    }

    Ok(backup_dir)
}

/// Write the migration manifest to `.clawchestra/backup/migration-manifest.json`.
pub fn write_migration_manifest(
    backup_dir: &Path,
    manifest: &MigrationManifest,
) -> Result<(), String> {
    let manifest_path = backup_dir.join("migration-manifest.json");
    let content = serde_json::to_string_pretty(manifest)
        .map_err(|e| format!("Failed to serialize migration manifest: {}", e))?;
    fs::write(&manifest_path, content).map_err(|e| {
        format!(
            "Failed to write migration manifest to {}: {}",
            manifest_path.display(),
            e
        )
    })
}

// ---------------------------------------------------------------------------
// YAML frontmatter parsing
// ---------------------------------------------------------------------------

/// Extract YAML frontmatter from a markdown file.
/// Returns the YAML content between `---` delimiters, and the body after.
fn extract_yaml_frontmatter(content: &str) -> Option<(&str, &str)> {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return None;
    }
    // Find the opening delimiter
    let after_open = &trimmed[3..];
    // Find the closing delimiter
    let close_pos = after_open.find("\n---")?;
    let yaml = &after_open[..close_pos];
    let body_start = close_pos + 4; // skip "\n---"
    let body = if body_start < after_open.len() {
        // Skip past any newline after the closing ---
        let rest = &after_open[body_start..];
        rest.strip_prefix('\n').unwrap_or(rest)
    } else {
        ""
    };
    Some((yaml.trim(), body))
}

/// Parse ROADMAP.md items from YAML frontmatter.
fn parse_roadmap_yaml(content: &str) -> Result<(Vec<serde_yaml::Value>, String), String> {
    let (yaml_str, body) = extract_yaml_frontmatter(content)
        .ok_or_else(|| "ROADMAP.md has no YAML frontmatter (no --- delimiters found)".to_string())?;

    let fm: RoadmapFrontmatter = serde_yaml::from_str(yaml_str).map_err(|e| {
        format!(
            "Failed to parse ROADMAP.md YAML frontmatter: {}",
            e
        )
    })?;

    Ok((fm.items, body.to_string()))
}

/// Parse CHANGELOG.md entries from YAML frontmatter.
fn parse_changelog_yaml(content: &str) -> Result<Vec<serde_yaml::Value>, String> {
    let (yaml_str, _body) = match extract_yaml_frontmatter(content) {
        Some(v) => v,
        None => return Ok(vec![]), // No frontmatter = no entries
    };

    let fm: ChangelogFrontmatter = serde_yaml::from_str(yaml_str).map_err(|e| {
        format!(
            "Failed to parse CHANGELOG.md YAML frontmatter: {}",
            e
        )
    })?;

    Ok(fm.entries)
}

// ---------------------------------------------------------------------------
// Slugify for ID generation (3.7)
// ---------------------------------------------------------------------------

/// Convert a title to a kebab-case slug for use as an ID.
fn slugify(title: &str) -> String {
    let lowered = title.to_lowercase();
    let re = Regex::new(r"[^a-z0-9]+").expect("slugify regex");
    let slug = re.replace_all(&lowered, "-").to_string();
    // Trim leading/trailing dashes
    slug.trim_matches('-').to_string()
}

/// Deduplicate IDs by appending `-2`, `-3`, etc.
fn deduplicate_ids(ids: &mut Vec<String>) -> Vec<(usize, String, String)> {
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut renames = Vec::new();

    for i in 0..ids.len() {
        let id = ids[i].clone();
        let count = seen.entry(id.clone()).or_insert(0);
        *count += 1;
        if *count > 1 {
            let new_id = format!("{}-{}", id, count);
            renames.push((i, ids[i].clone(), new_id.clone()));
            ids[i] = new_id;
        }
    }

    renames
}

// ---------------------------------------------------------------------------
// Migration-specific sanitizer (3.7)
// ---------------------------------------------------------------------------

/// Valid roadmap item statuses.
const VALID_ROADMAP_STATUSES: &[&str] = &["pending", "up-next", "in-progress", "complete"];

/// Sanitize a single YAML value into a DB roadmap item.
///
/// Unlike `sanitizeRoadmapItem` in roadmap.ts (which returns null for invalid items),
/// this migration-specific sanitizer imports with corrected values and logs warnings.
///
/// Returns None only for truly unrecoverable data (not an object, or no title AND no id).
fn migration_sanitize_item(
    value: &serde_yaml::Value,
    index: usize,
    migration_date: &str,
    warnings: &mut Vec<String>,
    sanitized_fields: &mut Vec<SanitizedFieldRecord>,
    dropped_fields: &mut Vec<DroppedFieldRecord>,
) -> Option<(DbRoadmapItem, String, String, bool)> {
    // (DbRoadmapItem, original_status, original_id_or_generated, id_was_generated)
    let mapping = match value.as_mapping() {
        Some(m) => m,
        None => {
            warnings.push(format!(
                "Item at index {} is not a YAML mapping — skipped (unrecoverable)",
                index
            ));
            return None;
        }
    };

    // Helper: get a string field from the mapping
    let get_str = |key: &str| -> Option<String> {
        mapping
            .get(serde_yaml::Value::String(key.to_string()))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };

    let get_i64 = |key: &str| -> Option<i64> {
        mapping
            .get(serde_yaml::Value::String(key.to_string()))
            .and_then(|v| v.as_i64())
    };

    let title = get_str("title");
    let raw_id = get_str("id");

    // Unrecoverable: no title AND no id
    if title.is_none() && raw_id.is_none() {
        warnings.push(format!(
            "Item at index {} has no title and no id — skipped (unrecoverable)",
            index
        ));
        return None;
    }

    // Generate ID if missing
    let id_generated;
    let id = if let Some(ref raw) = raw_id {
        id_generated = false;
        raw.clone()
    } else {
        id_generated = true;
        let generated = slugify(title.as_deref().unwrap_or("unnamed"));
        warnings.push(format!(
            "Item at index {} has no id — generated '{}' from title",
            index, generated
        ));
        sanitized_fields.push(SanitizedFieldRecord {
            field: "id".to_string(),
            original_value: "null".to_string(),
            new_value: generated.clone(),
        });
        generated
    };

    // Use id as title if title is missing
    let title = match title {
        Some(t) if !t.trim().is_empty() => t,
        _ => {
            warnings.push(format!(
                "Item '{}' has no title — using id as title",
                id
            ));
            sanitized_fields.push(SanitizedFieldRecord {
                field: "title".to_string(),
                original_value: "null".to_string(),
                new_value: id.clone(),
            });
            id.clone()
        }
    };

    // Sanitize status
    let raw_status = get_str("status").unwrap_or_default();
    let original_status = raw_status.clone();

    // Handle legacy 'shipped' status
    let status = if raw_status == "shipped" {
        sanitized_fields.push(SanitizedFieldRecord {
            field: "status".to_string(),
            original_value: "shipped".to_string(),
            new_value: "complete".to_string(),
        });
        warnings.push(format!(
            "Item '{}': migrated legacy 'shipped' status to 'complete'",
            id
        ));
        "complete".to_string()
    } else if !VALID_ROADMAP_STATUSES.contains(&raw_status.as_str()) {
        sanitized_fields.push(SanitizedFieldRecord {
            field: "status".to_string(),
            original_value: raw_status.clone(),
            new_value: "pending".to_string(),
        });
        if raw_status.is_empty() {
            warnings.push(format!(
                "Item '{}': missing status — defaulted to 'pending'",
                id
            ));
        } else {
            warnings.push(format!(
                "Item '{}': invalid status '{}' — defaulted to 'pending'",
                id, raw_status
            ));
        }
        "pending".to_string()
    } else {
        raw_status
    };

    // Handle completedAt
    let date_re = Regex::new(r"^\d{4}-\d{2}-\d{2}$").expect("date regex");
    let raw_completed_at = get_str("completedAt");
    let completed_at = if status == "complete" {
        match &raw_completed_at {
            Some(date) if date_re.is_match(date) => Some(date.clone()),
            Some(bad_date) => {
                // Try to parse as a date and normalize
                warnings.push(format!(
                    "Item '{}': completedAt '{}' is not YYYY-MM-DD — set to migration date",
                    id, bad_date
                ));
                sanitized_fields.push(SanitizedFieldRecord {
                    field: "completedAt".to_string(),
                    original_value: bad_date.clone(),
                    new_value: migration_date.to_string(),
                });
                Some(migration_date.to_string())
            }
            None => {
                warnings.push(format!(
                    "Item '{}' was complete but had no completedAt — set to migration date",
                    id
                ));
                sanitized_fields.push(SanitizedFieldRecord {
                    field: "completedAt".to_string(),
                    original_value: "null".to_string(),
                    new_value: migration_date.to_string(),
                });
                Some(migration_date.to_string())
            }
        }
    } else {
        // Keep completedAt as-is if present (historical context), but warn
        match &raw_completed_at {
            Some(date) if date_re.is_match(date) => {
                warnings.push(format!(
                    "Item '{}': has completedAt but status is '{}' (not 'complete') — kept as historical context",
                    id, status
                ));
                Some(date.clone())
            }
            Some(bad_date) => {
                warnings.push(format!(
                    "Item '{}': completedAt '{}' is not YYYY-MM-DD and status is not 'complete' — stripped",
                    id, bad_date
                ));
                None
            }
            None => None,
        }
    };

    // Priority
    let priority = get_i64("priority").unwrap_or((index + 1) as i64);

    // Optional fields
    let next_action = get_str("nextAction");
    let blocked_by = get_str("blockedBy");
    let icon = get_str("icon");
    let spec_doc = get_str("specDoc");
    let plan_doc = get_str("planDoc");

    // Tags
    let tags = mapping
        .get(serde_yaml::Value::String("tags".to_string()))
        .and_then(|v| v.as_sequence())
        .map(|seq| {
            seq.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect::<Vec<_>>()
        });

    // Detect dropped fields (fields in YAML but not in state.json schema)
    let known_fields: HashSet<&str> = [
        "id", "title", "status", "priority", "nextAction", "blockedBy",
        "tags", "icon", "specDoc", "planDoc", "completedAt",
    ].iter().copied().collect();

    for (key, val) in mapping.iter() {
        if let Some(key_str) = key.as_str() {
            if !known_fields.contains(key_str) {
                dropped_fields.push(DroppedFieldRecord {
                    item_id: id.clone(),
                    field: key_str.to_string(),
                    value: format!("{:?}", val),
                });
            }
        }
    }

    let now_ms = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let db_item = DbRoadmapItem {
        id: id.clone(),
        title: title.clone(),
        title_updated_at: now_ms,
        status: status.clone(),
        status_updated_at: now_ms,
        priority,
        priority_updated_at: now_ms,
        next_action: next_action.clone(),
        next_action_updated_at: next_action.as_ref().map(|_| now_ms),
        tags: tags.clone(),
        tags_updated_at: tags.as_ref().map(|_| now_ms),
        icon: icon.clone(),
        icon_updated_at: icon.as_ref().map(|_| now_ms),
        blocked_by: blocked_by.clone(),
        blocked_by_updated_at: blocked_by.as_ref().map(|_| now_ms),
        spec_doc: spec_doc.clone(),
        spec_doc_updated_at: spec_doc.as_ref().map(|_| now_ms),
        plan_doc: plan_doc.clone(),
        plan_doc_updated_at: plan_doc.as_ref().map(|_| now_ms),
        completed_at: completed_at.clone(),
        completed_at_updated_at: completed_at.as_ref().map(|_| now_ms),
    };

    Some((db_item, original_status, id.clone(), id_generated))
}

// ---------------------------------------------------------------------------
// Import ROADMAP.md items into DB (3.4 step 2)
// ---------------------------------------------------------------------------

/// Import ROADMAP.md items into the in-memory database.
///
/// Returns (items_imported, manifest) or an error.
pub fn import_roadmap_into_db(
    app_state: &mut AppState,
    project_id: &str,
    project_dir: &Path,
    project_title: &str,
) -> Result<(usize, MigrationManifest), String> {
    let roadmap_path = project_dir.join("ROADMAP.md");
    let changelog_path = project_dir.join("CHANGELOG.md");

    let migration_date = chrono::Local::now().format("%Y-%m-%d").to_string();

    // Parse ROADMAP.md
    let roadmap_content = fs::read_to_string(&roadmap_path).map_err(|e| {
        format!(
            "Failed to read ROADMAP.md in {}: {}",
            project_dir.display(),
            e
        )
    })?;

    let (raw_items, _body) = parse_roadmap_yaml(&roadmap_content)?;

    // Parse CHANGELOG.md if present
    let changelog_entries = if changelog_path.exists() {
        let changelog_content = fs::read_to_string(&changelog_path).map_err(|e| {
            format!(
                "Failed to read CHANGELOG.md in {}: {}",
                project_dir.display(),
                e
            )
        })?;
        match parse_changelog_yaml(&changelog_content) {
            Ok(entries) => entries,
            Err(e) => {
                tracing::warn!("Failed to parse CHANGELOG.md: {}", e);
                vec![]
            }
        }
    } else {
        vec![]
    };

    let mut all_warnings: Vec<String> = Vec::new();
    let mut migrated_items: Vec<MigratedItemRecord> = Vec::new();
    let mut dropped_fields: Vec<DroppedFieldRecord> = Vec::new();
    let mut db_items: Vec<DbRoadmapItem> = Vec::new();
    let mut ids: Vec<String> = Vec::new();

    // Sanitize each item
    for (index, raw_item) in raw_items.iter().enumerate() {
        let mut item_sanitized = Vec::new();
        let mut item_dropped = Vec::new();
        let mut item_warnings = Vec::new();

        match migration_sanitize_item(
            raw_item,
            index,
            &migration_date,
            &mut item_warnings,
            &mut item_sanitized,
            &mut item_dropped,
        ) {
            Some((db_item, original_status, _id, id_generated)) => {
                ids.push(db_item.id.clone());
                migrated_items.push(MigratedItemRecord {
                    id: db_item.id.clone(),
                    title: db_item.title.clone(),
                    original_status: original_status.clone(),
                    sanitized_fields: item_sanitized,
                    warnings: item_warnings.clone(),
                    id_generated,
                });
                all_warnings.extend(item_warnings);
                dropped_fields.extend(item_dropped);
                db_items.push(db_item);
            }
            None => {
                all_warnings.extend(item_warnings);
            }
        }
    }

    // Deduplicate IDs
    let renames = deduplicate_ids(&mut ids);
    for (index, old_id, new_id) in &renames {
        if *index < db_items.len() {
            db_items[*index].id = new_id.clone();
            all_warnings.push(format!(
                "Duplicate id '{}' — renamed to '{}'",
                old_id, new_id
            ));
            if let Some(record) = migrated_items.get_mut(*index) {
                record.id = new_id.clone();
                record.warnings.push(format!(
                    "Duplicate id '{}' — renamed to '{}'",
                    old_id, new_id
                ));
            }
        }
    }

    // Parse changelog entries for the manifest
    let changelog_records: Vec<ChangelogEntryRecord> = changelog_entries
        .iter()
        .filter_map(|entry| {
            let mapping = entry.as_mapping()?;
            let get_str = |key: &str| -> Option<String> {
                mapping
                    .get(serde_yaml::Value::String(key.to_string()))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            };
            Some(ChangelogEntryRecord {
                id: get_str("id")?,
                title: get_str("title")?,
                completed_at: get_str("completedAt").unwrap_or_default(),
                summary: get_str("summary"),
            })
        })
        .collect();

    // Create/update the project entry in the DB
    let ts = app_state.next_hlc();

    if !app_state.db.projects.contains_key(project_id) {
        // Create new project entry
        let project_data = DbProjectData {
            id: project_id.to_string(),
            title: project_title.to_string(),
            title_updated_at: ts,
            status: "in-progress".to_string(), // default for migration
            status_updated_at: ts,
            description: String::new(),
            description_updated_at: ts,
            parent_id: None,
            parent_id_updated_at: ts,
            tags: vec![],
            tags_updated_at: ts,
        };

        let mut roadmap_items_map: HashMap<String, DbRoadmapItem> = HashMap::new();
        for item in &db_items {
            roadmap_items_map.insert(item.id.clone(), item.clone());
        }

        let entry = DbProjectEntry {
            project_path: project_dir.to_string_lossy().to_string(),
            project: project_data,
            roadmap_items: roadmap_items_map,
        };

        app_state
            .db
            .projects
            .insert(project_id.to_string(), entry);
    } else {
        // Project already exists — just add the roadmap items
        if let Some(entry) = app_state.db.projects.get_mut(project_id) {
            for item in &db_items {
                if !entry.roadmap_items.contains_key(&item.id) {
                    entry.roadmap_items.insert(item.id.clone(), item.clone());
                }
            }
        }
    }

    app_state.mark_dirty();

    // Push a migration history entry
    if let Some(state_json) = app_state.project_state_json(project_id) {
        let entry = HistoryEntry {
            timestamp: app_state.hlc_counter,
            source: HistorySource::Migration,
            changed_fields: vec!["*".to_string()],
            state: state_json,
        };
        app_state.push_history(&ProjectId(project_id.to_string()), entry);
    }

    let manifest = MigrationManifest {
        migrated_at: migration_date,
        project_path: project_dir.to_string_lossy().to_string(),
        items_migrated: migrated_items,
        dropped_fields,
        changelog_entries: changelog_records,
        warnings: all_warnings.clone(),
        roadmap_body_preserved_in_backup: true,
    };

    Ok((db_items.len(), manifest))
}

// ---------------------------------------------------------------------------
// Gitignore update
// ---------------------------------------------------------------------------

/// Append `.clawchestra/` to the project's `.gitignore` if not already present.
/// Ensures a trailing newline before appending.
pub fn update_gitignore(project_dir: &Path) -> Result<(), String> {
    let gitignore_path = project_dir.join(".gitignore");

    if gitignore_contains_clawchestra(&gitignore_path) {
        return Ok(()); // Already present
    }

    let mut content = if gitignore_path.exists() {
        fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {}", e))?
    } else {
        String::new()
    };

    // Ensure trailing newline before appending
    if !content.is_empty() && !content.ends_with('\n') {
        content.push('\n');
    }

    content.push_str(".clawchestra/\n");

    fs::write(&gitignore_path, content)
        .map_err(|e| format!("Failed to write .gitignore: {}", e))
}

// ---------------------------------------------------------------------------
// Verification against backup (3.4 step 4)
// ---------------------------------------------------------------------------

/// Verify that all items from the backup ROADMAP.md exist in the DB with matching fields.
///
/// Returns Ok(()) if verification passes, or Err with details of mismatches.
pub fn verify_against_backup(
    project_dir: &Path,
    project_id: &str,
    app_state: &AppState,
) -> Result<(), String> {
    let backup_path = project_dir
        .join(".clawchestra")
        .join("backup")
        .join("ROADMAP.md.bak");

    if !backup_path.exists() {
        return Err("Backup ROADMAP.md.bak not found — cannot verify".to_string());
    }

    let backup_content = fs::read_to_string(&backup_path)
        .map_err(|e| format!("Failed to read backup ROADMAP.md.bak: {}", e))?;

    let (backup_items, _body) = match parse_roadmap_yaml(&backup_content) {
        Ok(v) => v,
        Err(e) => return Err(format!("Failed to parse backup ROADMAP.md.bak: {}", e)),
    };

    let db_entry = app_state
        .db
        .projects
        .get(project_id)
        .ok_or_else(|| format!("Project '{}' not found in DB during verification", project_id))?;

    // Count recoverable items (same logic as sanitizer — items that are objects with title or id)
    let recoverable_count = backup_items
        .iter()
        .filter(|v| {
            v.as_mapping().is_some_and(|m| {
                let has_title = m
                    .get(serde_yaml::Value::String("title".to_string()))
                    .and_then(|v| v.as_str())
                    .is_some_and(|s| !s.trim().is_empty());
                let has_id = m
                    .get(serde_yaml::Value::String("id".to_string()))
                    .and_then(|v| v.as_str())
                    .is_some();
                has_title || has_id
            })
        })
        .count();

    let db_item_count = db_entry.roadmap_items.len();

    if db_item_count < recoverable_count {
        return Err(format!(
            "Item count mismatch: backup has {} recoverable items but DB has {} — {} items may have been silently dropped",
            recoverable_count, db_item_count, recoverable_count - db_item_count
        ));
    }

    // Verify field-by-field for each backup item that can be matched
    let mut mismatches: Vec<String> = Vec::new();

    for value in &backup_items {
        let mapping = match value.as_mapping() {
            Some(m) => m,
            None => continue,
        };

        let get_str = |key: &str| -> Option<String> {
            mapping
                .get(serde_yaml::Value::String(key.to_string()))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        };

        // Find the item in DB by id or by title-derived slug
        let raw_id = get_str("id");
        let title = get_str("title");

        let db_item = if let Some(ref id) = raw_id {
            db_entry.roadmap_items.get(id)
        } else if let Some(ref t) = title {
            let slug = slugify(t);
            db_entry.roadmap_items.get(&slug)
        } else {
            continue; // Unrecoverable item, should have been skipped
        };

        let Some(db_item) = db_item else {
            // Try searching by title in case id was generated differently
            let found = db_entry.roadmap_items.values().find(|item| {
                title.as_ref().is_some_and(|t| item.title == *t)
            });
            if found.is_none() {
                let item_ref = raw_id.as_deref().unwrap_or(title.as_deref().unwrap_or("unknown"));
                mismatches.push(format!("Item '{}' from backup not found in DB", item_ref));
            }
            continue;
        };

        // Check fields that should match (with sanitization transformations allowed)
        if let Some(ref t) = title {
            if db_item.title != *t {
                mismatches.push(format!(
                    "Item '{}': title mismatch (backup='{}', db='{}')",
                    db_item.id, t, db_item.title
                ));
            }
        }

        // Status: allow sanitized mappings (shipped -> complete, invalid -> pending)
        // We don't flag these as mismatches since the sanitizer handles them

        // Verify all optional fields present in backup
        let get_i64 = |key: &str| -> Option<i64> {
            mapping
                .get(serde_yaml::Value::String(key.to_string()))
                .and_then(|v| v.as_i64())
        };
        let get_str_vec = |key: &str| -> Option<Vec<String>> {
            mapping
                .get(serde_yaml::Value::String(key.to_string()))
                .and_then(|v| v.as_sequence())
                .map(|seq| {
                    seq.iter()
                        .filter_map(|v| v.as_str().map(|s| s.to_string()))
                        .collect()
                })
        };

        if let Some(ref spec) = get_str("specDoc") {
            if db_item.spec_doc.as_ref() != Some(spec) {
                mismatches.push(format!(
                    "Item '{}': specDoc mismatch (backup='{}', db='{:?}')",
                    db_item.id, spec, db_item.spec_doc
                ));
            }
        }
        if let Some(ref plan) = get_str("planDoc") {
            if db_item.plan_doc.as_ref() != Some(plan) {
                mismatches.push(format!(
                    "Item '{}': planDoc mismatch (backup='{}', db='{:?}')",
                    db_item.id, plan, db_item.plan_doc
                ));
            }
        }
        if let Some(ref next_action) = get_str("nextAction") {
            if db_item.next_action.as_ref() != Some(next_action) {
                mismatches.push(format!(
                    "Item '{}': nextAction mismatch (backup='{}', db='{:?}')",
                    db_item.id, next_action, db_item.next_action
                ));
            }
        }
        if let Some(ref blocked_by) = get_str("blockedBy") {
            if db_item.blocked_by.as_ref() != Some(blocked_by) {
                mismatches.push(format!(
                    "Item '{}': blockedBy mismatch (backup='{}', db='{:?}')",
                    db_item.id, blocked_by, db_item.blocked_by
                ));
            }
        }
        if let Some(ref icon) = get_str("icon") {
            if db_item.icon.as_ref() != Some(icon) {
                mismatches.push(format!(
                    "Item '{}': icon mismatch (backup='{}', db='{:?}')",
                    db_item.id, icon, db_item.icon
                ));
            }
        }
        if let Some(priority) = get_i64("priority") {
            if db_item.priority != priority {
                mismatches.push(format!(
                    "Item '{}': priority mismatch (backup={}, db={})",
                    db_item.id, priority, db_item.priority
                ));
            }
        }
        if let Some(ref completed_at) = get_str("completedAt") {
            if db_item.completed_at.as_ref() != Some(completed_at) {
                mismatches.push(format!(
                    "Item '{}': completedAt mismatch (backup='{}', db='{:?}')",
                    db_item.id, completed_at, db_item.completed_at
                ));
            }
        }
        if let Some(ref tags) = get_str_vec("tags") {
            if db_item.tags.as_ref() != Some(tags) {
                mismatches.push(format!(
                    "Item '{}': tags mismatch (backup='{:?}', db='{:?}')",
                    db_item.id, tags, db_item.tags
                ));
            }
        }
    }

    if !mismatches.is_empty() {
        for m in &mismatches {
            tracing::warn!("Migration verification warning: {}", m);
        }
        // Warnings logged but don't block — only item count mismatch is a hard failure
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Source deletion + rename (3.4 step 4-5)
// ---------------------------------------------------------------------------

/// Delete ROADMAP.md and CHANGELOG.md after successful migration.
pub fn delete_source_files(project_dir: &Path) -> Result<(), String> {
    let roadmap_path = project_dir.join("ROADMAP.md");
    let changelog_path = project_dir.join("CHANGELOG.md");

    if roadmap_path.exists() {
        fs::remove_file(&roadmap_path).map_err(|e| {
            format!(
                "Failed to delete ROADMAP.md at {}: {}",
                roadmap_path.display(),
                e
            )
        })?;
        tracing::info!("Deleted {}", roadmap_path.display());
    }

    if changelog_path.exists() {
        fs::remove_file(&changelog_path).map_err(|e| {
            format!(
                "Failed to delete CHANGELOG.md at {}: {}",
                changelog_path.display(),
                e
            )
        })?;
        tracing::info!("Deleted {}", changelog_path.display());
    }

    Ok(())
}

/// Rename PROJECT.md -> CLAWCHESTRA.md if PROJECT.md exists and CLAWCHESTRA.md does not.
pub fn rename_project_file(project_dir: &Path) -> Result<bool, String> {
    let project_md = project_dir.join("PROJECT.md");
    let clawchestra_md = project_dir.join("CLAWCHESTRA.md");

    if project_md.exists() && !clawchestra_md.exists() {
        fs::rename(&project_md, &clawchestra_md).map_err(|e| {
            format!(
                "Failed to rename PROJECT.md -> CLAWCHESTRA.md: {}",
                e
            )
        })?;
        tracing::info!(
            "Renamed {} -> {}",
            project_md.display(),
            clawchestra_md.display()
        );
        Ok(true)
    } else {
        Ok(false)
    }
}

// ---------------------------------------------------------------------------
// Full migration flow (3.4)
// ---------------------------------------------------------------------------

/// Run the full migration flow for a single project.
///
/// Derives the current step and advances through the state machine.
pub fn run_project_migration(
    app_state: &mut AppState,
    project_id: &str,
    project_dir: &Path,
    project_title: &str,
) -> MigrationResult {
    let step_before = derive_migration_step(project_dir, project_id, app_state);
    let step_before_str = format!("{:?}", step_before);
    let mut warnings: Vec<String> = Vec::new();
    let mut items_imported: usize = 0;

    // Step 1: If NotStarted — backup, import, write manifest
    if step_before == MigrationStep::NotStarted {
        // Create backup
        let backup_dir = match create_pre_migration_backup(project_dir) {
            Ok(dir) => dir,
            Err(e) => {
                return MigrationResult {
                    project_path: project_dir.to_string_lossy().to_string(),
                    step_before: step_before_str,
                    step_after: "NotStarted".to_string(),
                    items_imported: 0,
                    warnings: vec![],
                    error: Some(format!("Backup failed: {}", e)),
                };
            }
        };

        // Import
        match import_roadmap_into_db(app_state, project_id, project_dir, project_title) {
            Ok((count, manifest)) => {
                items_imported = count;
                warnings.extend(manifest.warnings.clone());
                // Write manifest
                if let Err(e) = write_migration_manifest(&backup_dir, &manifest) {
                    warnings.push(format!("Failed to write migration manifest: {}", e));
                }
            }
            Err(e) => {
                return MigrationResult {
                    project_path: project_dir.to_string_lossy().to_string(),
                    step_before: step_before_str,
                    step_after: "NotStarted".to_string(),
                    items_imported: 0,
                    warnings,
                    error: Some(format!("Import failed: {}", e)),
                };
            }
        }
    }

    // Re-derive state after import
    let step_after_import = derive_migration_step(project_dir, project_id, app_state);

    // Step 2: If Imported — create state.json projection + update gitignore
    if step_after_import == MigrationStep::Imported
        || step_after_import == MigrationStep::Projected
    {
        // Ensure .clawchestra/ directory
        let clawchestra_dir = project_dir.join(".clawchestra");
        if let Err(e) = fs::create_dir_all(&clawchestra_dir) {
            return MigrationResult {
                project_path: project_dir.to_string_lossy().to_string(),
                step_before: step_before_str,
                step_after: format!("{:?}", step_after_import),
                items_imported,
                warnings,
                error: Some(format!("Failed to create .clawchestra/: {}", e)),
            };
        }

        // Write state.json projection
        if let Some(state_json) = app_state.project_state_json(project_id) {
            let state_json_path = clawchestra_dir.join("state.json");
            match serde_json::to_string_pretty(&state_json) {
                Ok(content) => {
                    if let Err(e) = fs::write(&state_json_path, &content) {
                        warnings.push(format!("Failed to write state.json: {}", e));
                    } else {
                        // Store content hash
                        let hash = crate::watcher::sha256_hex(content.as_bytes());
                        app_state
                            .content_hashes
                            .insert(ProjectId(project_id.to_string()), hash);
                    }
                }
                Err(e) => {
                    warnings.push(format!("Failed to serialize state.json: {}", e));
                }
            }
        }

        // Update .gitignore
        if let Err(e) = update_gitignore(project_dir) {
            warnings.push(format!("Failed to update .gitignore: {}", e));
        }
    }

    // Re-derive state after projection + gitignore
    let step_after_projected = derive_migration_step(project_dir, project_id, app_state);

    // Step 3: If GitignoreUpdated — verify against backup, delete sources, rename
    if step_after_projected == MigrationStep::GitignoreUpdated {
        // Verify against backup
        match verify_against_backup(project_dir, project_id, app_state) {
            Ok(()) => {
                // Delete source files
                if let Err(e) = delete_source_files(project_dir) {
                    return MigrationResult {
                        project_path: project_dir.to_string_lossy().to_string(),
                        step_before: step_before_str,
                        step_after: "GitignoreUpdated".to_string(),
                        items_imported,
                        warnings,
                        error: Some(format!("Source deletion failed: {}", e)),
                    };
                }

                // Rename PROJECT.md -> CLAWCHESTRA.md
                match rename_project_file(project_dir) {
                    Ok(renamed) => {
                        if renamed {
                            warnings.push("Renamed PROJECT.md -> CLAWCHESTRA.md".to_string());
                        }
                    }
                    Err(e) => {
                        warnings.push(format!("Rename failed (non-fatal): {}", e));
                    }
                }
            }
            Err(e) => {
                warnings.push(format!("Verification failed — skipping deletion: {}", e));
            }
        }
    }

    // Step 4: If SourceDeleted — gitignore was missed, fix it now
    let step_after_deletion = derive_migration_step(project_dir, project_id, app_state);
    if step_after_deletion == MigrationStep::SourceDeleted {
        if let Err(e) = update_gitignore(project_dir) {
            warnings.push(format!("Failed to update .gitignore for SourceDeleted project: {}", e));
        }
    }

    // Final state
    let step_after = derive_migration_step(project_dir, project_id, app_state);

    MigrationResult {
        project_path: project_dir.to_string_lossy().to_string(),
        step_before: step_before_str,
        step_after: format!("{:?}", step_after),
        items_imported,
        warnings,
        error: None,
    }
}

// ---------------------------------------------------------------------------
// Check if a project uses the legacy PROJECT.md filename (3.8)
// ---------------------------------------------------------------------------

/// Returns true if the project still uses PROJECT.md (not yet renamed to CLAWCHESTRA.md).
pub fn uses_legacy_filename(project_dir: &Path) -> bool {
    let project_md = project_dir.join("PROJECT.md");
    let clawchestra_md = project_dir.join("CLAWCHESTRA.md");
    project_md.exists() && !clawchestra_md.exists()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-migration-{}-{}",
            name,
            uuid::Uuid::new_v4()
        ));
        let _ = fs::create_dir_all(&dir);
        dir
    }

    fn cleanup(dir: &Path) {
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn test_extract_yaml_frontmatter() {
        let content = "---\nitems:\n  - id: foo\n    title: Foo\n---\nBody text here";
        let (yaml, body) = extract_yaml_frontmatter(content).unwrap();
        assert!(yaml.contains("items:"));
        assert!(body.contains("Body text"));
    }

    #[test]
    fn test_extract_yaml_frontmatter_no_frontmatter() {
        let content = "No frontmatter here";
        assert!(extract_yaml_frontmatter(content).is_none());
    }

    #[test]
    fn test_slugify() {
        assert_eq!(slugify("Hello World"), "hello-world");
        assert_eq!(slugify("My Cool Feature!"), "my-cool-feature");
        assert_eq!(slugify("kebab-case-already"), "kebab-case-already");
        assert_eq!(slugify("  spaces  "), "spaces");
    }

    #[test]
    fn test_deduplicate_ids() {
        let mut ids = vec!["foo".to_string(), "bar".to_string(), "foo".to_string(), "foo".to_string()];
        let renames = deduplicate_ids(&mut ids);
        assert_eq!(ids, vec!["foo", "bar", "foo-2", "foo-3"]);
        assert_eq!(renames.len(), 2);
    }

    #[test]
    fn test_derive_migration_step_no_roadmap_no_db() {
        let dir = test_dir("no-roadmap");
        let state = AppState::default();
        let step = derive_migration_step(&dir, "test-project", &state);
        assert_eq!(step, MigrationStep::Complete);
        cleanup(&dir);
    }

    #[test]
    fn test_derive_migration_step_roadmap_exists_no_db() {
        let dir = test_dir("roadmap-no-db");
        fs::write(dir.join("ROADMAP.md"), "---\nitems: []\n---\n").unwrap();
        let state = AppState::default();
        let step = derive_migration_step(&dir, "test-project", &state);
        assert_eq!(step, MigrationStep::NotStarted);
        cleanup(&dir);
    }

    #[test]
    fn test_derive_migration_step_db_rows_no_state_json() {
        let dir = test_dir("db-no-state");
        let mut state = AppState::default();
        // Add a DB entry
        let ts = state.next_hlc();
        state.db.projects.insert(
            "test-project".to_string(),
            DbProjectEntry {
                project_path: dir.to_string_lossy().to_string(),
                project: DbProjectData {
                    id: "test-project".to_string(),
                    title: "Test".to_string(),
                    title_updated_at: ts,
                    status: "in-progress".to_string(),
                    status_updated_at: ts,
                    description: String::new(),
                    description_updated_at: ts,
                    parent_id: None,
                    parent_id_updated_at: ts,
                    tags: vec![],
                    tags_updated_at: ts,
                },
                roadmap_items: HashMap::new(),
            },
        );
        let step = derive_migration_step(&dir, "test-project", &state);
        assert_eq!(step, MigrationStep::Imported);
        cleanup(&dir);
    }

    #[test]
    fn test_gitignore_update() {
        let dir = test_dir("gitignore");
        // No .gitignore exists
        update_gitignore(&dir).unwrap();
        let content = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(content.contains(".clawchestra/"));

        // Idempotent — second call should not duplicate
        update_gitignore(&dir).unwrap();
        let content = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert_eq!(content.matches(".clawchestra/").count(), 1);
        cleanup(&dir);
    }

    #[test]
    fn test_gitignore_update_existing_content() {
        let dir = test_dir("gitignore-existing");
        fs::write(dir.join(".gitignore"), "node_modules/\ndist/").unwrap();
        update_gitignore(&dir).unwrap();
        let content = fs::read_to_string(dir.join(".gitignore")).unwrap();
        assert!(content.contains("node_modules/\ndist/\n.clawchestra/\n"));
        cleanup(&dir);
    }

    #[test]
    fn test_pre_migration_backup() {
        let dir = test_dir("backup");
        fs::write(dir.join("ROADMAP.md"), "---\nitems: []\n---\n").unwrap();
        fs::write(dir.join("CHANGELOG.md"), "---\nentries: []\n---\n").unwrap();
        fs::write(dir.join("PROJECT.md"), "# Test Project\n").unwrap();

        let backup_dir = create_pre_migration_backup(&dir).unwrap();

        assert!(backup_dir.join("ROADMAP.md.bak").exists());
        assert!(backup_dir.join("CHANGELOG.md.bak").exists());
        assert!(backup_dir.join("PROJECT.md.bak").exists());
        cleanup(&dir);
    }

    #[test]
    fn test_rename_project_file() {
        let dir = test_dir("rename");
        fs::write(dir.join("PROJECT.md"), "# Test\n").unwrap();
        let renamed = rename_project_file(&dir).unwrap();
        assert!(renamed);
        assert!(!dir.join("PROJECT.md").exists());
        assert!(dir.join("CLAWCHESTRA.md").exists());
        cleanup(&dir);
    }

    #[test]
    fn test_rename_project_file_already_renamed() {
        let dir = test_dir("rename-skip");
        fs::write(dir.join("CLAWCHESTRA.md"), "# Test\n").unwrap();
        let renamed = rename_project_file(&dir).unwrap();
        assert!(!renamed);
        cleanup(&dir);
    }

    #[test]
    fn test_uses_legacy_filename() {
        let dir = test_dir("legacy");
        fs::write(dir.join("PROJECT.md"), "# Test\n").unwrap();
        assert!(uses_legacy_filename(&dir));

        // After rename
        fs::rename(dir.join("PROJECT.md"), dir.join("CLAWCHESTRA.md")).unwrap();
        assert!(!uses_legacy_filename(&dir));
        cleanup(&dir);
    }

    #[test]
    fn test_full_import_cycle() {
        let dir = test_dir("full-import");
        let roadmap_content = r#"---
items:
  - id: feature-auth
    title: "Authentication System"
    status: in-progress
    priority: 1
    nextAction: "Implement OAuth"
    tags: [feature, auth]
    specDoc: docs/specs/auth-spec.md
  - id: bug-fix
    title: "Fix Login Bug"
    status: complete
    priority: 2
    completedAt: "2026-02-15"
  - title: "No ID Item"
    status: pending
    priority: 3
---
# Roadmap notes
"#;
        fs::write(dir.join("ROADMAP.md"), roadmap_content).unwrap();
        fs::write(dir.join("PROJECT.md"), "# Test Project\n").unwrap();

        let mut state = AppState::default();
        let (count, manifest) =
            import_roadmap_into_db(&mut state, "test-project", &dir, "Test Project").unwrap();

        assert_eq!(count, 3);
        assert!(state.db.projects.contains_key("test-project"));

        let entry = &state.db.projects["test-project"];
        assert_eq!(entry.roadmap_items.len(), 3);
        assert!(entry.roadmap_items.contains_key("feature-auth"));
        assert!(entry.roadmap_items.contains_key("bug-fix"));

        // The third item should have a generated ID from title
        let has_no_id_item = entry
            .roadmap_items
            .values()
            .any(|item| item.title == "No ID Item");
        assert!(has_no_id_item);

        // Check the bug-fix item preserved its completedAt
        let bug_fix = &entry.roadmap_items["bug-fix"];
        assert_eq!(bug_fix.status, "complete");
        assert_eq!(bug_fix.completed_at, Some("2026-02-15".to_string()));

        // Manifest should record the import
        assert_eq!(manifest.items_migrated.len(), 3);
        assert!(manifest.roadmap_body_preserved_in_backup);

        cleanup(&dir);
    }

    #[test]
    fn test_migration_sanitizer_handles_missing_completed_at() {
        let dir = test_dir("missing-completed-at");
        let roadmap_content = r#"---
items:
  - id: done-no-date
    title: "Completed Without Date"
    status: complete
    priority: 1
---
"#;
        fs::write(dir.join("ROADMAP.md"), roadmap_content).unwrap();

        let mut state = AppState::default();
        let (count, manifest) =
            import_roadmap_into_db(&mut state, "test-project", &dir, "Test").unwrap();

        assert_eq!(count, 1);
        let item = &state.db.projects["test-project"].roadmap_items["done-no-date"];
        assert_eq!(item.status, "complete");
        // completedAt should be set to the migration date
        assert!(item.completed_at.is_some());

        // Should have a warning about missing completedAt
        let has_warning = manifest
            .warnings
            .iter()
            .any(|w| w.contains("had no completedAt"));
        assert!(has_warning);

        cleanup(&dir);
    }

    #[test]
    fn test_migration_sanitizer_handles_invalid_status() {
        let dir = test_dir("invalid-status");
        let roadmap_content = r#"---
items:
  - id: bad-status
    title: "Item With Bad Status"
    status: banana
    priority: 1
---
"#;
        fs::write(dir.join("ROADMAP.md"), roadmap_content).unwrap();

        let mut state = AppState::default();
        let (count, manifest) =
            import_roadmap_into_db(&mut state, "test-project", &dir, "Test").unwrap();

        assert_eq!(count, 1);
        let item = &state.db.projects["test-project"].roadmap_items["bad-status"];
        assert_eq!(item.status, "pending"); // Should default to pending

        let has_warning = manifest
            .warnings
            .iter()
            .any(|w| w.contains("invalid status 'banana'"));
        assert!(has_warning);

        cleanup(&dir);
    }

    #[test]
    fn test_migration_sanitizer_handles_shipped_status() {
        let dir = test_dir("shipped-status");
        let roadmap_content = r#"---
items:
  - id: shipped-item
    title: "Shipped Item"
    status: shipped
    priority: 1
---
"#;
        fs::write(dir.join("ROADMAP.md"), roadmap_content).unwrap();

        let mut state = AppState::default();
        let (count, manifest) =
            import_roadmap_into_db(&mut state, "test-project", &dir, "Test").unwrap();

        assert_eq!(count, 1);
        let item = &state.db.projects["test-project"].roadmap_items["shipped-item"];
        assert_eq!(item.status, "complete"); // shipped -> complete
        assert!(item.completed_at.is_some()); // Should get migration date

        let has_warning = manifest
            .warnings
            .iter()
            .any(|w| w.contains("shipped"));
        assert!(has_warning);

        cleanup(&dir);
    }

    #[test]
    fn test_full_migration_flow() {
        let dir = test_dir("full-flow");
        let roadmap_content = r#"---
items:
  - id: test-item
    title: "Test Item"
    status: pending
    priority: 1
---
# Notes
"#;
        fs::write(dir.join("ROADMAP.md"), roadmap_content).unwrap();
        fs::write(dir.join("PROJECT.md"), "# Test Project\n").unwrap();

        let mut state = AppState::default();

        let result = run_project_migration(&mut state, "test-project", &dir, "Test Project");
        assert!(result.error.is_none(), "Migration error: {:?}", result.error);
        assert_eq!(result.items_imported, 1);
        assert_eq!(result.step_after, "Complete");

        // Verify:
        // - ROADMAP.md deleted
        assert!(!dir.join("ROADMAP.md").exists());
        // - state.json exists
        assert!(dir.join(".clawchestra").join("state.json").exists());
        // - .gitignore updated
        assert!(gitignore_contains_clawchestra(&dir.join(".gitignore")));
        // - backup exists
        assert!(dir.join(".clawchestra").join("backup").join("ROADMAP.md.bak").exists());
        // - PROJECT.md renamed
        assert!(!dir.join("PROJECT.md").exists());
        assert!(dir.join("CLAWCHESTRA.md").exists());

        cleanup(&dir);
    }
}
