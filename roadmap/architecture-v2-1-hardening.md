---
title: Architecture V2.1 Hardening
status: up-next
type: deliverable
priority: 6
parent: pipeline-dashboard
lastActivity: 2026-02-12
tags: [architecture, hardening, concurrency]
specDoc: docs/ARCHITECTURE-V2-SPEC.md
dependsOn: [architecture-v2]
---

# Architecture V2.1 Hardening

Post-MVP hardening pass for Architecture V2.

## Scope

- Interprocess locking/CAS profile across catalog mutations
- Conflict handling/retry behavior (`catalogVersion`, lock contention)
- Migration smoke tests and rollback-focused tests
- Transactional rollback tests for Create New / Add Existing
- Better telemetry for path resolution and migration edge failures

## Why Separate

V2 MVP shipped to complete migration and decoupling quickly.
This follow-up focuses on reliability under contention and fault scenarios.

## Spec Reference

See deferred hardening items in `docs/ARCHITECTURE-V2-SPEC.md`.
