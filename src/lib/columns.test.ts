import { describe, expect, it } from 'bun:test';
import { resolveColumnOrder } from './columns';
import type { ColumnDefinition } from './schema';

const defaults: ColumnDefinition[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];

describe('resolveColumnOrder', () => {
  it('returns defaults when no saved order', () => {
    expect(resolveColumnOrder(undefined, defaults)).toEqual(defaults);
    expect(resolveColumnOrder([], defaults)).toEqual(defaults);
  });

  it('reorders columns according to saved order', () => {
    const result = resolveColumnOrder(['c', 'a', 'b'], defaults);
    expect(result.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });

  it('appends new columns not in saved order', () => {
    const result = resolveColumnOrder(['b', 'a'], defaults);
    expect(result.map((c) => c.id)).toEqual(['b', 'a', 'c']);
  });

  it('drops saved columns that no longer exist', () => {
    const result = resolveColumnOrder(['c', 'x', 'a'], defaults);
    expect(result.map((c) => c.id)).toEqual(['c', 'a', 'b']);
  });
});
