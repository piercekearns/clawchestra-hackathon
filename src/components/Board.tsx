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
  arrayMove,
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
const SCROLLBAR_GUTTER_PX = 7;
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
  const [itemsBeforeDrag, setItemsBeforeDrag] = useState<T[] | null>(null);
  const [dragSourceStatus, setDragSourceStatus] = useState<string | null>(null);

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
      const entry = localItems.find((e) => e.id === id);
      setDragSourceStatus(entry?.status ?? null);
      setItemsBeforeDrag([...localItems]);
    }
  };

  const handleDragOver = (event: DragOverEvent) => {
    if (!activeCardId) {
      setCardDragOverColumnId(null);
      return;
    }
    const { active, over } = event;
    if (!over) {
      setCardDragOverColumnId(null);
      return;
    }
    const activeId = String(active.id);
    const overId = String(over.id);

    // Skip column drags
    if (isColumnId(activeId)) return;

    // Resolve the target column from the over element
    const targetCol = columnIdSet.has(overId)
      ? overId
      : localItems.find((entry) => entry.id === overId)?.status ?? null;
    if (!targetCol) return;

    // Glow: compare against original drag source column
    setCardDragOverColumnId(targetCol !== dragSourceStatus ? targetCol : null);

    // Find the active item's current column
    const activeEntry = localItems.find((entry) => entry.id === activeId);
    if (!activeEntry) return;
    const sourceCol = activeEntry.status;

    // Cross-column transfer: move the item between groups in state
    // so the target column's SortableContext shows insertion position
    if (sourceCol !== targetCol) {
      setLocalItems((prev) => {
        const entry = prev.find((e) => e.id === activeId);
        if (!entry || entry.status !== sourceCol) return prev; // already moved

        const grp = groupByStatus(prev, orderedColumns);
        const srcGroup = grp[sourceCol] ?? [];
        const tgtGroup = grp[targetCol] ?? [];

        // Remove from source
        const sIdx = srcGroup.findIndex((e) => e.id === activeId);
        if (sIdx >= 0) srcGroup.splice(sIdx, 1);

        // Insert in target at hovered position
        const movedItem = { ...entry, status: targetCol } as T;
        const overIsColumn = columnIdSet.has(overId);

        if (overIsColumn || tgtGroup.length === 0) {
          tgtGroup.push(movedItem);
        } else {
          const oIdx = tgtGroup.findIndex((e) => e.id === overId);
          if (oIdx >= 0) {
            tgtGroup.splice(oIdx, 0, movedItem);
          } else {
            tgtGroup.push(movedItem);
          }
        }

        grp[sourceCol] = srcGroup;
        grp[targetCol] = tgtGroup;

        const rebuilt: typeof prev = [];
        for (const col of orderedColumns) {
          rebuilt.push(...(grp[col.id] ?? []));
        }
        return rebuilt;
      });
    }
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    if (itemsBeforeDrag) setLocalItems(itemsBeforeDrag);
    setActiveCardId(null);
    setActiveCardWidth(null);
    setActiveColumnId(null);
    setCardDragOverColumnId(null);
    setItemsBeforeDrag(null);
    setDragSourceStatus(null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    const activeId = String(active.id);

    // Save snapshot before clearing state
    const snapshot = itemsBeforeDrag;

    // Always reset drag state
    setActiveCardId(null);
    setActiveCardWidth(null);
    setActiveColumnId(null);
    setCardDragOverColumnId(null);
    setItemsBeforeDrag(null);
    setDragSourceStatus(null);

    if (!over) {
      // No valid target — restore pre-drag state
      if (snapshot) setLocalItems(snapshot);
      return;
    }
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
    // Cross-column transfer already happened in onDragOver.
    // Here we handle final within-column positioning.
    const activeEntry = localItems.find((entry) => entry.id === activeId);
    if (!activeEntry) {
      if (snapshot) setLocalItems(snapshot);
      return;
    }

    // If over target is a column droppable, commit current state
    if (columnIdSet.has(overId)) {
      onItemsChange(localItems);
      return;
    }

    // If active and over are in the same column, do a within-column reorder
    const overEntry = localItems.find((entry) => entry.id === overId);
    if (overEntry && overEntry.status === activeEntry.status) {
      const grp = groupByStatus(localItems, orderedColumns);
      const colItems = grp[activeEntry.status] ?? [];
      const activeIdx = colItems.findIndex((e) => e.id === activeId);
      const overIdx = colItems.findIndex((e) => e.id === overId);

      if (activeIdx >= 0 && overIdx >= 0 && activeIdx !== overIdx) {
        grp[activeEntry.status] = arrayMove(colItems, activeIdx, overIdx);
        const rebuilt: T[] = [];
        for (const column of orderedColumns) {
          rebuilt.push(...(grp[column.id] ?? []));
        }
        setLocalItems(rebuilt);
        onItemsChange(rebuilt);
        return;
      }
    }

    // Default: commit current state (cross-column was handled in onDragOver)
    onItemsChange(localItems);
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
      <div
        className="kanban-scroll h-full min-h-0 min-w-0 overflow-x-auto overflow-y-hidden"
        style={{ '--kanban-scrollbar-gutter': `${SCROLLBAR_GUTTER_PX}px` } as React.CSSProperties}
      >
        <SortableContext items={sortableColumnIds} strategy={horizontalListSortingStrategy}>
          <div
            ref={gridRef}
            className="grid min-h-0 w-full gap-4 pr-2"
            style={{
              gridTemplateColumns: `repeat(${orderedColumns.length}, minmax(${MIN_COLUMN_WIDTH}px, 1fr))`,
              gridTemplateRows: 'minmax(0, 1fr)',
              minWidth: `${minBoardWidth}px`,
              height: `calc(100% - ${SCROLLBAR_GUTTER_PX}px)`,
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
