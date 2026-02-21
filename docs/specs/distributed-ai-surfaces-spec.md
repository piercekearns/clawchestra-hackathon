# Distributed AI Surfaces

> Replace the single chat drawer as the sole AI interaction point with context-aware chat components embedded throughout the app — the UI location IS the instruction.

**Status:** Draft
**Created:** 2026-02-21
**Roadmap Item:** `distributed-ai-surfaces`
**Depends On:** `architecture-direction` (must be delivered first), `scoped-chat-sessions` (session key foundation)
**First Consumer:** `roadmap-item-quick-add` (P3 proof-of-concept)

---

## Problem

Today, all interaction with OpenClaw in Clawchestra happens through a single chat drawer. The user has to:

1. **State their context explicitly** — "Can you add a roadmap item to project X in column Y to do Z" — even though they're already looking at project X in column Y.
2. **Leave their current UI** — If they're in the Git Sync dialog and need AI help resolving a conflict, they either copy-paste into the chat drawer (losing context) or use a pre-filled "Ask agent to help" link (fragile, limited).
3. **Manage one flat conversation** — Every interaction about every project, every roadmap item, every feature, every bug goes into the same conversational stream. Context gets lost. Conversations interleave.

The result: the user does work that the UI should be doing. They're translating their spatial context ("I'm looking at this project, in this view, doing this action") into natural language for every interaction, when the app already knows all of that.

## What Success Looks Like

- **AI chat components exist at multiple points in the app**, not just the drawer.
- **Each surface auto-injects its context** — the user never has to state where they are or what they're doing. The git sync surface sends git state. The roadmap-item-creation surface sends the project ID and target column. The project card surface sends the project context.
- **The general chat drawer still exists** for unscoped conversations, but it's no longer the only way to talk to OpenClaw.
- **The app teaches OpenClaw** what each action requires — adding a roadmap item, resolving a git conflict, editing a project card — so OpenClaw always knows what standards to conform to, and the user just describes what they want.
- **Context injection is invisible** — from the user's perspective, they just type what they want. The boilerplate ("please add a roadmap item to project X in column Y") becomes a button press or mouse click, and then the AI chat attached to that action knows exactly what's expected.

## Core Concept: Surface = Context Profile

Each AI surface in the app is defined by:

| Property | Description |
|----------|-------------|
| **Location** | Where in the UI this surface lives (git sync dialog, roadmap item form, project card, etc.) |
| **Session key** | OpenClaw session routing — may share a project-level session or have its own |
| **Context payload** | Auto-injected metadata: project ID, current view, action being performed, relevant files |
| **Instruction framing** | What the surface tells OpenClaw about the user's intent — "The user is creating a new roadmap item for project X in column pending" |
| **Capability scope** | What responses are expected — structured output (YAML frontmatter), free-form advice, file mutations, etc. |
| **UI form** | Inline chat bubble, sidebar panel, modal chat, embedded terminal, etc. |

### Relationship to Scoped Chat Sessions

The `scoped-chat-sessions-spec.md` established that surfaces map to OpenClaw session keys, and each session maintains independent conversation history while sharing global memory and workspace access. Distributed AI Surfaces builds on this by:

1. **Multiplying the number of surfaces** — from "one dashboard session" to N context-specific sessions
2. **Adding structured context injection** — not just "User is viewing: projects" but rich, typed context payloads per surface
3. **Defining a surface registration pattern** — so new surfaces can be added declaratively, not by hardcoding

## Surface Examples

### Git Sync — Conflict Resolution Chat
**Today:** "Ask agent to help" link opens the chat drawer with pre-filled text about the git state.
**Future:** An inline chat component appears within the Git Sync dialog itself. The user talks to OpenClaw right there, with full git state auto-injected (branch, dirty files, conflict details). Responses can include actionable buttons ("Apply this resolution", "Skip file").

### Roadmap Item Quick-Add (P3 proof-of-concept)
**Today:** Doesn't exist. User types "add a roadmap item to project X..." in the chat drawer.
**Future:** User clicks a "+" button on a project's kanban column. A card appears with an AI chat box as the primary input. The user describes what the roadmap item should cover in natural language. OpenClaw knows (from context injection) which project and which column, so the user only describes the *what*. OpenClaw structures the output into schema-compliant YAML frontmatter. Optional manual fields are exposed below for users who prefer direct editing.

### Project Card — Quick Chat
**Today:** User opens the chat drawer and says "tell me about project X."
**Future:** A small chat icon on the project card opens an inline or sidebar chat scoped to that project. OpenClaw auto-loads the project's AGENTS.md, ROADMAP.md, and recent activity. Conversation history is persisted per-project.

### Roadmap Item Detail — In-Context Chat
**Today:** User opens the chat drawer and says "let's work on deliverable Y in project X."
**Future:** Within the roadmap item detail view, there's a chat panel. OpenClaw knows the item, its spec, its plan, its status. The user just talks about the work.

## Architecture Implications

This is not a bolt-on feature. The app's interaction layer needs redesigning:

1. **Chat component library** — A reusable `<AiChat>` component that accepts a context profile and renders appropriately (inline, sidebar, modal, etc.).
2. **Context injection protocol** — A typed interface for surfaces to declare their context payload, instruction framing, and expected response format.
3. **Session management** — Multiple concurrent OpenClaw sessions, possibly at different scopes (project-level vs item-level vs action-level). Need to decide session lifecycle per scope.
4. **Response routing** — When OpenClaw responds, the response needs to route back to the correct surface/component, not just the chat drawer.
5. **State synchronization** — If a surface creates a roadmap item, the kanban board needs to reflect the change without a manual refresh.

### Session Key Strategy

Options for how surfaces map to sessions:

| Strategy | Session keys | Trade-offs |
|----------|-------------|------------|
| **Per-surface** | `agent:main:git-sync`, `agent:main:quick-add`, etc. | Maximum isolation, but many sessions = many context windows = higher cost |
| **Per-project** | `agent:main:project:{id}` | All conversations about a project share context, natural grouping |
| **Hybrid** | Project-level sessions for ongoing work, ephemeral sessions for one-shot actions (quick-add, conflict resolution) | Best balance — long-lived project context + cheap one-shot surfaces |

The hybrid approach is likely correct. The `project-conversation-hub` spec should formalize this.

## Phased Delivery

### Phase 1: Chat Component Foundation
- Extract a reusable `<AiChat>` component from the existing chat drawer
- Define the `SurfaceContext` interface (session key, context payload, instruction framing)
- The drawer becomes a special case of `<AiChat>` with the general-purpose context profile

### Phase 2: Roadmap Item Quick-Add (P3 deliverable)
- First real consumer of the component
- Proves the pattern works: button → contextual chat → structured output → UI update
- Validates context injection, response parsing, and state sync

### Phase 3: Git Sync Inline Chat
- Replaces "Ask agent to help" with an embedded chat in the sync dialog
- Tests a different surface form (inline within a modal, not a sidebar)
- Validates multi-surface concurrency (user might have the drawer open AND the sync chat)

### Phase 4: Project/Item Chat Surfaces
- Chat on project cards, chat on roadmap item detail views
- Feeds into the `project-conversation-hub` spec for thread management
- Tests the per-project session key strategy

## Non-Goals

- Replacing the general chat drawer (it stays as the unscoped, general-purpose surface)
- Per-surface agent personalities (SOUL.md is global)
- Restricting tool access per surface (agent has full workspace access everywhere)
- Building this before architecture-direction is complete

## Open Questions

1. **Response format contracts** — Should surfaces define expected response formats (e.g., quick-add expects YAML frontmatter)? Or should the agent decide?
2. **Surface discovery** — Should surfaces be registered declaratively (a manifest) or composed ad-hoc in components?
3. **Concurrent surface limits** — How many active AI surfaces can the user have open simultaneously? Performance/UX implications.
4. **Token cost** — Multiple concurrent sessions each maintain their own context window. Acceptable? Need per-session model routing?
