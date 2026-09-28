// order-cost.js — what an order costs, net and with VAT. PURE (P15): no DOM,
// no Firestore, so every rule below is asserted under Node rather than read
// back out of a rendered screen.
//
// ⚠️⚠️ MONEY IS SHOWN ONLY TO PEOPLE WHO CAN READ PRICES. This file computes
// numbers; the caller (js/orders/orders-main.js) decides whether to draw them
// at all, gated the same way foodcost-settings.js already gates the rate per
// hour — an employee shown Orders must never learn what a sack of flour
// costs. Nothing here enforces that; it cannot, being pure.
//
// ⚠️ THE PRICE STAYS NET, EXACTLY AS FOOD COST ALREADY INSISTS ON
// (js/foodcost/foodcost-model.js): what is stored on ingredient-prices is
// the price WITHOUT VAT, and the VAT is added on top here, once, for
// DISPLAY. Nothing here ever writes back to a price.

import { isPriceUnit, positiveNumber } from './price-model.js';
import { parsePackSize } from './pack-size.js';

// The net cost of ONE ORDERED UNIT of an ingredient — one sack, one case, one
// piece, whatever the order screen's own quantity box counts.
//
//   priceUnit 'pcs'        → pricePerUnit itself: one ordered unit IS one
//                            priced piece, no conversion needed.
//   priceUnit 'kg' | 'l'   → pricePerUnit × the pack's weight in kilos, read
//                            from the ingredient's own `weight` free text
//                            (js/pack-size.js parsePackSize) — the same
//                            reading the stocktake already relies on. A pack
//                            size that cannot be read (parsePackSize -> null)
//                            means this cannot either: null, never a guess.
//   no usable price at all → null.
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
//   pcs price on a «6x1kg» case, or a weight   → null (which one is priced?)
//   unit and a pcs price
const WEIGHT_UNITS = Object.freeze({ kg: 1, g: 0.001, l: 1, lt: 1, ml: 0.001, cl: 0.01 });
const MULTIPLIER = /\d\s*[x×*]\s*\d/i;

export function unitCost(ingredient, price) {
  if (!price || !isPriceUnit(price.priceUnit)) return null;
  const rate = positiveNumber(price.pricePerUnit);
  if (rate === null) return null;

  const orderUnit = String((ingredient && ingredient.unit) || '').trim().toLowerCase();
  const byWeight = Object.prototype.hasOwnProperty.call(WEIGHT_UNITS, orderUnit);
  const packText = String((ingredient && ingredient.weight) || '');

  if (price.priceUnit === 'pcs') {
    if (byWeight || MULTIPLIER.test(packText)) return null;
    return rate;
  }

  // 'kg' | 'l' — js/price-model.js already treats 1 litre as 1 kilo the same way.
  if (byWeight) return rate * WEIGHT_UNITS[orderUnit];
  const packKg = parsePackSize(packText);
  if (packKg === null) return null;
  return rate * packKg;
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
