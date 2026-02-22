//! injection.rs — CLAUDE.md & AGENTS.md branch injection for tracked projects.
//!
//! Provides a single Tauri command `inject_agent_guidance` that iterates over
//! all local branches of a project and injects/updates the Clawchestra
//! Integration section in CLAUDE.md plus exact string replacements in AGENTS.md.
//!
//! Phase 4 of the Architecture Direction plan.

use serde::Serialize;
use std::path::Path;
use std::time::{Duration, Instant};

use crate::commands::git::{combine_git_output, run_git_capture};

// ---------------------------------------------------------------------------
// Constants — injection content
// ---------------------------------------------------------------------------

/// The CLAUDE.md section to inject. Must start with `## Clawchestra Integration`
/// so idempotency checks can find it.
const CLAUDE_MD_SECTION: &str = r#"## Clawchestra Integration

Project orchestration state lives in `.clawchestra/state.json` (gitignored, always on disk).

**Read:** Open `.clawchestra/state.json` to see project status, roadmap items, priorities. Always read immediately before writing — do not cache contents across operations.
**Write:** Edit `.clawchestra/state.json` to update status, add items, change priorities. Include BOTH `project` and `roadmapItems` in every write. Clawchestra validates and syncs automatically.

**Schema rules:**
- Project statuses: in-progress | up-next | pending | dormant | archived
- Roadmap item statuses: pending | up-next | in-progress | complete
- When setting status: complete, always set completedAt: YYYY-MM-DD
- Priorities are unique per column
- Do NOT delete items from state.json — removal requires explicit action via Clawchestra UI
- Items you omit from `roadmapItems` are NOT deleted — Clawchestra restores them on next projection

**After writing:** If your changes don't appear in state.json after writing, check `.clawchestra/last-rejection.json` for validation errors.

**Do NOT edit:** CLAWCHESTRA.md (human documentation only), any files in `.clawchestra/` other than state.json."#;

/// The section header used for idempotency detection.
const SECTION_HEADER: &str = "## Clawchestra Integration";

/// Commit message used for injection commits.
const COMMIT_MESSAGE: &str = "chore: update agent guidance for Clawchestra architecture";

/// Timeout per branch in seconds.
const BRANCH_TIMEOUT_SECS: u64 = 60;

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

#[derive(Serialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BranchResult {
    pub name: String,
    pub success: bool,
    pub skip_reason: Option<String>,
}

// ---------------------------------------------------------------------------
// AGENTS.md replacement pairs
// ---------------------------------------------------------------------------

/// Exact string replacements for AGENTS.md.
/// Each tuple is (old, new). Applied in order.
const AGENTS_MD_REPLACEMENTS: &[(&str, &str)] = &[
    (
        "read PROJECT.md",
        "read CLAWCHESTRA.md for documentation, .clawchestra/state.json for machine-readable state",
    ),
    ("PROJECT.md", "CLAWCHESTRA.md"),
    ("ROADMAP.md", ".clawchestra/state.json"),
    ("YAML frontmatter", "JSON"),
];

// ---------------------------------------------------------------------------
// Git helpers (project-scoped)
// ---------------------------------------------------------------------------

/// Get the current branch name, or None if HEAD is detached.
fn current_branch(repo: &str) -> Result<Option<String>, String> {
    let output = run_git_capture(repo, &["symbolic-ref", "--short", "HEAD"])?;
    if output.success {
        Ok(Some(output.stdout.clone()))
    } else {
        // Detached HEAD
        Ok(None)
    }
}

/// Get the current HEAD commit SHA (for detached HEAD restoration).
fn head_sha(repo: &str) -> Result<String, String> {
    let output = run_git_capture(repo, &["rev-parse", "HEAD"])?;
    if !output.success {
        return Err(format!("Failed to get HEAD SHA: {}", combine_git_output(&output)));
    }
    Ok(output.stdout.clone())
}

/// List all local branch names.
fn list_local_branches(repo: &str) -> Result<Vec<String>, String> {
    let output = run_git_capture(
        repo,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads/"],
    )?;
    if !output.success {
        return Err(format!(
            "Failed to list branches: {}",
            combine_git_output(&output)
        ));
    }
    Ok(output
        .stdout
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// List branches checked out in other worktrees (these cannot be checked out).
fn worktree_checked_out_branches(repo: &str) -> Result<Vec<String>, String> {
    let output = run_git_capture(repo, &["worktree", "list", "--porcelain"])?;
    if !output.success {
        // If worktree list fails, assume no worktrees
        return Ok(vec![]);
    }
    let mut branches = Vec::new();
    for line in output.stdout.lines() {
        if let Some(branch) = line.strip_prefix("branch refs/heads/") {
            branches.push(branch.trim().to_string());
        }
    }
    Ok(branches)
}

/// Check if working tree is dirty (has uncommitted changes).
fn is_dirty(repo: &str) -> Result<bool, String> {
    let output = run_git_capture(repo, &["status", "--porcelain"])?;
    if !output.success {
        return Err(format!(
            "git status failed: {}",
            combine_git_output(&output)
        ));
    }
    Ok(!output.stdout.is_empty())
}

/// Create a stash entry without modifying the working tree (git stash create),
/// then store it so it persists (git stash store).
/// Returns the stash ref if changes were stashed, None if clean.
fn stash_create_and_store(repo: &str) -> Result<Option<String>, String> {
    let create_output = run_git_capture(repo, &["stash", "create"])?;
    if !create_output.success || create_output.stdout.is_empty() {
        // Nothing to stash
        return Ok(None);
    }
    let stash_sha = create_output.stdout.clone();

    // Store it so it persists even if the process crashes
    let store_output = run_git_capture(
        repo,
        &[
            "stash",
            "store",
            "-m",
            "clawchestra: pre-injection stash",
            &stash_sha,
        ],
    )?;
    if !store_output.success {
        return Err(format!(
            "git stash store failed: {}",
            combine_git_output(&store_output)
        ));
    }
    Ok(Some("stash@{0}".to_string()))
}

/// Apply and drop a stash.
fn stash_pop(repo: &str) -> Result<(), String> {
    let output = run_git_capture(repo, &["stash", "pop"])?;
    if !output.success {
        return Err(format!(
            "git stash pop failed: {}",
            combine_git_output(&output)
        ));
    }
    Ok(())
}

/// Checkout a branch.
fn checkout(repo: &str, target: &str) -> Result<(), String> {
    let output = run_git_capture(repo, &["checkout", target])?;
    if !output.success {
        return Err(format!(
            "git checkout {} failed: {}",
            target,
            combine_git_output(&output)
        ));
    }
    Ok(())
}

/// Stage files and commit.
fn add_and_commit(repo: &str, files: &[&str], message: &str) -> Result<(), String> {
    let mut add_args = vec!["add", "--"];
    add_args.extend(files);
    let add_output = run_git_capture(repo, &add_args)?;
    if !add_output.success {
        return Err(format!(
            "git add failed: {}",
            combine_git_output(&add_output)
        ));
    }

    // Check if there's anything staged to commit
    let diff_output = run_git_capture(repo, &["diff", "--cached", "--quiet"])?;
    if diff_output.success {
        // Nothing staged — skip commit (no changes to these files on this branch)
        return Ok(());
    }

    let commit_output = run_git_capture(repo, &["commit", "-m", message])?;
    if !commit_output.success {
        return Err(format!(
            "git commit failed: {}",
            combine_git_output(&commit_output)
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// File update logic
// ---------------------------------------------------------------------------

/// Update CLAUDE.md: append section if missing, or replace existing section.
/// Returns true if the file was modified.
fn update_claude_md(project_path: &Path) -> Result<bool, String> {
    let claude_md_path = project_path.join("CLAUDE.md");

    if !claude_md_path.exists() {
        // Create CLAUDE.md with just the section
        std::fs::write(&claude_md_path, format!("# CLAUDE.md\n\n{CLAUDE_MD_SECTION}\n"))
            .map_err(|e| format!("Failed to create CLAUDE.md: {}", e))?;
        return Ok(true);
    }

    let content = std::fs::read_to_string(&claude_md_path)
        .map_err(|e| format!("Failed to read CLAUDE.md: {}", e))?;

    if content.contains(SECTION_HEADER) {
        // Replace existing section: find the section and replace everything from
        // the header to either the next `## ` heading or end of file.
        let new_content = replace_section(&content, SECTION_HEADER, CLAUDE_MD_SECTION);
        if new_content == content {
            return Ok(false); // No change needed
        }
        std::fs::write(&claude_md_path, new_content)
            .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
        Ok(true)
    } else {
        // Append section at end
        let mut new_content = content;
        if !new_content.ends_with('\n') {
            new_content.push('\n');
        }
        new_content.push('\n');
        new_content.push_str(CLAUDE_MD_SECTION);
        new_content.push('\n');
        std::fs::write(&claude_md_path, new_content)
            .map_err(|e| format!("Failed to write CLAUDE.md: {}", e))?;
        Ok(true)
    }
}

/// Replace a `## Heading` section (from its header to the next `## ` or EOF)
/// with new content.
fn replace_section(content: &str, header: &str, replacement: &str) -> String {
    let mut result = String::with_capacity(content.len());
    let mut in_section = false;
    let mut found_section = false;

    for line in content.lines() {
        if line.starts_with(header) && !found_section {
            // Start of our section — write replacement
            in_section = true;
            found_section = true;
            result.push_str(replacement);
            result.push('\n');
            continue;
        }

        if in_section {
            // Check if we've hit the next section (## heading that isn't ours)
            if line.starts_with("## ") {
                in_section = false;
                // Ensure blank line separator between replaced section and next heading
                if !result.ends_with("\n\n") {
                    result.push('\n');
                }
                result.push_str(line);
                result.push('\n');
            }
            // else: skip lines in old section
            continue;
        }

        result.push_str(line);
        result.push('\n');
    }

    // Trim trailing newline to match original if original didn't end with one
    if !content.ends_with('\n') && result.ends_with('\n') {
        result.pop();
    }

    result
}

/// Update AGENTS.md with exact string replacements.
/// Returns true if the file was modified.
fn update_agents_md(project_path: &Path) -> Result<bool, String> {
    let agents_md_path = project_path.join("AGENTS.md");

    if !agents_md_path.exists() {
        // No AGENTS.md to update — that's fine, not all projects have one
        return Ok(false);
    }

    let content = std::fs::read_to_string(&agents_md_path)
        .map_err(|e| format!("Failed to read AGENTS.md: {}", e))?;

    let mut new_content = content.clone();
    for &(old, new) in AGENTS_MD_REPLACEMENTS {
        new_content = new_content.replace(old, new);
    }

    if new_content == content {
        return Ok(false); // No changes
    }

    std::fs::write(&agents_md_path, new_content)
        .map_err(|e| format!("Failed to write AGENTS.md: {}", e))?;
    Ok(true)
}

/// Check if the Clawchestra Integration section is already present in CLAUDE.md
/// on the currently checked-out branch.
fn is_already_injected(project_path: &Path) -> bool {
    let claude_md_path = project_path.join("CLAUDE.md");
    if !claude_md_path.exists() {
        return false;
    }
    match std::fs::read_to_string(&claude_md_path) {
        Ok(content) => content.contains(SECTION_HEADER),
        Err(_) => false,
    }
}

// ---------------------------------------------------------------------------
// Main injection command
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn inject_agent_guidance(project_path: String) -> Result<Vec<BranchResult>, String> {
    let project_dir = std::path::PathBuf::from(&project_path);

    // Path validation
    if !project_dir.is_absolute() {
        return Err("project_path must be an absolute path".to_string());
    }
    if !project_dir.exists() {
        return Err(format!("Project path does not exist: {}", project_path));
    }
    if !project_dir.join(".git").exists() {
        return Err(format!("Not a git repository: {}", project_path));
    }

    // 4. Detect submodules — skip entire project
    if project_dir.join(".gitmodules").exists() {
        return Ok(vec![BranchResult {
            name: "(all)".to_string(),
            success: false,
            skip_reason: Some("submodules".to_string()),
        }]);
    }

    // 2. Record original branch (handle detached HEAD)
    let original_branch = current_branch(&project_path)?;
    let original_sha = head_sha(&project_path)?;

    // 1. Stash current changes if dirty
    let stash_ref = if is_dirty(&project_path)? {
        stash_create_and_store(&project_path)?
    } else {
        None
    };

    // 3. Detect worktree-checked-out branches
    let worktree_branches = worktree_checked_out_branches(&project_path)?;

    // List all local branches
    let branches = list_local_branches(&project_path)?;

    let mut results = Vec::with_capacity(branches.len());

    // 5. For each local branch
    for branch in &branches {
        let start = Instant::now();
        let timeout = Duration::from_secs(BRANCH_TIMEOUT_SECS);

        // Check if branch is checked out in another worktree
        // (allow the current branch — it's checked out in *this* worktree)
        let is_current = original_branch.as_deref() == Some(branch.as_str());
        if !is_current && worktree_branches.contains(branch) {
            results.push(BranchResult {
                name: branch.clone(),
                success: false,
                skip_reason: Some("worktree_checked_out".to_string()),
            });
            continue;
        }

        // Checkout branch (skip if we're already on it)
        if !is_current {
            if let Err(e) = checkout(&project_path, branch) {
                results.push(BranchResult {
                    name: branch.clone(),
                    success: false,
                    skip_reason: Some(format!("checkout_failed: {}", e)),
                });
                continue;
            }
        }

        // 5a. Idempotency check
        if is_already_injected(&project_dir) {
            results.push(BranchResult {
                name: branch.clone(),
                success: true,
                skip_reason: Some("already_injected".to_string()),
            });
            continue;
        }

        // Timeout check
        if start.elapsed() > timeout {
            results.push(BranchResult {
                name: branch.clone(),
                success: false,
                skip_reason: Some("timeout".to_string()),
            });
            continue;
        }

        // 5c-5e. Update files
        let claude_updated = match update_claude_md(&project_dir) {
            Ok(updated) => updated,
            Err(e) => {
                results.push(BranchResult {
                    name: branch.clone(),
                    success: false,
                    skip_reason: Some(format!("claude_md_error: {}", e)),
                });
                continue;
            }
        };

        let agents_updated = match update_agents_md(&project_dir) {
            Ok(updated) => updated,
            Err(e) => {
                results.push(BranchResult {
                    name: branch.clone(),
                    success: false,
                    skip_reason: Some(format!("agents_md_error: {}", e)),
                });
                continue;
            }
        };

        // 5f-5g. Stage and commit
        if claude_updated || agents_updated {
            let mut files_to_add: Vec<&str> = Vec::new();
            if claude_updated {
                files_to_add.push("CLAUDE.md");
            }
            if agents_updated {
                files_to_add.push("AGENTS.md");
            }

            if let Err(e) = add_and_commit(&project_path, &files_to_add, COMMIT_MESSAGE) {
                results.push(BranchResult {
                    name: branch.clone(),
                    success: false,
                    skip_reason: Some(format!("commit_error: {}", e)),
                });
                continue;
            }
        }

        // 5h. Record success
        results.push(BranchResult {
            name: branch.clone(),
            success: true,
            skip_reason: None,
        });
    }

    // 6. Restore original branch
    let restore_target = match &original_branch {
        Some(branch) => branch.clone(),
        None => original_sha, // Detached HEAD — restore by SHA
    };
    let restore_ok = checkout(&project_path, &restore_target).is_ok();
    if !restore_ok {
        eprintln!(
            "Warning: failed to restore original branch/SHA {}. \
             Stash NOT popped to avoid corruption — run `git stash pop` manually.",
            restore_target
        );
        // Return results but do NOT pop the stash — applying it to the wrong
        // branch could silently corrupt the working tree.
        return Ok(results);
    }

    // 7. Apply stash if exists (only after successful branch restore)
    if stash_ref.is_some() {
        if let Err(e) = stash_pop(&project_path) {
            eprintln!("Warning: failed to pop stash: {}", e);
        }
    }

    Ok(results)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod injection_tests {
    use super::*;
    use std::fs;

    #[test]
    fn replace_section_replaces_existing() {
        let content = "# CLAUDE.md\n\n## Clawchestra Integration\n\nOld content here.\nMore old.\n\n## Other Section\n\nKeep this.\n";
        let result = replace_section(content, SECTION_HEADER, CLAUDE_MD_SECTION);
        assert!(result.contains(SECTION_HEADER));
        assert!(result.contains(".clawchestra/state.json"));
        assert!(!result.contains("Old content here."));
        assert!(result.contains("## Other Section"));
        assert!(result.contains("Keep this."));
    }

    #[test]
    fn replace_section_at_end_of_file() {
        let content = "# CLAUDE.md\n\n## Clawchestra Integration\n\nOld content here.\n";
        let result = replace_section(content, SECTION_HEADER, CLAUDE_MD_SECTION);
        assert!(result.contains(SECTION_HEADER));
        assert!(result.contains(".clawchestra/state.json"));
        assert!(!result.contains("Old content here."));
    }

    #[test]
    fn replace_section_preserves_preceding_content() {
        let content = "# My Project\n\nSome intro.\n\n## Clawchestra Integration\n\nOld.\n\n## Build\n\nBuild info.\n";
        let result = replace_section(content, SECTION_HEADER, CLAUDE_MD_SECTION);
        assert!(result.starts_with("# My Project\n"));
        assert!(result.contains("Some intro."));
        assert!(result.contains(SECTION_HEADER));
        assert!(result.contains("## Build"));
        assert!(result.contains("Build info."));
    }

    #[test]
    fn agents_md_replacements_apply_correctly() {
        let content = "Read PROJECT.md for details.\nEdit ROADMAP.md to update.\nUses YAML frontmatter format.\nAlso read PROJECT.md here.\n";
        let mut result = content.to_string();
        for &(old, new) in AGENTS_MD_REPLACEMENTS {
            result = result.replace(old, new);
        }
        // "read PROJECT.md" gets the longer replacement
        assert!(result.contains("read CLAWCHESTRA.md for documentation, .clawchestra/state.json for machine-readable state"));
        // Remaining PROJECT.md references become CLAWCHESTRA.md
        // ROADMAP.md references become .clawchestra/state.json
        assert!(result.contains(".clawchestra/state.json"));
        assert!(!result.contains("ROADMAP.md"));
        assert!(result.contains("JSON format"));
        assert!(!result.contains("YAML frontmatter"));
    }

    #[test]
    fn idempotency_check_detects_section() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-test-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        // No CLAUDE.md — not injected
        assert!(!is_already_injected(&dir));

        // CLAUDE.md without section — not injected
        fs::write(dir.join("CLAUDE.md"), "# CLAUDE.md\n\nSome content.\n").unwrap();
        assert!(!is_already_injected(&dir));

        // CLAUDE.md with section — injected
        fs::write(
            dir.join("CLAUDE.md"),
            format!("# CLAUDE.md\n\n{}\n", CLAUDE_MD_SECTION),
        )
        .unwrap();
        assert!(is_already_injected(&dir));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_claude_md_creates_file_when_missing() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-create-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        let modified = update_claude_md(&dir).unwrap();
        assert!(modified);

        let content = fs::read_to_string(dir.join("CLAUDE.md")).unwrap();
        assert!(content.contains(SECTION_HEADER));
        assert!(content.contains(".clawchestra/state.json"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_claude_md_appends_when_no_section() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-append-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("CLAUDE.md"), "# My Project\n\nExisting content.\n").unwrap();

        let modified = update_claude_md(&dir).unwrap();
        assert!(modified);

        let content = fs::read_to_string(dir.join("CLAUDE.md")).unwrap();
        assert!(content.contains("# My Project"));
        assert!(content.contains("Existing content."));
        assert!(content.contains(SECTION_HEADER));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_claude_md_replaces_existing_section() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-replace-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("CLAUDE.md"),
            "# My Project\n\n## Clawchestra Integration\n\nOld content.\n\n## Other\n\nKept.\n",
        )
        .unwrap();

        let modified = update_claude_md(&dir).unwrap();
        assert!(modified);

        let content = fs::read_to_string(dir.join("CLAUDE.md")).unwrap();
        assert!(content.contains("# My Project"));
        assert!(!content.contains("Old content."));
        assert!(content.contains(".clawchestra/state.json"));
        assert!(content.contains("## Other"));
        assert!(content.contains("Kept."));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_agents_md_returns_false_when_no_file() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-noagents-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        let modified = update_agents_md(&dir).unwrap();
        assert!(!modified);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn update_agents_md_applies_replacements() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-agents-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("AGENTS.md"),
            "# AGENTS.md\n\nRead ROADMAP.md for items.\nEdit PROJECT.md for project info.\nUses YAML frontmatter format.\n",
        )
        .unwrap();

        let modified = update_agents_md(&dir).unwrap();
        assert!(modified);

        let content = fs::read_to_string(dir.join("AGENTS.md")).unwrap();
        assert!(!content.contains("ROADMAP.md"));
        assert!(content.contains(".clawchestra/state.json"));
        assert!(!content.contains("PROJECT.md"));
        assert!(content.contains("CLAWCHESTRA.md"));
        assert!(!content.contains("YAML frontmatter"));
        assert!(content.contains("JSON"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn inject_rejects_relative_path() {
        let result = inject_agent_guidance("relative/path".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute"));
    }

    #[test]
    fn inject_rejects_nonexistent_path() {
        let result = inject_agent_guidance("/tmp/nonexistent-clawchestra-test-dir-xyz".to_string());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn inject_skips_submodule_projects() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-submod-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        // Init a git repo with .gitmodules
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        fs::write(dir.join(".gitmodules"), "[submodule \"foo\"]\n\tpath = foo\n\turl = https://example.com/foo.git\n").unwrap();

        let results = inject_agent_guidance(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].skip_reason.as_deref(), Some("submodules"));
        assert!(!results[0].success);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn inject_works_on_single_branch_repo() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-single-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        // Init a git repo with an initial commit
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .output()
            .unwrap();
        fs::write(dir.join("README.md"), "# Test\n").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&dir)
            .output()
            .unwrap();

        let results = inject_agent_guidance(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(results.len(), 1);
        assert!(results[0].success);
        assert!(results[0].skip_reason.is_none());

        // Verify CLAUDE.md was created
        let claude_content = fs::read_to_string(dir.join("CLAUDE.md")).unwrap();
        assert!(claude_content.contains(SECTION_HEADER));
        assert!(claude_content.contains(".clawchestra/state.json"));

        // Run again — should be idempotent
        let results2 = inject_agent_guidance(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(results2.len(), 1);
        assert!(results2[0].success);
        assert_eq!(results2[0].skip_reason.as_deref(), Some("already_injected"));

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn inject_handles_multi_branch_repo() {
        let dir = std::env::temp_dir().join(format!(
            "clawchestra-inject-multi-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&dir).unwrap();

        // Init a git repo with an initial commit
        std::process::Command::new("git")
            .args(["init"])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(&dir)
            .output()
            .unwrap();
        fs::write(dir.join("README.md"), "# Test\n").unwrap();
        std::process::Command::new("git")
            .args(["add", "."])
            .current_dir(&dir)
            .output()
            .unwrap();
        std::process::Command::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(&dir)
            .output()
            .unwrap();

        // Create a second branch
        std::process::Command::new("git")
            .args(["branch", "feature-a"])
            .current_dir(&dir)
            .output()
            .unwrap();

        let results = inject_agent_guidance(dir.to_str().unwrap().to_string()).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| r.success));
        // At least one should have no skip_reason (first injection)
        assert!(results.iter().any(|r| r.skip_reason.is_none()));

        // Verify we're back on the original branch
        let branch_output = std::process::Command::new("git")
            .args(["symbolic-ref", "--short", "HEAD"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let current = String::from_utf8_lossy(&branch_output.stdout)
            .trim()
            .to_string();
        // Should be on master/main (whatever the default is)
        assert!(!current.is_empty());

        let _ = fs::remove_dir_all(dir);
    }
}
