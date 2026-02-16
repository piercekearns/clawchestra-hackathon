---
title: "Chat Infrastructure Phase A: Reliability"
status: draft
type: spec
created: 2026-02-16
parent: chat-infrastructure
---

# Chat Infrastructure Phase A: Reliability

WebSocket auto-reconnection + scoped chat sessions + scan path fix. The foundation everything else builds on.

## Deliverables

### 1. Scoped Chat Session

**One-line change + cleanup.** Already fully specced in `docs/specs/scoped-chat-sessions-spec.md`.

Changes in `src-tauri/src/lib.rs`:
- Line 667: `session_key: "agent:main:main"` → `"agent:main:pipeline-dashboard"`
- `normalize_session_key()`: default to `"agent:main:pipeline-dashboard"` instead of `"agent:main:main"`

Changes in frontend:
- On first launch after update, clear `chat.db` (detect session key change, wipe messages table)
- Or simpler: just clear on build (user gets clean slate with the update)

Test matrix:
- [ ] Send message from dashboard → verify it does NOT appear in webchat/Telegram
- [ ] Send message from webchat → verify it does NOT appear in dashboard
- [ ] Spawn sub-agent from dashboard → verify announce arrives in dashboard chat
- [ ] Agent has full workspace access (read/write MEMORY.md, files, tools)
- [ ] `/status` in dashboard shows `agent:main:pipeline-dashboard` session key

### 2. Default Scan Path Fix

**One-line change.** Leftover from architecture overhaul.

In `src-tauri/src/lib.rs`, `default_scan_paths()`:
- Change `clawdbot-sandbox/projects` → `projects` in the preferred paths array

```rust
let preferred = [
    Path::new(&home).join("repos").to_string_lossy().to_string(),
    Path::new(&home).join("projects").to_string_lossy().to_string(),  // was clawdbot-sandbox/projects
];
```

Test:
- [ ] Dashboard shows projects from `~/projects/` (nostr-dating, btc-folio, etc.)
- [ ] Dashboard still shows projects from `~/repos/` (pipeline-dashboard, memestr, etc.)
- [ ] No duplicate project IDs across scan paths

### 3. WebSocket Auto-Reconnection

The most complex piece. Previous attempt reverted due to Tauri WebSocket plugin issues.

#### Current State

The dashboard communicates with the gateway via `openclaw gateway call` CLI invocations (not a persistent WebSocket). The `openclaw_chat` Tauri command:
1. Calls `gateway_call("chat.send", ...)` — which spawns `openclaw gateway call chat.send`
2. Polls `gateway_call("chat.history", ...)` to detect when the response arrives
3. Also subscribes to gateway WS events for streaming (via `TauriOpenClawConnection`)

The WS connection (`TauriOpenClawConnection`) is used for:
- Streaming chat events (deltas, state changes, activity indicators)
- The previous reconnection attempt tried to make this connection self-healing

#### What Needs to Happen

**Layer 1: CLI-based reliability (quick win)**
- The CLI calls (`openclaw gateway call`) are already stateless — they reconnect per-call
- Add retry logic: if a CLI call fails, retry with exponential backoff (1s, 2s, 4s, max 10s)
- Surface connection failures as system bubbles in chat ("Gateway unreachable, retrying...")

**Layer 2: WS event stream reconnection**
- When the WS drops, attempt reconnection with exponential backoff
- During reconnection, show status in ChatBar ("Reconnecting...")
- On successful reconnect, re-subscribe to the current session's events
- If WS is down but CLI works, degrade gracefully (no streaming, but messages still send/receive via polling)

**Layer 3: Connection state machine**
```
Connected → Disconnected → Reconnecting → Connected
                              ↓
                         Failed (after max retries)
                              ↓
                         Manual Retry (user clicks)
```

- `StatusBadge` already handles `connected`, `disconnected`, `error` states
- Add `reconnecting` state with spinner
- After max retries (e.g. 5), show "Connection failed" with a retry button

#### Previous Attempt Analysis

The reverted commit (`36fbc72`) broke message delivery. Suspected cause: Tauri WebSocket plugin reconnection interfered with in-flight message handling. The new approach should:
- Separate the WS event stream from message send/receive (CLI-based sending is already separate)
- Never block message sending on WS state — CLI calls are independent
- Treat WS as an enhancement (streaming) not a requirement (messages work without it)

#### Files to Change

- `src/lib/gateway.ts` — WS connection management, retry logic, state machine
- `src/components/chat/ChatBar.tsx` — connection status display
- `src/components/chat/StatusBadge.tsx` — add `reconnecting` state
- `src-tauri/src/lib.rs` — retry logic for `gateway_call()` failures

## Build Order

1. Scoped session key change (5 min)
2. Scan path fix (5 min)
3. Chat.db clear on session key change (30 min)
4. CLI retry logic in `gateway_call()` (1-2 hours)
5. WS reconnection state machine in `gateway.ts` (2-4 hours)
6. UI updates for connection states (1 hour)
7. End-to-end testing (1-2 hours)

Total estimate: ~1 day of focused build time.

## Non-Goals

- Persistent message queue (offline queueing) — messages fail if gateway is down, that's fine
- Multi-gateway failover — single gateway only
- WebSocket as primary transport — CLI remains primary for sends
