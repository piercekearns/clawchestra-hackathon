import { cn } from '../../lib/utils';
import type { SearchResult } from './SearchModal';

interface SearchResultItemProps {
  result: SearchResult;
  isSelected: boolean;
  onClick: () => void;
}

const PROJECT_STATUS_COLORS: Record<string, string> = {
  'in-progress': 'bg-status-active/20 text-status-active',
  'up-next': 'bg-revival-accent/20 text-revival-accent-600 dark:text-revival-accent',
  'pending': 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  'dormant': 'bg-neutral-500/20 text-neutral-500',
  'archived': 'bg-neutral-400/20 text-neutral-500 dark:text-neutral-400',
};

const ROADMAP_STATUS_COLORS: Record<string, string> = {
  'pending': 'bg-neutral-500/20 text-neutral-500',
  'up-next': 'bg-revival-accent/20 text-revival-accent-600 dark:text-revival-accent',
  'in-progress': 'bg-blue-500/20 text-blue-600 dark:text-blue-400',
  'complete': 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
};

export function SearchResultItem({ result, isSelected, onClick }: SearchResultItemProps) {
  if (result.type === 'project') {
    const project = result.item;
    const statusColor = PROJECT_STATUS_COLORS[project.status] ?? PROJECT_STATUS_COLORS['dormant'];

    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800',
          isSelected && 'bg-neutral-100 dark:bg-neutral-800',
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-lg dark:bg-neutral-800">
          {project.frontmatter.icon || '📁'}
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
            {project.title}
          </div>
          {project.nextAction && (
            <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {project.nextAction}
            </div>
          )}
        </div>

        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor)}>
          {project.status}
        </span>
      </button>
    );
  }

  // Roadmap item
  const item = result.item;
  const statusColor = ROADMAP_STATUS_COLORS[item.status] ?? ROADMAP_STATUS_COLORS['pending'];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800',
        isSelected && 'bg-neutral-100 dark:bg-neutral-800',
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-lg dark:bg-neutral-800">
        {item.icon || '📋'}
      </span>

      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
          {item.title}
        </div>
        <div className="truncate text-xs text-neutral-500 dark:text-neutral-400">
          {item.nextAction ?? item.projectTitle}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full bg-indigo-500/15 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:text-indigo-400">
          deliverable
        </span>
        <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor)}>
          {item.status}
        </span>
      </div>
    </button>
  );
}
