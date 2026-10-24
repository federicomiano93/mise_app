// order-cost.ts — what an order costs, net and with VAT. PURE (P15): no DOM,
// no Firestore, so every rule below is asserted under Node rather than read
// back out of a rendered screen.
//
// TypeScript port of js/order-cost.js for Mise 2. Behaviour is identical, input for input:
// order-cost.spec.ts runs every test against BOTH files, parity.spec.ts compares their exports and
// odd-inputs.spec.ts feeds both the same strange values. The comments below are the ones the
// original paid for in bugs.
//
// ⚠️⚠️ MONEY IS SHOWN ONLY TO PEOPLE WHO CAN READ PRICES. This file computes
// numbers; the caller draws them only once the ingredient-prices read actually
// SUCCEEDED — the rules refuse it to an employee not shown Food cost. Nothing here
// enforces that; it cannot, being pure.
//
// ⚠️ THE PRICE STAYS NET, EXACTLY AS FOOD COST ALREADY INSISTS ON: what is stored on
// ingredient-prices is the price WITHOUT VAT, and the VAT is added on top here, once, for
// DISPLAY. Nothing here ever writes back to a price.

import { isPriceUnit, positiveNumber, storedCaseOf, packBaseOf } from './price-model';
import { parsePackSize } from './pack-size';
import { cleanUnit, sameUnit } from './order-unit';

// The fields of a card and of a stored price this file reads. Anything at all may arrive (a
// document is data), so every field is `unknown`.
interface OrderCard {
  unit?: unknown;
  packUnit?: unknown;
  packCount?: unknown;
  weight?: unknown;
}
interface OrderPrice {
  priceUnit?: unknown;
  pricePerUnit?: unknown;
  unitWeightKg?: unknown;
}
type Maybe<T> = T | null | undefined;

// The net cost of ONE ORDERED UNIT of an ingredient — one sack, one case, one
// piece, whatever the order screen's own quantity box counts.
//
// A price «by piece» is the price of ONE UNIT BOUGHT — the same thing the stocktake
// counts («its rate already is per one of them») — so it is the price of one ordered unit, whatever
// that unit is called. The rules that decide the rest are listed under «ONLY WHEN THE ORDER UNIT
// LEAVES NO DOUBT».
//
// ⚠️ NEVER ROUNDED HERE. A rounded unit cost multiplied by a large quantity
// drifts from the true total by more than a rounding error should; round
// only the number actually shown, with formatMoney (price-model.ts).
//
// ⚠️⚠️ ONLY WHEN THE ORDER UNIT LEAVES NO DOUBT (review of 28 Sep 2026). The quantity
// box counts whatever `ingredient.unit` says — a sack, a case, or kilos — and the
// same pack text reads two ways: «25kg» ordered in `kg` means 30 is thirty kilos,
// not thirty sacks, and a per-piece price on a «6x1kg» case could be the price of
// the case or of one bag in it. A guess there is a total 25 times too high or 6
// times too low that looks exactly as trustworthy as a right one, so anything
// ambiguous is `null` — counted as «no price» and said so on screen.
//
//   order unit kg/g/l/ml/cl and a kg|l price → the quantity IS a weight/volume:
//                                               rate × that many kilos (litres)
//   pack word or no unit, kg|l price, «25kg»  → rate × the pack's kilos
//   pcs price, pack text without a multiplier → rate (one ordered unit = one piece)
//   pcs price on a «6x1kg» case, or ordered    → null (which one is priced?)
//   by weight
//
// The order unit is free text, so the weight words are matched in the forms people
// actually type, in both languages — a missed «kili» would read a kilo as a whole
// 25kg sack, a total 25 times too high.
const WEIGHT_UNITS: Readonly<Record<string, number>> = Object.freeze({
  kg: 1, kgs: 1, kilo: 1, kilos: 1, kili: 1, chilo: 1, chili: 1, chilogrammi: 1,
  g: 0.001, gr: 0.001, grammi: 0.001, grams: 0.001,
  l: 1, lt: 1, litro: 1, litri: 1, litre: 1, litres: 1, liter: 1, liters: 1,
  ml: 0.001, cl: 0.01,
});
const MULTIPLIER = /\d\s*[x×*]\s*\d/i;
// The order-unit words that mean «one item of the case» — ordering «50 pz» from a case price
// means fifty items, each costing the case price divided by what the case holds.
const PIECE_UNITS: ReadonlySet<string> = new Set([
  'pz', 'pezzo', 'pezzi', 'pcs', 'pc', 'piece', 'pieces', 'each',
]);
// The words that mean «one whole case» — the counted thing IS the case that was priced.
const CASE_UNITS: ReadonlySet<string> = new Set([
  'cartone', 'cartoni', 'cassa', 'casse', 'collo', 'colli', 'confezione', 'confezioni',
  'scatola', 'scatole', 'box', 'case', 'cases', 'carton', 'crate', 'pack',
]);

// The kilos (litres) in one unit of a weight word. Only asked after the word is known to be one
// (hasOwnProperty), so the `?? NaN` is what the original's `undefined` would turn into, and cannot
// be reached.
const kilosIn = (word: string): number => WEIGHT_UNITS[word] ?? NaN;

// ⚠️ A PRICE QUOTED PER CASE (30 Sep 2026) decides by the order unit, and only when the
// price carries a whole case (storedCaseOf — a case that no longer matches its rate is a
// stale one and is ignored); without one everything below «const orderUnit» is what it was.
//   a weight/volume word      → as ever: rate × that unit's kilos (a case of pieces: null)
//   a piece word, or — on a case of PACKAGES only — the ingredient's own package word (packUnit:
//   «busta») → ONE ITEM of the case: case price ÷ how many it holds
//   a case word, or no unit   → the CASE price («1 cartone of 50 pz at 20» is 20, never 0.40)
//   a case of ONE             → the case price, for any non-weight word
//   any other word (busta, sacco, bottiglia…) on a case of several → null: one of WHAT?
//     Like every other rule in this file, when in doubt there is no number.
// ── «Cartone» (1 Oct 2026): current product data × the stored cost of ONE item ───────────────
// ⚠️ WHEN THE CARD SAYS «CARTONE» (a whole-number packCount) THE ANSWER IS BUILT FROM WHAT THE CARD
// SAYS NOW, NOT FROM THE FORMAT THE PRICE WAS TYPED UNDER. An employee can change the count, the
// package word or the weight from a screen that has no price section; the frozen case then no
// longer matches, and reading it as it stands would misprice (a one-pack case of 5 turned into a
// carton of 4 cost 5, not 20). So: the cost of ONE item (case price ÷ what that case held, or the
// per-piece rate, or a per-kilo rate × one item's weight) × the items in ONE ORDERED UNIT (packCount
// when ordered in the carton word, 1 when ordered in the package word).
// ⚠️ AN ITEM WITH NO packCount NEVER COMES HERE: legacyUnitCost() below is the old function, and
// the current app's tests/readers-regression-grid.test.mjs runs a frozen copy of it against this
// over every stored shape (order-cost.spec.ts runs the same grid against BOTH files). Exactly ONE
// shape reads differently from before (2nd review, 1 Oct 2026), named in the grid: a weight word
// on a per-piece price that remembers one piece's weight. A weight that is unreadable or a
// multiplier («6x1kg», «sacco») also keeps today's whole-unit reading and is NOT multiplied by
// packCount — that was the ×6-twice defect.

// A packCount as the rules store it: a whole number ≥ 1. Anything else (a string, 0, 2.5) is none.
export function validPackCount(ingredient: unknown): number | null {
  const count = ingredient && (ingredient as OrderCard).packCount;
  return typeof count === 'number' && Number.isInteger(count) && count >= 1 ? count : null;
}

// How many items ONE ordered unit of this card holds: packCount for the carton, 1 for the package word
// or a piece word. null for an item with no packCount.
export function itemsPerOrderedUnit(ingredient: unknown): number | null {
  const count = validPackCount(ingredient);
  if (count === null) return null;
  // A packCount that is valid means the card is an object.
  const card = ingredient as OrderCard;
  const unit = cleanUnit(card.unit).toLowerCase().replace(/\.$/, '');
  const pack = cleanUnit(card.packUnit).toLowerCase().replace(/\.$/, '');
  if ((pack !== '' && unit === pack) || PIECE_UNITS.has(unit)) return 1;
  return count;
}

// The net cost of ONE item, from the stored price and the card's weight; null when that cannot be
// known (a per-kilo rate with no simple weight, or a pieces price on a multiplier text).
// ⚠️ A PIECE THAT IS NOT THE ITEM (4th review, 2 Oct 2026): eggs priced 0.25 a piece, remembered as 60 g each,
// on a card whose weight is the 360 g tray. One item of the carton is the TRAY, and 0.25 is one egg: how many
// eggs a tray holds is written nowhere. A per-piece rate (no stored case) that remembers a piece weight
// different from the card's readable weight is therefore NOT the price of one item — a carton card gets no
// number from it (refuse rather than guess), and is not handed to the old reading either, which would price
// the whole carton as one egg.
export function pieceIsNotItem(ingredient: unknown, price: unknown): boolean {
  if (!price || (price as OrderPrice).priceUnit !== 'pcs' || storedCaseOf(price)) return false;
  const pieceKg = positiveNumber((price as OrderPrice).unitWeightKg);
  const card = ingredient as Maybe<OrderCard>;
  const base = packBaseOf(String((card && card.weight) || ''));
  return pieceKg !== null && base !== null && Math.abs(base.size - pieceKg) > 1e-9;
}

export function costPerItem(ingredient: unknown, price: unknown): number | null {
  const wholeCase = storedCaseOf(price);
  if (wholeCase) return wholeCase.casePrice / wholeCase.caseCount;
  const stored = price as Maybe<OrderPrice>;
  const rate = positiveNumber(stored && stored.pricePerUnit);
  // A rate was read from it, so the price is an object.
  if (rate === null || !isPriceUnit((stored as OrderPrice).priceUnit)) return null;
  const card = ingredient as Maybe<OrderCard>;
  const packText = String((card && card.weight) || '');
  if ((stored as OrderPrice).priceUnit === 'pcs') return MULTIPLIER.test(packText) || pieceIsNotItem(ingredient, price) ? null : rate;
  const base = packBaseOf(packText);
  return base ? rate * base.size : null;
}

export function unitCost(ingredient: unknown, price: unknown): number | null {
  const items = itemsPerOrderedUnit(ingredient);
  if (items === null) return legacyUnitCost(ingredient, price);
  const stored = price as Maybe<OrderPrice>;
  if (!stored || !isPriceUnit(stored.priceUnit) || positiveNumber(stored.pricePerUnit) === null) return null;
  const card = ingredient as Maybe<OrderCard>;
  const orderUnit = String((card && card.unit) || '').trim().toLowerCase().replace(/\.$/, '');
  // Ordered by weight, the quantity IS kilos or litres: that was never about the case.
  if (Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, orderUnit)) return legacyUnitCost(ingredient, price);
  if (pieceIsNotItem(ingredient, price)) return null;
  const each = costPerItem(ingredient, price);
  if (each !== null) return each * items;
  // ⚠️ ONE ITEM WITH NO KNOWN COST HAS NO PRICE (5th review, 2 Oct 2026): the old reading prices the WHOLE
  // ordered unit («6x1kg» → 12), which is the carton — never one busta of it. Only the carton word keeps it.
  return items === validPackCount(ingredient) ? legacyUnitCost(ingredient, price) : null;
}

// A per-piece price read by WEIGHT: what one kilo costs is the piece's price ÷ one piece's weight, so a
// line of `kilos` kilos costs that × kilos. null while nobody said what a piece weighs.
function viaPieceWeight(price: OrderPrice, rate: number, kilos: number): number | null {
  const pieceKg = positiveNumber(price.unitWeightKg);
  return pieceKg === null ? null : (rate / pieceKg) * kilos;
}

function legacyUnitCost(ingredient: unknown, price: unknown): number | null {
  const stored = price as Maybe<OrderPrice>;
  if (!stored || !isPriceUnit(stored.priceUnit)) return null;
  const rate = positiveNumber(stored.pricePerUnit);
  if (rate === null) return null;

  const card = ingredient as Maybe<OrderCard>;
  const orderUnit = String((card && card.unit) || '').trim().toLowerCase().replace(/\.$/, '');
  const byWeight = Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, orderUnit);

  const wholeCase = storedCaseOf(price);
  if (wholeCase) {
    if (byWeight) {
      return stored.priceUnit === 'pcs' ? viaPieceWeight(stored, rate, kilosIn(orderUnit)) : rate * kilosIn(orderUnit);
    }
    // ⚠️ THE PACKAGE WORD MEANS «ONE ITEM» ONLY FOR A CASE OF PACKAGES ('pack'), and it is asked
    // BEFORE the case words: a package declared «scatola» and ordered by «scatola» is one package,
    // not the case. On any other case it means nothing — eggs sold in a «vaschetta» of 360 g,
    // ordered by «vaschetta» from a case of 60 pieces at 12, are NOT 0.20 each (a tray is not
    // one egg): they fall through to the rules below and, being no piece/case word, are null.
    // ⚠️ THAT STAYS, ON PURPOSE (2nd review, 1 Oct 2026, decided by the owner's rule «refuse rather than
    // guess»): on legacy data a case of 30 eggs ordered by its own package word is not ONE egg. So after
    // an EMPLOYEE turns a Cartone into a Singola the line has no price until a manager opens the card
    // (it reopens on the new card as a Singola — pack-format.js usesLegacyCard keeps a case ordered by its own
    // package word there — says the format changed, and «Ricalcola» converts it to per-item).
    const packWord = String((card && card.packUnit) || '').trim().toLowerCase().replace(/\.$/, '');
    const isPackCase = wholeCase.caseItemUnit === 'pack';
    if (PIECE_UNITS.has(orderUnit) || (isPackCase && packWord !== '' && orderUnit === packWord)) {
      return wholeCase.casePrice / wholeCase.caseCount;
    }
    // ⚠️ AND ON ANY OTHER CASE THE PACKAGE WORD IS AMBIGUOUS EVEN WHEN IT IS ALSO A CASE WORD.
    // A box priced «100 pz at 30», declared as a «scatola» and ordered by «scatola», is one
    // scatola of 0.30 — or the whole case of 30? Nothing says; the case-word rule below would
    // answer 30 and look exactly as trustworthy as the right number (review of 30 Sep 2026).
    if (packWord !== '' && orderUnit === packWord && wholeCase.caseCount !== 1) return null;
    if (orderUnit === '' || CASE_UNITS.has(orderUnit) || wholeCase.caseCount === 1) return wholeCase.casePrice;
    return null;
  }
  const packText = String((card && card.weight) || '');

  if (stored.priceUnit === 'pcs') {
    if (byWeight) return viaPieceWeight(stored, rate, kilosIn(orderUnit));
    if (MULTIPLIER.test(packText)) return null;
    return rate;
  }

  // 'kg' | 'l' — price-model.ts already treats 1 litre as 1 kilo the same way.
  if (byWeight) return rate * kilosIn(orderUnit);
  const packKg = parsePackSize(packText);
  if (packKg === null) return null;
  return rate * packKg;
}

// The net cost of ONE of a line's CHOSEN unit. The card's own unit (or no choice) is exactly
// unitCost(). A DIFFERENT unit is priced only when it is the card's package word AND the price
// carries a stored case of packages: case price ÷ packages in it. Every other combination is
// null («no price») — a per-piece or per-kilo rate says nothing about how much a busta costs,
// and a stale unit (a package since renamed) means nothing either; a guess would be 4 times
// too high and look as trustworthy as a right number.
export function lineUnitCost(ingredient: unknown, price: unknown, unit: unknown): number | null {
  const card = ingredient as Maybe<OrderCard>;
  const chosen = cleanUnit(unit);
  if (chosen === '' || sameUnit(chosen, card && card.unit)) return unitCost(ingredient, price);
  const wholeCase = storedCaseOf(price);
  if (validPackCount(ingredient) !== null) {
    // A carton card: its package word is ONE item, whatever the stored case held.
    if (!sameUnit(chosen, (card as OrderCard).packUnit)) return null;
    return unitCost({ ...(ingredient as object), unit: chosen }, price);
  }
  if (!wholeCase || wholeCase.caseItemUnit !== 'pack' || !(wholeCase.caseCount > 0)) return null;
  if (!sameUnit(chosen, card && card.packUnit)) return null;
  return unitCost({ ...(ingredient as object), unit: chosen }, price);
}

// One line of an order, as the screen hands it over: every field may be missing or unreadable.
//   qty: how many were ordered; unitCost: what ONE costs (null = no price), already from
//   unitCost() or lineUnitCost(); vatRate: the purchase VAT in percent (null/undefined = not stated).
export interface OrderCostLine {
  qty?: unknown;
  unitCost?: unknown;
  vatRate?: unknown;
}

export interface OrderCostResult {
  net: number;
  vatByRate: Record<string, number>;
  gross: number;
  missingPrice: number;
  missingVat: number;
  costed: number;
}

// The whole order's cost from its LINES — one entry per ingredient actually
// being ordered (qty > 0), each already carrying its own unitCost() and
// vatRate (or null/undefined for "not stated").
//
// line: { qty, unitCost: number|null, vatRate: number|null|undefined }
// -> { net, vatByRate: { [rate]: amount }, gross, missingPrice, missingVat, costed }
//
// ⚠️ A LINE WITH NO PRICE IS NOT ZERO. Silently treating it as £0 would make
// an order cheaper on screen than it will actually be — the one direction
// that is never safe to be wrong in. It is EXCLUDED from `net`, and counted
// in `missingPrice`, so the screen can say "N items have no price, not
// included: the total is lower than the real one".
//
// ⚠️ A LINE WITH A PRICE BUT NO VAT RATE STILL ADDS TO `net`. The net price
// is known; only the VAT on it is not, so it is counted in `missingVat`
// rather than silently taxed at 0% — a rate that exists and genuinely is
// zero (UK zero-rated bread) must read exactly the same as a stated one.
export function orderCost(lines: Iterable<Maybe<OrderCostLine>> | null | undefined): OrderCostResult {
  let net = 0;
  const vatByRate: Record<string, number> = {};
  let missingPrice = 0;
  let missingVat = 0;
  // Lines that DID get a price — so a screen can tell «nothing is priced» (say so,
  // print no total) from «everything priced comes to 0» (which cannot happen, but
  // must never be the way the first case looks).
  let costed = 0;

  for (const line of lines || []) {
    const qty = Number(line && line.qty);
    // Nothing ordered is not a line to cost at all — the same rule
    // order-text.js's own num() applies to a quantity.
    if (!Number.isFinite(qty) || qty <= 0) continue;

    const uc = line && line.unitCost;
    if (uc === null || uc === undefined || !Number.isFinite(Number(uc))) {
      missingPrice += 1;
      continue;
    }

    const lineNet = qty * Number(uc);
    net += lineNet;
    costed += 1;

    const vatRate = line && line.vatRate;
    if (vatRate === null || vatRate === undefined || !Number.isFinite(Number(vatRate))) {
      missingVat += 1;
      continue;
    }

    const rate = Number(vatRate);
    vatByRate[rate] = (vatByRate[rate] || 0) + (lineNet * rate) / 100;
  }

  const vatTotal = Object.values(vatByRate).reduce((sum, v) => sum + v, 0);
  return { net, vatByRate, gross: net + vatTotal, missingPrice, missingVat, costed };
}
