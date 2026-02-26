import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Check, MoreHorizontal, Pin } from 'lucide-react';
import type { HubChat } from '../../lib/hub-types';
import { InlineEdit } from './InlineEdit';

interface ChatEntryRowProps {
  chat: HubChat;
  isActive: boolean;
  isItemComplete?: boolean;
  onSelect: (chatId: string) => void;
  onRename: (chatId: string, newTitle: string) => void;
  onTogglePin: (chatId: string, pinned: boolean) => void;
  onArchive: (chatId: string) => void;
  onMarkUnread: (chatId: string) => void;
  onDelete: (chatId: string) => void;
}

export function ChatEntryRow({
  chat,
  isActive,
  isItemComplete = false,
  onSelect,
  onRename,
  onTogglePin,
  onArchive,
  onMarkUnread,
  onDelete,
}: ChatEntryRowProps) {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div
      className={`hub-row group relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-colors ${
        isActive
          ? 'bg-revival-accent-400/10 text-neutral-900 dark:text-neutral-100'
          : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
      } ${isItemComplete ? 'opacity-60' : ''}`}
      onClick={() => onSelect(chat.id)}
    >
      {/* Pin icon — aligned under the folder icon above */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin(chat.id, !chat.pinned);
        }}
        className={`flex h-5 w-5 shrink-0 items-center justify-center transition-opacity ${
          chat.pinned
            ? 'text-[#DFFF00] opacity-100'
            : 'opacity-0 group-hover:opacity-100 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200'
        }`}
        aria-label={chat.pinned ? 'Unpin' : 'Pin'}
      >
        <Pin className="h-3 w-3" />
      </button>

      {/* Chat name — on hover, reserve space for action icons so text clips */}
      <div className={`min-w-0 flex-1 flex items-center gap-1.5 ${isEditing ? '' : 'group-hover:pr-14'}`}>
        <InlineEdit
          value={chat.title}
          onSave={(newTitle) => onRename(chat.id, newTitle)}
          className={`block text-xs leading-tight ${isItemComplete ? 'line-through' : ''} ${chat.unread ? 'font-semibold text-neutral-900 dark:text-neutral-100' : ''}`}
          useScrollReveal
          onEditingChange={setIsEditing}
        />
        {chat.unread && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#DFFF00]" />
        )}
      </div>

      {isItemComplete && (
        <Check className="h-3 w-3 shrink-0 text-green-500" />
      )}

      {/* Right hover actions — ⋯ first, then archive; hidden during inline edit */}
      <div className={`absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-0.5 rounded-md px-0.5 transition-opacity ${
        isEditing ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'
      } ${
        isActive ? 'bg-neutral-200/80 dark:bg-neutral-700/80' : 'bg-neutral-100 dark:bg-neutral-800'
      }`}>
        <ChatEntryMenu
          chat={chat}
          onMarkUnread={() => onMarkUnread(chat.id)}
          onDelete={() => onDelete(chat.id)}
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onArchive(chat.id);
          }}
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          aria-label="Archive"
        >
          <Archive className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function ChatEntryMenu({
  chat,
  onMarkUnread,
  onDelete,
}: {
  chat: HubChat;
  onMarkUnread: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({ top: rect.bottom + 4, left: rect.right - 144 });
      setOpen(true);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={handleToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            handleToggle(e as unknown as React.MouseEvent);
          }
          if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className="flex h-5 w-5 items-center justify-center rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-label="More actions"
      >
        <MoreHorizontal className="h-3 w-3" />
      </button>
      {open && menuPos && createPortal(
        <>
          <div
            className="fixed inset-0 z-[200]"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed z-[200] w-36 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onMarkUnread();
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              {chat.unread ? 'Mark as read' : 'Mark as unread'}
            </button>
            <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
                setOpen(false);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-status-danger hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              Delete
            </button>
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
