# Pipeline Dashboard — Data Contract

> This document defines the file formats that Pipeline Dashboard reads from project repos.
> Any agent modifying `PROJECT.md`, `ROADMAP.md`, or `CHANGELOG.md` in a scanned repo
> **must** follow these rules or the project will fail validation and not appear in the app.

## Scanned Paths

Pipeline Dashboard scans these directories one level deep for `PROJECT.md` files:
- `~/repos/` (active git repos)
- `~/projects/` (idea and standalone projects)

## PROJECT.md

YAML frontmatter parsed by `gray-matter`. Required fields marked with *.

```yaml
---
title: "Project Name"        # * string, required
status: in-progress             # * one of: in-progress, up-next, pending, dormant, archived
type: project                 # * one of: project, sub-project, idea
priority: 1                   # number, REQUIRED if status is in-progress
tags: [tag1, tag2]            # string array, optional
icon: "\U0001F4CA"           # emoji string, optional
lastActivity: '2026-02-13'   # ISO date string, optional (stale if >14 days ago)
lastReviewed: '2026-02-10'   # ISO date string, optional (needs review if >7 days ago)
nextAction: "Do the thing"   # string, optional
repo: owner/repo-name        # string, optional (GitHub repo reference)
parent: parent-project-id    # string, REQUIRED if type is sub-project
specDoc: path/to/spec.md     # string, optional (relative to project root)
planDoc: path/to/plan.md     # string, optional (relative to project root)
---

# Project Name

Markdown body with project description.
```

### Validation Rules
- `title`, `type`, and `status` are required — missing any = project rejected
- `status: in-progress` requires `priority` (number) — missing = project rejected
- `type: sub-project` requires `parent` — missing = project rejected
- Invalid status/type values = project rejected

## ROADMAP.md

YAML frontmatter with `items:` array. Markdown body preserved as notes.

```yaml
---
items:
  - id: kebab-case-slug       # string, auto-generated if missing
    title: "Item Title"        # * string, required
    status: pending            # * one of: pending, in-progress, complete
    priority: 1                # number, auto-assigned by position
    nextAction: "Next step"    # string, optional
    blockedBy: "other-id"      # string, optional
    tags: [tag1, tag2]         # string array, optional
    icon: "\U0001F3A8"        # emoji string, optional
---

# Project — Roadmap

Original markdown body preserved here. All detailed content, tables,
checklists, and phase descriptions go below the frontmatter.
```

### Important Rules
- **Only these fields are persisted**: `id, title, status, priority, nextAction, blockedBy, tags, icon`
- Any other fields (e.g. `specDoc`, `planDoc`) will be **stripped** when the app writes back
- The app auto-resolves spec/plan docs via convention paths: `docs/specs/{item.id}-spec.md`, `docs/plans/{item.id}-plan.md`
- Valid status values: `pending`, `in-progress`, `complete` — anything else = item silently dropped
- Items with missing `title` or invalid `status` are silently dropped
- Priority is auto-reassigned sequentially (1, 2, 3...) on read — manual priority values in YAML are overwritten

### Moving Items to CHANGELOG
When marking an item `complete` via the app, it automatically:
1. Creates the CHANGELOG entry
2. Removes the item from ROADMAP.md items array
3. Preserves the markdown body unchanged

## CHANGELOG.md

YAML frontmatter with `entries:` array. Reverse-chronological order.

```yaml
---
entries:
  - id: item-slug              # * string, required (matches former roadmap item ID)
    title: "Item Title"        # * string, required
    completedAt: "2026-02-07"  # * ISO date string, required (must parse as valid date)
    summary: "What was done"   # string, optional
---
```

### Validation Rules
- `id`, `title`, and `completedAt` are all required — missing any = entry dropped
- `completedAt` must be a parseable date string (ISO 8601 recommended)
- Entries are ordered reverse-chronologically (most recent first)

## Common Mistakes to Avoid

1. **Don't use emoji checkboxes in YAML** — `status: pending` not `status: ⏳ TODO`
2. **Don't forget priority for in-progress projects** — the project won't load
3. **Don't add custom fields to roadmap items** — they get stripped on save
4. **Don't use `complete`/`completed`/`done` as a project status** — use `archived` for finished projects
5. **Don't put completed items in the ROADMAP items array** — move them to CHANGELOG
6. **Don't modify the markdown body format** — the app preserves it as-is

## Version

Last updated: 2026-02-13
Schema source: `src/lib/schema.ts`, `src/lib/roadmap.ts`, `src/lib/changelog.ts`
