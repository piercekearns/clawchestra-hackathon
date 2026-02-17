# Chat Infrastructure Phase B: Implementation Plan

## Context

Phase B adds **awareness** — the user should always know what's happening. Sub-agent completions, failures, compaction events, and architecture decisions must all surface visibly in the chat. Phase A (scoped sessions + WS reliability) must be complete first.

**Spec:** `docs/specs/chat-infrastructure-phase-b-spec.md`
**Depends on:** `docs/plans/chat-infrastructure-phase-a-plan.md` (session key, state machine, system messages)

### Phase A Landing Checklist

Phase B implementation must not begin until ALL of these are verified in the codebase:

- [ ] Session key is `agent:main:pipeline-dashboard` in `src/lib/gateway.ts` (lines 627, 631, 1043) and `src-tauri/src/lib.rs` (lines 667, 775, 780)
- [ ] `WsConnectionState` type and `onStateChange()` method exist on `TauriOpenClawConnection` in `src/lib/tauri-websocket.ts`
- [ ] `getConnectionInstance()` is exported from `src/lib/tauri-websocket.ts`
- [ ] `subscribeConnectionState()` is exported from `src/lib/gateway.ts`
- [ ] `scheduleReconnect()` and exponential backoff logic exist in `TauriOpenClawConnection`
- [ ] `bun run validate` passes with all Phase A changes landed

---

## Build Order

### Step 1: Extend ChatMessage Type for System Bubbles

Phase A's `ChatMessage` already supports `role: 'system'`. Phase B adds structured metadata so system messages render as rich bubbles instead of plain text.

**`src/lib/gateway.ts`** — Extend `ChatMessage`:

```typescript
export type SystemBubbleKind = 'completion' | 'failure' | 'compaction' | 'decision' | 'info';

export interface SystemBubbleMeta {
  kind: SystemBubbleKind;
  title: string;
  details?: Record<string, string>;  // key-value pairs (Label, Runtime, Status, etc.)
  actions?: string[];                 // text hints: "View logs", "Retry", etc.
  runId?: string;                     // ties bubble to gateway run for dedup/lifecycle tracking
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  _id?: string;                       // stable local key set by store addChatMessage
  systemMeta?: SystemBubbleMeta;      // Only present when role === 'system'
}
```

#### Persistence: Reuse existing `metadata` column

The SQLite schema already has a `metadata TEXT` column on the `messages` table (`src-tauri/src/lib.rs:1694-1700`). The Rust `ChatMessage` struct already has `metadata: Option<String>` (`src-tauri/src/lib.rs:1731-1732`). The TypeScript `PersistedChatMessage` already has `metadata?: string` (`src/lib/tauri.ts:219-225`). The `chat_message_save` command already writes `metadata` to SQLite (`src-tauri/src/lib.rs:1810-1818`).

**No schema migration needed.** We serialize `SystemBubbleMeta` into the existing `metadata` JSON field. The JSON envelope stored in `metadata` will be:

```json
{
  "systemMeta": {
    "kind": "completion",
    "title": "Sub-agent completed",
    "details": { "Label": "Plan review", "Runtime": "2m 31s" },
    "runId": "run_abc123"
  }
}
```

**No Rust changes needed.** The Rust side already stores/loads `metadata` as an opaque `Option<String>`. All structured parsing happens in TypeScript.

---

### Step 2: Wire `systemMeta` Through the Persistence Pipeline

The current store drops `metadata` during both save and load. This is the core bug that would cause system bubbles to vanish on reload.

**`src/lib/store.ts`** — Fix `addChatMessage` (currently at line ~104-132):

The save call currently drops metadata:
```typescript
// CURRENT (broken for system bubbles):
await chatMessageSave({
  id,
  role: message.role,
  content: message.content,
  timestamp,
});
```

Fix to include metadata serialization:
```typescript
// FIXED:
await chatMessageSave({
  id,
  role: message.role,
  content: message.content,
  timestamp,
  metadata: message.systemMeta
    ? JSON.stringify({ systemMeta: message.systemMeta })
    : undefined,
});
```

**`src/lib/store.ts`** — Fix `loadChatMessages` (currently at line ~146-150):

The load mapping currently drops metadata:
```typescript
// CURRENT (broken):
chatMessages: messages.map((m) => ({
  role: m.role as ChatMessage['role'],
  content: m.content,
  timestamp: m.timestamp,
})),
```

Fix to deserialize metadata:
```typescript
// FIXED:
chatMessages: messages.map((m) => deserializePersistedMessage(m)),
```

**`src/lib/store.ts`** — Fix `loadMoreChatMessages` (currently at line ~189-193):

Same fix — the mapping currently drops metadata:
```typescript
// CURRENT (broken):
.map((m) => ({
  role: m.role as ChatMessage['role'],
  content: m.content,
  timestamp: m.timestamp,
}));
```

Fix:
```typescript
// FIXED:
.map((m) => deserializePersistedMessage(m));
```

**`src/lib/store.ts`** — Add deserialization helper (at module level):

```typescript
import type { PersistedChatMessage } from './tauri';
import type { ChatMessage, SystemBubbleMeta } from './gateway';

function deserializePersistedMessage(m: PersistedChatMessage): ChatMessage {
  let systemMeta: SystemBubbleMeta | undefined;
  if (m.metadata) {
    try {
      const parsed = JSON.parse(m.metadata);
      if (parsed?.systemMeta) {
        systemMeta = parsed.systemMeta as SystemBubbleMeta;
      }
    } catch {
      // Ignore malformed metadata — degrade gracefully to plain message
    }
  }
  return {
    role: m.role as ChatMessage['role'],
    content: m.content,
    timestamp: m.timestamp,
    ...(systemMeta ? { systemMeta } : {}),
  };
}
```

---

### Step 3: SystemBubble Component

New file: **`src/components/chat/SystemBubble.tsx`**

```typescript
import { CheckCircle2, XCircle, Trash2, HelpCircle, Info } from 'lucide-react';
import type { SystemBubbleKind, SystemBubbleMeta } from '../../lib/gateway';
import { cn } from '../../lib/utils';

const ICONS: Record<SystemBubbleKind, typeof CheckCircle2> = {
  completion: CheckCircle2,
  failure: XCircle,
  compaction: Trash2,
  decision: HelpCircle,
  info: Info,
};

const COLORS: Record<SystemBubbleKind, string> = {
  completion: 'text-green-500 dark:text-green-400',
  failure: 'text-red-500 dark:text-red-400',
  compaction: 'text-neutral-400 dark:text-neutral-500',
  decision: 'text-blue-500 dark:text-blue-400',
  info: 'text-neutral-500 dark:text-neutral-400',
};

const BORDER_COLORS: Record<SystemBubbleKind, string> = {
  completion: 'border-green-500/20 dark:border-green-400/20',
  failure: 'border-red-500/20 dark:border-red-400/20',
  compaction: 'border-neutral-300/50 dark:border-neutral-700/50',
  decision: 'border-blue-500/20 dark:border-blue-400/20',
  info: 'border-neutral-300/50 dark:border-neutral-700/50',
};

interface SystemBubbleProps {
  meta: SystemBubbleMeta;
  content: string;       // markdown body (fallback / extra context)
  timestamp?: number;
}

export function SystemBubble({ meta, content, timestamp }: SystemBubbleProps) {
  const Icon = ICONS[meta.kind];
  const iconColor = COLORS[meta.kind];
  const borderColor = BORDER_COLORS[meta.kind];

  // Use role="status" for informational bubbles, role="alert" for failures
  const ariaRole = meta.kind === 'failure' ? 'alert' : 'status';

  return (
    <div className="flex justify-center px-4 py-1" role={ariaRole}>
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          'bg-neutral-50/50 dark:bg-neutral-900/50',
          borderColor,
        )}
      >
        {/* Header: icon + title */}
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 flex-shrink-0', iconColor)} aria-hidden="true" />
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {meta.title}
          </span>
        </div>

        {/* Detail rows */}
        {meta.details && Object.keys(meta.details).length > 0 && (
          <dl className="mt-1.5 space-y-0.5 pl-6 text-xs text-neutral-500 dark:text-neutral-400">
            {Object.entries(meta.details).map(([key, value]) => (
              <div key={key} className="flex gap-1.5 min-w-0">
                <dt className="font-medium shrink-0">{key}:</dt>
                <dd className="break-words min-w-0">{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Body text — always show if present, even when details exist */}
        {content && (
          <p className="mt-1 pl-6 text-xs text-neutral-500 dark:text-neutral-400 break-words">
            {content}
          </p>
        )}

        {/* Action hints */}
        {meta.actions && meta.actions.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-2 pl-6">
            {meta.actions.map((action) => (
              <span
                key={action}
                className="text-[11px] text-neutral-400 dark:text-neutral-500"
              >
                {action}
              </span>
            ))}
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <div className="mt-1 pl-6 text-[11px] text-neutral-400 dark:text-neutral-500">
            {new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}
```

**Accessibility notes:** `role="alert"` on failure bubbles ensures screen readers announce them immediately. `role="status"` on informational bubbles provides polite announcements. `aria-hidden="true"` on icons avoids redundant announcements. Text sizes use `text-xs` (12px) minimum for readability, with `text-[11px]` only for secondary metadata.

---

### Step 4: Wire SystemBubble into MessageList

**`src/components/chat/MessageList.tsx`** — Conditional render:

In the messages map (currently at line ~168-173), check for `systemMeta`:

```typescript
import { SystemBubble } from './SystemBubble';

// Inside the messages.map:
{messages.map((message, index) => {
  if (message.role === 'system' && message.systemMeta) {
    return (
      <SystemBubble
        key={message._id ?? `${message.timestamp ?? index}-system-${message.systemMeta.kind}`}
        meta={message.systemMeta}
        content={message.content}
        timestamp={message.timestamp}
      />
    );
  }
  return (
    <MessageBubble
      key={message._id ?? `${message.timestamp ?? index}-${message.role}-${message.content.slice(0, 20)}`}
      message={message}
    />
  );
})}
```

**Note on keys:** Prefer the `_id` field (set by `addChatMessage` in the store) for stable, collision-free keys. Fall back to timestamp-based keys for messages loaded before `_id` was available.

**Unread indicator fix** (currently at line ~116-120): Include system messages in the new-message indicator so failure/compaction bubbles aren't silently missed when the user is scrolled up:

```typescript
// CURRENT (assistant-only):
if (latestMessage?.role === 'assistant') {
  setHasNewMessages(true);
}

// FIXED (assistant + critical system):
if (
  latestMessage?.role === 'assistant' ||
  (latestMessage?.role === 'system' && latestMessage.systemMeta &&
    ['failure', 'completion', 'compaction', 'decision'].includes(latestMessage.systemMeta.kind))
) {
  setHasNewMessages(true);
}
```

**`src/components/chat/index.ts`** — Export `SystemBubble`.

---

### Step 5: Durable Gateway Event Bus

Compaction, completion, and failure events can all arrive while the user is idle (no active `sendChatMessage` call). The current event subscription is local to each `sendViaTauriWs` call (`src/lib/gateway.ts:662-835`) and ends when the send resolves. We need a persistent, app-lifetime subscription layer.

**`src/lib/gateway.ts`** — Add a durable event subscription:

```typescript
type SystemEventKind = 'compaction' | 'error' | 'announce';

interface SystemEvent {
  kind: SystemEventKind;
  sessionKey?: string;
  runId?: string;
  label?: string;
  message?: string;
  status?: string;
  runtime?: string;
  tokens?: string;
  raw?: Record<string, unknown>;
}

type SystemEventListener = (event: SystemEvent) => void;

let systemEventUnsubscribe: (() => void) | null = null;
const systemEventListeners = new Set<SystemEventListener>();
const ACTIVE_SEND_DEDUP_WINDOW_MS = 120_000;
let activeSendRun: { runId: string; startedAt: number } | null = null;

export function markActiveSendRun(runId: string): void {
  activeSendRun = { runId, startedAt: Date.now() };
}

export function clearActiveSendRun(runId?: string): void {
  if (!activeSendRun) return;
  if (!runId || activeSendRun.runId === runId) {
    activeSendRun = null;
  }
}

function shouldSuppressForActiveSend(runId?: string): boolean {
  if (!runId || !activeSendRun) return false;
  if (activeSendRun.runId !== runId) return false;
  return Date.now() - activeSendRun.startedAt <= ACTIVE_SEND_DEDUP_WINDOW_MS;
}

/**
 * Subscribe to system-level gateway events (compaction, errors, announces)
 * that occur outside of active chat exchanges.
 * Returns unsubscribe function.
 */
export function subscribeSystemEvents(listener: SystemEventListener): () => void {
  systemEventListeners.add(listener);
  return () => systemEventListeners.delete(listener);
}

/**
 * Wire the durable event bus to the WS connection.
 * Call once after Phase A's getConnectionInstance() is available.
 * Idempotent — safe to call on reconnect.
 */
export async function wireSystemEventBus(): Promise<void> {
  // Tear down previous subscription if re-wiring (reconnect scenario)
  if (systemEventUnsubscribe) {
    systemEventUnsubscribe();
    systemEventUnsubscribe = null;
  }

  const { getConnectionInstance } = await import('./tauri-websocket');
  const connection = getConnectionInstance();
  if (!connection) return;

  systemEventUnsubscribe = connection.subscribe((eventName: string, payload: unknown) => {
    if (eventName !== 'chat') return;

    const chat = (typeof payload === 'object' && payload !== null
      ? payload
      : {}) as Record<string, unknown>;
    const state = typeof chat.state === 'string' ? chat.state : '';
    const sessionKey = typeof chat.sessionKey === 'string' ? chat.sessionKey : undefined;
    const runId = typeof chat.runId === 'string' ? chat.runId : undefined;

    // Dedup against active foreground send: the per-send subscriber already owns these.
    if (
      shouldSuppressForActiveSend(runId) &&
      (state === 'announce' || state === 'error' || state === 'final')
    ) {
      return;
    }

    // Compaction detection
    if (state === 'compacted' || state === 'compacting' || state === 'compaction_complete') {
      emit({ kind: 'compaction', sessionKey, runId, message: 'Conversation compacted' });
    }

    // Background error detection (errors outside active send are not caught by sendViaTauriWs)
    if (state === 'error') {
      emit({
        kind: 'error',
        sessionKey,
        runId,
        message: typeof chat.errorMessage === 'string' ? chat.errorMessage : 'Unknown error',
        label: typeof chat.label === 'string' ? chat.label : undefined,
      });
    }

    // Announce detection and classification (structured parser first, guarded fallback)
    const announce = parseAnnounceMetadata(chat, true);
    if (announce) {
      emit({
        kind: 'announce',
        sessionKey: announce.sessionKey ?? sessionKey,
        runId: announce.runId ?? runId,
        label: announce.label,
        status: announce.status,
        runtime: announce.runtime,
        tokens: announce.tokens,
        message: typeof chat.message === 'string' ? chat.message : undefined,
        raw: chat,
      });
    }
  });
}

function emit(event: SystemEvent): void {
  systemEventListeners.forEach((listener) => {
    try { listener(event); } catch (e) { console.error('[Gateway] System event listener error:', e); }
  });
}

/**
 * Tear down the durable event bus. Call on app unmount.
 */
export function teardownSystemEventBus(): void {
  if (systemEventUnsubscribe) {
    systemEventUnsubscribe();
    systemEventUnsubscribe = null;
  }
  systemEventListeners.clear();
}
```

**Lifecycle:** The event bus is owned by `App.tsx`. It is wired once on mount after the connection is established, re-wired on reconnect via Phase A's `subscribeConnectionState`, and torn down on unmount.

**Reconnect rebinding:** When Phase A's connection state transitions to `'connected'` (including after a reconnect), call `wireSystemEventBus()` to rebind. This replaces any stale subscription from the previous connection.

**Deduplication policy (concrete):**
- **Gateway-level active-send dedup window:** `sendViaTauriWs` must call `markActiveSendRun(runId)` immediately before `chat.send`, and call `clearActiveSendRun(runId)` in all terminal paths (`final` resolve, `error`, `aborted`, timeout). While active and within `ACTIVE_SEND_DEDUP_WINDOW_MS` (120s), the durable bus suppresses matching `announce`/`error`/`final` events for that `runId`.
- **Announce lifecycle set/clear:** App-layer announce handling keeps an `activeAnnounceRuns` map keyed by `runId`. Set on announce start (`status: started|running`), clear on terminal announce (`ok|error|timeout`).
- **Terminal announce dedup window:** App-layer keeps `seenTerminalAnnounceRuns` (`runId` -> timestamp). If a terminal announce for the same `runId` arrives again within `ANNOUNCE_TERMINAL_DEDUP_MS` (45s), drop it.
- **Persistence tie-in:** `runId` is stored on `SystemBubbleMeta.runId` so replays/history loads can still reason about duplicate terminal bubbles.

Placement in `sendViaTauriWs`:

```typescript
markActiveSendRun(runId);
try {
  await connection.request('chat.send', { sessionKey, message: messageText, idempotencyKey: runId });
  // ...existing event wait / completion logic...
} catch (error) {
  clearActiveSendRun(runId);
  throw error;
} finally {
  clearActiveSendRun(runId);
}
```

---

### Step 6: Compaction Awareness (Durable Bus → Bubble)

Compaction events must be detected globally, not just during active sends.

**`src/lib/gateway.ts`** — Add compaction to `stateLabels` (line ~751):

```typescript
const stateLabels: Record<string, string> = {
  // ...existing states...
  compacting: 'Compacting conversation...',
  compacted: 'Compacting conversation...',
};
```

**`src/App.tsx`** — Subscribe to system events on mount:

```typescript
useEffect(() => {
  // Wire the durable event bus after connection is ready
  void wireSystemEventBus();

  const unsubscribe = subscribeSystemEvents((event) => {
    if (event.kind === 'compaction') {
      addSystemBubble('compaction', 'Conversation compacted', {
        'Note': 'Older messages were summarized to free context space',
      }, undefined, event.runId);
    }
  });

  // Re-wire on reconnect (Phase A provides subscribeConnectionState)
  const unsubConnState = subscribeConnectionState((state) => {
    if (state === 'connected') {
      void wireSystemEventBus();
    }
  });

  return () => {
    unsubscribe();
    unsubConnState();
    teardownSystemEventBus();
  };
}, []);
```

**Discovery needed:** The exact gateway event state string for compaction is unconfirmed. Candidates: `compacting`, `compacted`, `compaction_complete`. During development, add a temporary catch-all log in the durable bus:

```typescript
console.log('[Gateway] system event bus received:', state, chat);
```

Trigger a compaction by having a long conversation (~50+ messages) and observe the actual state value. Update the bus filter accordingly.

---

### Step 7: Completion Delivery (Structured Parsing First)

When a sub-agent completes, OpenClaw sends an announce to the scoped session. With Phase A's session key fix, these will arrive at `agent:main:pipeline-dashboard`.

**Detection strategy (structured first, heuristic fallback):**

1. **Primary: Structured gateway event fields.** The durable event bus checks for `state === 'announce'`, `chat.announce === true`, or `chat.subagentResult !== undefined`. These are deterministic and cannot false-positive on normal assistant text.

2. **Fallback: Content pattern matching (guarded).** Only applied when the structured fields are absent AND additional guards are satisfied. The fallback is NOT applied to messages from normal assistant responses — only to messages that arrive via the durable event bus (i.e., outside an active user send).

**`src/lib/gateway.ts`** — Add announce parsing helper:

```typescript
interface AnnounceMetadata {
  label?: string;
  runtime?: string;
  status?: 'started' | 'running' | 'ok' | 'error' | 'timeout';
  tokens?: string;
  sessionKey?: string;
  runId?: string;
}

function normalizeAnnounceStatus(
  rawStatus: unknown,
  messageText: string,
): AnnounceMetadata['status'] {
  const normalized = typeof rawStatus === 'string' ? rawStatus.toLowerCase() : '';
  if (['start', 'started', 'queued'].includes(normalized)) return 'started';
  if (['running', 'in_progress'].includes(normalized)) return 'running';
  if (['ok', 'success', 'completed', 'complete', 'finished'].includes(normalized)) return 'ok';
  if (['error', 'failed', 'failure'].includes(normalized)) return 'error';
  if (['timeout', 'timed_out', 'timed-out'].includes(normalized)) return 'timeout';

  // Fallback to content hints when status field is absent/ambiguous
  if (/(timed?\s*out)/i.test(messageText)) return 'timeout';
  if (/(failed|error)/i.test(messageText)) return 'error';
  if (/(completed|finished|succeeded)/i.test(messageText)) return 'ok';
  return undefined;
}

/**
 * Parse structured announce metadata from a gateway event payload.
 * Returns null if the payload is not an announce.
 *
 * Strategy: check structured fields first; only fall back to content
 * pattern matching when the event came from the system event bus
 * (indicated by fromEventBus=true) to avoid false positives on
 * normal assistant text.
 */
export function parseAnnounceMetadata(
  eventPayload: Record<string, unknown>,
  fromEventBus: boolean = false,
): AnnounceMetadata | null {
  const messageText = typeof eventPayload.message === 'string' ? eventPayload.message : '';

  // Primary: structured event fields
  if (
    eventPayload.announce === true ||
    eventPayload.subagentResult !== undefined ||
    eventPayload.state === 'announce'
  ) {
    return {
      label: typeof eventPayload.label === 'string' ? eventPayload.label : undefined,
      runtime: typeof eventPayload.runtime === 'string' ? eventPayload.runtime : undefined,
      status: normalizeAnnounceStatus(eventPayload.status, messageText),
      tokens: typeof eventPayload.tokens === 'string' ? eventPayload.tokens : undefined,
      sessionKey: typeof eventPayload.sessionKey === 'string' ? eventPayload.sessionKey : undefined,
      runId: typeof eventPayload.runId === 'string' ? eventPayload.runId : undefined,
    };
  }

  // Fallback: content-based heuristic — ONLY from event bus, never on history fetch
  if (fromEventBus) {
    // Only match if content explicitly looks like an announce
    // Require both a status indicator AND a structural marker
    const isAnnounce =
      /(?:sub-?agent|task|background job)\s+(?:completed|finished|failed|timed?\s*out)/i.test(messageText);

    if (isAnnounce) {
      return {
        status: normalizeAnnounceStatus(undefined, messageText),
        runId: typeof eventPayload.runId === 'string' ? eventPayload.runId : undefined,
      };
    }
  }

  return null;
}
```

**`src/App.tsx`** — Handle announce events from the durable bus (add to the `subscribeSystemEvents` callback):

```typescript
const ANNOUNCE_TERMINAL_DEDUP_MS = 45_000;
const activeAnnounceRunsRef = useRef<Map<string, number>>(new Map());
const seenTerminalAnnounceRunsRef = useRef<Map<string, number>>(new Map());

function pruneExpiredRuns(map: Map<string, number>, ttlMs: number): void {
  const now = Date.now();
  for (const [runId, ts] of map.entries()) {
    if (now - ts > ttlMs) map.delete(runId);
  }
}

if (event.kind === 'announce') {
  const status = (event.status ?? '').toLowerCase();
  const runId = event.runId;
  const isStart = status === 'started' || status === 'running';
  const isFailure = status === 'error' || status === 'timeout';
  const isSuccess = status === 'ok';
  const isTerminal = isFailure || isSuccess;
  const now = Date.now();

  // Keep maps bounded.
  pruneExpiredRuns(activeAnnounceRunsRef.current, 10 * 60_000);
  pruneExpiredRuns(seenTerminalAnnounceRunsRef.current, ANNOUNCE_TERMINAL_DEDUP_MS);

  // Set run lifecycle on announce start.
  if (runId && isStart) {
    activeAnnounceRunsRef.current.set(runId, now);
    return;
  }

  // Clear lifecycle + dedupe terminal repeats.
  if (runId && isTerminal) {
    const seenAt = seenTerminalAnnounceRunsRef.current.get(runId);
    if (seenAt && now - seenAt < ANNOUNCE_TERMINAL_DEDUP_MS) {
      return;
    }
    seenTerminalAnnounceRunsRef.current.set(runId, now);
    activeAnnounceRunsRef.current.delete(runId);
  }

  // Ignore non-terminal progress announces (already tracked via activeAnnounceRunsRef).
  if (!isTerminal) return;

  addSystemBubble(
    isFailure ? 'failure' : 'completion',
    isFailure ? 'Sub-agent failed' : 'Sub-agent completed',
    {
      ...(event.label ? { 'Label': event.label } : {}),
      ...(event.runtime ? { 'Runtime': event.runtime } : {}),
      ...(event.status ? { 'Status': event.status } : {}),
    },
    isFailure ? ['Check logs for details'] : undefined,
    runId,
  );
}
```

**Rendering rule (deterministic):** When an announce is detected and rendered as a system bubble, the raw announce content is stored as the bubble's `content` field (shown as body text below the structured header). The raw content is NOT also rendered as a separate `MessageBubble`. This avoids confusing duplication. If the announce contains a natural-language summary, it will be visible in the bubble body.

---

### Step 8: Failure Alerts (Error Events → Bubble)

Failures come from three sources:

#### 8a. Gateway `error` state events (background)

The durable event bus (Step 5) already detects `state === 'error'` events globally, including those that occur outside an active `sendViaTauriWs` call.

**`src/App.tsx`** — Handle error events from the durable bus (add to the `subscribeSystemEvents` callback):

```typescript
if (event.kind === 'error') {
  addSystemBubble('failure', 'Background task failed', {
    'Error': event.message ?? 'Unknown error',
    ...(event.label ? { 'Task': event.label } : {}),
  }, ['Check logs for details'], event.runId);
}
```

#### 8b. Gateway `error` during active send

Already handled in `sendViaTauriWs` — state `'error'` rejects the promise, and `sendChatMessage` in `App.tsx` catches the rejection and adds an error system message. No additional code needed.

#### 8c. Process session crashes (coding agent polling)

The spec requires polling `process action:poll` periodically for active background sessions (`docs/specs/chat-infrastructure-phase-b-spec.md:73-77`). This is NOT covered by gateway events alone — a crashed process may not emit a clean error event.

**`src/lib/gateway.ts`** — Add process session health check:

```typescript
/**
 * Poll for background coding agent session health.
 * Call periodically (e.g., every 30s) while background sessions are active.
 * Uses the existing tauri-ws request path (TauriOpenClawConnection.request).
 * Returns sessions that have exited abnormally.
 */
export async function pollProcessSessions(
  sessionKeys: string[],
  transportOverride?: GatewayTransport,
): Promise<Array<{ sessionKey: string; exitCode: number; error?: string }>> {
  const failures: Array<{ sessionKey: string; exitCode: number; error?: string }> = [];
  const transport = await resolveTransport(transportOverride);
  if (transport.mode !== 'tauri-ws') return failures;

  const { getTauriOpenClawConnection } = await import('./tauri-websocket');
  const connection = await getTauriOpenClawConnection(
    transport.wsUrl,
    transport.sessionKey || 'agent:main:main',
    transport.token,
  );

  for (const sessionKey of sessionKeys) {
    try {
      const result = await connection.request<{ exitCode?: number; error?: string }>('process', {
        action: 'poll',
        sessionKey,
      });
      // If process exited with non-zero code, it's a failure
      if (result?.exitCode !== undefined && result.exitCode !== 0) {
        failures.push({
          sessionKey,
          exitCode: result.exitCode,
          error: typeof result.error === 'string' ? result.error : undefined,
        });
      }
    } catch {
      // Poll failure itself is not a process crash — ignore
    }
  }

  return failures;
}
```

**`src/App.tsx`** — Wire periodic polling (only when background sessions are known to be active):

```typescript
// Track active background session keys (reactive so polling effect starts/stops correctly)
const [activeBackgroundSessions, setActiveBackgroundSessions] = useState<Set<string>>(new Set());

// Call this when parsing a sessions_spawn result
const registerBackgroundSession = useCallback((sessionKey: string) => {
  setActiveBackgroundSessions((prev) => {
    if (prev.has(sessionKey)) return prev;
    const next = new Set(prev);
    next.add(sessionKey);
    return next;
  });
}, []);

useEffect(() => {
  if (activeBackgroundSessions.size === 0) return;

  const interval = setInterval(async () => {
    const keys = [...activeBackgroundSessions];
    if (keys.length === 0) return;

    const failures = await pollProcessSessions(keys);
    if (failures.length === 0) return;

    setActiveBackgroundSessions((prev) => {
      const next = new Set(prev);
      for (const failure of failures) next.delete(failure.sessionKey);
      return next;
    });

    for (const failure of failures) {
      addSystemBubble('failure', 'Coding agent crashed', {
        'Session': failure.sessionKey,
        'Exit code': String(failure.exitCode),
        ...(failure.error ? { 'Error': failure.error } : {}),
      }, ['Check logs for details']);
    }
  }, 30_000); // Every 30 seconds

  return () => clearInterval(interval);
}, [activeBackgroundSessions]);
```

**Note:** The set of active background session keys must be populated when `sessions_spawn` is called from the chat. This requires tracking the session keys returned by spawn results. For Phase B, the simplest approach is to parse spawn results from assistant messages and add session keys to the set. Full lifecycle management is Phase C territory.

---

### Step 9: Decision Surfacing — Agent Rules

This is primarily an agent behavior change, not a UI change. Decision messages from the agent will render as normal assistant messages in Phase B. The structured decision bubble UI is Phase C.

**`AGENTS.md`** (this repo) — Add Decision Escalation section:

```markdown
## Decision Escalation

When orchestrating sub-agents or coding agents:

### Always surface to user:
- Architecture/approach decisions (option A vs B)
- Plan review recommendations and suggested changes
- Scope changes ("should we also do X?")
- Error recovery options (retry, reduce scope, skip)
- Technology/library selection
- Breaking changes or data migrations
- Anything that changes what gets built

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

**Out-of-repo AGENTS.md (sandbox):** Not included as a build step since it's not in this repo and can't be validated by CI. Add a follow-up task to manually sync decision escalation rules to the sandbox AGENTS.md after Phase B lands.

---

### Step 10: Helper — `addSystemBubble` Convenience Function

To avoid boilerplate, add a helper to the store.

**`src/lib/store.ts`** — Add to `DashboardState` interface:

```typescript
addSystemBubble: (
  kind: SystemBubbleKind,
  title: string,
  details?: Record<string, string>,
  actions?: string[],
  runId?: string,
) => Promise<void>;
```

**`src/lib/store.ts`** — Add implementation alongside `addChatMessage`:

```typescript
addSystemBubble: async (kind, title, details, actions, runId) => {
  return get().addChatMessage({
    role: 'system',
    content: title,
    timestamp: Date.now(),
    systemMeta: { kind, title, details, actions, ...(runId ? { runId } : {}) },
  });
},
```

Then callers become one-liners:

```typescript
addSystemBubble('compaction', 'Conversation compacted', { 'Note': 'Older messages summarized' });
addSystemBubble('failure', 'Sub-agent failed', { 'Error': 'OOM killed', 'Task': 'Phase B plan' });
addSystemBubble('completion', 'Sub-agent completed', { 'Runtime': '2m 10s' }, undefined, 'run_abc123');
```

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `src/lib/gateway.ts` | Extend `ChatMessage` with `systemMeta` + `_id`, add `SystemBubbleMeta` with `runId`, add `SystemBubbleKind`, add `parseAnnounceMetadata()` with status normalization, add durable system event bus (`subscribeSystemEvents`, async `wireSystemEventBus`, `teardownSystemEventBus`), add active-send `runId` dedup helpers, add `pollProcessSessions()` via tauri-ws `connection.request('process', ...)`, add compaction state labels |
| `src/components/chat/SystemBubble.tsx` | **New file** — center-aligned, icon-driven system bubble component with ARIA roles |
| `src/components/chat/MessageList.tsx` | Conditional render: `SystemBubble` for system messages with meta, `MessageBubble` for everything else. Unread indicator includes critical system messages including compaction. |
| `src/components/chat/MessageBubble.tsx` | No changes (existing system message styling remains as fallback for system messages without `systemMeta`) |
| `src/components/chat/index.ts` | Export `SystemBubble` |
| `src/lib/store.ts` | Add `addSystemBubble` convenience method with optional `runId`, add `deserializePersistedMessage` helper, fix `addChatMessage` to serialize metadata, fix `loadChatMessages` and `loadMoreChatMessages` to deserialize metadata |
| `src/lib/tauri.ts` | No changes (existing `PersistedChatMessage` already has `metadata?: string`) |
| `src-tauri/src/lib.rs` | No changes (existing `ChatMessage` struct already has `metadata: Option<String>`, schema already has `metadata TEXT` column) |
| `src/App.tsx` | Wire durable event bus on mount, subscribe to system events for compaction/announce/error, implement announce lifecycle `runId` set/clear + terminal dedup window, re-wire on reconnect, process session health polling with reactive `useState` session tracking, teardown on unmount |
| `AGENTS.md` (this repo only) | Add Decision Escalation rules |

---

## Verification

### Manual Testing

1. **System bubble rendering:** Call `addSystemBubble('completion', 'Test completion', { 'Runtime': '30s' })` from browser console → verify centered, muted, icon-driven bubble appears
2. **All bubble kinds:** Test each kind (completion ✅, failure ❌, compaction 🧹, decision 🔷, info ℹ️) → verify correct icon, color, border, and ARIA role
3. **Compaction detection (global):** Have a long conversation (~50+ messages). Close the chat input (so no active send). Wait for auto-compaction → verify compaction bubble appears even though no send was in progress
4. **Completion delivery:** Use `sessions_spawn` from dashboard chat to run a small task → verify completion bubble appears when sub-agent finishes
5. **Failure alert (announce):** Spawn a sub-agent with a very short timeout (e.g., 5s) on a task that takes longer → verify failure bubble appears
6. **Failure alert (background error):** Stop the gateway while idle → verify error bubble appears (not silence)
7. **Process crash detection:** If a background coding agent session is active, kill it → verify failure bubble appears via process polling
8. **Persistence round-trip:** Send a system bubble → close and reopen drawer → verify bubble persists from SQLite with correct structured metadata (icon, title, details all preserved)
9. **Persistence pagination:** Load enough messages to trigger "load more" pagination → verify older system bubbles retain their structured metadata after pagination load
10. **Fallback rendering:** System messages WITHOUT `systemMeta` → verify they still render as plain system messages via `MessageBubble` (backward compat)
11. **No duplicate rendering:** When an announce arrives via the event bus → verify exactly ONE bubble appears (not both a system bubble and a separate assistant message)
12. **Unread indicator:** Scroll up in a long conversation. Trigger a failure, completion, or compaction bubble → verify "new messages" indicator appears
13. **Decision surfacing:** Ask the orchestrating agent to run a `/plan` review → verify decisions are surfaced in chat as assistant messages (not silently resolved)
14. **Reconnect rebinding:** Disconnect WS → reconnect → trigger a system event → verify the durable event bus still receives it (no stale subscription)
15. **Mobile overflow:** Add a system bubble with a very long label or error message → verify text wraps properly on narrow screens (no horizontal overflow)
16. **Accessibility:** Use a screen reader with a failure bubble → verify it is announced as an alert

### Automated

- `bun run typecheck` — TypeScript compiles with new types (`SystemBubbleMeta`, `SystemBubbleKind`, extended `ChatMessage`)
- `bun test` — existing tests pass (no behavioral changes to project/roadmap logic)
- `bun run build` — production build succeeds

### Build Validation

- `bun run validate` (typecheck + test + build) passes before commit

### Missing Test Scenarios (Add During Build)

1. **Persistence round-trip unit test:** Save a `ChatMessage` with `systemMeta` → load it back → assert `systemMeta` is fully restored (kind, title, details, actions)
2. **Migration compatibility test:** Load messages from an existing `chat.db` that has `metadata` column with `null` values → assert no errors, messages load as plain `ChatMessage` without `systemMeta`
3. **Announce classification tests:** Feed `parseAnnounceMetadata` with various payloads:
   - Structured announce (`announce: true`) → returns metadata ✅
   - Normal assistant text containing "task completed" → returns `null` (not a false positive) ✅
   - Event bus fallback with "sub-agent completed" → returns metadata ✅
   - Normal assistant text with emoji (✅, ❌) but no structural marker → returns `null` ✅
4. **Compaction event outside active send:** Mock a compaction event arriving with no active `sendViaTauriWs` call → verify system bubble is emitted
5. **Background error listener reconnect:** Simulate disconnect → reconnect → verify single listener (no duplicate bubbles from stale subscriptions)
6. **Unread indicator for system bubbles:** Add a failure bubble while `userScrolled` is true → verify `hasNewMessages` is set
7. **Duplicate suppression:** Same announce observed via both event bus and history fetch → verify only one bubble rendered
8. **Announce lifecycle dedup:** Emit `announce` start for `runId=X`, then terminal `ok`, then duplicate terminal `ok` within 45s → verify exactly one terminal bubble and `runId=X` removed from active lifecycle set

---

## Discovery Items (Resolve During Build)

1. **Compaction state event name** — Add `console.log('[Gateway] system event bus received:', state, chat)` in the durable bus, trigger a compaction, and note the exact state value. Update the bus filter. Candidates: `compacting`, `compacted`, `compaction_complete`.

2. **Announce format** — Sub-agent announces arrive via the gateway. Verify the exact event payload structure from a real `sessions_spawn` to confirm which structured fields (`announce`, `subagentResult`, `state: 'announce'`) are present. Tune `parseAnnounceMetadata` accordingly.

3. **Active send deduplication validation** — Test whether the durable bus and the per-send subscriber in `sendViaTauriWs` both fire for the same event, and verify Step 5 suppression (`markActiveSendRun`/`clearActiveSendRun`) prevents duplicate bubbles for the same `runId`.

4. **Background session tracking** — Determine how `sessions_spawn` results are structured and how to extract session keys for the process polling in Step 8c. This may require parsing the assistant's response or adding structured tracking.

---

## Estimate

- Steps 1-4 (types + persistence fix + component + wiring): ~1 day
- Steps 5-6 (durable event bus + compaction): ~0.5 day
- Steps 7-8 (completion + failure with structured parsing + process polling): ~1 day
- Steps 9-10 (decision rules + helper): ~0.5 day

**Total: ~3 days of focused build time.**
