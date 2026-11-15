// The four ways an order can leave the app, and who may use which (P15), run against BOTH implementations: the
// TypeScript port in shared/ and js/orders/send-routes.js, which the live app uses today. Ported from
// tests/send-routes.test.mjs; the module is a FULL port, so parity.spec.ts also compares its exports.
//
// PORTED: 20 of 20 tests of tests/send-routes.test.mjs. Added: routeSendsToSupplier, which the original file has
// no test for.
//
// ⚠️ THE TESTS THAT MATTER MOST ARE THE ONES THAT KEEP AN ORDER ABLE TO LEAVE. A
// restriction feature has one catastrophic failure mode — the order that can no
// longer get out at all — and it has three separate doors: every switch off, a
// preference pointing at a closed road, and a corrupt document read as "nothing
// allowed". Each has a test below.

import { describe, expect, test } from 'vitest';
import * as ported from './send-routes';
import * as legacyJs from '../../js/orders/send-routes.js';

const legacy = legacyJs as unknown as typeof ported;

const ALL_OFF = { manager: false, whatsapp: false, whatsappSupplier: false, email: false };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const {
    ROUTES, DEFAULT_ROUTES, normalizeSendRoutes, routesFor, listsAreTheOnlyRoad, effectiveRoutes,
    routeAvailableFor, unreachable, validateRoutes, toStored, routeSendsToSupplier,
  } = m;

  // ── ⚠️ AN ORDER MUST ALWAYS BE ABLE TO LEAVE ───────────────────────────────

  // ⚠️ THE STRUCTURAL ONE. If the switches applied to everybody, turning WhatsApp off
  // to hold an employee back would disarm the person who then has to reach the
  // supplier, and the order could never leave the building.
  test('⚠️ a manager or owner keeps ALL FOUR roads whatever the switches say', () => {
    const settings = normalizeSendRoutes({ sendRoutes: ALL_OFF });
    expect(routesFor(settings, { canManage: true })).toStrictEqual([...ROUTES]);
  });

  test('an employee gets only what is switched on', () => {
    const settings = normalizeSendRoutes({
      sendRoutes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false },
    });
    expect(routesFor(settings, { canManage: false })).toStrictEqual(['manager']);
  });

  // ⚠️ Refused OUT LOUD, so it reads as a message rather than a switch that
  // mysteriously will not stay off.
  test('⚠️ the last road cannot be closed', () => {
    expect(validateRoutes(ALL_OFF, 'manager')).toStrictEqual({ ok: false, reason: 'none' });
  });

  // ⚠️ Left alone it would silently mean "no preference" and the app would offer
  // whatever came first — a setting that stopped doing what it says without saying so.
  test('⚠️ a preference pointing at a closed road is MOVED, not kept', () => {
    const r = validateRoutes({ ...DEFAULT_ROUTES, whatsapp: false }, 'whatsapp');
    expect(r.ok).toBe(true);
    expect((r as { preferred: unknown }).preferred, 'moved to a road that is actually open').toBe('manager');
  });

  test('a preference on an open road is left exactly as it is', () => {
    const r = validateRoutes(DEFAULT_ROUTES, 'whatsapp');
    expect((r as { preferred: unknown }).preferred).toBe('whatsapp');
  });

  // ⚠️ An order that cannot leave the app at all is a worse failure than one that can
  // leave by a road somebody meant to close.
  test('⚠️ a corrupt document falls back to the defaults, never to "nothing allowed"', () => {
    ['', null, undefined, 42, { sendRoutes: 'yes' }, { sendRoutes: [] }].forEach(doc => {
      const s = normalizeSendRoutes(doc);
      expect(routesFor(s, {}).length, `${JSON.stringify(doc)} left no way out`).toBeGreaterThan(0);
    });
    expect(normalizeSendRoutes(null).routes).toStrictEqual({ ...DEFAULT_ROUTES });
  });

  // ⚠️ The settings screen refuses to save it, but a hand-written document, an older
  // version or a partial merge could still produce it.
  test('⚠️ a stored document with every road off is repaired on the way in', () => {
    const s = normalizeSendRoutes({ sendRoutes: ALL_OFF });
    expect(s.routes.manager, 'the in-app road is the one that comes back').toBe(true);
    expect(s.preferred).toBe('manager');
  });

  // ── The defaults ───────────────────────────────────────────────────────────

  // ⚠️ A default that switches on a way of contacting the OUTSIDE WORLD is a decision
  // made by nobody. A venue that has never been asked has agreed to nothing.
  test('⚠️ the two direct-to-supplier roads default to OFF', () => {
    expect(DEFAULT_ROUTES.whatsappSupplier).toBe(false);
    expect(DEFAULT_ROUTES.email).toBe(false);
    expect(DEFAULT_ROUTES.manager, 'and the two that already existed stay on').toBe(true);
    expect(DEFAULT_ROUTES.whatsapp).toBe(true);
  });

  test('a partially written document keeps its own values and defaults the rest', () => {
    const s = normalizeSendRoutes({ sendRoutes: { email: true } });
    expect(s.routes.email).toBe(true);
    expect(s.routes.whatsapp, 'untouched keys take the default').toBe(true);
    expect(s.routes.whatsappSupplier).toBe(false);
  });

  // ⚠️ Only a real boolean counts. A string "false" is truthy, and reading it as ON
  // would open a road the venue had closed.
  test('only a real boolean counts as a decision', () => {
    const s = normalizeSendRoutes({ sendRoutes: { whatsappSupplier: 'false', email: 1 } });
    expect(s.routes.whatsappSupplier, 'a string is not a decision').toBe(false);
    expect(s.routes.email, 'nor is a number').toBe(false);
  });

  // ── A road needs somewhere to go ───────────────────────────────────────────

  // ⚠️ Never a chat that opens blank or a mail addressed to nobody: those look like
  // the app failing, where "no number saved" names the thing to go and fix.
  test('⚠️ a direct road is unavailable for a supplier with no contact, and says which', () => {
    const withPhone = { id: 'a', name: 'A', phone: '447700900123' };
    const without = { id: 'b', name: 'B', phone: '  ' };

    expect(routeAvailableFor('whatsappSupplier', withPhone)).toBe(true);
    expect(routeAvailableFor('whatsappSupplier', without)).toBe(false);
    expect(unreachable('whatsappSupplier', [withPhone, without]).map(s => s.id)).toStrictEqual(['b']);
  });

  test('email needs an email, not a phone', () => {
    expect(routeAvailableFor('email', { phone: '447700900123' })).toBe(false);
    expect(routeAvailableFor('email', { email: 'a@b.test' })).toBe(true);
  });

  // ⚠️ The two that do NOT address a supplier are always available: one goes inside
  // the app, the other opens WhatsApp with no recipient for a person to choose.
  test('the two indirect roads never depend on a supplier', () => {
    expect(routeAvailableFor('manager', {})).toBe(true);
    expect(routeAvailableFor('whatsapp', {})).toBe(true);
    expect(routeAvailableFor('manager', null)).toBe(true);
    expect(unreachable('whatsapp', [{ id: 'x' }])).toStrictEqual([]);
  });

  // ── What reaches Firestore ─────────────────────────────────────────────────

  // ⚠️ EVERY KEY IS WRITTEN, and as a real boolean. config/{doc} validates a CLOSED
  // key list, and a half-written map is how a setting silently reverts.
  test('every road is stored explicitly, as a boolean', () => {
    const stored = toStored({ manager: true, whatsapp: 'yes' }, 'manager');
    expect(stored.sendRoutes).toStrictEqual({ manager: true, whatsapp: false, whatsappSupplier: false, email: false });
    expect(stored.preferredRoute).toBe('manager');
  });

  test('a missing preference is stored as an empty string, not undefined', () => {
    expect(toStored(DEFAULT_ROUTES, null).preferredRoute).toBe('');
    expect(typeof toStored(DEFAULT_ROUTES, undefined).preferredRoute).toBe('string');
  });

  test('the four roads are named once, and the screens read them from here', () => {
    expect([...ROUTES]).toStrictEqual(['manager', 'whatsapp', 'whatsappSupplier', 'email']);
  });

  // ── Order lists off for the whole venue (28 Sep 2026) ──
  test('order lists OFF takes the «to the manager» road from everybody, managers included', () => {
    const settings = { routes: { manager: true, whatsapp: true, whatsappSupplier: false, email: false }, orderLists: false };
    expect(routesFor(settings, { canManage: true })).toStrictEqual(ROUTES.filter(r => r !== 'manager'));
    expect(routesFor(settings, { canManage: false })).toStrictEqual(['whatsapp']);
  });

  test('order lists ON, or never set, changes nothing', () => {
    const settings = { routes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } };
    expect(routesFor(settings, { canManage: true })).toStrictEqual([...ROUTES]);
    expect(routesFor({ ...settings, orderLists: true }, { canManage: false })).toStrictEqual(['manager']);
  });

  test('lists are the only road when nothing else is on for staff', () => {
    expect(listsAreTheOnlyRoad({ routes: { manager: true, whatsapp: false, whatsappSupplier: false, email: false } })).toBe(true);
    expect(listsAreTheOnlyRoad({ routes: { manager: true, whatsapp: true, whatsappSupplier: false, email: false } })).toBe(false);
  });

  // ⚠️ With order lists off the manager road is gone for everybody, so it can never be
  // the one road «kept open» (review of 28 Sep 2026).
  test('lists off: closing the last real road is refused, even with manager stored on', () => {
    const routes = { manager: true, whatsapp: true, whatsappSupplier: false, email: false };
    const closingWhatsApp = effectiveRoutes({ ...routes, whatsapp: false }, false);
    expect(validateRoutes(closingWhatsApp, 'whatsapp').ok).toBe(false);
    expect(validateRoutes(effectiveRoutes({ ...routes, whatsapp: false }, true), 'whatsapp').ok,
      'with lists on, the manager road still counts').toBe(true);
  });

  // ── Added ──────────────────────────────────────────────────────────────────

  test('only WhatsApp-to-the-supplier and email put the order in the supplier\'s hands', () => {
    expect(ROUTES.filter(r => routeSendsToSupplier(r))).toStrictEqual(['whatsapp', 'whatsappSupplier', 'email']);
    expect(routeSendsToSupplier('manager')).toBe(false);
    expect(routeSendsToSupplier('post')).toBe(false);
    expect(routeSendsToSupplier(undefined)).toBe(false);
  });
});
