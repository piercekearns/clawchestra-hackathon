---
title: "Large-Scale Tauri Architecture Overhaul: Catalog to Scan Migration"
category: refactoring
tags: [tauri, rust, typescript, migration, dead-code, type-safety, scan-based-discovery]
module: Pipeline Dashboard
symptom: "Catalog-based project discovery was fragile, duplicative, and hard to maintain"
root_cause: "Architecture relied on stub files in app-support dir rather than filesystem as source of truth"
date: 2026-02-13
phases_completed: 3
files_changed: 23
lines_removed: 1494
lines_added: 693
---

# Large-Scale Tauri Architecture Overhaul

## Problem

The Pipeline Dashboard discovered projects via "catalog entries" (markdown stubs) in `~/Library/Application Support/Pipeline Dashboard/catalog/projects/`. This created:

- Duplication between stubs and actual repo `PROJECT.md` files
- Stale data when stub status diverged from repo state
- Complex `trackingMode` (`linked` vs `catalog-only`) concept with no real value
- A V2 migration system (~450 lines of Rust) that moved repos around the filesystem

## Solution

Replaced catalog-based discovery with scan-based discovery:

- **Settings**: `catalogRoot + workspaceRoots + approvedExternalPaths` simplified to `scanPaths: string[]`
- **Discovery**: Rust `scan_projects` command walks each scan path one level deep, returns dirs containing `PROJECT.md`
- **Frontend**: Reads `PROJECT.md` directly via gray-matter, derives `id` from folder name via `canonicalSlugify()`
- **Tier derivation**: `hasRepo ? 'github' : hasGit ? 'local' : 'idea'` — computed, not stored

## Key Lessons

### 1. Interface Contract Mismatches Hide in String Parameters

**What happened:** After refactoring `createProject()` to take `dirPath` instead of `id`, the store's `createProjectAndReload` still declared its first param as `id: string`. TypeScript was happy because both are strings.

**Prevention:**
- When renaming a function parameter's semantic meaning, grep for all callers and update the names
- Consider branded types (`type DirPath = string & { __brand: 'DirPath' }`) for parameters that look alike but mean different things
- Write a contract test: `expect(createProject).toBeCalledWith(expect.stringContaining('/'))` catches relative paths

### 2. Error Type Definitions Must Be Wired End-to-End

**What happened:** `scan_path_missing` error type was defined in TypeScript and handled in the UI, but the Rust backend returned `reason: "not found"` and `getProjects()` only checked for `"permission denied"`. The error was silently swallowed.

**Prevention:**
- When adding a new error type, trace the full path: Rust emitter → TypeScript consumer → UI display
- Add an integration test that exercises each skip reason from the Rust scanner
- Use exhaustive switch/if-else on `skipped.reason` with a fallback that logs unknown reasons

### 3. Dead Code Accumulates Silently After Major Refactors

**What happened:** After removing the catalog system, ~170 lines of dead code remained:
- `NOISE_DIRS` constant declared but never used
- `BOARD_COLUMNS` export identical to `PROJECT_COLUMNS`
- `ensureValidStatus()` duplicating `isProjectStatus()` from schema
- `listFiles` / `list_files` Rust command with no callers
- `SKIP_FILE_NAMES` and `LEGACY_SKIP_DIR_NAMES` Rust constants only used by removed code
- `migratedItem` variable assigned but never read

**Prevention:**
- Run a dead-code sweep after every major refactor phase (grep for exports, check callers)
- Use `eslint no-unused-vars` with `noUnusedLocals` in tsconfig
- Use `cargo clippy -- -W dead_code` for Rust
- Include "dead code sweep" as an explicit step in refactoring plans

### 4. Serde Defaults Handle Settings Migration Gracefully

**What happened:** Old settings files with `catalogRoot`/`workspaceRoots` needed to work after the upgrade. Using `#[serde(default = "default_scan_paths")]` on the new field meant serde silently ignores unknown old fields and populates the new field from the default function.

**Key insight:** No explicit migration code needed. The `sanitize_settings()` function normalizes on every load, and writing back the sanitized version removes stale fields automatically.

### 5. Phase-Based Execution With Validate Gates Catches Issues Early

**Structure used:**
```
For each phase:
  1. Implement changes
  2. Run `pnpm validate` (tsc + tests + vite build)
  3. Run `cargo build` for Rust changes
  4. Run review agents
  5. Fix critical issues
  6. Log non-critical items
  7. Move to next phase
```

**Why it worked:** Each validation gate caught issues within the phase that introduced them, not 3 phases later when the context was cold.

### 6. Rust Compiler Is Your Best Friend During Cleanup

**What happened:** Removing struct fields (`catalog_root`, `workspace_roots`) from `DashboardSettings` caused cascading compile errors that pointed directly to every function still referencing the old fields. This made cleanup mechanical: fix error → check if function is still needed → delete or update → next error.

**Key insight:** In Rust, aggressive deletion is safe because the compiler won't let you miss a reference. In TypeScript, it's riskier because `any` types and dynamic access can hide references. Always run `tsc --noEmit` after each edit batch.

## Checklist for Future Large Refactors

- [ ] Plan phases with clear boundaries (types first, then logic, then UI)
- [ ] Run `pnpm validate` + `cargo build` after every phase
- [ ] Trace removed types/fields across all files before deleting
- [ ] Check store interfaces match underlying function signatures
- [ ] Wire error types end-to-end: emitter → consumer → display
- [ ] Run dead-code sweep after removing major features
- [ ] Use serde defaults for settings migration (no explicit migration code needed)
- [ ] Let the Rust compiler guide cascading deletions

## Files Changed

**Core (types + settings):** `schema.ts`, `settings.ts`, `errors.ts`, `tauri.ts`
**Logic:** `projects.ts`, `project-flows.ts`, `watcher.ts`, `store.ts`, `changelog.ts`
**UI:** `App.tsx`, `SettingsDialog.tsx`, `AddProjectDialog.tsx`, `ProjectDetails.tsx`, `ProjectModalHeader.tsx`, `ProjectModal.tsx`, `SearchResultItem.tsx`, `ErrorBadge.tsx`, `useProjectModal.ts`
**Tests:** `schema.test.ts`, `hierarchy.test.ts`, `project-flows.rollback.test.ts`
**Rust:** `src-tauri/src/lib.rs`
**Docs:** `SCHEMA.md`, `AGENTS.md`
