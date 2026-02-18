import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronRight, GripVertical } from 'lucide-react';
import type { BoardItem, ColumnDefinition } from '../lib/schema';
import { Card } from './Card';

interface ColumnProps<T extends BoardItem> {
  column: ColumnDefinition;
  items: T[];
  collapsed?: boolean;
  /** External highlight (e.g. card being dragged over from another column) */
  highlighted?: boolean;
  onToggleCollapse?: () => void;
  onItemClick: (item: T) => void;
  getItemWarning?: (item: T) => boolean;
  renderItemIndicators?: (item: T) => ReactNode;
  renderItemActions?: (item: T) => ReactNode;
  renderItemHoverActions?: (item: T) => ReactNode;
  /** Spread onto the header to make it a drag handle for column reordering */
  headerDragHandleProps?: Record<string, unknown>;
}

export function Column<T extends BoardItem>({
  column,
  items,
  collapsed = false,
  highlighted = false,
  onToggleCollapse,
  onItemClick,
  headerDragHandleProps,
  getItemWarning,
  renderItemIndicators,
  renderItemActions,
  renderItemHoverActions,
}: ColumnProps<T>) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const { onKeyDown: dragHandleOnKeyDown, ...dragHandleProps } = (headerDragHandleProps ?? {}) as {
    onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
    [key: string]: unknown;
  };

  return (
    <section
      ref={setNodeRef}
      className={`flex h-full min-h-[24rem] min-w-0 flex-col rounded-2xl border p-3 transition-colors duration-200 ${
        isOver || highlighted
          ? 'border-revival-accent-400 bg-revival-accent-50/60 dark:bg-revival-accent-900/20'
          : 'border-neutral-200 bg-neutral-100/60 dark:border-neutral-700 dark:bg-neutral-900/40'
      }`}
    >
      <header
        className="mb-3 flex cursor-grab items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 transition-colors hover:bg-neutral-200/80 active:cursor-grabbing dark:bg-neutral-800 dark:hover:bg-neutral-700/80"
        role="button"
        aria-label={collapsed ? `Expand ${column.label} cards` : `Collapse ${column.label} cards`}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggleCollapse?.();
          }
          dragHandleOnKeyDown?.(e);
        }}
        {...dragHandleProps}
      >
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse?.();
          }}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label={collapsed ? 'Expand' : 'Collapse'}
        >
          {collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 dark:text-neutral-200">
          {column.label}
        </h2>
        <span className="ml-auto rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
          {items.length}
        </span>
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600" />
      </header>

      {!collapsed && (
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
      )}
    </section>
  );
}
