import type { ReactNode } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import type { BoardItem, ColumnDefinition } from '../lib/schema';
import { Card } from './Card';

interface ColumnProps<T extends BoardItem> {
  column: ColumnDefinition;
  items: T[];
  onItemClick: (item: T) => void;
  getItemWarning?: (item: T) => boolean;
  renderItemIndicators?: (item: T) => ReactNode;
  renderItemActions?: (item: T) => ReactNode;
  renderItemHoverActions?: (item: T) => ReactNode;
}

export function Column<T extends BoardItem>({
  column,
  items,
  onItemClick,
  getItemWarning,
  renderItemIndicators,
  renderItemActions,
  renderItemHoverActions,
}: ColumnProps<T>) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });

  return (
    <section
      ref={setNodeRef}
      className={`flex h-full min-h-[24rem] min-w-0 flex-col rounded-2xl border p-3 ${
        isOver
          ? 'border-revival-accent-400 bg-revival-accent-50/60 dark:bg-revival-accent-900/20'
          : 'border-neutral-200 bg-neutral-100/60 dark:border-neutral-700 dark:bg-neutral-900/40'
      }`}
    >
      <header className="mb-3 flex items-center justify-between rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 dark:text-neutral-200">
          {column.label}
        </h2>
        <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
          {items.length}
        </span>
      </header>

      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="scrollbar-hidden flex min-h-0 grow flex-col gap-2 overflow-y-auto pr-0">
          {items.map((item) => (
            <Card
              key={item.id}
              item={item}
              warning={getItemWarning?.(item)}
              onClick={onItemClick}
              renderIndicators={renderItemIndicators}
              renderActions={renderItemActions}
              renderHoverActions={renderItemHoverActions}
            />
          ))}

          {items.length === 0 ? (
            <div className="mt-6 rounded-xl border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
              Drop project here
            </div>
          ) : null}
        </div>
      </SortableContext>
    </section>
  );
}
