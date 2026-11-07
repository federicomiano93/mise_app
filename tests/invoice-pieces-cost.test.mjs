// invoice-pieces-cost.test.mjs — a product counted in pieces is priced per piece since 5 Nov 2026 (his rule), and a
// recipe or a Food cost line that uses it in GRAMS must cost exactly what it cost when it was priced per kilo.
// Invented invoices shaped like the real ones (Chiaragel cornetti, a graffa carton).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { costRecipe } from '../js/catalogue/recipe-cost-model.js';
import { ingredientLineCost } from '../js/foodcost/foodcost-model.js';
import { formatPricePerUnit, pricePerKg } from '../js/price-model.js';
import { newCase } from './helpers/invoice-builders.mjs';

// What the venue keeps after an import: the price in force is the newest invoice's.
const stored = (fileIngredient) => ({
  name: fileIngredient.name,
  priceUnit: fileIngredient.priceUnit,
  pricePerUnit: fileIngredient.prices[fileIngredient.prices.length - 1].pricePerUnit,
  unitWeightKg: fileIngredient.unitWeightKg,
});
const imported = (line) => {
  const c = newCase();
  c.add([line]);
  return stored(c.build().importFile.ingredients[0]);
};
const recipeUsing = (grams) => ({
  id: 'R1', name: 'Test', lossPct: 0, ingredients: [{ label: 'Cornetti', grams, unit: 'g', kind: 'ingredient', refId: 'C' }],
});

const CORNETTI = { desc: 'SG.CR.1980 PF VUOTO 85gr* 50pz', code: 'CR1', qty: 1, unit: 'CT', total: 23.2 };
// The same cornetti as the import saved them before the change: 23.2 € over 50 × 85 g = 5.4588 €/kg.
const BEFORE = { name: 'Cornetti', priceUnit: 'kg', pricePerUnit: 5.4588, unitWeightKg: null };

test('the cornetti are now priced per piece: 0.464 € a piece of 85 g', () => {
  const after = imported(CORNETTI);
  assert.deepEqual([after.priceUnit, after.pricePerUnit, after.unitWeightKg], ['pcs', 0.464, 0.085]);
  assert.match(formatPricePerUnit(after), /0[.,]464/);
});

test('a recipe using cornetti in grams costs the same as when they were priced per kilo', () => {
  const after = imported(CORNETTI);
  assert.ok(Math.abs(pricePerKg(after) - pricePerKg(BEFORE)) < 0.0001, 'the same price per kilo');
  for (const grams of [85, 170, 1000, 4250]) {
    const was = costRecipe(recipeUsing(grams), { ingredients: { C: BEFORE } });
    const now = costRecipe(recipeUsing(grams), { ingredients: { C: after } });
    assert.equal(now.partial, false, `${grams} g`);
    assert.ok(Math.abs(now.totalCost - was.totalCost) < 0.001, `${grams} g: ${now.totalCost} vs ${was.totalCost}`);
    assert.equal(now.costedGrams, was.costedGrams);
  }
});

test('a Food cost line in grams costs the same; one in pieces now costs exactly the piece price', () => {
  const after = imported(CORNETTI);
  const grams = (ing) => ingredientLineCost({ qty: 170, unit: 'g' }, ing);
  assert.ok(Math.abs(grams(after).cost - grams(BEFORE).cost) < 0.001);
  assert.equal(grams(after).kg, grams(BEFORE).kg);
  // Two cornetti: priced per kilo it needed a piece weight nobody had written; now it is 2 × 0.464.
  assert.equal(ingredientLineCost({ qty: 2, unit: 'pcs' }, BEFORE).cost, null);
  assert.deepEqual(ingredientLineCost({ qty: 2, unit: 'pcs' }, after), { cost: 0.928, kg: 0.17, reason: null });
});

test('the graffa carton: per piece now, and still its carton\'s price per kilo', () => {
  const after = imported({ desc: 'MI GRAFFA mignon 35/40gr 2Kg* 55pz', code: 'GR', qty: 1, unit: 'CT', total: 14.5 });
  assert.deepEqual([after.priceUnit, after.pricePerUnit, after.unitWeightKg], ['pcs', 0.2636, 0.0364]);
  // 14.5 € / 2 kg = 7.25 €/kg; a piece rounded to 0.1 g moves it by under 0.2 %.
  assert.ok(Math.abs(pricePerKg(after) - 7.25) / 7.25 < 0.002);
});
