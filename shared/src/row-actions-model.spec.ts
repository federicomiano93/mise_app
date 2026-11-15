// Unit tests for the judgements behind a recipe row's menu (P15 — the owner cannot read code, so these tests are the safety net), run
// against BOTH implementations: the TypeScript port in shared/ and js/catalogue/row-actions-model.js, which the live app uses today.
// Ported from the model tests of tests/recipe-row-actions.test.mjs (current app 70325def, 7 Nov 2026; the rest of that file reads the
// current app's screens and has Mise 2 specs of its own in app/src/recipes). The module is a FULL port, so parity.spec.ts also compares
// its exports name by name, and odd-inputs.spec.ts feeds both files the same junk. Fake data only.

import { describe, expect, test } from 'vitest';
import * as ported from './row-actions-model';
import * as legacyJs from '../../js/catalogue/row-actions-model.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  test('splitAmount: two parts that add up to the amount shown, in the row’s own unit', () => {
    expect(m.splitAmount(1250, 'g')).toStrictEqual({ a: 625, b: 625 });
    expect(m.splitAmount(1251, 'g')).toStrictEqual({ a: 626, b: 625 });
    expect(m.splitAmount(1.251, 'kg')).toStrictEqual({ a: 0.626, b: 0.625 });
    expect(m.splitAmount(3, 'pcs')).toStrictEqual({ a: 2, b: 1 });
  });

  test('splitAmount: null when there is nothing to split', () => {
    expect(m.splitAmount(1, 'pcs'), 'one piece cannot be halved').toBe(null);
    expect(m.splitAmount(1, 'g')).toBe(null);
    expect(m.splitAmount(0, 'g')).toBe(null);
    expect(m.splitAmount(-5, 'g')).toBe(null);
    expect(m.splitAmount(null, 'g')).toBe(null);
    expect(m.splitAmount(undefined, 'g')).toBe(null);
    expect(m.splitAmount(NaN, 'g')).toBe(null);
    expect(m.splitAmount(Infinity, 'g')).toBe(null);
    expect(m.splitAmount(null, 'to taste')).toBe(null);
  });

  test('splitBlockReason: null when splittable, toTaste without an amount, else tooSmall', () => {
    expect(m.splitBlockReason(1250, 'g')).toBe(null);
    expect(m.splitBlockReason(null, 'to taste')).toBe('toTaste');
    expect(m.splitBlockReason(null, 'g')).toBe('toTaste');
    expect(m.splitBlockReason(5, 'to taste')).toBe('toTaste');
    expect(m.splitBlockReason(1, 'pcs')).toBe('tooSmall');
    expect(m.splitBlockReason(0, 'g')).toBe('tooSmall');
    expect(m.splitBlockReason(NaN, 'g')).toBe('tooSmall');
  });

  const INGREDIENTS = {
    flour: { supplierId: 'mill' },
    salt: { supplierId: 'mill', active: false },
    yeast: { supplierId: 'gone' },
    water: {},
    oil: { supplierId: 'deli' },
  };
  const SUPPLIERS = { mill: { name: 'Mill' }, deli: { name: 'Deli', active: false } };

  test('orderTargetOf: an ingredient with an active supplier can be ordered', () => {
    expect(m.orderTargetOf({ label: 'Flour', refId: 'flour' }, INGREDIENTS, SUPPLIERS)).toStrictEqual({ ok: true, ingredientId: 'flour' });
    expect(m.orderTargetOf({ label: 'Flour', kind: 'ingredient', refId: 'flour' }, INGREDIENTS, SUPPLIERS)).toStrictEqual({ ok: true, ingredientId: 'flour' });
  });

  test('orderTargetOf: each reason it cannot', () => {
    const why = (row: unknown) => m.orderTargetOf(row, INGREDIENTS, SUPPLIERS);
    expect(why({ kind: 'recipe', refId: 'some-recipe' })).toStrictEqual({ ok: false, reason: 'recipe' });
    expect(why({ refId: 'salt' })).toStrictEqual({ ok: false, reason: 'notInUse' });
    expect(why({ label: 'typed by hand' }), 'unlinked row').toStrictEqual({ ok: false, reason: 'noSupplier' });
    expect(why({ refId: 'missing' }), 'ingredient gone').toStrictEqual({ ok: false, reason: 'noSupplier' });
    expect(why({ refId: 'water' }), 'no supplier id').toStrictEqual({ ok: false, reason: 'noSupplier' });
    expect(why({ refId: 'yeast' }), 'supplier missing').toStrictEqual({ ok: false, reason: 'noSupplier' });
    expect(why({ refId: 'oil' }), 'supplier inactive').toStrictEqual({ ok: false, reason: 'noSupplier' });
    expect(m.orderTargetOf({ refId: 'flour' }, null, null)).toStrictEqual({ ok: false, reason: 'noSupplier' });
  });

  test('rowKeysOf: the key stays with the ingredient when a row is added above it', () => {
    const before = [{ label: 'Farina', refId: 'F' }, { label: 'Sale' }, { label: 'Acqua', refId: 'A' }];
    const after = [{ label: 'Lievito', refId: 'L' }, ...before];
    const k0 = m.rowKeysOf(before);
    const k1 = m.rowKeysOf(after);
    expect(k0).toStrictEqual(['ingredient:F#1', 'name:Sale#1', 'ingredient:A#1']);
    expect(k1.indexOf(k0[2] as string), 'Acqua keeps its key one row down').toBe(3);
    expect(m.rowKeysOf([{ refId: 'F' }, { refId: 'F' }]), 'a row listed twice').toStrictEqual(['ingredient:F#1', 'ingredient:F#2']);
    expect(m.rowKeysOf([{ kind: 'recipe', refId: 'R' }])).toStrictEqual(['recipe:R#1']);
    expect(m.rowKeysOf(null)).toStrictEqual([]);
  });
});
