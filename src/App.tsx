import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, Clock4, GitBranch } from 'lucide-react';
import { GitHubStatusBadge } from './components/GitHubStatusBadge';
import { Tooltip } from './components/Tooltip';
import { AddProjectDialog } from './components/AddProjectDialog';
import { Board } from './components/Board';
import { Breadcrumb } from './components/Breadcrumb';
import { LifecycleActionBar } from './components/LifecycleActionBar';
import { ProjectModal } from './components/modal';
import type { ProjectModalActions } from './components/modal';
import { Header } from './components/Header';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { SettingsDialog } from './components/SettingsDialog';
import { SyncDialog } from './components/SyncDialog';
import { ChatShell, createQueueId } from './components/chat';
import { SearchModal } from './components/search';
import type { SearchableRoadmapItem } from './components/search';
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
  finalizeActiveTurnsForSession,
  getActiveTurnCount,
  hydratePendingTurns,
  pollProcessSessions,
  recoverRecentSessionMessages,
  subscribeConnectionState,
  subscribeTurnRegistry,
  subscribeSystemEvents,
  retryGatewayConnection,
  sendMessageWithContext,
  teardownSystemEventBus,
  type ChatMessage,
  type GatewayImageAttachment,
  wireSystemEventBus,
} from './lib/gateway';
import { commitPlanningDocs, fetchAllRepos, pushRepo } from './lib/git';
import { reorderProjects, updateProject, type ProjectUpdate } from './lib/projects';
import { enrichItemsWithDocs, readRoadmap, resolveDocFiles, writeRoadmap } from './lib/roadmap';
import { autoCommitIfLocalOnly } from './lib/auto-commit';
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
  chatRecoveryCursorAdvance,
  getDashboardSettings,
  isTauriRuntime,
  updateDashboardSettings,
} from './lib/tauri';
import { defaultView, projectRoadmapView } from './lib/views';
import { watchProjects } from './lib/watcher';
import { messageIdentitySignature } from './lib/chat-message-identity';
import { CHAT_RELIABILITY_FLAGS } from './lib/chat-reliability-flags';
import {
  buildFailureBubbleDedupeKey,
  classifyUpstreamFailure,
  shouldParseAssistantContentForSessionDiscovery,
} from './lib/chat-reliability';
import { readExecutionState, isUnresolvedSyncStep } from './lib/git-sync-utils';

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
const BACKGROUND_SESSION_STALE_MS = 3 * 60_000;
const CONNECTION_LOSS_BUBBLE_DELAY_MS = 5000;
const HARD_TERMINAL_ACTIVITY_CLEAR_MS = 10_000;
const RECOVERY_NEAR_DUP_WINDOW_MS = 10 * 60_000;
const RECOVERY_BUBBLE_DEDUP_MS = 5 * 60_000;
const SESSION_KEY_PATTERN = /\bagent:[a-z0-9:_-]+\b/gi;
const UPSTREAM_FAILURE_DEDUP_MS = 60_000;

/** Inline icons for use in tooltips and text */
const InlineBranch = () => (
  <GitBranch className="inline-block h-3 w-3 align-[-2px]" />
);
const InlineCheck = () => (
  <Check
    className="inline-block h-3 w-3 align-[-2px]"
    strokeWidth={2.5}
    strokeLinejoin="miter"
    strokeLinecap="square"
  />
);

function getGitHubStatusMeta(
  status?: GitStatus,
): { className: string; label: string; tooltip: ReactNode } {
  if (!status?.state || status.state === 'unknown') {
    return {
      className: 'text-neutral-500 dark:text-neutral-400',
      label: 'Git status unavailable',
      tooltip: status?.details || 'Git status unavailable',
    };
  }

  const branch = status.branch ?? '?';
  const ahead = status.aheadCount ?? 0;
  const behind = status.behindCount ?? 0;
  const hasRemote = Boolean(status.remote);

  // No upstream — branch isn't published to a remote
  if (!hasRemote) {
    return {
      className: 'text-neutral-500 dark:text-neutral-400',
      label: `${branch} · not linked to GitHub`,
      tooltip: <><InlineBranch /> {branch} · not linked to GitHub — push to connect</>,
    };
  }

  // Universal arrow notation for remote sync state
  let sync = '';
  if (ahead > 0 && behind > 0) sync = ` ↑${ahead} ↓${behind}`;
  else if (ahead > 0) sync = ` ↑${ahead}`;
  else if (behind > 0) sync = ` ↓${behind}`;

  let textSuffix = '';
  if (status.state === 'uncommitted') textSuffix = ' · uncommitted changes';

  const label = `${branch}${sync}${textSuffix}`;
  const isSynced = status.state === 'clean' && sync === '';

  const classMap: Record<string, string> = {
    clean: 'text-emerald-500 dark:text-emerald-400',
    uncommitted: 'text-amber-500 dark:text-amber-400',
    unpushed: 'text-sky-500 dark:text-sky-400',
    behind: 'text-rose-500 dark:text-rose-400',
  };

  return {
    className: classMap[status.state] ?? 'text-neutral-500 dark:text-neutral-400',
    label,
    tooltip: isSynced
      ? <><InlineBranch /> {branch} <InlineCheck /></>
      : <><InlineBranch /> {branch}{sync}{textSuffix}</>,
  };
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
  const setAgentActivity = useDashboardStore((state) => state.setAgentActivity);
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
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
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
  const [gatewayActiveTurns, setGatewayActiveTurns] = useState<number>(getActiveTurnCount());
  const [activeBackgroundSessions, setActiveBackgroundSessions] = useState<Set<string>>(new Set());
  const activeAnnounceRunsRef = useRef<Map<string, number>>(new Map());
  const seenTerminalAnnounceRunsRef = useRef<Map<string, number>>(new Map());
  const chatDrawerOpenRef = useRef(chatDrawerOpen);
  const chatQueueRef = useRef(chatQueue);
  const lastChatRecoveryAtRef = useRef(0);
  const lastRecoveryBubbleRef = useRef<{ signature: string; at: number } | null>(null);
  const recoveryInFlightRef = useRef<Promise<number> | null>(null);
  const backgroundSessionLastSeenRef = useRef<Map<string, number>>(new Map());
  const failureBubbleDedupeRef = useRef<Map<string, number>>(new Map());
  const queueDrainInFlightRef = useRef(false);
  const blockedQueueMessageIdRef = useRef<string | null>(null);
  const hardClearTimerRef = useRef<number | null>(null);
  const lastGatewayActiveTurnsRef = useRef(gatewayActiveTurns);

  const registerBackgroundSession = useCallback((sessionKey: string) => {
    if (!sessionKey || sessionKey === DEFAULT_SESSION_KEY) return;
    backgroundSessionLastSeenRef.current.set(sessionKey, Date.now());

    setActiveBackgroundSessions((prev) => {
      if (prev.has(sessionKey)) return prev;
      const next = new Set(prev);
      next.add(sessionKey);
      return next;
    });
  }, []);

  const allProjects = useMemo(() => flattenProjects(projects), [projects]);

  // Gather roadmap items from all projects for search
  const [allSearchableRoadmapItems, setAllSearchableRoadmapItems] = useState<SearchableRoadmapItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const gatherRoadmapItems = async () => {
      const items: SearchableRoadmapItem[] = [];
      for (const project of allProjects) {
        if (!project.hasRoadmap || !project.roadmapFilePath) continue;
        try {
          const roadmap = await readRoadmap(project.roadmapFilePath);
          for (const item of roadmap.items) {
            items.push({
              ...item,
              projectId: project.id,
              projectTitle: project.title,
            });
          }
        } catch {
          // Skip projects with unreadable roadmaps
        }
      }
      if (!cancelled) setAllSearchableRoadmapItems(items);
    };
    void gatherRoadmapItems();
    return () => { cancelled = true; };
  }, [allProjects]);

  // Filter out sub-projects from top-level view
  const topLevelProjects = useMemo(
    () => projects.filter((p) => !p.frontmatter.parent),
    [projects],
  );

  // Dirty project count for Sync button
  const dirtyProjects = useMemo(
    () => allProjects.filter((p) => p.gitStatus?.hasDirtyFiles),
    [allProjects],
  );

  // Unresolved sync state (conflict/failed persisted in localStorage)
  const [unresolvedSyncCount, setUnresolvedSyncCount] = useState(0);

  const scanUnresolvedSyncState = useCallback(() => {
    let count = 0;
    for (const p of allProjects) {
      if (!p.gitStatus) continue;
      const state = readExecutionState(p.id);
      if (state && isUnresolvedSyncStep(state.currentStep)) count++;
    }
    setUnresolvedSyncCount(count);
  }, [allProjects]);

  useEffect(() => { scanUnresolvedSyncState(); }, [scanUnresolvedSyncState]);

  const selectedProject = useMemo(
    () => allProjects.find((project) => project.id === selectedProjectId),
    [allProjects, selectedProjectId],
  );

  const isRoadmapView = viewContext.type === 'roadmap';
  const activeRoadmapProject = useMemo(() => {
    if (viewContext.type !== 'roadmap') return undefined;
    return allProjects.find((project) => project.id === viewContext.projectId);
  }, [allProjects, viewContext]);

  // Re-resolve roadmap item docs (spec/plan existence) without leaving the view.
  // Stored in a ref so the file watcher can call it without adding deps.
  const refreshRoadmapDocsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    refreshRoadmapDocsRef.current = async () => {
      if (!activeRoadmapProject || !roadmapDocument) return;
      try {
        const docsMap = await resolveDocFiles(
          activeRoadmapProject.dirPath,
          roadmapDocument.items,
          activeRoadmapProject.frontmatter,
        );
        setRoadmapItems((prev) => {
          const enriched = enrichItemsWithDocs(roadmapDocument.items, docsMap);
          // Preserve current ordering/status from prev (user may have dragged items)
          const docsById = new Map(enriched.map((item) => [item.id, item.docs]));
          return prev.map((item) => ({ ...item, docs: docsById.get(item.id) ?? item.docs }));
        });
      } catch {
        // silently fail — items keep existing docs
      }
    };
  }, [activeRoadmapProject, roadmapDocument]);

  const searchResults = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (!normalizedQuery) return allProjects;

    return allProjects.filter((project) => {
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
  }, [allProjects, searchQuery]);

  const chatConnectionState = useMemo<ChatConnectionState>(() => {
    if (wsConnectionState === 'reconnecting') return 'reconnecting';
    if (wsConnectionState === 'error') return 'error';
    if (gatewayConnected) return 'connected';
    return 'disconnected';
  }, [gatewayConnected, wsConnectionState]);

  const isChatBusy = chatSending || gatewayActiveTurns > 0 || activeBackgroundSessions.size > 0;

  const chatActivityLabel = useMemo(() => {
    // Event-driven labels take priority when they're more specific
    if (agentActivity === 'typing') return 'Typing...';
    if (agentActivity === 'working') return 'Working...';
    // Fallback: if a send is in-flight, always show activity
    // (mirrors OpenClaw webchat: indicator persists from send to final)
    if (isChatBusy) {
      return 'Working...';
    }
    return null;
  }, [agentActivity, isChatBusy]);

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
    const unsubscribe = subscribeTurnRegistry((turns) => {
      const active = turns.filter(
        (turn) =>
          turn.status === 'queued' ||
          turn.status === 'running' ||
          turn.status === 'awaiting_output',
      ).length;
      setGatewayActiveTurns(active);
    });

    return () => {
      unsubscribe();
    };
  }, []);

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
    void loadProjects().then(() => {
      // Fire-and-forget: fetch all remotes on startup, then reload to pick up updated refs
      const currentProjects = useDashboardStore.getState().projects;
      const flat = flattenProjects(currentProjects);
      void fetchAllRepos(flat).then(() => loadProjects());
    });
  }, [loadProjects]);

  // Load persisted chat messages on startup
  useEffect(() => {
    void loadChatMessages();
  }, [loadChatMessages]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void hydratePendingTurns(DEFAULT_SESSION_KEY);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (wsConnectionState !== 'connected') return;
    if (chatSending) return;
    if (gatewayActiveTurns <= 0) return;

    let cancelled = false;

    const probeDefaultSession = async () => {
      try {
        const { completed } = await pollProcessSessions([DEFAULT_SESSION_KEY]);
        if (cancelled) return;
        const defaultSessionTerminal = completed.some(
          (entry) => entry.sessionKey === DEFAULT_SESSION_KEY,
        );
        if (defaultSessionTerminal) {
          finalizeActiveTurnsForSession(DEFAULT_SESSION_KEY, 'session_process_terminal');
        }
      } catch {
        // Keep current turn state when probe transport is unavailable.
      }
    };

    void probeDefaultSession();
    const interval = window.setInterval(() => {
      void probeDefaultSession();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [chatSending, gatewayActiveTurns, wsConnectionState]);

  useEffect(() => {
    const clearTimer = () => {
      if (hardClearTimerRef.current !== null) {
        window.clearTimeout(hardClearTimerRef.current);
        hardClearTimerRef.current = null;
      }
    };

    const hasActiveWork = isChatBusy;
    if (hasActiveWork) {
      clearTimer();
      return;
    }

    if (agentActivity === 'idle' && !chatStreamingContent) {
      clearTimer();
      return;
    }

    if (hardClearTimerRef.current !== null) return clearTimer;

    hardClearTimerRef.current = window.setTimeout(() => {
      hardClearTimerRef.current = null;
      const stillNoActiveWork =
        getActiveTurnCount() === 0 &&
        !chatSending &&
        activeBackgroundSessions.size === 0;

      if (!stillNoActiveWork) return;

      setAgentActivity('idle');
      setChatStreamingContent((current) => (current ? null : current));
      console.log(
        `[Chat] Hard-cleared stale activity state after ${HARD_TERMINAL_ACTIVITY_CLEAR_MS}ms`,
      );
    }, HARD_TERMINAL_ACTIVITY_CLEAR_MS);

    return clearTimer;
  }, [
    activeBackgroundSessions.size,
    agentActivity,
    chatSending,
    chatStreamingContent,
    gatewayActiveTurns,
    setAgentActivity,
  ]);

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
        const semanticStatesEnabled = CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states;
        const isCompacting = semanticStatesEnabled && event.compactionState === 'compacting';
        void addSystemBubble(
          'compaction',
          isCompacting ? 'Compacting conversation...' : 'Conversation compacted',
          {
            Note: 'Older messages were summarized to free context space',
            ...(semanticStatesEnabled ? { Status: isCompacting ? 'In progress' : 'Complete' } : {}),
          },
          undefined,
          event.runId,
          event.message,
          isCompacting,
        );
        return;
      }

      if (event.kind === 'error') {
        const detailsMessage = event.message ?? 'Unknown error';
        const classified = classifyUpstreamFailure(detailsMessage);
        const dedupeKey = buildFailureBubbleDedupeKey(
          classified.type,
          event.runId,
          event.sessionKey,
        );
        const now = Date.now();
        for (const [key, seenAt] of failureBubbleDedupeRef.current.entries()) {
          if (now - seenAt > UPSTREAM_FAILURE_DEDUP_MS) {
            failureBubbleDedupeRef.current.delete(key);
          }
        }
        const lastSeen = failureBubbleDedupeRef.current.get(dedupeKey) ?? 0;
        if (now - lastSeen < UPSTREAM_FAILURE_DEDUP_MS) {
          return;
        }
        failureBubbleDedupeRef.current.set(dedupeKey, now);
        void addSystemBubble(
          'failure',
          classified.title,
          {
            Error: detailsMessage,
            ...(event.label ? { Task: event.label } : {}),
          },
          [classified.action],
          event.runId,
          detailsMessage,
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

        const backgroundSessionKey = event.sessionKey;
        if (isTerminal && backgroundSessionKey && backgroundSessionKey !== DEFAULT_SESSION_KEY) {
          backgroundSessionLastSeenRef.current.delete(backgroundSessionKey);
          setActiveBackgroundSessions((prev) => {
            if (!prev.has(backgroundSessionKey)) return prev;
            const next = new Set(prev);
            next.delete(backgroundSessionKey);
            return next;
          });
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

  const reconcileRecentHistory = useCallback(async (): Promise<number> => {
    if (recoveryInFlightRef.current) {
      return recoveryInFlightRef.current;
    }

    const run = (async (): Promise<number> => {
      const now = Date.now();
      if (now - lastChatRecoveryAtRef.current < 5000) {
        return 0;
      }
      lastChatRecoveryAtRef.current = now;

      try {
        const recovered = await recoverRecentSessionMessages({ limit: 200 });
        if (recovered.length === 0) return 0;

        const current = useDashboardStore.getState().chatMessages;
        const existingIds = new Set(
          current
            .map((message) => message._id)
            .filter((id): id is string => typeof id === 'string' && id.length > 0),
        );
        const timestampsBySignature = new Map<string, number[]>();
        for (const message of current) {
          const signature = messageIdentitySignature(message);
          const timestamp = message.timestamp ?? 0;
          const bucket = timestampsBySignature.get(signature) ?? [];
          bucket.push(timestamp);
          timestampsBySignature.set(signature, bucket);
        }

        let recoveredCount = 0;
        const recoveredSignatures: string[] = [];
        const shouldSuppressDuringActiveRun = isChatBusy;
        let lastMergedMessage: ChatMessage | null = null;
        for (const message of recovered) {
          if (shouldSuppressDuringActiveRun && message.role === 'assistant') {
            // During active runs, assistant deltas are already surfaced via
            // streaming. Deferring history backfill avoids duplicate fragment
            // bubbles that can later overlap with combined streamed output.
            continue;
          }
          const timestamp = message.timestamp ?? Date.now();
          if (message._id && existingIds.has(message._id)) continue;

          const contentSignature = messageIdentitySignature(message);
          const priorTimestamps = timestampsBySignature.get(contentSignature) ?? [];
          const isNearDuplicate = priorTimestamps.some(
            (existingTimestamp) =>
              Math.abs(existingTimestamp - timestamp) <= RECOVERY_NEAR_DUP_WINDOW_MS,
          );
          if (isNearDuplicate) continue;

          await addChatMessage({ ...message, timestamp });
          if (message._id) existingIds.add(message._id);
          priorTimestamps.push(timestamp);
          timestampsBySignature.set(contentSignature, priorTimestamps);
          recoveredCount += 1;
          recoveredSignatures.push(message._id ?? `${contentSignature}:${timestamp}`);
          if (message._id) {
            lastMergedMessage = { ...message, timestamp };
          }
        }

        if (
          CHAT_RELIABILITY_FLAGS.chat.recovery_cursoring &&
          lastMergedMessage &&
          lastMergedMessage._id &&
          typeof lastMergedMessage.timestamp === 'number'
        ) {
          try {
            await chatRecoveryCursorAdvance(
              DEFAULT_SESSION_KEY,
              lastMergedMessage.timestamp,
              lastMergedMessage._id,
            );
          } catch (error) {
            console.warn('[Chat] Failed to advance recovery cursor:', error);
          }
        }

        if (recoveredCount > 0) {
          const bubbleSignature = `${recoveredCount}:${recoveredSignatures.join('|')}`;
          const lastBubble = lastRecoveryBubbleRef.current;
          const shouldSuppressBubble =
            shouldSuppressDuringActiveRun ||
            lastBubble &&
            lastBubble.signature === bubbleSignature &&
            now - lastBubble.at <= RECOVERY_BUBBLE_DEDUP_MS;

          if (!shouldSuppressBubble) {
            await addSystemBubble('info', 'Recovered recent chat messages', {
              Recovered: String(recoveredCount),
            });
            lastRecoveryBubbleRef.current = { signature: bubbleSignature, at: now };
          }
        }

        return recoveredCount;
      } catch (error) {
        console.warn('[Chat] Failed to reconcile recent gateway history:', error);
        return 0;
      }
    })();

    recoveryInFlightRef.current = run;
    try {
      return await run;
    } finally {
      recoveryInFlightRef.current = null;
    }
  }, [addChatMessage, addSystemBubble, isChatBusy]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (wsConnectionState !== 'connected') return;
    void reconcileRecentHistory();
  }, [reconcileRecentHistory, wsConnectionState]);

  useEffect(() => {
    const previous = lastGatewayActiveTurnsRef.current;
    if (previous > 0 && gatewayActiveTurns === 0 && wsConnectionState === 'connected') {
      void reconcileRecentHistory();
    }
    lastGatewayActiveTurnsRef.current = gatewayActiveTurns;
  }, [gatewayActiveTurns, reconcileRecentHistory, wsConnectionState]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (wsConnectionState !== 'connected') return;
    if (gatewayActiveTurns <= 0 && activeBackgroundSessions.size === 0) return;

    const interval = window.setInterval(() => {
      void reconcileRecentHistory();
    }, 5000);

    return () => {
      window.clearInterval(interval);
    };
  }, [activeBackgroundSessions.size, gatewayActiveTurns, reconcileRecentHistory, wsConnectionState]);

  useEffect(() => {
    let disposed = false;
    let dispose: () => void = () => undefined;
    let fallbackPoll: number | undefined;

    const startWatching = async () => {
      if (!isTauriRuntime() || !dashboardSettings) return;

      try {
        const unwatch = await watchProjects(dashboardSettings.scanPaths, async () => {
          await loadProjects();
          void refreshRoadmapDocsRef.current();
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

      // Cmd+B / Ctrl+B toggles sidebar
      if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
        event.preventDefault();
        const current = useDashboardStore.getState().sidebarOpen;
        useDashboardStore.getState().setSidebarOpen(!current);
        return;
      }

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

        if (syncDialogOpen) {
          event.preventDefault();
          setSyncDialogOpen(false);
          return;
        }

        if (useDashboardStore.getState().sidebarOpen) {
          event.preventDefault();
          useDashboardStore.getState().setSidebarOpen(false);
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
    syncDialogOpen,
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
      // Auto-commit roadmap status/priority edits for local-only repos.
      // Use the active roadmap project context instead of selectedProjectId,
      // which is intentionally cleared in roadmap view.
      const roadmapProject = activeRoadmapProject;
      if (roadmapProject?.hasGit && !roadmapProject.gitStatus?.remote) {
        await autoCommitIfLocalOnly(roadmapProject.dirPath, roadmapProject.gitStatus, ['ROADMAP.md'], { justWritten: true });
      } else if (roadmapProject?.hasGit) {
        // Optimistically mark project dirty so Git Sync badge updates instantly
        setProjects(
          allProjects.map((p) =>
            p.id === roadmapProject.id
              ? {
                  ...p,
                  gitStatus: {
                    ...p.gitStatus!,
                    hasDirtyFiles: true,
                    allDirtyFiles: {
                      metadata: p.gitStatus?.allDirtyFiles?.metadata ?? [],
                      documents: [
                        ...(p.gitStatus?.allDirtyFiles?.documents ?? []),
                        ...( (p.gitStatus?.allDirtyFiles?.documents ?? []).some((f) => f.path === 'ROADMAP.md')
                          ? []
                          : [{ path: 'ROADMAP.md', status: 'modified' as const }]),
                      ],
                      code: p.gitStatus?.allDirtyFiles?.code ?? [],
                    },
                  },
                }
              : p,
          ),
        );
      }
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
      const changedProjectIds = new Set<string>();

      const statusUpdates: Promise<void>[] = [];
      for (const item of nextItems) {
        const before = previousById.get(item.id);
        if (before && (before.status !== item.status || before.priority !== item.priority)) {
          changedProjectIds.add(item.id);
        }
        if (before && before.status !== item.status) {
          const updates: ProjectUpdate = { status: item.status as ProjectStatus };
          // Auto-assign priority when moving to in-progress (required by schema)
          if (item.status === 'in-progress' && item.priority === undefined) {
            const inFlightCount = nextItems.filter(
              (entry) => entry.status === 'in-progress' && entry.id !== item.id,
            ).length;
            updates.priority = inFlightCount + 1;
          }
          // Clear priority when leaving in-progress
          if (before.status === 'in-progress' && item.status !== 'in-progress') {
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

      // Auto-commit project status/priority (Kanban) movements for local-only repos.
      // These are intent-obvious structural metadata updates and should not
      // generate persistent Sync noise.
      const localOnlyChanged = nextItems.filter(
        (item) =>
          changedProjectIds.has(item.id) &&
          item.hasGit &&
          !item.gitStatus?.remote,
      );
      await Promise.all(
        localOnlyChanged.map((item) =>
          autoCommitIfLocalOnly(item.dirPath, item.gitStatus, ['PROJECT.md'], { justWritten: true }),
        ),
      );

      // Optimistically mark changed remote-tracked projects dirty so Git Sync
      // badge updates instantly, before the full loadProjects() completes.
      const remoteChanged = nextItems.filter(
        (item) =>
          changedProjectIds.has(item.id) &&
          item.hasGit &&
          item.gitStatus?.remote,
      );
      if (remoteChanged.length > 0) {
        const dirtyIds = new Set(remoteChanged.map((p) => p.id));
        setProjects(
          nextItems.map((p) =>
            dirtyIds.has(p.id)
              ? {
                  ...p,
                  gitStatus: {
                    ...p.gitStatus!,
                    hasDirtyFiles: true,
                    allDirtyFiles: {
                      metadata: [
                        ...(p.gitStatus?.allDirtyFiles?.metadata ?? []),
                        ...( (p.gitStatus?.allDirtyFiles?.metadata ?? []).some((f) => f.path === 'PROJECT.md')
                          ? []
                          : [{ path: 'PROJECT.md', status: 'modified' as const }]),
                      ],
                      documents: p.gitStatus?.allDirtyFiles?.documents ?? [],
                      code: p.gitStatus?.allDirtyFiles?.code ?? [],
                    },
                  },
                }
              : p,
          ),
        );
      }

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
    blockedQueueMessageIdRef.current = null;
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
    if (blockedQueueMessageIdRef.current === id) {
      blockedQueueMessageIdRef.current = null;
    }
    setChatQueue((current) => current.filter((item) => item.id !== id));
  };

  // Process the next queued message (called after a send completes)
  const processNextQueuedMessage = async () => {
    if (queueDrainInFlightRef.current) return;
    if (isChatBusy) return;

    const next = chatQueueRef.current[0];
    if (!next) return;
    if (blockedQueueMessageIdRef.current === next.id) return;

    queueDrainInFlightRef.current = true;
    setChatQueue((current) => current.slice(1));

    // Let UI settle after dequeue before issuing next send.
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ok = await sendChatMessage({ text: next.text, images: next.attachments });

      if (!ok) {
        // Reinsert at the front and block auto-drain for this item so we
        // don't enter a tight retry loop on persistent transport failures.
        blockedQueueMessageIdRef.current = next.id;
        setChatQueue((current) => [next, ...current]);
      } else {
        blockedQueueMessageIdRef.current = null;
      }
    } finally {
      queueDrainInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (chatQueue.length === 0) return;
    if (isChatBusy) return;
    void processNextQueuedMessage();
  }, [chatQueue.length, isChatBusy]);

  useEffect(() => {
    if (activeBackgroundSessions.size === 0) return;

    const interval = setInterval(() => {
      const sessionKeys = [...activeBackgroundSessions];
      if (sessionKeys.length === 0) return;

      void pollProcessSessions(sessionKeys).then(({ completed, failures }) => {
      if (completed.length > 0) {
          for (const terminal of completed) {
            backgroundSessionLastSeenRef.current.delete(terminal.sessionKey);
          }
          setActiveBackgroundSessions((prev) => {
            const next = new Set(prev);
            for (const terminal of completed) {
              next.delete(terminal.sessionKey);
            }
            return next;
          });
        }

        if (failures.length === 0) return;

        // Sessions with non-zero exitCode are already removed via `completed`.

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

      if (gatewayActiveTurns <= 0 && !chatSending) {
        const cutoff = Date.now() - BACKGROUND_SESSION_STALE_MS;
        const staleKeys = sessionKeys.filter((sessionKey) => {
          const lastSeen = backgroundSessionLastSeenRef.current.get(sessionKey) ?? 0;
          return lastSeen < cutoff;
        });

        if (staleKeys.length > 0) {
          for (const sessionKey of staleKeys) {
            backgroundSessionLastSeenRef.current.delete(sessionKey);
          }
          setActiveBackgroundSessions((prev) => {
            const next = new Set(prev);
            for (const sessionKey of staleKeys) {
              next.delete(sessionKey);
            }
            return next;
          });
        }
      }
    }, BACKGROUND_POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [activeBackgroundSessions, addSystemBubble, chatSending, gatewayActiveTurns]);

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

    setChatSending(true);
    setChatStreamingContent(null);
    setChatResponseToastMessage(null);

    try {
      await addChatMessage(userMessage);
      let latestCursorCandidate: ChatMessage | null = null;
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
      blockedQueueMessageIdRef.current = null;
      
      // Add ALL assistant messages (fixes dropped message bug)
      for (const msg of result.messages) {
        await addChatMessage(msg);
        if (
          CHAT_RELIABILITY_FLAGS.chat.recovery_cursoring &&
          msg._id &&
          typeof msg.timestamp === 'number'
        ) {
          if (
            !latestCursorCandidate ||
            typeof latestCursorCandidate.timestamp !== 'number' ||
            msg.timestamp > latestCursorCandidate.timestamp
          ) {
            latestCursorCandidate = msg;
          }
        }
        if (
          shouldParseAssistantContentForSessionDiscovery(
            CHAT_RELIABILITY_FLAGS.chat.activity_strict_sources,
          ) &&
          msg.role === 'assistant'
        ) {
          for (const sessionKey of extractBackgroundSessionKeys(msg.content)) {
            registerBackgroundSession(sessionKey);
          }
        }
      }

      if (
        CHAT_RELIABILITY_FLAGS.chat.recovery_cursoring &&
        latestCursorCandidate &&
        latestCursorCandidate._id &&
        typeof latestCursorCandidate.timestamp === 'number'
      ) {
        try {
          await chatRecoveryCursorAdvance(
            DEFAULT_SESSION_KEY,
            latestCursorCandidate.timestamp,
            latestCursorCandidate._id,
          );
        } catch (error) {
          console.warn('[Chat] Failed to advance recovery cursor after send:', error);
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
      const classifiedFailure = classifyUpstreamFailure(messageText);
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
        isConnectionError ? 'Gateway error' : classifiedFailure.title,
        { Error: messageText },
        isConnectionError ? ['Check logs for details'] : [classifiedFailure.action],
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
    <div className="flex h-screen flex-col overflow-hidden bg-page text-neutral-900 dark:text-neutral-100">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar onOpenSettings={() => setSettingsDialogOpen(true)} />
        <div className="relative flex min-w-0 flex-1 flex-col px-4 pb-4 pt-4 md:px-6">
        <Header
          errors={errors}
          onRefresh={async () => {
            await loadProjects();
            void refreshRoadmapDocsRef.current();
            // Also fetch remotes and reload to pick up updated ahead/behind
            const currentProjects = useDashboardStore.getState().projects;
            const flat = flattenProjects(currentProjects);
            void fetchAllRepos(flat).then(() => loadProjects());
          }}
          onAddProject={() => setAddDialogOpen(true)}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          dirtyProjectCount={dirtyProjects.length}
          unresolvedSyncCount={unresolvedSyncCount}
          onOpenSync={() => setSyncDialogOpen(true)}
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

        {!isRoadmapView && searchQuery.trim() && (
          <section className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-0 p-3 dark:border-neutral-700 dark:bg-neutral-950/70">
            <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
              <span>{searchResults.length} matching project(s)</span>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  setSearchQuery('');
                }}
              >
                Clear
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

        <main className="mb-4 min-h-0 flex-1">
          <section className="h-full min-h-0 min-w-0 rounded-2xl border border-neutral-200 bg-neutral-0 p-3 dark:border-neutral-700 dark:bg-neutral-950/70 md:p-4">
            <div className="h-full min-h-0 overflow-hidden">
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

      <ChatShell
        messages={chatMessages}
        gatewayConnected={gatewayConnected}
        connectionState={chatConnectionState}
        activityLabel={chatActivityLabel}
        streamingContent={chatStreamingContent}
        prefillRequest={chatPrefillRequest}
        drawerOpen={chatDrawerOpen}
        responseToastMessage={chatResponseToastMessage}
        isAgentWorking={isChatBusy}
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
        </div>
      </div>

      <ProjectModal
        open={Boolean(selectedProject)}
        project={selectedProject}
        onClose={() => setSelectedProjectId(undefined)}
        actions={projectModalActions}
      />

      <SearchModal
        isOpen={searchOpen}
        projects={allProjects}
        roadmapItems={allSearchableRoadmapItems}
        onClose={() => setSearchOpen(false)}
        onSelectProject={(project) => {
          if (project.hasRoadmap) {
            void openRoadmapView(project);
          } else {
            setSelectedProjectId(project.id);
          }
        }}
        onSelectRoadmapItem={(item) => {
          const project = allProjects.find((p) => p.id === item.projectId);
          if (project) {
            void openRoadmapView(project).then(() => {
              setSelectedRoadmapItemId(item.id);
            });
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

      <SyncDialog
        open={syncDialogOpen}
        onOpenChange={(open) => {
          setSyncDialogOpen(open);
          if (!open) scanUnresolvedSyncState();
        }}
        projects={allProjects}
        onRequestChatPrefill={(text) => {
          setSyncDialogOpen(false);
          setChatDrawerOpen(true);
          setChatPrefillRequest({
            id: `prefill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text,
          });
        }}
        onSyncComplete={() => { void loadProjects(); }}
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
