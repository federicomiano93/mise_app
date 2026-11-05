// Unit tests for what a client may order and what the order becomes in the Calculator (P15 — the owner cannot read
// code, and these numbers decide how much dough is made), run against BOTH implementations: the TypeScript port in
// shared/ and js/client-order-model.js, which the live app uses today. Ported from tests/client-order-model.test.mjs.
//
// Client names here are placeholders on purpose: this repo is public.
//
// client-order-model.ts is an ADAPTED port, so parity.spec.ts does not pair it: `orderRows` takes the word for a
// deleted product as a third argument (the original looks it up in the interface dictionary, which in Mise 2
// belongs to the app), so its arity differs by design. The tests of `orderRows` hand the port the very word the
// original looks up in English ('Deleted product'; the original ignores a third argument), so both files must give
// the same text. The block after the shared tests stands in for what pairing would have checked (names, constants,
// function shapes).
//
// PORTED from tests/client-order-model.test.mjs: every test runs against both files.

import { describe, expect, test } from 'vitest';
import * as ported from './client-order-model';
import * as legacyJs from '../../js/client-order-model.js';

const legacy = legacyJs as unknown as typeof ported;

// What the original's `t('co.deletedProduct')` says in English, which is the language a test run has.
const DELETED_WORD = 'Deleted product';

// Local wall-clock times, built the way a person reads them — a UTC timestamp would not say which local day, and
// the whole cutoff is a local-clock idea.
const at = (y: number, m: number, d: number, h = 0, min = 0): number => new Date(y, m - 1, d, h, min).getTime();

const MON_0900 = at(2026, 8, 10, 9, 0);   // Monday morning
const MON_1730 = at(2026, 8, 10, 17, 30); // Monday, after a 16:00 cutoff

const CLIENT = {
  id: 'c-one', name: 'CLIENT A', products: [
    { id: 'p-buns', name: 'Buns', kind: 'number', weight: 71, recipeId: 'brioche' },
    { id: 'p-loaf', name: 'Loaf', kind: 'kg', weight: 905, recipeId: 'sourdough' },
  ],
};

const NOW_ISO = '2026-08-10T09:00:00.000Z';

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const MENU = m.menuFor(CLIENT);

  const build = (over: Record<string, unknown> = {}) => m.buildOrder({
    date: '2026-08-11', clientId: 'c-one', clientName: 'CLIENT A',
    quantities: { 'p-buns': 40 }, note: '', menu: MENU, nowIso: NOW_ISO, ...over,
  });

  // ── Dates ──────────────────────────────────────────────────────────────────

  test('a date that only LOOKS valid is refused', () => {
    expect(m.isISODate('2026-08-11')).toBe(true);
    expect(m.isISODate('2026-02-31')).toBe(false); // passes the pattern, then becomes 3 March
    expect(m.isISODate('2026-13-01')).toBe(false);
    expect(m.isISODate('11/08/2026')).toBe(false);
    expect(m.isISODate('')).toBe(false);
    expect(m.isISODate(null)).toBe(false);
  });

  test('a timestamp names its LOCAL day, not the UTC one', () => {
    // 00:30 local. toISOString() would name the previous day anywhere east of Greenwich, which would file an order
    // under a day the client never chose.
    expect(m.toISODate(at(2026, 8, 11, 0, 30))).toBe('2026-08-11');
    expect(m.toISODate(at(2026, 8, 11, 23, 30))).toBe('2026-08-11');
  });

  test('startOfDayMs is midnight local, and NaN for a non-date', () => {
    expect(m.startOfDayMs('2026-08-11')).toBe(at(2026, 8, 11, 0, 0));
    expect(Number.isNaN(m.startOfDayMs('nonsense'))).toBe(true);
  });

  // ── The cutoff ─────────────────────────────────────────────────────────────

  test('a cutoff is read as a clock time', () => {
    expect(m.cutoffMinutes('16:00')).toBe(960);
    expect(m.cutoffMinutes('00:00')).toBe(0);
    expect(m.cutoffMinutes('23:59')).toBe(1439);
    expect(m.cutoffMinutes(' 16:00 ')).toBe(960);
  });

  test('an unreadable cutoff leaves the door OPEN, never shut', () => {
    // ⚠️ The direction matters. A corrupt setting that CLOSED the door would stop every client ordering, with
    // nothing on screen explaining why — a fault that looks exactly like the business having no customers.
    for (const bad of ['25:00', '16:60', 'sixteen', '16', '', null, undefined, 42, {}]) {
      expect(m.cutoffMinutes(bad), `expected no cutoff for ${JSON.stringify(bad)}`).toBeNull();
    }
    expect(m.isDateOpen('2026-08-11', MON_1730, 'nonsense')).toBe(true);
  });

  test('the door for a day shuts at the cutoff on the day BEFORE it', () => {
    expect(m.closesAtMs('2026-08-11', '16:00')).toBe(at(2026, 8, 10, 16, 0));
    expect(m.closesAtMs('2026-08-01', '16:00')).toBe(at(2026, 7, 31, 16, 0)); // across a month
    expect(m.closesAtMs('2026-08-11', null)).toBeNull();
  });

  test('tomorrow is open before the cutoff and shut after it', () => {
    expect(m.isDateOpen('2026-08-11', MON_0900, '16:00')).toBe(true);
    expect(m.isDateOpen('2026-08-11', MON_1730, '16:00')).toBe(false);
    // The day after tomorrow is still open at 17:30 — its own door shuts tomorrow.
    expect(m.isDateOpen('2026-08-12', MON_1730, '16:00')).toBe(true);
  });

  test('TODAY is never orderable while a cutoff is set — that is what a deadline means', () => {
    expect(m.isDateOpen('2026-08-10', MON_0900, '16:00')).toBe(false);
    // …and IS orderable when the bakery has no cutoff at all.
    expect(m.isDateOpen('2026-08-10', MON_0900, null)).toBe(true);
  });

  test('the past is refused whatever the cutoff says', () => {
    expect(m.isDateOpen('2026-08-09', MON_0900, null)).toBe(false);
    expect(m.isDateOpen('2026-08-09', MON_0900, '16:00')).toBe(false);
  });

  test('an unreadable clock offers no day at all', () => {
    // Same choice as the WhatsApp prefill: a broken clock must not silently behave like "no limit", because that
    // failure looks exactly like the feature working.
    expect(m.orderableDates(0, '16:00')).toStrictEqual([]);
    expect(m.orderableDates(NaN, null)).toStrictEqual([]);
    expect(m.isDateOpen('2026-08-11', NaN, null)).toBe(false);
  });

  test('the offered days are the open ones, soonest first', () => {
    expect(m.orderableDates(MON_1730, '16:00', 3)).toStrictEqual(['2026-08-12', '2026-08-13']);
  });

  test('with no cutoff the list starts today', () => {
    expect(m.orderableDates(MON_0900, null, 2)).toStrictEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  test('the picker opens on TOMORROW', () => {
    expect(m.defaultOrderDate(MON_0900, '16:00')).toBe('2026-08-11');
  });

  test('…on the next open day once tomorrow has shut', () => {
    expect(m.defaultOrderDate(MON_1730, '16:00')).toBe('2026-08-12');
  });

  test('…and never on today, even when today is open', () => {
    // An evening tap would otherwise quietly order for a day that is nearly over.
    expect(m.defaultOrderDate(MON_1730, null)).toBe('2026-08-11');
  });

  test('nothing open means no default — the page must say so, not show an empty picker', () => {
    expect(m.defaultOrderDate(MON_1730, '16:00', 1)).toBe('');
  });

  // ── The deadline as a setting ──────────────────────────────────────────────

  test('an EMPTY deadline is a real answer — no deadline at all', () => {
    // ⚠️ A bakery that takes same-day orders clears the box. Treating empty as "not filled in" and substituting a
    // default would impose a deadline nobody asked for, and the only symptom would be customers quietly unable to
    // order for today.
    expect(m.normalizeCutoff('')).toBe('');
    expect(m.normalizeCutoff(null)).toBe('');
    expect(m.isDateOpen('2026-08-10', MON_0900, m.normalizeCutoff(''))).toBe(true);
  });

  test('a deadline that is not a time is treated as none, never as the default', () => {
    expect(m.normalizeCutoff('sixteen')).toBe('');
    expect(m.normalizeCutoff('25:00')).toBe('');
    expect(m.normalizeCutoff('16:00')).toBe('16:00');
    expect(m.normalizeCutoff(' 16:00 ')).toBe('16:00');
  });

  // ── Arriving late ──────────────────────────────────────────────────────────

  test('an order sent before its deadline did not arrive late', () => {
    const order = { date: '2026-08-11', updatedAt: new Date(MON_0900).toISOString() };
    expect(m.arrivedLate(order, '16:00')).toBe(false);
  });

  test('an order sent AFTER its deadline is flagged', () => {
    // ⚠️ It is shown, not refused: the security rules keep only a coarse floor on dates (they cannot express a
    // local clock time without being an hour wrong for half the year), so making a late one visible is what turns
    // that from a hole into a decision the bakery gets to make.
    const order = { date: '2026-08-11', updatedAt: new Date(MON_1730).toISOString() };
    expect(m.arrivedLate(order, '16:00')).toBe(true);
  });

  test('with no deadline, nothing can be late', () => {
    const order = { date: '2026-08-11', updatedAt: new Date(MON_1730).toISOString() };
    expect(m.arrivedLate(order, '')).toBe(false);
    expect(m.arrivedLate(order, null)).toBe(false);
  });

  test('an order with no timestamp is not accused of being late', () => {
    expect(m.arrivedLate({ date: '2026-08-11' }, '16:00')).toBe(false);
    expect(m.arrivedLate({ date: '2026-08-11', updatedAt: 'nonsense' }, '16:00')).toBe(false);
    expect(m.arrivedLate(null, '16:00')).toBe(false);
  });

  // ── Ids ────────────────────────────────────────────────────────────────────

  test('a client id may not contain an underscore', () => {
    // ⚠️ The security rules recover the client from `{date}_{clientId}` by splitting on the underscore. One inside
    // the id would split into three and compare the wrong half — a rule that fails open or closed depending on
    // the customer's name.
    expect(m.isValidOrderClientId('c-farofish')).toBe(true);
    expect(m.isValidOrderClientId('c-faro_fish')).toBe(false);
    expect(m.isValidOrderClientId('')).toBe(false);
    expect(m.isValidOrderClientId('-leading')).toBe(false);
    expect(m.isValidOrderClientId('a'.repeat(65))).toBe(false);
  });

  test('an order id is built in one place, and refuses to guess', () => {
    expect(m.orderDocId('2026-08-11', 'c-farofish')).toBe('2026-08-11_c-farofish');
    expect(() => m.orderDocId('11-08-2026', 'c-farofish')).toThrow(/Invalid order date/);
    expect(() => m.orderDocId('2026-08-11', 'c_bad')).toThrow(/Invalid client id/);
  });

  // ── The address behind a link ──────────────────────────────────────────────

  test('the link account\'s address is built in ONE place, and folded to lower case', () => {
    // ⚠️ Firebase Auth stores an email folded to lower case, so a mixed-case token creates an account whose
    // address does not match the string that created it. Sign-in happens to fold it the same way — this works by
    // ACCIDENT unless the folding is done here, on purpose, by the one function both sides call.
    expect(m.linkEmailFor('AbC-123_xY')).toBe('cabc-123_xy@orders.theitalianclub.invalid');
    expect(m.linkEmailFor('abc-123_xy')).toBe(m.linkEmailFor('AbC-123_xY'));
  });

  test('…and it is a valid, unreachable address whatever the token starts with', () => {
    // `.invalid` is reserved by RFC 2606: it can never receive mail and can never collide with somebody's real
    // address. The leading letter keeps the local part valid for a token starting with a digit or a dash.
    for (const token of ['9starts-with-a-digit', '-starts-with-a-dash', '_underscore']) {
      const email = m.linkEmailFor(token);
      expect(email, email).toMatch(/^[a-z][a-z0-9\-_]*@orders\.theitalianclub\.invalid$/);
    }
    expect(m.linkEmailFor(null)).toBe('c@orders.theitalianclub.invalid');
  });

  // ── The published menu ─────────────────────────────────────────────────────

  test('a menu carries only what a client needs to order', () => {
    expect(m.menuFor(CLIENT)).toStrictEqual({
      clientName: 'CLIENT A',
      products: [
        { id: 'p-buns', name: 'Buns', kind: 'number' },
        { id: 'p-loaf', name: 'Loaf', kind: 'kg' },
      ],
    });
  });

  test('a PAUSED product is not offered', () => {
    // It leaves the Calculator entirely, so offering it would let a client order something the bakery has decided
    // not to make.
    const paused = { ...CLIENT, products: [CLIENT.products[0], { ...CLIENT.products[1], active: false }] };
    expect(m.menuFor(paused).products.map(p => p.id)).toStrictEqual(['p-buns']);
  });

  test('a menu built from nothing is empty rather than broken', () => {
    expect(m.menuFor(null)).toStrictEqual({ clientName: '', products: [] });
    expect(m.menuFor({ name: 'X' })).toStrictEqual({ clientName: 'X', products: [] });
  });

  test('a menu is republished only when it really moved', () => {
    const wanted = m.menuFor(CLIENT);
    const [first, second] = wanted.products as [{ id: string; name: string; kind: string }, { id: string; name: string; kind: string }];
    expect(m.menuChanged(wanted, wanted)).toBe(false);
    expect(m.menuChanged(null, wanted)).toBe(true);
    expect(m.menuChanged({ ...wanted, clientName: 'RENAMED' }, wanted)).toBe(true);
    expect(m.menuChanged({ ...wanted, products: [first] }, wanted)).toBe(true);
    expect(m.menuChanged({ ...wanted, products: [second, first] }, wanted)).toBe(true);
    const renamed = { ...wanted, products: [{ ...first, name: 'Baps' }, second] };
    expect(m.menuChanged(renamed, wanted)).toBe(true);
    const rekinded = { ...wanted, products: [{ ...first, kind: 'kg' }, second] };
    expect(m.menuChanged(rekinded, wanted)).toBe(true);
  });

  // The bakery's name and country travel with the menu (not in the original test file, which predates them): the
  // comparison and the omission are the behaviour pinned here, against both files.
  test('the bakery name and country travel with the menu, trimmed and only when valid', () => {
    expect(m.menuFor(CLIENT, '  The Bakery  ', 'IT')).toStrictEqual({
      clientName: 'CLIENT A',
      products: [{ id: 'p-buns', name: 'Buns', kind: 'number' }, { id: 'p-loaf', name: 'Loaf', kind: 'kg' }],
      bakeryName: 'The Bakery',
      country: 'IT',
    });
    expect('bakeryName' in m.menuFor(CLIENT, '   ', 'XX')).toBe(false);
    expect('country' in m.menuFor(CLIENT, '', 'XX')).toBe(false);
    expect(m.menuFor(CLIENT, 'x'.repeat(300)).bakeryName).toHaveLength(200);
  });

  test('a changed bakery name or country republishes the menu', () => {
    const base = m.menuFor(CLIENT, 'Old', 'GB');
    expect(m.menuChanged(base, m.menuFor(CLIENT, 'Old', 'GB'))).toBe(false);
    expect(m.menuChanged(base, m.menuFor(CLIENT, 'New', 'GB'))).toBe(true);
    expect(m.menuChanged(base, m.menuFor(CLIENT, 'Old', 'IT'))).toBe(true);
    expect(m.menuChanged(base, m.menuFor(CLIENT, 'Old'))).toBe(true);
  });

  // ── Quantities ─────────────────────────────────────────────────────────────

  test('only real, positive quantities survive', () => {
    expect(m.normalizeQuantities({ a: 5, b: 0, c: -3, d: 'x', e: null, f: '7' })).toStrictEqual({ a: 5, f: 7 });
  });

  test('a quantity cannot run away', () => {
    expect(m.normalizeQuantities({ a: 9e9 })).toStrictEqual({ a: m.MAX_QTY });
  });

  test('a corrupt quantity map is empty, never NaN', () => {
    expect(m.normalizeQuantities(null)).toStrictEqual({});
    expect(m.normalizeQuantities('nope')).toStrictEqual({});
    expect(m.normalizeQuantities({ a: NaN, b: Infinity })).toStrictEqual({});
  });

  // ── Building the order ─────────────────────────────────────────────────────

  test('an order names what was ordered, at the moment it was ordered', () => {
    // ⚠️ Frozen names, same reason orders-history froze its own: a product renamed or deleted afterwards must not
    // turn a received order into a row of raw ids.
    expect(build().names).toStrictEqual({ 'p-buns': 'Buns' });
  });

  test('only ORDERED products are named — the freeze is not a copy of the menu', () => {
    expect(Object.keys(build({ quantities: { 'p-loaf': 2 } }).names)).toStrictEqual(['p-loaf']);
  });

  test('correcting an order keeps when it was first sent, and moves when it changed', () => {
    const first = build();
    const later = build({ quantities: { 'p-buns': 60 }, nowIso: '2026-08-10T11:00:00.000Z', existing: first });
    expect(later.createdAt).toBe(NOW_ISO);
    expect(later.updatedAt).toBe('2026-08-10T11:00:00.000Z');
    expect(later.quantities).toStrictEqual({ 'p-buns': 60 });
  });

  test('a correction carries forward the fact that the bakery already used the order', () => {
    // ⚠️ THE RULES REFUSE THE WRITE IF IT DOES NOT. A correction is written WHOLE, so omitting these would erase
    // the record that this order had been put into the Calculator — and the screen would stop warning that it
    // changed afterwards.
    const used = { ...build(), appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: NOW_ISO };
    const corrected = build({ quantities: { 'p-buns': 60 }, nowIso: '2026-08-10T11:00:00.000Z', existing: used });
    expect(corrected.appliedAt).toBe('2026-08-10T10:00:00.000Z');
    expect(corrected.appliedFor).toBe(NOW_ISO);
    // …and the correction is then visible AS a change, which is the whole purpose.
    expect(m.orderChangedSinceApplied(corrected)).toBe(true);
  });

  test('a first order carries no applied fields at all — the rules refuse them', () => {
    expect('appliedAt' in build()).toBe(false);
    expect('appliedFor' in build()).toBe(false);
    expect('appliedAt' in build({ existing: { createdAt: NOW_ISO } })).toBe(false);
  });

  test('a note is kept but cannot become a novel', () => {
    expect(build({ note: '  half cut  ' }).note).toBe('  half cut  ');
    expect(build({ note: 'x'.repeat(9999) }).note.length).toBe(m.MAX_NOTE);
    expect(build({ note: null }).note).toBe('');
  });

  // ── Changed after it was used ──────────────────────────────────────────────

  test('an order nobody has used yet is not "changed"', () => {
    expect(m.orderChangedSinceApplied(build())).toBe(false);
    expect(m.isApplied(build())).toBe(false);
  });

  test('an order used and then left alone is not "changed"', () => {
    const order = { ...build(), appliedAt: '2026-08-10T10:00:00.000Z', appliedFor: NOW_ISO };
    expect(m.orderChangedSinceApplied(order)).toBe(false);
    expect(m.isApplied(order)).toBe(true);
  });

  test('an order CHANGED after it was used says so — this is the one that bakes wrong', () => {
    const order = {
      ...build({ nowIso: '2026-08-10T11:00:00.000Z' }),
      appliedAt: '2026-08-10T10:00:00.000Z',
      appliedFor: NOW_ISO,
    };
    expect(m.orderChangedSinceApplied(order)).toBe(true);
  });

  test('a change inside the same second is still a change', () => {
    // ⚠️ Comparing "applied at" with "updated at" as two CLOCKS would miss this one and would also cry stale
    // whenever the two were written a moment apart. `appliedFor` records WHICH version was used, so neither
    // happens.
    const order = { ...build(), appliedAt: NOW_ISO, appliedFor: '2026-08-10T08:59:59.000Z' };
    expect(m.orderChangedSinceApplied(order)).toBe(true);
  });

  // ── Reading an order back ──────────────────────────────────────────────────

  const liveNames: Record<string, string> = { 'p-buns': 'Burger buns', 'p-loaf': 'Loaf' };
  const liveNameOf = (id: string): string => liveNames[id] || '';
  // The port takes the word for a deleted product; the original ignores a third argument and looks it up itself.
  const rowsOf = (order: unknown, live: unknown) => m.orderRows(order, live, DELETED_WORD);

  test('the lines read in a stable order, by name', () => {
    const order = build({ quantities: { 'p-loaf': 2, 'p-buns': 40 } });
    expect(rowsOf(order, liveNameOf).map(r => r.name)).toStrictEqual(['Burger buns', 'Loaf']);
    expect(m.orderTotalLines(order)).toBe(2);
  });

  test('a RENAMED product shows its new name', () => {
    expect(rowsOf(build(), liveNameOf)[0]?.name).toBe('Burger buns');
  });

  test('a DELETED product still says what it was, and is flagged', () => {
    const order = build({ quantities: { 'p-gone': 3 }, menu: { products: [{ id: 'p-gone', name: 'Old thing' }] } });
    const [row] = rowsOf(order, liveNameOf);
    expect(row?.name).toBe('Old thing');
    expect(row?.missing).toBe(true);
  });

  test('…and with nothing frozen either, it never shows a raw id', () => {
    const order = { quantities: { 'p-gone': 3 } };
    expect(rowsOf(order, liveNameOf)[0]?.name).toBe('Deleted product');
  });

  // ── Into the Calculator ────────────────────────────────────────────────────

  test('an order becomes the Calculator\'s own quantity keys', () => {
    expect(m.calculatorPatch(build(), CLIENT.products)).toStrictEqual({
      'c-one::p-buns': 40,
      'c-one::p-loaf': 0,
    });
  });

  test('a product the order does NOT mention is set to zero', () => {
    // ⚠️ The order is the client's complete statement. A 5 left over from yesterday in a field they did not ask
    // for today is a wrong number, and it is exactly the kind of leftover that gets baked.
    const patch = m.calculatorPatch(build({ quantities: { 'p-loaf': 2 } }), CLIENT.products);
    expect(patch['c-one::p-buns']).toBe(0);
    expect(patch['c-one::p-loaf']).toBe(2);
  });

  test('a paused product has no field, so it gets no entry', () => {
    const products = [CLIENT.products[0], { ...CLIENT.products[1], active: false }];
    expect(Object.keys(m.calculatorPatch(build(), products))).toStrictEqual(['c-one::p-buns']);
  });

  test('a line for a product the client no longer has is skipped, not invented', () => {
    const order = build({ quantities: { 'p-gone': 3, 'p-buns': 40 } });
    expect(m.calculatorPatch(order, CLIENT.products)).toStrictEqual({
      'c-one::p-buns': 40,
      'c-one::p-loaf': 0,
    });
  });

  test('an order with no client fills nothing at all', () => {
    expect(m.calculatorPatch({ quantities: { 'p-buns': 40 } }, CLIENT.products)).toStrictEqual({});
  });

  test('the horizon and the limits are the numbers the rules and the screen were built on', () => {
    expect(m.ORDER_HORIZON_DAYS).toBe(14);
    expect(m.CUTOFF_DEFAULT).toBe('16:00');
    expect(m.MAX_NOTE).toBe(500);
    expect(m.MAX_LINES).toBe(200);
    expect(m.MAX_QTY).toBe(100000);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port exports what the current app’s file does', () => {
  test('the same names, the same constants, functions of the same name (orderRows differs in arity by design)', () => {
    const ts = ported as Record<string, unknown>;
    const js = legacyJs as Record<string, unknown>;
    expect(Object.keys(ts).sort()).toStrictEqual(Object.keys(js).sort());
    for (const name of Object.keys(js)) {
      const a = ts[name];
      const b = js[name];
      if (typeof b === 'function') {
        expect(typeof a, name).toBe('function');
        expect((a as { name: string }).name, name).toBe((b as { name: string }).name);
        if (name !== 'orderRows') expect((a as { length: number }).length, name).toBe((b as { length: number }).length);
      } else if (b instanceof RegExp) {
        expect(a, name).toBeInstanceOf(RegExp);
        expect((a as RegExp).source, name).toBe(b.source);
      } else {
        expect(a, name).toBe(b);
      }
    }
    expect(ported.orderRows.length).toBe(legacy.orderRows.length + 1);
  });
});
