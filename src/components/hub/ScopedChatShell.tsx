import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubChat } from '../../lib/hub-types';
import type { ChatMessage } from '../../lib/gateway';
import { sendMessageWithContext, fetchSessionModel } from '../../lib/gateway';
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
      // Restore sending state — if the chat is still waiting for a response, keep the activity indicator
      setSending(useDashboardStore.getState().hubBusyChatIds.has(chat.id));
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

  // Probe session model on mount so the badge shows the model even before a send
  useEffect(() => {
    if (!chat.sessionKey) return;
    let cancelled = false;
    void fetchSessionModel({ sessionKey: chat.sessionKey, allowDefaultsFallback: false }).then((snapshot) => {
      if (cancelled || !snapshot) return;
      if (snapshot.model || snapshot.provider) {
        const ml = formatModelDisplayName(snapshot.model);
        const pl = formatProviderDisplayName(snapshot.provider);
        const label = pl && ml ? `${pl} · ${ml}` : ml ?? pl;
        if (label) {
          setModelLabel((prev) => prev ?? label);
          const rawModel = snapshot.model ?? 'unknown model';
          setModelTooltip((prev) => prev ?? (snapshot.provider ? `${snapshot.provider} · ${rawModel}` : rawModel));
        }
      }
    }).catch(() => {/* silently ignore */});
    return () => { cancelled = true; };
  }, [chat.id, chat.sessionKey]);

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

    // Capture the chat ID at send time — if the user switches away mid-response,
    // we route results to the originating chat's cache instead of the current view.
    const originChatId = chat.id;

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
      void hubChatMessageSave(originChatId, toPersisted(userMessage)).catch((err) => {
        console.warn('[ScopedChat] Failed to persist user message:', err);
      });
    }
    setSending(true);
    setStreamingContent(null);
    useDashboardStore.getState().addHubBusyChatId(originChatId);

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
            // Guard: only update streaming UI if we're still on the originating chat
            if (chatIdRef.current === originChatId) {
              setStreamingContent(content);
            }
          },
        },
      );

      // Check if user switched away while awaiting the response
      const switchedAway = chatIdRef.current !== originChatId;

      if (!switchedAway) {
        setStreamingContent(null);
      }

      // Build the response messages with IDs
      const responseMessages: ChatMessage[] = [];
      for (const msg of result.messages) {
        const withId: ChatMessage = { ...msg, _id: msg._id ?? generateMessageId() };
        responseMessages.push(withId);

        // Always persist to SQLite (using the original chat ID, not the current one)
        if (isTauriRuntime()) {
          void hubChatMessageSave(originChatId, toPersisted(withId)).catch((err) => {
            console.warn('[ScopedChat] Failed to persist assistant message:', err);
          });
        }
      }

      if (switchedAway) {
        // User navigated to a different chat — stash results in the originating chat's cache
        const cached = chatCache.get(originChatId);
        if (cached) {
          cached.messages = [...cached.messages, ...responseMessages];
          // Also stash model/usage into the cache
          if (result.runtimeModel || result.runtimeProvider) {
            const ml = formatModelDisplayName(result.runtimeModel);
            const pl = formatProviderDisplayName(result.runtimeProvider);
            cached.modelLabel = pl && ml ? `${pl} · ${ml}` : ml ?? pl;
            const rawModel = result.runtimeModel ?? 'unknown model';
            cached.modelTooltip = result.runtimeProvider ? `${result.runtimeProvider} · ${rawModel}` : rawModel;
          }
          if (result.usage) {
            cached.usage = result.usage;
          }
        }
        // Mark as unread since user isn't viewing this chat
        void hubChatUpdate(originChatId, { unread: true });
        const store = useDashboardStore.getState();
        store.setHubChats(store.hubChats.map((c) => (c.id === originChatId ? { ...c, unread: true } : c)));
      } else if (!useDashboardStore.getState().hubDrawerOpen) {
        // Drawer closed entirely — also mark unread
        void hubChatUpdate(originChatId, { unread: true });
        const store = useDashboardStore.getState();
        store.setHubChats(store.hubChats.map((c) => (c.id === originChatId ? { ...c, unread: true } : c)));
      } else {
        // Still on the originating chat — apply to state normally
        for (const msg of responseMessages) {
          setMessages((prev) => [...prev, msg]);
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
      }

      // Update activity + message count metadata (always uses originChatId)
      void hubChatUpdateActivity(originChatId);
      const currentChat = useDashboardStore.getState().hubChats.find((c) => c.id === originChatId);
      if (currentChat) {
        // +1 for user message, + N for assistant responses
        void hubChatUpdate(originChatId, { messageCount: (currentChat.messageCount ?? 0) + 1 + result.messages.length });
      }

      // Auto-name chat from first user message if title is generic
      if (sentCountRef.current === 1 && isGenericTitle(chat.title)) {
        const autoTitle = text.slice(0, 60) + (text.length > 60 ? '...' : '');
        void hubChatUpdate(originChatId, { title: autoTitle }).then(() => {
          const store = useDashboardStore.getState();
          store.setHubChats(store.hubChats.map((c) => (c.id === originChatId ? { ...c, title: autoTitle } : c)));
        }).catch((err) => {
          console.warn('[ScopedChat] Auto-name failed:', err);
        });
      }
    } catch (error) {
      console.error('[ScopedChat] Send failed:', error);
      if (chatIdRef.current === originChatId) {
        setMessages((prev) => [
          ...prev,
          {
            role: 'system' as const,
            content: `Failed to send: ${error instanceof Error ? error.message : 'Unknown error'}`,
            timestamp: Date.now(),
          },
        ]);
      }
    } finally {
      useDashboardStore.getState().removeHubBusyChatId(originChatId);
      if (chatIdRef.current === originChatId) {
        setSending(false);
      }
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
