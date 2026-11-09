// Unit tests for the typed total a saved log version was made with (P15 — the owner cannot read code), run
// against BOTH implementations: the TypeScript port in shared/ and js/log-model.js, which the live app uses
// today. Ported from tests/log-typed-total.test.mjs (its first test, the one that only calls `buildSheet`, is
// in log-model.spec.ts); the two must stay equal until the switch to Mise 2.
//
// A log edit changes quantities only and must keep the typed total of the dough that was made. 'both' recipes
// once lost it (the typed part became 0), silently lowering every ingredient of the new version.

import { describe, expect, test } from 'vitest';
import * as portedLog from './log-model';
import * as legacyLogJs from '../../js/log-model.js';

type Loose = any;
const legacyLog = legacyLogJs as unknown as typeof portedLog;

describe.each([
  ['shared/ (TypeScript)', portedLog],
  ['js/ (current app)', legacyLog],
] as const)('%s', (_name, m) => {
  const { buildSheet, typedTotalOf } = m as unknown as Record<string, Loose>;

  const ings = [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }];
  const mk = (logic: string): Loose => ({ id: 'r', name: 'Dough', logic, ingredients: ings, leaveningKey: null, leaveningDefaultPct: 0, baselinePct: 0 });
  const items = [{ id: 'a', name: 'Loaf', clientName: 'C', qty: 10, weightG: 500, kind: 'number', crate: { show: false } }];
  const occasional = [{ name: 'X', products: [{ name: 'Roll', qty: 4, weightG: 50, unit: 'pz' }] }];
  const occLines = [{ id: 'occ-0-0', name: 'Roll', clientName: 'X', qty: 4, weightG: 50, kind: 'number', crate: { show: false } }];

  function edit(recipe: Loose, prevVersion: Loose, newQty: number): Loose {
    const next = items.map(i => ({ ...i, qty: newQty }));
    return buildSheet({ recipe, items: next.concat(occLines), extraGrams: prevVersion.sheet.extra_g, totalInput: typedTotalOf(recipe, prevVersion), leaveningPct: 0 });
  }

  test('editing a both log keeps products + typed + extra (new sheet with typed_g)', () => {
    const recipe = mk('both');
    const sheet = buildSheet({ recipe, items: items.concat(occLines), totalInput: 3000, extraGrams: 100 });
    expect(sheet.total_g).toBe(5000 + 200 + 3000 + 100);
    const out = edit(recipe, { items, occasional, sheet }, 12);
    expect(out.total_g).toBe(6000 + 200 + 3000 + 100);
  });

  test('editing an OLD both log (no typed_g) derives the typed part', () => {
    const recipe = mk('both');
    const sheet = buildSheet({ recipe, items: items.concat(occLines), totalInput: 3000, extraGrams: 100 });
    delete sheet.typed_g;
    expect(typedTotalOf(recipe, { items, occasional, sheet })).toBe(3000);
    const out = edit(recipe, { items, occasional, sheet }, 12);
    expect(out.total_g).toBe(6000 + 200 + 3000 + 100);
  });

  test('derivation never goes negative or NaN', () => {
    const sheet = { total_g: 10, extra_g: 'x' };
    expect(typedTotalOf(mk('both'), { items, occasional, sheet })).toBe(0);
    expect(typedTotalOf(mk('both'), { sheet: {} })).toBe(0);
    expect(typedTotalOf(mk('both'), null)).toBe(0);
  });

  test('total keeps total_g, orders has no typed part', () => {
    const t = buildSheet({ recipe: mk('total'), items: [], totalInput: 2500 });
    expect(typedTotalOf(mk('total'), { sheet: t })).toBe(2500);
    const o = buildSheet({ recipe: mk('orders'), items });
    expect(typedTotalOf(mk('orders'), { items, sheet: o })).toBe(0);
    expect(edit(mk('orders'), { items, sheet: o }, 12).total_g).toBe(6200);
  });
});
