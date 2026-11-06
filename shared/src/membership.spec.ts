// Unit tests for the second session decision (P15): what a person may do once they are inside a
// location they already belong to — run against BOTH implementations: the TypeScript port in
// shared/ and the js/ file the live app uses today. Ported from tests/roles.test.mjs.
//
// membership.ts is the PURE half of js/roles.js only (ROLES, DEFAULT_ROLE, isValidRole, roleOf,
// canManage, isOwner). The other half turns a role into words through the current app's
// dictionary, which Mise 2 does not share, so the label tests are not ported and this module is
// NOT paired in parity.spec.ts (js/roles.js exports more than the port does).
//
// ⚠️ ALMOST EVERY TEST HERE IS THE SAME ASSERTION FROM A DIFFERENT DIRECTION — "this does NOT
// come out as owner". That is deliberate. There is exactly one dangerous answer this module can
// give, and it is handing somebody the power to delete another business's data because a value
// was missing, misspelled or corrupt. Everything else is recoverable.

import { describe, expect, test } from 'vitest';
import * as ported from './membership';
import * as portedSections from './sections';
import * as legacyRolesJs from '../../js/roles.js';
import * as legacySectionsJs from '../../js/sections.js';

const legacy = legacyRolesJs as unknown as typeof ported;
const legacySections = legacySectionsJs as unknown as typeof portedSections;

// `m` is the roles half, `s` the sections file beside it: the role is read from the membership
// value that sections.accessValue() owns, so each test uses the matching pair.
describe.each([
  ['shared/ (TypeScript)', ported, portedSections],
  ['js/ (current app)', legacy, legacySections],
] as const)('%s', (_name, m, s) => {
  // ── The default, and the shape production is in TODAY ──────────────────────

  test('the default is staff, not owner', () => {
    expect(m.DEFAULT_ROLE).toBe('staff');
  });

  // ⚠️ THE MOST IMPORTANT TEST IN THIS FILE. Every membership in production is written `true`, so
  // this is what the whole database says on the day the rules land: everyone keeps working,
  // nobody holds owner powers until the backfill.
  test('a plain `true` membership is a member, and is staff', () => {
    const doc = { locations: { bakery: true } };
    expect(s.locationsOf(doc)).toStrictEqual(['bakery']);
    expect(m.roleOf(doc, 'bakery')).toBe('staff');
    expect(m.isOwner(doc, 'bakery')).toBe(false);
  });

  // ⚠️ THE SECOND MOST IMPORTANT. locationsOf() used to filter on `=== true`, so without this an
  // OWNER would have had no locations at all and would have been locked out of the app entirely
  // by the change meant to give them more power.
  test('an owner is still a member, and can still open the location', () => {
    const doc = { locations: { bakery: 'owner' } };
    expect(s.locationsOf(doc)).toStrictEqual(['bakery']);
    expect(m.roleOf(doc, 'bakery')).toBe('owner');
    expect(m.isOwner(doc, 'bakery')).toBe(true);
  });

  test('no document at all: no access, and certainly not owner', () => {
    for (const doc of [null, undefined, {}, { locations: null }]) {
      expect(s.locationsOf(doc), String(doc)).toStrictEqual([]);
      expect(m.roleOf(doc, 'bakery'), String(doc)).toBe('staff');
      expect(m.isOwner(doc, 'bakery'), String(doc)).toBe(false);
    }
  });

  test('a corrupt locations field resolves to no access rather than throwing', () => {
    for (const broken of [[], 'owner', 42, true]) {
      const doc = { locations: broken };
      expect(s.locationsOf(doc), String(broken)).toStrictEqual([]);
      expect(m.isOwner(doc, 'bakery'), String(broken)).toBe(false);
    }
  });

  // ── A value nobody recognises is never access, and never MORE power ────────

  // ⚠️ 'head-chef' is a real word in this app — it is the title a manager can be called by — which
  // makes it exactly the value somebody might one day write into a membership by hand, thinking
  // it is a role. It is not, and it must still grant NOTHING.
  test('a value from a future version of the app grants nothing at all', () => {
    const doc = { locations: { bakery: 'head-chef' } };
    expect(s.locationsOf(doc), 'not even membership').toStrictEqual([]);
    expect(m.roleOf(doc, 'bakery')).toBe('staff');
    expect(m.isOwner(doc, 'bakery')).toBe(false);
    expect(m.canManage(doc, 'bakery')).toBe(false);
  });

  test('the value is case sensitive: Owner is not owner', () => {
    for (const bad of ['Owner', 'OWNER', ' owner', 'owner ']) {
      const doc = { locations: { bakery: bad } };
      expect(m.isOwner(doc, 'bakery'), bad).toBe(false);
      expect(s.locationsOf(doc), bad).toStrictEqual([]);
    }
  });

  test('false and truthy-but-wrong values are not access', () => {
    for (const bad of [false, 0, 1, 'true', 'yes', null, {}, ['owner']]) {
      const doc = { locations: { bakery: bad } };
      expect(s.accessValue(doc, 'bakery'), String(bad)).toBe(false);
      expect(m.isOwner(doc, 'bakery'), String(bad)).toBe(false);
    }
  });

  // ⚠️ A stray space is invisible in the Firebase console and the backfill is typed there by hand.
  // locationsOf() has always refused one in the KEY, because firestore.rules does not forgive one
  // either; the VALUE is refused for the same reason. Being kinder than the rules draws a delete
  // button the database refuses.
  test('a location key typed with a stray space grants nothing', () => {
    const doc = { locations: { 'bakery ': 'owner' } };
    expect(s.locationsOf(doc)).toStrictEqual([]);
    expect(m.isOwner(doc, 'bakery')).toBe(false);
  });

  // ── One location at a time ─────────────────────────────────────────────────

  test('owner of one location is only staff in the other', () => {
    const doc = { locations: { bakery: 'owner', restaurant: true } };
    expect(s.locationsOf(doc)).toStrictEqual(['bakery', 'restaurant']);
    expect(m.isOwner(doc, 'bakery')).toBe(true);
    expect(m.isOwner(doc, 'restaurant')).toBe(false);
    expect(m.roleOf(doc, 'restaurant')).toBe('staff');
  });

  test('owner of two locations', () => {
    const doc = { locations: { bakery: 'owner', restaurant: 'owner' } };
    expect(m.isOwner(doc, 'bakery')).toBe(true);
    expect(m.isOwner(doc, 'restaurant')).toBe(true);
  });

  test('a location that is not yours at all', () => {
    const doc = { locations: { bakery: 'owner' } };
    expect(m.isOwner(doc, 'somebody-else')).toBe(false);
    expect(m.roleOf(doc, 'somebody-else')).toBe('staff');
  });

  // ── The small pieces ───────────────────────────────────────────────────────

  test('there are three roles and no more', () => {
    expect([...m.ROLES]).toStrictEqual(['owner', 'manager', 'staff']);
  });

  test('isValidRole refuses everything that is not one of the three', () => {
    expect(m.isValidRole('owner')).toBe(true);
    expect(m.isValidRole('manager')).toBe(true);
    expect(m.isValidRole('staff')).toBe(true);
    for (const bad of ['head-chef', 'Owner', 'Manager', '', ' staff', null, undefined, 1, {}, true]) {
      expect(m.isValidRole(bad), String(bad)).toBe(false);
    }
  });

  // ── The manager: runs the location, hires nobody ───────────────────────────

  // ⚠️ THE DEFECT THIS CATCHES HAS ALREADY HAPPENED ONCE, with 'owner'. locationsOf() filtered on
  // `=== true`, so the very accounts holding the new value could not enter the app AT ALL — the app
  // opened on "no location yet" while the database said they were members. Any new access value
  // must be added in BOTH places, and this is what says so.
  test('a manager is a member, and can actually enter', () => {
    const doc = { locations: { bakery: 'manager' } };
    expect(s.locationsOf(doc)).toStrictEqual(['bakery']);
    expect(s.accessValue(doc, 'bakery')).toBe('manager');
    expect(m.roleOf(doc, 'bakery')).toBe('manager');
  });

  // ⚠️ The two upper roles differ in EXACTLY ONE thing, and it is not deleting.
  test('a manager deletes like an owner, but hires like nobody', () => {
    const manager = { locations: { bakery: 'manager' } };
    expect(m.canManage(manager, 'bakery'), 'runs the place').toBe(true);
    expect(m.isOwner(manager, 'bakery'), 'invites nobody').toBe(false);
  });

  test('an ordinary employee runs nothing and hires nobody', () => {
    const employee = { locations: { bakery: true } };
    expect(m.roleOf(employee, 'bakery')).toBe('staff');
    expect(m.canManage(employee, 'bakery')).toBe(false);
    expect(m.isOwner(employee, 'bakery')).toBe(false);
  });

  test('an owner can do both', () => {
    const owner = { locations: { bakery: 'owner' } };
    expect(m.canManage(owner, 'bakery')).toBe(true);
    expect(m.isOwner(owner, 'bakery')).toBe(true);
  });

  // The same case sensitivity the value has always had, now for the new word.
  test('Manager is not manager, and a stray space is not manager either', () => {
    for (const bad of ['Manager', 'MANAGER', ' manager', 'manager ']) {
      const doc = { locations: { bakery: bad } };
      expect(s.locationsOf(doc), bad).toStrictEqual([]);
      expect(m.canManage(doc, 'bakery'), bad).toBe(false);
    }
  });

  test('one person can be a manager in one location and an employee in another', () => {
    const doc = { locations: { bakery: 'manager', restaurant: true } };
    expect(s.locationsOf(doc)).toStrictEqual(['bakery', 'restaurant']);
    expect(m.canManage(doc, 'bakery')).toBe(true);
    expect(m.canManage(doc, 'restaurant')).toBe(false);
  });

  // ── «Head chef»: a job title, and NOT a fourth level of power ──────────────
  //
  // Federico, 13 Aug 2026: «aggiungi head chef come figura della cucina ma è come il ruolo del
  // manager». The whole danger of this feature is that it LOOKS like a role: the title changes the
  // WORD and never the POWER. (The title/label tests are not ported: they run through the current
  // app's dictionary.)

  test('a head chef holds the manager membership value, not one of its own', () => {
    // ⚠️ A new membership value must be added in THREE places — js/sections.js, firestore.rules,
    // functions/onboarding.js — and one that any of them does not recognise is a LOCKOUT, not a
    // demotion (v268, missed in all three on three separate days). So there is no new value:
    // 'head-chef' must never appear in ROLES.
    expect(m.ROLES.includes('head-chef' as never),
      'head-chef must not be a role — it is a label on the manager level').toBe(false);
    expect(m.isValidRole('head-chef')).toBe(false);

    // And the membership a head chef actually holds behaves exactly as a manager's.
    const chef = { locations: { bakery: 'manager' } };
    expect(m.canManage(chef, 'bakery')).toBe(true);
    expect(m.isOwner(chef, 'bakery')).toBe(false);
  });

  // ── Added: the answers always stay inside the three roles ──────────────────

  test('roleOf only ever answers one of the three roles, whatever the document says', () => {
    const VALUES = [true, false, 'owner', 'manager', 'staff', 'Owner', 'owner ', 'admin', 'head-chef', 0, 1, null, {}, []];
    for (const value of VALUES) {
      const doc = { locations: { bakery: value } };
      expect(m.isValidRole(m.roleOf(doc, 'bakery')), JSON.stringify(value)).toBe(true);
    }
    for (const doc of [null, undefined, 'owner', 42, [], { locations: 'owner' }]) {
      expect(m.roleOf(doc, 'bakery'), JSON.stringify(doc)).toBe('staff');
    }
  });

  test('the list of roles is frozen, so nobody can add a fourth at run time', () => {
    expect(Object.isFrozen(m.ROLES)).toBe(true);
  });

  test('canManage and isOwner agree with roleOf for every access value', () => {
    for (const value of [true, 'manager', 'owner', false, 'Owner', null]) {
      const doc = { locations: { bakery: value } };
      const role = m.roleOf(doc, 'bakery');
      expect(m.isOwner(doc, 'bakery'), JSON.stringify(value)).toBe(role === 'owner');
      expect(m.canManage(doc, 'bakery'), JSON.stringify(value)).toBe(role === 'owner' || role === 'manager');
    }
  });
});
