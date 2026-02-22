/**
 * constants.ts — Shared constants for Clawchestra.
 *
 * Single source of truth for status values, file names, and other
 * constants used across the codebase. Prefer importing from here
 * rather than repeating inline strings.
 *
 * Phase 5.1 of the Architecture Direction plan.
 */

// ---------------------------------------------------------------------------
// Roadmap item statuses
// ---------------------------------------------------------------------------

/** Valid statuses for a roadmap item. */
export const ROADMAP_ITEM_STATUSES = [
  'pending',
  'up-next',
  'in-progress',
  'complete',
] as const;

export type RoadmapItemStatus = (typeof ROADMAP_ITEM_STATUSES)[number];

// ---------------------------------------------------------------------------
// Project statuses
// ---------------------------------------------------------------------------

/** Valid statuses for a project. */
export const PROJECT_STATUSES = [
  'in-progress',
  'up-next',
  'pending',
  'dormant',
  'archived',
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
