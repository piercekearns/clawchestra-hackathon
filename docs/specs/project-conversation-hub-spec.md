# Project Conversation Hub

> Deep-dive conversation management organized by project — project-scoped chats and roadmap-item-scoped chats accessible directly from cards, living in the sidebar alongside terminal sessions.

**Status:** Draft (decisions captured, ready for plan)
**Created:** 2026-02-21
**Last Updated:** 2026-02-25
**Roadmap Item:** `project-conversation-hub`
**Depends On:** `distributed-ai-surfaces` (multi-surface foundation), `scoped-chat-sessions` (session isolation)

---

## Problem

Even with a general chat drawer for app-wide OpenClaw conversation, there's no way to:

1. **Deep-dive on a specific project** — constrain the conversation and its history to a single project, so OpenClaw's context is focused and the user's mental bandwidth is narrowed.
2. **Manage multiple concurrent conversations** about the same project — e.g., one chat about roadmap item A and another about item B, both ongoing.
3. **Return to a previous conversation** — if I had a deep discussion about a project's architecture last Tuesday, I can't find or continue it. It's lost in the flat chat history.
4. **See at a glance** which projects/items have active conversations — there's no visual indicator that "this card has an ongoing thread attached to it."
5. **Organize conversations by subject** — everything is in the general drawer. There's no persistent, navigable structure per project.

## Terminology

To avoid ambiguity, this spec uses these terms consistently:

- **General chat** — the existing app-wide OpenClaw chat bar. Macro-level, cross-project conversations. Stays as-is.
- **Thread** — a project-level container (like a folder). One thread per project. Lives in the conversation hub sidebar.
- **Chat** — an individual conversation within a thread. One project-level chat per thread, plus N roadmap-item-level chats. Can be either an OpenClaw chat session or a terminal session (see `embedded-agent-terminals-spec.md`).
- **Conversation hub** — the sidebar UI that houses all threads and their chats.

## What Success Looks Like

- **The general chat stays for big-picture work.** "Give me all in-progress items across all projects" — that's the general chat. It's the macro-level surface.
- **Threads are project-level containers.** Each project can have a thread. Within a thread: one project-level chat + per-roadmap-item chats. The thread is the deep-dive location.
- **Chats are accessible from cards.** A visual indicator on project cards and roadmap item cards shows active/existing chats. Click → sidebar opens to that chat. No hierarchy navigation needed.
- **New chats are created from cards.** Click a project card → opens the project chat (or creates the thread + project chat if none exists). Click a roadmap item → opens that item's chat (or creates it within the project's thread).
- **Multiple chats can be live concurrently.** Working on item A's chat doesn't close item B's chat. The user can switch between them.
- **History is persistent and navigable.** The user can browse past chats by project, see what was discussed, and continue where they left off.
- **OpenClaw knows the conversation is scoped.** When a chat is opened from a project card, OpenClaw understands (via context injection) that the conversation is about that specific project — unless the user explicitly steers it elsewhere.

## Two Surfaces, Two Purposes

| Surface | Location | Purpose | Scope |
|---------|----------|---------|-------|
| **General chat** | Bottom chat bar (existing) | App-wide conversation with OpenClaw | All projects, big-picture, macro-level |
| **Conversation hub** | Sidebar (new) | Deep-dive, project-constrained conversations | Single project or roadmap item |

The general chat is not a thread. It doesn't live in the conversation hub. It's a separate, always-available surface for when the user is thinking across projects or wants to talk to OpenClaw without constraining to a specific context.

## Thread + Chat Hierarchy

```
Conversation Hub (sidebar)
├── Clawchestra (project thread)
│   ├── 💬 Project chat              ← about the project overall
│   ├── 💬 git-sync                  ← roadmap item chat (most recent interaction)
│   ├── 💬 ui-tweaks                 ← roadmap item chat
│   ├── 🖥️ Claude Code — git-sync   ← terminal session (see embedded-agent-terminals)
│   ├── 💬 embedded-terminals        ← roadmap item chat
│   ├── 💬 rate-limit-resilience     ← roadmap item chat (5th visible)
│   └── ▾ Show 3 more...
├── ClawOS (project thread)
│   ├── 💬 Project chat
│   └── 💬 hackathon-mvp
└── + New project thread
```

### Visual discrimination: chat type

Each chat in the sidebar shows an icon indicating its type:

| Type | Icon | Description |
|------|------|-------------|
| OpenClaw chat | 💬 | Standard OpenClaw session (text conversation) |
| Claude Code terminal | Anthropic icon | Terminal session running Claude Code CLI |
| Codex terminal | OpenAI icon | Terminal session running Codex CLI |
| Cursor terminal | Cursor icon | Terminal session running Cursor CLI |
| Generic terminal | 🖥️ | Terminal session (generic shell) |

The chat UI itself looks similar across types — same sidebar panel, same visual container — but the content area renders differently (chat bubbles for OpenClaw, terminal emulator for terminals). The user selects the chat type when creating a new chat.

### Chat type selection

When creating a new chat (from a card or from the thread), the user chooses:

- **OpenClaw chat** (default) — a new scoped OpenClaw session
- **Claude Code** / **Codex** / **Cursor** / **Terminal** — a new terminal session (see `embedded-agent-terminals-spec.md`)

The default is OpenClaw. In future, certain UI actions could auto-default to a specific type (e.g., "Implement this item" might default to Claude Code terminal).

## UI: Card-Level Chat Access

The key UX insight: **the entry point is the card, not a sidebar hierarchy.**

### On Project Cards (Level 1 — Kanban Board)

- **Chat indicator** — small icon/badge showing active chats (e.g., `💬 3`)
- **Click indicator** → sidebar opens to the project's thread, showing the project-level chat
- If no thread exists yet → creates the thread + project-level chat automatically
- **Quick action** — "New chat" option to create additional chats within the thread

### On Roadmap Item Cards (Level 2 — Priority List)

- **Chat indicator** — shows if this specific item has an active chat
- **Click indicator** → sidebar opens to that item's chat directly
- If no chat exists for this item → creates one within the project's thread automatically
- Item-level chats inherit project context + add item-specific context (spec, plan, detail file)

### Sidebar Behavior

- Lives in the existing sidebar panel area (left side, same region as thin sidebar navigation)
- Shows chat content: message history, input box, context summary at top
- **Back navigation** — from an item chat, can go up to project thread list
- **Chat switcher** — click any chat in the thread list to switch without closing the sidebar
- Sidebar can coexist with the kanban view

## Chat Behaviors

- **Sorted by last interaction** — most recently active chats appear at the top, not by creation date
- **Max 5 visible per project** — roadmap-item-level chats show 5 max, then "Show N more..." dropdown below the 5th
- **Pin** — user can pin specific chats to keep them visible regardless of recency
- **Rename** — user can rename any chat (default name is the project/item title)
- **Archive** — user can manually archive chats they're done with
- **Mark as unread** — user can mark a chat as unread (for "come back to this" workflow)
- **Completion indicator** — when a linked roadmap item reaches `complete` status, the chat shows a visual checkmark/greyed title, but does NOT auto-archive (see decision below)

## Session Key Strategy

Building on the hybrid approach suggested in `distributed-ai-surfaces-spec.md`:

| Scope | Session Key Pattern | Lifecycle |
|-------|-------------------|-----------|
| Project general | `agent:main:project:{project-id}` | Long-lived, persists across sessions |
| Roadmap item | `agent:main:project:{project-id}:item:{item-id}` | Long-lived while item is active |
| Ad-hoc chat | `agent:main:project:{project-id}:chat:{uuid}` | User-managed, can be archived |
| Terminal session | N/A (terminal sessions don't use OpenClaw sessions) | Tied to PTY/tmux lifecycle |

### Context Injection Per Scope

| Scope | Auto-Injected Context |
|-------|----------------------|
| Project general | CLAWCHESTRA.md, state.json (for that project), project AGENTS.md, recent git state |
| Roadmap item | All project context + item detail file, spec, plan (if they exist) |
| Ad-hoc chat | Project context only (user provides the specifics) |

**Key behavior:** When a project-scoped or item-scoped chat is opened, OpenClaw should understand that the conversation is constrained to that project/item unless the user explicitly steers it elsewhere. The context injection makes this the default, and the session key isolation means the conversation history stays focused.

## Cross-Session Knowledge: The Context Gap Problem

A significant architectural challenge: when the user has multiple chats across a project (project-level + several item-level), how does OpenClaw in one chat know about decisions made in another?

**Current state:** OpenClaw has a consolidated memory system across sessions/devices. This provides some baseline awareness — things explicitly committed to memory in one chat will be available in others.

**Gap:** Conversational context that isn't explicitly memorized is lost across chats. If the user discusses an architectural decision in the project chat, the item-level chat won't know about it unless the user restates it or OpenClaw committed it to memory.

**Phase 1 approach:** Accept this limitation. The user manually bridges context between chats (or OpenClaw's memory catches the important bits). This matches how people work with multiple chat windows today.

**Future consideration:** A pooled context layer — perhaps a per-project knowledge store (structured summaries, key decisions, active constraints) that all chats within a thread can read. This could be:
- A project-level context file (like AGENTS.md but auto-maintained from chat interactions)
- A lightweight database of "decisions" and "constraints" extracted from chat history
- OpenClaw's existing memory system, augmented with project-scoped memory

This is explicitly a Phase 2+ concern. The architecture should not prevent it (session key isolation + project scoping makes it possible), but Phase 1 doesn't build it.

## Chat Persistence

Chats are persisted locally (Tauri app state, SQLite alongside existing chat.db):

```
chats table:
  - id (uuid)
  - project_id (string, matches project slug)
  - item_id (string, nullable — null for project-level chats)
  - type ('openclaw' | 'terminal')
  - agent_type (nullable — 'claude-code' | 'codex' | 'cursor' | 'opencode' | 'generic')
  - title (string)
  - session_key (string, nullable — null for terminal sessions)
  - pinned (boolean, default false)
  - unread (boolean, default false)
  - created_at (timestamp)
  - last_activity (timestamp)
  - message_count (integer — for OpenClaw chats; null for terminals)
  - archived (boolean, default false)
```

Message history for OpenClaw chats lives in OpenClaw's session transcripts (keyed by session key). The chats table is metadata only — it tells the UI what chats exist and where to find them, but the actual conversation content is in the gateway.

Terminal session scrollback is stored separately (see `embedded-agent-terminals-spec.md`).

## Decisions (Resolved)

### 1. Chat creation: auto-create from card interaction
Chats are created automatically when a user clicks a project card or roadmap item card's chat indicator. No explicit "New conversation" step needed for the first chat. Subsequent chats within the same thread require a "New chat" action (to choose type, scope, etc.).

### 2. Display limits: 5 visible, sorted by recency
Max 5 roadmap-item-level chats visible per project in the sidebar. "Show N more..." below the 5th. Sorted by last interaction timestamp, not creation date. Pinned chats always visible regardless of the limit.

### 3. No auto-archive on roadmap item completion
When a roadmap item reaches `complete` status, its chat shows a visual indicator (checkmark, greyed title) but is NOT auto-archived. Rationale: agents might set `complete` prematurely (despite the AGENTS.md guardrail), and the user may need the chat during testing/verification. The completion indicator serves as a prompt — the user can archive manually from there, and that completion indicator provides an easy entry point to trigger the archive action.

### 4. No cross-thread references
Chats within a thread are not aware of sibling chats. Too complex for insufficient value. The user bridges context manually or relies on OpenClaw's memory.

### 5. No general drawer migration (deferred)
No "Move this conversation to Project X" action from the general chat. Deferred — nice-to-have, not structural.

### 6. General chat stays separate
The general chat bar is a separate UI element from the conversation hub. It's the macro-level, app-wide surface. The conversation hub (sidebar) is the deep-dive location. They are not the same element evolved — they are two distinct surfaces serving different purposes.

### 7. tmux for terminal session persistence
Terminal sessions within the conversation hub use tmux as the backend (not direct PTY). This ensures session persistence across app restarts, matching the persistence behavior users expect from OpenClaw chat history. See `embedded-agent-terminals-spec.md` for details.

## Phased Delivery

### Phase 1: Chat Data Model + Storage + Basic Sidebar
- Define chat/thread schema in Tauri (SQLite table)
- Chat CRUD operations (create, list by project, archive, pin, rename, mark unread)
- Session key generation from chat scope
- Basic sidebar UI: thread list with chat entries, click to open
- Project-level chat rendering (reuse existing chat components with scoped session key)

### Phase 2: Card Indicators + Entry Points
- Chat count badges on project cards and roadmap item cards
- Click handlers to open sidebar to the relevant chat (auto-create if needed)
- Chat type selector (OpenClaw vs terminal types)
- Completion indicator on chats linked to completed roadmap items

### Phase 3: Full Chat Management
- Pin, rename, archive, mark-as-unread UI controls
- "Show N more..." overflow for >5 item-level chats
- Sort by last interaction
- Context injection per scope (project files, item spec/plan)
- Archived chats section (viewable, restorable)

### Phase 4: Terminal Integration
- Terminal sessions as a chat type within threads (depends on `embedded-agent-terminals` Phase 1)
- Agent-specific icons in sidebar
- Unified thread view: OpenClaw chats and terminal sessions side by side

## Relationship to Other Specs

- **`scoped-chat-sessions-spec.md`** — established session key isolation and surface profiles. This spec extends that into a structured thread/chat model.
- **`distributed-ai-surfaces-spec.md`** — provides the reusable `<AiChat>` component and context injection protocol. This spec organizes those surfaces into a navigable hierarchy.
- **`embedded-agent-terminals-spec.md`** — terminal sessions are a chat type within the conversation hub. The terminal spec defines the rendering and lifecycle; this spec defines the container and navigation.

## Non-Goals

- Replacing the general chat drawer (stays for unscoped, cross-project conversation)
- Multi-user threads (this is single-user, multiple conversations)
- Real-time collaboration features
- Thread sharing or export (for now)
- Cross-chat context awareness in Phase 1 (accepted limitation, future consideration documented above)

## Open Questions

*All previously open questions have been resolved (see Decisions section). New questions may arise during planning.*

1. **Context injection mechanism** — How exactly does the scoped session get its project/item context? Is this via OpenClaw's existing session preamble, a Clawchestra-specific skill, or a new injection mechanism? (Depends on `app-aware-ai-context` spec resolution.)
