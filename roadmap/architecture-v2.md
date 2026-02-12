---
title: Architecture V2
status: in-flight
priority: 7
type: deliverable
parent: pipeline-dashboard
tags:
  - architecture
  - settings
  - migration
specDoc: docs/ARCHITECTURE-V2-SPEC.md
---

# Architecture V2

Decouple Pipeline Dashboard from `clawdbot-sandbox` so it can live as a standalone app while still tracking projects across multiple workspaces and integrating with OpenClaw.

## Delivery Status (2026-02-12)

Current implementation state against the full spec:

- [x] **Phase 1 complete**: settings foundation shipped (settings file + Rust read/write + Settings UI + settings-backed paths)
- [x] **Phase 2 complete**: catalog-root separation with legacy compatibility + id/file invariants
- [x] **Phase 3 complete**: Create New wizard flow (folder picker, bootstrap, git init support, uniqueness checks)
- [x] **Phase 4 complete**: Add Existing wizard flow (compatibility check, retrofit actions, dirty-repo guard)
- [x] **Phase 5 complete**: migration runner + hardcoded-path removal + settings-based cutover hooks (physical app move remains operator-executed)
- [ ] **Phase 6 pending**: V2.1 hardening scope

What you should see now:
- Header settings control (gear icon)
- Dashboard Settings modal with path/config fields
- Project Wizard (`Create New` and `Add Existing`) from the Add Project button
- V2 migration runner inside Dashboard Settings

What you should not expect yet:
- Full V2.1 interprocess hardening (locks/CAS/conflict retries)

## Key Components

### Four-Path Model
- `catalogRoot` — Where project catalog entries live
- `workspaceRoots[]` — Allowed locations for project folders
- `openclawWorkspacePath` — OpenClaw operating context
- `appSourcePath` — App source location (for self-update)

### Settings System
- Settings file at `~/Library/Application Support/Pipeline Dashboard/settings.json` (macOS)
- In-app Settings panel (gear icon in header)
- Editable path/config fields

### Enhanced Project Flows
- **Create New:** Folder picker, git init, full bootstrap
- **Add Existing:** Compatibility checker, retrofit UI

### Migration
- Move app to standalone repo
- Migrate catalog entries
- Remove hardcoded paths

### App Rename
- Rename to "Pipeline" (drop "Dashboard")

## Implementation Phases

1. Settings System (read/write config, basic UI)
2. Catalog Separation (use catalogRoot)
3. Create New Flow (folder picker, git init, validation)
4. Add Existing Flow (compatibility checker, retrofit)
5. Migration (move app, update paths)
6. Rename (update all references)

## Spec

Full specification: [ARCHITECTURE-V2-SPEC.md](../docs/ARCHITECTURE-V2-SPEC.md)
