// Unit tests for the order list one person sends to another (P15), run against BOTH implementations: the TypeScript port in
// shared/ and js/orders/order-request-model.js, which the live app uses today. Ported from tests/order-request-model.test.mjs.
//
// What must never break:
//   - a row somebody left at 0 must NOT reach the manager's screen;
//   - an EMPTY list must not be creatable;
//   - a list is finished when every line is ticked, and by NOTHING else;
//   - the divergence warning goes quiet on a line that has been ticked;
//   - the window HIDES old lists and never drops them.
//
// ADAPTED ON PURPOSE (see the head of order-request-model.ts), tested on the port alone: `senderName` (no address, '' for nobody,
// his decision of 3 Nov 2026) and the words `groupRequest` takes as an argument.

import { describe, expect, test } from 'vitest';
import * as ported from './order-request-model';
import * as legacyJs from '../../js/orders/order-request-model.js';

const legacy = legacyJs as unknown as typeof ported;

const NOW = new Date('2026-08-14T09:00:00Z');
const SUPPLIERS = [{ id: 's1', name: 'Borgo' }, { id: 's2', name: 'Alba' }];
const INGREDIENTS = [
  { id: 'i1', name: 'Flour 00', weight: '25kg', supplierId: 's1', active: true },
  { id: 'i2', name: 'Butter', weight: '5kg', supplierId: 's1', active: true },
  { id: 'i3', name: 'Tinned tomato', weight: '', supplierId: 's2', active: true },
];
const FROM = { uid: 'u-emp', name: 'Marco Rossi' };
const BAG_CARD = { id: 'i1', name: 'Flour 00', weight: '25kg', supplierId: 's1', active: true, unit: 'cartone', packUnit: 'busta' };

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const build = (entries: unknown, suppliers: typeof SUPPLIERS = SUPPLIERS, extra: Record<string, unknown> = {}) => m.buildOrderRequest({
    suppliers, ingredients: INGREDIENTS, entries, date: '2026-08-14', from: FROM, now: NOW, ...extra,
  });
  const built = (entries: unknown, suppliers: typeof SUPPLIERS = SUPPLIERS, extra: Record<string, unknown> = {}) => {
    const req = build(entries, suppliers, extra);
    if (req === null) throw new Error('a list was expected');
    return req;
  };
  const buildWith = (entries: unknown) => {
    const req = m.buildOrderRequest({
      suppliers: SUPPLIERS, ingredients: [BAG_CARD, INGREDIENTS[1], INGREDIENTS[2]], entries, date: '2026-08-14', from: FROM, now: NOW,
    });
    if (req === null) throw new Error('a list was expected');
    return req;
  };

  test('a named sender is named, and never by the raw uid', () => {
    expect(m.senderName({ firstName: 'Marco', lastName: 'Rossi' })).toBe('Marco Rossi');
    expect(m.senderName({ firstName: 'Marco' })).toBe('Marco');
    expect(m.senderName({ firstName: ' Marco ', lastName: '  ' })).toBe('Marco');
  });

  test('a row left at 0 does not reach the manager', () => {
    const req = built({ i1: { qty: 4 }, i2: { qty: 0, stock: 9 }, i3: { qty: 2 } });
    expect(Object.keys(req.quantities).sort()).toStrictEqual(['i1', 'i3']);
  });

  test('there is no such thing as an empty order list', () => {
    expect(build({})).toBeNull();
    expect(build({ i1: { qty: 0 } })).toBeNull();
    expect(build({ i1: { qty: 0, stock: 12 } })).toBeNull();
  });

  test('the names and the supplier are frozen onto the list', () => {
    const req = built({ i1: { qty: 4 }, i3: { qty: 2 } });
    expect(req.names.i1).toBe('Flour 00 25kg');
    expect(req.supplierOf.i1).toBe('s1');
    expect(req.supplierNames).toStrictEqual({ s1: 'Borgo', s2: 'Alba' });
  });

  test('a supplier that contributed nothing is not named at all', () => {
    const req = built({ i1: { qty: 4 }, i3: { qty: 0 } });
    expect(Object.keys(req.supplierNames)).toStrictEqual(['s1']);
    expect(m.supplierIdsOf(req)).toStrictEqual(['s1']);
  });

  test('the ticks start empty, and the stamps are the same instant', () => {
    const req = built({ i1: { qty: 4 } });
    expect(req.done).toStrictEqual({});
    expect(req.createdAt).toBe(req.updatedAt);
    expect(req.fromUid).toBe('u-emp');
    expect(req.fromName).toBe('Marco Rossi');
  });

  test('a quantity is made whole and safe, exactly as the archive does', () => {
    const req = built({ i1: { qty: '4.6' }, i2: { qty: 1e999 }, i3: { qty: -3 } });
    expect(req.quantities).toStrictEqual({ i1: 5 });
  });

  test('a list longer than the cap is refused here, not by a bare permission error', () => {
    const many = [];
    const entries: Record<string, { qty: number }> = {};
    for (let n = 0; n <= m.MAX_LINES; n += 1) {
      many.push({ id: `x${n}`, name: `Item ${n}`, supplierId: 's1', active: true });
      entries[`x${n}`] = { qty: 1 };
    }
    expect(m.buildOrderRequest({ suppliers: [SUPPLIERS[0]], ingredients: many, entries, date: '2026-08-14', from: FROM, now: NOW })).toBeNull();
    expect(m.MAX_LINES).toBe(500);
    expect(m.REQUEST_WINDOW_DAYS).toBe(15);
  });

  test('the ingredients ordered without a supplier are not lost', () => {
    const req = m.buildOrderRequest({
      suppliers: [{ id: 'no-supplier', name: 'No supplier' }],
      ingredients: [{ id: 'n1', name: 'Cling film', supplierId: 'no-supplier', active: true }],
      entries: { n1: { qty: 2 } }, date: '2026-08-14', from: FROM, now: NOW,
    });
    expect(req?.quantities.n1).toBe(2);
    expect(req?.supplierOf.n1).toBe('no-supplier');
  });

  test('a note is trimmed and capped; no note is an empty string', () => {
    expect(built({ i1: { qty: 1 } }).note).toBe('');
    expect(built({ i1: { qty: 1 } }, SUPPLIERS, { note: '  urgent  ' }).note).toBe('urgent');
    expect(built({ i1: { qty: 1 } }, SUPPLIERS, { note: 'x'.repeat(900) }).note).toHaveLength(500);
  });

  test('a list is finished only when every line is ticked', () => {
    const req = built({ i1: { qty: 4 }, i3: { qty: 2 } });
    expect(m.isRequestDone(req)).toBe(false);
    expect(m.isRequestDone({ ...req, done: { i1: true } })).toBe(false);
    expect(m.isRequestDone({ ...req, done: { i1: true, i3: true } })).toBe(true);
  });

  test('a tick that is not exactly true does not count', () => {
    const req = built({ i1: { qty: 4 } });
    for (const tick of ['yes', 1, false]) expect(m.isRequestDone({ ...req, done: { i1: tick } }), String(tick)).toBe(false);
  });

  test('a tick left behind on a line that is gone cannot finish a list', () => {
    const req = built({ i1: { qty: 4 }, i3: { qty: 2 } });
    expect(m.isRequestDone({ ...req, done: { i1: true, ghost: true } })).toBe(false);
  });

  test('an impossible empty list reads as finished rather than jamming the screen', () => {
    expect(m.isRequestDone({ quantities: {}, done: {} })).toBe(true);
  });

  test('what is left is what Finish would tick', () => {
    const req = { quantities: { a: 1, b: 2, c: 3 }, done: { b: true } };
    expect(m.remainingIds(req).sort()).toStrictEqual(['a', 'c']);
    expect(m.remainingIds({ quantities: { a: 1 }, done: { a: true } })).toStrictEqual([]);
  });

  test('only a line ticked with exactly true is done', () => {
    expect(m.remainingIds({ quantities: { a: 1, b: 1, c: 1 }, done: { a: 1, b: 'true', c: true } })).toStrictEqual(['a', 'b']);
  });

  test('a missing or broken list has nothing left, and never throws', () => {
    for (const request of [undefined, null, {}, { quantities: null }, { quantities: {}, done: null }, 0, '']) {
      expect(m.remainingIds(request), String(request)).toStrictEqual([]);
    }
    expect(m.remainingIds({ quantities: { a: 1 } })).toStrictEqual(['a']);
  });

  test('only unfinished lists are waiting, newest first', () => {
    const list = [
      { createdAt: '2026-08-12T08:00:00Z', quantities: { a: 1 }, done: {} },
      { createdAt: '2026-08-14T08:00:00Z', quantities: { b: 1 }, done: {} },
      { createdAt: '2026-08-13T08:00:00Z', quantities: { c: 1 }, done: { c: true } },
    ];
    expect(m.waitingRequests(list).map(r => r.createdAt)).toStrictEqual(['2026-08-14T08:00:00Z', '2026-08-12T08:00:00Z']);
    expect(m.waitingRequests([])).toStrictEqual([]);
  });

  test('the list is regrouped under its suppliers, with a count each', () => {
    const req = { ...built({ i1: { qty: 4 }, i2: { qty: 1 }, i3: { qty: 2 } }), done: { i1: true } };
    const groups = m.groupRequest(req, {});
    const borgo = groups.find(g => g.supplierId === 's1');
    expect(borgo?.supplierName).toBe('Borgo');
    expect(borgo?.total).toBe(2);
    expect(borgo?.doneCount).toBe(1);
    expect(groups.find(g => g.supplierId === 's2')?.total).toBe(1);
  });

  test('a renamed ingredient shows its NEW name; a deleted one keeps the frozen one', () => {
    const req = built({ i1: { qty: 4 }, i2: { qty: 1 } });
    const items = m.groupRequest(req, { i1: { id: 'i1', name: 'Strong flour', weight: '25kg' } }).find(g => g.supplierId === 's1')?.items;
    expect(items?.find(i => i.id === 'i1')?.name).toBe('Strong flour 25kg');
    expect(items?.find(i => i.id === 'i2')?.name).toBe('Butter 5kg');
  });

  test('a line whose supplier was never named is still drawn', () => {
    const groups = m.groupRequest({ quantities: { orphan: 3 }, names: { orphan: 'Yeast 500g' }, supplierOf: {}, supplierNames: {}, done: {} }, {});
    expect(groups).toHaveLength(1);
    expect(groups[0]?.items[0]?.name).toBe('Yeast 500g');
  });

  test('a quantity changed since the list was sent is reported', () => {
    const req = built({ i1: { qty: 4 }, i3: { qty: 2 } });
    expect(m.liveDifference(req, { i1: { qty: 6 }, i3: { qty: 2 } })).toStrictEqual({ i1: 6 });
  });

  test('a row cleared out of the shared order reads as 0, not as absent', () => {
    expect(m.liveDifference(built({ i1: { qty: 4 } }), {})).toStrictEqual({ i1: 0 });
  });

  test('a TICKED line never warns: recording an order clears its row', () => {
    const req = { ...built({ i1: { qty: 4 }, i3: { qty: 2 } }), done: { i1: true } };
    expect(m.liveDifference(req, { i3: { qty: 2 } })).toStrictEqual({});
  });

  test('the window hides old lists and hands them back, never drops them', () => {
    const list = [{ date: '2026-08-14' }, { date: '2026-07-01' }, { date: '2026-07-31' }, { date: '2026-07-30' }];
    const { recent, older } = m.splitRequestsByAge(list, m.REQUEST_WINDOW_DAYS, NOW);
    expect(recent.map(r => r.date)).toStrictEqual(['2026-08-14', '2026-07-31']);
    expect(older.map(r => r.date)).toStrictEqual(['2026-07-01', '2026-07-30']);
  });

  test('a nonsense window shows everything rather than hiding everything', () => {
    const list = [{ date: '2020-01-01' }];
    expect(m.splitRequestsByAge(list, 0).recent).toStrictEqual(list);
    expect(m.splitRequestsByAge(list, Number.NaN).recent).toStrictEqual(list);
    expect(m.splitRequestsByAge(list, undefined, new Date('2026-08-14')).older).toStrictEqual(list);
  });

  test('a list freezes the unit of a line that has a choice, and only that line', () => {
    expect(buildWith({ i1: { qty: 2, unit: 'busta' }, i2: { qty: 1 } }).units).toStrictEqual({ i1: 'busta' });
    expect(buildWith({ i1: { qty: 2 } }).units).toStrictEqual({ i1: 'cartone' });
  });

  test('a list with no unit anywhere keeps its old shape (no `units` key)', () => {
    expect('units' in built({ i1: { qty: 4 } })).toBe(false);
  });

  test('groupRequest carries each line’s unit', () => {
    const req = buildWith({ i1: { qty: 2, unit: 'busta' }, i2: { qty: 1 } });
    const items = m.groupRequest(req, {}).find(g => g.supplierId === 's1')?.items;
    expect(items?.find(i => i.id === 'i1')?.unit).toBe('busta');
    expect(items?.find(i => i.id === 'i2')?.unit).toBe('');
  });

  test('a different unit is a difference even at the same number', () => {
    const req = buildWith({ i1: { qty: 2 } });
    const byId = { i1: BAG_CARD };
    expect(m.liveDifference(req, { i1: { qty: 2 } }, byId)).toStrictEqual({});
    expect(m.liveDifference(req, { i1: { qty: 2, unit: 'busta' } }, byId)).toStrictEqual({ i1: 2 });
    expect(m.liveDifference(req, { i1: { qty: 2, unit: 'Cartone' } }, byId)).toStrictEqual({});
  });
});

describe('the sender with no name (his decision, 3 Nov 2026)', () => {
  test('the port never takes an address and answers nothing: the screen says «Someone»', () => {
    expect(ported.senderName({})).toBe('');
    expect(ported.senderName(null)).toBe('');
    expect(ported.senderName({ firstName: '  ', lastName: ' ', email: 'a@b.test' })).toBe('');
    expect(ported.senderName.length).toBeLessThanOrEqual(1);
  });

  test('the list then carries no name at all, and no address', () => {
    const req = ported.buildOrderRequest({
      suppliers: SUPPLIERS, ingredients: INGREDIENTS, entries: { i1: { qty: 1 } }, date: '2026-08-14',
      from: { uid: 'u', name: ported.senderName({ email: 'a@b.test' }) }, now: NOW,
    });
    expect(req?.fromName).toBe('');
    expect(JSON.stringify(req)).not.toContain('a@b.test');
  });

  test('the current app, until the switch, still falls back to the address', () => {
    const original = legacyJs as unknown as { senderName: (member: unknown, email?: string) => string };
    expect(original.senderName({}, 'marco@example.test')).toBe('marco@example.test');
  });
});

describe('the words groupRequest is handed', () => {
  test('a line with no named supplier is headed by the word given; a line never named gets the word for a deleted one', () => {
    const groups = ported.groupRequest(
      { quantities: { orphan: 3 }, names: {}, supplierOf: {}, supplierNames: {}, done: {} }, {}, { noSupplier: 'No supplier', deleted: 'Gone' },
    );
    expect(groups[0]?.supplierName).toBe('No supplier');
    expect(groups[0]?.items[0]?.name).toBe('Gone');
  });
});

describe('the port against the original', () => {
  const original = legacyJs as unknown as Record<string, unknown>;
  const port = ported as unknown as Record<string, unknown>;

  test('it exports exactly what the original does', () => {
    expect(Object.keys(port).sort()).toStrictEqual(Object.keys(original).sort());
  });

  test.each(['remainingIds', 'isRequestDone', 'waitingRequests', 'supplierIdsOf', 'liveDifference', 'splitRequestsByAge', 'buildOrderRequest'])('%s has the same name', name => {
    expect((port[name] as { name: string }).name).toBe((original[name] as { name: string }).name);
  });
});
