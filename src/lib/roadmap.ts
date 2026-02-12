import matter from 'gray-matter';
import type { RoadmapDocument, RoadmapItem, RoadmapStatus } from './schema';
import { readFile, writeFile } from './tauri';

const VALID_ROADMAP_STATUS = new Set<RoadmapStatus>(['pending', 'in-progress', 'complete']);

function sanitizeRoadmapItem(item: unknown, index: number): RoadmapItem | null {
  if (typeof item !== 'object' || item === null) return null;

  const record = item as Record<string, unknown>;
  if (typeof record.title !== 'string' || !record.title.trim()) return null;
  if (typeof record.status !== 'string' || !VALID_ROADMAP_STATUS.has(record.status as RoadmapStatus)) {
    return null;
  }

  return {
    id: typeof record.id === 'string' ? record.id : `roadmap-${index + 1}`,
    title: record.title,
    status: record.status as RoadmapStatus,
    priority: typeof record.priority === 'number' ? record.priority : undefined,
    nextAction: typeof record.nextAction === 'string' ? record.nextAction : undefined,
    blockedBy:
      record.blockedBy === null
        ? undefined
        : typeof record.blockedBy === 'string'
          ? record.blockedBy
          : undefined,
    tags: Array.isArray(record.tags)
      ? record.tags.filter((tag): tag is string => typeof tag === 'string')
      : undefined,
    icon: typeof record.icon === 'string' ? record.icon : undefined,
  };
}

function normalizeRoadmapItems(items: RoadmapItem[]): RoadmapItem[] {
  return items.map((item, index) => ({
    ...item,
    id: item.id || `roadmap-${index + 1}`,
    priority: index + 1,
  }));
}

export async function readRoadmap(filePath: string): Promise<RoadmapDocument> {
  const raw = await readFile(filePath);
  const { data, content } = matter(raw);

  const itemsRaw = (data as Record<string, unknown>).items;
  const parsed = Array.isArray(itemsRaw)
    ? itemsRaw
        .map((item, index) => sanitizeRoadmapItem(item, index))
        .filter((item): item is RoadmapItem => item !== null)
    : [];

  return {
    filePath,
    items: normalizeRoadmapItems(parsed),
    notes: content,
  };
}

export async function writeRoadmap(document: RoadmapDocument): Promise<void> {
  const payloadItems = document.items.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    nextAction: item.nextAction,
    blockedBy: item.blockedBy,
    tags: item.tags,
    icon: item.icon,
  }));

  const content = matter.stringify(document.notes ?? '', {
    items: payloadItems,
  });

  await writeFile(document.filePath, content);
}
