# Pre-Release Hardening

> Deferred fixes from the architecture-direction-v2 holistic code reviews, tracked with trigger events for when each becomes necessary.

## Background

During the architecture-direction-v2 build (7 phases: state management, file watcher, validation, injection, sync, migration, logging), two rounds of holistic code review were conducted using 7+ specialized review agents. These reviews produced 22 findings total (todos 002-022). Of those:

- **16 were fixed** in the same session (002-007, 010, 013-022)
- **5 remain deferred** (008, 009, 011, 012, plus umbrella items in 023)
- **1 was risk-accepted** (009 — migration wall-clock timestamps, practically a non-issue)

This spec documents the deferred items so they aren't lost, and assigns trigger events so the decision of "when to fix" is clear.

## Deferred Items

### 1. CSP Disabled in Tauri Config (#008)

**What:** `tauri.conf.json` has `"csp": null`, disabling Content Security Policy entirely. No defense-in-depth against XSS if a compromised dependency or rendered markdown injects a script.

**Risk:** Medium. Desktop Tauri apps have lower attack surface than web apps (no arbitrary URL navigation), but CSP is still a meaningful security layer.

**Fix:** Add a restrictive CSP policy:
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' ipc: http://ipc.localhost"
```

**Effort:** Small (one config line + testing that nothing breaks).

**Trigger event:** Before sharing the app with any other user, or before any public release. This is the single most important pre-release hardening item.

---

### 2. Migration Uses Wall-Clock Timestamps (#009)

**What:** `migration.rs` uses `SystemTime::now()` for HLC `__updatedAt` values during legacy data import. If two devices independently migrate the same project with clock skew, then sync, the merge could produce unexpected field-level outcomes.

**Risk:** Very low. Migration runs once per project. The UUID-based tiebreaker handles equal timestamps. Would require two machines to independently migrate the same legacy project with significant clock skew, then sync.

**Fix:** Pass the AppState HLC counter to migration and use `advance_hlc()` for each timestamp.

**Effort:** Medium.

**Trigger event:** Probably never. Only matters if multi-device sync is active AND two devices independently migrate the same legacy project. If migration always runs on one device per project (which is the expected flow), this is a permanent non-issue. Fix only if clock-skew-related merge bugs are actually observed.

---

### 3. Naming Inconsistency: openclaw vs OpenClaw (#011)

**What:** Mixed casing across the codebase: `openclaw`, `OpenClaw`, `open_claw` in variable names, comments, paths, settings keys, and function names. No functional impact but reduces grep-ability and readability for new contributors.

**Risk:** None (cosmetic).

**Fix:** Pick a convention (`openclaw` for code identifiers, `OpenClaw` for user-facing text) and apply consistently.

**Effort:** Medium (many files, but all mechanical renames).

**Trigger event:** Before onboarding other contributors to the codebase. Zero urgency while the project still has a single primary developer. Would be a good "rainy day" cleanup task.

---

### 4. Stale Lock File After SIGKILL (#012)

**What:** If the app is killed via SIGKILL (force quit, OOM killer), branch sync lock files (`branch-sync-locks/*.lock`) may persist. On next launch, stale lock detection exists (PID check + age timeout) but could false-positive if the PID is reused by another process.

**Risk:** Low. The stale detection heuristic (PID alive check + 5-minute timeout) handles most cases. Worst case: a branch sync operation is blocked until the timeout expires.

**Fix:** Add startup cleanup that sweeps stale lock files, or switch to advisory file locks (flock) which are automatically released by the OS on process exit.

**Effort:** Small-Medium.

**Trigger event:** Before unattended/service operation, or if multiple users share a machine. On a single developer's machine, a stale lock after force-quit is a minor inconvenience (wait 5 minutes or manually delete the lock file).

---

### 5. Broader Hardening (from #023)

Items identified by the security-sentinel that aren't bugs but would strengthen the app:

**a) IPC Rate Limiting**
- No rate limiting on Tauri commands (`set_project_status`, `set_item_status`, etc.)
- A malicious or runaway frontend could spam mutations
- **Trigger:** Before allowing untrusted frontends or extensions to call IPC commands

**b) Path Canonicalization**
- `project_path` parameters are validated for absolute paths and existence, but no `fs::canonicalize()` to resolve symlinks
- **Trigger:** Before accepting project paths from untrusted sources (e.g., a web-based project picker)

**c) Integration Tests**
- Unit tests exist for merge, validation, injection, and sync individually. No integration test exercises the full watcher flow (file change -> debounce -> merge -> writeback -> event emission)
- **Trigger:** Before any significant refactor of the watcher or merge pipeline. Also recommended before adding new field types to state.json.

### 6. Sync Snapshot Race Condition (#024) — NEW from round 3

**What:** `sync_local_launch` and `sync_merge_remote` clone the DB, release the lock for I/O, then re-acquire and overwrite with the merged result. Any watcher-applied changes in between are silently lost.

**Risk:** Medium. Narrow timing window but non-zero under rapid agent writes during sync.

**Fix:** Compare-and-swap: after re-acquiring the lock, check if `hlc_counter` advanced. If so, re-merge against current state.

**Effort:** Small.

**Trigger event:** Before multi-device sync is used with concurrent agent writes. The #1 finding across all review agents.

---

### 7. Unrestricted Filesystem IPC Commands (#025) — NEW from round 3

**What:** `read_file`, `write_file`, `delete_file`, `remove_path` accept arbitrary paths with zero validation. Combined with CSP disabled, any XSS can read/write/delete any file the user owns.

**Risk:** High. Trivially exploitable if combined with an XSS vector.

**Fix:** Path allowlist (only paths under scan_paths, app support dir, /tmp) with canonicalization.

**Effort:** Small-Medium.

**Trigger event:** Before sharing the app with any other user. This is tied to #008 (CSP) — together they form the critical security baseline.

---

### 8. Multi-Device Sync Correctness (#026) — NEW from round 3

**What:** Three related issues: (a) UUID tie-breaking is non-deterministic with 3+ devices, (b) sync merge bypasses business rule validation, (c) HLC timestamp growth path bypasses wall-clock check.

**Risk:** Low for 2-device sync, medium for 3+ devices.

**Fix:** (a) Per-field client UUID tracking. (b) Validate coupled fields after sync merge. (c) Use `max(last, wall_clock)` as growth base.

**Effort:** Small (c), Medium (b), Medium-Large (a).

**Trigger event:** (c) can be fixed now. (b) before remote sync. (a) before 3+ device sync.

## Priority Order

If doing a pre-release hardening sprint, address in this order:

1. **#008 CSP + #025 Filesystem IPC** — Critical security baseline. Do these together before sharing with anyone.
2. **#024 Sync snapshot race** — Critical data integrity. Small fix, high value.
3. **#026c HLC growth path** — One-line fix, improves sync correctness.
4. **#023c Integration tests** — Protects against regressions in the core pipeline.
5. **#012 Stale locks** — Small fix, improves reliability.
6. **#026b Sync business rules** — Before remote sync goes live.
7. **#011 Naming** — Mechanical, do when onboarding contributors.
8. **#026a UUID tie-breaking** — Before 3+ device sync.
9. **#009 Migration timestamps** — Likely never needed.
10. **#023a/b Rate limiting + path canonicalization** — Only when threat model expands.

## Review History

| Date | Event | Findings |
|------|-------|----------|
| 2026-02-21 | Holistic review round 1 (6 agents) | 11 findings (002-012), 6 fixed, 4 deferred, 1 cleaned up |
| 2026-02-21 | Holistic review round 2 (7 agents) | 10 findings (013-022), all fixed including #016 |
| 2026-02-21 | Spec created | Consolidated deferred items with trigger events |
| 2026-02-21 | Round 3 review | 4-agent holistic review (architecture, security, performance, data integrity). 3 new items: #024 sync race, #025 filesystem IPC, #026 multi-device sync correctness |
