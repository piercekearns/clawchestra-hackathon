---
title: Architecture V2
status: complete
priority: 7
type: deliverable
parent: clawchestra
lastActivity: 2026-02-12
tags:
  - architecture
  - settings
  - migration
specDoc: docs/ARCHITECTURE-V2-SPEC.md
---

# Architecture V2 (MVP)

Decouple Pipeline Dashboard from `clawdbot-sandbox` so it can run as a standalone app while tracking projects across configured workspaces.

## Delivery Status (2026-02-12)

This deliverable is complete for MVP scope (Phases 1-5):

- [x] **Phase 1**: settings foundation (Rust read/write, settings UI, settings-backed paths)
- [x] **Phase 2**: catalog-root separation with legacy compatibility
- [x] **Phase 3**: Create New wizard (folder picker, bootstrap, git init, uniqueness checks)
- [x] **Phase 4**: Add Existing wizard (compatibility check, retrofit actions, dirty-repo guard)
- [x] **Phase 5**: migration runner, hardcoded-path removal, settings-based cutover hooks

Finalized operator cutover state:
- `appSourcePath` points to `<repo-root>`
- `workspaceRoots` is repos-only (`~/repos`)
- legacy sandbox app copy retired from `clawdbot-sandbox/projects`

## What Is Deferred

Hardening work is tracked as a separate deliverable:
- [Architecture V2.1 Hardening](./architecture-v2-1-hardening.md)

This includes interprocess locking/CAS, conflict retries, and broader migration hardening tests.

## User-Visible Outcomes

- Header settings control (gear icon)
- Dashboard Settings modal with path/config fields
- Project Wizard (`Create New` and `Add Existing`) from Add Project
- V2 migration runner inside Dashboard Settings

## Spec

Full specification: [ARCHITECTURE-V2-SPEC.md](../docs/ARCHITECTURE-V2-SPEC.md)
