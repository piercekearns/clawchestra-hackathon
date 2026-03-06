import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { GripVertical } from 'lucide-react';
import type { RoadmapItemWithDocs, RoadmapStatus } from '../../lib/schema';
import { RoadmapItemRow } from './RoadmapItemRow';

interface RoadmapItemListProps {
  items: RoadmapItemWithDocs[];
  onReorder: (items: RoadmapItemWithDocs[]) => void;
  onStatusChange: (itemId: string, status: RoadmapStatus) => void;
  onItemClick: (item: RoadmapItemWithDocs) => void;
  onDocClick: (item: RoadmapItemWithDocs, docType: 'spec' | 'plan') => void;
}

export function RoadmapItemList({
  items,
  onReorder,
  onStatusChange,
  onItemClick,
  onDocClick,
}: RoadmapItemListProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 },
    }),
  );

  const activeItem = activeId ? items.find((item) => item.id === activeId) ?? null : null;
  const activeIndex = activeItem ? items.indexOf(activeItem) : -1;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((item) => item.id === String(active.id));
    const newIndex = items.findIndex((item) => item.id === String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(items, oldIndex, newIndex);
    onReorder(reordered);
  };

  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400">
        No roadmap items yet
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragCancel={() => setActiveId(null)}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
        <div className="flex flex-col gap-1.5">
          {items.map((item, index) => (
            <RoadmapItemRow
              key={item.id}
              item={item}
              index={index}
              onStatusChange={onStatusChange}
              onItemClick={onItemClick}
              onDocClick={onDocClick}
            />
          ))}
        </div>
      </SortableContext>

      <DragOverlay>
        {activeItem ? (
          <div className="flex items-center gap-2 rounded-lg border border-revival-accent-400 bg-neutral-50 px-2 py-2 shadow-lg dark:bg-neutral-800">
            <GripVertical className="h-4 w-4 shrink-0 text-neutral-400" />
            <span className="shrink-0 rounded-full border border-neutral-300 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:border-neutral-600 dark:text-neutral-200">
              P{activeIndex + 1}
            </span>
            <span className="truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">
              {activeItem.title}
              {activeItem.icon ? <span className="ml-1 inline-block align-text-bottom">{activeItem.icon}</span> : null}
            </span>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
