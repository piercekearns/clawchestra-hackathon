import { useCallback, useEffect, useRef, useState } from 'react';
import type { HubChat } from '../lib/hub-types';
import type { ChatMessage, UsageSnapshot } from '../lib/gateway';
import { sendMessageWithContext, fetchSessionModel, abortActiveRun } from '../lib/gateway';
import { useDashboardStore, EMPTY_HUB_MESSAGES } from '../lib/store';
import {
  hubChatUpdate,
  hubChatUpdateActivity,
  hubChatMessagesLoad,
  isTauriRuntime,
  type PersistedChatMessage,
} from '../lib/tauri';
import { buildScopedContext } from '../lib/hub-context';
import { formatModelDisplayName, formatProviderDisplayName } from '../lib/model-label';
import { classifyUpstreamFailure } from '../lib/chat-reliability';
import type { ChatConnectionState } from '../components/chat/types';

// ---------------------------------------------------------------------------
// Persistence helpers (inline — no separate utils file needed)
// ---------------------------------------------------------------------------

function generateMessageId(): string {
  return `hub-msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function toPersistedHubMessage(msg: ChatMessage): PersistedChatMessage {
  return {
    id: msg._id ?? generateMessageId(),
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp ?? Date.now(),
  };
}

function fromPersistedHubMessage(p: PersistedChatMessage): ChatMessage {
  return {
    role: p.role as ChatMessage['role'],
    content: p.content,
    timestamp: p.timestamp,
    _id: p.id,
  };
}

function isGenericTitle(title: string): boolean {
  return /^(New Chat|Chat|Untitled|New Conversation)$/i.test(title.trim());
}

// ---------------------------------------------------------------------------
// Return type
// ---------------------------------------------------------------------------

export interface ScopedChatSession {
  messages: ChatMessage[];
  displayMessages: ChatMessage[];
  streamingContent: string | null;
  input: string;
  sending: boolean;
  contextLoaded: boolean;
  gatewayConnected: boolean;
  wsConnectionState: ChatConnectionState;
  modelLabel: string | null;
  modelTooltip: string | null;
  modelUsage: UsageSnapshot | null;
  dragActive: boolean;

  setInput: (value: string) => void;
  setDragActive: (value: boolean) => void;
  handleSend: () => Promise<void>;
  handleStop: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useScopedChatSession({ chat }: { chat: HubChat }): ScopedChatSession {
  // --- Store selectors (survive chat switches) ---
  const messages = useDashboardStore((s) => s.hubChatMessages[chat.id] ?? EMPTY_HUB_MESSAGES);
  const modelState = useDashboardStore((s) => s.hubChatModelState[chat.id]);
  const sending = useDashboardStore((s) => s.hubBusyChatIds.has(chat.id));
  const gatewayConnected = useDashboardStore((s) => s.gatewayConnected);
  const wsConnectionState = useDashboardStore((s) => s.wsConnectionState);

  // --- Local state (acceptable to reset on mount) ---
  const [input, setInputRaw] = useState('');
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [contextLoaded, setContextLoaded] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  // --- Refs ---
  const contextRef = useRef<string | null>(null);
  const chatIdRef = useRef(chat.id);
  const draftsRef = useRef(new Map<string, string>());

  // --- Draft persistence across chat switches ---
  const setInput = useCallback((value: string) => {
    setInputRaw(value);
    draftsRef.current.set(chatIdRef.current, value);
  }, []);

  // Restore draft + reset local state when switching chats
  useEffect(() => {
    if (chatIdRef.current !== chat.id) {
      // Save outgoing draft
      draftsRef.current.set(chatIdRef.current, input);
      chatIdRef.current = chat.id;
    }

    // Restore incoming draft
    setInputRaw(draftsRef.current.get(chat.id) ?? '');

    // Reset local state that doesn't survive switches
    setStreamingContent(null);
    setContextLoaded(false);
    contextRef.current = null;
    // Sync sending state from store for the new chat
    // (no setState needed — `sending` selector already reads from store)
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Cold-start load from SQLite ---
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const storeMessages = useDashboardStore.getState().hubChatMessages[chat.id];
    if (storeMessages && storeMessages.length > 0) return; // already loaded

    let cancelled = false;
    void hubChatMessagesLoad(chat.id, 200).then((rows) => {
      if (cancelled || rows.length === 0) return;
      const restored = rows.map(fromPersistedHubMessage);
      useDashboardStore.getState().setHubChatMessages(chat.id, restored, true); // merge!
    }).catch((err) => {
      console.warn('[ScopedChat] SQLite load failed:', err);
    });
    return () => { cancelled = true; };
  }, [chat.id]);

  // --- Build scoped context on mount / chat identity change ---
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
  }, [chat.id, chat.projectId, chat.itemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Probe session model on mount (populate badge before first send) ---
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
          const store = useDashboardStore.getState();
          const existing = store.hubChatModelState[chat.id];
          // Only set if not already populated (don't overwrite send-time detection)
          if (!existing?.label) {
            const rawModel = snapshot.model ?? 'unknown model';
            store.setHubChatModelState(chat.id, {
              label,
              tooltip: snapshot.provider ? `${snapshot.provider} · ${rawModel}` : rawModel,
            });
          }
        }
      }
    }).catch(() => {/* silently ignore */});
    return () => { cancelled = true; };
  }, [chat.id, chat.sessionKey]);

  // --- Clear unread on open ---
  useEffect(() => {
    if (chat.unread) {
      void hubChatUpdate(chat.id, { unread: false });
      const { hubChats, setHubChats } = useDashboardStore.getState();
      setHubChats(hubChats.map((c) => (c.id === chat.id ? { ...c, unread: false } : c)));
    }
  }, [chat.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Build display messages (real messages + streaming preview) ---
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

  // --- Send handler ---
  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const store = useDashboardStore.getState();
    const originChatId = chat.id;

    // 1. Create user message
    const userMessage: ChatMessage = {
      role: 'user',
      content: text,
      timestamp: Date.now(),
      _id: generateMessageId(),
    };

    // 2. Snapshot prior messages BEFORE mutation (matches main chat pattern —
    //    avoids stale-snapshot pitfall of reading back after set())
    const priorMessages = store.hubChatMessages[originChatId] ?? [];

    // 3. Add to store (atomic dedup-then-append)
    store.addHubChatMessage(originChatId, userMessage);

    // 4. Clear input + mark busy
    setInputRaw('');
    draftsRef.current.set(originChatId, '');
    store.addHubBusyChatId(originChatId);
    store.addHubStreamingChatId(originChatId);
    setStreamingContent(null);

    // 5. Build history for send — prior snapshot + user message (same as main chat)
    const historyForSend = [...priorMessages, userMessage];

    // 6. Prepend context on first send
    const contextInjected = store.hubChatContextInjected[originChatId];
    if (contextRef.current && !contextInjected) {
      historyForSend.unshift({
        role: 'system' as const,
        content: contextRef.current,
        timestamp: Date.now(),
      });
      store.setHubChatContextInjected(originChatId, true);
    }

    try {
      const viewContext = store.viewContext;
      // Safety timeout — gateway can get stuck in an infinite poll loop if WS drops mid-send
      const SEND_TIMEOUT_MS = 2 * 60 * 1000;
      const result = await Promise.race([
        sendMessageWithContext(
          historyForSend,
          {
            view: viewContext.type,
            selectedProject: chat.title,
            surface: 'hub-scoped-chat',
          },
          {
            sessionKey: chat.sessionKey ?? undefined,
            skipTurnTracking: true,
            onStreamDelta: (content) => {
              // Guard: only update local streaming state if still on the originating chat
              if (chatIdRef.current === originChatId) {
                setStreamingContent(content);
              }
            },
          },
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('Request timed out — the connection may be unstable. Try again.')),
            SEND_TIMEOUT_MS,
          ),
        ),
      ]);

      // Check if user switched away while awaiting the response
      const switchedAway = chatIdRef.current !== originChatId;

      if (!switchedAway) {
        setStreamingContent(null);
      }
      useDashboardStore.getState().setGatewayConnected(true);

      // Aborted runs: show confirmation and return early
      if (result.aborted) {
        useDashboardStore.getState().addHubChatMessage(originChatId, {
          role: 'assistant',
          content: '*Run stopped.*',
          timestamp: Date.now(),
          _id: generateMessageId(),
        });
        return;
      }

      // Add response messages via store (each goes through dedup pipeline)
      for (const msg of result.messages) {
        const withId: ChatMessage = { ...msg, _id: msg._id ?? generateMessageId() };
        useDashboardStore.getState().addHubChatMessage(originChatId, withId);
      }

      // Extract model badge + usage
      if (result.runtimeModel || result.runtimeProvider) {
        const ml = formatModelDisplayName(result.runtimeModel);
        const pl = formatProviderDisplayName(result.runtimeProvider);
        const label = pl && ml ? `${pl} · ${ml}` : ml ?? pl;
        const rawModel = result.runtimeModel ?? 'unknown model';
        useDashboardStore.getState().setHubChatModelState(originChatId, {
          label,
          tooltip: result.runtimeProvider ? `${result.runtimeProvider} · ${rawModel}` : rawModel,
        });
      }
      if (result.usage) {
        useDashboardStore.getState().setHubChatModelState(originChatId, { usage: result.usage });
      }

      // Mark unread if user isn't currently viewing this chat
      const currentStore = useDashboardStore.getState();
      const notViewing = switchedAway
        || !currentStore.hubDrawerOpen
        || currentStore.hubActiveChatId !== originChatId;
      if (notViewing) {
        void hubChatUpdate(originChatId, { unread: true });
        currentStore.setHubChats(
          currentStore.hubChats.map((c) => (c.id === originChatId ? { ...c, unread: true } : c)),
        );
      }

      // Update activity + message count metadata
      void hubChatUpdateActivity(originChatId);
      const chatRecord = useDashboardStore.getState().hubChats.find((c) => c.id === originChatId);
      if (chatRecord) {
        void hubChatUpdate(originChatId, {
          messageCount: (chatRecord.messageCount ?? 0) + 1 + result.messages.length,
        });
      }

      // Auto-name chat from first user message if title is generic
      if (!contextInjected && isGenericTitle(chat.title)) {
        const autoTitle = text.slice(0, 60) + (text.length > 60 ? '...' : '');
        void hubChatUpdate(originChatId, { title: autoTitle }).then(() => {
          const s = useDashboardStore.getState();
          s.setHubChats(s.hubChats.map((c) => (c.id === originChatId ? { ...c, title: autoTitle } : c)));
        }).catch((err) => {
          console.warn('[ScopedChat] Auto-name failed:', err);
        });
      }
    } catch (error) {
      console.error('[ScopedChat] Send failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const classification = classifyUpstreamFailure(errorMsg);

      // Add classified error bubble
      useDashboardStore.getState().addHubChatMessage(originChatId, {
        role: 'system' as const,
        content: classification.action
          ? `${classification.title}: ${classification.action}`
          : `Failed to send: ${errorMsg}`,
        timestamp: Date.now(),
        _id: generateMessageId(),
      });

      // Update connection state for connection-level errors
      if (classification.type === 'upstream_failure') {
        useDashboardStore.getState().setGatewayConnected(false);
      }
    } finally {
      const finalStore = useDashboardStore.getState();
      finalStore.removeHubBusyChatId(originChatId);
      finalStore.removeHubStreamingChatId(originChatId);
      if (chatIdRef.current === originChatId) {
        setStreamingContent(null);
      }
    }
  }, [input, sending, chat.id, chat.sessionKey, chat.title]);

  const lastAbortAtRef = useRef(0);
  const handleStop = useCallback(async () => {
    const now = Date.now();
    if (now - lastAbortAtRef.current < 500) return;
    lastAbortAtRef.current = now;
    try {
      await abortActiveRun(chat.sessionKey ?? undefined);
    } catch (err) {
      console.warn('[ScopedChat] chat.abort failed:', err);
      // Scoped chats don't have system bubbles — error is logged only
    }
  }, [chat.sessionKey]);

  return {
    messages,
    displayMessages,
    streamingContent,
    input,
    sending,
    contextLoaded,
    gatewayConnected,
    wsConnectionState,
    modelLabel: modelState?.label ?? null,
    modelTooltip: modelState?.tooltip ?? null,
    modelUsage: modelState?.usage ?? null,
    dragActive,
    setInput,
    setDragActive,
    handleSend,
    handleStop,
  };
}
