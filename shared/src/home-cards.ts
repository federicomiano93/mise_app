// home-cards.ts — which Home cards a venue shows to its ordinary employees, and in what
// order everybody sees them.
//
// TypeScript port of js/home-cards.js for Mise 2. Behaviour is identical, input for input:
// shared/src/home-cards.spec.ts runs every test against BOTH files and parity.spec.ts compares
// their exports. The comments below are the ones the original paid for in bugs.
//
// Federico, 13 Sep 2026: «possiamo creare una schermata dove il proprietario, headchef
// e manager decidono le schede che si possono vedere senza passare da firebase?» —
// and, asked what hiding should mean, he chose: ONLY HIDE, and ONLY FOR EMPLOYEES.
// Then: «se le nascondo i dipendenti non ricevono le notifiche perche' vuol dire che
// non voglio che usino quella scheda» — so a hidden card is silent for them too.
// Then: «voglio poter decidere tutto dall'app tutte le card che ci sono nella home» —
// Food cost and Stocktake included — and «devo poter cambiare l'ordine trascinandole»,
// for the whole venue.
//
// PURE, AND ZERO IMPORTS ON PURPOSE. The Home asks it (which cards to draw, in what
// order), the page gate asks it on every page (whether to send an employee back), the
// settings screen asks it (what each switch shows) — and THE SERVER asks it, to decide
// who may be notified and which values setStaffCard / setHomeCardOrder accept. Zero imports
// is what lets the same file run in all of those places.
//
// ⚠️⚠️ TWO KINDS OF CARD, AND THE DEFAULT POINTS OPPOSITE WAYS FOR EACH.
//   • The everyday cards (Calculator, Catalogue, Orders, Suppliers, Pastries) are the
//     work. An employee sees them unless the venue HID one: only a literal `true` in
//     `staffHiddenCards` hides. A venue that never heard of the field, a document that
//     failed to load and a corrupt value all show every card — a cosmetic switch must
//     never empty a working Home.
//   • The money cards (Food cost, Stocktake) are the business's accounts. An employee
//     sees them only if the venue SHOWED one: only a literal `true` in `staffShownCards`
//     shows. Every doubt answers HIDDEN — power nobody granted does not exist
//     (js/roles.js) — and it is the same direction firestore.rules takes, because for
//     these two the card is backed by a real permission, not only by the Home.
//
// ⚠️ OWNERS, MANAGERS AND HEAD CHEFS ALWAYS SEE EVERY CARD. That was his choice, and it
// is also what keeps the switch safe to use: the person who hid a card can never lose
// the way back to it, because the screen that shows it again is on their own Home.

// Every card the Home can show, in the order the markup draws them.
//
// ⚠️ `id` IS NOT THE SECTION. Suppliers & ingredients shares `orders`, and Stocktake
// shares `foodcost`: hiding one of a pair must not hide the other.
//
// `employeePush`: whether an EMPLOYEE can be notified about something that opens this
// card's page, so that hiding it has notifications to silence. The Calculator receives
// a client's order and the Catalogue a timer; an order list goes only to whoever runs
// the place (functions/index.js managersAmong). A test ties it to push-model's
// cardForKind.
//
// `optIn`: a money card — hidden from employees until the venue shows it (see above).
export const STAFF_CARDS = Object.freeze([
  Object.freeze({ id: 'calculator', section: 'calculator', labelKey: 'section.calculator', employeePush: true, optIn: false }),
  Object.freeze({ id: 'catalogue', section: 'catalogue', labelKey: 'section.catalogue', employeePush: true, optIn: false }),
  Object.freeze({ id: 'orders', section: 'orders', labelKey: 'section.orders', employeePush: false, optIn: false }),
  Object.freeze({ id: 'suppliers', section: 'orders', labelKey: 'section.suppliersAndIngredients', employeePush: false, optIn: false }),
  Object.freeze({ id: 'pastries', section: 'pastries', labelKey: 'section.pastries', employeePush: false, optIn: false }),
  Object.freeze({ id: 'foodcost', section: 'foodcost', labelKey: 'section.foodcost', employeePush: false, optIn: true }),
  Object.freeze({ id: 'inventory', section: 'foodcost', labelKey: 'section.inventory', employeePush: false, optIn: true }),
] as const);

export type StaffCard = (typeof STAFF_CARDS)[number];
export type CardId = StaffCard['id'];
// The money cards: the ones with `optIn: true` above.
export type OptInCardId = Extract<StaffCard, { readonly optIn: true }>['id'];

export const HIDEABLE_IDS: readonly CardId[] = Object.freeze(STAFF_CARDS.map(card => card.id));
export const OPT_IN_IDS: readonly OptInCardId[] = Object.freeze(
  STAFF_CARDS
    .filter((card): card is Extract<StaffCard, { readonly optIn: true }> => card.optIn)
    .map(card => card.id),
);

// The fields on locations/{lid}.
export const HIDDEN_FIELD = 'staffHiddenCards';   // { <everyday card>: true } — hidden from staff
export const SHOWN_FIELD = 'staffShownCards';     // { <money card>: true } — shown to staff
export const ORDER_FIELD = 'homeCardOrder';       // [<card id>, …] — the Home's order, for everybody

// The part of locations/{lid} this file reads, keyed by the constants above so the two cannot
// drift apart. Every field is as untrusted as the document: a venue that never heard of one,
// a failed load and a corrupt value are all expected, which is why the functions below take
// `unknown` rather than this type.
export interface HomeCardFields {
  [HIDDEN_FIELD]?: Partial<Record<CardId, boolean>>;
  [SHOWN_FIELD]?: Partial<Record<CardId, boolean>>;
  [ORDER_FIELD]?: CardId[];
}

// Is this a card id this app knows? A membership test on strings (not `includes`) so that
// anything at all may be asked.
const isCardId = (id: unknown): id is CardId => HIDEABLE_IDS.some(known => known === id);
const isOptInId = (id: unknown): boolean => OPT_IN_IDS.some(known => known === id);

// A property of something already known to be an object, read as the untrusted value it is.
const readKey = (source: object, key: string): unknown => (source as Record<string, unknown>)[key];

// A literal `true` under this card in this map on this document — and nothing else.
function flagged(locationDoc: unknown, field: string, cardId: string): boolean {
  const map = locationDoc && typeof locationDoc === 'object' ? readKey(locationDoc, field) : null;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return false;
  return Object.prototype.hasOwnProperty.call(map, cardId) && readKey(map, cardId) === true;
}

// Is this card hidden from this venue's employees?
export function isHiddenForStaff(locationDoc: unknown, cardId: string | null | undefined): boolean {
  if (!isCardId(cardId)) return false;
  if (isOptInId(cardId)) return !flagged(locationDoc, SHOWN_FIELD, cardId);
  return flagged(locationDoc, HIDDEN_FIELD, cardId);
}

// Is this card shown to this person? `canManage` is the session's — true for an owner
// and for a manager, which includes a head chef.
//
// A card with no id is never hidden by this layer.
export function cardVisibleTo(locationDoc: unknown, canManage: unknown, cardId: string | null | undefined): boolean {
  if (canManage === true) return true;
  if (!cardId) return true;
  return !isHiddenForStaff(locationDoc, cardId);
}

// Anything that maps a uid to its membership value and can be asked with `get` — a Map,
// in practice. Optional on purpose: see mayBeTold().
export interface AccessLookup {
  get(uid: string): unknown;
}

// Of these people, who may still be told about something that opens this card?
// `null` when the card is not hidden at all — everybody may, and nobody's role needs
// reading. Otherwise the Set of uids who may.
//
// `accessByUid` maps a uid to its membership VALUE for this venue (users/{uid}.locations
// .<lid>: `true` | 'manager' | 'owner'). ⚠️ A UID ABSENT FROM IT — its role could not be
// read — IS NOT KNOWN TO RUN THE PLACE, and is not told: power nobody granted does not
// exist (js/roles.js). A head chef holds 'manager', so they are told.
//
// ⚠️ IT LIVES HERE, PURE, SO IT CAN BE RUN BY A TEST. The server (functions/index.js)
// only reads the two documents and hands them over; the decision it used to make
// inline could be broken five ways with every text-reading test still green.
export function mayBeTold(
  locationDoc: unknown,
  cardId: string | null | undefined,
  uids: unknown,
  accessByUid: AccessLookup | null | undefined,
): Set<string> | null {
  if (!isHiddenForStaff(locationDoc, cardId)) return null;
  const told = new Set<string>();
  const candidates: unknown[] = Array.isArray(uids) ? uids : [];
  for (const uid of candidates) {
    if (!uid || typeof uid !== 'string') continue;
    const access = accessByUid && typeof accessByUid.get === 'function' ? accessByUid.get(uid) : undefined;
    if (cardVisibleTo(locationDoc, access === 'owner' || access === 'manager', cardId)) told.add(uid);
  }
  return told;
}

// ── The order ────────────────────────────────────────────────────────────────

// A saved order the app can use: known card ids only, each once. Anything else in the
// list is dropped rather than trusted, and a list that is not a list is no order at all.
export function cleanOrder(list: unknown): CardId[] {
  if (!Array.isArray(list)) return [];
  const items: unknown[] = list;
  const out: CardId[] = [];
  for (const id of items) {
    if (isCardId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

// What setHomeCardOrder accepts: a non-empty list of known ids, each once, and nothing
// else. Stricter than cleanOrder on purpose — the server stores what it is given, so a
// list it would have to repair is a list it refuses.
export function isValidOrder(list: unknown): boolean {
  return Array.isArray(list)
    && list.length > 0
    && list.length <= HIDEABLE_IDS.length
    && cleanOrder(list).length === list.length;
}

// These card ids, in the venue's order. A card the saved order names comes first, in
// that order; a card it does not name — a venue that never chose, or a card added to
// the app after it chose — follows, in the order it was given.
//
// Generic: the Home hands over whatever it read from the markup (a card with no
// `data-card` is `undefined`), and gets the same values back, reordered.
export function orderedCardIds<T>(locationDoc: unknown, ids: readonly T[] | null | undefined): T[] {
  const saved: readonly unknown[] = cleanOrder(
    locationDoc && typeof locationDoc === 'object' ? readKey(locationDoc, ORDER_FIELD) : null,
  );
  const given: readonly T[] = Array.isArray(ids) ? ids : [];
  const rank = (id: T): number => (saved.includes(id) ? saved.indexOf(id) : saved.length + given.indexOf(id));
  return given.slice().sort((a, b) => rank(a) - rank(b));
}
