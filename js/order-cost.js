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
export function unitCost(ingredient, price) {
  if (!price || !isPriceUnit(price.priceUnit)) return null;
  const rate = positiveNumber(price.pricePerUnit);
  if (rate === null) return null;

  if (price.priceUnit === 'pcs') return rate;

  // 'kg' | 'l' — the two units parsePackSize already answers in kilos, and
  // js/price-model.js already treats 1 litre as 1 kilo the same way.
  const packKg = parsePackSize(ingredient && ingredient.weight);
  if (packKg === null) return null;
  return rate * packKg;
}

// The whole order's cost from its LINES — one entry per ingredient actually
// being ordered (qty > 0), each already carrying its own unitCost() and
// vatRate (or null/undefined for "not stated").
//
// line: { qty, unitCost: number|null, vatRate: number|null|undefined }
// -> { net, vatByRate: { [rate]: amount }, gross, missingPrice, missingVat }
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

    const vatRate = line && line.vatRate;
    if (vatRate === null || vatRate === undefined || !Number.isFinite(Number(vatRate))) {
      missingVat += 1;
      continue;
    }

    const rate = Number(vatRate);
    vatByRate[rate] = (vatByRate[rate] || 0) + (lineNet * rate) / 100;
  }

  const vatTotal = Object.values(vatByRate).reduce((sum, v) => sum + v, 0);
  return { net, vatByRate, gross: net + vatTotal, missingPrice, missingVat };
}
