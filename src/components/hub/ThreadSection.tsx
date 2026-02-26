import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Folder, FolderOpen, MessageSquare, Plus, Terminal } from 'lucide-react';
import type { HubChat, HubThread } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { ChatEntryRow } from './ChatEntryRow';
import { ScrollRevealText } from './ScrollRevealText';

const MAX_VISIBLE_CHATS = 5;

interface ThreadSectionProps {
  thread: HubThread;
  collapsed: boolean;
  activeChatId: string | null;
  completedItemIds?: Set<string>;
  onToggle: () => void;
  onSelectChat: (chatId: string) => void;
  onRenameChat: (chatId: string, newTitle: string) => void;
  onTogglePinChat: (chatId: string, pinned: boolean) => void;
  onArchiveChat: (chatId: string) => void;
  onMarkUnreadChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onAddChat: (projectId: string) => void;
}

export function ThreadSection({
  thread,
  collapsed,
  activeChatId,
  completedItemIds,
  onToggle,
  onSelectChat,
  onRenameChat,
  onTogglePinChat,
  onArchiveChat,
  onMarkUnreadChat,
  onDeleteChat,
  onAddChat,
}: ThreadSectionProps) {
  const [showAll, setShowAll] = useState(false);
  const hubBusyChatIds = useDashboardStore((s) => s.hubBusyChatIds);
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

  // Project-level chat (itemId === null) always floats to the top, separate from pin sort
  const projectChat = thread.chats.find((c) => !c.itemId && !c.archived) ?? null;
  const restChats = thread.chats.filter((c) => c !== projectChat);

  const pinnedChats = restChats.filter((c) => c.pinned && !c.archived);
  const unpinnedChats = restChats.filter((c) => !c.pinned && !c.archived);
  const archivedChats = thread.chats.filter((c) => c.archived);

  const visibleUnpinned = showAll ? unpinnedChats : unpinnedChats.slice(0, MAX_VISIBLE_CHATS);
  const hiddenCount = unpinnedChats.length - visibleUnpinned.length;
  const allVisible = [...pinnedChats, ...visibleUnpinned];

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`mb-1 ${isDragging ? 'opacity-50' : ''}`}
    >
      {/* Thread header — drag handle lives here, not on the entire section */}
      <div
        className="hub-row group relative flex items-center gap-2 rounded-md px-3 py-1.5 cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800"
        onClick={onToggle}
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

        {/* Project name — on hover, reserve space for + button so text clips */}
        <div className="min-w-0 flex-1 group-hover:pr-8">
          <ScrollRevealText
            text={thread.projectTitle}
            className="text-sm font-semibold leading-tight text-neutral-800 dark:text-neutral-200"
          />
        </div>

        {/* Hover actions: + */}
        <div className="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md bg-neutral-100 px-0.5 opacity-0 group-hover:opacity-100 transition-opacity dark:bg-neutral-800">
          <TypePickerButton projectId={thread.projectId} onAddChat={onAddChat} />
        </div>
      </div>

      {/* Chat entries — NO indentation, same alignment as project header */}
      {!collapsed && (
        <div>
          {/* Project-level chat always first, with a persistent home icon */}
          {projectChat && (
            <ChatEntryRow
              key={projectChat.id}
              chat={projectChat}
              isActive={activeChatId === projectChat.id}
              isProjectChat
              isBusy={hubBusyChatIds.has(projectChat.id)}
              onSelect={onSelectChat}
              onRename={onRenameChat}
              onTogglePin={onTogglePinChat}
              onArchive={onArchiveChat}
              onMarkUnread={onMarkUnreadChat}
              onDelete={onDeleteChat}
            />
          )}
          {allVisible.map((chat) => (
            <ChatEntryRow
              key={chat.id}
              chat={chat}
              isActive={activeChatId === chat.id}
              isItemComplete={chat.itemId ? completedItemIds?.has(chat.itemId) : false}
              isBusy={hubBusyChatIds.has(chat.id)}
              onSelect={onSelectChat}
              onRename={onRenameChat}
              onTogglePin={onTogglePinChat}
              onArchive={onArchiveChat}
              onMarkUnread={onMarkUnreadChat}
              onDelete={onDeleteChat}
            />
          ))}

          {hiddenCount > 0 && !showAll && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="w-full px-3 py-1 text-left text-[11px] text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Show {hiddenCount} more...
            </button>
          )}
          {showAll && hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(false)}
              className="w-full px-3 py-1 text-left text-[11px] text-neutral-500 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
            >
              Show less
            </button>
          )}

          {archivedChats.length > 0 && (
            <ArchivedSection
              chats={archivedChats}
              activeChatId={activeChatId}
              onSelectChat={onSelectChat}
              onRenameChat={onRenameChat}
              onTogglePinChat={onTogglePinChat}
              onArchiveChat={onArchiveChat}
              onMarkUnreadChat={onMarkUnreadChat}
              onDeleteChat={onDeleteChat}
            />
          )}
        </div>
      )}
    </div>
  );
}

function TypePickerButton({ projectId, onAddChat }: { projectId: string; onAddChat: (projectId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 176 });
      setOpen(true);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-label="New chat"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && menuPos && createPortal(
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-[200] w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpen(false);
                onAddChat(projectId);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              OpenClaw Chat
            </button>
            <button
              type="button"
              disabled
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-400 dark:text-neutral-600 cursor-not-allowed"
            >
              <Terminal className="h-3.5 w-3.5" />
              <span>Terminal</span>
              <span className="ml-auto text-[10px] text-neutral-400 dark:text-neutral-600">Coming soon</span>
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}

function ArchivedSection({
  chats,
  activeChatId,
  onSelectChat,
  onRenameChat,
  onTogglePinChat,
  onArchiveChat,
  onMarkUnreadChat,
  onDeleteChat,
}: {
  chats: HubChat[];
  activeChatId: string | null;
  onSelectChat: (id: string) => void;
  onRenameChat: (id: string, title: string) => void;
  onTogglePinChat: (id: string, pinned: boolean) => void;
  onArchiveChat: (id: string) => void;
  onMarkUnreadChat: (id: string) => void;
  onDeleteChat: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const hubBusyChatIds = useDashboardStore((s) => s.hubBusyChatIds);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1 px-3 py-1 text-[11px] text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Archived ({chats.length})
      </button>
      {expanded && (
        <div className="opacity-50">
          {chats.map((chat) => (
            <ChatEntryRow
              key={chat.id}
              chat={chat}
              isActive={activeChatId === chat.id}
              isBusy={hubBusyChatIds.has(chat.id)}
              onSelect={onSelectChat}
              onRename={onRenameChat}
              onTogglePin={onTogglePinChat}
              onArchive={onArchiveChat}
              onMarkUnread={onMarkUnreadChat}
              onDelete={onDeleteChat}
            />
          ))}
        </div>
      )}
    </div>
  );
}
