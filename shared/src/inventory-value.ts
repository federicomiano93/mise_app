// inventory-value.ts — what a month's consumption was worth.
//
// TypeScript port of js/inventory/inventory-value.js for Mise 2, all of it but `formatTotal`.
// Behaviour is identical, input for input: inventory-value.spec.ts runs the current app's tests
// against BOTH files and odd-inputs.spec.ts feeds both the same strange values. The comments below
// are the ones the original paid for in bugs.
//
// ⚠️ A PARTIAL PORT, SO parity.spec.ts DOES NOT PAIR IT. NOT PORTED: formatTotal. It writes the month's
// total with the venue's money, which the original reads from a module variable that the session sets
// (js/currency.js); Mise 2 keeps no venue fact in a module variable, and the app writes money with
// `formatMoney(value, money)` of price-model.ts, handing it the venue's `Money`. The spec compares
// the names, constants, frozen-ness and function shapes of everything this file does port with the
// js/ file itself.
//
// PURE. It imports only the shared base (price-model, order-cost, pack-size, ingredient-name), which
// lives there precisely because Orders enters prices, Food Cost reads them and now the stocktake does
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

import { pricePerKg, roundTo, storedCaseOf, packWeightOf } from './price-model';
// ⚠️ THE SAME unitCost() ORDERS USES, for a product priced per case: the stocktake counts in the
// ORDER unit, so what one counted unit costs must be decided by the one function that already
// reads that unit — two copies of the rule could only ever disagree.
import { unitCost, itemsPerOrderedUnit } from './order-cost';
// ⚠️ MOVED TO pack-size (29 Sep 2026): order-cost needs the exact same reading of "how many kilos does
// one pack hold", and a calculation shared by more than one feature belongs in the shared base
// (CLAUDE.md "Modular by feature"), not inside this one's folder. Re-exported so every EXISTING
// import of parsePackSize from this file keeps working.
import { parsePackSize } from './pack-size';
import { ingredientDisplayName } from './ingredient-name';

export { parsePackSize };

// The fields of a month and of a product this file reads. Anything at all may arrive (a document is
// data), so every field is `unknown`.
type Loose = Readonly<Record<string, unknown>>;
type Maybe<T> = T | null | undefined;
interface ValueMonth {
  packKg?: unknown;
  unitPrice?: unknown;
}
interface ValueCard {
  id?: unknown;
  unit?: unknown;
  weight?: unknown;
  priceUnit?: unknown;
  pricePerUnit?: unknown;
}

function round3(value: number): number {
  return Math.round((value + Number.EPSILON) * 1000) / 1000;
}

// The pack weight this month is using: what somebody typed in beats what the
// text says, and the month carries it forward so it is typed once ever.
//
// ⚠️ A CLOSED MONTH READS ONLY WHAT WAS FROZEN INTO IT. The pack text is free text
// on the live product record — correct a typo in it next spring ("sacco" →
// "25kg") and every closed month would quietly gain a cost it never had. What a
// closed month has no frozen weight for has no cost, for ever.
export function packKgFor(month: unknown, ingredient: unknown, closed: boolean = false): number | null {
  const card = ingredient as Maybe<ValueCard>;
  const m = month as Maybe<ValueMonth>;
  const id = card && card.id;
  const stored = m && m.packKg ? Number((m.packKg as Loose)[id as string]) : NaN;
  if (Number.isFinite(stored) && stored > 0) return round3(stored);
  if (closed) return null;
  const kg = parsePackSize(card && card.weight);
  // ⚠️ A CARTON'S WEIGHT IS ONE ITEM'S (1 Oct 2026): counted in cartoni, the stocktake's pack is
  // packCount of them. Only for a SIMPLE readable weight — «6x1kg» or «sacco» keep today's reading of
  // the whole ordered unit and are never multiplied (that was the ×6-twice defect).
  const items = itemsPerOrderedUnit(ingredient);
  // (A packCount was read from it, so the product is an object.)
  if (items !== null && kg !== null && packWeightOf((card as ValueCard).weight)) return kg * items;
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
export function packPrice(month: unknown, ingredient: unknown, closed?: boolean): number | null {
  const card = ingredient as Maybe<ValueCard>;
  const m = month as Maybe<ValueMonth>;
  const id = card && card.id;

  if (closed) {
    const frozen = Number(m && m.unitPrice ? (m.unitPrice as Loose)[id as string] : NaN);
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

  if (card && card.priceUnit === 'pcs') {
    // A carton card counts cartons: the price of one is the per-item rate × the items in it. ⚠️ AND WHEN THE
    // CARTON CANNOT BE PRICED (a multiplier weight, «6x1l») THERE IS NO PRICE — never one item's rate standing in
    // for a whole carton (3rd review): refuse rather than guess.
    if (itemsPerOrderedUnit(ingredient) !== null) {
      const viaCard = unitCost(ingredient, ingredient);
      return viaCard === null ? null : round3(viaCard);
    }
    const each = Number(card.pricePerUnit);
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
// ⚠️ THE KEYS ARE THE CURRENT APP'S DICTIONARY KEYS, NOT PHRASES: the app decides which of its own
// messages each one stands for.
export type CasePackNote =
  | { key: 'inv.packCaseAmbiguous' }
  | { key: 'inv.packCasePer'; value: number; unit: string };

export function casePackNote(ingredient: unknown): CasePackNote | null {
  if (!storedCaseOf(ingredient)) return null;
  const each = unitCost(ingredient, ingredient);
  if (each === null) return { key: 'inv.packCaseAmbiguous' };
  return { key: 'inv.packCasePer', value: each, unit: String((ingredient && (ingredient as ValueCard).unit) || '').trim() };
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

export type ValueBlocker = typeof NO_PRICE | typeof NO_PACK | typeof NO_FROZEN_PRICE;

export function valueBlocker(month: unknown, ingredient: unknown, closed: boolean = false): ValueBlocker | null {
  if (closed) {
    return packPrice(month, ingredient, true) === null ? NO_FROZEN_PRICE : null;
  }
  const card = ingredient as Maybe<ValueCard>;
  if (storedCaseOf(ingredient)) return unitCost(ingredient, ingredient) === null ? NO_PRICE : null;
  if (card && card.priceUnit === 'pcs') {
    // the same refusal as packPrice: a carton card whose carton cannot be priced has no price
    if (itemsPerOrderedUnit(ingredient) !== null && unitCost(ingredient, ingredient) === null) return NO_PRICE;
    const each = Number(card.pricePerUnit);
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
export interface LineValue {
  value: number | null;
  blocker: ValueBlocker | null;
}

export function lineValue(month: unknown, ingredient: unknown, used: number | null | undefined, closed?: boolean): LineValue {
  if (used === null || used === undefined) return { value: null, blocker: null };
  const price = packPrice(month, ingredient, closed);
  if (price === null) return { value: null, blocker: valueBlocker(month, ingredient, closed) };
  return { value: round3(used * price), blocker: null };
}

// What monthCost is handed: the month, the products and the question "how much of this was used?"
// (null or undefined when nobody counted it).
export interface MonthCostInput<T> {
  month: unknown;
  ingredients: Maybe<readonly T[]>;
  consumptionOf: (ingredient: T) => number | null | undefined;
  closed?: boolean;
}

export interface CostLine<T> {
  ingredient: T;
  used: number;
  value: number | null;
  blocker: ValueBlocker | null;
}

export interface MonthCost<T> {
  lines: CostLine<T>[];
  total: number;
  counted: number;
  withoutValue: number;
}

// The whole month, most expensive first — which is the order somebody wants it
// in, because the question is always "where does the money go".
export function monthCost<T>({ month, ingredients, consumptionOf, closed }: MonthCostInput<T>): MonthCost<T> {
  const list: readonly T[] = Array.isArray(ingredients) ? ingredients : [];
  const lines: CostLine<T>[] = [];
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
    return ingredientDisplayName(a.ingredient).localeCompare(ingredientDisplayName(b.ingredient));
  });

  return { lines, total: round3(total), counted, withoutValue };
}
