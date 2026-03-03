import { useMemo, useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Folder, FolderOpen, RotateCcw, Trash2 } from 'lucide-react';
import type { HubAgentType, HubChat, HubRow, HubThread } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { hubChatUpdate } from '../../lib/tauri';
import { RowEntryRow } from './RowEntryRow';
import { ScrollRevealText } from './ScrollRevealText';
import { TypePickerMenu } from './TypePickerMenu';

interface ThreadSectionProps {
  thread: HubThread;
  collapsed: boolean;
  activeChatId: string | null;
  completedItemIds?: Set<string>;
  onToggle: () => void;
  onSelectChat: (chatId: string) => void;
  onTogglePinChat: (chatId: string, pinned: boolean) => void;
  onArchiveChats: (chatIds: string[]) => void;
  onMarkReadChats: (chatIds: string[]) => void;
  onDeleteChats: (chatIds: string[]) => void;
  onAddChat: (projectId: string) => void;
  onAddTerminal?: (projectId: string, agentType: HubAgentType) => void;
}

/** Group non-archived chats in a thread into HubRows by (projectId, itemId). */
function buildRows(thread: HubThread, roadmapItemMap: Map<string, string>): HubRow[] {
  const nonArchived = thread.chats.filter((c) => !c.archived);
  const groups = new Map<string, HubChat[]>();

  for (const chat of nonArchived) {
    const key = chat.itemId ?? '__project__';
    const existing = groups.get(key);
    if (existing) {
      existing.push(chat);
    } else {
      groups.set(key, [chat]);
    }
  }

  const rows: HubRow[] = [];
  for (const [key, tabs] of groups) {
    const itemId = key === '__project__' ? null : key;
    const isProjectSurface = itemId === null;

    let title: string;
    if (isProjectSurface) {
      title = thread.projectTitle;
    } else {
      title = roadmapItemMap.get(itemId!) ?? tabs[0]?.title ?? 'Untitled';
    }

    // Sort tabs: by sortOrder, then creation time
    const sortedTabs = [...tabs].sort(
      (a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt,
    );

    rows.push({
      projectId: thread.projectId,
      itemId,
      title,
      tabs: sortedTabs,
      isProjectSurface,
    });
  }

  // Order: project surface first, then pinned rows, then by lastActivity desc
  rows.sort((a, b) => {
    if (a.isProjectSurface !== b.isProjectSurface) return a.isProjectSurface ? -1 : 1;
    const aPinned = a.tabs.some((t) => t.pinned);
    const bPinned = b.tabs.some((t) => t.pinned);
    if (aPinned !== bPinned) return aPinned ? -1 : 1;
    const aMax = Math.max(...a.tabs.map((t) => t.lastActivity));
    const bMax = Math.max(...b.tabs.map((t) => t.lastActivity));
    return bMax - aMax;
  });

  return rows;
}

export function ThreadSection({
  thread,
  collapsed,
  activeChatId,
  completedItemIds,
  onToggle,
  onSelectChat,
  onTogglePinChat,
  onArchiveChats,
  onMarkReadChats,
  onDeleteChats,
  onAddChat,
  onAddTerminal,
}: ThreadSectionProps) {
  const [contextMenuPos, setContextMenuPos] = useState<{ top: number; left: number } | null>(null);
  const roadmapItems = useDashboardStore((s) => s.roadmapItems);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: thread.projectId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  // Build a title lookup for roadmap items in this project
  const roadmapItemMap = useMemo(() => {
    const map = new Map<string, string>();
    const items = roadmapItems[thread.projectId] ?? [];
    for (const item of items) {
      map.set(item.id, item.title);
    }
    return map;
  }, [roadmapItems, thread.projectId]);

  // Group chats into rows
  const rows = useMemo(
    () => buildRows(thread, roadmapItemMap),
    [thread, roadmapItemMap],
  );

  // Check if the active chat belongs to any row in this thread
  const activeRow = activeChatId
    ? rows.find((r) => r.tabs.some((t) => t.id === activeChatId))
    : null;

  // Archived chats (for the collapsible archived section)
  const archivedChats = thread.chats.filter((c) => c.archived);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mb-1 ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Folder header — drag handle */}
      <div
        className="hub-row group relative flex items-center gap-2 rounded-md px-3 py-1.5 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={onToggle}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenuPos({ top: e.clientY + 4, left: e.clientX });
        }}
        {...attributes}
        {...listeners}
      >
        {/* Folder icon / chevron */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-500 dark:text-neutral-400"
          aria-label={collapsed ? 'Expand thread' : 'Collapse thread'}
        >
          <span className="group-hover:hidden">
            {collapsed ? (
              <Folder className="h-4 w-4" />
            ) : (
              <FolderOpen className="h-4 w-4" />
            )}
          </span>
          <span className="hidden group-hover:inline">
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </span>
        </button>

        {/* Project name */}
        <div className="min-w-0 flex-1 group-hover:pr-8">
          <ScrollRevealText
            text={thread.projectTitle}
            className="text-sm leading-tight text-neutral-700 dark:text-neutral-300"
          />
        </div>

        {/* Hover actions: + */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md bg-neutral-100 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity dark:bg-neutral-800">
          <TypePickerMenu
            onAddChat={() => onAddChat(thread.projectId)}
            onAddTerminal={onAddTerminal ? (agentType) => onAddTerminal(thread.projectId, agentType) : undefined}
            externalMenuPos={contextMenuPos}
            onExternalMenuClose={() => setContextMenuPos(null)}
          />
        </div>
      </div>

      {/* Rows — grouped chat surfaces */}
      {!collapsed && (
        <div>
          {rows.map((row) => {
            if (row.tabs.length === 0) return null;
            const rowKey = `${row.projectId}:${row.itemId ?? '__project__'}`;
            const isRowActive = activeRow === row;
            const isItemComplete = row.itemId ? (completedItemIds?.has(row.itemId) ?? false) : false;

            // Pick the best tab to open when clicking the row
            const bestTab = row.tabs.reduce((best, tab) =>
              tab.lastActivity > best.lastActivity ? tab : best,
            );

            return (
              <RowEntryRow
                key={rowKey}
                row={row}
                isActive={isRowActive}
                isItemComplete={isItemComplete}
                onSelect={() => onSelectChat(bestTab.id)}
                onRenameRow={() => {/* Row rename not yet supported */}}
                onTogglePinRow={() => {
                  const isPinned = row.tabs.some((t) => t.pinned);
                  const newPinned = !isPinned;
                  for (const tab of row.tabs) {
                    onTogglePinChat(tab.id, newPinned);
                  }
                }}
                onArchiveRow={() => onArchiveChats(row.tabs.map((t) => t.id))}
                onMarkReadRow={() => onMarkReadChats(row.tabs.map((t) => t.id))}
                onDeleteRow={() => onDeleteChats(row.tabs.map((t) => t.id))}
              />
            );
          })}

          {archivedChats.length > 0 && (
            <ArchivedSection
              count={archivedChats.length}
              chats={archivedChats}
              activeChatId={activeChatId}
              onSelectChat={onSelectChat}
              onDeleteChat={(id) => onDeleteChats([id])}
            />
          )}
        </div>
      )}
    </div>
  );
}

function ArchivedSection({
  count,
  chats,
  activeChatId,
  onSelectChat,
  onDeleteChat,
}: {
  count: number;
  chats: HubChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);

  const handleUnarchive = async (id: string) => {
    await hubChatUpdate(id, { archived: false });
    await refreshHubChats();
  };

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 px-3 py-1 text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Archived ({count})
      </button>
      {expanded && (
        <div className="opacity-50">
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`group/archived flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer ${
                activeChatId === chat.id
                  ? 'bg-revival-accent-400/10 text-neutral-900 dark:text-neutral-100'
                  : 'text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800'
              }`}
              onClick={() => onSelectChat(chat.id)}
            >
              <span className="min-w-0 flex-1 truncate text-xs">{chat.title}</span>
              <span className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/archived:opacity-100 transition-opacity">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleUnarchive(chat.id); }}
                  className="flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                  aria-label="Restore"
                >
                  <RotateCcw className="h-2.5 w-2.5" />
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteChat(chat.id); }}
                  className="flex h-4 w-4 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-status-danger dark:hover:bg-neutral-700"
                  aria-label="Delete"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
