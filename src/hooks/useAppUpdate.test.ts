import { describe, expect, it } from 'bun:test';
import { getUpdateBlockedReason } from './useAppUpdate';

describe('useAppUpdate guard', () => {
  it('returns force-update warning while active turns exist and guard is enabled', () => {
    expect(getUpdateBlockedReason(2, true)).toBe(
      'Active chat turn detected (2) — update will force restart and may interrupt current response.',
    );
  });

  it('allows update when guard is enabled but there are no active turns', () => {
    expect(getUpdateBlockedReason(0, true)).toBeNull();
  });

  it('allows update when guard is disabled', () => {
    expect(getUpdateBlockedReason(3, false)).toBeNull();
  });
});
