---
title: Scoped Chat Sessions
status: draft
type: spec
created: 2026-02-16
---

# Scoped Chat Sessions

## Problem

OpenClaw maintains a single conversational session per agent. All messages — regardless of which surface they arrive from (webchat, Telegram, Pipeline Dashboard, future apps) — land in one flat stream. The agent has no way to distinguish:

- "I'm replying to the last thing you said in the dashboard" from
- "I'm starting a new topic from Telegram"

This creates three concrete problems:

1. **Lost conversational thread.** When the user returns to the dashboard and replies to the last message visible there, the agent may have had 10 intervening exchanges on Telegram. The reply feels non-sequitur.

2. **Context contamination.** Dashboard conversations are about project management — roadmap items, builds, architecture. Telegram conversations might be casual, personal, or about a completely different project. Mixing them degrades both.

3. **Agent instruction ambiguity.** The dashboard sends a `"User is viewing: projects"` prefix to hint at context, but this is fragile. The agent has to guess whether a message is continuing a dashboard thread or starting fresh.

## What Success Looks Like

- When I open the Pipeline Dashboard chat, I see **only** the conversation history from the dashboard, and the agent continues from where we left off *in the dashboard*.
- The agent still has access to its full global memory (MEMORY.md, daily notes, project files) — it's not amnesiac, just contextually focused.
- When the agent replies in the dashboard, it doesn't pollute Telegram or vice versa.
- If I explicitly ask "what were we talking about on Telegram?" the agent can still recall that — the separation is conversational, not informational.

## Key Distinction: Session Scope vs Memory Scope

This is the critical design constraint:

| Layer | Scoped per surface? | Why |
|-------|---------------------|-----|
| **Conversation history** | ✅ Yes | Each surface has its own thread |
| **System prompt / instructions** | ✅ Yes (optionally) | Dashboard gets project-focused instructions; Telegram gets general |
| **Memory (MEMORY.md, daily notes)** | ❌ No — global | Agent's continuity shouldn't fragment |
| **File access / tools** | ❌ No — global | Agent needs full workspace access everywhere |
| **Identity (SOUL.md)** | ❌ No — global | Same personality everywhere |

The agent is one entity with one memory and one identity, but it maintains separate *conversations* with different *contextual priming* depending on the surface.

## Approaches

### Option A: OpenClaw Session Keys (Recommended)

OpenClaw already has a concept of session keys. Today the dashboard talks to the `main` session. Instead, it could use a surface-specific session key like `dashboard:chat` or `pipeline-dashboard`.

**How it works:**
- Dashboard sends messages with a distinct session key (e.g. `pipeline-dashboard`)
- OpenClaw routes to a session with that key — separate conversation history
- The session inherits the same agent config, memory files, tools, and workspace
- System prompt can be augmented with dashboard-specific context (e.g. AGENTS.md auto-injection, "User is viewing: X")
- Agent can still reference global memory and files

**Pros:**
- Native OpenClaw concept — minimal custom work
- Conversation isolation is automatic
- Chat persistence (SQLite) naturally separates by session key
- Each surface gets its own scrollback

**Cons:**
- Need to understand how OpenClaw handles multi-session memory sharing (do sessions share MEMORY.md? Almost certainly yes since it's file-based, but need to confirm)
- System prompt customization per session may need OpenClaw config changes
- Cost: each surface session uses its own context window, so the agent re-reads files per session

**Investigation needed:**
- Does OpenClaw support custom session keys from external integrations?
- Can per-session system prompts be configured?
- How does conversation compaction work across sessions — are they independent?
- What's the token cost implication of N parallel sessions?

### Option B: Surface Tags on Messages

Keep the single session but tag each message with its source surface. The agent (and persistence layer) can filter/group by tag.

**How it works:**
- Dashboard adds metadata to each message: `{ surface: "pipeline-dashboard", viewing: "projects" }`
- Chat persistence stores the tag
- When rendering history, filter by surface
- Agent receives all messages but gets a hint: "This message is from the dashboard, your last dashboard message was X"

**Pros:**
- No OpenClaw changes needed — pure app-side
- Single session = single context window = cheaper
- Agent sees full cross-surface context when needed

**Cons:**
- Agent still gets cross-surface messages in its context, just tagged
- Filtering is cosmetic (UI-side) not real (agent-side)
- Doesn't truly solve the "continue where we left off" problem — the agent's context window still has everything interleaved
- Relies on the agent being disciplined about respecting tags

### Option C: Hybrid — Session Keys + Shared Memory Bus

Use separate OpenClaw sessions per surface, but add a lightweight mechanism for cross-session awareness.

**How it works:**
- Each surface gets its own session (Option A)
- A shared file (e.g. `memory/cross-session-state.json`) acts as a message bus
- When something significant happens in one session, the agent notes it in the shared file
- Other sessions pick it up on next interaction or heartbeat
- Example: dashboard session writes "Completed scan-paths cleanup, trashed 19 stubs" → Telegram session sees this in its next heartbeat and knows without being told

**Pros:**
- True conversational isolation
- Cross-surface awareness without context contamination
- Scales to N surfaces

**Cons:**
- Most complex to implement
- Relies on agent discipline to write to the bus
- Risk of the bus becoming another staleness problem

## Surface-Specific Modalities

This opens up the idea that each surface isn't just a different chat window — it's a different *interaction mode* with different capabilities and priorities.

### Pipeline Dashboard Surface

| Aspect | Value |
|--------|-------|
| **Primary purpose** | Project management, roadmap, architecture decisions |
| **Context injection** | Auto-load project AGENTS.md, current view state, selected project |
| **Conversation style** | Task-oriented, technical, action-heavy |
| **History scope** | Dashboard-only — don't show Telegram chatter |
| **Capabilities** | File operations, git, code generation, roadmap mutations |
| **System prompt additions** | "You are in the Pipeline Dashboard. The user is viewing: {view}. Selected project: {project}. Consult {project}/AGENTS.md for operations." |

### Telegram Surface

| Aspect | Value |
|--------|-------|
| **Primary purpose** | General assistant, quick questions, notifications |
| **Context injection** | Standard SOUL.md + MEMORY.md |
| **Conversation style** | Casual, concise (mobile-first) |
| **History scope** | Telegram-only |
| **Capabilities** | Everything — but formatting constrained to Telegram markdown |
| **System prompt additions** | None beyond defaults |

### Future Surfaces (e.g. ClawOS, Revival Admin, IDE Plugin)

Each new integration point would define:
1. **Session key** — unique identifier for conversation routing
2. **Context priming** — what files/docs to auto-inject
3. **Conversation purpose** — what kind of work happens here
4. **Capability constraints** — what the agent should/shouldn't do
5. **Formatting rules** — platform-specific output formatting

This creates a pattern: **surface = session key + context profile + capability scope**.

## Persistence Implications

The dashboard already has SQLite chat persistence. Currently it stores all messages in one table. With scoped sessions:

- Messages get a `session_key` column (or the existing table is keyed by session)
- Loading history filters by session key
- The "last message in this surface" is always correct
- Cross-surface search could still work ("search all my conversations for X")

## Implementation Phases

### Phase 1: Investigation
- Confirm OpenClaw session key mechanics (can external apps create/target sessions?)
- Confirm memory sharing between sessions (file-based = likely yes)
- Confirm per-session system prompt customization
- Document findings

### Phase 2: Dashboard Integration
- Dashboard sends messages with a `pipeline-dashboard` session key
- Chat persistence keyed by session
- System prompt augmented with dashboard context
- History loads only dashboard messages

### Phase 3: Context Profiles
- Define a "surface profile" structure: session key, context files, system prompt additions, capabilities
- Dashboard profile auto-injects AGENTS.md + current view state
- Profile is passed with each message or configured on session creation

### Phase 4: Cross-Session Awareness (if needed)
- Shared state file for significant events
- Heartbeat-based cross-session sync
- "What happened on other surfaces?" query support

## Open Questions

1. **Does OpenClaw already support this?** The session architecture may already allow custom session keys from Tauri. Need to check OpenClaw docs for external session targeting.
2. **Token cost of multiple sessions?** Each session maintains its own context window. If the agent re-reads MEMORY.md, SOUL.md, etc. per session, that's duplicated tokens. Acceptable trade-off?
3. **Session lifecycle.** Does a dashboard session persist forever, or expire after inactivity? What about context window limits — does each session compact independently?
4. **Cross-surface commands.** Should the user be able to say "send this to Telegram" from the dashboard? Or is surface isolation strict?
5. **Which approach?** Option A (session keys) seems right for v1. Option C (hybrid) is the long-term ideal but may be premature.

## Non-Goals

- Giving each surface a different agent personality (SOUL.md is global)
- Restricting file/tool access per surface (agent has full access everywhere)
- Building a general-purpose multi-tenant system (this is one user, multiple surfaces)
- Replacing OpenClaw's channel routing (this is about conversational context, not message delivery)

## Relationship to Other Roadmap Items

- **Configurable OpenClaw Integration (P5)** — this spec refines what "configurable" means. The integration isn't just "can the dashboard talk to OpenClaw" but "how does the dashboard's conversation relate to other surfaces."
- **OpenClaw Platform Audit (P7)** — the audit documents what each platform *can* do. This spec documents what each platform *should* do in the context of the dashboard.
- **Scan Paths Architecture (P2)** — scan paths established `PROJECT.md` as the source of truth. Scoped sessions extend that idea: each surface knows which project files to inject.
