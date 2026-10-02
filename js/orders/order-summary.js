// order-summary.js — PURE: what one supplier's tablet summary sheet shows.
//
// ⚠️⚠️ THE SAME SELECTION, THE SAME LINES, AS THE WHATSAPP MESSAGE. This calls
// order-text.js's orderedItems() — the exact selection buildSendScreen
// (preview.js) calls too — and builds its lines through order-text.js's own
// summaryLines(), the same function sectionFor() uses to build the message
// itself. Two independent implementations of "what does this supplier's order
// look like" would be two places they could quietly disagree; a summary that
// showed one number while the message that actually reaches the supplier said
// another would be worse than no summary at all.
//
// ⚠️ MONEY NEVER REACHES order-text.js (29 Sep 2026). The amount is computed
// HERE, alongside the lines, and never folded into buildOrderMessage's output
// — see tests/order-cost-message.test.mjs, which pins that adding a price to
// an ingredient cannot change one byte of what a supplier receives.

import { orderedItems, summaryLines, itemLabel } from './order-text.js';
import { supplierLabel } from '../supplier-label.js';
import { ingredientDisplayName } from '../ingredient-name.js';
import { lineUnitCost, orderCost } from '../order-cost.js';
import { entryUnit } from '../order-unit.js';

// supplier: { id, name } | null; ingredients: that supplier's products,
// already lensed the way orderIngredients()/ingredientsBySupplier() in
// orders-main.js produce them — AFTER js/price-model.js's withPrices(), so an
// ingredient this account may read the price of already carries priceUnit/
// pricePerUnit/vatRate; one an employee may not simply has none, and its cost
// comes back null the same way an ingredient nobody has priced yet always has.
// entries: state.entries ({ id: { qty, stock } }).
// -> { name, lines: [{ label, qty }], costLines: [{ label, qty, unitCost,
//      vatRate }], totals: orderCost()'s own shape }
export function supplierSummary(supplier, ingredients, entries) {
  const items = orderedItems(ingredients, entries);
  const lines = summaryLines(items);

  // ⚠️ MATCHED BY LABEL, THE SAME KEY summaryLines() itself sorts by. Not
  // matched by id: `lines` deliberately carries no id (see order-text.js),
  // because it is built to be identical to the message's own text, which
  // knows nothing of ids either. Two DIFFERENT ingredients from the same
  // supplier with an identical name AND weight would collide here — the
  // same edge case the message itself already cannot tell apart.
  //
  // ⚠️ THE UNIT PRICES THE LINE — a busta costs a quarter of the cartone — so the line's
  // own unit (from the draft entry, found by the same ingredient) is what is priced,
  // and it travels on the cost line for the screens that show it.
  const byLabel = new Map();
  (ingredients || []).forEach(ing => {
    if ((entries?.[ing.id]?.qty || 0) <= 0) return;
    byLabel.set(itemLabel(ing.name, ing.weight || ''), ing);
  });

  const costLines = lines.map(({ label, qty, unit }) => {
    const ing = byLabel.get(label);
    // The price of ONE of THIS line's unit; lineUnitCost() says «no price» rather than guess
    // when the chosen unit cannot be priced from the card.
    // ⚠️ `lines` above stay the message's own text (the invoice name); the sheet SHOWS the name to
    // show, found through the same ingredient (the match key is still the message's label).
    return {
      label: ing ? itemLabel(ingredientDisplayName(ing), ing.weight || '') : label,
      qty,
      ...(unit ? { unit } : {}),
      unitCost: ing ? lineUnitCost(ing, ing, entryUnit(entries?.[ing.id], ing)) : null,
      vatRate: ing && ing.vatRate != null ? Number(ing.vatRate) : null,
    };
  });

  return { name: supplierLabel(supplier), lines, costLines, totals: orderCost(costLines) };
}
