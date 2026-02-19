# CLAUDE.md — Clawchestra

> **Read `AGENTS.md` for the full operations reference.** This file contains the critical constraints
> that must be followed, plus Claude Code-specific guidance. The compliance block below is
> auto-generated — edit it in AGENTS.md, not here.

<!-- COMPLIANCE:START — Auto-extracted to tool-specific files. Edit here, run scripts/sync-agent-compliance.sh -->

## Agent Compliance Block

> **This section is mechanically synced to all tool-specific config files (CLAUDE.md, .cursorrules, etc.).**
> Edit constraints HERE in AGENTS.md, then run `scripts/sync-agent-compliance.sh` to propagate.
> Never edit the compliance block directly in CLAUDE.md or other generated files — it will be overwritten.

### Schema Constraints (HARD — app rejects invalid values silently)

**Roadmap item statuses:** `pending` | `up-next` | `in-progress` | `complete`
- No other values. Not `done`, not `finished`, not `shipped`, not `blocked`.

**Project statuses:** `in-progress` | `up-next` | `pending` | `dormant` | `archived`

**When setting `status: complete`:** Always also set `completedAt: YYYY-MM-DD` (ISO date).

### Hard Rules

1. **Completion requires human sign-off.** Never set `status: complete` on a roadmap item autonomously — including after `/build` workflows. After building, set `status: in-progress` with `nextAction: "Built — awaiting verification"`.

2. **Never touch the running app.** No `open`, `kill`, restart. No `tauri build` without `--no-bundle`. No installing to `/Applications/`. User controls app lifecycle via in-app Update button.

3. **Priorities are unique per column.** Check existing items before assigning. Default to bottom (max + 1).

4. **Keep `nextAction` in sync.** When you create/update a spec, plan, or code — update the roadmap item's `nextAction` field to reflect current state. Stale `nextAction` = broken UX.

5. **Document format: human-readable first.** No YAML frontmatter in spec/plan docs. Title → one-line blockquote → summary → metadata below the fold.

### File Structure

```
ROADMAP.md                    — YAML frontmatter `items:` array (source of truth for roadmap)
CHANGELOG.md                  — YAML frontmatter `entries:` array (completed items)
roadmap/{item-id}.md          — Detail file per roadmap item
docs/specs/{item-id}-spec.md  — Spec documents
docs/plans/{item-id}-plan.md  — Plan documents
```

### Build & Test Commands

```bash
bun test                        # Run tests
npx tsc --noEmit                # Type check
pnpm build                      # Frontend only (fast)
npx tauri build --no-bundle     # Full release build (ALWAYS --no-bundle)
```

### Roadmap Item YAML Shape

```yaml
- id: kebab-case-id
  title: "Human-readable title"
  status: pending              # pending | up-next | in-progress | complete
  priority: 1                  # unique within status column
  specDoc: docs/specs/id-spec.md    # optional, relative to project root
  planDoc: docs/plans/id-plan.md    # optional, relative to project root
  nextAction: "What happens next"   # shown in UI, keep current
  tags: [bug, feature]              # optional
```

<!-- COMPLIANCE:END -->

---

## Claude Code-Specific

### Full Reference
Read `AGENTS.md` for the complete operations reference, including:
- All UI operations and how to replicate them
- Priority rules and examples
- Roadmap workflow (add, complete, remove)
- Adding projects
- Decision escalation rules
- Chat integration details
- UI patterns and component library

### Key Paths
| Path | Purpose |
|------|---------|
| `AGENTS.md` | Full operations reference (READ THIS) |
| `ROADMAP.md` | YAML frontmatter `items:` array |
| `CHANGELOG.md` | Completed items |
| `docs/specs/{item-id}-spec.md` | Spec documents |
| `docs/plans/{item-id}-plan.md` | Plan documents |
| `roadmap/{item-id}.md` | Detail files per item |
| `src/App.tsx` | Main app, state management |
| `src-tauri/src/lib.rs` | All Tauri commands |
