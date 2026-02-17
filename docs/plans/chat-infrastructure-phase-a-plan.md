# Chat Infrastructure Phase A: Implementation Plan

## Context

The dashboard shares chat sessions with webchat/Telegram (`agent:main:main`), the default scan path references a legacy directory (`~/clawdbot-sandbox/projects`), and the WebSocket connection has no reconnection logic (previous attempt reverted in `36fbc72`). Phase A fixes all three and adds a state machine for connection resilience.

**Spec:** `docs/specs/chat-infrastructure-phase-a-spec.md`

### Transport Architecture (Clarification)

The app defaults to **`tauri-ws`** transport, not CLI. The transport resolution path is:

1. `App` sends via `sendMessageWithContext(...)` (`src/App.tsx:532`)
2. `resolveTransport()` calls `getDefaultOpenClawTransport()` (`src/lib/gateway.ts:258`)
3. When Tauri is available, this returns `{ mode: 'tauri-ws', ... }` (`src/lib/gateway.ts:269`)
4. Messages are sent via `sendViaTauriWs(...)` using `TauriOpenClawConnection` (`src/lib/gateway.ts:989`)

The CLI path (`tauri-openclaw` mode via `gateway_call()` in Rust) is used for backend commands and as a fallback, but is **not** the default chat send path. The WS reconnection work (Step 5) is therefore the primary resilience mechanism; CLI retries (Step 4) cover backend command paths only.

---

## Build Order

### Step 1: Scoped Session Key (4 transport paths)

Update session key across **all** transport modes, not just `tauri-ws`.

**`src-tauri/src/lib.rs`**
- Line 667: `"agent:main:main"` → `"agent:main:pipeline-dashboard"`
- Line 775: `"agent:main:main"` → `"agent:main:pipeline-dashboard"` (in `normalize_session_key()` default)
- Line 780: `"agent:main:main"` → `"agent:main:pipeline-dashboard"` (in `normalize_session_key()` empty branch)

**`src/lib/gateway.ts`**
- Line 572: `'main'` → `'agent:main:pipeline-dashboard'` (in `sendViaOpenClawWs` — `transport.sessionKey?.trim() || 'main'` fallback)
- Line 627: `'agent:main:main'` → `'agent:main:pipeline-dashboard'` (in `sendViaTauriWs` — `getTauriOpenClawConnection` call)
- Line 631: `'agent:main:main'` → `'agent:main:pipeline-dashboard'` (in `sendViaTauriWs` — local `sessionKey` variable)
- Line 1043: `'agent:main:main'` → `'agent:main:pipeline-dashboard'` (in `checkGatewayConnection`)

**Note:** Line 572 uses `'main'` not `'agent:main:main'` — this is a different fallback format in the `openclaw-ws` transport path. Must be updated to the full scoped key to avoid leaking into shared session semantics.

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

#### 3c. Startup migration in App.tsx (atomic with error handling)

**`src/App.tsx`** — In `loadSettings` effect (line 176-193):

After `const settings = await getDashboardSettings()`, add:
```typescript
const CURRENT_SESSION_KEY = 'agent:main:pipeline-dashboard';
if (settings.chatSessionKey !== CURRENT_SESSION_KEY) {
  console.log('[App] Session key changed, clearing chat.db');
  try {
    await useDashboardStore.getState().clearChatHistory();
    // Only mark migration complete if clear succeeded
    await updateDashboardSettings({ ...settings, chatSessionKey: CURRENT_SESSION_KEY });
    settings.chatSessionKey = CURRENT_SESSION_KEY;
    console.log('[App] Session key migration complete');
  } catch (migrationError) {
    // If clear or settings update fails, do NOT mark complete.
    // Migration will retry on next startup.
    console.error('[App] Session key migration failed, will retry next launch:', migrationError);
  }
}
```

**Critical fix (review finding #5):** The original plan called `clearChatHistory()` then `updateDashboardSettings()` without checking if clear succeeded. `clearChatHistory()` swallows errors internally (`src/lib/store.ts:216-217`), so a failed clear would still mark migration complete, leaving stale history forever.

Fix: Wrap both operations in a single try/catch. `clearChatHistory()` must also be updated to **re-throw** errors so the migration can detect failure:

**`src/lib/store.ts`** — `clearChatHistory` (line 209-219):
```typescript
clearChatHistory: async () => {
  set({ chatMessages: [], chatHasMore: false });

  if (isTauriRuntime()) {
    try {
      await chatMessagesClear();
      console.log('[Store] Chat history cleared');
    } catch (error) {
      console.error('[Store] Failed to clear chat history:', error);
      throw error; // Re-throw so callers can detect failure
    }
  }
},
```

**Race condition fix:** Move `loadChatMessages()` call (currently at line 172-174 as a separate effect) to the end of the `loadSettings` effect, *after* the migration check. Remove the standalone `useEffect(() => { void loadChatMessages(); }, [...])`.

---

### Step 4: CLI Retry Logic in `gateway_call()` (backend command paths only)

**Scope clarification:** This retry logic covers `gateway_call()` in Rust, which is used by `tauri-openclaw` mode and backend commands (e.g., the polling loop in `openclaw_chat` at line 995). It does **not** cover the default `tauri-ws` send path — that is handled by Step 5's reconnection state machine.

**`src-tauri/src/lib.rs`** — lines 786-834

Rename current `gateway_call()` → `gateway_call_once()`. Create new `gateway_call()` wrapper:

```rust
fn gateway_call(method: &str, params: &Value) -> Result<Value, String> {
    let max_retries: u32 = 4;
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

Backoff: 1s → 2s → 4s → (fail), max 10s cap. Matches spec (`docs/specs/chat-infrastructure-phase-a-spec.md:72`).

**Note on blocking:** `thread::sleep` in `gateway_call()` retries can compound with the existing `poll_interval` sleep in `openclaw_chat` (line 995). For the polling loop, this means worst-case latency increases by up to 7s (1+2+4) per poll cycle. This is acceptable because CLI polling is not the primary transport, and transient failures during polling should self-heal.

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

#### 5c. Close frame → reconnect + pending callback rejection

In `connect()`, modify the listener (line 73-75):
```typescript
if (msg.type === 'Close') {
  this.ws = null;
  this.rejectPendingCallbacks('WebSocket closed');
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

**Critical fix (review finding #6):** On disconnect, all pending request callbacks must be explicitly rejected. Without this, in-flight requests hang until their 30s timeout during reconnect churn.

```typescript
private rejectPendingCallbacks(reason: string): void {
  const pending = new Map(this.requestCallbacks);
  this.requestCallbacks.clear();
  for (const [id, { reject }] of pending) {
    try { reject(new Error(reason)); } catch {}
  }
}
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
  if (this.disposed) return;
  this.reconnectAttempt = 0;
  this.scheduleReconnect();
}
```

#### 5e. Clean disconnect

Update `disconnect()` to set `disposed = true`, clear reconnect timer, reject pending callbacks, clear stateListeners:
```typescript
async disconnect(): Promise<void> {
  this.disposed = true;
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  this.rejectPendingCallbacks('Connection disposed');
  if (this.ws) {
    await this.ws.disconnect();
    this.ws = null;
  }
  this.handlers.clear();
  this.stateListeners.clear();
  this.setState('disconnected');
}
```

#### 5f. Update `get connected`

```typescript
get connected(): boolean {
  return this._state === 'connected' && this.ws !== null;
}
```

#### 5g. Update singleton `getTauriOpenClawConnection()`

Return existing instance if state is `connected` or `reconnecting` (don't create duplicates during reconnection).

Add `getConnectionInstance()` export for external state access:
```typescript
export function getConnectionInstance(): TauriOpenClawConnection | null {
  return connectionInstance;
}
```

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
  import('./tauri-websocket').then(({ getConnectionInstance }) => {
    const instance = getConnectionInstance();
    if (instance) {
      instance.retryManually();
    } else {
      // No instance exists yet — trigger a fresh connection attempt
      void checkGatewayConnection();
    }
  });
}
```

**Critical fix (review finding #4):** The original plan used `getConnectionInstance()?.retryManually()` which is a no-op when no connection singleton exists (e.g., if the initial `checkGatewayConnection()` failed before creating a `TauriOpenClawConnection`). The fix above falls back to `checkGatewayConnection()` to bootstrap a fresh connection attempt.

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

**Startup resilience (review finding #4 continued):** If `checkGatewayConnection()` fails on initial call (returns `false`), the subscription bridge may not be wired yet (no connection instance to subscribe to). The `subscribeConnectionState` listener will still receive the initial `'disconnected'` state from the module-level default. When the user clicks "Retry", `retryGatewayConnection()` will call `checkGatewayConnection()` to bootstrap a fresh instance and wire the bridge.

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

#### 7c. ChatBar — Retry button (avoiding nested `<button>`)

**`src/components/chat/ChatBar.tsx`** — Add `onRetryConnection?: () => void` to `ChatBarProps`.

**Critical fix (review finding #3):** In floating mode, the header bar is a `<button>` element (`src/components/chat/ChatBar.tsx:162`). Placing another `<button>` inside it creates invalid nested HTML that breaks click/keyboard behavior.

**Solution:** Place the retry control **outside** the floating header button, as a sibling element within the header container. Refactor the floating header to wrap both elements in a non-interactive container:

```tsx
{isFloating ? (
  <div className="relative flex w-full flex-shrink-0 items-center border-b border-neutral-300/80 dark:border-neutral-700/80">
    <button
      type="button"
      className="flex flex-1 items-center gap-2 px-3 py-2 text-left"
      onClick={onToggleDrawer}
      aria-expanded={drawerOpen}
      aria-label={drawerOpen ? 'Collapse chat drawer' : 'Open chat drawer'}
    >
      <span className="font-semibold uppercase tracking-[0.06em] text-[11px] text-neutral-600 dark:text-neutral-300">
        OpenClaw
      </span>
      <StatusBadge state={connectionState} />
      {activityLabel ? <ActivityIndicator label={activityLabel} /> : null}
      {/* ... rest of header content ... */}
    </button>
    {connectionState === 'error' && onRetryConnection && (
      <button
        type="button"
        className="mr-2 rounded-full border border-status-danger/50 px-2 py-0.5 text-[10px] text-status-danger hover:bg-status-danger/10"
        onClick={(e) => { e.stopPropagation(); onRetryConnection(); }}
      >
        Retry
      </button>
    )}
  </div>
) : (/* embedded header unchanged */)}
```

For the **embedded** variant, the retry button can be placed directly in the header (which is already a `<div>`, not a `<button>`).

#### 7d. Wire retry in App.tsx

```typescript
import { retryGatewayConnection } from './lib/gateway';
// Pass to ChatShell:
onRetryConnection={retryGatewayConnection}
```

#### 7e. StatusBadge — No changes needed

**Note (review finding #9):** `StatusBadge` already supports `reconnecting` and `connecting` states (`src/components/chat/StatusBadge.tsx:13-21`). No new badge variants are needed — only the state wiring in Steps 6-7a.

---

## Files Modified (summary)

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Session key (3×), scan path (1×), settings struct, CLI retry |
| `src/lib/gateway.ts` | Session key (4× — includes line 572), state bridge, retry export with bootstrap fallback |
| `src/lib/tauri-websocket.ts` | State machine, reconnection, pending callback rejection, retry, singleton update, `getConnectionInstance` export |
| `src/lib/settings.ts` | Add `chatSessionKey` field |
| `src/lib/store.ts` | `clearChatHistory` re-throws errors for migration detection |
| `src/App.tsx` | Chat.db migration (atomic), subscription effect, system bubbles, retry wiring |
| `src/components/chat/ChatShell.tsx` | Add `onRetryConnection` prop |
| `src/components/chat/ChatBar.tsx` | Refactor floating header to avoid nested `<button>`, add retry button as sibling |

---

## Verification

### Manual Testing
1. **Session isolation:** Send message from dashboard → confirm NOT in webchat. Send from webchat → confirm NOT in dashboard.
2. **Scan path:** Verify `~/projects/` projects appear. Verify `~/repos/` still works.
3. **Chat.db clear:** After update, verify chat history is wiped (clean slate). On second launch, verify messages persist normally.
4. **CLI retry:** Stop gateway, send message via `tauri-openclaw` mode, verify retry log in Tauri console ("Gateway call failed... retrying"), then start gateway before retries exhaust.
5. **WS reconnect:** Stop gateway while connected → StatusBadge shows "Reconnecting..." with spinner. Restart gateway → StatusBadge returns to "Connected". System bubble confirms "Connection restored."
6. **WS down, no automatic transport fallback:** Kill WS — messages fail (no silent fallback to CLI). StatusBadge reflects disconnected/reconnecting state. This is the expected behavior: `tauri-ws` is the sole frontend send path; there is no automatic fallback to `tauri-openclaw` mode in `sendMessage()` (`src/lib/gateway.ts:945`).
7. **Manual retry:** Let auto-reconnect exhaust 5 attempts → StatusBadge shows "Error". Click "Retry" → reconnection attempts restart.
8. **Startup race condition:** Fresh install → settings load, session key check passes (new default), chat loads empty. No flash of stale messages.
9. **Startup with gateway down:** App starts, `checkGatewayConnection()` fails → state stays `disconnected`. "Retry" button appears after user interaction or state transition. Clicking retry bootstraps a fresh connection attempt.
10. **Manual retry with no connection instance:** After initial connect failure (no singleton created), click "Retry" → `retryGatewayConnection()` calls `checkGatewayConnection()` to bootstrap fresh instance instead of being a no-op.
11. **In-flight requests during disconnect:** Send a message, then kill WS before response arrives → pending callbacks are rejected immediately (not after 30s timeout). User sees error promptly.
12. **Multiple reconnect cycles:** Trigger disconnect/reconnect 3+ times in succession → verify no duplicate listeners, no timer leaks, no stale state bridge subscriptions.
13. **Migration failure — DB clear fails:** Simulate `chatMessagesClear()` throwing → settings key is NOT updated → migration retries on next launch.
14. **Migration failure — settings update fails after clear:** Simulate `updateDashboardSettings()` throwing → migration retries on next launch → second clear is a no-op on empty DB → settings update succeeds.
15. **First-launch migration race:** User sends message before migration completes → migration still runs (loads settings first), no stale messages leak.
16. **`openclaw-ws` transport isolation:** If `openclaw-ws` mode is used, verify session key is `agent:main:pipeline-dashboard` (not the old `'main'` fallback at line 572).
17. **Floating header retry button:** Click "Retry" in floating mode → verify no nested `<button>` in DOM, keyboard navigation works correctly, `onToggleDrawer` is not triggered.
18. **No regressions in `tauri-openclaw` mode:** After session key + retry changes, verify backend CLI commands still work correctly.

### Automated
- `bun test` — existing tests pass (no behavioral changes to schema/views/projects)
- `bun run typecheck` — TypeScript compiles with new props and types
- `bun run build` — production build succeeds

### Build validation
- `bun run validate` (typecheck + test + build) passes before commit
