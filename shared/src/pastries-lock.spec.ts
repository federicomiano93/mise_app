// Unit tests for the pastry LOCK: is tonight's list already done, and may it still be changed?
// Run against BOTH implementations: the TypeScript port in shared/ and js/pastries/pastries-lock.js,
// which the live app uses today. Ported from tests/pastries-lock.test.mjs; the two must stay equal
// until the switch to Mise 2. Every one of that file's 20 tests is ported (none needs the dictionary
// or the DOM). The module is a FULL port, so parity.spec.ts also compares its exports name by name.
//
// Each side is tested with its OWN neighbours: the TypeScript lock with the TypeScript work date and
// day start, the js/ lock with the js/ ones, so a test never mixes the two apps.
//
// The thing worth pinning here is not the locking — it is the UNLOCKING. A list
// that stays locked leaves someone at 4am unable to correct it, so every test
// below that proves a release matters more than the one next to it.
//
// ⚠️ AND THE OTHER HALF: unlocking must never CLEAR anything. That property does
// not live in this file (there is nothing here that could delete), and that is
// exactly the point — the roll at 4am is a question about a date, not an action.
//
// Dates are built from numeric components and nowMs is always injected, so
// nothing here depends on when or where it runs.

import { describe, expect, test } from 'vitest';
import * as ported from './pastries-lock';
import * as portedLog from './pastries-log-model';
import * as portedModel from './pastries-model';
import * as legacyJs from '../../js/pastries/pastries-lock.js';
import * as legacyLogJs from '../../js/pastries/pastries-log-model.js';
import * as legacyModelJs from '../../js/pastries/pastries-model.js';

const legacy = legacyJs as unknown as typeof ported;
const legacyLog = legacyLogJs as unknown as typeof portedLog;
const legacyModel = legacyModelJs as unknown as typeof portedModel;

const at = (y: number, m: number, d: number, h = 12, min = 0): number => new Date(y, m, d, h, min).getTime();
const TONIGHT = '2026-08-05';
const LAST_NIGHT = '2026-08-04';

describe.each([
  ['shared/ (TypeScript)', ported, portedLog, portedModel],
  ['js/ (current app)', legacy, legacyLog, legacyModel],
] as const)('%s', (_name, m, log, model) => {
  // ── What locks, and what does not ────────────────────────────────────────────

  test('a list nobody has confirmed is never locked', () => {
    expect(m.isDayLocked({ confirmed: false, grant: null, workDate: TONIGHT })).toBe(false);
    expect(m.isDayLocked({ confirmed: false, grant: TONIGHT, workDate: TONIGHT })).toBe(false);
  });

  test('a list confirmed tonight is locked', () => {
    expect(m.isDayLocked({ confirmed: true, grant: null, workDate: TONIGHT })).toBe(true);
  });

  test('permission given tonight unlocks it', () => {
    expect(m.isDayLocked({ confirmed: true, grant: TONIGHT, workDate: TONIGHT })).toBe(false);
  });

  test("last night's permission is spent — it does not carry over", () => {
    // ⚠️ THIS IS WHAT MAKES THE PERMISSION EXPIRE WITHOUT ANYTHING CLEANING IT UP.
    // The stored value is the work date it was given on, so at 4am it simply stops
    // matching. Nothing has to run, and nothing can be left behind.
    expect(m.isDayLocked({ confirmed: true, grant: LAST_NIGHT, workDate: TONIGHT })).toBe(true);
  });

  test('a clock nobody can read locks NOTHING', () => {
    // The opposite of how the record model answers about deleting, and deliberately
    // so: there, doubt had to mean "keep", because the mistake was irreversible.
    // Here the mistake would be someone standing at 4am unable to correct a list,
    // with nothing on screen explaining why.
    for (const bad of [undefined, null, '', 'tonight', 42, {}, [], '2026-02-31', '05-08-2026']) {
      expect(m.isDayLocked({ confirmed: true, grant: null, workDate: bad }),
        `workDate=${JSON.stringify(bad)}`).toBe(false);
    }
  });

  test('asked about nothing at all, it locks nothing', () => {
    expect(m.isDayLocked()).toBe(false);
    expect(m.isDayLocked({})).toBe(false);
  });

  // ── Where the permission is kept ─────────────────────────────────────────────

  test('the permission key names the day, and only a real weekday has one', () => {
    expect(m.grantKeyFor('Thursday')).toBe(`${m.EDIT_GRANT_PREFIX}Thursday`);
    for (const bad of ['thursday', 'Funday', '', null, undefined, 42, {}]) {
      expect(m.grantKeyFor(bad), `day=${JSON.stringify(bad)}`).toBe(null);
    }
  });

  // ── What each action does to the permission ──────────────────────────────────

  test('Edit grants the permission for tonight', () => {
    expect(m.grantAfter('edit', TONIGHT)).toBe(TONIGHT);
  });

  test('CONFIRMING SPENDS THE PERMISSION', () => {
    // ⚠️ THE BUG THIS TEST EXISTS FOR, reported within the hour of shipping.
    // Confirm → Edit → Confirm left the permission behind, so the second Confirm
    // wrote the record and the day stayed green: it looked like the button had
    // done nothing at all.
    expect(m.grantAfter('confirm')).toBe(null);
    expect(m.grantAfter('confirm', TONIGHT)).toBe(null);
  });

  test('a permission granted on an unreadable clock is no permission', () => {
    for (const bad of [undefined, null, '', 'tonight', 42, '2026-02-31']) {
      expect(m.grantAfter('edit', bad), `workDate=${JSON.stringify(bad)}`).toBe(null);
    }
  });

  test('the whole sequence: confirm, edit, confirm again', () => {
    // The bug end to end, as a state machine. `confirmed` stays true throughout —
    // the record is never removed — so the ONLY thing that can reopen or reclose
    // the day is the permission.
    let grant: string | null = null;
    const locked = (): boolean => m.isDayLocked({ confirmed: true, grant, workDate: TONIGHT });

    expect(locked(), 'confirmed and untouched: locked').toBe(true);

    grant = m.grantAfter('edit', TONIGHT);
    expect(locked(), 'after Edit: open').toBe(false);

    grant = m.grantAfter('confirm');
    expect(locked(), 'after confirming again: LOCKED once more').toBe(true);

    grant = m.grantAfter('edit', TONIGHT);
    expect(locked(), 'and Edit still works afterwards').toBe(false);
  });

  // ── When it unlocks by itself ────────────────────────────────────────────────

  test('the wait runs to the next 4am, never past it', () => {
    // Just before: minutes. Just after: nearly a full day.
    const justBefore = at(2026, 7, 5, 3, 59);
    expect(m.msUntilWorkDayEnd(justBefore)).toBe(60000);

    const justAfter = at(2026, 7, 5, 4, 1);
    expect(m.msUntilWorkDayEnd(justAfter)).toBe(24 * 3600000 - 60000);

    // Midday: 16 hours to 4am.
    expect(m.msUntilWorkDayEnd(at(2026, 7, 5, 12))).toBe(16 * 3600000);
  });

  test('exactly 4am waits for the NEXT one, not zero', () => {
    // That roll has just happened. Returning 0 would spin a timer against itself.
    const wait = m.msUntilWorkDayEnd(at(2026, 7, 5, model.DAY_START_HOUR, 0));
    expect(wait).toBe(24 * 3600000);
  });

  test('the moment it fires, the work date really has moved on', () => {
    // ⚠️ THE TEST THAT TIES THE TIMER TO THE THING IT EXISTS FOR. A wait that is
    // right to the millisecond is worthless if the date it wakes up for is the
    // same one. Waiting the returned time (plus the second the app adds) must
    // land on a DIFFERENT work date.
    for (const start of [at(2026, 7, 5, 3, 59), at(2026, 7, 5, 12), at(2026, 7, 5, 23, 30)]) {
      const wait = m.msUntilWorkDayEnd(start);
      // A missing wait counts as none at all (as `start + null` does in the original), so the
      // date would not move and the check below fails.
      expect(log.workDate(start + (wait ?? 0) + 1000),
        `starting at ${new Date(start).toISOString()}`).not.toBe(log.workDate(start));
    }
  });

  test('an unreadable clock sets no timer at all', () => {
    for (const bad of [undefined, null, NaN, 0, -1, Infinity, -Infinity, 'now', {}]) {
      expect(m.msUntilWorkDayEnd(bad), `nowMs=${String(bad)}`).toBe(null);
    }
  });

  // ── Reading which lists are done ─────────────────────────────────────────────

  test('the confirmed days come off the records, by id', () => {
    const set = m.confirmedDaysFrom([
      { id: '2026-08-05_Thursday', date: '2026-08-05', day: 'Thursday' },
      { id: '2026-08-05_Monday', date: '2026-08-05', day: 'Monday' },
    ]);
    expect([...set].sort()).toStrictEqual(['Monday', 'Thursday']);
  });

  test('the id wins over the field, as it does everywhere else in this feature', () => {
    const set = m.confirmedDaysFrom([{ id: '2026-08-05_Friday', day: 'Monday' }]);
    expect([...set]).toStrictEqual(['Friday']);
  });

  test('a record nobody can read locks nothing', () => {
    // It is simply absent from the answer — never a lock on a day it cannot name.
    const set = m.confirmedDaysFrom([
      { id: 'rubbish', day: 'Nonday' },
      { id: '2026-08-05_Funday' },
      null, undefined, 'a record', 42, {},
      { id: '2026-08-05_Wednesday', day: 'Wednesday' },
    ]);
    expect([...set]).toStrictEqual(['Wednesday']);
  });

  test('asked about nothing, nothing is confirmed', () => {
    for (const bad of [null, undefined, 'x', 42, {}, []]) {
      expect(m.confirmedDaysFrom(bad).size, `logs=${JSON.stringify(bad)}`).toBe(0);
    }
  });

  // ── The two halves together ──────────────────────────────────────────────────

  test('a day confirmed tonight unlocks itself once the date rolls', () => {
    // The whole feature in one assertion: same record, same permission state, one
    // work date later — and it is open again. Nothing was stored, expired or
    // deleted to make that happen.
    const day = 'Thursday';
    const confirmed = m.confirmedDaysFrom([{ id: `${TONIGHT}_${day}`, day }]);

    expect(m.isDayLocked({ confirmed: confirmed.has(day), grant: null, workDate: TONIGHT })).toBe(true);

    // Tomorrow's query returns nothing for the new date: the record still exists,
    // it just is not TONIGHT's any more.
    const tomorrow = m.confirmedDaysFrom([]);
    expect(m.isDayLocked({ confirmed: tomorrow.has(day), grant: null, workDate: '2026-08-06' })).toBe(false);
  });
});
