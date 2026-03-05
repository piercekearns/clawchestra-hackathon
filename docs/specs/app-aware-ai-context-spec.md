# App-Aware AI Context

> Make OpenClaw a contextually informed, goal-oriented guide within Clawchestra — not just a general-purpose AI that happens to be embedded, but an assistant that knows what the app can do, how users should be guided, and what the current interaction context is.

**Status:** Draft (directional — ideas and ethos, not a fixed plan)
**Created:** 2026-02-21
**Last Updated:** 2026-03-05 (boundary clarification with distributed-ai-surfaces, staleness prevention, user-vs-developer context, concrete injection format)
**Roadmap Item:** `app-aware-ai-context`
**Design Principles:** `docs/DESIGN_PRINCIPLES.md` (dual surface, discoverability, stakes/reversibility, parity)
**Foundational Reading:** [Agent-Native Architectures](https://every.to/guides/agent-native), [Lessons From Four Apps](https://every.to/source-code/how-to-build-agent-native-lessons-from-four-apps)

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

### Dual-Surface Parity Matrix (Indicative, Not Exhaustive)

The capability map tracks not just "what can the user do" but also whether each capability has both a UI surface and an AI surface, and which is primary. See `docs/DESIGN_PRINCIPLES.md` Principle 1 (Dual Surface) and Principle 6 (Capability Parity).

```
| Capability                    | UI Surface          | AI Surface              | Primary | Parity |
|-------------------------------|---------------------|-------------------------|---------|--------|
| View project kanban           | Kanban board        | "Show me project X"     | UI      | ✅     |
| View roadmap item detail      | Item detail panel   | "What's the status of Y"| UI      | ✅     |
| Run lifecycle command         | Action bar buttons  | "Deepen the spec for Y" | Both    | ✅     |
| Commit git changes            | Git sync dialog     | "Commit my work"        | UI      | ✅     |
| Add new project               | [not built]         | "Set up a project"      | AI      | ⚠️ UI  |
| Add new roadmap item          | [not built]         | "Add an item for..."    | AI      | ⚠️ UI  |
| Edit project metadata         | [not built]         | "Rename project to..."  | UI      | ⚠️ UI  |
| Edit roadmap item metadata    | [not built]         | "Change priority to 2"  | UI      | ⚠️ UI  |
| Change colour theme           | [not built]         | "Make it darker"        | UI      | ⚠️ UI  |
| Reorder roadmap priorities    | [not built]         | "Move X above Y"        | UI      | ⚠️ Both|
| Branch management             | [not built]         | [not built]             | UI      | ❌     |
| Project-scoped conversations  | [not built]         | [not built]             | Both    | ❌     |
| Open coding agent session     | [not built]         | [not built]             | UI      | ❌     |
```

This is illustrative. The actual matrix would be maintained as a living document that evolves with each release. Items marked `[not built]` are planned — OpenClaw should know they're coming but not suggest them prematurely.

**The parity discipline:** When shipping any feature, update this matrix. Verify both surfaces exist. Identify the primary. If one surface is missing, flag it.

**The dual-surface question for every feature:** Is it faster/better to do this manually or via AI? The answer determines the primary surface. The other surface still exists.

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

## Layer 2b: Early Discoverability (Onboarding)

Users should be primed from their first interaction to understand Clawchestra's dual nature: UI for structured actions, AI for everything else, both always available.

### Mechanisms (Ideas, Not Commitments)

- **First-run capability hints** — On first launch (or first launch after OpenClaw is connected), subtle cues that communicate: "You can do things with the UI. You can also ask AI to do anything the UI can do. And AI can do things beyond the UI too." Not a rigid step-by-step tutorial — something that sets expectations without patronising.

- **Loading/splash capability rotation** — Brief, rotating hints on the loading screen: "Did you know? You can change the colour scheme just by asking." / "Type /? to see what OpenClaw can help with." / "Talk to me and we'll set up a new project together." These cycle through different capabilities, seeding awareness over time.

- **Discovery commands** — `/help`, `/?`, or similar in the chat that surfaces capability categories conversationally. Not a docs page — a starting point for exploration. OpenClaw responds with grouped capabilities: "Here's what I can help with in Clawchestra: **Projects** (create, edit, archive), **Roadmap** (add items, write specs, plan work), **Git** (commit, sync, resolve conflicts), **Customisation** (themes, layouts), **or just ask me anything.**"

- **Contextual AI hints on UI elements** — When a user interacts with a UI element for the first time, a subtle indicator shows the AI alternative: "You can also ask OpenClaw to do this." Shown once per element, not repeatedly. Teaches the user that every UI action has an AI equivalent.

- **In-chat progressive revelation** — When a user asks OpenClaw for something simple, OpenClaw occasionally reveals depth: "Done — I've added the roadmap item. By the way, I can also write a spec for it if you describe what the feature should do." This surfaces capability at the moment it's relevant.

### The Goal

By the end of the first session, the user should understand three things:
1. The UI does what they expect — click things, see results
2. OpenClaw can do everything the UI can do, plus more
3. They can explore freely — things are safe to try, easy to undo

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
- **`distributed-ai-surfaces-spec.md`** — Distributed surfaces provide the UI locations where context is auto-injected. This spec defines *what* gets injected (capability map, guidelines, state) and *how OpenClaw should behave* with that context. See Boundary Clarification below.
- **`roadmap-item-quick-add-spec.md`** — Quick-add is one of the first features where this spec's ideas materialise: OpenClaw knows the user is adding a roadmap item, knows the schema, knows the project, and guides the user through it.
- **`embedded-agent-terminals-spec.md`** — When coding agent sessions exist, the capability map and guidelines need to cover them (when to suggest opening one, how to help the user set up context, etc.).

### Boundary Clarification: This Spec vs. Distributed AI Surfaces

Both specs converge on the same insight — that context injection alone isn't enough; surfaces need response contracts. To avoid duplication:

**Distributed AI Surfaces owns:**
- Where surfaces exist in the UI (locations, forms, lifecycle)
- The `SurfaceContext` interface (session key, context payload structure, `responseContract` field)
- The reusable `<AiChat>` component pattern
- Session management (per-project, per-surface, hybrid)
- State sync (surface creates item → UI updates)
- Surface registration/discovery

**This spec (App-Aware AI Context) owns:**
- The **content** of what gets injected into any surface (capability map, behavioural guidelines, dynamic state)
- **Response contracts** — how OpenClaw should behave per-surface (the values that populate `SurfaceContext.responseContract`)
- The capability map itself (`CAPABILITIES.md`)
- Guided workflow patterns and discoverability
- The staleness prevention mechanism (see below)
- The user-vs-developer context separation

The boundary: Distributed AI Surfaces defines *where chat lives and what shape context takes*. This spec defines *what the content of that context is and how OpenClaw should use it*.

## Agent-Native Principles (From Industry Research)

This spec is informed by the emerging "agent-native" architecture pattern, particularly as described in Every.to's [Agent-Native Architectures guide](https://every.to/guides/agent-native) and [Lessons From Four Apps](https://every.to/source-code/how-to-build-agent-native-lessons-from-four-apps).

### Key Principles Applied to Clawchestra

1. **Parity** — Whatever the user can do through UI, the agent should be able to achieve. The dual-surface parity matrix above is the mechanism for ensuring this.

2. **Granularity** — OpenClaw's tools are atomic primitives (read, write, exec). Features are outcomes achieved by composing those tools. The "logic" lives in prompts/skills, not hardcoded functions.

3. **Composability** — With atomic tools and parity, new features can be created by writing new prompts or skills. Users could bring their own workflow descriptions.

4. **Emergent capability** — The agent can accomplish things we didn't explicitly design for. If a user asks "cross-reference my two most active projects and suggest which roadmap items might conflict," we didn't build that feature — but OpenClaw can compose tools to achieve it.

5. **Improvement over time** — Context accumulates (MEMORY.md), prompts/skills refine, the capability map evolves based on what users actually do.

### The Agent-Native Balance

Clawchestra is NOT purely agent-native. The dual-surface principle means we consciously choose when to build deterministic UI and when to rely on agent-driven outcomes. Pure agent-native (everything goes through the AI) creates problems:

- **Speed:** Clicking a colour picker is faster than typing "change background to white" and waiting for AI processing.
- **Cost:** Every AI interaction burns tokens. Manual UI interactions are free.
- **Determinism:** UI actions always produce the same result. AI actions have non-zero error rates.
- **Discovery:** A blank chat box says "you can do anything" — which often means users do nothing. UI affordances teach what's possible.

The balance: build the minimum deterministic UI needed for common, simple, speed-sensitive interactions. Put the intelligence in skills/prompts for complex, creative, judgment-requiring interactions. Both paths always available. See `docs/DESIGN_PRINCIPLES.md` for the full framework.

### Skills as the Feature Layer

Behaviours that would traditionally be coded logic can instead be **skills** — text files that describe how to handle specific tasks (inspired by Cora's approach). For Clawchestra:

- "How to add a roadmap item" → a skill describing the schema, the workflow, the validation
- "How to set up a new project from an idea" → a guided workflow as a skill
- "How the user likes their specs structured" → a user-customisable skill

Skills are inspectable, versionable, editable by developers AND users, and don't require code changes to update. They bridge the behavioural guidelines (Layer 2) and the injection mechanism (Layer 5).

### Latent Demand Discovery (With Discoverability Caveat)

Observe what users ask OpenClaw to do within Clawchestra. Patterns reveal what to build next. But: latent demand only reveals itself if users know what's possible. Discoverability (Layer 2b) is a prerequisite for demand discovery. You can't observe demand for capabilities users don't know they can ask for.

**The cycle:** Discoverability → Users try things → Demand revealed → Features formalised → More discoverability.

---

## Lessons from First Distributed AI Surface: Roadmap Item Quick-Add

The `roadmap-item-quick-add` feature (commits `439c5dc`–`42fc527`) is the first distributed AI surface — an AI chat component embedded outside the general chat drawer. Building it revealed a concrete gap that this spec needs to address.

### The Gap: OpenClaw Doesn't Know How to Respond Per-Surface

The quick-add modal injects structured context into every message: project ID, target column, existing items, schema, and an instruction to create the item immediately. OpenClaw *acts* correctly — it creates the item. But its *response* is wrong for the surface:

- **What the user expects:** A brief, tidy confirmation — "Created **Dark Mode Theme System** in pending (priority 4)."
- **What OpenClaw returns:** A verbose, unstructured dump — the same style it would use in the general chat drawer, as if it's having a full conversation rather than confirming a scoped action.

This is exactly the kind of problem this spec's Layer 2 (Behavioural Guidelines) and Layer 3 (Dynamic State Awareness) are designed to solve. The quick-add experience proves that:

1. **Context injection tells OpenClaw WHAT to do** — this works today.
2. **Nothing tells OpenClaw HOW to respond based on the surface** — this is missing.

### What Needs to Happen

**Surface-specific response contracts** — part of the capability map or behavioural guidelines — that teach OpenClaw how to behave differently depending on where the message came from:

| Surface | Expected Response Style |
|---------|------------------------|
| General chat drawer | Conversational, detailed, markdown-rich |
| Roadmap item quick-add | Brief confirmation + summary (1–3 sentences), structured |
| Git sync inline chat | Actionable options, resolution-focused |
| Project card chat | Context-aware, project-scoped, medium depth |
| Roadmap item detail chat | Item-scoped, spec/plan-aware, workflow-suggestive |

This could be implemented as:
- **Per-surface instruction blocks** in the context injection — "When responding from this surface, keep replies under 3 sentences and confirm what was created."
- **A surface-awareness skill** — a skill that teaches OpenClaw the different surfaces, their purposes, and the expected interaction style for each.
- **Enhanced behavioural guidelines** — Layer 2 guidelines that include surface-specific response patterns, not just general "be helpful" principles.

### Priority Implication

This finding elevates the urgency of this deliverable. The distributed AI surfaces architecture is working mechanically (context injection, state sync, scoped chat), but the user experience is undermined by OpenClaw not adapting its response style. Every new surface that ships will have the same problem until OpenClaw has surface-aware behavioural guidelines.

The minimum viable version of this spec's deliverable could be: **per-surface response format guidance injected alongside the context payload.** This is a pragmatic first step that doesn't require the full capability map or skill system — just extending the existing context injection with a `responseFormat` field.

### Updated Dual-Surface Parity Matrix

```
| Capability                    | UI Surface          | AI Surface              | Primary | Parity |
|-------------------------------|---------------------|-------------------------|---------|--------|
| Add new roadmap item          | Quick-add modal     | "Add an item for..."    | Both    | ✅     |
```

The `Add new roadmap item` row can be updated from `[not built] / ⚠️ UI` to `Both / ✅` — the quick-add modal provides the UI surface, and the AI chat within it provides the AI surface. Both exist and work.

## Layer 6: Staleness Prevention

### The Problem

A static `CAPABILITIES.md` rots the moment a feature ships and nobody updates it. Because this file is **runtime context injected into OpenClaw**, staleness isn't just bad documentation — it's wrong behaviour. OpenClaw will suggest features that don't exist, miss features that do, or give guidance that contradicts the current UI.

### The Mechanism: Agent Compliance Rule

AGENTS.md Hard Rule 5 now requires:

> **When shipping a feature that adds, changes, or removes a user-facing capability or AI surface:** Update `CAPABILITIES.md` to reflect the change.

This is enforced the same way `nextAction` sync is enforced — as a compliance rule that agents check after every code change. The Rule Zero checklist in AGENTS.md now includes: *"Does this add, change, or remove a user-facing capability or AI surface?"* If yes → update `CAPABILITIES.md`.

### Why This Works

The pattern is already proven. Agents reliably update `nextAction` in state.json after work because it's a hard rule with a clear trigger. CAPABILITIES.md uses the same trigger ("did I add/change/remove a capability?") and the same enforcement ("update the file before considering the work complete").

### Future: Structural Verification

For additional safety, a CI lint step could verify that PRs touching UI components or context injection also modify CAPABILITIES.md. This is heavier machinery and not needed initially — the compliance rule is sufficient to start.

---

## Layer 7: User Context vs. Developer Context

### The Problem

Clawchestra currently injects `AGENTS.md` into OpenClaw sessions for scoped chats. This file is the **developer's** operations reference — it describes how to edit `state.json`, what the compliance block is, internal schema details, etc. When other users plug their own OpenClaw into their own Clawchestra, their OpenClaw receives instructions intended for the developer, not the user.

### The Separation

Two distinct layers of context, injected independently:

**Shipped context (all users):** `CAPABILITIES.md`
- What the app can do (features, views, actions, workflows)
- How OpenClaw should behave in each surface (response contracts)
- What the user can ask for and how they'll be guided
- Ships with the app binary; updated when features ship

**Developer context (instance owner only):** `AGENTS.md`
- How to edit state.json, create projects, manage roadmap items
- Schema constraints, priority rules, file structure
- Build commands, compliance rules
- Only relevant when OpenClaw is operating on the Clawchestra codebase itself

### How This Affects Injection

The context injection mechanism (`hub-context.ts`) should:
1. **Always inject** `CAPABILITIES.md` — this is what makes OpenClaw app-aware for any user
2. **Conditionally inject** `AGENTS.md` — only when the scoped chat is for a project that IS Clawchestra (detected by project directory matching the app's own repo)
3. **Never inject** developer context for non-developer users — their OpenClaw should know what the app does, not how it's built

### What CAPABILITIES.md Contains (vs. AGENTS.md)

| Content | CAPABILITIES.md | AGENTS.md |
|---------|----------------|-----------|
| "User can add roadmap items" | ✅ | — |
| "How to edit state.json to add items" | — | ✅ |
| "Stop button cancels the active run" | ✅ | — |
| "Priority values must be unique per column" | — | ✅ |
| "OpenClaw can help write specs and plans" | ✅ | — |
| "Spec docs use Title → blockquote → summary format" | — | ✅ |
| "Terminal sessions can be created from the hub" | ✅ | — |

---

## Concrete Injection Format

### Current State

Every message from Clawchestra currently includes a one-liner:
```
User is viewing project: Clawchestra

User request:
Help me add a roadmap item
```

### Target Format

For the full app-awareness layer, the injected context should be structured:

```
[Clawchestra Context]
Surface: main-chat-drawer
View: roadmap (project: Clawchestra)
Selected item: app-aware-ai-context (status: pending)

[Response Guidelines]
You are inside Clawchestra. From the main chat drawer, respond conversationally
with markdown formatting. You may suggest app features, guide workflows, and
reference the capability map.

User request:
Help me add a roadmap item
```

For scoped surfaces with tighter contracts:
```
[Clawchestra Context]
Surface: roadmap-quick-add
Project: Clawchestra
Target column: pending

[Response Guidelines]
Brief confirmation only. Include item title, column, and priority.
Keep response under 3 sentences. Use markdown formatting.

User request:
Add a dark mode theme system
```

### Implementation

The `composeContextWrappedUserMessage()` function in `gateway.ts` already builds the context prefix. Extending it to include surface type and response guidelines is a natural evolution — no new architecture needed.

The capability map (`CAPABILITIES.md`) is injected once on session start (same as the current scoped context injection). Response guidelines are per-message (because the surface/view can change).

---

## Open Questions

1. **How prescriptive should the guidelines be?** Too vague and OpenClaw doesn't change behaviour. Too specific and it feels scripted. Where's the sweet spot? *Update: the quick-add experience suggests more prescriptive is better for scoped surfaces. A quick-add chat shouldn't feel conversational — it should feel like a confirmation.*
2. **Skill vs. preamble?** Which injection mechanism is more maintainable and reliable? *Leaning preamble: for third-party users, Clawchestra injecting everything is more reliable than requiring users to install a skill into their OpenClaw. The preamble approach (extending `composeContextWrappedUserMessage()`) works today and doesn't depend on OpenClaw's skill system.*
3. **How do we measure success?** How do we know if OpenClaw is actually being a better guide within Clawchestra vs. generic chat? User feedback? Usage patterns? Task completion rates?
4. **Compaction resilience.** How do we ensure the context survives compaction reliably? Skills are re-injected, but are they re-injected in full? Does the capability map fit within context limits?
5. **User-modified instances.** If users start modifying their Clawchestra instance via OpenClaw, how does the capability map stay accurate? Does it need to be auto-generated from the codebase? *Deferred — aspirational territory. For now, CAPABILITIES.md is maintained by agent compliance rule (AGENTS.md Hard Rule 5).*
6. **Per-surface response contracts.** ~~Should response format guidance live in the context injection payload, in a skill, or in the behavioural guidelines?~~ *Resolved: response contracts are per-message, injected alongside the context payload via `composeContextWrappedUserMessage()`. Content is defined here (Layer 2); the structural field (`SurfaceContext.responseContract`) is defined in distributed-ai-surfaces-spec. See Boundary Clarification and Concrete Injection Format sections above.*
7. **Developer vs. user context.** *Resolved: see Layer 7 above. CAPABILITIES.md (shipped context, all users) vs. AGENTS.md (developer context, instance owner only). Injection mechanism conditionally includes AGENTS.md only when the scoped chat targets the Clawchestra project itself.*
