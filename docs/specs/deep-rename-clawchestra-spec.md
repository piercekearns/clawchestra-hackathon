# Deep Rename to Clawchestra

> Rename every internal reference from "Pipeline Dashboard" to "Clawchestra" — Cargo package, data paths, session keys, env vars, identifiers — and migrate existing user data.

## Summary

The app's UI already says "Clawchestra" (title bar, update script, branding), but the internals are still "Pipeline Dashboard" or "pipeline-dashboard" in ~30 locations across Rust, TypeScript, config files, and shell scripts. This creates confusion for agents reading the code, breaks naming consistency, and would expose the old name to the friend during First Friend Readiness. This is mostly mechanical, but it now has two hard constraints: it must preserve Git Sync behavior (including local-only UI-triggered auto-commit policy) and it must not create avoidable onboarding friction for First Friend Readiness.

---

**Roadmap Item:** `deep-rename-clawchestra`
**Status:** Draft
**Created:** 2026-02-19
**Author:** Clawdbot

---

## Table of Contents

1. [Rename Targets](#rename-targets)
2. [Data Directory Migration](#data-directory-migration)
3. [Git Sync Compatibility Requirements](#git-sync-compatibility-requirements)
4. [FFR Alignment](#ffr-alignment)
5. [Sequencing Considerations](#sequencing-considerations)
6. [What NOT to Rename](#what-not-to-rename)
7. [Build Scope](#build-scope)
8. [Verification Checklist](#verification-checklist)

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
| `src-tauri/tauri.conf.json` `identifier` | `com.clawdbot.pipeline-dashboard` | `ai.clawchestra.desktop` |
| `src-tauri/capabilities/default.json` `description` | `"Default capability for Pipeline Dashboard"` | `"Default capability for Clawchestra"` |

**Note on identifier change:** Tauri uses the identifier for the app data directory on some platforms. Changing it may affect where Tauri itself stores data (separate from our custom settings path). Test that the app still finds its data after the identifier change.

### Tier 3: Session Key

| File | Line | Current | New |
|------|------|---------|-----|
| `src-tauri/src/lib.rs` | 15 | `"agent:main:pipeline-dashboard"` | `"agent:main:clawchestra"` |
| `src/lib/gateway.ts` | 117 | `'agent:main:pipeline-dashboard'` | `'agent:main:clawchestra'` |
| `src/lib/gateway.test.ts` | 120, 128, 535, 547, 566, 574, 582, 590 | `'agent:main:pipeline-dashboard'` | `'agent:main:clawchestra'` |

**Impact:** After this change, the app connects to a different OpenClaw session. Existing chat history in the gateway for the old session key is orphaned (still in JSONL, just not fetched). New session starts clean. This is acceptable — the local SQLite chat.db retains history regardless of session key.

FFR Phase 2 later makes this configurable via settings (with `agent:main:clawchestra` as the default). Deep Rename sets that default and removes the old hardcoded name so FFR can layer configuration on a clean baseline.

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
| `update.sh` | line 11 | `OLD_APP_NAME="Pipeline Dashboard"` | Keep as one-release fallback, remove in follow-up after first successful post-rename update |
| `update.sh` | line 13 | `PIPELINE_DASHBOARD_INSTALL_PATH` | `CLAWCHESTRA_INSTALL_PATH` |
| `update.sh` | line 15 | `PIPELINE_DASHBOARD_RESTART_AFTER_BUILD` | `CLAWCHESTRA_RESTART_AFTER_BUILD` |
| `update.sh` | line 16 | `"/tmp/pipeline-dashboard-update.lock"` | `"/tmp/clawchestra-update.lock"` |
| `update.sh` | line 82 | `killall "pipeline-dashboard"` | Keep as one-release fallback for legacy process names, remove in follow-up |

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

## Git Sync Compatibility Requirements

Deep Rename must be neutral with respect to Git Sync semantics.

1. **Do not tie rename behavior to Git Sync category taxonomy**
   - Metadata/Documents/Code grouping is for Sync UX; rename execution must not depend on that classification.

2. **Preserve local-only UI-triggered auto-commit behavior**
   - Project/roadmap Kanban status/priority moves on local-only repos should continue to auto-commit after rename.
   - This relies on trigger source (UI structural move), not file category labels.

3. **Avoid accidental mixed commits during migration**
   - Rename should be shipped as explicit migration-oriented commits (not via background auto-commit paths).
   - If any migration step encounters pre-existing unrelated dirty changes in target files, require explicit/manual commit path.

4. **Keep Git Sync branch labels and defaults coherent**
   - Local-only branch indicators (`(local)`) remain unchanged behaviorally.
   - Session-key default becomes `agent:main:clawchestra` consistently across backend/frontend.

---

## Data Directory Migration

This is the most complex part. There are **seven** data locations that reference the old name:

### Known data directories (macOS)

| Path | Contents | Migration |
|------|----------|-----------|
| `~/Library/Application Support/Pipeline Dashboard/` | settings.json, logs/ | Rename to `Clawchestra/` |
| `~/Library/Application Support/pipeline-dashboard/` | chat.db (SQLite) | Rename to `clawchestra/` |
| `~/Library/WebKit/pipeline-dashboard/` | WebView storage (localStorage) | See below |
| `~/Library/WebKit/com.clawdbot.pipeline-dashboard/` | WebView storage (identifier-keyed) | See below |
| `~/Library/WebKit/ai.clawchestra.desktop/` | New identifier-keyed WebView storage | Created on first launch post-rename |
| `~/Library/Preferences/com.clawdbot.pipeline-dashboard.plist` | macOS preferences | See below |
| `~/Library/Preferences/ai.clawchestra.desktop.plist` | New identifier-keyed preferences | Created on first launch post-rename |
| `~/Library/Caches/pipeline-dashboard/` | App cache | Can delete (non-critical) |
| `~/Library/Caches/com.clawdbot.pipeline-dashboard/` | Identifier-keyed cache | Can delete (non-critical) |
| `~/Library/Caches/ai.clawchestra.desktop/` | New identifier-keyed cache | Created on first launch post-rename |

### Critical: WebView Storage (localStorage)

Zustand's `persist` middleware stores state in **localStorage** inside the Tauri WebView. The localStorage key is `clawchestra-state` (already renamed). However, the WebView's storage location on disk is determined by the **Tauri identifier** (`com.clawdbot.pipeline-dashboard` pre-rename, `ai.clawchestra.desktop` post-rename).

**If we change the identifier to `ai.clawchestra.desktop`**, the WebView creates a new storage directory. The old localStorage data (theme preference, collapsed columns, column order, sidebar state) is orphaned in the old WebKit directory.

**Options:**

1. **Don't change the identifier** — WebView storage survives, but the app identifier stays as the old name forever. Clean for now, messy long-term.
2. **Change the identifier + migrate WebKit directories** — Rename `~/Library/WebKit/com.clawdbot.pipeline-dashboard/` → `~/Library/WebKit/ai.clawchestra.desktop/`. Risky — WebKit may validate directory names against internal state.
3. **Change the identifier + accept localStorage loss** — User loses theme/sidebar/column preferences. They're trivial to reconfigure (a few clicks). This is the safest option.

**Recommendation: Option 3.** The persisted state is 5 fields (theme, collapsedColumns, columnOrder, sidebarOpen, sidebarWidth) — all trivially recoverable by the user. Attempting to migrate WebKit directories risks corrupting WebView state. Cache directories can be safely deleted (non-critical).

### Critical: Board ID Stability

Project IDs are derived from the **folder name** via `canonicalSlugify()`:
```typescript
const folderName = dirPath.split('/').pop() ?? dirPath;
const id = canonicalSlugify(folderName); // "pipeline-dashboard" → "pipeline-dashboard"
```

If the repo folder moves from one canonical location to another, the project ID changes from `pipeline-dashboard` to `clawchestra`. This affects:

- **`selectedProjectId`** in Zustand — project won't auto-select after rename (minor, resets on next click)
- **`collapsedColumns[boardId]`** — board-specific column state uses `roadmap:{projectId}` as key. Old state orphaned. (Mitigated by Option 3 above — localStorage is reset anyway)
- **`columnOrder[boardId]`** — same as above

Since we're accepting localStorage loss (Option 3), the board ID change is a non-issue — all board state resets to defaults.

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
    
    // Clean up old cache directories (non-critical)
    let cache_dir = dirs::cache_dir().unwrap();
    let _ = fs::remove_dir_all(cache_dir.join("pipeline-dashboard"));
    let _ = fs::remove_dir_all(cache_dir.join("com.clawdbot.pipeline-dashboard"));
    
    // Clean up old preferences plist (macOS only)
    #[cfg(target_os = "macos")]
    {
        let prefs = dirs::home_dir().unwrap().join("Library/Preferences/com.clawdbot.pipeline-dashboard.plist");
        let _ = fs::remove_file(prefs);
    }
    
    // Old WebKit directories left in place — don't touch WebKit internals
    // They'll be ignored and eventually cleaned up by macOS
    
    Ok(())
}
```

**Rules:**
- Only migrate if old path exists AND new path doesn't — idempotent, safe to run repeatedly
- Use `fs::rename` (atomic on same filesystem) — not copy+delete
- If migration fails, log error but don't crash — settings will be recreated from defaults
- Migration runs once, then old paths are gone. No dual-path lookup.
- **Do NOT migrate WebKit directories** — let macOS handle stale WebKit data
- **Do NOT migrate plist** — Tauri creates a new one automatically
- Cache directories: delete old ones (best-effort, non-fatal)
- Clean up old `update.sh` references to `OLD_APP_NAME` / `OLD_INSTALL_PATH` — the transition from "Pipeline Dashboard" to "Clawchestra" in `/Applications/` is already handled there and can be removed post-migration.

### Rollback / Recovery Runbook

If migration partially fails in production:

1. Stop the app.
2. Inspect both old and new directories:
   - `~/Library/Application Support/Pipeline Dashboard/`
   - `~/Library/Application Support/Clawchestra/`
   - `~/Library/Application Support/pipeline-dashboard/`
   - `~/Library/Application Support/clawchestra/`
3. If old has the latest data and new is partial/empty:
   - Move new aside (timestamp suffix), then restore old as source of truth.
4. Relaunch app once and re-run migration.
5. If still failing, keep old path as source of truth for that machine, log error details, and disable automatic migration for that install until patched.

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
| Tauri identifier → `ai.clawchestra.desktop` | FFR Phase 1 cross-platform config | May affect Tauri's own data directory — test on macOS before FFR adds platforms |
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
The repo currently lives at `<repo-root>/`. Renaming the folder is optional and should be treated as a separate/manual migration step.

**Decision:** Defer folder rename out of this spec's implementation scope.

Why:
- It changes derived project IDs (`canonicalSlugify(folderName)`), which can churn board identity/state.
- It adds avoidable moving parts while Git Sync Phase 2/3 are being stabilized.
- It is not required for internal code rename correctness.

Document it as a follow-up operational step once Deep Rename + Git Sync milestones are verified.

---

## What NOT to Rename

| Item | Why |
|------|-----|
| Historical docs (`docs/plans/`, old specs) | They describe what was true at the time. Falsifying history helps no one. |
| `CHANGELOG.md` entries | Historical record |
| `REVIEW-FIXES.md` | Historical review document |
| Git commit history | Obviously |
| Repo folder path (`<repo-root>`) as part of this build | Deferred/manual post-migration step to avoid project ID churn during active Git Sync work |
| `roadmap.ts` migration code (`shipped` → `complete`) | Legacy migration, still needed |
| `update.sh` OLD_APP_NAME cleanup logic | Keep until first successful update post-rename confirms `/Applications/Pipeline Dashboard.app` is gone, then remove in a follow-up |

---

## Risks and Edge Cases

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Tauri identifier change moves WebView storage | High (by design) | Low | Accept localStorage loss — 5 trivial preferences |
| `fs::rename` fails cross-filesystem | Low (same disk) | Medium | Fall back to copy+delete; log warning |
| OpenClaw rejects new session key | Very Low | Medium | OpenClaw creates sessions lazily — new key just works |
| Build cache (`target/`) stale after crate rename | Certain | None | Cargo rebuilds automatically; may be slow first time |
| Folder rename changes project ID → board state orphaned | High if folder renamed | Low | localStorage reset anyway; project re-discovers fine |
| `parent: pipeline-dashboard` in roadmap detail files not updated | Medium | Low | These files are agent/human reference only, not consumed by app. Update anyway for consistency. |
| macOS Gatekeeper flags renamed app | Low | Medium | Already unsigned; user already accepted risk |
| Friend clones repo and gets migration code for a directory they don't have | Certain | None | Migration is idempotent — no-op when old paths don't exist |

---

## Build Scope

**Estimated file changes:** ~15 files (excluding `target/` rebuild and `package-lock.json` regeneration)

**Estimated effort:** Small-Medium. The rename is mechanical, but the data migration needs care and testing.

### Deliverables
1. Cargo package renamed (`clawchestra` / `clawchestra_lib`)
2. All internal string references updated (session key, paths, env vars, identifiers)
3. Data migration function (settings dir + chat DB dir, idempotent)
4. `settings_file_path()` switched to `dirs` crate (small FFR-aligned improvement)
5. `update.sh` cleaned up (new env var names + lock path, with one-release legacy fallback retained)
6. `package.json` name updated
7. Documentation content updated (PROJECT.md, OVERVIEW.md, roadmap parent fields)
8. All tests passing (`bun test` + `cargo check`)
9. Roadmap item `parent:` fields updated across all `roadmap/*.md` files

### NOT in scope (deferred to FFR)
- Making session key configurable (FFR Phase 2)
- Switching remaining 7 `env::var("HOME")` calls to `dirs` (FFR Phase 1)
- Cross-platform update scripts (FFR Phase 1)
- Renaming the git repo folder (manual follow-up after Deep Rename + Git Sync validation)

---

## Verification Checklist

After the rename, verify:

### Build
- [ ] `cargo check` passes
- [ ] `bun test` passes (85+ tests)
- [ ] `npx tsc --noEmit` passes
- [ ] `pnpm build` succeeds
- [ ] `npx tauri build --no-bundle` succeeds

### Data Migration
- [ ] App launches and finds existing settings (migration worked)
- [ ] Chat history preserved (chat.db migrated to `~/Library/Application Support/clawchestra/`)
- [ ] Settings migrated to `~/Library/Application Support/Clawchestra/`
- [ ] Old settings dir `~/Library/Application Support/Pipeline Dashboard/` no longer exists
- [ ] Old chat DB dir `~/Library/Application Support/pipeline-dashboard/` no longer exists
- [ ] Old cache dirs cleaned up (best-effort)
- [ ] Theme/sidebar preferences reset to defaults (expected — localStorage lost with identifier change)
- [ ] Migration test: old exists + new missing -> rename occurs once
- [ ] Migration test: old missing + new exists -> no-op
- [ ] Migration test: old exists + new exists -> no-op (no overwrite)
- [ ] Migration test: forced rename error -> app continues with logged warning

### Functionality
- [ ] Chat connects to OpenClaw (new session key `agent:main:clawchestra` works)
- [ ] Projects load correctly on the board
- [ ] Roadmap view works for Clawchestra project
- [ ] Update button works (new env vars, new lock file path)
- [ ] Second launch: migration is a no-op (idempotent)
- [ ] Local-only UI Kanban structural moves still auto-commit as before rename
- [ ] Git Sync dialog still shows expected dirty state behavior after rename

### Code Hygiene
- [ ] `rg -n --glob '!src-tauri/target/**' --glob '!dist/**' --glob '!node_modules/**' "pipeline.dashboard|pipeline_dashboard|Pipeline Dashboard" src src-tauri/src` returns only: historical comments, migration code, or `killall` fallback
- [ ] `rg -n --glob '!src-tauri/target/**' --glob '!dist/**' --glob '!node_modules/**' "PIPELINE_DASHBOARD" src src-tauri update.sh` returns nothing
