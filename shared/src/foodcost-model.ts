// foodcost-model.ts — what a finished product costs to make, and what share of its price that is. PURE: no
// DOM, no Firestore, so every rule below is asserted under Node (P15).
//
// TypeScript PARTIAL port of js/foodcost/foodcost-model.js for Mise 2. Behaviour is identical, input for
// input, junk included (every function accepts `unknown`, as the original accepts anything, because a
// document is data): foodcost-model.spec.ts runs every test against BOTH files and compares each ported
// export with the js/ file itself; odd-inputs.spec.ts feeds both the same strange values. It is NOT paired
// in parity.spec.ts: the original also exports `blockerText`, which looks a word up in the interface
// dictionary (`t()`), and in Mise 2 the dictionary belongs to the app. `BLOCKER_TEXT` (the dictionary KEYS,
// frozen) is ported, and the app resolves a blocker through its own typed i18n.
//
// THE CHAIN, end to end:
//   Orders    knows what an ingredient costs per kilo
//   Catalogue turns that into what a RECIPE costs per kilo
//   here      turns that into what a PRODUCT costs, and what it earns
//
// A product is a BATCH: some kilos of one or more recipes, and ingredients added straight to it (Federico,
// 13 Sep 2026: a cream cornetto is «la ricetta cornetto, la ricetta crema e l'ingrediente zucchero a
// velo»). It is sold BY THE PIECE (the batch is divided by how many come out of it), BY WEIGHT (the cost
// per kilo is the answer directly) or BY THE PACK (a pack holds so many grams, or so many pieces).
//
// ⚠️ PACKAGING IS COUNTED PER UNIT SOLD, NOT PER BATCH — one bag per piece, one tray and one label per
// pack, so much film per kilo. Federico, 13 Sep 2026: «per pezzo o confezione ma togli infornata non ha
// senso». Counted in production that day before the change: 3 products, none with a packaging line, so no
// stored number changed meaning.
//
// ⚠️ THE SELLING PRICE IS TYPED GROSS — with VAT, the number on the label, the one a person can check
// against the till. The food cost is worked out on the NET price, because the VAT is never the business's
// money. Getting this backwards makes every margin look better than it is, by exactly the VAT rate.

import { ingredientDisplayName } from './ingredient-name';
import { pricePerKg as ingredientPricePerKg, roundTo, positiveNumber } from './price-model';
import { costRecipe } from './recipe-cost-model';
// The VAT menu moved to vat-rates.ts (as js/vat-rates.js in the current app) because the ingredient price
// form's purchase-VAT field needs the same national menu. Re-exported from here UNCHANGED, as the original
// does, so every import of VAT_RATES_BY_COUNTRY/vatRatesFor from this file keeps working.
import { VAT_RATES_BY_COUNTRY, vatRatesFor } from './vat-rates';

export { VAT_RATES_BY_COUNTRY, vatRatesFor };

// Anything at all may arrive (a document is data), so what is read off a document is `unknown` and read
// the way the original reads it.
type Loose = Readonly<Record<string, unknown>>;

// ── The vocabulary ───────────────────────────────────────────────────────────

// How the product is sold. There is no default: a product with none cannot be costed, and it says so,
// rather than being silently treated as one of them.
export const SELLING_MODES = Object.freeze(['piece', 'weight', 'pack'] as const);
export type SellingMode = (typeof SELLING_MODES)[number];

// What one pack holds: a weight, or a number of pieces.
export const PACK_UNITS = Object.freeze(['g', 'kg', 'pcs'] as const);
export type PackUnit = (typeof PACK_UNITS)[number];

// The amount of an ingredient added straight to a product.
export const LINE_UNITS = Object.freeze(['g', 'kg', 'pcs'] as const);
export type LineUnit = (typeof LINE_UNITS)[number];

// ⚠️⚠️ THE SHAPE OF A PRODUCT, WRITTEN ON IT, AND firestore.rules READS IT. A product is saved WHOLE, so a
// phone still on the version before ingredient lines and packs would save it back without them — deleting
// them in silence. The rules refuse a save that does not carry this over a product that does. Raise it
// only with a rules change.
export const PRODUCT_MODEL = 2;

// The traffic light. Green up to the target, amber up to a tenth above it, red beyond. RELATIVE rather
// than a fixed number of points, so a 12% target and a 35% target both get a proportionate warning band
// instead of one being far stricter than the other by accident.
export const AMBER_MULTIPLIER = 1.1;

// Why a product cannot be costed. Each names one thing to go and fill in; the order is the order a person
// would fill them in.
// ⚠️ KEYS, resolved at draw time. Built once at module load, a t() here would be frozen in the language the
// app started in.
export const BLOCKER_TEXT = Object.freeze({
  'no-components': 'fc.addAtLeastOne',
  'no-selling-mode': 'fc.chooseWhetherThisIs',
  'no-pieces': 'fc.sayHowManyPieces',
  'no-pack-size': 'fc.sayWhatAPackHolds',
  'no-vat': 'fc.chooseTheVatRate',
  'no-price': 'fc.enterTheSellingPrice',
  'no-recipe-cost': 'fc.theRecipesInThis',
  'no-weight': 'fc.theRecipesInThis2',
});

export type Blocker = keyof typeof BLOCKER_TEXT;

// ── The shapes ───────────────────────────────────────────────────────────────

// A RECIPE line, in kilos per batch — the shape every product has had since the start, kept exactly so it
// is written back unchanged. (`kind?: undefined` only lets the two lines be told apart by `kind`.)
export interface RecipeLine {
  kind?: undefined;
  recipeId: string;
  qtyKg: number;
}

// An INGREDIENT added straight to the product, in grams, kilos or pieces per batch.
export interface IngredientLine {
  kind: 'ingredient';
  ingredientId: string;
  qty: number;
  unit: LineUnit;
}

export type ProductComponent = RecipeLine | IngredientLine;

// One packaging item, in pieces PER UNIT SOLD.
export interface PackagingLine {
  ingredientId: string;
  qtyPcs: number;
}

// A product as the rest of the feature may assume it: what normalizeProduct returns. Missing values stay
// missing — null, not 0.
export interface Product {
  id: string;
  name: string;
  components: ProductComponent[];
  packaging: PackagingLine[];
  sellingMode: SellingMode | null;
  piecesPerBatch: number | null;
  packSize: number | null;
  packUnit: PackUnit | null;
  sellingPrice: number | null;
  vatRate: number | null;
  foodCostTarget: number | null;
  labourMinutes: number | null;
  labourPeople: number | null;
  model: number | null;
}

// The two tables a cost is read from, by id (a Map or a plain object each — callers hand over whatever they
// already have), and the hourly labour cost: ABSENT for anybody who may not see it, and then every labour
// figure is null.
export type Table = ReadonlyMap<string, unknown> | Readonly<Record<string, unknown>>;

export interface CostTables {
  recipes?: Table | null;
  ingredients?: Table | null;
  labourCostPerHour?: number | null;
}

export type IngredientLineReason = 'no-ingredient-price' | 'no-piece-price' | 'no-piece-weight';

export interface IngredientLineCost {
  cost: number | null;
  kg: number;
  reason: IngredientLineReason | null;
}

// One line of a batch, explained, so the screen can say WHICH line has no price. (`name` of a recipe row is
// whatever the recipe carries; real recipes carry a string.)
export type BatchRow =
  | {
    kind: 'ingredient'; id: string; name: string; qty: number; unit: LineUnit; cost: number | null;
    reason: 'missing-ingredient' | IngredientLineReason | null;
  }
  | {
    kind: 'recipe'; id: string; name: string; qty: number; cost: number | null;
    reason: 'missing-recipe' | 'no-recipe-cost' | null;
  };

export interface BatchTotals {
  cost: number;
  kg: number;
  partial: boolean;
  rows: BatchRow[];
}

export interface PackagingRow {
  kind: 'packaging';
  id: string;
  name: string;
  qty: number;
  cost: number | null;
  reason: 'missing-ingredient' | 'no-piece-price' | null;
}

export interface PackagingTotals {
  cost: number;
  partial: boolean;
  rows: PackagingRow[];
}

export type SaleUnit = 'piece' | 'kg' | 'pack';

export interface ProductionCost {
  batchCost: number | null;
  unitCost: number | null;
  unit: SaleUnit | null;
  labourBatchCost: number | null;
  labourUnitCost: number | null;
  totalUnitCost: number | null;
  partial: boolean;
  batch: BatchTotals;
  packaging: PackagingTotals;
}

export type FoodCostStatus = 'green' | 'amber' | 'red';

export interface CostResult {
  unitCost: number | null;
  netUnitPrice: number | null;
  foodCostPct: number | null;
  margin: number | null;
  status: FoodCostStatus | null;
  partial: boolean;
  blockers: Blocker[];
  batch: BatchTotals;
  packaging: PackagingTotals;
  labourUnitCost: number | null;
  totalUnitCost: number | null;
  labourPct: number | null;
  totalCostPct: number | null;
}

// A NEW product for a recipe no product uses yet (see draftFromRecipe).
export interface ProductDraft {
  id: null;
  name: string;
  components: RecipeLine[];
  packaging: PackagingLine[];
  sellingMode: null;
  piecesPerBatch: null;
  packSize: null;
  packUnit: null;
  sellingPrice: null;
  vatRate: null;
  foodCostTarget: null;
}

// One entry in the append-only history.
export interface ProductSnapshot {
  recordedAt: string;
  unitCost: number | null;
  foodCostPct: number | null;
  sellingPrice: number | null;
  vatRate: number | null;
  sellingMode: SellingMode | null;
  frozenPrices: Record<string, number>;
}

// ── The VAT menu ─────────────────────────────────────────────────────────────

// Which entry of the VAT menu a stored rate selects, and what the free field shows:
//
//   { select: '' | 'other' | '<rate>', other: '' | '<rate>' }
//
// ⚠️ A RATE THE COUNTRY'S LIST DOES NOT OFFER GOES IN THE FREE FIELD, UNCHANGED — a product saved at 20% on
// an Italian venue opens on «another rate» with 20 in it, and keeps costing at 20 until somebody picks
// otherwise. Selecting a menu value that does not exist would instead leave the menu looking blank over a
// rate still in force.
export function vatSelection(rate: unknown, country: unknown): { select: string; other: string } {
  const value = zeroOrMore(rate);
  if (value === null) return { select: '', other: '' };
  return vatRatesFor(country).some(choice => choice.rate === value)
    ? { select: String(value), other: '' }
    : { select: 'other', other: String(value) };
}

// A number that may legitimately be zero — a VAT rate, and nothing else here. Kept separate from
// positiveNumber so the difference is deliberate and visible: everywhere else zero means "not filled in",
// and here it does not.
export function zeroOrMore(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isSellingMode(mode: unknown): mode is SellingMode {
  return (SELLING_MODES as readonly unknown[]).includes(mode);
}

// ── Normalisation (junk-safe: never throws, never yields NaN) ─────────────────

// A line of what the product is made of: a RECIPE, in kilos per batch, or an INGREDIENT added straight to
// it, in grams, kilos or pieces per batch.
function normalizeComponent(raw: unknown): ProductComponent | null {
  if (!raw || typeof raw !== 'object') return null;
  const line = raw as Loose;
  if (line.kind === 'ingredient') {
    const ingredientId = line.ingredientId != null ? String(line.ingredientId).trim() : '';
    if (!ingredientId) return null;
    const qty = Number(line.qty);
    return {
      kind: 'ingredient',
      ingredientId,
      qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
      unit: (LINE_UNITS as readonly unknown[]).includes(line.unit) ? line.unit as LineUnit : 'g',
    };
  }
  const recipeId = line.recipeId != null ? String(line.recipeId).trim() : '';
  if (!recipeId) return null;
  const qtyKg = Number(line.qtyKg);
  return { recipeId, qtyKg: Number.isFinite(qtyKg) && qtyKg >= 0 ? qtyKg : 0 };
}

// One packaging item, in pieces PER UNIT SOLD.
function normalizePackaging(raw: unknown): PackagingLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as Loose;
  const ingredientId = item.ingredientId != null ? String(item.ingredientId).trim() : '';
  if (!ingredientId) return null;
  const qtyPcs = Number(item.qtyPcs);
  return { ingredientId, qtyPcs: Number.isFinite(qtyPcs) && qtyPcs >= 0 ? qtyPcs : 0 };
}

// A product from arbitrary (Firestore) input. Missing values stay missing — null, not 0 — because "no VAT
// rate chosen" and "zero-rated" are different answers and only one of them can be costed.
//
// ⚠️ EVERY FIELD A PRODUCT CARRIES MUST BE NAMED HERE. The store normalises before it caches and the
// editor copies from the result, so a field left out is dropped by THIS version of the app on its own next
// save — not only by an old phone.
export function normalizeProduct(raw: unknown): Product | null {
  if (!raw || typeof raw !== 'object') return null;
  const doc = raw as Loose;
  return {
    id: doc.id != null ? String(doc.id) : '',
    name: String(doc.name != null ? doc.name : '').trim(),
    components: (Array.isArray(doc.components) ? doc.components as unknown[] : []).map(normalizeComponent).filter((c): c is ProductComponent => !!c),
    packaging: (Array.isArray(doc.packaging) ? doc.packaging as unknown[] : []).map(normalizePackaging).filter((p): p is PackagingLine => !!p),
    sellingMode: isSellingMode(doc.sellingMode) ? doc.sellingMode : null,
    piecesPerBatch: positiveNumber(doc.piecesPerBatch),
    packSize: positiveNumber(doc.packSize),
    packUnit: (PACK_UNITS as readonly unknown[]).includes(doc.packUnit) ? doc.packUnit as PackUnit : null,
    sellingPrice: positiveNumber(doc.sellingPrice),
    vatRate: zeroOrMore(doc.vatRate),
    foodCostTarget: positiveNumber(doc.foodCostTarget),
    // How long one batch takes to make, and by how many people (13 Sep 2026). Missing stays missing: no
    // time said is not «no time taken».
    labourMinutes: positiveNumber(doc.labourMinutes),
    labourPeople: positiveNumber(doc.labourPeople),
    model: Number.isInteger(doc.model) && (doc.model as number) > 0 ? doc.model as number : null,
  };
}

export function normalizeProducts(list: unknown): Product[] {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProduct).filter((p): p is Product => !!p);
}

// ── The maths ────────────────────────────────────────────────────────────────

// The price without VAT. A rate of 0 returns the price unchanged, which is correct and is the common case
// for takeaway bakery in the UK.
export function netPrice(gross: unknown, vatRate: unknown): number | null {
  const price = positiveNumber(gross);
  const rate = zeroOrMore(vatRate);
  if (price === null || rate === null) return null;
  return roundTo(price / (1 + rate / 100), 4);
}

// What an ingredient added straight to a product costs, and weighs, for one batch:
//
//   { cost, kg, reason }   — cost null, and a reason, when it cannot be costed
//
// ⚠️ AN UNPRICED LINE ADDS NO WEIGHT EITHER, the same rule as an unpriced recipe: a product would otherwise
// look heavier and cheaper per kilo than it is.
// ⚠️ A LINE IN PIECES NEEDS A PRICE PER PIECE — or, bought by the kilo, what one piece weighs. «3 pieces»
// of something bought by weight means nothing without it.
// ⚠️ A PIECE WITH NO KNOWN WEIGHT ADDS ITS COST AND NO WEIGHT: a decoration bought by the piece is costed
// exactly, and only a product sold by the kilo is a touch lighter for it.
export function ingredientLineCost(line: unknown, ingredient: unknown): IngredientLineCost {
  const ing = (ingredient || {}) as Loose;
  const row = line as Loose | null | undefined;
  const qty = Number(row && row.qty) || 0;
  const pieceKg = positiveNumber(ing.unitWeightKg);

  if (row && row.unit === 'pcs') {
    const each = ing.priceUnit === 'pcs' ? positiveNumber(ing.pricePerUnit) : null;
    if (each !== null) {
      return { cost: roundTo(qty * each, 4), kg: pieceKg === null ? 0 : roundTo(qty * pieceKg, 6), reason: null };
    }
    const rate = ingredientPricePerKg(ing);
    if (rate !== null && pieceKg !== null) {
      return { cost: roundTo(qty * pieceKg * rate, 4), kg: roundTo(qty * pieceKg, 6), reason: null };
    }
    return { cost: null, kg: 0, reason: positiveNumber(ing.pricePerUnit) === null ? 'no-ingredient-price' : 'no-piece-price' };
  }

  const kg = row && row.unit === 'kg' ? qty : qty / 1000;
  const rate = ingredientPricePerKg(ing);
  if (rate === null) {
    const pricedByPiece = ing.priceUnit === 'pcs' && positiveNumber(ing.pricePerUnit) !== null;
    return { cost: null, kg: 0, reason: pricedByPiece ? 'no-piece-weight' : 'no-ingredient-price' };
  }
  return { cost: roundTo(kg * rate, 4), kg: roundTo(kg, 6), reason: null };
}

// What one batch costs, and what it weighs — its RECIPES and INGREDIENTS. Packaging is not in it: it is
// counted per unit sold (packagingPerUnit below).
//
// Returns { cost, kg, partial, rows } — `rows` explains each line, so the screen can say WHICH line has no
// price rather than only that something has none.
export function batchTotals(product: unknown, tables: CostTables = {}): BatchTotals {
  const p = normalizeProduct(product) || { components: [], packaging: [] };
  const recipesById = tables.recipes || {};
  let cost = 0;
  let kg = 0;
  let partial = false;
  const rows: BatchRow[] = [];

  p.components.forEach(component => {
    if (component.kind === 'ingredient') {
      const ingredient = lookup(tables.ingredients, component.ingredientId);
      if (!ingredient) {
        partial = true;
        rows.push({ kind: 'ingredient', id: component.ingredientId, name: '', qty: component.qty, unit: component.unit, cost: null, reason: 'missing-ingredient' });
        return;
      }
      const line = ingredientLineCost(component, ingredient);
      if (line.cost === null) {
        partial = true;
        rows.push({ kind: 'ingredient', id: component.ingredientId, name: ingredientDisplayName(ingredient), qty: component.qty, unit: component.unit, cost: null, reason: line.reason });
        return;
      }
      cost += line.cost;
      kg += line.kg;
      rows.push({ kind: 'ingredient', id: component.ingredientId, name: ingredientDisplayName(ingredient), qty: component.qty, unit: component.unit, cost: line.cost, reason: null });
      return;
    }

    const recipe = lookup(recipesById, component.recipeId) as { name: string } | null;
    if (!recipe) {
      partial = true;
      rows.push({ kind: 'recipe', id: component.recipeId, name: '', qty: component.qtyKg, cost: null, reason: 'missing-recipe' });
      return;
    }
    const costed = costRecipe(recipe, tables);
    if (costed.pricePerKg === null) {
      partial = true;
      rows.push({ kind: 'recipe', id: component.recipeId, name: recipe.name, qty: component.qtyKg, cost: null, reason: 'no-recipe-cost' });
      return;
    }
    // A recipe that is only PARTLY priced makes the product partly priced too — the same rule, and the
    // same reason, as one recipe inside another.
    if (costed.partial) partial = true;
    const lineCost = roundTo(component.qtyKg * costed.pricePerKg, 4);
    cost += lineCost;
    kg += component.qtyKg;
    rows.push({ kind: 'recipe', id: component.recipeId, name: recipe.name, qty: component.qtyKg, cost: lineCost, reason: null });
  });

  return { cost: roundTo(cost, 4), kg: roundTo(kg, 4), partial, rows };
}

// What the packaging of ONE UNIT SOLD costs — one piece, one pack or one kilo.
//
//   { cost, partial, rows }
//
// ⚠️ PACKAGING ADDS COST BUT NOT WEIGHT. A box is not part of what is sold by the kilo.
// ⚠️ ONLY WHAT IS BOUGHT BY THE PIECE, because «3 boxes» of something priced per kilo means nothing — left
// out and named, never guessed at.
export function packagingPerUnit(product: unknown, tables: CostTables = {}): PackagingTotals {
  const p = normalizeProduct(product) || { packaging: [] };
  let cost = 0;
  let partial = false;
  const rows: PackagingRow[] = [];

  p.packaging.forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId) as Loose | null;
    if (!ingredient) {
      partial = true;
      rows.push({ kind: 'packaging', id: item.ingredientId, name: '', qty: item.qtyPcs, cost: null, reason: 'missing-ingredient' });
      return;
    }
    const each = ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each === null) {
      partial = true;
      rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredientDisplayName(ingredient), qty: item.qtyPcs, cost: null, reason: 'no-piece-price' });
      return;
    }
    const lineCost = roundTo(item.qtyPcs * each, 4);
    cost += lineCost;
    rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredientDisplayName(ingredient), qty: item.qtyPcs, cost: lineCost, reason: null });
  });

  return { cost: roundTo(cost, 4), partial, rows };
}

// Accept a Map or a plain object for the two lookup tables.
function lookup(table: unknown, id: unknown): unknown {
  if (!table || !id) return null;
  const t = table as { get?: unknown } & Record<PropertyKey, unknown>;
  if (typeof t.get === 'function') return (t.get as (id: unknown) => unknown).call(table, id) || null;
  return Object.prototype.hasOwnProperty.call(table, id as PropertyKey) ? t[id as PropertyKey] : null;
}

// Sold by weight, or by a pack that holds a weight — the two that divide by kilos.
function byWeight(p: Product): boolean {
  return p.sellingMode === 'weight'
    || (p.sellingMode === 'pack' && p.packSize !== null && (p.packUnit === 'g' || p.packUnit === 'kg'));
}

// How many units of sale one batch makes — pieces, kilos or packs — or null while it cannot be known: no way
// of selling chosen, no pieces said, no pack size, no weight.
//
// QUIRK COPIED: a product that already carries a truthy `components` is used AS IT IS, normalised or not
// (the original's own shortcut for a product it normalised itself), so a raw document with text where a
// number belongs gives back that text. Callers pass normalised products; no real input reaches it.
export function unitsPerBatch(product: unknown, batch: unknown): number | null {
  const raw = product as Loose | null | undefined;
  const p = (raw && raw.components ? raw : normalizeProduct(product)) as Product | null;
  if (!p) return null;
  const b = batch as { kg?: number } | null | undefined;
  const kg = b && (b.kg as number) > 0 ? b.kg as number : null;
  if (p.sellingMode === 'piece') return p.piecesPerBatch;
  if (p.sellingMode === 'weight') return kg;
  if (p.sellingMode === 'pack') {
    if (p.packSize === null || !p.packUnit) return null;
    if (p.packUnit === 'pcs') return p.piecesPerBatch === null ? null : p.piecesPerBatch / p.packSize;
    const packKg = p.packUnit === 'g' ? p.packSize / 1000 : p.packSize;
    return kg === null ? null : kg / packKg;
  }
  return null;
}

// One unit's share of an amount spent on the whole batch — or null when the batch cannot be divided yet.
// ⚠️ THE ONE PLACE THIS DIVISION IS DONE: the materials use it, and so will anything else a batch costs
// (the labour), so no two figures on the screen can be divided by two different numbers.
function perUnitOf(p: Product, batch: BatchTotals, amount: number): number | null {
  const units = unitsPerBatch(p, batch);
  return units !== null && units > 0 ? amount / units : null;
}

// What one unit sold costs to make: its share of the batch, plus its own packaging.
function unitCostOf(p: Product | null, batch: BatchTotals, packaging: PackagingTotals): number | null {
  if (!p || !(batch.cost > 0)) return null;
  const share = perUnitOf(p, batch, batch.cost);
  if (share === null) return null;
  return roundTo(share + (packaging ? packaging.cost : 0), 4);
}

// What the WORK on one batch costs: minutes × people × what an hour costs the venue — or null while any of
// the three is missing. People left empty count as one.
//
// Federico, 13 Sep 2026: time on the PRODUCT, one hourly cost for the venue, and — asked who may see it —
// only whoever runs the place. So `tables.labourCostPerHour` is simply absent for anybody else, and every
// labour figure below is null for them.
// ⚠️ LABOUR NEVER ENTERS THE FOOD COST %. Food cost is what the ingredients and packaging take of the
// price, the number every kitchen compares; labour is shown beside it.
export function labourBatchCost(product: unknown, tables: CostTables = {}): number | null {
  const raw = product as Loose | null | undefined;
  const p = (raw && Array.isArray(raw.components) && 'labourMinutes' in raw ? raw : normalizeProduct(product)) as Product | null;
  if (!p) return null;
  const rate = positiveNumber(tables && tables.labourCostPerHour);
  if (rate === null || p.labourMinutes === null) return null;
  const people = p.labourPeople === null ? 1 : p.labourPeople;
  return roundTo(p.labourMinutes / 60 * people * rate, 4);
}

// One unit's share of the labour — the same division as its share of the materials.
function labourPerUnit(p: Product, batch: BatchTotals, tables: CostTables): number | null {
  const labour = labourBatchCost(p, tables);
  if (labour === null) return null;
  const share = perUnitOf(p, batch, labour);
  return share === null ? null : roundTo(share, 4);
}

function saleUnitOf(p: Product): SaleUnit {
  return p.sellingMode === 'weight' ? 'kg' : p.sellingMode === 'pack' ? 'pack' : 'piece';
}

// What making this product costs, BEFORE anybody has said what it sells for.
//
//   { batchCost, unitCost, unit, labourBatchCost, labourUnitCost, totalUnitCost, partial, batch, packaging }
//
// Federico, 13 Sep 2026: the cost of a product belongs in Food cost, and it has to be readable as soon as
// the recipe and its kilos are in — not only once a selling price and a VAT rate have been typed, which is
// when costProduct() below starts answering.
//
// `batchCost` is null when no line has a cost at all (never 0: a product that reads as costing nothing is
// the one wrong answer this screen must not give). It is the batch's recipes and ingredients, plus the
// packaging of every unit it makes once that number is known. `unit` is 'piece', 'kg' or 'pack' exactly
// when `unitCost` is a number.
export function productionCost(product: unknown, tables: CostTables = {}): ProductionCost {
  const p = normalizeProduct(product);
  const batch = batchTotals(p, tables);
  const packaging = packagingPerUnit(p, tables);
  const units = p ? unitsPerBatch(p, batch) : null;
  const unitCost = unitCostOf(p, batch, packaging);
  const labourUnitCost = p ? labourPerUnit(p, batch, tables) : null;
  const unitsKnown = units !== null && units > 0;
  return {
    batchCost: batch.cost > 0 ? roundTo(batch.cost + (unitsKnown ? packaging.cost * units : 0), 4) : null,
    unitCost,
    // `p` is there whenever there is a unit cost.
    unit: unitCost === null ? null : saleUnitOf(p as Product),
    // The work, beside the materials — never inside unitCost (see labourBatchCost).
    labourBatchCost: p ? labourBatchCost(p, tables) : null,
    labourUnitCost,
    totalUnitCost: unitCost !== null && labourUnitCost !== null ? roundTo(unitCost + labourUnitCost, 4) : null,
    // ⚠️ Packaging that cannot yet be multiplied out — no way of selling said — is missing from the batch
    // figure, so the batch figure is too LOW, and says so.
    partial: batch.partial || packaging.partial || (packaging.rows.length > 0 && !unitsKnown),
    batch,
    packaging,
  };
}

// ── Opened from a recipe ─────────────────────────────────────────────────────
//
// Federico, 13 Sep 2026: a recipe's «Apri nel Food cost» opens its product — the one that uses it, the
// list of them when there are several, a new one when there is none.

// The products with this recipe on one of their lines, as they were given (so the screen opens the very
// object the store holds, not a copy of it).
export function productsUsingRecipe<T>(products: readonly T[] | null | undefined, recipeId: unknown): T[] {
  const id = recipeId == null ? '' : String(recipeId).trim();
  if (!id || !Array.isArray(products)) return [];
  return (products as T[]).filter(raw => {
    const p = normalizeProduct(raw);
    return !!p && p.components.some(c => c.kind !== 'ingredient' && c.recipeId === id);
  });
}

// A NEW product for a recipe no product uses yet: the recipe's name and the recipe on its first line — and
// nothing a person has not said. ⚠️ No kilos, no way of selling, no price, no VAT: a real-looking value
// nobody typed is one somebody saves and trusts.
export function draftFromRecipe(recipe: unknown): ProductDraft | null {
  if (!recipe || typeof recipe !== 'object') return null;
  const card = recipe as Loose;
  const recipeId = card.id == null ? '' : String(card.id).trim();
  if (!recipeId) return null;
  return {
    id: null,
    name: String(card.name ?? '').trim(),
    components: [{ recipeId, qtyKg: 0 }],
    packaging: [],
    sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null, sellingPrice: null,
    vatRate: null, foodCostTarget: null,
  };
}

// The labour half of the answer, beside the food cost — null throughout while the time or the rate is
// missing. `labourPct` and `totalCostPct` are shares of the NET price, like the food cost itself, so the
// three numbers can be read side by side.
function labourAnswer(p: Product, batch: BatchTotals, tables: CostTables, unitCost: number | null, netUnitPrice: number | null):
Pick<CostResult, 'labourUnitCost' | 'totalUnitCost' | 'labourPct' | 'totalCostPct'> {
  const labourUnitCost = labourPerUnit(p, batch, tables);
  if (labourUnitCost === null || unitCost === null || netUnitPrice === null || !(netUnitPrice > 0)) {
    return { labourUnitCost, totalUnitCost: null, labourPct: null, totalCostPct: null };
  }
  const totalUnitCost = roundTo(unitCost + labourUnitCost, 4);
  return {
    labourUnitCost,
    totalUnitCost,
    labourPct: roundTo(labourUnitCost / netUnitPrice * 100, 2),
    totalCostPct: roundTo(totalUnitCost / netUnitPrice * 100, 2),
  };
}

// The whole answer for one product.
//
//   { unitCost, netUnitPrice, foodCostPct, margin, status, partial, blockers, batch, packaging, + labour }
//
// foodCostPct is null whenever anything needed is missing, and `blockers` says what. It is never guessed
// and never shown as 0 — a food cost of nothing would be read as a product that costs nothing to make.
export function costProduct(product: unknown, tables: CostTables = {}): CostResult {
  const p = normalizeProduct(product);
  const batch = batchTotals(p, tables);
  const packaging = packagingPerUnit(p, tables);
  const blockers: Blocker[] = [];

  if (!p || !p.components.length) blockers.push('no-components');
  if (p && !p.sellingMode) blockers.push('no-selling-mode');
  if (p && p.sellingMode === 'piece' && p.piecesPerBatch === null) blockers.push('no-pieces');
  if (p && p.sellingMode === 'pack') {
    if (p.packSize === null || !p.packUnit) blockers.push('no-pack-size');
    else if (p.packUnit === 'pcs' && p.piecesPerBatch === null) blockers.push('no-pieces');
  }
  if (p && p.vatRate === null) blockers.push('no-vat');
  if (p && p.sellingPrice === null) blockers.push('no-price');

  // A batch of nothing cannot be divided. Reported as its own reason rather than folded into "no
  // components": the components may be there and simply unpriced.
  if (p && p.components.length && batch.cost <= 0) blockers.push('no-recipe-cost');
  if (p && byWeight(p) && batch.kg <= 0) blockers.push('no-weight');

  const base: CostResult = {
    unitCost: null, netUnitPrice: null, foodCostPct: null, margin: null,
    status: null, partial: batch.partial || packaging.partial, blockers, batch, packaging,
    labourUnitCost: null, totalUnitCost: null, labourPct: null, totalCostPct: null,
  };
  // No blocker means there is a product.
  if (blockers.length || !p) return base;

  // The blockers above guarantee a number here — and it is the same division the production cost on its
  // own uses.
  const unitCost = unitCostOf(p, batch, packaging);
  if (unitCost === null) return { ...base, blockers: ['no-recipe-cost'] };

  const netUnitPrice = netPrice(p.sellingPrice, p.vatRate);
  if (netUnitPrice === null || netUnitPrice <= 0) {
    return { ...base, blockers: [...blockers, 'no-price'] };
  }

  const foodCostPct = roundTo(unitCost / netUnitPrice * 100, 2);

  return {
    ...base,
    unitCost,
    netUnitPrice,
    foodCostPct,
    // What one piece (or one kilo, or one pack) actually leaves behind. The percentage is the comparable
    // number; this is the one that pays the rent.
    margin: roundTo(netUnitPrice - unitCost, 4),
    status: statusFor(foodCostPct, p.foodCostTarget),
    ...labourAnswer(p, batch, tables, unitCost, netUnitPrice),
  };
}

// The selling price, WITH VAT, at which this product's food cost would be exactly its target — or null
// when the cost, the VAT rate or the target is missing.
//
// Federico, 13 Sep 2026: besides «I have the price, what is my food cost?», the screen should answer «I
// know what it costs and the food cost I want: what do I sell it at?». Both on one screen (his choice),
// from the same numbers.
//
// ⚠️ ROUNDED UP TO THE CENT, NEVER TO THE NEAREST. Rounding down by half a cent would put the real food
// cost a hair ABOVE the target the price was asked for — a price suggested to hit a target must hit it.
// ⚠️ A VAT RATE OF 0 IS A REAL ANSWER (zeroOrMore), exactly as in netPrice().
export function suggestedGrossPrice({ unitCost, vatRate, targetPct }: { unitCost?: unknown; vatRate?: unknown; targetPct?: unknown } = {}): number | null {
  const cost = positiveNumber(unitCost);
  const rate = zeroOrMore(vatRate);
  const target = positiveNumber(targetPct);
  if (cost === null || rate === null || target === null || target > 100) return null;
  const gross = cost / (target / 100) * (1 + rate / 100);
  // The epsilon keeps a price that is already a whole number of cents from being pushed up by
  // floating-point dust (2.4000000000000004 must stay 2.40).
  return Math.ceil(roundTo(gross * 100, 6) - 1e-9) / 100;
}

// green / amber / red against the product's own target, or null when it has none — a product with no
// target is not failing, it simply has nothing to be measured against, and colouring it would be inventing
// a standard nobody set.
export function statusFor(foodCostPct: unknown, target: unknown): FoodCostStatus | null {
  const pct = Number(foodCostPct);
  const goal = positiveNumber(target);
  if (!Number.isFinite(pct) || goal === null) return null;
  if (pct <= goal) return 'green';
  if (pct <= goal * AMBER_MULTIPLIER) return 'amber';
  return 'red';
}

// The products worst first — the order somebody opening this screen wants, because the reason to open it
// is to find what is losing money.
//
// Products that cannot be costed sort LAST, not first: they are a data-entry job, not a margin problem,
// and putting them at the top would bury the real answer under a list of half-filled cards.
export function sortByMargin<T>(products: readonly T[] | null | undefined, tables: CostTables = {}): { product: T; result: CostResult }[] {
  // A corrupt entry must not take the whole screen down. costProduct already tolerates null; the NAME is
  // read here too, and reading it straight off the object threw inside Array.sort — which is the worst
  // place for it, because the list is drawn from a live Firestore snapshot and one bad document would
  // blank the whole page rather than one row.
  const nameOf = (p: unknown): string => String((p && (p as Loose).name) || '');

  return (products || []).slice()
    .map(product => ({ product, result: costProduct(product, tables) }))
    .sort((a, b) => {
      const av = a.result.foodCostPct;
      const bv = b.result.foodCostPct;
      if (av === null && bv === null) return nameOf(a.product).localeCompare(nameOf(b.product));
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av || nameOf(a.product).localeCompare(nameOf(b.product));
    });
}

// ── Snapshots ────────────────────────────────────────────────────────────────

// Should this change be recorded? The design's rule: a snapshot is taken when the SELLING PRICE or the
// COMPOSITION changes — the two things a person does deliberately — and at no other time.
//
// ⚠️ KNOWN LIMITATION, WRITTEN DOWN ON PURPOSE. Ingredient prices drift upwards without anybody touching
// the product, and that erosion leaves NO point on this series. The history therefore answers "what did we
// decide, and when", not "what did it cost every week". Revisit after two or three months of real use; the
// fix is a periodic snapshot, which was deliberately not built now.
export function snapshotWorthTaking(before: unknown, after: unknown): boolean {
  const a = normalizeProduct(before);
  const b = normalizeProduct(after);
  if (!b) return false;
  if (!a) return true;                                  // the first save is a point
  if (a.sellingPrice !== b.sellingPrice) return true;
  if (a.vatRate !== b.vatRate) return true;             // it changes the net price
  if (a.sellingMode !== b.sellingMode) return true;
  if (a.piecesPerBatch !== b.piecesPerBatch) return true;
  if (a.packSize !== b.packSize || a.packUnit !== b.packUnit) return true;
  return compositionKey(a) !== compositionKey(b);
}

// A stable string for "what this product is made of", so a reordered list of the same components is NOT a
// change. Sorted, because the editor can reorder rows and nobody means anything by it.
function compositionKey(product: Product): string {
  const parts = [
    ...product.components.map(c => (c.kind === 'ingredient'
      ? `i:${c.ingredientId}:${c.qty}:${c.unit}`
      : `r:${c.recipeId}:${c.qtyKg}`)),
    ...product.packaging.map(p => `p:${p.ingredientId}:${p.qtyPcs}`),
  ];
  return parts.sort().join('|');
}

// One entry in the append-only history. It freezes the ingredient prices of the moment as well as the
// answer, so a margin from six months ago can still be explained rather than merely asserted.
//
// ⚠️ THE VAT RATE IS FROZEN TOO. Rates change by law, and without this every past margin would silently be
// recomputed against today's rate — corrupting a series whose whole purpose is to be comparable over time.
export function productSnapshot(product: unknown, result: Pick<CostResult, 'unitCost' | 'foodCostPct'>, nowIso: string, tables: CostTables = {}): ProductSnapshot {
  const p: Partial<Product> = normalizeProduct(product) || {};
  return {
    recordedAt: nowIso,
    unitCost: result.unitCost,
    foodCostPct: result.foodCostPct,
    sellingPrice: p.sellingPrice ?? null,
    vatRate: p.vatRate ?? null,
    sellingMode: p.sellingMode ?? null,
    frozenPrices: frozenPricesFor(p, tables),
  };
}

// What every ingredient this product depends on cost at this moment, flattened to { ingredientId:
// pricePerKg } — or the price of one piece, for what is bought by the piece. Recipes are walked so an
// ingredient two levels down is captured too — otherwise the frozen record could not explain a change that
// came from inside a sub-recipe.
function frozenPricesFor(product: Partial<Product>, tables: CostTables): Record<string, number> {
  const out: Record<string, number> = {};
  const seen = new Set<string>();

  const freezeIngredient = (id: string): void => {
    const ingredient = lookup(tables.ingredients, id) as Loose | null;
    const rate = ingredientPricePerKg(ingredient);
    if (rate !== null) { out[id] = rate; return; }
    const each = ingredient && ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each !== null) out[id] = each;
  };

  const walkRecipe = (recipeId: string, depth: number): void => {
    if (depth > 4 || seen.has(recipeId)) return;
    seen.add(recipeId);
    const recipe = lookup(tables.recipes, recipeId) as { ingredients?: unknown } | null;
    if (!recipe || !Array.isArray(recipe.ingredients)) return;
    (recipe.ingredients as (Loose | null | undefined)[]).forEach(row => {
      const refId = row && row.refId ? String(row.refId) : '';
      if (!refId) return;
      if ((row as Loose).kind === 'recipe') { walkRecipe(refId, depth + 1); return; }
      const rate = ingredientPricePerKg(lookup(tables.ingredients, refId));
      if (rate !== null) out[refId] = rate;
    });
  };

  (product.components || []).forEach(c => {
    if (c.kind === 'ingredient') freezeIngredient(c.ingredientId);
    else walkRecipe(c.recipeId, 1);
  });
  (product.packaging || []).forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId) as Loose | null;
    const each = ingredient && ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each !== null) out[item.ingredientId] = each;
  });

  return out;
}
