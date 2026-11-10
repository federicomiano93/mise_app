// A product counted in pieces is priced per piece since 5 Nov 2026 (his rule), and a recipe or a Food cost line that
// uses it in GRAMS must cost exactly what it cost when it was priced per kilo. Ported from
// tests/invoice-pieces-cost.test.mjs. Invented invoices shaped like the real ones (cornetti, a graffa carton).
//
// The invoice is read by BOTH readers (shared/ and js/); the cost is computed by the TypeScript code in shared/
// (recipe-cost-model.ts, foodcost-model.ts, price-model.ts), which parity.spec.ts pins to the js/ files.
//
// NOT PORTED: the check that `formatPricePerUnit` prints «0,464». In shared/ it takes the translator and the money
// formatter as arguments, so it is a screen-level check (the price text of a per-piece rate is pinned in
// price-write.spec.ts — «each» / «al pezzo», both apps — and its three decimals in price-model.spec.ts).

import { describe, expect, test } from 'vitest';
import { costRecipe } from './recipe-cost-model';
import { ingredientLineCost } from './foodcost-model';
import { pricePerKg } from './price-model';
import { implementations } from './invoice-zip/testing/implementations';
import { makeCase } from './invoice-zip/testing/invoice-builders';
import type { LineSpec } from './invoice-zip/testing/invoice-builders';

interface Stored { name: unknown; priceUnit: unknown; pricePerUnit: number; unitWeightKg: number | null }

const recipeUsing = (grams: number): Record<string, unknown> => ({
  id: 'R1', name: 'Test', lossPct: 0, ingredients: [{ label: 'Cornetti', grams, unit: 'g', kind: 'ingredient', refId: 'C' }],
});

const CORNETTI: LineSpec = { desc: 'SG.CR.1980 PF VUOTO 85gr* 50pz', code: 'CR1', qty: 1, unit: 'CT', total: 23.2 };
// The same cornetti as the import saved them before the change: 23.2 € over 50 × 85 g = 5.4588 €/kg.
const BEFORE: Stored = { name: 'Cornetti', priceUnit: 'kg', pricePerUnit: 5.4588, unitWeightKg: null };

describe.each(implementations)('%s', (_name, impl) => {
  // What the venue keeps after an import: the price in force is the newest invoice's.
  const imported = (line: LineSpec): Stored => {
    const c = makeCase(impl.caseImpl);
    c.add([line]);
    const ingredient = c.build().importFile.ingredients[0] as unknown as {
      name: unknown; priceUnit: unknown; unitWeightKg: number | null; prices: { pricePerUnit: number }[];
    };
    return {
      name: ingredient.name,
      priceUnit: ingredient.priceUnit,
      pricePerUnit: (ingredient.prices[ingredient.prices.length - 1] as { pricePerUnit: number }).pricePerUnit,
      unitWeightKg: ingredient.unitWeightKg,
    };
  };

  test('the cornetti are now priced per piece: 0.464 € a piece of 85 g', () => {
    const after = imported(CORNETTI);
    expect([after.priceUnit, after.pricePerUnit, after.unitWeightKg]).toStrictEqual(['pcs', 0.464, 0.085]);
  });

  test('a recipe using cornetti in grams costs the same as when they were priced per kilo', () => {
    const after = imported(CORNETTI);
    expect(Math.abs((pricePerKg(after) as number) - (pricePerKg(BEFORE) as number)), 'the same price per kilo').toBeLessThan(0.0001);
    for (const grams of [85, 170, 1000, 4250]) {
      const was = costRecipe(recipeUsing(grams), { ingredients: { C: BEFORE } });
      const now = costRecipe(recipeUsing(grams), { ingredients: { C: after } });
      expect(now.partial, `${grams} g`).toBe(false);
      expect(Math.abs((now.totalCost as number) - (was.totalCost as number)), `${grams} g: ${now.totalCost} vs ${was.totalCost}`).toBeLessThan(0.001);
      expect(now.costedGrams).toBe(was.costedGrams);
    }
  });

  test('a Food cost line in grams costs the same; one in pieces now costs exactly the piece price', () => {
    const after = imported(CORNETTI);
    const grams = (ing: Stored) => ingredientLineCost({ qty: 170, unit: 'g' }, ing);
    expect(Math.abs((grams(after).cost as number) - (grams(BEFORE).cost as number))).toBeLessThan(0.001);
    expect(grams(after).kg).toBe(grams(BEFORE).kg);
    // Two cornetti: priced per kilo it needed a piece weight nobody had written; now it is 2 × 0.464.
    expect(ingredientLineCost({ qty: 2, unit: 'pcs' }, BEFORE).cost).toBe(null);
    expect(ingredientLineCost({ qty: 2, unit: 'pcs' }, after)).toStrictEqual({ cost: 0.928, kg: 0.17, reason: null });
  });

  test('the graffa carton: per piece now, and still its carton\'s price per kilo', () => {
    const after = imported({ desc: 'MI GRAFFA mignon 35/40gr 2Kg* 55pz', code: 'GR', qty: 1, unit: 'CT', total: 14.5 });
    expect([after.priceUnit, after.pricePerUnit, after.unitWeightKg]).toStrictEqual(['pcs', 0.2636, 0.0364]);
    // 14.5 € / 2 kg = 7.25 €/kg; a piece rounded to 0.1 g moves it by under 0.2 %.
    expect(Math.abs((pricePerKg(after) as number) - 7.25) / 7.25).toBeLessThan(0.002);
  });
});
