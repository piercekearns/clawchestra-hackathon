---
title: WebSocket Auto-Reconnection
status: up-next
type: deliverable
priority: 6
parent: clawchestra
lastActivity: 2026-02-12
tags: [reliability, gateway, websocket]
---

# WebSocket Auto-Reconnection

The Pipeline Dashboard's WebSocket connection to the OpenClaw gateway drops during heavy subagent/Claude Code work and never recovers. Users have to switch to the TUI or gateway dashboard to continue chatting.

## Problem

- `TauriOpenClawConnection` has no reconnection logic
- Singleton pattern doesn't detect dead sockets (`connected` just checks `ws !== null`)
- WebSocket reconnection listener was previously removed ("removed for debugging" comment in App.tsx)
- Gateway becomes unresponsive under load (subagents, spawned Claude Code sessions), causing timeouts and dropped connections

## Fixes Required

### 1. Auto-reconnect in WebSocket layer (Quick)
- Add `reconnect()` with exponential backoff to `TauriOpenClawConnection`
- Trigger on `Close` frame or failed `send()`
- Reset backoff on successful reconnect

### 2. Connection health heartbeat (Medium)
- HTTP health check every 15s succeeds even when WebSocket is dead
- Add WebSocket-level periodic ping (e.g. `chat.history` call through WS)
- Detect stale connections before user notices

### 3. UI reconnect banner
- Non-dismissible banner when connection drops
- "Reconnect" button for manual recovery
- Show connection state clearly (not just the small status badge)

## Files

- `src/lib/tauri-websocket.ts` — reconnection logic
- `src/lib/gateway.ts` — health check improvements
- `src/App.tsx` — re-enable connection state subscription, add banner
