import { describe, expect, it } from 'bun:test';
import { AUTO_COMMIT_ALLOWED_FILES } from './auto-commit';

describe('auto-commit allowlist', () => {
  it('only allows CLAWCHESTRA.md for metadata auto-commit', () => {
    expect(AUTO_COMMIT_ALLOWED_FILES).toEqual(['CLAWCHESTRA.md']);
  });
});

