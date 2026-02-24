import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useDroppable } from '@dnd-kit/core';
import { ChevronDown, ChevronUp, ChevronsRightLeft } from 'lucide-react';
import type { BoardItem, ColumnDefinition } from '../lib/schema';
import { Card } from './Card';

interface ColumnProps<T extends BoardItem> {
  column: ColumnDefinition;
  items: T[];
  cardsCollapsed?: boolean;
  minimized?: boolean;
  /** External highlight (e.g. card being dragged over from another column) */
  highlighted?: boolean;
  onToggleCardsCollapse?: () => void;
  onToggleMinimize?: () => void;
  onItemClick: (item: T) => void;
  getItemWarning?: (item: T) => boolean;
  renderItemIndicators?: (item: T) => ReactNode;
  renderItemActions?: (item: T) => ReactNode;
  renderItemHoverActions?: (item: T) => ReactNode;
  showPriority?: boolean;
  /** Spread onto the header to make it a drag handle for column reordering */
  headerDragHandleProps?: Record<string, unknown>;
}

export function Column<T extends BoardItem>({
  column,
  items,
  cardsCollapsed = false,
  minimized = false,
  highlighted = false,
  onToggleCardsCollapse,
  onToggleMinimize,
  onItemClick,
  headerDragHandleProps,
  getItemWarning,
  renderItemIndicators,
  renderItemActions,
  renderItemHoverActions,
  showPriority = true,
}: ColumnProps<T>) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const { onKeyDown: dragHandleOnKeyDown, ...dragHandleProps } = (headerDragHandleProps ?? {}) as {
    onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
    [key: string]: unknown;
  };

  return (
    <section
      ref={setNodeRef}
      className={`flex h-full min-h-0 min-w-0 flex-col rounded-2xl border transition-colors duration-200 ${
        isOver || highlighted
          ? 'border-revival-accent-400 bg-revival-accent-50/60 dark:bg-revival-accent-900/20'
          : 'border-neutral-200 bg-neutral-100/60 dark:border-neutral-700 dark:bg-neutral-900/40'
      } ${minimized ? 'p-2' : 'p-3'}`}
    >
      <header
        className={`cursor-grab rounded-lg bg-neutral-100 transition-colors hover:bg-neutral-200/80 active:cursor-grabbing dark:bg-neutral-800 dark:hover:bg-neutral-700/80 ${
          minimized
            ? 'flex h-full min-h-0 flex-col items-center px-1 pb-2 pt-[15px]'
            : 'mb-3 mr-[1px] flex items-center gap-1.5 px-3 py-2'
        }`}
        role="button"
        aria-label={`Reorder ${column.label} column`}
        tabIndex={0}
        onKeyDown={(e) => {
          dragHandleOnKeyDown?.(e);
        }}
        {...dragHandleProps}
      >
        {minimized ? (
          <>
            <div className="flex w-full shrink-0 items-center justify-center">
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMinimize?.();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Restore ${column.label} column`}
              >
                <ChevronsRightLeft className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex min-h-0 w-full flex-1 items-start justify-center overflow-hidden">
              <div className="flex items-center gap-2 [text-orientation:mixed] [writing-mode:vertical-rl]">
                <span className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 dark:text-neutral-200">
                  {column.label}
                </span>
                <span className="inline-flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-neutral-200 px-2 text-[11px] font-semibold leading-none text-neutral-700 [writing-mode:horizontal-tb] dark:bg-neutral-700 dark:text-neutral-200">
                  {items.length}
                </span>
              </div>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-neutral-400 transition-colors hover:text-neutral-600 dark:text-neutral-500 dark:hover:text-neutral-300"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCardsCollapse?.();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={cardsCollapsed ? `Show ${column.label} cards` : `Hide ${column.label} cards`}
            >
              {cardsCollapsed ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
            <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 dark:text-neutral-200">
              {column.label}
            </h2>
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="shrink-0 rounded p-0.5 text-neutral-500 transition-colors hover:text-neutral-700 dark:text-neutral-400 dark:hover:text-neutral-200"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleMinimize?.();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                aria-label={`Minimize ${column.label} column`}
              >
                <ChevronsRightLeft className="h-3.5 w-3.5" />
              </button>
              <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                {items.length}
              </span>
            </div>
          </>
        )}
      </header>

      {!cardsCollapsed && !minimized && (
        <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          <div className="scrollbar-hidden flex min-h-0 grow flex-col gap-2 overflow-y-auto pr-[1px]">
            {items.map((item) => (
              <Card
                key={item.id}
                item={item}
                warning={getItemWarning?.(item)}
                onClick={onItemClick}
                renderIndicators={renderItemIndicators}
                renderActions={renderItemActions}
                renderHoverActions={renderItemHoverActions}
                showPriority={showPriority}
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
