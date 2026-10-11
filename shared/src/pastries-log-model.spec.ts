// Unit tests for the pastry RECORD model, run against BOTH implementations: the TypeScript port in
// shared/ and js/pastries/pastries-log-model.js, which the live app uses today. Ported from
// tests/pastries-log-model.test.mjs; the two must stay equal until the switch to Mise 2.
// Every one of that file's 22 tests is ported (none needs the dictionary or the DOM). The module is
// a FULL port, so parity.spec.ts also compares its exports name by name.
//
// ⚠️ THIS FILE USED TO TEST A DELETION. It does not any more, because there is
// no longer one: nothing in The Italian Club removes anything from the database
// on its own. The Calculator's retention is a display filter over data kept for
// ever ("DISPLAY-only — the database keeps every log"), the Orders history
// window says "This HIDES, it never deletes", and the pastry records are now the
// same shape. A record leaves the SCREEN after fifteen days and stays in the
// database.
//
// The first test below is what keeps it that way: it pins the module's whole
// list of exports, so adding a function that deletes turns a test red instead of
// slipping past unnoticed.
//
// Dates are built from numeric components and nowMs is always injected, so
// nothing here depends on when or where it runs.

import { describe, expect, test } from 'vitest';
import * as ported from './pastries-log-model';
import * as legacyJs from '../../js/pastries/pastries-log-model.js';

const legacy = legacyJs as unknown as typeof ported;

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m, d, h, min).getTime();
const NOW = at(2026, 7, 20, 12);            // Thu 20 Aug 2026, midday
const rec = (date: string, extra: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id: `${date}_Monday`, date, day: 'Monday', items: [], ...extra });

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── Nothing here may delete ──────────────────────────────────────────────────

  test('this module exports nothing that decides what to delete', () => {
    // ⚠️ THE POINT OF THIS TEST. The rule is "nothing deletes from the database by
    // itself", and a rule that lives only in a comment is a rule that comes back.
    // An earlier version of this file exported isLogExpired() and expiredLogs();
    // both were removed rather than switched off. Re-adding anything of the kind
    // fails HERE, in one line, before it can be wired up to a delete.
    //
    // If a genuinely new export belongs in this module, add it to this list on
    // purpose — and if it has anything to do with removing a record, don't.
    expect(Object.keys(m).sort()).toStrictEqual([
      'LOG_VISIBLE_DAYS', 'MAX_LOG_ITEMS',
      'buildLog', 'daysBetween', 'isLogVisible', 'isRealISODate', 'logIdFor',
      'normalizeLog', 'normalizeLogs', 'sortLogs', 'workDate',
    ].sort());
  });

  test('the screen window is fifteen days, and it is the only window there is', () => {
    expect(m.LOG_VISIBLE_DAYS).toBe(15);
  });

  // ── The work date ────────────────────────────────────────────────────────────

  test('a record accepted after midnight belongs to the night before', () => {
    expect(m.workDate(at(2026, 7, 4, 23, 30))).toBe('2026-08-04');
    expect(m.workDate(at(2026, 7, 5, 0, 30))).toBe('2026-08-04');   // still that night
    expect(m.workDate(at(2026, 7, 5, 3, 59))).toBe('2026-08-04');
    expect(m.workDate(at(2026, 7, 5, 4, 0))).toBe('2026-08-05');    // the new work day
  });

  test('the work date survives both clock changes', () => {
    expect(m.workDate(at(2026, 9, 25, 3, 30))).toBe('2026-10-24');
    expect(m.workDate(at(2026, 9, 25, 4, 30))).toBe('2026-10-25');
    expect(m.workDate(at(2026, 2, 29, 3, 30))).toBe('2026-03-28');
    expect(m.workDate(at(2026, 2, 29, 4, 30))).toBe('2026-03-29');
  });

  test('an id is the date and the weekday, in that order', () => {
    expect(m.logIdFor('2026-08-05', 'Wednesday')).toBe('2026-08-05_Wednesday');
  });

  // ── Reading a date ───────────────────────────────────────────────────────────

  test('a date that looks right but is not a real day is refused', () => {
    expect(m.isRealISODate('2026-08-05')).toBe(true);
    expect(m.isRealISODate('2026-02-31')).toBe(false);   // passes the shape, is not a day
    expect(m.isRealISODate('2026-13-01')).toBe(false);
    expect(m.isRealISODate('2026-00-10')).toBe(false);
    expect(m.isRealISODate('05-08-2026')).toBe(false);
    expect(m.isRealISODate('2026-8-5')).toBe(false);
    expect(m.isRealISODate('')).toBe(false);
    expect(m.isRealISODate(null)).toBe(false);
    expect(m.isRealISODate(20260805)).toBe(false);
  });

  test('a leap day is a real day', () => {
    expect(m.isRealISODate('2028-02-29')).toBe(true);
    expect(m.isRealISODate('2026-02-29')).toBe(false);
  });

  test('days between two dates ignores the clock changes', () => {
    expect(m.daysBetween('2026-08-05', '2026-08-20')).toBe(15);
    expect(m.daysBetween('2026-08-20', '2026-08-05')).toBe(-15);
    expect(m.daysBetween('2026-08-05', '2026-08-05')).toBe(0);
    // BST ends inside this span; read as UTC midnights it is still exactly 7.
    expect(m.daysBetween('2026-10-22', '2026-10-29')).toBe(7);
    expect(m.daysBetween('nonsense', '2026-08-05')).toBe(null);
    expect(m.daysBetween('2026-08-05', null)).toBe(null);
  });

  // ── What is on screen ────────────────────────────────────────────────────────

  test('a record drops off the screen after 15 days', () => {
    expect(m.isLogVisible(rec('2026-08-20'), NOW)).toBe(true);   // today
    expect(m.isLogVisible(rec('2026-08-05'), NOW)).toBe(true);   // exactly 15
    expect(m.isLogVisible(rec('2026-08-04'), NOW)).toBe(false);  // 16
  });

  test('a record leaving the screen is hidden and NOTHING else', () => {
    // The whole surviving contract, in one line: this function answers a question
    // about a screen. The record it hides is untouched, and there is no longer any
    // function in the app that could remove it.
    const hidden = rec('2026-01-01');                             // months old
    expect(m.isLogVisible(hidden, NOW)).toBe(false);
    expect(m.normalizeLogs([hidden]).map(l => l.id), 'it must still read back as a perfectly good record')
      .toStrictEqual([hidden.id]);
  });

  test('a record nobody can date is SHOWN, not hidden', () => {
    // The screen is where a person would notice something wrong. Hiding it would
    // make the only visible symptom disappear.
    expect(m.isLogVisible(rec('nonsense'), NOW)).toBe(true);
    expect(m.isLogVisible({ id: 'x' }, NOW)).toBe(true);
    expect(m.isLogVisible(rec('2026-09-01'), NOW)).toBe(true);   // dated ahead
  });

  test('an unreadable clock hides nothing', () => {
    // A phone whose clock cannot be believed shows everything rather than deciding
    // anything. Cheap now that the answer only governs a screen.
    const old = rec('2026-01-01');
    for (const bad of [undefined, null, NaN, 0, -1, Infinity, -Infinity, 'now', {}]) {
      expect(m.isLogVisible(old, bad), `nowMs=${String(bad)}`).toBe(true);
    }
  });

  // ── Reading records ──────────────────────────────────────────────────────────

  test('the id wins over the fields, as it does everywhere else', () => {
    const l = m.normalizeLog({ date: '2026-01-01', day: 'Friday', items: [] }, '2026-08-05_Wednesday');
    expect(l.date).toBe('2026-08-05');
    expect(l.day).toBe('Wednesday');
  });

  test('a record that cannot be placed on a timeline is dropped from the screen', () => {
    // Dropped from the LIST, not from the database — there is nowhere to draw it on
    // a timeline, but it is still there to be looked at.
    const list = m.normalizeLogs([
      { id: '2026-08-05_Wednesday', date: '2026-08-05', day: 'Wednesday', items: [] },
      { id: 'rubbish', date: 'rubbish', day: 'Nonday', items: [] },
      { id: '2026-02-31_Monday', items: [] },
      null,
    ]);
    expect(list.length).toBe(1);
    expect(list[0]?.id).toBe('2026-08-05_Wednesday');
  });

  test('a record is cleaned exactly like a day is', () => {
    const l = m.normalizeLog({
      items: [1, null, { name: '  Cornetti  ', qty: '24' }, { qty: 5 }],
      note: 'slow proof',
    }, '2026-08-05_Wednesday');
    expect(l.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }]);
    expect(l.note).toBe('slow proof');
  });

  test('a record carrying more rows than the cap reads back at the cap', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ name: `P${i}`, qty: 1 }));
    expect(m.normalizeLog({ items }, '2026-08-05_Monday').items.length).toBe(m.MAX_LOG_ITEMS);
  });

  test('records are newest first, and two on one date never swap places', () => {
    const list = m.sortLogs([
      { date: '2026-08-04', day: 'Wednesday' },
      { date: '2026-08-05', day: 'Friday' },
      { date: '2026-08-05', day: 'Tuesday' },
    ]);
    expect(list.map(l => `${l.date} ${l.day}`))
      .toStrictEqual(['2026-08-05 Tuesday', '2026-08-05 Friday', '2026-08-04 Wednesday']);
  });

  // ── What Accept writes ───────────────────────────────────────────────────────

  test('a record is stamped with the work date, not the calendar date', () => {
    const l = m.buildLog({ day: 'Wednesday', items: [], note: '', nowMs: at(2026, 7, 5, 1, 0) });
    expect(l.date).toBe('2026-08-04');                 // 1am, so the night before
    expect(l.day).toBe('Wednesday');                   // …of the Wednesday list
    expect(l.id).toBe('2026-08-04_Wednesday');
  });

  test('accepting twice in one night keeps the first createdAt', () => {
    // The second Accept is a CORRECTION, not a second night's work.
    const first = m.buildLog({ day: 'Monday', items: [], note: '', nowMs: at(2026, 7, 20, 22) });
    const again = m.buildLog({
      day: 'Monday', items: [], note: '', nowMs: at(2026, 7, 20, 23), existing: first,
    });
    expect(again.id).toBe(first.id);
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.updatedAt).not.toBe(first.updatedAt);
  });

  test('the note is frozen into the record', () => {
    // It was part of the instruction in force that night; a record showing
    // today's note would misdescribe it.
    const l = m.buildLog({ day: 'Monday', items: [], note: 'butter is low', nowMs: NOW });
    expect(l.note).toBe('butter is low');
    expect(m.buildLog({ day: 'Monday', items: [], note: 42, nowMs: NOW }).note).toBe('');
  });

  test('a record carries the real list, cleaned, in order', () => {
    const l = m.buildLog({
      day: 'Monday',
      items: [{ name: 'Cornetti', qty: 24 }, { name: '', qty: 3 }, { name: 'Bomboloni', qty: '10' }],
      note: '', nowMs: NOW,
    });
    expect(l.items).toStrictEqual([{ name: 'Cornetti', qty: 24 }, { name: 'Bomboloni', qty: 10 }]);
  });

  test('what buildLog writes is what normalizeLog reads back', () => {
    const built = m.buildLog({
      day: 'Wednesday', items: [{ name: 'Cornetti', qty: 24 }], note: 'x', nowMs: NOW,
    });
    const read = m.normalizeLog(built, built.id);
    expect(read.date).toBe(built.date);
    expect(read.day).toBe(built.day);
    expect(read.items).toStrictEqual(built.items);
    expect(read.note).toBe(built.note);
    expect(m.isLogVisible(read, NOW)).toBe(true);
  });
});
