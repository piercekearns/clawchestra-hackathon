import matter from 'gray-matter';
import type {
  ProjectFrontmatter,
  RoadmapDocument,
  RoadmapItem,
  RoadmapItemDocs,
  RoadmapItemWithDocs,
  RoadmapStatus,
} from './schema';
import { pathExists, readFile, writeFile } from './tauri';

const VALID_ROADMAP_STATUS = new Set<RoadmapStatus>(['pending', 'up-next', 'in-progress', 'complete']);

function sanitizeRoadmapItem(item: unknown, index: number): RoadmapItem | null {
  if (typeof item !== 'object' || item === null) return null;

  const record = item as Record<string, unknown>;
  if (typeof record.title !== 'string' || !record.title.trim()) return null;
  // Migrate legacy 'shipped' status to 'complete'
  if (record.status === 'shipped') record.status = 'complete';
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
    specDoc: typeof record.specDoc === 'string' ? record.specDoc : undefined,
    planDoc: typeof record.planDoc === 'string' ? record.planDoc : undefined,
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
    specDoc: item.specDoc,
    planDoc: item.planDoc,
  }));

  const content = matter.stringify(document.notes ?? '', {
    items: payloadItems,
  });

  await writeFile(document.filePath, content);
}

async function checkPath(path: string): Promise<string | undefined> {
  const exists = await pathExists(path);
  return exists ? path : undefined;
}

/**
 * Resolve doc files for roadmap items.
 *
 * Resolution order (per item):
 *   1. Item-level specDoc / planDoc field (from ROADMAP.md YAML)
 *   2. Convention paths: docs/specs/{id}-spec.md, docs/specs/{id}.md
 *   3. Nothing — items do NOT inherit project-level docs
 *
 * Project-level specDoc/planDoc are for the project overview only;
 * roadmap items must have their own docs or show "no spec".
 */
export async function resolveDocFiles(
  localPath: string,
  items: RoadmapItem[],
  _frontmatter: ProjectFrontmatter,
): Promise<Map<string, RoadmapItemDocs>> {
  const result = new Map<string, RoadmapItemDocs>();

  const itemPromises = items.map(async (item) => {
    const docs: RoadmapItemDocs = {};

    // 1. Check item-level specDoc / planDoc (explicit override in ROADMAP.md)
    if (item.specDoc) {
      const resolved = await checkPath(`${localPath}/${item.specDoc}`);
      if (resolved) docs.spec = resolved;
    }
    if (item.planDoc) {
      const resolved = await checkPath(`${localPath}/${item.planDoc}`);
      if (resolved) docs.plan = resolved;
    }

    // 2. Convention paths (only if not already resolved)
    if (!docs.spec) {
      const itemSpecPaths = [
        `${localPath}/docs/specs/${item.id}-spec.md`,
        `${localPath}/docs/specs/${item.id}.md`,
      ];
      for (const path of itemSpecPaths) {
        const found = await checkPath(path);
        if (found) { docs.spec = found; break; }
      }
    }

    if (!docs.plan) {
      const itemPlanPaths = [
        `${localPath}/docs/plans/${item.id}-plan.md`,
        `${localPath}/docs/plans/${item.id}.md`,
      ];
      for (const path of itemPlanPaths) {
        const found = await checkPath(path);
        if (found) { docs.plan = found; break; }
      }
    }

    // 3. No fallback to project-level — items without their own docs show nothing

    result.set(item.id, docs);
  });

  await Promise.all(itemPromises);
  return result;
}

export function enrichItemsWithDocs(
  items: RoadmapItem[],
  docsMap: Map<string, RoadmapItemDocs>,
): RoadmapItemWithDocs[] {
  return items.map((item) => ({
    ...item,
    docs: docsMap.get(item.id) ?? {},
  }));
}
