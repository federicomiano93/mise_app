// editorModel.ts — the recipe editor's working copy and the rules that turn it into what is saved: the pure half of
// js/catalogue/catalogue-editor.js (`working`, `cleanWorking`, `updateTotal`), with no React in it.
//
// ⚠️ EVERY ROW IS SPREAD, NEVER HAND-LISTED. The copy and the cleaning both rebuild every row, so a field named in
// neither is dropped on save — which is how opening a recipe to fix a typo would have wiped every ingredient link it
// had. The row keeps whatever it carries (its link, its `rid`, anything a later step adds); only the three fields the
// editor owns (label, grams, unit) are rewritten.

import {
  applyLink, isSameLink, isWeighableUnit, linkOf, linkedItemName, moveRow, normalizeShelfLifeDays, normalizeWeight, unitOf,
  weighableTotalGrams,
} from '@mise/shared/catalogue-model';
import type { CatalogueRecipe } from '@mise/shared/catalogue-model';
import { categoryOf } from '@mise/shared/recipe-shelf';
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
  // The image label's two boxes (labelTexts.ts) as typed, with the same rule: null = never touched, the stored text goes
  // through as it is (in `rest`).
  readonly labelName: string | null;
  readonly labelText: string | null;
  // The HACCP label's storage text (labelTexts.ts), with the same rule.
  readonly haccpStorage: string | null;
  // The recipe's category as the menu shows it now ('' = none), and what it showed when the editor opened. ⚠️ THE CATEGORY GOES
  // TO THE STORE ONLY WHEN THE TWO DIFFER (cleanWorking): a recipe filed under a word that has since left the list shows «no
  // category» here, and an unrelated save must not strip the word from it. The stored word is NOT in `rest` for that reason.
  readonly category: string;
  readonly categoryStart: string;
}

// The most a recipe's name may hold: the rules refuse a name of 200 characters or more (firestore.rules, `recipes`), and a
// save that is refused AFTER the screen has left (the save is local-first) would throw the typing away.
// ⚠️ NEW IN MISE 2: the current app has no such cap, and a name that long fails there at the database.
export const NAME_MAX_LENGTH = 199;

// The four boxes nobody has typed in.
const UNTOUCHED = { netWeight: null, shelfLife: null, labelName: null, labelText: null, haccpStorage: null } as const;
// No category chosen, and none to start from.
const NO_CATEGORY = { category: '', categoryStart: '' } as const;

let counter = 0;
const nextKey = (): number => ++counter;

// The amount is '' (not 0) until somebody types: the box shows its placeholder.
export const emptyRow = (): Row => ({ label: '', grams: '', unit: 'g' });

const newRow = (): EditRow => ({ key: nextKey(), row: emptyRow() });

// null = a new recipe: empty, with one empty row and the placeholders showing (P20).
// `categories` is the venue's list: the starting choice is the recipe's word SPELLED AS THE LIST SPELLS IT, '' for none or a word
// that has left the list. ⚠️ `category` and `archived` stay OUT of `rest`: the category travels only when moved (see Working), and
// a save never sends the archive flag (the store keeps it).
export function workingFrom(recipe: CatalogueRecipe | null, categories: readonly string[] = []): Working {
  if (recipe === null) return { name: '', rows: [newRow()], rest: {}, ...UNTOUCHED, ...NO_CATEGORY };
  const { name, ingredients, ...others } = recipe;
  const rest: Record<string, unknown> = { ...others };
  delete rest.category;
  delete rest.archived;
  const start = categoryOf(recipe, categories);
  return {
    name,
    rows: ingredients.map(row => ({ key: nextKey(), row: { ...row, unit: unitOf(row) } })),
    rest,
    ...UNTOUCHED,
    category: start,
    categoryStart: start,
  };
}

// A DUPLICATE of a recipe, as the working copy of a NEW recipe (the recipe page's «Duplicate»). Nothing is saved by this: it
// is only what the new-recipe editor starts from, and it starts dirty.
//
// ⚠️ `rest` IS A WHITELIST, NEVER `workingFrom`'s «everything else»: that carries the original's `id` (and `bakery`), and
// cleanWorking spreads `rest` into what is saved, so a copy that kept the id would OVERWRITE THE ORIGINAL. What a copy
// takes: the pack weight, the shelf life, the mixing procedure, the image label's ingredients text and the category. What it leaves: the archive flag, the id, the venue, the oven loss and the two
// weighings (`lossPct`, `rawGrams`, `cookedGrams` are Food cost's, measured on the ORIGINAL's products).
// ⚠️ EVERY ROW COMES AS IT IS, `rid` included: a rid is only unique within one recipe, and keeping it keeps the procedure's
// step → row references valid (and a link to an ingredient or a recipe stays a link).
// ⚠️ THE NAME IS `copyName(original)` MADE TO FIT THE NAME BOX: when the whole is too long, the ORIGINAL's name loses its
// end, so the «(copy)» is never the part that is cut.
// ⚠️ THE CATEGORY IS COPIED (as the list spells it) AND COUNTS AS CHOSEN — the copy starts from «no category», so it is saved
// with the original's. THE ARCHIVE NEVER IS: a copy is a recipe on the shelf, not in the fold.
export function duplicateWorking(
  recipe: CatalogueRecipe,
  copyName: (name: string) => string,
  categories: readonly string[] = [],
): Working {
  let name = copyName(recipe.name);
  if (name.length > NAME_MAX_LENGTH) {
    const kept = recipe.name.slice(0, Math.max(0, recipe.name.length - (name.length - NAME_MAX_LENGTH))).trimEnd();
    name = copyName(kept);
  }
  const from = recipe as unknown as Readonly<Record<string, unknown>>;
  const rest: Record<string, unknown> = {};
  // ⚠️ NOT the image label's title (`labelName`): it names the ORIGINAL, and a copy printed with it would carry the other
  // product's name. Left out, the copy's label shows its own name in capitals until somebody types one.
  for (const key of ['netWeightG', 'shelfLifeDays', 'steps', 'endNote', 'labelIngredientsText', 'haccpStorage'] as const) {
    if (from[key] !== undefined) rest[key] = JSON.parse(JSON.stringify(from[key])) as unknown;
  }
  return {
    name,
    rows: recipe.ingredients.map(row => ({ key: nextKey(), row: { ...row, unit: unitOf(row) } })),
    rest,
    ...UNTOUCHED,
    category: categoryOf(recipe, categories),
    categoryStart: '',
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

// A recipe READ FROM A PHOTOGRAPH, as the working copy of a NEW recipe (js/catalogue/catalogue-editor.js, the `draft`
// branch of renderEditor). Nothing is saved by a read: this is only what the editor starts from.
//
// ⚠️ NO OVEN LOSS HERE, AND THAT IS NOT AN OVERSIGHT. Since 13 Sep 2026 the dough is weighed raw and cooked on a product's
// recipe line in Food cost, and the catalogue store no longer writes the loss at all — a value carried on a draft would be
// thrown away on Save while looking kept.
// ⚠️ NET WEIGHT AND SHELF LIFE ONLY WHEN THE READ HAS THEM: a recipe nobody has given a shelf life must stay without one,
// because 0 days would print today's date as a use-by.
// A draft with no rows still gets one empty row to type into.
export function workingFromDraft(draft: unknown): Working {
  const read = (typeof draft === 'object' && draft !== null ? draft : {}) as Record<string, unknown>;
  const given: readonly unknown[] = Array.isArray(read.ingredients) ? read.ingredients as unknown[] : [];
  const rows = given.length > 0 ? given : [emptyRow()];
  const grams = normalizeWeight(read.netWeightG);
  const days = normalizeShelfLifeDays(read.shelfLifeDays);
  return {
    name: typeof read.name === 'string' ? read.name : '',
    rows: rows.map(item => {
      const row = (typeof item === 'object' && item !== null ? item : {}) as Row;
      return { key: nextKey(), row: { ...row, unit: unitOf(row) } };
    }),
    rest: { ...(grams > 0 ? { netWeightG: grams } : {}), ...(days !== null ? { shelfLifeDays: days } : {}) },
    ...UNTOUCHED,
    ...NO_CATEGORY,
  };
}

// A working copy that travelled in the navigation state (the typed copy kept while the photo screen is open), made
// trustworthy again: the state of a history entry can come back from a reload, so its shape is checked, and the rows
// get FRESH keys (a reload restarts the counter, and two rows with one key would be one row to React). null when it is
// not a working copy.
export function restoreWorking(value: unknown): Working | null {
  if (typeof value !== 'object' || value === null) return null;
  const held = value as Record<string, unknown>;
  if (typeof held.name !== 'string' || !Array.isArray(held.rows)) return null;
  const rows: EditRow[] = [];
  for (const item of held.rows as unknown[]) {
    const row = typeof item === 'object' && item !== null ? (item as { row?: unknown }).row : undefined;
    if (typeof row !== 'object' || row === null) return null;
    rows.push({ key: nextKey(), row: row as Row });
  }
  if (rows.length === 0) rows.push(newRow());
  const rest = typeof held.rest === 'object' && held.rest !== null ? held.rest as Record<string, unknown> : {};
  return {
    name: held.name,
    rows,
    rest,
    netWeight: typeof held.netWeight === 'string' ? held.netWeight : null,
    shelfLife: typeof held.shelfLife === 'string' ? held.shelfLife : null,
    labelName: typeof held.labelName === 'string' ? held.labelName : null,
    labelText: typeof held.labelText === 'string' ? held.labelText : null,
    haccpStorage: typeof held.haccpStorage === 'string' ? held.haccpStorage : null,
    category: typeof held.category === 'string' ? held.category : '',
    categoryStart: typeof held.categoryStart === 'string' ? held.categoryStart : '',
  };
}

// What the image label's two boxes show: what was typed, else the stored text.
export const labelNameText = (working: Working): string =>
  working.labelName ?? (typeof working.rest.labelName === 'string' ? working.rest.labelName : '');
export const labelIngredientsBoxText = (working: Working): string =>
  working.labelText ?? (typeof working.rest.labelIngredientsText === 'string' ? working.rest.labelIngredientsText : '');

// The HACCP storage box: what was typed, else the stored text.
export const haccpStorageText = (working: Working): string =>
  working.haccpStorage ?? (typeof working.rest.haccpStorage === 'string' ? working.rest.haccpStorage : '');

export const setName = (working: Working, name: string): Working => ({ ...working, name });

export const setCategory = (working: Working, category: string): Working => ({ ...working, category });

export const setRowFields = (working: Working, key: number, fields: Row): Working => ({
  ...working,
  rows: working.rows.map(item => (item.key === key ? { key, row: { ...item.row, ...fields } } : item)),
});

// What a pick hands back: the item's kind and id, and its invoice name (the fallback for a row's name).
export interface Chosen {
  readonly kind: 'ingredient' | 'recipe';
  readonly refId: string;
  readonly name: string;
}

// ⚠️ THE ONE PLACE A ROW'S LINK IS WRITTEN, through applyLink (the suggestion list and the chooser both come here). `null`
// removes the link and keeps the name.
// ⚠️ THE NAME FOLLOWS THE PICK (his decision, 9 Oct 2026): a pick that CHANGES the link sets the row's name to the linked
// item's display name; choosing what is already there never undoes a name typed since.
// ⚠️ applyLink MUTATES, and the working copy is React state: it is given a COPY of the row, never the row itself.
export function linkRowTo(
  working: Working,
  key: number,
  chosen: Chosen | null,
  ingredients: unknown,
  recipes: unknown,
): Working {
  return {
    ...working,
    rows: working.rows.map(item => {
      if (item.key !== key) return item;
      const copy: Record<string, unknown> = { ...item.row };
      const same = isSameLink(linkOf(copy), chosen);
      applyLink(copy, chosen, same ? {} : { label: linkedItemName(chosen, ingredients, recipes) });
      return { key, row: copy };
    }),
  };
}

export const addRow = (working: Working): Working => ({ ...working, rows: [...working.rows, newRow()] });

// ⚠️ THE LAST ROW IS EMPTIED, NOT REMOVED: a recipe always has a row to type into.
export function removeRow(working: Working, key: number): Working {
  const rows = working.rows.filter(item => item.key !== key);
  return { ...working, rows: rows.length > 0 ? rows : [newRow()] };
}

// ── Reordering ───────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ THE SAME EditRow OBJECTS MOVE (shared moveRow reorders the list, it copies nothing), so a row keeps its `row` — its
// link and its `rid` — and a guided mixing step that points at a row by `rid` is never unhooked by a reorder.
// A move that changes nothing (out of range, the same place) gives back the very `working` it was given.
export function moveWorkingRow(working: Working, from: number, to: number): Working {
  const rows = moveRow(working.rows, from, to);
  return rows.every((item, index) => item === working.rows[index]) ? working : { ...working, rows };
}

// One place up (-1) or down (1) for the row with this key: the arrow keys on a grip.
export function stepWorkingRow(working: Working, key: number, delta: -1 | 1): Working {
  const from = working.rows.findIndex(item => item.key === key);
  return from < 0 ? working : moveWorkingRow(working, from, from + delta);
}

export type DropPosition = 'before' | 'after' | 'on';

// What React Aria's onReorder says (the row moved, the row it was dropped at, and on which side) as indices for moveRow.
// «On» is no place for a row in a flat list: nothing moves.
export function dropWorkingRow(working: Working, movedKey: number, targetKey: number, position: DropPosition): Working {
  if (position === 'on' || movedKey === targetKey) return working;
  const from = working.rows.findIndex(item => item.key === movedKey);
  const target = working.rows.findIndex(item => item.key === targetKey);
  if (from < 0 || target < 0) return working;
  // The index the row takes once it has left its old place: the rows after it shift one up.
  const slot = position === 'before' ? target : target + 1;
  return moveWorkingRow(working, from, from < slot ? slot - 1 : slot);
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
  // The image label's boxes, typed: handed over as typed (the store trims them, and an empty one takes the field away).
  if (working.labelName !== null) out.labelName = working.labelName;
  if (working.labelText !== null) out.labelIngredientsText = working.labelText;
  if (working.haccpStorage !== null) out.haccpStorage = working.haccpStorage;
  // The category only when the choice MOVED from where the editor started ('' = «no category», a removal).
  if (working.category !== working.categoryStart) out.category = working.category;
  return out as unknown as RecipeToSave;
}

// Whole grams, no thousands separator — the same reading as the recipe view.
const grams = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0, useGrouping: false });

export const totalText = (clean: RecipeToSave): string => grams.format(weighableTotalGrams(clean));

// How many named rows are left out of the total (pieces, spoons, pinches, «to taste»).
export const notWeighedCount = (clean: RecipeToSave): number =>
  clean.ingredients.filter(row => !isWeighableUnit(unitOf(row))).length;
