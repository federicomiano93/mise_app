// Panificio Miano, 29 Oct 2026: «avevo calcolato una ricetta nel calcolatore ma nel tablet non
// lo vedo». A dough made «from a total» on the PC WAS in the tablet's dough history, but its card
// said «Nessun prodotto inserito.» — the card listed only client products, trays and extra dough,
// so the one number such a dough is made from (the grams typed) appeared nowhere until the card
// was opened. The card now says how much dough it is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSheet, doughAmountLine } from '../js/log-model.js';
import { _dictionaries, translate } from '../js/i18n.js';

const read = f => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ings = [{ key: 'flour', label: 'Farina 0', grams: 1000 }, { key: 'water', label: 'Acqua', grams: 650 }];
const mk = (logic, extra = {}) => ({ id: 'r', name: 'Pane semplice', logic, ingredients: ings, leaveningKey: null, leaveningDefaultPct: 0, baselinePct: 0, trayWeight: 1000, ...extra });
const loaf = { id: 'a', name: 'Pagnotta', clientName: 'Bar', qty: 10, weightG: 500, kind: 'number', crate: { show: false } };
const version = (recipe, opts) => ({ items: opts.items || [], occasional: [], sheet: buildSheet({ recipe, ...opts }) });

test('a «from a total» dough: the card says the total, not «no products entered»', () => {
  assert.deepEqual(doughAmountLine(version(mk('total'), { totalInput: 1650 })), { kind: 'total', g: 1650 });
});

test('«orders + total» with no product typed: the total; with products: the typed part on top', () => {
  assert.deepEqual(doughAmountLine(version(mk('both'), { totalInput: 3000 })), { kind: 'total', g: 3000 });
  assert.deepEqual(doughAmountLine(version(mk('both'), { items: [loaf], totalInput: 3000 })), { kind: 'typed', g: 3000 });
  assert.equal(doughAmountLine(version(mk('both'), { items: [loaf], totalInput: 0 })), null, 'nothing typed: nothing to add');
});

test('an orders dough is explained by its products; trays have their own line', () => {
  assert.equal(doughAmountLine(version(mk('orders'), { items: [loaf] })), null);
  assert.equal(doughAmountLine(version(mk('trays'), { trays: 3 })), null);
  assert.equal(doughAmountLine(version(mk('traysTotal'), { trays: 3, totalInput: 500 })), null);
  assert.equal(doughAmountLine(version(mk('orders'), { items: [] })), null, 'an empty dough still says «no products»');
});

test('extra dough alone is already said by its own line', () => {
  assert.equal(doughAmountLine(version(mk('orders'), { items: [], extraGrams: 400 })), null);
  assert.deepEqual(doughAmountLine(version(mk('both'), { totalInput: 1000, extraGrams: 400 })), { kind: 'total', g: 1400 });
});

test('a total sheet saved before typed_g still shows its total; junk never reads as a number', () => {
  assert.deepEqual(doughAmountLine({ items: [], sheet: { total_g: 2200, extra_g: 0, ingredients: [] } }), { kind: 'total', g: 2200 });
  assert.equal(doughAmountLine({ items: [], sheet: { total_g: 'x', extra_g: 0 } }), null);
  assert.equal(doughAmountLine({ items: [] }), null);
  assert.equal(doughAmountLine(null), null);
});

test('the history card draws the line, in both languages, grouped like grams', () => {
  const view = read('js/log-view.js');
  assert.match(view, /doughAmountLine\(version\)/);
  assert.match(view, /t\('calc\.historyTotal', \{ g: formatGrams\(amount\.g\) \}\)/);
  assert.match(view, /t\('calc\.traysTypedPart', \{ g: formatGrams\(amount\.g\) \}\)/);
  const d = _dictionaries();
  assert.equal(translate(d, 'en', 'calc.historyTotal', { g: '1,650' }), 'Total dough: 1,650 g');
  assert.equal(translate(d, 'it', 'calc.historyTotal', { g: '1.650' }), 'Impasto totale: 1.650 g');
});
