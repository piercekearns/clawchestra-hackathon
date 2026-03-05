# Distributed AI Surfaces

> Replace the single chat drawer as the sole AI interaction point with context-aware chat components embedded throughout the app — the UI location IS the instruction.

**Status:** Draft — deferred to post-FFR
**Created:** 2026-02-21
**Last Updated:** 2026-03-05 (scoping clarification: future expansion only)
**Roadmap Item:** `distributed-ai-surfaces`
**Depends On:** `architecture-direction` (must be delivered first), `scoped-chat-sessions` (session key foundation), `first-friend-readiness` (ships before new surfaces)
**First Consumer:** `roadmap-item-quick-add` (P3 proof-of-concept — already shipped)

---

## Scoping Note

**This roadmap item covers future AI surface expansion — creating NEW surfaces beyond what exists today.** It is deferred until after first-friend-readiness (FFR).

Three AI surfaces already exist and are fully functional:
1. **Main chat drawer** — the general-purpose chat bar
2. **Hub drawer scoped chats** — project/item-scoped OpenClaw tabs in the hub drawer
3. **Quick-add modal** — AI chat embedded in the add-roadmap-item dialog

These existing surfaces are served by `app-aware-ai-context` (Phase 1), which builds the context injection, response contracts, and behavioural guidelines for them NOW. The injection pattern is designed to be extensible — when this spec ships new surfaces post-FFR, each new surface plugs into the same formula (surface identifier + response contract + context payload) without rearchitecting.

**What this spec will deliver (post-FFR):**
- Git sync inline chat (Phase 3 below)
- Project card chat, roadmap item detail chat (Phase 4 below)
- Reusable `<AiChat>` component extraction (Phase 1 below — when a second consumer justifies generalisation)
- `SurfaceContext` interface formalisation
- Surface registration/discovery patterns

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

## Boundary with App-Aware AI Context

This spec and `app-aware-ai-context-spec.md` both identified the same gap — surfaces need response contracts, not just context injection. To avoid duplication, the boundary is:

**This spec owns:** Where surfaces exist in the UI, the `SurfaceContext` interface (session key, context payload structure, `responseContract` field), the `<AiChat>` component, session management, state sync, and surface registration.

**App-Aware AI Context owns:** The *content* of what gets injected (capability map, behavioural guidelines, dynamic state), response contracts (the values that populate `SurfaceContext.responseContract`), guided workflows, discoverability, and staleness prevention.

This spec defines *where chat lives and what shape context takes*. App-Aware AI Context defines *what the content is and how OpenClaw uses it*.

The `SurfaceContext` interface should include a `responseContract` field that app-aware context populates:

```typescript
interface SurfaceContext {
  sessionKey: string;
  contextPayload: Record<string, unknown>;
  instructionFraming: string;
  responseContract: string;  // ← populated by app-aware AI context layer
  capabilityScope: string[];
  uiForm: 'inline' | 'sidebar' | 'modal' | 'embedded';
}
```

---

## Non-Goals

- Replacing the general chat drawer (it stays as the unscoped, general-purpose surface)
- Per-surface agent personalities (SOUL.md is global)
- Restricting tool access per surface (agent has full workspace access everywhere)
- Building this before architecture-direction is complete

## Lessons from First Implementation: Roadmap Item Quick-Add

The `roadmap-item-quick-add` feature shipped (commits `439c5dc`–`42fc527`) as the first real distributed AI surface. It proves the core pattern works — and exposes what's missing.

### What Works

- **Context injection works.** The modal auto-injects project ID, target column, existing items, and schema into every message. The user just describes what they want. OpenClaw receives structured context without the user typing it.
- **Scoped interaction works.** The chat is about one thing (creating a roadmap item), not everything. The user doesn't need to say "in project X in column Y" — the surface already knows.
- **AI-structured output works.** Natural language in, schema-compliant item out. OpenClaw creates the roadmap item directly from the user's description.
- **State sync works.** The kanban board updates immediately when the item is created — no refresh needed.

### What's Missing: Surface-Aware Response Behaviour

The quick-add feature revealed that **context injection alone is not enough**. OpenClaw receives the structured context and acts on it correctly (creates the item), but its *response* doesn't match what the surface expects.

**The problem:** OpenClaw responds the same way regardless of which surface the message came from. When a user sends a message via the quick-add modal, OpenClaw's reply is verbose and unstructured — the same style it would use in the general chat drawer. But the quick-add surface is a scoped, one-shot action. The expected response is:

> "Created **Dark Mode Theme System** in the pending column — priority 4. Added tags: `ui`, `theming`. Click the card to review details."

Instead, what the user gets is a long, unformatted dump that doesn't clearly confirm what was done or how to proceed.

**What this means for the architecture:**

1. **Surfaces need response contracts.** Each surface should define not just what context to inject, but how OpenClaw should format its reply. The `SurfaceContext` interface includes a `responseContract` field for this — see Boundary with App-Aware AI Context above.

2. **This is an app-aware AI context problem.** The fix isn't in the UI — it's in how OpenClaw is prompted per-surface. The response contract content is defined by `app-aware-ai-context-spec.md` (Layer 2: Behavioural Guidelines); this spec provides the `responseContract` field in `SurfaceContext` that carries it.

3. **This pattern will repeat for every future surface.** Git sync, project card chat, item detail chat — each will need its own response contract. The `SurfaceContext` interface formalises this.

### Implication for Build Order

The original phased delivery assumed the reusable `<AiChat>` component extraction (Phase 1) would come first. In practice, we built the quick-add surface directly without extracting a shared component — and the result works. The more urgent need is **response behaviour training** (an `app-aware-ai-context` concern) rather than component abstraction. The component extraction can happen when the second surface ships (git sync inline chat) and we have two consumers to generalize from.

**Current priority:** `app-aware-ai-context` Phase 1 ships first — covering the three existing surfaces with context injection, response contracts, and behavioural guidelines. This spec's deliverables (new surfaces, component extraction) begin post-FFR, building on that foundation.

## Open Questions

1. **Response format contracts** — ~~Should surfaces define expected response formats?~~ *Resolved: yes. The `SurfaceContext.responseContract` field carries per-surface response guidance. The content of response contracts is owned by `app-aware-ai-context-spec.md`; this spec provides the structural field.*
2. **Surface discovery** — Should surfaces be registered declaratively (a manifest) or composed ad-hoc in components?
3. **Concurrent surface limits** — How many active AI surfaces can the user have open simultaneously? Performance/UX implications.
4. **Token cost** — Multiple concurrent sessions each maintain their own context window. Acceptable? Need per-session model routing?
