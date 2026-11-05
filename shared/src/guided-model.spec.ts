// Unit tests for the row ids of the Catalogue's guided-model that the Calculator needs (P15) — `ridOf`, and
// `makeRowId` / `withRowIds` for the link picker (step 3c-2) — run against BOTH implementations: the TypeScript
// port in shared/ and js/catalogue/guided-model.js. The `withRowIds` block is ported from
// tests/guided-model.test.mjs («Stable row ids»); the two must stay equal until the switch to Mise 2.
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
  const { ridOf, withRowIds, makeRowId } = m as unknown as Record<string, Loose>;

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

  test('a row that already has an id keeps it, byte for byte', () => {
    const rows = [{ rid: 'ra', label: 'Flour', grams: 1000, unit: 'g' }];
    const out = withRowIds(rows);
    expect(out[0], 'the untouched row must be the SAME object, not a copy').toBe(rows[0]);
    expect(out[0].rid).toBe('ra');
  });

  test('a row with no id gets one, and it is unique', () => {
    const out = withRowIds([
      { label: 'Flour', grams: 1000 },
      { label: 'Water', grams: 500 },
      { rid: 'rc', label: 'Butter', grams: 500 },
    ]);
    expect(ridOf(out[0])).toBeTruthy();
    expect(ridOf(out[1])).toBeTruthy();
    expect(out[2].rid).toBe('rc');
    expect(new Set(out.map(ridOf)).size, 'two rows ended up sharing an id').toBe(3);
  });

  test('a DUPLICATED id is broken apart — two rows may never share one', () => {
    const out = withRowIds([
      { rid: 'ra', label: 'Flour', grams: 1000 },
      { rid: 'ra', label: 'Water', grams: 500 },
    ]);
    expect(out[0].rid).toBe('ra');
    expect(out[1].rid).not.toBe('ra');
    expect(ridOf(out[1])).toBeTruthy();
  });

  test('the generator never repeats itself into a collision', () => {
    let n = 0;
    const bad = () => (++n <= 2 ? 'rx' : 'ry');
    const out = withRowIds([{ label: 'A' }, { label: 'B' }], bad);
    expect(out[0].rid).toBe('rx');
    expect(out[1].rid).toBe('ry');
  });

  test('withRowIds survives junk without throwing, and never mutates its input', () => {
    expect(withRowIds(null)).toStrictEqual([]);
    expect(withRowIds('nope')).toStrictEqual([]);
    const input = [null, { label: 'A' }];
    const out = withRowIds(input);
    expect(out[0]).toBeNull();
    expect(ridOf(out[1])).toBeTruthy();
    expect(input[1]).toStrictEqual({ label: 'A' });
  });

  test('a generated id looks like an id, and follows the random source it is given', () => {
    for (let i = 0; i < 50; i++) expect(makeRowId()).toMatch(/^r[a-z0-9]{8}$/);
    expect(makeRowId(() => 0)).toBe('raaaaaaaa');
    expect(makeRowId(() => 0.999)).toBe('r99999999');
  });
});

describe('the port against the original', () => {
  test('every ported function has the same name and arity in both', () => {
    for (const name of ['ridOf', 'makeRowId', 'withRowIds'] as const) {
      expect(ported[name].name, name).toBe((legacyJs as Record<string, Loose>)[name].name);
      expect(ported[name].length, `${name}: arity`).toBe((legacyJs as Record<string, Loose>)[name].length);
    }
  });

  test('the original still exports everything this port leaves out', () => {
    for (const name of ['normalizeSteps', 'MAX_STEPS']) {
      expect((legacyJs as Record<string, unknown>)[name] !== undefined, name).toBe(true);
    }
  });

  test('the port exports the row-id functions and nothing else', () => {
    expect(Object.keys(ported).sort()).toStrictEqual(['makeRowId', 'ridOf', 'withRowIds']);
  });
});
