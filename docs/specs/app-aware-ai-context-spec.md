# App-Aware AI Context

> Make OpenClaw a contextually informed, goal-oriented guide within Clawchestra — not just a general-purpose AI that happens to be embedded, but an assistant that knows what the app can do, how users should be guided, and what the current interaction context is.

**Status:** Draft (directional — ideas and ethos, not a fixed plan)
**Created:** 2026-02-21
**Roadmap Item:** `app-aware-ai-context`

---

## Note on This Spec

This spec captures the general direction and a rich set of ideas from early design conversations. It's deliberately not deterministic — much of what's described here represents the ethos and aspiration rather than a locked-in plan. Some ideas will land as described, others will evolve, and new ones will emerge during implementation. The core principle is clear; the details remain open.

---

## The Core Idea

When a user talks to OpenClaw inside Clawchestra, OpenClaw should behave differently than when the same user talks to it via Telegram or webchat. Not a different personality — the same agent, the same memory, the same relationship — but with an additional layer of awareness:

1. **It knows what Clawchestra can do** — the features, the views, the actions, the workflows
2. **It guides users toward those capabilities** — proactively, subtly, helpfully
3. **It knows where the user currently is** — what view, what project, what action they're in the middle of
4. **It plays a role** — it's the app's AI assistant, not just a chatbot embedded in a sidebar

The effect: the user feels like OpenClaw *understands* Clawchestra. They don't need documentation. They don't need to know what commands to type. OpenClaw already knows what's possible and helps them get there conversationally.

---

## Why This Matters

Without this, OpenClaw inside Clawchestra is just OpenClaw with a different session key. It can read files and run commands, sure, but it doesn't *know* the app. It doesn't know that the user can add roadmap items, that projects have kanban boards, that there's a git sync feature, that specs follow a particular format. The user has to be the expert — they have to know what to ask for.

With this, the dynamic inverts. The app teaches OpenClaw, and OpenClaw teaches the user. A new user can say "I've got some ideas for a project" and OpenClaw responds: "Great — shall I set up a project for you? I can create a spec doc to capture those ideas, and once it's fleshed out, we can add roadmap items to plan the work." The user didn't need to know that projects have specs, or that roadmap items exist, or how any of it works. OpenClaw guided them there.

---

## Layer 1: Capability Map

### What It Is

A structured description of everything Clawchestra enables at a user level. Not the source code — the user-facing functionality. What views exist, what actions are available, what workflows are supported, what states things can be in.

### Key Nuance: Default, Not Absolute

The capability map represents what Clawchestra comes with out of the box. It is not a hard constraint on what's possible.

This matters because of the AI-native tension inherent to this application: if OpenClaw is installed on the same device as Clawchestra and has filesystem access, it can technically modify the application's source code. The user could ask OpenClaw to add a feature, change how something works, or fix a bug — and OpenClaw could do it by editing the codebase and triggering a rebuild.

This creates interesting questions:
- **The capability map is a recommended surface, not a wall.** It tells OpenClaw "here's what the user should know they can do" — but it doesn't tell OpenClaw "here's the only thing that's possible." OpenClaw should guide users toward the designed experience while remaining aware that the boundaries are soft.
- **Responsibility and trust.** If a user modifies their own instance of Clawchestra via OpenClaw, and something breaks, the responsibility model shifts. This isn't a problem to solve now, but it's a tension to be aware of as the app develops.
- **AI-native software.** The long-term possibility is that users customise their instance of Clawchestra through natural language — "I want the sidebar to also show me my calendar" — and OpenClaw makes it happen. The capability map would then evolve per-user. This is aspirational, not planned, but the architecture shouldn't preclude it.

For now: the capability map is what Clawchestra ships with. It's the starting point, not the ceiling.

### What It Contains (Indicative, Not Exhaustive)

```
Clawchestra Capability Map (v1 — draft)

Views:
- Kanban board (projects across columns: in-progress, up-next, pending, dormant, archived)
- Project detail (kanban of roadmap items for a specific project)
- Settings
- Chat drawer (OpenClaw conversation)

Project Actions:
- View project kanban board
- View project details (roadmap items, git state, scan status)
- [Future] Add new project
- [Future] Edit project metadata (name, icon, description)
- [Future] Archive/delete project

Roadmap Item Actions:
- View roadmap item detail (spec, plan, status, next action)
- Run lifecycle commands (deepen-spec, write-plan, build, review)
- [Future] Add new roadmap item (via AI chat-first quick-add)
- [Future] Edit roadmap item metadata
- [Future] Reorder priorities
- [Future] Move between columns

Git Actions:
- View git sync status (dirty files, categories)
- Commit changes (with category selection)
- [Future] Branch management
- [Future] AI-generated commit messages

Chat:
- Talk to OpenClaw (general purpose)
- [Future] Project-scoped conversations
- [Future] Roadmap-item-scoped conversations
- [Future] Coding agent sessions

Settings:
- OpenClaw connection configuration
- Theme preferences
- Scan path configuration
```

This is illustrative. The actual map would be maintained as a living document (or structured data) that evolves with each release. Items marked `[Future]` are planned but not yet built — OpenClaw should know they're coming but not suggest them prematurely.

### How It's Maintained

The capability map should live somewhere that:
- Gets updated when features ship (part of the release process)
- Is readable by OpenClaw (injected into context)
- Is human-readable (so developers can review it)

Likely location: a dedicated file in the Clawchestra project (e.g., `CAPABILITIES.md` or a structured `capabilities.yaml`) that ships with the app and gets injected into OpenClaw's context via the session preamble.

---

## Layer 2: Behavioural Guidelines

### What They Are

Instructions for how OpenClaw should behave when interacting with users within Clawchestra. Not rigid scripts — more like principles and patterns that shape OpenClaw's responses toward helping users get value from the app.

### Key Nuance: Suggestive, Not Prescriptive

The guidelines should make OpenClaw a good guide without making it feel like a pushy onboarding wizard. The user should feel like they're getting helpful suggestions, not being funnelled through a tutorial. OpenClaw is a knowledgeable friend who knows the app well, not a support bot reading from a script.

If a user wants to do something differently from the "recommended" workflow, OpenClaw should accommodate that. The guidelines describe the happy path, but OpenClaw remains flexible.

### Example Patterns (Indicative)

**User mentions a new idea:**
> "I've been thinking about building a tool that tracks my reading list"

OpenClaw might respond:
> "That sounds like a solid project. Want me to set one up for you? I can create a spec doc to capture what you're thinking — we can iterate on it, and once the shape is clear, add some roadmap items to break it into deliverables."

Not:
> "Sure! Let me create a project called 'Reading Tracker' with status 'pending' in the 'up-next' column with tags 'personal, tools'..."

The first is a guide. The second is a robot.

**User is looking at a project with no roadmap items:**

OpenClaw might notice this (via dynamic state awareness) and gently suggest:
> "This project doesn't have any roadmap items yet. If you've got a sense of what the first few pieces of work would be, I can help structure them."

**User has a roadmap item with a spec but no plan:**
> "The spec for this item looks pretty fleshed out. Want me to write a plan? That would break the spec down into implementation phases."

**User asks about something the app can do but they haven't discovered:**
> User: "Is there a way to see what files have changed in this project?"
> OpenClaw: "Yep — there's a Git Sync tab on the project view. It shows dirty files grouped by category. Want me to walk you through it?"

**User asks about something the app can't do yet:**
> User: "Can I drag projects between columns?"
> OpenClaw: "Not yet — that's on the roadmap though. Right now you'd need to update the project's status in its PROJECT.md file directly. Want me to do that for you?"

### What the Guidelines Don't Do

- **They don't replace OpenClaw's personality.** The user's SOUL.md, MEMORY.md, and existing relationship with OpenClaw take precedence. The guidelines add app-awareness on top.
- **They don't restrict OpenClaw.** If the user wants to do something outside the capability map (even modify the app itself), the guidelines don't block it. They just ensure OpenClaw naturally gravitates toward the designed experience first.
- **They don't create a rigid flow.** There's no "step 1, step 2, step 3" that every user must follow. Different users will use the app differently, and OpenClaw should adapt.

---

## Layer 3: Dynamic State Awareness

### What It Is

OpenClaw knows not just that it's inside Clawchestra, but what the user is currently doing in Clawchestra. What view they're on, what project they're looking at, what action they just performed.

### What's Easy vs. Hard

Some state is naturally available because it comes through the interaction surface:

| State | How It's Known | Difficulty |
|-------|---------------|-----------|
| **Which surface the message came from** | Session key / surface metadata on each message | Easy — already partially implemented ("User is viewing: X") |
| **Which project is selected** | App sends project context with messages from project views | Easy — extend existing context injection |
| **Which roadmap item is open** | App sends item context with messages from item views | Easy — same mechanism |
| **What action the user is performing** | Distributed AI surfaces auto-inject action context (e.g., "adding a roadmap item") | Medium — depends on distributed-ai-surfaces being built |
| **What tab is open (settings, git sync, etc.)** | App would need to broadcast view state changes to the chat context | Medium — needs an event bridge from app state to chat context |
| **What the user just clicked** | Fine-grained UI event tracking | Hard — and possibly unnecessary/creepy |
| **What the user is looking at (scroll position, visible cards)** | Viewport tracking | Hard — and almost certainly unnecessary |

### Practical Starting Point

Start with what's easy and high-value:
1. **Surface context** — "This message is from the Clawchestra chat drawer" (already exists)
2. **Project context** — "The user is viewing project X" (extend existing "User is viewing:" pattern)
3. **Item context** — "The user is looking at roadmap item Y in project X" (same mechanism)
4. **Action context** — "The user is creating a new roadmap item for project X" (comes naturally with distributed AI surfaces)

Defer fine-grained state tracking until there's a clear need. The user can always tell OpenClaw what they're looking at if the context isn't automatically available.

### Architectural Implication

Dynamic state awareness requires an event bridge from Clawchestra's UI state to the OpenClaw chat context. This could be:

- **Message-level injection** — Each message from Clawchestra includes a structured context payload (current view, selected project/item, active action). Simple, already partially done.
- **Session-level state** — Clawchestra maintains a "current state" object that OpenClaw can query or that gets injected into the session preamble. More complex but richer.
- **Reactive events** — Clawchestra emits state change events that update OpenClaw's context in real-time (e.g., user navigates from project A to project B → OpenClaw's context updates). Most complex, probably overkill for v1.

Message-level injection is the pragmatic choice. It's already partially working and extends naturally.

---

## Layer 4: Guided Workflow Patterns

### What They Are

Specific interaction patterns for common tasks that help users get value from Clawchestra without needing to discover features on their own. These aren't rigid scripts — they're templates for the kinds of interactions OpenClaw should facilitate.

### Example Patterns (Illustrative)

**New project creation flow:**
1. User describes an idea
2. OpenClaw offers to create a project
3. OpenClaw suggests a name, proposes creating a spec doc
4. User and OpenClaw iterate on the spec via conversation
5. OpenClaw offers to add roadmap items once the spec is solid
6. User approves, OpenClaw creates the roadmap items with proper schema

**Roadmap item progression:**
1. OpenClaw notices an item has a spec but no plan → suggests writing one
2. Plan is written → OpenClaw suggests reviewing it or moving to implementation
3. Implementation happens (via coding agent or OpenClaw) → OpenClaw suggests marking complete
4. Item completed → OpenClaw updates status, suggests what's next

**Stuck/confused user:**
1. User sends a vague message like "I don't know what to do next"
2. OpenClaw looks at the project state — what items are in-progress, what's blocked, what's ready
3. Suggests a concrete next action: "Your git-sync spec is ready for a plan. Want me to write one?"

**Discovery assistance:**
1. User tries to do something that Clawchestra supports but they don't know about
2. OpenClaw points them to the feature and offers to help use it

These patterns should be documented as examples in the behavioural guidelines, not as hardcoded interaction flows.

---

## Layer 5: Injection Mechanism

### How It Gets to OpenClaw

The most natural mechanism: a Clawchestra-specific AGENTS.md (or equivalent) that gets loaded into OpenClaw's context whenever it's interacting with a user via Clawchestra.

### What Gets Injected

1. **Capability map** — "Here's what Clawchestra can do" (Layer 1)
2. **Behavioural guidelines** — "Here's how you should help users within Clawchestra" (Layer 2)
3. **Dynamic state** — "Here's what the user is currently doing" (Layer 3, per-message)
4. **Project context** — AGENTS.md, ROADMAP.md, etc. for the selected project (already partially done)

### When It Gets Injected

- **On session start** — Full context load (capability map, guidelines, current state)
- **After compaction** — Re-inject the context so OpenClaw doesn't lose awareness of where it is
- **Per-message** — Dynamic state updates (current view, selected project/item)

### Possible Implementation: Clawchestra as a Skill

One approach: package the capability map and behavioural guidelines as an OpenClaw skill. When OpenClaw detects it's in a Clawchestra session (via session key prefix or surface metadata), it loads the skill automatically.

This would mean:
- The skill ships with Clawchestra (or is installed alongside it)
- It contains the AGENTS.md-style context file with capabilities and guidelines
- It gets loaded into the system prompt for Clawchestra sessions
- It survives compaction (skills are re-injected after compaction)
- It can be versioned alongside the app (capability map updates when features ship)

### Possible Implementation: Enhanced Session Preamble

Alternative: Clawchestra injects a structured preamble into each session that includes everything OpenClaw needs to know. This extends the existing "User is viewing: X" pattern into a richer context payload.

Both approaches achieve the same thing. The skill approach is more self-contained; the preamble approach is more dynamic.

---

## What This Enables Long-Term

### Docs-Free Onboarding

A new user installs Clawchestra, connects OpenClaw, and starts chatting. OpenClaw already knows the app. No tutorial needed, no documentation to read. The user says what they want to do, and OpenClaw helps them do it using the app's features.

### Evolving Capability Awareness

As features ship, the capability map updates. OpenClaw immediately knows about new features and can suggest them to users. The app's AI assistant is always up-to-date without the user needing to read changelogs.

### Per-User Adaptation

Over time, OpenClaw learns how this particular user uses Clawchestra. Maybe they never use the git sync feature — OpenClaw stops suggesting it. Maybe they always want specs before plans — OpenClaw adapts its workflow suggestions. The behavioural guidelines are starting points; OpenClaw's actual behaviour evolves with the user.

### AI-Native Software (Aspirational)

The furthest extension of this idea: users customise their instance of Clawchestra through conversation with OpenClaw. "I want a dark mode", "Can you add a column for 'blocked' items?", "I'd like the sidebar to show recent git commits." OpenClaw, having access to the source code, makes it happen. The capability map becomes per-user and dynamic.

This is aspirational territory — significant trust, safety, and responsibility questions need answering before it's practical. But the architecture (capability map as a living document, OpenClaw as the interface layer) doesn't preclude it.

---

## Relationship to Other Specs

- **`scoped-chat-sessions-spec.md`** — Established session isolation and surface profiles (Phase 4/5). This spec extends surface profiles into a full app-awareness layer.
- **`distributed-ai-surfaces-spec.md`** — Distributed surfaces provide the UI locations where context is auto-injected. This spec defines *what* gets injected (capability map, guidelines, state) and *how OpenClaw should behave* with that context.
- **`roadmap-item-quick-add-spec.md`** — Quick-add is one of the first features where this spec's ideas materialise: OpenClaw knows the user is adding a roadmap item, knows the schema, knows the project, and guides the user through it.
- **`embedded-agent-terminals-spec.md`** — When coding agent sessions exist, the capability map and guidelines need to cover them (when to suggest opening one, how to help the user set up context, etc.).

## Open Questions

1. **How prescriptive should the guidelines be?** Too vague and OpenClaw doesn't change behaviour. Too specific and it feels scripted. Where's the sweet spot?
2. **Skill vs. preamble?** Which injection mechanism is more maintainable and reliable?
3. **How do we measure success?** How do we know if OpenClaw is actually being a better guide within Clawchestra vs. generic chat? User feedback? Usage patterns? Task completion rates?
4. **Compaction resilience.** How do we ensure the context survives compaction reliably? Skills are re-injected, but are they re-injected in full? Does the capability map fit within context limits?
5. **User-modified instances.** If users start modifying their Clawchestra instance via OpenClaw, how does the capability map stay accurate? Does it need to be auto-generated from the codebase?
