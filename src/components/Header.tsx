import { RefreshCcw } from 'lucide-react';
import { Input } from './ui/input';
import { ErrorBadge } from './ErrorBadge';
import type { DashboardError } from '../lib/errors';
import { Button } from './ui/button';

interface HeaderProps {
  errors: DashboardError[];
  onRefresh: () => Promise<void>;
  onAddProject: () => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  dirtyProjectCount: number;
  unresolvedSyncCount: number;
  onOpenSync: () => void;
}

export function Header({
  errors,
  onRefresh,
  onAddProject,
  searchQuery,
  onSearchQueryChange,
  dirtyProjectCount,
  unresolvedSyncCount,
  onOpenSync,
}: HeaderProps) {
  return (
    <header className="mb-4 rounded-2xl border border-neutral-200 bg-neutral-0/95 p-4 backdrop-blur dark:border-neutral-700 dark:bg-neutral-950/95">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            value={searchQuery}
            onChange={(event) => onSearchQueryChange(event.target.value)}
            placeholder="Search by title, id, tag, next action..."
            className="pr-14"
          />
          <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 select-none rounded border border-neutral-300 bg-neutral-100 px-1.5 py-0.5 text-[11px] font-medium tracking-wide text-neutral-500 dark:border-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            ⌘ + K
          </kbd>
        </div>

        <ErrorBadge errors={errors} />

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onRefresh()}
          className="inline-flex items-center gap-1"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </Button>

        {(dirtyProjectCount > 0 || unresolvedSyncCount > 0) && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onOpenSync}
            className="inline-flex items-center gap-1"
          >
            Git Sync
            <span className={`ml-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-bold ${
              unresolvedSyncCount > 0
                ? 'bg-red-500 text-white'
                : 'bg-orange-400 text-neutral-900'
            }`}>
              {unresolvedSyncCount > 0 ? unresolvedSyncCount : dirtyProjectCount}
            </span>
          </Button>
        )}

        <Button type="button" size="sm" onClick={onAddProject}>
          Add Project
        </Button>
      </div>
    </header>
  );
}
