/**
 * Pipeline Dashboard Schema
 * 
 * IMPORTANT: Keep docs/AGENTS.md and docs/SCHEMA.md in sync with this file.
 * 
 * If you change:
 * - Status values (ProjectStatus) → update AGENTS.md status definitions
 * - Required fields → update AGENTS.md field requirements table
 * - Validation rules → update AGENTS.md accordingly
 * - New fields → add to SCHEMA.md and AGENTS.md if agent-relevant
 */

import { differenceInDays, parseISO } from 'date-fns';

export type ProjectStatus =
  | 'in-flight'
  | 'up-next'
  | 'simmering'
  | 'dormant'
  | 'shipped';

export type ProjectType = 'project' | 'sub-project' | 'idea' | 'deliverable';
export type ProjectTrackingMode = 'linked' | 'catalog-only';

export type ProjectColor =
  | 'blue'
  | 'green'
  | 'yellow'
  | 'red'
  | 'purple'
  | 'gray';

export type ThemePreference = 'system' | 'light' | 'dark';

export interface BoardItem {
  id: string;
  title: string;
  status: string;
  priority?: number;
  icon?: string;
  nextAction?: string;
  blockedBy?: string;
  tags?: string[];
}

export interface ColumnDefinition {
  id: string;
  label: string;
  color?: string;
}

export interface ProjectFrontmatter {
  id?: string;
  title: string;
  status?: ProjectStatus;
  trackingMode?: ProjectTrackingMode;
  catalogVersion?: number;
  type: ProjectType;
  priority?: number;
  localPath?: string;
  statusFile?: string;
  repo?: string;
  parent?: string;
  lastActivity?: string;
  lastReviewed?: string;
  tags?: string[];
  icon?: string;
  color?: ProjectColor;
  blockedBy?: string;
  nextAction?: string;
  cachedStatus?: ProjectStatus;
  cachedNextAction?: string;
  cachedGitStatus?: string;
  cachedBranch?: string;
  cacheUpdatedAt?: string;
  specDoc?: string;    // Path to specification document
  planDoc?: string;    // Path to planning document
}

export interface RepoStatus {
  title?: string;
  status?: ProjectStatus;
  nextAction?: string;
  blockedBy?: string;
  lastActivity?: string;
}

export type GitStatusState = 'clean' | 'uncommitted' | 'unpushed' | 'behind' | 'unknown';

export interface GitStatus {
  state: GitStatusState;
  branch?: string;
  details?: string;
}

export interface ProjectViewModel extends BoardItem {
  id: string;
  filePath: string;
  frontmatter: ProjectFrontmatter;
  content: string;
  repoStatus?: RepoStatus;
  repoFilePath?: string;
  roadmapFilePath?: string;
  hasRoadmap: boolean;
  gitStatus?: GitStatus;
  children: ProjectViewModel[];
  isStale: boolean;
  needsReview: boolean;
  hasRepo: boolean;
  commitActivity?: {
    lastCommit?: string;
    commitsThisWeek: number;
  };
}

export type RoadmapStatus = 'pending' | 'in-progress' | 'complete';

export interface RoadmapItem extends BoardItem {
  id: string;
  status: RoadmapStatus;
}

export interface RoadmapDocument {
  filePath: string;
  items: RoadmapItem[];
  notes: string;
}

export interface RoadmapItemDocs {
  spec?: string;
  plan?: string;
}

export interface RoadmapItemWithDocs extends RoadmapItem {
  docs: RoadmapItemDocs;
}

export const PROJECT_COLUMNS: ColumnDefinition[] = [
  { id: 'in-flight', label: 'In Flight' },
  { id: 'up-next', label: 'Up Next' },
  { id: 'simmering', label: 'Simmering' },
  { id: 'dormant', label: 'Dormant' },
  { id: 'shipped', label: 'Shipped' },
];

export const ROADMAP_COLUMNS: ColumnDefinition[] = [
  { id: 'pending', label: 'Pending' },
  { id: 'in-progress', label: 'In Progress' },
  { id: 'complete', label: 'Complete' },
];

export const VALID_STATUSES = [
  'in-flight',
  'up-next',
  'simmering',
  'dormant',
  'shipped',
] as const satisfies readonly ProjectStatus[];

export const VALID_TYPES = [
  'project',
  'sub-project',
  'idea',
  'deliverable',
] as const satisfies readonly ProjectType[];
export const VALID_TRACKING_MODES = ['linked', 'catalog-only'] as const satisfies readonly ProjectTrackingMode[];

export const VALID_COLORS = [
  'blue',
  'green',
  'yellow',
  'red',
  'purple',
  'gray',
] as const satisfies readonly ProjectColor[];

export type ValidationResult =
  | { valid: true; data: ProjectFrontmatter }
  | { valid: false; errors: string[] };

export function isProjectStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && VALID_STATUSES.includes(value as ProjectStatus);
}

function resolveTrackingMode(record: Record<string, unknown>): ProjectTrackingMode {
  if (
    typeof record.trackingMode === 'string'
    && VALID_TRACKING_MODES.includes(record.trackingMode as ProjectTrackingMode)
  ) {
    return record.trackingMode as ProjectTrackingMode;
  }

  return typeof record.localPath === 'string' && record.localPath.trim().length > 0
    ? 'linked'
    : 'catalog-only';
}

export function validateProject(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (typeof data !== 'object' || data === null) {
    return { valid: false, errors: ['frontmatter is not an object'] };
  }

  const record = data as Record<string, unknown>;

  if (typeof record.title !== 'string' || !record.title.trim()) {
    errors.push('title is required');
  }
  if (typeof record.type !== 'string' || !record.type.trim()) {
    errors.push('type is required');
  }

  const trackingMode = resolveTrackingMode(record);
  if (trackingMode === 'catalog-only') {
    if (typeof record.status !== 'string' || !record.status.trim()) {
      errors.push('status is required for catalog-only projects');
    }
  } else if (trackingMode === 'linked') {
    if (typeof record.localPath !== 'string' || !record.localPath.trim()) {
      errors.push('localPath is required for linked projects');
    }
  }

  if (record.status === 'in-flight' && typeof record.priority !== 'number') {
    errors.push('priority is required for in-flight projects');
  }

  if (record.type === 'sub-project' && typeof record.parent !== 'string') {
    errors.push('parent is required for sub-projects');
  }

  if (typeof record.status === 'string' && !VALID_STATUSES.includes(record.status as ProjectStatus)) {
    errors.push(`invalid status: ${record.status}`);
  }

  if (typeof record.type === 'string' && !VALID_TYPES.includes(record.type as ProjectType)) {
    errors.push(`invalid type: ${record.type}`);
  }

  if (
    record.trackingMode !== undefined
    && (typeof record.trackingMode !== 'string'
      || !VALID_TRACKING_MODES.includes(record.trackingMode as ProjectTrackingMode))
  ) {
    errors.push(`invalid trackingMode: ${String(record.trackingMode)}`);
  }

  if (record.color !== undefined) {
    if (typeof record.color !== 'string' || !VALID_COLORS.includes(record.color as ProjectColor)) {
      errors.push(`invalid color: ${String(record.color)}`);
    }
  }

  if (record.icon !== undefined && typeof record.icon !== 'string') {
    errors.push('icon must be a string');
  }

  if (record.tags !== undefined) {
    if (!Array.isArray(record.tags) || !record.tags.every((tag) => typeof tag === 'string')) {
      errors.push('tags must be an array of strings');
    }
  }

  if (
    record.priority !== undefined &&
    (typeof record.priority !== 'number' || !Number.isFinite(record.priority))
  ) {
    errors.push('priority must be a finite number');
  }

  if (record.localPath !== undefined && typeof record.localPath !== 'string') {
    errors.push('localPath must be a string');
  }

  if (record.statusFile !== undefined && typeof record.statusFile !== 'string') {
    errors.push('statusFile must be a string');
  }

  if (record.blockedBy !== undefined && typeof record.blockedBy !== 'string') {
    errors.push('blockedBy must be a string');
  }

  if (record.nextAction !== undefined && typeof record.nextAction !== 'string') {
    errors.push('nextAction must be a string');
  }

  if (record.cachedStatus !== undefined && !isProjectStatus(record.cachedStatus)) {
    errors.push(`invalid cachedStatus: ${String(record.cachedStatus)}`);
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: {
      ...(record as unknown as ProjectFrontmatter),
      trackingMode,
    },
  };
}

export function validateRepoStatus(data: unknown): RepoStatus | null {
  if (typeof data !== 'object' || data === null) return null;

  const record = data as Record<string, unknown>;
  const result: RepoStatus = {};

  if (typeof record.title === 'string') result.title = record.title;
  if (typeof record.status === 'string') {
    if (!VALID_STATUSES.includes(record.status as ProjectStatus)) return null;
    result.status = record.status as ProjectStatus;
  }
  if (typeof record.nextAction === 'string') result.nextAction = record.nextAction;
  if (record.blockedBy === null || typeof record.blockedBy === 'string') {
    result.blockedBy = record.blockedBy ?? undefined;
  }
  if (typeof record.lastActivity === 'string') result.lastActivity = record.lastActivity;

  return result;
}

export function isStale(lastActivity: string | Date | undefined): boolean {
  if (!lastActivity) return true;

  try {
    // gray-matter can parse YAML dates as Date objects or strings
    const activityDate = lastActivity instanceof Date 
      ? lastActivity 
      : parseISO(lastActivity);
    return differenceInDays(new Date(), activityDate) > 14;
  } catch {
    return true;
  }
}

export function needsReview(lastReviewed: string | Date | undefined): boolean {
  if (!lastReviewed) return true;

  try {
    // gray-matter can parse YAML dates as Date objects or strings
    const reviewDate = lastReviewed instanceof Date 
      ? lastReviewed 
      : parseISO(lastReviewed);
    return differenceInDays(new Date(), reviewDate) > 7;
  } catch {
    return true;
  }
}
