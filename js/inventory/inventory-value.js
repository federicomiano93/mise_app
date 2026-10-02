// inventory-value.js — what a month's consumption was worth.
//
// PURE. It imports only js/price-model.js, which lives in js/ root precisely
// because Orders enters prices, Food Cost reads them and now the stocktake does
// too — a copy of a CALCULATION is worse than a copy of a dialog.
//
// ⚠️⚠️ THE AWKWARD JOINT IN THIS WHOLE FEATURE IS HERE, AND IT IS WORTH
// UNDERSTANDING BEFORE CHANGING ANYTHING. The count is in PACKS — sacks, cases,
// boxes, whatever the thing is ordered in. The price is per KILO (or per litre,
// or per piece). To turn a count into money you need the one number this app has
// never held: how much one pack weighs. What it holds instead is `weight`, a FREE
// TEXT field somebody typed — "25kg", "2.27kg", "6x1kg", "sacco".
//
// So: the text is read where it can be read, the answer is stored so it is read
// once and not every month, and where it cannot be read THE ROW STILL COUNTS —
// it simply has no money beside it, and the screen says how many such rows there
// are. No number is ever invented. A guessed pack weight would not look wrong on
// the screen; it would just make the month's cost wrong.

import { pricePerKg, formatMoney, roundTo, storedCaseOf, packWeightOf } from '../price-model.js';
// ⚠️ THE SAME unitCost() ORDERS USES, for a product priced per case: the stocktake counts in the
// ORDER unit, so what one counted unit costs must be decided by the one function that already
// reads that unit — two copies of the rule could only ever disagree.
import { unitCost, itemsPerOrderedUnit } from '../order-cost.js';
// ⚠️ MOVED TO js/pack-size.js (29 Sep 2026): js/order-cost.js needs the exact
// same reading of "how many kilos does one pack hold", and a calculation
// shared by more than one feature belongs in js/ root (CLAUDE.md "Modular by
// feature"), not inside this one's folder. Re-exported so every EXISTING
// import of parsePackSize from this file keeps working.
import { parsePackSize } from '../pack-size.js';

export { parsePackSize };

function round3(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

// The pack weight this month is using: what somebody typed in beats what the
// text says, and the month carries it forward so it is typed once ever.
//
// ⚠️ A CLOSED MONTH READS ONLY WHAT WAS FROZEN INTO IT. The pack text is free text
// on the live product record — correct a typo in it next spring ("sacco" →
// "25kg") and every closed month would quietly gain a cost it never had. What a
// closed month has no frozen weight for has no cost, for ever.
export function packKgFor(month, ingredient, closed = false) {
  const id = ingredient && ingredient.id;
  const stored = month && month.packKg ? Number(month.packKg[id]) : NaN;
  if (Number.isFinite(stored) && stored > 0) return round3(stored);
  if (closed) return null;
  const kg = parsePackSize(ingredient && ingredient.weight);
  // ⚠️ A CARTON'S WEIGHT IS ONE ITEM'S (1 Oct 2026): counted in cartoni, the stocktake's pack is
  // packCount of them. Only for a SIMPLE readable weight — «6x1kg» or «sacco» keep today's reading of
  // the whole ordered unit and are never multiplied (that was the ×6-twice defect).
  const items = itemsPerOrderedUnit(ingredient);
  if (items !== null && kg !== null && packWeightOf(ingredient.weight)) return kg * items;
  return kg;
}

// What one pack of this costs.
//
// ⚠️ A PRODUCT PRICED BY THE PIECE NEEDS NO PACK WEIGHT AT ALL. Its rate already
// is "per one of them", which is the same thing the stocktake counts — so the
// conversion the rest of this file exists for simply does not arise.
// ⚠️ A CLOSED MONTH USES THE PRICE FROZEN INTO IT. A price changed next spring
// must not restate what last September cost; that is the whole reason the month
// carries a `unitPrice` map of its own.
// ⚠️ AND WHAT IS FROZEN IS THE PRICE OF ONE COUNTED UNIT, not a rate per kilo.
// That is what makes it right for a product priced by the piece as well as one
// priced by weight — there is nothing left to multiply on the way out, and so
// nothing that can disagree with the pack weight stored beside it.
// ⚠️⚠️ AND THE FROZEN FIGURE IS THE ONLY ONE A CLOSED MONTH MAY USE — no falling
// back to today's price when it is missing. A fallback is what made the word
// "closed" a promise the code did not keep: the screen says «this month is closed:
// its figures no longer change» while a price entered in November would have
// changed what September cost. A product with no frozen price has NO cost in that
// month, the row says so, and the total says how many such rows there are.
export function packPrice(month, ingredient, closed) {
  const id = ingredient && ingredient.id;

  if (closed) {
    const frozen = Number(month && month.unitPrice ? month.unitPrice[id] : NaN);
    return Number.isFinite(frozen) && frozen > 0 ? round3(frozen) : null;
  }

  // ⚠️ A PRICE QUOTED PER CASE (30 Sep 2026): one counted unit is one ORDER unit, and what
  // that costs depends on the unit (eggs ordered in «pz» from a case of 360: one egg; «cartone»:
  // the case) — unitCost() decides, null when the unit leaves doubt. Needs no pack weight: a case of
  // packages carries the size of one package inside itself (stored at save time), so it does not
  // read the ingredient's weight either. A STALE case (a rate typed over it) is not a case at all
  // and goes on to the rules below, which do need the weight.
  // Six decimals, not round3: one straw out of 2000 must not round to nothing.
  if (storedCaseOf(ingredient)) {
    const each = unitCost(ingredient, ingredient);
    return each === null ? null : roundTo(each, 6);
  }

  if (ingredient && ingredient.priceUnit === 'pcs') {
    // A carton card counts cartons: the price of one is the per-item rate × the items in it. ⚠️ AND WHEN THE
    // CARTON CANNOT BE PRICED (a multiplier weight, «6x1l») THERE IS NO PRICE — never one item's rate standing in
    // for a whole carton (3rd review): refuse rather than guess.
    if (itemsPerOrderedUnit(ingredient) !== null) {
      const viaCard = unitCost(ingredient, ingredient);
      return viaCard === null ? null : round3(viaCard);
    }
    const each = Number(ingredient.pricePerUnit);
    return Number.isFinite(each) && each > 0 ? round3(each) : null;
  }

  const rate = pricePerKg(ingredient);
  if (rate === null) return null;
  const kg = packKgFor(month, ingredient);
  return kg === null ? null : round3(rate * kg);
}

// What the stocktake detail says about a product priced per CASE: the price of ONE COUNTED UNIT
// in the ingredient's own order unit (the unit the counts are typed in), or — when that unit
// leaves doubt (busta, sacco… on a case of several) — that it cannot be valued and what to
// change. PURE: the caller does the t() and the number formatting (formatRate, so a tiny price
// is never shown as 0.00). Null when the ingredient carries no valid case.
export function casePackNote(ingredient) {
  if (!storedCaseOf(ingredient)) return null;
  const each = unitCost(ingredient, ingredient);
  if (each === null) return { key: 'inv.packCaseAmbiguous' };
  return { key: 'inv.packCasePer', value: each, unit: String((ingredient && ingredient.unit) || '').trim() };
}

// Why a row has no money beside it, so the screen can say which of the two jobs
// would fix it. `null` means it has one.
//
// ⚠️ THE THIRD ONE IS NOT A JOB, IT IS A FACT. In a closed month nothing can be
// fixed: the figures were frozen on the day, and a price typed now belongs to now.
// Saying "no price entered" there would send somebody to enter one and change
// nothing, which is worse than saying what actually happened.
export const NO_PRICE = 'no-price';
export const NO_PACK = 'no-pack';
export const NO_FROZEN_PRICE = 'no-frozen-price';

export function valueBlocker(month, ingredient, closed = false) {
  if (closed) {
    return packPrice(month, ingredient, true) === null ? NO_FROZEN_PRICE : null;
  }
  if (storedCaseOf(ingredient)) return unitCost(ingredient, ingredient) === null ? NO_PRICE : null;
  if (ingredient && ingredient.priceUnit === 'pcs') {
    // the same refusal as packPrice: a carton card whose carton cannot be priced has no price
    if (itemsPerOrderedUnit(ingredient) !== null && unitCost(ingredient, ingredient) === null) return NO_PRICE;
    const each = Number(ingredient.pricePerUnit);
    return Number.isFinite(each) && each > 0 ? null : NO_PRICE;
  }
  if (pricePerKg(ingredient) === null) return NO_PRICE;
  return packKgFor(month, ingredient) === null ? NO_PACK : null;
}

// One row's line of the month's cost.
//
// ⚠️ `used` COMES FROM THE MODEL, NOT FROM HERE, and a null stays null. A product
// nobody counted has no consumption, so it has no cost either — not a zero cost,
// which would quietly flatter the total.
export function lineValue(month, ingredient, used, closed) {
  if (used === null || used === undefined) return { value: null, blocker: null };
  const price = packPrice(month, ingredient, closed);
  if (price === null) return { value: null, blocker: valueBlocker(month, ingredient, closed) };
  return { value: round3(used * price), blocker: null };
}

// The whole month, most expensive first — which is the order somebody wants it
// in, because the question is always "where does the money go".
export function monthCost({ month, ingredients, consumptionOf, closed }) {
  const list = Array.isArray(ingredients) ? ingredients : [];
  const lines = [];
  let total = 0;
  let counted = 0;
  let withoutValue = 0;

  list.forEach(ingredient => {
    const used = consumptionOf(ingredient);
    if (used === null || used === undefined) return;
    counted += 1;
    const { value, blocker } = lineValue(month, ingredient, used, closed);
    if (value === null) withoutValue += 1; else total += value;
    lines.push({ ingredient, used, value, blocker });
  });

  lines.sort((a, b) => {
    // Rows with no value sort LAST: they are a data-entry job, not an answer, and
    // at the top they would bury the thing the screen is for.
    if ((a.value === null) !== (b.value === null)) return a.value === null ? 1 : -1;
    if (a.value !== b.value) return (b.value || 0) - (a.value || 0);
    return String(a.ingredient.name || '').localeCompare(String(b.ingredient.name || ''));
  });

  return { lines, total: round3(total), counted, withoutValue };
}

// The month's total as it should read on a screen, in the venue's own currency.
// ⚠️ NO SYMBOL IS EVER WRITTEN IN THIS PROJECT'S CODE — formatMoney asks the
// session, which got it from the venue's country.
export function formatTotal(value) {
  return formatMoney(value);
}
