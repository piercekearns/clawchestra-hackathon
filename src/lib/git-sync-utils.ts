/**
 * Pure utility functions for git-sync operations.
 *
 * Extracted from SyncDialog.tsx so tests and other modules can import
 * without depending on a React component.
 */
import type { DirtyFileCategories, DirtyFileCategory, GitStatus } from './schema';

// ---------------------------------------------------------------------------
// Categorization constants
// CROSS-REFERENCE: These constants mirror src-tauri/src/lib.rs categorization
// (METADATA_FILES, DOCUMENT_FILES, DOCUMENT_DIR_PREFIXES). They are used as a
// frontend fallback when allDirtyFiles is absent. If you add a new category or
// path here, update the Rust constants too.
// ---------------------------------------------------------------------------

const METADATA_FILES = new Set(['PROJECT.md']);
const DOCUMENT_FILES = new Set(['ROADMAP.md', 'CHANGELOG.md']);
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

/** Collect files from selected categories */
export function filesForSelectedCategories(
  categories: DirtyFileCategories,
  selected: Set<DirtyFileCategory>,
): string[] {
  const files: string[] = [];
  if (selected.has('metadata')) files.push(...categories.metadata);
  if (selected.has('documents')) files.push(...categories.documents);
  if (selected.has('code')) files.push(...categories.code);
  return files;
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
  return { label: `${git.branch} ✓`, safe: true };
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
