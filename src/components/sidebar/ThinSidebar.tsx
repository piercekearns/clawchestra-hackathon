import type { ComponentType, ReactNode } from 'react';
import React from 'react';
import { ArrowLeftRight, Github, MessageSquare, Plus, RefreshCcw, Search, Settings } from 'lucide-react';
import { Tooltip } from '../Tooltip';

interface ThinSidebarProps {
  side: 'left' | 'right';
  onSearch: () => void;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenSync: () => void;
  onSwitchSide: () => void;
  onOpenSettings: () => void;
  onToggleHub: () => void;
  hubButtonRef?: React.Ref<HTMLDivElement>;
  syncBadgeCount?: number;
  hubUnreadCount?: number;
}

const THIN_SIDEBAR_WIDTH = 44;

export function ThinSidebar({
  side,
  onSearch,
  onAddProject,
  onRefresh,
  onOpenSync,
  onSwitchSide,
  onOpenSettings,
  onToggleHub,
  hubButtonRef,
  syncBadgeCount = 0,
  hubUnreadCount = 0,
}: ThinSidebarProps) {
  const isRight = side === 'right';
  const switchLabel = 'Switch panel side';
  const hasSyncBadge = syncBadgeCount > 0;
  const hasHubBadge = hubUnreadCount > 0;

  return (
    <aside
      className={`flex shrink-0 flex-col items-center justify-between border-neutral-200 py-3 dark:border-neutral-700 ${
        isRight ? 'border-l' : 'border-r'
      }`}
      style={{ width: THIN_SIDEBAR_WIDTH }}
      aria-label="Thin sidebar"
    >
      <div className="mt-1 flex flex-col items-center gap-0.5">
        <ThinSidebarButton
          icon={Search}
          label={
            <span className="inline-flex items-center gap-1">
              Search projects
              <span className="text-[10px] text-neutral-400">⌘K</span>
            </span>
          }
          onClick={onSearch}
          ariaLabel="Search projects and roadmaps"
        />
        <ThinSidebarButton
          icon={Plus}
          label="Add project"
          onClick={onAddProject}
          ariaLabel="Add project"
          iconClassName="h-5 w-5"
        />
        <ThinSidebarButton
          icon={RefreshCcw}
          label="Refresh Clawchestra"
          onClick={onRefresh}
          ariaLabel="Refresh Clawchestra"
        />
        <ThinSidebarButton
          icon={Github}
          label="Manage Git Syncs"
          onClick={onOpenSync}
          ariaLabel="Manage Git Syncs"
          badgeCount={hasSyncBadge ? syncBadgeCount : undefined}
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
        <ThinSidebarButton
          icon={ArrowLeftRight}
          label={switchLabel}
          onClick={onSwitchSide}
          ariaLabel={switchLabel}
        />
      </div>

      <div className="mb-[5px] flex flex-col items-center gap-2">
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
