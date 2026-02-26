import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubChat } from '../../lib/hub-types';
import type { ChatMessage } from '../../lib/gateway';
import { sendMessageWithContext } from '../../lib/gateway';
import { useDashboardStore } from '../../lib/store';
import {
  hubChatUpdate,
  hubChatUpdateActivity,
  hubChatMessagesLoad,
  hubChatMessageSave,
  isTauriRuntime,
} from '../../lib/tauri';
import type { PersistedChatMessage } from '../../lib/tauri';
import { buildScopedContext } from '../../lib/hub-context';
import { formatModelDisplayName, formatProviderDisplayName } from '../../lib/model-label';
import { MessageList } from '../chat/MessageList';
import { ChatBar } from '../chat/ChatBar';

interface ScopedChatShellProps {
  chat: HubChat;
}

interface ScopedChatCacheEntry {
  messages: ChatMessage[];
  input: string;
  sentCount: number;
  modelLabel: string | null;
  modelTooltip: string | null;
  usage: { used: number; max: number; percent: number } | null;
}

/** In-memory cache so chat history survives switching between drawer chats. */
const chatCache = new Map<string, ScopedChatCacheEntry>();

let _msgCounter = 0;
function generateMessageId(): string {
  return `hub-msg-${Date.now()}-${++_msgCounter}`;
}

function toPersisted(msg: ChatMessage): PersistedChatMessage {
  return {
    id: msg._id ?? generateMessageId(),
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp ?? Date.now(),
  };
}

function fromPersisted(p: PersistedChatMessage): ChatMessage {
  return {
    role: p.role as ChatMessage['role'],
    content: p.content,
    timestamp: p.timestamp,
    _id: p.id,
  };
}

export function ScopedChatShell({ chat }: ScopedChatShellProps) {
  const cached = chatCache.get(chat.id);
  const [messages, setMessages] = useState<ChatMessage[]>(cached?.messages ?? []);
  const [input, setInput] = useState(cached?.input ?? '');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [modelLabel, setModelLabel] = useState<string | null>(cached?.modelLabel ?? null);
  const [modelTooltip, setModelTooltip] = useState<string | null>(cached?.modelTooltip ?? null);
  const [modelUsage, setModelUsage] = useState<{ used: number; max: number; percent: number } | null>(cached?.usage ?? null);
  const chatIdRef = useRef(chat.id);
  const contextRef = useRef<string | null>(null);
  const sentCountRef = useRef(cached?.sentCount ?? 0);
  const gatewayConnected = useDashboardStore((s) => s.gatewayConnected);
  const wsConnectionState = useDashboardStore((s) => s.wsConnectionState);

  // Save to cache whenever messages, input, or model/usage change
  useEffect(() => {
    chatCache.set(chatIdRef.current, {
      messages,
      input,
      sentCount: sentCountRef.current,
      modelLabel,
      modelTooltip,
      usage: modelUsage,
    });
  }, [messages, input, modelLabel, modelTooltip, modelUsage]);

  // Restore or reset state when chat changes
  useEffect(() => {
    if (chatIdRef.current !== chat.id) {
      // Save outgoing chat state
      chatCache.set(chatIdRef.current, {
        messages,
        input,
        sentCount: sentCountRef.current,
        modelLabel,
        modelTooltip,
        usage: modelUsage,
      });
      chatIdRef.current = chat.id;

      // Restore incoming chat state from cache
      const incoming = chatCache.get(chat.id);
      setMessages(incoming?.messages ?? []);
      setInput(incoming?.input ?? '');
      sentCountRef.current = incoming?.sentCount ?? 0;
      setModelLabel(incoming?.modelLabel ?? null);
      setModelTooltip(incoming?.modelTooltip ?? null);
      setModelUsage(incoming?.usage ?? null);
      setSending(false);
      setStreamingContent(null);
      setContextLoaded(false);
      contextRef.current = null;
    }
  }, [chat.id, messages, input, modelLabel, modelTooltip, modelUsage]);

  // Load scoped context on mount / chat identity change
  useEffect(() => {
    let cancelled = false;
    contextRef.current = null;
    setContextLoaded(false);
    void buildScopedContext(chat).then((ctx) => {
      if (!cancelled) {
        contextRef.current = ctx;
        setContextLoaded(true);
      }
    });
    return () => { cancelled = true; };
  }, [chat.id, chat.projectId, chat.itemId]);

  // Cold-start: load messages from SQLite when cache is empty
  useEffect(() => {
    if (!isTauriRuntime()) return;
    // Only load if cache was empty for this chat (cold start / app restart)
    if (chatCache.has(chat.id) && (chatCache.get(chat.id)?.messages.length ?? 0) > 0) return;

    let cancelled = false;
    void hubChatMessagesLoad(chat.id, 200).then((rows) => {
      if (cancelled || rows.length === 0) return;
      const restored = rows.map(fromPersisted);
      setMessages(restored);
      sentCountRef.current = restored.filter((m) => m.role === 'user').length;
    }).catch((err) => {
      console.warn('[ScopedChat] SQLite load failed:', err);
    });
    return () => { cancelled = true; };
  }, [chat.id]);

  // Clear unread on open
  useEffect(() => {
    if (chat.unread) {
      void hubChatUpdate(chat.id, { unread: false });
      const { hubChats, setHubChats } = useDashboardStore.getState();
      setHubChats(hubChats.map((c) => (c.id === chat.id ? { ...c, unread: false } : c)));
    }
  }, [chat.id, chat.unread]);

  // Build display messages (real messages + streaming preview)
  const displayMessages: ChatMessage[] = streamingContent
    ? [
        ...messages,
        {
          role: 'assistant' as const,
          content: streamingContent,
          timestamp: Date.now(),
        },
      ]
    : messages;

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      _id: generateMessageId(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    // Fire-and-forget persist user message to SQLite
    if (isTauriRuntime()) {
      void hubChatMessageSave(chat.id, toPersisted(userMessage)).catch((err) => {
        console.warn('[ScopedChat] Failed to persist user message:', err);
      });
    }
    setSending(true);
    setStreamingContent(null);

    // Prepend context as system message on first send
    const historyForSend = [...messages, userMessage];
    if (contextRef.current && sentCountRef.current === 0) {
      historyForSend.unshift({
        role: 'system' as const,
        content: contextRef.current,
        timestamp: Date.now(),
      });
    }
    sentCountRef.current += 1;

    try {
      const viewContext = useDashboardStore.getState().viewContext;
      const result = await sendMessageWithContext(
        historyForSend,
        {
          view: viewContext.type,
          selectedProject: chat.title,
        },
        {
          sessionKey: chat.sessionKey ?? undefined,
          skipTurnTracking: true,
          onStreamDelta: (content) => {
            setStreamingContent(content);
          },
        },
      );

      setStreamingContent(null);
      for (const msg of result.messages) {
        const withId: ChatMessage = { ...msg, _id: msg._id ?? generateMessageId() };
        setMessages((prev) => [...prev, withId]);

        // Fire-and-forget persist assistant message to SQLite
        if (isTauriRuntime()) {
          void hubChatMessageSave(chat.id, toPersisted(withId)).catch((err) => {
            console.warn('[ScopedChat] Failed to persist assistant message:', err);
          });
        }
      }

      // Extract model badge + usage ring from send result
      if (result.runtimeModel || result.runtimeProvider) {
        const ml = formatModelDisplayName(result.runtimeModel);
        const pl = formatProviderDisplayName(result.runtimeProvider);
        setModelLabel(pl && ml ? `${pl} · ${ml}` : ml ?? pl);
        const rawModel = result.runtimeModel ?? 'unknown model';
        setModelTooltip(result.runtimeProvider ? `${result.runtimeProvider} · ${rawModel}` : rawModel);
      }
      if (result.usage) {
        setModelUsage(result.usage);
      }

      // Update activity + message count metadata
      void hubChatUpdateActivity(chat.id);
      const currentChat = useDashboardStore.getState().hubChats.find((c) => c.id === chat.id);
      if (currentChat) {
        // +1 for user message, + N for assistant responses
        void hubChatUpdate(chat.id, { messageCount: (currentChat.messageCount ?? 0) + 1 + result.messages.length });
      }

      // Auto-name chat from first user message if title is generic
      if (sentCountRef.current === 1 && isGenericTitle(chat.title)) {
        const autoTitle = text.slice(0, 60) + (text.length > 60 ? '...' : '');
        void hubChatUpdate(chat.id, { title: autoTitle }).then(() => {
          const store = useDashboardStore.getState();
          store.setHubChats(store.hubChats.map((c) => (c.id === chat.id ? { ...c, title: autoTitle } : c)));
        }).catch((err) => {
          console.warn('[ScopedChat] Auto-name failed:', err);
        });
      }
    } catch (error) {
      console.error('[ScopedChat] Send failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system' as const,
          content: `Failed to send: ${error instanceof Error ? error.message : 'Unknown error'}`,
          timestamp: Date.now(),
        },
      ]);
    } finally {
      setSending(false);
    }
  }, [input, sending, messages, chat.sessionKey, chat.title, chat.id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Messages — flex-col so MessageList's flex-1 stretches; relative for empty-state positioning */}
      <div className="relative min-h-0 flex-1 flex flex-col">
        {messages.length === 0 && !streamingContent ? (
          <div className="absolute inset-0 flex items-center justify-center px-4">
            <p className="text-center text-xs text-neutral-400 dark:text-neutral-500">
              {contextLoaded ? (
                <>
                  Start a conversation about{' '}
                  <span className="font-medium text-neutral-500 dark:text-neutral-400">
                    {chat.title}
                  </span>
                </>
              ) : (
                'Loading context...'
              )}
            </p>
          </div>
        ) : (
          <MessageList
            messages={displayMessages}
            showReadingIndicator={sending && !streamingContent}
          />
        )}
      </div>

      {/* Input bar — reuses the main ChatBar in embedded mode */}
      <div className="shrink-0 px-3 pt-2">
      <div className="overflow-hidden rounded-xl border border-neutral-300 dark:border-neutral-600">
      <ChatBar
        connectionState={wsConnectionState}
        activityLabel={sending ? 'Working...' : null}
        drawerOpen={false}
        variant="embedded"
        showToggle={false}
        input={input}
        sending={sending}
        dragActive={dragActive}
        images={[]}
        gatewayConnected={gatewayConnected}
        queue={[]}
        activeModelLabel={modelLabel}
        activeModelTooltip={modelTooltip}
        activeModelUsage={modelUsage}
        onInputChange={setInput}
        onToggleDrawer={() => {}}
        onSubmit={() => void handleSend()}
        onRemoveImage={() => {}}
        onRemoveFromQueue={() => {}}
        onRetryQueuedMessage={() => {}}
        onPasteFiles={async () => {}}
        onDropFiles={async () => {}}
        onDragStateChange={setDragActive}
      />
      </div>
      </div>
    </div>
  );
}

/** Check if a chat title is a generic auto-generated name. */
function isGenericTitle(title: string): boolean {
  return /^(New Chat|Chat|Untitled|New Conversation)$/i.test(title.trim());
}
