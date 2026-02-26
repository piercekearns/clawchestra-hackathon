import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import type { HubChat } from '../../lib/hub-types';
import type { ChatMessage } from '../../lib/gateway';
import { sendMessageWithContext } from '../../lib/gateway';
import { useDashboardStore } from '../../lib/store';
import { hubChatUpdate, hubChatUpdateActivity } from '../../lib/tauri';
import { buildScopedContext } from '../../lib/hub-context';
import { MessageList } from '../chat/MessageList';

interface ScopedChatShellProps {
  chat: HubChat;
}

export function ScopedChatShell({ chat }: ScopedChatShellProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatIdRef = useRef(chat.id);
  const contextRef = useRef<string | null>(null);
  const sentCountRef = useRef(0);

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = '40px';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [input]);

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
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

      {/* Input bar */}
      <div className="border-t border-neutral-200 px-3 py-2 dark:border-neutral-700">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={sending ? 'Working...' : 'Type a message...'}
            disabled={sending}
            rows={1}
            className="flex-1 resize-none rounded-md border border-neutral-200 bg-transparent px-3 py-2 text-sm text-neutral-800 placeholder-neutral-400 outline-none focus:border-revival-accent-400/60 focus:ring-1 focus:ring-revival-accent-400/40 dark:border-neutral-700 dark:text-neutral-200 dark:placeholder-neutral-500"
            style={{ minHeight: 40, maxHeight: 120 }}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || sending}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#DFFF00] text-neutral-900 transition-colors hover:bg-[#d4f500] disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Send message"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

/** Check if a chat title is a generic auto-generated name. */
function isGenericTitle(title: string): boolean {
  return /^(New Chat|Chat|Untitled|New Conversation)$/i.test(title.trim());
}
