// Unit tests for the session decisions (P15), run against BOTH implementations: the TypeScript
// port in shared/ and the js/ file the live app uses today. Ported from tests/sections.test.mjs
// and tests/sections-by-role.test.mjs; the two must stay equal until the switch to Mise 2.
//
// The pair of defaults is the whole point of this file, and they deliberately point in opposite
// directions:
//   - a broken `sections` field must NOT empty a working location's app;
//   - a broken `users/{uid}` document MUST mean no access at all;
//   - a role nobody recognises must NOT open the screen that shows what the business pays and
//     earns (the third question: a location says which parts it bought, a role says which of
//     those THIS person sees).
// Getting any of them backwards is invisible in the code and obvious in production.

import { describe, expect, test } from 'vitest';
import * as ported from './sections';
import * as legacyJs from '../../js/sections.js';

const legacy = legacyJs as unknown as typeof ported;

const ALL_ON = { orders: true, calculator: true, catalogue: true, pastries: true, foodcost: true };
const TWO = { locations: { main: 'owner', 'trattoria-x': 'owner' } };
const venue = (extra?: Record<string, unknown>) => ({ name: 'A place', sections: extra || {} });
const field = (value: unknown, key: string): unknown => (value as Record<string, unknown>)[key];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── Sections: default ALLOWED ──────────────────────────────────────────────

  test('no location document: every section stays available', () => {
    expect(m.allowedSections(null)).toStrictEqual(ALL_ON);
    expect(m.allowedSections(undefined)).toStrictEqual(ALL_ON);
  });

  test('a document without the field: every section stays available', () => {
    expect(m.allowedSections({ name: 'The Italian Club' })).toStrictEqual(ALL_ON);
  });

  test('only an explicit false hides a section', () => {
    const doc = { sections: { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false } };
    expect(m.allowedSections(doc)).toStrictEqual(
      { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false });
    expect(m.isSectionAllowed(doc, 'orders')).toBe(true);
    expect(m.isSectionAllowed(doc, 'calculator')).toBe(false);
  });

  test('a corrupt sections field leaves the app whole rather than emptying it', () => {
    for (const bad of ['nonsense', 42, [], true, null]) {
      expect(m.allowedSections({ sections: bad }), `sections: ${JSON.stringify(bad)} must not hide anything`)
        .toStrictEqual(ALL_ON);
    }
    // A value that is merely not `false` is not a hide instruction either.
    expect(m.allowedSections({ sections: { orders: 'no' } }).orders).toBe(true);
  });

  // ⚠️ THE COST OF THAT DEFAULT, WRITTEN DOWN ONCE.
  //
  // Every location document in production was written before Pastries existed, so none of them
  // mentions it — and a missing key means ON. Adding a section to SECTIONS therefore switches it
  // on for EVERY existing venue until someone types `sections.<name>: false` into the ones that
  // should not have it. firestore.rules carries the same default, so a venue showing a section it
  // does not want can also WRITE that collection: the console edit is part of shipping a section.
  test('a venue set up before a section existed still gets it — a missing key means on', () => {
    const beforePastries = { sections: { orders: true, calculator: false, catalogue: false } };
    expect(m.allowedSections(beforePastries).pastries).toBe(true);
    expect(m.isSectionAllowed(beforePastries, 'pastries')).toBe(true);

    const afterTheConsoleEdit = {
      sections: { orders: true, calculator: false, catalogue: false, pastries: false },
    };
    expect(m.isSectionAllowed(afterTheConsoleEdit, 'pastries')).toBe(false);

    // Food Cost is the newest one, and the same thing is true of it: every venue gets it until
    // somebody types the false in. The restaurant is the one that must not have it.
    expect(m.allowedSections(afterTheConsoleEdit).foodcost).toBe(true);
    expect(m.isSectionAllowed({
      sections: { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false },
    }, 'foodcost')).toBe(false);
  });

  test('an unknown section name in the document is ignored, not rendered', () => {
    const out = m.allowedSections({ sections: { orders: true, invoices: true } });
    expect(Object.keys(out)).toStrictEqual([...m.SECTIONS]);
  });

  // ── Sections: a name typed with stray spaces still counts ──────────────────
  //
  // Straight from production (30 July 2026): the restaurant's document was saved with `sections `
  // and `calculator `, spaces that are invisible in the Firebase console. The app found no field,
  // defaulted every section ON, and showed three cards to a location set up for one.

  test('a trailing space in the sections field name does not silently void it', () => {
    const out = m.allowedSections({
      'sections ': { orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false },
    });
    expect(out).toStrictEqual({ orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false });
  });

  test('a trailing space in a section name does not silently void it', () => {
    const out = m.allowedSections({
      sections: { orders: true, 'calculator ': false, ' catalogue': false, 'pastries ': false, 'foodcost ': false },
    });
    expect(out).toStrictEqual({ orders: true, calculator: false, catalogue: false, pastries: false, foodcost: false });
  });

  test('the exact name always wins over a spaced one, so it is never ambiguous', () => {
    const doc = { sections: { calculator: false }, 'sections ': { calculator: true } };
    expect(m.allowedSections(doc).calculator).toBe(false);

    const inner = { sections: { 'calculator ': true, calculator: false } };
    expect(m.allowedSections(inner).calculator).toBe(false);
  });

  // ── Membership: default NONE ───────────────────────────────────────────────

  test('no user document means no locations — never all of them', () => {
    expect(m.locationsOf(null)).toStrictEqual([]);
    expect(m.locationsOf(undefined)).toStrictEqual([]);
    expect(m.locationsOf({})).toStrictEqual([]);
    expect(m.locationsOf({ locations: null })).toStrictEqual([]);
  });

  test('a corrupt locations field means no locations', () => {
    for (const bad of ['main', 42, ['main'], true]) {
      expect(m.locationsOf({ locations: bad }), `locations: ${JSON.stringify(bad)} must grant nothing`)
        .toStrictEqual([]);
    }
  });

  test('only entries explicitly set to true count as access', () => {
    const doc = { locations: { main: true, 'trattoria-x': false, ghost: 'yes', other: 1 } };
    expect(m.locationsOf(doc)).toStrictEqual(['main']);
  });

  // The asymmetry with allowedSections is deliberate, and this test is what stops somebody
  // "fixing" it later: firestore.rules reads this same map and does NOT forgive a stray space.
  // Forgiving one here would open the app on a location the database then refuses on every read.
  test('a location id typed with a space grants nothing — unlike sections', () => {
    expect(m.locationsOf({ locations: { 'restaurant ': true } })).toStrictEqual([]);
    expect(m.locationsOf({ 'locations ': { restaurant: true } })).toStrictEqual([]);
  });

  test('an unusable id is dropped, so sign-in says "no access" instead of throwing', () => {
    const doc = { locations: { 'bakery/../secret': true, '': true, 'a b': true, bakery: true } };
    expect(m.locationsOf(doc)).toStrictEqual(['bakery']);
  });

  // Added: the same two drops asked of every role value, since a manager or owner entry goes
  // through the same filter and a regression in one branch would not show with `true` alone.
  test('locationsOf drops an id with a stray space and an id with a slash, whatever the role', () => {
    for (const value of [true, 'manager', 'owner']) {
      const doc = {
        locations: {
          'bakery ': value, ' bakery': value, 'bak ery': value, 'bakery\n': value, 'bakery\t': value,
          'bakery/x': value, '/bakery': value, '../bakery': value, bakery: value,
        },
      };
      expect(m.locationsOf(doc), String(value)).toStrictEqual(['bakery']);
    }
  });

  test('several locations come back in a stable order', () => {
    expect(m.locationsOf({ locations: { zeta: true, alfa: true, main: true } }))
      .toStrictEqual(['alfa', 'main', 'zeta']);
  });

  // ── What `locations.<id>` may say ──────────────────────────────────────────
  // ⚠️ THE ROLE LIVES IN THIS VALUE (it is what firestore.rules member() reads). A value not in the
  // list is no access at all, never a lesser access.

  test('accessValue gives back exactly the three values the rules accept', () => {
    expect(m.accessValue({ locations: { bakery: true } }, 'bakery')).toBe(true);
    expect(m.accessValue({ locations: { bakery: 'manager' } }, 'bakery')).toBe('manager');
    expect(m.accessValue({ locations: { bakery: 'owner' } }, 'bakery')).toBe('owner');
    expect(m.OWNER).toBe('owner');
    expect(m.MANAGER).toBe('manager');
  });

  test('accessValue refuses Owner, "owner " and every other near miss', () => {
    const NEAR_MISSES = ['Owner', 'OWNER', 'owner ', ' owner', 'owner\n', 'Manager', 'MANAGER', 'manager ', ' manager',
      'head-chef', 'staff', 'admin', 'true', 'yes', false, 0, 1, null, {}, ['owner'], ['manager']];
    for (const bad of NEAR_MISSES) {
      expect(m.accessValue({ locations: { bakery: bad } }, 'bakery'), JSON.stringify(bad)).toBe(false);
    }
  });

  test('accessValue reads the exact key — a stray space in the id is a different, absent key', () => {
    const doc = { locations: { bakery: 'owner' } };
    expect(m.accessValue(doc, 'bakery ')).toBe(false);
    expect(m.accessValue(doc, ' bakery')).toBe(false);
    expect(m.accessValue(doc, 'Bakery')).toBe(false);
    expect(m.accessValue({ locations: { 'bakery ': 'owner' } }, 'bakery')).toBe(false);
  });

  test('accessValue is false when there is no document, no locations or no id', () => {
    for (const doc of [null, undefined, {}, { locations: null }, { locations: [] }, { locations: 'owner' }]) {
      expect(m.accessValue(doc, 'bakery'), JSON.stringify(doc)).toBe(false);
    }
    expect(m.accessValue({ locations: { bakery: 'owner' } }, undefined)).toBe(false);
    expect(m.accessValue({ locations: { bakery: 'owner' } }, '')).toBe(false);
  });

  // ── Which location this session opens ──────────────────────────────────────

  test('one location: straight in, no question asked', () => {
    const out = m.pickLocation({ locations: { main: true } }, null);
    expect(out).toStrictEqual({ status: 'ready', locationId: 'main', options: ['main'] });
  });

  test('two locations and no previous choice: ask', () => {
    const out = m.pickLocation({ locations: { main: true, 'trattoria-x': true } }, null);
    expect(out.status).toBe('choose');
    expect(out.options).toStrictEqual(['main', 'trattoria-x']);
    expect(field(out, 'locationId')).toBeUndefined();
  });

  test('two locations and a remembered one: go back where you were', () => {
    const out = m.pickLocation({ locations: { main: true, 'trattoria-x': true } }, 'trattoria-x');
    expect(out.status).toBe('ready');
    expect(field(out, 'locationId')).toBe('trattoria-x');
  });

  test('a remembered location that is no longer yours is ignored', () => {
    // Access was taken away; a phone must not keep it alive from local storage.
    const out = m.pickLocation({ locations: { main: true, 'trattoria-x': true } }, 'sold-last-year');
    expect(out.status).toBe('choose');

    const single = m.pickLocation({ locations: { main: true } }, 'sold-last-year');
    expect(single.status).toBe('ready');
    expect(field(single, 'locationId')).toBe('main');
  });

  test('an account with no location is a named state, not a crash', () => {
    expect(m.pickLocation(null, 'main')).toStrictEqual({ status: 'none', options: [] });
    expect(m.pickLocation({ locations: {} }, null)).toStrictEqual({ status: 'none', options: [] });
  });

  // ── Where opening the app LANDS ────────────────────────────────────────────
  //
  // One step above pickLocation. Everything here pushes in one direction: the hub is the app
  // administrator's screen and nobody else's, because for everybody else it is a door they must
  // open every morning to reach the only room behind it.

  test('an ordinary account never sees the hub, whatever it holds', () => {
    for (const doc of [TWO, { locations: { main: true } }, { locations: {} }, null]) {
      expect(m.pickStart(doc, { remembered: 'main' }).status).not.toBe('hub');
    }
  });

  test('an ordinary account lands exactly where pickLocation says', () => {
    expect(m.pickStart(TWO, { remembered: 'main' })).toStrictEqual(m.pickLocation(TWO, 'main'));
    expect(m.pickStart(TWO, {})).toStrictEqual(m.pickLocation(TWO, ''));
    expect(m.pickStart(null, {})).toStrictEqual(m.pickLocation(null, ''));
  });

  test('the app administrator opens on the hub', () => {
    const out = m.pickStart(TWO, { isAppAdmin: true, remembered: 'main' });
    expect(out.status).toBe('hub');
    expect(out.options).toStrictEqual(['main', 'trattoria-x']);
  });

  // ⚠️ A remembered venue must NOT skip the hub. It is what "open the app and you are in Mise"
  // means; skipping it would make the hub reachable only on the very first open of a device.
  test('a remembered venue does not skip the hub', () => {
    expect(m.pickStart(TWO, { isAppAdmin: true, remembered: 'trattoria-x' }).status).toBe('hub');
  });

  // ⚠️ THE TEST THIS FEATURE LIVES OR DIES BY. Once past the hub the app is being used — every
  // page change re-asks this question, and answering "hub" again would throw somebody out of the
  // Calculator on the way to Orders.
  test('past the hub, a page change goes straight back to the venue', () => {
    const out = m.pickStart(TWO, { isAppAdmin: true, hubPassed: true, remembered: 'trattoria-x' });
    expect(out.status).toBe('ready');
    expect(field(out, 'locationId')).toBe('trattoria-x');
  });

  test('past the hub with nothing remembered, the picker still asks', () => {
    expect(m.pickStart(TWO, { isAppAdmin: true, hubPassed: true }).status).toBe('choose');
  });

  // ⚠️ The one case that would otherwise hide the whole back office behind a message about a
  // problem: an administrator who sells the app and runs no venue of their own.
  test('an administrator with no venue of their own still gets the hub', () => {
    const out = m.pickStart({ locations: {} }, { isAppAdmin: true });
    expect(out.status).toBe('hub');
    expect(out.options).toStrictEqual([]);
    expect(m.pickStart(null, { isAppAdmin: true }).status).toBe('hub');
  });

  // Same bias as every other guard in this app: a value nobody understands is the LEAST power,
  // never the most. Only the boolean true is an administrator.
  test('anything that is not exactly true is not an administrator', () => {
    for (const value of ['true', 1, {}, [], 'owner', 'yes']) {
      expect(m.pickStart(TWO, { isAppAdmin: value }).status, String(value)).not.toBe('hub');
    }
  });

  test('anything that is not exactly true has not passed the hub', () => {
    for (const value of ['true', 1, {}, [], 'yes']) {
      expect(m.pickStart(TWO, { isAppAdmin: true, hubPassed: value }).status, String(value)).toBe('hub');
    }
  });

  test('no options at all is not a crash', () => {
    expect(m.pickStart(null, {}).status).toBe('none');
    expect(m.pickStart(undefined, undefined).status).toBe('none');
  });

  // ── The back arrow: "show me my venues" ────────────────────────────────────

  // ⚠️ IT MUST BEAT THE HUB. Somebody who taps the arrow inside a venue is asking for the venue
  // list; answering with the Mise home would skip the very screen the arrow was pressed to reach.
  test('asking for the venue picker wins over the hub', () => {
    const out = m.pickStart(TWO, { isAppAdmin: true, pickVenue: true, remembered: 'main' });
    expect(out.status).toBe('choose');
    expect(out.options).toStrictEqual(['main', 'trattoria-x']);
  });

  test('a remembered venue does not skip the picker either', () => {
    expect(m.pickStart(TWO, { pickVenue: true, remembered: 'trattoria-x' }).status).toBe('choose');
  });

  // A flag that somehow survives for somebody with one venue must land somewhere sensible rather
  // than on a list of one.
  test('asking for the picker with one venue just opens it', () => {
    const one = { locations: { main: 'owner' } };
    const out = m.pickStart(one, { pickVenue: true });
    expect(out.status).toBe('ready');
    expect(field(out, 'locationId')).toBe('main');
  });

  test('anything that is not exactly true is not a request for the picker', () => {
    for (const value of ['true', 1, {}, []]) {
      expect(m.pickStart(TWO, { pickVenue: value, remembered: 'main' }).status, String(value)).not.toBe('choose');
    }
  });

  // Added: the order of the three questions, for every combination of the three flags. With two
  // venues and one remembered, the three possible answers are all different, so the table says
  // which question was asked first: the picker, then the hub, then the venue itself.
  test('pickStart asks pickVenue first, then the hub, then the venue — for every flag combination', () => {
    for (const isAppAdmin of [true, false]) {
      for (const hubPassed of [true, false]) {
        for (const pickVenue of [true, false]) {
          const expected = pickVenue ? 'choose' : isAppAdmin && !hubPassed ? 'hub' : 'ready';
          const out = m.pickStart(TWO, { isAppAdmin, hubPassed, pickVenue, remembered: 'main' });
          expect(out.status, JSON.stringify({ isAppAdmin, hubPassed, pickVenue })).toBe(expected);
        }
      }
    }
  });

  test('the administrator with no venue gets the hub on every open, and the hub carries no options', () => {
    for (const doc of [{ locations: {} }, { locations: { 'bakery ': true } }, null, undefined]) {
      const out = m.pickStart(doc, { isAppAdmin: true, remembered: 'bakery' });
      expect(out.status, JSON.stringify(doc)).toBe('hub');
      expect(out.options, JSON.stringify(doc)).toStrictEqual([]);
    }
  });

  // ── Whether the arrow is drawn at all ──────────────────────────────────────

  test('one venue and not an administrator: no arrow', () => {
    expect(m.hasLevelAbove({ isAppAdmin: false, options: ['main'] })).toBe(false);
    expect(m.hasLevelAbove({ options: [] })).toBe(false);
    expect(m.hasLevelAbove({})).toBe(false);
    expect(m.hasLevelAbove()).toBe(false);
  });

  test('more than one venue: an arrow, administrator or not', () => {
    expect(m.hasLevelAbove({ isAppAdmin: false, options: ['main', 'other'] })).toBe(true);
  });

  // ⚠️ An administrator with a single venue still has the customer list above them.
  test('an administrator always has somewhere above, even with one venue', () => {
    expect(m.hasLevelAbove({ isAppAdmin: true, options: ['main'] })).toBe(true);
    expect(m.hasLevelAbove({ isAppAdmin: true, options: [] })).toBe(true);
  });

  test('a corrupt options value is not an arrow, and not a crash', () => {
    for (const options of [null, undefined, 'main', 42, {}]) {
      expect(m.hasLevelAbove({ options }), String(options)).toBe(false);
    }
  });

  // ── Who sees Food Cost ─────────────────────────────────────────────────────

  test('an owner and a manager see Food Cost', () => {
    for (const role of ['owner', 'manager']) {
      expect(m.isSectionAllowedFor(venue(), role, 'foodcost'), role).toBe(true);
    }
  });

  // ⚠️ THE POINT OF THE WHOLE FEATURE. Food Cost is what the business pays for its ingredients and
  // earns on each product; everything else in the app is what to make and how much of it.
  test('an ordinary employee does not', () => {
    expect(m.isSectionAllowedFor(venue(), 'staff', 'foodcost')).toBe(false);
  });

  test('a role nobody recognises does not either', () => {
    for (const role of ['head-chef', 'Owner', 'MANAGER', '', null, undefined, 1, {}]) {
      expect(m.isSectionAllowedFor(venue(), role, 'foodcost'), String(role)).toBe(false);
    }
  });

  // Added: the same two sentences asked of sectionsFor directly, with the roles that matter most:
  // «staff», a missing role and «admin» (a word that sounds powerful and is not a role at all).
  test('sectionsFor gives Food Cost to the owner and the manager only', () => {
    for (const role of ['owner', 'manager']) {
      expect(m.sectionsFor(venue(), role).foodcost, role).toBe(true);
    }
    for (const role of ['staff', undefined, 'admin', null, true, 'Owner', 'owner ']) {
      expect(m.sectionsFor(venue(), role).foodcost, String(role)).toBe(false);
    }
  });

  // ── Everything else is unchanged for everybody ─────────────────────────────

  test('the other four sections are open to every role', () => {
    for (const role of ['owner', 'manager', 'staff', 'nonsense']) {
      for (const name of m.SECTIONS.filter(s => s !== 'foodcost')) {
        expect(m.isSectionAllowedFor(venue(), role, name), `${role}/${name}`).toBe(true);
      }
    }
  });

  // ⚠️ A baker who cannot open the Calculator has no app. The role narrows exactly one screen, and
  // this is what says so if a future change widens it.
  test('an employee keeps every screen the daily work needs', () => {
    expect(m.sectionsFor(venue(), 'staff')).toStrictEqual({
      orders: true, calculator: true, catalogue: true, pastries: true, foodcost: false,
    });
  });

  // ── A role narrows, it never widens ────────────────────────────────────────

  // ⚠️ THE DIRECTION THAT MATTERS. Being an owner cannot turn on a section the venue does not
  // have — otherwise the Orders-only restaurant would grow a Food Cost screen the moment its owner
  // signed in.
  test('an owner cannot see a section the location does not have', () => {
    const ordersOnly = venue({ calculator: false, catalogue: false, pastries: false, foodcost: false });
    expect(m.isSectionAllowedFor(ordersOnly, 'owner', 'foodcost')).toBe(false);
    expect(m.isSectionAllowedFor(ordersOnly, 'owner', 'calculator')).toBe(false);
    expect(m.isSectionAllowedFor(ordersOnly, 'owner', 'orders')).toBe(true);
  });

  test('the result is the location set narrowed, never anything new', () => {
    const ordersOnly = venue({ calculator: false, catalogue: false, pastries: false, foodcost: false });
    for (const role of ['owner', 'manager', 'staff']) {
      const seen = m.sectionsFor(ordersOnly, role);
      const bought = m.allowedSections(ordersOnly);
      for (const name of m.SECTIONS) {
        if (seen[name]) expect(bought[name], `${role} saw ${name} the venue lacks`).toBe(true);
      }
    }
  });

  // ── The awkward documents ──────────────────────────────────────────────────

  // ⚠️ A missing or corrupt location document must not empty the app — that default is
  // deliberately UNCHANGED here. Only the money screen is narrowed, and only by role.
  test('a missing location document still leaves an owner everything', () => {
    for (const broken of [null, undefined, {}, { sections: null }, { sections: 'yes' }, []]) {
      const seen = m.sectionsFor(broken, 'owner');
      expect(seen.orders, String(broken)).toBe(true);
      expect(seen.foodcost, String(broken)).toBe(true);
    }
  });

  test('a missing location document still hides Food Cost from an employee', () => {
    for (const broken of [null, undefined, {}, { sections: null }]) {
      expect(m.sectionsFor(broken, 'staff').foodcost, String(broken)).toBe(false);
    }
  });

  // The stray-space forgiveness of allowedSections survives the narrowing.
  test('a section name typed with a stray space is still honoured', () => {
    const doc = { 'sections ': { 'foodcost ': false } };
    expect(m.isSectionAllowedFor(doc, 'owner', 'foodcost')).toBe(false);
  });

  test('every section name gets an answer, and it is always a boolean', () => {
    for (const role of ['owner', 'manager', 'staff', 'nonsense']) {
      const seen = m.sectionsFor(venue(), role);
      expect(Object.keys(seen).sort(), role).toStrictEqual([...m.SECTIONS].sort());
      for (const name of m.SECTIONS) expect(typeof seen[name], `${role}/${name}`).toBe('boolean');
    }
  });

  // Added: a section name that does not exist is never allowed, for any role — the list in
  // SECTIONS is what makes a screen reachable, so a name outside it opens nothing.
  test('a name outside the list is never allowed, for any role', () => {
    for (const role of ['owner', 'manager', 'staff', undefined]) {
      for (const name of ['invoices', '', undefined, null, 'toString', '__proto__', 'Orders']) {
        expect(m.isSectionAllowedFor(venue(), role, name), `${String(role)}/${String(name)}`).toBe(false);
        expect(m.isSectionAllowed(venue(), name), String(name)).toBe(false);
      }
    }
  });

  test('the list of sections is the five the app has, in this order, and frozen', () => {
    expect([...m.SECTIONS]).toStrictEqual(['orders', 'calculator', 'catalogue', 'pastries', 'foodcost']);
    expect(Object.isFrozen(m.SECTIONS)).toBe(true);
  });
});
