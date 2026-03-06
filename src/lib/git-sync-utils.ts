/**
 * Pure utility functions for git-sync operations.
 *
 * Extracted from SyncDialog.tsx so tests and other modules can import
 * without depending on a React component.
 */
import type {
  DirtyFileCategories,
  DirtyFileCategory,
  DirtyFileEntry,
  GitBranchState,
  GitStatus,
} from './schema';

// ---------------------------------------------------------------------------
// Categorization constants
// CROSS-REFERENCE: These constants mirror src-tauri/src/lib.rs categorization
// (METADATA_FILES, DOCUMENT_FILES, DOCUMENT_DIR_PREFIXES). They are used as a
// frontend fallback when allDirtyFiles is absent. If you add a new category or
// path here, update the Rust constants too.
// ---------------------------------------------------------------------------

const METADATA_FILES = new Set(['CLAWCHESTRA.md', 'PROJECT.md']);
// NOTE: ROADMAP.md and CHANGELOG.md removed post-migration (data lives in .clawchestra/state.json and db.json now)
const DOCUMENT_FILES = new Set<string>([]);
const DOCUMENT_DIR_PREFIXES = ['roadmap/', 'docs/specs/', 'docs/plans/'];

// ---------------------------------------------------------------------------
// Categorization helpers
// ---------------------------------------------------------------------------

export function categorizeFile(path: string): DirtyFileCategory {
  if (METADATA_FILES.has(path)) return 'metadata';
  if (DOCUMENT_FILES.has(path) || DOCUMENT_DIR_PREFIXES.some((p) => path.startsWith(p)))
    return 'documents';
  return 'code';
}

export function groupDirtyFiles(
  files: string[],
): { metadata: string[]; documents: string[]; code: string[] } {
  const metadata: string[] = [];
  const documents: string[] = [];
  const code: string[] = [];
  for (const f of files) {
    const cat = categorizeFile(f);
    if (cat === 'metadata') metadata.push(f);
    else if (cat === 'documents') documents.push(f);
    else code.push(f);
  }
  return { metadata, documents, code };
}

/** Get categorized dirty files from backend data */
export function getProjectDirtyCategories(
  git: GitStatus,
): DirtyFileCategories {
  return git.allDirtyFiles ?? { metadata: [], documents: [], code: [] };
}

/** Collect file paths from selected categories (for commit operations) */
export function filesForSelectedCategories(
  categories: DirtyFileCategories,
  selected: Set<DirtyFileCategory>,
): string[] {
  const entries: DirtyFileEntry[] = [];
  if (selected.has('metadata')) entries.push(...categories.metadata);
  if (selected.has('documents')) entries.push(...categories.documents);
  if (selected.has('code')) entries.push(...categories.code);
  return entries.map((e) => e.path);
}

// ---------------------------------------------------------------------------
// Branch indicator
// ---------------------------------------------------------------------------

export function getBranchIndicator(git: GitStatus): { label: string; safe: boolean } {
  if (!git.remote) return { label: `${git.branch ?? '?'} (local)`, safe: true };
  const ahead = git.aheadCount ?? 0;
  const behind = git.behindCount ?? 0;
  if (ahead > 0 && behind > 0)
    return { label: `${git.branch} ↑${ahead} ↓${behind} ⚠`, safe: false };
  if (behind > 0) return { label: `${git.branch} ↓${behind} ⚠`, safe: false };
  if (ahead > 0) return { label: `${git.branch} ↑${ahead}`, safe: true };
  return { label: `${git.branch}`, safe: true };
}

export function getTargetBranchIndicator(branch: GitBranchState): { label: string; safe: boolean } {
  if (branch.localOnly) return { label: `${branch.name} (local)`, safe: true };
  if (branch.diverged) {
    return {
      label: `${branch.name} ↑${branch.aheadCount} ↓${branch.behindCount} ⚠`,
      safe: false,
    };
  }
  if (branch.behindCount > 0) return { label: `${branch.name} ↓${branch.behindCount} ⚠`, safe: false };
  if (branch.aheadCount > 0) return { label: `${branch.name} ↑${branch.aheadCount}`, safe: true };
  return { label: `${branch.name}`, safe: true };
}

// ---------------------------------------------------------------------------
// Branch sync execution state (shared with SyncDialog + App)
// ---------------------------------------------------------------------------

export type BranchSyncStep =
  | 'source-commit'
  | 'pull-first'
  | 'source-push'
  | 'target-cherry-pick'
  | 'target-complete'
  | 'conflict'
  | 'failed'
  | 'resume-after-conflict';

const VALID_STEPS = new Set<BranchSyncStep>([
  'source-commit', 'pull-first', 'source-push',
  'target-cherry-pick', 'target-complete',
  'conflict', 'failed', 'resume-after-conflict',
]);

export interface BranchSyncExecutionState {
  projectId: string;
  sourceBranch: string;
  commitHash?: string;
  completedTargets: string[];
  remainingTargets: string[];
  currentStep: BranchSyncStep;
  currentTarget?: string;
  targetPushBranches?: string[];
  sourcePushEnabled?: boolean;
  sourcePushed?: boolean;
  pendingStashRef?: string;
  errorMessage?: string;
  conflictFiles?: string[];
  updatedAt: number;
}

export function executionStateKey(projectId: string): string {
  return `clawchestra:branch-sync:${projectId}`;
}

export function readExecutionState(projectId: string): BranchSyncExecutionState | null {
  try {
    const raw = localStorage.getItem(executionStateKey(projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BranchSyncExecutionState;
    // Structural validation — treat malformed data as corrupted
    if (
      typeof parsed !== 'object' || parsed === null
      || typeof parsed.projectId !== 'string'
      || typeof parsed.sourceBranch !== 'string'
      || !VALID_STEPS.has(parsed.currentStep)
      || !Array.isArray(parsed.completedTargets)
      || !Array.isArray(parsed.remainingTargets)
      || typeof parsed.updatedAt !== 'number'
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeExecutionState(projectId: string, state: BranchSyncExecutionState): void {
  try {
    localStorage.setItem(executionStateKey(projectId), JSON.stringify(state));
  } catch {
    // localStorage failures should not block sync execution
  }
}

export function clearExecutionState(projectId: string): void {
  try {
    localStorage.removeItem(executionStateKey(projectId));
  } catch {
    // no-op
  }
}

export function isFailedSyncStep(step: BranchSyncStep): boolean {
  return step === 'conflict' || step === 'failed';
}

// ---------------------------------------------------------------------------
// Commit message generation
// ---------------------------------------------------------------------------

export const CATEGORY_LABELS: Record<DirtyFileCategory, string> = {
  metadata: 'Metadata',
  documents: 'Documents',
  code: 'Code',
};

export function buildCommitMessage(
  projects: { name: string; files: string[]; categories: Set<DirtyFileCategory> }[],
): string {
  if (projects.length === 0) return 'chore: sync project changes';

  const nameList =
    projects.length > 3
      ? `${projects.slice(0, 3).map((p) => p.name).join(', ')}, ...`
      : projects.map((p) => p.name).join(', ');

  // Determine which category sets are active across all projects
  const allCategories = new Set<DirtyFileCategory>();
  for (const p of projects) {
    for (const c of p.categories) allCategories.add(c);
  }

  const allFiles = [...new Set(projects.flatMap((p) => p.files))];

  // Choose commit prefix based on categories
  let prefix: string;
  if (allCategories.size === 1 && allCategories.has('metadata')) {
    prefix = 'chore: sync project metadata';
  } else if (allCategories.size === 1 && allCategories.has('documents')) {
    prefix = 'docs: update project docs';
  } else if (allCategories.size === 1 && allCategories.has('code')) {
    prefix = 'chore: sync code changes';
  } else {
    prefix = 'chore: sync project changes';
  }

  const filePart =
    allFiles.length > 0 && allFiles.length <= 4
      ? ` — ${allFiles.join(', ')}`
      : allFiles.length > 4
        ? ` — ${allFiles.slice(0, 3).join(', ')}, +${allFiles.length - 3} more`
        : '';

  return `${prefix} (${nameList})${filePart}`;
}

// ---------------------------------------------------------------------------
// Git error parsing — extract human-readable summary from raw git output
// ---------------------------------------------------------------------------

/**
 * Parse raw git cherry-pick / merge error output into a one-line human summary.
 * Falls back to first non-hint, non-empty line if no pattern matches.
 */
export function parseGitError(raw: string): string {
  if (!raw) return 'Unknown error';

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  // CONFLICT lines are the most informative
  const conflictLines = lines.filter((l) => l.startsWith('CONFLICT'));
  if (conflictLines.length > 0) {
    const summaries: string[] = [];

    for (const line of conflictLines) {
      // CONFLICT (modify/delete): FILE deleted in HEAD and modified in HASH
      const modDelete = line.match(/CONFLICT \(modify\/delete\):\s*(\S+)\s+deleted in (.+?) and modified in/);
      if (modDelete) {
        summaries.push(`${modDelete[1]} was deleted on one branch but modified on the other`);
        continue;
      }
      // CONFLICT (content): Merge conflict in FILE
      const content = line.match(/CONFLICT \(content\):\s*Merge conflict in\s+(\S+)/);
      if (content) {
        summaries.push(`${content[1]} has conflicting changes on both branches`);
        continue;
      }
      // CONFLICT (add/add): Merge conflict in FILE
      const addAdd = line.match(/CONFLICT \(add\/add\):\s*Merge conflict in\s+(\S+)/);
      if (addAdd) {
        summaries.push(`${addAdd[1]} was added on both branches with different content`);
        continue;
      }
      // Generic CONFLICT (type): rest of message
      const generic = line.match(/CONFLICT \(([^)]+)\):\s*(.*)/);
      if (generic) {
        summaries.push(generic[2]);
      }
    }

    if (summaries.length === 1) return summaries[0];
    if (summaries.length > 1) return `${summaries.length} conflicts: ${summaries.join('; ')}`;
  }

  // error: lines next
  const errorLine = lines.find((l) => l.startsWith('error:'));
  if (errorLine) return errorLine.replace(/^error:\s*/, '');

  // Fallback: first non-hint line
  return lines.find((l) => !l.startsWith('hint:')) ?? 'Unknown error';
}
