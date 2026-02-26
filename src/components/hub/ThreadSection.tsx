import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ChevronDown, ChevronRight, Folder, FolderOpen, MessageSquare, MoreHorizontal, Plus, Terminal } from 'lucide-react';
import type { HubChat, HubChatType, HubThread } from '../../lib/hub-types';
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

  const pinnedChats = thread.chats.filter((c) => c.pinned && !c.archived);
  const unpinnedChats = thread.chats.filter((c) => !c.pinned && !c.archived);
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

        {/* Project name */}
        <div className="min-w-0 flex-1 pr-14">
          <ScrollRevealText
            text={thread.projectTitle}
            className="text-xs font-semibold leading-tight text-neutral-800 dark:text-neutral-200"
          />
        </div>

        {/* Hover actions: ⋯ and + */}
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
            }}
            className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            aria-label="Thread actions"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          <TypePickerButton projectId={thread.projectId} onAddChat={onAddChat} />
        </div>
      </div>

      {/* Chat entries — NO indentation, same alignment as project header */}
      {!collapsed && (
        <div>
          {allVisible.map((chat) => (
            <ChatEntryRow
              key={chat.id}
              chat={chat}
              isActive={activeChatId === chat.id}
              isItemComplete={chat.itemId ? completedItemIds?.has(chat.itemId) : false}
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

  return (
    <div className="relative">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-label="New chat"
      >
        <Plus className="h-3.5 w-3.5" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-50" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
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
        </>
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
