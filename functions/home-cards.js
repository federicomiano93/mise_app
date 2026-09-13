// home-cards.js — which Home cards a venue shows to its ordinary employees.
//
// Federico, 13 Sep 2026: «possiamo creare una schermata dove il proprietario, headchef
// e manager decidono le schede che si possono vedere senza passare da firebase?» —
// and, asked what hiding should mean, he chose: ONLY HIDE, and ONLY FOR EMPLOYEES.
// Then: «se le nascondo i dipendenti non ricevono le notifiche perche' vuol dire che
// non voglio che usino quella scheda» — so a hidden card is silent for them too.
//
// PURE, AND ZERO IMPORTS ON PURPOSE. The Home asks it (which cards to draw),
// js/auth-gate.js asks it on every page (whether to send an employee back), the
// settings screen asks it (what each switch shows) — and THE SERVER asks it, through
// functions/home-cards.js, a byte-for-byte copy pinned by tests/copie-allineate.test.mjs,
// to decide whether an employee's phone may be buzzed about a card. Zero imports is
// what lets the copy BE a copy.
//
// ⚠️⚠️ NOT AN ACCESS SWITCH. Hiding a card changes no permission, no rule and no data:
// the section stays on and the database still answers. What decides ACCESS is
// `sections` (which parts the venue has) and the role (js/sections.js ROLE_ONLY); this
// is a third layer on top of both, and it can only ever take a card AWAY — from the
// Home, from the address bar, and from the employee's notifications. It can never show
// a card either of those hides — a venue without Pastries gets no Pastries switch.
//
// ⚠️ OWNERS, MANAGERS AND HEAD CHEFS ALWAYS SEE EVERY CARD. That was his choice, and it
// is also what keeps the switch safe to use: the person who hid a card can never lose
// the way back to it, because the screen that shows it again is on their own Home.
//
// ⚠️ THE DEFAULT IS VISIBLE, and only a literal `true` hides. A venue that has never
// heard of the field, a document that failed to load and a corrupt value all show
// every card — the same direction as `sections`, for the same reason: a cosmetic
// switch must never empty a working Home.

// The cards an employee can be shown at all, in Home order. Food cost and Stocktake
// are absent on purpose: an employee never sees them (ROLE_ONLY), so there is nothing
// to hide.
//
// ⚠️ `id` IS NOT THE SECTION. Suppliers & ingredients shares the `orders` section, and
// hiding one of the two must not hide the other.
//
// `employeePush`: whether an EMPLOYEE can be notified about something that opens this
// card's page, so that hiding it has notifications to silence. The Calculator receives
// a client's order and the Catalogue a timer; an order list goes only to whoever runs
// the place (functions/index.js managersAmong), so Orders has nothing to silence. The
// hiding dialog uses it to say so, and a test ties it to js/push-model.js cardForKind.
export const STAFF_CARDS = Object.freeze([
  Object.freeze({ id: 'calculator', section: 'calculator', labelKey: 'section.calculator', employeePush: true }),
  Object.freeze({ id: 'catalogue', section: 'catalogue', labelKey: 'section.catalogue', employeePush: true }),
  Object.freeze({ id: 'orders', section: 'orders', labelKey: 'section.orders', employeePush: false }),
  Object.freeze({ id: 'suppliers', section: 'orders', labelKey: 'section.suppliersAndIngredients', employeePush: false }),
  Object.freeze({ id: 'pastries', section: 'pastries', labelKey: 'section.pastries', employeePush: false }),
]);

export const HIDEABLE_IDS = Object.freeze(STAFF_CARDS.map(card => card.id));

// The field on locations/{lid}: `{ <cardId>: true }` for every card hidden from staff.
export const HIDDEN_FIELD = 'staffHiddenCards';

// Has this venue hidden this card from its employees?
export function isHiddenForStaff(locationDoc, cardId) {
  if (!HIDEABLE_IDS.includes(cardId)) return false;
  const map = locationDoc && typeof locationDoc === 'object' ? locationDoc[HIDDEN_FIELD] : null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.prototype.hasOwnProperty.call(map, cardId) && map[cardId] === true;
}

// Is this card shown to this person? `canManage` is the session's — true for an owner
// and for a manager, which includes a head chef.
//
// A card with no id (Food cost, Stocktake) is never hidden by this layer.
export function cardVisibleTo(locationDoc, canManage, cardId) {
  if (canManage === true) return true;
  if (!cardId) return true;
  return !isHiddenForStaff(locationDoc, cardId);
}
