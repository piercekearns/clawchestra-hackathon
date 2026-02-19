import { describe, expect, it } from 'bun:test';
import {
  getBranchIndicator,
  buildCommitMessage,
  categorizeFile,
  groupDirtyFiles,
  getProjectDirtyCategories,
  filesForSelectedCategories,
} from './git-sync-utils';
import type { DirtyFileCategory, GitStatus } from './schema';

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

  it('returns safe + checkmark for in-sync branch', () => {
    const result = getBranchIndicator({
      ...baseGit,
      aheadCount: 0,
      behindCount: 0,
    });
    expect(result.safe).toBe(true);
    expect(result.label).toContain('✓');
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
    expect(result.label).toContain('feature-x');
    expect(result.label).toContain('✓');
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
        files: ['PROJECT.md'],
        categories: new Set<DirtyFileCategory>(['metadata']),
      }]),
    ).toBe('chore: sync project metadata (ClawOS) — PROJECT.md');
  });

  it('generates docs-only message', () => {
    expect(
      buildCommitMessage([{
        name: 'ClawOS',
        files: ['ROADMAP.md'],
        categories: new Set<DirtyFileCategory>(['documents']),
      }]),
    ).toBe('docs: update project docs (ClawOS) — ROADMAP.md');
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
        files: ['PROJECT.md', 'src/App.tsx'],
        categories: new Set<DirtyFileCategory>(['metadata', 'code']),
      }]),
    ).toBe('chore: sync project changes (ClawOS) — PROJECT.md, src/App.tsx');
  });

  it('generates message for multiple projects', () => {
    expect(
      buildCommitMessage([
        { name: 'ClawOS', files: ['PROJECT.md'], categories: new Set<DirtyFileCategory>(['metadata']) },
        { name: 'Memestr', files: ['ROADMAP.md'], categories: new Set<DirtyFileCategory>(['documents']) },
        { name: 'Dashboard', files: ['PROJECT.md'], categories: new Set<DirtyFileCategory>(['metadata']) },
      ]),
    ).toBe('chore: sync project changes (ClawOS, Memestr, Dashboard) — PROJECT.md, ROADMAP.md');
  });

  it('truncates project names with ellipsis for more than three', () => {
    const cats = new Set<DirtyFileCategory>(['metadata']);
    const msg = buildCommitMessage([
      { name: 'A', files: ['PROJECT.md'], categories: cats },
      { name: 'B', files: ['PROJECT.md'], categories: cats },
      { name: 'C', files: [], categories: cats },
      { name: 'D', files: ['PROJECT.md'], categories: cats },
    ]);
    expect(msg).toBe('chore: sync project metadata (A, B, C, ...) — PROJECT.md');
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

  it('classifies ROADMAP.md as documents', () => {
    expect(categorizeFile('ROADMAP.md')).toBe('documents');
  });

  it('classifies CHANGELOG.md as documents', () => {
    expect(categorizeFile('CHANGELOG.md')).toBe('documents');
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
});

describe('groupDirtyFiles', () => {
  it('groups mixed files into three categories', () => {
    const files = [
      'PROJECT.md',
      'docs/specs/new-spec.md',
      'ROADMAP.md',
      'roadmap/item.md',
      'src/App.tsx',
      'package.json',
    ];
    const { metadata, documents, code } = groupDirtyFiles(files);
    expect(metadata).toEqual(['PROJECT.md']);
    expect(documents).toEqual(['docs/specs/new-spec.md', 'ROADMAP.md', 'roadmap/item.md']);
    expect(code).toEqual(['src/App.tsx', 'package.json']);
  });

  it('handles empty list', () => {
    const { metadata, documents, code } = groupDirtyFiles([]);
    expect(metadata).toEqual([]);
    expect(documents).toEqual([]);
    expect(code).toEqual([]);
  });

  it('handles documents-only list', () => {
    const { metadata, documents, code } = groupDirtyFiles(['CHANGELOG.md']);
    expect(metadata).toEqual([]);
    expect(documents).toEqual(['CHANGELOG.md']);
    expect(code).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getProjectDirtyCategories / filesForSelectedCategories
// ---------------------------------------------------------------------------

describe('getProjectDirtyCategories', () => {
  it('uses allDirtyFiles from backend when available', () => {
    const git: GitStatus = {
      state: 'uncommitted',
      stashCount: 0,
      allDirtyFiles: {
        metadata: ['PROJECT.md'],
        documents: ['ROADMAP.md'],
        code: ['src/main.ts'],
      },
      dirtyFiles: ['PROJECT.md'], // legacy — should be ignored
    };
    const cats = getProjectDirtyCategories(git);
    expect(cats.metadata).toEqual(['PROJECT.md']);
    expect(cats.documents).toEqual(['ROADMAP.md']);
    expect(cats.code).toEqual(['src/main.ts']);
  });

  it('falls back to frontend categorization for legacy data', () => {
    const git: GitStatus = {
      state: 'uncommitted',
      stashCount: 0,
      dirtyFiles: ['PROJECT.md', 'src/App.tsx'],
    };
    const cats = getProjectDirtyCategories(git);
    expect(cats.metadata).toEqual(['PROJECT.md']);
    expect(cats.code).toEqual(['src/App.tsx']);
  });
});

describe('filesForSelectedCategories', () => {
  const cats = {
    metadata: ['PROJECT.md'],
    documents: ['ROADMAP.md', 'roadmap/item.md'],
    code: ['src/App.tsx'],
  };

  it('returns files for selected categories only', () => {
    const selected = new Set<DirtyFileCategory>(['metadata', 'documents']);
    expect(filesForSelectedCategories(cats, selected)).toEqual([
      'PROJECT.md',
      'ROADMAP.md',
      'roadmap/item.md',
    ]);
  });

  it('returns empty array when nothing selected', () => {
    expect(filesForSelectedCategories(cats, new Set())).toEqual([]);
  });

  it('returns all files when all categories selected', () => {
    const selected = new Set<DirtyFileCategory>(['metadata', 'documents', 'code']);
    expect(filesForSelectedCategories(cats, selected)).toEqual([
      'PROJECT.md',
      'ROADMAP.md',
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
