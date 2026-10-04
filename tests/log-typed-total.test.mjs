// A log edit changes quantities only and must keep the typed total of the dough that
// was made. 'both' recipes lost it (the typed part became 0) — silently lowering
// every ingredient of the new version.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSheet, typedTotalOf } from '../js/log-model.js';

const ings = [{ key: 'flour', label: 'Flour', grams: 1000 }, { key: 'water', label: 'Water', grams: 600 }];
const mk = (logic) => ({ id: 'r', name: 'Dough', logic, ingredients: ings, leaveningKey: null, leaveningDefaultPct: 0, baselinePct: 0 });
const items = [{ id: 'a', name: 'Loaf', clientName: 'C', qty: 10, weightG: 500, kind: 'number', crate: { show: false } }];
const occasional = [{ name: 'X', products: [{ name: 'Roll', qty: 4, weightG: 50, unit: 'pz' }] }];
const occLines = [{ id: 'occ-0-0', name: 'Roll', clientName: 'X', qty: 4, weightG: 50, kind: 'number', crate: { show: false } }];

function edit(recipe, prevVersion, newQty) {
  const next = items.map(i => ({ ...i, qty: newQty }));
  return buildSheet({ recipe, items: next.concat(occLines), extraGrams: prevVersion.sheet.extra_g, totalInput: typedTotalOf(recipe, prevVersion), leaveningPct: 0 });
}

test('buildSheet stores typed_g for total and both, not for orders', () => {
  assert.equal(buildSheet({ recipe: mk('both'), items, totalInput: 3000, extraGrams: 100 }).typed_g, 3000);
  assert.equal(buildSheet({ recipe: mk('total'), items: [], totalInput: 2500 }).typed_g, 2500);
  assert.equal('typed_g' in buildSheet({ recipe: mk('orders'), items }), false);
});

test('editing a both log keeps products + typed + extra (new sheet with typed_g)', () => {
  const recipe = mk('both');
  const sheet = buildSheet({ recipe, items: items.concat(occLines), totalInput: 3000, extraGrams: 100 });
  assert.equal(sheet.total_g, 5000 + 200 + 3000 + 100);
  const out = edit(recipe, { items, occasional, sheet }, 12);
  assert.equal(out.total_g, 6000 + 200 + 3000 + 100);
});

test('editing an OLD both log (no typed_g) derives the typed part', () => {
  const recipe = mk('both');
  const sheet = buildSheet({ recipe, items: items.concat(occLines), totalInput: 3000, extraGrams: 100 });
  delete sheet.typed_g;
  assert.equal(typedTotalOf(recipe, { items, occasional, sheet }), 3000);
  const out = edit(recipe, { items, occasional, sheet }, 12);
  assert.equal(out.total_g, 6000 + 200 + 3000 + 100);
});

test('derivation never goes negative or NaN', () => {
  const sheet = { total_g: 10, extra_g: 'x' };
  assert.equal(typedTotalOf(mk('both'), { items, occasional, sheet }), 0);
  assert.equal(typedTotalOf(mk('both'), { sheet: {} }), 0);
  assert.equal(typedTotalOf(mk('both'), null), 0);
});

test('total keeps total_g, orders has no typed part', () => {
  const t = buildSheet({ recipe: mk('total'), items: [], totalInput: 2500 });
  assert.equal(typedTotalOf(mk('total'), { sheet: t }), 2500);
  const o = buildSheet({ recipe: mk('orders'), items });
  assert.equal(typedTotalOf(mk('orders'), { items, sheet: o }), 0);
  assert.equal(edit(mk('orders'), { items, sheet: o }, 12).total_g, 6200);
});
