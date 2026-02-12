# Pipeline Dashboard Schema

This document mirrors the `ProjectFrontmatter` schema implemented in `/src/lib/schema.ts`.

## Required fields

- `title`: string
- `status`: one of `in-flight`, `up-next`, `simmering`, `dormant`, `shipped`
- `type`: one of `project`, `sub-project`, `idea`, `deliverable`

## Optional fields

- `priority`: number
- `localPath`: string
- `statusFile`: string (defaults to `PROJECT.md`)
- `repo`: string
- `parent`: string (required for `sub-project` and `deliverable` types)
- `lastActivity`: ISO date string
- `lastReviewed`: ISO date string
- `tags`: string[]
- `icon`: string
- `color`: one of `blue|green|yellow|red|purple|gray`
- `blockedBy`: string
- `nextAction`: string
- `specDoc`: string (path to specification document)
- `planDoc`: string (path to planning document)

## Type Definitions

### `project`
Top-level project. Appears as a card in the main Kanban view.

### `sub-project`
Child of a project. Requires `parent` field pointing to parent project ID.

### `idea`
Early-stage concept. May not have full scope defined.

### `deliverable`
Roadmap item within a project. Requires `parent` field.
- Used for discrete pieces of work on a project's roadmap
- Can have `specDoc` and `planDoc` for detailed documentation
- Displayed in a priority-sorted list under the parent project
- Status shown as badge, not as separate columns

## Hierarchy

```
project (Kanban card)
├── sub-project (Kanban card, parent: project)
└── deliverable (Priority list card, parent: project)
    ├── specDoc → markdown document
    └── planDoc → markdown document
```

## Document Conventions

### Spec Documents
- Path: `docs/{deliverable-id}/SPEC.md`
- Contains: Technical specification, requirements, design details

### Plan Documents
- Path: `docs/{deliverable-id}/PLAN.md`
- Contains: Implementation checklist, phases, progress tracking
- May include checkboxes for task completion
