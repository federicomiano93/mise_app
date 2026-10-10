// "I am on holiday" — and the much bigger danger it introduces — run against BOTH
// implementations: the TypeScript port in shared/ and the js/ file the live app uses today.
// Ported from tests/away-model.test.mjs; the two must stay equal until the switch to Mise 2.
//
// ⚠️⚠️ THE TESTS THAT MATTER MOST ARE THE ONES ABOUT REACHING NOBODY. Silencing a
// phone is easy; the failure this feature can cause is an order list that arrives
// at no one, with the sender told it went. Every rule below exists to make that
// impossible to do silently.

import { describe, expect, test } from 'vitest';
import * as ported from './away-model';
import * as legacyJs from '../../js/away-model.js';

const legacy = legacyJs as unknown as typeof ported;

// A fixed local noon, so no test depends on when it is run.
const NOW = new Date(2026, 7, 14, 12, 0, 0).getTime();   // 14 Aug 2026
const TODAY = '2026-08-14';

const roster = [
  { uid: 'u-own', role: 'owner', firstName: 'Anna', lastName: 'Rossi' },
  { uid: 'u-mgr', role: 'manager', firstName: 'Marco', lastName: 'Bianchi' },
  { uid: 'u-staff', role: 'staff', firstName: 'Sam', lastName: 'Baker' },
];

describe.each([
  ['shared/ (TypeScript)', ported],
  ['js/ (current app)', legacy],
] as const)('%s', (_name, m) => {
  // ── Away, and ending by itself ───────────────────────────────────────────────

  test('the LAST day is included — "away until Friday" means Friday too', () => {
    expect(m.isAway({ until: TODAY }, NOW), 'the last day must still count').toBe(true);
    expect(m.isAway({ until: '2026-08-15' }, NOW)).toBe(true);
    expect(m.isAway({ until: '2026-08-13' }, NOW), 'yesterday is over').toBe(false);
  });

  // ⚠️ NOTHING COUNTS DOWN AND NOTHING RUNS AT MIDNIGHT. The answer is derived from
  // the clock every time it is asked, exactly like the 4am pastry lock — so there is
  // no flag that can get stuck on.
  test('it ends BY ITSELF when the date passes, with nothing having to run', () => {
    const doc = { until: '2026-08-16' };
    expect(m.isAway(doc, new Date(2026, 7, 16, 23, 59).getTime())).toBe(true);
    expect(m.isAway(doc, new Date(2026, 7, 17, 0, 1).getTime())).toBe(false);
  });

  // ⚠️ EVERY UNCERTAIN ANSWER IS "NOT AWAY". One unnecessary notification is
  // recoverable; a list that reaches nobody because a corrupt record read as a
  // holiday is not.
  test('anything unreadable means the phone RINGS', () => {
    for (const bad of [null, undefined, {}, { until: '' }, { until: 'friday' },
      { until: '2026-13-01' }, { until: '2026-02-31' }, { until: 42 }]) {
      expect(m.isAway(bad, NOW), `${JSON.stringify(bad)} silenced a phone`).toBe(false);
    }
  });

  test('awayUids collects only the people really away', () => {
    const set = m.awayUids([
      { uid: 'a', until: '2026-08-20' },
      { uid: 'b', until: '2026-08-01' },
      { uid: 'c', until: 'nonsense' },
      { uid: '', until: '2026-08-20' },
    ], NOW);
    expect([...set]).toStrictEqual(['a']);
  });

  // ── Setting it ───────────────────────────────────────────────────────────────

  test('a sensible date is stored', () => {
    const doc = m.buildAwayDoc({ uid: 'u1', until: '2026-08-20', now: NOW });
    expect(doc).toStrictEqual({ uid: 'u1', until: '2026-08-20', updatedAt: NOW });
  });

  // ⚠️ "I am back" is a real answer and is written as an EMPTY STRING, not by
  // deleting: a delete that fails leaves somebody silenced with nothing on record
  // to explain why.
  test('coming back is a real answer, written rather than deleted', () => {
    expect(m.buildAwayDoc({ uid: 'u1', until: '', now: NOW }))
      .toStrictEqual({ uid: 'u1', until: '', updatedAt: NOW });
    expect(m.isAway({ uid: 'u1', until: '' }, NOW)).toBe(false);
  });

  test('a date already gone is refused, not stored as a holiday that never happens', () => {
    expect(m.buildAwayDoc({ uid: 'u1', until: '2026-08-13', now: NOW })).toBe(null);
    // Today itself is fine — a one-day holiday is a real thing.
    expect(m.buildAwayDoc({ uid: 'u1', until: TODAY, now: NOW })).toBeTruthy();
  });

  // ⚠️ Somebody typing 2027 by mistake would switch their notifications off for a
  // year and never think about it again.
  test('an absurdly distant date is refused', () => {
    expect(m.buildAwayDoc({ uid: 'u1', until: '2028-01-01', now: NOW })).toBe(null);
    expect(m.buildAwayDoc({ uid: 'u1', until: m.maxAwayDate(NOW), now: NOW })).toBeTruthy();
    expect(m.daysBetween(TODAY, m.maxAwayDate(NOW))).toBe(m.MAX_AWAY_DAYS);
  });

  test('junk never reaches the database', () => {
    expect(m.buildAwayDoc({ uid: '', until: '2026-08-20', now: NOW })).toBe(null);
    expect(m.buildAwayDoc({ uid: 'u1', until: 'soon', now: NOW })).toBe(null);
    expect(m.buildAwayDoc({ uid: 'u1', until: '20/08/2026', now: NOW })).toBe(null);
  });

  test('the local calendar day is read locally, never through UTC', () => {
    // 00:30 local on the 14th is still the 14th, whatever UTC thinks.
    expect(m.toISODate(new Date(2026, 7, 14, 0, 30).getTime())).toBe('2026-08-14');
    expect(m.toISODate(new Date(2026, 7, 14, 23, 30).getTime())).toBe('2026-08-14');
  });

  // ── ⚠️ THE PART THAT KEEPS A LIST FROM REACHING NOBODY ───────────────────────

  test('only the people who run the place are counted, never the sender', () => {
    const told = m.whoWillBeTold(roster, new Set(), 'u-own');
    expect(told.map(member => member.uid), 'the owner sending it is not told').toStrictEqual(['u-mgr']);
    expect(m.whoWillBeTold(roster, new Set(), 'u-staff').map(member => member.uid),
      'an employee sending it tells both').toStrictEqual(['u-own', 'u-mgr']);
  });

  test('somebody away is not counted as somebody who will hear it', () => {
    const told = m.whoWillBeTold(roster, new Set(['u-mgr']), 'u-staff');
    expect(told.map(member => member.uid)).toStrictEqual(['u-own']);
  });

  test('⚠️ when EVERY manager is away, the sender is warned', () => {
    expect(m.nobodyWillBeTold(roster, new Set(['u-own', 'u-mgr']), 'u-staff')).toBe(true);
    expect(m.nobodyWillBeTold(roster, new Set(['u-mgr']), 'u-staff'),
      'one is still there — no warning').toBe(false);
  });

  // ⚠️ AN EMPTY ROSTER MEANS "the app does not know", NOT "nobody is there". Warning
  // then would fire on every send in a venue whose roster has never been filled in,
  // and a warning that always fires is one nobody reads.
  test('an unknown roster does NOT produce a false "nobody will hear this"', () => {
    expect(m.nobodyWillBeTold([], new Set(), 'u-staff')).toBe(false);
    expect(m.nobodyWillBeTold(null, new Set(), 'u-staff')).toBe(false);
    // A venue with only employees: nobody runs it, so there is nothing to warn about
    // that this feature caused.
    expect(m.nobodyWillBeTold([{ uid: 'x', role: 'staff' }], new Set(), 'u-staff')).toBe(false);
  });

  test('the warning can name who is away', () => {
    expect(m.awayNames(roster, new Set(['u-mgr']), 'u-staff')).toStrictEqual(['Marco Bianchi']);
    expect(m.awayNames(roster, new Set(), 'u-staff')).toStrictEqual([]);
  });

  // ⚠️ IT NEVER RETURNS THE uid, and it returns '' rather than a word: this file
  // has no imports so it can be copied byte-for-byte onto the server, so the word
  // for "somebody" belongs to the screen. The property that matters is the same
  // either way — a raw uid must never reach a person's eyes.
  test('a person with no name is never printed as a raw uid', () => {
    expect(m.personName({ uid: 'Fdx92kQ1nT', email: 'a@b.test' })).toBe('a@b.test');
    expect(m.personName({ uid: 'Fdx92kQ1nT' }),
      'the model hands the screen nothing rather than a uid').toBe('');
    expect(m.personName(null)).toBe('');
  });
});
