/**
 * Clawchestra Schema
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
  | 'archived';

export type ProjectType = 'project' | 'sub-project' | 'idea';

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
  type: ProjectType;
  priority?: number;
  repo?: string;
  parent?: string;
  lastActivity?: string;
  lastReviewed?: string;
  tags?: string[];
  icon?: string;
  color?: ProjectColor;
  blockedBy?: string;
  nextAction?: string;
  specDoc?: string;
  planDoc?: string;
}

export type GitStatusState = 'clean' | 'uncommitted' | 'unpushed' | 'behind' | 'unknown';

export interface GitStatus {
  state: GitStatusState;
  branch?: string;
  details?: string;
  /** Origin remote URL (auto-detected from git config) */
  remote?: string;
  lastCommitDate?: string;
  lastCommitMessage?: string;
  lastCommitAuthor?: string;
  commitsThisWeek?: number;
  latestTag?: string;
  stashCount: number;
  aheadCount?: number;
  behindCount?: number;
}

export interface ProjectViewModel extends BoardItem {
  id: string;
  /** Absolute path to the PROJECT.md file */
  filePath: string;
  /** Absolute path to the project directory (parent of PROJECT.md) */
  dirPath: string;
  frontmatter: ProjectFrontmatter;
  content: string;
  roadmapFilePath?: string;
  hasRoadmap: boolean;
  changelogFilePath?: string;
  hasChangelog: boolean;
  hasGit: boolean;
  gitStatus?: GitStatus;
  children: ProjectViewModel[];
  isStale: boolean;
  needsReview: boolean;
  /** True if frontmatter.repo is set (GitHub-linked) */
  hasRepo: boolean;
  commitActivity?: {
    lastCommit?: string;
    commitsThisWeek: number;
  };
}

export type RoadmapStatus = 'pending' | 'up-next' | 'in-progress' | 'complete';

export interface RoadmapItem extends BoardItem {
  id: string;
  status: RoadmapStatus;
  /** Optional path to item-specific spec doc (relative to project dir) */
  specDoc?: string;
  /** Optional path to item-specific plan doc (relative to project dir) */
  planDoc?: string;
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

export interface ChangelogEntry {
  id: string;
  title: string;
  completedAt: string;
  summary?: string;
}

export interface ChangelogDocument {
  filePath: string;
  entries: ChangelogEntry[];
}

export const PROJECT_COLUMNS: ColumnDefinition[] = [
  { id: 'in-flight', label: 'In Flight' },
  { id: 'up-next', label: 'Up Next' },
  { id: 'simmering', label: 'Simmering' },
  { id: 'dormant', label: 'Dormant' },
];


export const ROADMAP_COLUMNS: ColumnDefinition[] = [
  { id: 'in-progress', label: 'In Progress' },
  { id: 'up-next', label: 'Up Next' },
  { id: 'pending', label: 'Pending' },
  { id: 'complete', label: 'Complete' },
];

export const VALID_STATUSES = [
  'in-flight',
  'up-next',
  'simmering',
  'dormant',
  'archived',
] as const satisfies readonly ProjectStatus[];

export const VALID_TYPES = [
  'project',
  'sub-project',
  'idea',
] as const satisfies readonly ProjectType[];

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
  if (typeof record.status !== 'string' || !record.status.trim()) {
    errors.push('status is required');
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

  if (record.blockedBy !== undefined && typeof record.blockedBy !== 'string') {
    errors.push('blockedBy must be a string');
  }

  if (record.nextAction !== undefined && typeof record.nextAction !== 'string') {
    errors.push('nextAction must be a string');
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    data: record as unknown as ProjectFrontmatter,
  };
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
