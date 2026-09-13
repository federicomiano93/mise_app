// foodcost-model.js — what a finished product costs to make, and what share of
// its price that is. PURE: no DOM, no Firestore, so every rule below is asserted
// under Node (P15).
//
// THE CHAIN, end to end:
//   Orders    knows what an ingredient costs per kilo
//   Catalogue turns that into what a RECIPE costs per kilo
//   here      turns that into what a PRODUCT costs, and what it earns
//
// A product is a BATCH: some kilos of one or more recipes, and ingredients added
// straight to it (Federico, 13 Sep 2026: a cream cornetto is «la ricetta cornetto, la
// ricetta crema e l'ingrediente zucchero a velo»). It is sold BY THE PIECE (the batch is
// divided by how many come out of it), BY WEIGHT (the cost per kilo is the answer
// directly) or BY THE PACK (a pack holds so many grams, or so many pieces).
//
// ⚠️ PACKAGING IS COUNTED PER UNIT SOLD, NOT PER BATCH — one bag per piece, one tray and
// one label per pack, so much film per kilo. Federico, 13 Sep 2026: «per pezzo o
// confezione ma togli infornata non ha senso». Counted in production that day before
// the change: 3 products, none with a packaging line, so no stored number changed meaning.
//
// ⚠️ THE SELLING PRICE IS TYPED GROSS — with VAT, the number on the label, the one
// a person can check against the till. The food cost is worked out on the NET
// price, because the VAT is never the business's money. Getting this backwards
// makes every margin look better than it is, by exactly the VAT rate.

import { t } from '../i18n.js';
import { pricePerKg as ingredientPricePerKg, roundTo, positiveNumber } from '../price-model.js';
import { costRecipe } from '../catalogue/recipe-cost-model.js';

// The VAT rates offered as CHOICES, per country. Federico, 13 Sep 2026: «dammi aliquota
// iva per quelle italiane». Not a closed list — a free field sits beside the choices,
// because the rate that applies to a bakery product is a question for an accountant,
// not for this file.
//
// ⚠️ THE COUNTRY IS THE VENUE'S (js/market.js countryOf), NEVER THE INTERFACE LANGUAGE:
// an Italian bakery run in English still charges Italian IVA — the same rule the
// currency follows.
// ⚠️ ZERO IS A REAL, COMMON ANSWER IN THE UK, not a missing one. Most bread and cakes
// sold to take away are zero-rated there, while the same thing eaten in is standard-
// rated — which is exactly why the rate lives on each PRODUCT. Anything that treats 0
// as "not filled in" will refuse to cost the bakery's main line.
// ⚠️ A RATE ALREADY STORED THAT IS NOT IN ITS COUNTRY'S LIST IS NEVER CHANGED: the editor
// shows it in the «another rate» field. A product saved at 20% stays at 20%.
export const VAT_RATES_BY_COUNTRY = Object.freeze({
  GB: Object.freeze([
    Object.freeze({ rate: 20, key: 'fc.vat.standard' }),
    Object.freeze({ rate: 5, key: 'fc.vat.reduced' }),
    Object.freeze({ rate: 0, key: 'fc.vat.zero' }),
  ]),
  IT: Object.freeze([
    Object.freeze({ rate: 22, key: 'fc.vat.standard' }),
    Object.freeze({ rate: 10, key: 'fc.vat.reduced' }),
    Object.freeze({ rate: 4, key: 'fc.vat.minimum' }),
  ]),
});

// The choices for a venue's country. ⚠️ An unknown country gets the UK's — the app's
// historical list, and the direction js/currency.js falls back in. Unlike a label, a
// wrong CHOICE cannot produce a wrong number: the rate stored is whatever is picked or
// typed, and the free field is always there, so it costs a tap and never a margin.
export function vatRatesFor(country) {
  return Object.prototype.hasOwnProperty.call(VAT_RATES_BY_COUNTRY, country)
    ? VAT_RATES_BY_COUNTRY[country]
    : VAT_RATES_BY_COUNTRY.GB;
}

// Which entry of the VAT menu a stored rate selects, and what the free field shows:
//
//   { select: '' | 'other' | '<rate>', other: '' | '<rate>' }
//
// ⚠️ A RATE THE COUNTRY'S LIST DOES NOT OFFER GOES IN THE FREE FIELD, UNCHANGED — a
// product saved at 20% on an Italian venue opens on «another rate» with 20 in it, and
// keeps costing at 20 until somebody picks otherwise. Selecting a menu value that does
// not exist would instead leave the menu looking blank over a rate still in force.
export function vatSelection(rate, country) {
  const value = zeroOrMore(rate);
  if (value === null) return { select: '', other: '' };
  return vatRatesFor(country).some(choice => choice.rate === value)
    ? { select: String(value), other: '' }
    : { select: 'other', other: String(value) };
}

// How the product is sold. There is no default: a product with none cannot be
// costed, and it says so, rather than being silently treated as one of them.
export const SELLING_MODES = Object.freeze(['piece', 'weight', 'pack']);

// What one pack holds: a weight, or a number of pieces.
export const PACK_UNITS = Object.freeze(['g', 'kg', 'pcs']);

// The amount of an ingredient added straight to a product.
export const LINE_UNITS = Object.freeze(['g', 'kg', 'pcs']);

// ⚠️⚠️ THE SHAPE OF A PRODUCT, WRITTEN ON IT, AND firestore.rules READS IT. A product is
// saved WHOLE, so a phone still on the version before ingredient lines and packs would
// save it back without them — deleting them in silence. The rules refuse a save that
// does not carry this over a product that does. Raise it only with a rules change.
export const PRODUCT_MODEL = 2;

// The traffic light. Green up to the target, amber up to a tenth above it, red
// beyond. RELATIVE rather than a fixed number of points, so a 12% target and a 35%
// target both get a proportionate warning band instead of one being far stricter
// than the other by accident.
export const AMBER_MULTIPLIER = 1.1;

// Why a product cannot be costed. Each names one thing to go and fill in; the
// order is the order a person would fill them in.
// ⚠️ KEYS, resolved at draw time — see js/calculator-render.js. Built once at module
// load, a t() here would be frozen in the language the app started in.
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

// The one place a blocker key becomes words, so no screen can forget to translate it.
export function blockerText(key) {
  return BLOCKER_TEXT[key] ? t(BLOCKER_TEXT[key]) : key;
}

// A number that may legitimately be zero — a VAT rate, and nothing else here.
// Kept separate from positiveNumber so the difference is deliberate and visible:
// everywhere else zero means "not filled in", and here it does not.
export function zeroOrMore(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function isSellingMode(mode) {
  return SELLING_MODES.includes(mode);
}

// ── Normalisation (junk-safe: never throws, never yields NaN) ─────────────────

// A line of what the product is made of: a RECIPE, in kilos per batch — the shape every
// product has had since the start, kept exactly so it is written back unchanged — or an
// INGREDIENT added straight to it, in grams, kilos or pieces per batch.
function normalizeComponent(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.kind === 'ingredient') {
    const ingredientId = raw.ingredientId != null ? String(raw.ingredientId).trim() : '';
    if (!ingredientId) return null;
    const qty = Number(raw.qty);
    return {
      kind: 'ingredient',
      ingredientId,
      qty: Number.isFinite(qty) && qty >= 0 ? qty : 0,
      unit: LINE_UNITS.includes(raw.unit) ? raw.unit : 'g',
    };
  }
  const recipeId = raw.recipeId != null ? String(raw.recipeId).trim() : '';
  if (!recipeId) return null;
  const qtyKg = Number(raw.qtyKg);
  return { recipeId, qtyKg: Number.isFinite(qtyKg) && qtyKg >= 0 ? qtyKg : 0 };
}

// One packaging item, in pieces PER UNIT SOLD.
function normalizePackaging(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ingredientId = raw.ingredientId != null ? String(raw.ingredientId).trim() : '';
  if (!ingredientId) return null;
  const qtyPcs = Number(raw.qtyPcs);
  return { ingredientId, qtyPcs: Number.isFinite(qtyPcs) && qtyPcs >= 0 ? qtyPcs : 0 };
}

// A product from arbitrary (Firestore) input. Missing values stay missing — null,
// not 0 — because "no VAT rate chosen" and "zero-rated" are different answers and
// only one of them can be costed.
//
// ⚠️ EVERY FIELD A PRODUCT CARRIES MUST BE NAMED HERE. The store normalises before it
// caches and the editor copies from the result, so a field left out is dropped by THIS
// version of the app on its own next save — not only by an old phone.
export function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    id: raw.id != null ? String(raw.id) : '',
    name: String(raw.name != null ? raw.name : '').trim(),
    components: (Array.isArray(raw.components) ? raw.components : []).map(normalizeComponent).filter(Boolean),
    packaging: (Array.isArray(raw.packaging) ? raw.packaging : []).map(normalizePackaging).filter(Boolean),
    sellingMode: isSellingMode(raw.sellingMode) ? raw.sellingMode : null,
    piecesPerBatch: positiveNumber(raw.piecesPerBatch),
    packSize: positiveNumber(raw.packSize),
    packUnit: PACK_UNITS.includes(raw.packUnit) ? raw.packUnit : null,
    sellingPrice: positiveNumber(raw.sellingPrice),
    vatRate: zeroOrMore(raw.vatRate),
    foodCostTarget: positiveNumber(raw.foodCostTarget),
    model: Number.isInteger(raw.model) && raw.model > 0 ? raw.model : null,
  };
}

export function normalizeProducts(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeProduct).filter(Boolean);
}

// ── The maths ────────────────────────────────────────────────────────────────

// The price without VAT. A rate of 0 returns the price unchanged, which is correct
// and is the common case for takeaway bakery in the UK.
export function netPrice(gross, vatRate) {
  const price = positiveNumber(gross);
  const rate = zeroOrMore(vatRate);
  if (price === null || rate === null) return null;
  return roundTo(price / (1 + rate / 100), 4);
}

// What an ingredient added straight to a product costs, and weighs, for one batch:
//
//   { cost, kg, reason }   — cost null, and a reason, when it cannot be costed
//
// ⚠️ AN UNPRICED LINE ADDS NO WEIGHT EITHER, the same rule as an unpriced recipe: a
// product would otherwise look heavier and cheaper per kilo than it is.
// ⚠️ A LINE IN PIECES NEEDS A PRICE PER PIECE — or, bought by the kilo, what one piece
// weighs. «3 pieces» of something bought by weight means nothing without it.
// ⚠️ A PIECE WITH NO KNOWN WEIGHT ADDS ITS COST AND NO WEIGHT: a decoration bought by the
// piece is costed exactly, and only a product sold by the kilo is a touch lighter for it.
export function ingredientLineCost(line, ingredient) {
  const ing = ingredient || {};
  const qty = Number(line && line.qty) || 0;
  const pieceKg = positiveNumber(ing.unitWeightKg);

  if (line && line.unit === 'pcs') {
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

  const kg = line && line.unit === 'kg' ? qty : qty / 1000;
  const rate = ingredientPricePerKg(ing);
  if (rate === null) {
    const pricedByPiece = ing.priceUnit === 'pcs' && positiveNumber(ing.pricePerUnit) !== null;
    return { cost: null, kg: 0, reason: pricedByPiece ? 'no-piece-weight' : 'no-ingredient-price' };
  }
  return { cost: roundTo(kg * rate, 4), kg: roundTo(kg, 6), reason: null };
}

// What one batch costs, and what it weighs — its RECIPES and INGREDIENTS. Packaging is
// not in it: it is counted per unit sold (packagingPerUnit below).
//
// Returns { cost, kg, partial, rows } — `rows` explains each line, so the screen
// can say WHICH line has no price rather than only that something has none.
export function batchTotals(product, tables = {}) {
  const p = normalizeProduct(product) || { components: [], packaging: [] };
  const recipesById = tables.recipes || {};
  let cost = 0;
  let kg = 0;
  let partial = false;
  const rows = [];

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
        rows.push({ kind: 'ingredient', id: component.ingredientId, name: ingredient.name || '', qty: component.qty, unit: component.unit, cost: null, reason: line.reason });
        return;
      }
      cost += line.cost;
      kg += line.kg;
      rows.push({ kind: 'ingredient', id: component.ingredientId, name: ingredient.name || '', qty: component.qty, unit: component.unit, cost: line.cost, reason: null });
      return;
    }

    const recipe = lookup(recipesById, component.recipeId);
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
    // A recipe that is only PARTLY priced makes the product partly priced too —
    // the same rule, and the same reason, as one recipe inside another.
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
// ⚠️ ONLY WHAT IS BOUGHT BY THE PIECE, because «3 boxes» of something priced per kilo
// means nothing — left out and named, never guessed at.
export function packagingPerUnit(product, tables = {}) {
  const p = normalizeProduct(product) || { packaging: [] };
  let cost = 0;
  let partial = false;
  const rows = [];

  p.packaging.forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId);
    if (!ingredient) {
      partial = true;
      rows.push({ kind: 'packaging', id: item.ingredientId, name: '', qty: item.qtyPcs, cost: null, reason: 'missing-ingredient' });
      return;
    }
    const each = ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each === null) {
      partial = true;
      rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredient.name || '', qty: item.qtyPcs, cost: null, reason: 'no-piece-price' });
      return;
    }
    const lineCost = roundTo(item.qtyPcs * each, 4);
    cost += lineCost;
    rows.push({ kind: 'packaging', id: item.ingredientId, name: ingredient.name || '', qty: item.qtyPcs, cost: lineCost, reason: null });
  });

  return { cost: roundTo(cost, 4), partial, rows };
}

function lookup(table, id) {
  if (!table || !id) return null;
  if (typeof table.get === 'function') return table.get(id) || null;
  return Object.prototype.hasOwnProperty.call(table, id) ? table[id] : null;
}

// Sold by weight, or by a pack that holds a weight — the two that divide by kilos.
function byWeight(p) {
  return p.sellingMode === 'weight'
    || (p.sellingMode === 'pack' && p.packSize !== null && (p.packUnit === 'g' || p.packUnit === 'kg'));
}

// How many units of sale one batch makes — pieces, kilos or packs — or null while it
// cannot be known: no way of selling chosen, no pieces said, no pack size, no weight.
export function unitsPerBatch(product, batch) {
  const p = product && product.components ? product : normalizeProduct(product);
  if (!p) return null;
  const kg = batch && batch.kg > 0 ? batch.kg : null;
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

// One unit's share of an amount spent on the whole batch — or null when the batch cannot
// be divided yet. ⚠️ THE ONE PLACE THIS DIVISION IS DONE: the materials use it, and so
// will anything else a batch costs (the labour), so no two figures on the screen can be
// divided by two different numbers.
function perUnitOf(p, batch, amount) {
  const units = unitsPerBatch(p, batch);
  return units > 0 ? amount / units : null;
}

// What one unit sold costs to make: its share of the batch, plus its own packaging.
function unitCostOf(p, batch, packaging) {
  if (!p || !(batch.cost > 0)) return null;
  const share = perUnitOf(p, batch, batch.cost);
  if (share === null) return null;
  return roundTo(share + (packaging ? packaging.cost : 0), 4);
}

function unitOf(p) {
  return p.sellingMode === 'weight' ? 'kg' : p.sellingMode === 'pack' ? 'pack' : 'piece';
}

// What making this product costs, BEFORE anybody has said what it sells for.
//
//   { batchCost, unitCost, unit, partial, batch, packaging }
//
// Federico, 13 Sep 2026: the cost of a product belongs in Food cost, and it has to be
// readable as soon as the recipe and its kilos are in — not only once a selling price
// and a VAT rate have been typed, which is when costProduct() below starts answering.
//
// `batchCost` is null when no line has a cost at all (never 0: a product that reads as
// costing nothing is the one wrong answer this screen must not give). It is the batch's
// recipes and ingredients, plus the packaging of every unit it makes once that number is
// known. `unit` is 'piece', 'kg' or 'pack' exactly when `unitCost` is a number.
export function productionCost(product, tables = {}) {
  const p = normalizeProduct(product);
  const batch = batchTotals(p, tables);
  const packaging = packagingPerUnit(p, tables);
  const units = p ? unitsPerBatch(p, batch) : null;
  const unitCost = unitCostOf(p, batch, packaging);
  return {
    batchCost: batch.cost > 0 ? roundTo(batch.cost + (units > 0 ? packaging.cost * units : 0), 4) : null,
    unitCost,
    unit: unitCost === null ? null : unitOf(p),
    // ⚠️ Packaging that cannot yet be multiplied out — no way of selling said — is missing
    // from the batch figure, so the batch figure is too LOW, and says so.
    partial: batch.partial || packaging.partial || (packaging.rows.length > 0 && !(units > 0)),
    batch,
    packaging,
  };
}

// ── Opened from a recipe ─────────────────────────────────────────────────────
//
// Federico, 13 Sep 2026: a recipe's «Apri nel Food cost» opens its product — the one
// that uses it, the list of them when there are several, a new one when there is none.

// The products with this recipe on one of their lines, as they were given (so the
// screen opens the very object the store holds, not a copy of it).
export function productsUsingRecipe(products, recipeId) {
  const id = recipeId == null ? '' : String(recipeId).trim();
  if (!id || !Array.isArray(products)) return [];
  return products.filter(raw => {
    const p = normalizeProduct(raw);
    return !!p && p.components.some(c => c.recipeId === id);
  });
}

// A NEW product for a recipe no product uses yet: the recipe's name and the recipe on
// its first line — and nothing a person has not said. ⚠️ No kilos, no way of selling,
// no price, no VAT: a real-looking value nobody typed is one somebody saves and trusts.
export function draftFromRecipe(recipe) {
  if (!recipe || typeof recipe !== 'object') return null;
  const recipeId = recipe.id == null ? '' : String(recipe.id).trim();
  if (!recipeId) return null;
  return {
    id: null,
    name: String(recipe.name ?? '').trim(),
    components: [{ recipeId, qtyKg: 0 }],
    packaging: [],
    sellingMode: null, piecesPerBatch: null, packSize: null, packUnit: null, sellingPrice: null,
    vatRate: null, foodCostTarget: null,
  };
}

// The whole answer for one product.
//
//   { unitCost, netUnitPrice, foodCostPct, margin, status, partial, blockers, batch, packaging }
//
// foodCostPct is null whenever anything needed is missing, and `blockers` says
// what. It is never guessed and never shown as 0 — a food cost of nothing would be
// read as a product that costs nothing to make.
export function costProduct(product, tables = {}) {
  const p = normalizeProduct(product);
  const batch = batchTotals(p, tables);
  const packaging = packagingPerUnit(p, tables);
  const blockers = [];

  if (!p || !p.components.length) blockers.push('no-components');
  if (p && !p.sellingMode) blockers.push('no-selling-mode');
  if (p && p.sellingMode === 'piece' && p.piecesPerBatch === null) blockers.push('no-pieces');
  if (p && p.sellingMode === 'pack') {
    if (p.packSize === null || !p.packUnit) blockers.push('no-pack-size');
    else if (p.packUnit === 'pcs' && p.piecesPerBatch === null) blockers.push('no-pieces');
  }
  if (p && p.vatRate === null) blockers.push('no-vat');
  if (p && p.sellingPrice === null) blockers.push('no-price');

  // A batch of nothing cannot be divided. Reported as its own reason rather than
  // folded into "no components": the components may be there and simply unpriced.
  if (p && p.components.length && batch.cost <= 0) blockers.push('no-recipe-cost');
  if (p && byWeight(p) && batch.kg <= 0) blockers.push('no-weight');

  const base = {
    unitCost: null, netUnitPrice: null, foodCostPct: null, margin: null,
    status: null, partial: batch.partial || packaging.partial, blockers, batch, packaging,
  };
  if (blockers.length) return base;

  // The blockers above guarantee a number here — and it is the same division the
  // production cost on its own uses.
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
    // What one piece (or one kilo, or one pack) actually leaves behind. The
    // percentage is the comparable number; this is the one that pays the rent.
    margin: roundTo(netUnitPrice - unitCost, 4),
    status: statusFor(foodCostPct, p.foodCostTarget),
  };
}

// The selling price, WITH VAT, at which this product's food cost would be exactly its
// target — or null when the cost, the VAT rate or the target is missing.
//
// Federico, 13 Sep 2026: besides «I have the price, what is my food cost?», the screen
// should answer «I know what it costs and the food cost I want: what do I sell it at?».
// Both on one screen (his choice), from the same numbers.
//
// ⚠️ ROUNDED UP TO THE CENT, NEVER TO THE NEAREST. Rounding down by half a cent would
// put the real food cost a hair ABOVE the target the price was asked for — a price
// suggested to hit a target must hit it.
// ⚠️ A VAT RATE OF 0 IS A REAL ANSWER (zeroOrMore), exactly as in netPrice().
export function suggestedGrossPrice({ unitCost, vatRate, targetPct } = {}) {
  const cost = positiveNumber(unitCost);
  const rate = zeroOrMore(vatRate);
  const target = positiveNumber(targetPct);
  if (cost === null || rate === null || target === null || target > 100) return null;
  const gross = cost / (target / 100) * (1 + rate / 100);
  // The epsilon keeps a price that is already a whole number of cents from being pushed
  // up by floating-point dust (2.4000000000000004 must stay 2.40).
  return Math.ceil(roundTo(gross * 100, 6) - 1e-9) / 100;
}

// green / amber / red against the product's own target, or null when it has none —
// a product with no target is not failing, it simply has nothing to be measured
// against, and colouring it would be inventing a standard nobody set.
export function statusFor(foodCostPct, target) {
  const pct = Number(foodCostPct);
  const goal = positiveNumber(target);
  if (!Number.isFinite(pct) || goal === null) return null;
  if (pct <= goal) return 'green';
  if (pct <= goal * AMBER_MULTIPLIER) return 'amber';
  return 'red';
}

// The products worst first — the order somebody opening this screen wants, because
// the reason to open it is to find what is losing money.
//
// Products that cannot be costed sort LAST, not first: they are a data-entry job,
// not a margin problem, and putting them at the top would bury the real answer
// under a list of half-filled cards.
export function sortByMargin(products, tables = {}) {
  // A corrupt entry must not take the whole screen down. costProduct already
  // tolerates null; the NAME is read here too, and reading it straight off the
  // object threw inside Array.sort — which is the worst place for it, because the
  // list is drawn from a live Firestore snapshot and one bad document would blank
  // the whole page rather than one row.
  const nameOf = p => String((p && p.name) || '');

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

// Should this change be recorded? The design's rule: a snapshot is taken when the
// SELLING PRICE or the COMPOSITION changes — the two things a person does
// deliberately — and at no other time.
//
// ⚠️ KNOWN LIMITATION, WRITTEN DOWN ON PURPOSE. Ingredient prices drift upwards
// without anybody touching the product, and that erosion leaves NO point on this
// series. The history therefore answers "what did we decide, and when", not "what
// did it cost every week". Revisit after two or three months of real use; the fix
// is a periodic snapshot, which was deliberately not built now.
export function snapshotWorthTaking(before, after) {
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

// A stable string for "what this product is made of", so a reordered list of the
// same components is NOT a change. Sorted, because the editor can reorder rows and
// nobody means anything by it.
function compositionKey(product) {
  const parts = [
    ...product.components.map(c => (c.kind === 'ingredient'
      ? `i:${c.ingredientId}:${c.qty}:${c.unit}`
      : `r:${c.recipeId}:${c.qtyKg}`)),
    ...product.packaging.map(p => `p:${p.ingredientId}:${p.qtyPcs}`),
  ];
  return parts.sort().join('|');
}

// One entry in the append-only history. It freezes the ingredient prices of the
// moment as well as the answer, so a margin from six months ago can still be
// explained rather than merely asserted.
//
// ⚠️ THE VAT RATE IS FROZEN TOO. Rates change by law, and without this every past
// margin would silently be recomputed against today's rate — corrupting a series
// whose whole purpose is to be comparable over time.
export function productSnapshot(product, result, nowIso, tables = {}) {
  const p = normalizeProduct(product) || {};
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

// What every ingredient this product depends on cost at this moment, flattened to
// { ingredientId: pricePerKg } — or the price of one piece, for what is bought by the
// piece. Recipes are walked so an ingredient two levels down is captured too —
// otherwise the frozen record could not explain a change that came from inside a
// sub-recipe.
function frozenPricesFor(product, tables) {
  const out = {};
  const seen = new Set();

  const freezeIngredient = id => {
    const ingredient = lookup(tables.ingredients, id);
    const rate = ingredientPricePerKg(ingredient);
    if (rate !== null) { out[id] = rate; return; }
    const each = ingredient && ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each !== null) out[id] = each;
  };

  const walkRecipe = (recipeId, depth) => {
    if (depth > 4 || seen.has(recipeId)) return;
    seen.add(recipeId);
    const recipe = lookup(tables.recipes, recipeId);
    if (!recipe || !Array.isArray(recipe.ingredients)) return;
    recipe.ingredients.forEach(row => {
      const refId = row && row.refId ? String(row.refId) : '';
      if (!refId) return;
      if (row.kind === 'recipe') { walkRecipe(refId, depth + 1); return; }
      const rate = ingredientPricePerKg(lookup(tables.ingredients, refId));
      if (rate !== null) out[refId] = rate;
    });
  };

  (product.components || []).forEach(c => {
    if (c.kind === 'ingredient') freezeIngredient(c.ingredientId);
    else walkRecipe(c.recipeId, 1);
  });
  (product.packaging || []).forEach(item => {
    const ingredient = lookup(tables.ingredients, item.ingredientId);
    const each = ingredient && ingredient.priceUnit === 'pcs' ? positiveNumber(ingredient.pricePerUnit) : null;
    if (each !== null) out[item.ingredientId] = each;
  });

  return out;
}
