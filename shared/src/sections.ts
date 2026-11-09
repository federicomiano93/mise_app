// sections.ts — two decisions, both pure, both taken from documents that only the Firebase
// console can write:
//
//   1. WHICH LOCATION is this session working on (users/{uid}.locations)
//   2. WHICH PARTS of the app that location uses (locations/{id}.sections)
//
// TypeScript port of js/sections.js for Mise 2. Behaviour is identical, input for input:
// sections.spec.ts runs every test against BOTH files and parity.spec.ts compares their exports.
// The comments below are the ones the original paid for in bugs. The defaults point in OPPOSITE
// directions, for a reason given at each one.

import { isValidLocationId } from './location-id';

// ⚠️ THE ROLE TABLE LIVES IN home-cards.ts, because the server asks it through that file's byte
// copy and the copy may import nothing.
export { ROLE_CARDS, roleHasCard } from './home-cards';

export type SectionName = 'orders' | 'calculator' | 'catalogue' | 'pastries' | 'foodcost';
export type SectionMap = Record<SectionName, boolean>;

// ⚠️ A NEW NAME HERE IS NOT OPTIONAL, IT IS WHAT MAKES A SCREEN REACHABLE. A section missing
// from this list is not "allowed by default" — allowedSections never produces a key for it, so
// isSectionAllowed returns false and the screen cannot be opened anywhere, with nothing saying
// why. ⚠️ AND ADDING ONE TURNS IT ON FOR EVERY EXISTING LOCATION, because the default below is
// ALLOWED and no location document written before today mentions the new name.
export const SECTIONS: readonly SectionName[] = Object.freeze(['orders', 'calculator', 'catalogue', 'pastries', 'foodcost'] as const);

// Read a field by name, accepting a name typed with stray spaces around it. These documents are
// typed by hand in the Firebase console, where a trailing space is INVISIBLE: on 30 Jul 2026 the
// restaurant had `sections ` and `calculator `, the app found no field at all and switched every
// section on. An exact match always wins, so a document with both names is not ambiguous.
function fieldNamed(obj: unknown, wanted: string): unknown {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return undefined;
  const record = obj as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(record, wanted)) return record[wanted];
  const loose = Object.keys(record).find(key => key.trim() === wanted);
  return loose === undefined ? undefined : record[loose];
}

// Which sections a location uses.
//
// DEFAULT: ALLOWED. A missing or corrupt `sections` field must never empty a working location's
// app, and it leaks nothing: a location only ever sees its OWN data, so an extra section shows an
// extra EMPTY screen. Only an explicit `false` hides one.
export function allowedSections(locationDoc: unknown): SectionMap {
  const raw = fieldNamed(locationDoc, 'sections');
  const map = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {} as SectionMap;
  SECTIONS.forEach(name => { out[name] = fieldNamed(map, name) !== false; });
  return out;
}

export function isSectionAllowed(locationDoc: unknown, name: unknown): boolean {
  return (allowedSections(locationDoc) as Record<string, boolean>)[name as string] === true;
}

// What `locations.<id>` may say, and what each answer means. ⚠️ THE ROLE LIVES IN THIS VALUE
// (it is what firestore.rules member() reads):
//   true       → a member of this location, an ordinary employee
//   'manager'  → a member who runs this location: deletes too, but hires nobody
//   'owner'    → a member, and the person whose business it is
//   'owner-sales'   → runs the sales side only: Food cost and the clients
//   'owner-kitchen' → runs the kitchen side only: everything but those two
//   anything else (false, missing, a typo) → no access at all
// ⚠️ A NEW VALUE GOES IN FOUR PLACES OR IT IS A LOCKOUT: js/sections.js (and this port),
// firestore.rules member(), functions/onboarding.js accessValue().
export const OWNER = 'owner';
export const MANAGER = 'manager';
// Federico, 1 Nov 2026. ⚠️ Same deployment order as above: rules first, then the app, and only
// then may anybody be given one of these.
export const OWNER_SALES = 'owner-sales';
export const OWNER_KITCHEN = 'owner-kitchen';

export type AccessValue = true | typeof MANAGER | typeof OWNER | typeof OWNER_SALES | typeof OWNER_KITCHEN;

// ⚠️ A value NOT in here is no access at all, never a lesser access. A role from a later version
// of the app, a typo, a string with a stray space: all refused.
const ACCESS_VALUES: readonly unknown[] = Object.freeze([true, OWNER_KITCHEN, OWNER_SALES, MANAGER, OWNER]);

function locationsField(userDoc: unknown): Record<string, unknown> | null {
  const raw = userDoc && typeof userDoc === 'object' ? (userDoc as Record<string, unknown>).locations : null;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

export function accessValue(userDoc: unknown, locationId: unknown): AccessValue | false {
  const raw = locationsField(userDoc);
  if (!raw) return false;
  const value = raw[locationId as string];
  return ACCESS_VALUES.includes(value) ? (value as AccessValue) : false;
}

// ── Sections that also depend on WHO is looking ──────────────────────────────────────────────
// Food Cost is the screen that says what the business PAYS and EARNS. ⚠️ THE DEFAULT IS THE
// OPPOSITE WAY ROUND FROM allowedSections: a role nobody recognises is not on the list, so it is
// REFUSED — power nobody granted does not exist.
const ROLE_ONLY: Readonly<Partial<Record<SectionName, readonly string[]>>> = Object.freeze({ foodcost: [OWNER, MANAGER, OWNER_SALES] });

// The other direction: the sections a partial owner is kept out of, the same list
// firestore.rules narrowedOut() refuses (tests/partial-owner-roles.test.mjs compares them).
// ⚠️ The rules decide; this only stops a screen collecting their refusals.
export const NOT_FOR_ROLE: Readonly<Record<string, readonly SectionName[]>> = Object.freeze({
  [OWNER_SALES]: Object.freeze(['calculator', 'catalogue', 'orders', 'pastries'] as const),
  [OWNER_KITCHEN]: Object.freeze(['foodcost'] as const),
});

// The location's set NARROWED by the role, never widened.
export function sectionsFor(locationDoc: unknown, role: unknown): SectionMap {
  const fromLocation = allowedSections(locationDoc);
  const kept: readonly SectionName[] = Object.prototype.hasOwnProperty.call(NOT_FOR_ROLE, String(role))
    ? NOT_FOR_ROLE[role as string] ?? []
    : [];
  const out = {} as SectionMap;
  SECTIONS.forEach(name => {
    const roles = ROLE_ONLY[name];
    out[name] = fromLocation[name] === true && (!roles || roles.includes(role as string)) && !kept.includes(name);
  });
  return out;
}

export function isSectionAllowedFor(locationDoc: unknown, role: unknown, name: unknown): boolean {
  return (sectionsFor(locationDoc, role) as Record<string, boolean>)[name as string] === true;
}

// Where a page sends somebody whose card it is not. Home, except for one person: a client's order
// notifies the owner of the sales side and its tap opens calculator.html, because one notification
// goes to everybody (js/push-model.js targetPage) and the service worker cannot know a role. Home
// would lose the order they tapped, so they land on the orders received. (Mise 2 answers with the
// current app's page names too, for parity; nothing in app/ reads it yet — slice 4 of the roles work
// sends the sales owner to `/clients/orders` from `SectionRoute`.)
export function pageWhenRefused(role: unknown, pageCard: unknown): string {
  return role === OWNER_SALES && pageCard === 'calculator' ? 'clients.html#orders' : 'index.html';
}

// Which locations this person may enter, in a stable order.
//
// DEFAULT: NONE — this one IS the boundary between two businesses' data. ⚠️ AND IT DELIBERATELY
// DOES NOT FORGIVE A STRAY SPACE: firestore.rules reads this same document and does not either,
// and being kinder than the rules would open a location the database then refuses on every read.
// Ids that could never name a folder are DROPPED, so they fail as "no location yet", not a crash.
export function locationsOf(userDoc: unknown): string[] {
  const raw = locationsField(userDoc);
  if (!raw) return [];
  return Object.keys(raw)
    .filter(id => accessValue(userDoc, id) !== false && isValidLocationId(id))
    .sort();
}

export type PickLocation =
  | { status: 'none'; options: string[] }
  | { status: 'ready'; locationId: string; options: string[] }
  | { status: 'choose'; options: string[] };

export type PickStart = PickLocation | { status: 'hub'; options: string[] };

// What happens right after a successful sign-in. `remembered` (the last choice on THIS device)
// is honoured only if it is still one of yours: an access taken away must not survive in a
// phone's local storage.
export function pickLocation(userDoc: unknown, remembered?: unknown): PickLocation {
  const options = locationsOf(userDoc);
  if (options.length === 0) return { status: 'none', options };
  if (options.length === 1) return { status: 'ready', locationId: options[0] as string, options };
  if (remembered && options.includes(remembered as string)) {
    return { status: 'ready', locationId: remembered as string, options };
  }
  return { status: 'choose', options };
}

export interface PickStartOptions {
  isAppAdmin?: unknown;
  hubPassed?: unknown;
  pickVenue?: unknown;
  remembered?: unknown;
}

// Where does opening the app LAND? ⚠️ THE HUB IS FOR THE APP'S ADMINISTRATOR ALONE; everybody
// else lands inside their venue exactly as yesterday. ⚠️ An administrator with no venue of their
// own still gets the hub. ⚠️ `pickVenue` (the back arrow from inside a venue: "show me my
// venues") is asked BEFORE the hub, and the caller consumes it so it decides one load only.
export function pickStart(userDoc: unknown, { isAppAdmin = false, hubPassed = false,
                                             pickVenue = false, remembered = '' }: PickStartOptions = {}): PickStart {
  if (pickVenue === true) {
    const options = locationsOf(userDoc);
    if (options.length > 1) return { status: 'choose', options };
    return pickLocation(userDoc, remembered);
  }
  if (isAppAdmin === true && hubPassed !== true) {
    return { status: 'hub', options: locationsOf(userDoc) };
  }
  return pickLocation(userDoc, remembered);
}

// Is there a level ABOVE this venue for the back arrow to step up to? One venue and not an
// administrator means no arrow: it would lead to a list of one.
export function hasLevelAbove({ isAppAdmin = false, options = [] }: { isAppAdmin?: unknown; options?: unknown } = {}): boolean {
  return isAppAdmin === true || (Array.isArray(options) && options.length > 1);
}
