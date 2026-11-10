// Tests for the due-first ordering and the set comparison (Mise 2 only: no original to compare with).
import { describe, expect, test } from 'vitest';
import { dueFirst, sameSet } from './due-first';

const rows = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }));
const ids = (list: readonly { id: string }[]) => list.map(row => row.id);

describe('dueFirst', () => {
  test('puts the due ones first, each part keeping its own order', () => {
    expect(ids(dueFirst(rows, new Set(['d', 'b'])) as typeof rows)).toEqual(['b', 'd', 'a', 'c', 'e']);
  });

  test('nobody due: the same array comes back', () => {
    expect(dueFirst(rows, new Set())).toBe(rows);
    expect(dueFirst(rows, new Set(['zzz']))).toBe(rows);
  });

  test('everybody due, or the due ones already first: the same array comes back', () => {
    expect(dueFirst(rows, new Set(['a', 'b', 'c', 'd', 'e']))).toBe(rows);
    expect(dueFirst(rows, new Set(['a', 'b']))).toBe(rows);
  });

  test('does not change the array it was given, and ignores a row without an id', () => {
    const before = [...rows];
    dueFirst(rows, new Set(['e']));
    expect(rows).toEqual(before);
    const odd = [{ id: undefined }, { id: 'x' }];
    expect(dueFirst(odd, new Set(['x']))).toEqual([{ id: 'x' }, { id: undefined }]);
  });
});

describe('sameSet', () => {
  test('equal members are the same set, in any order', () => {
    expect(sameSet(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true);
    expect(sameSet(new Set(), new Set())).toBe(true);
  });

  test('a different size or member is not', () => {
    expect(sameSet(new Set(['a']), new Set(['a', 'b']))).toBe(false);
    expect(sameSet(new Set(['a', 'b']), new Set(['a', 'c']))).toBe(false);
  });
});
