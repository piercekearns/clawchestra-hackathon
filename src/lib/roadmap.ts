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

async function checkPath(path: string): Promise<string | undefined> {
  const exists = await pathExists(path);
  return exists ? path : undefined;
}

/**
 * Resolve doc files for roadmap items.
 * 1. Check frontmatter fields (specDoc / planDoc) first
 * 2. Fall back to convention-based paths
 */
export async function resolveDocFiles(
  localPath: string,
  items: RoadmapItem[],
  frontmatter: ProjectFrontmatter,
): Promise<Map<string, RoadmapItemDocs>> {
  const result = new Map<string, RoadmapItemDocs>();

  // Project-level frontmatter docs (shared across items)
  const projectSpecPath = frontmatter.specDoc
    ? `${localPath}/${frontmatter.specDoc}`
    : undefined;
  const projectPlanPath = frontmatter.planDoc
    ? `${localPath}/${frontmatter.planDoc}`
    : undefined;

  // Convention paths at project level
  const projectConventionPaths = [
    { type: 'spec' as const, paths: [
      `${localPath}/SPEC.md`,
      `${localPath}/docs/specs/SPEC.md`,
    ]},
    { type: 'plan' as const, paths: [
      `${localPath}/PLAN.md`,
      `${localPath}/docs/plans/PLAN.md`,
    ]},
  ];

  // Resolve project-level docs once
  let projectSpec: string | undefined;
  let projectPlan: string | undefined;

  const projectChecks: Promise<void>[] = [];

  if (projectSpecPath) {
    projectChecks.push(
      checkPath(projectSpecPath).then((p) => { projectSpec = p; }),
    );
  }
  if (projectPlanPath) {
    projectChecks.push(
      checkPath(projectPlanPath).then((p) => { projectPlan = p; }),
    );
  }

  await Promise.all(projectChecks);

  // For each item, check item-specific paths, then fall back to project-level
  const itemPromises = items.map(async (item) => {
    const docs: RoadmapItemDocs = {};

    // Item-specific convention paths
    const itemSpecPaths = [
      `${localPath}/docs/specs/${item.id}-spec.md`,
      `${localPath}/docs/specs/${item.id}.md`,
    ];
    const itemPlanPaths = [
      `${localPath}/docs/plans/${item.id}-plan.md`,
      `${localPath}/docs/plans/${item.id}.md`,
    ];

    // Check item-specific paths first
    const checks = await Promise.all([
      ...itemSpecPaths.map(checkPath),
      ...itemPlanPaths.map(checkPath),
    ]);

    const specMatch = checks.slice(0, itemSpecPaths.length).find(Boolean);
    const planMatch = checks.slice(itemSpecPaths.length).find(Boolean);

    docs.spec = specMatch;
    docs.plan = planMatch;

    // Fall back to project-level if no item-specific docs found
    if (!docs.spec && projectSpec) docs.spec = projectSpec;
    if (!docs.plan && projectPlan) docs.plan = projectPlan;

    // Fall back to convention paths if still no matches
    if (!docs.spec && !projectSpecPath) {
      for (const conv of projectConventionPaths) {
        if (conv.type === 'spec' && !docs.spec) {
          for (const path of conv.paths) {
            const found = await checkPath(path);
            if (found) { docs.spec = found; break; }
          }
        }
      }
    }
    if (!docs.plan && !projectPlanPath) {
      for (const conv of projectConventionPaths) {
        if (conv.type === 'plan' && !docs.plan) {
          for (const path of conv.paths) {
            const found = await checkPath(path);
            if (found) { docs.plan = found; break; }
          }
        }
      }
    }

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
