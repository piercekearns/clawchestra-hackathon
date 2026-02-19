# Deep Rename to Clawchestra

> Rename every internal reference from "Pipeline Dashboard" to "Clawchestra" — Cargo package, data paths, session keys, env vars, identifiers — and migrate existing user data.

## Summary

The app's UI already says "Clawchestra" (title bar, update script, branding), but the internals are still "Pipeline Dashboard" or "pipeline-dashboard" in ~30 locations across Rust, TypeScript, config files, and shell scripts. This creates confusion for agents reading the code, breaks naming consistency, and would expose the old name to the friend during First Friend Readiness. This is a mechanical rename with one non-trivial piece: migrating Pierce's existing data directory so settings and chat history aren't lost.

---

**Roadmap Item:** `deep-rename-clawchestra`
**Status:** Draft
**Created:** 2026-02-19
**Author:** Clawdbot

---

## Table of Contents

1. [Rename Targets](#rename-targets)
2. [Data Directory Migration](#data-directory-migration)
3. [FFR Alignment](#ffr-alignment)
4. [Sequencing Considerations](#sequencing-considerations)
5. [What NOT to Rename](#what-not-to-rename)
6. [Build Scope](#build-scope)
7. [Verification Checklist](#verification-checklist)

---

## Rename Targets

### Tier 1: Cargo / Rust (breaks build if wrong)

| File | Current | New |
|------|---------|-----|
| `src-tauri/Cargo.toml` `[package] name` | `pipeline-dashboard` | `clawchestra` |
| `src-tauri/Cargo.toml` `[lib] name` | `pipeline_dashboard_lib` | `clawchestra_lib` |
| `src-tauri/Cargo.toml` `description` | `"Pipeline Dashboard"` | `"Clawchestra"` |
| `src-tauri/src/main.rs` | `pipeline_dashboard_lib::run()` | `clawchestra_lib::run()` |

After this change, `cargo check` must pass. The `target/` directory will rebuild from scratch (new crate name = new fingerprints).

### Tier 2: Tauri Config / Identity

| File | Current | New |
|------|---------|-----|
| `src-tauri/tauri.conf.json` `identifier` | `com.clawdbot.pipeline-dashboard` | `com.clawdbot.clawchestra` |
| `src-tauri/capabilities/default.json` `description` | `"Default capability for Pipeline Dashboard"` | `"Default capability for Clawchestra"` |

**Note on identifier change:** Tauri uses the identifier for the app data directory on some platforms. Changing it may affect where Tauri itself stores data (separate from our custom settings path). Test that the app still finds its data after the identifier change.

### Tier 3: Session Key

| File | Line | Current | New |
|------|------|---------|-----|
| `src-tauri/src/lib.rs` | 15 | `"agent:main:pipeline-dashboard"` | `"agent:main:clawchestra"` |
| `src/lib/gateway.ts` | 117 | `'agent:main:pipeline-dashboard'` | `'agent:main:clawchestra'` |
| `src/lib/gateway.test.ts` | 120, 128, 535, 547, 566, 574, 582, 590 | `'agent:main:pipeline-dashboard'` | `'agent:main:clawchestra'` |

**Impact:** After this change, the app connects to a different OpenClaw session. Existing chat history in the gateway for the old session key is orphaned (still in JSONL, just not fetched). New session starts clean. This is acceptable — the local SQLite chat.db retains history regardless of session key.

FFR Phase 2 later makes this configurable via settings (with `agent:main:clawchestra` as the default). Deep Rename just changes the hardcoded constant.

### Tier 4: Data Paths in `lib.rs`

| Location | Line(s) | Current | New |
|----------|---------|---------|-----|
| `settings_file_path()` macOS | 137 | `"Pipeline Dashboard"` | `"Clawchestra"` |
| `settings_file_path()` Windows | 142, 148 | `"Pipeline Dashboard"` | `"Clawchestra"` |
| `settings_file_path()` Linux | 154 | `"pipeline-dashboard"` | `"clawchestra"` |
| `get_chat_db_path()` | 1839 | `"pipeline-dashboard"` | `"clawchestra"` |

These paths determine where settings.json and chat.db live on disk. Changing them without migration = data loss. See [Data Directory Migration](#data-directory-migration).

### Tier 5: Env Vars, Lock Files, Temp Names

| File | Location | Current | New |
|------|----------|---------|-----|
| `lib.rs` | line 906 | `"pipeline-dashboard-{nanos}"` (idempotency key) | `"clawchestra-{nanos}"` |
| `lib.rs` | line 1385 | `"/tmp/pipeline-dashboard-update.lock"` | `"/tmp/clawchestra-update.lock"` |
| `lib.rs` | line 1524 | `PIPELINE_DASHBOARD_INSTALL_PATH` | `CLAWCHESTRA_INSTALL_PATH` |
| `lib.rs` | line 1525 | `PIPELINE_DASHBOARD_RESTART_AFTER_BUILD` | `CLAWCHESTRA_RESTART_AFTER_BUILD` |
| `lib.rs` | line 2271 | `"pipeline-dashboard-{name}-{uuid}"` (test temp dirs) | `"clawchestra-{name}-{uuid}"` |
| `update.sh` | line 11 | `OLD_APP_NAME="Pipeline Dashboard"` | Remove entirely (migration complete) |
| `update.sh` | line 13 | `PIPELINE_DASHBOARD_INSTALL_PATH` | `CLAWCHESTRA_INSTALL_PATH` |
| `update.sh` | line 15 | `PIPELINE_DASHBOARD_RESTART_AFTER_BUILD` | `CLAWCHESTRA_RESTART_AFTER_BUILD` |
| `update.sh` | line 16 | `"/tmp/pipeline-dashboard-update.lock"` | `"/tmp/clawchestra-update.lock"` |
| `update.sh` | line 82 | `killall "pipeline-dashboard"` | Remove (binary name is already `Clawchestra`) |

### Tier 6: Frontend / package.json

| File | Field | Current | New |
|------|-------|---------|-----|
| `package.json` `name` | | `pipeline-dashboard` | `clawchestra` |
| `package-lock.json` | Auto-regenerates | `pipeline-dashboard` | `clawchestra` |

### Tier 7: Content / Documentation

| File | What | Action |
|------|------|--------|
| `PROJECT.md` | Sub-heading says "Pipeline Dashboard" | Change to "Clawchestra" |
| `OVERVIEW.md` | Title + content | Update |
| `docs/AGENTS.md` | Already says "Clawchestra" in header | ✅ No change needed |
| `CLAUDE.md` | Already says "Clawchestra" | ✅ No change needed |
| Various `roadmap/*.md` | `parent: pipeline-dashboard` field | Update to `parent: clawchestra` |
| Various `docs/plans/*.md` | Historical references | Leave as-is (historical) |

---

## Data Directory Migration

This is the only non-trivial part. Pierce has existing data at:
- **macOS:** `~/Library/Application Support/Pipeline Dashboard/` (settings.json, logs/)
- **Chat DB:** `~/Library/Application Support/pipeline-dashboard/chat.db` (via `dirs::data_dir()`)

After rename, new paths would be:
- **macOS:** `~/Library/Application Support/Clawchestra/` (settings)
- **Chat DB:** `~/Library/Application Support/clawchestra/chat.db`

### Migration Strategy

On app startup, before reading settings:

```rust
fn migrate_data_directory() -> Result<(), String> {
    // Settings directory
    let old_settings_dir = /* old "Pipeline Dashboard" path */;
    let new_settings_dir = /* new "Clawchestra" path */;
    
    if old_settings_dir.exists() && !new_settings_dir.exists() {
        fs::rename(&old_settings_dir, &new_settings_dir)
            .map_err(|e| format!("Migration failed: {e}"))?;
    }
    
    // Chat DB directory  
    let old_db_dir = dirs::data_dir().unwrap().join("pipeline-dashboard");
    let new_db_dir = dirs::data_dir().unwrap().join("clawchestra");
    
    if old_db_dir.exists() && !new_db_dir.exists() {
        fs::rename(&old_db_dir, &new_db_dir)
            .map_err(|e| format!("Chat DB migration failed: {e}"))?;
    }
    
    Ok(())
}
```

**Rules:**
- Only migrate if old path exists AND new path doesn't — idempotent, safe to run repeatedly
- Use `fs::rename` (atomic on same filesystem) — not copy+delete
- If migration fails, log error but don't crash — settings will be recreated from defaults
- Migration runs once, then old paths are gone. No dual-path lookup.
- Clean up old `update.sh` references to `OLD_APP_NAME` / `OLD_INSTALL_PATH` — the transition from "Pipeline Dashboard" to "Clawchestra" in `/Applications/` is already handled there and can be removed post-migration.

### `env::var("HOME")` vs `dirs` crate

Currently mixed: `get_chat_db_path()` uses `dirs::data_dir()` but `settings_file_path()` uses `env::var("HOME")` with manual platform branching. 

**Decision point for sequencing:** Should Deep Rename also switch `settings_file_path()` to use `dirs` crate? 

**Recommendation: Yes.** It's a small incremental change (4 lines), it eliminates the manual platform branching that's already in `settings_file_path()`, and it means the migration code only needs to deal with `dirs`-based paths on both sides. This steals a small piece from FFR Phase 1, but it's the exact piece that makes the migration clean. FFR Phase 1 then only needs to fix the remaining `env::var("HOME")` calls (lines 91, 111, 667, 739, 821, 1345, 1612) — the settings path is already done.

---

## FFR Alignment

How each Deep Rename change relates to First Friend Readiness:

| Deep Rename Change | FFR Touchpoint | Interaction |
|---|---|---|
| Session key → `agent:main:clawchestra` | FFR Phase 2 makes it configurable | No conflict — DR sets new default, FFR adds UI override |
| Data paths → `Clawchestra` / `clawchestra` | FFR Phase 1 switches remaining `env::var("HOME")` to `dirs` | DR handles settings path + migration; FFR handles the other 7 call sites |
| Env vars → `CLAWCHESTRA_*` | FFR Phase 1 cross-platform update scripts | DR renames; FFR adds Windows equivalents using new names |
| `update.sh` cleanup | FFR adds `update.bat`/`update.ps1` | DR cleans macOS script; FFR adds cross-platform scripts |
| Tauri identifier change | FFR Phase 1 cross-platform config | May affect Tauri's own data directory — test on macOS before FFR adds platforms |
| Package/crate rename | No FFR impact | Pure rename, no downstream dependency |
| `killall "pipeline-dashboard"` in update.sh | FFR cross-platform update | Remove — binary name is already `Clawchestra`. FFR uses process name from config |

**No conflicts.** Deep Rename completes the name migration; FFR builds on top of the renamed codebase. The one shared concern (settings path + `dirs` crate) is handled by doing the `dirs` switch for settings in Deep Rename, leaving FFR to handle the remaining call sites.

---

## Sequencing Considerations

### Must happen BEFORE Deep Rename
- Nothing. Deep Rename has no prerequisites (Git Sync is P1 but independent).

### Must happen AFTER Deep Rename
- **FFR Phase 1** — expects codebase to say "Clawchestra" everywhere
- **FFR Phase 2** — builds configurable gateway on top of renamed session key

### Within Deep Rename, the order matters:
1. **Cargo.toml + main.rs** first — get the build working under the new crate name
2. **Data migration code** — add migration function before changing paths
3. **All path references** — settings, chat DB, lock files, temp dirs
4. **Session key** — both Rust and TypeScript
5. **Config files** — tauri.conf.json, capabilities, package.json
6. **Env vars + update.sh** — last, since they're runtime not build-time
7. **Content/docs** — roadmap parent fields, PROJECT.md, OVERVIEW.md

### Repo folder name
The repo lives at `~/repos/pipeline-dashboard/`. Renaming the folder to `~/repos/clawchestra/` is optional — it doesn't affect the build, and `git remote` URLs don't change. But for consistency with the friend's experience, it should be renamed. This is a manual step: `mv ~/repos/pipeline-dashboard ~/repos/clawchestra` + update scan paths in settings.

---

## What NOT to Rename

| Item | Why |
|------|-----|
| Historical docs (`docs/plans/`, old specs) | They describe what was true at the time. Falsifying history helps no one. |
| `CHANGELOG.md` entries | Historical record |
| `REVIEW-FIXES.md` | Historical review document |
| Git commit history | Obviously |
| `roadmap.ts` migration code (`shipped` → `complete`) | Legacy migration, still needed |
| `update.sh` OLD_APP_NAME cleanup logic | Keep until first successful update post-rename confirms `/Applications/Pipeline Dashboard.app` is gone, then remove in a follow-up |

---

## Build Scope

**Estimated file changes:** ~15 files (excluding `target/` rebuild and `package-lock.json` regeneration)

**Estimated effort:** Small-Medium. The rename is mechanical, but the data migration needs care and testing.

### Deliverables
1. Cargo package renamed (`clawchestra` / `clawchestra_lib`)
2. All internal string references updated (session key, paths, env vars, identifiers)
3. Data migration function (settings dir + chat DB dir, idempotent)
4. `settings_file_path()` switched to `dirs` crate (small FFR-aligned improvement)
5. `update.sh` cleaned up (remove old-name references, update env var names)
6. `package.json` name updated
7. Documentation content updated (PROJECT.md, OVERVIEW.md, roadmap parent fields)
8. All tests passing (`bun test` + `cargo check`)
9. Roadmap item `parent:` fields updated across all `roadmap/*.md` files

### NOT in scope (deferred to FFR)
- Making session key configurable (FFR Phase 2)
- Switching remaining 7 `env::var("HOME")` calls to `dirs` (FFR Phase 1)
- Cross-platform update scripts (FFR Phase 1)
- Renaming the git repo folder (manual step, documented in release notes)

---

## Verification Checklist

After the rename, verify:

- [ ] `cargo check` passes
- [ ] `bun test` passes (85+ tests)
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm build` succeeds
- [ ] `npx tauri build --no-bundle` succeeds
- [ ] App launches and finds existing settings (migration worked)
- [ ] Chat history preserved (chat.db migrated)
- [ ] Chat connects to OpenClaw (new session key works)
- [ ] `grep -r "pipeline.dashboard\|pipeline_dashboard\|Pipeline Dashboard" src/ src-tauri/src/` returns only historical comments or migration code
- [ ] Update button works (new env vars, new lock file path)
- [ ] No old data directory left at `~/Library/Application Support/Pipeline Dashboard/`
