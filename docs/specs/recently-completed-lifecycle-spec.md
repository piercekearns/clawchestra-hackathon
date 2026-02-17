# Recently Completed Lifecycle

> Completed roadmap items age out of the kanban into a changelog — keeping the board clean without losing history.

Today, completed items stay in the Complete column forever, clogging the board. This introduces a lifecycle: items move to Complete only after explicit human sign-off, the Complete column caps at a "recently completed" window, and older items migrate to CHANGELOG.md automatically.

---

**Roadmap Item:** `recently-completed-lifecycle`
**Status:** Up Next
**Created:** 2026-02-17

---

## Rules

### 1. Completion requires explicit sign-off

An item moves to `complete` only when the human explicitly confirms it's verified and working. Agents must NOT auto-complete items after shipping code — the item stays `in-progress` until sign-off.

**This rule must be codified in:**
- `AGENTS.md` — agent behavior rules
- Schema docs — status field documentation
- Any agent context files that reference roadmap workflows

### 2. Recently Completed window

The Complete column shows only the N most recently completed items (default: 10). "Recently" is determined by a `completedAt` timestamp on the item.

- When an item is marked `complete`, set `completedAt` to the current ISO date
- The Complete column renders only the 10 items with the most recent `completedAt`
- Items beyond the cap are hidden from the kanban but still exist in ROADMAP.md until migrated

### 3. Changelog migration

Items that age out of the Recently Completed window migrate to `CHANGELOG.md`:

- **Trigger:** When a new item is completed and the cap is exceeded, the oldest completed item migrates
- **Migration:** Item details (title, completion date, summary) are appended to CHANGELOG.md under a dated section
- **Cleanup:** The item is removed from ROADMAP.md after migration
- **CHANGELOG.md format:** Reverse-chronological sections by date, each with item title + one-line summary

### 4. Schema changes

Add to `RoadmapItem` interface:

```typescript
completedAt?: string;  // ISO date — set when status changes to 'complete'
```

The ROADMAP.md YAML serializer must preserve `completedAt` when present.

## What must be codified

This isn't just a UI feature — the rules need to be embedded in agent-facing docs so any agent working on this project follows them:

| Document | What to add |
|----------|-------------|
| `AGENTS.md` | Rule: agents never auto-complete items; completion requires human sign-off. Rule: when marking complete, always set `completedAt`. |
| `src/lib/schema.ts` | `completedAt?: string` on `RoadmapItem` |
| `src/lib/roadmap.ts` | Preserve `completedAt` in sanitizer/writer. Migration logic (move old items to CHANGELOG.md). |
| `CHANGELOG.md` | Create if not exists. Format: reverse-chronological dated sections. |
| `ROADMAP.md` spec comment | Note the lifecycle: complete → recently completed → changelog |

## UI behavior

- **Complete column header:** Shows "Complete" with count badge (only recently completed count)
- **No visual difference** for items in the recently completed window vs any other column — they're just cards
- **When an item migrates out:** It simply disappears from the kanban on next refresh. No animation needed for V1.
- **CHANGELOG.md** is viewable from a future UI surface (out of scope for this deliverable — file just needs to exist and be well-formatted)

## Edge cases

| Scenario | Behavior |
|----------|----------|
| Fewer than 10 completed items | All show in Complete column, no migration |
| Item completed without `completedAt` | Treat as oldest (migrate first) |
| Agent tries to mark complete without human sign-off | Agent rules in AGENTS.md prohibit this |
| CHANGELOG.md doesn't exist | Create it on first migration |
| Manual ROADMAP.md edit removes `completedAt` | Treat as oldest |

## Out of scope

- UI for viewing CHANGELOG.md (future deliverable)
- Automatic completion detection (always requires human sign-off)
- Configurable cap (hardcoded to 10 for V1)

---

*Spec is a living document. Update as decisions are made during build.*
