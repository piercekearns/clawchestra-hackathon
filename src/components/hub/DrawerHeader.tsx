import { useState } from 'react';
import { Archive, ExternalLink, MoreHorizontal, Pin, PenLine, X } from 'lucide-react';
import type { HubChat } from '../../lib/hub-types';
import { hubChatUpdate } from '../../lib/tauri';
import { useDashboardStore } from '../../lib/store';

interface DrawerHeaderProps {
  chat: HubChat;
  projectTitle: string;
  onClose: () => void;
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
  onOpenLinkedItem?: (projectId: string, projectTitle: string, itemId: string) => void;
}

export function DrawerHeader({ chat, projectTitle, onClose, onToast, onOpenLinkedItem }: DrawerHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);

  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);

  const handleTogglePin = async () => {
    setMenuOpen(false);
    try {
      await hubChatUpdate(chat.id, { pinned: !chat.pinned });
      await refreshHubChats();
    } catch (err) {
      console.error('[DrawerHeader] Pin toggle failed:', err);
    }
  };

  const handleArchive = async () => {
    setMenuOpen(false);
    try {
      await hubChatUpdate(chat.id, { archived: true });
      await refreshHubChats();
      if (onToast) {
        onToast('success', `"${chat.title}" archived`, {
          label: 'Undo',
          onClick: () => {
            void hubChatUpdate(chat.id, { archived: false }).then(() => refreshHubChats());
          },
        });
      }
    } catch (err) {
      console.error('[DrawerHeader] Archive failed:', err);
    }
  };

  const handleRenameStart = () => {
    setMenuOpen(false);
    setRenameValue(chat.title);
    setRenaming(true);
  };

  const handleRenameSubmit = async () => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== chat.title) {
      await hubChatUpdate(chat.id, { title: trimmed });
      await refreshHubChats();
    }
    setRenaming(false);
  };

  const handleOpenLinkedItem = () => {
    setMenuOpen(false);
    if (chat.itemId && onOpenLinkedItem) {
      onOpenLinkedItem(chat.projectId, projectTitle, chat.itemId);
    }
  };

  return (
    <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-700 md:px-6">
      <div className="min-w-0 flex-1">
        {renaming ? (
          <input
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={() => void handleRenameSubmit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleRenameSubmit();
              if (e.key === 'Escape') setRenaming(false);
            }}
            autoFocus
            className="w-full rounded border border-neutral-300 bg-transparent px-1.5 py-0.5 text-sm font-medium text-neutral-800 outline-none focus:border-revival-accent-400/60 dark:border-neutral-600 dark:text-neutral-200"
          />
        ) : (
          <>
            <div className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200">
              {chat.isProjectRoot ? projectTitle : chat.title}
            </div>
            {!chat.isProjectRoot && (
              <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                {projectTitle}
              </div>
            )}
          </>
        )}
      </div>
      {/* ⋯ menu */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
          aria-label="Chat actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-50" onClick={() => setMenuOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
              {!chat.isProjectRoot && <MenuButton icon={PenLine} label="Rename" onClick={handleRenameStart} />}
              {!chat.isProjectRoot && <MenuButton
                icon={Pin}
                label={chat.pinned ? 'Unpin' : 'Pin'}
                onClick={() => void handleTogglePin()}
              />}
              {!chat.isProjectRoot && <MenuButton icon={Archive} label="Archive" onClick={() => void handleArchive()} />}
              {chat.itemId && onOpenLinkedItem && (
                <>
                  <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                  <MenuButton icon={ExternalLink} label="Open linked item" onClick={handleOpenLinkedItem} />
                </>
              )}
            </div>
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-label="Close chat drawer"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function MenuButton({ icon: Icon, label, onClick }: { icon: typeof Pin; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}
