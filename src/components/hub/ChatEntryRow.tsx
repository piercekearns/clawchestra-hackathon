import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Home, MessageSquare, MoreHorizontal, Pin } from 'lucide-react';
import type { HubChat } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import { AgentIcon } from './AgentIcon';
import { InlineEdit } from './InlineEdit';

interface ChatEntryRowProps {
  chat: HubChat;
  isActive: boolean;
  isItemComplete?: boolean;
  /** When true, renders this row as the project-level root chat (special icon, no pin/archive) */
  isProjectChat?: boolean;
  /** When true, replaces the icon with animated activity dots */
  isBusy?: boolean;
  onSelect: (chatId: string) => void;
  onRename: (chatId: string, newTitle: string) => void;
  onTogglePin: (chatId: string, pinned: boolean) => void;
  onArchive: (chatId: string) => void;
  onMarkUnread: (chatId: string) => void;
  onDelete: (chatId: string) => void;
  onClearHistory?: (chatId: string) => void;
}

export function ChatEntryRow({
  chat,
  isActive,
  isItemComplete = false,
  isProjectChat = false,
  isBusy = false,
  onSelect,
  onRename,
  onTogglePin,
  onArchive,
  onMarkUnread,
  onDelete,
  onClearHistory,
}: ChatEntryRowProps) {
  const activeTerminals = useDashboardStore((s) => s.activeTerminalChatIds);
  const terminalStatusReady = useDashboardStore((s) => s.terminalStatusReady);
  const isDeadTerminal = terminalStatusReady && chat.type === 'terminal' && !chat.archived && !activeTerminals.has(chat.id);
  const activity = useDashboardStore((s) => s.terminalActivity[chat.id]);

  // Derived terminal activity states
  const isTerminalActive = chat.type === 'terminal' && !isDeadTerminal && !!activity?.isActive;
  const isTerminalActionRequired = chat.type === 'terminal' && !isDeadTerminal && !!activity?.actionRequired;
  const isTerminalUnread = chat.type === 'terminal' && !isDeadTerminal && !!activity
    && activity.lastOutputAt > activity.lastViewedAt;

  // Debounced active dots — 500ms enter delay, 2s exit delay to prevent flickering
  const [showActiveDots, setShowActiveDots] = useState(false);
  useEffect(() => {
    if (!isTerminalActive) {
      const timer = setTimeout(() => setShowActiveDots(false), 2000);
      return () => clearTimeout(timer);
    }
    const timer = setTimeout(() => setShowActiveDots(true), 500);
    return () => clearTimeout(timer);
  }, [isTerminalActive]);

  const [isEditing, setIsEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuPos({ top: e.clientY, left: e.clientX });
    setMenuOpen(true);
  };

  return (
    <div
      className={`hub-row group relative flex select-none items-center gap-2 rounded-md px-3 py-1.5 text-sm cursor-pointer transition-colors ${
        isActive
          ? 'bg-revival-accent-400/10 text-neutral-900 dark:text-neutral-100'
          : 'text-neutral-800 hover:bg-neutral-100 dark:text-neutral-100 dark:hover:bg-neutral-800'
      } ${isItemComplete ? 'opacity-60' : ''}`}
      onClick={() => onSelect(chat.id)}
      onContextMenu={handleContextMenu}
    >
      {/* Icon slot: busy dots → type icon with unread overlay */}
      {isBusy ? (
        <span className="flex h-5 w-5 shrink-0 items-center justify-center gap-[2px]">
          <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:0ms]" />
          <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:150ms]" />
          <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:300ms]" />
        </span>
      ) : isProjectChat ? (
        <span
          className="relative flex h-5 w-5 shrink-0 items-center justify-center text-revival-accent-400/80 dark:text-revival-accent-400/70"
          aria-label="Project chat"
        >
          <Home className="h-4 w-4" />
          {chat.unread && (
            <span className="absolute -top-px -right-0.5 h-2 w-2 rounded-full bg-[#DFFF00]" />
          )}
        </span>
      ) : chat.pinned ? (
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center text-[#DFFF00]">
          <Pin className="h-4 w-4" />
          {chat.unread && (
            <span className="absolute -top-px -right-0.5 h-2 w-2 rounded-full bg-[#DFFF00]" />
          )}
        </span>
      ) : chat.type === 'terminal' ? (
        showActiveDots ? (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center gap-[2px]">
            <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:0ms]" />
            <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:150ms]" />
            <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:300ms]" />
          </span>
        ) : (
          <span className={`relative flex h-5 w-5 shrink-0 items-center justify-center ${
            isDeadTerminal ? 'text-red-400' : 'text-neutral-400 dark:text-neutral-500'
          }`}>
            <AgentIcon agentType={chat.agentType} className="h-3.5 w-3.5" />
            {/* Suppress bubbles while terminal is active — dots will take over after 500ms delay */}
            {!isTerminalActive && isTerminalActionRequired ? (
              <span className="absolute -top-px -right-0.5 h-2 w-2 rounded-full bg-amber-400" />
            ) : !isTerminalActive && (isTerminalUnread || chat.unread) ? (
              <span className="absolute -top-px -right-0.5 h-2 w-2 rounded-full bg-[#DFFF00]" />
            ) : null}
          </span>
        )
      ) : (
        <span className="relative flex h-5 w-5 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500">
          <MessageSquare className="h-3.5 w-3.5" />
          {chat.unread && (
            <span className="absolute -top-px -right-0.5 h-2 w-2 rounded-full bg-[#DFFF00]" />
          )}
        </span>
      )}

      {/* Chat name — on hover, reserve space for ⋯ button so text clips */}
      <div className={`min-w-0 flex-1 flex items-center gap-1.5 ${isEditing ? '' : 'group-hover:pr-6'}`}>
        <InlineEdit
          value={chat.title}
          onSave={(newTitle) => onRename(chat.id, newTitle)}
          editable={!isProjectChat}
          className={`block text-sm leading-tight ${isItemComplete ? 'line-through' : ''} ${chat.unread ? 'font-semibold text-neutral-900 dark:text-neutral-100' : ''}`}
          useScrollReveal
          onEditingChange={setIsEditing}
        />
      </div>

      {isItemComplete && (
        <Check className="h-3 w-3 shrink-0 text-[#DFFF00]/70" />
      )}

      {/* Right hover action — single ⋯ menu with all actions */}
      <div className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-0.5 transition-opacity ${
        isEditing ? 'opacity-0 pointer-events-none' : 'opacity-0 group-hover:opacity-100'
      } ${
        isActive ? 'bg-neutral-200/80 dark:bg-neutral-700/80' : 'bg-neutral-100 dark:bg-neutral-800'
      }`}>
        <ChatEntryMenu
          chat={chat}
          isProjectChat={isProjectChat}
          open={menuOpen}
          menuPos={menuPos}
          onOpen={(pos) => { setMenuPos(pos); setMenuOpen(true); }}
          onClose={() => setMenuOpen(false)}
          onTogglePin={() => onTogglePin(chat.id, !chat.pinned)}
          onArchive={() => onArchive(chat.id)}
          onMarkUnread={() => onMarkUnread(chat.id)}
          onDelete={() => onDelete(chat.id)}
          onClearHistory={onClearHistory ? () => onClearHistory(chat.id) : undefined}
        />
      </div>
    </div>
  );
}

function ChatEntryMenu({
  chat,
  isProjectChat,
  open,
  menuPos,
  onOpen,
  onClose,
  onTogglePin,
  onArchive,
  onMarkUnread,
  onDelete,
  onClearHistory,
}: {
  chat: HubChat;
  isProjectChat?: boolean;
  open: boolean;
  menuPos: { top: number; left: number } | null;
  onOpen: (pos: { top: number; left: number }) => void;
  onClose: () => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onMarkUnread: () => void;
  onDelete: () => void;
  onClearHistory?: () => void;
}) {
  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      onClose();
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      onOpen({ top: rect.bottom + 4, left: rect.right - 144 });
    }
  };

  const menuItem = (label: string, action: () => void, danger = false) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        action();
        onClose();
      }}
      className={`w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
        danger
          ? 'text-status-danger'
          : 'text-neutral-700 dark:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );

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
            onClose();
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
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          />
          <div
            className="fixed z-[200] w-36 rounded-md border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
            style={{ top: menuPos.top, left: menuPos.left }}
          >
            {!isProjectChat && menuItem(chat.pinned ? 'Unpin' : 'Pin', onTogglePin)}
            {menuItem(chat.unread ? 'Mark as read' : 'Mark as unread', onMarkUnread)}
            {!isProjectChat && menuItem('Archive', onArchive)}
            {isProjectChat && onClearHistory && menuItem('Clear history', onClearHistory)}
            {!isProjectChat && (
              <>
                <div className="my-1 border-t border-neutral-200 dark:border-neutral-700" />
                {menuItem('Delete', onDelete, true)}
              </>
            )}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
