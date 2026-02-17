---
title: "Fix: Roadmap Item Spec Links"
id: fix-roadmap-spec-links
status: pending
tags: [bug, roadmap, ui]
icon: "🐛"
---

# Fix: Roadmap Item Spec Links

## Bug

Every roadmap item's "Spec" tab shows the **project-level** `SPEC.md` instead of the item's own spec document.

## Root Cause

In `src/lib/roadmap.ts` → `resolveDocFiles()`:

1. **Item frontmatter `specDoc` is ignored** — the function only reads `specDoc` from the **project** frontmatter (`ProjectFrontmatter`), not from individual roadmap items. So `specDoc: docs/specs/scoped-chat-sessions-spec.md` on `chat-infrastructure.md` does nothing.

2. **Fallback is too eager** — when no item-specific spec is found at convention paths (`docs/specs/{id}-spec.md`), it falls back to the project-level `SPEC.md` at root. Since that file exists, every item without its own spec shows the overall project spec.

## Fix

Two changes needed:

### 1. Read `specDoc`/`planDoc` from roadmap item frontmatter
Pass each item's parsed frontmatter into the doc resolution. If the item has `specDoc`, resolve it relative to `localPath` and use it before convention paths.

### 2. Don't fall back to project-level spec for individual items
The fallback to `SPEC.md` should only apply when viewing the project itself, not when viewing a roadmap item. Remove or guard the fallback:

```typescript
// Only fall back to project spec if explicitly configured, not convention
if (!docs.spec && projectSpec && item.usesProjectSpec) docs.spec = projectSpec;
```

Or simpler: just don't fall back at all. If an item has no spec, show "No spec document found" with a "Create Spec" button.

## Files to Change

- `src/lib/roadmap.ts` — `resolveDocFiles()` function
- `src/lib/schema.ts` — add `specDoc`/`planDoc` to `RoadmapItem` type if needed
