import type { ReactNode } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AlertTriangle } from 'lucide-react';
import type { BoardItem } from '../lib/schema';

interface CardProps<T extends BoardItem> {
  item: T;
  warning?: boolean;
  onClick: (item: T) => void;
  renderIndicators?: (item: T) => ReactNode;
  renderActions?: (item: T) => ReactNode;
  renderHoverActions?: (item: T) => ReactNode;
}

export function Card<T extends BoardItem>({
  item,
  warning,
  onClick,
  renderIndicators,
  renderActions,
  renderHoverActions,
}: CardProps<T>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  return (
    <article
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onClick(item)}
      className="group cursor-grab rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-neutral-900 shadow-sm outline-none transition hover:border-revival-accent-400 hover:bg-neutral-100 focus:outline-none focus-visible:outline-none active:cursor-grabbing dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-700"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 text-sm font-semibold leading-tight">
          <span>{item.title}</span>
          {item.icon ? <span className="ml-1 inline-block align-text-bottom">{item.icon}</span> : null}
        </h3>
        <div className="flex shrink-0 items-center gap-1">
          {renderIndicators ? renderIndicators(item) : null}
          {warning ? <AlertTriangle className="h-4 w-4 text-status-warning" /> : null}
          {item.priority !== undefined ? (
            <span className="rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">
              P{item.priority}
            </span>
          ) : null}
        </div>
      </div>

      <div className="space-y-1 text-xs text-neutral-600 dark:text-neutral-300">
        {renderHoverActions ? (
          <div className="relative min-h-[1.75rem]">
            <div className="transition-opacity duration-150 group-hover:opacity-0">
              {item.nextAction ? (
                <p className="line-clamp-2">
                  <span className="font-medium text-neutral-800 dark:text-neutral-200">Next:</span>{' '}
                  {item.nextAction}
                </p>
              ) : (
                <p className="line-clamp-1 opacity-0" aria-hidden>
                  Next
                </p>
              )}
            </div>
            <div className="pointer-events-none invisible absolute inset-0 flex items-center justify-start opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100">
              {renderHoverActions(item)}
            </div>
          </div>
        ) : item.nextAction ? (
          <p className="line-clamp-2">
            <span className="font-medium text-neutral-800 dark:text-neutral-200">Next:</span>{' '}
            {item.nextAction}
          </p>
        ) : null}

        {item.blockedBy ? (
          <p className="line-clamp-1 text-status-blocked">
            <span className="font-medium">Blocked:</span> {item.blockedBy}
          </p>
        ) : null}
      </div>

      {renderActions ? (
        <div className="mt-2 flex flex-wrap gap-1.5">{renderActions(item)}</div>
      ) : null}
    </article>
  );
}
