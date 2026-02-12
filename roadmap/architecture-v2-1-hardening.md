---
title: Architecture V2.1 Hardening
status: shipped
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

## Delivery Status (2026-02-12)

- [x] Mutation locking added for filesystem/catalog-affecting Tauri commands
- [x] Lock contention retry behavior added to Create New/Add Existing flows
- [x] Transactional rollback tests added for Create New/Add Existing late failures
- [x] Migration smoke test added for catalog-entry copy behavior
- [x] Path failure telemetry/logging added for resolution/normalization failures

## Scope

- Interprocess locking/CAS profile across catalog mutations
- Conflict handling/retry behavior (`catalogVersion`, lock contention)
- Migration smoke tests and rollback-focused tests
- Transactional rollback tests for Create New / Add Existing
- Better telemetry for path resolution and migration edge failures

## Non-Critical Follow-Ups

- Full per-entry `catalogVersion` CAS conflict workflow
- True multi-process contention integration test harness
- Recovery-gate coverage for startup read/write blocking

## Why Separate

V2 MVP shipped to complete migration and decoupling quickly.
This follow-up focuses on reliability under contention and fault scenarios.

## Spec Reference

See deferred hardening items in `docs/ARCHITECTURE-V2-SPEC.md`.
