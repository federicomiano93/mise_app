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
//
// ⚠️⚠️ AFTER THE SWITCH THIS PORT IS NO LONGER THE ORIGINAL (Federico, 10 Nov 2026: «il calo è del prodotto», which
// reverses his 13 Sep choice that the loss belongs to the recipe; ~/.claude/plans/inherited-twirling-platypus.md §3, §8).
// In Mise 2 the lines of «Made of» are what goes INTO the dough, weighed RAW, and a recipe line is costed at the recipe's
// price per kilo RAW; the PRODUCT owns its loss: `cookedGrams`, the batch weighed out of the oven, and `rawGrams`, a raw
// weight typed apart from the lines' total (a dough made double). The batch weighs what comes out (productCooking). A
// product saved by the current app (`model` below 3) is converted ON READ by fromLegacyProduct, with the same cost to the
// last stored decimal, and is saved in the new shape at the next Save — the database is never rewritten in bulk. Every
// spec that runs this file against js/foodcost/foodcost-model.js says where the two now part («post-switch»).

import { ingredientDisplayName } from './ingredient-name';
import type { PriceTranslate } from './price-model';
import { pricePerKg as ingredientPricePerKg, roundTo, positiveNumber } from './price-model';
import { costRecipe, COST_REASON_TEXT, MAX_RECIPE_DEPTH } from './recipe-cost-model';
import type { RecipeCost } from './recipe-cost-model';
// How search text is compared: the catalogue's own rule, so a name found there is found here.
import { normalizeSearchText, linkOf, normalizeLossPct } from './catalogue-model';
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
// ⚠️ 3 IN MISE 2 ONLY (10 Nov 2026), 2 in the current app: a model-3 product's recipe lines are RAW kilos, which the
// current app would read as finished kilos and cost too HIGH by the loss — so the rules refuse its save over a model-3
// product, and it can never write the raw lines back as finished ones. Products below 3 are converted on read
// (fromLegacyProduct).
export const PRODUCT_MODEL = 3;

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
  // Mise 2 only (post-switch): sold by weight, and the cooked weight typed is heavier than the raw one — the batch's
  // weight is unknown until it is corrected (productCooking), so it takes the place of 'no-weight'.
  'cooked-heavier': 'fc.cooking.blockHeavier',
  // Only the preview asks for these two (productPreview): the food cost itself needs neither.
  'no-target': 'fc.preview.needTarget',
  'no-packaging-price': 'fc.preview.needPackagingPrice',
});

export type Blocker = keyof typeof BLOCKER_TEXT;

// ── The shapes ───────────────────────────────────────────────────────────────

// A RECIPE line, in kilos per batch — the shape every product has had since the start, kept exactly so it
// is written back unchanged. (`kind?: undefined` only lets the two lines be told apart by `kind`.)
// ⚠️ MISE 2 (model 3): `qtyKg` is the RAW dough put into the batch. Below model 3 it was the FINISHED weight, and
// fromLegacyProduct turns it into the raw one.
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
  // «Finished product, no weight loss»: the recipes' oven loss is laid aside for this product's cost.
  // ⚠️ READ ONLY TO CONVERT A PRODUCT BELOW MODEL 3 (its cooked weight = its raw one); Mise 2 never writes it.
  noWeightLoss: boolean;
  // Mise 2 (model 3): the product's own weighing, in grams. `rawGrams` is a raw weight typed APART from the lines'
  // total (a dough made double): null = the lines' total. `cookedGrams` is the batch weighed out of the oven: null = not
  // weighed, which is «no loss». See productCooking.
  rawGrams: number | null;
  cookedGrams: number | null;
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

// What ONE line of «Made of» is priced at and costs (componentLineCost).
export interface ComponentLineCost {
  name: string;
  rate: number | null;
  rateUnit: 'kg' | 'pcs' | null;
  cost: number | null;
  kg: number;
  partial: boolean;
  reason: 'missing-recipe' | 'missing-ingredient' | 'no-recipe-cost' | IngredientLineReason | null;
}

// What ONE packaging item is priced at and costs per unit sold (packagingLineCost).
export interface PackagingLineCost {
  rate: number | null;
  rateUnit: 'kg' | 'pcs' | null;
  cost: number | null;
  reason: 'no-price' | 'no-piece-price' | null;
}

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
    // «Finished product, no weight loss» (Nov 2026). Only a literal true switches it on: missing, null or
    // anything else is «the recipes' own loss applies», the old behaviour.
    noWeightLoss: doc.noWeightLoss === true,
    // The product's own weighing (Mise 2, model 3). Missing stays missing: no raw typed is «the lines' total», no
    // cooked weight is «not weighed», and neither is ever a 0.
    rawGrams: gramsOf(doc.rawGrams),
    cookedGrams: gramsOf(doc.cookedGrams),
    model: Number.isInteger(doc.model) && (doc.model as number) > 0 ? doc.model as number : null,
  };
}

// A weight in grams, as the rules keep it: above 0 and at most ten tonnes (the recipe's own bound,
// catalogue-model MAX_WEIGHT_G) — anything else is «not said».
const MAX_PRODUCT_GRAMS = 10000000;
function gramsOf(value: unknown): number | null {
  const n = positiveNumber(value);
  return n !== null && n <= MAX_PRODUCT_GRAMS ? n : null;
}

// A product's weighing as the rules can keep it, from the lines' raw total and the cooked weight, in grams.
// ⚠️⚠️ A PAIR PAST THE RULES' TEN TONNES KEEPS ITS RATIO (second code review, 11 Nov 2026). Grams typed into the old kilo box
// make batches of TONNES (16 such lines in production on 8 Nov). Dropping a cooked weight past ten tonnes took the loss away:
// the batch was worked out on the raw kilos, a cost per kilo too low by the loss, and for ever after a Save. So the two
// weights are divided by a thousand, as often as it takes, the raw one written apart from the lines' total: the batch is the
// total × cooked ÷ raw (productCooking), so every figure stays the one the current app shows, and once somebody corrects the
// line the two weights are the ones that were meant. Nothing to keep (no cooked weight) is two nulls.
export function fittedWeighing(rawTotalGrams: number, cookedGrams: number): { rawGrams: number | null; cookedGrams: number | null } {
  if (!(cookedGrams > 0) || !Number.isFinite(cookedGrams)) return { rawGrams: null, cookedGrams: null };
  if (cookedGrams <= MAX_PRODUCT_GRAMS) return { rawGrams: null, cookedGrams };
  if (!(rawTotalGrams >= cookedGrams) || !Number.isFinite(rawTotalGrams)) return { rawGrams: null, cookedGrams: null };
  let scale = 1000;
  while (rawTotalGrams / scale > MAX_PRODUCT_GRAMS) scale *= 1000;
  return { rawGrams: rawTotalGrams / scale, cookedGrams: cookedGrams / scale };
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
// ⚠️ AN UNPRICED LINE REPORTS NO WEIGHT HERE, the current app's rule, kept so the pair stays paired: there, a product would
// otherwise have looked heavier and cheaper per kilo than it is. Mise 2's batch does not take its weight from here — it counts
// every line whose weight is known, priced or not (lineRawKg, productCooking), and marks the figure partial when a price is
// missing.
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
//
// ⚠️ MISE 2 (post-switch): `kg` is what the batch weighs ONCE MADE — productCooking's output, 0 while it cannot be
// known — and it counts EVERY line with a known weight, priced or not. The current app counted only the priced lines;
// counting them all keeps the weight of a product whose price is missing in part, so its cost per kilo is not exact yet —
// usually too low (a line with no price adds weight and no cost), but a row with no price INSIDE a recipe adds neither,
// so it can be too high as well (per-kg-model says the same): the card says the figure is partial.
// A product below model 3 is converted first (currentProduct), so its cost is the one it always had.
export function batchTotals(product: unknown, tables: CostTables = {}): BatchTotals {
  const p = currentProduct(product, tables);
  let cost = 0;
  let partial = false;
  const rows: BatchRow[] = [];

  (p ? p.components : []).forEach(component => {
    // ⚠️ THE ONE PLACE A LINE IS COSTED (current app 02839278): the card's own «rate and this amount» under
    // each line (componentLineCost) and this total are the very same call, so they cannot disagree.
    const line = componentLineCost(component, tables);
    const base = component.kind === 'ingredient'
      ? { kind: 'ingredient' as const, id: component.ingredientId, name: line.name, qty: component.qty, unit: component.unit }
      : { kind: 'recipe' as const, id: component.recipeId, name: line.name, qty: component.qtyKg };
    if (line.partial) partial = true;
    if (line.cost === null) {
      rows.push({ ...base, cost: null, reason: line.reason } as BatchRow);
      return;
    }
    cost += line.cost;
    rows.push({ ...base, cost: line.cost, reason: null } as BatchRow);
  });

  const out = p ? cookingOf(p, tables).outputKg : null;
  return { cost: roundTo(cost, 4), kg: out === null ? 0 : roundTo(out, 4), partial, rows };
}

// What ONE line of «Made of» — a recipe or an ingredient added straight to the product — is priced at and
// costs for the amount typed:
//
//   { name, rate, rateUnit, cost, kg, partial, reason }
//
//   rate      the price it is bought or made at: per kilo ('kg') or each ('pcs') — whichever matches how THIS
//             line is costed; null when no usable price is known
//   cost      for the amount on the line, or null when the line cannot be costed
//   partial   true when the line makes the product only partly costed (gone, unpriced, or a recipe that is
//             itself only partly priced)
//   reason    why cost is null: 'missing-recipe' | 'missing-ingredient' | 'no-recipe-cost' | the reasons of
//             ingredientLineCost
//
// ⚠️ UNKNOWN IS null, NEVER 0. A rate may be known while the cost is not (a price per piece on a line counted
// in grams): the screen shows the rate and says what is missing.
// ⚠️ MISE 2 (post-switch): a recipe line is RAW dough, so it is ALWAYS costed at the recipe's price per kilo RAW — the
// recipe's own loss is laid aside, as the current app did only for a product marked «no weight loss» (that third
// argument is gone). Hand it a line of a CURRENT product (currentProduct): a line below model 3 holds finished kilos.
export function componentLineCost(
  component: unknown,
  tables: CostTables = {},
): ComponentLineCost {
  const line = component as Loose | null | undefined;
  if (line && line.kind === 'ingredient') {
    const ingredient = lookup(tables.ingredients, line.ingredientId) as Loose | null;
    if (!ingredient) {
      return { name: '', rate: null, rateUnit: null, cost: null, kg: 0, partial: true, reason: 'missing-ingredient' };
    }
    const name = ingredientDisplayName(ingredient);
    const costed = ingredientLineCost(line, ingredient);
    const each = ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    const perKg = ingredientPricePerKg(ingredient);
    if (costed.cost === null) {
      // The price exists but cannot be used: say which one it is, and nothing more.
      let rate: number | null = null;
      let rateUnit: 'kg' | 'pcs' | null = null;
      if (costed.reason === 'no-piece-weight' && each !== null) { rate = each; rateUnit = 'pcs'; }
      else if (costed.reason === 'no-piece-price' && perKg !== null) { rate = perKg; rateUnit = 'kg'; }
      return { name, rate, rateUnit, cost: null, kg: 0, partial: true, reason: costed.reason };
    }
    // A line in pieces priced each is costed each; every other costed line goes through a price per kilo (a
    // weight line, or pieces of something bought by the kilo).
    const eachLine = line.unit === 'pcs' && each !== null;
    return {
      name, rate: eachLine ? each : perKg, rateUnit: eachLine ? 'pcs' : 'kg',
      cost: costed.cost, kg: costed.kg, partial: false, reason: null,
    };
  }

  const recipe = lookup(tables.recipes, line && line.recipeId) as ({ name: string } & Loose) | null;
  if (!recipe) {
    return { name: '', rate: null, rateUnit: null, cost: null, kg: 0, partial: true, reason: 'missing-recipe' };
  }
  const qtyKg = Number(line && line.qtyKg) || 0;
  // ⚠️ RAW KILOS AT THE PRICE OF A RAW KILO: the loss of the recipe is laid aside for THIS cost only — the recipe keeps
  // its own number (its label reads it), and the PRODUCT's loss decides what the batch weighs (productCooking).
  const costed = rawRecipeCost(recipe, tables);
  if (costed.pricePerKg === null) {
    return { name: recipe.name, rate: null, rateUnit: null, cost: null, kg: 0, partial: true, reason: 'no-recipe-cost' };
  }
  // A recipe that is only PARTLY priced makes the product partly priced too — the same rule, and the same
  // reason, as one recipe inside another.
  return {
    name: recipe.name, rate: costed.pricePerKg, rateUnit: 'kg',
    cost: roundTo(qtyKg * costed.pricePerKg, 4), kg: qtyKg, partial: !!costed.partial, reason: null,
  };
}

// What ONE packaging item is priced at and costs, per unit sold:
//
//   { rate, rateUnit, cost, reason }
//
//   priced each          → rate each ('pcs'), cost = pieces × each
//   priced by weight     → reason 'no-piece-price', with the per-kilo rate known
//   no price at all      → reason 'no-price', rate null
//
// ⚠️ ONLY WHAT IS BOUGHT BY THE PIECE CAN BE COUNTED: «3 boxes» of something priced per kilo means nothing.
// Unknown is null, never 0.
export function packagingLineCost(item: unknown, ingredient: unknown): PackagingLineCost {
  const ing = (ingredient || {}) as Loose;
  const qty = Number(item && (item as Loose).qtyPcs) || 0;
  const each = ing.priceUnit === 'pcs' ? positiveNumber(ing.pricePerUnit) : null;
  if (each !== null) return { rate: each, rateUnit: 'pcs', cost: roundTo(qty * each, 4), reason: null };
  if (positiveNumber(ing.pricePerUnit) === null) return { rate: null, rateUnit: null, cost: null, reason: 'no-price' };
  const perKg = ingredientPricePerKg(ing);
  return { rate: perKg, rateUnit: perKg === null ? null : 'kg', cost: null, reason: 'no-piece-price' };
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
    const line = packagingLineCost(item, ingredient);
    if (line.cost === null) {
      partial = true;
      // One reason for «no price» and «priced by weight»: the rows name what to give it, a price per piece.
      rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredientDisplayName(ingredient), qty: item.qtyPcs, cost: null, reason: 'no-piece-price' });
      return;
    }
    cost += line.cost;
    rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredientDisplayName(ingredient), qty: item.qtyPcs, cost: line.cost, reason: null });
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

// ── The product's own weighing (Mise 2, post-switch, 10 Nov 2026) ────────────
//
// Federico, 10 Nov 2026: «Impasto crudo deve essere il totale di "Composto da". Dal peso cotto l'app deve calcolare il
// costo di 1 kg di impasto cotto», and the loss belongs to the PRODUCT: his Zulle (the Zulle recipe + almonds + icing
// sugar, 790 g raw, 690 g cooked) loses as ONE dough, and the current app saved that as the Zulle recipe's own loss. The
// approved mockup (plan §9) is the reference for every rule below.

// A recipe costed per kilo RAW: its own loss laid aside (its label still reads it).
function rawRecipeCost(recipe: Loose, tables: CostTables): RecipeCost {
  return costRecipe({ ...recipe, lossPct: 0 }, tables);
}

// What ONE line of «Made of» weighs raw, WHATEVER ITS PRICE: a recipe line its kilos, an ingredient its grams or kilos,
// pieces only through a known weight of one piece. null when that weight cannot be known — pieces with no piece weight,
// or of an ingredient that is gone: the mockup's «Manca il peso di un pezzo: non conta nel crudo.»
// ⚠️ THE KILOS ingredientLineCost COUNTS, ROUNDED THE SAME WAY, so a priced line weighs here what it weighs there.
export function lineRawKg(component: unknown, tables: CostTables = {}): number | null {
  if (!component || typeof component !== 'object') return null;
  const line = component as Loose;
  if (line.kind !== 'ingredient') {
    const kg = Number(line.qtyKg);
    return Number.isFinite(kg) && kg > 0 ? kg : 0;
  }
  const qty = Number(line.qty);
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  if (line.unit === 'pcs') {
    const ingredient = lookup(tables.ingredients, line.ingredientId) as Loose | null;
    const pieceKg = ingredient ? positiveNumber(ingredient.unitWeightKg) : null;
    return pieceKg === null ? null : roundTo(qty * pieceKg, 6);
  }
  return roundTo(line.unit === 'kg' ? qty : qty / 1000, 6);
}

// The loss of a product in percent, with TWO REAL DECIMALS, from two weights in the same unit: 790 down to 690 is 12.66.
// (The recipe's weightLoss rounds to a tenth on purpose — the label prints it — and stays as it is.) null when either
// weight is missing or the cooked one is heavier.
export function productLossPct(rawWeight: unknown, cookedWeight: unknown): number | null {
  const raw = positiveNumber(rawWeight);
  const cooked = positiveNumber(cookedWeight);
  if (raw === null || cooked === null || cooked > raw * (1 + 1e-9)) return null;
  return Math.max(0, roundTo((raw - cooked) / raw * 100, 2));
}

export interface ProductCooking {
  // Every line with a known weight, raw (lineRawKg): what «Impasto crudo» is filled with.
  rawTotalKg: number;
  // The raw weight the loss is measured on: the one typed apart from the total (rawGrams), else the total.
  rawKg: number;
  // A raw weight was typed apart from the total: the screen offers «usa il totale».
  rawTyped: boolean;
  // The batch weighed out of the oven, or null — not weighed, which is «no loss».
  cookedKg: number | null;
  // The cooked weight is heavier than the raw one: kept and shown in red, and what the batch weighs is unknown until it is
  // corrected — a typo must never make a kilo look cheaper.
  heavier: boolean;
  // Two decimals; null when not weighed, or heavier.
  lossPct: number | null;
  // What one batch weighs once made: the lines' total × cooked ÷ raw (so a raw weight typed apart from the total — a
  // dough made double — counts through the ratio); the total itself when not weighed; null while the cooked weight is
  // heavier.
  outputKg: number | null;
}

// The two weights of a product, read: the «Cottura» section and every kilo the batch weighs.
export function productCooking(product: unknown, tables: CostTables = {}): ProductCooking {
  return cookingOf(currentProduct(product, tables), tables);
}

// productCooking for a product that is already current.
function cookingOf(p: Product | null, tables: CostTables): ProductCooking {
  // ⚠️ ADDED UP IN THE LINES' ORDER AND NOT ROUNDED: for a product that loses nothing this is the very sum the current app
  // divided by, so every figure stays the same to its last decimal (a screen formats it).
  let rawTotalKg = 0;
  for (const component of p ? p.components : []) {
    const kg = lineRawKg(component, tables);
    if (kg !== null) rawTotalKg += kg;
  }
  const typed = p ? p.rawGrams : null;
  const rawKg = typed !== null ? typed / 1000 : rawTotalKg;
  const cookedKg = p && p.cookedGrams !== null ? p.cookedGrams / 1000 : null;
  // A hair of tolerance: a cooked weight typed equal to a total added up from several lines is not «heavier».
  const heavier = cookedKg !== null && rawKg > 0 && cookedKg > rawKg * (1 + 1e-9);
  const weighed = cookedKg !== null && rawKg > 0 && !heavier;
  let outputKg: number | null = rawTotalKg;
  if (heavier) outputKg = null;
  // Weighed on the lines' own total: what came out IS the cooked weight — no ratio, so nothing to round.
  else if (weighed) outputKg = typed === null ? cookedKg : roundTo(rawTotalKg * (cookedKg as number) / rawKg, 6);
  return {
    rawTotalKg,
    rawKg,
    rawTyped: typed !== null,
    cookedKg,
    heavier,
    lossPct: weighed ? productLossPct(rawKg, cookedKg) : null,
    outputKg,
  };
}

// ── Products saved before the switch (model below 3) ─────────────────────────
//
// ⚠️⚠️ CONVERTED ON READ, NEVER REWRITTEN IN BULK (his choice, plan §5): the cost model reads every product through
// currentProduct, so a product the current app saved is costed and shown in the new shape, and the next Save writes it.
//
//   recipe line   its FINISHED kilos q become RAW: q ÷ (1 − the recipe's loss) — legacyRawKg says how, to the last decimal
//   ingredient    never lost weight in the current app: it stays as it was
//   cooked        the sum of every line's OLD kilos (what the old card took the batch to weigh), kept only below the raw
//                 total — a product that lost nothing is simply «not weighed»; past the rules' ten tonnes, the same ratio a
//                 thousand times lighter, the raw weight written apart (fittedWeighing)
//   noWeightLoss  the recipes' loss was laid aside: every line stays as it was, so there is nothing to weigh
//
// ⚠️ THE COST IS THE ONE THE CURRENT APP SHOWED, BY CONSTRUCTION: each recipe line costs its raw kilos at the raw price
// instead of its finished kilos at the finished price — the same money — and the batch weighs its old kilos again (raw total
// × cooked ÷ raw total). The one figure that moves is the weight of a PARTIAL product: the current app left an unpriced
// line's kilos out of it, Mise 2 counts every line with a known weight (batchTotals says why). A recipe that is gone keeps
// its kilos: its loss can no longer be known.
export function isLegacyProduct(product: unknown): boolean {
  const p = normalizeProduct(product);
  return !!p && isLegacy(p);
}

function isLegacy(p: Product): boolean {
  return p.model === null || p.model < PRODUCT_MODEL;
}

export function fromLegacyProduct(product: unknown, tables: CostTables = {}): Product | null {
  const p = normalizeProduct(product);
  if (!p || !isLegacy(p)) return p;
  let raw = 0;
  let cooked = 0;
  const components = p.components.map<ProductComponent>(component => {
    if (component.kind === 'ingredient') {
      const kg = lineRawKg(component, tables);
      if (kg !== null) { raw += kg; cooked += kg; }
      return component;
    }
    const qtyKg = p.noWeightLoss ? component.qtyKg : legacyRawKg(component, tables);
    raw += qtyKg;
    cooked += component.qtyKg;
    return { recipeId: component.recipeId, qtyKg };
  });
  const loses = cooked > 0 && raw - cooked > 1e-9;
  // ⚠️ ONLY WEIGHTS THE RULES ACCEPT (code reviews of 11 Nov 2026): a cooked weight past ten tonnes would be refused at every
  // Save; fittedWeighing keeps such a pair as the same ratio, so the product's figures do not move.
  const weighing = loses ? fittedWeighing(raw * 1000, legacyCookedGrams(cooked)) : { rawGrams: null, cookedGrams: null };
  return {
    ...p,
    components,
    noWeightLoss: false,
    rawGrams: weighing.rawGrams,
    cookedGrams: weighing.cookedGrams,
    model: PRODUCT_MODEL,
  };
}

// The cooked weight of a product saved before the switch, in grams: the old kilos, to the microgram (the next Save writes
// it). ⚠️ What every figure divides by is the batch's kilos to FOUR decimals, and grams turned back into kilos can land one
// floating-point step away from the sum the current app rounded — which, on an exact half of the fourth decimal, would round
// the other way. So the grams are the first of these that give back the old four decimals.
function legacyCookedGrams(cookedKg: number): number {
  const kg = roundTo(cookedKg, 4);
  const grams = cookedKg * 1000;
  const fits = [roundTo(grams, 6), grams, grams * (1 + 1e-12), grams * (1 - 1e-12)].find(g => roundTo(g / 1000, 4) === kg);
  return fits === undefined ? roundTo(grams, 6) : fits;
}

// The product as Mise 2 reads it: normalised, and converted when it was saved before the switch (fromLegacyProduct
// leaves a current one as it is). ⚠️ Every reader of a stored product's LINES or WEIGHTS goes through this, with the
// recipes and ingredients loaded — a line below model 3 holds finished kilos.
export function currentProduct(product: unknown, tables: CostTables = {}): Product | null {
  return fromLegacyProduct(product, tables);
}

// The raw kilos of a recipe line saved before the switch.
// ⚠️ TO THE LAST STORED DECIMAL: the current app costed q finished kilos at the recipe's price per kilo FINISHED, rounded
// to four decimals; q ÷ (1 − loss) raw kilos at the price per kilo RAW, rounded too, can differ from it in that fourth
// decimal. So the raw kilos come from the two prices themselves — q × finished ÷ raw — which on any real recipe is
// q ÷ (1 − loss) to a fraction of a gram, and costs exactly what the line cost. Only where that would move the weight by
// more than 0.1% (a recipe under about 10 cents a raw kilo — mostly water — where four decimals are a coarse rounding of the
// two prices) is the weight the plain q ÷ (1 − loss), whose cost can then move by the two prices' last decimals: at most
// 0.00005 × (1 ÷ (1 − loss) + 1) a kilo on the line — about a hundredth of a cent for the usual losses, half a cent at a
// 99% one (foodcost-product-loss.spec.ts, section 4). The weight, and the loss «Cottura» shows from it, are the dough's.
// ⚠️ NEVER BELOW q (code review, 11 Nov 2026): a raw weight lighter than what came out of the oven is no weight at all, and with
// a loss of a few hundredths of a percent the roundest weight on the line's cost could be.
// ⚠️ NEVER MORE THAN 0.1% FROM THE PLAIN WEIGHT (second code review, 11 Nov 2026): where a price is coarse — a small line, a
// cheap recipe — the roundest weight on the line's cost was far from the dough's (5 g of a 10% loss became 6 g raw, and
// «Cottura» showed a 16.67% loss). So the loss «Cottura» shows is the recipe's to within a tenth of a point.
function legacyRawKg(line: RecipeLine, tables: CostTables): number {
  const q = line.qtyKg;
  const recipe = lookup(tables.recipes, line.recipeId) as Loose | null;
  if (!(q > 0) || !recipe) return q;
  const loss = normalizeLossPct(recipe.lossPct);
  if (!(loss > 0)) return q;
  const plain = q / (1 - loss / 100);
  // The plain weight to the milligram, the most a typed line holds — never under q, for a line saved with more decimals.
  const plainKg = Math.max(roundTo(plain, 6), q);
  const finished = costRecipe(recipe, tables).pricePerKg;
  const rawRate = rawRecipeCost(recipe, tables).pricePerKg;
  // No price to keep — none at all, or one that rounds to nothing (code review, 11 Nov 2026: twenty grams of water at a fifth of
  // a cent a kilo made a 5 kg line into 1 g, the first weight tried «keeping» a cost of 0): the plain weight.
  if (finished === null || rawRate === null || !(finished > 0) || !(rawRate > 0)) return plainKg;
  const exact = q * finished / rawRate;
  const near = (kg: number): boolean => Math.abs(kg / plain - 1) <= 1e-3;
  const fromPlain = !near(exact);
  const cost = roundTo(q * finished, 4);
  const keeps = (kg: number): boolean => kg >= q && roundTo(kg * rawRate, 4) === cost;
  // ⚠️ A WEIGHT A PERSON COULD HAVE TYPED (found driving the app, 11 Nov 2026): the exact raw kilos opened in the gram box as
  // «1030.449734», and 0.9 kg of a recipe that loses 10% as «999.99» instead of 1000. The line's cost is kept to its fourth
  // decimal, and every raw weight whose cost rounds to that same figure keeps every figure of the product (the line, the
  // batch, the per-kilo total, the food cost: the output kilos are the cooked weight, which the raw one does not touch). So
  // the ROUNDEST such weight near the dough's is taken: whole grams, then tenths, hundredths, thousandths of a gram (six
  // decimals of a kilo, the most a typed line holds) — looked for next to the plain weight when the exact one is not the dough's.
  const start = fromPlain ? plain : exact;
  for (const decimals of [3, 4, 5, 6]) {
    const round = roundTo(start, decimals);
    const step = 10 ** -decimals;
    for (const kg of [round, roundTo(round - step, decimals), roundTo(round + step, decimals)]) {
      if (near(kg) && keeps(kg)) return kg;
    }
  }
  if (fromPlain) return plainKg;
  // A recipe so dear that no typable weight lands on the cost (over 100 € a kilo): the exact one, which sits within the 0.1%.
  // Multiplying back can land one floating-point step off q × finished, and on an exact half of the fourth decimal that step
  // would round the line's cost the other way: a hair either side settles it on the cost the line had.
  for (const kg of [exact, exact * (1 + 1e-12), exact * (1 - 1e-12)]) {
    if (keeps(kg)) return kg;
  }
  return Math.max(exact, q);
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
  const p = currentProduct(product, tables);
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
  const p = currentProduct(product, tables);
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
  // Mise 2: a cooked weight heavier than the raw one leaves the batch's weight unknown (productCooking) — the thing to fix
  // is that weight, so it is named instead of 'no-weight'.
  if (p && byWeight(p) && batch.kg <= 0) blockers.push(cookingOf(p, tables).heavier ? 'cooked-heavier' : 'no-weight');

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

// The same price WITHOUT VAT: what one unit must bring in, net, for the food cost to be exactly its target —
// or null when the cost or the target is missing. It needs no VAT rate, so a product whose rate nobody has
// chosen yet can still be told what it must earn.
//
// ⚠️ ROUNDED UP TO THE CENT ON ITS OWN, like suggestedGrossPrice — never worked back from the gross price,
// whose own rounding could leave the net a hair under the target.
export function suggestedNetPrice({ unitCost, targetPct }: { unitCost?: unknown; targetPct?: unknown } = {}): number | null {
  const cost = positiveNumber(unitCost);
  const target = positiveNumber(targetPct);
  if (cost === null || target === null || target > 100) return null;
  return Math.ceil(roundTo(cost / (target / 100) * 100, 6) - 1e-9) / 100;
}

// ── The preview of one product (Federico, 7 Nov 2026) ───────────────────────
//
// Tapping a product in the list shows, before the whole card, the figures that decide its price, in HIS
// order: the selling price as typed, the raw materials, the packaging, the labour (only where time and rate
// are known), the total, the food cost against its target, the margin, and the ideal price with and without
// VAT.
//
// ⚠️ NOTHING HERE IS A NEW SUM: every figure is productionCost(), costProduct() or the two suggested
// prices, so the preview can never disagree with the card or the list. The one figure of its own, the
// materials WITHOUT the packaging, is the batch's share through perUnitOf, the very division unitCost is
// built from.
// ⚠️ UNKNOWN IS null, NEVER 0, and `missing` names what to fill in (blocker keys, in the order a person
// would fill them in), so the screen can say it instead of a number.
// `unpriced` is the «Which?» list under the partial warning (unpricedParts below).
export interface ProductPreview {
  unit: SaleUnit | null;
  sellingPrice: number | null;
  materialsUnitCost: number | null;
  packagingUnitCost: number | null;
  hasPackaging: boolean;
  labourUnitCost: number | null;
  totalUnitCost: number | null;
  foodCostPct: number | null;
  targetPct: number | null;
  status: FoodCostStatus | null;
  margin: number | null;
  idealGross: number | null;
  idealNet: number | null;
  partial: boolean;
  unpriced: UnpricedPart[];
  missing: Blocker[];
}

// ADAPTED: the translator is the LAST argument (the original reads js/i18n.js itself). It is only used for the
// two names of a line that no longer exists, inside `unpriced`.
export function productPreview(product: unknown, tables: CostTables = {}, t: PriceTranslate): ProductPreview {
  const p = currentProduct(product, tables);
  const cost = productionCost(p, tables);
  const result = costProduct(p, tables);
  const unitCost = cost.unitCost;
  const share = p && unitCost !== null ? perUnitOf(p, cost.batch, cost.batch.cost) : null;
  const labourUnitCost = cost.labourUnitCost;
  const targetPct = p ? p.foodCostTarget : null;
  const missing: Blocker[] = [...result.blockers];
  // ⚠️ AN UNPRICED BOX ADDS NOTHING to packagingPerUnit's sum, so its figure would read «0,00 €» — «the
  // packaging is free». Unknown is unknown: no figure, and the line to fix is named.
  const packagingKnown = !cost.packaging.partial;
  if (p && !packagingKnown) missing.push('no-packaging-price');
  if (p && targetPct === null) missing.push('no-target');
  return {
    unit: unitCost !== null ? cost.unit : (p && p.sellingMode ? saleUnitOf(p) : null),
    sellingPrice: p ? p.sellingPrice : null,
    materialsUnitCost: share === null ? null : roundTo(share, 4),
    packagingUnitCost: unitCost === null || !packagingKnown ? null : cost.packaging.cost,
    hasPackaging: !!p && p.packaging.length > 0,
    labourUnitCost,
    // Materials and packaging, plus the work where there is a figure for it.
    totalUnitCost: labourUnitCost !== null ? cost.totalUnitCost : unitCost,
    foodCostPct: result.foodCostPct,
    targetPct,
    status: result.status,
    margin: result.margin,
    idealGross: suggestedGrossPrice({ unitCost, vatRate: p ? p.vatRate : null, targetPct }),
    idealNet: suggestedNetPrice({ unitCost, targetPct }),
    partial: cost.partial || result.partial,
    // What has no price, for the «Which?» list under the partial warning.
    unpriced: unpricedParts(p, tables, t),
    missing: [...new Set(missing)],
  };
}

// ── What has no price yet (Federico, 7 Nov 2026: «Quali?») ──────────────────
//
// Under the warning «a part of this product is not priced yet», the list of WHAT. Pure, so the preview only
// draws it. Ported from current-app commit 02839278 (PR #485).
//
//   [{ name, inRecipe, reason }]   — inRecipe is '' for a line of the product itself
//
// reason: the reasons of ingredientLineCost ('no-ingredient-price', 'no-piece-weight', 'no-piece-price'),
// 'packaging-no-price', 'packaging-no-mode', 'packaging-no-units', 'recipe-no-price', 'gone', or a costRecipe
// reason for a row inside a recipe ('no-price', 'not-linked', 'sub-not-costable'…). unpricedReasonText() turns
// any of them into words.
//
// ⚠️ NEVER AN EMPTY NAME, AND NOTHING LEFT OUT: a line whose ingredient or recipe no longer exists makes the
// cost partial too, so it is listed under the words the card's line shows («This item no longer exists»),
// reason 'gone' — otherwise the warning would stand with nothing to name. A recipe row is listed by its label.
// ⚠️ WHAT MAKES `partial` TRUE, NO MORE AND NO LESS: rows the recipe's own model marks «not costed» with a
// label, opened into sub-recipes — priced or not, because a sub-recipe that is itself partial counts too.
// ⚠️ PIECES AND SPOONS INCLUDED («sale q.b.»): costRecipe() makes a labelled one partial, so leaving it out
// would show the warning with nothing to name.
export interface UnpricedPart {
  name: string;
  inRecipe: string;
  reason: string;
}

// The dictionary KEYS (frozen). NOT exported, like the original's: the names-equal check pins it. The recipe-row
// reasons are the catalogue's (COST_REASON_TEXT).
const UNPRICED_REASON_TEXT = Object.freeze({
  'no-ingredient-price': 'fc.unpriced.noPrice',
  'packaging-no-price': 'fc.unpriced.noPrice',
  'no-piece-weight': 'fc.unpriced.noPieceWeight',
  'no-piece-price': 'fc.unpriced.noPiecePrice',
  'packaging-no-mode': 'fc.unpriced.packagingNoMode',
  'packaging-no-units': 'fc.unpriced.packagingNoUnits',
  'recipe-no-price': 'fc.unpriced.recipeNoPrice',
  'gone': 'fc.unpriced.gone',
} as const);

// The one place an unpriced reason becomes words. ADAPTED: the translator is the last argument. The original
// falls back to the catalogue's costReasonLabel, which is COST_REASON_TEXT looked up through the same t().
export function unpricedReasonText(reason: unknown, t: PriceTranslate): string {
  const own = UNPRICED_REASON_TEXT as Readonly<Record<string, string>>;
  const catalogue = COST_REASON_TEXT as Readonly<Record<string, string>>;
  const key = typeof reason === 'string' ? own[reason] : undefined;
  if (key) return t(key);
  const fallback = typeof reason === 'string' ? catalogue[reason] : undefined;
  return fallback ? t(fallback) : '';
}

export function unpricedParts(product: unknown, tables: CostTables = {}, t: PriceTranslate): UnpricedPart[] {
  const p = currentProduct(product, tables);
  if (!p) return [];
  const out: UnpricedPart[] = [];
  const keys = new Set<string>();
  const add = (name: unknown, inRecipe: string, reason: string): void => {
    const label = String(name || '').trim();
    if (!label) return;
    const key = JSON.stringify([label, inRecipe, reason]);
    if (keys.has(key)) return;
    keys.add(key);
    out.push({ name: label, inRecipe, reason });
  };

  // The rows of one recipe that cannot be costed, opened into sub-recipes. Returns how many it found
  // (de-duplicated ones included), so the caller knows whether anything was named. `depth` and `branch` are
  // costRecipe's own, so this stops where the cost stops.
  const openRecipe = (recipe: Loose, depth: number, branch: ReadonlySet<string>): number => {
    const costed = costRecipe(recipe, tables, depth, branch);
    const here = new Set([...branch, String(recipe.id || '')]);
    const recipeName = String(recipe.name || '').trim();
    const rowsOfRecipe = (recipe.ingredients || []) as unknown[];
    let found = 0;
    costed.rows.forEach((row, i) => {
      const link = linkOf(rowsOfRecipe[i]);
      const sub = link && link.kind === 'recipe' && depth < MAX_RECIPE_DEPTH && !here.has(link.refId)
        ? lookup(tables.recipes, link.refId) as Loose | null : null;
      let named = 0;
      // ⚠️ A sub-recipe with no price is opened only under a LABELLED row: costRecipe() counts an unlabelled
      // one as nothing, so listing what is inside it would name what is not partial. A priced sub-recipe is
      // always opened — its own partial counts whatever the row's label.
      if (sub && link && ((row.reason === 'sub-not-costable' && row.label) || row.costed)) {
        named = openRecipe(sub, depth + 1, new Set([...here, link.refId]));
      }
      found += named;
      if (!row.costed && row.label && !(row.reason === 'sub-not-costable' && named > 0)) {
        add(row.label, recipeName, row.reason as string);
        found += 1;
      }
    });
    return found;
  };

  p.components.forEach(component => {
    const line = componentLineCost(component, tables);
    if (component.kind === 'ingredient') {
      if (line.reason === 'missing-ingredient') add(t('fc.thisItemNoLonger'), '', 'gone');
      else if (line.cost === null) add(line.name, '', line.reason as string);
      return;
    }
    if (line.reason === 'missing-recipe') { add(t('fc.thisRecipeNoLonger'), '', 'gone'); return; }
    const recipe = lookup(tables.recipes, component.recipeId) as Loose;
    const found = openRecipe(recipe, 1, new Set());
    if (line.rate === null && !found) add(recipe.name, '', 'recipe-no-price');
  });

  p.packaging.forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId);
    if (!ingredient) { add(t('fc.thisItemNoLonger'), '', 'gone'); return; }
    const line = packagingLineCost(item, ingredient);
    if (line.cost !== null) return;
    add(ingredientDisplayName(ingredient), '', line.reason === 'no-price' ? 'packaging-no-price' : 'no-piece-price');
  });

  // Packaging that cannot be multiplied out yet is missing from the batch figure (productionCost counts it
  // as partial): ONE entry for all of it. ⚠️ TWO DIFFERENT ADVICES: no way of selling chosen → choose one;
  // chosen but not complete (no pieces per batch, no pack size, nothing weighed yet) → finish it — «choose
  // how it is sold» on a card that says «a pezzo» is wrong.
  if (p.packaging.length > 0 && !((unitsPerBatch(p, batchTotals(p, tables)) as number) > 0)) {
    add(t('fc.unpriced.packagingName'), '', p.sellingMode ? 'packaging-no-units' : 'packaging-no-mode');
  }
  return out;
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

// The search bar of the list (Federico, 7 Nov 2026): does this product's NAME hold what was typed? Accents
// and capitals do not count («caffe» finds «Caffè»), spaces around the text neither, and nothing typed
// matches everything. Applied AFTER sortByMargin, so the rows that stay keep the worst-margin-first order.
export function nameMatches(product: unknown, query: unknown): boolean {
  const wanted = normalizeSearchText(query);
  if (!wanted) return true;
  return normalizeSearchText(product && (product as Loose).name).includes(wanted);
}

// ── Snapshots ────────────────────────────────────────────────────────────────

// Should this change be recorded? The design's rule: a snapshot is taken when the SELLING PRICE or the
// COMPOSITION changes — the two things a person does deliberately — and at no other time.
//
// ⚠️ KNOWN LIMITATION, WRITTEN DOWN ON PURPOSE. Ingredient prices drift upwards without anybody touching
// the product, and that erosion leaves NO point on this series. The history therefore answers "what did we
// decide, and when", not "what did it cost every week". Revisit after two or three months of real use; the
// fix is a periodic snapshot, which was deliberately not built now.
// ⚠️ MISE 2: both sides are read through currentProduct (`tables` is what converts a product below model 3), so the first
// Save of a product the current app wrote — its lines turned raw, nothing typed — is not taken for a new composition.
export function snapshotWorthTaking(before: unknown, after: unknown, tables: CostTables = {}): boolean {
  const a = currentProduct(before, tables);
  const b = currentProduct(after, tables);
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
    // Mise 2: the two weights decide what the batch weighs, so what a kilo costs.
    `w:${product.rawGrams ?? ''}:${product.cookedGrams ?? ''}`,
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
