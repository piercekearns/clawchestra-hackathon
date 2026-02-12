# Pipeline Dashboard — Agent Guidelines

This document defines how AI agents should interact with the pipeline dashboard. **Read this before doing any work.**

---

## Rule Zero: Sync Check (MANDATORY)

**Before completing ANY work on the pipeline dashboard, ask yourself:**

1. **Did I change the schema?** (`/src/lib/schema.ts`)
   - → Check if `AGENTS.md` or `SCHEMA.md` need updates (new fields, changed statuses, new validation rules)

2. **Did I change how agents should interact?** (process, rules, priorities)
   - → Check if `AGENTS.md` needs updates
   - → Check if the schema supports the new process

3. **Did I add/move/modify projects?**
   - → Check if priority assignments follow the rules below
   - → Ensure `lastActivity` is updated

4. **Did I change UI behavior?** (new indicators, new columns, new views)
   - → Check if `AGENTS.md` needs to document how agents should interpret or use the new behavior

**This rule applies to ALL changes:** adding items, moving items, modifying schema, changing UI, updating documentation. Nothing ships without this check.

The goal: **These files stay in sync at all times.**
- `/src/lib/schema.ts` — the code truth
- `/docs/SCHEMA.md` — human-readable schema reference
- `/docs/AGENTS.md` — how agents should interact (this file)

---

## Hierarchy Levels

The Dashboard supports three levels of hierarchy:

### Level 1: Projects (Kanban)
Top-level items. Types: `project`, `sub-project`, `idea`
- Displayed as Kanban cards in columns
- Full multi-column view

### Level 2: Deliverables (Priority List)
Roadmap items within a project. Type: `deliverable`
- Live in `roadmap/` folder within project
- Require `parent` field pointing to project
- Displayed as priority-sorted list (not Kanban columns)
- Status shown as badge, changeable via dropdown
- Drag to reorder changes priority

### Level 3: Documents (Markdown View)
Spec and plan documents for deliverables.
- Linked via `specDoc` and `planDoc` fields
- Live in `docs/{deliverable-id}/` folder
- Rendered as pretty markdown with interactive checkboxes
- Not cards — just documents

---

## Adding a Project

### Required Information

Before adding a project, gather:

1. **Title** — Clear, concise name
2. **Type** — Is it a `project`, `sub-project`, `idea`, or `deliverable`?
3. **Status** — Which column does it belong in? (see Status Definitions below)
4. **Priority** — Where does it rank within that column? (see Priority Rules below)

### Priority Rules

**Priority is relative to other items in the same column.** It determines ordering within a status, not across the whole board.

When adding a new project:

1. **List existing items** in the target column with their priorities
2. **Ask or infer** where the new item ranks relative to existing ones
3. **Assign priority** accordingly:
   - If it's the most important in that column → lowest number (1)
   - If it's least important → highest number
   - If unclear, **ask the user** rather than guessing

**Never assign arbitrary priorities.** If you don't know where something ranks, ask:
> "Where does this rank among [list existing items in column]?"

### Example

Adding to "up-next" column with existing items:
- BotFather (priority 1)
- Dating App (priority 2)

If the new item is less urgent than both:
```yaml
priority: 3
```

If it should come before Dating App but after BotFather:
```yaml
priority: 2  # (and update Dating App to priority 3)
```

---

## Status Definitions

### `in-flight`
**Actively being worked on.** Has dedicated time/attention this week.

Criteria:
- Active development or significant progress expected
- Usually has a clear `nextAction`
- **Requires `priority` field** — determines focus order

### `up-next`
**Queued for active work.** Not started yet, but planned soon.

Criteria:
- Scoped and ready to begin
- Waiting for capacity or a current in-flight item to complete
- Has clear enough definition to start

### `simmering`
**On the radar but not prioritized.** Ideas being developed, research ongoing.

Criteria:
- Interesting but not urgent
- May need more research/definition before becoming "up-next"
- Could be promoted when capacity opens

### `dormant`
**Paused or deprioritized.** Not abandoned, but not active.

Criteria:
- Was previously active but paused
- Blocked indefinitely
- Lower priority than everything in "simmering"

### `shipped`
**Completed.** Launched, delivered, or closed.

Criteria:
- Live/deployed, or
- Decided not to pursue (document why)

---

## Changing Status

### Promotions
- `simmering` → `up-next`: When scope is clear and it's prioritized
- `up-next` → `in-flight`: When work actually begins
- `in-flight` → `shipped`: When complete

### Demotions
- `in-flight` → `up-next`: When paused but still planned soon
- `in-flight` → `simmering`: When deprioritized significantly
- `up-next` → `simmering`: When something else takes priority
- Any → `dormant`: When indefinitely paused

### Always update `lastActivity`
When changing any project, update `lastActivity` to today's date.

---

## Field Requirements by Status

| Field | in-flight | up-next | simmering | dormant | shipped |
|-------|-----------|---------|-----------|---------|---------|
| title | ✓ | ✓ | ✓ | ✓ | ✓ |
| status | ✓ | ✓ | ✓ | ✓ | ✓ |
| type | ✓ | ✓ | ✓ | ✓ | ✓ |
| priority | **required** | recommended | optional | optional | optional |
| nextAction | recommended | optional | optional | optional | — |
| lastActivity | ✓ | ✓ | ✓ | ✓ | ✓ |

---

## Indicators

### 🕐 Stale (red clock)
Shows when `lastActivity` is >14 days ago. Means the project hasn't been touched — might need review or status update.

### 🔗 Linked repo
Shows when project has `localPath` pointing to a local repository.

---

## File Location

Projects live in: `/Users/piercekearns/clawdbot-sandbox/projects/`

Each project is a markdown file with YAML frontmatter:
```markdown
---
title: My Project
status: up-next
priority: 2
type: project
tags: [tag1, tag2]
icon: 🚀
lastActivity: 2026-02-11
nextAction: Define scope
---

# My Project

Description and notes here...
```

See `SCHEMA.md` for full field reference.

---

## Adding a Deliverable (Roadmap Item)

Deliverables are roadmap items for a specific project.

### File Location

Create in: `{project-folder}/roadmap/{deliverable-id}.md`

Example: `projects/pipeline-dashboard/roadmap/chat-drawer-ui.md`

### Required Fields

```yaml
---
title: Chat Drawer UI
status: up-next
type: deliverable
priority: 1
parent: pipeline-dashboard
lastActivity: 2026-02-11
---
```

### Optional Fields

```yaml
specDoc: docs/chat-drawer/SPEC.md
planDoc: docs/chat-drawer/PLAN.md
tags: [ui, chat]
```

### Document Structure

For deliverables with specs/plans:

```
projects/pipeline-dashboard/
├── roadmap/
│   └── chat-drawer-ui.md    # Deliverable (Level 2)
└── docs/
    └── chat-drawer/
        ├── SPEC.md           # Specification (Level 3)
        └── PLAN.md           # Implementation plan (Level 3)
```

### Marking as Done

When a deliverable is complete:

1. Change `status: shipped` in the deliverable file
2. Add entry to project's `CHANGELOG.md` with:
   - Item name with ✅
   - Brief summary of what was built
   - Date
3. Optionally move file to `roadmap/done/` folder
