/**
 * roadmap-item-mapper.ts — Converts RoadmapItemState (backend shape) to RoadmapItemWithDocs (UI shape).
 *
 * Phase 5.17: This conversion runs at the UI boundary only — the Zustand store holds
 * RoadmapItemState[] (the backend shape). Components that render the kanban board
 * call mapToRoadmapItemsWithDocs() to get the UI-ready shape.
 *
 * Priority default: items without an explicit priority get `Infinity` for sort ordering
 * (pushes them to the bottom of their column). This value MUST NOT be written back to
 * state.json or db.json — it is not valid JSON or z.number().int().
 */

import type { RoadmapItemState } from './state-json';
import type { RoadmapItemWithDocs } from './schema';

/** Convert a single RoadmapItemState to RoadmapItemWithDocs. */
export function mapStateToRoadmapItem(item: RoadmapItemState): RoadmapItemWithDocs {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority ?? Infinity,
    icon: item.icon ?? undefined,
    nextAction: item.nextAction ?? undefined,
    blockedBy: item.blockedBy ?? undefined,
    tags: item.tags ?? undefined,
    specDoc: item.specDoc ?? undefined,
    planDoc: item.planDoc ?? undefined,
    docs: {},
  };
}

/** Convert an array of RoadmapItemState to RoadmapItemWithDocs[], sorted by priority. */
export function mapToRoadmapItemsWithDocs(
  items: RoadmapItemState[],
): RoadmapItemWithDocs[] {
  return items
    .map(mapStateToRoadmapItem)
    .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity));
}
