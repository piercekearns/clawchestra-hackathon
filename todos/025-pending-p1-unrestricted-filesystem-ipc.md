---
status: pending
priority: p1
issue_id: "025"
tags: [security, pre-release, architecture-direction-v2]
dependencies: ["008"]
---

# Unrestricted filesystem IPC commands

## Problem Statement

Four Tauri IPC commands — `read_file`, `write_file`, `delete_file`, and `remove_path` — accept arbitrary filesystem paths from the frontend with zero validation. Any path reachable by the process user can be read, overwritten, or deleted. Combined with CSP disabled (#008), any XSS in the webview can read `~/.ssh/id_rsa`, overwrite `~/.zshrc`, or delete the user's home directory.

This is more severe than the path canonicalization item in #023, which only covers `project_path` parameters. These four commands have no path restriction at all.

## Findings

**Location:** `src-tauri/src/lib.rs` lines 558-593

- `read_file(path: String)` — reads any file
- `write_file(path: String, content: String)` — creates directories + writes any file
- `delete_file(path: String)` — deletes any file
- `remove_path(path: String)` — `remove_dir_all` on any path (including `~`)

**Exploitability:** Trivial from webview console: `window.__TAURI__.invoke('read_file', { path: '/etc/passwd' })`

**Also identified:** `run_command_with_output` (lib.rs lines 671-708) constructs shell commands via string concatenation with incomplete escaping (handles spaces/quotes but misses `;`, `|`, `$()`, backticks). Should use `Command::new().args()` directly.

**Identified by:** Security Sentinel (#1, CRITICAL; #3, CRITICAL)

## Proposed Solutions

### Option A: Path allowlist (Recommended)
Implement a path allowlist: only allow paths under configured `scan_paths`, the app support directory (`~/.openclaw/clawchestra/`), and `/tmp`. Canonicalize paths before checking.

- Pros: Targeted fix, doesn't break legitimate usage
- Cons: Must enumerate all legitimate paths
- Effort: Small-Medium
- Risk: Low

### Option B: Tauri FsScope
Use Tauri's built-in `FsScope` allowlist in `tauri.conf.json` to restrict filesystem access at the framework level.

- Pros: Framework-level enforcement, covers all commands
- Cons: Less flexible, may be harder to configure dynamically
- Effort: Small
- Risk: Low

### For shell injection:
Replace `run_command_with_output`'s `/bin/sh -c` string concatenation with direct `Command::new(command).args(args)` invocation.

## Recommended Action

Option A for the IPC commands. Direct `Command::new` for shell injection. Both are pre-release blockers when combined with #008 (CSP).

## Technical Details

**Affected files:** `src-tauri/src/lib.rs`

## Acceptance Criteria

- [ ] `read_file`, `write_file`, `delete_file`, `remove_path` only operate on paths under allowed prefixes
- [ ] Paths are canonicalized before allowlist check (prevents `/../` bypass)
- [ ] `run_command_with_output` does not use shell string concatenation
- [ ] Test: attempting to read/write outside allowed paths returns error

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | From review round 3 — Security Sentinel findings #1 and #3 |
