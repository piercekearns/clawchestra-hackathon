import type { ComponentType, ReactNode } from 'react';
import { ArrowLeftRight, Github, Plus, RefreshCcw, Search, Settings } from 'lucide-react';
import { Tooltip } from '../Tooltip';

interface ThinSidebarProps {
  side: 'left' | 'right';
  onSearch: () => void;
  onAddProject: () => void;
  onRefresh: () => void;
  onOpenSync: () => void;
  onSwitchSide: () => void;
  onOpenSettings: () => void;
  syncBadgeCount?: number;
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
  syncBadgeCount = 0,
}: ThinSidebarProps) {
  const isRight = side === 'right';
  const switchLabel = 'Switch panel side';
  const hasSyncBadge = syncBadgeCount > 0;

  return (
    <aside
      className={`flex shrink-0 flex-col items-center justify-between border-neutral-200 bg-neutral-0/95 py-3 dark:border-neutral-700 dark:bg-neutral-950/90 ${
        isRight ? 'border-l' : 'border-r'
      }`}
      style={{ width: THIN_SIDEBAR_WIDTH }}
      aria-label="Thin sidebar"
    >
      <div className="mt-2 flex flex-col items-center gap-2">
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
        <ThinSidebarButton
          icon={ArrowLeftRight}
          label={switchLabel}
          onClick={onSwitchSide}
          ariaLabel={switchLabel}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
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
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <Icon className={iconClassName ?? 'h-4 w-4'} />
        {badgeCount && badgeCount > 0 ? (
          <span className="absolute right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[#DFFF00] px-1 text-[10px] font-semibold text-neutral-900">
            {badgeCount}
          </span>
        ) : null}
      </button>
    </Tooltip>
  );
}
