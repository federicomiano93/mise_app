import { describe, expect, it } from 'vitest';
import { normalizeCatalogueRecipe, rebaseAmounts, scaleFromRow } from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { en } from '../i18n/en';
import { format } from '../i18n/i18n';
import { snapshotAmounts } from './guidedRunModel';
import { snapshotOf } from './guidedSession';
import { recipeAmounts } from './recipeAmounts';
import { recipeExportModel } from './recipeExportModel';

// ⚠️ EVERY READER OF A BATCH SHOWS THE SAME NUMBERS (the owner's decision, 16 Nov 2026): the table, the guided run, the «Calculate
// from this ingredient» preview, the export model and «Use as base recipe» all take them from the one shared scaling, and the
// Total is those rows added up. Invented recipes and amounts only.

const t = (key: keyof typeof en, params?: Record<string, string | number>) => format('en', en[key], params);

const recipeOf = (raw: unknown): CatalogueRecipe => normalizeCatalogueRecipe(raw) as CatalogueRecipe;

// 2990 g, ten rows, all grams.
const PROVA = recipeOf({ id: 'pv', name: 'Pane di prova', ingredients: ([
  ['Farina A di prova', 1000], ['Farina B di prova', 640], ['Acqua di prova', 720], ['Burro di prova', 310], ['Zucchero di prova', 180],
  ['Tuorli di prova', 95], ['Sale di prova', 22], ['Lievito di prova', 14], ['Malto di prova', 6], ['Vaniglia di prova', 3],
] as const).map(([label, grams]) => ({ label, grams, unit: 'g' })) });

// Every kind of unit: weighed ones, pieces, spoons, «to taste».
const MIXED = recipeOf({ id: 'mx', name: 'Crema di prova', ingredients: [
  { label: 'Farina di prova', grams: 1200, unit: 'g' }, { label: 'Latte di prova', grams: 0.75, unit: 'l' },
  { label: 'Panna di prova', grams: 180, unit: 'ml' }, { label: 'Burro di prova', grams: 0.3, unit: 'kg' },
  { label: 'Zucchero di prova', grams: 260, unit: 'g' }, { label: 'Uova di prova', grams: 6, unit: 'pcs' },
  { label: 'Cannella di prova', grams: 1, unit: 'tsp' }, { label: 'Sale di prova', grams: 0, unit: 'to taste' },
] });

// The rows a reader shows, in grams, added up: weighed rows only.
const GRAMS_PER: Record<string, number> = { g: 1, kg: 1000, ml: 1, l: 1000 };
const addedUp = (recipe: CatalogueRecipe, values: readonly (number | null)[]): number => Math.round(recipe.ingredients.reduce(
  (sum, ing, i) => sum + (values[i] ?? 0) * (GRAMS_PER[ing.unit ?? 'g'] ?? 0), 0));

describe('one set of numbers for every reader of a batch', () => {
  for (const recipe of [PROVA, MIXED]) {
    for (const target of [1234, 3664, 4000, 4800, 7777, 12500]) {
      it(`${recipe.name} at ${target} g: table, guided run, export, «Use as base» agree, and the Total is the rows added up`, () => {
        const table = recipeAmounts(recipe, target, t, 'en-GB');
        expect(snapshotAmounts(snapshotOf(recipe, target)), 'the guided run').toStrictEqual(table.values);
        const model = recipeExportModel(recipe, table);
        expect(model.rows.map(row => row.value), 'the export').toStrictEqual(table.values);
        const saved = rebaseAmounts(recipe, target)!;
        table.values.forEach((value, i) => { if (value !== null) expect(saved[i], `«Use as base», row ${i}`).toBe(value); });
        expect(table.totalGrams).toBe(addedUp(recipe, table.values));
        expect(model.totalG).toBe(table.totalGrams);
        expect(table.total.num).toBe(String(table.totalGrams));
      });
    }
  }

  it('all in grams and scaled by its total, the Total is the batch typed, to the gram', () => {
    for (const target of [1234, 3664, 4000, 4800, 7777, 12500]) expect(recipeAmounts(PROVA, target, t, 'en-GB').totalGrams).toBe(target);
  });

  it('with litres and kilos nothing is corrected: the Total says what the rows weigh, and a warning says any gap of 1 g or more', () => {
    for (const target of [1234, 3664, 4000, 4800, 7777, 12500]) {
      const table = recipeAmounts(MIXED, target, t, 'en-GB');
      expect(table.totalGrams, String(target)).toBe(addedUp(MIXED, table.values));
      expect(Math.abs(table.totalGrams - target), String(target)).toBeLessThanOrEqual(10);
      // The warning's gap is exactly the batch less the Total shown, and there is none when they agree.
      const gap = target - table.totalGrams;
      expect(table.warning, String(target)).toStrictEqual(gap === 0 ? null : { diff: gap });
    }
  });

  it('from a row: the preview, the table, the export and «Use as base» agree; the chosen row exact; Total = the rows added up', () => {
    const preview = scaleFromRow(PROVA, 4, 241)!;
    const row = { index: 4, amount: preview.amount };
    const table = recipeAmounts(PROVA, preview.target, t, 'en-GB', row);
    expect(table.values).toStrictEqual(preview.amounts);
    expect(table.values[4]).toBe(241);
    // The guided run started from that batch keeps the row, so it shows the very same numbers (review of 16 Nov 2026: by its total
    // it read a few grams off, the chosen row included).
    const snapshot = snapshotOf(PROVA, preview.target, row);
    expect(snapshot.fromRow).toStrictEqual(row);
    expect(snapshotAmounts(snapshot), 'the guided run').toStrictEqual(preview.amounts);
    expect(recipeExportModel(PROVA, table).rows.map(r => r.value)).toStrictEqual(preview.amounts);
    expect(rebaseAmounts(PROVA, preview.target, row)).toStrictEqual(preview.amounts);
    expect(table.totalGrams).toBe(addedUp(PROVA, preview.amounts));
    expect(table.warning).toBe(null);
  });

  it('the guided run from a row agrees for every row and many typed amounts; a batch by its total keeps the saved shape as it was', () => {
    for (let index = 0; index < PROVA.ingredients.length; index++) {
      for (let typed = 2; typed <= 3000; typed += 37) {
        const preview = scaleFromRow(PROVA, index, typed);
        if (preview === null) continue;
        const row = { index, amount: preview.amount };
        expect(snapshotAmounts(snapshotOf(PROVA, preview.target, row)), `row ${index}, ${typed} g`)
          .toStrictEqual(recipeAmounts(PROVA, preview.target, t, 'en-GB', row).values);
      }
    }
    expect('fromRow' in snapshotOf(PROVA, 4000)).toBe(false);
    expect('fromRow' in snapshotOf(PROVA, 4000, null)).toBe(false);
  });

  it('the recipe as written: the Total is its rows added up', () => {
    const table = recipeAmounts(MIXED, null, t, 'en-GB');
    expect(table.totalGrams).toBe(addedUp(MIXED, table.values));
    expect(table.totalGrams).toBe(1200 + 750 + 180 + 300 + 260);
  });
});
