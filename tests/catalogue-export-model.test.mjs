// exportModelOf (js/catalogue/catalogue-model.js): the recipe screen's rows as the export reads them.
// Fake recipes only — the repo is public.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportModelOf, scaleCatalogue, baseAmounts, weighableTotalGrams } from '../js/catalogue/catalogue-model.js';

const RECIPE = {
  id: 'r1',
  name: 'Crema di prova',
  ingredients: [
    { label: 'Latte di prova', grams: 500, unit: 'ml' },
    { label: 'Farina di prova', grams: 2, unit: 'kg' },
    { label: 'Uova di prova', grams: 3, unit: 'pcs' },
    { label: 'Zucchero di prova', grams: 250 },
    { label: 'Sale di prova', grams: 0, unit: 'to taste' },
  ],
};

test('exportModelOf keeps each row in its own unit, with grams-per-unit (0 when not weighable)', () => {
  const amounts = baseAmounts(RECIPE);
  const m = exportModelOf(RECIPE, amounts, weighableTotalGrams(RECIPE));
  assert.equal(m.name, 'Crema di prova');
  assert.equal(m.trays, 0);
  assert.equal(m.totalG, 2750);
  assert.deepEqual(m.rows.map(r => [r.name, r.value, r.factor]), [
    ['Latte di prova', amounts[0], 1],
    ['Farina di prova', amounts[1], 1000],
    ['Uova di prova', amounts[2], 0],
    ['Zucchero di prova', amounts[3], 1],
    ['Sale di prova', null, 0],
  ]);
  assert.equal(m.rows[0].unit, 'ml');
  assert.equal(m.rows[3].unit, 'g');
  assert.ok(m.rows[2].unit.length > 0 && m.rows[4].unit.length > 0);
});

test('the amounts are taken as drawn (scaled), the total rounded; a non-positive total is 0', () => {
  const amounts = scaleCatalogue(RECIPE, 5500);
  const m = exportModelOf(RECIPE, amounts, 5500.4);
  assert.equal(m.totalG, 5500);
  m.rows.forEach((r, i) => assert.equal(r.value, amounts[i]));
  assert.equal(exportModelOf(RECIPE, amounts, 0).totalG, 0);
  assert.equal(exportModelOf(RECIPE, amounts, NaN).totalG, 0);
  assert.equal(exportModelOf(RECIPE, amounts, -5).totalG, 0);
});
