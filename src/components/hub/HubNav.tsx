import { useCallback, useEffect, useMemo } from 'react';
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
import { MessageSquare } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import { hubChatCreate, hubChatUpdate, hubChatDelete, hubChatMessagesClear } from '../../lib/tauri';
import type { HubChat, HubThread } from '../../lib/hub-types';
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
  const setHubActiveChatId = useDashboardStore((s) => s.setHubActiveChatId);
  const setHubDrawerOpen = useDashboardStore((s) => s.setHubDrawerOpen);
  const toggleHubThread = useDashboardStore((s) => s.toggleHubThread);
  const setHubThreadOrder = useDashboardStore((s) => s.setHubThreadOrder);
  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);

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
        projectTitle: titleLookup.get(projectId) ?? projectId,
        chats: sorted,
      });
    }

    // Apply manual order if set, otherwise sort by most recent activity
    if (hubThreadOrder.length > 0) {
      const orderIndex = new Map(hubThreadOrder.map((id, i) => [id, i]));
      result.sort((a, b) => {
        const aIdx = orderIndex.get(a.projectId) ?? Number.MAX_SAFE_INTEGER;
        const bIdx = orderIndex.get(b.projectId) ?? Number.MAX_SAFE_INTEGER;
        if (aIdx !== bIdx) return aIdx - bIdx;
        // Both unordered — fall back to activity
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
  }, [hubChats, projects, hubThreadOrder]);

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

  const handleRenameChat = async (chatId: string, newTitle: string) => {
    await hubChatUpdate(chatId, { title: newTitle });
    await refreshHubChats();
  };

  const handleTogglePinChat = async (chatId: string, pinned: boolean) => {
    await hubChatUpdate(chatId, { pinned });
    await refreshHubChats();
  };

  const handleArchiveChat = async (chatId: string) => {
    const chat = hubChats.find((c) => c.id === chatId);
    await hubChatUpdate(chatId, { archived: true });
    await refreshHubChats();
    if (onToast && chat) {
      onToast('success', `"${chat.title}" archived`, {
        label: 'Undo',
        onClick: () => {
          void hubChatUpdate(chatId, { archived: false }).then(() => refreshHubChats());
        },
      });
    }
  };

  const handleMarkUnreadChat = async (chatId: string) => {
    const chat = hubChats.find((c) => c.id === chatId);
    if (!chat) return;
    await hubChatUpdate(chatId, { unread: !chat.unread });
    await refreshHubChats();
  };

  const handleDeleteChat = async (chatId: string) => {
    await hubChatDelete(chatId);
    // Clean up transient store state for the deleted chat (prevents memory leaks)
    useDashboardStore.getState().clearHubChatState(chatId);
    if (hubActiveChatId === chatId) {
      setHubActiveChatId(null);
      setHubDrawerOpen(false);
    }
    await refreshHubChats();
  };

  const handleClearHistory = async (chatId: string) => {
    useDashboardStore.getState().setHubChatMessages(chatId, []);
    await hubChatMessagesClear(chatId);
    await hubChatUpdate(chatId, { messageCount: 0 });
    await refreshHubChats();
  };

  const handleAddChat = async (projectId: string) => {
    const title = `New Chat ${new Date().toLocaleDateString()}`;
    const newChat = await hubChatCreate(
      projectId,
      null,
      'openclaw',
      null,
      title,
    );
    await refreshHubChats();
    // Expand the thread if it's collapsed
    if (hubCollapsedThreads.includes(projectId)) {
      toggleHubThread(projectId);
    }
    setHubActiveChatId(newChat.id);
    setHubDrawerOpen(true);
  };

  const threadIds = useMemo(() => threads.map((t) => t.projectId), [threads]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-1.5 px-5 pb-2 pt-5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400 dark:text-neutral-500">
          Conversations
        </span>
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
              {threads.map((thread) => (
                <ThreadSection
                  key={thread.projectId}
                  thread={thread}
                  collapsed={hubCollapsedThreads.includes(thread.projectId)}
                  activeChatId={hubActiveChatId}
                  completedItemIds={completedItemIds}
                  onToggle={() => toggleHubThread(thread.projectId)}
                  onSelectChat={handleSelectChat}
                  onRenameChat={handleRenameChat}
                  onTogglePinChat={handleTogglePinChat}
                  onArchiveChat={handleArchiveChat}
                  onMarkUnreadChat={handleMarkUnreadChat}
                  onDeleteChat={handleDeleteChat}
                  onClearHistory={handleClearHistory}
                  onAddChat={handleAddChat}
                />
              ))}
            </SortableContext>
          </DndContext>
        )}
      </div>
    </div>
  );
}
