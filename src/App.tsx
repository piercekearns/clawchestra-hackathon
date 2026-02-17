import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock4, Link2 } from 'lucide-react';
import { AddProjectDialog } from './components/AddProjectDialog';
import { Board } from './components/Board';
import { Breadcrumb } from './components/Breadcrumb';
import { ProjectModal } from './components/modal';
import type { ProjectModalActions } from './components/modal';
import { Header } from './components/Header';
import { SettingsDialog } from './components/SettingsDialog';
import { ChatShell, createQueueId } from './components/chat';
import { SearchModal } from './components/search';
import type { ChatConnectionState, ChatSendPayload, QueuedMessage } from './components/chat';
import type { DashboardError } from './lib/errors';
import {
  checkGatewayConnection,
  retryGatewayConnection,
  sendMessageWithContext,
  type ChatMessage,
  type GatewayImageAttachment,
} from './lib/gateway';
import { commitPlanningDocs, gitStatusEmoji, pushRepo } from './lib/git';
import { reorderProjects, updateProject, type ProjectUpdate } from './lib/projects';
import { readRoadmap, writeRoadmap } from './lib/roadmap';
import type {
  ProjectStatus,
  ProjectViewModel,
  RoadmapDocument,
  RoadmapItem,
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

export default function App() {
  const projects = useDashboardStore((state) => state.projects);
  const errors = useDashboardStore((state) => state.errors);
  const chatMessages = useDashboardStore((state) => state.chatMessages);
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
  const [roadmapItems, setRoadmapItems] = useState<RoadmapItem[]>([]);
  const [chatActivityLabel, setChatActivityLabel] = useState<string | null>(null);
  const [chatStreamingContent, setChatStreamingContent] = useState<string | null>(null);
  const [chatSending, setChatSending] = useState(false); // Track if agent is working
  const [chatDrawerOpen, setChatDrawerOpen] = useState(false);
  const [chatResponseToastMessage, setChatResponseToastMessage] = useState<string | null>(null);
  const [chatQueue, setChatQueue] = useState<QueuedMessage[]>([]); // Message queue
  const chatDrawerOpenRef = useRef(chatDrawerOpen);

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

  // System bubbles for connection state transitions
  useEffect(() => {
    let prevState: ChatConnectionState = useDashboardStore.getState().wsConnectionState;

    const unsubscribe = useDashboardStore.subscribe((state) => {
      const nextState = state.wsConnectionState;
      if (nextState === prevState) return;

      if (nextState === 'disconnected' && prevState === 'connected') {
        addChatMessage({ role: 'system', content: 'Gateway connection lost, reconnecting...', timestamp: Date.now() });
      } else if (nextState === 'connected' && (prevState === 'reconnecting' || prevState === 'error')) {
        addChatMessage({ role: 'system', content: 'Connection restored.', timestamp: Date.now() });
      } else if (nextState === 'error') {
        addChatMessage({ role: 'system', content: 'Connection failed after 5 attempts. Click retry to try again.', timestamp: Date.now() });
      }

      prevState = nextState;
    });

    return unsubscribe;
  }, [addChatMessage]);

  useEffect(() => {
    let disposed = false;
    let dispose: () => void = () => undefined;
    let fallbackPoll: number | undefined;

    const startWatching = async () => {
      if (!isTauriRuntime() || !dashboardSettings) return;

      try {
        const unwatch = await watchProjects(dashboardSettings.scanPaths, async () => {
          await loadProjects();
          addChatMessage({
            role: 'system',
            content: `File watcher: refreshed ${new Date().toLocaleTimeString()}`,
            timestamp: Date.now(),
          });
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
  }, [addChatMessage, loadProjects, dashboardSettings]);

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
      setRoadmapDocument(roadmap);
      setRoadmapItems(roadmap.items);
      setViewContext(projectRoadmapView(project.id, project.title));
      setSelectedProjectId(undefined);
    } catch (error) {
      pushToast(
        'error',
        error instanceof Error ? error.message : `Failed to open roadmap for ${project.title}`,
      );
    }
  };

  const persistRoadmapChanges = async (nextItems: RoadmapItem[]) => {
    if (!roadmapDocument) return;

    const orderedByColumn: RoadmapItem[] = [];
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
      items: orderedByColumn,
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
    setChatQueue((current) => {
      if (current.length === 0) return current;
      
      const [next, ...rest] = current;
      // Use setTimeout to avoid state update during render
      setTimeout(() => {
        void sendChatMessage({ text: next.text, images: next.attachments });
      }, 100);
      
      return rest;
    });
  };

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

    addChatMessage(userMessage);
    setChatSending(true);
    setChatActivityLabel('Thinking...');
    setChatStreamingContent(null);
    setChatResponseToastMessage(null);

    try {
      const result = await sendMessageWithContext(
        [...chatMessages, userMessage],
        {
          view: viewContext.type,
          selectedProject: selectedProject?.title,
        },
        {
          attachments,
          onStreamDelta: (content) => {
            setChatStreamingContent(content);
          },
          onActivityChange: (label) => {
            // Update activity label based on gateway state events
            setChatActivityLabel(label);
          },
        },
      );

      setChatStreamingContent(null);
      setGatewayConnected(true);
      
      // Add ALL assistant messages (fixes dropped message bug)
      for (const msg of result.messages) {
        addChatMessage(msg);
      }
      
      if (!chatDrawerOpenRef.current && result.lastContent) {
        setChatResponseToastMessage(result.lastContent);
      }
      await loadProjects();
      return true;
    } catch (error) {
      const messageText = error instanceof Error ? error.message : 'Gateway request failed';
      setGatewayConnected(false);
      addError({ type: 'gateway_down', message: messageText });
      addChatMessage({ role: 'system', content: `Gateway error: ${messageText}`, timestamp: Date.now() });
      return false;
    } finally {
      setChatSending(false);
      setChatActivityLabel(null);
      setChatStreamingContent(null);
      
      // Process next queued message if any
      void processNextQueuedMessage();
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
                  onClick={() => setSelectedProjectId(project.id)}
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
                <Board
                  columns={viewContext.columns}
                  items={roadmapItems}
                  onItemClick={() => undefined}
                  onItemsChange={(nextItems) => {
                    void persistRoadmapChanges(nextItems);
                  }}
                />
              ) : (
                <Board
                  columns={viewContext.columns}
                  items={topLevelProjects}
                  onItemClick={(project) => setSelectedProjectId(project.id)}
                  renderItemIndicators={(project) => (
                    <>
                      {project.isStale ? <Clock4 className="h-4 w-4 text-status-danger" /> : null}
                      {project.hasRepo ? <Link2 className="h-4 w-4 text-status-info" /> : null}
                      {project.gitStatus ? (
                        <span className="text-xs" title={project.gitStatus.details}>
                          {gitStatusEmoji(project.gitStatus)}
                        </span>
                      ) : null}
                      {project.commitActivity ? (
                        <span className="rounded-full bg-neutral-200 px-1.5 py-0.5 text-[10px] dark:bg-neutral-700">
                          {project.commitActivity.commitsThisWeek}/wk
                        </span>
                      ) : null}
                    </>
                  )}
                  renderItemActions={(project) => {
                    if (!project.hasRoadmap) return null;
                    return (
                      <button
                        type="button"
                        className="rounded-full border border-revival-accent-400 px-2 py-0.5 text-[10px] font-semibold text-neutral-900 hover:bg-revival-accent-100 dark:text-neutral-100 dark:hover:bg-revival-accent-900/40"
                        onClick={(event) => {
                          event.stopPropagation();
                          void openRoadmapView(project);
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        View Roadmap
                      </button>
                    );
                  }}
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
        onSelect={(project) => setSelectedProjectId(project.id)}
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
