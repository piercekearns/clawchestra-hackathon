# CLAUDE.md — Clawchestra

Read `AGENTS.md` before doing any work. It is the source of truth for all operations, schemas, and rules.

## Critical Schema Constraints

### Roadmap Item Statuses (ONLY these values)
```
pending | up-next | in-progress | complete
```
No other values are valid. Not `done`, not `finished`, not `shipped`. The app will silently drop items with invalid statuses.

### Project Statuses (ONLY these values)
```
in-flight | up-next | simmering | dormant | shipped | archived
```

### Completion Rule
**Never set `status: complete` on a roadmap item without explicit human sign-off.** After building, set `status: in-progress` with `nextAction: "Built — awaiting verification"`. The human decides when something is complete.

## Build & Test
```bash
bun test              # Run tests (74 expected)
npx tsc --noEmit      # Type check
npx tauri build --no-bundle  # Full build (never without --no-bundle)
pnpm build            # Frontend only
```

## Key Paths
- `AGENTS.md` — Full operations reference (READ THIS)
- `ROADMAP.md` — YAML frontmatter `items:` array
- `CHANGELOG.md` — Completed items
- `docs/specs/{item-id}-spec.md` — Spec documents
- `docs/plans/{item-id}-plan.md` — Plan documents
- `roadmap/{item-id}.md` — Detail files per item
