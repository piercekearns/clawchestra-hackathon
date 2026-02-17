# Chat Infrastructure Phase B: Awareness

> Completion delivery, failure alerts, compaction UI, and decision surfacing. The user should always know what's happening and never have decisions made for them invisibly.

---

**Roadmap Item:** `chat-infrastructure`
**Status:** Draft
**Created:** 2026-02-16

## Prerequisites

Phase A must be complete (scoped sessions + WebSocket reliability).

## Deliverables

### 1. Completion Delivery Guarantees

**Problem:** Sub-agent announces and coding agent completions sometimes don't reach the user — they go to the wrong session, get swallowed, or the user has no way to know they arrived.

**Solution:** With scoped sessions (Phase A), announces route to `agent:main:pipeline-dashboard`. This deliverable validates that end-to-end and adds visual treatment.

#### Completion Bubbles

When a sub-agent or background task completes, render a **completion bubble** in the chat:

```
┌─────────────────────────────────────────┐
│ ✅ Sub-agent completed                   │
│ Label: Plan review for collapsible-sidebar│
│ Runtime: 2m 31s                          │
│ Status: ok                               │
│                                          │
│ [View full result below ↓]               │
└─────────────────────────────────────────┘
```

This is separate from the agent's natural-language summary (which follows as a normal message). The bubble is a system-level indicator that something completed.

#### Implementation

- Listen for `chat` events where the message contains sub-agent announce metadata
- Parse the announce stats (runtime, tokens, status, session key)
- Render as a system bubble (distinct from user/assistant messages)
- Style: muted background, smaller text, icon-based (✅ success, ❌ failure, ⏱️ timeout)

### 2. Failure Alerts

**Problem:** When sub-agents OOM, timeout, or crash, the user finds out only by asking "what happened?" — sometimes hours later.

**Solution:** Proactive failure bubbles in chat.

#### Failure Bubble

```
┌─────────────────────────────────────────┐
│ ❌ Sub-agent failed                      │
│ Label: Build websocket-reconnection      │
│ Runtime: 4m 12s                          │
│ Error: Process killed (OOM)              │
│ Project: Pipeline Dashboard              │
│                                          │
│ [View logs] [Retry]                      │
└─────────────────────────────────────────┘
```

#### Detection Sources

1. **Sub-agent announce with error status** — OpenClaw already sends these. The announce includes `status: "error"` or `status: "timeout"`. Just render them distinctly.

2. **Process session crashes** — When a coding agent (Claude Code / Codex) is running as a background `exec` process:
   - Poll `process action:poll` periodically for active background sessions
   - If a session exits with non-zero code or is killed, surface alert
   - The `coding-agent` skill's wake trigger (`openclaw system event`) handles the happy path; we need the sad path too

3. **Gateway events** — If the gateway broadcasts failure events for sub-agent runs, subscribe to those

#### Agent Behavior Rules

The orchestrating agent (OpenClaw) must:
- **Immediately report** any sub-agent failure it detects — don't wait for the user to ask
- **Include context** — which project, which deliverable, what was being attempted
- **Suggest next steps** — "Retry?", "Check logs?", "Reduce scope?"

### 3. Compaction Awareness UI

**Problem:** User doesn't know when their session is being compacted. Long conversations suddenly feel "forgetful" with no explanation.

**Solution:** System bubble when compaction occurs.

```
┌─────────────────────────────────────────┐
│ 🧹 Conversation compacted               │
│ Older messages summarized to free space  │
│ Session: 3 compactions total             │
└─────────────────────────────────────────┘
```

#### Implementation

- Identify the gateway event state emitted during compaction (check Control UI source or gateway verbose logs for exact state name)
- Add to `stateLabels` in `gateway.ts`: `compacting: "Compacting conversation..."`
- Render a system bubble after compaction completes
- Optionally show "Saving context..." during pre-compaction memory flush

### 4. Decision Surfacing

**Problem:** In a multi-tier hierarchy (user → OpenClaw → Claude Code → sub-agents), decisions get swallowed. The orchestrating agent picks an option without asking, or a sub-agent's recommendation never reaches the user.

**Solution:** Conservative decision escalation — surface ALL decisions to the user initially.

#### What Counts as a Decision

| Always Surface | Can Act Autonomously |
|---------------|---------------------|
| Architecture choices (approach A vs B) | File naming conventions |
| Plan review recommendations | Formatting / code style |
| Scope changes ("should we also do X?") | Ordering of independent tasks |
| Error recovery options | Mechanical execution of approved plan |
| Technology/library selection | Git operations within approved scope |
| Breaking changes or migrations | Test writing for approved features |
| Anything that changes what gets built | Anything that's execution detail |

#### Decision Bubble

When a decision needs surfacing:

```
┌─────────────────────────────────────────┐
│ 🔷 Decision needed                       │
│ Project: Pipeline Dashboard              │
│ Deliverable: WebSocket Reconnection      │
│ Source: Plan review (sub-agent)          │
│                                          │
│ How should reconnection state be managed?│
│                                          │
│ Option 1 (recommended): State machine    │
│   in gateway.ts with exponential backoff │
│                                          │
│ Option 2: Tauri plugin-level reconnect   │
│   with event forwarding                  │
│                                          │
│ Option 3: Hybrid — Tauri for transport,  │
│   gateway.ts for application state       │
│                                          │
│ Reply with your choice or direction.     │
└─────────────────────────────────────────┘
```

#### Implementation (Phase B — Natural Language)

For Phase B, decisions are surfaced as natural language messages from the agent. No structured UI — just clear, contextual messages in the chat. The agent formats them consistently:

1. **Context header** — which project, deliverable, and workflow produced the decision
2. **The question** — what needs deciding
3. **Options** — if sub-agents provided options, list them with any recommendations
4. **Ask for input** — explicitly request the user's direction

The structured decision UI (clickable option cards, buttons) is Phase C territory.

#### Agent-Side Rules (codify in AGENTS.md)

```markdown
## Decision Escalation

When orchestrating sub-agents or coding agents:

### Always surface to user:
- Architecture/approach decisions (A vs B)
- Plan review recommendations and suggested changes
- Scope changes ("should we also do X?")
- Error recovery options
- Technology/library selection
- Breaking changes or data migrations

### Can proceed autonomously:
- File naming, formatting, code style
- Ordering of independent sub-tasks
- Mechanical execution within approved plan scope
- Git operations (commit, branch) within approved scope
- Test writing for already-approved features

### Format:
Always provide: project context, deliverable context, the decision,
options with recommendations, and an explicit ask for direction.
```

### 5. System Bubble Component

All four deliverables above use a common UI pattern: the **system bubble**. This should be a shared component.

#### Design

- Visually distinct from user messages (right-aligned) and agent messages (left-aligned)
- Center-aligned or full-width with muted background
- Smaller text, icon-driven
- Types: `completion` (✅), `failure` (❌), `compaction` (🧹), `decision` (🔷), `info` (ℹ️)
- Optional expandable section (for logs, full error details, etc.)
- Optional action buttons (View logs, Retry, etc.) — text-based for Phase B, structured for Phase C

#### Component

```typescript
interface SystemBubble {
  type: 'completion' | 'failure' | 'compaction' | 'decision' | 'info';
  title: string;
  details?: string[];     // key-value pairs or lines
  body?: string;          // markdown content
  actions?: string[];     // text labels (Phase B: just render as text hints)
  timestamp: number;
}
```

## Build Order

1. System bubble component (shared foundation)
2. Compaction awareness (simplest — just map a gateway event to a bubble)
3. Completion delivery (validate scoped session routing + render completion bubbles)
4. Failure alerts (add failure detection + render failure bubbles)
5. Decision surfacing — agent rules (codify in AGENTS.md)
6. Decision surfacing — formatting conventions (test with real sub-agent workflows)

Total estimate: 2-3 days of focused build time.

## Test Scenarios

- [ ] Spawn sub-agent from dashboard → completion bubble appears when done
- [ ] Spawn sub-agent that will fail (e.g. timeout after 10s) → failure bubble appears
- [ ] Long conversation → compaction bubble appears when auto-compaction triggers
- [ ] Run `/plan` via sub-agent → plan review decisions surface in dashboard chat
- [ ] Run Claude Code in background → completion notification arrives in dashboard
- [ ] Claude Code OOMs → failure alert appears (not silence)
- [ ] Decision surfaced by sub-agent → user can reply in chat with direction

## Non-Goals

- Structured decision UI (clickable buttons/cards) — Phase C
- Session panel with live status — Phase C
- Automatic retry of failed sub-agents — manual retry only for now
- Sub-agent cost tracking in UI — stats are in the announce, not a dedicated view
