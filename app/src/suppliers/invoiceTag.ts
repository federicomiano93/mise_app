// invoiceTag.ts — which rows of the Ingredients and Suppliers lists carry the small «From invoice» tag (Federico's decision of
// 21 Oct 2026; Mise 2 only). DERIVED FROM WHAT THE ITEMS ALREADY HOLD: no origin field is written and nothing in production is
// back-filled.
//
// ⚠️ ONLY THE INVOICE IMPORT WRITES THESE THREE KEYS (and the merge tool, which carries them over): neither app's card lets a person
// type an article code or an invoice description (ingredientCardModel.ts `buildSave` never sends them). So an item that holds one
// was made or linked by an import:
//   • `supplierCode` — the supplier's article code of the pack (written when an import creates the item, or links an item that
//     had none);
//   • `supplierCodes` — the other packs' codes of the same item;
//   • `invoiceName` — the description as on the invoice.
// A hand-made item later matched by an import learns a code or the invoice name from it, and so gets the tag (told to him).
// ⚠️ NO EXTRA READ: the lists already hold these keys (the store keeps every key but the price ones). The invoice price points
// (`ingredients/{id}/prices`) would say it too, but reading them would cost one read per item.
// A supplier carries the tag when at least one of its items does.

import type { StoredDoc } from './suppliersSource';

const filled = (value: unknown): boolean => typeof value === 'string' && value.trim() !== '';

export function fromInvoice(item: Readonly<Record<string, unknown>>): boolean {
  return filled(item.supplierCode)
    || (Array.isArray(item.supplierCodes) && item.supplierCodes.some(filled))
    || filled(item.invoiceName);
}

// The ids of the suppliers with at least one item from an invoice.
export function suppliersFromInvoices(items: readonly StoredDoc[]): Set<string> {
  const ids = new Set<string>();
  items.forEach(item => {
    if (typeof item.supplierId === 'string' && item.supplierId !== '' && fromInvoice(item)) ids.add(item.supplierId);
  });
  return ids;
}
