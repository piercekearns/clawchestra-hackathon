# Chat Infrastructure Phase B: Implementation Plan

## Context

Phase B adds **awareness** — the user should always know what's happening. Sub-agent completions, failures, compaction events, and architecture decisions must all surface visibly in the chat. Phase A (scoped sessions + WS reliability) must be complete first.

**Spec:** `docs/specs/chat-infrastructure-phase-b-spec.md`
**Depends on:** `docs/plans/chat-infrastructure-phase-a-plan.md` (session key, state machine, system messages)

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
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: number;
  systemMeta?: SystemBubbleMeta;      // Only present when role === 'system'
}
```

**`src/lib/chat-db.ts`** (or wherever `chatMessageSave` lives) — Add `system_meta` column:

- Add nullable `system_meta TEXT` column to the messages table
- Serialize as JSON on save, parse on load
- Migration: `ALTER TABLE chat_messages ADD COLUMN system_meta TEXT`
- Existing messages without the column get `null` (backward compatible)

**`src-tauri/src/lib.rs`** — Update the Rust `ChatMessageRow` struct:

```rust
#[derive(Debug, Serialize, Deserialize)]
struct ChatMessageRow {
    id: String,
    role: String,
    content: String,
    timestamp: i64,
    #[serde(default)]
    system_meta: Option<String>,  // JSON blob
}
```

Update `chat_message_save` to accept and store the field.
Update `chat_messages_load` to return it.

---

### Step 2: SystemBubble Component

New file: **`src/components/chat/SystemBubble.tsx`**

```typescript
import { CheckCircle2, XCircle, Trash2, HelpCircle, Info } from 'lucide-react';
import type { SystemBubbleMeta } from '../../lib/gateway';
import { cn } from '../../lib/utils';

const ICONS: Record<string, typeof CheckCircle2> = {
  completion: CheckCircle2,
  failure: XCircle,
  compaction: Trash2,
  decision: HelpCircle,
  info: Info,
};

const COLORS: Record<string, string> = {
  completion: 'text-green-500 dark:text-green-400',
  failure: 'text-red-500 dark:text-red-400',
  compaction: 'text-neutral-400 dark:text-neutral-500',
  decision: 'text-blue-500 dark:text-blue-400',
  info: 'text-neutral-500 dark:text-neutral-400',
};

const BORDER_COLORS: Record<string, string> = {
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
  const Icon = ICONS[meta.kind] ?? Info;
  const iconColor = COLORS[meta.kind] ?? COLORS.info;
  const borderColor = BORDER_COLORS[meta.kind] ?? BORDER_COLORS.info;

  return (
    <div className="flex justify-center px-4 py-1">
      <div
        className={cn(
          'max-w-[85%] rounded-lg border px-3 py-2',
          'bg-neutral-50/50 dark:bg-neutral-900/50',
          borderColor,
        )}
      >
        {/* Header: icon + title */}
        <div className="flex items-center gap-2">
          <Icon className={cn('h-4 w-4 flex-shrink-0', iconColor)} />
          <span className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
            {meta.title}
          </span>
        </div>

        {/* Detail rows */}
        {meta.details && Object.keys(meta.details).length > 0 && (
          <dl className="mt-1.5 space-y-0.5 pl-6 text-[11px] text-neutral-500 dark:text-neutral-400">
            {Object.entries(meta.details).map(([key, value]) => (
              <div key={key} className="flex gap-1.5">
                <dt className="font-medium">{key}:</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {/* Body text (if any beyond what details cover) */}
        {content && !meta.details && (
          <p className="mt-1 pl-6 text-[11px] text-neutral-500 dark:text-neutral-400">
            {content}
          </p>
        )}

        {/* Action hints */}
        {meta.actions && meta.actions.length > 0 && (
          <div className="mt-1.5 flex gap-2 pl-6">
            {meta.actions.map((action) => (
              <span
                key={action}
                className="text-[10px] text-neutral-400 dark:text-neutral-500"
              >
                {action}
              </span>
            ))}
          </div>
        )}

        {/* Timestamp */}
        {timestamp && (
          <div className="mt-1 pl-6 text-[10px] text-neutral-400 dark:text-neutral-500">
            {new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </div>
        )}
      </div>
    </div>
  );
}
```

---

### Step 3: Wire SystemBubble into MessageList

**`src/components/chat/MessageList.tsx`** — Conditional render:

In the message map, check for `systemMeta`:

```typescript
import { SystemBubble } from './SystemBubble';

// Inside the messages.map:
{messages.map((message, index) => {
  if (message.role === 'system' && message.systemMeta) {
    return (
      <SystemBubble
        key={`${message.timestamp ?? index}-system-${message.systemMeta.kind}`}
        meta={message.systemMeta}
        content={message.content}
        timestamp={message.timestamp}
      />
    );
  }
  return (
    <MessageBubble
      key={`${message.timestamp ?? index}-${message.role}-${message.content.slice(0, 20)}`}
      message={message}
    />
  );
})}
```

**`src/components/chat/index.ts`** — Export `SystemBubble`.

---

### Step 4: Compaction Awareness (Simplest — Gateway Event → Bubble)

This is the lowest-hanging fruit. The gateway emits state events during chat processing. We need to detect compaction and render a bubble.

**`src/lib/gateway.ts`** — Add compaction to `stateLabels` (line ~752):

```typescript
const stateLabels: Record<string, string> = {
  // ...existing states...
  compacting: 'Compacting conversation...',
  compacted: 'Compacting conversation...',
};
```

**`src/lib/gateway.ts`** — In the WS event subscriber (inside `sendViaTauriWs`), add compaction detection:

After the existing state handling block (~line 784), add:

```typescript
// Detect compaction events
if (state === 'compacted' || state === 'compaction_complete') {
  // Emit a callback so the UI can add a system bubble
  if (onCompaction) {
    onCompaction();
  }
}
```

Add `onCompaction?: () => void` to the options parameter of `sendViaTauriWs`.

**`src/App.tsx`** — In the `handleSend` function, pass an `onCompaction` callback:

```typescript
onCompaction: () => {
  addChatMessage({
    role: 'system',
    content: 'Older messages summarized to free context space.',
    timestamp: Date.now(),
    systemMeta: {
      kind: 'compaction',
      title: 'Conversation compacted',
      details: { 'Note': 'Older messages were summarized to free space' },
    },
  });
},
```

**Discovery needed:** Check the actual gateway event name for compaction. Candidates: `compacting`, `compacted`, `compaction_complete`. Test by having a long conversation and watching `console.log` in the WS subscriber for the actual state string. Add a temporary catch-all log:

```typescript
console.log('[Gateway] state event:', state, chat);
```

---

### Step 5: Completion Delivery (Sub-Agent Announces → Bubble)

When a sub-agent completes, OpenClaw sends an announce message to the scoped session. With Phase A's session key fix, these will arrive at `agent:main:pipeline-dashboard`.

The announce arrives as a normal assistant message containing structured metadata. We need to detect it and render a completion bubble.

**`src/lib/gateway.ts`** — Add announce detection helper:

```typescript
interface AnnounceMetadata {
  label?: string;
  runtime?: string;
  status?: string;
  tokens?: string;
  sessionKey?: string;
}

/**
 * Detect if a message is a sub-agent announce and extract metadata.
 * Announces follow a pattern: "✅ Sub-agent completed: <label>" or similar.
 * The gateway may also include structured metadata in the event payload.
 */
export function parseAnnounceMetadata(
  content: string,
  eventPayload?: Record<string, unknown>,
): AnnounceMetadata | null {
  // Check event payload first (structured data from gateway)
  if (eventPayload?.announce === true || eventPayload?.subagentResult !== undefined) {
    return {
      label: typeof eventPayload.label === 'string' ? eventPayload.label : undefined,
      runtime: typeof eventPayload.runtime === 'string' ? eventPayload.runtime : undefined,
      status: typeof eventPayload.status === 'string' ? eventPayload.status : 'ok',
      tokens: typeof eventPayload.tokens === 'string' ? eventPayload.tokens : undefined,
      sessionKey: typeof eventPayload.sessionKey === 'string' ? eventPayload.sessionKey : undefined,
    };
  }

  // Fallback: pattern-match on content text
  // Sub-agent announces typically contain "sub-agent" or "task completed" or start with emoji indicators
  // This is heuristic — refine once we see real announce formats
  const announcePatterns = [
    /sub-?agent\s+(completed|finished|done)/i,
    /task\s+(completed|finished|done)/i,
    /^✅\s/,
    /^❌\s/,
  ];

  if (announcePatterns.some((p) => p.test(content))) {
    return {
      status: content.startsWith('❌') ? 'error' : 'ok',
    };
  }

  return null;
}
```

**`src/App.tsx`** — In the message processing after `sendViaTauriWs` resolves, check new assistant messages for announces:

```typescript
// After receiving assistant messages, check for announces
for (const msg of newAssistantMessages) {
  const announce = parseAnnounceMetadata(msg.content);
  if (announce) {
    // Add a system bubble BEFORE the announce content
    addChatMessage({
      role: 'system',
      content: msg.content,
      timestamp: Date.now(),
      systemMeta: {
        kind: announce.status === 'error' ? 'failure' : 'completion',
        title: announce.status === 'error' ? 'Sub-agent failed' : 'Sub-agent completed',
        details: {
          ...(announce.label ? { 'Label': announce.label } : {}),
          ...(announce.runtime ? { 'Runtime': announce.runtime } : {}),
          ...(announce.status ? { 'Status': announce.status } : {}),
        },
      },
    });
    // Don't also render as a normal message (or do — user preference)
  }
}
```

**Note:** The announce detection is heuristic for Phase B. Phase C can add structured metadata from the gateway event payload for reliable detection. For now, pattern-matching on content is good enough.

---

### Step 6: Failure Alerts (Error Events → Bubble)

Failures come from two sources:

#### 6a. Gateway `error` state events

Already handled in `sendViaTauriWs` — state `'error'` rejects the promise. But this only covers errors during an active chat exchange. Background errors (sub-agent crashes while idle) need a persistent listener.

**`src/lib/gateway.ts`** — Add a background error listener:

```typescript
/**
 * Subscribe to background error events (failures that happen outside active chat exchanges).
 * Returns unsubscribe function.
 */
export function subscribeBackgroundErrors(
  onError: (error: { message: string; sessionKey?: string; label?: string }) => void,
): () => void {
  // This requires a persistent WS subscription outside of sendViaTauriWs
  // Use the connection's subscribe method directly
  const connection = getConnectionInstance();
  if (!connection) return () => {};

  return connection.subscribe((eventName, payload) => {
    if (eventName !== 'chat') return;
    const chat = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>;
    const state = typeof chat.state === 'string' ? chat.state : '';

    if (state === 'error') {
      onError({
        message: typeof chat.errorMessage === 'string' ? chat.errorMessage : 'Unknown error',
        sessionKey: typeof chat.sessionKey === 'string' ? chat.sessionKey : undefined,
        label: typeof chat.label === 'string' ? chat.label : undefined,
      });
    }
  });
}
```

**`src/App.tsx`** — Subscribe on mount:

```typescript
useEffect(() => {
  const unsubscribe = subscribeBackgroundErrors((error) => {
    addChatMessage({
      role: 'system',
      content: error.message,
      timestamp: Date.now(),
      systemMeta: {
        kind: 'failure',
        title: 'Background task failed',
        details: {
          'Error': error.message,
          ...(error.label ? { 'Task': error.label } : {}),
        },
        actions: ['Check logs for details'],
      },
    });
  });

  return unsubscribe;
}, [addChatMessage]);
```

#### 6b. Process session crashes (coding agents)

When a coding agent (Claude Code / Codex) is running as a background `exec` process and gets killed, OpenClaw detects it via the `Exec failed` system event. The orchestrating agent (me) already reports these. The dashboard just needs to render them correctly.

**Agent-side (no code change):** When I detect a process failure, I already send a message. With the announce pattern matching from Step 5, failure messages containing `❌` or "failed" will be detected and rendered as failure bubbles.

---

### Step 7: Decision Surfacing — Agent Rules

This is primarily an agent behavior change, not a UI change. Decision messages from the agent will render as normal assistant messages in Phase B. The structured decision bubble UI is Phase C.

**`/Users/piercekearns/repos/pipeline-dashboard/AGENTS.md`** — Add Decision Escalation section:

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

**`/Users/piercekearns/clawdbot-sandbox/AGENTS.md`** — Add matching section (since the orchestrating agent reads this, not the dashboard's AGENTS.md):

Same content as above, under a new `## Decision Escalation` heading.

---

### Step 8: Helper — `addSystemBubble` Convenience Function

To avoid boilerplate, add a helper to the store or as a standalone function.

**`src/lib/store.ts`** — Add alongside `addChatMessage`:

```typescript
addSystemBubble: async (kind: SystemBubbleKind, title: string, details?: Record<string, string>, actions?: string[]) => {
  return get().addChatMessage({
    role: 'system',
    content: title,
    timestamp: Date.now(),
    systemMeta: { kind, title, details, actions },
  });
},
```

Update the store interface to expose this. Then callers become one-liners:

```typescript
addSystemBubble('compaction', 'Conversation compacted', { 'Note': 'Older messages summarized' });
addSystemBubble('failure', 'Sub-agent failed', { 'Error': 'OOM killed', 'Task': 'Phase B plan' });
```

---

## Files Modified (Summary)

| File | Changes |
|------|---------|
| `src/lib/gateway.ts` | Extend `ChatMessage` with `systemMeta`, add `SystemBubbleMeta` type, add `parseAnnounceMetadata()`, add `subscribeBackgroundErrors()`, add compaction state labels |
| `src/components/chat/SystemBubble.tsx` | **New file** — center-aligned, icon-driven system bubble component |
| `src/components/chat/MessageList.tsx` | Conditional render: `SystemBubble` for system messages with meta, `MessageBubble` for everything else |
| `src/components/chat/MessageBubble.tsx` | No changes (existing system message styling remains as fallback) |
| `src/components/chat/index.ts` | Export `SystemBubble` |
| `src/lib/store.ts` | Add `addSystemBubble` convenience method, update interface |
| `src/lib/chat-db.ts` / `src-tauri/src/lib.rs` | Add `system_meta` column to chat messages table, update save/load |
| `src/App.tsx` | Wire compaction callback, background error subscription, announce detection |
| `AGENTS.md` (dashboard repo) | Add Decision Escalation rules |
| `AGENTS.md` (sandbox) | Add matching Decision Escalation rules |

---

## Verification

### Manual Testing

1. **System bubble rendering:** Manually call `addSystemBubble('completion', 'Test completion', { 'Runtime': '30s' })` from browser console → verify centered, muted, icon-driven bubble appears
2. **All bubble kinds:** Test each kind (completion ✅, failure ❌, compaction 🧹, decision 🔷, info ℹ️) → verify correct icon, color, border
3. **Compaction detection:** Have a long conversation (~50+ messages) → watch for compaction state event in console → verify compaction bubble appears
4. **Completion delivery:** Use `sessions_spawn` from dashboard chat to run a small task → verify completion bubble appears when sub-agent finishes
5. **Failure alert:** Spawn a sub-agent with a very short timeout (e.g., 5s) on a task that takes longer → verify failure bubble appears
6. **Background errors:** Stop the gateway while idle → verify error bubble appears (not silence)
7. **Persistence:** Send a system bubble → close and reopen drawer → verify bubble persists from SQLite
8. **Fallback:** System messages WITHOUT `systemMeta` → verify they still render as plain system messages via `MessageBubble` (backward compat)
9. **Decision surfacing:** Ask the orchestrating agent to run a `/plan` review → verify decisions are surfaced in chat as assistant messages (not silently resolved)

### Automated

- `bun run typecheck` — TypeScript compiles with new types (`SystemBubbleMeta`, extended `ChatMessage`)
- `bun test` — existing tests pass (no behavioral changes to project/roadmap logic)
- `bun run build` — production build succeeds

### Build Validation

- `bun run validate` (typecheck + test + build) passes before commit

---

## Discovery Items (Resolve During Build)

1. **Compaction state event name** — Need to check actual gateway event string. Add `console.log('[Gateway] state:', state)` in the WS subscriber, trigger a compaction, and note the exact state value. Candidates: `compacting`, `compacted`, `compaction_complete`.

2. **Announce format** — Sub-agent announces arrive as assistant messages. Need to verify the exact text format from a real `sessions_spawn` to tune the pattern matching in `parseAnnounceMetadata()`.

3. **chat_messages schema migration** — If using SQLite with an existing table, check if `ALTER TABLE ADD COLUMN` works with the Tauri SQLite plugin, or if we need a migration strategy (create new table, copy, drop old).

4. **Background subscription lifetime** — `subscribeBackgroundErrors` needs the WS connection to be established. May need to defer subscription until after connection is confirmed, or re-subscribe on reconnect (Phase A's `onStateChange` callback).

---

## Estimate

- Steps 1-3 (types + component + wiring): ~0.5 day
- Step 4 (compaction): ~0.5 day (including discovery of actual event name)
- Steps 5-6 (completion + failure): ~1 day
- Steps 7-8 (decision rules + helper): ~0.5 day

**Total: ~2-2.5 days of focused build time.**
