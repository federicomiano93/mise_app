// Unit tests for the order form's prefill (P15 — the owner cannot read code; these numbers end up in a message
// sent to a client), run against BOTH implementations for the pure part: the TypeScript port in shared/ and
// js/calculator-order-prefill.js, which the live app uses today. Ported from tests/order-prefill.test.mjs.
//
// calculator-order-prefill.ts is an ADAPTED port, so parity.spec.ts does not pair it: `prefillNote` takes the
// translate function as a third argument (the original reads the interface dictionary, which in Mise 2 belongs
// to the app), so its arity differs by design. The block after the shared tests stands in for what pairing would
// have checked (names, the constant, the function shapes), and the note is tested against the port only, with a
// fake `t` that echoes the key and the params — the English sentences themselves are asserted in the
// Calculator's order-form specs (app/), where the real dictionary is.
//
// PORTED from tests/order-prefill.test.mjs: every test except the four about the note runs against both
// files; those four are rewritten for the port as said above.

import { describe, expect, test } from 'vitest';
import * as ported from './calculator-order-prefill';
import * as legacyJs from '../../js/calculator-order-prefill.js';
import { latestVersion as latestOf } from './log-model';

const legacy = legacyJs as unknown as typeof ported;

// Local wall-clock times, built the way a person reads them. The work day rolls at 4am, so the hour matters as
// much as the date and a UTC timestamp would not say which work day it lands in.
const at = (y: number, m: number, d: number, h: number, min: number): number => new Date(y, m - 1, d, h, min).getTime();

const NOW = at(2026, 8, 10, 9, 51); // Monday morning, mid-shift
const TODAY = at(2026, 8, 10, 8, 30);
const YESTERDAY = at(2026, 8, 9, 13, 46);
const THREE_DAYS_AGO = at(2026, 8, 7, 10, 0);

// A log, newest-first order being the caller's job.
const mkLog = (items: unknown[], createdAtMs: number = TODAY) => ({ createdAtMs, versions: [{ items }] });
const item = (clientName: string, id: string, qty: unknown) => ({ clientName, id, qty, name: id });

// Placeholder client names on purpose: this repo is public, so no real customer of the business appears in it.
const ENTRIES = [
  { client: { name: 'CLIENT A' }, products: [{ id: 'p1', name: 'Pizzas' }, { id: 'p2', name: 'Focaccias' }] },
  { client: { name: 'CLIENT B' }, products: [{ id: 'p1', name: 'Pizzas' }] },
];

const BOTH_DAYS = [
  mkLog([item('CLIENT A', 'p1', 30)], TODAY),
  mkLog([item('CLIENT A', 'p2', 48)], YESTERDAY),
];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  const fill = (logs: unknown, opts: { nowMs?: unknown; window?: unknown } = {}) =>
    m.prefillFromLogs(ENTRIES, logs, latestOf, { nowMs: NOW, ...opts });

  // ── Pairing a log line to a row ──────────────────────────────────────────────

  test('a quantity from the log lands on the matching row', () => {
    expect(fill([mkLog([item('CLIENT A', 'p1', 40)])])).toStrictEqual({ '0|p1': 40 });
  });

  test('the most RECENT log wins when two recorded the same row', () => {
    const logs = [mkLog([item('CLIENT A', 'p1', 12)]), mkLog([item('CLIENT A', 'p1', 99)])];
    expect(fill(logs)).toStrictEqual({ '0|p1': 12 });
  });

  test('a ZERO in the newest log is an answer — it stops an older number outliving it', () => {
    // ⚠️ THE DEFECT THIS PINS, reported from the bakery on 10 Aug 2026. A dough log lists EVERY product of its
    // recipe for every client, zeros included, so a zero in today's log means "none of these today".
    const logs = [
      mkLog([item('CLIENT A', 'p1', 0)], TODAY),
      mkLog([item('CLIENT A', 'p1', 10)], YESTERDAY),
    ];
    expect(fill(logs)).toStrictEqual({});
  });

  test('the newest log decides a row even when an older one has a bigger number', () => {
    const logs = [
      mkLog([item('CLIENT A', 'p1', 3)], TODAY),
      mkLog([item('CLIENT A', 'p1', 99)], YESTERDAY),
    ];
    expect(fill(logs)).toStrictEqual({ '0|p1': 3 });
  });

  test('a row the newest log does NOT mention still falls through to an older one', () => {
    // A focaccia log cannot answer for a brioche row: it never names it.
    const logs = [
      mkLog([item('CLIENT A', 'p1', 5)], TODAY),
      mkLog([item('CLIENT A', 'p2', 48)], YESTERDAY),
    ];
    expect(fill(logs)).toStrictEqual({ '0|p1': 5, '0|p2': 48 });
  });

  test('the real shape it went wrong on: two doughs, one row zeroed today', () => {
    const entries = [
      { client: { name: 'CLIENT A' }, products: [
        { id: 'buns', name: 'Buns' }, { id: 'rolls', name: 'Rolls' }, { id: 'trays', name: 'Trays' }] },
    ];
    const logs = [
      mkLog([item('CLIENT A', 'buns', 0), item('CLIENT A', 'rolls', 20)], TODAY),
      mkLog([item('CLIENT A', 'buns', 10), item('CLIENT A', 'rolls', 20)], YESTERDAY),
      mkLog([item('CLIENT A', 'trays', 4)], YESTERDAY),
    ];
    expect(m.prefillFromLogs(entries, logs, latestOf, { nowMs: NOW })).toStrictEqual({ '0|rolls': 20, '0|trays': 4 });
  });

  test('the same product for two clients does not bleed across', () => {
    const logs = [mkLog([item('CLIENT A', 'p1', 40), item('CLIENT B', 'p1', 5)])];
    expect(fill(logs)).toStrictEqual({ '0|p1': 40, '1|p1': 5 });
  });

  test('a client in the log but not in this WhatsApp list is ignored', () => {
    expect(fill([mkLog([item('SOMEONE ELSE', 'p1', 40)])])).toStrictEqual({});
  });

  test('a row with nothing recorded is simply absent, so the form leaves it at 0', () => {
    expect('0|p2' in fill([mkLog([item('CLIENT A', 'p1', 40)])])).toBe(false);
  });

  test('a renamed client stops matching — the honest limit, not a silent wrong number', () => {
    expect(fill([mkLog([item('CLIENT A LTD', 'p1', 40)])])).toStrictEqual({});
  });

  // ── The window: yesterday and today, and nothing older ───────────────────────

  test('a dough made TODAY is offered', () => {
    expect(fill([mkLog([item('CLIENT A', 'p1', 30)], TODAY)])).toStrictEqual({ '0|p1': 30 });
  });

  test('a dough made YESTERDAY for today is offered — it is already baked', () => {
    expect(fill([mkLog([item('CLIENT A', 'p1', 48)], YESTERDAY)])).toStrictEqual({ '0|p1': 48 });
  });

  test('a dough from three days ago is NOT offered', () => {
    expect(fill([mkLog([item('CLIENT A', 'p1', 40)], THREE_DAYS_AGO)])).toStrictEqual({});
  });

  test('today beats yesterday for the same row, and yesterday still fills a row today missed', () => {
    const logs = [
      mkLog([item('CLIENT A', 'p1', 30)], TODAY),
      mkLog([item('CLIENT A', 'p1', 12), item('CLIENT A', 'p2', 48)], YESTERDAY),
    ];
    expect(fill(logs)).toStrictEqual({ '0|p1': 30, '0|p2': 48 });
  });

  test('the window is TWO work days, and the constant says so', () => {
    expect(m.PREFILL_WORK_DAYS).toBe(2);
  });

  // ── The setting: yesterday and today, yesterday only, today only ─────────────

  test('"both" offers each day’s work', () => {
    expect(fill(BOTH_DAYS, { window: 'both' })).toStrictEqual({ '0|p1': 30, '0|p2': 48 });
  });

  test('"today" leaves yesterday’s work out', () => {
    expect(fill(BOTH_DAYS, { window: 'today' })).toStrictEqual({ '0|p1': 30 });
  });

  test('"yesterday" means yesterday ONLY, not yesterday onwards', () => {
    expect(fill(BOTH_DAYS, { window: 'yesterday' })).toStrictEqual({ '0|p2': 48 });
  });

  test('no window, or one nobody recognises, widens to both rather than narrowing', () => {
    // A corrupt setting must never quietly hide a day's work from an order.
    for (const bad of [undefined, null, '', 'ieri', 'BOTH', 42, {}]) {
      expect(fill(BOTH_DAYS, { window: bad }), String(bad)).toStrictEqual({ '0|p1': 30, '0|p2': 48 });
    }
  });

  test('every window still refuses anything older than yesterday', () => {
    const old = [mkLog([item('CLIENT A', 'p1', 40)], THREE_DAYS_AGO)];
    for (const w of ['both', 'today', 'yesterday']) {
      expect(fill(old, { window: w }), w).toStrictEqual({});
    }
  });

  // ── The 4am boundary ─────────────────────────────────────────────────────────

  test('a log written after midnight belongs to the night before, and is still offered', () => {
    const lateNight = at(2026, 8, 10, 0, 30);
    expect(fill([mkLog([item('CLIENT A', 'p1', 20)], lateNight)])).toStrictEqual({ '0|p1': 20 });
  });

  test('a log written before 4am YESTERDAY belongs to the day before that, and is not offered', () => {
    const sundayNight = at(2026, 8, 9, 2, 0);
    expect(fill([mkLog([item('CLIENT A', 'p1', 20)], sundayNight)])).toStrictEqual({});
  });

  // ── Nothing is guessed when the clock cannot be read ─────────────────────────

  test('no clock offers nothing, rather than silently offering everything', () => {
    const logs = [mkLog([item('CLIENT A', 'p1', 40)], THREE_DAYS_AGO)];
    for (const bad of [undefined, null, 0, -1, Number.NaN, 'abc', {}]) {
      expect(m.prefillFromLogs(ENTRIES, logs, latestOf, { nowMs: bad }), String(bad)).toStrictEqual({});
    }
  });

  test('a log with no timestamp is not offered — there is no honest way to place it', () => {
    expect(fill([{ versions: [{ items: [item('CLIENT A', 'p1', 40)] }] }])).toStrictEqual({});
  });

  test('junk in, nothing out — never a crash and never a NaN', () => {
    expect(m.prefillFromLogs(null, null, latestOf, { nowMs: NOW })).toStrictEqual({});
    expect(fill([null, {}, { versions: [] }])).toStrictEqual({});
    expect(fill([mkLog([null, item('CLIENT A', 'p1', 'abc')])])).toStrictEqual({});
    expect(m.prefillFromLogs([null, { client: null }], [mkLog([item('CLIENT A', 'p1', 1)])], latestOf, { nowMs: NOW })).toStrictEqual({});
  });
});

// ── What pairing would have checked ──────────────────────────────────────────

describe('the port exports what the current app’s file does', () => {
  test('the same names, the same constant, functions of the same name (prefillNote differs in arity by design)', () => {
    const ts = ported as Record<string, unknown>;
    const js = legacyJs as Record<string, unknown>;
    expect(Object.keys(ts).sort()).toStrictEqual(Object.keys(js).sort());
    expect(ts['PREFILL_WORK_DAYS']).toBe(js['PREFILL_WORK_DAYS']);
    for (const name of Object.keys(js)) {
      if (typeof js[name] !== 'function') continue;
      expect((ts[name] as { name: string }).name, name).toBe((js[name] as { name: string }).name);
    }
    expect(ported.prefillFromLogs.length).toBe(legacy.prefillFromLogs.length);
    expect(ported.prefillNote.length).toBe(legacy.prefillNote.length + 1);
  });
});

// ── The sentence above the form (port only: the translate function comes in as an argument) ────────────────

// Echoes what it was asked for, so the choice of key and of params is what is asserted.
const echo = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  params ? `${key}(${Object.entries(params).map(([k, v]) => `${k}=${String(v)}`).join(',')})` : key;
const note = (n: number, window: unknown): string => ported.prefillNote(n, window, echo);

describe('prefillNote', () => {
  test('nothing found says so, naming the window; a count is passed as `n`, beside the window', () => {
    expect(note(0, 'both')).toBe('calc.prefill.nothingLogged(when=calc.prefill.window.both)');
    expect(note(1, 'both')).toBe('calc.prefill.filled(n=1,when=calc.prefill.window.both)');
    expect(note(4, 'both')).toBe('calc.prefill.filled(n=4,when=calc.prefill.window.both)');
  });

  test('the note follows the SETTING — a fixed sentence would start lying', () => {
    expect(note(2, 'today')).toContain('window.today');
    expect(note(2, 'yesterday')).toContain('window.yesterday');
    expect(note(0, 'today')).toContain('window.today');
    expect(note(0, 'yesterday')).toContain('window.yesterday');
    expect(note(2, 'today')).not.toContain('window.yesterday');
  });

  test('an unknown window falls back to the widest wording, matching what it offers', () => {
    for (const bad of [undefined, null, '', 'ieri', 42, 'constructor']) {
      expect(note(2, bad), String(bad)).toContain('window.both');
    }
  });

  test('whatever the count, the note names the window it drew from', () => {
    for (const n of [0, 1, 2, 9]) expect(note(n, 'both')).toContain('calc.prefill.window.both');
  });
});
