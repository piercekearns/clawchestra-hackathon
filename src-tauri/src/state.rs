//! state.rs — Type definitions for the Clawchestra state system.
//!
//! Defines:
//! - `StateJson` — per-project .clawchestra/state.json structure (serde)
//! - `AppState` — runtime in-memory state (Arc<Mutex<...>> inner type)
//! - `MigrationStep` — derived (not persisted) migration state machine
//! - Branded newtype: `ProjectId`
//! - `HistoryEntry` — state history buffer entry
//!
//! Phase 1.3 of the Architecture Direction plan.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::time::SystemTime;

// ---------------------------------------------------------------------------
// Branded newtypes
// ---------------------------------------------------------------------------

/// A project identifier (kebab-case slug derived from project title or folder name).
/// Wraps a String to prevent accidental mixing with arbitrary strings.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ProjectId(pub String);

impl ProjectId {
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for ProjectId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

// ---------------------------------------------------------------------------
// state.json schema (per-project, agent-facing)
// ---------------------------------------------------------------------------

/// The project metadata section of state.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJsonProject {
    pub id: String,
    pub title: String,
    pub status: String, // validated: in-progress | up-next | pending | dormant | archived
    pub description: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
}

/// A single roadmap item in state.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJsonRoadmapItem {
    pub id: String,
    pub title: String,
    pub status: String, // validated: pending | up-next | in-progress | complete
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub next_action: Option<String>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub blocked_by: Option<String>,
    #[serde(default)]
    pub spec_doc: Option<String>,
    #[serde(default)]
    pub plan_doc: Option<String>,
    #[serde(default)]
    pub completed_at: Option<String>, // validated: YYYY-MM-DD or null
}

/// The full per-project state.json document.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJson {
    #[serde(rename = "_schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "_generatedAt")]
    pub generated_at: u64,
    #[serde(rename = "_generatedBy")]
    pub generated_by: String,
    pub project: StateJsonProject,
    #[serde(rename = "roadmapItems")]
    pub roadmap_items: Vec<StateJsonRoadmapItem>,
}

// ---------------------------------------------------------------------------
// db.json schema (global, all projects)
// ---------------------------------------------------------------------------

/// Per-field timestamped project data in db.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbProjectData {
    pub id: String,
    pub title: String,
    #[serde(rename = "title__updatedAt")]
    pub title_updated_at: u64,
    pub status: String,
    #[serde(rename = "status__updatedAt")]
    pub status_updated_at: u64,
    pub description: String,
    #[serde(rename = "description__updatedAt")]
    pub description_updated_at: u64,
    #[serde(default)]
    pub parent_id: Option<String>,
    #[serde(rename = "parentId__updatedAt")]
    pub parent_id_updated_at: u64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(rename = "tags__updatedAt")]
    pub tags_updated_at: u64,
}

/// Per-field timestamped roadmap item in db.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbRoadmapItem {
    pub id: String,
    pub title: String,
    #[serde(rename = "title__updatedAt")]
    pub title_updated_at: u64,
    pub status: String,
    #[serde(rename = "status__updatedAt")]
    pub status_updated_at: u64,
    pub priority: i64,
    #[serde(rename = "priority__updatedAt")]
    pub priority_updated_at: u64,
    #[serde(default, rename = "nextAction")]
    pub next_action: Option<String>,
    #[serde(default, rename = "nextAction__updatedAt")]
    pub next_action_updated_at: Option<u64>,
    #[serde(default)]
    pub tags: Option<Vec<String>>,
    #[serde(default, rename = "tags__updatedAt")]
    pub tags_updated_at: Option<u64>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default, rename = "icon__updatedAt")]
    pub icon_updated_at: Option<u64>,
    #[serde(default, rename = "blockedBy")]
    pub blocked_by: Option<String>,
    #[serde(default, rename = "blockedBy__updatedAt")]
    pub blocked_by_updated_at: Option<u64>,
    #[serde(default, rename = "specDoc")]
    pub spec_doc: Option<String>,
    #[serde(default, rename = "specDoc__updatedAt")]
    pub spec_doc_updated_at: Option<u64>,
    #[serde(default, rename = "planDoc")]
    pub plan_doc: Option<String>,
    #[serde(default, rename = "planDoc__updatedAt")]
    pub plan_doc_updated_at: Option<u64>,
    #[serde(default, rename = "specDocBranch")]
    pub spec_doc_branch: Option<String>,
    #[serde(default, rename = "specDocBranch__updatedAt")]
    pub spec_doc_branch_updated_at: Option<u64>,
    #[serde(default, rename = "planDocBranch")]
    pub plan_doc_branch: Option<String>,
    #[serde(default, rename = "planDocBranch__updatedAt")]
    pub plan_doc_branch_updated_at: Option<u64>,
    #[serde(default, rename = "completedAt")]
    pub completed_at: Option<String>,
    #[serde(default, rename = "completedAt__updatedAt")]
    pub completed_at_updated_at: Option<u64>,
}

/// A project entry in db.json containing path, metadata, and roadmap items.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbProjectEntry {
    pub project_path: String,
    pub project: DbProjectData,
    #[serde(rename = "roadmapItems")]
    pub roadmap_items: HashMap<String, DbRoadmapItem>,
}

/// Client identity record in db.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DbClient {
    pub hostname: String,
    pub platform: String,
    pub last_seen_at: u64,
}

/// The top-level db.json structure.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbJson {
    #[serde(rename = "_schemaVersion")]
    pub schema_version: u32,
    #[serde(rename = "_lastSyncedAt")]
    pub last_synced_at: u64,
    #[serde(rename = "_hlcCounter")]
    pub hlc_counter: u64,
    pub projects: HashMap<String, DbProjectEntry>,
    pub clients: HashMap<String, DbClient>,
}

// ---------------------------------------------------------------------------
// db.json Default (empty database)
// ---------------------------------------------------------------------------

impl Default for DbJson {
    fn default() -> Self {
        Self {
            schema_version: 1,
            last_synced_at: 0,
            hlc_counter: 0,
            projects: HashMap::new(),
            clients: HashMap::new(),
        }
    }
}

/// Returns the canonical path to db.json: `~/.openclaw/clawchestra/db.json`.
pub fn db_json_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or_else(|| "Could not find home directory".to_string())?;
    Ok(home
        .join(".openclaw")
        .join("clawchestra")
        .join("db.json"))
}

// ---------------------------------------------------------------------------
// Runtime application state
// ---------------------------------------------------------------------------

/// The inner type behind `Arc<tokio::sync::Mutex<AppState>>` — canonical runtime state.
///
/// All project/roadmap data lives here at runtime. db.json is the persistence
/// layer (debounced writes). state.json files are projections for agent
/// consumption.
#[derive(Debug)]
pub struct AppState {
    /// Global DB (all projects, per-field timestamps)
    pub db: DbJson,
    /// SHA-256 of last-written state.json per project (for change detection, D8)
    pub content_hashes: HashMap<ProjectId, String>,
    /// Circular buffer of state history per project (for undo and stale write detection)
    pub state_history: HashMap<ProjectId, VecDeque<HistoryEntry>>,
    /// Hybrid logical clock counter for this device
    pub hlc_counter: u64,
    /// Whether the in-memory DB has unflushed changes
    pub dirty: bool,
    /// Maximum state history buffer size (from settings)
    pub history_buffer_size: usize,
    /// This client's stable UUID (set once at startup, used for sync tie-breaking)
    pub client_uuid: String,
    /// Per-project circular buffer of validation rejection events (Phase 7.3)
    pub validation_rejections: HashMap<ProjectId, VecDeque<ValidationRejection>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            db: DbJson::default(),
            content_hashes: HashMap::new(),
            state_history: HashMap::new(),
            hlc_counter: 0,
            dirty: false,
            history_buffer_size: 20,
            client_uuid: String::new(),
            validation_rejections: HashMap::new(),
        }
    }
}

impl AppState {
    /// Advance the hybrid logical clock and return the new timestamp.
    /// HLC: max(wall_clock_ms, last_seen_timestamp) + 1
    pub fn next_hlc(&mut self) -> u64 {
        let wall_clock = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let next = std::cmp::max(wall_clock, self.hlc_counter) + 1;
        self.hlc_counter = next;
        self.db.hlc_counter = next;
        next
    }

    /// Mark the DB as dirty (needs persistence).
    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    /// Push a history entry into the per-project circular buffer.
    pub fn push_history(
        &mut self,
        project_id: &ProjectId,
        entry: HistoryEntry,
    ) {
        let buffer = self
            .state_history
            .entry(project_id.clone())
            .or_insert_with(VecDeque::new);
        if buffer.len() >= self.history_buffer_size {
            buffer.pop_front();
        }
        buffer.push_back(entry);
    }

    /// Get the most recent history entry for a project.
    pub fn last_history(&self, project_id: &ProjectId) -> Option<&HistoryEntry> {
        self.state_history
            .get(project_id)
            .and_then(|buf| buf.back())
    }

    /// Returns the Nth-from-last history entry (0 = most recent, 1 = second most recent, etc.)
    pub fn history_at(&self, project_id: &ProjectId, n: usize) -> Option<&HistoryEntry> {
        self.state_history
            .get(project_id)
            .and_then(|buf| buf.iter().rev().nth(n))
    }

    /// Project a StateJson document from the DB for a given project.
    pub fn project_state_json(&self, project_id: &str) -> Option<StateJson> {
        let entry = self.db.projects.get(project_id)?;
        let now_ms = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        let project = StateJsonProject {
            id: entry.project.id.clone(),
            title: entry.project.title.clone(),
            status: entry.project.status.clone(),
            description: entry.project.description.clone(),
            parent_id: entry.project.parent_id.clone(),
            tags: entry.project.tags.clone(),
        };
        let mut items: Vec<StateJsonRoadmapItem> = entry
            .roadmap_items
            .values()
            .map(|db_item| StateJsonRoadmapItem {
                id: db_item.id.clone(),
                title: db_item.title.clone(),
                status: db_item.status.clone(),
                priority: Some(db_item.priority),
                next_action: db_item.next_action.clone(),
                tags: db_item.tags.clone(),
                icon: db_item.icon.clone(),
                blocked_by: db_item.blocked_by.clone(),
                spec_doc: db_item.spec_doc.clone(),
                plan_doc: db_item.plan_doc.clone(),
                completed_at: db_item.completed_at.clone(),
            })
            .collect();
        // Sort by priority (ascending), with None at the end
        items.sort_by_key(|item| item.priority.unwrap_or(i64::MAX));
        Some(StateJson {
            schema_version: 1,
            generated_at: now_ms,
            generated_by: "clawchestra".to_string(),
            project,
            roadmap_items: items,
        })
    }

}

// ---------------------------------------------------------------------------
// Validation rejection events (Phase 7.3)
// ---------------------------------------------------------------------------

/// A validation rejection event recorded when partial-apply rejects fields.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationRejection {
    /// Millisecond timestamp when the rejection occurred
    pub timestamp: u64,
    /// The project that was being validated
    pub project_id: String,
    /// Dot-paths of the rejected fields
    pub rejected_fields: Vec<String>,
    /// Human-readable reason for the rejection
    pub reason: String,
    /// Whether a user has acknowledged/resolved this rejection
    pub resolved: bool,
}

// ---------------------------------------------------------------------------
// State history
// ---------------------------------------------------------------------------

/// A snapshot entry in the per-project state history buffer.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    /// HLC timestamp when this snapshot was created
    pub timestamp: u64,
    /// Source of the change
    pub source: HistorySource,
    /// Dot-path list of changed fields (e.g., "roadmapItems.auth-system.status")
    pub changed_fields: Vec<String>,
    /// Full state.json snapshot at this point
    pub state: StateJson,
}

/// Who initiated a state change.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistorySource {
    Agent,
    Ui,
    Sync,
    Migration,
}

// ---------------------------------------------------------------------------
// Migration state machine (derived, not persisted)
// ---------------------------------------------------------------------------

/// Derived migration state for a project. Computed from filesystem checks,
/// never persisted to the database. Each step is individually retriable.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationStep {
    /// ROADMAP.md exists AND no DB rows for this project
    NotStarted,
    /// DB rows exist AND no .clawchestra/state.json
    Imported,
    /// state.json exists AND .clawchestra/ not in .gitignore
    Projected,
    /// .gitignore updated AND ROADMAP.md still exists
    GitignoreUpdated,
    /// ROADMAP.md does not exist AND state.json exists
    SourceDeleted,
    /// All migration steps complete
    Complete,
}

// ---------------------------------------------------------------------------
// Validation result
// ---------------------------------------------------------------------------

/// Result of validating an incoming state.json against the current DB state.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StateJsonValidationResult {
    /// Changes that passed validation and were applied
    pub applied_changes: Vec<AppliedChange>,
    /// Fields that failed validation and were rejected (DB value kept)
    pub rejected_fields: Vec<RejectedField>,
    /// Non-fatal warnings (unknown fields stripped, etc.)
    pub warnings: Vec<String>,
}

/// A single field change that was accepted and applied.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedChange {
    /// Dot-path to the field (e.g., "roadmapItems.auth-system.status")
    pub field: String,
    /// Previous value (serialized)
    pub old_value: Option<String>,
    /// New value (serialized)
    pub new_value: String,
}

/// A single field that failed validation and was rejected.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RejectedField {
    /// Dot-path to the field
    pub field: String,
    /// The invalid value that was rejected
    pub value: String,
    /// Why it was rejected
    pub reason: String,
}
