import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { watch } from '@tauri-apps/plugin-fs';
import { restoreStateCurrent, saveWindowState, StateFlags } from '@tauri-apps/plugin-window-state';
import { Archive, Check, CircleCheckBig, Clock4, EyeOff, GitBranch, Github, MessageSquare, Plus, RefreshCcw, RotateCcw, Search, Trash2 } from 'lucide-react';
import { ValidationBadge } from './components/ValidationBadge';
import { BranchPopover } from './components/BranchPopover';
import { Tooltip } from './components/Tooltip';
import { AddProjectDialog } from './components/AddProjectDialog';
import { AddRoadmapItemDialog } from './components/AddRoadmapItemDialog';
import { Board } from './components/Board';
import { Breadcrumb } from './components/Breadcrumb';
import { LifecycleActionBar } from './components/LifecycleActionBar';
import { ProjectModal } from './components/modal';
import type { ProjectModalActions } from './components/modal';
import { TitleBar } from './components/TitleBar';
import { Sidebar } from './components/sidebar/Sidebar';
import { ThinSidebar } from './components/sidebar/ThinSidebar';
import { SecondaryDrawer } from './components/hub/SecondaryDrawer';
import { QuickAccessPopover } from './components/hub/QuickAccessPopover';
import { openOrCreateProjectChat, openOrCreateItemChat, projectHasThread, itemHasChat } from './lib/hub-actions';
import { SettingsPage } from './components/SettingsPage';
import { SyncDialog } from './components/SyncDialog';
import { getSyncStatusForDisplay, performSyncOnClose, performSyncOnLaunch } from './lib/sync';
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
  consumePendingTurnMigrationNotice,
  fetchSessionModel,
  finalizeActiveTurnsForSession,
  getActiveTurnCount,
  getResolvedDefaultSessionKey,
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
  type SystemBubbleAction,
  wireSystemEventBus,
} from './lib/gateway';
import { commitPlanningDocs, fetchAllRepos, pushRepo } from './lib/git';
import { reorderProjects, updateProject, type ProjectUpdate } from './lib/projects';
import { enrichItemsWithDocs, resolveDocFiles } from './lib/doc-resolution';
import { autoCommitIfLocalOnly } from './lib/auto-commit';
import { RoadmapItemDialog } from './components/modal/RoadmapItemDialog';
import type {
  DirtyFileCategory,
  GitStatus,
  ProjectStatus,
  ProjectViewModel,
  RoadmapItemWithDocs,
  RoadmapStatus,
  ThemePreference,
} from './lib/schema';
import type { RoadmapItemState } from './lib/state-json';
import type { DashboardSettings } from './lib/settings';
import { useDashboardStore } from './lib/store';
import {
  batchReorderItems,
  chatRecoveryCursorAdvance,
  getOpenclawBearerToken,
  detectAgents,
  getAppUpdateLockState,
  getDashboardSettings,
  getValidationHistory,
  isTauriRuntime,
  tmuxListClawchestraSessions,
  tmuxKillSession,
  markRejectionResolved,
  resetOpenclawAuthCooldown,
  updateDashboardSettings,
  createRoadmapItem,
  deleteRoadmapItems,
  updateRoadmapItem,
  type ValidationRejection,
} from './lib/tauri';
import { mapToRoadmapItemsWithDocs } from './lib/roadmap-item-mapper';
import { defaultView, projectRoadmapView } from './lib/views';
import { setupTauriEventListeners } from './lib/tauri-events';
import { messageIdentitySignature } from './lib/chat-message-identity';
import { formatModelDisplayName, formatProviderDisplayName } from './lib/model-label';
import { CHAT_RELIABILITY_FLAGS } from './lib/chat-reliability-flags';
import {
  buildFailureBubbleDedupeKey,
  classifyUpstreamFailure,
  fetchRateLimitCooldownInfo,
  shouldParseAssistantContentForSessionDiscovery,
} from './lib/chat-reliability';
import { readExecutionState, isFailedSyncStep } from './lib/git-sync-utils';
import { parseTmuxSessionName } from './lib/terminal-utils';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
  action?: { label: string; onClick: () => void };
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

/** Optimistically mark a project's git status as dirty with an additional file entry. */
function withOptimisticDirtyFile(
  projects: ProjectViewModel[],
  projectIds: Set<string>,
  filePath: string,
  category: DirtyFileCategory,
): ProjectViewModel[] {
  return projects.map((p) => {
    if (!projectIds.has(p.id)) return p;
    const existing = p.gitStatus?.allDirtyFiles?.[category] ?? [];
    const alreadyPresent = existing.some((f) => f.path === filePath);
    return {
      ...p,
      gitStatus: {
        ...p.gitStatus!,
        hasDirtyFiles: true,
        allDirtyFiles: {
          metadata: p.gitStatus?.allDirtyFiles?.metadata ?? [],
          documents: p.gitStatus?.allDirtyFiles?.documents ?? [],
          code: p.gitStatus?.allDirtyFiles?.code ?? [],
          [category]: alreadyPresent ? existing : [...existing, { path: filePath, status: 'modified' as const }],
        },
      },
    };
  });
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
const EMPTY_COLUMN_IDS: string[] = [];

/** Inline icons for use in tooltips and text */
const InlineBranch = () => (
  <GitBranch className="inline-block h-3 w-3 align-[-2px]" />
);

function getGitHubStatusMeta(
  status?: GitStatus,
): { className: string; label: string; tooltip: ReactNode } {
  if (!status?.state || status.state === 'unknown') {
    const fallbackBranch = status?.branch ?? 'Git';
    return {
      className: 'text-neutral-600 dark:text-neutral-400',
      label: fallbackBranch,
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
      className: 'text-neutral-600 dark:text-neutral-400',
      label: branch,
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

  const label = `${branch}${sync}`;

  const classMap: Record<string, string> = {
    clean: 'text-[#DFFF00] dark:text-[#DFFF00]',
    uncommitted: 'text-amber-600 dark:text-amber-400',
    unpushed: 'text-sky-600 dark:text-sky-400',
    behind: 'text-rose-600 dark:text-rose-400',
  };

  return {
    className: classMap[status.state] ?? 'text-neutral-600 dark:text-neutral-400',
    label,
    tooltip: <><InlineBranch /> {branch}{sync}{textSuffix}</>,
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
  const currentSessionKey = getResolvedDefaultSessionKey();
  const matches = content.match(SESSION_KEY_PATTERN) ?? [];
  return [...new Set(matches)].filter((key) => key !== currentSessionKey);
}

function summarizeAttemptedChatPayload(payload: ChatSendPayload): string {
  const trimmedText = payload.text.trim();
  if (trimmedText.length > 0) {
    return trimmedText.length > 180 ? `${trimmedText.slice(0, 177)}...` : trimmedText;
  }
  if (payload.images.length > 0) {
    return `[image-only message: ${payload.images.length} attachment${payload.images.length === 1 ? '' : 's'}]`;
  }
  return '[empty message]';
}

interface SendChatOptions {
  idempotencyKey?: string;
  queueAttempt?: number;
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
  const sidebarOpen = useDashboardStore((state) => state.sidebarOpen);
  const sidebarSide = useDashboardStore((state) => state.sidebarSide);
  const thinSidebarSide = useDashboardStore((state) => state.thinSidebarSide);
  const sidebarMode = useDashboardStore((state) => state.sidebarMode);
  const hubChats = useDashboardStore((state) => state.hubChats);
  const hubActiveChatId = useDashboardStore((state) => state.hubActiveChatId);
  const hubDrawerOpen = useDashboardStore((state) => state.hubDrawerOpen);
  const hubDrawerWidth = useDashboardStore((state) => state.hubDrawerWidth);
  const activeSessionModel = useDashboardStore((state) => state.activeSessionModel);
  const activeSessionProvider = useDashboardStore((state) => state.activeSessionProvider);
  const storeRoadmapItems = useDashboardStore((state) => state.roadmapItems);

  const loadProjects = useDashboardStore((state) => state.loadProjects);
  const updateProjectFromEvent = useDashboardStore((state) => state.updateProjectFromEvent);
  const setProjects = useDashboardStore((state) => state.setProjects);
  const setRoadmapItemsForProject = useDashboardStore((state) => state.setRoadmapItemsForProject);
  const addError = useDashboardStore((state) => state.addError);
  const setGatewayConnected = useDashboardStore((state) => state.setGatewayConnected);
  const setAgentActivity = useDashboardStore((state) => state.setAgentActivity);
  const setViewContext = useDashboardStore((state) => state.setViewContext);
  const setActiveSessionModel = useDashboardStore((state) => state.setActiveSessionModel);
  const addChatMessage = useDashboardStore((state) => state.addChatMessage);
  const addSystemBubble = useDashboardStore((state) => state.addSystemBubble);
  const loadChatMessages = useDashboardStore((state) => state.loadChatMessages);
  const loadMoreChatMessages = useDashboardStore((state) => state.loadMoreChatMessages);
  const chatHasMore = useDashboardStore((state) => state.chatHasMore);
  const chatLoadingMore = useDashboardStore((state) => state.chatLoadingMore);
  const setSelectedProjectId = useDashboardStore((state) => state.setSelectedProjectId);
  const updateProjectAndReload = useDashboardStore((state) => state.updateProjectAndReload);
  const setThinSidebarSide = useDashboardStore((state) => state.setThinSidebarSide);
  const setSidebarMode = useDashboardStore((state) => state.setSidebarMode);
  const setHubDrawerOpen = useDashboardStore((state) => state.setHubDrawerOpen);
  const setHubDrawerWidth = useDashboardStore((state) => state.setHubDrawerWidth);
  const deleteProjectAndReload = useDashboardStore((state) => state.deleteProjectAndReload);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogInitialStatus, setAddDialogInitialStatus] = useState<string | undefined>(undefined);
  const [addRoadmapItemOpen, setAddRoadmapItemOpen] = useState(false);
  const [addRoadmapItemInitialStatus, setAddRoadmapItemInitialStatus] = useState<string | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [deleteAllArchivedConfirmOpen, setDeleteAllArchivedConfirmOpen] = useState(false);
  /** Maps item ID → status before archive, so Restore returns items to their original column. */
  const [preArchiveStatus, setPreArchiveStatus] = useState<Record<string, RoadmapStatus>>({});
  const [settingsPageOpen, setSettingsPageOpen] = useState(false);
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [settingsSaveNudge, setSettingsSaveNudge] = useState(false);
  const [syncDialogOpen, setSyncDialogOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [dashboardSettings, setDashboardSettings] = useState<DashboardSettings | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItemWithDocs[]>([]);
  const [selectedRoadmapItemId, setSelectedRoadmapItemId] = useState<string | null>(null);
  const [chatStreamingContent, setChatStreamingContent] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false); // Track if agent is working
  const [chatPendingBubbleVisible, setChatPendingBubbleVisible] = useState(false);
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
  const launchSyncStartedRef = useRef(false);
  const launchMigrationToastShownRef = useRef(false);
  const closeSyncInFlightRef = useRef(false);
  const hardClearTimerRef = useRef<number | null>(null);
  const lastGatewayActiveTurnsRef = useRef(gatewayActiveTurns);
  const chatSendingRef = useRef(chatSending);
  const sessionModelRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const hubButtonRef = useRef<HTMLDivElement>(null);

  const registerBackgroundSession = useCallback((sessionKey: string) => {
    if (!sessionKey || sessionKey === getResolvedDefaultSessionKey()) return;
    backgroundSessionLastSeenRef.current.set(sessionKey, Date.now());

    setActiveBackgroundSessions((prev) => {
      if (prev.has(sessionKey)) return prev;
      const next = new Set(prev);
      next.add(sessionKey);
      return next;
    });
  }, []);

  const allProjects = useMemo(() => flattenProjects(projects), [projects]);

  // Restore window size/position from saved state on launch.
  useEffect(() => {
    if (isTauriRuntime()) {
      // Restore immediately, then again after a short delay as a safety net
      // in case the initial restore races with window creation.
      const restore = () => restoreStateCurrent(StateFlags.ALL).catch((err) => {
        console.warn('[WindowState] restore failed:', err);
      });
      void restore();
      const timer = window.setTimeout(() => { void restore(); }, 300);
      return () => clearTimeout(timer);
    }
  }, []);

  // Gather roadmap items from all projects for search
  const [allSearchableRoadmapItems, setAllSearchableRoadmapItems] = useState<SearchableRoadmapItem[]>([]);

  useEffect(() => {
    let cancelled = false;
    const gatherRoadmapItems = async () => {
      const items: SearchableRoadmapItem[] = [];
      for (const project of allProjects) {
        const storeItems = storeRoadmapItems[project.id] || [];
        for (const si of storeItems) {
          items.push({
            id: si.id,
            title: si.title,
            status: si.status,
            priority: si.priority ?? undefined,
            icon: si.icon ?? undefined,
            nextAction: si.nextAction ?? undefined,
            blockedBy: si.blockedBy ?? undefined,
            tags: si.tags ?? undefined,
            projectId: project.id,
            projectTitle: project.title,
          });
        }
      }
      if (!cancelled) setAllSearchableRoadmapItems(items);
    };
    void gatherRoadmapItems();
    return () => { cancelled = true; };
  }, [allProjects, storeRoadmapItems]);

  // Filter out sub-projects from top-level view
  const topLevelProjects = useMemo(
    () => projects.filter((p) => !p.frontmatter.parent),
    [projects],
  );

  // Dirty project count for Sync button — debounced so agent mid-flight commits
  // don't flash the badge. A project must be dirty for DIRTY_DEBOUNCE_MS before
  // it counts toward the badge. A 15s tick ensures the threshold is caught promptly.
  const DIRTY_DEBOUNCE_MS = 60_000;
  const dirtyFirstSeenRef = useRef<Map<string, number>>(new Map());
  const [dirtyTick, setDirtyTick] = useState(0);

  useEffect(() => {
    const now = Date.now();
    for (const project of allProjects) {
      const isDirty = project.gitStatus?.hasDirtyFiles ?? false;
      if (isDirty && !dirtyFirstSeenRef.current.has(project.id)) {
        dirtyFirstSeenRef.current.set(project.id, now);
      } else if (!isDirty) {
        dirtyFirstSeenRef.current.delete(project.id);
      }
    }
  }, [allProjects]);

  useEffect(() => {
    const id = setInterval(() => setDirtyTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, []);

  const dirtyProjects = useMemo(() => {
    const now = Date.now();
    return allProjects.filter((p) => {
      if (!p.gitStatus?.hasDirtyFiles) return false;
      const firstSeen = dirtyFirstSeenRef.current.get(p.id);
      return firstSeen !== undefined && now - firstSeen >= DIRTY_DEBOUNCE_MS;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allProjects, dirtyTick]);

  // Unresolved sync state (conflict/failed persisted in localStorage)
  const [unresolvedSyncCount, setUnresolvedSyncCount] = useState(0);

  const syncBadgeCount = useMemo(
    () => (unresolvedSyncCount > 0 ? unresolvedSyncCount : dirtyProjects.length),
    [dirtyProjects.length, unresolvedSyncCount],
  );

  // Validation rejection history (Phase 7.3) — stored in zustand
  const validationRejections = useDashboardStore((s) => s.validationRejections);
  const setValidationRejections = useDashboardStore((s) => s.setValidationRejections);
  const dismissValidationRejection = useDashboardStore((s) => s.dismissValidationRejection);

  const scanUnresolvedSyncState = useCallback(() => {
    let count = 0;
    for (const p of allProjects) {
      if (!p.gitStatus) continue;
      const state = readExecutionState(p.id);
      if (state && isFailedSyncStep(state.currentStep)) count++;
    }
    setUnresolvedSyncCount(count);
  }, [allProjects]);

  useEffect(() => { scanUnresolvedSyncState(); }, [scanUnresolvedSyncState]);

  const selectedProject = useMemo(
    () => allProjects.find((project) => project.id === selectedProjectId),
    [allProjects, selectedProjectId],
  );

  const isRoadmapView = viewContext.type === 'roadmap';
  const boardModalOpen = sidebarOpen && (
    Boolean(selectedRoadmapItemId)
    || Boolean(selectedProject)
    || addDialogOpen
    || syncDialogOpen
  );

  const showThinSidebar = !sidebarOpen;
  const activeRoadmapProject = useMemo(() => {
    if (viewContext.type !== 'roadmap') return undefined;
    return allProjects.find((project) => project.id === viewContext.projectId);
  }, [allProjects, viewContext]);

  const roadmapBoardId = useMemo(
    () => (activeRoadmapProject ? `roadmap:${activeRoadmapProject.id}` : null),
    [activeRoadmapProject?.id],
  );
  const collapsedRoadmapColumns = useDashboardStore((state) =>
    roadmapBoardId ? state.collapsedColumns?.[roadmapBoardId] ?? EMPTY_COLUMN_IDS : EMPTY_COLUMN_IDS,
  );
  const minimizedRoadmapColumns = useDashboardStore((state) =>
    roadmapBoardId ? state.minimizedColumns?.[roadmapBoardId] ?? EMPTY_COLUMN_IDS : EMPTY_COLUMN_IDS,
  );
  const hiddenRoadmapStatuses = useMemo(
    () => new Set([...collapsedRoadmapColumns, ...minimizedRoadmapColumns]),
    [collapsedRoadmapColumns, minimizedRoadmapColumns],
  );

  // Re-resolve roadmap item docs (spec/plan existence) without leaving the view.
  // Stored in a ref so the file watcher can call it without adding deps.
  const refreshRoadmapDocsRef = useRef<() => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    refreshRoadmapDocsRef.current = async () => {
      if (!activeRoadmapProject || roadmapItems.length === 0) return;
      try {
        const docsMap = await resolveDocFiles(
          activeRoadmapProject.dirPath,
          roadmapItems,
          activeRoadmapProject.frontmatter,
        );
        setRoadmapItems((prev) => {
          const enriched = enrichItemsWithDocs(roadmapItems, docsMap);
          // Preserve current ordering/status from prev (user may have dragged items)
          const docsById = new Map(enriched.map((item) => [item.id, item.docs]));
          return prev.map((item) => ({ ...item, docs: docsById.get(item.id) ?? item.docs }));
        });
      } catch {
        // silently fail — items keep existing docs
      }
    };
  }, [activeRoadmapProject, roadmapItems]);

  const loadProjectsTimeoutRef = useRef<number | null>(null);
  const docsRefreshTimeoutRef = useRef<number | null>(null);
  const roadmapRefreshTimeoutRef = useRef<number | null>(null);

  const maybeLoadProjects = useCallback(async () => {
    if (!isTauriRuntime()) {
      await loadProjects();
      return;
    }

    try {
      const lockState = await getAppUpdateLockState();
      if (lockState.lockPresent && !lockState.stale) {
        return;
      }
    } catch {
      // If lock state check fails, proceed with loading.
    }

    await loadProjects();
  }, [loadProjects]);

  const scheduleLoadProjects = useCallback(
    (delay = 250) => {
      if (loadProjectsTimeoutRef.current) {
        window.clearTimeout(loadProjectsTimeoutRef.current);
      }
      loadProjectsTimeoutRef.current = window.setTimeout(() => {
        loadProjectsTimeoutRef.current = null;
        void maybeLoadProjects();
      }, delay);
    },
    [maybeLoadProjects],
  );

  const scheduleDocsRefresh = useCallback(
    (delay = 200) => {
      if (docsRefreshTimeoutRef.current) {
        window.clearTimeout(docsRefreshTimeoutRef.current);
      }
      docsRefreshTimeoutRef.current = window.setTimeout(() => {
        docsRefreshTimeoutRef.current = null;
        void refreshRoadmapDocsRef.current();
      }, delay);
    },
    [],
  );

  const refreshRoadmapFromFile = useCallback(
    async (mode: 'visible' | 'all' = 'visible') => {
      if (!activeRoadmapProject || !isTauriRuntime()) return;
      const roadmapPath = `${activeRoadmapProject.dirPath}/ROADMAP.md`;
      const stateJsonPath = `${activeRoadmapProject.dirPath}/.clawchestra/state.json`;

      try {
        let items: RoadmapItemState[] = [];

        if (activeRoadmapProject.stateJsonMigrated) {
          const { readFile } = await import('./lib/tauri');
          const { parseStateJson } = await import('./lib/state-json');
          const raw = await readFile(stateJsonPath);
          const parsed = parseStateJson(JSON.parse(raw));
          if (!parsed.ok) {
            throw parsed.error;
          }
          items = parsed.data.roadmapItems.map((item, index) => ({
            ...item,
            priority: item.priority ?? index + 1,
          }));
        } else {
          const { readRoadmap } = await import('./lib/roadmap');
          const document = await readRoadmap(roadmapPath);
          items = document.items.map((item, index) => ({
            id: item.id,
            title: item.title,
            status: item.status,
            priority: item.priority ?? index + 1,
            nextAction: item.nextAction ?? undefined,
            blockedBy: item.blockedBy ?? undefined,
            tags: item.tags ?? undefined,
            icon: item.icon ?? undefined,
            specDoc: item.specDoc ?? undefined,
            planDoc: item.planDoc ?? undefined,
          }));
        }

        setRoadmapItemsForProject(activeRoadmapProject.id, items);

        const mapped = mapToRoadmapItemsWithDocs(items);
        setRoadmapItems((prev) => {
          if (prev.length === 0) return mapped;

          const prevById = new Map(prev.map((entry) => [entry.id, entry]));
          const docsById = new Map(prev.map((entry) => [entry.id, entry.docs]));

          return mapped.map((entry) => {
            const next = { ...entry, docs: docsById.get(entry.id) ?? entry.docs };
            if (mode === 'visible' && hiddenRoadmapStatuses.has(entry.status)) {
              return prevById.get(entry.id) ?? next;
            }
            return next;
          });
        });

        scheduleDocsRefresh();
      } catch (error) {
        console.warn('[Roadmap] Failed to refresh from file:', error);
      }
    },
    [activeRoadmapProject, hiddenRoadmapStatuses, scheduleDocsRefresh, setRoadmapItemsForProject],
  );

  const scheduleRoadmapRefresh = useCallback(
    (mode: 'visible' | 'all' = 'visible', delay = 200) => {
      if (roadmapRefreshTimeoutRef.current) {
        window.clearTimeout(roadmapRefreshTimeoutRef.current);
      }
      roadmapRefreshTimeoutRef.current = window.setTimeout(() => {
        roadmapRefreshTimeoutRef.current = null;
        void refreshRoadmapFromFile(mode);
      }, delay);
    },
    [refreshRoadmapFromFile],
  );

  useEffect(() => () => {
    if (loadProjectsTimeoutRef.current) window.clearTimeout(loadProjectsTimeoutRef.current);
    if (docsRefreshTimeoutRef.current) window.clearTimeout(docsRefreshTimeoutRef.current);
    if (roadmapRefreshTimeoutRef.current) window.clearTimeout(roadmapRefreshTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!activeRoadmapProject || !isRoadmapView) return;
    scheduleRoadmapRefresh('all', 0);
  }, [activeRoadmapProject?.id, isRoadmapView, scheduleRoadmapRefresh]);

  useEffect(() => {
    if (!activeRoadmapProject || !isRoadmapView) return;
    scheduleRoadmapRefresh('all', 150);
  }, [collapsedRoadmapColumns, minimizedRoadmapColumns, activeRoadmapProject?.id, isRoadmapView, scheduleRoadmapRefresh]);

  useEffect(() => {
    if (!activeRoadmapProject || !isRoadmapView || !isTauriRuntime()) return;
    const watchPath = activeRoadmapProject.stateJsonMigrated
      ? `${activeRoadmapProject.dirPath}/.clawchestra/state.json`
      : `${activeRoadmapProject.dirPath}/ROADMAP.md`;
    const roadmapDir = `${activeRoadmapProject.dirPath}/roadmap`;
    let unwatchRoadmap: (() => void) | null = null;
    let unwatchDetails: (() => void) | null = null;
    (async () => {
      try {
        unwatchRoadmap = await watch(watchPath, () => scheduleRoadmapRefresh('visible'), { delayMs: 200 });
      } catch (error) {
        console.warn('[Roadmap] Failed to watch roadmap file:', error);
      }
      try {
        unwatchDetails = await watch(roadmapDir, () => scheduleRoadmapRefresh('all'), { delayMs: 200 });
      } catch (error) {
        console.warn('[Roadmap] Failed to watch roadmap detail files:', error);
      }
    })();
    return () => {
      if (unwatchRoadmap) unwatchRoadmap();
      if (unwatchDetails) unwatchDetails();
    };
  }, [activeRoadmapProject?.id, activeRoadmapProject?.stateJsonMigrated, isRoadmapView, scheduleRoadmapRefresh]);

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
    if (agentActivity === 'compacting') return 'Compacting...';
    if (agentActivity === 'typing') return 'Typing...';
    if (agentActivity === 'working') return 'Working...';
    return null;
  }, [agentActivity]);

  const activeModelLabel = useMemo(() => {
    const modelLabel = formatModelDisplayName(activeSessionModel);
    const providerLabel = formatProviderDisplayName(activeSessionProvider);
    if (providerLabel && modelLabel) return `${providerLabel} · ${modelLabel}`;
    return modelLabel ?? providerLabel;
  }, [activeSessionModel, activeSessionProvider]);

  const activeModelTooltip = useMemo(() => {
    if (!activeSessionModel && !activeSessionProvider) return null;
    const model = activeSessionModel ?? 'unknown model';
    if (!activeSessionProvider) return model;
    return `${activeSessionProvider} · ${model}`;
  }, [activeSessionModel, activeSessionProvider]);

  const [activeModelUsage, setActiveModelUsage] = useState<{
    used: number;
    max: number;
    percent: number;
  } | null>(null);

  const pushToast = useCallback((kind: Toast['kind'], message: string, action?: Toast['action']) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((current) => [...current, { id, kind, message, action }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  const refreshActiveSessionModel = useCallback(async () => {
    if (!isTauriRuntime()) return;
    if (wsConnectionState !== 'connected') return;
    if (sessionModelRefreshInFlightRef.current) {
      return sessionModelRefreshInFlightRef.current;
    }

    const refreshTask = (async () => {
      const snapshot = await fetchSessionModel({
        allowDefaultsFallback: false,
      });
      if (!snapshot) {
        setActiveSessionModel(null, null);
        return;
      }
      if (!snapshot.model && !snapshot.provider) {
        setActiveSessionModel(null, null);
        return;
      }
      setActiveSessionModel(snapshot.model, snapshot.provider);
    })().finally(() => {
      sessionModelRefreshInFlightRef.current = null;
    });

    sessionModelRefreshInFlightRef.current = refreshTask;
    return refreshTask;
  }, [setActiveSessionModel, wsConnectionState]);

  useEffect(() => {
    chatDrawerOpenRef.current = chatDrawerOpen;
  }, [chatDrawerOpen]);

  // Open chat drawer when a chatDraft is set from StatusBadge (or elsewhere)
  const chatDraft = useDashboardStore((s) => s.chatDraft);
  useEffect(() => {
    if (chatDraft) {
      setChatDrawerOpen(true);
    }
  }, [chatDraft]);

  useEffect(() => {
    chatQueueRef.current = chatQueue;
  }, [chatQueue]);

  useEffect(() => { chatSendingRef.current = chatSending; }, [chatSending]);

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

  // Load validation rejection history on startup (Phase 7.3)
  useEffect(() => {
    void getValidationHistory().then(setValidationRejections).catch(() => {});
  }, []);

  // Detect coding agents + discover tmux sessions on startup
  useEffect(() => {
    if (!isTauriRuntime()) return;
    void (async () => {
      try {
        // Detect available agents (claude, codex, opencode, tmux)
        const agents = await detectAgents();
        useDashboardStore.getState().setDetectedAgents(agents);

        // Discover running tmux sessions
        const sessions = await tmuxListClawchestraSessions();
        const hubChats = useDashboardStore.getState().hubChats;
        const hubChatIds = new Set(hubChats.map((c) => c.id));
        const activeChatIds = new Set<string>();

        for (const sessionName of sessions) {
          const parsed = parseTmuxSessionName(sessionName);
          if (parsed && hubChatIds.has(parsed.chatId)) {
            activeChatIds.add(parsed.chatId);
          } else {
            // Orphaned tmux session — kill it
            try { await tmuxKillSession(sessionName); } catch { /* ignore */ }
          }
        }

        useDashboardStore.getState().setActiveTerminalChatIds(activeChatIds);
      } catch {
        // Agent detection is best-effort
      }
    })();
  }, []);

  // Load persisted chat messages on startup
  useEffect(() => {
    void loadChatMessages();
  }, [loadChatMessages]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    const sessionKey = getResolvedDefaultSessionKey();
    void hydratePendingTurns(sessionKey).then((turns) => {
      const migrationNotice = consumePendingTurnMigrationNotice();
      if (migrationNotice) {
        void addSystemBubble('info', 'Recovered pending chat state', {
          Note: migrationNotice,
        });
      }
      const hasActiveTurns = turns.some(
        (t) => t.status === 'queued' || t.status === 'running' || t.status === 'awaiting_output',
      );
      if (hasActiveTurns) {
        setAgentActivity('working');
      }
    });
  }, [addSystemBubble, setAgentActivity]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (wsConnectionState !== 'connected') return;
    if (chatSending) return;
    if (gatewayActiveTurns <= 0) return;

    let cancelled = false;

    const probeDefaultSession = async () => {
      try {
        const sessionKey = getResolvedDefaultSessionKey();
        const { completed } = await pollProcessSessions([sessionKey]);
        if (cancelled) return;
        const defaultSessionTerminal = completed.some(
          (entry) => entry.sessionKey === sessionKey,
        );
        if (defaultSessionTerminal) {
          finalizeActiveTurnsForSession(sessionKey, 'session_process_terminal');
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

  // Sync-on-launch for configured mode (Local/Remote) once per app session.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!dashboardSettings) return;
    if (launchSyncStartedRef.current) return;

    let cancelled = false;
    launchSyncStartedRef.current = true;

    const runLaunchSync = async () => {
      let bearerToken: string | null = null;
      if (dashboardSettings.openclawSyncMode === 'Remote') {
        try {
          bearerToken = await getOpenclawBearerToken();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to read bearer token';
          if (!cancelled) {
            setLastSyncError(message);
            pushToast('error', message);
          }
          return;
        }
      }

      const result = await performSyncOnLaunch(
        dashboardSettings.openclawSyncMode,
        dashboardSettings.openclawRemoteUrl,
        bearerToken,
      );
      if (cancelled) return;

      if (result.success) {
        setLastSyncError(null);
        if (
          dashboardSettings.openclawSyncMode !== 'Disabled' &&
          dashboardSettings.openclawSyncMode !== 'Unknown'
        ) {
          setLastSyncedAt(Date.now());
        }
      } else {
        setLastSyncError(result.message);
      }

      for (const warning of result.warnings) {
        pushToast('error', warning);
      }
    };

    void runLaunchSync();
    return () => {
      cancelled = true;
    };
  }, [dashboardSettings]);

  // Best-effort sync-on-close for remote/local modes (frontend-managed path).
  const runCloseSync = useCallback(async () => {
    if (!isTauriRuntime()) return;
    if (!dashboardSettings) return;
    if (closeSyncInFlightRef.current) return;

    closeSyncInFlightRef.current = true;
    try {
      let bearerToken: string | null = null;
      if (dashboardSettings.openclawSyncMode === 'Remote') {
        try {
          bearerToken = await getOpenclawBearerToken();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to read bearer token';
          setLastSyncError(message);
          return;
        }
      }

      const result = await performSyncOnClose(
        dashboardSettings.openclawSyncMode,
        dashboardSettings.openclawRemoteUrl,
        bearerToken,
      );

      if (result.success) {
        if (
          dashboardSettings.openclawSyncMode !== 'Disabled' &&
          dashboardSettings.openclawSyncMode !== 'Unknown'
        ) {
          setLastSyncedAt(Date.now());
        }
        setLastSyncError(null);
      } else {
        setLastSyncError(result.message);
      }
    } finally {
      closeSyncInFlightRef.current = false;
    }
  }, [dashboardSettings]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (!dashboardSettings) return;

    const handlePageExit = () => {
      void runCloseSync();
    };

    window.addEventListener('beforeunload', handlePageExit);
    window.addEventListener('pagehide', handlePageExit);
    return () => {
      window.removeEventListener('beforeunload', handlePageExit);
      window.removeEventListener('pagehide', handlePageExit);
    };
  }, [dashboardSettings, runCloseSync]);

  // Initial connection attempt — wires Zustand bridge via getTauriOpenClawConnection
  useEffect(() => {
    void checkGatewayConnection();
  }, []);

  useEffect(() => {
    void wireSystemEventBus();

    const unsubscribeSystemEvents = subscribeSystemEvents(async (event) => {
      if (event.kind === 'compaction') {
        const semanticStatesEnabled = CHAT_RELIABILITY_FLAGS.chat.compaction_semantic_states;
        const isCompacting = semanticStatesEnabled && event.compactionState === 'compacting';
        setAgentActivity(isCompacting ? 'compacting' : 'working');
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

      if (event.kind === 'usage') {
        const currentSessionKey = getResolvedDefaultSessionKey();
        if (event.sessionKey && event.sessionKey !== currentSessionKey) {
          return;
        }
        if (event.usage) {
          setActiveModelUsage(event.usage);
        }
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

        // Enrich rate-limit errors with actual cooldown duration
        let bubbleTitle = classified.title;
        let bubbleActions: SystemBubbleAction[] = [classified.action];
        if (classified.type === 'rate_limit') {
          const cooldownInfo = await fetchRateLimitCooldownInfo();
          if (cooldownInfo) {
            bubbleTitle = `Rate limited \u2014 cooldown expires in ${cooldownInfo.remainingFormatted}`;
            bubbleActions = [
              {
                label: `Clear ${cooldownInfo.provider} rate limit`,
                actionId: 'clear_rate_limit',
                payload: { profileId: cooldownInfo.profileId },
              },
            ];
          }
        }

        void addSystemBubble(
          'failure',
          bubbleTitle,
          {
            Error: detailsMessage,
            ...(event.label ? { Task: event.label } : {}),
          },
          bubbleActions,
          event.runId,
          detailsMessage,
        );
        return;
      }

      if (event.kind === 'announce') {
        const currentSessionKey = getResolvedDefaultSessionKey();
        if (event.sessionKey && event.sessionKey !== currentSessionKey) {
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
        if (isTerminal && backgroundSessionKey && backgroundSessionKey !== currentSessionKey) {
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
  }, [addSystemBubble, registerBackgroundSession, setActiveModelUsage]);

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

    let cancelled = false;
    const pollMs = chatSending ? 4000 : 15000;

    const refresh = async () => {
      if (cancelled) return;
      await refreshActiveSessionModel();
    };

    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [chatSending, refreshActiveSessionModel, wsConnectionState]);

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
        const shouldSuppressDuringActiveRun = chatSendingRef.current;
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
              getResolvedDefaultSessionKey(),
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
  }, [addChatMessage, addSystemBubble]);

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

  // Unified Rust watcher event listeners (Phase 5: replaces old TS watcher)
  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;

    const setup = async () => {
      if (!isTauriRuntime()) return;

      const unsubscribe = await setupTauriEventListeners({
        onStateJsonMerged: (payload) => {
          updateProjectFromEvent(payload);
          scheduleDocsRefresh();
        },
        onClawchestraReady: () => {
          void loadProjects();
        },
        onMigrationLaunchSummary: (payload) => {
          if (launchMigrationToastShownRef.current) return;
          if (
            payload.migratedCount <= 0 &&
            payload.warningCount <= 0 &&
            payload.legacyRenamedCount <= 0
          ) {
            return;
          }
          launchMigrationToastShownRef.current = true;

          if (payload.warningCount > 0) {
            const noun = payload.warningCount === 1 ? 'warning' : 'warnings';
            pushToast(
              'error',
              `Startup migration completed with ${payload.warningCount} ${noun}`,
            );
            return;
          }

          const totalTouched = payload.migratedCount + payload.legacyRenamedCount;
          const projectNoun = totalTouched === 1 ? 'project' : 'projects';
          pushToast(
            'success',
            `Startup migration processed ${totalTouched} ${projectNoun}`,
          );
        },
        onProjectFileChanged: () => {
          scheduleLoadProjects();
          scheduleDocsRefresh();
        },
        onGitStatusChanged: () => {
          scheduleLoadProjects();
        },
      });

      if (disposed) {
        unsubscribe();
        return;
      }

      cleanup = unsubscribe;
    };

    void setup();

    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [loadProjects, pushToast, scheduleDocsRefresh, scheduleLoadProjects, updateProjectFromEvent]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (!allProjects.some((project) => project.id === selectedProjectId)) {
      setSelectedProjectId(undefined);
    }
  }, [allProjects, selectedProjectId, setSelectedProjectId]);

  const handleSettingsOpen = useCallback(() => {
    setSettingsSaveNudge(false);
    setSettingsPageOpen(true);
    useDashboardStore.getState().setSidebarOpen(true);
  }, []);

  const handleSettingsBack = useCallback(() => {
    if (settingsDirty) {
      setSettingsSaveNudge(true);
      return;
    }
    setSettingsPageOpen(false);
  }, [settingsDirty]);

  const handleSearchOpen = useCallback(() => {
    setSearchOpen(true);
  }, []);

  const handleAddProjectOpen = useCallback(() => {
    setAddDialogOpen(true);
  }, []);

  const handleRefreshProjects = useCallback(async () => {
    await loadProjects();
    void refreshRoadmapDocsRef.current();
    const currentProjects = useDashboardStore.getState().projects;
    const flat = flattenProjects(currentProjects);
    void fetchAllRepos(flat).then(() => loadProjects());
  }, [loadProjects]);

  const handleOpenSync = useCallback(() => {
    setSyncDialogOpen(true);
  }, []);

  const handleSwitchThinSidebarSide = useCallback(() => {
    setThinSidebarSide(thinSidebarSide === 'left' ? 'right' : 'left');
  }, [setThinSidebarSide, thinSidebarSide]);

  const handleToggleHub = useCallback(() => {
    const store = useDashboardStore.getState();
    if (store.sidebarOpen && !settingsPageOpen) {
      store.setSidebarOpen(false);
    } else {
      setSettingsPageOpen(false);
      setSidebarMode('default');
      store.setSidebarOpen(true);
    }
  }, [setSidebarMode, settingsPageOpen]);

  const handleQuickAccessSelectChat = useCallback((chatId: string) => {
    setSettingsPageOpen(false);
    setSidebarMode('default');
    useDashboardStore.getState().setSidebarOpen(true);
    useDashboardStore.getState().setHubActiveChatId(chatId);
    useDashboardStore.getState().setHubDrawerOpen(true);
  }, [setSidebarMode]);

  const handleOpenLinkedItem = useCallback((projectId: string, projectTitle: string, itemId: string) => {
    setViewContext(projectRoadmapView(projectId, projectTitle));
    setSelectedRoadmapItemId(itemId);
  }, [setViewContext]);

  const handleOpenLinkedProject = useCallback((projectId: string, projectTitle: string) => {
    setViewContext(projectRoadmapView(projectId, projectTitle));
  }, [setViewContext]);

  const hubUnreadCount = useMemo(
    () => hubChats.filter((c) => c.unread && !c.archived).length,
    [hubChats],
  );

  const resolvedSidebarMode = settingsPageOpen ? 'settings' as const : sidebarMode;

  const sidebarActions = useMemo(
    () => [
      {
        id: 'search',
        label: 'Search Projects',
        icon: Search,
        onClick: handleSearchOpen,
      },
      {
        id: 'add-project',
        label: 'Add Project',
        icon: Plus,
        onClick: handleAddProjectOpen,
        iconClassName: 'h-5 w-5',
      },
      {
        id: 'git-sync',
        label: 'Git Syncs',
        icon: Github,
        onClick: handleOpenSync,
        badgeCount: syncBadgeCount > 0 ? syncBadgeCount : undefined,
      },
      {
        id: 'refresh',
        label: 'Refresh',
        icon: RefreshCcw,
        onClick: handleRefreshProjects,
      },
    ],
    [
      handleAddProjectOpen,
      handleOpenSync,
      handleRefreshProjects,
      handleSearchOpen,
      syncBadgeCount,
    ],
  );

  const handleSettingsDirtyChange = useCallback((dirty: boolean) => {
    setSettingsDirty(dirty);
  }, []);

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

        if (settingsPageOpen) {
          event.preventDefault();
          handleSettingsBack();
          return;
        }

        if (syncDialogOpen) {
          event.preventDefault();
          setSyncDialogOpen(false);
          return;
        }

      }

    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    addDialogOpen,
    chatDrawerOpen,
    searchOpen,
    settingsPageOpen,
    syncDialogOpen,
    selectedProjectId,
    setSelectedProjectId,
    handleSettingsBack,
  ]);

  useEffect(() => {
    if (!settingsDirty) {
      setSettingsSaveNudge(false);
    }
  }, [settingsDirty]);

  const resetToProjectBoard = () => {
    setViewContext(defaultView());
    setRoadmapItems([]);
    setShowArchived(false);
    setPreArchiveStatus({});
  };

  const openRoadmapView = async (project: ProjectViewModel) => {
    const items = storeRoadmapItems[project.id] || [];
    if (items.length === 0) {
      pushToast('error', `No roadmap data found for ${project.title}`);
      return;
    }
    const enrichedItems = mapToRoadmapItemsWithDocs(items);
    try {
      const docsMap = await resolveDocFiles(project.dirPath, enrichedItems, project.frontmatter);
      const withDocs = enrichItemsWithDocs(enrichedItems, docsMap);
      setRoadmapItems(withDocs);
    } catch {
      setRoadmapItems(enrichedItems);
    }
    setViewContext(projectRoadmapView(project.id, project.title));
    setSelectedProjectId(undefined);
  };

  useEffect(() => {
    if (!activeRoadmapProject) return;
    const items = storeRoadmapItems[activeRoadmapProject.id];
    if (!items) return;

    const mapped = mapToRoadmapItemsWithDocs(items);
    setRoadmapItems((prev) => {
      if (prev.length === 0) return mapped;
      const docsById = new Map(prev.map((item) => [item.id, item.docs]));
      return mapped.map((item) => ({ ...item, docs: docsById.get(item.id) ?? item.docs }));
    });
  }, [activeRoadmapProject, storeRoadmapItems]);

  const persistRoadmapChanges = async (nextItems: RoadmapItemWithDocs[]) => {
    if (!activeRoadmapProject) return;

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

    const previousItems = roadmapItems;
    setRoadmapItems(orderedByColumn);

    try {
      await batchReorderItems(
        activeRoadmapProject.id,
        orderedByColumn.map((item) => ({
          itemId: item.id,
          newPriority: item.priority ?? 0,
          newStatus: item.status,
        })),
      );
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
          autoCommitIfLocalOnly(item.dirPath, item.gitStatus, ['CLAWCHESTRA.md'], { justWritten: true }),
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
        setProjects(withOptimisticDirtyFile(nextItems, dirtyIds, 'CLAWCHESTRA.md', 'metadata'));
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
    const queued: QueuedMessage = {
      id: createQueueId(),
      text: payload.text,
      attachments: payload.images,
      queuedAt: Date.now(),
      attemptCount: 0,
      status: 'queued',
    };
    setChatQueue((current) => [...current, queued]);
  };

  // Remove a message from the queue
  const removeFromChatQueue = (id: string) => {
    setChatQueue((current) => current.filter((item) => item.id !== id));
  };

  const retryQueuedMessage = (id: string) => {
    setChatQueue((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status: 'queued',
              attemptCount: 0,
              lastError: undefined,
              queuedAt: Date.now(),
            }
          : item,
      ),
    );
    if (!isChatBusy) {
      window.setTimeout(() => {
        void processNextQueuedMessage();
      }, 50);
    }
  };

  // Process the next queued message (called after a send completes)
  const processNextQueuedMessage = async () => {
    if (queueDrainInFlightRef.current) return;
    if (isChatBusy) return;

    const nextIndex = chatQueueRef.current.findIndex((item) => item.status === 'queued');
    if (nextIndex < 0) return;
    const next = chatQueueRef.current[nextIndex];

    queueDrainInFlightRef.current = true;
    setChatQueue((current) => current.filter((_, index) => index !== nextIndex));

    // Let UI settle after dequeue before issuing next send.
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      const ok = await sendChatMessage(
        { text: next.text, images: next.attachments },
        { idempotencyKey: next.id, queueAttempt: next.attemptCount },
      );

      if (!ok) {
        if (next.attemptCount < 1) {
          const retryItem: QueuedMessage = {
            ...next,
            attemptCount: next.attemptCount + 1,
            status: 'queued',
            lastError: undefined,
          };
          setChatQueue((current) => [retryItem, ...current]);
          window.setTimeout(() => {
            void processNextQueuedMessage();
          }, 250);
        } else {
          const failedItem: QueuedMessage = {
            ...next,
            status: 'failed',
            lastError: 'Send failed after retry',
          };
          setChatQueue((current) => [failedItem, ...current]);
        }
      }
    } finally {
      queueDrainInFlightRef.current = false;
    }
  };

  useEffect(() => {
    if (!chatQueue.some((item) => item.status === 'queued')) return;
    if (isChatBusy) return;
    void processNextQueuedMessage();
  }, [chatQueue, isChatBusy]);

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

  const sendChatMessage = async (
    payload: ChatSendPayload,
    options?: SendChatOptions,
  ) => {
    const text = payload.text.trim();
    if (!text && payload.images.length === 0) return false;
    const attemptedMessageSummary = summarizeAttemptedChatPayload(payload);
    const isQueuedFirstAttempt = Boolean(
      (options?.queueAttempt ?? 0) === 0 && options?.idempotencyKey,
    );
    let runtimeTruthApplied = false;

    const imageSummary =
      payload.images.length > 0
        ? `\n\n[Attached images: ${payload.images.map((image) => image.name).join(', ')}]`
        : '';

    const userMessage: ChatMessage = {
      role: 'user',
      content: `${text || 'Please analyze attached images.'}${imageSummary}`,
      timestamp: Date.now(),
    };
    const sendStartedAt = userMessage.timestamp ?? Date.now();

    const attachments: GatewayImageAttachment[] = payload.images.map((image) => ({
      name: image.name,
      mediaType: image.mediaType,
      dataUrl: image.dataUrl,
    }));

    // Read a fresh store snapshot here so send context doesn't rely on a stale
    // render-captured `chatMessages` array.
    const priorMessages = useDashboardStore.getState().chatMessages;

    setChatSending(true);
    setChatPendingBubbleVisible(true);
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
          idempotencyKey: options?.idempotencyKey,
          onStreamDelta: (content) => {
            if (content.trim().length > 0) {
              setChatPendingBubbleVisible(false);
            }
            setChatStreamingContent(content);
          },
        },
      );

      setChatStreamingContent(null);
      setGatewayConnected(true);

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
            getResolvedDefaultSessionKey(),
            latestCursorCandidate.timestamp,
            latestCursorCandidate._id,
          );
        } catch (error) {
          console.warn('[Chat] Failed to advance recovery cursor after send:', error);
        }
      }

      const expectedAssistantSignatures = result.messages
        .filter((msg) => msg.role === 'assistant')
        .map((msg) => messageIdentitySignature(msg));
      const hasRecentExpectedAssistant = (): boolean => {
        if (expectedAssistantSignatures.length === 0) return false;
        const signatureSet = new Set(expectedAssistantSignatures);
        return useDashboardStore
          .getState()
          .chatMessages
          .some((existing) => {
            if (existing.role !== 'assistant') return false;
            if ((existing.timestamp ?? 0) < sendStartedAt - 30_000) return false;
            return signatureSet.has(messageIdentitySignature(existing));
          });
      };

      let surfacedAssistant = hasRecentExpectedAssistant();
      if (!surfacedAssistant && expectedAssistantSignatures.length > 0) {
        console.warn(
          '[Chat] Send completed but assistant message is not visible yet; forcing history reconciliation',
          {
            expectedAssistantCount: expectedAssistantSignatures.length,
            sendStartedAt,
          },
        );
        await reconcileRecentHistory();
        surfacedAssistant = hasRecentExpectedAssistant();
      }

      if (!surfacedAssistant) {
        const fallbackContent = result.lastContent.trim();
        if (fallbackContent.length > 0) {
          console.warn(
            '[Chat] Send completed without visible assistant message after reconciliation; injecting fallback assistant message',
            { sendStartedAt, fallbackLength: fallbackContent.length },
          );
          await addChatMessage({
            role: 'assistant',
            content: fallbackContent,
            timestamp: Date.now(),
          });
        }
      }

      if (!chatDrawerOpenRef.current && result.lastContent) {
        setChatResponseToastMessage(result.lastContent);
      }
      if (result.runtimeModel || result.runtimeProvider) {
        runtimeTruthApplied = true;
        setActiveSessionModel(result.runtimeModel ?? null, result.runtimeProvider ?? null);
      }
      if (result.usage !== undefined) {
        setActiveModelUsage(result.usage);
      }
      setChatPendingBubbleVisible(false);
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
      void refreshActiveSessionModel();
      addError({ type: 'gateway_down', message: messageText });
      if (!isQueuedFirstAttempt) {
        // Enrich rate-limit errors with actual cooldown duration
        let bubbleTitle = isConnectionError ? 'Gateway error' : classifiedFailure.title;
        let bubbleActions: SystemBubbleAction[] = isConnectionError
          ? ['Check logs for details']
          : [classifiedFailure.action];

        if (!isConnectionError && classifiedFailure.type === 'rate_limit') {
          const cooldownInfo = await fetchRateLimitCooldownInfo();
          if (cooldownInfo) {
            bubbleTitle = `Rate limited \u2014 cooldown expires in ${cooldownInfo.remainingFormatted}`;
            bubbleActions = [
              {
                label: `Clear ${cooldownInfo.provider} rate limit`,
                actionId: 'clear_rate_limit',
                payload: { profileId: cooldownInfo.profileId },
              },
            ];
          }
        }

        void addSystemBubble(
          'failure',
          bubbleTitle,
          {
            Message: attemptedMessageSummary,
            Error: messageText,
          },
          bubbleActions,
        );
        pushToast(
          'error',
          `Failed to send: "${attemptedMessageSummary}" (${classifiedFailure.title})`,
        );
      }
      setChatPendingBubbleVisible(false);
      return false;
    } finally {
      setChatSending(false);
      setChatPendingBubbleVisible(false);
      setChatStreamingContent(null);
      if (runtimeTruthApplied) {
        window.setTimeout(() => {
          void refreshActiveSessionModel();
        }, 10_000);
      } else {
        void refreshActiveSessionModel();
      }
    }
  };

  const sendChatText = async (message: string) => {
    return sendChatMessage({ text: message, images: [] });
  };

  const handleSystemBubbleAction = useCallback(
    async (actionId: string, payload?: Record<string, unknown>) => {
      if (actionId === 'clear_rate_limit' && payload?.profileId) {
        try {
          await resetOpenclawAuthCooldown(payload.profileId as string);
          pushToast('success', `Cleared rate limit for ${payload.profileId}`);
        } catch (err) {
          pushToast(
            'error',
            `Failed to clear rate limit: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    },
    [pushToast],
  );

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

  const toastContent = toasts.map((toast) => (
    <div
      key={toast.id}
      className={`pointer-events-auto flex w-full max-w-md items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-sm shadow-md ${
        toast.kind === 'error'
          ? 'border-status-danger/60 bg-red-50 text-status-danger dark:border-red-500/40 dark:bg-[#1f1012] dark:text-red-300'
          : 'border-revival-accent-400/40 bg-revival-accent-100 text-neutral-900 dark:bg-[#202210] dark:text-neutral-100'
      }`}
    >
      <span>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            setToasts((current) => current.filter((t) => t.id !== toast.id));
          }}
          className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-revival-accent-600 transition-colors hover:bg-revival-accent-400/20 dark:text-revival-accent-300"
        >
          {toast.action.label}
        </button>
      ) : null}
    </div>
  ));

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-page text-neutral-900 dark:text-neutral-100">
      <TitleBar settingsMode={settingsPageOpen} />
      <div className="flex min-h-0 flex-1">
        {showThinSidebar && thinSidebarSide === 'left' ? (
          <ThinSidebar
            side="left"
            onSearch={handleSearchOpen}
            onAddProject={handleAddProjectOpen}
            onRefresh={handleRefreshProjects}
            onOpenSync={handleOpenSync}
            onSwitchSide={handleSwitchThinSidebarSide}
            onOpenSettings={handleSettingsOpen}
            onToggleHub={handleToggleHub}
            hubButtonRef={hubButtonRef}
            syncBadgeCount={syncBadgeCount}
            hubUnreadCount={hubUnreadCount}
          />
        ) : null}
        {sidebarSide === 'left' ? (
          <Sidebar
            side="left"
            mode={resolvedSidebarMode}
            onOpenSettings={handleSettingsOpen}
            onBack={handleSettingsBack}
            elevated={boardModalOpen}
            actions={sidebarActions}
            onToast={pushToast}
          />
        ) : null}
        {hubDrawerOpen && hubActiveChatId && sidebarSide === 'left' && (
          <SecondaryDrawer
            chatId={hubActiveChatId}
            width={hubDrawerWidth}
            onWidthChange={setHubDrawerWidth}
            onClose={() => setHubDrawerOpen(false)}
            onToast={pushToast}
            onOpenLinkedItem={handleOpenLinkedItem}
            onOpenLinkedProject={handleOpenLinkedProject}
          />
        )}
        <div className={`relative flex min-w-0 flex-1 flex-col ${settingsPageOpen ? '' : 'p-4 md:p-6'}`}>
        {settingsPageOpen ? (
          <main className="mb-4 min-h-0 flex-1">
            <div className={`h-full min-h-0 overflow-y-auto ${sidebarSide === 'right' ? '[direction:rtl]' : ''}`}>
              <div className={sidebarSide === 'right' ? '[direction:ltr]' : ''}>
              <SettingsPage
                active={settingsPageOpen}
                settings={dashboardSettings}
                saveNudge={settingsSaveNudge}
                onDirtyChange={handleSettingsDirtyChange}
                onNotify={(kind, message) => pushToast(kind, message)}
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
              </div>
            </div>
          </main>
        ) : (
          <>
        <div className="relative mb-4 -mt-[5px] flex items-center justify-between gap-3 px-3 md:px-4">
          <div className="flex items-center gap-1.5">
            <Breadcrumb
              viewContext={viewContext}
              onNavigate={(crumbId) => {
                if (crumbId === 'root') {
                  resetToProjectBoard();
                }
              }}
            />
            {isRoadmapView && activeRoadmapProject && (() => {
              const hasChat = projectHasThread(hubChats, activeRoadmapProject.id);
              return (
                <Tooltip text={hasChat ? 'Open project chat' : 'Create project chat'}>
                  <button
                    type="button"
                    className={`flex h-5 w-5 items-center justify-center rounded transition-colors ${
                      hasChat
                        ? 'text-[#DFFF00]'
                        : 'text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200'
                    }`}
                    onClick={() => {
                      void openOrCreateProjectChat(
                        activeRoadmapProject.id,
                        activeRoadmapProject.title,
                      );
                    }}
                    aria-label={hasChat ? 'Open project chat' : 'Create project chat'}
                  >
                    <MessageSquare className="h-3.5 w-3.5" fill={hasChat ? 'currentColor' : 'none'} />
                  </button>
                </Tooltip>
              );
            })()}
          </div>
          <div className="text-xs text-neutral-500">
            {loading
              ? 'Loading...'
              : isRoadmapView
                ? (
                  <span className="group/archive relative inline-flex items-center gap-2">
                    {/* Item count — hidden on hover when archive is off */}
                    <span className={showArchived ? 'hidden' : 'group-hover/archive:hidden'}>
                      {roadmapItems.filter((i) => i.status !== 'archived').length} roadmap item(s)
                    </span>
                    {/* Show archive toggle — visible on hover, or always when active */}
                    <span className={`items-center gap-2 ${showArchived ? 'inline-flex' : 'hidden group-hover/archive:inline-flex'}`}>
                      <span className="whitespace-nowrap">Show archive</span>
                      <button
                        type="button"
                        onClick={() => setShowArchived((v) => {
                          const next = !v;
                          if (next) {
                            requestAnimationFrame(() => {
                              setTimeout(() => {
                                const scroller = document.querySelector('.kanban-scroll');
                                if (scroller) {
                                  scroller.scrollTo({ left: scroller.scrollWidth, behavior: 'smooth' });
                                }
                              }, 50);
                            });
                          }
                          return next;
                        })}
                        className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                          showArchived
                            ? 'bg-revival-accent-500'
                            : 'bg-neutral-300 dark:bg-neutral-600'
                        }`}
                        aria-label={showArchived ? 'Hide archived items' : 'Show archived items'}
                      >
                        <span
                          className={`inline-block h-3 w-3 rounded-full bg-white shadow-sm transition-transform ${
                            showArchived ? 'translate-x-3.5' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </span>
                  </span>
                )
                : `${topLevelProjects.length} projects`}
          </div>
          {!settingsPageOpen && toasts.length > 0 && (
            <div className="pointer-events-none absolute inset-x-0 -top-[12px] z-[70] flex justify-center px-4">
              <div className="pointer-events-auto flex flex-col items-center gap-2">
                {toastContent}
              </div>
            </div>
          )}
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
          <div className="h-full min-h-0 min-w-0 overflow-hidden">
              {isRoadmapView ? (() => {
                const projectId = activeRoadmapProject!.id;
                const nonArchivedItems = roadmapItems.filter((i) => i.status !== 'archived');
                const archivedItems = roadmapItems.filter((i) => i.status === 'archived');

                const handleComplete = (item: RoadmapItemWithDocs) => {
                  const previousStatus = item.status;
                  const previousPriority = item.priority;
                  const completedAt = new Date().toISOString().split('T')[0];
                  setRoadmapItems((prev) =>
                    prev.map((i) => (i.id === item.id ? { ...i, status: 'complete', completedAt } : i)),
                  );
                  void updateRoadmapItem(projectId, item.id, { status: 'complete', completedAt }).catch(() => {
                    setRoadmapItems((prev) =>
                      prev.map((i) =>
                        i.id === item.id ? { ...i, status: previousStatus, priority: previousPriority, completedAt: undefined } : i,
                      ),
                    );
                    pushToast('error', 'Failed to complete item');
                  });
                  pushToast('success', `"${item.title}" completed`, {
                    label: 'Undo',
                    onClick: () => {
                      setRoadmapItems((prev) =>
                        prev.map((i) =>
                          i.id === item.id ? { ...i, status: previousStatus, priority: previousPriority, completedAt: undefined } : i,
                        ),
                      );
                      void updateRoadmapItem(projectId, item.id, { status: previousStatus, completedAt: '' });
                    },
                  });
                };

                const handleArchive = (item: RoadmapItemWithDocs) => {
                  const previousStatus = item.status;
                  const previousPriority = item.priority;
                  setPreArchiveStatus((prev) => ({ ...prev, [item.id]: previousStatus }));
                  setRoadmapItems((prev) =>
                    prev.map((i) => (i.id === item.id ? { ...i, status: 'archived' } : i)),
                  );
                  void updateRoadmapItem(projectId, item.id, { status: 'archived' }).catch(() => {
                    setPreArchiveStatus((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
                    setRoadmapItems((prev) =>
                      prev.map((i) =>
                        i.id === item.id ? { ...i, status: previousStatus, priority: previousPriority } : i,
                      ),
                    );
                    pushToast('error', 'Failed to archive item');
                  });
                  pushToast('success', `"${item.title}" archived`, {
                    label: 'Undo',
                    onClick: () => {
                      setPreArchiveStatus((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
                      setRoadmapItems((prev) =>
                        prev.map((i) =>
                          i.id === item.id ? { ...i, status: previousStatus, priority: previousPriority } : i,
                        ),
                      );
                      void updateRoadmapItem(projectId, item.id, { status: previousStatus });
                    },
                  });
                };

                const handleRestore = (item: RoadmapItemWithDocs) => {
                  const restoreTo = preArchiveStatus[item.id] ?? 'pending';
                  setPreArchiveStatus((prev) => { const next = { ...prev }; delete next[item.id]; return next; });
                  setRoadmapItems((prev) =>
                    prev.map((i) => (i.id === item.id ? { ...i, status: restoreTo } : i)),
                  );
                  void updateRoadmapItem(projectId, item.id, { status: restoreTo }).catch(() => {
                    setRoadmapItems((prev) =>
                      prev.map((i) => (i.id === item.id ? { ...i, status: 'archived' } : i)),
                    );
                    pushToast('error', 'Failed to restore item');
                  });
                  const columnLabel = viewContext.columns.find((c) => c.id === restoreTo)?.label ?? restoreTo;
                  pushToast('success', `"${item.title}" restored to ${columnLabel}`);
                };

                const handleDeleteItem = (item: RoadmapItemWithDocs) => {
                  const snapshot = { ...item };
                  const storeSnapshot = storeRoadmapItems[projectId] ?? [];
                  setRoadmapItems((prev) => prev.filter((i) => i.id !== item.id));
                  setRoadmapItemsForProject(projectId, storeSnapshot.filter((i) => i.id !== item.id));
                  void deleteRoadmapItems(projectId, [item.id]).catch(() => {
                    setRoadmapItems((prev) => [...prev, snapshot]);
                    setRoadmapItemsForProject(projectId, storeSnapshot);
                    pushToast('error', 'Failed to delete item');
                  });
                  pushToast('success', `"${item.title}" deleted`, {
                    label: 'Undo',
                    onClick: () => {
                      setRoadmapItems((prev) => [...prev, snapshot]);
                      setRoadmapItemsForProject(projectId, storeSnapshot);
                      void createRoadmapItem(projectId, {
                        id: snapshot.id,
                        title: snapshot.title,
                        status: snapshot.status,
                        priority: snapshot.priority,
                        nextAction: snapshot.nextAction,
                        tags: snapshot.tags,
                        icon: snapshot.icon,
                      });
                    },
                  });
                };

                const handleDeleteAllArchived = () => {
                  const snapshots = [...archivedItems];
                  const storeSnapshot = storeRoadmapItems[projectId] ?? [];
                  setRoadmapItems((prev) => prev.filter((i) => i.status !== 'archived'));
                  setRoadmapItemsForProject(projectId, storeSnapshot.filter((i) => i.status !== 'archived'));
                  setShowArchived(false);
                  setDeleteAllArchivedConfirmOpen(false);
                  void deleteRoadmapItems(projectId, snapshots.map((i) => i.id)).catch(() => {
                    setRoadmapItems((prev) => [...prev, ...snapshots]);
                    setRoadmapItemsForProject(projectId, storeSnapshot);
                    pushToast('error', 'Failed to delete archived items');
                  });
                  pushToast('success', `${snapshots.length} archived item(s) deleted`);
                };

                const stopDrag = (e: React.PointerEvent) => e.stopPropagation();
                const stopClick = (e: React.MouseEvent) => e.stopPropagation();
                const actionBtnClass = 'inline-flex h-6 w-6 items-center justify-center rounded transition-all text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-900 hover:shadow-sm dark:hover:bg-neutral-600/50 dark:hover:text-neutral-100';

                return (
                  <Board
                    columns={viewContext.columns}
                    items={nonArchivedItems}
                    boardId={`roadmap:${viewContext.type === 'roadmap' ? viewContext.projectId : 'unknown'}`}
                    onItemClick={(item) => setSelectedRoadmapItemId(item.id)}
                    renderItemHoverActions={(item) => (
                      <LifecycleActionBar
                        specExists={Boolean(item.docs?.spec)}
                        planExists={Boolean(item.docs?.plan)}
                        onAction={(action) => handleLifecycleAction(item, action)}
                      />
                    )}
                    renderItemRightHoverActions={(item) => {
                      const hasChat = activeRoadmapProject ? itemHasChat(hubChats, activeRoadmapProject.id, item.id) : false;
                      return (
                      <>
                        <Tooltip text={hasChat ? 'Open chat' : 'Create chat'}>
                          <button
                            type="button"
                            className={hasChat ? `inline-flex h-6 w-6 items-center justify-center rounded transition-all text-[#DFFF00]` : actionBtnClass}
                            onPointerDown={stopDrag}
                            onClick={(e) => {
                              stopClick(e);
                              if (activeRoadmapProject) {
                                void openOrCreateItemChat(
                                  activeRoadmapProject.id,
                                  activeRoadmapProject.title,
                                  item.id,
                                  item.title,
                                );
                              }
                            }}
                            aria-label={hasChat ? 'Open chat' : 'Create chat'}
                          >
                            <MessageSquare className="h-[15px] w-[15px]" fill={hasChat ? 'currentColor' : 'none'} />
                          </button>
                        </Tooltip>
                        {item.status !== 'complete' && (
                          <Tooltip text="Complete">
                            <button
                              type="button"
                              className={actionBtnClass}
                              onPointerDown={stopDrag}
                              onClick={(e) => { stopClick(e); handleComplete(item); }}
                              aria-label="Complete"
                            >
                              <CircleCheckBig className="h-[15px] w-[15px]" />
                            </button>
                          </Tooltip>
                        )}
                        <Tooltip text="Archive">
                          <button
                            type="button"
                            className={actionBtnClass}
                            onPointerDown={stopDrag}
                            onClick={(e) => { stopClick(e); handleArchive(item); }}
                            aria-label="Archive"
                          >
                            <Archive className="h-[15px] w-[15px]" />
                          </button>
                        </Tooltip>
                      </>
                      );
                    }}
                    onItemsChange={(nextItems) => {
                      void persistRoadmapChanges(nextItems);
                    }}
                    onQuickAdd={(columnId) => {
                      setAddRoadmapItemInitialStatus(columnId);
                      setAddRoadmapItemOpen(true);
                    }}
                    quickAddLabel="Add Roadmap Item"
                    trailingContent={showArchived ? (
                      <section className="flex h-full min-h-0 min-w-0 flex-col rounded-2xl border border-neutral-200 bg-neutral-100/60 p-3 dark:border-neutral-700 dark:bg-neutral-900/40">
                        {/* Header */}
                        <header className="mb-3 mr-[1px] flex items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
                          <Archive className="h-3.5 w-3.5 text-neutral-500 dark:text-neutral-400" />
                          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 dark:text-neutral-200">
                            Archived
                          </h2>
                          <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                            {archivedItems.length}
                          </span>
                          <div className="ml-auto flex items-center gap-1">
                            {archivedItems.length > 0 && (
                              <button
                                type="button"
                                onClick={() => setDeleteAllArchivedConfirmOpen(true)}
                                className="rounded p-1 text-neutral-400 transition-colors hover:bg-red-100 hover:text-red-600 dark:text-neutral-500 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                                title="Delete all archived items"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <Tooltip text="Hide archive">
                              <button
                                type="button"
                                onClick={() => setShowArchived(false)}
                                className="rounded p-1 text-neutral-500 transition-colors hover:bg-neutral-200 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                                aria-label="Hide archived column"
                              >
                                <EyeOff className="h-3.5 w-3.5" />
                              </button>
                            </Tooltip>
                          </div>
                        </header>
                        {/* Cards */}
                        <div className="scrollbar-hidden flex min-h-0 grow flex-col gap-2 overflow-y-auto pr-[1px]">
                          {archivedItems.length === 0 ? (
                            <div className="flex w-full items-center justify-center rounded-xl border border-dashed border-neutral-300 px-3 py-2.5 text-xs font-medium text-neutral-500 dark:border-neutral-600 dark:text-neutral-400">
                              No archived items
                            </div>
                          ) : (
                            archivedItems.map((item) => (
                              <article
                                key={item.id}
                                onClick={() => setSelectedRoadmapItemId(item.id)}
                                className="group relative cursor-pointer rounded-xl border border-neutral-200 bg-neutral-50 px-3 py-2 shadow-sm transition hover:border-revival-accent-400 hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="text-sm font-semibold leading-tight">
                                    {item.title}
                                    {item.icon ? <span className="ml-1 inline-block align-text-bottom">{item.icon}</span> : null}
                                  </h3>
                                  {/* Restore + Delete buttons on hover */}
                                  <div className="pointer-events-none invisible flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
                                    <Tooltip text="Restore">
                                      <button
                                        type="button"
                                        className={actionBtnClass}
                                        onClick={(e) => { stopClick(e); handleRestore(item); }}
                                        aria-label="Restore"
                                      >
                                        <RotateCcw className="h-[15px] w-[15px]" />
                                      </button>
                                    </Tooltip>
                                    <Tooltip text="Delete">
                                      <button
                                        type="button"
                                        className="inline-flex h-6 w-6 items-center justify-center rounded transition-all text-neutral-500 dark:text-neutral-400 hover:bg-red-100 hover:text-red-600 hover:shadow-sm dark:hover:bg-red-900/30 dark:hover:text-red-400"
                                        onClick={(e) => { stopClick(e); handleDeleteItem(item); }}
                                        aria-label="Delete permanently"
                                      >
                                        <Trash2 className="h-[15px] w-[15px]" />
                                      </button>
                                    </Tooltip>
                                  </div>
                                </div>
                              </article>
                            ))
                          )}
                        </div>
                      </section>
                    ) : undefined}
                  />
                );
              })() : (
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
                    const projectRejections = validationRejections[project.id] ?? [];
                    return (
                      <>
                        {projectRejections.length > 0 && (
                          <ValidationBadge
                            rejections={projectRejections}
                            onDismiss={(timestamp) => {
                              dismissValidationRejection(project.id, timestamp);
                              void markRejectionResolved(project.id, timestamp).catch(() => {});
                            }}
                          />
                        )}
                        {project.isStale ? <Clock4 className="h-4 w-4 text-status-danger" /> : null}
                        {project.hasRepo ? (
                          <BranchPopover
                            project={project}
                            badgeClassName={gitHubStatusMeta.className}
                            badgeTooltip={gitHubStatusMeta.tooltip}
                            badgeLabel={gitHubStatusMeta.label}
                            onCheckoutComplete={() => { void loadProjects(); }}
                          />
                        ) : null}
                      </>
                    );
                  }}
                  renderItemActions={() => null}
                  renderItemRightHoverActions={(project) => {
                    const hasChat = projectHasThread(hubChats, project.id);
                    return (
                    <Tooltip text={hasChat ? 'Open project chat' : 'Create project chat'}>
                      <button
                        type="button"
                        className={`inline-flex h-6 w-6 items-center justify-center rounded transition-all ${
                          hasChat
                            ? 'text-[#DFFF00]'
                            : 'text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/70 hover:text-neutral-900 hover:shadow-sm dark:hover:bg-neutral-600/50 dark:hover:text-neutral-100'
                        }`}
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          void openOrCreateProjectChat(
                            project.id,
                            project.frontmatter?.title ?? project.id,
                          );
                        }}
                        aria-label={hasChat ? 'Open project chat' : 'Create project chat'}
                      >
                        <MessageSquare className="h-[15px] w-[15px]" fill={hasChat ? 'currentColor' : 'none'} />
                      </button>
                    </Tooltip>
                    );
                  }}
                  onItemsChange={(nextItems) => {
                    void persistBoardChanges(nextItems);
                  }}
                  onQuickAdd={(columnId) => {
                    setAddDialogInitialStatus(columnId);
                    setAddDialogOpen(true);
                  }}
                  quickAddLabel="Add Project"
                />
              )}
          </div>
        </main>

        {isRoadmapView ? (
          <RoadmapItemDialog
            item={roadmapItems.find((i) => i.id === selectedRoadmapItemId) ?? null}
            projectTitle={activeRoadmapProject?.title ?? 'Project'}
            projectDir={activeRoadmapProject?.dirPath ?? ''}
            projectFrontmatter={activeRoadmapProject?.frontmatter}
            projectId={activeRoadmapProject?.id}
            isMigrated={activeRoadmapProject?.stateJsonMigrated}
            boardScoped
            onClose={() => setSelectedRoadmapItemId(null)}
            onStatusChange={(itemId, status) => {
              const updated = roadmapItems.map((i) =>
                i.id === itemId ? { ...i, status } : i,
              );
              void persistRoadmapChanges(updated);
            }}
            onOpenChat={(itemId, itemTitle) => {
              if (activeRoadmapProject) {
                void openOrCreateItemChat(
                  activeRoadmapProject.id,
                  activeRoadmapProject.title,
                  itemId,
                  itemTitle,
                );
              }
            }}
          />
        ) : null}
        </>
        )}

      {settingsPageOpen && toasts.length > 0 && (
        <div className="pointer-events-none absolute bottom-4 left-1/2 z-[70] flex w-full max-w-xl -translate-x-1/2 flex-col items-center gap-2 px-4">
          {toastContent}
        </div>
      )}

      <div className={settingsPageOpen ? 'hidden' : ''}>
        <ChatShell
          messages={chatMessages}
          gatewayConnected={gatewayConnected}
          connectionState={chatConnectionState}
          activityLabel={chatActivityLabel}
          activeModelLabel={activeModelLabel}
          activeModelTooltip={activeModelTooltip}
          activeModelUsage={activeModelUsage}
          streamingContent={chatStreamingContent}
          prefillRequest={chatPrefillRequest}
          drawerOpen={chatDrawerOpen}
          responseToastMessage={chatResponseToastMessage}
          isAgentWorking={isChatBusy}
          isCompacting={agentActivity === 'compacting'}
          showPendingBubble={chatPendingBubbleVisible}
          queue={chatQueue}
          hasMoreMessages={chatHasMore}
          loadingMoreMessages={chatLoadingMore}
          onDrawerOpenChange={setChatDrawerOpen}
          onDismissResponseToast={() => setChatResponseToastMessage(null)}
          onSend={sendChatMessage}
          onQueueMessage={queueChatMessage}
          onRemoveFromQueue={removeFromChatQueue}
          onRetryQueuedMessage={retryQueuedMessage}
          onLoadMore={loadMoreChatMessages}
          onRetryConnection={retryGatewayConnection}
          onSystemBubbleAction={handleSystemBubbleAction}
        />
      </div>

      {!settingsPageOpen && (
        <>
          <ProjectModal
            open={Boolean(selectedProject)}
            project={selectedProject}
            boardScoped={sidebarOpen}
            onClose={() => setSelectedProjectId(undefined)}
            actions={projectModalActions}
          />

          <AddProjectDialog
            open={addDialogOpen}
            settings={dashboardSettings}
            existingProjects={allProjects}
            boardScoped={sidebarOpen}
            initialStatus={addDialogInitialStatus as ProjectStatus | undefined}
            onClose={() => { setAddDialogOpen(false); setAddDialogInitialStatus(undefined); }}
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

          {activeRoadmapProject && (
            <AddRoadmapItemDialog
              open={addRoadmapItemOpen}
              projectId={activeRoadmapProject.id}
              projectTitle={activeRoadmapProject.title}
              existingItems={roadmapItems}
              gatewayConnected={gatewayConnected}
              initialStatus={addRoadmapItemInitialStatus as import('./lib/constants').RoadmapItemStatus | undefined}
              boardScoped
              onClose={() => { setAddRoadmapItemOpen(false); setAddRoadmapItemInitialStatus(undefined); }}
              onComplete={async () => {
                await refreshRoadmapFromFile('all');
              }}
            />
          )}

          {/* Delete All Archived confirmation modal */}
          {deleteAllArchivedConfirmOpen && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
              <div className="w-full max-w-sm rounded-2xl border border-red-300 bg-white p-6 shadow-xl dark:border-red-800 dark:bg-neutral-900">
                <h3 className="text-base font-semibold text-neutral-900 dark:text-neutral-100">
                  Delete all archived items?
                </h3>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  This will permanently delete{' '}
                  <span className="font-semibold">{roadmapItems.filter((i) => i.status === 'archived').length}</span>{' '}
                  archived item(s). This action cannot be undone.
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setDeleteAllArchivedConfirmOpen(false)}
                    className="rounded-lg border border-neutral-300 px-4 py-2 text-sm font-medium text-neutral-700 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      // handleDeleteAllArchived is only available in roadmap IIFE scope,
                      // so we replicate the logic here with access to the state setters
                      const archived = roadmapItems.filter((i) => i.status === 'archived');
                      if (archived.length === 0) { setDeleteAllArchivedConfirmOpen(false); return; }
                      const projectId = activeRoadmapProject!.id;
                      const storeSnapshot = storeRoadmapItems[projectId] ?? [];
                      setRoadmapItems((prev) => prev.filter((i) => i.status !== 'archived'));
                      setRoadmapItemsForProject(projectId, storeSnapshot.filter((i) => i.status !== 'archived'));
                      setShowArchived(false);
                      setDeleteAllArchivedConfirmOpen(false);
                      void deleteRoadmapItems(projectId, archived.map((i) => i.id)).catch(() => {
                        setRoadmapItems((prev) => [...prev, ...archived]);
                        setRoadmapItemsForProject(projectId, storeSnapshot);
                        pushToast('error', 'Failed to delete archived items');
                      });
                      pushToast('success', `${archived.length} archived item(s) deleted`);
                    }}
                    className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-red-700"
                  >
                    Delete all
                  </button>
                </div>
              </div>
            </div>
          )}

          <SyncDialog
            open={syncDialogOpen}
            onOpenChange={(open) => {
              setSyncDialogOpen(open);
              if (!open) scanUnresolvedSyncState();
            }}
            projects={allProjects}
            boardScoped={sidebarOpen}
            onRequestChatPrefill={(prefillText) => {
              setSyncDialogOpen(false);
              setChatDrawerOpen(true);
              setChatPrefillRequest({
                id: `prefill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                text: prefillText,
              });
            }}
            onSyncComplete={() => { void loadProjects(); }}
          />
        </>
      )}
        </div>
        {hubDrawerOpen && hubActiveChatId && sidebarSide === 'right' && (
          <SecondaryDrawer
            chatId={hubActiveChatId}
            width={hubDrawerWidth}
            side="right"
            onWidthChange={setHubDrawerWidth}
            onClose={() => setHubDrawerOpen(false)}
            onToast={pushToast}
            onOpenLinkedItem={handleOpenLinkedItem}
            onOpenLinkedProject={handleOpenLinkedProject}
          />
        )}
        {sidebarSide === 'right' ? (
          <Sidebar
            side="right"
            mode={resolvedSidebarMode}
            onOpenSettings={handleSettingsOpen}
            onBack={handleSettingsBack}
            elevated={boardModalOpen}
            actions={sidebarActions}
            onToast={pushToast}
          />
        ) : null}
        {showThinSidebar && thinSidebarSide === 'right' ? (
          <ThinSidebar
            side="right"
            onSearch={handleSearchOpen}
            onAddProject={handleAddProjectOpen}
            onRefresh={handleRefreshProjects}
            onOpenSync={handleOpenSync}
            onSwitchSide={handleSwitchThinSidebarSide}
            onOpenSettings={handleSettingsOpen}
            onToggleHub={handleToggleHub}
            hubButtonRef={hubButtonRef}
            syncBadgeCount={syncBadgeCount}
            hubUnreadCount={hubUnreadCount}
          />
        ) : null}
      </div>

      {/* Quick access popover for hub conversations */}
      <QuickAccessPopover
        anchorRef={hubButtonRef}
        onSelectChat={handleQuickAccessSelectChat}
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
    </div>
  );
}
