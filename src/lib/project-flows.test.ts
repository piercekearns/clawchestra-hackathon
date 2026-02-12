import { describe, expect, it } from 'bun:test';
import { canonicalSlugify, isReservedProjectId, titleFromFolderName } from './project-flows';

describe('project flows', () => {
  it('slugifies with canonical normalization', () => {
    expect(canonicalSlugify('Shopping App')).toBe('shopping-app');
    expect(canonicalSlugify('  Déjà Vu!  ')).toBe('deja-vu');
    expect(canonicalSlugify('foo___bar')).toBe('foo-bar');
    expect(canonicalSlugify('---')).toBe('project');
  });

  it('enforces max length and trims trailing separators', () => {
    const long = 'A'.repeat(80);
    const slug = canonicalSlugify(long);
    expect(slug.length).toBe(63);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('marks reserved ids', () => {
    expect(isReservedProjectId('projects')).toBe(true);
    expect(isReservedProjectId('shopping-app')).toBe(false);
  });

  it('builds display titles from folder names', () => {
    expect(titleFromFolderName('shopping-app')).toBe('Shopping App');
    expect(titleFromFolderName('my_old_project')).toBe('My Old Project');
  });
});
