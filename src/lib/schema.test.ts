import { describe, expect, it } from 'bun:test';
import {
  isStale,
  needsReview,
  validateProject,
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

  it('requires status field', () => {
    const result = validateProject({
      title: 'No Status',
      type: 'project',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('status is required');
    }
  });

  it('requires title field', () => {
    const result = validateProject({
      status: 'up-next',
      type: 'project',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('title is required');
    }
  });

  it('requires type field', () => {
    const result = validateProject({
      title: 'No Type',
      status: 'up-next',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('type is required');
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

  it('accepts archived status', () => {
    const result = validateProject({
      title: 'Old Project',
      status: 'archived',
      type: 'project',
    });

    expect(result.valid).toBe(true);
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

  it('requires parent for sub-projects', () => {
    const result = validateProject({
      title: 'Sub Project',
      status: 'up-next',
      type: 'sub-project',
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors).toContain('parent is required for sub-projects');
    }
  });

  it('validates tags as string array', () => {
    const result = validateProject({
      title: 'Tagged',
      status: 'up-next',
      type: 'project',
      tags: [123],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.some((error) => error.includes('tags'))).toBe(true);
    }
  });

  it('computes stale/review heuristics from dates', () => {
    expect(isStale('2000-01-01')).toBe(true);
    expect(needsReview('2000-01-01')).toBe(true);

    const today = new Date().toISOString().split('T')[0];
    expect(isStale(today)).toBe(false);
    expect(needsReview(today)).toBe(false);
  });
});
