import { cn } from '../../lib/utils';
import type { ProjectViewModel } from '../../lib/schema';

interface SearchResultItemProps {
  project: ProjectViewModel;
  isSelected: boolean;
  onClick: () => void;
}

const STATUS_COLORS: Record<string, string> = {
  'in-flight': 'bg-status-active/20 text-status-active',
  'up-next': 'bg-revival-accent/20 text-revival-accent-600 dark:text-revival-accent',
  'simmering': 'bg-amber-500/20 text-amber-600 dark:text-amber-400',
  'dormant': 'bg-neutral-500/20 text-neutral-500',
  'shipped': 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400',
};

export function SearchResultItem({ project, isSelected, onClick }: SearchResultItemProps) {
  const statusColor = STATUS_COLORS[project.status] ?? STATUS_COLORS['dormant'];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800',
        isSelected && 'bg-neutral-100 dark:bg-neutral-800',
      )}
    >
      {/* Icon/Emoji */}
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-lg dark:bg-neutral-800">
        {project.frontmatter.icon || '📁'}
      </span>

      {/* Title + Next Action */}
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

      {/* Status Badge */}
      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium', statusColor)}>
        {project.status}
      </span>

      {/* Priority */}
      {project.frontmatter.priority && (
        <span className="shrink-0 text-xs text-neutral-400 dark:text-neutral-500">
          P{project.frontmatter.priority}
        </span>
      )}
    </button>
  );
}
