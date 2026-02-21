# Clawchestra Design Principles

> Core principles that govern how features are designed, built, and experienced in Clawchestra. Every feature spec, every UI component, and every AI interaction should reference these.

**Status:** Living document
**Created:** 2026-02-21
**Referenced by:** `AGENTS.md`, `app-aware-ai-context-spec.md`, all feature specs

---

## 1. Dual Surface: Always Both, Never Either/Or

Every capability in Clawchestra should be achievable via both UI and AI. Neither is optional.

The question for each feature isn't "UI or AI?" — it's "which is primary?" The other path still exists.

### Choosing the Primary Surface

| Signal | Lean UI Primary | Lean AI Primary |
|--------|----------------|-----------------|
| Interaction is simple/binary (toggle, select from list) | ✅ | |
| User knows exactly what they want (specific value) | ✅ | |
| Speed matters more than flexibility | ✅ | |
| Interaction requires creative/unstructured input | | ✅ |
| User is exploring or unsure what they want | | ✅ |
| Output requires judgment (structuring, prioritising, naming) | | ✅ |
| Action is complex or multi-step | | ✅ |

### Examples

- **Changing a colour theme:** UI primary (settings → colour picker). AI also works ("make it darker with a lime accent"). Both paths modify the same `theme.json`.
- **Adding a roadmap item:** AI primary (describe what you want, OpenClaw structures it). UI form also works (manual fields for title, status, priority). Both paths write to `ROADMAP.md`.
- **Toggling a boolean setting:** UI only is acceptable — the overhead of asking AI to flip a switch adds no value. But parity means the agent CAN do it if asked.

### The Discipline

When building any feature, ask:
1. Can the user do this via UI? If not, should they be able to?
2. Can the agent achieve this outcome? If not, what tool/primitive is missing?
3. Which surface is primary for this feature?
4. Does the secondary surface exist (even if minimal)?

---

## 2. Discoverability Enables Demand

Users won't ask for things they don't know are possible. A blank canvas with infinite capability produces paralysis, not creativity. Constraints and visible affordances INCREASE discovery.

### Three Discovery Mechanisms

1. **UI affordances reveal capability.** A visible "Change Theme" button tells the user theming exists — even if they end up asking OpenClaw to do it. The button is the discovery mechanism. A "+" button on a kanban column tells users they can add items. The UI teaches what's possible.

2. **AI proactively surfaces capability.** OpenClaw, knowing the app's capability map, suggests features when contextually relevant: "This project doesn't have roadmap items yet — want me to help structure some?" The AI teaches what's possible, at the right moment.

3. **Discovery at the intersection.** When a user opens the quick-add form and sees "or describe what you want in the chat below," they discover the AI path. When they type in the chat and OpenClaw responds "I can also set up a full project with specs if you want," they discover depth they didn't expect. Each surface reveals the other.

### Early Discoverability (Onboarding)

Users should be primed to understand Clawchestra's dual nature from the start:

- **First-run experience** — Subtle, non-intrusive signals that set expectations. Not a rigid tutorial, but something that communicates: "You can do things with the UI. You can also ask AI to do anything the UI can do. And AI can do things beyond the UI too."
- **Loading/splash cues** — Brief, rotating capability hints: "Did you know? You can change the colour scheme just by asking." / "Type /? in the chat to see what OpenClaw can help with."
- **Discovery commands** — `/help`, `/?`, or similar in the chat that surfaces capability categories. Not a docs dump — a conversational starting point.
- **Contextual discovery** — When a user interacts with a UI element for the first time, a subtle indicator shows the AI alternative. "You can also ask OpenClaw to do this." Shown once, not repeatedly.

### The Principle

Give users enough structure to discover what's possible, enough freedom to go beyond it, and enough signals to know both paths exist. Constraints create discovery; discovery enables demand.

---

## 3. Stakes and Reversibility Govern Autonomy

When the AI takes action, the interaction pattern depends on how risky the action is and how easy it is to undo.

### The Matrix

| Stakes | Reversibility | Pattern | Example |
|--------|-------------|---------|---------|
| Low | Easy | **Auto-apply** | Reorganise priority order, update a status label |
| Low | Hard | **Quick confirm** | Change theme colours, rename a project |
| High | Easy | **Preview + apply** | Edit a spec doc, restructure roadmap items |
| High | Hard | **Explicit approval + rollback** | Modify source code, delete a project, send external messages |

### Rollback Must Be Trivial

For any action the AI takes, "undo that" should work. This means:
- **File changes:** Git commit or snapshot before applying, so revert is one step
- **Config changes:** Keep the previous version, one-click restore
- **Source code changes:** Checkpoint before modification, automated health check after
- **Destructive actions:** Soft-delete by default (trash, not rm), with recovery window

### Guardrails Live in Tools, Not Prompts

Telling an AI "please be careful" in a prompt is unreliable. If an action can't be undone, the constraint must be in the tool itself:
- The delete tool requires a confirmation parameter — it won't execute without approval
- The source-code-edit tool auto-commits before applying and runs health checks after
- The external-message tool shows a preview and waits for explicit send

This gives users freedom without fear. Low-stakes things just happen. High-stakes things are safe to try because they're cheap to reverse.

---

## 4. The Agent Knows the App (App-Aware AI Context)

When OpenClaw operates within Clawchestra, it should behave as a contextually informed guide — not a generic AI that happens to be in a sidebar.

### What This Means

- OpenClaw knows what Clawchestra can do (the capability map)
- OpenClaw knows where the user currently is (dynamic state awareness)
- OpenClaw guides users toward useful workflows (behavioural guidelines)
- OpenClaw adapts its suggestions to what's contextually relevant (not a static script)

### What This Doesn't Mean

- OpenClaw doesn't become a different personality inside Clawchestra (SOUL.md is global)
- OpenClaw doesn't restrict itself to only Clawchestra capabilities (it can still answer general questions, search the web, etc.)
- OpenClaw doesn't force users through workflows (guidelines are suggestive, not prescriptive)

See `docs/specs/app-aware-ai-context-spec.md` for full details.

---

## 5. Features Are Outcomes, Not Code (Agent-Native Ethos)

Where possible, features should be described as outcomes that the AI achieves by composing atomic tools — not as hardcoded logic.

### The Spectrum

Not everything should be agent-driven. The dual-surface principle applies: some features are better as deterministic UI, some as AI-driven outcomes, most as both.

```
Deterministic UI ←————————————————————→ Agent-Driven Outcome

Toggle dark mode          Quick-add roadmap item          "Set up a project
(always UI)               (AI primary, UI secondary)       for my new idea"
                                                           (always AI)
```

### When to Use Each

- **Deterministic code** for things that must always work the same way, are performance-critical, or where AI adds no judgment value (toggles, sorts, filters)
- **Agent-driven outcomes** for things that benefit from judgment, creativity, or handling unstructured input (creating structured items from descriptions, writing specs, suggesting next steps)
- **Both** for most things (the dual-surface principle)

### Code as Scaffolding

Some coded features exist to compensate for what today's models can't do reliably. As models improve, those features may become unnecessary — the agent handles the task with a prompt and atomic tools. The architecture should make this transition easy: features decompose into "the UI part" (persists) and "the logic part" (may become a skill/prompt).

### Skills as Features

Behaviours that would traditionally be coded logic can instead be **skills** — text files that describe how to handle a specific task. Developers edit skills to change behaviour. Users could bring their own. Skills are inspectable, versionable, and don't require code changes to update.

---

## 6. Capability Parity (The Parity Audit)

Whatever the user can do through the UI, the agent should be able to achieve through its tools. This is tracked via the **Dual-Surface Parity Matrix** in the capability map.

### The Discipline

When shipping any feature:
1. Document the UI capability
2. Verify the agent can achieve the same outcome
3. If the agent can't, identify the missing tool/primitive
4. Record which surface is primary
5. Update the capability map

### Parity ≠ Identical Interface

Parity means achieving the same outcome, not using the same interface. The user clicks a colour picker; the agent edits `theme.json`. Same outcome, different mechanism. That's parity.

---

## 7. Latent Demand Discovery

Observe what users ask the AI to do within the app. Patterns reveal what to build next.

### How It Works

1. Users ask OpenClaw for things within Clawchestra
2. When the agent succeeds → that's a validated capability (document it)
3. When the agent fails → that's a gap (add the missing tool/primitive)
4. When many users ask for the same thing → formalise it (add a UI surface, create a skill, add a domain tool)
5. When nobody asks for something → maybe it doesn't need a dedicated feature

### The Discoverability Caveat

Latent demand only reveals itself if users know what's possible. You can't observe demand for features users don't know they can ask for. This is why Principle 2 (Discoverability Enables Demand) is a prerequisite for Principle 7.

**The cycle:** Discoverability → Users try things → Demand revealed → Features formalised → More discoverability.

---

## References

- [Agent-Native Architectures (Every.to)](https://every.to/guides/agent-native) — foundational reading on the five principles (parity, granularity, composability, emergent capability, improvement over time)
- [How to Build Agent-Native: Lessons From Four Apps (Every.to)](https://every.to/source-code/how-to-build-agent-native-lessons-from-four-apps) — case studies from Cora, Sparkle, Monologue
- `docs/specs/app-aware-ai-context-spec.md` — detailed spec for the AI context layer
- `docs/specs/distributed-ai-surfaces-spec.md` — multi-surface architecture
