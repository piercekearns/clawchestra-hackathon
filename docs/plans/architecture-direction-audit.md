# Architecture Direction: Codebase Audit

> Phase 1.1 — Every reference to PROJECT.md, ROADMAP.md, CHANGELOG.md across the codebase, classified as **update**, **remove**, or **keep**.
>
> **Date:** 2026-02-21

---

## Source Code References (must act on)

### `src-tauri/src/lib.rs`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 709-710 | `PROJECT.md` — project discovery check | **update** | Scan for `CLAWCHESTRA.md` first, fall back to `PROJECT.md` (Phase 3.1) |
| 1444 | `METADATA_FILES: &[&str] = &["PROJECT.md"]` | **update** | Add `CLAWCHESTRA.md`, keep `PROJECT.md` during transition |
| 1447 | `DOCUMENT_FILES: &[&str] = &["ROADMAP.md", "CHANGELOG.md"]` | **remove** | These files cease to exist post-migration |
| 3426 | Test: `categorize_dirty_file("PROJECT.md")` | **update** | Update test to use `CLAWCHESTRA.md` |
| 3431 | Test: `categorize_dirty_file("ROADMAP.md")` | **remove** | Dead test post-migration |
| 3433 | Test: `categorize_dirty_file("CHANGELOG.md")` | **remove** | Dead test post-migration |
| 3495-3502 | Test fixtures with `PROJECT.md` | **update** | Use `CLAWCHESTRA.md` |
| 3496 | Test fixture with `ROADMAP.md` | **remove** | Dead post-migration |
| 3505 | Test assertion `ROADMAP.md` in documents | **remove** | Dead post-migration |
| 3540 | Test: `validate_commit_path("PROJECT.md")` | **update** | Use `CLAWCHESTRA.md` |

### `src/lib/store.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 566 | `['PROJECT.md']` hardcoded as auto-commit target | **update** | Change to `['CLAWCHESTRA.md']` (Phase 5.2) |

### `src/lib/git-sync-utils.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 23 | `METADATA_FILES = new Set(['PROJECT.md'])` | **update** | Add `CLAWCHESTRA.md`, keep `PROJECT.md` during transition |
| 24 | `DOCUMENT_FILES = new Set(['ROADMAP.md', 'CHANGELOG.md'])` | **remove** | These files cease to exist post-migration |

### `src/lib/auto-commit.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 5 | `AUTO_COMMIT_ALLOWED = new Set(['PROJECT.md', 'ROADMAP.md'])` | **update** | Change to `new Set(['CLAWCHESTRA.md'])` (Phase 5.2) |
| 9 | Comment: "Only commits PROJECT.md/ROADMAP.md" | **update** | Update comment |

### `src/lib/watcher.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 1-41 | Entire module | **remove** | Replaced by unified Rust watcher (D9, Phase 2.3) |

### `src/lib/git.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 36 | `files: string[] = ['PROJECT.md', 'ROADMAP.md']` default param | **update** | Change to `['CLAWCHESTRA.md']` |

### `src/lib/projects.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 57-59 | `PROJECT.md` — project file path construction | **update** | Scan for `CLAWCHESTRA.md` first, fall back |
| 76 | Error: `'Could not read PROJECT.md'` | **update** | Update error message |
| 107 | `ROADMAP.md` file path | **remove** | State comes from DB post-migration |
| 108 | `CHANGELOG.md` file path | **remove** | State comes from DB post-migration |
| 208 | `PROJECT.md` write path | **update** | Write to `CLAWCHESTRA.md` |

### `src/lib/roadmap.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 106 | Comment: "from ROADMAP.md YAML" | **remove** | Dead code post-migration (readRoadmap/writeRoadmap) |
| 123 | Comment: "explicit override in ROADMAP.md" | **remove** | Dead code post-migration |

### `src/lib/changelog.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 106 | `CHANGELOG.md` creation | **remove** | Entire module becomes dead code post-migration |
| 112 | `ROADMAP.md` read | **remove** | Dead code post-migration |
| 132 | `ROADMAP.md` remove item | **remove** | Dead code post-migration |

### `src/lib/templates.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 32 | `readTemplate('docs/templates/PROJECT.md')` | **update** | Template becomes `CLAWCHESTRA.md` |
| 36 | `readTemplate('docs/templates/ROADMAP.md')` | **remove** | No ROADMAP.md scaffolding post-migration |
| 44 | `writeIfMissing(..., projectTemplate)` for `PROJECT.md` | **update** | Write `CLAWCHESTRA.md` |
| 45 | `writeIfMissing(resolvedRepoPath + '/ROADMAP.md', ...)` | **remove** | No ROADMAP.md scaffolding |

### `src/lib/project-flows.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 134 | `PROJECT.md` path | **update** | Use `CLAWCHESTRA.md` |
| 135 | `ROADMAP.md` path | **remove** | No ROADMAP.md creation |
| 174-189 | Compatibility checks for `PROJECT.md` | **update** | Check for `CLAWCHESTRA.md` |
| 197-198 | `ROADMAP.md` in action plan | **remove** | No ROADMAP.md scaffolding |
| 341 | Write `PROJECT.md` | **update** | Write `CLAWCHESTRA.md` |
| 342 | Push `'PROJECT.md'` to createdFiles | **update** | Push `'CLAWCHESTRA.md'` |
| 345-346 | Write + push `ROADMAP.md` | **remove** | No ROADMAP.md creation |
| 395 | Error: `PROJECT.md frontmatter is invalid` | **update** | Update message |
| 429 | `PROJECT.md` path | **update** | Use `CLAWCHESTRA.md` |
| 455 | Write `ROADMAP.md` | **remove** | No ROADMAP.md creation |
| 463-464 | Git add `'ROADMAP.md'` | **remove** | No ROADMAP.md |

### `src/App.tsx`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 1081 | `'No ROADMAP.md found for ...'` | **remove** | Dead code post-migration |
| 1138 | `autoCommitIfLocalOnly(..., ['ROADMAP.md'], ...)` | **remove** | Kanban writes to state.json, not ROADMAP.md |
| 1140 | `withOptimisticDirtyFile(..., 'ROADMAP.md', 'documents')` | **remove** | Dead code |
| 1231 | `autoCommitIfLocalOnly(..., ['PROJECT.md'], ...)` | **update** | Change to `['CLAWCHESTRA.md']` |
| 1245 | `withOptimisticDirtyFile(..., 'PROJECT.md', 'metadata')` | **update** | Change to `'CLAWCHESTRA.md'` |

### `src/components/AddProjectDialog.tsx`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 263 | `"Create ROADMAP.md"` label | **remove** | No ROADMAP.md scaffolding post-migration |
| 364 | `"PROJECT.md:"` display label | **update** | Display `CLAWCHESTRA.md` |
| 365 | `"ROADMAP.md:"` display label | **remove** | No ROADMAP.md display |
| 418 | `"Create PROJECT.md if missing"` | **update** | `Create CLAWCHESTRA.md if missing` |
| 427 | `"Add PROJECT.md frontmatter"` | **update** | `Add CLAWCHESTRA.md frontmatter` |
| 436 | `"Create ROADMAP.md when missing"` | **remove** | No ROADMAP.md scaffolding |

### `src/lib/schema.ts`

| Line | Reference | Classification | Notes |
|------|-----------|----------------|-------|
| 164 | Comment: `Absolute path to the PROJECT.md file` | **update** | Update comment |
| 166 | Comment: `parent of PROJECT.md` | **update** | Update comment |

### Test Files

| File | Lines | Reference | Classification | Notes |
|------|-------|-----------|----------------|-------|
| `src/lib/git-sync.test.ts` | 197-251 | Multiple `PROJECT.md`, `ROADMAP.md` in test fixtures | **update** | Update fixtures |
| `src/lib/git-sync.test.ts` | 274-279 | `categorizeFile('PROJECT.md')`, `categorizeFile('ROADMAP.md')` | **update/remove** | Update/remove test assertions |
| `src/lib/git-sync.test.ts` | 282-283 | `categorizeFile('CHANGELOG.md')` | **remove** | Dead test |
| `src/lib/git-sync.test.ts` | 320-365 | Fixtures with `PROJECT.md`, `ROADMAP.md` | **update** | Update fixtures |
| `src/lib/git-sync.test.ts` | 400-422 | Multi-file test with `PROJECT.md`, `ROADMAP.md` | **update** | Update fixtures |
| `src/lib/git-sync.test.ts` | 462-466 | Conflict test with `ROADMAP.md` | **remove** | Dead test |
| `src/lib/hierarchy.test.ts` | 14 | `filePath: /tmp/${id}/PROJECT.md` | **update** | Use `CLAWCHESTRA.md` |
| `src/lib/project-flows.rollback.test.ts` | 145, 188-189 | `PROJECT.md`, `ROADMAP.md` file assertions | **update/remove** | Update fixtures |

---

## Agent Guidance Files (must act on via branch injection)

| File | Lines | Reference | Classification | Notes |
|------|-------|-----------|----------------|-------|
| `CLAUDE.md` | 39 | `ROADMAP.md` in File Structure | **update** | Update to `.clawchestra/state.json` (Phase 4) |
| `CLAUDE.md` | 40 | `CHANGELOG.md` in File Structure | **remove** | No CHANGELOG.md post-migration |
| `CLAUDE.md` | 91 | `ROADMAP.md` in Key Paths table | **update** | Point to state.json |
| `CLAUDE.md` | 92 | `CHANGELOG.md` in Key Paths table | **remove** | No CHANGELOG.md |
| `AGENTS.md` | 41-42 | `ROADMAP.md`, `CHANGELOG.md` in File Structure | **update** | Update file structure |
| `AGENTS.md` | 156-160 | Roadmap operations referencing `ROADMAP.md` | **update** | Reference state.json |
| `AGENTS.md` | 168 | `CHANGELOG.md` in "View changelog" | **remove** | Dead post-migration |
| `AGENTS.md` | 180 | `PROJECT.md / ROADMAP.md` auto-commit | **update** | Update to `CLAWCHESTRA.md` |
| `AGENTS.md` | 224-282 | Full roadmap workflow referencing `ROADMAP.md` and `CHANGELOG.md` | **update** | Rewrite for state.json (Phase 4.1) |
| `.cursorrules` | 38-39 | `ROADMAP.md`, `CHANGELOG.md` in File Structure | **update** | Mirror CLAUDE.md changes |
| `docs/AGENTS.md` | 188 | `PROJECT.md, ROADMAP.md, CHANGELOG.md` dirty files | **update** | Update file list |
| `docs/AGENTS.md` | 300 | `ROADMAP.md` completion workflow | **update** | Reference state.json |
| `docs/templates/AGENTS.md` | 6-14 | `PROJECT.md`, `ROADMAP.md` template refs | **update** | Template for new projects |

---

## Documentation References (keep — update later or informational)

| File | Classification | Notes |
|------|----------------|-------|
| `SPEC.md` (37 refs) | **keep** | Historical spec document, not operational |
| `REVIEW-FIXES.md` (1 ref) | **keep** | Historical review document |
| `CHANGELOG.md` (2 refs) | **keep** | The CHANGELOG.md file itself is historical |
| `docs/ARCHITECTURE-V2-SPEC.md` (30+ refs) | **keep** | Historical spec, superseded by architecture-direction |
| `docs/SCHEMA.md` (3 refs) | **keep** | Will be updated in Phase 5 |
| `docs/conventions/data-contract.md` (5 refs) | **keep** | Update in Phase 5 |
| `docs/specs/architecture-direction-spec.md` (40+ refs) | **keep** | Active spec, references are about the transition itself |
| `docs/specs/git-sync-spec.md` (15 refs) | **keep** | Will be updated in Phase 5 |
| `docs/specs/git-sync-scope-spec.md` (5 refs) | **keep** | Will be updated in Phase 5 |
| `docs/specs/scan-paths-architecture-spec.md` (20+ refs) | **keep** | Historical spec |
| `docs/specs/project-architecture-overhaul-spec.md` (20+ refs) | **keep** | Historical spec |
| `docs/specs/first-friend-readiness-spec.md` (8 refs) | **keep** | Will be updated in Phase 5 |
| `docs/specs/recently-completed-lifecycle-spec.md` (7 refs) | **keep** | Historical spec |
| `docs/specs/git-branch-sync-spec.md` (5 refs) | **keep** | Historical spec |
| `docs/specs/draggable-kanban-columns-spec.md` (1 ref) | **keep** | Historical spec |
| `docs/specs/deep-rename-clawchestra-spec.md` (3 refs) | **keep** | Historical spec |
| `docs/specs/ai-commit-messages-spec.md` (2 refs) | **keep** | Historical spec |
| `docs/specs/project-modal-improvements-spec.md` (3 refs) | **keep** | Historical spec |
| `docs/specs/scoped-chat-sessions-spec.md` (1 ref) | **keep** | Historical spec |
| `docs/plans/*.md` (many refs) | **keep** | Historical plan documents |
| `roadmap/*.md` (6 refs) | **keep** | Detail files, stay git-tracked |
| `todos/*.md` (2 refs) | **keep** | Historical todo |
| `scripts/sync-agent-compliance.sh` | **update** | Phase 4.3 |

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| Source code references needing **update** | ~35 | Phase 3 (dual-filename), Phase 5 (cleanup) |
| Source code references needing **remove** | ~25 | Phase 5 (dead code sweep) |
| Agent guidance files needing **update** | ~15 | Phase 4 (branch injection) |
| Documentation references to **keep** | ~100+ | No action needed (historical docs) |
| Test fixtures needing update | ~20 | Phase 5.7 |

### High-Priority Targets (Phase 5)

1. **`src/lib/git-sync-utils.ts`** — `METADATA_FILES` and `DOCUMENT_FILES` constants
2. **`src/lib/auto-commit.ts`** — `AUTO_COMMIT_ALLOWED` set
3. **`src/lib/store.ts` line 566** — hardcoded `['PROJECT.md']`
4. **`src-tauri/src/lib.rs` lines 1444, 1447** — `METADATA_FILES`, `DOCUMENT_FILES` constants
5. **`src/lib/watcher.ts`** — entire module replaced by Rust watcher
6. **`src/lib/changelog.ts`** — entire module dead post-migration
7. **`src/lib/roadmap.ts`** — `readRoadmap()`/`writeRoadmap()` dead post-migration
