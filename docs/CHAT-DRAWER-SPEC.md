# Chat Drawer UI — Specification

**Roadmap Item:** P1 - Chat Drawer UI  
**Status:** Spec Complete  
**Last Updated:** 2026-02-11

---

## Overview

Redesign the OpenClaw chat integration from an inline chat bar to a drawer-based UI that:
- Stays compact when not needed
- Shows activity status inline
- Surfaces responses via toast notifications
- Expands to a full drawer for conversation history

---

## Components

### 1. ChatBar
The persistent bottom bar, always visible.

```
┌─────────────────────────────────────────────────────────────┐
│ OpenClaw 🟢 Connected  · Thinking...       [▲]              │  ← Row 1: Status + Activity + Toggle
├─────────────────────────────────────────────────────────────┤
│ [Type a message...                              ] [Send ▶]  │  ← Row 2: Input + Send
└─────────────────────────────────────────────────────────────┘
```

**Layout:**
- Row 1: Status badge (left), Activity text (right of badge), Toggle arrow (CENTERED in bar)
- Row 2: Text input (expands with shift+enter), Send button (always yellow #DFFF00)

**Behavior:**
- Click anywhere on Row 1 (not just arrow) → opens drawer
- [▲] is visual indicator only, centered horizontally
- Input can expand vertically (shift+enter), hovers over Kanban temporarily

### 2. StatusBadge
Simple connection indicator.

| State | Display |
|-------|---------|
| Connected | `🟢 Connected` |
| Error | `🔴 Error` |
| Disconnected | `⚫ Disconnected` |

No intermediate states. Badge only reflects connection health.

### 3. ActivityIndicator
Shows current work, appears to the right of StatusBadge.

```
· Thinking...
· Running tool...
· Fetching...
· Reading files...
· Writing files...
```

**Behavior:**
- Only visible when work is in progress
- Uses animated dots (···) 
- Text updates to reflect current activity type
- Disappears when work completes

**Activity Type Mapping (from OpenClaw):**
- `thinking` content block → "Thinking..."
- `toolCall` with name `exec` → "Running tool..."
- `toolCall` with name `web_fetch` → "Fetching..."
- `toolCall` with name `Read` → "Reading files..."
- `toolCall` with name `Write` or `Edit` → "Writing files..."

Note: This mapping applies when structured OpenClaw event/content blocks are available. For non-streaming/plain-text transports, default to a generic `Thinking...` activity label.

### 4. ResponseToast
Notification that appears when a response is complete.

```
┌─────────────────────────────────────────────────────────────┐
│ 🤖 The repo is clean — you're on `main` with no...    [✕]  │
└─────────────────────────────────────────────────────────────┘
```

**Layout:**
- Full width (same as ChatBar)
- Similar height to ChatBar Row 1
- Avatar/icon on left
- Truncated message text (ellipsis if too long)
- [✕] close button on right

**Behavior:**
- Appears ONLY when response is fully complete (not during streaming)
- Does NOT auto-dismiss
- Click [✕] → dismiss toast, drawer stays closed
- Click message body → dismiss toast AND open drawer

### 5. ChatDrawer
Expandable panel showing full conversation history.

```
┌─────────────────────────────────────────────────────────────┐
│░░░░░░░░░░░░░░░░░░ KANBAN (dimmed backdrop) ░░░░░░░░░░░░░░░░░│
├─────────────────────────────────────────────────────────────┤
│                      [drag handle]                          │
│ ▸ Thought 42s · 3 tools                                     │  ← Collapsed summary
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🤖 Clawdbot                                      4:16pm │ │  ← Message bubble
│ │ The repo is clean — you're on `main` with no            │ │
│ │ uncommitted changes.                                    │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 👤 You                                           4:15pm │ │
│ │ What's the git status of this repo?                     │ │
│ └─────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────┤
│ OpenClaw 🟢 Connected                           [▼]         │
├─────────────────────────────────────────────────────────────┤
│ [Type a message...                              ] [Send ▶]  │
└─────────────────────────────────────────────────────────────┘
```

**Layout:**
- Backdrop: dimmed overlay behind drawer (click backdrop closes drawer)
- Drag handle at top for resizing
- Scrollable message list
- ChatBar fixed at bottom (toggle arrow becomes [▼])

**Behavior:**
- Default height: ~60% of viewport (configurable in settings later)
- Draggable: can resize freely by dragging top edge (no snap points)
- Drag range: clamp between ~5% and ~95% viewport height, with a minimum 56px floor
- [▼] collapses back to just ChatBar
- `Escape` closes drawer when open
- Scrolls to bottom (most recent) on open

### 6. MessageBubble
Individual message in the drawer.

**User Message:**
```
┌────────────────────────────────────────┐
│ 👤 You                          4:15pm │
│ What's the git status?                 │
└────────────────────────────────────────┘
```

**Assistant Message:**
```
▸ Thought 42s · 3 tools                    ← ThinkingSummary (above bubble)
┌────────────────────────────────────────┐
│ 🤖 Clawdbot                     4:16pm │
│ The repo is clean — you're on `main`   │
│ with no uncommitted changes.           │
└────────────────────────────────────────┘
```

**Layout:**
- Avatar + name + timestamp in header
- Message content with markdown rendering
- Assistant messages have ThinkingSummary ABOVE the bubble

### 7. ThinkingSummary
Collapsible header showing work done for a response.

**Collapsed:**
```
▸ Thought 42s · 3 tools
```

**Expanded:**
```
▾ Thought 42s · 3 tools
┌─────────────────────────────────────────┐
│ 💭 Thinking                             │
│ The user wants the git status. I'll run   │
│ the command to check...                 │
├─────────────────────────────────────────┤
│ ▸ exec: git status (✓ 0.02s)            │
│ ▸ exec: ls -la (✓ 0.01s)                │
│ ▸ web_fetch (✓ 0.3s)                    │
└─────────────────────────────────────────┘
```

**Behavior:**
- Click to expand/collapse
- Shows thinking content when expanded
- Lists tool calls with status (✓/✗) and duration
- Each tool call can further expand to show output (optional)

---

## Data Flow

### OpenClaw Message Format (from chat.history API)

```typescript
interface Message {
  role: 'user' | 'assistant' | 'toolResult';
  content: ContentBlock[];
  timestamp: number;
  // Assistant-specific:
  model?: string;
  usage?: { input, output, cost, ... };
  stopReason?: 'toolUse' | 'endTurn';
}

interface ContentBlock {
  type: 'text' | 'thinking' | 'toolCall';
  // For text:
  text?: string;
  // For thinking:
  thinking?: string;
  // For toolCall:
  id?: string;
  name?: string;
  arguments?: object;
}

interface ToolResult {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: [{ type: 'text', text: string }];
  details?: { status, exitCode, durationMs };
  isError: boolean;
}
```

### State Management

```typescript
interface ChatState {
  // Connection
  connected: boolean;
  connectionError: string | null;
  
  // Activity
  isWorking: boolean;
  currentActivity: 'thinking' | 'tool' | 'fetch' | 'read' | 'write' | null;
  
  // Messages
  messages: Message[];
  
  // UI
  drawerOpen: boolean;
  drawerHeight: number; // percentage or pixels
  pendingToast: Message | null; // response awaiting acknowledgment
}
```

---

## Component File Structure

```
src/components/chat/
├── ChatBar.tsx           # Main bar with input
├── StatusBadge.tsx       # Connection indicator
├── ActivityIndicator.tsx # Working status text
├── ResponseToast.tsx     # Notification popup
├── ChatDrawer.tsx        # Expandable panel
├── MessageList.tsx       # Scrollable history
├── MessageBubble.tsx     # Individual message
├── ThinkingSummary.tsx   # Collapsible work summary
├── ToolStep.tsx          # Individual tool call display
└── index.ts              # Exports
```

---

## Implementation Phases

### Phase 1: Core Structure
- [ ] ChatBar with status badge and centered toggle
- [ ] StatusBadge component (connected/error/disconnected)
- [ ] Basic drawer open/close (fixed height)
- [ ] Message list with user/assistant bubbles

### Phase 2: Activity & Toast
- [ ] ActivityIndicator with animated dots
- [ ] Map OpenClaw events to activity types
- [ ] ResponseToast component
- [ ] Toast appears on response complete

### Phase 3: Rich Messages
- [ ] ThinkingSummary component
- [ ] Collapsible thinking content
- [ ] Tool call display with ToolStep
- [ ] Markdown rendering in messages

### Phase 4: Polish
- [ ] Draggable drawer height
- [ ] Backdrop dimming
- [ ] Smooth animations
- [ ] Keyboard shortcuts (Escape to close)

---

## Dependencies

**Existing:**
- shadcn/ui (base components)
- Tailwind CSS
- Lucide icons

**Consider adding:**
- prompt-kit components (if compatible)
- framer-motion (for drawer animations)
- react-markdown (for message rendering)

---

## Open Questions

1. **Settings:** Where to configure default drawer height? (Future settings panel)

---

## References

- [prompt-kit](https://github.com/ibelick/prompt-kit) — AI chat components
- [AI Elements](https://www.tryelements.dev/docs/ai-elements) — Vercel AI SDK components
- OpenClaw Gateway Dashboard — existing chat UI reference
