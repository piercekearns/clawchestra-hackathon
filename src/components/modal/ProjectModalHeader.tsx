import { AlertTriangle, X } from 'lucide-react';
import type { ProjectViewModel } from '../../lib/schema';
import { PROJECT_STATUSES, type ProjectStatus } from '../../lib/constants';
import type { BadgeProps } from '../ui/badge';
import { StatusBadge } from './StatusBadge';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const PROJECT_STATUS_LABELS: Partial<Record<ProjectStatus, string>> = {
  'in-progress': 'In Progress',
  'up-next': 'Up Next',
  pending: 'Pending',
  dormant: 'Dormant',
  archived: 'Archived',
};

function projectStatusVariant(status: ProjectStatus): BadgeVariant {
  switch (status) {
    case 'in-progress':
      return 'accent';
    case 'up-next':
      return 'success';
    case 'pending':
      return 'warning';
    case 'dormant':
    case 'archived':
      return 'outline';
  }
}

interface ProjectModalHeaderProps {
  project: ProjectViewModel;
  localStatus: ProjectStatus;
  onStatusChange: (status: ProjectStatus) => void;
  onClose: () => void;
  showClose?: boolean;
}

export function ProjectModalHeader({
  project,
  localStatus,
  onStatusChange,
  onClose,
  showClose = true,
}: ProjectModalHeaderProps) {
  return (
    <div className="mb-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0 flex items-center gap-1.5">
            <h2 className="truncate text-xl font-semibold text-neutral-900 dark:text-neutral-100">
              {project.title}
            </h2>
            {project.icon && (
              <span className="shrink-0 text-lg" aria-hidden="true">{project.icon}</span>
            )}
          </div>
          <StatusBadge<ProjectStatus>
            value={localStatus}
            options={PROJECT_STATUSES}
            labels={PROJECT_STATUS_LABELS}
            variant={projectStatusVariant}
            onChange={onStatusChange}
          />
        </div>
        {showClose ? (
          <button
            type="button"
            className="shrink-0 rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-300"
            onClick={onClose}
            aria-label="Close modal"
          >
            <X className="h-5 w-5" />
          </button>
        ) : null}
      </div>

      {project.blockedBy && (
        <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-status-warning/40 bg-status-warning/10 px-3 py-1.5 text-sm text-status-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>Blocked by: {project.blockedBy}</span>
        </div>
      )}
    </div>
  );
}
