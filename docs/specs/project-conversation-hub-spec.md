# Project Conversation Hub

> Conductor/Codex-inspired threaded conversation management organized by project — conversations accessible directly from project cards and roadmap item cards, no hierarchy navigation needed.

**Status:** Draft
**Created:** 2026-02-21
**Roadmap Item:** `project-conversation-hub`
**Depends On:** `distributed-ai-surfaces` (multi-surface foundation), `scoped-chat-sessions` (session isolation)

---

## Problem

Even with distributed AI surfaces (contextual chat at multiple points in the app), there's no way to:

1. **Manage multiple concurrent conversations** about the same project — e.g., one conversation about roadmap item A and another about item B, both ongoing.
2. **Return to a previous conversation** — if I had a deep discussion about a project's architecture last Tuesday, I can't find or continue it. It's lost in the flat chat history.
3. **See at a glance** which projects/items have active conversations — there's no visual indicator that "this card has an ongoing AI thread attached to it."
4. **Organize conversations by subject** — everything is either in the general drawer or in a per-surface ephemeral chat. There's no persistent, navigable structure.

This is the problem Conductor and Codex solve for code projects — they organize AI conversations into project-scoped threads. Clawchestra needs the same for its project/roadmap model.

## What Success Looks Like

- **Projects are conversation containers.** Each project can have multiple conversation threads (general, per-roadmap-item, ad-hoc).
- **Conversations are accessible from cards.** A visual indicator on project cards and roadmap item cards shows active/existing threads. Click → sidebar opens to that conversation. No hierarchy navigation needed.
- **New threads can be created from any card.** Right-click a project card → "Start a conversation about this project." Click a roadmap item → "Discuss this item." The thread is automatically scoped and context-injected.
- **Multiple conversations can be live concurrently.** Working on item A's thread doesn't close item B's thread. The user can switch between them.
- **History is persistent and navigable.** The user can browse past conversations by project, see what was discussed, and continue where they left off.

## Inspiration: Conductor / Codex Thread Model

In Codex:
- You add a "project" (a folder on your computer)
- Projects become threads — containers for conversations
- Within a thread, you can have sub-conversations
- The project context (codebase, files) is automatically available in every conversation within that thread

**Clawchestra's equivalent:**
- Projects already exist in the kanban (tracked via `PROJECT.md`)
- Projects become thread containers
- Roadmap items become natural sub-thread scopes within a project
- Project context (AGENTS.md, ROADMAP.md, specs, plans, git state) is automatically injected per-thread

## Thread Hierarchy

```
Project (kanban card)
├── General Thread          — project-wide discussion, architecture, planning
├── Roadmap Item A Thread   — specific to deliverable A (spec, plan, implementation)
├── Roadmap Item B Thread   — specific to deliverable B
├── Ad-hoc Thread           — user-created for any purpose ("brainstorm feature X")
└── [Agent Terminal]        — (see embedded-agent-terminals spec)
```

Each thread has:
- **Title** — auto-generated from context or user-named
- **Session key** — maps to an OpenClaw session (`agent:main:project:{id}:general`, `agent:main:project:{id}:item:{item-id}`, etc.)
- **Context profile** — what gets auto-injected (project files, item spec, etc.)
- **Last activity** — timestamp for sorting/staleness
- **Message count** — for visual density indication

## UI: Card-Level Conversation Access

The key UX insight from the original discussion: **the entry point is the card, not a sidebar hierarchy.**

### On Project Cards (Level 1 — Kanban)

- **Thread indicator** — small icon/badge showing number of active threads (e.g., `💬 3`)
- **Click indicator** → sidebar opens showing that project's thread list
- **Quick action** — "New conversation" button creates a general thread for that project
- If only one thread exists, clicking goes directly to it (no intermediate list)

### On Roadmap Item Cards (Level 2 — Priority List)

- **Thread indicator** — shows if this specific item has an active conversation
- **Click indicator** → sidebar opens to that item's thread directly
- **Quick action** — "Discuss this item" creates a thread scoped to the item with its spec/plan auto-loaded
- Item-level threads inherit project context + add item-specific context

### Sidebar Behavior

- Opens from the right (same position as current chat drawer, but richer)
- Shows thread content: message history, input box, context summary at top
- **Back navigation** — from an item thread, can go up to project thread list
- **Thread switcher** — tabs or dropdown to switch between a project's threads without closing the sidebar
- Sidebar can coexist with the kanban view (doesn't overlay the board)

## Session Key Strategy

Building on the hybrid approach suggested in `distributed-ai-surfaces-spec.md`:

| Scope | Session Key Pattern | Lifecycle |
|-------|-------------------|-----------|
| Project general | `agent:main:project:{project-id}` | Long-lived, persists across sessions |
| Roadmap item | `agent:main:project:{project-id}:item:{item-id}` | Long-lived while item is active |
| Ad-hoc thread | `agent:main:project:{project-id}:thread:{uuid}` | User-managed, can be archived |
| Ephemeral action | `agent:main:action:{action-type}:{uuid}` | Short-lived, cleaned up after action completes |

### Context Injection Per Scope

| Scope | Auto-Injected Context |
|-------|----------------------|
| Project general | PROJECT.md, ROADMAP.md, project AGENTS.md, recent git state |
| Roadmap item | All project context + item detail file, spec, plan (if they exist) |
| Ad-hoc thread | Project context only (user provides the specifics) |

## Thread Persistence

Threads are persisted locally (Tauri app state, likely SQLite alongside existing chat.db):

```
threads table:
  - id (uuid)
  - project_id (string, matches project slug)
  - item_id (string, nullable — null for project-level threads)
  - title (string)
  - session_key (string)
  - created_at (timestamp)
  - last_activity (timestamp)
  - message_count (integer)
  - archived (boolean)
```

Message history lives in OpenClaw's session transcripts (keyed by session key). The threads table is metadata only — it tells the UI what threads exist and where to find them, but the actual conversation content is in the gateway.

## Phased Delivery

### Phase 1: Thread Data Model + Storage
- Define thread schema in Tauri (SQLite table or store)
- Thread CRUD operations (create, list by project, archive)
- Session key generation from thread scope

### Phase 2: Card Indicators
- Thread count badges on project cards and roadmap item cards
- Click handlers to open sidebar to the relevant thread
- "New conversation" quick action on cards

### Phase 3: Thread Sidebar
- Sidebar renders thread content (message history from OpenClaw session)
- Input box with context injection per scope
- Thread switcher for navigating between a project's threads
- Back navigation (item thread → project thread list)

### Phase 4: Thread Management
- Thread list view (all threads, filterable by project)
- Archive/delete threads
- Rename threads
- Thread search (across all conversations)

## Relationship to Other Specs

- **`scoped-chat-sessions-spec.md`** — established session key isolation and surface profiles. This spec extends that into a structured thread model.
- **`distributed-ai-surfaces-spec.md`** — provides the reusable `<AiChat>` component and context injection protocol. This spec organizes those surfaces into a navigable hierarchy.
- **`embedded-agent-terminals-spec.md`** — agent terminals become another thread type within the project conversation hub.

## Non-Goals

- Replacing the general chat drawer (stays for unscoped, cross-project conversation)
- Multi-user threads (this is single-user, multiple conversations)
- Real-time collaboration features
- Thread sharing or export (for now)

## Open Questions

1. **Thread creation friction** — Should threads be auto-created (first message to a project creates a general thread) or always explicit (user clicks "New conversation")?
2. **Thread limits** — Should there be a max number of active threads per project? OpenClaw session cost is the constraint.
3. **Thread archival** — When a roadmap item is marked complete, should its thread auto-archive? Or stay accessible?
4. **Cross-thread references** — "In the other conversation about item A, we decided X" — should threads be aware of sibling threads?
5. **General drawer migration** — If a user starts a conversation in the general drawer that's clearly about a specific project, should there be a "Move to project thread" action?
