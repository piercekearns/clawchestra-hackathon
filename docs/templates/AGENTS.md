# AGENTS.md — {{PROJECT_TITLE}}

## Required context for coding agents

Before making changes, always read:
1. `PROJECT.md`
2. `ROADMAP.md`
3. Schema expectations from the Pipeline Dashboard (`docs/SCHEMA.md`)

## Dashboard schema compliance

- Keep `PROJECT.md` frontmatter valid.
- Use project statuses: `in-progress`, `up-next`, `pending`, `dormant`, `archived`.
- Keep `ROADMAP.md` frontmatter `items` valid with statuses:
  `pending`, `up-next`, `in-progress`, `complete`.
- Update `lastActivity` when major status changes happen.

## Agent behavior

- Prefer incremental commits with descriptive messages.
- Validate changes with tests/lint before handing off.
- Preserve file-based source of truth; do not invent parallel trackers.
