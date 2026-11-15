// Ported from tests/session-from-cache.test.mjs (its sameData tests), run against BOTH the
// TypeScript port and js/same-data.js. ⚠️ A "different" here reloads the app: two equal
// documents must never compare different, whatever order their keys arrived in.

import { describe, expect, test } from 'vitest';
import * as ported from './same-data';
import * as legacyJs from '../../js/same-data.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('the same data in another key order is the same answer', () => {
    expect(m.sameData({ a: 1, b: { c: 2, d: [1, { e: 3, f: 4 }] } },
                      { b: { d: [1, { f: 4, e: 3 }], c: 2 }, a: 1 })).toBe(true);
    expect(m.sameData(null, null)).toBe(true);
    expect(m.sameData(undefined, null)).toBe(true);
  });

  test('a real change is a different answer', () => {
    expect(m.sameData({ locations: { bakery: 'manager' } }, { locations: { bakery: true } })).toBe(false);
    expect(m.sameData({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(m.sameData({ list: [1, 2] }, { list: [2, 1] })).toBe(false);
    expect(m.sameData({ a: 1 }, null)).toBe(false);
  });

  test('a timestamp-like object compares by its fields', () => {
    expect(m.sameData({ at: { seconds: 1, nanoseconds: 2 } }, { at: { nanoseconds: 2, seconds: 1 } })).toBe(true);
    expect(m.sameData({ at: { seconds: 1, nanoseconds: 2 } }, { at: { seconds: 1, nanoseconds: 3 } })).toBe(false);
  });
});
