import { describe, expect, it } from 'bun:test';
import {
  getBranchIndicator,
  getTargetBranchIndicator,
  buildCommitMessage,
  categorizeFile,
  groupDirtyFiles,
  getProjectDirtyCategories,
  filesForSelectedCategories,
  parseGitError,
} from './git-sync-utils';
import type { DirtyFileCategory, DirtyFileEntry, GitBranchState, GitStatus } from './schema';

/** Helper: create a DirtyFileEntry with default 'modified' status */
function entry(path: string, status: DirtyFileEntry['status'] = 'modified'): DirtyFileEntry {
  return { path, status };
}

// ---------------------------------------------------------------------------
// getBranchIndicator
// ---------------------------------------------------------------------------

describe('getBranchIndicator', () => {
  const baseGit: GitStatus = {
    state: 'clean',
    branch: 'main',
    remote: 'https://github.com/user/repo.git',
    stashCount: 0,
  };

  it('returns safe for in-sync branch', () => {
    const result = getBranchIndicator({
      ...baseGit,
      aheadCount: 0,
      behindCount: 0,
    });
    expect(result.safe).toBe(true);
    expect(result.label).toBe('main');
  });

  it('returns safe for ahead-only branch', () => {
    const result = getBranchIndicator({
      ...baseGit,
      aheadCount: 3,
      behindCount: 0,
    });
    expect(result.safe).toBe(true);
    expect(result.label).toContain('↑3');
    expect(result.label).not.toContain('↓');
  });

  it('returns unsafe for behind branch', () => {
    const result = getBranchIndicator({
      ...baseGit,
      aheadCount: 0,
      behindCount: 5,
    });
    expect(result.safe).toBe(false);
    expect(result.label).toContain('↓5');
    expect(result.label).toContain('⚠');
  });

  it('returns unsafe for diverged branch (ahead + behind)', () => {
    const result = getBranchIndicator({
      ...baseGit,
      aheadCount: 2,
      behindCount: 3,
    });
    expect(result.safe).toBe(false);
    expect(result.label).toContain('↑2');
    expect(result.label).toContain('↓3');
    expect(result.label).toContain('⚠');
  });

  it('returns safe with local label when no remote', () => {
    const result = getBranchIndicator({
      ...baseGit,
      remote: undefined,
    });
    expect(result.safe).toBe(true);
    expect(result.label).toContain('(local)');
  });

  it('handles non-default branch name', () => {
    const result = getBranchIndicator({
      ...baseGit,
      branch: 'feature-x',
      aheadCount: 0,
      behindCount: 0,
    });
    expect(result.safe).toBe(true);
    expect(result.label).toBe('feature-x');
  });
});

describe('getTargetBranchIndicator', () => {
  const baseBranch: GitBranchState = {
    name: 'staging',
    isCurrent: false,
    hasUpstream: true,
    aheadCount: 0,
    behindCount: 0,
    diverged: false,
    localOnly: false,
  };

  it('formats in-sync target branch', () => {
    const result = getTargetBranchIndicator(baseBranch);
    expect(result.safe).toBe(true);
    expect(result.label).toBe('staging');
  });

  it('formats behind target branch as unsafe', () => {
    const result = getTargetBranchIndicator({
      ...baseBranch,
      behindCount: 2,
    });
    expect(result.safe).toBe(false);
    expect(result.label).toContain('↓2');
    expect(result.label).toContain('⚠');
  });

  it('formats diverged target branch', () => {
    const result = getTargetBranchIndicator({
      ...baseBranch,
      aheadCount: 3,
      behindCount: 1,
      diverged: true,
    });
    expect(result.safe).toBe(false);
    expect(result.label).toContain('↑3');
    expect(result.label).toContain('↓1');
  });

  it('formats local-only target branch', () => {
    const result = getTargetBranchIndicator({
      ...baseBranch,
      hasUpstream: false,
      localOnly: true,
    });
    expect(result.safe).toBe(true);
    expect(result.label).toContain('(local)');
  });
});

// ---------------------------------------------------------------------------
// Smart push defaults
// ---------------------------------------------------------------------------

describe('smart push defaults', () => {
  // Push defaults logic: safe branches get push enabled, unsafe get push disabled.
  // This tests the logic that SyncDialog uses in its useEffect.

  function shouldDefaultPushEnabled(git: GitStatus): boolean {
    const { safe } = getBranchIndicator(git);
    return safe;
  }

  const baseGit: GitStatus = {
    state: 'clean',
    branch: 'main',
    remote: 'https://github.com/user/repo.git',
    stashCount: 0,
  };

  it('push enabled for in-sync branch', () => {
    expect(shouldDefaultPushEnabled({ ...baseGit, aheadCount: 0, behindCount: 0 })).toBe(true);
  });

  it('push enabled for ahead branch', () => {
    expect(shouldDefaultPushEnabled({ ...baseGit, aheadCount: 2, behindCount: 0 })).toBe(true);
  });

  it('push disabled for behind branch', () => {
    expect(shouldDefaultPushEnabled({ ...baseGit, aheadCount: 0, behindCount: 3 })).toBe(false);
  });

  it('push disabled for diverged branch', () => {
    expect(shouldDefaultPushEnabled({ ...baseGit, aheadCount: 1, behindCount: 2 })).toBe(false);
  });

  it('push default safe=true when no remote (but push UI hidden by remote check)', () => {
    // safe=true for no-remote, but push toggle never renders because git.remote is falsy
    expect(shouldDefaultPushEnabled({ ...baseGit, remote: undefined })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Default commit message generation
// ---------------------------------------------------------------------------

describe('default commit message', () => {
  it('generates metadata-only message', () => {
    expect(
      buildCommitMessage([{
        name: 'ClawOS',
        files: ['CLAWCHESTRA.md'],
        categories: new Set<DirtyFileCategory>(['metadata']),
      }]),
    ).toBe('chore: sync project metadata (ClawOS) — CLAWCHESTRA.md');
  });

  it('generates docs-only message', () => {
    expect(
      buildCommitMessage([{
        name: 'ClawOS',
        files: ['docs/specs/feature-spec.md'],
        categories: new Set<DirtyFileCategory>(['documents']),
      }]),
    ).toBe('docs: update project docs (ClawOS) — docs/specs/feature-spec.md');
  });

  it('generates code-only message', () => {
    expect(
      buildCommitMessage([{
        name: 'ClawOS',
        files: ['src/App.tsx'],
        categories: new Set<DirtyFileCategory>(['code']),
      }]),
    ).toBe('chore: sync code changes (ClawOS) — src/App.tsx');
  });

  it('generates mixed-category message', () => {
    expect(
      buildCommitMessage([{
        name: 'ClawOS',
        files: ['CLAWCHESTRA.md', 'src/App.tsx'],
        categories: new Set<DirtyFileCategory>(['metadata', 'code']),
      }]),
    ).toBe('chore: sync project changes (ClawOS) — CLAWCHESTRA.md, src/App.tsx');
  });

  it('generates message for multiple projects', () => {
    expect(
      buildCommitMessage([
        { name: 'ClawOS', files: ['CLAWCHESTRA.md'], categories: new Set<DirtyFileCategory>(['metadata']) },
        { name: 'Memestr', files: ['roadmap/feature.md'], categories: new Set<DirtyFileCategory>(['documents']) },
        { name: 'Dashboard', files: ['CLAWCHESTRA.md'], categories: new Set<DirtyFileCategory>(['metadata']) },
      ]),
    ).toBe('chore: sync project changes (ClawOS, Memestr, Dashboard) — CLAWCHESTRA.md, roadmap/feature.md');
  });

  it('truncates project names with ellipsis for more than three', () => {
    const cats = new Set<DirtyFileCategory>(['metadata']);
    const msg = buildCommitMessage([
      { name: 'A', files: ['CLAWCHESTRA.md'], categories: cats },
      { name: 'B', files: ['CLAWCHESTRA.md'], categories: cats },
      { name: 'C', files: [], categories: cats },
      { name: 'D', files: ['CLAWCHESTRA.md'], categories: cats },
    ]);
    expect(msg).toBe('chore: sync project metadata (A, B, C, ...) — CLAWCHESTRA.md');
  });

  it('generates message without files when none provided', () => {
    expect(
      buildCommitMessage([{
        name: 'ClawOS',
        files: [],
        categories: new Set<DirtyFileCategory>(['metadata']),
      }]),
    ).toBe('chore: sync project metadata (ClawOS)');
  });

  it('handles empty project list', () => {
    expect(buildCommitMessage([])).toBe('chore: sync project changes');
  });
});

// ---------------------------------------------------------------------------
// Dirty file categorization
// ---------------------------------------------------------------------------

describe('categorizeFile', () => {
  it('classifies PROJECT.md as metadata', () => {
    expect(categorizeFile('PROJECT.md')).toBe('metadata');
  });

  it('classifies CLAWCHESTRA.md as metadata', () => {
    expect(categorizeFile('CLAWCHESTRA.md')).toBe('metadata');
  });

  it('classifies ROADMAP.md as code (removed from DOCUMENT_FILES post-migration)', () => {
    expect(categorizeFile('ROADMAP.md')).toBe('code');
  });

  it('classifies CHANGELOG.md as code (removed from DOCUMENT_FILES post-migration)', () => {
    expect(categorizeFile('CHANGELOG.md')).toBe('code');
  });

  it('classifies spec docs as documents', () => {
    expect(categorizeFile('docs/specs/git-sync-spec.md')).toBe('documents');
  });

  it('classifies plan docs as documents', () => {
    expect(categorizeFile('docs/plans/git-sync-plan.md')).toBe('documents');
  });

  it('classifies roadmap item files as documents', () => {
    expect(categorizeFile('roadmap/git-sync.md')).toBe('documents');
  });

  it('classifies source files as code', () => {
    expect(categorizeFile('src/App.tsx')).toBe('code');
  });

  it('classifies config files as code', () => {
    expect(categorizeFile('package.json')).toBe('code');
  });

  it('classifies README as code', () => {
    expect(categorizeFile('README.md')).toBe('code');
  });

  it('classifies nested doc paths as documents', () => {
    expect(categorizeFile('docs/specs/sub/deeply-nested.md')).toBe('documents');
    expect(categorizeFile('docs/plans/v2/refactor-plan.md')).toBe('documents');
    expect(categorizeFile('roadmap/sub/item.md')).toBe('documents');
  });
});

describe('groupDirtyFiles', () => {
  it('groups mixed files into three categories', () => {
    const files = [
      'CLAWCHESTRA.md',
      'docs/specs/new-spec.md',
      'roadmap/item.md',
      'src/App.tsx',
      'package.json',
    ];
    const { metadata, documents, code } = groupDirtyFiles(files);
    expect(metadata).toEqual(['CLAWCHESTRA.md']);
    expect(documents).toEqual(['docs/specs/new-spec.md', 'roadmap/item.md']);
    expect(code).toEqual(['src/App.tsx', 'package.json']);
  });

  it('handles empty list', () => {
    const { metadata, documents, code } = groupDirtyFiles([]);
    expect(metadata).toEqual([]);
    expect(documents).toEqual([]);
    expect(code).toEqual([]);
  });

  it('handles code-only list (CHANGELOG.md is now code)', () => {
    const { metadata, documents, code } = groupDirtyFiles(['CHANGELOG.md']);
    expect(metadata).toEqual([]);
    expect(documents).toEqual([]);
    expect(code).toEqual(['CHANGELOG.md']);
  });
});

// ---------------------------------------------------------------------------
// getProjectDirtyCategories / filesForSelectedCategories
// ---------------------------------------------------------------------------

describe('getProjectDirtyCategories', () => {
  it('returns allDirtyFiles from backend when available', () => {
    const git: GitStatus = {
      state: 'uncommitted',
      stashCount: 0,
      allDirtyFiles: {
        metadata: [entry('CLAWCHESTRA.md')],
        documents: [entry('roadmap/feature.md')],
        code: [entry('src/main.ts')],
      },
    };
    const cats = getProjectDirtyCategories(git);
    expect(cats.metadata).toEqual([entry('CLAWCHESTRA.md')]);
    expect(cats.documents).toEqual([entry('roadmap/feature.md')]);
    expect(cats.code).toEqual([entry('src/main.ts')]);
  });

  it('returns empty categories when allDirtyFiles is undefined', () => {
    const git: GitStatus = {
      state: 'uncommitted',
      stashCount: 0,
    };
    const cats = getProjectDirtyCategories(git);
    expect(cats.metadata).toEqual([]);
    expect(cats.documents).toEqual([]);
    expect(cats.code).toEqual([]);
  });

  it('handles nested document paths correctly', () => {
    const git: GitStatus = {
      state: 'uncommitted',
      stashCount: 0,
      allDirtyFiles: {
        metadata: [],
        documents: [entry('docs/specs/deeply/nested/spec.md'), entry('docs/plans/sub/plan.md')],
        code: [],
      },
    };
    const cats = getProjectDirtyCategories(git);
    expect(cats.documents).toEqual([
      entry('docs/specs/deeply/nested/spec.md'),
      entry('docs/plans/sub/plan.md'),
    ]);
  });
});

describe('filesForSelectedCategories', () => {
  const cats = {
    metadata: [entry('CLAWCHESTRA.md')],
    documents: [entry('docs/specs/feature-spec.md'), entry('roadmap/item.md')],
    code: [entry('src/App.tsx')],
  };

  it('returns file paths for selected categories only', () => {
    const selected = new Set<DirtyFileCategory>(['metadata', 'documents']);
    expect(filesForSelectedCategories(cats, selected)).toEqual([
      'CLAWCHESTRA.md',
      'docs/specs/feature-spec.md',
      'roadmap/item.md',
    ]);
  });

  it('returns empty array when nothing selected', () => {
    expect(filesForSelectedCategories(cats, new Set())).toEqual([]);
  });

  it('returns all file paths when all categories selected', () => {
    const selected = new Set<DirtyFileCategory>(['metadata', 'documents', 'code']);
    expect(filesForSelectedCategories(cats, selected)).toEqual([
      'CLAWCHESTRA.md',
      'docs/specs/feature-spec.md',
      'roadmap/item.md',
      'src/App.tsx',
    ]);
  });
});

// ---------------------------------------------------------------------------
// SyncResult handling
// ---------------------------------------------------------------------------

describe('SyncResult type', () => {
  // These are structural tests to verify the shape works correctly.
  // The actual sync execution is an integration concern.

  it('represents a successful commit+push', () => {
    const result = { projectId: 'clawos', success: true, hash: 'abc1234', pushed: true };
    expect(result.success).toBe(true);
    expect(result.hash).toBe('abc1234');
    expect(result.pushed).toBe(true);
  });

  it('represents a commit-only success', () => {
    const result = { projectId: 'memestr', success: true, hash: 'def5678', pushed: false };
    expect(result.success).toBe(true);
    expect(result.pushed).toBe(false);
  });

  it('represents a failure', () => {
    const result = { projectId: 'fail', success: false, error: 'git push failed: rejected' };
    expect(result.success).toBe(false);
    expect(result.error).toContain('rejected');
  });
});

// ---------------------------------------------------------------------------
// parseGitError
// ---------------------------------------------------------------------------
describe('parseGitError', () => {
  it('parses modify/delete conflict', () => {
    const raw = `CONFLICT (modify/delete): ROADMAP.md deleted in HEAD and modified in abc1234
error: could not apply abc1234... chore: sync
hint: after resolving the conflicts, mark the corrected paths`;
    const result = parseGitError(raw);
    expect(result).toContain('ROADMAP.md');
    expect(result).toContain('deleted');
  });

  it('parses content conflict', () => {
    const raw = `Auto-merging src/App.tsx
CONFLICT (content): Merge conflict in src/App.tsx
error: could not apply abc1234`;
    const result = parseGitError(raw);
    expect(result).toContain('src/App.tsx');
  });

  it('falls back to error line when no CONFLICT', () => {
    const raw = `error: could not apply abc1234... commit message
hint: after resolving the conflicts`;
    expect(parseGitError(raw)).toContain('could not apply');
  });

  it('returns unknown for empty input', () => {
    expect(parseGitError('')).toBe('Unknown error');
  });
});
