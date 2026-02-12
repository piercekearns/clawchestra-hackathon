import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import type { RoadmapItemWithDocs, RoadmapStatus } from '../../lib/schema';
import type { BadgeProps } from '../ui/badge';
import { StatusBadge } from './StatusBadge';
import { DocBadge } from './DocBadge';

type BadgeVariant = NonNullable<BadgeProps['variant']>;

const ROADMAP_STATUSES: readonly RoadmapStatus[] = [
  'pending',
  'in-progress',
  'complete',
] as const;

const ROADMAP_STATUS_LABELS: Partial<Record<RoadmapStatus, string>> = {
  'pending': 'Pending',
  'in-progress': 'In Progress',
  'complete': 'Complete',
};

function roadmapStatusVariant(status: RoadmapStatus): BadgeVariant {
  switch (status) {
    case 'pending':
      return 'outline';
    case 'in-progress':
      return 'accent';
    case 'complete':
      return 'success';
  }
}

interface RoadmapItemRowProps {
  item: RoadmapItemWithDocs;
  index: number;
  onStatusChange: (itemId: string, status: RoadmapStatus) => void;
  onItemClick: (item: RoadmapItemWithDocs) => void;
  onDocClick: (item: RoadmapItemWithDocs, docType: 'spec' | 'plan') => void;
}

export function RoadmapItemRow({
  item,
  index,
  onStatusChange,
  onItemClick,
  onDocClick,
}: RoadmapItemRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex flex-wrap items-center gap-2 rounded-lg border border-neutral-200 bg-neutral-50 px-2 py-2 transition-colors hover:border-revival-accent-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-revival-accent-400 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:border-revival-accent-400 sm:flex-nowrap"
      role="button"
      tabIndex={0}
      onClick={() => onItemClick(item)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onItemClick(item);
      }}
    >
      <button
        type="button"
        className="shrink-0 cursor-grab touch-none text-neutral-400 hover:text-neutral-600 active:cursor-grabbing dark:text-neutral-500 dark:hover:text-neutral-300"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">
        P{index + 1}
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
        {item.title}
      </span>

      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <StatusBadge<RoadmapStatus>
          value={item.status}
          options={ROADMAP_STATUSES}
          labels={ROADMAP_STATUS_LABELS}
          variant={roadmapStatusVariant}
          onChange={(next) => onStatusChange(item.id, next)}
        />
        {item.docs.spec && (
          <DocBadge type="spec" onClick={() => onDocClick(item, 'spec')} />
        )}
        {item.docs.plan && (
          <DocBadge type="plan" onClick={() => onDocClick(item, 'plan')} />
        )}
      </div>
    </div>
  );
}
