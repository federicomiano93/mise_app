// order-summary.ts — PURE: what one supplier's tablet summary sheet shows.
//
// TypeScript port of js/orders/order-summary.js for Mise 2. Behaviour is identical, input for input:
// order-summary.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
// The comments below are the ones the original paid for in bugs.
//
// ⚠️⚠️ THE SAME SELECTION, THE SAME LINES, AS THE WHATSAPP MESSAGE. This calls
// order-text's orderedItems() — the exact selection the send screen calls too — and builds
// its lines through order-text's own summaryLines(), the same function the message itself
// is built from. Two independent implementations of "what does this supplier's order
// look like" would be two places they could quietly disagree; a summary that
// showed one number while the message that actually reaches the supplier said
// another would be worse than no summary at all.
//
// ⚠️ MONEY NEVER REACHES order-text (29 Sep 2026). The amount is computed
// HERE, alongside the lines, and never folded into buildOrderMessage's output:
// adding a price to an ingredient cannot change one byte of what a supplier receives.

import { orderedItems, summaryLines, itemLabel } from './order-text';
import { supplierLabel } from './supplier-label';
import { ingredientDisplayName } from './ingredient-name';
import { lineUnitCost, orderCost, type OrderCostResult } from './order-cost';
import { entryUnit } from './order-unit';

export interface SummaryLine { label: string; qty: number; unit?: string }

export interface SummaryCostLine {
  label: string;
  qty: number;
  unit?: string;
  unitCost: number | null;
  vatRate: number | null;
}

export interface SupplierSummary {
  name: string;
  lines: SummaryLine[];
  costLines: SummaryCostLine[];
  totals: OrderCostResult;
}

interface Ing { id: string; name?: unknown; weight?: unknown; vatRate?: unknown }

// supplier: { id, name } | null; ingredients: that supplier's products,
// already lensed the way the Orders screen produces them — AFTER price-model's withPrices(), so an
// ingredient this account may read the price of already carries priceUnit/
// pricePerUnit/vatRate; one an employee may not simply has none, and its cost
// comes back null the same way an ingredient nobody has priced yet always has.
// entries: the draft ({ id: { qty, stock } }).
export function supplierSummary(supplier?: unknown, ingredients?: readonly unknown[] | null, entries?: unknown): SupplierSummary {
  const byId = entries as Record<string, unknown> | null | undefined;
  const items = orderedItems(ingredients, entries);
  const lines = summaryLines(items);

  // ⚠️ MATCHED BY LABEL, THE SAME KEY summaryLines() itself sorts by. Not
  // matched by id: `lines` deliberately carries no id (see order-text),
  // because it is built to be identical to the message's own text, which
  // knows nothing of ids either. Two DIFFERENT ingredients from the same
  // supplier with an identical name AND weight would collide here — the
  // same edge case the message itself already cannot tell apart.
  //
  // ⚠️ THE UNIT PRICES THE LINE — a busta costs a quarter of the cartone — so the line's
  // own unit (from the draft entry, found by the same ingredient) is what is priced,
  // and it travels on the cost line for the screens that show it.
  const byLabel = new Map<string, Ing>();
  (ingredients || []).forEach(raw => {
    const ing = raw as Ing;
    if (((byId?.[ing.id] as { qty?: number } | undefined)?.qty || 0) <= 0) return;
    byLabel.set(itemLabel(ing.name, ing.weight || ''), ing);
  });

  const costLines = lines.map(({ label, qty, unit }): SummaryCostLine => {
    const ing = byLabel.get(label);
    // The price of ONE of THIS line's unit; lineUnitCost() says «no price» rather than guess
    // when the chosen unit cannot be priced from the card.
    // ⚠️ `lines` above stay the message's own text (the invoice name); the sheet SHOWS the name to
    // show, found through the same ingredient (the match key is still the message's label).
    return {
      label: ing ? itemLabel(ingredientDisplayName(ing), ing.weight || '') : label,
      qty,
      ...(unit ? { unit } : {}),
      unitCost: ing ? lineUnitCost(ing, ing, entryUnit(byId?.[ing.id], ing)) : null,
      vatRate: ing && ing.vatRate != null ? Number(ing.vatRate) : null,
    };
  });

  return { name: supplierLabel(supplier), lines, costLines, totals: orderCost(costLines) };
}
