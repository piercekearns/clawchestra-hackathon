import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { FolderPlus, MessageSquare } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import { hubChatCreate, hubChatUpdate, hubChatDelete } from '../../lib/tauri';
import type { HubChat, HubThread, HubAgentType } from '../../lib/hub-types';
import { AGENT_LABELS } from '../../lib/terminal-utils';
import { ThreadSection } from './ThreadSection';

interface HubNavProps {
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
}

export function HubNav({ onToast }: HubNavProps) {
  const projects = useDashboardStore((s) => s.projects);
  const hubChats = useDashboardStore((s) => s.hubChats);
  const hubCollapsedThreads = useDashboardStore((s) => s.hubCollapsedThreads);
  const hubActiveChatId = useDashboardStore((s) => s.hubActiveChatId);
  const hubThreadOrder = useDashboardStore((s) => s.hubThreadOrder);
  const customFolders = useDashboardStore((s) => s.customFolders);
  const setHubActiveChatId = useDashboardStore((s) => s.setHubActiveChatId);
  const setHubDrawerOpen = useDashboardStore((s) => s.setHubDrawerOpen);
  const toggleHubThread = useDashboardStore((s) => s.toggleHubThread);
  const setHubThreadOrder = useDashboardStore((s) => s.setHubThreadOrder);
  const addCustomFolder = useDashboardStore((s) => s.addCustomFolder);
  const renameCustomFolder = useDashboardStore((s) => s.renameCustomFolder);
  const deleteCustomFolder = useDashboardStore((s) => s.deleteCustomFolder);
  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);

  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  // Load chats on mount
  useEffect(() => {
    void refreshHubChats();
  }, [refreshHubChats]);

  // Build threads from chats + projects
  const threads: HubThread[] = useMemo(() => {
    const byProject = new Map<string, HubChat[]>();
    for (const chat of hubChats) {
      const existing = byProject.get(chat.projectId);
      if (existing) {
        existing.push(chat);
      } else {
        byProject.set(chat.projectId, [chat]);
      }
    }

    // Build a project title lookup from the projects tree
    const titleLookup = new Map<string, string>();
    const walk = (ps: typeof projects) => {
      for (const p of ps) {
        titleLookup.set(p.id, p.frontmatter?.title ?? p.id);
        if (p.children) walk(p.children);
      }
    };
    walk(projects);

    const result: HubThread[] = [];
    for (const [projectId, chats] of byProject) {
      // Sort: pinned first, then by lastActivity desc
      const sorted = [...chats].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.lastActivity - a.lastActivity;
      });
      result.push({
        projectId,
        projectTitle: titleLookup.get(projectId) ?? customFolders[projectId]?.name ?? projectId,
        chats: sorted,
      });
    }

    // Ensure custom folders appear even if they have no chats
    for (const [folderId, folder] of Object.entries(customFolders)) {
      if (!byProject.has(folderId)) {
        result.push({ projectId: folderId, projectTitle: folder.name, chats: [] });
      }
    }

    // Apply manual order if set, otherwise sort by most recent activity
    if (hubThreadOrder.length > 0) {
      const orderIndex = new Map(hubThreadOrder.map((id, i) => [id, i]));
      result.sort((a, b) => {
        const aIdx = orderIndex.get(a.projectId) ?? Number.MAX_SAFE_INTEGER;
        const bIdx = orderIndex.get(b.projectId) ?? Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        const aMax = Math.max(...a.chats.map((c) => c.lastActivity));
        const bMax = Math.max(...b.chats.map((c) => c.lastActivity));
        return bMax - aMax;
      });
    } else {
      result.sort((a, b) => {
        const aMax = Math.max(...a.chats.map((c) => c.lastActivity));
        const bMax = Math.max(...b.chats.map((c) => c.lastActivity));
        return bMax - aMax;
      });
    }

    return result;
  }, [hubChats, projects, hubThreadOrder, customFolders]);

  // Collect completed item IDs from projects' roadmap items
  const roadmapItems = useDashboardStore((s) => s.roadmapItems);
  const completedItemIds = useMemo(() => {
    const ids = new Set<string>();
    for (const projectItems of Object.values(roadmapItems)) {
      for (const item of projectItems) {
        if (item.status === 'complete') {
          ids.add(item.id);
        }
      }
    }
    return ids;
  }, [roadmapItems]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const ids = threads.map((t) => t.projectId);
      const oldIndex = ids.indexOf(active.id as string);
      const newIndex = ids.indexOf(over.id as string);
      if (oldIndex < 0 || newIndex < 0) return;
      const newOrder = arrayMove(ids, oldIndex, newIndex);
      setHubThreadOrder(newOrder);
    },
    [threads, setHubThreadOrder],
  );

  const handleSelectChat = (chatId: string) => {
    setHubActiveChatId(chatId);
    setHubDrawerOpen(true);
  };

  const handleTogglePinChat = async (chatId: string, pinned: boolean) => {
    await hubChatUpdate(chatId, { pinned });
    await refreshHubChats();
  };

  /** Archive multiple chats at once (row-level action). */
  const handleArchiveChats = async (chatIds: string[]) => {
    for (const id of chatIds) {
      await hubChatUpdate(id, { archived: true });
    }
    await refreshHubChats();
    // If the active chat was archived, close the drawer
    if (hubActiveChatId && chatIds.includes(hubActiveChatId)) {
      setHubActiveChatId(null);
      setHubDrawerOpen(false);
    }
    if (onToast && chatIds.length > 0) {
      const label = chatIds.length === 1 ? '1 chat archived' : `${chatIds.length} chats archived`;
      onToast('success', label, {
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
    }
  };

  /** Mark multiple chats as read (row-level action). */
  const handleMarkReadChats = async (chatIds: string[]) => {
    for (const id of chatIds) {
      const chat = hubChats.find((c) => c.id === id);
      if (chat?.unread) {
        await hubChatUpdate(id, { unread: false });
      }
    }
    await refreshHubChats();
  };

  /** Delete multiple chats at once (row-level action). */
  const handleDeleteChats = async (chatIds: string[]) => {
    for (const id of chatIds) {
      await hubChatDelete(id);
      useDashboardStore.getState().clearHubChatState(id);
    }
    if (hubActiveChatId && chatIds.includes(hubActiveChatId)) {
      setHubActiveChatId(null);
      setHubDrawerOpen(false);
    }
    await refreshHubChats();
  };

  const handleAddChat = async (projectId: string) => {
    const title = `New Chat ${new Date().toLocaleDateString()}`;
    const rowId = `custom-${Date.now()}`;
    const newChat = await hubChatCreate(
      projectId,
      rowId,
      'openclaw',
      null,
      title,
    );
    await refreshHubChats();
    if (hubCollapsedThreads.includes(projectId)) {
      toggleHubThread(projectId);
    }
    setHubActiveChatId(newChat.id);
    setHubDrawerOpen(true);
  };

  const handleAddTerminal = async (projectId: string, agentType: HubAgentType) => {
    const label = AGENT_LABELS[agentType] ?? agentType;
    const title = `${label} Terminal`;
    const rowId = `custom-${Date.now()}`;
    const newChat = await hubChatCreate(
      projectId,
      rowId,
      'terminal',
      agentType,
      title,
    );
    await refreshHubChats();
    if (hubCollapsedThreads.includes(projectId)) {
      toggleHubThread(projectId);
    }
    setHubActiveChatId(newChat.id);
    setHubDrawerOpen(true);
    const currentWidth = useDashboardStore.getState().hubDrawerWidth;
    if (currentWidth < 640) {
      useDashboardStore.getState().setHubDrawerWidth(640);
    }
  };

  const handleNewFolder = async () => {
    const id = `folder-${Date.now()}`;
    addCustomFolder(id, 'New Folder');
    const newChat = await hubChatCreate(id, null, 'openclaw', null, 'Chat');
    await refreshHubChats();
    // Place new folder at the bottom — use current thread order (or derive
    // from current activity-sorted list) and append the new id.
    const currentOrder = hubThreadOrder.length > 0
      ? hubThreadOrder
      : threads.map((t) => t.projectId);
    setHubThreadOrder([...currentOrder.filter((x) => x !== id), id]);
    if (hubCollapsedThreads.includes(id)) {
      toggleHubThread(id);
    }
    setHubActiveChatId(newChat.id);
    setHubDrawerOpen(true);
    setRenamingFolderId(id);
  };

  const handleDeleteFolder = async (folderId: string) => {
    const folderChats = hubChats.filter((c) => c.projectId === folderId);
    for (const chat of folderChats) {
      await hubChatDelete(chat.id);
      useDashboardStore.getState().clearHubChatState(chat.id);
    }
    deleteCustomFolder(folderId);
    if (hubActiveChatId && folderChats.some((c) => c.id === hubActiveChatId)) {
      setHubActiveChatId(null);
      setHubDrawerOpen(false);
    }
    await refreshHubChats();
  };

  const threadIds = useMemo(() => threads.map((t) => t.projectId), [threads]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pb-2 pt-5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          Conversations
        </span>
        <button
          type="button"
          onClick={() => void handleNewFolder()}
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
          aria-label="New folder"
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {threads.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
            <MessageSquare className="h-8 w-8 text-neutral-300 dark:text-neutral-600" />
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              No conversations yet
            </p>
            <p className="text-[11px] text-neutral-400 dark:text-neutral-500">
              Start a chat from any project or roadmap item card
            </p>
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={threadIds} strategy={verticalListSortingStrategy}>
              {threads.map((thread) => {
                const isCustom = thread.projectId in customFolders;
                return (
                  <ThreadSection
                    key={thread.projectId}
                    thread={thread}
                    collapsed={hubCollapsedThreads.includes(thread.projectId)}
                    activeChatId={hubActiveChatId}
                    completedItemIds={completedItemIds}
                    isCustomFolder={isCustom}
                    isRenaming={renamingFolderId === thread.projectId}
                    onRenameFolder={isCustom ? (name) => {
                      renameCustomFolder(thread.projectId, name);
                      setRenamingFolderId(null);
                    } : undefined}
                    onDeleteFolder={isCustom ? () => void handleDeleteFolder(thread.projectId) : undefined}
                    onToggle={() => toggleHubThread(thread.projectId)}
                    onSelectChat={handleSelectChat}
                    onTogglePinChat={handleTogglePinChat}
                    onArchiveChats={handleArchiveChats}
                    onMarkReadChats={handleMarkReadChats}
                    onDeleteChats={handleDeleteChats}
                    onAddChat={handleAddChat}
                    onAddTerminal={handleAddTerminal}
                  />
                );
              })}
            </SortableContext>
          </DndContext>
        )}

      </div>
    </div>
  );
}
