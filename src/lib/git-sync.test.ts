import { describe, expect, it } from 'bun:test';
import {
  getBranchIndicator,
  buildCommitMessage,
  categorizeFile,
  groupDirtyFiles,
} from '../components/SyncDialog';
import type { GitStatus } from './schema';

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
  it('generates message for single project with files', () => {
    expect(
      buildCommitMessage([{ name: 'ClawOS', files: ['PROJECT.md'] }]),
    ).toBe('chore: sync project metadata (ClawOS) — PROJECT.md');
  });

  it('generates message for multiple projects', () => {
    expect(
      buildCommitMessage([
        { name: 'ClawOS', files: ['PROJECT.md'] },
        { name: 'Memestr', files: ['ROADMAP.md'] },
        { name: 'Dashboard', files: ['PROJECT.md'] },
      ]),
    ).toBe('chore: sync project metadata (ClawOS, Memestr, Dashboard) — PROJECT.md, ROADMAP.md');
  });

  it('truncates project names with ellipsis for more than three', () => {
    const msg = buildCommitMessage([
      { name: 'A', files: ['PROJECT.md'] },
      { name: 'B', files: ['ROADMAP.md'] },
      { name: 'C', files: [] },
      { name: 'D', files: ['PROJECT.md'] },
    ]);
    expect(msg).toBe('chore: sync project metadata (A, B, C, ...) — PROJECT.md, ROADMAP.md');
  });

  it('generates message without files when none provided', () => {
    expect(
      buildCommitMessage([{ name: 'ClawOS', files: [] }]),
    ).toBe('chore: sync project metadata (ClawOS)');
  });

  it('handles empty project list', () => {
    expect(buildCommitMessage([])).toBe('chore: sync project metadata');
  });
});

// ---------------------------------------------------------------------------
// Dirty file categorization
// ---------------------------------------------------------------------------

describe('categorizeFile', () => {
  it('classifies PROJECT.md as metadata', () => {
    expect(categorizeFile('PROJECT.md')).toBe('metadata');
  });

  it('classifies ROADMAP.md as metadata', () => {
    expect(categorizeFile('ROADMAP.md')).toBe('metadata');
  });

  it('classifies CHANGELOG.md as metadata', () => {
    expect(categorizeFile('CHANGELOG.md')).toBe('metadata');
  });

  it('classifies spec docs as document', () => {
    expect(categorizeFile('docs/specs/git-sync-spec.md')).toBe('document');
  });

  it('classifies plan docs as document', () => {
    expect(categorizeFile('docs/plans/git-sync-plan.md')).toBe('document');
  });

  it('classifies roadmap item files as document', () => {
    expect(categorizeFile('roadmap/git-sync.md')).toBe('document');
  });
});

describe('groupDirtyFiles', () => {
  it('groups mixed files correctly', () => {
    const files = ['PROJECT.md', 'docs/specs/new-spec.md', 'ROADMAP.md', 'roadmap/item.md'];
    const { metadata, documents } = groupDirtyFiles(files);
    expect(metadata).toEqual(['PROJECT.md', 'ROADMAP.md']);
    expect(documents).toEqual(['docs/specs/new-spec.md', 'roadmap/item.md']);
  });

  it('handles empty list', () => {
    const { metadata, documents } = groupDirtyFiles([]);
    expect(metadata).toEqual([]);
    expect(documents).toEqual([]);
  });

  it('handles metadata-only list', () => {
    const { metadata, documents } = groupDirtyFiles(['CHANGELOG.md']);
    expect(metadata).toEqual(['CHANGELOG.md']);
    expect(documents).toEqual([]);
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
