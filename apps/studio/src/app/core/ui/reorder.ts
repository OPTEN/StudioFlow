/**
 * Pure helpers for ordered lists that the operator reorders (Sources dock: items front to back, Scenes dock: scenes).
 * No Angular, no DOM.
 */

/** Where a keyboard step moves an entry: one place earlier or later, or to the very start or end. */
export type ReorderStep = 'earlier' | 'later' | 'first' | 'last';

/**
 * The order after moving `entry` to position `toIndex` (0-based, clamped to the list). An unknown entry or a move to
 * its own position gives an equal copy.
 */
export function moveEntry<T>(order: readonly T[], entry: T, toIndex: number): T[] {
  const from = order.indexOf(entry);
  const next = [...order];
  if (from < 0) {
    return next;
  }
  const target = Math.min(Math.max(toIndex, 0), order.length - 1);
  next.splice(from, 1);
  next.splice(target, 0, entry);
  return next;
}

/**
 * `entries` in the order of the ids `order`; entries it does not list (added by another session meanwhile) keep their
 * relative order behind the listed ones, and ids without an entry are ignored.
 */
export function sortByOrder<T>(
  entries: readonly T[],
  order: readonly string[],
  idOf: (entry: T) => string,
): T[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  const rankOf = (entry: T): number => rank.get(idOf(entry)) ?? order.length;
  return [...entries].sort((a, b) => rankOf(a) - rankOf(b));
}

/** Position an entry at `index` reaches with `step`, clamped to a list of `count` entries. */
export function stepTarget(index: number, count: number, step: ReorderStep): number {
  switch (step) {
    case 'earlier':
      return Math.max(index - 1, 0);
    case 'later':
      return Math.min(index + 1, count - 1);
    case 'first':
      return 0;
    case 'last':
      return count - 1;
  }
}

/** True when `order` lists every entry of `entries` exactly once. */
export function isPermutation<T>(order: readonly T[], entries: readonly T[]): boolean {
  const unique = new Set(order);
  return (
    order.length === entries.length &&
    unique.size === order.length &&
    entries.every((entry) => unique.has(entry))
  );
}

/** True when both lists hold the same entries in the same order. */
export function sameOrder<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
