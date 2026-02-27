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

**Roadmap item statuses:** `pending` | `up-next` | `in-progress` | `complete` | `archived`
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
.clawchestra/state.json       — JSON (source of truth for roadmap, machine-readable)
CLAWCHESTRA.md                — Human documentation (do not edit programmatically)
roadmap/{item-id}.md          — Detail file per roadmap item
docs/specs/{item-id}-spec.md  — Spec documents (auto-discovered by UI convention)
docs/plans/{item-id}-plan.md  — Plan documents (auto-discovered by UI convention)
```

> ⚠️ **`roadmap/*.md` files are NOT auto-rendered in the card detail view.**
> The UI resolves docs via `doc-resolution.ts` in this order:
> 1. `specDoc` / `planDoc` field in `state.json` (relative to project root)
> 2. Convention paths: `docs/specs/{id}-spec.md`, `docs/specs/{id}.md`
> 3. Nothing — card shows only `nextAction` text
>
> `roadmap/{id}.md` files are used for chat context injection only (see `hub-context.ts`).
> **If you create a `roadmap/*.md` detail file, always also set `specDoc: "roadmap/{id}.md"` in
> state.json** — otherwise the content is invisible to the user in the UI.

### Build & Test Commands

```bash
bun test                        # Run tests
npx tsc --noEmit                # Type check
pnpm build                      # Frontend only (fast)
npx tauri build --no-bundle     # Full release build (ALWAYS --no-bundle)
```

### Title Length Guideline
Aim for ~40 characters or fewer for roadmap item and project titles — this fits on one line at minimum card width. Two lines is acceptable. Avoid long titles that wrap to 3+ lines.

### Roadmap Item JSON Shape

```json
{
  "id": "kebab-case-id",
  "title": "Human-readable title",
  "status": "pending",
  "priority": 1,
  "specDoc": "docs/specs/id-spec.md",
  "planDoc": "docs/plans/id-plan.md",
  "nextAction": "What happens next",
  "tags": ["bug", "feature"]
}
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
| `.clawchestra/state.json` | JSON roadmap source of truth |
| `CLAWCHESTRA.md` | Human documentation (frontmatter + markdown) |
| `docs/specs/{item-id}-spec.md` | Spec documents |
| `docs/plans/{item-id}-plan.md` | Plan documents |
| `roadmap/{item-id}.md` | Detail files per item |
| `src/App.tsx` | Main app, state management |
| `src-tauri/src/lib.rs` | All Tauri commands |
