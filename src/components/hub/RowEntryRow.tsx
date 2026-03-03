import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Home, MessageSquare, MoreHorizontal, Pin } from 'lucide-react';
import type { HubChat, HubRow } from '../../lib/hub-types';
import { useDashboardStore } from '../../lib/store';
import type { TerminalActivityEntry } from '../../lib/store';
import { ScrollRevealText } from './ScrollRevealText';

/** Compute aggregate activity priority for a row's tabs: 1=action-required, 2=unread, 3=active, 4=idle */
function getRowActivity(
  tabs: HubChat[],
  terminalActivity: Record<string, TerminalActivityEntry>,
  busyChatIds: Set<string>,
): 1 | 2 | 3 | 4 {
  let hasActionRequired = false;
  let hasUnread = false;
  let hasActive = false;

  for (const tab of tabs) {
    if (busyChatIds.has(tab.id)) hasActive = true;
    if (tab.unread) hasUnread = true;
    if (tab.type === 'terminal') {
      const a = terminalActivity[tab.id];
      if (a?.actionRequired) hasActionRequired = true;
      if (a && a.lastOutputAt > a.lastViewedAt) hasUnread = true;
      if (a?.isActive) hasActive = true;
    }
  }

  if (hasActionRequired) return 1;
  if (hasUnread) return 2;
  if (hasActive) return 3;
  return 4;
}

interface RowEntryRowProps {
  row: HubRow;
  isActive: boolean;
  isItemComplete?: boolean;
  onSelect: () => void;
  onRenameRow: (title: string) => void;
  onTogglePinRow: () => void;
  onArchiveRow: () => void;
  onMarkReadRow: () => void;
  onDeleteRow: () => void;
}

export function RowEntryRow({
  row,
  isActive,
  isItemComplete = false,
  onSelect,
  onRenameRow,
  onTogglePinRow,
  onArchiveRow,
  onMarkReadRow,
  onDeleteRow,
}: RowEntryRowProps) {
  const terminalActivity = useDashboardStore((s) => s.terminalActivity);
  const busyChatIds = useDashboardStore((s) => s.hubBusyChatIds);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const activity = getRowActivity(row.tabs, terminalActivity, busyChatIds);
  const isPinned = row.tabs.some((t) => t.pinned);
  const hasUnread = activity <= 2;
  const tabCount = row.tabs.length;

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
      onClick={onSelect}
      onContextMenu={handleContextMenu}
    >
      {/* Icon slot: activity indicator or default icon */}
      <RowIcon activity={activity} isProjectSurface={row.isProjectSurface} isPinned={isPinned} />

      {/* Row title + tab count badge */}
      <div className="min-w-0 flex-1 group-hover:pr-6">
        <div className="flex items-center gap-1.5">
          <ScrollRevealText
            text={row.title}
            className={`text-sm leading-tight ${hasUnread ? 'font-semibold text-neutral-900 dark:text-neutral-100' : ''} ${isItemComplete ? 'line-through' : ''}`}
          />
          {tabCount > 1 && (
            <span className="shrink-0 rounded-full bg-neutral-200 px-1.5 text-[10px] font-medium leading-4 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-400">
              {tabCount}
            </span>
          )}
        </div>
      </div>

      {isItemComplete && (
        <Check className="h-3 w-3 shrink-0 text-[#DFFF00]/70" />
      )}

      {/* Context menu trigger on hover */}
      <div className={`absolute right-1 top-1/2 -translate-y-1/2 rounded-md px-0.5 transition-opacity opacity-0 group-hover:opacity-100 ${
        isActive ? 'bg-neutral-200/80 dark:bg-neutral-700/80' : 'bg-neutral-100 dark:bg-neutral-800'
      }`}>
        <RowContextMenu
          row={row}
          isPinned={isPinned}
          open={menuOpen}
          menuPos={menuPos}
          onOpen={(pos) => { setMenuPos(pos); setMenuOpen(true); }}
          onClose={() => setMenuOpen(false)}
          onRename={onRenameRow}
          onTogglePin={onTogglePinRow}
          onArchive={onArchiveRow}
          onMarkRead={onMarkReadRow}
          onDelete={onDeleteRow}
        />
      </div>
    </div>
  );
}

function RowIcon({ activity, isProjectSurface, isPinned }: { activity: 1 | 2 | 3 | 4; isProjectSurface: boolean; isPinned: boolean }) {
  if (activity === 1) {
    // Action required — amber dot
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
      </span>
    );
  }
  if (activity === 2) {
    // Unread — yellow dot
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center">
        <span className="h-2 w-2 rounded-full bg-[#DFFF00]" />
      </span>
    );
  }
  if (activity === 3) {
    // Active — animated dots
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center gap-[2px]">
        <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:0ms]" />
        <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:150ms]" />
        <span className="h-1 w-1 rounded-full bg-revival-accent-400 animate-dotBounce [animation-delay:300ms]" />
      </span>
    );
  }
  // Idle — default icon
  if (isProjectSurface) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-revival-accent-400/80 dark:text-revival-accent-400/70">
        <Home className="h-4 w-4" />
      </span>
    );
  }
  if (isPinned) {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center text-[#DFFF00]">
        <Pin className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center text-neutral-400 dark:text-neutral-500">
      <MessageSquare className="h-3.5 w-3.5" />
    </span>
  );
}

function RowContextMenu({
  row,
  isPinned,
  open,
  menuPos,
  onOpen,
  onClose,
  onRename,
  onTogglePin,
  onArchive,
  onMarkRead,
  onDelete,
}: {
  row: HubRow;
  isPinned: boolean;
  open: boolean;
  menuPos: { top: number; left: number } | null;
  onOpen: (pos: { top: number; left: number }) => void;
  onClose: () => void;
  onRename: (title: string) => void;
  onTogglePin: () => void;
  onArchive: () => void;
  onMarkRead: () => void;
  onDelete: () => void;
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
        danger ? 'text-status-danger' : 'text-neutral-700 dark:text-neutral-300'
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
            {!row.isProjectSurface && menuItem(isPinned ? 'Unpin' : 'Pin', onTogglePin)}
            {menuItem('Mark as read', onMarkRead)}
            {!row.isProjectSurface && menuItem('Archive', onArchive)}
            {!row.isProjectSurface && (
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
