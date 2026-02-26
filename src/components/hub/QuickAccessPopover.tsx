import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare } from 'lucide-react';
import { useDashboardStore } from '../../lib/store';
import type { HubChat } from '../../lib/hub-types';
import { ChatTypeIcon } from './ChatTypeIcon';

interface QuickAccessPopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>;
  onSelectChat: (chatId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function QuickAccessPopover({ anchorRef, onSelectChat }: QuickAccessPopoverProps) {
  const [visible, setVisible] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const hoverTimerRef = useRef<number | null>(null);
  const leaveTimerRef = useRef<number | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hubChats = useDashboardStore((s) => s.hubChats);
  const projects = useDashboardStore((s) => s.projects);

  // Build project title lookup
  const titleLookup = useMemo(() => {
    const map = new Map<string, string>();
    const walk = (ps: typeof projects) => {
      for (const p of ps) {
        map.set(p.id, p.frontmatter?.title ?? p.id);
        if (p.children) walk(p.children);
      }
    };
    walk(projects);
    return map;
  }, [projects]);

  // Top 5 entries: unread first, then most recent
  const entries = useMemo(() => {
    const active = hubChats.filter((c) => !c.archived);
    const unread = active.filter((c) => c.unread).sort((a, b) => b.lastActivity - a.lastActivity);
    const read = active.filter((c) => !c.unread).sort((a, b) => b.lastActivity - a.lastActivity);
    return [...unread, ...read].slice(0, 5);
  }, [hubChats]);

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({
      top: rect.top,
      left: rect.right + 8,
    });
  }, [anchorRef]);

  const show = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
    hoverTimerRef.current = window.setTimeout(() => {
      updatePosition();
      setVisible(true);
    }, 300);
  }, [updatePosition]);

  const hide = useCallback(() => {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    leaveTimerRef.current = window.setTimeout(() => {
      setVisible(false);
    }, 200);
  }, []);

  const cancelHide = useCallback(() => {
    if (leaveTimerRef.current) {
      clearTimeout(leaveTimerRef.current);
      leaveTimerRef.current = null;
    }
  }, []);

  // Attach hover listeners to the anchor element
  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    el.addEventListener('mouseenter', show);
    el.addEventListener('mouseleave', hide);
    return () => {
      el.removeEventListener('mouseenter', show);
      el.removeEventListener('mouseleave', hide);
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
      if (leaveTimerRef.current) clearTimeout(leaveTimerRef.current);
    };
  }, [anchorRef, show, hide]);

  if (!visible || !pos) return null;

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[100] w-64 rounded-lg border border-neutral-200 bg-white py-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
      style={{ top: pos.top, left: pos.left }}
      onMouseEnter={cancelHide}
      onMouseLeave={hide}
    >
      {entries.length === 0 ? (
        <div className="px-3 py-4 text-center">
          <MessageSquare className="mx-auto mb-1 h-5 w-5 text-neutral-300 dark:text-neutral-600" />
          <p className="text-xs text-neutral-500 dark:text-neutral-400">
            No chats yet
          </p>
          <p className="mt-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
            Open a project card to start one
          </p>
        </div>
      ) : (
        entries.map((chat) => (
          <button
            key={chat.id}
            type="button"
            onClick={() => {
              onSelectChat(chat.id);
              setVisible(false);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <ChatTypeIcon
              type={chat.type}
              agentType={chat.agentType}
              className="h-3.5 w-3.5 shrink-0 text-neutral-400"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="truncate text-xs font-medium text-neutral-800 dark:text-neutral-200">
                  {chat.title}
                </span>
                {chat.unread && (
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#DFFF00]" />
                )}
              </div>
              <div className="truncate text-[11px] text-neutral-400 dark:text-neutral-500">
                {titleLookup.get(chat.projectId) ?? chat.projectId}
              </div>
            </div>
            <span className="shrink-0 text-[10px] text-neutral-400 dark:text-neutral-500">
              {formatRelativeTime(chat.lastActivity)}
            </span>
          </button>
        ))
      )}
    </div>,
    document.body,
  );
}
