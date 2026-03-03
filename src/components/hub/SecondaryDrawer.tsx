import { useCallback, useMemo, useRef, useState } from 'react';
import type { HubAgentType, HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { hubChatCreate, hubChatUpdate, tmuxKillSession } from '../../lib/tauri';
import { tmuxSessionName, AGENT_LABELS } from '../../lib/terminal-utils';
import { addTerminalSpawnGrace } from '../../lib/terminal-activity';
import { DrawerHeader } from './DrawerHeader';
import { ScopedChatShell } from './ScopedChatShell';
import { TabStrip } from './TabStrip';

const MIN_WIDTH = 280;
const MAX_WIDTH = 1200;

interface SecondaryDrawerProps {
  chatId: string;
  width: number;
  side?: 'left' | 'right';
  onWidthChange: (width: number) => void;
  onClose: () => void;
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
  onOpenLinkedItem?: (projectId: string, projectTitle: string, itemId: string) => void;
  onOpenLinkedProject?: (projectId: string, projectTitle: string) => void;
}

export function SecondaryDrawer({
  chatId,
  width,
  side = 'left',
  onWidthChange,
  onClose,
  onToast,
  onOpenLinkedItem,
  onOpenLinkedProject,
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
  const drawerRef = useRef<HTMLDivElement>(null);

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

  const handleCloseTab = useCallback(
    async (tabChatId: string) => {
      await hubChatUpdate(tabChatId, { archived: true });
      await refreshHubChats();

      // If closing the active tab, switch to another tab or close drawer
      if (tabChatId === chatId) {
        const remaining = rowTabs.filter((t) => t.id !== tabChatId);
        if (remaining.length > 0) {
          // Switch to the most recently active remaining tab
          const best = remaining.reduce((a, b) =>
            a.lastActivity > b.lastActivity ? a : b,
          );
          setHubActiveChatId(best.id);
        } else {
          onClose();
        }
      }

      if (onToast) {
        const archived = hubChats.find((c) => c.id === tabChatId);
        if (archived) {
          onToast('success', `"${archived.title}" archived`, {
            label: 'Undo',
            onClick: () => {
              void hubChatUpdate(tabChatId, { archived: false }).then(() => refreshHubChats());
            },
          });
        }
      }
    },
    [chatId, rowTabs, hubChats, setHubActiveChatId, refreshHubChats, onClose, onToast],
  );

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

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      setIsResizing(true);
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const rect = drawerRef.current?.getBoundingClientRect();
      const drawerLeft = rect?.left ?? 0;
      const drawerRight = rect?.right ?? 0;

      const onMouseMove = (event: MouseEvent) => {
        if (!isDragging.current) return;
        cancelAnimationFrame(rafHandle.current);
        rafHandle.current = requestAnimationFrame(() => {
          if (!isDragging.current) return;
          const newWidth = side === 'right'
            ? drawerRight - event.clientX
            : event.clientX - drawerLeft;
          const minW = chat?.type === 'terminal' ? 560 : MIN_WIDTH;
          onWidthChange(Math.min(MAX_WIDTH, Math.max(minW, newWidth)));
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
    [onWidthChange, chat, side],
  );

  if (!chat) return null;

  return (
    <div
      ref={drawerRef}
      className={`relative z-[60] flex shrink-0 flex-col overflow-visible ${side === 'right' ? 'border-l' : 'border-r'} ${
        isResizing
          ? 'border-[#9fbf00] dark:border-[#9fbf00]'
          : isHandleHover
            ? 'border-[#8ca800] dark:border-[#8ca800]'
            : 'border-neutral-200 dark:border-neutral-700'
      } ${isResizing ? '' : 'transition-[border-color] duration-200 ease-out'}`}
      style={{ width, willChange: 'transform' }}
    >
      <div className="flex h-full flex-col overflow-hidden">
        <DrawerHeader
          chat={chat}
          projectTitle={projectTitle}
          rowTitle={rowTitle}
          onClose={onClose}
          onToast={onToast}
          onOpenLinkedItem={onOpenLinkedItem}
          onOpenLinkedProject={onOpenLinkedProject}
          onRestart={chat.type === 'terminal' ? handleRestart : undefined}
        />
        {/* Tab strip — shown when the row has multiple tabs, or always to allow adding tabs */}
        <TabStrip
          tabs={rowTabs}
          activeTabId={chatId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onAddChat={handleAddChat}
          onAddTerminal={handleAddTerminal}
        />
        <div className={`flex min-h-0 flex-1 flex-col transition-shadow duration-200 ${
          terminalDragActive ? '' : terminalFocused ? 'ring-1 ring-inset ring-revival-accent-400/40' : ''
        }`}>
          <ScopedChatShell chat={chat} onTerminalFocusChange={setTerminalFocused} onTerminalDragActiveChange={setTerminalDragActive} terminalRestartKey={terminalRestartKey} />
        </div>
      </div>

      {/* Drag handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        onMouseDown={handleDragStart}
        onMouseEnter={() => setIsHandleHover(true)}
        onMouseLeave={() => setIsHandleHover(false)}
        onDoubleClick={() => onWidthChange(chat?.type === 'terminal' ? 640 : 400)}
        className={`group absolute top-0 z-[70] h-full w-[6px] cursor-col-resize [will-change:transform] ${
          side === 'right' ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'
        }`}
      >
        <div
          className={`pointer-events-none absolute left-1/2 top-1/2 h-6 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border shadow-sm transition-colors duration-150 ${
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
