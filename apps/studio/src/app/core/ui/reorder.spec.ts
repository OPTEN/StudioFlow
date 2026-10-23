import { isPermutation, moveEntry, sameOrder, sortByOrder, stepTarget } from './reorder';

describe('moveEntry', () => {
  const order = ['a', 'b', 'c', 'd'];

  it.each([
    ['to the start', 'c', 0, ['c', 'a', 'b', 'd']],
    ['to the end', 'a', 3, ['b', 'c', 'd', 'a']],
    ['one place later', 'b', 2, ['a', 'c', 'b', 'd']],
    ['one place earlier', 'c', 1, ['a', 'c', 'b', 'd']],
    ['to its own position', 'b', 1, ['a', 'b', 'c', 'd']],
  ])('moves an entry %s', (_name, entry, to, expected) => {
    expect(moveEntry(order, entry, to)).toEqual(expected);
  });

  it('clamps the target to the list', () => {
    expect(moveEntry(order, 'b', -5)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveEntry(order, 'b', 99)).toEqual(['a', 'c', 'd', 'b']);
  });

  it('returns an equal copy for an unknown entry, a single entry and an empty list', () => {
    const unknown = moveEntry(order, 'x', 0);
    expect(unknown).toEqual(order);
    expect(unknown).not.toBe(order);
    expect(moveEntry(['a'], 'a', 3)).toEqual(['a']);
    expect(moveEntry([], 'a', 0)).toEqual([]);
  });

  it('does not change its input', () => {
    moveEntry(order, 'a', 3);
    expect(order).toEqual(['a', 'b', 'c', 'd']);
  });
});

describe('stepTarget', () => {
  it.each([
    [2, 5, 'earlier', 1],
    [2, 5, 'later', 3],
    [0, 5, 'earlier', 0],
    [4, 5, 'later', 4],
    [2, 5, 'first', 0],
    [2, 5, 'last', 4],
    [0, 1, 'last', 0],
  ] as const)('step from %i of %i: %s -> %i', (index, count, step, expected) => {
    expect(stepTarget(index, count, step)).toBe(expected);
  });
});

describe('sortByOrder', () => {
  const entries = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const idOf = (entry: { id: string }): string => entry.id;

  it('sorts by the listed ids', () => {
    expect(sortByOrder(entries, ['c', 'a', 'b'], idOf).map(idOf)).toEqual(['c', 'a', 'b']);
  });

  it('keeps unlisted entries behind the listed ones in their own order and ignores unknown ids', () => {
    expect(sortByOrder(entries, ['x', 'c'], idOf).map(idOf)).toEqual(['c', 'a', 'b']);
  });

  it('does not change its input', () => {
    sortByOrder(entries, ['c', 'b', 'a'], idOf);
    expect(entries.map(idOf)).toEqual(['a', 'b', 'c']);
  });
});

describe('isPermutation', () => {
  it('accepts every ordering of the same entries', () => {
    expect(isPermutation(['c', 'a', 'b'], ['a', 'b', 'c'])).toBe(true);
    expect(isPermutation([], [])).toBe(true);
  });

  it.each([
    ['a missing entry', ['a', 'b'], ['a', 'b', 'c']],
    ['an extra entry', ['a', 'b', 'c', 'd'], ['a', 'b', 'c']],
    ['a duplicate', ['a', 'a', 'b'], ['a', 'b', 'c']],
    ['an unknown entry', ['a', 'b', 'x'], ['a', 'b', 'c']],
  ])('rejects %s', (_name, order, entries) => {
    expect(isPermutation(order, entries)).toBe(false);
  });
});

describe('sameOrder', () => {
  it('compares entries and their order', () => {
    expect(sameOrder(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameOrder(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameOrder(['a'], ['a', 'b'])).toBe(false);
    expect(sameOrder([], [])).toBe(true);
  });
});
