// order-cost.js — what an order costs, net and with VAT. PURE (P15): no DOM,
// no Firestore, so every rule below is asserted under Node rather than read
// back out of a rendered screen.
//
// ⚠️⚠️ MONEY IS SHOWN ONLY TO PEOPLE WHO CAN READ PRICES. This file computes
// numbers; the caller (js/orders/orders-main.js) draws them only once the
// ingredient-prices read actually SUCCEEDED (state.pricesReadable) — the rules
// refuse it to an employee not shown Food cost. Nothing here enforces that; it
// cannot, being pure.
//
// ⚠️ THE PRICE STAYS NET, EXACTLY AS FOOD COST ALREADY INSISTS ON
// (js/foodcost/foodcost-model.js): what is stored on ingredient-prices is
// the price WITHOUT VAT, and the VAT is added on top here, once, for
// DISPLAY. Nothing here ever writes back to a price.

import { isPriceUnit, positiveNumber, storedCaseOf, packWeightOf, packBaseOf } from './price-model.js';
import { parsePackSize } from './pack-size.js';
import { cleanUnit, sameUnit } from './order-unit.js';

// The net cost of ONE ORDERED UNIT of an ingredient — one sack, one case, one
// piece, whatever the order screen's own quantity box counts.
//
// A price «by piece» is the price of ONE UNIT BOUGHT — the same thing the stocktake
// counts (js/inventory/inventory-value.js: «its rate already is per one of them») —
// so it is the price of one ordered unit, whatever that unit is called. The rules
// that decide the rest are listed under «ONLY WHEN THE ORDER UNIT LEAVES NO DOUBT».
//
// ⚠️ NEVER ROUNDED HERE. A rounded unit cost multiplied by a large quantity
// drifts from the true total by more than a rounding error should; round
// only the number actually shown, with formatMoney (js/price-model.js).
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
const WEIGHT_UNITS = Object.freeze({
  kg: 1, kgs: 1, kilo: 1, kilos: 1, kili: 1, chilo: 1, chili: 1, chilogrammi: 1,
  g: 0.001, gr: 0.001, grammi: 0.001, grams: 0.001,
  l: 1, lt: 1, litro: 1, litri: 1, litre: 1, litres: 1, liter: 1, liters: 1,
  ml: 0.001, cl: 0.01,
});
const MULTIPLIER = /\d\s*[x×*]\s*\d/i;
// The order-unit words that mean «one item of the case» — ordering «50 pz» from a case price
// means fifty items, each costing the case price divided by what the case holds.
const PIECE_UNITS = new Set([
  'pz', 'pezzo', 'pezzi', 'pcs', 'pc', 'piece', 'pieces', 'each',
]);
// The words that mean «one whole case» — the counted thing IS the case that was priced.
const CASE_UNITS = new Set([
  'cartone', 'cartoni', 'cassa', 'casse', 'collo', 'colli', 'confezione', 'confezioni',
  'scatola', 'scatole', 'box', 'case', 'cases', 'carton', 'crate', 'pack',
]);

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
// tests/readers-regression-grid.test.mjs runs a frozen copy of it against this over every stored
// shape. Exactly TWO shapes read differently from before (2nd review, 1 Oct 2026), both named in the
// grid: the package word on a case of PIECES (one item — what «Singola after Cartone» leaves behind),
// and a weight word on a per-piece price that remembers one piece's weight. A weight that is unreadable or a multiplier («6x1kg», «sacco») also keeps today's
// whole-unit reading and is NOT multiplied by packCount — that was the ×6-twice defect.

// A packCount as the rules store it: a whole number ≥ 1. Anything else (a string, 0, 2.5) is none.
export function validPackCount(ingredient) {
  const count = ingredient && ingredient.packCount;
  return Number.isInteger(count) && count >= 1 ? count : null;
}

// How many items ONE ordered unit of this card holds: packCount for the carton, 1 for the package word
// or a piece word. null for an item with no packCount.
export function itemsPerOrderedUnit(ingredient) {
  const count = validPackCount(ingredient);
  if (count === null) return null;
  const unit = cleanUnit(ingredient.unit).toLowerCase().replace(/\.$/, '');
  const pack = cleanUnit(ingredient.packUnit).toLowerCase().replace(/\.$/, '');
  if ((pack !== '' && unit === pack) || PIECE_UNITS.has(unit)) return 1;
  return count;
}

// The net cost of ONE item, from the stored price and the card's weight; null when that cannot be
// known (a per-kilo rate with no simple weight, or a pieces price on a multiplier text).
export function costPerItem(ingredient, price) {
  const wholeCase = storedCaseOf(price);
  if (wholeCase) return wholeCase.casePrice / wholeCase.caseCount;
  const rate = positiveNumber(price && price.pricePerUnit);
  if (rate === null || !isPriceUnit(price.priceUnit)) return null;
  const packText = String((ingredient && ingredient.weight) || '');
  if (price.priceUnit === 'pcs') return MULTIPLIER.test(packText) ? null : rate;
  const base = packBaseOf(packText);
  return base ? rate * base.size : null;
}

export function unitCost(ingredient, price) {
  const items = itemsPerOrderedUnit(ingredient);
  if (items === null) return legacyUnitCost(ingredient, price);
  if (!price || !isPriceUnit(price.priceUnit) || positiveNumber(price.pricePerUnit) === null) return null;
  const orderUnit = String((ingredient && ingredient.unit) || '').trim().toLowerCase().replace(/\.$/, '');
  // Ordered by weight, the quantity IS kilos or litres: that was never about the case.
  if (Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, orderUnit)) return legacyUnitCost(ingredient, price);
  const each = costPerItem(ingredient, price);
  return each === null ? legacyUnitCost(ingredient, price) : each * items;
}

// A per-piece price read by WEIGHT: what one kilo costs is the piece's price ÷ one piece's weight, so a
// line of `kilos` kilos costs that × kilos. null while nobody said what a piece weighs.
function viaPieceWeight(price, rate, kilos) {
  const pieceKg = positiveNumber(price.unitWeightKg);
  return pieceKg === null ? null : (rate / pieceKg) * kilos;
}

function legacyUnitCost(ingredient, price) {
  if (!price || !isPriceUnit(price.priceUnit)) return null;
  const rate = positiveNumber(price.pricePerUnit);
  if (rate === null) return null;

  const orderUnit = String((ingredient && ingredient.unit) || '').trim().toLowerCase().replace(/\.$/, '');
  const byWeight = Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, orderUnit);

  const wholeCase = storedCaseOf(price);
  if (wholeCase) {
    if (byWeight) {
      return price.priceUnit === 'pcs' ? viaPieceWeight(price, rate, WEIGHT_UNITS[orderUnit]) : rate * WEIGHT_UNITS[orderUnit];
    }
    // ⚠️ THE PACKAGE WORD MEANS «ONE ITEM» for a case of PACKAGES ('pack') and — since the 2nd review of
    // 1 Oct 2026 — for a case of PIECES too, and it is asked BEFORE the case words: a package
    // declared «scatola» and ordered by «scatola» is one package, not the case. The pieces case is
    // what a Singola leaves behind when an employee (no price section) turns a Cartone into one: its
    // unit becomes the package word, and one of those is casePrice ÷ caseCount. (Before, such a line
    // had no price at all.) An explicit-size case (4 × 2.5 kg) still says nothing.
    const packWord = String((ingredient && ingredient.packUnit) || '').trim().toLowerCase().replace(/\.$/, '');
    const isPackCase = wholeCase.caseItemUnit === 'pack' || wholeCase.caseItemUnit === 'pcs';
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
  const packText = String((ingredient && ingredient.weight) || '');

  if (price.priceUnit === 'pcs') {
    if (byWeight) return viaPieceWeight(price, rate, WEIGHT_UNITS[orderUnit]);
    if (MULTIPLIER.test(packText)) return null;
    return rate;
  }

  // 'kg' | 'l' — js/price-model.js already treats 1 litre as 1 kilo the same way.
  if (byWeight) return rate * WEIGHT_UNITS[orderUnit];
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
export function lineUnitCost(ingredient, price, unit) {
  const chosen = cleanUnit(unit);
  if (chosen === '' || sameUnit(chosen, ingredient && ingredient.unit)) return unitCost(ingredient, price);
  const wholeCase = storedCaseOf(price);
  if (validPackCount(ingredient) !== null) {
    // A carton card: its package word is ONE item, whatever the stored case held.
    if (!sameUnit(chosen, ingredient.packUnit)) return null;
    return unitCost({ ...ingredient, unit: chosen }, price);
  }
  if (!wholeCase || wholeCase.caseItemUnit !== 'pack' || !(wholeCase.caseCount > 0)) return null;
  if (!sameUnit(chosen, ingredient && ingredient.packUnit)) return null;
  return unitCost({ ...ingredient, unit: chosen }, price);
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
export function orderCost(lines) {
  let net = 0;
  const vatByRate = {};
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
