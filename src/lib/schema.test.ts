import { describe, expect, it } from 'bun:test';
import {
  isStale,
  needsReview,
  validateProject,
  validateRepoStatus,
} from './schema';

describe('schema', () => {
  it('validates a minimal project frontmatter payload', () => {
    const result = validateProject({
      title: 'Pipeline Dashboard',
      status: 'up-next',
      type: 'project',
    });

    expect(result.valid).toBe(true);
  });

  it('allows linked projects without catalog status', () => {
    const result = validateProject({
      title: 'Linked Project',
      type: 'project',
      trackingMode: 'linked',
      localPath: '/tmp/linked-project',
    });

    expect(result.valid).toBe(true);
  });

  it('requires status for catalog-only projects', () => {
    const result = validateProject({
      title: 'Catalog Only',
      type: 'idea',
      trackingMode: 'catalog-only',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('status is required for catalog-only projects');
    }
  });

  it('rejects invalid project status values', () => {
    const result = validateProject({
      title: 'Bad Status',
      status: 'not-a-status',
      type: 'project',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes('invalid status'))).toBe(true);
    }
  });

  it('requires priority for in-flight projects', () => {
    const result = validateProject({
      title: 'In Flight No Priority',
      status: 'in-flight',
      type: 'project',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('priority is required for in-flight projects');
    }
  });

  it('validates repo status shape and rejects invalid status', () => {
    const ok = validateRepoStatus({ title: 'Repo project', status: 'in-flight' });
    const bad = validateRepoStatus({ title: 'Repo project', status: 'invalid' });

    expect(ok).not.toBeNull();
    expect(ok?.status).toBe('in-flight');
    expect(bad).toBeNull();
  });

  it('computes stale/review heuristics from dates', () => {
    expect(isStale('2000-01-01')).toBe(true);
    expect(needsReview('2000-01-01')).toBe(true);

    const today = new Date().toISOString().split('T')[0];
    expect(isStale(today)).toBe(false);
    expect(needsReview(today)).toBe(false);
  });
});
