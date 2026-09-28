// order-summary.js — PURE: what one supplier's tablet summary sheet shows.
//
// ⚠️⚠️ THE SAME SELECTION, THE SAME LINES, AS THE WHATSAPP MESSAGE. This reads
// entries with exactly the rule buildSendScreen (preview.js) uses — qty > 0 —
// and builds its lines through order-text.js's summaryLines(), the same
// function sectionFor() uses to build the message itself. Two independent
// implementations of "what does this supplier's order look like" would be two
// places they could quietly disagree; a summary that showed one number while
// the message that actually reaches the supplier said another would be worse
// than no summary at all.

import { summaryLines } from './order-text.js';

// supplier: { id, name } | null; ingredients: that supplier's products,
// already lensed the way orderIngredients()/ingredientsBySupplier() in
// orders-main.js produce them; entries: state.entries ({ id: { qty, stock } }).
// -> { name, lines: [{ label, qty }] }
export function supplierSummary(supplier, ingredients, entries) {
  const items = (ingredients || [])
    .filter(ing => (entries?.[ing.id]?.qty || 0) > 0)
    .map(ing => ({ name: ing.name, weight: ing.weight || '', qty: entries[ing.id].qty }));

  return { name: supplier?.name || '', lines: summaryLines(items) };
}
