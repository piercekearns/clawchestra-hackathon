# Chat Infrastructure Phase A: Implementation Plan

## Context

The dashboard shares chat sessions with webchat/Telegram (`agent:main:main`), the default scan path references a legacy directory (`~/clawdbot-sandbox/projects`), and the WebSocket connection has no reconnection logic (previous attempt reverted in `36fbc72`). Phase A fixes all three and adds a state machine for connection resilience.

**Spec:** `docs/specs/chat-infrastructure-phase-a-spec.md`

**Note:** The spec's "Current State" section (line 59) and "Non-Goals" (line 124) describe CLI as the primary transport. This is inaccurate — the app defaults to `tauri-ws`. The spec should be updated to match the transport architecture described below.

### Transport Architecture

The app defaults to **`tauri-ws`** transport, not CLI. The transport resolution path is:

1. `App` sends via `sendMessageWithContext(...)` (`src/App.tsx:532`)
2. `resolveTransport()` calls `getDefaultOpenClawTransport()` (`src/lib/gateway.ts:258`)
3. When Tauri is available, this returns `{ mode: 'tauri-ws', ... }` (`src/lib/gateway.ts:269`)
4. Messages are sent via `sendViaTauriWs(...)` using `TauriOpenClawConnection` (`src/lib/gateway.ts:989`)

The CLI path (`tauri-openclaw` mode via `gateway_call()` in Rust) is used for backend commands and as a fallback, but is **not** the default chat send path. The WS reconnection work (Step 3) is therefore the primary resilience mechanism.

---

## Constants

Define `DEFAULT_SESSION_KEY` once per language to avoid scattering the literal across 9+ locations:

**`src-tauri/src/lib.rs`** — top of file, after imports:
```rust
const DEFAULT_SESSION_KEY: &str = "agent:main:pipeline-dashboard";
```

**`src/lib/gateway.ts`** — top of file, after imports:
```typescript
export const DEFAULT_SESSION_KEY = 'agent:main:pipeline-dashboard';
```

All references to `"agent:main:main"`, `"agent:main:pipeline-dashboard"`, and the `'main'` fallback (line 572) use these constants instead of string literals.

---

## Build Order

### Step 1: Scoped Session Key + Scan Path Fix

#### 1a. Session key — Rust (3 locations → constant)

**`src-tauri/src/lib.rs`**
- Line 667: `"agent:main:main".to_string()` → `DEFAULT_SESSION_KEY.to_string()`
- Line 775: `"agent:main:main".to_string()` → `DEFAULT_SESSION_KEY.to_string()` (in `normalize_session_key()` default)
- Line 780: `"agent:main:main".to_string()` → `DEFAULT_SESSION_KEY.to_string()` (in `normalize_session_key()` empty branch)

#### 1b. Session key — TypeScript (4 locations → constant)

**`src/lib/gateway.ts`**
- Line 572: `'main'` → `DEFAULT_SESSION_KEY` (in `sendViaOpenClawWs` — `transport.sessionKey?.trim() || 'main'` fallback)
- Line 627: `'agent:main:main'` → `DEFAULT_SESSION_KEY` (in `sendViaTauriWs` — `getTauriOpenClawConnection` call)
- Line 631: `'agent:main:main'` → `DEFAULT_SESSION_KEY` (in `sendViaTauriWs` — local `sessionKey` variable)
- Line 1043: `'agent:main:main'` → `DEFAULT_SESSION_KEY` (in `checkGatewayConnection`)

**Note:** Line 572 uses `'main'` not `'agent:main:main'` — this is a different fallback format in the `openclaw-ws` transport path. Must be updated to the full scoped key to avoid leaking into shared session semantics.

#### 1c. Scan path fix

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

### Step 2: Chat.db Migration in Rust Startup

**Approach:** Use the existing `migration_version` field in `DashboardSettings`. On app startup (before the webview renders), check `migration_version`. If `< 1`, clear `chat.db` and bump to `1`. This runs in Rust's `tauri::Builder::setup()`, eliminating the React effect race conditions from the previous plan.

#### 2a. Add setup hook to `run()`

**`src-tauri/src/lib.rs`** — `run()` function (line 1851-1884):

Insert `.setup()` before `.invoke_handler()`:

```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|_app| {
            run_migrations();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // ... unchanged
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

#### 2b. Migration function

**`src-tauri/src/lib.rs`** — new function, placed near `load_dashboard_settings()`:

```rust
fn run_migrations() {
    let mut settings = match load_dashboard_settings() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[Migration] Failed to load settings, skipping: {e}");
            return;
        }
    };

    if settings.migration_version < 1 {
        println!("[Migration] Clearing chat.db for session key migration (v0 → v1)");
        match clear_chat_database() {
            Ok(()) => {
                settings.migration_version = 1;
                if let Err(e) = write_dashboard_settings_file(&settings) {
                    eprintln!("[Migration] Failed to update settings after clear: {e}");
                    // Migration will retry on next launch — clear is idempotent on empty DB
                }
            }
            Err(e) => {
                eprintln!("[Migration] Failed to clear chat.db: {e}");
                // Do NOT bump migration_version — retry on next launch
            }
        }
    }
}
```

#### 2c. Separate `clear_chat_database()` function

**`src-tauri/src/lib.rs`** — new function near `chat_messages_clear()` (line 1826):

```rust
/// Low-level DB clear that returns errors (unlike the Tauri command which is fire-and-forget).
/// Used by migrations and the `chat_messages_clear` Tauri command.
fn clear_chat_database() -> Result<(), String> {
    let guard = get_or_init_chat_db()?;
    let conn = guard.as_ref().ok_or("Database not initialized")?;
    conn.execute("DELETE FROM messages", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}
```

Update `chat_messages_clear` to delegate:
```rust
#[tauri::command]
fn chat_messages_clear() -> Result<(), String> {
    clear_chat_database()
}
```

This preserves the existing `clearChatHistory` contract in the store (swallows errors) while giving the migration a throwing path. No changes needed to `src/lib/store.ts`.

#### 2d. Update `default_migration_version()`

**`src-tauri/src/lib.rs`** — line 70-72:

```rust
fn default_migration_version() -> u32 {
    1  // New installs start at v1 (no migration needed)
}
```

Also update `default_settings()` (line 387) and its fallback (line 397): `migration_version: 1`.

**Why Rust startup instead of React effect:**
- Runs before the webview loads — no race with `loadChatMessages()`
- No need to reorder React effects or remove the standalone `loadChatMessages` effect
- Transactional: clear + settings update happen in the same process with no IPC boundary
- If it fails, the app still boots normally — migration retries on next launch
- No changes to `clearChatHistory` public contract in the store

---

### Step 3: WS Reconnection State Machine

**`src/lib/tauri-websocket.ts`** — `TauriOpenClawConnection` class

#### 3a. Use existing `ChatConnectionState` type

Reuse the existing type from `src/components/chat/types.ts` instead of introducing a new `WsConnectionState`. This eliminates the mapping layer in App.tsx.

```typescript
import type { ChatConnectionState } from '../components/chat/types';
```

New class fields:
```typescript
private _state: ChatConnectionState = 'disconnected';
private stateListeners = new Set<(state: ChatConnectionState) => void>();
private reconnectAttempt = 0;
private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
private maxReconnectAttempts = 5;
private disposed = false;
```

#### 3b. State management methods

```typescript
get state(): ChatConnectionState { return this._state; }

private setState(next: ChatConnectionState): void {
  if (this._state === next) return;
  const prev = this._state;
  this._state = next;
  this.stateListeners.forEach(fn => {
    try { fn(next); } catch (e) { console.warn('[TauriWS] State listener error:', e); }
  });
}

onStateChange(listener: (s: ChatConnectionState) => void): () => void {
  this.stateListeners.add(listener);
  return () => this.stateListeners.delete(listener);
}
```

#### 3c. Store timeout handles for clean rejection

Update the `requestCallbacks` map type to include the timeout handle:

```typescript
private requestCallbacks: Map<string, {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}> = new Map();
```

Update `request()` method to store the timeout:

```typescript
async request<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  if (!this.ws) {
    throw new Error('WebSocket not connected');
  }

  const id = `req-${++this.messageIdCounter}-${Date.now()}`;
  const message = { type: 'req', id, method, params };

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      this.requestCallbacks.delete(id);
      reject(new Error(`Request timeout: ${method}`));
    }, 30000);

    this.requestCallbacks.set(id, {
      resolve: (v) => {
        clearTimeout(timeout);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timeout);
        reject(e);
      },
      timeout,
    });

    this.ws!.send(JSON.stringify(message)).catch((err) => {
      this.requestCallbacks.delete(id);
      clearTimeout(timeout);
      reject(err);
    });
  });
}
```

#### 3d. Pending callback rejection with timeout cleanup

```typescript
private rejectPendingCallbacks(reason: string): void {
  const pending = new Map(this.requestCallbacks);
  this.requestCallbacks.clear();
  for (const [id, { reject, timeout }] of pending) {
    clearTimeout(timeout);
    try { reject(new Error(reason)); } catch (e) { console.warn('[TauriWS] Reject error:', e); }
  }
}
```

#### 3e. Close frame → reconnect

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

#### 3f. Reconnection logic

```typescript
private scheduleReconnect(): void {
  if (this.disposed || this.reconnectAttempt >= this.maxReconnectAttempts) {
    if (!this.disposed) this.setState('error');
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
    if (this.ws) { try { await this.ws.disconnect(); } catch (e) { console.warn('[TauriWS] Pre-reconnect disconnect error:', e); } this.ws = null; }
    await this.connect(); // sets 'connected' on success
  } catch {
    this.scheduleReconnect();
  }
}

retryManually(): void {
  if (this.disposed) {
    // Reset disposed state — allows retry after clean disconnect
    this.disposed = false;
  }
  this.reconnectAttempt = 0;
  this.scheduleReconnect();
}
```

**Bug fix (review finding):** The original `retryManually()` returned early when `disposed === true`, making it permanently dead after `disconnect()`. The fix resets `disposed = false` to allow the retry to proceed. This is the correct behavior because `retryManually()` represents an explicit user intent to reconnect — it should always work regardless of previous state.

#### 3g. Clean disconnect

```typescript
async disconnect(): Promise<void> {
  this.disposed = true;
  if (this.reconnectTimer) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
  this.setState('disconnected');  // Notify listeners BEFORE clearing them
  this.rejectPendingCallbacks('Connection disposed');
  if (this.ws) {
    await this.ws.disconnect();
    this.ws = null;
  }
  this.handlers.clear();
  this.stateListeners.clear();
}
```

**Fix:** `setState('disconnected')` is called *before* `stateListeners.clear()` so the Zustand bridge (Step 3i) receives the final state transition. Previous plan had these reversed.

#### 3h. Update `get connected`

```typescript
get connected(): boolean {
  return this._state === 'connected' && this.ws !== null;
}
```

#### 3i. Update singleton `getTauriOpenClawConnection()` with reconnect guard

```typescript
export async function getTauriOpenClawConnection(
  wsUrl: string,
  sessionKey: string,
  token?: string,
): Promise<TauriOpenClawConnection> {
  // Reuse existing connection if connected or reconnecting (don't create duplicates)
  if (connectionInstance) {
    const state = connectionInstance.state;
    if (state === 'connected' || state === 'reconnecting') {
      return connectionInstance;
    }
  }

  // Avoid multiple concurrent connection attempts
  if (connectionPromise) {
    return connectionPromise;
  }

  connectionPromise = (async () => {
    // Clean up disposed instance before creating new one
    if (connectionInstance) {
      try { await connectionInstance.disconnect(); } catch {}
    }
    connectionInstance = new TauriOpenClawConnection(wsUrl, sessionKey, token);
    // Wire Zustand bridge for this new instance (see Step 3j)
    wireConnectionStateToStore(connectionInstance);
    await connectionInstance.connect();
    return connectionInstance;
  })();

  try {
    return await connectionPromise;
  } finally {
    connectionPromise = null;
  }
}
```

**Bug fix (review finding):** The original code checked `connectionInstance?.connected`, which returns `false` during reconnection, causing a duplicate instance to race with the state machine. The fix checks `connectionInstance.state` for both `'connected'` and `'reconnecting'`.

#### 3j. Zustand connection state bridge (replaces hand-rolled pub/sub)

Instead of a custom `Set<callback>` observer in `gateway.ts`, use the existing Zustand store:

**`src/lib/store.ts`** — add to `DashboardState` interface:

```typescript
wsConnectionState: ChatConnectionState;
setWsConnectionState: (state: ChatConnectionState) => void;
```

Add to store creation:
```typescript
wsConnectionState: 'disconnected',
setWsConnectionState: (wsConnectionState) => set({ wsConnectionState }),
```

**`src/lib/tauri-websocket.ts`** — bridge function wired in `getTauriOpenClawConnection()`:

```typescript
function wireConnectionStateToStore(connection: TauriOpenClawConnection): void {
  const { setWsConnectionState, setGatewayConnected } = useDashboardStore.getState();
  connection.onStateChange((state) => {
    setWsConnectionState(state);
    setGatewayConnected(state === 'connected');
  });
}
```

This replaces the entire Step 6 from the previous plan (the `connectionStateListeners` Set, `currentConnectionState`, `connectionStateBridgeWired` flag, and `subscribeConnectionState` function). The Zustand store is the single source of truth for connection state, accessible from any component via `useDashboardStore`.

**Bug fix (review finding):** The previous `connectionStateBridgeWired` flag never reset when the connection instance was replaced. The new approach wires the bridge inside `getTauriOpenClawConnection()` every time a new instance is created, making it impossible to get stale.

#### 3k. Update `closeTauriOpenClawConnection()` and add `getConnectionInstance()`

```typescript
export function closeTauriOpenClawConnection(): void {
  if (connectionInstance) {
    connectionInstance.disconnect();  // handles disposed, timers, listeners
    connectionInstance = null;
  }
}

export function getConnectionInstance(): TauriOpenClawConnection | null {
  return connectionInstance;
}
```

---

### Step 4: UI Integration

#### 4a. App.tsx — Replace polling with Zustand subscription

Replace the `checkGatewayConnection` polling effect (lines 195-213):

```typescript
useEffect(() => {
  void checkGatewayConnection(); // initial connection attempt, wires Zustand bridge
}, []);
```

The polling interval is removed entirely. Connection state updates now flow through Zustand via the bridge wired in Step 3j. No subscription/unsubscription needed in App.tsx.

Update `chatConnectionState` memo (lines 137-141) to read from Zustand:

```typescript
const wsConnectionState = useDashboardStore((s) => s.wsConnectionState);

const chatConnectionState = useMemo<ChatConnectionState>(() => {
  if (wsConnectionState === 'reconnecting') return 'reconnecting';
  if (wsConnectionState === 'error') return 'error';
  if (gatewayConnected) return 'connected';
  return 'disconnected';
}, [gatewayConnected, wsConnectionState]);
```

#### 4b. System bubbles via Zustand subscription

Add a separate effect for system bubbles, using the Zustand `subscribe` API to track transitions:

```typescript
useEffect(() => {
  let prevState: ChatConnectionState = useDashboardStore.getState().wsConnectionState;

  const unsubscribe = useDashboardStore.subscribe(
    (state) => state.wsConnectionState,
    (state) => {
      if (state === prevState) return;

      if (state === 'disconnected' && prevState === 'connected') {
        addChatMessage({ role: 'system', content: 'Gateway connection lost, reconnecting...', timestamp: Date.now() });
      } else if (state === 'connected' && (prevState === 'reconnecting' || prevState === 'error')) {
        addChatMessage({ role: 'system', content: 'Connection restored.', timestamp: Date.now() });
      } else if (state === 'error') {
        addChatMessage({ role: 'system', content: 'Connection failed after 5 attempts. Click retry to try again.', timestamp: Date.now() });
      }

      prevState = state;
    },
  );

  return unsubscribe;
}, [addChatMessage]);
```

**Simplification:** The "Connection restored" bubble only fires when transitioning from `'reconnecting'` or `'error'` → `'connected'`. This replaces the harder-to-read `prevState !== 'connected' && prevState !== 'disconnected'` guard from the previous plan with explicit source states.

#### 4c. Retry connection function

**`src/lib/gateway.ts`** — export a retry function (replaces the previous hand-rolled bridge):

```typescript
import { getConnectionInstance } from './tauri-websocket';

export function retryGatewayConnection(): void {
  const instance = getConnectionInstance();
  if (instance) {
    instance.retryManually();
  } else {
    // No instance exists yet — bootstrap a fresh connection
    void checkGatewayConnection();
  }
}
```

This is 6 lines instead of the previous 25-line bridge module. The `retryManually()` fix in Step 3f ensures this works even after `disconnect()` has set `disposed = true`.

#### 4d. Retry banner in chat drawer (replaces ChatBar header surgery)

Instead of refactoring the floating header's `<button>` structure, show the retry UI as a banner above the message list inside the drawer. This avoids the nested `<button>` HTML issue entirely.

**`src/components/chat/ChatShell.tsx`** — Add `onRetryConnection` prop and render banner:

```tsx
interface ChatShellProps {
  // ... existing props
  onRetryConnection?: () => void;
}

// Inside the drawer content area, above the message list:
{connectionState === 'error' && onRetryConnection && (
  <div className="flex items-center justify-between border-b border-status-danger/20 bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
    <span>Connection failed after 5 attempts.</span>
    <button
      type="button"
      className="rounded-full border border-status-danger/50 px-2 py-0.5 hover:bg-status-danger/10"
      onClick={onRetryConnection}
    >
      Retry
    </button>
  </div>
)}
```

**`src/components/chat/ChatBar.tsx`** — No structural changes needed. The floating header remains a single `<button>` element. `StatusBadge` shows the `error` state; the retry action is in the drawer banner above.

#### 4e. Wire retry in App.tsx

```typescript
import { retryGatewayConnection } from './lib/gateway';
// Pass to ChatShell:
onRetryConnection={retryGatewayConnection}
```

#### 4f. StatusBadge — No changes needed

`StatusBadge` already supports `reconnecting` and `connecting` states (`src/components/chat/StatusBadge.tsx:13-21`). No new badge variants needed — only the Zustand state wiring in Steps 3j and 4a.

---

## Files Modified (summary)

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | `DEFAULT_SESSION_KEY` constant, session key (3×), scan path (1×), `run_migrations()` in setup hook, `clear_chat_database()`, `default_migration_version()` → 1 |
| `src/lib/gateway.ts` | `DEFAULT_SESSION_KEY` constant, session key (4× — includes line 572), `retryGatewayConnection()` export |
| `src/lib/tauri-websocket.ts` | State machine using `ChatConnectionState`, reconnection, `rejectPendingCallbacks` with timeout cleanup, `retryManually` with `disposed` reset, singleton reconnect guard, Zustand bridge wiring, `getConnectionInstance` export |
| `src/lib/store.ts` | Add `wsConnectionState` + `setWsConnectionState` to Zustand store |
| `src/App.tsx` | Remove polling effect, read `wsConnectionState` from Zustand, system bubble subscription, retry wiring |
| `src/components/chat/ChatShell.tsx` | Add `onRetryConnection` prop, retry banner above message list |

**Files NOT modified (vs previous plan):**
- `src/lib/settings.ts` — no new `chatSessionKey` field needed (using `migrationVersion`)
- `src/lib/store.ts` — `clearChatHistory` contract unchanged (migration is in Rust)
- `src/components/chat/ChatBar.tsx` — no structural refactor needed (retry is in drawer banner)

---

## Verification

### Manual Testing

1. **Session isolation:** Send message from dashboard → confirm NOT in webchat. Send from webchat → confirm NOT in dashboard.
2. **Scan path:** Verify `~/projects/` projects appear. Verify `~/repos/` still works.
3. **Chat.db clear:** After update, verify chat history is wiped (clean slate). On second launch, verify messages persist normally.
4. **WS reconnect:** Stop gateway while connected → StatusBadge shows "Reconnecting..." with spinner. Restart gateway → StatusBadge returns to "Connected". System bubble confirms "Connection restored."
5. **WS down, no automatic transport fallback:** Kill WS — messages fail (no silent fallback to CLI). StatusBadge reflects disconnected/reconnecting state. This is the expected behavior: `tauri-ws` is the sole frontend send path; there is no automatic fallback to `tauri-openclaw` mode in `sendMessage()` (`src/lib/gateway.ts:945`).
6. **Manual retry:** Let auto-reconnect exhaust 5 attempts → StatusBadge shows "Error". Retry banner appears in drawer. Click "Retry" → reconnection attempts restart.
7. **Startup with gateway down:** App starts, `checkGatewayConnection()` fails → state stays `disconnected`. Retry banner appears after state transitions to `error`. Clicking retry bootstraps a fresh connection attempt.
8. **Manual retry with no connection instance:** After initial connect failure (no singleton created), click "Retry" → `retryGatewayConnection()` calls `checkGatewayConnection()` to bootstrap fresh instance instead of being a no-op.
9. **Manual retry after clean disconnect:** After `disconnect()` sets `disposed = true`, click "Retry" → `retryManually()` resets `disposed = false` and reconnects successfully.
10. **In-flight requests during disconnect:** Send a message, then kill WS before response arrives → pending callbacks are rejected immediately (not after 30s timeout), timeout handles are cleared. User sees error promptly.
11. **Multiple reconnect cycles:** Trigger disconnect/reconnect 3+ times in succession → verify no duplicate listeners, no timer leaks, no duplicate connection instances.
12. **Singleton during reconnect:** Call `getTauriOpenClawConnection()` while state is `reconnecting` → returns existing instance (no duplicate created).
13. **Migration on first update:** Old install (migration_version=0) → app starts → chat.db cleared before webview loads → no flash of stale messages.
14. **Migration on fresh install:** New install (migration_version=1 by default) → no migration runs → chat loads empty normally.
15. **`openclaw-ws` transport isolation:** If `openclaw-ws` mode is used, verify session key is `DEFAULT_SESSION_KEY` (not the old `'main'` fallback at line 572).
16. **No regressions in `tauri-openclaw` mode:** After session key changes, verify backend CLI commands still work correctly.

### Automated
- `bun test` — existing tests pass (no behavioral changes to schema/views/projects)
- `bun run typecheck` — TypeScript compiles with new Zustand slice and types
- `bun run build` — production build succeeds

### Build validation
- `bun run validate` (typecheck + test + build) passes before commit

---

## Deferred: CLI Retry Logic

**Removed from Phase A.** The `gateway_call()` retry wrapper (exponential backoff for `tauri-openclaw` mode) is deferred to a future "CLI mode hardening" follow-up.

**Rationale:** `tauri-ws` is the default transport. CLI is used for backend commands and as a fallback. Adding retry logic to a secondary transport path that most users never trigger is premature. Additionally, `gateway_call()` is synchronous and called from `#[tauri::command] async fn openclaw_chat` — adding `thread::sleep` would block the Tokio runtime thread for up to 7s per retry cycle, starving other async IPC commands. A proper implementation would need `tokio::time::sleep` with an async `gateway_call`, which is a larger refactor.

**When to revisit:** If CLI mode becomes a supported primary transport, or if transient CLI failures are observed in production.
