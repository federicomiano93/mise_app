// ingredient-origin.js — did this ingredient (or packaging) come from an invoice?
//
// ⚠️ THE SAME RULE AS MISE 2 (app/src/suppliers/invoiceTag.ts, commit 75175715): only the
// invoice import and the merge write these three keys, so any of them being filled in means the
// record came from an invoice. Anything else was typed in by hand, and the lists mark it with a
// pencil. A blank or whitespace-only value counts as absent: a merge write clears a field by
// sending '', never by omitting it.
//
// Pure, no imports: shared by the registry screen and its tests.

const filled = (value) => typeof value === 'string' && value.trim() !== '';

export function fromInvoice(item) {
  if (!item) return false;
  return filled(item.supplierCode)
    || (Array.isArray(item.supplierCodes) && item.supplierCodes.some(filled))
    || filled(item.invoiceName);
}
