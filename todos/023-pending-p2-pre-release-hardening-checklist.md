---
status: pending
priority: p2
issue_id: "023"
tags: [pre-release, security, hardening, architecture-direction-v2]
dependencies: []
---

# Pre-release hardening checklist

## Problem Statement

Across two rounds of holistic code review (todos 002-022), several items were flagged as pre-release hardening requirements. Some were fixed, some deferred. This consolidated checklist tracks everything that should be addressed before the first public/production release.

## Outstanding Items

### Security (from review rounds 1 & 2)

- [ ] **#008 — CSP disabled in Tauri config** (`tauri.conf.json`)
  - Content Security Policy is set to a permissive default. Should be tightened before release.
  - Status: deferred (P2)

- [ ] **Rate limiting on Tauri IPC commands**
  - No rate limiting on `set_project_status`, `set_item_status`, etc. A malicious or runaway frontend could spam mutations.
  - Recommendation: Add basic rate limiting or debounce at the IPC boundary.

- [ ] **Input sanitization on file paths**
  - `project_path` parameters in commands like `inject_agent_guidance` are validated for absolute paths and existence, but no symlink resolution or path canonicalization.
  - Recommendation: `fs::canonicalize()` on user-provided paths before use.

- [ ] **#025 — Unrestricted filesystem IPC commands** (P1, see todo 025)
  - `read_file`, `write_file`, `delete_file`, `remove_path` accept arbitrary paths with zero validation.
  - Combined with disabled CSP, any XSS can read/write/delete any file the user owns.
  - Status: tracked separately as P1

- [ ] **Shell injection in `run_command_with_output`**
  - String concatenation for shell commands with incomplete escaping (misses `;`, `|`, `$()`, backticks).
  - Recommendation: Replace with `Command::new(command).args(args)` (no shell interpretation).

- [ ] **Self-update executes user-configurable shell script**
  - `run_app_update` loads `update.sh` from `app_source_path` (user-configurable) and runs via `/bin/sh`.
  - Recommendation: Embed update logic in Rust binary, or verify script integrity before execution.

- [ ] **Unbounded string fields in state.json**
  - No per-field length limits on `title`, `description`, `nextAction`, `specDoc`, `planDoc`, etc.
  - A single 1MB state.json can cause 5-10x memory amplification through the merge/history/event pipeline.
  - Recommendation: Add max length per field. Cap `roadmap_items` count at ~500.

- [ ] **Bearer token in plaintext settings.json**
  - `openclaw_bearer_token` stored as plaintext on disk. Code has TODO to move to OS keychain.
  - Recommendation: Use `keyring` crate before remote sync goes live.

### Data Integrity

- [ ] **#024 — Sync snapshot race condition** (P1, see todo 024)
  - `sync_local_launch` and `sync_merge_remote` can overwrite concurrent watcher merges when re-acquiring the lock.
  - Status: tracked separately as P1

- [ ] **#026 — Multi-device sync correctness** (P2, see todo 026)
  - UUID tie-breaking non-deterministic with 3+ devices. Sync merge bypasses business rules. HLC growth path bypasses wall-clock.
  - Status: tracked separately as P2

- [ ] **Atomic write temp-file collision**
  - `write_str_atomic` uses millisecond timestamp as temp suffix. Same-ms writes collide.
  - Recommendation: Add random suffix or use `tempfile` crate.

- [ ] **#009 — Migration uses wall-clock timestamps**
  - `migration.rs` uses `SystemTime::now()` for HLC timestamps during import. If the system clock is wrong, imported items get incorrect timestamps that affect sync ordering.
  - Status: deferred (P3 — only affects one-time migration)

- [x] **#016 — Coupled field rejection drops entire item** — FIXED (narrowed blast radius to coupled fields only)

### Naming / Cleanup

- [ ] **#011 — Naming inconsistency: "openclaw" references**
  - Config fields, function names, and paths still reference "openclaw" despite the rename to "clawchestra". Not a functional issue but confusing.
  - Status: deferred (P3)

- [ ] **#012 — Stale lock file after SIGKILL**
  - Branch sync lock files (`branch-sync-locks/*.lock`) survive SIGKILL. Stale lock detection exists but relies on PID checks which can false-positive if PID is reused.
  - Status: deferred (P3)

### Testing

- [ ] **Integration tests for watcher → merge → writeback pipeline**
  - Unit tests exist for merge, validation, injection, and sync individually. No integration test exercises the full watcher flow (file change → debounce → merge → writeback → event emission).
  - Recommendation: Add at least one integration test.

- [ ] **Sync conflict resolution integration test**
  - `merge_db_json` is unit-tested but the full `sync_local_launch` and `sync_merge_remote` commands are not tested end-to-end.

### Performance / Reliability (from review round 3)

- [ ] **DbFlushHandle notification loss**
  - `tokio::sync::Notify` drops signals received during an active flush. Under rapid writes, a dirty flag could be set but never flushed until the next notification.
  - Recommendation: Re-check dirty flag after each flush cycle.

- [ ] **Parse failure recovery leaves corrupt file on disk**
  - `write_back_current_state` does string-based path matching. If no project matches (new project, symlinks, case sensitivity), corrupt state.json remains on disk, causing a warning storm.
  - Recommendation: Rename/delete corrupt file on no-match.

- [ ] **Regex compiled per validation call**
  - `Regex::new(r"^\d{4}-\d{2}-\d{2}$")` compiled on every `validate_state_json` call.
  - Recommendation: Use `once_cell::sync::Lazy` to compile once.

## Acceptance Criteria

- [ ] All items above triaged: fixed, accepted as-is with justification, or tracked separately
- [ ] No P1 items remaining (#024, #025 must be addressed)
- [ ] Security items (#008, #025, rate limiting, path canonicalization) addressed or risk-accepted

## Work Log

| Date | Action | Notes |
|------|--------|-------|
| 2026-02-21 | Created | Consolidated from review rounds 1 & 2 per user request |
| 2026-02-21 | Updated | Added findings from review round 3 (4 agents: architecture, security, performance, data integrity) |
