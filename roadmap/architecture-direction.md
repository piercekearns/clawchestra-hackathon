# Architecture Direction

Moving project state from git-tracked files into a synced database backed by OpenClaw, so orchestration data is branch-independent, device-independent, and agent-accessible.

## Key Deliverables
- Rename PROJECT.md -> CLAWCHESTRA.md
- `.clawchestra/state.json` projection with per-field timestamps
- CLAUDE.md injection into all branches during project setup (with retry mechanism)
- OpenClaw data endpoint extension (`~/.openclaw/extensions/data-endpoint.ts`)
- OpenClaw system prompt injection (training about Clawchestra, DB, schema, client identity)
- File-level locking for same-machine agent/UI races
- Client identity (UUID per Clawchestra instance)
- Programmatic sync (filesystem local, HTTP remote)

## Spec
See `docs/specs/architecture-direction-spec.md` for full analysis (46 decisions, 5 resolved questions, trigger events table, extended vision).

## What's Built (Phases 1–4 + hardening)

- Module extraction: state.rs, migration.rs, watcher.rs, validation.rs, sync.rs, locking.rs, db_persistence.rs
- HLC field-level merge with content-based tie-breaking
- CAS guard on sync operations
- Atomic db.json persistence (500ms debounce + crash-safe flush)
- Migration state machine (ROADMAP.md → db.json) with backup + manifest
- Branch injection (inject_agent_guidance command — fully implemented)
- OpenClaw extension generation + bearer token via OS keychain
- File watcher unified in Rust (notify crate)
- 17-fix hardening sprint: string limits, UUID tie-breaking, post-merge validation, HLC wall-clock fix, atomic write suffixes, path validation, startup lock sweep, dirty re-check loop

## Remaining

- Phase 5: Frontend alignment (see plan Phase 5) — next build
- Phase 6: Extension installation UI, sync wiring, cloud agent injection — see `cloud-agent-sync` roadmap item
- Phase 7: Structured logging, debug export, validation badges

## Status
Phases 1–4 complete + hardening sprint. Phase 5 frontend alignment is next.

## nextAction
Phase 5 frontend alignment — run deepen-plan against plan-v2.md then build

## Relationship to First-Friend-Readiness
Phase 1 (Foundation) blocks first-friend-readiness onboarding (project discovery needs CLAWCHESTRA.md, branch injection happens during "add project"). Phase 2 (OpenClaw Integration) blocks first-friend-readiness if the friend uses a VPS. Cross-platform work in first-friend-readiness can start in parallel with both phases.

## Phases (mapped from trigger events table in spec)

### Phase 1: Foundation (blocks first-friend-readiness onboarding)
- Rename PROJECT.md -> CLAWCHESTRA.md
- Implement `.clawchestra/state.json` projection with per-field timestamps
- File-level locking for state.json
- CLAUDE.md injection during "add project" flow (with retry mechanism)
- Schema validation on state.json ingest

### Phase 2: OpenClaw Integration (blocks first-friend-readiness if friend uses VPS)
- OpenClaw data endpoint extension
- OpenClaw system prompt injection at setup
- Client identity (UUID generation + registration)
- Direct filesystem sync (local) + HTTP sync (remote)
- Sync triggers: on launch, on state change, on close

### Phase 3: Multi-Device Prep (deferred)
- Per-field merge logic using timestamps
- Sync status indicator in UI
- Periodic polling for remote changes
- Chat history reconciliation across devices

### Phase 4: Mobile/Web (deferred)
- Remote-only sync (no direct filesystem)
- Per-device UI settings
- Operation-based sync (if multi-user)

## Dependencies
- Spec complete: `docs/specs/architecture-direction-spec.md`
- OpenClaw plugin SDK confirmed feasible (Express.js, `registerHttpRoute()`)
- Existing bot guidance in AGENTS.md compatible with new model

## Parallelism with First-Friend-Readiness

```
Architecture Phase 1 ─────────┐
                               ├──> FFR Onboarding (Phase 3)
Cross-Platform (FFR Phase 1) ──┘    FFR Project Scaffolding (Phase 4)
                                    FFR Settings Panel (Phase 5)
Architecture Phase 2 ──────────> FFR Remote Gateway Config
```

Cross-platform foundation (paths, shell, title bar, update mechanism) has zero dependency on architecture direction. Start both in parallel.
