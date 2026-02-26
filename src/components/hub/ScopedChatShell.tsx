import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubChat } from '../../lib/hub-types';
import type { ChatMessage } from '../../lib/gateway';
import { sendMessageWithContext } from '../../lib/gateway';
import { useDashboardStore } from '../../lib/store';
import { hubChatUpdate, hubChatUpdateActivity } from '../../lib/tauri';
import { buildScopedContext } from '../../lib/hub-context';
import { MessageList } from '../chat/MessageList';
import { ChatBar } from '../chat/ChatBar';

interface ScopedChatShellProps {
  chat: HubChat;
}

export function ScopedChatShell({ chat }: ScopedChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const chatIdRef = useRef(chat.id);
  const contextRef = useRef<string | null>(null);
  const sentCountRef = useRef(0);
  const gatewayConnected = useDashboardStore((s) => s.gatewayConnected);
  const wsConnectionState = useDashboardStore((s) => s.wsConnectionState);

  // Reset state when chat changes
  useEffect(() => {
    if (chatIdRef.current !== chat.id) {
      chatIdRef.current = chat.id;
      setMessages([]);
      setInput('');
      setSending(false);
      setStreamingContent(null);
      setContextLoaded(false);
      contextRef.current = null;
      sentCountRef.current = 0;
    }
  }, [chat.id]);

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
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
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
        setMessages((prev) => [...prev, msg]);
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
      {/* Messages */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {messages.length === 0 && !streamingContent ? (
          <div className="flex h-full items-center justify-center px-4">
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
      <div className="shrink-0 px-3 pb-4 pt-2 md:pb-6">
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
  );
}

/** Check if a chat title is a generic auto-generated name. */
function isGenericTitle(title: string): boolean {
  return /^(New Chat|Chat|Untitled|New Conversation)$/i.test(title.trim());
}
