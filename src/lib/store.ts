import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatConnectionState } from '../components/chat/types';
import type { DashboardError } from './errors';
import type { ChatMessage, SystemBubbleKind, SystemBubbleMeta } from './gateway';
import type { ProjectFrontmatter, ProjectViewModel, ThemePreference } from './schema';
import type { StateJsonMergedPayload, ClawchestraReadyPayload } from './state-json';
import { createProject, getProjects, removeProject, updateProject, type ProjectUpdate } from './projects';
import { autoCommitIfLocalOnly } from './auto-commit';
import { defaultView, type ViewContext } from './views';
import {
  chatMessagesLoad,
  chatMessageSave,
  chatMessagesClear,
  chatMessagesCount,
  getDashboardSettings,
  isTauriRuntime,
  type PersistedChatMessage,
} from './tauri';
import {
  trackChatPersistenceWrite,
} from './chat-persistence';
import {
  normalizeChatContentForMatch,
} from './chat-normalization';
import {
  isLikelyDuplicateMessage,
  messageIdentitySignature,
  normalizeMessageIdentityContent,
  unwrapUserContentForDisplay,
} from './chat-message-identity';

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 280;

interface DashboardState {
  projects: ProjectViewModel[];
  errors: DashboardError[];
  gatewayConnected: boolean;
  wsConnectionState: ChatConnectionState;
  agentActivity: 'idle' | 'typing' | 'working';
  viewContext: ViewContext;
  chatMessages: ChatMessage[];
  chatHasMore: boolean;
  chatLoadingMore: boolean;
  themePreference: ThemePreference;
  loading: boolean;
  selectedProjectId?: string;
  /** Collapsed columns per board. Key: board id ("projects" | "roadmap:{projectId}"), Value: collapsed column status ids */
  collapsedColumns: Record<string, string[]>;
  /** Custom column order per board. Key: board id, Value: ordered status ids */
  columnOrder: Record<string, string[]>;
  sidebarOpen: boolean;
  sidebarWidth: number;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;

  setProjects: (projects: ProjectViewModel[]) => void;
  loadProjects: () => Promise<void>;
  addError: (error: DashboardError) => void;
  clearError: (error: DashboardError) => void;
  clearErrorsByType: (type: DashboardError['type']) => void;
  setGatewayConnected: (connected: boolean) => void;
  setWsConnectionState: (state: ChatConnectionState) => void;
  setAgentActivity: (state: 'idle' | 'typing' | 'working') => void;
  setViewContext: (view: ViewContext) => void;
  setThemePreference: (pref: ThemePreference) => void;
  addChatMessage: (message: ChatMessage) => Promise<void>;
  addSystemBubble: (
    kind: SystemBubbleKind,
    title: string,
    details?: Record<string, string>,
    actions?: string[],
    runId?: string,
    content?: string,
    loading?: boolean,
  ) => Promise<void>;
  loadChatMessages: () => Promise<void>;
  loadMoreChatMessages: () => Promise<void>;
  clearChatHistory: () => Promise<void>;
  setSelectedProjectId: (id?: string) => void;
  toggleColumnCollapse: (boardId: string, columnId: string) => void;
  isColumnCollapsed: (boardId: string, columnId: string) => boolean;
  setColumnOrder: (boardId: string, order: string[]) => void;
  updateProjectAndReload: (project: ProjectViewModel, updates: ProjectUpdate) => Promise<void>;
  createProjectAndReload: (
    dirPath: string,
    frontmatter: ProjectFrontmatter,
    content: string,
  ) => Promise<void>;
  deleteProjectAndReload: (filePath: string) => Promise<void>;
  /** Update a single project from a state-json-merged Tauri event payload (Phase 2.8) */
  updateProjectFromEvent: (payload: StateJsonMergedPayload) => void;
}

// Helper to generate unique message IDs
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const CHAT_PROGRESSIVE_DEDUPE_WINDOW_MS = 10 * 60_000;
const CHAT_RECOVERY_BUBBLE_DEDUPE_WINDOW_MS = 30_000;

function comparableMessageContent(message: ChatMessage): string {
  return normalizeMessageIdentityContent(message);
}

function sanitizeIncomingChatMessage(message: ChatMessage): ChatMessage {
  if (message.role !== 'user') return message;
  const unwrapped = unwrapUserContentForDisplay(message);
  if (!unwrapped) return message;
  return {
    ...message,
    content: unwrapped,
  };
}

function isRecoverySystemBubble(message: ChatMessage): boolean {
  return (
    message.role === 'system' &&
    message.systemMeta?.kind === 'info' &&
    message.systemMeta?.title === 'Recovered recent chat messages'
  );
}

function isCompactionSystemBubble(message: ChatMessage): boolean {
  return message.role === 'system' && message.systemMeta?.kind === 'compaction';
}

function canMergeProgressiveMessage(existing: ChatMessage, incoming: ChatMessage): boolean {
  if (existing.role !== 'assistant' && existing.role !== 'user') return false;
  return isLikelyDuplicateMessage(existing, incoming, CHAT_PROGRESSIVE_DEDUPE_WINDOW_MS);
}

function shouldPreferIncoming(existing: ChatMessage, incoming: ChatMessage): boolean {
  const existingNorm = comparableMessageContent(existing);
  const incomingNorm = comparableMessageContent(incoming);
  if (incomingNorm.length > existingNorm.length) return true;
  if (incomingNorm.length < existingNorm.length) return false;
  return (incoming.timestamp ?? 0) >= (existing.timestamp ?? 0);
}

function collapseTrailingAssistantRun(
  collapsed: ChatMessage[],
  incoming: ChatMessage,
): ChatMessage | null {
  if (incoming.role !== 'assistant' || collapsed.length < 2) return null;

  let runStart = collapsed.length;
  for (let i = collapsed.length - 1; i >= 0; i -= 1) {
    if (collapsed[i].role !== 'assistant') break;
    runStart = i;
  }

  if (runStart >= collapsed.length - 1) return null;

  const run = collapsed.slice(runStart);
  const incomingNorm = comparableMessageContent(incoming);
  const runNorm = normalizeChatContentForMatch(run.map((message) => message.content).join('\n\n'));
  if (!incomingNorm || !runNorm) return null;

  const overlaps =
    incomingNorm === runNorm ||
    incomingNorm.startsWith(runNorm) ||
    runNorm.startsWith(incomingNorm);
  if (!overlaps) return null;

  const newestRunTimestamp = run.reduce((max, message) => Math.max(max, message.timestamp ?? 0), 0);
  if (Math.abs((incoming.timestamp ?? 0) - newestRunTimestamp) > CHAT_PROGRESSIVE_DEDUPE_WINDOW_MS) {
    return null;
  }

  return shouldPreferIncoming(run[run.length - 1], incoming) ? { ...incoming } : null;
}

function collapseChatDuplicates(messages: ChatMessage[]): ChatMessage[] {
  const collapsed: ChatMessage[] = [];

  for (const message of messages) {
    if (collapsed.length === 0) {
      collapsed.push(message);
      continue;
    }

    if (message._id) {
      const sameIdIndex = collapsed.findIndex((existing) => existing._id === message._id);
      if (sameIdIndex >= 0) {
        collapsed[sameIdIndex] = message;
        continue;
      }
    }

    if (isCompactionSystemBubble(message)) {
      const incomingRunId = message.systemMeta?.runId;
      const incomingTs = message.timestamp ?? 0;
      let replaceIndex = -1;
      for (let i = collapsed.length - 1; i >= 0; i -= 1) {
        const existing = collapsed[i];
        if (!isCompactionSystemBubble(existing)) continue;
        const existingRunId = existing.systemMeta?.runId;
        if (incomingRunId && existingRunId && incomingRunId === existingRunId) {
          replaceIndex = i;
          break;
        }
        if (!incomingRunId && !existingRunId) {
          const existingTs = existing.timestamp ?? 0;
          if (Math.abs(existingTs - incomingTs) <= CHAT_RECOVERY_BUBBLE_DEDUPE_WINDOW_MS) {
            replaceIndex = i;
            break;
          }
        }
      }
      if (replaceIndex >= 0) {
        collapsed[replaceIndex] = message;
      } else {
        collapsed.push(message);
      }
      continue;
    }

    if (isRecoverySystemBubble(message)) {
      const incomingRecovered = message.systemMeta?.details?.Recovered ?? '';
      const incomingTs = message.timestamp ?? 0;
      let seenEquivalentRecentBubble = false;
      for (let i = collapsed.length - 1; i >= 0; i -= 1) {
        const existing = collapsed[i];
        const existingTs = existing.timestamp ?? 0;
        if (incomingTs > 0 && existingTs > 0) {
          const ageDelta = Math.abs(incomingTs - existingTs);
          if (ageDelta > CHAT_RECOVERY_BUBBLE_DEDUPE_WINDOW_MS) {
            break;
          }
        }
        if (
          isRecoverySystemBubble(existing) &&
          (existing.systemMeta?.details?.Recovered ?? '') === incomingRecovered
        ) {
          seenEquivalentRecentBubble = true;
          break;
        }
      }
      if (seenEquivalentRecentBubble) {
        continue;
      }
    }

    let mergeIndex = -1;
    for (let i = collapsed.length - 1; i >= 0; i -= 1) {
      const existing = collapsed[i];
      if (existing.role === 'system') continue;
      if (existing.role !== message.role) break;
      if (canMergeProgressiveMessage(existing, message)) {
        mergeIndex = i;
      }
      break;
    }

    if (mergeIndex >= 0) {
      const existing = collapsed[mergeIndex];
      if (shouldPreferIncoming(existing, message)) {
        collapsed[mergeIndex] = {
          ...message,
          _id: message._id ?? existing._id,
        };
      }
      continue;
    }

    const collapsedAssistantRun = collapseTrailingAssistantRun(collapsed, message);
    if (collapsedAssistantRun) {
      while (collapsed.length > 0 && collapsed[collapsed.length - 1]?.role === 'assistant') {
        collapsed.pop();
      }
      collapsed.push(collapsedAssistantRun);
      continue;
    }

    collapsed.push(message);
  }

  return collapsed;
}

function deserializePersistedMessage(m: PersistedChatMessage): ChatMessage {
  let systemMeta: SystemBubbleMeta | undefined;

  if (m.metadata) {
    try {
      const parsed = JSON.parse(m.metadata) as { systemMeta?: SystemBubbleMeta };
      if (parsed?.systemMeta) {
        systemMeta = parsed.systemMeta;
      }
    } catch {
      // Ignore malformed metadata and fall back to plain messages.
    }
  }

  const message: ChatMessage = {
    role: m.role as ChatMessage['role'],
    content: m.content,
    timestamp: m.timestamp,
    _id: m.id,
    ...(systemMeta ? { systemMeta } : {}),
  };
  return sanitizeIncomingChatMessage(message);
}

export const __storeTestUtils = {
  collapseChatDuplicates,
};

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      projects: [],
      errors: [],
      gatewayConnected: false,
      wsConnectionState: 'disconnected' as ChatConnectionState,
      agentActivity: 'idle',
      viewContext: defaultView(),
      chatMessages: [],
      chatHasMore: true,
      chatLoadingMore: false,
      themePreference: 'system',
      loading: false,
      selectedProjectId: undefined,
      collapsedColumns: {},
      columnOrder: {},
      sidebarOpen: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,

      setProjects: (projects) => set({ projects }),

      loadProjects: async () => {
        set({ loading: true });
        try {
          const settings = await getDashboardSettings();
          const result = await getProjects(settings.scanPaths);
          set({ projects: result.projects, errors: result.errors, loading: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed loading projects';
          set((state) => ({
            loading: false,
            errors: [...state.errors, { type: 'parse_failure', file: 'projects', error: message }],
          }));
        }
      },

      addError: (error) => set((state) => ({ errors: [...state.errors, error] })),

      clearError: (error) =>
        set((state) => ({
          errors: state.errors.filter((entry) => JSON.stringify(entry) !== JSON.stringify(error)),
        })),

      clearErrorsByType: (type) =>
        set((state) => ({ errors: state.errors.filter((entry) => entry.type !== type) })),

      setGatewayConnected: (gatewayConnected) => set({ gatewayConnected }),

      setWsConnectionState: (wsConnectionState) => set({ wsConnectionState }),

      setAgentActivity: (agentActivity) => set({ agentActivity }),

      setViewContext: (viewContext) => set({ viewContext }),

      setThemePreference: (themePreference) => set({ themePreference }),

      addChatMessage: async (message) => {
        const normalizedMessage = sanitizeIncomingChatMessage(message);
        // Generate ID upfront so state and DB use the same ID
        const id = normalizedMessage._id ?? generateMessageId();
        const timestamp = normalizedMessage.timestamp ?? Date.now();
        const existingMessages = get().chatMessages;
        const incomingSignature = messageIdentitySignature({
          ...normalizedMessage,
          timestamp,
        });
        const duplicateById = existingMessages.some((existing) => existing._id === id);
        const duplicateByContentAndTime = existingMessages.some((existing) => {
          const existingSignature = messageIdentitySignature(existing);
          return (
            existingSignature === incomingSignature &&
            Math.abs((existing.timestamp ?? 0) - timestamp) <= CHAT_PROGRESSIVE_DEDUPE_WINDOW_MS
          );
        });

        if (duplicateById || duplicateByContentAndTime) {
          return;
        }

        const messageWithMeta = {
          ...normalizedMessage,
          timestamp,
          _id: id, // Store ID for potential future updates
        };
        
        // Add to state immediately (optimistic)
        set((state) => ({
          chatMessages: collapseChatDuplicates([...state.chatMessages, messageWithMeta]),
        }));
        
        // Persist to SQLite if in Tauri (fire-and-forget, acceptable if lost on quick close)
        if (isTauriRuntime()) {
          const write = trackChatPersistenceWrite(
            chatMessageSave({
              id,
              role: normalizedMessage.role,
              content: normalizedMessage.content,
              timestamp,
              metadata: normalizedMessage.systemMeta
                ? JSON.stringify({ systemMeta: normalizedMessage.systemMeta })
                : undefined,
            }),
          );
          try {
            await write;
          } catch (error) {
            console.error('[Store] Failed to persist message:', error);
          }
        }
      },

      addSystemBubble: async (kind, title, details, actions, runId, content, loading) => {
        // Don't duplicate title as content — only use title as fallback
        // when there are no details (otherwise it shows the same text twice)
        const resolvedContent = content ?? (details ? '' : title);
        return get().addChatMessage({
          role: 'system',
          content: resolvedContent,
          timestamp: Date.now(),
          systemMeta: {
            kind,
            title,
            details,
            actions,
            ...(runId ? { runId } : {}),
            ...(typeof loading === 'boolean' ? { loading } : {}),
          },
        });
      },

      loadChatMessages: async () => {
        if (!isTauriRuntime()) {
          console.log('[Store] Not in Tauri, skipping chat persistence');
          return;
        }
        
        try {
          const messages = await chatMessagesLoad(undefined, 50);
          const total = await chatMessagesCount();
          
          set({
            chatMessages: collapseChatDuplicates(messages.map((m) => deserializePersistedMessage(m))),
            chatHasMore: messages.length < total,
          });
          
          console.log(`[Store] Loaded ${messages.length} messages (${total} total)`);
        } catch (error) {
          console.error('[Store] Failed to load chat messages:', error);
        }
      },

      loadMoreChatMessages: async () => {
        if (!isTauriRuntime()) return;
        
        const { chatMessages, chatHasMore, chatLoadingMore } = get();
        if (!chatHasMore || chatLoadingMore) return;
        
        set({ chatLoadingMore: true });
        
        try {
          const oldestMessage = chatMessages[0];
          if (!oldestMessage?.timestamp) {
            set({ chatLoadingMore: false, chatHasMore: false });
            return;
          }
          
          const olderMessages = await chatMessagesLoad(
            oldestMessage.timestamp,
            50,
            oldestMessage._id,
          );
          
          if (olderMessages.length === 0) {
            set({ chatLoadingMore: false, chatHasMore: false });
            return;
          }
          
          // Deduplicate by persisted message id.
          const existingIds = new Set(
            chatMessages
              .map((m) => m._id)
              .filter((id): id is string => typeof id === 'string' && id.length > 0),
          );
          
          const newMessages = olderMessages
            .filter((m) => !existingIds.has(m.id))
            .map((m) => deserializePersistedMessage(m));
          
          set((state) => ({
            chatMessages: collapseChatDuplicates([...newMessages, ...state.chatMessages]),
            chatLoadingMore: false,
            chatHasMore: olderMessages.length === 50,
          }));
          
          console.log(`[Store] Loaded ${newMessages.length} more messages (${olderMessages.length - newMessages.length} duplicates filtered)`);
        } catch (error) {
          console.error('[Store] Failed to load more messages:', error);
          set({ chatLoadingMore: false });
        }
      },

      clearChatHistory: async () => {
        set({ chatMessages: [], chatHasMore: false });
        
        if (isTauriRuntime()) {
          try {
            await chatMessagesClear();
            console.log('[Store] Chat history cleared');
          } catch (error) {
            console.error('[Store] Failed to clear chat history:', error);
          }
        }
      },

      setSelectedProjectId: (selectedProjectId) => set({ selectedProjectId }),

      toggleColumnCollapse: (boardId, columnId) =>
        set((state) => {
          const current = state.collapsedColumns[boardId] ?? [];
          const isCollapsed = current.includes(columnId);
          const next = isCollapsed
            ? current.filter((id) => id !== columnId)
            : [...current, columnId];
          return {
            collapsedColumns: {
              ...state.collapsedColumns,
              [boardId]: next,
            },
          };
        }),

      isColumnCollapsed: (boardId, columnId) => {
        const current = get().collapsedColumns[boardId] ?? [];
        return current.includes(columnId);
      },

      setColumnOrder: (boardId, order) =>
        set((state) => ({
          columnOrder: {
            ...state.columnOrder,
            [boardId]: order,
          },
        })),

      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)) }),

      updateProjectAndReload: async (project, updates) => {
        await updateProject(project, updates);
        // Auto-commit for local-only repos (no remote)
        if (project.hasGit && !project.gitStatus?.remote) {
          await autoCommitIfLocalOnly(
            project.dirPath,
            project.gitStatus,
            ['CLAWCHESTRA.md'],
            { justWritten: true },
          );
        }
        await get().loadProjects();
      },

      createProjectAndReload: async (dirPath, frontmatter, content) => {
        await createProject(dirPath, frontmatter, content);
        await get().loadProjects();
      },

      deleteProjectAndReload: async (filePath) => {
        await removeProject(filePath);
        await get().loadProjects();
      },

      updateProjectFromEvent: (payload) => {
        if (!payload.projectId) return;
        const { projects } = get();
        const existingIdx = projects.findIndex(
          (p) => p.id === payload.projectId || p.frontmatter?.id === payload.projectId,
        );

        if (existingIdx >= 0) {
          // Update existing project — preserve UI-only fields (filePath, dirPath, git*, children, etc.)
          const existing = projects[existingIdx];
          const updated: ProjectViewModel = {
            ...existing,
            // Sync BoardItem-level fields
            title: payload.project.title,
            status: payload.project.status,
            // Sync frontmatter
            frontmatter: {
              ...existing.frontmatter,
              title: payload.project.title,
              status: payload.project.status as ProjectViewModel['frontmatter']['status'],
              tags: payload.project.tags,
              parent: payload.project.parentId ?? undefined,
            },
            // Sync content (description maps to content)
            content: payload.project.description,
            // Update hasRoadmap based on incoming roadmapItems
            hasRoadmap: existing.hasRoadmap || payload.roadmapItems.length > 0,
          };
          const next = [...projects];
          next[existingIdx] = updated;
          set({ projects: next });
        }
        // New project from watcher is deferred to Phase 3+ (requires full ProjectViewModel shape)
      },
    }),
    {
      name: 'clawchestra-state',
      partialize: (state) => ({
        themePreference: state.themePreference,
        collapsedColumns: state.collapsedColumns,
        columnOrder: state.columnOrder,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
      }),
    },
  ),
);
