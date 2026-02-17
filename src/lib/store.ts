import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatConnectionState } from '../components/chat/types';
import type { DashboardError } from './errors';
import type { ChatMessage, SystemBubbleKind, SystemBubbleMeta } from './gateway';
import type { ProjectFrontmatter, ProjectViewModel, ThemePreference } from './schema';
import { createProject, getProjects, removeProject, updateProject, type ProjectUpdate } from './projects';
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
  ) => Promise<void>;
  loadChatMessages: () => Promise<void>;
  loadMoreChatMessages: () => Promise<void>;
  clearChatHistory: () => Promise<void>;
  setSelectedProjectId: (id?: string) => void;
  updateProjectAndReload: (project: ProjectViewModel, updates: ProjectUpdate) => Promise<void>;
  createProjectAndReload: (
    dirPath: string,
    frontmatter: ProjectFrontmatter,
    content: string,
  ) => Promise<void>;
  deleteProjectAndReload: (filePath: string) => Promise<void>;
}

// Helper to generate unique message IDs
function generateMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
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

  return {
    role: m.role as ChatMessage['role'],
    content: m.content,
    timestamp: m.timestamp,
    _id: m.id,
    ...(systemMeta ? { systemMeta } : {}),
  };
}

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
        // Generate ID upfront so state and DB use the same ID
        const id = message._id ?? generateMessageId();
        const timestamp = message.timestamp ?? Date.now();
        
        const messageWithMeta = {
          ...message,
          timestamp,
          _id: id, // Store ID for potential future updates
        };
        
        // Add to state immediately (optimistic)
        set((state) => ({
          chatMessages: [...state.chatMessages, messageWithMeta],
        }));
        
        // Persist to SQLite if in Tauri (fire-and-forget, acceptable if lost on quick close)
        if (isTauriRuntime()) {
          try {
            await chatMessageSave({
              id,
              role: message.role,
              content: message.content,
              timestamp,
              metadata: message.systemMeta
                ? JSON.stringify({ systemMeta: message.systemMeta })
                : undefined,
            });
          } catch (error) {
            console.error('[Store] Failed to persist message:', error);
          }
        }
      },

      addSystemBubble: async (kind, title, details, actions, runId, content) => {
        return get().addChatMessage({
          role: 'system',
          content: content ?? title,
          timestamp: Date.now(),
          systemMeta: { kind, title, details, actions, ...(runId ? { runId } : {}) },
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
            chatMessages: messages.map((m) => deserializePersistedMessage(m)),
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
            chatMessages: [...newMessages, ...state.chatMessages],
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

      updateProjectAndReload: async (project, updates) => {
        await updateProject(project, updates);
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
    }),
    {
      name: 'clawchestra-state',
      partialize: (state) => ({
        themePreference: state.themePreference,
      }),
    },
  ),
);
