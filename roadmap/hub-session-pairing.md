---
title: Hub Session Pairing (Chat + Terminal)
id: hub-session-pairing
status: pending
tags: [hub, ux, terminal, sidebar, pairing]
icon: "⇄"
nextAction: "Implement thin left connector line in sidebar for paired rows; chat↔terminal tab strip in DrawerHeader; + creation flow for missing session"
lastActivity: "2026-02-28"
---

# Hub Session Pairing (Chat + Terminal)

Each project and roadmap item can have two kinds of sessions: a **chat** (conversation with an agent) and a **terminal** (shell / Claude Code / Codex). These belong together. The UI should reflect that pairing and make switching between them — or creating a missing one — effortless.

The pairing data already exists implicitly: both session types share the same `itemId` (roadmap item) or `projectId`. No new schema is needed. This feature is purely about surfacing what's already there.

## Scope

Three things ship together — removing any one makes the feature feel incomplete:

1. **Sidebar connector line** — thin vertical line on the left edge spanning paired rows
2. **Header tab strip** — chat↔terminal switcher in `DrawerHeader.tsx`
3. **Creation flow** — `+ Chat` / `+ Terminal` button when one side doesn't exist yet

## 1. Sidebar connector line

In the hub sidebar, when a project/item has both a chat session and a terminal session, the two rows are rendered adjacent and connected by a **thin static vertical line** on their left edge.

- Line spans the full height of both rows — top of the chat row to the bottom of the terminal row (or vice versa)
- Neutral/muted colour — `border-l-2 border-neutral-300 dark:border-neutral-700` or similar
- No folder, no indentation, no expand/collapse — the rows remain flat list items
- Each row keeps its own icon (chat icon vs terminal icon), so the type distinction is always clear
- Line is always visible (not hover-only) — the pairing should be discoverable at a glance

**Implementation approach:**
- In the list-rendering logic (`ThreadSection.tsx` or `HubNav.tsx`), detect adjacent paired rows (same `itemId`/`projectId`, one chat type + one terminal type)
- Render a shared left container element that draws the line, or use CSS pseudo-elements / `before`/`after` on the rows themselves
- Order: chat row first, terminal row second (consistent ordering, not dependent on creation time)

## 2. Header tab strip

Inside `DrawerHeader.tsx`, when the active session belongs to a project or roadmap item, query whether a paired session exists on the other side.

```
┌──────────────────────────────────────┐
│  [Header controls — title, actions]  │
│  ─────────────────────────────────── │
│  [ 💬 Chat ]  [ ⬛ Terminal ]         │  ← tab strip
├──────────────────────────────────────┤
│  (existing ribbon slot — complete,   │
│   dead session, etc.)                │
└──────────────────────────────────────┘
```

**Tab states:**

| Scenario | Chat tab | Terminal tab |
|----------|----------|--------------|
| Both exist | Filled (active if in chat) | Filled (active if in terminal) |
| Only chat exists | Filled + active | Outline `+ Terminal` |
| Only terminal exists | Outline `+ Chat` | Filled + active |
| Neither (no item link) | Hide strip entirely | — |

- **Filled active** — current session, highlighted/selected state
- **Filled inactive** — other session exists, click to switch (opens it in the drawer)
- **Outline `+`** — session doesn't exist yet, click to create and open it

The tab strip appears only when the chat/terminal is linked to a project or roadmap item (`itemId` or `projectId` is set). Standalone unlinked sessions don't show the strip.

**Placement:** rendered in `DrawerHeader.tsx` below the main header controls, above the ribbon slot (complete / dead session ribbons). Part of the header DOM, not the scrollable content area.

## 3. Creation flow

When the user presses `+ Terminal` or `+ Chat`:

- Create a new session of the missing type, linked to the same `itemId`/`projectId`
- Open it immediately in the secondary drawer
- The sidebar connector line appears as soon as both sessions exist

**`+ Terminal`** → creates a terminal chat for this item. Respects whatever default terminal type is configured (shell / Claude Code / Codex). Opens the TypePicker if no default is set.

**`+ Chat`** → creates a regular chat session for this item. Opens it in the drawer ready for input.

## Relationship with p19 (terminal-session-status)

These features compose cleanly:

- A paired terminal with a dead session → terminal tab in the strip shows the dead state (red icon or muted), clicking it opens the pane with the restart ribbon already visible
- The `+ Terminal` button is shown when no terminal exists at all (not the same as dead — dead still counts as "exists")

## Files Affected

| File | Change |
|------|--------|
| `src/components/hub/ThreadSection.tsx` or `HubNav.tsx` | Detect paired rows; render left connector line |
| `src/components/hub/DrawerHeader.tsx` | Tab strip below header controls; filled/outline/+ states; creation handler |
| `src/lib/store.ts` | Query helper: `getPairedSession(chatId)` → returns paired chat/terminal for same item |
| `src/components/hub/ChatEntryRow.tsx` | Left edge adjustment to accommodate connector line rendering |

## Open Questions

1. What if a project/item has multiple terminal chats? (e.g. user created two) — show only the most recent non-archived one in the tab strip, or show all?
2. What if a project/item has multiple chat sessions? — same question. Likely: most recent active one surfaces in the tab strip.
3. Ordering of tabs: chat always left, terminal always right? Or follow creation order? → Recommend: chat left, terminal right (consistent, predictable).
</content>
