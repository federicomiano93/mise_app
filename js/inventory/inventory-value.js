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

import { pricePerKg, formatMoney } from '../price-model.js';

// Everything convertible to kilos, and the one deliberate equivalence:
// ⚠️ 1 LITRE IS TREATED AS 1 KG, exactly as js/price-model.js already does for
// prices. It is wrong for oil and right for milk and water; it is the app's
// existing convention, and having the count disagree with the price would be
// worse than either.
const TO_KG = { kg: 1, g: 0.001, l: 1, lt: 1, ml: 0.001, cl: 0.01 };
const UNIT = '(kg|lt|ml|cl|g|l)';
const NUMBER = '([0-9]+(?:[.,][0-9]+)?)';

// "6 x 1kg" / "12x500g" — a case of several packs. The multiplier comes first.
const MULTIPLIED = new RegExp(`^${NUMBER}\\s*[x×*]\\s*${NUMBER}\\s*${UNIT}$`, 'i');
// "25kg" / "2,27 kg" / "500 g"
const PLAIN = new RegExp(`^${NUMBER}\\s*${UNIT}$`, 'i');
// "kg 5" — the unit first, which is how a lot of Italian invoices are written.
const UNIT_FIRST = new RegExp(`^${UNIT}\\s*${NUMBER}$`, 'i');

const num = text => Number(String(text).replace(',', '.'));

function round3(value) {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

// How many kilos one pack holds, read from the text somebody typed.
//
// ⚠️ IT ANSWERS null FAR MORE OFTEN THAN IT GUESSES, and that is the design. A
// weight it cannot read is a row with no money beside it and a line on the screen
// saying so — which somebody can fix in one tap. A guess would be a wrong cost
// that looks exactly like a right one.
export function parsePackSize(text) {
  if (typeof text !== 'string') return null;
  const clean = text.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!clean) return null;

  let m = clean.match(MULTIPLIED);
  if (m) {
    const total = num(m[1]) * num(m[2]) * TO_KG[m[3]];
    return Number.isFinite(total) && total > 0 ? round3(total) : null;
  }
  m = clean.match(PLAIN);
  if (m) {
    const total = num(m[1]) * TO_KG[m[2]];
    return Number.isFinite(total) && total > 0 ? round3(total) : null;
  }
  m = clean.match(UNIT_FIRST);
  if (m) {
    const total = num(m[2]) * TO_KG[m[1]];
    return Number.isFinite(total) && total > 0 ? round3(total) : null;
  }
  return null;
}

// The pack weight this month is using: what somebody typed in beats what the
// text says, and the month carries it forward so it is typed once ever.
export function packKgFor(month, ingredient) {
  const id = ingredient && ingredient.id;
  const stored = month && month.packKg ? Number(month.packKg[id]) : NaN;
  if (Number.isFinite(stored) && stored > 0) return round3(stored);
  return parsePackSize(ingredient && ingredient.weight);
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
export function packPrice(month, ingredient, closed) {
  const id = ingredient && ingredient.id;

  if (closed && month && month.unitPrice) {
    const frozen = Number(month.unitPrice[id]);
    if (Number.isFinite(frozen) && frozen > 0) return round3(frozen);
  }

  if (ingredient && ingredient.priceUnit === 'pcs') {
    const each = Number(ingredient.pricePerUnit);
    return Number.isFinite(each) && each > 0 ? round3(each) : null;
  }

  const rate = pricePerKg(ingredient);
  if (rate === null) return null;
  const kg = packKgFor(month, ingredient);
  return kg === null ? null : round3(rate * kg);
}

// Why a row has no money beside it, so the screen can say which of the two jobs
// would fix it. `null` means it has one.
export const NO_PRICE = 'no-price';
export const NO_PACK = 'no-pack';

export function valueBlocker(month, ingredient) {
  if (ingredient && ingredient.priceUnit === 'pcs') {
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
  if (price === null) return { value: null, blocker: valueBlocker(month, ingredient) };
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
