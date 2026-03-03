import { useMemo, useState } from 'react';
import { Archive, Check, ChevronDown, ChevronUp, CircleX, ExternalLink, MoreHorizontal, Pin, PenLine, X } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import type { HubChat } from '../../lib/hub-types';
import { hubChatUpdate, tmuxKillSession } from '../../lib/tauri';
import { useDashboardStore } from '../../lib/store';
import { tmuxSessionName, AGENT_LABELS } from '../../lib/terminal-utils';
import { hasTerminalSpawnGrace } from '../../lib/terminal-activity';

interface DrawerHeaderProps {
  chat: HubChat;
  projectTitle: string;
  /** Row-level title (item title for item rows, project title for project rows). */
  rowTitle?: string;
  onClose: () => void;
  onToast?: (kind: 'success' | 'error', message: string, action?: { label: string; onClick: () => void }) => void;
  onOpenLinkedItem?: (projectId: string, projectTitle: string, itemId: string) => void;
  onOpenLinkedProject?: (projectId: string, projectTitle: string) => void;
  /** Callback to restart a dead terminal session (remounts TerminalShell). */
  onRestart?: () => void;
  canCycleUp?: boolean;
  canCycleDown?: boolean;
  onCycleUp?: () => void;
  onCycleDown?: () => void;
}

export function DrawerHeader({ chat, projectTitle, rowTitle, onClose, onToast, onOpenLinkedItem, onOpenLinkedProject, onRestart, canCycleUp, canCycleDown, onCycleUp, onCycleDown }: DrawerHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(chat.title);
  const [confirmEndSession, setConfirmEndSession] = useState(false);

  const refreshHubChats = useDashboardStore((s) => s.refreshHubChats);
  const roadmapItems = useDashboardStore((s) => s.roadmapItems);
  const activeTerminals = useDashboardStore((s) => s.activeTerminalChatIds);
  const terminalStatusReady = useDashboardStore((s) => s.terminalStatusReady);

  const isTerminal = chat.type === 'terminal';
  const isRecentlyCreated = Date.now() - chat.createdAt < 60_000;
  const isDeadTerminal = terminalStatusReady && isTerminal && !chat.archived && !activeTerminals.has(chat.id) && !isRecentlyCreated && !hasTerminalSpawnGrace(chat.id);

  const isLinkedItemComplete = useMemo(() => {
    if (!chat.itemId) return false;
    const projectItems = roadmapItems[chat.projectId];
    if (!projectItems) return false;
    return projectItems.some((item) => item.id === chat.itemId && item.status === 'complete');
  }, [chat.itemId, chat.projectId, roadmapItems]);

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
    if (chat.itemId && onOpenLinkedItem) {
      onOpenLinkedItem(chat.projectId, projectTitle, chat.itemId);
    }
  };

  const handleEndSession = async () => {
    try {
      const sessionName = tmuxSessionName(chat.projectId, chat.id);
      await tmuxKillSession(sessionName);
    } catch {
      // tmux session may already be dead
    }
    await hubChatUpdate(chat.id, { archived: true });
    await refreshHubChats();
    setConfirmEndSession(false);
    onClose();
  };

  return (
    <>
    <div className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 dark:border-neutral-700 md:px-6">
      {/* Row cycle chevrons — left of title */}
      {(canCycleUp || canCycleDown) && (
        <div className="flex items-center gap-0.5">
          {canCycleUp && (
            <Tooltip text="Previous row">
              <button
                type="button"
                onClick={onCycleUp}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                aria-label="Previous row"
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
          {canCycleDown && (
            <Tooltip text="Next row">
              <button
                type="button"
                onClick={onCycleDown}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
                aria-label="Next row"
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      )}
      <div className="min-w-0 flex-1 flex flex-col justify-center min-h-9">
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
            <div
              className="truncate text-sm font-medium text-neutral-800 dark:text-neutral-200"
            >
              {rowTitle ?? (chat.isProjectRoot ? projectTitle : chat.title)}
            </div>
            {/* Subtitle: project name for non-project rows */}
            {(chat.itemId || (!chat.isProjectRoot && !rowTitle)) && (
              <div className="truncate text-[11px] text-neutral-500 dark:text-neutral-400">
                {projectTitle}
              </div>
            )}
          </>
        )}
      </div>
      {/* Terminal: End Session button — other chats: ⋯ menu */}
      {isTerminal ? (
        <div className="relative">
          {confirmEndSession ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-neutral-500 dark:text-neutral-400">End?</span>
              <button
                type="button"
                onClick={() => void handleEndSession()}
                className="rounded px-1.5 py-0.5 text-[11px] font-medium text-red-500 hover:bg-red-500/10"
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => setConfirmEndSession(false)}
                className="rounded px-1.5 py-0.5 text-[11px] text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                No
              </button>
            </div>
          ) : (
            <Tooltip text="End terminal session">
              <button
                type="button"
                onClick={() => setConfirmEndSession(true)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-red-400 transition-colors hover:bg-red-500/10 hover:text-red-500"
                aria-label="End session"
              >
                <div className="h-3 w-3 rounded-sm bg-current" />
              </button>
            </Tooltip>
          )}
        </div>
      ) : !chat.isProjectRoot ? (
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
                <MenuButton icon={PenLine} label="Rename" onClick={handleRenameStart} />
                <MenuButton
                  icon={Pin}
                  label={chat.pinned ? 'Unpin' : 'Pin'}
                  onClick={() => void handleTogglePin()}
                />
                <MenuButton icon={Archive} label="Archive" onClick={() => void handleArchive()} />
              </div>
            </>
          )}
        </div>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        aria-label="Close chat drawer"
      >
        <X className="h-4 w-4" />
      </button>
      {chat.isProjectRoot && onOpenLinkedProject && (
        <Tooltip text="Open linked project">
          <button
            type="button"
            onClick={() => onOpenLinkedProject(chat.projectId, projectTitle)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            aria-label="Open linked project"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
      {chat.itemId && onOpenLinkedItem && (
        <Tooltip text="Open linked item">
          <button
            type="button"
            onClick={handleOpenLinkedItem}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-600 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
            aria-label="Open linked item"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </Tooltip>
      )}
    </div>
    {isLinkedItemComplete && (
      <div className="flex items-center gap-2 border-b border-[#DFFF00]/10 bg-[#DFFF00]/5 px-4 py-1.5 md:px-6">
        <Check className="h-3.5 w-3.5 shrink-0 text-[#DFFF00]/70" />
        <span className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">
          Roadmap item complete
        </span>
        <button
          type="button"
          onClick={() => void handleArchive()}
          className="rounded-full border border-[#DFFF00]/30 px-2 py-0.5 text-[11px] text-neutral-500 transition-colors hover:bg-[#DFFF00]/10 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
        >
          Archive chat
        </button>
      </div>
    )}
    {isDeadTerminal && (
      <div className="flex items-center gap-2 border-b border-red-500/10 bg-red-500/5 px-4 py-1.5 md:px-6">
        <CircleX className="h-3.5 w-3.5 shrink-0 text-red-400/70" />
        <span className="flex-1 text-xs text-neutral-500 dark:text-neutral-400">
          Session ended
        </span>
        {onRestart && (
          <button
            type="button"
            onClick={onRestart}
            className="rounded-full border border-red-500/30 px-2 py-0.5 text-[11px] text-neutral-500 transition-colors hover:bg-red-500/10 hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
          >
            Restart
          </button>
        )}
      </div>
    )}
    </>
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
