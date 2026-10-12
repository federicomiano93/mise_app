// What the Dough history's two editors save: «Add log» (a new log by hand) and «Edit log» (a new version of a
// manual log). Pure: the screens hold the working copy and hand it in; the store writes.
//
// A port of the part before the write of `doCommit` in js/log-add.js and of `openLogEdit` / `doSave` in
// js/log-edit.js (both files draw on load, so they cannot be imported into a spec: logVersions.spec.ts checks
// the behaviour their tests pin — tests/log-typed-total, log-edit-rows, calculator-trays).
//
// ⚠️ A HAND-MADE LOG IS SAVED FROM THE RECIPE THE CALCULATOR WOULD SHOW: a linked tab's catalogue rows
// (`recipeToSave`), and refused — never a sheet of zeros — when they are not there yet, gone, empty or not
// weighable, with the same sentence as the work view.
//
// ⚠️ AN EDIT RECALCULATES WITH THE RECIPE THE LOG WAS MADE WITH (the version's frozen `recipe`), never today's,
// and at the tray weight it was made with; it keeps the leavening %, the extra dough, the divisor's n and the
// typed total of the version it edits (`typedTotalOf`: «both» logs once lost it, silently lowering every
// ingredient). A log written before the frozen recipe existed falls back to today's recipe, or it could not be
// edited at all.
//
// ⚠️ THE STORED TEXT IS THE CURRENT APP'S (calculatorSave.ts): the caller reads the two words with t() AT SAVE
// TIME and hands them in; the timestamp is the English one of log-time.

import {
  getDivisorIncluded, getRecipeById, getRecipes, getTabProducts, normalizeTrays, usesOrders, usesTrays,
} from '@mise/shared/calculator-config';
import type { CalculatorConfig, Recipe, TabProduct } from '@mise/shared/calculator-config';
import { canCalculate, isLinked } from '@mise/shared/calculator-recipe-source';
import {
  buildLogText, buildSheet, editRows, latestVersion, recipeSnapshot, traysEditState, traysSheetRecipe, typedTotalOf,
} from '@mise/shared/log-model';
import type { EditRow, Log, LogLine, LogTextWords, LogVersion, OccasionalClient } from '@mise/shared/log-model';
import { logTimestamp } from '@mise/shared/log-time';
import { sourceRecipe, stillLoading } from './calculatorResult';
import type { StoredDoc } from './calculatorSource';

const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

// The recipe a hand-made log is saved from, or why it cannot be (the work view's sentences: problemSentence).
export type RecipeToSave =
  | { readonly recipe: Recipe }
  | { readonly problem: 'loading' }
  | { readonly problem: 'missing' | 'empty' | 'unweighable'; readonly row: string };

// js/calculator-catalogue-link.js `recipeToSave`, with Mise 2's extra state: a linked recipe that has not ARRIVED
// is not one that is gone (two sentences).
export function recipeToSave(recipe: Recipe, linked: Readonly<Record<string, StoredDoc | null>>): RecipeToSave {
  if (!isLinked(recipe)) return { recipe };
  if (stillLoading(recipe, linked)) return { problem: 'loading' };
  const { source, resolved } = sourceRecipe(recipe, linked);
  if (!canCalculate(resolved)) return { problem: resolved.problem ?? 'empty', row: resolved.problemRow };
  return { recipe: source };
}

// One quantity row of an editor: a product line with the quantity typed so far.
export type QtyRow = EditRow;

function productRow(product: TabProduct): Omit<QtyRow, 'qty'> {
  return {
    id: product.id, name: product.name, clientName: product.clientName, weightG: product.weight, kind: product.kind,
    crate: product.crate || { show: false, perBox: 20 },
  };
}

// The line a version stores for a row (js: the same seven keys, the quantity a clean number).
function savedLine(row: QtyRow): LogLine {
  return {
    id: row.id, name: row.name, clientName: row.clientName,
    qty: num(row.qty), weightG: num(row.weightG), kind: row.kind, crate: row.crate as LogLine['crate'],
  };
}

// ── «Add log» ───────────────────────────────────────────────────────────────────────────────────────────────

// The rows «Add log» starts from when a recipe is picked: every product of the recipe at zero, grouped as the
// Calculator orders them; none for a recipe that does not take orders (it has only a total or trays).
export function manualRows(config: CalculatorConfig, recipeId: string): QtyRow[] {
  const recipe = getRecipeById(config, recipeId);
  if (!recipe || !usesOrders(recipe.logic)) return [];
  return getTabProducts(config, recipeId).map(product => ({ ...productRow(product), qty: 0 }));
}

export interface ManualInputs {
  readonly config: CalculatorConfig;
  readonly recipeId: string;
  // recipeToSave's recipe.
  readonly recipe: Recipe;
  readonly rows: readonly QtyRow[];
  readonly totalInput: unknown;
  readonly trays: unknown;
  readonly words: LogTextWords;
  readonly nowMs: number;
}

// The first version of a hand-made log: the recipe's default leavening, no extra dough, the divisor's n at 0.
export function buildManualVersion(input: ManualInputs): Omit<LogVersion, 'kind'> {
  const { config, recipeId, recipe, rows, totalInput, trays, words, nowMs } = input;
  const items = rows.map(savedLine);
  const divisor = { includedIds: getDivisorIncluded(config, recipeId), n: 0 };
  const sheet = buildSheet({
    recipe, items, extraGrams: 0, totalInput: num(totalInput), trays: num(normalizeTrays(trays)),
    leaveningPct: recipe.leaveningDefaultPct, divisor,
  });
  return {
    calculatedBy: '',
    at: logTimestamp(new Date(nowMs)),
    items,
    occasional: [],
    sheet,
    text: buildLogText(items, [], { grams: 0, value: 0, unit: 'g' }, words),
    recipe: recipeSnapshot(recipe),
  };
}

// ── «Edit log» ──────────────────────────────────────────────────────────────────────────────────────────────

// The recipe id a log belongs to: its stored recipeId, else a recipe matched by the log's dough name (older
// migrated logs), else the first recipe (js/log-edit.js `resolveRecipeId`).
export function resolveLogRecipeId(config: CalculatorConfig, log: Log): string {
  if (log.recipeId && getRecipeById(config, log.recipeId)) return String(log.recipeId);
  const recipes = getRecipes(config);
  const byName = recipes.find(recipe => recipe.name === log.dough);
  if (byName) return byName.id;
  return recipes[0]?.id ?? '';
}

// An occasional client of an older log, carried forward unchanged (the feature to add new ones was removed).
export interface CarriedOccasional {
  readonly name: string;
  readonly products: readonly { name: string; qty: number; weightG: number; unit: 'kg' | 'pz'; productId: string }[];
}

// The editor's working copy of a log.
export interface EditStart {
  readonly recipeId: string;
  // The recipe the log was MADE with (the version's frozen one), else today's; null when neither exists.
  readonly recipe: Recipe | LogVersion['recipe'] | null;
  readonly rows: QtyRow[];
  readonly occasional: CarriedOccasional[];
  readonly calculatedBy: string;
  readonly trays: number;
  readonly typedTotal: number;
  readonly trayWeight: number;
}

// js/log-edit.js `openLogEdit`: what the log SAVED comes first and verbatim; the products added to those clients
// since then follow at zero, so a log can gain a row but never lose or rewrite one.
export function editStart(config: CalculatorConfig, log: Log): EditStart {
  const version = latestVersion(log) || {};
  const recipeId = resolveLogRecipeId(config, log);
  const rows = editRows(version.items, getTabProducts(config, recipeId).map(productRow));
  const recipe = version.recipe || getRecipeById(config, recipeId);
  const occasional = (version.occasional || []).map((client: OccasionalClient) => ({
    name: String(client.name || ''),
    products: (client.products || []).map(product => ({
      name: String(product.name || ''), qty: num(product.qty), weightG: num(product.weightG),
      unit: product.unit === 'kg' ? 'kg' as const : 'pz' as const,
      productId: String((product as { productId?: unknown }).productId || ''),
    })),
  }));
  const { trays, trayWeight, typedTotal } = traysEditState(version.sheet || {}, recipe);
  return {
    recipeId, recipe: recipe ?? null, rows, occasional, calculatedBy: String(version.calculatedBy || ''),
    trays, typedTotal, trayWeight,
  };
}

// Whether the editor shows trays (and, for «trays + total», the grams on top) instead of quantity rows.
export function editsTrays(recipe: EditStart['recipe']): boolean {
  return !!recipe && usesTrays(recipe.logic);
}

export interface EditInputs {
  readonly config: CalculatorConfig;
  // The working copy, as edited.
  readonly working: EditStart;
  // The version being edited (the log's latest).
  readonly previous: LogVersion | null;
  // occasionalClient names an occasional client with no name; both words go into the text.
  readonly words: LogTextWords;
  readonly nowMs: number;
}

// js/log-edit.js `doSave`, the part before the write: the version an edit appends.
export function buildEditedVersion(input: EditInputs): Omit<LogVersion, 'kind'> {
  const { config, working, previous, words, nowMs } = input;
  const items = working.rows.map(savedLine);

  // Occasional clients → cleaned data + extra lines that feed the dough total.
  const occClean: { name: string; products: CarriedOccasional['products'][number][] }[] = [];
  const occLines: LogLine[] = [];
  working.occasional.forEach((client, oi) => {
    const products = client.products.filter(product => product.name.trim() !== '' && num(product.qty) > 0);
    if (!client.name.trim() && !products.length) return; // drop fully empty
    const name = client.name.trim() || words.occasionalClient;
    occClean.push({
      name,
      products: products.map(product => ({
        name: product.name.trim(), qty: num(product.qty), weightG: num(product.weightG),
        unit: product.unit === 'kg' ? 'kg' : 'pz', productId: product.productId || '',
      })),
    });
    products.forEach((product, pi) => occLines.push({
      id: 'occ-' + oi + '-' + pi, name: product.name.trim(), clientName: name,
      qty: num(product.qty), weightG: num(product.weightG), kind: product.unit === 'kg' ? 'kg' : 'number',
      crate: { show: false, perBox: 20 },
    }));
  });

  // Leavening, extra, typed total and divisor come from the version being edited (this screen edits quantities
  // only); the sheet is recomputed with the recipe the log was MADE with, not today's.
  const recipe = working.recipe;
  const prevSheet = previous?.sheet ?? null;
  const leaveningPct = prevSheet && prevSheet.param ? prevSheet.param.value : (recipe ? recipe.leaveningDefaultPct : 0);
  const extraG = prevSheet ? num(prevSheet.extra_g) : 0;
  const totalInput = recipe && recipe.logic === 'traysTotal' ? working.typedTotal : typedTotalOf(recipe, previous);
  const trays = recipe && usesTrays(recipe.logic) ? working.trays : 0;
  const divisor = {
    includedIds: getDivisorIncluded(config, working.recipeId),
    n: prevSheet && prevSheet.divisor ? prevSheet.divisor.n : 0,
  };

  const sheet = buildSheet({
    recipe: traysSheetRecipe(recipe, working.trayWeight), items: items.concat(occLines), extraGrams: extraG,
    totalInput, trays, leaveningPct, divisor,
  });
  return {
    calculatedBy: working.calculatedBy.trim(),
    at: logTimestamp(new Date(nowMs)),
    items,
    occasional: occClean,
    sheet,
    text: buildLogText(items, occClean, { grams: extraG, value: extraG, unit: 'g' }, words),
    recipe: recipeSnapshot(recipe),
  };
}
