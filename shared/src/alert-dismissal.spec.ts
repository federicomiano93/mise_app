// Tests for closing a calendar notice you have read, without losing it (P15), run against BOTH implementations: the TypeScript port
// in shared/ and js/orders/alert-dismissal.js, which the live app uses today. The module is a FULL port, so parity.spec.ts also
// compares its exports.
//
// ⚠️⚠️ ONLY THE CALENDAR NOTICES CLOSE, AND THAT IS THE POINT (Federico, 24 Aug 2026). A coming holiday is something to read once.
// Everything else on that screen is WORK — orders to place today, orders that never arrived, something added nobody was told
// about — and a closeable piece of work is one somebody can close by mistake and never see again.
//
// PORTED: every test of tests/alert-dismissal.test.mjs that calls the pure functions (sections 1 to 4), plus the one about the
// venue switch, re-stated on the pure `keysToClear` of local-data (the original reads the SOURCE of js/local-data.js; here both
// local-data files are asked what they would clear), plus a null-storage test added here (the original's try/catch answers it).
// LEFT OUT (they read source text or the dictionary, which Mise 2 has no equivalent of; they still run on the current app's
// side through tests/alert-dismissal.test.mjs):
//   - «only calendar notices can be closed» and «the close button is a sibling of the text, never inside it» — regexes over
//     js/orders/notifications.js, whose renderers become Mise 2 screen code.
//   - «every new phrase exists in BOTH languages» — the dictionary, which in Mise 2 belongs to the app.

import { describe, expect, test } from 'vitest';
import * as ported from './alert-dismissal';
import * as portedLocalData from './local-data';
import * as legacyJs from '../../js/orders/alert-dismissal.js';
import * as legacyLocalData from '../../js/local-data.js';

const legacy = legacyJs as unknown as typeof ported;

const XMAS = { key: 'bh-2026-12-25', kind: 'holiday', text: 'Christmas' };
const CLASH = { key: 'conf-SUP_A-2026-12-25', kind: 'conflict', text: 'clash' };
const NEWYEAR = { key: 'bh-2027-01-01', kind: 'holiday', text: 'New Year' };

const store = (initial: string | null) => {
  let value = initial;
  return {
    getItem: (): string | null => value,
    setItem: (_k: string, v: string): void => { value = v; },
    read: (): string | null => value,
  };
};

describe.each([
  ['shared/ (TypeScript)', ported, portedLocalData],
  ['js/ (current app)', legacy, legacyLocalData as unknown as typeof portedLocalData],
] as const)('%s', (_name, m, localData) => {
  const { visibleAlerts, hiddenAlerts, pruneDismissed, withDismissed, reopenAll, readDismissed, writeDismissed, DISMISSED_KEY } = m;

  // ── 1. Closing one, and what is left ───────────────────────────────────────

  test('a closed notice is not shown; the others are', () => {
    const dismissed = withDismissed([], XMAS.key);
    expect(visibleAlerts([XMAS, CLASH], dismissed).map(a => a.key)).toStrictEqual([CLASH.key]);
    expect(hiddenAlerts([XMAS, CLASH], dismissed).map(a => a.key)).toStrictEqual([XMAS.key]);
  });

  test('closing the same one twice does not double it', () => {
    const once = withDismissed([], XMAS.key);
    expect(withDismissed(once, XMAS.key)).toStrictEqual(once);
  });

  test('nothing closed: everything is shown, and there is nothing to reopen', () => {
    expect(visibleAlerts([XMAS, CLASH], []).length).toBe(2);
    expect(hiddenAlerts([XMAS, CLASH], []).length).toBe(0);
  });

  // ⚠️ The pill stands for "the notices you put away", so it puts them ALL back. Doing it one at a time would mean tapping three
  // times to find out there is nothing new.
  test('⚠️ reopening clears the lot', () => {
    expect(reopenAll()).toStrictEqual([]);
    expect(visibleAlerts([XMAS, CLASH], reopenAll()).length).toBe(2);
  });

  // ── 2. A DIFFERENT holiday is a different question ─────────────────────────

  // ⚠️⚠️ THIS IS WHAT MAKES "IT COMES BACK ON ITS OWN" TRUE, and it costs nothing: the keys were already stable and already
  // carried the date the notice is about.
  test('⚠️⚠️ closing Christmas says nothing about New Year', () => {
    const dismissed = withDismissed([], XMAS.key);
    expect(visibleAlerts([NEWYEAR], dismissed).map(a => a.key)).toStrictEqual([NEWYEAR.key]);
  });

  // ── 3. The memory cleans itself, BY DATE ───────────────────────────────────

  // ⚠️⚠️ THE DEFECT THIS REPLACES, AND IT WAS FOUND BY RELOADING THE REAL APP. The first version kept only the keys still among
  // "today's alerts", which sounds tighter and is not: the alerts are recomputed on every paint and the FIRST paint happens before
  // the suppliers have arrived. With no suppliers there is no delivery-clash alert, so its key was pruned as though the notice had
  // expired — and the moment the suppliers landed it reopened, wide, a notice somebody had explicitly put away.
  test('⚠️⚠️ a key is kept even when this paint has no such alert yet', () => {
    const dismissed = [XMAS.key, CLASH.key];
    expect(pruneDismissed(dismissed, '2026-08-24'), 'an incomplete snapshot must not be able to forget a dismissal')
      .toStrictEqual(dismissed);
  });

  test('a notice whose day has passed takes its key with it', () => {
    expect(pruneDismissed([XMAS.key, NEWYEAR.key], '2026-12-26')).toStrictEqual([NEWYEAR.key]);
  });

  test('the day itself still counts as future — the notice is about today', () => {
    expect(pruneDismissed([XMAS.key], '2026-12-25')).toStrictEqual([XMAS.key]);
  });

  // ⚠️ None exist today. If a kind ever arrives without a date it will reopen rather than be silenced for ever, which is the safe
  // direction for something whose whole job is to be read.
  test('⚠️ a key with no date in it is dropped, not kept for ever', () => {
    expect(pruneDismissed(['something-else'], '2026-08-24')).toStrictEqual([]);
  });

  test('junk in, no throw out', () => {
    expect(pruneDismissed(null, '2026-08-24')).toStrictEqual([]);
    expect(visibleAlerts(null, null)).toStrictEqual([]);
    expect(hiddenAlerts(null, null)).toStrictEqual([]);
    expect(withDismissed(null, null)).toStrictEqual([]);
  });

  // ── 4. Storage, and which way to fail ──────────────────────────────────────

  test('what is written is what comes back', () => {
    const s = store(null);
    writeDismissed(s, [XMAS.key]);
    expect(readDismissed(s)).toStrictEqual([XMAS.key]);
  });

  // ⚠️⚠️ THE SAFE DIRECTION IS DECIDED BY WHAT THE SILENCE WOULD COST. whats-new-boot.js stays quiet when storage is unreadable,
  // because the worst it costs is a missed announcement. Here silence HIDES something true about the week ahead.
  test('⚠️⚠️ unreadable storage shows everything — it never hides a notice', () => {
    const broken = { getItem(): string | null { throw new Error('private window'); }, setItem(): void { /* unused */ } };
    expect(readDismissed(broken)).toStrictEqual([]);
    expect(visibleAlerts([XMAS, CLASH], readDismissed(broken)).length).toBe(2);
  });

  test('storage that refuses to be written is not worth an error', () => {
    const broken = { getItem: (): string | null => null, setItem(): void { throw new Error('full'); } };
    expect(writeDismissed(broken, [XMAS.key])).toBe(false);
  });

  test('a corrupt value reads as "nothing dismissed"', () => {
    expect(readDismissed(store('not json'))).toStrictEqual([]);
    expect(readDismissed(store('{"not":"a list"}'))).toStrictEqual([]);
    expect(readDismissed(store('[1,2,{"x":1}]')), 'only strings are keys').toStrictEqual([]);
  });

  test('no storage at all reads as nothing dismissed and writes nothing', () => {
    expect(readDismissed(null)).toStrictEqual([]);
    expect(readDismissed(undefined)).toStrictEqual([]);
    expect(writeDismissed(null, [XMAS.key])).toBe(false);
    expect(writeDismissed(undefined, [XMAS.key])).toBe(false);
  });

  test('the memory lives under one key, and it is the one the current app uses', () => {
    expect(DISMISSED_KEY).toBe('orders-alerts-dismissed');
    const s = store(null);
    writeDismissed(s, [XMAS.key]);
    expect(s.read()).toBe(JSON.stringify([XMAS.key]));
  });

  // ── 5. Where the memory lives ──────────────────────────────────────────────

  // ⚠️⚠️ THE KEY MUST NOT SURVIVE A CHANGE OF VENUE. local-data clears everything whose prefix is not on its keep-list, and this
  // is about THIS venue's week — the same reasoning that leaves `just-joined` and `orders-reminder-date` off it. (The original
  // test reads the source of js/local-data.js; asking keysToClear is the same question, answered by the code itself.)
  test('⚠️⚠️ the dismissal is forgotten when the venue changes', () => {
    expect(localData.keysToClear([DISMISSED_KEY, 'uk-bank-holidays']),
      `${DISMISSED_KEY} must NOT be kept — it belongs to one venue's calendar`).toStrictEqual([DISMISSED_KEY]);
  });
});
