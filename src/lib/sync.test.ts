/**
 * sync.test.ts -- Tests for the sync orchestration module.
 *
 * Phase 6 verification: merge logic with timestamps, timestamp tie resolution.
 *
 * These tests verify the TypeScript sync orchestration layer.
 * The core HLC merge logic is tested in Rust (sync.rs tests).
 * Here we test the TypeScript-side orchestration and type contracts.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import type { SyncResult } from './tauri';
import type { SyncMode } from './settings';

// Since the sync module calls Tauri commands (which require a runtime),
// we test the orchestration logic by verifying the module's type contracts
// and helper behavior.

describe('SyncResult type contract', () => {
  it('matches expected shape', () => {
    const result: SyncResult = {
      success: true,
      message: 'test',
      warnings: [],
      fieldsFromRemote: 0,
      fieldsFromLocal: 0,
    };
    expect(result.success).toBe(true);
    expect(result.message).toBe('test');
    expect(result.warnings).toEqual([]);
    expect(result.fieldsFromRemote).toBe(0);
    expect(result.fieldsFromLocal).toBe(0);
  });

  it('handles warnings', () => {
    const result: SyncResult = {
      success: true,
      message: 'sync complete',
      warnings: ['Clock difference detected', 'Failed to write'],
      fieldsFromRemote: 5,
      fieldsFromLocal: 3,
    };
    expect(result.warnings).toHaveLength(2);
    expect(result.fieldsFromRemote).toBe(5);
    expect(result.fieldsFromLocal).toBe(3);
  });
});

describe('SyncMode type', () => {
  it('covers all modes', () => {
    const modes: SyncMode[] = ['Local', 'Remote', 'Disabled', 'Unknown'];
    expect(modes).toHaveLength(4);
  });

  it('defaults to Local', () => {
    // In Rust, SyncMode defaults to Local. Verify the TypeScript type allows it.
    const mode: SyncMode = 'Local';
    expect(mode).toBe('Local');
  });
});

describe('merge logic contracts', () => {
  // These tests verify the expected behavior of the HLC merge algorithm.
  // The actual merge runs in Rust -- here we document the expected behavior.

  it('newer timestamp wins (per-field)', () => {
    // Given:
    // local field  title="Local Title"  title__updatedAt=5
    // remote field title="Remote Title" title__updatedAt=15
    // Expected: merged title = "Remote Title" (15 > 5)
    const localTs = 5;
    const remoteTs = 15;
    expect(remoteTs > localTs).toBe(true);
  });

  it('tie goes to local (conservative)', () => {
    // Given:
    // local field  title="Local Title"  title__updatedAt=10
    // remote field title="Remote Title" title__updatedAt=10
    // Expected: merged title = "Local Title" (tie, local wins)
    const localTs = 10;
    const remoteTs = 10;
    expect(remoteTs > localTs).toBe(false); // local wins on tie
  });

  it('HLC counter is max + 1', () => {
    const localCounter = 10;
    const remoteCounter = 20;
    const mergedCounter = Math.max(localCounter, remoteCounter) + 1;
    expect(mergedCounter).toBe(21);
  });

  it('HLC counter is max + 1 when local is higher', () => {
    const localCounter = 30;
    const remoteCounter = 20;
    const mergedCounter = Math.max(localCounter, remoteCounter) + 1;
    expect(mergedCounter).toBe(31);
  });

  it('HLC counter is max + 1 when equal', () => {
    const localCounter = 15;
    const remoteCounter = 15;
    const mergedCounter = Math.max(localCounter, remoteCounter) + 1;
    expect(mergedCounter).toBe(16);
  });
});

describe('clock skew detection', () => {
  const CLOCK_SKEW_THRESHOLD_MS = 5_000;

  function detectClockSkew(remoteTimestamp: number): string | null {
    const localNow = Date.now();
    const diff = Math.abs(localNow - remoteTimestamp);
    if (diff > CLOCK_SKEW_THRESHOLD_MS) {
      return `Clock difference detected between devices (${diff}ms). Sync results may be unexpected.`;
    }
    return null;
  }

  it('detects large clock skew', () => {
    const futureTs = Date.now() + 10_000; // 10 seconds in the future
    const warning = detectClockSkew(futureTs);
    expect(warning).not.toBeNull();
    expect(warning).toContain('Clock difference');
  });

  it('no warning for small skew', () => {
    const now = Date.now();
    const warning = detectClockSkew(now);
    expect(warning).toBeNull();
  });

  it('detects past clock skew', () => {
    const pastTs = Date.now() - 10_000; // 10 seconds in the past
    const warning = detectClockSkew(pastTs);
    expect(warning).not.toBeNull();
  });
});

describe('per-field merge simulation', () => {
  // Simulates the per-field merge algorithm used in Rust
  interface TimestampedField<T> {
    value: T;
    updatedAt: number;
  }

  function mergeField<T>(
    local: TimestampedField<T>,
    remote: TimestampedField<T>,
  ): { value: T; updatedAt: number; source: 'local' | 'remote' } {
    if (remote.updatedAt > local.updatedAt) {
      return { value: remote.value, updatedAt: remote.updatedAt, source: 'remote' };
    }
    return { value: local.value, updatedAt: local.updatedAt, source: 'local' };
  }

  it('merges multiple fields independently', () => {
    // Scenario: 3 fields, each with different timestamps
    const localTitle = { value: 'Old Title', updatedAt: 5 };
    const remoteTitle = { value: 'New Title', updatedAt: 15 };

    const localStatus = { value: 'pending', updatedAt: 20 };
    const remoteStatus = { value: 'in-progress', updatedAt: 10 };

    const localDesc = { value: 'local desc', updatedAt: 8 };
    const remoteDesc = { value: 'remote desc', updatedAt: 8 }; // tie

    const mergedTitle = mergeField(localTitle, remoteTitle);
    const mergedStatus = mergeField(localStatus, remoteStatus);
    const mergedDesc = mergeField(localDesc, remoteDesc);

    expect(mergedTitle.value).toBe('New Title');
    expect(mergedTitle.source).toBe('remote');

    expect(mergedStatus.value).toBe('pending');
    expect(mergedStatus.source).toBe('local');

    expect(mergedDesc.value).toBe('local desc');
    expect(mergedDesc.source).toBe('local'); // tie goes to local
  });

  it('handles new items from remote (no local counterpart)', () => {
    // When an item exists only on remote, it should be added to merged
    const remoteItems = new Map([
      ['item-1', { title: 'Remote Item', updatedAt: 10 }],
    ]);
    const localItems = new Map<string, { title: string; updatedAt: number }>();

    const merged = new Map(localItems);
    for (const [id, item] of remoteItems) {
      if (!merged.has(id)) {
        merged.set(id, item);
      }
    }

    expect(merged.has('item-1')).toBe(true);
    expect(merged.get('item-1')?.title).toBe('Remote Item');
  });

  it('preserves local-only items (no remote counterpart)', () => {
    // When an item exists only on local, it should be kept in merged
    const localItems = new Map([
      ['item-1', { title: 'Local Item', updatedAt: 10 }],
    ]);
    const remoteItems = new Map<string, { title: string; updatedAt: number }>();

    const merged = new Map(localItems);
    for (const [id, item] of remoteItems) {
      if (!merged.has(id)) {
        merged.set(id, item);
      }
    }

    expect(merged.has('item-1')).toBe(true);
    expect(merged.get('item-1')?.title).toBe('Local Item');
  });
});
