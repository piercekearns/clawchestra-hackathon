import type { ColumnDefinition } from './schema';

/**
 * Resolve column display order by merging a saved order with the default columns.
 * - Saved columns that still exist are placed in saved order
 * - New columns (not in saved order) are appended at the end
 * - Removed columns (in saved order but not in defaults) are dropped
 */
export function resolveColumnOrder(
  savedOrder: string[] | undefined,
  defaults: ColumnDefinition[],
): ColumnDefinition[] {
  if (!savedOrder || savedOrder.length === 0) return defaults;

  const defaultMap = new Map(defaults.map((col) => [col.id, col]));
  const result: ColumnDefinition[] = [];
  const seen = new Set<string>();

  // Add saved columns that still exist
  for (const id of savedOrder) {
    const col = defaultMap.get(id);
    if (col) {
      result.push(col);
      seen.add(id);
    }
  }

  // Append any new columns not in saved order
  for (const col of defaults) {
    if (!seen.has(col.id)) {
      result.push(col);
    }
  }

  return result;
}
