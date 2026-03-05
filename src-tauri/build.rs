use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn find_repo_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start.to_path_buf());
    while let Some(dir) = current {
        if dir.join(".git").exists() {
            return Some(dir);
        }
        current = dir.parent().map(Path::to_path_buf);
    }
    None
}

fn git_dir_for(repo_root: &Path) -> Option<PathBuf> {
    let dot_git = repo_root.join(".git");
    if dot_git.is_dir() {
        return Some(dot_git);
    }

    if dot_git.is_file() {
        let raw = fs::read_to_string(dot_git).ok()?;
        let prefix = "gitdir:";
        let gitdir = raw
            .lines()
            .find_map(|line| line.trim().strip_prefix(prefix))
            .map(str::trim)?;
        let resolved = if Path::new(gitdir).is_absolute() {
            PathBuf::from(gitdir)
        } else {
            repo_root.join(gitdir)
        };
        return Some(resolved);
    }

    None
}

fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")
        .ok()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    let repo_root = find_repo_root(&manifest_dir);

    if let Some(root) = &repo_root {
        if let Some(git_dir) = git_dir_for(root) {
            println!("cargo:rerun-if-changed={}", git_dir.join("HEAD").display());
            println!(
                "cargo:rerun-if-changed={}",
                git_dir.join("refs").join("heads").display()
            );
            println!("cargo:rerun-if-changed={}", root.join(".git").display());
        }
    }

    let output = repo_root.as_ref().and_then(|root| {
        Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["rev-parse", "HEAD"])
            .output()
            .ok()
    });

    let commit_hash = output
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    println!("cargo:rustc-env=BUILD_COMMIT={}", commit_hash);

    // Re-run if CAPABILITIES.md changes (embedded at compile time via include_str!)
    if let Some(root) = &repo_root {
        println!("cargo:rerun-if-changed={}", root.join("CAPABILITIES.md").display());
    }

    tauri_build::build()
}
