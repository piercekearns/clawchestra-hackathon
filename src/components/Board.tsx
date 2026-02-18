import type { ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragCancelEvent,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BoardItem, ColumnDefinition } from '../lib/schema';
import { resolveColumnOrder } from '../lib/columns';
import { useDashboardStore } from '../lib/store';
import { Card } from './Card';
import { Column } from './Column';

interface BoardProps<T extends BoardItem> {
  columns: ColumnDefinition[];
  items: T[];
  /** Board identifier for collapse/order persistence ("projects" | "roadmap:{projectId}") */
  boardId?: string;
  onItemClick: (item: T) => void;
  onItemsChange: (items: T[]) => void;
  getItemWarning?: (item: T) => boolean;
  renderItemIndicators?: (item: T) => ReactNode;
  renderItemActions?: (item: T) => ReactNode;
  renderItemHoverActions?: (item: T) => ReactNode;
}

const MIN_COLUMN_WIDTH = 300;
const COLUMN_GAP = 16;
const EMPTY_ARRAY: string[] = [];

/**
 * Scoped collision detection: when dragging a column (col:* ID), only
 * consider other col:* sortable targets so SortableContext can animate
 * swaps. When dragging a card, exclude col:* targets to avoid confusion.
 */
const scopedCollision: CollisionDetection = (args) => {
  const activeId = String(args.active.id);
  if (activeId.startsWith('col:')) {
    const columnOnly = args.droppableContainers.filter(
      (c) => String(c.id).startsWith('col:'),
    );
    return closestCorners({ ...args, droppableContainers: columnOnly });
  }
  // Card drag — match cards + plain column droppables (not col:* sortables)
  const cardTargets = args.droppableContainers.filter(
    (c) => !String(c.id).startsWith('col:'),
  );
  return closestCorners({ ...args, droppableContainers: cardTargets });
};

function groupByStatus<T extends BoardItem>(
  items: T[],
  columns: ColumnDefinition[],
): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const column of columns) {
    grouped[column.id] = [];
  }
  for (const item of items) {
    if (!grouped[item.status]) grouped[item.status] = [];
    grouped[item.status].push(item);
  }
  return grouped;
}

/** Wrapper that makes a Column sortable (draggable by its header) */
function SortableColumn<T extends BoardItem>({
  column,
  children,
}: {
  column: ColumnDefinition;
  children: (dragHandleProps: {
    listeners: ReturnType<typeof useSortable>['listeners'];
    attributes: ReturnType<typeof useSortable>['attributes'];
  }) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `col:${column.id}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="h-full min-h-0">
      {children({ listeners, attributes })}
    </div>
  );
}

export function Board<T extends BoardItem>({
  columns,
  items,
  boardId = 'projects',
  onItemClick,
  onItemsChange,
  getItemWarning,
  renderItemIndicators,
  renderItemActions,
  renderItemHoverActions,
}: BoardProps<T>) {
  const collapsedColumns = useDashboardStore(
    (s) => s.collapsedColumns[boardId] ?? EMPTY_ARRAY,
  );
  const savedColumnOrder = useDashboardStore(
    (s) => s.columnOrder[boardId],
  );
  const toggleColumnCollapse = useDashboardStore((s) => s.toggleColumnCollapse);
  const setColumnOrder = useDashboardStore((s) => s.setColumnOrder);

  const handleToggleCollapse = useCallback(
    (columnId: string) => toggleColumnCollapse(boardId, columnId),
    [boardId, toggleColumnCollapse],
  );

  // Resolve column display order from saved preferences
  const orderedColumns = useMemo(
    () => resolveColumnOrder(savedColumnOrder, columns),
    [savedColumnOrder, columns],
  );

  const [localItems, setLocalItems] = useState(items);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeCardWidth, setActiveCardWidth] = useState<number | null>(null);
  const [activeColumnId, setActiveColumnId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const [cardDragOverColumnId, setCardDragOverColumnId] = useState<string | null>(null);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  // Single sensor set — distance:6 for cards, column headers use the same
  // (columns only activate from their drag-handle header, so the low
  // threshold doesn't cause accidental column drags on card areas).
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const grouped = useMemo(() => groupByStatus(localItems, orderedColumns), [orderedColumns, localItems]);
  const activeItem = activeCardId ? localItems.find((entry) => entry.id === activeCardId) ?? null : null;
  const columnIdSet = useMemo(() => new Set(orderedColumns.map((c) => c.id)), [orderedColumns]);
  const collapsedSet = useMemo(() => new Set(collapsedColumns), [collapsedColumns]);

  const minBoardWidth = useMemo(
    () => orderedColumns.length * MIN_COLUMN_WIDTH + Math.max(0, orderedColumns.length - 1) * COLUMN_GAP,
    [orderedColumns.length],
  );

  const sortableColumnIds = useMemo(
    () => orderedColumns.map((c) => `col:${c.id}`),
    [orderedColumns],
  );

  const isColumnId = (id: string) => id.startsWith('col:');
  const toColumnStatusId = (id: string): string | null => {
    const normalized = isColumnId(id) ? id.slice(4) : id;
    return columnIdSet.has(normalized) ? normalized : null;
  };

  // --- Card DnD helpers ---
  const findStatusForTarget = (targetId: string): string | null => {
    if (columnIdSet.has(targetId)) return targetId;
    return localItems.find((entry) => entry.id === targetId)?.status ?? null;
  };

  const activeColumn = activeColumnId
    ? orderedColumns.find((c) => c.id === activeColumnId) ?? null
    : null;
  const activeColumnItemCount = activeColumn
    ? (grouped[activeColumn.id] ?? []).length
    : 0;

  // --- Unified DnD handlers ---
  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (isColumnId(id)) {
      setActiveColumnId(id.replace(/^col:/, ''));
    } else {
      setActiveCardId(id);
      setActiveCardWidth(event.active.rect.current.initial?.width ?? null);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    // Track which column a card is hovering over (for glow effect)
    if (!activeCardId) {
      setCardDragOverColumnId(null);
      return;
    }
    const { over } = event;
    if (!over) {
      setCardDragOverColumnId(null);
      return;
    }
    const overId = String(over.id);
    // Resolve over target to a column ID
    const targetCol = columnIdSet.has(overId)
      ? overId
      : localItems.find((entry) => entry.id === overId)?.status ?? null;
    // Only glow if it's a different column from the card's source
    const sourceCol = localItems.find((entry) => entry.id === activeCardId)?.status ?? null;
    setCardDragOverColumnId(targetCol && targetCol !== sourceCol ? targetCol : null);
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveCardId(null);
    setActiveCardWidth(null);
    setActiveColumnId(null);
    setCardDragOverColumnId(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);

    // Always reset drag state
    setActiveCardId(null);
    setActiveCardWidth(null);
    setActiveColumnId(null);
    setCardDragOverColumnId(null);

    if (!over) return;
    const overId = String(over.id);

    // --- Column reorder ---
    if (isColumnId(activeId)) {
      // over.id may be "col:xxx" (sortable) or plain "xxx" (droppable)
      const activeColId = toColumnStatusId(activeId);
      const overColId = toColumnStatusId(overId);
      if (!activeColId || !overColId || activeColId === overColId) return;

      const oldIndex = orderedColumns.findIndex((c) => c.id === activeColId);
      const newIndex = orderedColumns.findIndex((c) => c.id === overColId);
      if (oldIndex < 0 || newIndex < 0) return;

      const next = [...orderedColumns];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);

      setColumnOrder(boardId, next.map((c) => c.id));
      return;
    }

    // --- Card move / reorder ---
    const activeEntry = localItems.find((entry) => entry.id === activeId);
    if (!activeEntry) return;

    const sourceStatus = activeEntry.status;
    const targetStatus = findStatusForTarget(overId);
    if (!targetStatus) return;

    const groupedItems = groupByStatus(localItems, orderedColumns);
    const sourceItems = [...(groupedItems[sourceStatus] ?? [])];
    const targetItems =
      sourceStatus === targetStatus ? sourceItems : [...(groupedItems[targetStatus] ?? [])];

    const activeIndexInSource = sourceItems.findIndex((entry) => entry.id === activeEntry.id);
    if (activeIndexInSource < 0) return;

    sourceItems.splice(activeIndexInSource, 1);
    const targetWithoutActive = targetItems.filter((entry) => entry.id !== activeEntry.id);
    const overIsColumn = columnIdSet.has(overId);

    let insertIndex = targetWithoutActive.length;
    if (!overIsColumn) {
      const overIndex = targetWithoutActive.findIndex((entry) => entry.id === overId);
      if (overIndex >= 0) insertIndex = overIndex;
    }

    const movedItem = { ...activeEntry, status: targetStatus } as T;
    targetWithoutActive.splice(insertIndex, 0, movedItem);

    groupedItems[sourceStatus] = sourceItems;
    groupedItems[targetStatus] = targetWithoutActive;

    const rebuilt: T[] = [];
    for (const column of orderedColumns) {
      rebuilt.push(...(groupedItems[column.id] ?? []));
    }

    setLocalItems(rebuilt);
    onItemsChange(rebuilt);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={scopedCollision}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-scroll -mb-2 h-full min-h-[24rem] min-w-0 overflow-x-auto overflow-y-hidden pb-0">
        <SortableContext items={sortableColumnIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={gridRef}
            className="grid h-full min-h-[24rem] w-full gap-4"
            style={{
              gridTemplateColumns: `repeat(${orderedColumns.length}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`,
              gridTemplateRows: 'minmax(0, 1fr)',
              minWidth: `${minBoardWidth}px`,
            }}
          >
            {orderedColumns.map((column) => (
              <SortableColumn key={column.id} column={column}>
                {({ listeners, attributes }) => (
                  <Column
                    column={column}
                    items={grouped[column.id] ?? []}
                    collapsed={collapsedSet.has(column.id)}
                    highlighted={cardDragOverColumnId === column.id}
                    onToggleCollapse={() => handleToggleCollapse(column.id)}
                    onItemClick={onItemClick}
                    getItemWarning={getItemWarning}
                    renderItemIndicators={renderItemIndicators}
                    renderItemActions={renderItemActions}
                    renderItemHoverActions={renderItemHoverActions}
                    headerDragHandleProps={{ ...listeners, ...attributes }}
                  />
                )}
              </SortableColumn>
            ))}
          </div>
        </SortableContext>
      </div>

      <DragOverlay>
        {activeItem ? (
          <div style={activeCardWidth ? { width: `${activeCardWidth}px` } : undefined}>
            <Card
              item={activeItem}
              onClick={() => undefined}
              renderIndicators={renderItemIndicators}
              renderHoverActions={renderItemHoverActions}
            />
          </div>
        ) : activeColumn ? (
          <div
            className="flex flex-col overflow-hidden rounded-2xl border border-revival-accent-400 bg-neutral-100/90 p-3 shadow-2xl dark:bg-neutral-900/90"
            style={{
              width: gridRef.current
                ? `${(gridRef.current.clientWidth - (orderedColumns.length - 1) * COLUMN_GAP) / orderedColumns.length}px`
                : `${MIN_COLUMN_WIDTH}px`,
              height: gridRef.current ? `${gridRef.current.clientHeight}px` : undefined,
            }}
          >
            {/* Header */}
            <div className="mb-3 flex cursor-grabbing items-center gap-1.5 rounded-lg bg-neutral-100 px-3 py-2 dark:bg-neutral-800">
              <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-neutral-700 dark:text-neutral-200">
                {activeColumn.label}
              </h2>
              <span className="ml-auto rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200">
                {activeColumnItemCount}
              </span>
              <GripVertical className="h-3.5 w-3.5 shrink-0 text-neutral-400 dark:text-neutral-500" />
            </div>
            {/* Card previews */}
            <div className="flex flex-col gap-2 overflow-hidden">
              {(grouped[activeColumn.id] ?? []).map((item) => (
                <Card
                  key={item.id}
                  item={item}
                  onClick={() => undefined}
                  renderIndicators={renderItemIndicators}
                  renderHoverActions={renderItemHoverActions}
                />
              ))}
              {activeColumnItemCount === 0 && (
                <div className="rounded-xl border border-dashed border-neutral-300 p-4 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
                  Drop project here
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
