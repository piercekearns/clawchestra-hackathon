# Per-Chat Agent Routing (ACP)

> Let users bind specific OpenClaw agents to specific hub chats, so different conversations can be handled by different specialized agents.

## Context

OpenClaw v2026.2.26 introduces the Agent Communication Protocol (ACP) with thread-bound agents and `agents.bind`/`agents.unbind` RPCs. This enables Clawchestra to route individual chat sessions to specific agents rather than relying on the default agent for all conversations.

Today, Clawchestra talks to whichever agent handles the session key. All chats go through the same agent. Users running multiple OpenClaw agents (e.g. a code review agent, a writing agent, a research agent) have no way to control which agent handles which chat from within Clawchestra.

## Who Benefits

- **Solo users with one agent**: No benefit yet. This feature is invisible/dormant.
- **Users with multiple agents**: Can assign specialized agents to specific chats (e.g. "use the code agent for this project's chats, the writing agent for blog posts").
- **Future multi-agent setups**: As OpenClaw's agent ecosystem grows, per-chat routing becomes essential for usable orchestration.

## Design

### Phase 1: Feature Detection + Agent Roster

- On connect, probe `agents.list` RPC to detect ACP availability
- If available, fetch and cache the list of bound agents
- Store capability flag in dashboard store: `openclawSupportsAcp: boolean`
- If unavailable (older server), gracefully skip with no UI impact

### Phase 2: Agent Selector in Chat Creation

- When creating a new chat (via the + button on a thread), if ACP is available, show an optional agent dropdown
- Default: "Auto" (server decides, current behavior)
- Options: list from `agents.list` response
- On selection, call `agents.bind` with the chat's session key and chosen agent ID

### Phase 3: Agent Indicator + Rebinding

- Show the bound agent name in the drawer header (small badge or subtitle)
- Allow rebinding via the drawer header menu (alongside Rename, Pin, Archive)
- Unbinding reverts to default agent routing

## Backwards Compatibility

- Feature-detect via RPC probe, matching the existing `classifyProcessPollCapability` pattern in `gateway.ts`
- If `agents.list` returns an error or is unrecognized, set `openclawSupportsAcp: false` and hide all ACP UI
- No protocol version bump needed — this is additive
- Users on older OpenClaw versions see no change in behavior

## Technical Notes

- `agents.list` / `agents.bind` / `agents.unbind` are new RPCs in OpenClaw .26
- Session key per chat already exists (scoped hub chats use custom session keys)
- Agent binding is per-session-key, which maps 1:1 to hub chats
- The connect handshake already includes scopes; may need `agents.read` / `agents.write` scopes added

## Files Likely Affected

| File | Change |
|------|--------|
| `src/lib/gateway.ts` | Add ACP feature detection probe, agents.list/bind/unbind RPC wrappers |
| `src/lib/store.ts` | Add `openclawSupportsAcp` flag, agent roster cache |
| `src/components/hub/ThreadSection.tsx` | Agent selector in chat creation flow |
| `src/components/hub/DrawerHeader.tsx` | Agent indicator badge, rebind menu option |
| `src/lib/tauri-websocket.ts` | Possibly add agent scopes to connect handshake |

## Open Questions

1. What does the `agents.list` response shape look like? Need to verify against OpenClaw .26 docs.
2. Should agent binding persist across session key rotations (recovery suffix)?
3. How does agent binding interact with subagent spawning — can a bound agent spawn its own subagents?
4. Should we show agent status (online/offline) alongside the agent name?
