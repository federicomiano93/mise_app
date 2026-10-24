// kg and litres keep their decimals (to the gram / millilitre) on the recipe screen, in guided
// mixing and in its editor. Until 14 Oct 2026 every amount was rounded to a whole number in its
// own unit, so 1.84 kg of flour read «2 kg» and 0.4 kg read «0 kg».

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setLanguage, currentLanguage } from '../js/i18n.js';
import {
  scaleCatalogue, baseAmounts, roundInUnit, unitDecimals, formatAmount,
} from '../js/catalogue/catalogue-model.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = f => readFileSync(join(root, f), 'utf8');
const inLanguage = (lang, fn) => {
  const before = currentLanguage();
  try { setLanguage(lang); return fn(); } finally { setLanguage(before); }
};

// Made-up recipe: 0.4 kg flour + 250 ml milk + 2 eggs = 650 g weighable.
const MIXED = { ingredients: [
  { label: 'Farina di prova', grams: 0.4, unit: 'kg' },
  { label: 'Latte di prova', grams: 250, unit: 'ml' },
  { label: 'Uova di prova', grams: 2, unit: 'pcs' },
  { label: 'Sale di prova', grams: 0, unit: 'to taste' },
] };

test('only kg, l, dl and cl have decimals, down to one gram or millilitre', () => {
  assert.deepEqual(['kg', 'l', 'dl', 'cl', 'g', 'mg', 'ml', 'pcs', 'tsp', 'to taste'].map(unitDecimals),
    [3, 3, 2, 1, 0, 0, 0, 0, 0, 0]);
  assert.equal(roundInUnit(1.8375, 'kg'), 1.838);
  assert.equal(roundInUnit(1.8461538, 'l'), 1.846);
  assert.equal(roundInUnit(2.345, 'dl'), 2.35);
  assert.equal(roundInUnit(2.4, 'g'), 2);
  assert.equal(roundInUnit(2.5, 'pcs'), 3);
  assert.equal(roundInUnit('junk', 'kg'), 0);
});

test('⚠️ the base recipe keeps 0.4 kg (it used to read «0 kg»)', () => {
  assert.deepEqual(baseAmounts(MIXED), [0.4, 250, 2, null]);
});

test('⚠️ a scaled kg row keeps its decimals (1.846 kg, it used to read «2 kg»)', () => {
  // 3000 / 650 = 4.615…: 0.4 kg -> 1.846 kg, 250 ml -> 1154 ml, 2 eggs -> 9.
  assert.deepEqual(scaleCatalogue(MIXED, 3000), [1.846, 1154, 9, null]);
});

test('an all-grams recipe is unchanged: whole grams summing exactly to the target', () => {
  const out = scaleCatalogue({ ingredients: [
    { label: 'a', grams: 333, unit: 'g' }, { label: 'b', grams: 333, unit: 'g' }, { label: 'c', grams: 334, unit: 'g' },
  ] }, 1001);
  assert.ok(out.every(Number.isInteger));
  assert.equal(out.reduce((s, v) => s + v, 0), 1001);
});

test('formatAmount: the interface language decides the decimal mark; no trailing zeros, no grouping', () => {
  inLanguage('it', () => {
    assert.equal(formatAmount(1.846, 'kg'), '1,846');
    assert.equal(formatAmount(1.8, 'kg'), '1,8');
    assert.equal(formatAmount(2, 'kg'), '2');
    assert.equal(formatAmount(12000, 'g'), '12000');
    assert.equal(formatAmount(2.6, 'pcs'), '3');
  });
  inLanguage('en', () => {
    assert.equal(formatAmount(1.846, 'kg'), '1.846');
    assert.equal(formatAmount(12000, 'g'), '12000');
  });
});

test('every screen that prints a catalogue amount goes through formatAmount', () => {
  const detail = read('js/catalogue/catalogue-detail.js');
  assert.match(detail, /num: formatAmount\(value, unit\)/);
  const run = read('js/catalogue/guided-run.js');
  assert.match(run, /formatAmount\(row\.amount, row\.unit\)/);
  assert.match(run, /formatAmount\(amount, unitOf\(row\)\)/);
  assert.match(read('js/catalogue/guided-editor.js'), /formatAmount\(row\.grams, unitOf\(row\)\)/);
  for (const f of ['js/catalogue/guided-run.js', 'js/catalogue/guided-editor.js']) {
    assert.doesNotMatch(read(f), /maximumFractionDigits: 0/, `${f} still rounds amounts to whole numbers`);
  }
});
