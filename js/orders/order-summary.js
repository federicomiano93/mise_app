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

import { orderedItems, summaryLines } from './order-text.js';

// supplier: { id, name } | null; ingredients: that supplier's products,
// already lensed the way orderIngredients()/ingredientsBySupplier() in
// orders-main.js produce them; entries: state.entries ({ id: { qty, stock } }).
// -> { name, lines: [{ label, qty }] }
export function supplierSummary(supplier, ingredients, entries) {
  return { name: supplier?.name || '', lines: summaryLines(orderedItems(ingredients, entries)) };
}
