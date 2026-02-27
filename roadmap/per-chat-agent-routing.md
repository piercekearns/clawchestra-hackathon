---
title: Per-Chat Agent Routing (ACP)
id: per-chat-agent-routing
status: pending
tags: [agents, openclaw, chat, infrastructure]
icon: "🔀"
specDoc: docs/specs/per-chat-agent-routing-spec.md
nextAction: "Spec written — needs OpenClaw .26+ with ACP support. Feature-detect via agents.list RPC probe before exposing UI."
lastActivity: "2026-02-27"
---

# Per-Chat Agent Routing (ACP)

> Let users bind specific OpenClaw agents to specific hub chats, so different conversations can be handled by different specialised agents.

Full spec: [`docs/specs/per-chat-agent-routing-spec.md`](../docs/specs/per-chat-agent-routing-spec.md)

---

## The Problem

Today every hub chat in Clawchestra talks to whichever agent happens to handle the default session. There's no way to say "this chat should use the code-review agent, and that chat should use the research agent." As OpenClaw's agent ecosystem grows — multiple specialised agents running in parallel — this becomes a real blocker.

## What We're Building

A phased system that lets users optionally bind a specific OpenClaw agent to each hub chat:

### Phase 1 — Feature Detection + Agent Roster
- On connect, probe the new `agents.list` ACP RPC (OpenClaw v2026.2.26+)
- If available, cache the agent list and set `openclawSupportsAcp: true` in the store
- If not available (older server), set `false` — no UI changes, graceful degradation

### Phase 2 — Agent Selector in Chat Creation
- When creating a new chat via the `+` button on a thread folder, show an optional agent dropdown if ACP is available
- Default is `"Auto"` (current behaviour — server picks)
- Selecting an agent calls `agents.bind` with the chat's session key

### Phase 3 — Agent Indicator + Rebinding
- Show the bound agent name in the secondary drawer header (small badge or subtitle text)
- Allow rebinding via the drawer header menu (Rename / Pin / Archive / **Rebind agent**)
- Unbinding reverts to default auto-routing

## Key Constraints
- **Requires OpenClaw .26+** — the `agents.list` / `agents.bind` / `agents.unbind` RPCs are new in that release
- Must degrade invisibly for users on older versions (same pattern as `classifyProcessPollCapability`)
- Agent binding is per-session-key, which maps 1:1 to hub chats — no new concepts needed

## Files Affected
| File | Change |
|------|--------|
| `src/lib/gateway.ts` | ACP feature probe, agents.list/bind/unbind RPC wrappers |
| `src/lib/store.ts` | `openclawSupportsAcp` flag, agent roster cache |
| `src/components/hub/ThreadSection.tsx` | Agent selector in chat creation flow |
| `src/components/hub/DrawerHeader.tsx` | Agent indicator badge, rebind menu |
| `src/lib/tauri-websocket.ts` | Possibly add agents scopes to connect handshake |

## Open Questions
1. Exact `agents.list` response shape — needs verification against OpenClaw .26 docs
2. Should agent binding survive session key rotations (recovery suffix)?
3. How does binding interact with subagent spawning from within a bound chat?
4. Should the agent selector show online/offline status alongside the agent name?
