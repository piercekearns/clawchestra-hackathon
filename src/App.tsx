import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Clock4 } from 'lucide-react';
import { GitHubStatusBadge } from './components/GitHubStatusBadge';
import { AddProjectDialog } from './components/AddProjectDialog';
import { Board } from './components/Board';
import { Breadcrumb } from './components/Breadcrumb';
import { LifecycleActionBar } from './components/LifecycleActionBar';
import { ProjectModal } from './components/modal';
import type { ProjectModalActions } from './components/modal';
import { Header } from './components/Header';
import { SettingsDialog } from './components/SettingsDialog';
import { ChatShell, createQueueId } from './components/chat';
import { SearchModal } from './components/search';
import type {
  ChatConnectionState,
  ChatPrefillRequest,
  ChatSendPayload,
  QueuedMessage,
} from './components/chat';
import {
  buildLifecyclePrompt,
  type DeliverableLifecycleAction,
} from './lib/deliverable-lifecycle';
import type { DashboardError } from './lib/errors';
import {
  checkGatewayConnection,
  DEFAULT_SESSION_KEY,
  pollProcessSessions,
  recoverRecentSessionMessages,
  subscribeConnectionState,
  subscribeSystemEvents,
  retryGatewayConnection,
  sendMessageWithContext,
  teardownSystemEventBus,
  type ChatMessage,
  type GatewayImageAttachment,
  wireSystemEventBus,
} from './lib/gateway';
import { commitPlanningDocs, pushRepo } from './lib/git';
import { reorderProjects, updateProject, type ProjectUpdate } from './lib/projects';
import { enrichItemsWithDocs, readRoadmap, resolveDocFiles, writeRoadmap } from './lib/roadmap';
import { RoadmapItemDialog } from './components/modal/RoadmapItemDialog';
import type {
  GitStatus,
  ProjectStatus,
  ProjectViewModel,
  RoadmapDocument,
  RoadmapItemWithDocs,
  ThemePreference,
} from './lib/schema';
import type { DashboardSettings } from './lib/settings';
import { useDashboardStore } from './lib/store';
import {
  getDashboardSettings,
  isTauriRuntime,
  updateDashboardSettings,
} from './lib/tauri';
import { defaultView, projectRoadmapView } from './lib/views';
import { watchProjects } from './lib/watcher';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

function flattenProjects(projects: ProjectViewModel[]): ProjectViewModel[] {
  return projects.flatMap((project) => [project, ...flattenProjects(project.children)]);
}

function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = preference === 'dark' || (preference === 'system' && systemDark);
  root.classList.toggle('dark', isDark);
}

const ANNOUNCE_TERMINAL_DEDUP_MS = 45_000;
const BACKGROUND_POLL_INTERVAL_MS = 30_000;
const CONNECTION_LOSS_BUBBLE_DELAY_MS = 5000;
const SESSION_KEY_PATTERN = /\bagent:[a-z0-9:_-]+\b/gi;

function getGitHubStatusMeta(
  status?: GitStatus,
): { className: string; label: string; tooltip: string } {
  switch (status?.state) {
    case 'clean':
      return {
        className: 'text-emerald-500 dark:text-emerald-400',
        label: 'Repository is clean',
        tooltip: status.details || 'Repository is clean.',
      };
    case 'uncommitted':
      return {
        className: 'text-amber-500 dark:text-amber-400',
        label: 'Repository has uncommitted changes',
        tooltip: status.details || 'Repository has uncommitted changes.',
      };
    case 'unpushed':
      return {
        className: 'text-sky-500 dark:text-sky-400',
        label: 'Repository has unpushed commits',
        tooltip: status.details || 'Repository has unpushed commits.',
      };
    case 'behind':
      return {
        className: 'text-rose-500 dark:text-rose-400',
        label: 'Repository is behind remote',
        tooltip: status.details || 'Repository is behind its remote.',
      };
    default:
      return {
        className: 'text-neutral-500 dark:text-neutral-400',
        label: 'Git status unavailable',
        tooltip: status?.details || 'Git status unavailable.',
      };
  }
}

function pruneExpiredRuns(map: Map<string, number>, ttlMs: number): void {
  const now = Date.now();
  for (const [runId, ts] of map.entries()) {
    if (now - ts > ttlMs) {
      map.delete(runId);
    }
  }
}

function extractBackgroundSessionKeys(content: string): string[] {
  const matches = content.match(SESSION_KEY_PATTERN) ?? [];
  return [...new Set(matches)].filter((key) => key !== DEFAULT_SESSION_KEY);
}

export default function App() {
  const projects = useDashboardStore((state) => state.projects);
  const errors = useDashboardStore((state) => state.errors);
  const chatMessages = useDashboardStore((state) => state.chatMessages);
  const agentActivity = useDashboardStore((state) => state.agentActivity);
  const gatewayConnected = useDashboardStore((state) => state.gatewayConnected);
  const wsConnectionState = useDashboardStore((state) => state.wsConnectionState);
  const themePreference = useDashboardStore((state) => state.themePreference);
  const viewContext = useDashboardStore((state) => state.viewContext);
  const loading = useDashboardStore((state) => state.loading);
  const selectedProjectId = useDashboardStore((state) => state.selectedProjectId);

  const loadProjects = useDashboardStore((state) => state.loadProjects);
  const setProjects = useDashboardStore((state) => state.setProjects);
  const addError = useDashboardStore((state) => state.addError);
  const setGatewayConnected = useDashboardStore((state) => state.setGatewayConnected);
  const setThemePreference = useDashboardStore((state) => state.setThemePreference);
  const setViewContext = useDashboardStore((state) => state.setViewContext);
  const addChatMessage = useDashboardStore((state) => state.addChatMessage);
  const addSystemBubble = useDashboardStore((state) => state.addSystemBubble);
  const loadChatMessages = useDashboardStore((state) => state.loadChatMessages);
  const loadMoreChatMessages = useDashboardStore((state) => state.loadMoreChatMessages);
  const chatHasMore = useDashboardStore((state) => state.chatHasMore);
  const chatLoadingMore = useDashboardStore((state) => state.chatLoadingMore);
  const setSelectedProjectId = useDashboardStore((state) => state.setSelectedProjectId);
  const updateProjectAndReload = useDashboardStore((state) => state.updateProjectAndReload);
  const deleteProjectAndReload = useDashboardStore((state) => state.deleteProjectAndReload);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings | null>(null);
  const [roadmapDocument, setRoadmapDocument] = useState<RoadmapDocument | null>(null);
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItemWithDocs[]>([]);
  const [selectedRoadmapItemId, setSelectedRoadmapItemId] = useState<string | null>(null);
  const [chatStreamingContent, setChatStreamingContent] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false); // Track if agent is working
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [chatPrefillRequest, setChatPrefillRequest] = useState<ChatPrefillRequest | null>(null);
  const [chatResponseToastMessage, setChatResponseToastMessage] = useState<string | null>(null);
  const [chatQueue, setChatQueue] = useState<QueuedMessage[]>([]); // Message queue
  const [activeBackgroundSessions, setActiveBackgroundSessions] = useState<Set<string>>(new Set());
  const activeAnnounceRunsRef = useRef<Map<string, number>>(new Map());
  const seenTerminalAnnounceRunsRef = useRef<Map<string, number>>(new Map());
  const chatDrawerOpenRef = useRef(chatDrawerOpen);
  const chatQueueRef = useRef(chatQueue);
  const lastChatRecoveryAtRef = useRef(0);

  const registerBackgroundSession = useCallback((sessionKey: string) => {
    if (!sessionKey || sessionKey === DEFAULT_SESSION_KEY) return;

    setActiveBackgroundSessions((prev) => {
      if (prev.has(sessionKey)) return prev;
      const next = new Set(prev);
      next.add(sessionKey);
      return next;
    });
  }, []);

  const allProjects = useMemo(() => flattenProjects(projects), [projects]);

  // Filter out sub-projects from top-level view
  const topLevelProjects = useMemo(
    () => projects.filter((p) => !p.frontmatter.parent),
    [projects],
  );

  const selectedProject = useMemo(
    () => allProjects.find((project) => project.id === selectedProjectId),
    [allProjects, selectedProjectId],
  );

  const isRoadmapView = viewContext.type === 'roadmap';
  const activeRoadmapProject = useMemo(() => {
    if (viewContext.type !== 'roadmap') return undefined;
    return allProjects.find((project) => project.id === viewContext.projectId);
  }, [allProjects, viewContext]);

  const searchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return allProjects.filter((project) => {
      const matchesStatus = statusFilter === 'all' || project.status === statusFilter;
      if (!matchesStatus) return false;
      if (!normalizedQuery) return true;

      const searchable = [
        project.title,
        project.id,
        project.nextAction ?? '',
        project.blockedBy ?? '',
        ...(project.tags ?? []),
      ]
        .join(' ')
        .toLowerCase();

      return searchable.includes(normalizedQuery);
    });
  }, [allProjects, searchQuery, statusFilter]);

  const chatConnectionState = useMemo<ChatConnectionState>(() => {
    if (wsConnectionState === 'reconnecting') return 'reconnecting';
    if (wsConnectionState === 'error') return 'error';
    if (gatewayConnected) return 'connected';
    return 'disconnected';
  }, [gatewayConnected, wsConnectionState]);

  const chatActivityLabel = useMemo(() => {
    // Event-driven labels take priority when they're more specific
    if (agentActivity === 'typing') return 'Typing...';
    if (agentActivity === 'working') return 'Working...';
    // Fallback: if a send is in-flight, always show activity
    // (mirrors OpenClaw webchat: indicator persists from send to final)
    if (chatSending) return 'Working...';
    return null;
  }, [agentActivity, chatSending]);

  const pushToast = (kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((current) => [...current, { id, kind, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3600);
  };

  useEffect(() => {
    chatDrawerOpenRef.current = chatDrawerOpen;
  }, [chatDrawerOpen]);

  useEffect(() => {
    chatQueueRef.current = chatQueue;
  }, [chatQueue]);

  useEffect(() => {
    applyTheme(themePreference);

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const listener = () => {
      if (themePreference === 'system') applyTheme('system');
    };

    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, [themePreference]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  // Load persisted chat messages on startup
  useEffect(() => {
    void loadChatMessages();
  }, [loadChatMessages]);

  useEffect(() => {
    if (!isTauriRuntime()) return;

    const loadSettings = async () => {
      try {
        const settings = await getDashboardSettings();
        setDashboardSettings(settings);
      } catch (error) {
        addError({
          type: 'parse_failure',
          file: 'settings',
          error: error instanceof Error ? error.message : 'Failed to load settings',
        });
      }
    };

    void loadSettings();
  }, [addError]);

  // Initial connection attempt — wires Zustand bridge via getTauriOpenClawConnection
  useEffect(() => {
    void checkGatewayConnection();
  }, []);

  useEffect(() => {
    void wireSystemEventBus();

    const unsubscribeSystemEvents = subscribeSystemEvents((event) => {
      if (event.kind === 'compaction') {
        void addSystemBubble(
          'compaction',
          'Conversation compacted',
          {
            Note: 'Older messages were summarized to free context space',
          },
          undefined,
          event.runId,
          event.message,
        );
        return;
      }

      if (event.kind === 'error') {
        void addSystemBubble(
          'failure',
          'Background task failed',
          {
            Error: event.message ?? 'Unknown error',
            ...(event.label ? { Task: event.label } : {}),
          },
          ['Check logs for details'],
          event.runId,
          event.message,
        );
        return;
      }

      if (event.kind === 'announce') {
        if (event.sessionKey && event.sessionKey !== DEFAULT_SESSION_KEY) {
          registerBackgroundSession(event.sessionKey);
        }
        const status = (event.status ?? '').toLowerCase();
        const runId = event.runId;
        const isStart = status === 'started' || status === 'running';
        const isFailure = status === 'error' || status === 'timeout';
        const isSuccess = status === 'ok';
        const isTerminal = isFailure || isSuccess;
        const now = Date.now();

        pruneExpiredRuns(activeAnnounceRunsRef.current, 10 * 60_000);
        pruneExpiredRuns(seenTerminalAnnounceRunsRef.current, ANNOUNCE_TERMINAL_DEDUP_MS);

        if (runId && isStart) {
          activeAnnounceRunsRef.current.set(runId, now);
          return;
        }

        if (runId && isTerminal) {
          const seenAt = seenTerminalAnnounceRunsRef.current.get(runId);
          if (seenAt && now - seenAt < ANNOUNCE_TERMINAL_DEDUP_MS) {
            return;
          }
          seenTerminalAnnounceRunsRef.current.set(runId, now);
          activeAnnounceRunsRef.current.delete(runId);
        }

        if (!isTerminal) return;

        void addSystemBubble(
          isFailure ? 'failure' : 'completion',
          isFailure ? 'Sub-agent failed' : 'Sub-agent completed',
          {
            ...(event.label ? { Label: event.label } : {}),
            ...(event.runtime ? { Runtime: event.runtime } : {}),
            ...(event.status ? { Status: event.status } : {}),
          },
          isFailure ? ['Check logs for details'] : undefined,
          runId,
          event.message,
        );
      }
    });

    const unsubscribeConnectionState = subscribeConnectionState((state) => {
      if (state === 'connected') {
        void wireSystemEventBus();
      }
    });

    return () => {
      unsubscribeSystemEvents();
      unsubscribeConnectionState();
      teardownSystemEventBus();
    };
  }, [addSystemBubble, registerBackgroundSession]);

  // System bubbles for connection state transitions
  useEffect(() => {
    let prevState: ChatConnectionState = useDashboardStore.getState().wsConnectionState;
    let lossBubbleTimer: number | null = null;
    let lossBubbleShown = false;

    const clearLossBubbleTimer = () => {
      if (lossBubbleTimer !== null) {
        window.clearTimeout(lossBubbleTimer);
        lossBubbleTimer = null;
      }
    };

    const scheduleLossBubble = () => {
      if (lossBubbleTimer !== null || lossBubbleShown) return;
      lossBubbleTimer = window.setTimeout(() => {
        lossBubbleTimer = null;
        lossBubbleShown = true;
        void addSystemBubble('info', 'Gateway connection lost', {
          Status: 'Reconnecting...',
        });
      }, CONNECTION_LOSS_BUBBLE_DELAY_MS);
    };

    const unsubscribe = subscribeConnectionState((nextState) => {
      if (nextState === prevState) return;

      if (nextState === 'reconnecting' && prevState === 'connected') {
        scheduleLossBubble();
      } else if (nextState === 'connected') {
        clearLossBubbleTimer();
        if (lossBubbleShown || prevState === 'error') {
          void addSystemBubble('info', 'Connection restored');
        }
        lossBubbleShown = false;
      } else if (nextState === 'error') {
        clearLossBubbleTimer();
        lossBubbleShown = false;
        void addSystemBubble('failure', 'Connection failed after 5 attempts', {
          Action: 'Click retry to try again.',
        });
      } else if (nextState === 'disconnected' && prevState === 'connected') {
        scheduleLossBubble();
      }

      prevState = nextState;
    });

    return () => {
      clearLossBubbleTimer();
      unsubscribe();
    };
  }, [addSystemBubble]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (wsConnectionState !== 'connected') return;

    const now = Date.now();
    if (now - lastChatRecoveryAtRef.current < 5000) {
      return;
    }
    lastChatRecoveryAtRef.current = now;

    let cancelled = false;

    const reconcileRecentHistory = async () => {
      try {
        const recovered = await recoverRecentSessionMessages({ limit: 200 });
        if (cancelled || recovered.length === 0) return;

        const current = useDashboardStore.getState().chatMessages;
        const existingIds = new Set(
          current
            .map((message) => message._id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        const existingFallbackKeys = new Set(
          current.map(
            (message) =>
              `${message.role}:${message.timestamp ?? 0}:${message.content}`,
          ),
        );

        let recoveredCount = 0;
        for (const message of recovered) {
          if (message._id && existingIds.has(message._id)) continue;
          const fallbackKey = `${message.role}:${message.timestamp ?? 0}:${message.content}`;
          if (existingFallbackKeys.has(fallbackKey)) continue;

          await addChatMessage(message);
          if (message._id) existingIds.add(message._id);
          existingFallbackKeys.add(fallbackKey);
          recoveredCount += 1;
        }

        if (!cancelled && recoveredCount > 0) {
          await addSystemBubble('info', 'Recovered recent chat messages', {
            Recovered: String(recoveredCount),
          });
        }
      } catch (error) {
        console.warn('[Chat] Failed to reconcile recent gateway history:', error);
      }
    };

    void reconcileRecentHistory();

    return () => {
      cancelled = true;
    };
  }, [addChatMessage, addSystemBubble, wsConnectionState]);

  useEffect(() => {
    let disposed = false;
    let dispose: () => void = () => undefined;
    let fallbackPoll: number | undefined;

    const startWatching = async () => {
      if (!isTauriRuntime() || !dashboardSettings) return;

      try {
        const unwatch = await watchProjects(dashboardSettings.scanPaths, async () => {
          await loadProjects();
          void addSystemBubble(
            'info',
            'File watcher refresh',
            { Time: new Date().toLocaleTimeString() },
          );
        });

        if (disposed) {
          unwatch();
          return;
        }

        dispose = unwatch;
      } catch (error) {
        console.warn('Project watcher unavailable, using polling fallback:', error);
        fallbackPoll = window.setInterval(() => {
          void loadProjects();
        }, 15000);
      }
    };

    void startWatching();

    return () => {
      disposed = true;
      dispose();
      if (fallbackPoll !== undefined) {
        window.clearInterval(fallbackPoll);
      }
    };
  }, [addSystemBubble, loadProjects, dashboardSettings]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!allProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(undefined);
    }
  }, [allProjects, selectedProjectId, setSelectedProjectId]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;

      // Cmd+K / Ctrl+K opens search
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault();
        setSearchOpen(true);
        return;
      }

      if (event.key === 'Escape') {
        if (searchOpen) {
          event.preventDefault();
          setSearchOpen(false);
          return;
        }

        if (chatDrawerOpen) {
          event.preventDefault();
          setChatDrawerOpen(false);
          return;
        }

        if (selectedProjectId) {
          event.preventDefault();
          setSelectedProjectId(undefined);
          return;
        }

        if (addDialogOpen) {
          event.preventDefault();
          setAddDialogOpen(false);
          return;
        }

        if (settingsDialogOpen) {
          event.preventDefault();
          setSettingsDialogOpen(false);
          return;
        }

        if (isRoadmapView) {
          event.preventDefault();
          setViewContext(defaultView());
          setRoadmapDocument(null);
          setRoadmapItems([]);
          return;
        }
      }

      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }

      if (selectedProjectId || addDialogOpen) {
        return;
      }

      if (isRoadmapView || allProjects.length === 0) return;

      const ordered = allProjects;
      const currentIndex = selectedProjectId
        ? ordered.findIndex((project) => project.id === selectedProjectId)
        : -1;

      if (event.key === 'j' || event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        event.preventDefault();
        const nextIndex = currentIndex < 0 ? 0 : Math.min(currentIndex + 1, ordered.length - 1);
        setSelectedProjectId(ordered[nextIndex]?.id);
      }

      if (event.key === 'k' || event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        event.preventDefault();
        const prevIndex = currentIndex < 0 ? 0 : Math.max(currentIndex - 1, 0);
        setSelectedProjectId(ordered[prevIndex]?.id);
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    addDialogOpen,
    allProjects,
    chatDrawerOpen,
    isRoadmapView,
    searchOpen,
    settingsDialogOpen,
    selectedProjectId,
    setSelectedProjectId,
    setViewContext,
  ]);

  const resetToProjectBoard = () => {
    setViewContext(defaultView());
    setRoadmapDocument(null);
    setRoadmapItems([]);
  };

  const openRoadmapView = async (project: ProjectViewModel) => {
    if (!project.roadmapFilePath || !project.hasRoadmap) {
      pushToast('error', `No ROADMAP.md found for ${project.title}`);
      return;
    }

    try {
      const roadmap = await readRoadmap(project.roadmapFilePath);
      let enrichedRoadmapItems: RoadmapItemWithDocs[];

      try {
        const docsMap = await resolveDocFiles(project.dirPath, roadmap.items, project.frontmatter);
        enrichedRoadmapItems = enrichItemsWithDocs(roadmap.items, docsMap);
      } catch {
        enrichedRoadmapItems = roadmap.items.map((item) => ({ ...item, docs: {} }));
      }

      setRoadmapDocument(roadmap);
      setRoadmapItems(enrichedRoadmapItems);
      setViewContext(projectRoadmapView(project.id, project.title));
      setSelectedProjectId(undefined);
    } catch (error) {
      pushToast(
        'error',
        error instanceof Error ? error.message : `Failed to open roadmap for ${project.title}`,
      );
    }
  };

  const persistRoadmapChanges = async (nextItems: RoadmapItemWithDocs[]) => {
    if (!roadmapDocument) return;

    const orderedByColumn: RoadmapItemWithDocs[] = [];
    for (const column of viewContext.columns) {
      const itemsInColumn = nextItems
        .filter((item) => item.status === column.id)
        .map((item, index) => ({
          ...item,
          priority: index + 1,
        }));
      orderedByColumn.push(...itemsInColumn);
    }

    const nextDocument: RoadmapDocument = {
      ...roadmapDocument,
      items: orderedByColumn.map(({ docs: _docs, ...item }) => item),
    };

    const previousItems = roadmapItems;
    setRoadmapItems(orderedByColumn);

    try {
      await writeRoadmap(nextDocument);
      setRoadmapDocument(nextDocument);
      pushToast('success', 'Roadmap saved');
    } catch (error) {
      setRoadmapItems(previousItems);
      pushToast(
        'error',
        error instanceof Error ? error.message : 'Failed to save roadmap changes',
      );
    }
  };

  const handleLifecycleAction = useCallback(
    (item: RoadmapItemWithDocs, action: DeliverableLifecycleAction) => {
      if (!activeRoadmapProject) return;

      const text = buildLifecyclePrompt(action, {
        project: {
          id: activeRoadmapProject.id,
          title: activeRoadmapProject.title,
          dirPath: activeRoadmapProject.dirPath,
        },
        item: {
          id: item.id,
          title: item.title,
          docs: item.docs,
        },
      });

      setChatDrawerOpen(true);
      setChatPrefillRequest({
        id: `prefill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text,
      });
    },
    [activeRoadmapProject],
  );

  const persistBoardChanges = async (nextItems: ProjectViewModel[]) => {
    const previousItems = projects;
    setProjects(nextItems);

    try {
      const previousById = new Map(previousItems.map((item) => [item.id, item]));

      const statusUpdates: Promise<void>[] = [];
      for (const item of nextItems) {
        const before = previousById.get(item.id);
        if (before && before.status !== item.status) {
          const updates: ProjectUpdate = { status: item.status as ProjectStatus };
          // Auto-assign priority when moving to in-flight (required by schema)
          if (item.status === 'in-flight' && item.priority === undefined) {
            const inFlightCount = nextItems.filter(
              (entry) => entry.status === 'in-flight' && entry.id !== item.id,
            ).length;
            updates.priority = inFlightCount + 1;
          }
          // Clear priority when leaving in-flight
          if (before.status === 'in-flight' && item.status !== 'in-flight') {
            updates.priority = null;
          }
          statusUpdates.push(updateProject(item, updates));
        }
      }

      await Promise.all(statusUpdates);

      const reorderJobs = viewContext.columns.map((column) => {
        const orderedIds = nextItems
          .filter((item) => item.status === column.id)
          .map((item) => item.id);
        return reorderProjects(orderedIds, nextItems);
      });

      await Promise.all(reorderJobs);
      await loadProjects();
    } catch (error) {
      setProjects(previousItems);
      const message = error instanceof Error ? error.message : 'Save failed';
      const saveError: DashboardError = {
        type: 'save_failure',
        file: 'drag-and-drop',
        error: message,
      };
      addError(saveError);
      pushToast('error', `Failed to save drag update: ${message}`);
    }
  };

  // Queue a message while agent is working
  const queueChatMessage = (payload: ChatSendPayload) => {
    const queued: QueuedMessage = {
      id: createQueueId(),
      text: payload.text,
      attachments: payload.images,
      queuedAt: Date.now(),
    };
    setChatQueue((current) => [...current, queued]);
  };

  // Remove a message from the queue
  const removeFromChatQueue = (id: string) => {
    setChatQueue((current) => current.filter((item) => item.id !== id));
  };

  // Process the next queued message (called after a send completes)
  const processNextQueuedMessage = async () => {
    const next = chatQueueRef.current[0];
    if (!next) return;

    setChatQueue((current) => current.slice(1));

    // Let UI settle after dequeue before issuing next send.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const ok = await sendChatMessage({ text: next.text, images: next.attachments });

    if (!ok) {
      // Reinsert at the front so failed messages aren't dropped.
      setChatQueue((current) => [next, ...current]);
    }
  };

  useEffect(() => {
    if (activeBackgroundSessions.size === 0) return;

    const interval = setInterval(() => {
      const sessionKeys = [...activeBackgroundSessions];
      if (sessionKeys.length === 0) return;

      void pollProcessSessions(sessionKeys).then((failures) => {
        if (failures.length === 0) return;

        setActiveBackgroundSessions((prev) => {
          const next = new Set(prev);
          for (const failure of failures) {
            next.delete(failure.sessionKey);
          }
          return next;
        });

        for (const failure of failures) {
          void addSystemBubble(
            'failure',
            'Coding agent crashed',
            {
              Session: failure.sessionKey,
              'Exit code': String(failure.exitCode),
              ...(failure.error ? { Error: failure.error } : {}),
            },
            ['Check logs for details'],
          );
        }
      });
    }, BACKGROUND_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeBackgroundSessions, addSystemBubble]);

  const sendChatMessage = async (payload: ChatSendPayload) => {
    const text = payload.text.trim();
    if (!text && payload.images.length === 0) return false;

    const imageSummary =
      payload.images.length > 0
        ? `\n\n[Attached images: ${payload.images.map((image) => image.name).join(', ')}]`
        : '';

    const userMessage: ChatMessage = {
      role: 'user',
      content: `${text || 'Please analyze attached images.'}${imageSummary}`,
      timestamp: Date.now(),
    };

    const attachments: GatewayImageAttachment[] = payload.images.map((image) => ({
      name: image.name,
      mediaType: image.mediaType,
      dataUrl: image.dataUrl,
    }));

    // Read a fresh store snapshot here so send context doesn't rely on a stale
    // render-captured `chatMessages` array.
    const priorMessages = useDashboardStore.getState().chatMessages;

    addChatMessage(userMessage);
    setChatSending(true);
    setChatStreamingContent(null);
    setChatResponseToastMessage(null);

    try {
      const result = await sendMessageWithContext(
        [...priorMessages, userMessage],
        {
          view: viewContext.type,
          selectedProject: selectedProject?.title,
          openclawWorkspacePath: dashboardSettings?.openclawWorkspacePath,
          openclawContextPolicy: dashboardSettings?.openclawContextPolicy,
        },
        {
          attachments,
          onStreamDelta: (content) => {
            setChatStreamingContent(content);
          },
        },
      );

      setChatStreamingContent(null);
      setGatewayConnected(true);
      
      // Add ALL assistant messages (fixes dropped message bug)
      for (const msg of result.messages) {
        addChatMessage(msg);
        if (msg.role === 'assistant') {
          for (const sessionKey of extractBackgroundSessionKeys(msg.content)) {
            registerBackgroundSession(sessionKey);
          }
        }
      }
      
      if (!chatDrawerOpenRef.current && result.lastContent) {
        setChatResponseToastMessage(result.lastContent);
      }
      await loadProjects();
      void processNextQueuedMessage();
      return true;
    } catch (error) {
      console.error('[Chat] === SEND FAILED ===', error);
      const messageText = error instanceof Error ? error.message : 'Gateway request failed';
      const lowerMessage = messageText.toLowerCase();
      // Only mark gateway disconnected for actual connection failures,
      // not for "no response" errors (gateway is reachable, agent just
      // didn't produce output — e.g. session busy, empty response).
      const isConnectionError =
        lowerMessage.includes('not connected') ||
        lowerMessage.includes('connection') ||
        lowerMessage.includes('socket') ||
        lowerMessage.includes('timed out waiting');
      if (isConnectionError) {
        setGatewayConnected(false);
      }
      addError({ type: 'gateway_down', message: messageText });
      void addSystemBubble(
        'failure',
        isConnectionError ? 'Gateway error' : 'No response from agent',
        { Error: messageText },
        isConnectionError ? ['Check logs for details'] : ['Agent may be busy — try again'],
      );
      return false;
    } finally {
      setChatSending(false);
      setChatStreamingContent(null);
    }
  };

  const sendChatText = async (message: string) => {
    return sendChatMessage({ text: message, images: [] });
  };

  const projectModalActions: ProjectModalActions = {
    onSave: async (project, updates) => {
      try {
        await updateProjectAndReload(project, updates);
        pushToast('success', `Updated ${project.title}`);
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Save failed');
      }
    },
    onDelete: async (project) => {
      try {
        await deleteProjectAndReload(project.filePath);
        pushToast('success', `Deleted ${project.title}`);
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Delete failed');
      }
    },
    onMarkReviewed: async (project) => {
      try {
        await updateProjectAndReload(project, {
          lastReviewed: new Date().toISOString().split('T')[0],
        });
        pushToast('success', `Marked ${project.title} as reviewed`);
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Mark reviewed failed');
      }
    },
    onRequestUpdate: async (project) => {
      const ok = await sendChatText(
        `Please review and update status for project \"${project.title}\" (${project.id}).`,
      );
      if (ok) {
        pushToast('success', `Requested update for ${project.title}`);
      } else {
        pushToast('error', `Failed to send update request for ${project.title}`);
      }
    },
    onCommitRepo: async (project) => {
      if (!project.hasGit) {
        pushToast('error', `Project ${project.title} has no git repository.`);
        return;
      }

      try {
        const message = `[Dashboard] Synced planning docs for \"${project.title}\"`;
        await commitPlanningDocs(project.dirPath, message);
        pushToast('success', `Committed planning docs for ${project.title}`);
        await loadProjects();
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Commit failed');
      }
    },
    onPushRepo: async (project) => {
      if (!project.hasGit) {
        pushToast('error', `Project ${project.title} has no git repository.`);
        return;
      }

      try {
        await pushRepo(project.dirPath);
        pushToast('success', `Pushed ${project.title}`);
        await loadProjects();
      } catch (error) {
        pushToast('error', error instanceof Error ? error.message : 'Push failed');
      }
    },
    onOpenLinkedProject: (projectId) => setSelectedProjectId(projectId),
  };

  return (
    <div className="h-screen overflow-hidden bg-page px-4 pb-32 pt-4 text-neutral-900 dark:text-neutral-100 md:px-6 md:pb-36">
      <div className="flex h-full min-h-0 w-full flex-col">
        <Header
          errors={errors}
          onRefresh={loadProjects}
          onAddProject={() => setAddDialogOpen(true)}
          onOpenSettings={() => setSettingsDialogOpen(true)}
          themePreference={themePreference}
          onChangeTheme={setThemePreference}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          statusOptions={viewContext.columns.map((column) => ({
            id: column.id,
            label: column.label,
          }))}
        />

        <div className="mb-4 flex items-center justify-between gap-3">
          <Breadcrumb
            viewContext={viewContext}
            onNavigate={(crumbId) => {
              if (crumbId === 'root') {
                resetToProjectBoard();
              }
            }}
          />
          <div className="text-xs text-neutral-500">
            {loading
              ? 'Loading...'
              : isRoadmapView
                ? `${roadmapItems.length} roadmap item(s)`
                : `${topLevelProjects.length} projects`}
          </div>
        </div>

        {!isRoadmapView && (searchQuery.trim() || statusFilter !== 'all') && (
          <section className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-0 p-3 dark:border-neutral-700 dark:bg-neutral-950/70">
            <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
              <span>{searchResults.length} matching project(s)</span>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setSearchQuery('');
                  setStatusFilter('all');
                }}
              >
                Clear filters
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {searchResults.slice(0, 12).map((project) => (
                <button
                  type="button"
                  key={project.id}
                  className="rounded-full border border-neutral-300 px-3 py-1 text-xs hover:border-revival-accent-400 dark:border-neutral-600"
                  onClick={() => {
                    if (project.hasRoadmap) {
                      void openRoadmapView(project);
                    } else {
                      setSelectedProjectId(project.id);
                    }
                  }}
                >
                  {project.title}
                </button>
              ))}
              {searchResults.length > 12 && (
                <span className="rounded-full border border-dashed border-neutral-300 px-3 py-1 text-xs text-neutral-500 dark:border-neutral-600">
                  +{searchResults.length - 12} more
                </span>
              )}
            </div>
          </section>
        )}

        <main className="min-h-0 flex-1">
          <section className="h-full min-h-0 min-w-0 rounded-2xl border border-neutral-200 bg-neutral-0 p-3 dark:border-neutral-700 dark:bg-neutral-950/70 md:p-4">
            <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto pr-1">
              {isRoadmapView ? (
                <>
                <Board
                  columns={viewContext.columns}
                  items={roadmapItems}
                  boardId={`roadmap:${viewContext.type === 'roadmap' ? viewContext.projectId : 'unknown'}`}
                  onItemClick={(item) => setSelectedRoadmapItemId(item.id)}
                  renderItemHoverActions={(item) => (
                    <LifecycleActionBar
                      specExists={Boolean(item.docs?.spec)}
                      planExists={Boolean(item.docs?.plan)}
                      onAction={(action) => handleLifecycleAction(item, action)}
                    />
                  )}
                  onItemsChange={(nextItems) => {
                    void persistRoadmapChanges(nextItems);
                  }}
                />
                <RoadmapItemDialog
                  item={roadmapItems.find((i) => i.id === selectedRoadmapItemId) ?? null}
                  projectTitle={activeRoadmapProject?.title ?? 'Project'}
                  projectDir={activeRoadmapProject?.dirPath ?? ''}
                  projectFrontmatter={activeRoadmapProject?.frontmatter}
                  onClose={() => setSelectedRoadmapItemId(null)}
                  onStatusChange={(itemId, status) => {
                    const updated = roadmapItems.map((i) =>
                      i.id === itemId ? { ...i, status } : i,
                    );
                    void persistRoadmapChanges(updated);
                  }}
                />
                </>
              ) : (
                <Board
                  columns={viewContext.columns}
                  items={topLevelProjects}
                  onItemClick={(project) => {
                    if (project.hasRoadmap) {
                      void openRoadmapView(project);
                    } else {
                      setSelectedProjectId(project.id);
                    }
                  }}
                  renderItemIndicators={(project) => {
                    const gitHubStatusMeta = getGitHubStatusMeta(project.gitStatus);
                    return (
                      <>
                        {project.isStale ? <Clock4 className="h-4 w-4 text-status-danger" /> : null}
                        {project.hasRepo ? (
                          <GitHubStatusBadge
                            className={gitHubStatusMeta.className}
                            tooltip={gitHubStatusMeta.tooltip}
                            label={gitHubStatusMeta.label}
                          />
                        ) : null}
                        {project.commitActivity ? (
                          <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] dark:bg-neutral-700">
                            {project.commitActivity.commitsThisWeek}/wk
                          </span>
                        ) : null}
                      </>
                    );
                  }}
                  renderItemActions={() => null}
                  onItemsChange={(nextItems) => {
                    void persistBoardChanges(nextItems);
                  }}
                />
              )}
            </div>
          </section>
        </main>
      </div>

      <ChatShell
        messages={chatMessages}
        gatewayConnected={gatewayConnected}
        connectionState={chatConnectionState}
        activityLabel={chatActivityLabel}
        streamingContent={chatStreamingContent}
        prefillRequest={chatPrefillRequest}
        drawerOpen={chatDrawerOpen}
        responseToastMessage={chatResponseToastMessage}
        isAgentWorking={chatSending}
        queue={chatQueue}
        hasMoreMessages={chatHasMore}
        loadingMoreMessages={chatLoadingMore}
        onDrawerOpenChange={setChatDrawerOpen}
        onDismissResponseToast={() => setChatResponseToastMessage(null)}
        onSend={sendChatMessage}
        onQueueMessage={queueChatMessage}
        onRemoveFromQueue={removeFromChatQueue}
        onLoadMore={loadMoreChatMessages}
        onRetryConnection={retryGatewayConnection}
      />

      <ProjectModal
        open={Boolean(selectedProject)}
        project={selectedProject}
        onClose={() => setSelectedProjectId(undefined)}
        actions={projectModalActions}
      />

      <SearchModal
        isOpen={searchOpen}
        projects={allProjects}
        onClose={() => setSearchOpen(false)}
        onSelect={(project) => {
          if (project.hasRoadmap) {
            void openRoadmapView(project);
          } else {
            setSelectedProjectId(project.id);
          }
        }}
      />

      <AddProjectDialog
        open={addDialogOpen}
        settings={dashboardSettings}
        existingProjects={allProjects}
        onClose={() => setAddDialogOpen(false)}
        onComplete={async (message) => {
          try {
            await loadProjects();
            pushToast('success', message);
          } catch (error) {
            pushToast('error', error instanceof Error ? error.message : 'Reload failed');
            throw error;
          }
        }}
      />

      <SettingsDialog
        open={settingsDialogOpen}
        settings={dashboardSettings}
        onClose={() => setSettingsDialogOpen(false)}
        onSave={async (settings) => {
          try {
            const saved = await updateDashboardSettings(settings);
            setDashboardSettings(saved);
            await loadProjects();
            pushToast('success', 'Settings saved');
          } catch (error) {
            pushToast('error', error instanceof Error ? error.message : 'Failed to save settings');
            throw error;
          }
        }}
      />

      <div className="pointer-events-none fixed left-1/2 top-4 z-[70] flex w-full max-w-xl -translate-x-1/2 flex-col items-center gap-2 px-4">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto w-full max-w-md rounded-lg border px-3 py-2 text-sm shadow-lg backdrop-blur ${
              toast.kind === 'error'
                ? 'border-status-danger/45 bg-status-danger/12 text-status-danger dark:bg-status-danger/18'
                : 'border-revival-accent-400/45 bg-neutral-100/92 text-neutral-900 dark:bg-neutral-900/92 dark:text-neutral-100'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
