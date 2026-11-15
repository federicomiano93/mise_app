// Unit tests for the client-order history (P15), run against BOTH implementations for the pure part: the TypeScript
// port in shared/ and js/client-order-history.js, which the live app uses today. Ported from
// tests/client-order-history.test.mjs.
//
// ⚠️ THE MOST IMPORTANT TESTS IN THIS FILE ARE THE LAST ONES, and they are not about behaviour at all: they pin the
// module's whole EXPORT LIST (the port's and the original's), so that re-adding anything which decides what to
// delete turns a test red and NAMES it.
//
// This app shipped an automatic deletion exactly once (pastry records, v1.24.0) and removed it the next day on
// Federico's instruction: «niente si deve cancellare in automatico dal database». It was not disabled but deleted,
// because a delete sitting there switched off is one somebody reconnects in six months without knowing why. The same
// guard was written for that module and is written again here.
//
// client-order-history.ts is an ADAPTED port, so parity.spec.ts does not pair it: `linesLabel` and `emptyWords` take
// the translate function as their last argument (the original reads the interface dictionary, which in Mise 2
// belongs to the app), so their arity differs by design. Those two are tested against the port with a fake `t` that
// echoes the key and the params — the English sentences themselves are asserted in the app (app/), where the real
// dictionary is — and the same words are checked against the original in English.

import { describe, expect, test } from 'vitest';
import * as ported from './client-order-history';
import * as legacyJs from '../../js/client-order-history.js';

const legacy = legacyJs as unknown as typeof ported;

const at = (y: number, m: number, d: number, h = 12): number => new Date(y, m - 1, d, h).getTime();

const ORDERS = [
  { id: 'a', date: '2026-08-10', clientName: 'B', updatedAt: '2026-08-09T09:00:00Z', quantities: { p1: 2 } },
  { id: 'b', date: '2026-08-11', clientName: 'A', updatedAt: '2026-08-10T08:00:00Z', quantities: { p1: 1, p2: 3 } },
  { id: 'c', date: '2026-08-11', clientName: 'C', updatedAt: '2026-08-10T07:00:00Z', quantities: {} },
];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── The window ─────────────────────────────────────────────────────────────

  test('the window is the fifteen days before today', () => {
    const w = m.pastWindow(at(2026, 8, 12));
    expect(w.before).toBe('2026-08-12');
    expect(w.since).toBe('2026-07-28');       // 15 days back
    expect(w.days).toBe(15);
  });

  test('"show older" widens it a window at a time, and never shrinks it', () => {
    expect(m.pastWindow(at(2026, 8, 12), 2).since).toBe('2026-07-13');
    expect(m.pastWindow(at(2026, 8, 12), 2).days).toBe(30);
    // Nonsense must not produce a window smaller than the first one.
    for (const bad of [0, -3, null, undefined, 'two', NaN]) {
      expect(m.pastWindow(at(2026, 8, 12), bad).since, String(bad)).toBe('2026-07-28');
    }
  });

  test('the window is built in the LOCAL calendar, across a month end', () => {
    expect(m.pastWindow(at(2026, 3, 5)).since).toBe('2026-02-18');
  });

  // ⚠️ 00:30 is the hour this gets wrong if anybody reaches for toISOString(), which converts to UTC first and
  // names yesterday for everyone east of Greenwich.
  test('just after midnight the window still starts from TODAY', () => {
    expect(m.pastWindow(at(2026, 8, 12, 0)).before).toBe('2026-08-12');
  });

  // ── Which screen owns an order ─────────────────────────────────────────────

  // ⚠️ TODAY IS NOT HISTORY. It is still to be delivered, so it belongs to the other screen — and an order on both
  // would be read as two orders.
  test('today belongs to what is still coming, not to the history', () => {
    expect(m.isPast({ date: '2026-08-12' }, '2026-08-12')).toBe(false);
    expect(m.isPast({ date: '2026-08-13' }, '2026-08-12')).toBe(false);
    expect(m.isPast({ date: '2026-08-11' }, '2026-08-12')).toBe(true);
  });

  test('an unusable date is never called past', () => {
    for (const date of [undefined, null, '', 'yesterday', '2026-13-01', '2026-02-31', 42]) {
      expect(m.isPast({ date }, '2026-08-12'), String(date)).toBe(false);
    }
    expect(m.isPast(null, '2026-08-12')).toBe(false);
    expect(m.isPast({ date: '2026-08-11' }, 'nonsense')).toBe(false);
  });

  // ── Grouping ───────────────────────────────────────────────────────────────

  test('one entry per day, newest day first', () => {
    const days = m.groupByDay(ORDERS);
    expect(days.map(d => d.date)).toStrictEqual(['2026-08-11', '2026-08-10']);
    expect(days[0]?.orders.length).toBe(2);
    expect(days[1]?.orders.length).toBe(1);
  });

  test('inside a day, the order that came in first is first', () => {
    const [first] = m.groupByDay(ORDERS);
    expect(first?.orders.map(o => (o as { id: string }).id)).toStrictEqual(['c', 'b']);
  });

  // ⚠️ A client who sent an order asking for NOTHING is a fact about that day — very possibly the fact somebody is
  // looking the day up to check. Dropping it would say they never ordered, which is a different and wrong
  // statement.
  test('an order with no lines is kept, not silently dropped', () => {
    const days = m.groupByDay(ORDERS);
    const empty = days[0]?.orders.find(o => (o as { id: string }).id === 'c');
    expect(empty, 'the empty order must still appear').toBeTruthy();
    expect(m.lineCount(empty)).toBe(0);
  });

  test('an unreadable date is dropped rather than given a nonsense heading', () => {
    const days = m.groupByDay([...ORDERS, { id: 'x', date: 'whenever' }, { id: 'y' }, null]);
    expect(days.map(d => d.date)).toStrictEqual(['2026-08-11', '2026-08-10']);
    expect(days.reduce((n, d) => n + d.orders.length, 0)).toBe(3);
  });

  test('nothing at all is an empty list, not a crash', () => {
    for (const input of [[], null, undefined, 'orders', 42]) {
      expect(m.groupByDay(input), String(input)).toStrictEqual([]);
    }
  });

  test('two orders with the same time inside a day are told apart by the client name', () => {
    const same = [
      { id: 'z', date: '2026-08-11', clientName: 'Zed', updatedAt: 'T' },
      { id: 'a', date: '2026-08-11', clientName: 'Abe', updatedAt: 'T' },
    ];
    expect(m.groupByDay(same)[0]?.orders.map(o => (o as { id: string }).id)).toStrictEqual(['a', 'z']);
  });

  // ── Counting the lines ─────────────────────────────────────────────────────

  test('only quantities above zero count as a line', () => {
    expect(m.lineCount({ quantities: { a: 2, b: 0, c: 5 } })).toBe(2);
    expect(m.lineCount({ quantities: { a: '3', b: '0' } })).toBe(1);
    expect(m.lineCount({ quantities: {} })).toBe(0);
    expect(m.lineCount({})).toBe(0);
    expect(m.lineCount(null)).toBe(0);
    expect(m.lineCount({ quantities: 'lots' })).toBe(0);
  });

  test('the fifteen days are the SCREEN window, and are the app\'s usual number', () => {
    expect(m.HISTORY_WINDOW_DAYS).toBe(15);
    expect(m.MAX_HISTORY_READ, 'the read cap must not be so low it hides a normal window').toBeGreaterThanOrEqual(100);
  });
});

// ── ⚠️ THE GUARD THAT MATTERS ────────────────────────────────────────────────

// These modules may group, count and describe. They may not decide what to remove — from the screen it is a window,
// and from the database nothing at all. If a future change adds a prune, an expiry or a delete, this fails and says
// its name.
describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s — nothing here deletes', (_name, m) => {
  test('the module exports exactly these, and nothing that deletes', () => {
    expect(Object.keys(m).sort()).toStrictEqual([
      'HISTORY_WINDOW_DAYS',
      'MAX_HISTORY_READ',
      'emptyWords',
      'groupByDay',
      'isPast',
      'lineCount',
      'linesLabel',
      'pastWindow',
    ]);
  });

  test('no export is named for deleting, expiring or pruning', () => {
    const suspicious = Object.keys(m)
      .filter(name => /delete|remove|prune|expire|purge|drop|clean/i.test(name));
    expect(suspicious, 'nothing in this app deletes a client order automatically — see the file header').toStrictEqual([]);
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port exports what the current app’s file does', () => {
  test('the same names, the same constants, functions of the same name (the two words differ in arity by design)', () => {
    const ts = ported as Record<string, unknown>;
    const js = legacyJs as Record<string, unknown>;
    expect(Object.keys(ts).sort()).toStrictEqual(Object.keys(js).sort());
    for (const name of Object.keys(js)) {
      const b = js[name];
      if (typeof b === 'function') {
        expect((ts[name] as { name: string }).name, name).toBe((b as { name: string }).name);
        if (name !== 'linesLabel' && name !== 'emptyWords') {
          expect((ts[name] as { length: number }).length, name).toBe((b as { length: number }).length);
        }
      } else {
        expect(ts[name], name).toBe(b);
      }
    }
    expect(ported.linesLabel.length).toBe(legacy.linesLabel.length + 1);
    expect(ported.emptyWords.length).toBe(legacy.emptyWords.length + 1);
  });
});

// ── The words (port only: the translate function comes in as an argument) ───────────────────────────────

// Echoes what it was asked for, so the choice of key and of params is what is asserted.
const echo = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key;

describe('linesLabel', () => {
  test('no lines says "nothing ordered"; one or several pass the count as `n`', () => {
    expect(ported.linesLabel({ quantities: {} }, echo)).toBe('calc.nothingOrdered');
    expect(ported.linesLabel(null, echo)).toBe('calc.nothingOrdered');
    expect(ported.linesLabel({ quantities: { a: 1 } }, echo)).toBe('calc.linesOrdered(n=1)');
    expect(ported.linesLabel({ quantities: { a: 1, b: 2, c: 0 } }, echo)).toBe('calc.linesOrdered(n=2)');
  });

  test('an order with no lines is described as nothing ordered, still kept in its day', () => {
    const empty = ported.groupByDay(ORDERS)[0]?.orders.find(o => (o as { id: string }).id === 'c');
    expect(ported.linesLabel(empty, echo)).toBe('calc.nothingOrdered');
  });

  test('the original says the same in English: singular, plural and nothing', () => {
    expect(legacy.linesLabel({ quantities: {} }, echo)).toBe('nothing ordered');
    expect(legacy.linesLabel({ quantities: { a: 1 } }, echo)).toBe('1 line');
    expect(legacy.linesLabel({ quantities: { a: 1, b: 2 } }, echo)).toBe('2 lines');
  });
});

// ⚠️ "Nothing here" has two meanings and only ONE of them is a reason to widen the window. Told apart, somebody
// knows whether to tap "show older" or to stop looking.
describe('emptyWords', () => {
  test('an empty window says WHICH kind of empty it is', () => {
    expect(ported.emptyWords(15, false, echo)).toBe('help.noClientHasSent');
    expect(ported.emptyWords(15, true, echo)).toBe('help.noOrdersInLastDays(n=15)');
    expect(ported.emptyWords(15, false, echo)).not.toBe(ported.emptyWords(15, true, echo));
    expect(ported.emptyWords(30, true, echo)).toBe('help.noOrdersInLastDays(n=30)');
  });

  test('the original’s English carries the same two meanings, with the reassurance that nothing is deleted', () => {
    const never = legacy.emptyWords(15, false, echo);
    const none = legacy.emptyWords(15, true, echo);
    expect(never).not.toBe(none);
    expect(none).toMatch(/15 days/);
    // The reassurance is the load-bearing half: an empty screen must not read as "your old orders are gone", which
    // is what a bare "no orders" would say.
    expect(none).toMatch(/kept/);
    expect(none).toMatch(/deleted/);
    expect(/15 days/.test(never), 'a bakery with no clients yet is not told about a window').toBe(false);
  });
});
