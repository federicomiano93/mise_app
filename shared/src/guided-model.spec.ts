// Unit tests for `ridOf`, the one function of the Catalogue's guided-model that the Calculator needs (P15),
// run against BOTH implementations: the TypeScript port in shared/ and js/catalogue/guided-model.js. The
// original's own tests (tests/guided-model.test.mjs) only call `ridOf` as a helper of `withRowIds`, which is
// not ported yet (step 3c-2), so these are written here; the two must stay equal until the switch to Mise 2.
//
// guided-model.ts is a PARTIAL port, so parity.spec.ts does not pair it: the original holds a whole mixing
// procedure (steps, timers, resume) the Calculator never reads. The last block stands in for what pairing
// would have checked, for `ridOf` alone.

import { describe, expect, test } from 'vitest';
import * as ported from './guided-model';
import * as legacyJs from '../../js/catalogue/guided-model.js';

type Loose = any;
const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { ridOf } = m as unknown as Record<string, Loose>;

  test('a row\'s id is its rid, trimmed', () => {
    expect(ridOf({ rid: 'ra' })).toBe('ra');
    expect(ridOf({ rid: '  ra  ' })).toBe('ra');
    expect(ridOf({ rid: 42 })).toBe('42');
  });

  test('a row with no usable id answers the empty text, never undefined or a throw', () => {
    for (const row of [null, undefined, {}, { rid: null }, { rid: undefined }, { rid: '' }, { rid: '   ' }, 'str', 5, []]) {
      expect(ridOf(row), JSON.stringify(row)).toBe('');
    }
  });

  test('the key of a linked row is its own rid, never its name', () => {
    expect(ridOf({ rid: 'r1', label: 'Yeast' })).toBe(ridOf({ rid: 'r1', label: 'Fresh yeast' }));
  });
});

describe('the port against the original', () => {
  test('ridOf has the same name and arity in both', () => {
    expect(ported.ridOf.name).toBe(legacyJs.ridOf.name);
    expect(ported.ridOf.length).toBe(legacyJs.ridOf.length);
  });

  test('the original still exports everything this port leaves out', () => {
    for (const name of ['makeRowId', 'withRowIds', 'normalizeSteps', 'MAX_STEPS']) {
      expect((legacyJs as Record<string, unknown>)[name] !== undefined, name).toBe(true);
    }
  });

  test('the port exports ridOf and nothing else', () => {
    expect(Object.keys(ported)).toStrictEqual(['ridOf']);
  });
});
