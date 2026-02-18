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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BoardItem, ColumnDefinition } from '../lib/schema';
import { useDashboardStore } from '../lib/store';
import { Card } from './Card';
import { Column } from './Column';

interface BoardProps<T extends BoardItem> {
  columns: ColumnDefinition[];
  items: T[];
  /** Board identifier for collapse persistence ("projects" | "roadmap:{projectId}") */
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
const EMPTY_COLLAPSED_COLUMNS: string[] = [];

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
    (s) => s.collapsedColumns[boardId] ?? EMPTY_COLLAPSED_COLUMNS,
  );
  const toggleColumnCollapse = useDashboardStore((s) => s.toggleColumnCollapse);

  const handleToggleCollapse = useCallback(
    (columnId: string) => toggleColumnCollapse(boardId, columnId),
    [boardId, toggleColumnCollapse],
  );
  const [localItems, setLocalItems] = useState(items);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeCardWidth, setActiveCardWidth] = useState<number | null>(null);

  useEffect(() => {
    setLocalItems(items);
  }, [items]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const grouped = useMemo(() => groupByStatus(localItems, columns), [columns, localItems]);

  const activeItem = activeId ? localItems.find((entry) => entry.id === activeId) ?? null : null;

  const columnIds = useMemo(() => new Set(columns.map((column) => column.id)), [columns]);
  const collapsedSet = useMemo(() => new Set(collapsedColumns), [collapsedColumns]);

  const minBoardWidth = useMemo(
    () => columns.length * MIN_COLUMN_WIDTH + Math.max(0, columns.length - 1) * COLUMN_GAP,
    [columns.length],
  );

  const findStatusForTarget = (targetId: string): string | null => {
    if (columnIds.has(targetId)) return targetId;
    return localItems.find((entry) => entry.id === targetId)?.status ?? null;
  };

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    const measuredWidth = event.active.rect.current.initial?.width ?? null;
    setActiveCardWidth(measuredWidth);
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    setActiveId(null);
    setActiveCardWidth(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setActiveCardWidth(null);
    if (!over) return;

    const activeEntry = localItems.find((entry) => entry.id === String(active.id));
    if (!activeEntry) return;

    const sourceStatus = activeEntry.status;
    const targetStatus = findStatusForTarget(String(over.id));
    if (!targetStatus) return;

    const groupedItems = groupByStatus(localItems, columns);
    const sourceItems = [...(groupedItems[sourceStatus] ?? [])];
    const targetItems =
      sourceStatus === targetStatus ? sourceItems : [...(groupedItems[targetStatus] ?? [])];

    const activeIndexInSource = sourceItems.findIndex((entry) => entry.id === activeEntry.id);
    if (activeIndexInSource < 0) return;

    sourceItems.splice(activeIndexInSource, 1);

    const targetWithoutActive = targetItems.filter((entry) => entry.id !== activeEntry.id);
    const overIsColumn = columnIds.has(String(over.id));

    let insertIndex = targetWithoutActive.length;
    if (!overIsColumn) {
      const overIndex = targetWithoutActive.findIndex((entry) => entry.id === String(over.id));
      if (overIndex >= 0) insertIndex = overIndex;
    }

    const movedItem = {
      ...activeEntry,
      status: targetStatus,
    } as T;

    targetWithoutActive.splice(insertIndex, 0, movedItem);

    groupedItems[sourceStatus] = sourceItems;
    groupedItems[targetStatus] = targetWithoutActive;

    const rebuilt: T[] = [];
    for (const column of columns) {
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
        <div
          className="grid h-full min-h-[24rem] w-full gap-4"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`,
            minWidth: `${minBoardWidth}px`,
          }}
        >
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              items={grouped[column.id] ?? []}
              collapsed={collapsedSet.has(column.id)}
              onToggleCollapse={() => handleToggleCollapse(column.id)}
              onItemClick={onItemClick}
              getItemWarning={getItemWarning}
              renderItemIndicators={renderItemIndicators}
              renderItemActions={renderItemActions}
              renderItemHoverActions={renderItemHoverActions}
            />
          ))}
        </div>
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
