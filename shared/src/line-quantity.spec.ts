// A Food cost recipe line's amount, typed in grams or kilos, stored in KILOS — run against BOTH implementations: the
// TypeScript port in shared/ and js/foodcost/line-quantity.js, which the live app uses today. Ported from the line-quantity
// tests of tests/foodcost-line-units-and-switch.test.mjs (8 Nov 2026, item 27 of docs/mise2-port-owed.md); the tests there
// that read the editor's source have their Mise 2 twins in app/src/foodcost (productEditorModel.spec.ts and
// FoodcostSection.editor.lines.spec.tsx). parity.spec.ts pairs the two files.

import { describe, expect, test } from 'vitest';
import * as ported from './line-quantity';
import * as legacyJs from '../../js/foodcost/line-quantity.js';

const legacy = legacyJs as unknown as typeof ported;

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const { KILO_LINE_UNITS, kilosFromTyped, typedFromKilos, tooMuchOfRecipe, TOO_MUCH_RECIPE_FACTOR } = m;

  test('a recipe line offers grams and kilos, like an ingredient line', () => {
    expect([...KILO_LINE_UNITS]).toStrictEqual(['g', 'kg']);
  });

  test('⚠️ kilos stay kilos: the box on «kg» stores exactly what is typed', () => {
    expect(kilosFromTyped('1.7', 'kg')).toBe(1.7);
    expect(kilosFromTyped('', 'kg')).toBe(0);
    expect(kilosFromTyped('abc', 'kg')).toBe(0);
    expect(typedFromKilos(1.7, 'kg')).toBe('1.7');
    expect(typedFromKilos(0, 'kg'), 'nothing yet shows the placeholder, not a 0').toBe('');
  });

  test('⚠️ typed in grams, the STORED value is still kilos — and never float noise', () => {
    expect(kilosFromTyped('522', 'g'), '522 / 1000 must not become 0.5220000000001').toBe(0.522);
    expect(kilosFromTyped('1500', 'g')).toBe(1.5);
    expect(kilosFromTyped('0.5', 'g')).toBe(0.0005);
    // Every whole gram up to 100 kg: nothing longer than six decimals is ever stored.
    for (let g = 1; g <= 100000; g++) {
      const kg = String(kilosFromTyped(String(g), 'g'));
      const decimals = (kg.split('.')[1] || '').length;
      if (decimals > 6 || /e/.test(kg)) expect.fail(`${g} g -> ${kg}`);
    }
  });

  test('⚠️ a box opens in grams: 3.233 kg shows «3233», 0.522 shows «522»', () => {
    expect(typedFromKilos(3.233, 'g')).toBe('3233');
    expect(typedFromKilos(0.522, 'g')).toBe('522');
    for (const kilos of [0.522, 1.7, 0.001, 12.345678, 0.000001, 25]) {
      const asGrams = typedFromKilos(kilos, 'g');
      expect(kilosFromTyped(asGrams, 'g'), `${kilos} kg shown as ${asGrams} g and read back`).toBe(kilos);
    }
  });

  test('⚠️ switching the unit keeps the typed number and changes its meaning', () => {
    expect(kilosFromTyped('522', 'g')).toBe(0.522);
    expect(kilosFromTyped('522', 'kg'), 'g -> kg: the box still says 522, now kilos').toBe(522);
    expect(kilosFromTyped('522', 'g'), 'and back to g: still 522, 0.522 kg stored').toBe(0.522);
    expect(kilosFromTyped('', 'kg'), 'an empty box changes nothing').toBe(kilosFromTyped('', 'g'));
  });

  test('tooMuchOfRecipe: only beyond 20 whole batches, only when the recipe makes something', () => {
    expect(TOO_MUCH_RECIPE_FACTOR).toBe(20);
    expect(tooMuchOfRecipe(20, 1), 'exactly 20x is fine').toBe(false);
    expect(tooMuchOfRecipe(20.001, 1), 'just over warns').toBe(true);
    expect(tooMuchOfRecipe(522, 0.522), 'grams typed as kilos').toBe(true);
    expect(tooMuchOfRecipe(3, 1), 'a real triple batch').toBe(false);
    expect(tooMuchOfRecipe(500, 0), 'a recipe of pieces only never warns').toBe(false);
    expect(tooMuchOfRecipe(500, null)).toBe(false);
    expect(tooMuchOfRecipe(500, undefined)).toBe(false);
    expect(tooMuchOfRecipe(Number.NaN, 1)).toBe(false);
    expect(tooMuchOfRecipe(500, Number.NaN)).toBe(false);
    expect(tooMuchOfRecipe(Number.POSITIVE_INFINITY, 1)).toBe(false);
  });

  test('the impossible numbers are still left to product-limits: nothing is clamped here', () => {
    expect(kilosFromTyped('-5', 'kg')).toBe(-5);
    expect(kilosFromTyped('-5', 'g')).toBe(-0.005);
  });
});
