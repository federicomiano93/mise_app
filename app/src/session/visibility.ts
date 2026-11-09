import { isSectionAllowed } from '@mise/shared/sections';
import type { SectionName } from '@mise/shared/sections';
import { cardVisibleTo, isHiddenForStaff } from '@mise/shared/home-cards';
import type { CardId } from '@mise/shared/home-cards';
import type { SectionId } from '../shell/sections';
import type { DocData } from './backend';

// Which of Mise 2's sections a person is shown in this venue.
//
// ⚠️ UX ONLY, NEVER A PERMISSION (P2). Hiding a section here only keeps somebody from landing
// on a screen that would fill with "permission denied"; every read and write is judged by
// firestore.rules on the server. A person who types the address by hand gets «not available»,
// and if they got past that the rules would still refuse the data.
//
// The rule is the current app's page gate (js/auth-gate.js, the `ready` case), question for
// question: a page is open when the VENUE bought its section AND the card that leads to it is
// shown to THIS person. They are two questions on purpose — Suppliers and Orders share the
// section `orders` but are separate cards, so a venue can hide one from its employees and not
// the other; and Food cost and Stocktake share `foodcost`, each its own card, both hidden from
// employees until the venue shows them (shared/src/home-cards.ts).
const GATES: ReadonlyArray<{ id: SectionId; section: SectionName; card: CardId }> = [
  { id: 'orders', section: 'orders', card: 'orders' },
  { id: 'suppliers', section: 'orders', card: 'suppliers' },
  { id: 'recipes', section: 'catalogue', card: 'catalogue' },
  { id: 'calculator', section: 'calculator', card: 'calculator' },
  { id: 'pastries', section: 'pastries', card: 'pastries' },
  { id: 'stocktake', section: 'foodcost', card: 'inventory' },
  { id: 'foodcost', section: 'foodcost', card: 'foodcost' },
];

// `location` is the venue's own document (null while it has none: the shared rules then default
// to everything on). `canManage` is the session's: true for an owner, a manager and the two partial
// owners. `role` is the session's too, and it is NOT optional in practice: a partial owner is told
// apart from the others by it alone, and a call without it would show the sales owner the kitchen
// (tests/partial-owner-roles.test.mjs walks every caller of cardVisibleTo).
//
// Home (the venue's to-do list, step 3g-1) is always visible too: every member of the venue may read and write it
// (firestore.rules, `todos`), and it is where the app opens.
//
// Settings is always visible: it holds the person's own account and the way to sign out, and a
// screen with nothing in it must never be the end of the road.
export function visibleSectionIds(location: DocData | null, canManage: boolean, role: unknown): ReadonlySet<SectionId> {
  const visible = new Set<SectionId>(['home', 'settings']);
  for (const gate of GATES) {
    if (isSectionAllowed(location, gate.section) && cardVisibleTo(location, canManage, gate.card, role)) {
      visible.add(gate.id);
    }
  }
  return visible;
}

// May this person read what the business PAYS for its ingredients — the purchase prices the Orders summary
// and the supplier screens total? The rules' cardAccess(lid, 'foodcost', 'prices'): the venue has Food
// cost, and the person either runs a side (canManage: an owner, a manager, the kitchen owner who orders
// the goods) or the venue shows Food cost to its employees. ⚠️ By the VENUE's section and card, never by
// the role's cards: the kitchen owner has no Food cost card and still reads the prices, as the rules say.
export function readsPurchasePrices(location: DocData | null, canManage: boolean): boolean {
  return isSectionAllowed(location, 'foodcost') && (canManage || !isHiddenForStaff(location, 'foodcost'));
}
