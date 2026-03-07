# Native Agent Sessions

> Make the conversation hub capable of hosting native, non-terminal coding sessions, starting with Codex, while keeping OpenClaw as Clawchestra's project brain and context plane.

## Summary

Clawchestra already has two strong execution surfaces inside the hub: scoped OpenClaw chats and embedded terminal sessions. The next step is not a new area of the app, but a new session kind inside the same hub drawer: a native structured coding session that is neither an OpenClaw chat nor a terminal emulator. Codex is the first target because it already exposes an official `app-server` protocol with threads, turns, items, approvals, and rollback, making a high-quality native integration feasible today.

This feature does not reposition Clawchestra as a general-purpose model harness or ACP orchestrator. OpenClaw remains the context plane and project assistant for the app: it knows tracked projects, roadmap priorities, specs, plans, and user intent. Native agent sessions are an execution surface within Clawchestra that the user can drive directly when they want a better-than-terminal coding experience, while still allowing OpenClaw to stay informed about what happened around the project.

---

**Roadmap Item:** `native-agent-sessions`
**Status:** Draft
**Created:** 2026-03-07
**Depends On:** `project-conversation-hub`, `embedded-agent-terminals`
**Related:** `project-diff-viewer`, `terminal-context-preamble`

---

## Problem

Clawchestra currently has a hard split in the hub drawer:

1. OpenClaw chat sessions render as message-first chat UIs.
2. Direct coding sessions render as terminal emulators.

That split is good enough for terminal-backed workflows, but it leaves a large gap between Clawchestra and the best dedicated coding-agent experiences:

1. **Terminal embedding is not the same as native integration.** Codex and similar tools can expose structured concepts such as approvals, work items, file changes, rollback, and session lifecycle. A terminal pane hides that structure behind text.
2. **The drawer currently branches on implementation detail instead of session type.** A native Codex session is neither "just another chat" nor "just another terminal." The hub needs a richer concept than those two buckets.
3. **Users still reach for external apps when they want the best coding UX.** Even when Clawchestra's planning and project visibility are superior, the direct coding surface feels weaker than Codex Desktop, T3 Chat, or a good terminal-native experience.
4. **OpenClaw remains central to the app, but direct work outside OpenClaw still matters.** Users want OpenClaw to remain aware of project progress, changed files, and implementation outcomes without requiring OpenClaw to mediate every coding interaction.
5. **A partial, demo-quality native session would be worse than staying terminal-only.** This is only worth shipping if it feels robust, durable, and native enough that users trust it for real work.

## Product Positioning

This spec is intentionally opinionated about what Clawchestra is and is not.

### What Clawchestra is

- A project-aware AI workspace.
- The place where planning, roadmap state, project context, and execution surfaces meet.
- A better UI shell for OpenClaw plus direct coding tools.
- A user-driven workspace where the person can choose when to work through OpenClaw and when to drive a coding harness more directly.

### What Clawchestra is not

- A replacement for OpenClaw as project brain and app assistant.
- A new provider-agnostic model harness competing with OpenCode.
- A broad ACP-first orchestrator for every external coding tool.
- A requirement that all future coding tools become native before they are useful in the app.

## Desired Outcome

The target experience is:

- The user opens a project or roadmap-item session in the same hub drawer they already use today.
- They choose between OpenClaw chat, terminal session, or native Codex session using the same hub scaffolding.
- A native Codex session feels like a first-class coding surface rather than a disguised terminal.
- OpenClaw remains aware of the project context and can benefit from what happened in that direct session.
- The user increasingly feels that Clawchestra is the best place to build, not just the best place to plan.

## Core Model

This feature introduces a clearer separation between three layers.

### 1. Context plane

OpenClaw remains the context plane for Clawchestra:

- tracked projects
- roadmap state
- specs and plans
- project-aware guidance
- orchestration help when the user wants it

OpenClaw should stay informed about what is happening around a project even when the user is driving a direct coding session.

### 2. Session plane

The hub hosts multiple execution surfaces:

- `openclaw-chat`
- `terminal-session`
- `codex-native-session`

Future session kinds may exist, but the system should not be built around speculative provider proliferation.

### 3. Presentation plane

The hub sidebar, drawer, tabs, thread grouping, project linkage, unread state, and roadmap-item association remain unified. What changes is the renderer inside the drawer: each session kind gets the content surface it needs.

## Session Renderer Architecture

Today the drawer effectively chooses between two renderer paths:

- OpenClaw chat UI
- terminal shell UI

The required shift is:

- treat hub entries as sessions first
- choose the content renderer based on session kind

This keeps the current spatial model intact:

- same thread list in the sidebar
- same secondary drawer
- same project and roadmap-item association
- same tab and pairing concepts where useful

What changes is only the renderer in the content pane.

### Required session kinds

| Session kind | Renderer | Primary use |
|--------------|----------|-------------|
| `openclaw-chat` | message-first chat | planning, assistant guidance, project-aware discussion |
| `terminal-session` | PTY/xterm | tools without native protocols, shell-first workflows |
| `codex-native-session` | structured timeline/work surface | high-quality direct coding with Codex |

This is not a demand for a large abstraction framework. It is a practical generalization of the hub so that one drawer can host more than chat bubbles and terminals.

## Why Codex First

Codex is the first native target because:

- OpenAI ships an official `codex app-server` protocol for rich clients.
- That protocol already exposes the primitives a native UI needs: threads, turns, items, approvals, user-input requests, rollback, interruption, and notifications.
- T3 Chat has already validated that this protocol can power a significantly better-than-terminal experience.
- Codex is a tool the project owner already reaches for enough that the payoff is immediate.

Claude Code and other tools may later gain comparable protocols or ACP adapters, but this spec does not block on that ecosystem maturing.

## Native-Ready Release Bar

This should not be framed as a thin MVP. It should be framed as the minimum bar for a native session to feel trustworthy.

The first release of a native Codex session should include:

1. **Durable session lifecycle**
   - create session
   - resume session
   - persist session identity
   - reconnect after app or drawer interruption

2. **Real conversation control**
   - send turn
   - stream assistant output
   - interrupt running turn
   - rollback the latest turn(s)

3. **Structured activity visibility**
   - assistant/user messages
   - work/activity entries derived from Codex items
   - clear turn status and current phase
   - explicit waiting states when approvals or user input are needed

4. **Approvals and user prompts**
   - render pending approvals clearly
   - render tool/user-input prompts clearly
   - route user responses back into the active session

5. **Changed-file visibility**
   - show that files changed
   - show which files changed
   - associate file changes with turns or activity entries when possible
   - provide actions to open files or existing diff surfaces

6. **Hub integration**
   - project association
   - roadmap-item association
   - title and last-activity handling
   - unread or attention state where meaningful

7. **OpenClaw awareness**
   - enough metadata, summaries, or state linkage that OpenClaw can stay productively aware of what happened in the project

8. **Long-session robustness**
   - capped histories where needed
   - virtualization for long timelines
   - graceful recovery from transport errors
   - no obvious degradation during long coding sessions

If this bar cannot be met, the terminal experience remains the better product.

## Changed-File Visibility vs Full Diff Review

This spec deliberately separates change visibility from full inline diff review.

### Required in the first native Codex release

- a clear indication that files changed
- a file list or change summary attached to relevant turns
- actions to open changed files
- actions to jump to an existing project diff surface when available

### Not required on day one

- a full embedded side-by-side diff review surface inside the Codex session pane

The separate `project-diff-viewer` item remains the right place to design a richer cross-project diff experience. Native Codex sessions should integrate with that future work, not be blocked by it.

## Internal Architecture

The native session path needs a clearer internal model than the current "chat or terminal" split.

### Provider adapter

A provider-specific adapter translates raw provider events into Clawchestra's own internal concepts.

For Codex, that means translating `app-server` notifications and requests into stable Clawchestra events such as:

- message added
- activity started
- activity completed
- approval requested
- approval resolved
- file change observed
- user input requested
- turn completed

### Canonical runtime events

Clawchestra should define a provider-neutral internal event vocabulary for sessions. It does not need to be fully universal on day one, but it must be stable enough that:

- OpenClaw chat sessions can map into it partially
- terminal sessions can map into it partially
- native Codex sessions can map into it richly

### Projected read model

The UI should not derive everything ad hoc from raw provider traffic. It should read from a session-oriented projection that supports:

- current messages
- visible activity timeline
- pending approvals
- pending user prompts
- changed files
- session status
- metadata required for the hub list

This is the architectural move that makes the drawer capable of hosting multiple native-quality session types cleanly.

## OpenClaw's Role

OpenClaw stays fundamentally involved in the app even when the user is not currently in an OpenClaw chat bubble.

### OpenClaw should continue to own

- project and roadmap understanding
- context-aware advice
- planning, spec, and workflow guidance
- orchestration when the user wants to delegate through OpenClaw

### Native sessions should still feed OpenClaw indirectly

Clawchestra should preserve enough information that OpenClaw can be meaningfully aware of direct coding work, for example:

- which project or item the session belonged to
- whether the session is active, interrupted, or complete
- which files changed
- lightweight summaries or handoff notes where appropriate
- the existence of direct work that should influence next recommendations

This does not require OpenClaw to mediate the transport for every native session. It only requires Clawchestra to treat those sessions as first-class project activity rather than isolated tools.

## ACP Stance

ACP matters here, but mostly as an OpenClaw-side capability and a future interoperability option, not as the primary implementation mechanism for this item.

### This spec does not require

- Clawchestra becoming a broad ACP client for many agent ecosystems.
- Clawchestra becoming its own multi-agent orchestrator.

### This spec does assume

- OpenClaw may increasingly use ACP to delegate work to external coding harnesses more efficiently than terminal scraping.
- Clawchestra should be able to benefit from that on the OpenClaw side when OpenClaw exposes useful state or telemetry.
- Native Codex sessions can proceed independently because Codex already has a strong direct protocol today.

In short: ACP is strategically relevant, but the first implementation should be codex-first and hub-native rather than ACP-first and ecosystem-wide.

## UI Concept

The spatial model remains the current conversation hub model:

- thread list in the sidebar
- active session in the secondary drawer
- session opened from the same project and roadmap-item entry points

### Native Codex session content

The native Codex renderer should feel closer to a structured work timeline than to a terminal:

- streaming messages
- activity log / work log
- pending approvals and prompts
- change summaries
- clear active/completed/interrupted states
- session controls for interrupt and rollback

The renderer should not mimic a chat app when the underlying session is doing structured coding work. At the same time, it should not introduce a wholly separate navigation paradigm. It lives inside the same drawer, with the same hub affordances, but uses a different content treatment.

## Data Model Direction

The current hub data model distinguishes mainly between OpenClaw chats and terminal chats. This spec requires a broader session model.

At a minimum, hub state should evolve to support:

- stable session kind
- stable external session identity where relevant
- project id
- roadmap item id
- title
- last activity
- status
- attention state
- renderer-specific metadata

This may mean evolving existing chat types into a more explicit session-kind model rather than overloading the current `chat.type` split.

## Performance Expectations

Because native sessions can run long and produce large histories, performance must be designed in from the start.

Required characteristics:

- virtualized long timelines
- capped derived views where appropriate
- cheap hub-list summaries
- controlled rendering for syntax-heavy or change-heavy content
- explicit recovery from reconnects and stale sessions

T3 Chat's use of projection caps, virtualization, and worker-backed diff work is a useful reference point for this quality bar even if the exact implementation differs.

## Delivery Sequence

### Phase 1: Session-model groundwork

- introduce a clearer session-kind model in the hub
- decouple drawer rendering from the simple chat-vs-terminal branch
- define canonical session events and projected read model shape

### Phase 2: Codex backend integration

- add a Codex adapter speaking `codex app-server`
- support create, resume, send, interrupt, rollback
- map native protocol events into the canonical session model

### Phase 3: Codex native renderer

- build the native session UI in the existing drawer
- render messages, activity timeline, approvals, prompts, and changed-file summaries
- persist hub metadata and session resume state cleanly

### Phase 4: OpenClaw awareness and handoff

- expose enough metadata, summaries, or status to keep OpenClaw project-aware
- ensure roadmap and project context can benefit from direct session outcomes

### Phase 5: Richer change review integration

- connect native session change summaries to the project diff surface
- optionally add more inline diff review where it serves the direct coding flow

## Non-Goals

- Replacing OpenClaw with a native provider switchboard
- Blocking progress on a general ACP abstraction before shipping Codex
- Removing embedded terminals as a supported path
- Building a perfect provider-neutral abstraction for agents that do not yet expose strong native protocols
- Shipping a full diff-review workstation inside the first native session release

## Success Criteria

This item is successful when:

- users can open a native Codex session from the hub in the same drawer they already use
- that session feels clearly better than a terminal embed for real coding work
- OpenClaw remains central to project awareness rather than sidelined
- the user no longer feels a strong need to leave Clawchestra to get a high-quality direct Codex experience
- the architecture sets up future native session types without requiring the app to become a full agent harness

## Open Questions

1. How should changed-file summaries be presented before the dedicated diff viewer is ready?
2. What is the minimum useful handoff signal back into OpenClaw: file list, summary note, session transcript summary, or some combination?
3. Should native Codex sessions appear as peers to terminal sessions within existing pairing UX, or should pairing evolve into a more generic "related sessions" concept?
4. How much native session state should persist locally versus being rehydrated from the provider on resume?
5. Which controls belong in the drawer header versus inside the structured session timeline?
