// records.ts — what the RECORDS (suppliers, and the things bought from them) share across sections.
//
// TypeScript FULL port of js/records.js for Mise 2. Behaviour is identical, input for input; records.spec.ts runs
// every test against BOTH files and parity.spec.ts pairs them.
//
// The records are kept on «Ingredients & suppliers». Since 13 Sep 2026 a recipe row in the Recipe catalogue can add
// a missing ingredient too (step 3e, T15) — Federico: «se non c'è in anagrafica fammelo inserire direttamente dalla
// ricerca degli ingredienti». The answer both sections must give identically lives here.

import { isSectionAllowed } from './sections';
import { cardVisibleTo } from './home-cards';

// The pseudo-supplier «no supplier» — the supermarket, the cash & carry. Its id is STORED on an ingredient, so every
// screen that files one must use the same string.
export const NO_SUPPLIER_ID = 'no-supplier';

// May this person add a supplier or an ingredient in this venue?
//
// ⚠️ THE SAME QUESTION THE «Ingredients & suppliers» GATE ASKS: its section AND its card. The section is also what the
// rules ask before a supplier or an ingredient is written (canUse(lid, 'orders')), so a door that answered «yes» here
// where the section says «no» would open a form whose Save the database refuses — or reopen, from the Recipe
// catalogue, a screen the venue has hidden from its employees.
//
// ⚠️ NO VENUE, NO. Before the session has opened a venue there is nothing to judge by.
export function mayEditRecords(locationDoc: unknown, canManage: unknown): boolean {
  if (!locationDoc || typeof locationDoc !== 'object') return false;
  return isSectionAllowed(locationDoc, 'orders')
    && cardVisibleTo(locationDoc, canManage === true, 'suppliers');
}
