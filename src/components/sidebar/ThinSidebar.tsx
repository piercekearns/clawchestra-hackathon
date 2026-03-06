import { useState, type ComponentType, type ReactNode } from 'react';
import React from 'react';
import { createPortal } from 'react-dom';
import { Github, MessageSquare, Monitor, Moon, Palette, Plus, RefreshCcw, Search, Settings, Sun } from 'lucide-react';
import type { ThemePreference } from '../../lib/schema';
import { useDashboardStore } from '../../lib/store';
import { Tooltip } from '../Tooltip';

interface ThinSidebarProps {
  onSearch: () => void;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenSync: () => void;
  onOpenSettings: () => void;
  onToggleHub: () => void;
  hubButtonRef?: React.Ref<HTMLDivElement>;
  syncBadgeCount?: number;
  hubUnreadCount?: number;
}

const THIN_SIDEBAR_WIDTH = 44;

export function ThinSidebar({
  onSearch,
  onAddProject,
  onRefresh,
  onOpenSync,
  onOpenSettings,
  onToggleHub,
  hubButtonRef,
  syncBadgeCount = 0,
  hubUnreadCount = 0,
}: ThinSidebarProps) {
  const themePreference = useDashboardStore((s) => s.themePreference);
  const setThemePreference = useDashboardStore((s) => s.setThemePreference);
  const hasSyncBadge = syncBadgeCount > 0;
  const hasHubBadge = hubUnreadCount > 0;

  return (
    <aside
      className="flex shrink-0 flex-col items-center justify-between border-r border-neutral-200 py-3 dark:border-neutral-700"
      style={{ width: THIN_SIDEBAR_WIDTH }}
      aria-label="Thin sidebar"
    >
      <div className="mt-1 flex flex-col items-center gap-1.5">
        <ThinSidebarButton
          icon={Search}
          label={
            <span className="inline-flex items-center gap-1">
              Search Projects
              <span className="text-[10px] text-neutral-400">⌘K</span>
            </span>
          }
          onClick={onSearch}
          ariaLabel="Search projects and roadmaps"
        />
        <ThinSidebarButton
          icon={Plus}
          label="Add Project"
          onClick={onAddProject}
          ariaLabel="Add project"
          iconClassName="h-5 w-5"
        />
        <ThinSidebarButton
          icon={RefreshCcw}
          label="Refresh"
          onClick={onRefresh}
          ariaLabel="Refresh Clawchestra"
        />
        <ThinSidebarButton
          icon={Github}
          label="Git Syncs"
          onClick={onOpenSync}
          ariaLabel="Manage Git Syncs"
          badgeCount={hasSyncBadge ? syncBadgeCount : undefined}
        />
        <ThinThemeButton
          themePreference={themePreference}
          onSetTheme={setThemePreference}
        />
        <div ref={hubButtonRef}>
          <ThinSidebarButton
            icon={MessageSquare}
            label="Conversations"
            onClick={onToggleHub}
            ariaLabel="Toggle conversations hub"
            badgeCount={hasHubBadge ? hubUnreadCount : undefined}
          />
        </div>
      </div>

      <div className="mb-[9px] flex flex-col items-center gap-2">
        <ThinSidebarButton
          icon={Settings}
          label="Settings"
          onClick={onOpenSettings}
          ariaLabel="Settings"
        />
      </div>
    </aside>
  );
}

function ThinSidebarButton({
  icon: Icon,
  label,
  onClick,
  badgeCount,
  ariaLabel,
  iconClassName,
}: {
  icon: ComponentType<{ className?: string }>;
  label: ReactNode;
  onClick: () => void;
  badgeCount?: number;
  ariaLabel: string;
  iconClassName?: string;
}) {
  return (
    <Tooltip text={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel}
        className="relative flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
      >
        <Icon className={iconClassName ?? 'h-4 w-4'} />
        {badgeCount && badgeCount > 0 ? (
          <span className="absolute right-[3px] top-px inline-flex h-3 min-w-3 items-center justify-center rounded-full bg-[#DFFF00] px-0.5 text-[8px] font-semibold text-neutral-900">
            {badgeCount}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}

const THEME_OPTIONS: { pref: ThemePreference; icon: ComponentType<{ className?: string }>; label: string }[] = [
  { pref: 'light', icon: Sun, label: 'Light' },
  { pref: 'dark', icon: Moon, label: 'Dark' },
  { pref: 'system', icon: Monitor, label: 'System' },
];

function ThinThemeButton({
  themePreference,
  onSetTheme,
}: {
  themePreference: ThemePreference;
  onSetTheme: (pref: ThemePreference) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (open) {
      setOpen(false);
    } else {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuPos({ top: rect.top, left: rect.right + 8 });
      setOpen(true);
    }
  };

  return (
    <>
      <Tooltip text="Theme">
        <button
          type="button"
          onClick={handleToggle}
          aria-label="Theme"
          className="relative flex h-7 w-7 items-center justify-center rounded-md text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-700 dark:hover:text-neutral-200"
        >
          <Palette className="h-4 w-4" />
        </button>
      </Tooltip>
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
            {THEME_OPTIONS.map(({ pref, icon: Icon, label }) => (
              <button
                key={pref}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSetTheme(pref);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  pref === themePreference
                    ? 'bg-neutral-200 text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100'
                    : 'text-neutral-700 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}
