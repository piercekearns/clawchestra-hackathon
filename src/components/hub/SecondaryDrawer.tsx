import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HubAgentType, HubChat, HubThread } from '../../lib/hub-types';
import { buildRows } from '../../lib/hub-utils';
import { useDashboardStore } from '../../lib/store';
import { hubChatCreate, hubChatUpdate, tmuxKillSession } from '../../lib/tauri';
import { tmuxSessionName, AGENT_LABELS } from '../../lib/terminal-utils';
import { addTerminalSpawnGrace } from '../../lib/terminal-activity';
import { DrawerHeader } from './DrawerHeader';
import { ScopedChatShell } from './ScopedChatShell';
import { TabStrip } from './TabStrip';

const MIN_WIDTH = 280;
const MAX_WIDTH = 1200;
const MIN_HEIGHT = 200;
const MAX_HEIGHT = 800;

interface SecondaryDrawerProps {
  chatId: string;
  width: number;
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
  onOpenLinkedItem?: (projectId: string, projectTitle: string, itemId: string) => void;
  onOpenLinkedProject?: (projectId: string, projectTitle: string) => void;
  orientation?: 'horizontal' | 'vertical';
  height?: number;
  onHeightChange?: (height: number) => void;
}

export function SecondaryDrawer({
  chatId,
  width,
  onWidthChange,
  onClose,
  onToast,
  onOpenLinkedItem,
  onOpenLinkedProject,
  orientation = 'horizontal',
  height = 400,
  onHeightChange,
}: SecondaryDrawerProps) {
  const hubChats = useDashboardStore((s) => s.hubChats);
  const projects = useDashboardStore((s) => s.projects);
  const roadmapItems = useDashboardStore((s) => s.roadmapItems);
  const setHubActiveChatId = useDashboardStore((s) => s.setHubActiveChatId);
  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);

  const chat = hubChats.find((c) => c.id === chatId);
  const isDragging = useRef(false);
  const rafHandle = useRef(0);
  const [isResizing, setIsResizing] = useState(false);
  const [isHandleHover, setIsHandleHover] = useState(false);
  const [terminalFocused, setTerminalFocused] = useState(false);
  const [terminalDragActive, setTerminalDragActive] = useState(false);
  const [terminalRestartKey, setTerminalRestartKey] = useState(0);
  const [pendingCloseTabId, setPendingCloseTabId] = useState<string | null>(null);
  const [pendingArchive, setPendingArchive] = useState<{ type: 'tab' | 'row'; chatIds: string[]; activeCount: number } | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  // Track the last active tab per row (keyed by "projectId:itemId") for cycling back
  const lastActiveTabPerRow = useRef(new Map<string, string>());

  // Local toast state — drawer toasts render inside the header, not on the kanban board
  const [drawerToasts, setDrawerToasts] = useState<{ id: number; kind: 'success' | 'error'; message: string; action?: { label: string; onClick: () => void } }[]>([]);
  const pushDrawerToast = useCallback((kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setDrawerToasts((current) => [...current, { id, kind, message, action }]);
    window.setTimeout(() => {
      setDrawerToasts((current) => current.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  // Record the current tab as the last active for its row
  useEffect(() => {
    if (!chat) return;
    const rowKey = `${chat.projectId}:${chat.itemId ?? '__project__'}`;
    lastActiveTabPerRow.current.set(rowKey, chat.id);
  }, [chat]);

  // Resolve project title
  const projectTitle = useMemo(() => {
    if (!chat) return '';
    const findTitle = (ps: typeof projects): string | undefined => {
      for (const p of ps) {
        if (p.id === chat.projectId) return p.frontmatter?.title ?? p.id;
        if (p.children) {
          const found = findTitle(p.children);
          if (found) return found;
        }
      }
      return undefined;
    };
    return findTitle(projects) ?? chat.projectId;
  }, [chat, projects]);

  // Derive the row: all non-archived chats sharing the same (projectId, itemId) as the active chat
  const rowTabs = useMemo(() => {
    if (!chat) return [];
    return hubChats
      .filter(
        (c) =>
          c.projectId === chat.projectId &&
          c.itemId === chat.itemId &&
          !c.archived,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  }, [chat, hubChats]);

  // Resolve row title: for item-level rows, use roadmap item title
  const rowTitle = useMemo(() => {
    if (!chat) return '';
    if (chat.itemId) {
      const items = roadmapItems[chat.projectId] ?? [];
      const item = items.find((i) => i.id === chat.itemId);
      return item?.title ?? chat.title;
    }
    return projectTitle;
  }, [chat, projectTitle, roadmapItems]);

  // Build sorted rows for the current folder to enable row cycling
  const roadmapItemMap = useMemo(() => {
    if (!chat) return new Map<string, string>();
    const map = new Map<string, string>();
    const items = roadmapItems[chat.projectId] ?? [];
    for (const item of items) {
      map.set(item.id, item.title);
    }
    return map;
  }, [chat, roadmapItems]);

  const threadRows = useMemo(() => {
    if (!chat) return [];
    const threadChats = hubChats.filter((c) => c.projectId === chat.projectId);
    const thread: HubThread = { projectId: chat.projectId, projectTitle, chats: threadChats };
    return buildRows(thread, roadmapItemMap);
  }, [chat, hubChats, projectTitle, roadmapItemMap]);

  const currentItemId = chat?.itemId ?? null;
  const currentRowIndex = threadRows.findIndex(
    (r) => r.itemId === currentItemId,
  );
  const canGoUp = currentRowIndex > 0;
  const canGoDown = currentRowIndex >= 0 && currentRowIndex < threadRows.length - 1;

  const handleCycleRow = useCallback(
    (direction: 'up' | 'down') => {
      const targetIndex = direction === 'up' ? currentRowIndex - 1 : currentRowIndex + 1;
      const targetRow = threadRows[targetIndex];
      if (!targetRow || targetRow.tabs.length === 0) return;
      // Prefer the tab last viewed in this row, fall back to first by sort order
      const rowKey = `${targetRow.projectId}:${targetRow.itemId ?? '__project__'}`;
      const lastId = lastActiveTabPerRow.current.get(rowKey);
      const lastTab = lastId ? targetRow.tabs.find((t) => t.id === lastId) : undefined;
      const bestTab = lastTab ?? targetRow.tabs[0];
      setHubActiveChatId(bestTab.id);
      // Auto-expand for terminals
      if (bestTab.type === 'terminal') {
        const currentWidth = useDashboardStore.getState().hubDrawerWidth;
        if (currentWidth < 640) {
          useDashboardStore.getState().setHubDrawerWidth(640);
        }
      }
    },
    [currentRowIndex, threadRows, setHubActiveChatId],
  );

  const handleRestart = useCallback(() => {
    if (!chat) return;
    const sessionName = tmuxSessionName(chat.projectId, chat.id);
    void tmuxKillSession(sessionName).catch(() => {});
    setTerminalRestartKey((k) => k + 1);
  }, [chat]);

  const handleSelectTab = useCallback(
    (tabChatId: string) => {
      setHubActiveChatId(tabChatId);
      // Reset terminal restart key when switching tabs
      setTerminalRestartKey(0);
      // Auto-expand for terminals
      const tabChat = hubChats.find((c) => c.id === tabChatId);
      if (tabChat?.type === 'terminal') {
        const currentWidth = useDashboardStore.getState().hubDrawerWidth;
        if (currentWidth < 640) {
          useDashboardStore.getState().setHubDrawerWidth(640);
        }
      }
    },
    [hubChats, setHubActiveChatId],
  );

  const executeCloseTab = useCallback(
    async (tabChatId: string, killSession: boolean) => {
      if (killSession) {
        const tabChat = hubChats.find((c) => c.id === tabChatId);
        if (tabChat) {
          const session = tmuxSessionName(tabChat.projectId, tabChat.id);
          void tmuxKillSession(session).catch(() => {});
        }
      }

      await hubChatUpdate(tabChatId, { archived: true });
      await refreshHubChats();

      // If closing the active tab, switch to another tab in the row,
      // or cycle to an adjacent row, or close the drawer as a last resort
      if (tabChatId === chatId) {
        const remaining = rowTabs.filter((t) => t.id !== tabChatId);
        if (remaining.length > 0) {
          const best = remaining.reduce((a, b) =>
            a.lastActivity > b.lastActivity ? a : b,
          );
          setHubActiveChatId(best.id);
        } else {
          const adjacentRow = currentRowIndex > 0
            ? threadRows[currentRowIndex - 1]
            : threadRows[currentRowIndex + 1];
          if (adjacentRow && adjacentRow.tabs.length > 0) {
            const rowKey = `${adjacentRow.projectId}:${adjacentRow.itemId ?? '__project__'}`;
            const lastId = lastActiveTabPerRow.current.get(rowKey);
            const lastTab = lastId ? adjacentRow.tabs.find((t) => t.id === lastId) : undefined;
            const bestTab = lastTab ?? adjacentRow.tabs[0];
            setHubActiveChatId(bestTab.id);
          } else {
            onClose();
          }
        }
      }

      const archived = hubChats.find((c) => c.id === tabChatId);
      if (archived) {
        pushDrawerToast('success', `"${archived.title}" archived`, {
          label: 'Undo',
          onClick: () => {
            void hubChatUpdate(tabChatId, { archived: false }).then(() => refreshHubChats());
          },
        });
      }
    },
    [chatId, rowTabs, hubChats, setHubActiveChatId, refreshHubChats, onClose, pushDrawerToast],
  );

  const activeTerminals = useDashboardStore((s) => s.activeTerminalChatIds);

  const handleCloseTab = useCallback(
    (tabChatId: string) => {
      const tabChat = hubChats.find((c) => c.id === tabChatId);
      const isActiveTerminal = tabChat?.type === 'terminal' && activeTerminals.has(tabChatId);
      if (isActiveTerminal) {
        setPendingCloseTabId(tabChatId);
      } else {
        void executeCloseTab(tabChatId, false);
      }
    },
    [hubChats, activeTerminals, executeCloseTab],
  );

  /** Navigate to an adjacent row, or close the drawer if none remain. */
  const navigateAway = useCallback(() => {
    const adjacentRow = currentRowIndex > 0
      ? threadRows[currentRowIndex - 1]
      : threadRows[currentRowIndex + 1];
    if (adjacentRow && adjacentRow.tabs.length > 0) {
      const rowKey = `${adjacentRow.projectId}:${adjacentRow.itemId ?? '__project__'}`;
      const lastId = lastActiveTabPerRow.current.get(rowKey);
      const lastTab = lastId ? adjacentRow.tabs.find((t) => t.id === lastId) : undefined;
      const bestTab = lastTab ?? adjacentRow.tabs[0];
      setHubActiveChatId(bestTab.id);
    } else {
      onClose();
    }
  }, [currentRowIndex, threadRows, setHubActiveChatId, onClose]);

  /** Execute archive for a set of chat IDs — kills active terminals, archives, navigates away. */
  const executeArchive = useCallback(
    async (chatIds: string[], label: string) => {
      // Kill any active terminal sessions
      for (const id of chatIds) {
        const c = hubChats.find((h) => h.id === id);
        if (c?.type === 'terminal' && activeTerminals.has(id)) {
          const session = tmuxSessionName(c.projectId, c.id);
          void tmuxKillSession(session).catch(() => {});
        }
      }
      // Archive all
      for (const id of chatIds) {
        await hubChatUpdate(id, { archived: true });
      }
      await refreshHubChats();
      // Navigate away
      if (chatIds.includes(chatId)) {
        const remaining = rowTabs.filter((t) => !chatIds.includes(t.id));
        if (remaining.length > 0) {
          const best = remaining.reduce((a, b) =>
            a.lastActivity > b.lastActivity ? a : b,
          );
          setHubActiveChatId(best.id);
        } else {
          navigateAway();
        }
      }
      pushDrawerToast('success', label, {
        label: 'Undo',
        onClick: () => {
          void (async () => {
            for (const id of chatIds) {
              await hubChatUpdate(id, { archived: false });
            }
            await refreshHubChats();
          })();
        },
      });
    },
    [chatId, rowTabs, hubChats, activeTerminals, setHubActiveChatId, refreshHubChats, navigateAway, pushDrawerToast],
  );

  /** Archive the current tab — with confirmation if it has an active terminal. */
  const handleArchiveTab = useCallback(() => {
    if (!chat) return;
    const isActive = chat.type === 'terminal' && activeTerminals.has(chat.id);
    if (isActive) {
      setPendingArchive({ type: 'tab', chatIds: [chat.id], activeCount: 1 });
    } else {
      void executeArchive([chat.id], `"${chat.title}" archived`);
    }
  }, [chat, activeTerminals, executeArchive]);

  /** Archive the entire row — with confirmation if any tabs have active terminals. */
  const handleArchiveRow = useCallback(() => {
    if (rowTabs.length === 0) return;
    const ids = rowTabs.map((t) => t.id);
    const activeCount = rowTabs.filter((t) => t.type === 'terminal' && activeTerminals.has(t.id)).length;
    if (activeCount > 0) {
      setPendingArchive({ type: 'row', chatIds: ids, activeCount });
    } else {
      const label = ids.length === 1 ? `"${rowTabs[0].title}" archived` : `${ids.length} chats archived`;
      void executeArchive(ids, label);
    }
  }, [rowTabs, activeTerminals, executeArchive]);

  const handleAddChat = useCallback(async () => {
    if (!chat) return;
    const title = `New Chat ${new Date().toLocaleDateString()}`;
    const newChat = await hubChatCreate(
      chat.projectId,
      chat.itemId,
      'openclaw',
      null,
      title,
    );
    await refreshHubChats();
    setHubActiveChatId(newChat.id);
  }, [chat, refreshHubChats, setHubActiveChatId]);

  const handleAddTerminal = useCallback(
    async (agentType: HubAgentType) => {
      if (!chat) return;
      const label = AGENT_LABELS[agentType] ?? agentType;
      const title = agentType === 'generic' ? 'Terminal' : label;
      const newChat = await hubChatCreate(
        chat.projectId,
        chat.itemId,
        'terminal',
        agentType,
        title,
      );

      // Optimistic active terminal tracking (same as openOrCreateTerminal)
      const store = useDashboardStore.getState();
      const updated = new Set(store.activeTerminalChatIds);
      updated.add(newChat.id);
      store.setActiveTerminalChatIds(updated);
      addTerminalSpawnGrace(newChat.id);

      await refreshHubChats();
      setHubActiveChatId(newChat.id);

      // Auto-expand for terminals
      const currentWidth = useDashboardStore.getState().hubDrawerWidth;
      if (currentWidth < 640) {
        useDashboardStore.getState().setHubDrawerWidth(640);
      }
    },
    [chat, refreshHubChats, setHubActiveChatId],
  );

  const isVertical = orientation === 'vertical';

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = isVertical ? 'row-resize' : 'col-resize';

      const rect = drawerRef.current?.getBoundingClientRect();

      const onMouseMove = (event: MouseEvent) => {
        if (!isDragging.current) return;
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = requestAnimationFrame(() => {
          if (!isDragging.current) return;
          if (isVertical) {
            const drawerBottom = rect?.bottom ?? 0;
            const newHeight = drawerBottom - event.clientY;
            const minH = chat?.type === 'terminal' ? 300 : MIN_HEIGHT;
            const parentHeight = drawerRef.current?.parentElement?.clientHeight ?? Infinity;
            const maxH = Math.min(MAX_HEIGHT, parentHeight - MIN_HEIGHT);
            onHeightChange?.(Math.min(maxH, Math.max(minH, newHeight)));
          } else {
            const drawerLeft = rect?.left ?? 0;
            const newWidth = event.clientX - drawerLeft;
            const minW = chat?.type === 'terminal' ? 560 : MIN_WIDTH;
            onWidthChange(Math.min(MAX_WIDTH, Math.max(minW, newWidth)));
          }
        });
      };

      const onMouseUp = () => {
        isDragging.current = false;
        cancelAnimationFrame(rafHandle.current);
        setIsResizing(false);
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    },
    [onWidthChange, onHeightChange, chat, isVertical],
  );

  if (!chat) return null;

  return (
    <div
      ref={drawerRef}
      className={`relative z-[60] flex flex-col shrink-0 overflow-visible`}
      style={isVertical ? { height, maxHeight: 'calc(100% - 200px)', willChange: 'transform' } : { width, willChange: 'transform' }}
    >
      <div className="flex h-full flex-col">
        {/* Header + tabs section — always neutral border */}
        <div className={`${isVertical ? 'border-t' : 'border-r'} border-neutral-200 dark:border-neutral-700`}>
          <div className="relative">
          <DrawerHeader
            chat={chat}
            projectTitle={projectTitle}
            rowTitle={rowTitle}
            onClose={onClose}
            onToast={pushDrawerToast}
            onOpenLinkedItem={onOpenLinkedItem}
            onOpenLinkedProject={onOpenLinkedProject}
            onRestart={chat.type === 'terminal' ? handleRestart : undefined}
            onArchiveTab={handleArchiveTab}
            onArchiveRow={handleArchiveRow}
            canCycleUp={canGoUp}
            canCycleDown={canGoDown}
            onCycleUp={canGoUp ? () => handleCycleRow('up') : undefined}
            onCycleDown={canGoDown ? () => handleCycleRow('down') : undefined}
          />
          {drawerToasts.length > 0 && (
            <div className="pointer-events-none absolute inset-0 z-[70] flex items-center justify-center px-4">
              <div className="pointer-events-auto flex flex-col items-center gap-2">
                {drawerToasts.map((toast) => (
                  <div
                    key={toast.id}
                    className={`flex w-full max-w-md items-center justify-between gap-3 rounded-lg border px-3 py-1.5 text-sm shadow-md ${
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
                          setDrawerToasts((current) => current.filter((t) => t.id !== toast.id));
                        }}
                        className="shrink-0 rounded px-2 py-0.5 text-xs font-semibold text-revival-accent-600 transition-colors hover:bg-revival-accent-400/20 dark:text-revival-accent-300"
                      >
                        {toast.action.label}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
          {/* Tab strip — shown when the row has multiple tabs, or always to allow adding tabs */}
          <TabStrip
            tabs={rowTabs}
            activeTabId={chatId}
            onSelectTab={handleSelectTab}
            onCloseTab={handleCloseTab}
            onAddChat={handleAddChat}
            onAddTerminal={handleAddTerminal}
          />
          {pendingCloseTabId && (
            <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs dark:bg-amber-400/5">
              <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-300">
                This terminal is running. End session?
              </span>
              <button
                type="button"
                onClick={() => setPendingCloseTabId(null)}
                className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1 font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const id = pendingCloseTabId;
                  setPendingCloseTabId(null);
                  void executeCloseTab(id, true);
                }}
                className="shrink-0 rounded-md bg-red-500 px-2.5 py-1 font-medium text-white transition-colors hover:bg-red-600"
              >
                End session
              </button>
            </div>
          )}
          {pendingArchive && (
            <div className="flex items-center gap-2 border-b border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs dark:bg-amber-400/5">
              <span className="min-w-0 flex-1 text-neutral-700 dark:text-neutral-300">
                {pendingArchive.activeCount === 1
                  ? 'This will end 1 active terminal session.'
                  : `This will end ${pendingArchive.activeCount} active terminal sessions.`}
                {' '}Archive?
              </span>
              <button
                type="button"
                onClick={() => setPendingArchive(null)}
                className="shrink-0 rounded-md border border-neutral-200 px-2.5 py-1 font-medium text-neutral-600 transition-colors hover:bg-neutral-100 dark:border-neutral-600 dark:text-neutral-400 dark:hover:bg-neutral-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const { chatIds } = pendingArchive;
                  const label = chatIds.length === 1
                    ? `"${hubChats.find((c) => c.id === chatIds[0])?.title ?? 'Chat'}" archived`
                    : `${chatIds.length} chats archived`;
                  setPendingArchive(null);
                  void executeArchive(chatIds, label);
                }}
                className="shrink-0 rounded-md bg-red-500 px-2.5 py-1 font-medium text-white transition-colors hover:bg-red-600"
              >
                End &amp; archive
              </button>
            </div>
          )}
        </div>
        <div
          className={`flex min-h-0 flex-1 flex-col border ${isVertical ? '' : '-ml-px'} ${
            isResizing
              ? 'border-[#9fbf00] dark:border-[#9fbf00]'
              : isHandleHover
                ? 'border-[#8ca800] dark:border-[#8ca800]'
                : terminalFocused && !terminalDragActive
                  ? 'border-revival-accent-400/50'
                  : isVertical
                    ? 'border-transparent'
                    : 'border-transparent border-r-neutral-200 dark:border-transparent dark:border-r-neutral-700'
          } ${isResizing ? '' : 'transition-[border-color] duration-200 ease-out'}`}
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ScopedChatShell chat={chat} onTerminalFocusChange={setTerminalFocused} onTerminalDragActiveChange={setTerminalDragActive} terminalRestartKey={terminalRestartKey} />
          </div>
        </div>
      </div>

      {/* Drag handle */}
      <div
        role="separator"
        aria-orientation={isVertical ? 'horizontal' : 'vertical'}
        aria-valuenow={isVertical ? height : width}
        aria-valuemin={isVertical ? MIN_HEIGHT : MIN_WIDTH}
        aria-valuemax={isVertical ? MAX_HEIGHT : MAX_WIDTH}
        onMouseDown={handleDragStart}
        onMouseEnter={() => setIsHandleHover(true)}
        onMouseLeave={() => setIsHandleHover(false)}
        onDoubleClick={() => {
          if (isVertical) {
            onHeightChange?.(chat?.type === 'terminal' ? 400 : 300);
          } else {
            onWidthChange(chat?.type === 'terminal' ? 640 : 400);
          }
        }}
        className={isVertical
          ? 'group absolute left-0 top-0 z-[70] h-[6px] w-full -translate-y-1/2 cursor-row-resize [will-change:transform]'
          : 'group absolute right-0 top-0 z-[70] h-full w-[6px] translate-x-1/2 cursor-col-resize [will-change:transform]'
        }
      >
        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-colors duration-150 ${
            isVertical ? 'h-1.5 w-6' : 'h-6 w-1.5'
          } ${
            isResizing
              ? 'border-[#DFFF00] bg-[#DFFF00]'
              : isHandleHover
                ? 'border-[#a7c400] bg-[#a7c400]'
                : 'border-neutral-300 dark:border-neutral-600 bg-white dark:bg-neutral-900'
          }`}
        />
      </div>
    </div>
  );
}
