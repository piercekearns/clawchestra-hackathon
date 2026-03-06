import { describe, expect, it } from 'bun:test';
import { sanitizeChangelogEntry } from './changelog';

describe('changelog', () => {
  describe('sanitizeChangelogEntry', () => {
    it('returns a valid entry for well-formed input', () => {
      const result = sanitizeChangelogEntry({
        id: 'item-1',
        title: 'My Feature',
        completedAt: '2026-03-03',
        summary: 'Built the thing',
      });

      expect(result).toEqual({
        id: 'item-1',
        title: 'My Feature',
        completedAt: '2026-03-03',
        summary: 'Built the thing',
      });
    });

    it('returns entry without summary when summary is missing', () => {
      const result = sanitizeChangelogEntry({
        id: 'item-2',
        title: 'Another Feature',
        completedAt: '2026-03-01',
      });

      expect(result).toEqual({
        id: 'item-2',
        title: 'Another Feature',
        completedAt: '2026-03-01',
        summary: undefined,
      });
    });

    it('rejects null input', () => {
      expect(sanitizeChangelogEntry(null)).toBeNull();
    });

    it('rejects non-object input', () => {
      expect(sanitizeChangelogEntry('string')).toBeNull();
      expect(sanitizeChangelogEntry(42)).toBeNull();
    });

    it('rejects entry with empty id', () => {
      expect(sanitizeChangelogEntry({
        id: '',
        title: 'Title',
        completedAt: '2026-03-01',
      })).toBeNull();
    });

    it('rejects entry with missing id', () => {
      expect(sanitizeChangelogEntry({
        title: 'Title',
        completedAt: '2026-03-01',
      })).toBeNull();
    });

    it('rejects entry with empty title', () => {
      expect(sanitizeChangelogEntry({
        id: 'item-1',
        title: '',
        completedAt: '2026-03-01',
      })).toBeNull();
    });

    it('rejects entry with missing completedAt', () => {
      expect(sanitizeChangelogEntry({
        id: 'item-1',
        title: 'Title',
      })).toBeNull();
    });

    it('rejects entry with invalid date', () => {
      expect(sanitizeChangelogEntry({
        id: 'item-1',
        title: 'Title',
        completedAt: 'not-a-date',
      })).toBeNull();
    });

    it('ignores non-string summary', () => {
      const result = sanitizeChangelogEntry({
        id: 'item-1',
        title: 'Title',
        completedAt: '2026-03-01',
        summary: 42,
      });

      expect(result).not.toBeNull();
      expect(result!.summary).toBeUndefined();
    });
  });
});
