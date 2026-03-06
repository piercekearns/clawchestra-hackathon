/**
 * doc-resolution.ts — Resolves spec/plan doc file paths for roadmap items.
 *
 * Extracted from roadmap.ts in Phase 5.18. These functions are storage-format
 * independent — they work with any item that has an `id`, `specDoc`, and `planDoc`.
 */

import type {
  ProjectFrontmatter,
  RoadmapItem,
  RoadmapItemDocs,
  RoadmapItemWithDocs,
} from './schema';
import { pathExists } from './tauri';

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
