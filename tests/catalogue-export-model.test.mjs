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

// ── kg and litres keep their decimals in the files too (fix/catalogue-kg-litre-decimals) ──────────

import { setLanguage, currentLanguage } from '../js/i18n.js';
import { rowTextOf, xlsxSheet } from '../js/recipe-export.js';

const DECIMALS = {
  id: 'r2',
  name: 'Impasto di prova',
  ingredients: [
    { label: 'Farina di prova', grams: 0.4, unit: 'kg' },
    { label: 'Latte di prova', grams: 1.25, unit: 'l' },
    { label: 'Uova di prova', grams: 2, unit: 'pcs' },
  ],
};

test('⚠️ a 1.846 kg row is «1,846 kg» in the PDF (as on the Italian screen), never «2 kg»', () => {
  const before = currentLanguage();
  try {
    setLanguage('it');
    const amounts = scaleCatalogue(DECIMALS, 3000);
    const m = exportModelOf(DECIMALS, amounts, 3000);
    assert.deepEqual(m.rows.map(r => r.decimals), [3, 3, 0]);
    assert.deepEqual(m.rows.map(rowTextOf), ['0,727 kg', '2,273 l', '4 pz']);
  } finally { setLanguage(before); }
});

test('⚠️ in Excel a kg / l cell holds the decimals and its format does not round them away', () => {
  const amounts = scaleCatalogue(DECIMALS, 3000);
  const m = exportModelOf(DECIMALS, amounts, 3000);
  const { data } = xlsxSheet({ title: 'T', rows: m.rows, totalLabel: 'Totale', totalG: m.totalG });
  assert.deepEqual([data[2][1].value, data[2][1].format], [0.727, 'General "kg"']);
  assert.deepEqual([data[3][1].value, data[3][1].format], [2.273, 'General "l"']);
  assert.equal(data[4][1].format, `0 "${m.rows[2].unit}"`);
  // 0.727 kg + 2.273 l = 3000 g, the screen's total: the spreadsheet computes it itself.
  assert.deepEqual([data.at(-1)[1].value, data.at(-1)[1].type], ['B3*1000+B4*1000', 'Formula']);
});

test('the Calculator rows are untouched: whole grams, «0 "g"»', () => {
  assert.equal(rowTextOf({ name: 'a', grams: 14400.4 }), '14400 g');
  const { data } = xlsxSheet({ title: 'T', rows: [{ name: 'a', grams: 14400.4 }], totalLabel: 'T', totalG: 14400 });
  assert.equal(data[2][1].format, '0 "g"');
});
