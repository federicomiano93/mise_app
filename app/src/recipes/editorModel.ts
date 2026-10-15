// editorModel.ts — the recipe editor's working copy and the rules that turn it into what is saved: the pure half of
// js/catalogue/catalogue-editor.js (`working`, `cleanWorking`, `updateTotal`), with no React in it.
//
// ⚠️ EVERY ROW IS SPREAD, NEVER HAND-LISTED. The copy and the cleaning both rebuild every row, so a field named in
// neither is dropped on save — which is how opening a recipe to fix a typo would have wiped every ingredient link it
// had. The row keeps whatever it carries (its link, its `rid`, anything a later step adds); only the three fields the
// editor owns (label, grams, unit) are rewritten.

import {
  isWeighableUnit, normalizeShelfLifeDays, normalizeWeight, unitOf, weighableTotalGrams,
} from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import type { RecipeToSave } from './recipesStore';

export type Row = Readonly<Record<string, unknown>>;

// A row with the key that keeps it standing while it is typed in (never saved: it lives beside the row, not in it).
export interface EditRow {
  readonly key: number;
  readonly row: Row;
}

export interface Working {
  readonly name: string;
  readonly rows: readonly EditRow[];
  // Everything else the recipe carries (its id, the oven loss, the procedure…): passed to the cleaned copy as it was.
  readonly rest: Readonly<Record<string, unknown>>;
  // The two label boxes as typed. null = never touched: the recipe's stored value goes through unchanged (a net weight
  // of 12.5 g is not rounded to 13 by opening and saving a recipe whose box is not even shown).
  readonly netWeight: string | null;
  readonly shelfLife: string | null;
}

let counter = 0;
const nextKey = (): number => ++counter;

// The amount is '' (not 0) until somebody types: the box shows its placeholder.
export const emptyRow = (): Row => ({ label: '', grams: '', unit: 'g' });

const newRow = (): EditRow => ({ key: nextKey(), row: emptyRow() });

// null = a new recipe: empty, with one empty row and the placeholders showing (P20).
export function workingFrom(recipe: CatalogueRecipe | null): Working {
  if (recipe === null) return { name: '', rows: [newRow()], rest: {}, netWeight: null, shelfLife: null };
  const { name, ingredients, ...rest } = recipe;
  return {
    name,
    rows: ingredients.map(row => ({ key: nextKey(), row: { ...row, unit: unitOf(row) } })),
    rest,
    netWeight: null,
    shelfLife: null,
  };
}

// What the two label boxes show: what was typed, else the stored value.
export function netWeightText(working: Working): string {
  if (working.netWeight !== null) return working.netWeight;
  const grams = normalizeWeight(working.rest.netWeightG);
  return grams > 0 ? String(Math.round(grams)) : '';
}

// ⚠️ EMPTY IS «NOBODY HAS SAID», AND IT IS NOT ZERO: zero days would print today's date as a use-by.
export function shelfLifeText(working: Working): string {
  if (working.shelfLife !== null) return working.shelfLife;
  const days = normalizeShelfLifeDays(working.rest.shelfLifeDays);
  return days === null ? '' : String(days);
}

export const setName = (working: Working, name: string): Working => ({ ...working, name });

export const setRowFields = (working: Working, key: number, fields: Row): Working => ({
  ...working,
  rows: working.rows.map(item => (item.key === key ? { key, row: { ...item.row, ...fields } } : item)),
});

export const addRow = (working: Working): Working => ({ ...working, rows: [...working.rows, newRow()] });

// ⚠️ THE LAST ROW IS EMPTIED, NOT REMOVED: a recipe always has a row to type into.
export function removeRow(working: Working, key: number): Working {
  const rows = working.rows.filter(item => item.key !== key);
  return { ...working, rows: rows.length > 0 ? rows : [newRow()] };
}

// Trim the names, make the amounts non-negative numbers, drop the rows with no name — and give back everything else the
// recipe carries. Spread first (see above); only the fields this editor owns are rewritten.
export function cleanWorking(working: Working): RecipeToSave {
  const out: Record<string, unknown> = {
    ...working.rest,
    name: working.name.trim(),
    ingredients: working.rows
      .map(({ row }) => ({
        ...row,
        label: String(row.label ?? '').trim(),
        grams: Math.max(0, Number(row.grams) || 0),
        unit: unitOf(row),
      }))
      .filter(row => row.label),
  };
  // A box that was typed in replaces the stored value: 0 for an emptied net weight (the store turns it into a removal),
  // no key at all for an emptied shelf life.
  if (working.netWeight !== null) out.netWeightG = normalizeWeight(working.netWeight);
  if (working.shelfLife !== null) {
    const days = normalizeShelfLifeDays(working.shelfLife);
    if (days === null) delete out.shelfLifeDays;
    else out.shelfLifeDays = days;
  }
  return out as unknown as RecipeToSave;
}

// Whole grams, no thousands separator — the same reading as the recipe view.
const grams = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });

export const totalText = (clean: RecipeToSave): string => grams.format(weighableTotalGrams(clean));

// How many named rows are left out of the total (pieces, spoons, pinches, «to taste»).
export const notWeighedCount = (clean: RecipeToSave): number =>
  clean.ingredients.filter(row => !isWeighableUnit(unitOf(row))).length;
