import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatConnectionState } from '../components/chat/types';
import type { DashboardError } from './errors';
import type { ChatMessage, SystemBubbleAction, SystemBubbleKind, SystemBubbleMeta } from './gateway';
import type { ProjectFrontmatter, ProjectViewModel, ThemePreference } from './schema';
import type { StateJsonMergedPayload, ClawchestraReadyPayload, RoadmapItemState } from './state-json';
import type { ValidationRejection } from './tauri';
import { createProject, getProjects, removeProject, updateProject, type ProjectUpdate } from './projects';
import { autoCommitIfLocalOnly } from './auto-commit';
import { defaultView, type ViewContext } from './views';
import {
  chatMessagesLoad,
  chatMessageSave,
  chatMessagesClear,
  chatMessagesCount,
  getAllProjects,
  getDashboardSettings,
  hubChatList,
  hubChatMessageSave,
  injectAgentGuidance,
  isTauriRuntime,
  pathExists,
  type DetectedAgent,
  type PersistedChatMessage,
} from './tauri';
import type { HubChat, HubChatModelState } from './hub-types';
import {
  trackChatPersistenceWrite,
} from './chat-persistence';
import {
  normalizeChatContentForMatch,
  stripAssistantControlDirectives,
} from './chat-normalization';
import {
  isLikelyDuplicateMessage,
  messageIdentitySignature,
  normalizeMessageIdentityContent,
  unwrapUserContentForDisplay,
} from './chat-message-identity';

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 480;
export const SIDEBAR_DEFAULT_WIDTH = 280;

export interface TerminalActivityEntry {
  lastOutputAt: number;
  lastViewedAt: number;
  isActive: boolean;
  actionRequired: boolean;
  connectionError: string | null;
  lastCaptureHash: string;
}

interface DashboardState {
  projects: ProjectViewModel[];
  /** Roadmap items per project (keyed by project ID). Populated from db.json via get_all_projects. */
  roadmapItems: Record<string, RoadmapItemState[]>;
  errors: DashboardError[];
  gatewayConnected: boolean;
  wsConnectionState: ChatConnectionState;
  wsConnectionErrorReason: string | null;
  agentActivity: 'idle' | 'typing' | 'working' | 'compacting';
  viewContext: ViewContext;
  chatMessages: ChatMessage[];
  chatHasMore: boolean;
  chatLoadingMore: boolean;
  themePreference: ThemePreference;
  loading: boolean;
  selectedProjectId?: string;
  activeSessionModel: string | null;
  activeSessionProvider: string | null;
  /** Collapsed columns per board. Key: board id ("projects" | "roadmap:{projectId}"), Value: collapsed column status ids */
  collapsedColumns: Record<string, string[]>;
  /** Minimized columns per board. Key: board id ("projects" | "roadmap:{projectId}"), Value: minimized column status ids */
  minimizedColumns: Record<string, string[]>;
  /** Custom column order per board. Key: board id, Value: ordered status ids */
  columnOrder: Record<string, string[]>;
  chatDraft: string | null;
  validationRejections: Record<string, ValidationRejection[]>;
  buildErrors: { message: string; timestamp: number }[];
  sidebarOpen: boolean;
  sidebarSide: 'left' | 'right';
  sidebarWidth: number;
  thinSidebarSide: 'left' | 'right';
  // Hub state
  sidebarMode: 'default' | 'settings';
  hubActiveChatId: string | null;
  hubDrawerOpen: boolean;
  hubDrawerWidth: number;
  hubCollapsedThreads: string[];
  hubThreadOrder: string[];
  hubChats: HubChat[];
  /** Custom folders not linked to any project — keyed by synthetic folder ID (e.g. "folder-{timestamp}"). */
  customFolders: Record<string, { name: string }>;
  /** Transient set of chat IDs currently waiting for a response (not persisted). */
  hubBusyChatIds: Set<string>;
  /** Transient per-chat message history — keyed by chatId (not persisted). */
  hubChatMessages: Partial<Record<string, ChatMessage[]>>;
  /** Transient per-chat model/usage badge state (not persisted). */
  hubChatModelState: Partial<Record<string, HubChatModelState>>;
  /** Transient set of chat IDs currently streaming a response — for sidebar indicator (not persisted). */
  hubStreamingChatIds: Set<string>;
  /** Tracks whether system context has been injected on first send for each chat (not persisted). */
  hubChatContextInjected: Partial<Record<string, boolean>>;
  /** Detected coding agents on the system (transient, not persisted). */
  detectedAgents: DetectedAgent[];
  /** Terminal chats with confirmed running tmux sessions (transient). */
  activeTerminalChatIds: Set<string>;
  /** True after the first tmux session discovery completes — prevents false-dead flash on startup. */
  terminalStatusReady: boolean;
  /** Whether the quit guard dialog is visible (transient). */
  quitGuardOpen: boolean;
  /** Per-terminal activity state for sidebar indicators (transient). */
  terminalActivity: Record<string, TerminalActivityEntry>;
  // Hub actions
  setSidebarMode: (mode: 'default' | 'settings') => void;
  setHubActiveChatId: (id: string | null) => void;
  setHubDrawerOpen: (open: boolean) => void;
  setHubDrawerWidth: (width: number) => void;
  toggleHubThread: (projectId: string) => void;
  setHubThreadOrder: (order: string[]) => void;
  setHubChats: (chats: HubChat[]) => void;
  refreshHubChats: () => Promise<void>;
  addHubBusyChatId: (id: string) => void;
  removeHubBusyChatId: (id: string) => void;
  /** Add a message to a hub chat — atomic dedup-then-append inside a single set() updater. */
  addHubChatMessage: (chatId: string, message: ChatMessage) => void;
  /** Bulk set (or merge) messages for a hub chat — used for cold-start SQLite load. */
  setHubChatMessages: (chatId: string, messages: ChatMessage[], merge?: boolean) => void;
  /** Partial-update model/tooltip/usage for a hub chat. */
  setHubChatModelState: (chatId: string, update: Partial<HubChatModelState>) => void;
  /** Mark system context as injected for a hub chat (first-send tracking). */
  setHubChatContextInjected: (chatId: string, injected: boolean) => void;
  /** Clean up all transient state for a deleted hub chat — prevents memory leaks. */
  clearHubChatState: (chatId: string) => void;
  /** Mark a hub chat as actively streaming (for sidebar indicator). */
  addHubStreamingChatId: (id: string) => void;
  /** Unmark a hub chat from streaming. */
  removeHubStreamingChatId: (id: string) => void;
  /** Set detected agents (from startup scan). */
  setDetectedAgents: (agents: DetectedAgent[]) => void;
  /** Set active terminal chat IDs (tmux sessions that are running). */
  setActiveTerminalChatIds: (ids: Set<string>) => void;
  /** Show/hide the quit guard dialog. */
  setQuitGuardOpen: (open: boolean) => void;
  /** Add a custom folder. */
  addCustomFolder: (id: string, name: string) => void;
  /** Rename a custom folder. */
  renameCustomFolder: (id: string, name: string) => void;
  /** Delete a custom folder. */
  deleteCustomFolder: (id: string) => void;
  /** Merge partial activity updates for a terminal chat. */
  updateTerminalActivity: (chatId: string, update: Partial<TerminalActivityEntry>) => void;
  /** Mark a terminal as viewed — resets unread + action-required. */
  markTerminalViewed: (chatId: string) => void;

  setChatDraft: (message: string | null) => void;
  setValidationRejections: (rejections: Record<string, ValidationRejection[]>) => void;
  dismissValidationRejection: (projectId: string, timestamp: number) => void;
  addBuildError: (message: string) => void;
  dismissBuildError: (timestamp: number) => void;
  clearBuildErrors: () => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarSide: (side: 'left' | 'right') => void;
  setSidebarWidth: (width: number) => void;
  setThinSidebarSide: (side: 'left' | 'right') => void;

  setProjects: (projects: ProjectViewModel[]) => void;
  setRoadmapItemsForProject: (projectId: string, items: RoadmapItemState[]) => void;
  loadProjects: () => Promise<void>;
  addError: (error: DashboardError) => void;
  clearError: (error: DashboardError) => void;
  clearErrorsByType: (type: DashboardError['type']) => void;
  setGatewayConnected: (connected: boolean) => void;
  setWsConnectionState: (state: ChatConnectionState) => void;
  setWsConnectionErrorReason: (reason: string | null) => void;
  setAgentActivity: (state: 'idle' | 'typing' | 'working' | 'compacting') => void;
  setViewContext: (view: ViewContext) => void;
  setThemePreference: (pref: ThemePreference) => void;
  setActiveSessionModel: (model: string | null, provider: string | null) => void;
  addChatMessage: (message: ChatMessage) => Promise<void>;
  addSystemBubble: (
    kind: SystemBubbleKind,
    title: string,
    details?: Record<string, string>,
    actions?: SystemBubbleAction[],
    runId?: string,
    content?: string,
    loading?: boolean,
  ) => Promise<void>;
  loadChatMessages: () => Promise<void>;
  loadMoreChatMessages: () => Promise<void>;
  clearChatHistory: () => Promise<void>;
  setSelectedProjectId: (id?: string) => void;
  toggleColumnCollapse: (boardId: string, columnId: string) => void;
  toggleColumnMinimize: (boardId: string, columnId: string) => void;
  isColumnCollapsed: (boardId: string, columnId: string) => boolean;
  isColumnMinimized: (boardId: string, columnId: string) => boolean;
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
  if (message.role === 'assistant') {
    const sanitized = stripAssistantControlDirectives(message.content);
    if (sanitized === message.content) return message;
    return {
      ...message,
      content: sanitized,
    };
  }

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

function sortChatMessagesChronologically(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((a, b) => {
    const aTimestamp = a.timestamp ?? 0;
    const bTimestamp = b.timestamp ?? 0;
    if (aTimestamp !== bTimestamp) return aTimestamp - bTimestamp;

    const aId = a._id ?? '';
    const bId = b._id ?? '';
    if (aId && bId && aId !== bId) return aId.localeCompare(bId);
    return 0;
  });
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

/** Stable empty array for hub chat selectors — avoids unstable `?? []` refs. */
const EMPTY_HUB_MESSAGES: ChatMessage[] = [];

/** Export for use in useScopedChatSession selectors. */
export { EMPTY_HUB_MESSAGES };

function toPersistedHubMessage(msg: ChatMessage): PersistedChatMessage {
  return {
    id: msg._id ?? generateMessageId(),
    role: msg.role,
    content: msg.content,
    timestamp: msg.timestamp ?? Date.now(),
  };
}

function normalizeBoardColumnState(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== 'object') return {};
  const normalized: Record<string, string[]> = {};
  for (const [boardId, columns] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(columns)) continue;
    normalized[boardId] = columns.filter((columnId): columnId is string => typeof columnId === 'string');
  }
  return normalized;
}

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => ({
      projects: [],
      roadmapItems: {},
      errors: [],
      gatewayConnected: false,
      wsConnectionState: 'disconnected' as ChatConnectionState,
      wsConnectionErrorReason: null,
      agentActivity: 'idle',
      viewContext: defaultView(),
      chatMessages: [],
      chatHasMore: true,
      chatLoadingMore: false,
      themePreference: 'system',
      loading: false,
      selectedProjectId: undefined,
      activeSessionModel: null,
      activeSessionProvider: null,
      collapsedColumns: {},
      minimizedColumns: {},
      columnOrder: {},
      chatDraft: null,
      validationRejections: {},
      buildErrors: [],
      sidebarOpen: false,
      sidebarSide: 'left',
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      thinSidebarSide: 'left',
      // Hub defaults
      sidebarMode: 'default',
      hubActiveChatId: null,
      hubDrawerOpen: false,
      hubDrawerWidth: 400,
      hubCollapsedThreads: [],
      hubThreadOrder: [],
      hubChats: [],
      customFolders: {},
      hubBusyChatIds: new Set<string>(),
      hubChatMessages: {},
      hubChatModelState: {},
      hubStreamingChatIds: new Set<string>(),
      hubChatContextInjected: {},
      detectedAgents: [],
      activeTerminalChatIds: new Set<string>(),
      terminalStatusReady: false,
      quitGuardOpen: false,
      terminalActivity: {},

      setProjects: (projects) => set({ projects }),
      setRoadmapItemsForProject: (projectId, items) =>
        set((state) => ({
          roadmapItems: {
            ...state.roadmapItems,
            [projectId]: items,
          },
        })),

      loadProjects: async () => {
        set({ loading: true });
        try {
          const settings = await getDashboardSettings();
          const result = await getProjects(settings.scanPaths);

          // Also fetch roadmap items and migration status from db.json (Phase 5.17)
          let roadmapItems: Record<string, RoadmapItemState[]> = {};
          if (isTauriRuntime()) {
            try {
              const dbProjects = await getAllProjects();
              const migrationMap = new Map<string, boolean>();
              for (const p of dbProjects) {
                if (p.roadmapItems.length > 0) {
                  roadmapItems[p.id] = p.roadmapItems;
                }
                migrationMap.set(p.id, p.stateJsonMigrated);
              }
              // Merge stateJsonMigrated flag and hasRoadmap into ProjectViewModel
              for (const proj of result.projects) {
                const migrated = migrationMap.get(proj.id);
                if (migrated !== undefined) {
                  proj.stateJsonMigrated = migrated;
                }
                // Migrated projects: roadmap items live in db.json, not ROADMAP.md
                if (roadmapItems[proj.id]?.length > 0) {
                  proj.hasRoadmap = true;
                }
              }
            } catch {
              // Non-fatal: roadmap items will be loaded on next event
            }
          }

          set({ projects: result.projects, roadmapItems, errors: result.errors, loading: false });
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

      setWsConnectionErrorReason: (wsConnectionErrorReason) => set({ wsConnectionErrorReason }),

      setAgentActivity: (agentActivity) => set({ agentActivity }),

      setViewContext: (viewContext) => set({ viewContext }),

      setThemePreference: (themePreference) => set({ themePreference }),

      setActiveSessionModel: (activeSessionModel, activeSessionProvider) =>
        set({ activeSessionModel, activeSessionProvider }),

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
        const shouldDedupeByContentAndTime = !normalizedMessage._id;
        const duplicateByContentAndTime =
          shouldDedupeByContentAndTime &&
          existingMessages.some((existing) => {
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
          chatMessages: collapseChatDuplicates(
            sortChatMessagesChronologically([...state.chatMessages, messageWithMeta]),
          ),
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
            chatMessages: collapseChatDuplicates(
              sortChatMessagesChronologically(
                messages.map((m) => deserializePersistedMessage(m)),
              ),
            ),
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
            chatMessages: collapseChatDuplicates(
              sortChatMessagesChronologically([...newMessages, ...state.chatMessages]),
            ),
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

      toggleColumnMinimize: (boardId, columnId) =>
        set((state) => {
          const current = state.minimizedColumns[boardId] ?? [];
          const isMinimized = current.includes(columnId);
          const next = isMinimized
            ? current.filter((id) => id !== columnId)
            : [...current, columnId];
          return {
            minimizedColumns: {
              ...state.minimizedColumns,
              [boardId]: next,
            },
          };
        }),

      isColumnCollapsed: (boardId, columnId) => {
        const current = get().collapsedColumns[boardId] ?? [];
        return current.includes(columnId);
      },

      isColumnMinimized: (boardId, columnId) => {
        const current = get().minimizedColumns[boardId] ?? [];
        return current.includes(columnId);
      },

      setColumnOrder: (boardId, order) =>
        set((state) => ({
          columnOrder: {
            ...state.columnOrder,
            [boardId]: order,
          },
        })),

      setChatDraft: (chatDraft) => set({ chatDraft }),
      setValidationRejections: (validationRejections) => set({ validationRejections }),
      dismissValidationRejection: (projectId, timestamp) =>
        set((state) => {
          const projectRejections = state.validationRejections[projectId];
          if (!projectRejections) return state;
          return {
            validationRejections: {
              ...state.validationRejections,
              [projectId]: projectRejections.map((r) =>
                r.timestamp === timestamp ? { ...r, resolved: true } : r,
              ),
            },
          };
        }),
      addBuildError: (message) =>
        set((state) => ({
          buildErrors: [...state.buildErrors, { message, timestamp: Date.now() }],
        })),
      dismissBuildError: (timestamp) =>
        set((state) => ({
          buildErrors: state.buildErrors.filter((e) => e.timestamp !== timestamp),
        })),
      clearBuildErrors: () => set({ buildErrors: [] }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setSidebarSide: (sidebarSide) => set({ sidebarSide }),
      setSidebarWidth: (width) =>
        set({ sidebarWidth: Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width)) }),
      setThinSidebarSide: (thinSidebarSide) => set({ thinSidebarSide }),

      // Hub actions
      setSidebarMode: (sidebarMode) => set({ sidebarMode }),
      setHubActiveChatId: (hubActiveChatId) => set({ hubActiveChatId }),
      setHubDrawerOpen: (hubDrawerOpen) => set({ hubDrawerOpen }),
      setHubDrawerWidth: (width) =>
        set({ hubDrawerWidth: Math.min(1200, Math.max(280, width)) }),
      toggleHubThread: (projectId) =>
        set((state) => {
          const collapsed = state.hubCollapsedThreads;
          if (collapsed.includes(projectId)) {
            return { hubCollapsedThreads: collapsed.filter((id) => id !== projectId) };
          }
          return { hubCollapsedThreads: [...collapsed, projectId] };
        }),
      setHubThreadOrder: (hubThreadOrder) => set({ hubThreadOrder }),
      addCustomFolder: (id, name) =>
        set((state) => ({
          customFolders: { ...state.customFolders, [id]: { name } },
        })),
      renameCustomFolder: (id, name) =>
        set((state) => {
          if (!state.customFolders[id]) return {};
          return { customFolders: { ...state.customFolders, [id]: { name } } };
        }),
      deleteCustomFolder: (id) =>
        set((state) => {
          const { [id]: _, ...rest } = state.customFolders;
          return {
            customFolders: rest,
            hubCollapsedThreads: state.hubCollapsedThreads.filter((t) => t !== id),
            hubThreadOrder: state.hubThreadOrder.filter((t) => t !== id),
          };
        }),
      setHubChats: (hubChats) => set({ hubChats }),
      refreshHubChats: async () => {
        if (!isTauriRuntime()) return;
        try {
          const chats = await hubChatList(undefined, true);
          set({ hubChats: chats });
        } catch (err) {
          console.warn('[Store] Failed to refresh hub chats:', err);
        }
      },
      addHubBusyChatId: (id) =>
        set((state) => {
          const next = new Set(state.hubBusyChatIds);
          next.add(id);
          return { hubBusyChatIds: next };
        }),
      removeHubBusyChatId: (id) =>
        set((state) => {
          const next = new Set(state.hubBusyChatIds);
          next.delete(id);
          return { hubBusyChatIds: next };
        }),

      // Hub chat message actions (Phase 2.x: unified scoped chat infrastructure)
      addHubChatMessage: (chatId, message) => {
        set((state) => {
          // 1. Sanitize
          const sanitized = sanitizeIncomingChatMessage(message);

          // 2. Generate ID if missing
          const id = sanitized._id ?? generateMessageId();
          const timestamp = sanitized.timestamp ?? Date.now();
          const messageWithMeta = { ...sanitized, _id: id, timestamp };

          // 3. Dedup check — simple signature match against last 20 messages
          const existing = state.hubChatMessages[chatId] ?? [];
          const sig = messageIdentitySignature(messageWithMeta);
          const isDupe = existing.slice(-20).some((m) => messageIdentitySignature(m) === sig);
          if (isDupe) return state; // no-op

          // 4. Append + sort (hub chats are mostly append-only, sort is cheap insurance)
          const updated = sortChatMessagesChronologically([...existing, messageWithMeta]);

          // 5. Persist (fire-and-forget with tracking)
          if (isTauriRuntime()) {
            void trackChatPersistenceWrite(
              hubChatMessageSave(chatId, toPersistedHubMessage(messageWithMeta)),
            ).catch((err) => {
              console.warn('[Store] Failed to persist hub message:', err);
            });
          }

          return { hubChatMessages: { ...state.hubChatMessages, [chatId]: updated } };
        });
      },

      setHubChatMessages: (chatId, messages, merge = false) => {
        set((state) => {
          const existing = state.hubChatMessages[chatId] ?? [];
          let final: ChatMessage[];
          if (merge && existing.length > 0) {
            // Merge loaded messages with any that arrived via WS during the async SQLite load
            const seen = new Set<string>();
            final = sortChatMessagesChronologically(
              [...existing, ...messages].filter((m) => {
                const sig = messageIdentitySignature(m);
                if (seen.has(sig)) return false;
                seen.add(sig);
                return true;
              }),
            );
          } else {
            final = messages;
          }
          return { hubChatMessages: { ...state.hubChatMessages, [chatId]: final } };
        });
      },

      setHubChatModelState: (chatId, update) => {
        set((state) => {
          const current = state.hubChatModelState[chatId] ?? { label: null, tooltip: null, usage: null };
          return {
            hubChatModelState: {
              ...state.hubChatModelState,
              [chatId]: { ...current, ...update },
            },
          };
        });
      },

      setHubChatContextInjected: (chatId, injected) => {
        set((state) => ({
          hubChatContextInjected: { ...state.hubChatContextInjected, [chatId]: injected },
        }));
      },

      clearHubChatState: (chatId) => {
        set((state) => {
          const { [chatId]: _msgs, ...restMsgs } = state.hubChatMessages;
          const { [chatId]: _model, ...restModel } = state.hubChatModelState;
          const { [chatId]: _ctx, ...restCtx } = state.hubChatContextInjected;
          const newBusy = new Set(state.hubBusyChatIds);
          newBusy.delete(chatId);
          const newStreaming = new Set(state.hubStreamingChatIds);
          newStreaming.delete(chatId);
          return {
            hubChatMessages: restMsgs,
            hubChatModelState: restModel,
            hubChatContextInjected: restCtx,
            hubBusyChatIds: newBusy,
            hubStreamingChatIds: newStreaming,
          };
        });
      },

      addHubStreamingChatId: (id) =>
        set((state) => ({
          hubStreamingChatIds: new Set(state.hubStreamingChatIds).add(id),
        })),
      removeHubStreamingChatId: (id) =>
        set((state) => {
          const next = new Set(state.hubStreamingChatIds);
          next.delete(id);
          return { hubStreamingChatIds: next };
        }),

      setDetectedAgents: (agents) => set({ detectedAgents: agents }),
      setActiveTerminalChatIds: (ids) => set({ activeTerminalChatIds: ids, terminalStatusReady: true }),
      setQuitGuardOpen: (open) => set({ quitGuardOpen: open }),

      updateTerminalActivity: (chatId, update) =>
        set((state) => {
          const defaults: TerminalActivityEntry = {
            lastOutputAt: 0, lastViewedAt: 0, isActive: false,
            actionRequired: false, connectionError: null, lastCaptureHash: '',
          };
          const prev = state.terminalActivity[chatId] ?? defaults;
          return {
            terminalActivity: {
              ...state.terminalActivity,
              [chatId]: { ...prev, ...update },
            },
          };
        }),

      markTerminalViewed: (chatId) =>
        set((state) => {
          const prev = state.terminalActivity[chatId];
          const wasActionRequired = prev?.actionRequired ?? false;
          return {
            terminalActivity: {
              ...state.terminalActivity,
              [chatId]: {
                lastOutputAt: prev?.lastOutputAt ?? 0,
                // Clear hash so the background poll seeds fresh from tmux
                // on the next cycle (avoids stale hash → false activity).
                lastCaptureHash: '',
                lastViewedAt: Date.now(),
                // Don't clear actionRequired — it should persist until the user
                // actually resolves the prompt and the PTY detects resumed output.
                actionRequired: wasActionRequired,
                // Don't clear connectionError — it persists until the TUI
                // reconnects and detectConnectionError returns null.
                connectionError: prev?.connectionError ?? null,
                // Always clear isActive — once the user is viewing the terminal,
                // TerminalShell's onData handler takes over activity management.
                // Stale isActive from the background poll would otherwise persist
                // because TerminalShell's local tracker starts fresh on mount and
                // the deactivation interval never fires for it.
                isActive: false,
              },
            },
          };
        }),

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

        // Fire-and-forget: inject agent guidance on git projects
        void pathExists(`${dirPath}/.git`).then((hasGit) => {
          if (hasGit) void injectAgentGuidance(dirPath).catch(() => {});
        }).catch(() => {});
      },

      deleteProjectAndReload: async (filePath) => {
        await removeProject(filePath);
        await get().loadProjects();
      },

      updateProjectFromEvent: (payload) => {
        if (!payload.projectId) return;
        const { projects, roadmapItems } = get();
        const existingIdx = projects.findIndex(
          (p) => p.id === payload.projectId || p.frontmatter?.id === payload.projectId,
        );

        // Phase 5.17: Store roadmap items in the dedicated store field
        const nextRoadmapItems = { ...roadmapItems };
        if (payload.roadmapItems.length > 0) {
          nextRoadmapItems[payload.projectId] = payload.roadmapItems;
        }

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
          set({ projects: next, roadmapItems: nextRoadmapItems });
        } else {
          // Project not in UI yet — still store roadmap items for when it appears
          set({ roadmapItems: nextRoadmapItems });
        }
      },
    }),
    {
      name: 'clawchestra-state',
      partialize: (state) => ({
        themePreference: state.themePreference,
        collapsedColumns: state.collapsedColumns,
        minimizedColumns: state.minimizedColumns,
        columnOrder: state.columnOrder,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        thinSidebarSide: state.thinSidebarSide,
        // Hub state (persisted)
        sidebarMode: state.sidebarMode,
        hubActiveChatId: state.hubActiveChatId,
        hubDrawerOpen: state.hubDrawerOpen,
        hubDrawerWidth: state.hubDrawerWidth,
        hubCollapsedThreads: state.hubCollapsedThreads,
        hubThreadOrder: state.hubThreadOrder,
        customFolders: state.customFolders,
        // Terminal activity — persist timestamps so unread state survives restarts.
        // Strip transient fields (isActive, actionRequired, connectionError, lastCaptureHash).
        terminalActivity: Object.fromEntries(
          Object.entries(state.terminalActivity).map(([id, entry]) => [
            id,
            { lastOutputAt: entry.lastOutputAt, lastViewedAt: entry.lastViewedAt,
              isActive: false, actionRequired: false, connectionError: null, lastCaptureHash: '' },
          ]),
        ),
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<DashboardState>;
        return {
          ...currentState,
          ...persisted,
          collapsedColumns: normalizeBoardColumnState(persisted.collapsedColumns),
          minimizedColumns: normalizeBoardColumnState(persisted.minimizedColumns),
          columnOrder: normalizeBoardColumnState(persisted.columnOrder),
        };
      },
    },
  ),
);
