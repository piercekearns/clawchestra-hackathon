# Project Conversation Hub

> Deep-dive conversation management organized by project — project-scoped chats and roadmap-item-scoped chats accessible directly from cards, living in the sidebar alongside terminal sessions.

**Status:** Draft (decisions captured, ready for plan)
**Created:** 2026-02-21
**Last Updated:** 2026-02-26
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

The key UX insight: **the entry point is the card, not a sidebar hierarchy.** Both project cards and roadmap item cards surface a `MessagesSquare` icon on hover that creates or navigates to the relevant thread/chat.

### The `MessagesSquare` Button — States

The icon uses the same hover-reveal style as the existing card lifecycle buttons — hidden by default, fades in on card hover.

| State | Visual | Tooltip | Click action |
|-------|--------|---------|--------------|
| **No thread exists** | Unfilled / default stroke colour | `"Create Thread"` | Creates the project thread + project-level chat, then opens hub nav to it + secondary drawer to the new chat |
| **Thread exists, no notifications** | Filled, coloured `#DFFF00` (chartreuse) | `"Open Thread"` | Opens hub nav to the project thread + secondary drawer to the project-level chat (or most recent chat if one was previously active) |
| **Thread exists, has notifications** | Filled `#DFFF00` + small notification dot/badge | `"Open Thread (N unread)"` | Same as above — drawer opens to the chat with the notification |

The `#DFFF00` fill is a proposal — validate visually against the card background at implementation. If chartreuse reads poorly in context, the filled state can use the app's accent colour instead.

---

### On Project Cards (Level 1 — Kanban Board)

The `MessagesSquare` icon appears in the card's hover-reveal button area (same zone as other card actions).

- **Unfilled** → no thread for this project yet
- **Filled `#DFFF00`** → thread exists
- **Filled + notification badge** → thread has chats with unread/action-required states
- **Click** → opens hub nav sidebar to that project's thread. Secondary drawer opens to the project-level chat (the thread's root conversation). If no thread existed, creates it first.

---

### On Roadmap Item Cards (Level 2 — Priority List)

The `MessagesSquare` icon sits **to the left of the existing lifecycle buttons** (Update Spec, Create Plan, Plan Review, etc.) in the card's hover-reveal button row.

Same filled/unfilled/notification state logic as project cards, but scoped to item-level:

- **Unfilled** → no chat exists for this roadmap item yet
- **Filled `#DFFF00`** → a chat for this item exists within its project's thread
- **Filled + badge** → that chat has unreads or action-required
- **Click** → opens hub nav to the item's chat within its project thread. Secondary drawer opens directly to that item-level chat. If no item chat existed, creates one within the project's thread.

#### Lifecycle buttons — future rethink (flagged, not actioned)

The 5 lifecycle buttons (Update Spec, Create Plan, Plan Review, etc.) currently auto-copy-paste prompts into the general chat. As the hub and per-item chat sessions mature, this workflow will likely change — it makes more sense for those actions to initiate or continue an item-scoped chat rather than dumping into the general chat. **The buttons stay as-is for now** until the new workflow is defined. This is flagged here so it's not forgotten when planning item-level chats.

### Spatial Layout (Option B — resolved, see Decision 8)

The conversation hub uses a **two-layer spatial model**:

1. **Main sidebar** — contains the hub navigation: the list of project threads and their chat/terminal entries. This is persistent navigation infrastructure — it stays visible while the user browses and selects.
2. **Secondary chat drawer** — opens to the right of the main sidebar when the user clicks a specific chat or terminal entry. This is where the conversation actually happens. It can be resized and dismissed independently of the main sidebar.

```
[Thin strip] | [Main sidebar — hub nav] | [Secondary drawer — active chat] | [Kanban board]
```

The secondary drawer can be open or closed independently. The main sidebar remains visible regardless of drawer state. The kanban board shifts right to accommodate the drawer width (or overlaps at narrower screen sizes — exact behaviour TBD in planning).

---

### Thin Sidebar Entry Point

The thin icon strip (existing left-edge navigation) gains a dedicated **conversation hub icon** — **`MessagesSquare`** from Lucide (two overlapping speech bubbles).

**Click behaviour:**
- **Click (hub not open):** Opens the main sidebar to the conversation hub view. If all threads are collapsed, expands them so the user can immediately see and navigate to threads and chats.
- **Click (hub already open):** Collapses the main sidebar back (standard sidebar toggle behaviour).
- **Visual state:** Icon is highlighted/active when the hub is open, default when closed.

**Notification badge:** A small dot or count badge sits on the glyph whenever any chat/terminal has an unread message or an action required (e.g. terminal waiting for approval). Visible at all times — gives the user a signal without opening anything.

---

#### Quick Access Popover (hover)

On **hover** over the hub glyph (after ~300ms delay to prevent accidental triggers), a compact popover card surfaces to the right of the thin strip — without opening the full sidebar.

**Contents:** Up to **5 entries**, sorted by priority:

1. Chats/terminals with **unread messages or actions required** — floated to the top, in recency order within that group
2. Remaining slots filled by **most recently active** chats/terminals

Each entry shows:

| Element | Detail |
|---------|--------|
| Type icon | Chat bubble (OpenClaw) or terminal/agent icon — same icons as hub nav |
| Chat name | Truncated if needed |
| Project name | Shown smaller beneath the chat name — gives context at a glance |
| Notification indicator | Dot or label (`unread`, `approval needed`, `error`) if applicable |
| Last activity | Relative timestamp (e.g. "2m ago") |

**Clicking an entry** in the popover opens the secondary drawer directly to that chat — skipping the "find thread → find chat → click" path entirely. Hub nav also opens so the user has full context, but the drawer is the destination.

**Clicking the glyph itself** (while popover is visible) opens the full hub nav as normal.

**Popover dismissal:** Disappears when the cursor leaves the glyph + popover area (with a ~200ms grace period so the user can move the cursor from glyph to popover without it closing). Also dismisses if the user clicks anywhere outside it.

**When the popover would be empty** (no chats exist yet): show a brief prompt — *"No chats yet. Open a project card to start one."* — rather than showing nothing.

---

### Secondary Chat Drawer

When the user clicks a chat or terminal entry in the hub nav, a **secondary drawer** opens to the right of the main sidebar containing the active conversation or terminal session.

**Drawer behaviour:**
- Resizable — user can drag the drawer wider or narrower.
- Persists while navigating — switching between chats in the hub nav updates the drawer content without closing it.
- **Close control:** A **dismiss icon** (e.g. `→` collapse arrow or `×`) sits in the **top-right corner of the drawer**. Clicking it closes the drawer, leaving the main sidebar (hub nav) visible and the kanban board returning to full width. It does not close the main sidebar.
- The drawer is the only way to interact with a chat — no chat content renders inside the main sidebar nav itself.

---

### Main Sidebar Hub Nav Behaviour

- Shows the thread list with chat/terminal entries (as specified in Row Layout section)
- **Back navigation** — from within the drawer, a breadcrumb or header indicates the active chat scope. The hub nav sidebar always shows where you are.
- **Chat switcher** — clicking a different chat in the nav updates the drawer. No need to close and re-open.
- Hub nav coexists with the kanban board view (sits to the left of it).

### Row Layout + Hover Affordances

The hub has two distinct row types with different visual structures and different hover behaviours.

---

#### Project thread header row

**Default state (no hover):**
```
[📁]  Project Name
```

**On hover:**
```
[▾]  Project Name ···················  [+]  [⋯]
```

| Zone | Element | Default | On Hover |
|------|---------|---------|----------|
| Far left | **Folder icon `📁` / Chevron `▾▸`** | Folder icon — always visible, signals this is a container | Replaced by chevron — click to expand/collapse thread |
| Middle | **Project name** | Always visible. Double-click to rename. Truncates with `…` + hover scroll if too long. | Same, plus scroll animation plays |
| Right | **`+` add button** | Hidden | Fades in. Opens type-picker: *OpenClaw chat* (default) or *Terminal session* (with agent selector). |
| Far right | **`⋯` menu** | Hidden | Fades in. See actions below. |

The folder icon and chevron occupy the same space — the folder icon is the resting state, the chevron is the hover state. The swap signals affordance without cluttering the default view.

The folder icon itself reflects thread state: **open folder** when the thread is expanded (chats visible), **closed folder** when collapsed. This gives an at-a-glance read of which threads are open without needing to look at the chevron direction.

**Thread reordering:** Project threads can be drag-to-reordered by clicking and dragging any thread header row. Cursor changes to `grab` on hover over the draggable zone (folder icon + name area) and `grabbing` during drag. The `+` and `⋯` buttons are not drag handles — hovering them shows the default pointer cursor. A visual drop indicator (line between threads) shows the insertion point during drag. Order is persisted to app state.

**Project header `⋯` menu:**
- *Expand all / Collapse all* (toggle all threads at once)
- *(Reserved — keep menu present for future project-level actions)*
- Note: `+` handles all chat creation, so the menu is intentionally sparse on project headers. May be omitted entirely if no additional project-level actions materialise during planning.

---

#### Chat entry row (indented under project)

```
  [📌 hover]  Chat Name ············  [🗄 hover]  [⋯ hover]
```

| Zone | Element | Behaviour |
|------|---------|-----------|
| Left indent space | **Pin icon `📌`** | Hidden by default. Fades in on row hover, in the indented whitespace to the left of the name. Click to pin/unpin. Pinned chats show the icon persistently (filled/coloured). |
| Middle | **Chat name** | Double-click to rename (inline edit — Enter to confirm, Escape to cancel, blur to save). Single-click opens/switches to the chat. Truncates with hover scroll if too long. |
| Right (hover) | **Archive icon** | Fades in on row hover. Click to archive (moves to archived section, confirmation snackbar with undo). |
| Far right (hover) | **`⋯` menu** | Fades in on row hover. Contains the actions that don't warrant a dedicated button (see below). |

**Chat entry `⋯` menu — what's left after pin, archive, rename:**

| Action | Why it's in the menu (not a direct button) |
|--------|---------------------------------------------|
| Mark as unread / Read | Infrequent enough to not need a button; classic three-dot action |
| Open linked item | Contextual — only shown when chat has a linked roadmap item. Navigates to that card. |
| Delete | Deliberately tucked away — destructive, irreversible, should require intent |

That's it. Three items (one conditional). The menu is lean because the common actions are already on direct affordances.

---

#### Terminal session entry row (indented, same indent as chat entries)

Terminal rows follow the same layout as chat entries but with role-appropriate right-edge and menu actions:

```
  [📌 hover]  Terminal Name ·········  [⏹ hover]  [⋯ hover]
```

| Zone | Element | Notes |
|------|---------|-------|
| Left indent | **Pin icon** | Same as chat entries |
| Middle | **Session name** | Double-click to rename. Default: `"{Agent} — {scope}"` (e.g. `Claude Code — git-sync`), optionally suffixed with first prompt content once the session has started. |
| Right (hover) | **End / Archive icon** | Context-sensitive: shows **End session** `⏹` if session is active (with confirmation); shows **Archive** `🗄` if session is completed/idle. |
| Far right (hover) | **`⋯` menu** | See below. |

**Terminal entry `⋯` menu:**

| Action | Notes |
|--------|-------|
| Detach | Disconnect xterm.js from the tmux session without killing it — session keeps running in background |
| View scrollback | Open session output in read-only mode (useful for completed sessions) |
| Mark as unread | Same as chat entries |
| Delete | Remove session + scrollback from history. Destructive, requires confirmation. |

---

#### Trigger behaviour (shared across all row types)

- All hover-only elements (pin icon, archive/end button, `⋯` icon, `+` button) are **hidden by default**. They fade in (`opacity: 0 → 1`, `~150ms`) when the row is hovered.
- On hover-out (no menu open): fade back out.
- If a menu is open: all hover elements stay visible until the menu is dismissed.
- The `⋯` icon is focusable; Enter/Space opens the menu; Escape closes it.
- Dropdown is a compact popover (not a full modal). Appears below or above based on available space.
- Destructive actions (Delete, End session) are separated by a divider and rendered in a muted danger colour.

#### Coexistence with the name reveal animation

The name's `translateX` animation and the right-edge hover buttons share the same `mouseenter` trigger. They coexist without conflict:

- The text container has `padding-right` equal to the combined width of the right-edge button(s) + gap. The scrolling text therefore never reaches the button zone.
- The `⋯` icon sits `position: absolute; right: 8px` (or similar), outside the text clip zone.
- Animation `translateX` target is capped to the overflow distance minus this reserved padding.

#### Chat name inference

When a chat is **created manually** (via the `+` button on a project header), the initial name defaults to:
- `"New chat"` with a timestamp suffix, immediately editable
- Once the first message is sent: name auto-updates to a short inferred label derived from the opening prompt (e.g. `"Fixing auth flow"` from a prompt like *"Help me fix the authentication flow in the login component"*). This inference is a lightweight AI call (single-turn, cheap model, optional — falls back to keeping the manual name if the user already renamed it).
- If created from a card: default name is the project or roadmap item title (same as today's auto-naming).

---

### Truncated Name Reveal (Hover Marquee)

When a project or roadmap item name is too long to fit in the sidebar row, it truncates with `…`. On hover, instead of showing a static tooltip, the label plays a **smooth horizontal scroll animation** that pans the text left to reveal the hidden portion, then either holds or gently pans back.

**Behaviour:**
- **Default state:** `overflow: hidden`, `text-overflow: ellipsis`. Truncated with `…` at the clip boundary.
- **On hover:** A CSS `translateX` animation slides the text left at a gentle pace (not a jarring flash) to reveal the full name. The `…` disappears once the scroll begins.
- **End of reveal:** Animation either holds at the end of the text for ~0.5s, then slides back to start — or loops seamlessly if the name is very long.
- **On hover-out:** Immediately snaps (or fast-fades) back to the default truncated state. No lingering mid-scroll.
- **No tooltip fallback needed** — the animation *is* the tooltip. Cleaner and more delightful than a floating box.

**Implementation notes:**
- Pure CSS via `@keyframes` with `transform: translateX(calc(-100% + <container-width>px))` — no JS needed for the basic case.
- Container clips with `overflow: hidden`. The inner text element animates.
- Animation duration should scale loosely with the amount of overflow — very long names need more time. A CSS custom property (`--overflow-distance`) set by JS (measured at render time) and referenced in the animation makes this dynamic.
- Easing: ease-in-out or linear both work. Avoid ease (too front-loaded).
- Applies to: project names, roadmap item chat names, terminal session names — any truncated label in the hub.
- **Does not apply** to action buttons or badges in the same row — only the name/label text.

**Example timing (starting point, tune in implementation):**
- Delay before animation starts: `300ms` (prevents flicker on mouse-through)
- Pan duration: `~1.5s` for a moderately long name
- Hold at end: `500ms`
- Return: `200ms` (fast snap back, or instant)

## Chat Behaviors

- **Sorted by last interaction** — most recently active chats appear at the top, not by creation date
- **Max 5 visible per project** — roadmap-item-level chats show 5 max, then "Show N more..." dropdown below the 5th
- **Pin** — user can pin specific chats *(pin icon in left indent zone, on hover)*
- **Rename** — user can rename any chat *(double-click the name — primary; also in `⋯` menu)*
- **Archive** — user can manually archive chats *(archive icon at right edge, on hover)*
- **Mark as unread** — user can mark a chat as unread *(via `⋯` menu)*
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

### 8. Spatial layout: Option B (separate resizable secondary drawer)
The hub navigation (thread list) lives in the main sidebar. Active chat/terminal content opens in a **secondary drawer** to the right of the main sidebar — independently resizable and dismissible. The main sidebar remains visible regardless of drawer state. Entry point is a dedicated conversation hub icon in the thin strip. Thin strip icon click opens the hub nav and expands all threads if collapsed. Secondary drawer has a close control in its top-right corner that dismisses only the drawer, leaving the hub nav intact.

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

### ~~OQ-1: Spatial layout~~ → **Resolved** — see Decision 8

### OQ-1 (archived): Spatial layout — nav hub vs active chat surface

The spec currently describes the conversation hub as living in the sidebar and also renders chat content there. This conflates two distinct UI concerns:

- **Navigation layer** — the thread list, chat list, project/item tree, search, switcher. This is the *hub* — you need to stay oriented within it.
- **Chat content layer** — the actual message history, input box, context header. This is where the *conversation happens*.

**The problem:** If opening a chat replaces the sidebar with the chat, the user loses access to the navigation. They can't switch to another chat, scan across projects, or navigate back without some back-button gesture. The hub needs to be persistent or very easily recovered while the user is inside a conversation.

**Proposed options to decide between:**

| Option | Description | Trade-offs |
|--------|-------------|------------|
| **A — Split panel (hub left, chat right)** | Navigation hub occupies a narrow left column (always visible). Active chat opens to its right in a wider panel. Both coexist. | Most spatial — two panes. Requires enough screen width. |
| **B — Chat opens in a separate resizable drawer** | Hub lives in the sidebar as currently. Clicking a chat opens an additional right-side (or left-side) drawer that renders the conversation. Hub stays visible underneath / alongside. Drawer can be resized/dismissed independently. | Similar to a VS Code secondary panel. Hub persists. Drawer adds width. |
| **C — Hub is a persistently visible strip** | Hub collapses to a narrow icon strip (like the thin sidebar), active chat fills the rest. Expanding the strip reveals thread/chat names. | Compact but discovery may be worse — harder to orient when minimised. |
| **D — Hub slides over, but chat remembers scroll + stays warm** | Chat opens in the full sidebar area (replaces nav), but a pinned "back to hub" button is always visible. Chat stays mounted in background so switching is instant. | Lower spatial cost, higher cognitive cost — user has to mentally track "am I in a chat or the hub?". |

**Key questions for the decision:**
- Should the hub always be visible while in a conversation, or is a persistent "back" affordance sufficient?
- Does the chat drawer need to be resizable independently of the sidebar?
- Can the chat drawer be open *at the same time* as the project kanban board (so the user sees board + hub strip + chat panel simultaneously)?
- Where does the terminal session panel live — same drawer as chat? Its own drawer? Full-screen overlay?
- On narrower screens, which panel wins?

**Recommendation (unvalidated — needs decision):** Option B (separate resizable drawer). Rationale: the hub should feel like persistent navigation infrastructure (like a file tree), not a modal you step into and out of. The chat drawer adds width but preserves orientation. The drawer pattern is familiar (VS Code secondary sidebar, Notion page preview). Resizability lets power users make it narrow during active coding and wide during deep chat.

**Impact on both specs:** This decision determines the layout architecture for `embedded-agent-terminals` too — terminal sessions and OpenClaw chats live in the same container, so the same spatial model applies to both.

---

### OQ-2: Context injection mechanism
How exactly does the scoped session get its project/item context? Is this via OpenClaw's existing session preamble, a Clawchestra-specific skill, or a new injection mechanism? (Depends on `app-aware-ai-context` spec resolution.)
