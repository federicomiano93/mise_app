import { supplierLabel } from '@mise/shared/supplier-label';
import type { StoredDoc } from './foodcostSource';

// Whom an ingredient is bought from, as the screen shows it (POST-SWITCH, step 4 of the Food cost plan, 11 Nov 2026: «quando
// scegli un ingrediente deve dirti il fornitore»). '' when there is nothing to say, and the screen then draws nothing at all —
// no dash, no empty line.
//
// ⚠️ ONE SUPPLIER PER INGREDIENT, ITS OWN `supplierId`: that is the whole link in the data model (the ingredient card writes it,
// Orders files the ingredient under it, the Recipe catalogue's link chooser names it the same way, recipes/linkModel.ts). An
// order line sent elsewhere «for this order only» is Orders' business and never moves the ingredient.
// ⚠️ THE NAME THROUGH supplierLabel() ONLY: the short name when there is one, else the legal name — never `supplier.name`.
// '' as well for:
//   • no `supplierId`, and the pseudo-supplier «no supplier» (NO_SUPPLIER_ID: never a document, so never found);
//   • a supplier not (yet) heard of — still loading, offline with no copy, refused, deleted — the line simply waits for it;
//   • an id that only an object's own machinery answers to (`constructor`, `__proto__`): looked up as an OWN key.
// A supplier switched off («not in use») is still the one the ingredient is bought from, so it is still named, as the
// Recipe catalogue does.
export function supplierOf(ingredient: unknown, suppliers: Readonly<Record<string, StoredDoc>>): string {
  const id = (ingredient as { supplierId?: unknown } | null | undefined)?.supplierId;
  if (typeof id !== 'string' || id === '') return '';
  if (!Object.prototype.hasOwnProperty.call(suppliers, id)) return '';
  return supplierLabel(suppliers[id]).trim();
}
