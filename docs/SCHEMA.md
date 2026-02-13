# Pipeline Dashboard Schema

This document mirrors the `ProjectFrontmatter` schema implemented in `/src/lib/schema.ts`.

## Required fields

- `title`: string
- `status`: one of `in-flight`, `up-next`, `simmering`, `dormant`, `shipped`, `archived`
- `type`: one of `project`, `sub-project`, `idea`

## Optional fields

- `priority`: number
- `localPath`: string
- `statusFile`: string (defaults to `PROJECT.md`)
- `repo`: string
- `parent`: string (required for `sub-project` type)
- `lastActivity`: ISO date string
- `lastReviewed`: ISO date string
- `tags`: string[]
- `icon`: string
- `color`: one of `blue|green|yellow|red|purple|gray`
- `blockedBy`: string
- `nextAction`: string
- `specDoc`: string (path to specification document)
- `planDoc`: string (path to planning document)

## Status Definitions

| Status | Meaning |
|--------|---------|
| `in-flight` | Actively being worked on |
| `up-next` | Queued for work |
| `simmering` | Low-priority background work |
| `dormant` | Inactive, may resume later |
| `shipped` | Completed and delivered (deprecated — use `archived`) |
| `archived` | Done, no longer active. Not shown on board, visible via search. |

## Type Definitions

### `project`
Top-level project. Appears as a card in the main Kanban view.

### `sub-project`
Child of a project. Requires `parent` field pointing to parent project ID.

### `idea`
Early-stage concept. May not have full scope defined.

## Hierarchy

```
project (Kanban card)
├── sub-project (Kanban card, parent: project)
```

## ROADMAP.md Format

Roadmap files use YAML frontmatter with an `items:` array:

```yaml
---
items:
  - id: feature-auth
    title: User Authentication
    status: in-progress
    priority: 1
    nextAction: Implement OAuth flow
  - id: feature-search
    title: Search
    status: pending
    priority: 2
---
# Project Title — Roadmap

Optional markdown notes below frontmatter.
```

### Roadmap Item Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Unique identifier (auto-generated as `roadmap-N` if missing) |
| `title` | string | Yes | Item display name |
| `status` | string | Yes | One of: `pending`, `in-progress`, `complete` |
| `priority` | number | No | Display order (auto-assigned from array position) |
| `nextAction` | string | No | Current action item |
| `blockedBy` | string | No | Blocking dependency |
| `tags` | string[] | No | Classification tags |
| `icon` | string | No | Display icon |

## CHANGELOG.md Format

Changelog files track completed roadmap items:

```yaml
---
entries:
  - id: feature-auth
    title: User Authentication
    completedAt: "2026-02-13"
    summary: Implemented OAuth flow with Google and GitHub
---
```

### Changelog Entry Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | Yes | Matches the original roadmap item ID |
| `title` | string | Yes | Item display name |
| `completedAt` | string | Yes | ISO date when completed |
| `summary` | string | No | Brief description of what was done |

## Lifecycle

```
Roadmap item lifecycle:
  pending → in-progress → complete → (auto-migrate to CHANGELOG.md)
```

When a roadmap item's status is changed to `complete`:
1. The item is appended to CHANGELOG.md (reverse-chronological)
2. The item is removed from ROADMAP.md
3. The migration is idempotent — safe to call twice on the same item

## Document Conventions

### Spec Documents
- Path: `docs/specs/{item-id}-spec.md` or `docs/specs/{item-id}.md`
- Fallback: `docs/specs/SPEC.md` or project-level `specDoc` frontmatter
- Contains: Technical specification, requirements, design details

### Plan Documents
- Path: `docs/plans/{item-id}-plan.md` or `docs/plans/{item-id}.md`
- Fallback: `docs/plans/PLAN.md` or project-level `planDoc` frontmatter
- Contains: Implementation checklist, phases, progress tracking
