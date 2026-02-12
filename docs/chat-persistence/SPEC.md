# Chat Persistence — SPEC

**Status:** Ready  
**Created:** 2026-02-12  
**Updated:** 2026-02-12  
**Priority:** P1  
**Reviewed:** ✅ 2026-02-12 (architecture, performance, simplicity, risk)

---

## Problem Statement

Chat history is lost on app refresh/restart. Users lose context of previous conversations.

---

## Scope

### In Scope (MVP)
- [x] ~~Activity indicator during tool calls~~ — **SHIPPED** (Chat UX Overhaul)
- [x] ~~Message queue~~ — **SHIPPED** (Chat UX Overhaul)
- [x] ~~Multi-message bug fix~~ — **SHIPPED** (Chat UX Overhaul)
- [ ] Local chat storage (SQLite via Tauri)
- [ ] Persist messages on send/receive
- [ ] Load recent messages on startup
- [ ] Lazy loading (scroll-to-top loads older messages)

### Deferred (Post-MVP)
- **Virtualization** — Not needed for <500 messages. Native DOM handles this fine. Defer until performance issues observed.
- **Sessions table** — YAGNI. Single flat `messages` table for v1. Add session grouping when we build session management UI.
- **Session management UI** — List/archive/restore sessions
- **Encryption at rest** — SQLCipher if needed later

### Out of Scope
- Real-time tool call streaming (depends on OpenClaw gateway changes)
- Collapsible chain-of-thought UI

---

## Technical Design

### 1. Storage Layer

**SQLite via Tauri** — Local, secure, fast. No `sessions` table in v1.

```sql
-- Simple flat messages table (no session grouping for v1)
CREATE TABLE messages (
  id TEXT PRIMARY KEY,           -- UUID
  role TEXT NOT NULL,            -- 'user' | 'assistant' | 'system'
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL,    -- Unix ms
  metadata TEXT,                 -- JSON blob for attachments, etc.
  created_at INTEGER DEFAULT (strftime('%s', 'now') * 1000)
);

CREATE INDEX idx_messages_timestamp ON messages(timestamp DESC);

-- Enable WAL mode for better concurrent read performance
PRAGMA journal_mode=WAL;
```

**Location:** Tauri app data dir (`~/.pipeline-dashboard/chat.db` or platform equivalent)

### 2. Tauri Commands

```rust
#[tauri::command]
async fn chat_messages_load(
    before_timestamp: Option<i64>,  // Cursor for pagination
    limit: Option<i64>,              // Default 50
) -> Result<Vec<ChatMessage>, String>

#[tauri::command]
async fn chat_message_save(message: ChatMessage) -> Result<(), String>

#[tauri::command]
async fn chat_messages_clear() -> Result<(), String>  // For "new session" action
```

### 3. Frontend Integration

**Store Changes:**
```typescript
interface ChatState {
  messages: ChatMessage[];
  hasMore: boolean;           // More messages to load above
  isLoadingMore: boolean;
  
  // Actions
  loadInitial: () => Promise<void>;
  loadMore: () => Promise<void>;   // Called on scroll to top
  addMessage: (msg: ChatMessage) => void;
  persistMessage: (msg: ChatMessage) => Promise<void>;
  clearHistory: () => Promise<void>;
}
```

**Lazy Loading (no virtualization needed):**
```tsx
function MessageList() {
  const { messages, loadMore, hasMore, isLoadingMore } = useChatStore();
  const containerRef = useRef<HTMLDivElement>(null);

  // Detect scroll to top → loadMore()
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    
    const onScroll = () => {
      if (el.scrollTop < 200 && hasMore && !isLoadingMore) {
        loadMore();
      }
    };
    
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, [hasMore, isLoadingMore, loadMore]);

  return (
    <div ref={containerRef} className="overflow-auto h-full">
      {isLoadingMore && <LoadingSpinner />}
      {messages.map(msg => <MessageBubble key={msg.id} message={msg} />)}
    </div>
  );
}
```

### 4. Startup Flow

1. App opens → Load last 50 messages
2. Scroll to bottom (most recent)
3. User scrolls up → Load 50 more when near top
4. Repeat until no more messages

### 5. Message Persistence Flow

**On Send:**
```typescript
async function sendMessage(content: string) {
  const userMsg = { id: uuid(), role: 'user', content, timestamp: Date.now() };
  
  // 1. Add to UI immediately (optimistic)
  addMessage(userMsg);
  
  // 2. Persist to SQLite
  await persistMessage(userMsg);
  
  // 3. Send to OpenClaw, get response
  const result = await sendMessageWithContext(...);
  
  // 4. Add + persist assistant responses
  for (const msg of result.messages) {
    addMessage(msg);
    await persistMessage(msg);
  }
}
```

---

## Milestones

### Phase 1: Basic Persistence (~2-3 hours) ✅ COMPLETE
- [x] SQLite schema + Tauri commands (rusqlite)
- [x] Save messages on send/receive
- [x] Load all messages on startup

### Phase 2: Lazy Loading (~1-2 hours) ✅ COMPLETE
- [x] Paginated load (50 at a time, cursor-based)
- [x] Scroll-to-top triggers loadMore
- [x] Loading indicator
- [x] Error handling + retry

**Total Estimate: 4-5 hours** — SHIPPED 2026-02-12

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| `rusqlite` | SQLite bindings for Rust/Tauri |
| `uuid` | Message ID generation (may already have) |

**Not needed for MVP:**
- `@tanstack/react-virtual` — Defer until virtualization is needed

---

## Security Considerations

- **Local only** — No server storage, data stays on device
- **App data directory** — Uses OS-protected app storage
- **No encryption at rest** (v1) — Could add SQLCipher later if needed

---

## Review Summary (2026-02-12)

| Reviewer | Verdict | Key Feedback |
|----------|---------|--------------|
| Architecture | ✅ APPROVE | SQLite correct for Tauri, schema clean |
| Performance | ✅ APPROVE | Cursor pagination correct, add WAL mode |
| Simplicity | ⚠️ NEEDS WORK | Remove shipped work, cut sessions table, defer virtualization |
| Risk | ⚠️ NEEDS WORK | Estimates optimistic, Rust fluency required |

**Actions Taken:**
- ✅ Removed shipped work (activity indicator, queue, multi-message fix)
- ✅ Cut sessions table for v1
- ✅ Deferred virtualization
- ✅ Added WAL mode pragma
- ✅ Revised estimates (4-5h)
- ✅ Simplified Tauri commands

---

## Open Questions (Resolved)

1. ~~Session naming~~ — **Deferred.** No sessions in v1.
2. ~~Session switching~~ — **Deferred.** Single message stream for now.
3. ~~Data migration~~ — None needed. In-memory messages lost on deploy (already happening).
