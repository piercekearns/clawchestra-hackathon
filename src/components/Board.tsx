import type { ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragCancelEvent,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useCallback, useEffect, useMemo, useState } from 'react';
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

  /** All sortable IDs: column IDs + every card ID (needed for single DndContext) */
  const allSortableIds = useMemo(() => {
    const ids: string[] = [...sortableColumnIds];
    for (const col of orderedColumns) {
      for (const item of grouped[col.id] ?? []) {
        ids.push(item.id);
      }
    }
    return ids;
  }, [sortableColumnIds, orderedColumns, grouped]);

  const isColumnId = (id: string) => id.startsWith('col:');

  // --- Card DnD helpers ---
  const findStatusForTarget = (targetId: string): string | null => {
    if (columnIdSet.has(targetId)) return targetId;
    return localItems.find((entry) => entry.id === targetId)?.status ?? null;
  };

  // --- Unified DnD handlers ---
  const handleDragStart = (event: DragStartEvent) => {
    const id = String(event.active.id);
    if (!isColumnId(id)) {
      setActiveCardId(id);
      setActiveCardWidth(event.active.rect.current.initial?.width ?? null);
    }
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveCardId(null);
    setActiveCardWidth(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);

    // Always reset card drag state
    setActiveCardId(null);
    setActiveCardWidth(null);

    if (!over) return;
    const overId = String(over.id);

    // --- Column reorder ---
    if (isColumnId(activeId)) {
      if (activeId === overId) return;
      // Only reorder if dropping on another column
      if (!isColumnId(overId)) return;

      const activeColId = activeId.replace(/^col:/, '');
      const overColId = overId.replace(/^col:/, '');

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
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragCancel={handleDragCancel}
      onDragEnd={handleDragEnd}
    >
      <div className="kanban-scroll -mb-2 h-full min-h-[24rem] min-w-0 overflow-x-auto overflow-y-hidden pb-0">
        <SortableContext items={sortableColumnIds} strategy={horizontalListSortingStrategy}>
          <div
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
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
