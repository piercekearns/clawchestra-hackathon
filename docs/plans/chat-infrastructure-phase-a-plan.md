# Chat Infrastructure Phase A: Implementation Plan

## Context

The dashboard shares chat sessions with webchat/Telegram (`agent:main:main`), the default scan path references a legacy directory (`~/clawdbot-sandbox/projects`), and the WebSocket connection has no reconnection logic (previous attempt reverted in `36fbc72`). Phase A fixes all three and adds a state machine for connection resilience.

**Spec:** `docs/specs/chat-infrastructure-phase-a-spec.md`

---

## Build Order

### Step 1: Scoped Session Key (3 string replacements)

**`src-tauri/src/lib.rs`**
- Line 667: `"agent:main:main"` → `"agent:main:pipeline-dashboard"`
- Line 775: `"agent:main:main"` → `"agent:main:pipeline-dashboard"` (in `normalize_session_key()` default)
- Line 780: `"agent:main:main"` → `"agent:main:pipeline-dashboard"` (in `normalize_session_key()` empty branch)

**`src/lib/gateway.ts`**
- Line 627: `'agent:main:main'` → `'agent:main:pipeline-dashboard'`
- Line 631: `'agent:main:main'` → `'agent:main:pipeline-dashboard'`
- Line 1043: `'agent:main:main'` → `'agent:main:pipeline-dashboard'`

---

### Step 2: Scan Path Fix (1 path change)

**`src-tauri/src/lib.rs`** — `default_scan_paths()` lines 81-88

Replace:
```rust
Path::new(&home).join("clawdbot-sandbox").join("projects").to_string_lossy().to_string(),
```
With:
```rust
Path::new(&home).join("projects").to_string_lossy().to_string(),
```

---

### Step 3: Chat.db Clear on Session Key Change

**Approach:** Store `chatSessionKey` in `DashboardSettings`. On startup, compare with the current key. If mismatched (or absent — first launch after update), clear `chat.db` and update the stored key.

#### 3a. Add field to Rust struct

**`src-tauri/src/lib.rs`** — `DashboardSettings` struct (line 39-56):
```rust
#[serde(default)]
chat_session_key: Option<String>,
```

Update `default_settings()` (line 384-403) to include:
```rust
chat_session_key: Some("agent:main:pipeline-dashboard".to_string()),
```

Update both `sanitize_settings()` fallback paths to include the field.

#### 3b. Add field to TypeScript interface

**`src/lib/settings.ts`** — add to `DashboardSettings`:
```typescript
chatSessionKey?: string | null;
```

#### 3c. Startup migration in App.tsx

**`src/App.tsx`** — In `loadSettings` effect (line 176-193):

After `const settings = await getDashboardSettings()`, add:
```typescript
const CURRENT_SESSION_KEY = 'agent:main:pipeline-dashboard';
if (settings.chatSessionKey !== CURRENT_SESSION_KEY) {
  console.log('[App] Session key changed, clearing chat.db');
  await useDashboardStore.getState().clearChatHistory();
  await updateDashboardSettings({ ...settings, chatSessionKey: CURRENT_SESSION_KEY });
  settings.chatSessionKey = CURRENT_SESSION_KEY;
}
```

**Race condition fix:** Move `loadChatMessages()` call (currently at line 172-174 as a separate effect) to the end of the `loadSettings` effect, *after* the migration check. Remove the standalone `useEffect(() => { void loadChatMessages(); }, [...])`.

---

### Step 4: CLI Retry Logic in `gateway_call()`

**`src-tauri/src/lib.rs`** — lines 786-834

Rename current `gateway_call()` → `gateway_call_once()`. Create new `gateway_call()` wrapper:

```rust
fn gateway_call(method: &str, params: &Value) -> Result<Value, String> {
    let max_retries: u32 = 3;
    let mut delay_ms: u64 = 1000;
    let mut last_error = String::new();

    for attempt in 0..max_retries {
        match gateway_call_once(method, params) {
            Ok(result) => return Ok(result),
            Err(e) => {
                // Don't retry non-transient errors
                if e.contains("Payload too large")
                    || e.contains("Failed to encode params")
                    || e.contains("OpenClaw CLI not found")
                {
                    return Err(e);
                }
                last_error = e;
                if attempt < max_retries - 1 {
                    std::thread::sleep(std::time::Duration::from_millis(delay_ms));
                    delay_ms = (delay_ms * 2).min(10_000);
                }
            }
        }
    }
    Err(format!("Gateway call failed after {max_retries} attempts: {last_error}"))
}
```

Backoff: 1s → 2s → (fail). Runs on Tauri command thread, `thread::sleep` is safe.

---

### Step 5: WS Reconnection State Machine

**`src/lib/tauri-websocket.ts`** — `TauriOpenClawConnection` class

#### 5a. Add state tracking

New type and fields:
```typescript
export type WsConnectionState = 'connected' | 'disconnected' | 'reconnecting' | 'failed';

// Class fields:
private _state: WsConnectionState = 'disconnected';
private stateListeners = new Set<(state: WsConnectionState) => void>();
private reconnectAttempt = 0;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
private maxReconnectAttempts = 5;
private disposed = false;
```

#### 5b. State management methods

```typescript
get state(): WsConnectionState { return this._state; }

private setState(next: WsConnectionState): void {
  if (this._state === next) return;
  this._state = next;
  this.stateListeners.forEach(fn => { try { fn(next); } catch {} });
}

onStateChange(listener: (s: WsConnectionState) => void): () => void {
  this.stateListeners.add(listener);
  return () => this.stateListeners.delete(listener);
}
```

#### 5c. Close frame → reconnect

In `connect()`, modify the listener (line 73-75):
```typescript
if (msg.type === 'Close') {
  this.ws = null;
  this.setState('disconnected');
  this.scheduleReconnect();
  return;
}
```

After successful handshake (line 107):
```typescript
this.setState('connected');
this.reconnectAttempt = 0;
```

#### 5d. Reconnection logic

```typescript
private scheduleReconnect(): void {
  if (this.disposed || this.reconnectAttempt >= this.maxReconnectAttempts) {
    if (!this.disposed) this.setState('failed');
    return;
  }
  const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 30_000);
  this.reconnectAttempt++;
  this.setState('reconnecting');
  this.reconnectTimer = setTimeout(() => void this.attemptReconnect(), delay);
}

private async attemptReconnect(): Promise<void> {
  if (this.disposed) return;
  try {
    if (this.ws) { try { await this.ws.disconnect(); } catch {} this.ws = null; }
    await this.connect(); // sets 'connected' on success
  } catch {
    this.scheduleReconnect();
  }
}

retryManually(): void {
  this.reconnectAttempt = 0;
  this.scheduleReconnect();
}
```

#### 5e. Clean disconnect

Update `disconnect()` to set `disposed = true`, clear reconnect timer, clear stateListeners.

#### 5f. Update `get connected`

```typescript
get connected(): boolean {
  return this._state === 'connected' && this.ws !== null;
}
```

#### 5g. Update singleton `getTauriOpenClawConnection()`

Return existing instance if state is `connected` or `reconnecting` (don't create duplicates during reconnection).

Add `getConnectionInstance()` export for external state access.

---

### Step 6: Gateway State Bridge

**`src/lib/gateway.ts`** — new module-level connection state observable

```typescript
import type { WsConnectionState } from './tauri-websocket';

type ConnectionStateListener = (state: WsConnectionState) => void;
const connectionStateListeners = new Set<ConnectionStateListener>();
let currentConnectionState: WsConnectionState = 'disconnected';
let connectionStateBridgeWired = false;

export function subscribeConnectionState(listener: ConnectionStateListener): () => void {
  connectionStateListeners.add(listener);
  listener(currentConnectionState); // immediate notify
  return () => connectionStateListeners.delete(listener);
}

export function retryGatewayConnection(): void {
  const { getConnectionInstance } = require('./tauri-websocket'); // or dynamic import
  getConnectionInstance()?.retryManually();
}
```

Wire in `sendViaTauriWs()` after `getTauriOpenClawConnection()` resolves — subscribe to `connection.onStateChange()` once (guarded by `connectionStateBridgeWired` flag).

Also wire in `checkGatewayConnection()` since that's the first place the connection is created on startup.

---

### Step 7: UI Integration

#### 7a. App.tsx — Replace polling with subscription

Replace the `checkGatewayConnection` polling effect (lines 195-213):

```typescript
const [wsConnectionState, setWsConnectionState] = useState<ChatConnectionState>('disconnected');

useEffect(() => {
  void checkGatewayConnection(); // initial connection attempt
  let prevState: ChatConnectionState = 'disconnected';

  const unsubscribe = subscribeConnectionState((state) => {
    const mapped: ChatConnectionState =
      state === 'failed' ? 'error' : state;
    setGatewayConnected(mapped === 'connected');
    setWsConnectionState(mapped);

    // System bubbles (only on meaningful transitions)
    if (mapped !== prevState) {
      if (mapped === 'disconnected' && prevState === 'connected') {
        addChatMessage({ role: 'system', content: 'Gateway connection lost, reconnecting...', timestamp: Date.now() });
      } else if (mapped === 'connected' && prevState !== 'connected' && prevState !== 'disconnected') {
        addChatMessage({ role: 'system', content: 'Connection restored.', timestamp: Date.now() });
      } else if (mapped === 'error') {
        addChatMessage({ role: 'system', content: 'Connection failed after 5 attempts. Click retry to try again.', timestamp: Date.now() });
      }
      prevState = mapped;
    }
  });

  return unsubscribe;
}, [setGatewayConnected, addChatMessage]);
```

Update `chatConnectionState` memo (lines 137-141) to incorporate `wsConnectionState`:
```typescript
const chatConnectionState = useMemo<ChatConnectionState>(() => {
  if (wsConnectionState === 'reconnecting') return 'reconnecting';
  if (wsConnectionState === 'error') return 'error';
  if (gatewayConnected) return 'connected';
  return 'disconnected';
}, [gatewayConnected, wsConnectionState]);
```

#### 7b. ChatShell — Add `onRetryConnection` prop

**`src/components/chat/ChatShell.tsx`** — Add to `ChatShellProps`:
```typescript
onRetryConnection?: () => void;
```

Pass through to both `ChatBar` instances (floating and embedded).

#### 7c. ChatBar — Retry button

**`src/components/chat/ChatBar.tsx`** — Add `onRetryConnection?: () => void` to `ChatBarProps`.

In the header bar, next to `StatusBadge`:
```tsx
{connectionState === 'error' && onRetryConnection && (
  <button
    type="button"
    className="rounded-full border border-status-danger/50 px-2 py-0.5 text-[10px] text-status-danger hover:bg-status-danger/10"
    onClick={(e) => { e.stopPropagation(); onRetryConnection(); }}
  >
    Retry
  </button>
)}
```

#### 7d. Wire retry in App.tsx

```typescript
import { retryGatewayConnection } from './lib/gateway';
// Pass to ChatShell:
onRetryConnection={retryGatewayConnection}
```

---

## Files Modified (summary)

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Session key (3×), scan path (1×), settings struct, CLI retry |
| `src/lib/gateway.ts` | Session key (3×), state bridge, retry export |
| `src/lib/tauri-websocket.ts` | State machine, reconnection, retry, singleton update |
| `src/lib/settings.ts` | Add `chatSessionKey` field |
| `src/App.tsx` | Chat.db migration, subscription effect, system bubbles, retry wiring |
| `src/components/chat/ChatShell.tsx` | Add `onRetryConnection` prop |
| `src/components/chat/ChatBar.tsx` | Add retry button, `onRetryConnection` prop |

---

## Verification

### Manual Testing
1. **Session isolation:** Send message from dashboard → confirm NOT in webchat. Send from webchat → confirm NOT in dashboard.
2. **Scan path:** Verify `~/projects/` projects appear. Verify `~/repos/` still works.
3. **Chat.db clear:** After update, verify chat history is wiped (clean slate). On second launch, verify messages persist normally.
4. **CLI retry:** Stop gateway, send message, verify retry log in Tauri console ("Gateway call failed... retrying"), then start gateway before retries exhaust.
5. **WS reconnect:** Stop gateway while connected → StatusBadge shows "Reconnecting..." with spinner. Restart gateway → StatusBadge returns to "Connected". System bubble confirms "Connection restored."
6. **Graceful degradation:** Kill WS but keep CLI alive → messages still send/receive via polling fallback. No blocking on WS state.
7. **Manual retry:** Let auto-reconnect exhaust 5 attempts → StatusBadge shows "Error". Click "Retry" → reconnection attempts restart.
8. **Startup race condition:** Fresh install → settings load, session key check passes (new default), chat loads empty. No flash of stale messages.

### Automated
- `bun test` — existing tests pass (no behavioral changes to schema/views/projects)
- `bun run typecheck` — TypeScript compiles with new props and types
- `bun run build` — production build succeeds

### Build validation
- `bun run validate` (typecheck + test + build) passes before commit
