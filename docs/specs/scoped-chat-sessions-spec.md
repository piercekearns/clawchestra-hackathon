# Scoped Chat Sessions

> Isolate dashboard chat from other OpenClaw surfaces so messages don't leak between webchat, Telegram, and the app.

---

**Roadmap Item:** `chat-infrastructure`
**Status:** Draft
**Created:** 2026-02-16

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

## Investigation Results (2026-02-16)

**OpenClaw already supports this natively.** The investigation phase is done.

### What the dashboard does today

In `src-tauri/src/lib.rs`:
- Session key is hardcoded: `session_key: "agent:main:main".to_string()` (line 667)
- `normalize_session_key()` defaults to `"agent:main:main"` (line 773)
- All `chat.send`, `chat.history` calls pass `sessionKey` as a parameter
- The gateway `chat.send` and `chat.history` WS methods already accept arbitrary session keys

### What needs to change

**One line.** Change `"agent:main:main"` to `"agent:main:pipeline-dashboard"` and the dashboard gets its own isolated conversation thread. The gateway creates sessions on demand — no pre-registration needed.

### Confirmed behaviors

| Question | Answer | Source |
|----------|--------|--------|
| Does OpenClaw support custom session keys? | **Yes.** `chat.send` accepts `sessionKey`. HTTP API has `x-openclaw-session-key` header. Sessions are created on demand. | `docs/gateway/openai-http-api.md`, `docs/concepts/session.md` |
| Do sessions share memory files? | **Yes.** Memory is file-based (MEMORY.md, daily notes). All sessions read from the same workspace. | `docs/concepts/session.md` — "All session state is owned by the gateway" but workspace files are filesystem-level, not session-scoped |
| Independent compaction? | **Yes.** Each session has its own JSONL transcript and compacts independently. | `docs/concepts/session.md` — transcripts stored per sessionId |
| Per-session system prompts? | **Partially.** The workspace files (AGENTS.md, SOUL.md, etc.) are injected based on agent config, not session. But the dashboard can prepend context to each message (already does with "User is viewing: X"). | `docs/concepts/system-prompt.md` |
| Token cost of parallel sessions? | Each session maintains its own context window. Workspace files (AGENTS.md, SOUL.md, MEMORY.md, etc.) are re-read per session. Acceptable trade-off for isolation. | Architecture inference |
| Session lifecycle/reset? | Configurable. Default: daily reset at 4am. Can set per-channel or per-type overrides. Dashboard session could have its own reset policy via `resetByChannel` if registered as a channel type. | `docs/concepts/session.md` |

### Session key format

OpenClaw session keys follow the pattern `agent:<agentId>:<key>`. The dashboard should use:

```
agent:main:pipeline-dashboard
```

This is explicit, descriptive, and follows the existing convention. The gateway will create the session on first message and persist its transcript separately.

---

## Approaches

### Option A: OpenClaw Session Keys (Recommended — confirmed feasible)

OpenClaw already has a concept of session keys. Today the dashboard talks to the `main` session. Instead, it uses a surface-specific session key like `agent:main:pipeline-dashboard`.

**How it works:**
- Dashboard sends messages with a distinct session key (`agent:main:pipeline-dashboard`)
- OpenClaw routes to a session with that key — separate conversation history
- The session inherits the same agent config, memory files, tools, and workspace
- System prompt can be augmented with dashboard-specific context (e.g. AGENTS.md auto-injection, "User is viewing: X")
- Agent can still reference global memory and files

**Pros:**
- Native OpenClaw concept — **already works today with no OpenClaw changes**
- Conversation isolation is automatic
- Chat persistence (SQLite) naturally separates by session key
- Each surface gets its own scrollback
- Compaction is independent per session

**Cons:**
- Cost: each surface session uses its own context window, so the agent re-reads workspace files per session
- System prompt customization is limited to what the dashboard prepends to messages (no per-session system prompt override in OpenClaw config yet)
- The agent in the dashboard session won't automatically know what happened in the Telegram session (unless it checks memory files)

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

### Phase 1: Investigation ✅ DONE
- ✅ OpenClaw supports custom session keys natively (`chat.send` accepts `sessionKey`)
- ✅ Memory sharing confirmed (file-based, all sessions share workspace)
- ✅ Per-session system prompts: not directly configurable, but dashboard can prepend context
- ✅ Findings documented above

### Phase 2: Dashboard Session Key + Clean Slate
- Change `session_key` in `OpenClawGatewayConfig` from `"agent:main:main"` to `"agent:main:pipeline-dashboard"`
- Update `normalize_session_key()` default to match
- **Clear SQLite chat.db** on session key change (clean slate — decision confirmed 2026-02-16)
  - Old messages from `agent:main:main` are still in the gateway's JSONL transcript if ever needed
  - No migration of old messages — fresh start for the dashboard thread
- Test: send a message from dashboard, verify it doesn't appear in webchat/Telegram history
- Test: send a message from webchat, verify it doesn't appear in dashboard history
- Verify the agent still has full workspace access (memory, files, tools)

### Phase 3: Compaction Awareness UI
- **Investigate gateway chat event states** — identify what state name is emitted during compaction (likely `compacting` or similar) and memory flush (`memory_flush` or similar)
- **Reference the OpenClaw Control UI** — examine how it renders the compaction indicator (spinner + system bubble) to understand the event flow
- **Add compaction states to `stateLabels`** in `gateway.ts`:
  - `compacting: "Compacting conversation..."`
  - `memory_flush: "Saving context..."` (or whatever the gateway emits)
- **Design a system-style chat bubble** for compaction/flush events:
  - Similar shape to message bubbles but visually distinct (muted color, smaller, centered)
  - Shows spinner + label while in progress
  - Styled to match dashboard theme (not copy-pasted from Control UI)
- **Show compaction count** — surface `🧹 Compactions: N` somewhere (status bar or chat info)

### Phase 4: Context Enrichment
- Dashboard prepends richer context to each message:
  - Current view (already doing "User is viewing: X")
  - Selected project (if any)
  - Auto-inject: "Consult {project}/AGENTS.md for operations" when a project is selected
- Consider a "session preamble" that runs once on first message to prime the agent:
  - "You are in the Pipeline Dashboard. This is a project management surface. Load the Pipeline Dashboard AGENTS.md."
- Surface-specific system prompt injection (may need OpenClaw feature request if message-level prepending isn't enough)

### Phase 5: Surface Profiles (optional, future)
- Define a "surface profile" structure: session key, context files, system prompt additions, capabilities
- Dashboard profile auto-injects AGENTS.md + current view state
- Profile is passed with each message or configured on session creation
- Generalizes to any future app integration (ClawOS, Revival admin, IDE plugin)

### Phase 6: Cross-Session Awareness (optional, future)
- Shared state file for significant events
- Heartbeat-based cross-session sync
- "What happened on other surfaces?" query support

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-02-16 | **Option A: Session Keys** | Native OpenClaw support, no changes needed on gateway side |
| 2026-02-16 | **Clean slate for chat.db** | Old messages are mixed main-session history; no reliable way to filter. Gateway JSONL preserved as backup. |
| 2026-02-16 | **Compaction UI as Phase 3** | Natural fit — scoped sessions mean independent compaction per surface, so the dashboard needs to show when its session is compacting |

## Remaining Questions

1. **Session lifecycle.** Should the dashboard session reset daily (default behavior) or persist longer? Project management context benefits from longer sessions. Consider `resetByChannel` or `idleMinutes` override.
2. **Cross-surface commands.** Should the user be able to say "send this to Telegram" from the dashboard? Or is surface isolation strict? (Probably allow it — the agent has `message` tool.)
3. **Settings UI.** Should the session key be user-configurable in Settings, or hardcoded? Hardcoded for now — make configurable only if there's a use case.
4. **Compaction event state names.** Need to check gateway source or Control UI source for exact event state strings emitted during compaction/memory flush.

## Non-Goals

- Giving each surface a different agent personality (SOUL.md is global)
- Restricting file/tool access per surface (agent has full access everywhere)
- Building a general-purpose multi-tenant system (this is one user, multiple surfaces)
- Replacing OpenClaw's channel routing (this is about conversational context, not message delivery)

## Relationship to Other Roadmap Items

- **Configurable OpenClaw Integration (P5)** — this spec refines what "configurable" means. The integration isn't just "can the dashboard talk to OpenClaw" but "how does the dashboard's conversation relate to other surfaces."
- **OpenClaw Platform Audit (P7)** — the audit documents what each platform *can* do. This spec documents what each platform *should* do in the context of the dashboard.
- **Scan Paths Architecture (P2)** — scan paths established `PROJECT.md` as the source of truth. Scoped sessions extend that idea: each surface knows which project files to inject.
