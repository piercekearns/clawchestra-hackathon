---
title: Chat UX Overhaul (MVP)
type: feat
date: 2026-02-12
status: ready
reviewed: true
reviewers: [architecture, performance, simplicity, data-integrity]
---

# Chat UX Overhaul — MVP Implementation Plan

## Overview

Fix critical chat bugs and add basic slash commands. Scope has been **deliberately minimized** based on multi-agent review feedback.

## Problem Statement

1. **Messages being dropped** — Only the last assistant message shows; earlier messages lost
2. **Activity indicator disappears** — "Thinking..." vanishes during tool calls
3. **Can't send while agent working** — No feedback, feels broken
4. **No slash commands** — Can't invoke workflows from chat

## Scope

### ✅ In Scope (MVP)
- [ ] Fix multiple messages bug
- [ ] Fix activity indicator persistence
- [ ] Disable input while agent working
- [ ] Simple slash command dropdown

### ⏸️ Deferred (Post-MVP)
- SQLite persistence → Use JSON file if needed
- Virtualization → Not needed for <1000 messages
- Session management → Single session is fine
- Command categories/templates → 6 commands don't need categories
- Message queue UI → Disabling input is sufficient

---

## Phase 1: Bug Fixes (~4 hours)

### 1.1 Multiple Messages Bug Fix

**Problem:** `gateway.ts` returns only the last assistant message.

**Fix:**
```typescript
// gateway.ts — change return type
interface SendResult {
  messages: ChatMessage[];
  runId: string;
}

// After state: 'final', fetch history and return ALL new messages
const history = await connection.request('chat.history', { sessionKey, limit: 50 });
const newMessages = history.messages.slice(previousCount);
return { messages: newMessages, runId };
```

**App.tsx change:**
```typescript
// Old
const reply = await sendMessageWithContext(...);
addChatMessage({ role: 'assistant', content: reply });

// New
const result = await sendMessageWithContext(...);
for (const msg of result.messages) {
  addChatMessage(msg);
}
```

**Files:**
- `src/lib/gateway.ts`
- `src/App.tsx`

**Acceptance criteria:**
- [ ] All assistant messages in a response appear
- [ ] Messages appear in correct order

---

### 1.2 Activity Indicator Persistence

**Problem:** "Thinking..." clears when streaming starts, but tool calls have no streaming.

**Fix:**
```typescript
// Track runId, not just chatSending
const [chatRunId, setChatRunId] = useState<string | null>(null);

// Activity logic
const isWorking = chatSending || !!chatRunId;

// Clear only on final
if (state === 'final' || state === 'error') {
  setChatRunId(null);
}
```

**Files:**
- `src/App.tsx`

**Acceptance criteria:**
- [ ] "Thinking..." visible during entire response
- [ ] Clears only when response complete

---

### 1.3 Disable Input While Working

**Problem:** User can type but not send, feels broken.

**Simplified fix:** Just disable the input and show placeholder.

```tsx
<textarea
  disabled={isWorking}
  placeholder={isWorking ? "Agent is thinking..." : "Message..."}
/>
<button disabled={isWorking || !input.trim()}>Send</button>
```

**Files:**
- `src/components/chat/ChatBar.tsx`

**Acceptance criteria:**
- [ ] Input disabled while agent working
- [ ] Placeholder indicates agent is thinking
- [ ] Re-enables when response complete

---

## Phase 2: Slash Commands (~2-3 hours)

### 2.1 Command List

Hardcoded list of 6 commands:

```typescript
// src/lib/commands.ts
export const COMMANDS = [
  { name: 'plan', desc: 'Create implementation plan' },
  { name: 'review', desc: 'Multi-agent code review' },
  { name: 'work', desc: 'Execute plan with todos' },
  { name: 'deepen-plan', desc: 'Enhance plan with research' },
  { name: 'status', desc: 'Show session status' },
  { name: 'new', desc: 'Start new session' },
];
```

### 2.2 Simple Dropdown UI

**Trigger:** User types `/` at start of message.

**UI:** Simple filtered list, no cmdk, no keyboard nav.

```tsx
// src/components/chat/CommandDropdown.tsx
export function CommandDropdown({ 
  input, 
  onSelect 
}: { 
  input: string; 
  onSelect: (cmd: string) => void;
}) {
  if (!input.startsWith('/')) return null;
  
  const query = input.slice(1).toLowerCase();
  const filtered = COMMANDS.filter(c => 
    c.name.toLowerCase().startsWith(query)
  );
  
  if (filtered.length === 0) return null;
  
  return (
    <div className="absolute bottom-full left-0 mb-2 w-64 rounded-lg border border-neutral-700 bg-neutral-900 p-1 shadow-lg">
      {filtered.map(cmd => (
        <button
          key={cmd.name}
          onClick={() => onSelect(`/${cmd.name} `)}
          className="flex w-full flex-col items-start rounded px-3 py-2 text-left hover:bg-neutral-800"
        >
          <span className="font-medium text-revival-accent">/{cmd.name}</span>
          <span className="text-xs text-neutral-400">{cmd.desc}</span>
        </button>
      ))}
    </div>
  );
}
```

### 2.3 Integration

```tsx
// In ChatBar.tsx
const [showCommands, setShowCommands] = useState(false);

useEffect(() => {
  setShowCommands(input.startsWith('/') && !isWorking);
}, [input, isWorking]);

return (
  <div className="relative">
    {showCommands && (
      <CommandDropdown 
        input={input} 
        onSelect={(cmd) => {
          setInput(cmd);
          setShowCommands(false);
        }} 
      />
    )}
    <textarea ... />
  </div>
);
```

**Files:**
- `src/lib/commands.ts` (new)
- `src/components/chat/CommandDropdown.tsx` (new)
- `src/components/chat/ChatBar.tsx`

**Acceptance criteria:**
- [ ] `/` shows dropdown
- [ ] Typing filters list
- [ ] Click selects command
- [ ] Dropdown closes after selection

---

## Architecture Notes

Per review feedback, if this grows we should:
1. Extract `ChatContext` provider (App.tsx is getting bloated)
2. Define explicit state machine for chat lifecycle
3. Add `chatService.ts` orchestration layer

**Not doing now** — current scope is small enough.

---

## Estimate

| Phase | Item | Hours |
|-------|------|-------|
| 1.1 | Multiple messages fix | 2-3 |
| 1.2 | Activity indicator | 1 |
| 1.3 | Disable input | 0.5 |
| 2.x | Slash commands | 2-3 |
| | **Total** | **6-8** |

---

## Post-MVP Considerations

When/if needed later:

| Feature | Trigger | Solution |
|---------|---------|----------|
| Persistence | Users complain about losing chat | JSON file (~20 lines) |
| More commands | 15+ commands | Add categories, cmdk |
| Long history | 1000+ messages causing lag | Virtualization |
| Multiple chats | Users request | Session management |

---

## Review Summary

Plan reviewed by 4 parallel agents on 2026-02-12:

- **Architecture:** Extract ChatContext if scope grows
- **Performance:** Defer virtualization, use IntersectionObserver if lazy loading
- **Simplicity:** Cut SQLite, cmdk, session management — ship simple
- **Data Integrity:** JSON file sufficient for MVP, SQLite for scale

**Verdict:** Ship MVP in 6-8 hours, iterate based on feedback.
