// records.js — what the RECORDS (suppliers, and the things bought from them) share across
// features. PURE.
//
// The records are kept on «Fornitori e ingredienti», a page of the Orders feature. Since
// 13 Sep 2026 a recipe row in the Catalogue can add a missing ingredient too — Federico:
// «se non c'è in anagrafica fammelo inserire direttamente dalla ricerca degli ingredienti».
// A feature may not import another feature's folder, so the two answers both sides must
// give identically live here.

import { isSectionAllowed } from './sections.js';
import { cardVisibleTo } from './home-cards.js';

// The pseudo-supplier «no supplier» — the supermarket, the cash & carry. Its id is STORED on
// an ingredient, so every screen that files one must use the same string.
// js/orders/no-supplier.js builds the rest of that pseudo-supplier around it.
export const NO_SUPPLIER_ID = 'no-supplier';

// May this person add a supplier or an ingredient in this venue?
//
// ⚠️ THE SAME QUESTION js/auth-gate.js ASKS before it lets anybody stay on suppliers.html:
// its section AND its card. The section is also what the rules ask before a supplier or an
// ingredient is written (canUse(lid, 'orders')), so a door that answered «yes» here where
// the page says «no» would open a form whose Save the database refuses — or reopen, from
// the Catalogue, a screen the venue has hidden from its employees.
//
// ⚠️ NO VENUE, NO. Before the session has opened a venue there is nothing to judge by.
export function mayEditRecords(locationDoc, canManage) {
  if (!locationDoc || typeof locationDoc !== 'object') return false;
  return isSectionAllowed(locationDoc, 'orders')
    && cardVisibleTo(locationDoc, canManage === true, 'suppliers');
}
