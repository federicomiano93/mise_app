import {
  DEFAULT_TRAY_WEIGHT, LOGICS, MAX_VISIBLE_RECIPES, isValidTrayWeight, moveIngredient, normalizeTrayWeight, usesTrays,
} from '@mise/shared/calculator-config';
import type { Logic, Recipe, RecipeIngredient } from '@mise/shared/calculator-config';
import { isLinked } from '@mise/shared/calculator-recipe-source';

// What the Recipes editor does with the recipes, as plain functions (ports of the working copy in js/recipes.js): it
// edits ONE copy of the whole `recipes` array, and Save writes that array over the latest configuration — the
// store's normaliser then rebuilds, from it, everything that must stay consistent with the recipes (the ingredient
// registry, the per-recipe maps).

// A recipe as it is being edited: the tray weight is what was TYPED, so an empty box can be refused on Save (the
// saved configuration normalises it).
export type EditableRecipe = Omit<Recipe, 'trayWeight'> & { trayWeight: number | '' };

export const toEditable = (recipes: readonly Recipe[]): EditableRecipe[] => recipes.map(recipe => ({ ...recipe }));

export const isBlank = (text: unknown): boolean => typeof text !== 'string' || text.trim() === '';

// A short random id after a prefix: `r-` for a recipe (the current app's `genId`).
export function newId(random: () => number = Math.random): string {
  return 'r-' + random().toString(36).slice(2, 8);
}

// A recipe starts empty with placeholders: orders, a thousand grams a tray, no leavening, last in the order.
// `visible` is false when four are already shown.
export function newRecipe(order: number, visible: boolean, random?: () => number): EditableRecipe {
  return {
    id: newId(random), name: '', logic: 'orders', trayWeight: DEFAULT_TRAY_WEIGHT, ingredients: [],
    leaveningKey: null, leaveningDefaultPct: 0, showLeavening: true, baselinePct: null,
    order, visible,
  };
}

// A recipe just added and left untouched: no name and no ingredients (and nothing linked). It is not kept.
export function isEmptyRecipe(recipe: EditableRecipe | undefined): boolean {
  return !recipe || (isBlank(recipe.name) && recipe.ingredients.length === 0 && !isLinked(recipe));
}

export const logicOf = (recipe: { readonly logic?: unknown }): Logic =>
  (LOGICS as unknown[]).includes(recipe.logic) ? (recipe.logic as Logic) : 'orders';

// How many recipes are flagged to show (the «at most four» guard).
export const visibleCount = (recipes: readonly EditableRecipe[]): number => recipes.filter(recipe => recipe.visible !== false).length;

export const isFull = (recipes: readonly EditableRecipe[]): boolean => visibleCount(recipes) >= MAX_VISIBLE_RECIPES;

// The first recipe that cannot be saved: a blank name, or — unless it is linked — no ingredient, or one with a blank
// name. null when all are complete.
//
// ⚠️ A LINKED RECIPE KEEPS ITS INGREDIENTS IN THE CATALOGUE. Demanding them here would refuse to save every tab the
// moment it was linked — the guard would fire on the very change it is meant to allow.
export function firstInvalid(recipes: readonly EditableRecipe[]): string | null {
  for (const recipe of recipes) {
    if (isBlank(recipe.name)) return recipe.id;
    if (isLinked(recipe)) continue;
    if (recipe.ingredients.length === 0 || recipe.ingredients.some(row => isBlank(row.label))) return recipe.id;
  }
  return null;
}

// A trays recipe needs a tray weight: the first one without a usable one.
export function firstBadTray(recipes: readonly EditableRecipe[]): string | null {
  return recipes.find(recipe => usesTrays(logicOf(recipe)) && !isValidTrayWeight(recipe.trayWeight))?.id ?? null;
}

// What is written: every tray weight a whole number (an empty box on a recipe that does not use trays becomes the
// default; the trays recipes were checked before). The link is left as it is.
export function settleRecipes(recipes: readonly EditableRecipe[]): Recipe[] {
  return recipes.map(recipe => ({ ...recipe, trayWeight: normalizeTrayWeight(recipe.trayWeight) }));
}

export function sameRecipes(a: readonly EditableRecipe[], b: readonly EditableRecipe[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function patchRecipe(recipes: readonly EditableRecipe[], id: string, patch: Partial<EditableRecipe>): EditableRecipe[] {
  return recipes.map(recipe => (recipe.id === id ? { ...recipe, ...patch } : recipe));
}

export function patchIngredient(recipe: EditableRecipe, index: number, patch: Partial<RecipeIngredient>): EditableRecipe {
  return { ...recipe, ingredients: recipe.ingredients.map((row, i) => (i === index ? { ...row, ...patch } : row)) };
}

export function addIngredient(recipe: EditableRecipe): EditableRecipe {
  return { ...recipe, ingredients: [...recipe.ingredients, { key: '', label: '', grams: 0 }] };
}

// One ingredient moved to another place (the reorder mode). The SAME row objects move (shared moveIngredient), so every
// row keeps its key and the leavening, found by that key, still points at the same ingredient: only the order changes.
// A move that changes nothing (out of range, the same place) gives back the very recipe it was handed.
export function moveIngredientIn(recipe: EditableRecipe, from: number, to: number): EditableRecipe {
  const moved = moveIngredient(recipe.ingredients, from, to);
  return moved.every((row, index) => row === recipe.ingredients[index]) ? recipe : { ...recipe, ingredients: moved };
}

// Where a row goes when React Aria says it was dropped «before» / «after» another (or «on» it, which is no place in a flat
// list). `keys` are the rows' identities in their present order. null when nothing moves. The same arithmetic as the
// recipe book's dropWorkingRow (recipes/editorModel.ts), over plain keys.
export type DropPosition = 'before' | 'after' | 'on';
export function dropMove(keys: readonly number[], moved: number, target: number, position: DropPosition): { from: number; to: number } | null {
  if (position === 'on' || moved === target) return null;
  const from = keys.indexOf(moved);
  const at = keys.indexOf(target);
  if (from < 0 || at < 0) return null;
  // The index the row takes once it has left its old place: the rows after it shift one up.
  const slot = position === 'before' ? at : at + 1;
  const to = from < slot ? slot - 1 : slot;
  return to === from ? null : { from, to };
}

// One place up (-1) or down (1) for the row with this key: the arrow keys on a grip. null at either end.
export function stepMove(keys: readonly number[], key: number, delta: -1 | 1): { from: number; to: number } | null {
  const from = keys.indexOf(key);
  const to = from + delta;
  return from < 0 || to < 0 || to >= keys.length ? null : { from, to };
}

// Removing the ingredient that is the leavening leaves the recipe with none.
export function removeIngredient(recipe: EditableRecipe, index: number): EditableRecipe {
  const row = recipe.ingredients[index];
  return {
    ...recipe,
    ingredients: recipe.ingredients.filter((_, i) => i !== index),
    leaveningKey: row && recipe.leaveningKey && recipe.leaveningKey === row.key ? null : recipe.leaveningKey,
  };
}

// ── The leavening ────────────────────────────────────────────────────────────────────────────

// One row the leavening can be: its option value, and its name ('' while it has none).
export type LeaveningRow = { readonly value: string; readonly label: string };

// The rows a recipe's leavening can be chosen from. A linked recipe offers the Catalogue's rows (by their own id);
// its own leftover list would let somebody pick an ingredient the dough no longer contains.
//
// ⚠️ An own ingredient with no key cannot be pointed at yet: its option is `#<position>`, and it gets a key the
// moment it is chosen.
export function leaveningRows(recipe: EditableRecipe, linkedRows: readonly RecipeIngredient[] | null): LeaveningRow[] {
  return (linkedRows ?? recipe.ingredients).map((row, index) => ({ value: row.key || `#${index}`, label: row.label }));
}

// The key a new leavening row gets: its name as a slug, then its position (the current app's).
//
// ⚠️ A KEY NO OTHER ROW HAS (current app 262efcfe): rows can be reordered, so «name-<index>» may already be the key of an
// older row, and two rows sharing it would hand the leavening to whichever comes first.
export function keyForRow(label: string, index: number, taken: readonly string[] = []): string {
  let key = `${(label || 'ing').toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${index}`;
  while (taken.includes(key)) key += '-x';
  return key;
}

// «Which ingredient makes the dough rise»: '' is «nothing rises», a real answer.
//
// ⚠️ WHEN LINKED, THE CHOICE IS STORED AS leaveningRid (the row's own id), picked from the CATALOGUE's rows. (The
// current app looked the pick up among the tab's own leftover rows, which a linked tab's ids never match.)
export function chooseLeavening(
  recipe: EditableRecipe, picked: string, linkedRows: readonly RecipeIngredient[] | null,
): EditableRecipe {
  if (!picked) return linkedRows ? { ...recipe, leaveningRid: null } : { ...recipe, leaveningKey: null };
  let next: EditableRecipe;
  if (linkedRows) {
    if (!linkedRows.some(row => row.key === picked)) return recipe;
    next = { ...recipe, leaveningRid: picked };
  } else {
    const index = picked.startsWith('#') ? Number(picked.slice(1)) : recipe.ingredients.findIndex(row => row.key === picked);
    const row = recipe.ingredients[index];
    if (!row) return recipe;
    const key = row.key || keyForRow(row.label, index, recipe.ingredients.filter(other => other !== row).map(other => other.key));
    next = { ...patchIngredient(recipe, index, { key }), leaveningKey: key };
  }
  const pct = next.leaveningDefaultPct || 1;
  // ⚠️ A LINKED PICK RESTARTS THE BASELINE AT THE STARTING % (the current app's fix, PR #376; the shared twin is
  // calculator-recipe-source.ts chooseLeavening). A baseline left from the tab's old own recipe would silently change
  // the Catalogue's yeast at the very % every phone starts from (0.65 kept, 0.8 start → ×1.23).
  return { ...next, leaveningDefaultPct: pct, baselinePct: linkedRows || next.baselinePct == null ? pct : next.baselinePct };
}

// What the leavening select shows: the chosen row's option value, or '' for none.
export function leaveningValue(recipe: EditableRecipe, linked: boolean): string {
  return (linked ? recipe.leaveningRid : recipe.leaveningKey) || '';
}

// ── The link to the Catalogue ────────────────────────────────────────────────────────────────

// The leavening has to be chosen again: it now points at a row in a different recipe, and guessing by name is the
// thing being avoided. The recipe's own ingredient list stays as it was (the tab ignores it while linked).
export function linkTo(recipe: EditableRecipe, catalogueId: string): EditableRecipe {
  const { leaveningRid: _gone, ...rest } = recipe;
  void _gone;
  return { ...rest, catalogueId };
}

// ⚠️ UNLINKING LEAVES THE TAB WITH NOTHING RATHER THAN A STALE COPY: both keys are deleted, not set to null.
export function unlink(recipe: EditableRecipe): EditableRecipe {
  const { catalogueId: _id, leaveningRid: _rid, ...rest } = recipe;
  void _id;
  void _rid;
  return rest;
}
