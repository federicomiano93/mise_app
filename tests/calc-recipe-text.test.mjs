// Unit tests for the Copy/WhatsApp recipe text builder (P15 — the owner cannot
// read code, so this is the safety net for the export, which used to be impossible
// to test because it scraped the rendered DOM). Now it is a pure function over the
// same [{ name, grams }] data the screen renders, titled by the recipe's name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecipeText } from '../js/calculator-recipe-text.js';

const SEP = '-'.repeat(22);

test('output: title (uppercased name), separator, lines and the "Flour uniqua blue" split', () => {
  const rows = [
    { name: 'Flour uniqua blue', grams: 1000 },
    { name: 'Yeast', grams: 4 },
  ];
  const out = buildRecipeText('Focaccia', rows, 2000);
  assert.equal(out, [
    'FOCACCIA  2.0 kg',
    SEP,
    'Flour uniqua',
    'blue:       1000 g',
    'Yeast:         4 g',
  ].join('\n'));
});

test('"Flour uniqua blue" becomes two lines; a normal ingredient stays one line', () => {
  const out = buildRecipeText('Sourdough', [{ name: 'Flour uniqua blue', grams: 500 }], 500);
  const lines = out.split('\n');
  assert.equal(lines.length, 4); // title + separator + bare label + "blue:" line
  assert.equal(lines[2], 'Flour uniqua');
  assert.match(lines[3], /^blue:\s+500 g$/);

  const single = buildRecipeText('Brioche', [{ name: 'Water', grams: 1500 }], 1500);
  assert.equal(single.split('\n').length, 3); // title + separator + one line
});

test('grams are rounded the same way the screen rounds them', () => {
  // 118.6 is an invented fractional amount: it must round to a whole gram on screen.
  assert.match(buildRecipeText('Brioche', [{ name: 'Yeast', grams: 118.6 }], 3000), /Yeast:\s+119 g/);
  assert.match(buildRecipeText('Brioche', [{ name: 'Yeast', grams: 4.5 }], 3000), /Yeast:\s+5 g/);
});

test('total is shown in kg with one decimal; the title is the uppercased recipe name', () => {
  assert.match(buildRecipeText('Focaccia', [{ name: 'X', grams: 1 }], 2500), /^FOCACCIA {2}2\.5 kg/);
  assert.match(buildRecipeText('My New Recipe', [{ name: 'X', grams: 1 }], 1000), /^MY NEW RECIPE {2}1\.0 kg/);
});

test('no rows returns an empty string (nothing calculated yet)', () => {
  assert.equal(buildRecipeText('Focaccia', [], 2500), '');
  assert.equal(buildRecipeText('Focaccia', null, 2500), '');
});
