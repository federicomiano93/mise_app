// The Orders draft journal (P15), run against BOTH implementations: the TypeScript port in shared/ and js/orders/draft-journal.js,
// which the current app uses. Both apps share one origin and one localStorage, so what one writes the other must read back — the
// cross-read test below is the one that matters most. These are the pure cases of tests/draft-journal.test.mjs (venue, age,
// «trusts nothing», storage full, orderedSince, the wipe on sign-out); the cases that need the draft itself are in
// app/src/orders/draftSync.journal.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './draft-journal';
import * as legacy from '../../js/orders/draft-journal.js';
import * as portedLocalData from './local-data';
import * as legacyLocalData from '../../js/local-data.js';

const implementations: Array<[string, typeof ported]> = [['shared/ (TypeScript)', ported], ['js/ (current app)', legacy as unknown as typeof ported]];

const VENUE = 'venue-a';
const DAY = '2026-11-01';

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string): string | null => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string): void => { map.set(key, String(value)); },
    removeItem: (key: string): void => { map.delete(key); },
  };
}

const claims = (qty = 5) => ({ at: 1000, entries: { flour: { row: { qty }, base: { qty: 0 } } }, days: {} });

describe.each(implementations)('%s', (_name, m) => {
  const { DRAFT_JOURNAL_KEY, DRAFT_JOURNAL_MAX_AGE_MS, readJournal, writeJournal, dropNotedLine, orderedSince, historyLookBackDay } = m;

  test('the key, the version and the limits are the ones the current app uses', () => {
    expect(DRAFT_JOURNAL_KEY).toBe('orders-draft-claims');
    expect(m.DRAFT_JOURNAL_VERSION).toBe(1);
    expect(DRAFT_JOURNAL_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(m.CLOCK_MARGIN_MS).toBe(2 * 60 * 1000);
    expect(m.HISTORY_LOOK_BACK_DAYS).toBe(7);
  });

  test('the note is one venue\'s: another venue neither reads it nor keeps it', () => {
    const storage = memory();
    writeJournal(VENUE, claims(), storage);
    expect(readJournal('venue-b', 1000, storage)).toBeNull();
    expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  test('older than a day: dropped; a day old exactly: kept', () => {
    const storage = memory();
    writeJournal(VENUE, claims(), storage);
    expect(readJournal(VENUE, 1000 + DRAFT_JOURNAL_MAX_AGE_MS, storage)).not.toBeNull();
    expect(readJournal(VENUE, 1001 + DRAFT_JOURNAL_MAX_AGE_MS, storage)).toBeNull();
    expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  test('it trusts nothing it reads', () => {
    const storage = memory();
    const put = (value: unknown) => storage.setItem(DRAFT_JOURNAL_KEY, typeof value === 'string' ? value : JSON.stringify(value));
    const good = { v: 1, lid: VENUE, at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} };

    for (const bad of ['not json', 'null', '[]', { ...good, v: 2 }, { ...good, at: 'yesterday' }, { ...good, entries: 7 }]) {
      put(bad);
      expect(readJournal(VENUE, 1000, storage), JSON.stringify(bad)).toBeNull();
      expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
    }
    // A write in the air it cannot read counts as none: the line itself is still good.
    put({ ...good, entries: { flour: { ...good.entries.flour, air: 'nonsense' } } });
    expect(readJournal(VENUE, 1000, storage)?.entries.flour).toStrictEqual(good.entries.flour);
    put({ ...good, entries: { flour: { ...good.entries.flour, air: [{ qty: -1 }, 7, { qty: 2 }] } } });
    expect(readJournal(VENUE, 1000, storage)?.entries.flour).toStrictEqual({ ...good.entries.flour, air: [{ qty: 2 }] });
    // One bad line does not cost the good ones.
    put({
      ...good,
      entries: {
        ...good.entries,
        a: { row: { qty: -1 }, base: { qty: 0 } },
        b: { row: { qty: 1.5 }, base: { qty: 0 } },
        c: { row: { unit: 3 }, base: { unit: '' } },
        d: { row: { qty: 1 } },
        e: 'nonsense',
      },
      days: { s1: { day: DAY, base: '' }, s2: { day: 4, base: '' }, s3: { day: DAY } },
    });
    const read = readJournal(VENUE, 1000, storage);
    expect(Object.keys(read?.entries ?? {})).toStrictEqual(['flour']);
    expect(Object.keys(read?.days ?? {})).toStrictEqual(['s1']);
    // A field nobody asked for does not travel.
    put({ ...good, entries: { flour: { row: { qty: 5, hacked: true }, base: { qty: 0 } } } });
    expect(readJournal(VENUE, 1000, storage)?.entries.flour?.row).toStrictEqual({ qty: 5 });
  });

  test('a missing venue, a missing storage and a throwing storage read as nothing', () => {
    const storage = memory();
    writeJournal(VENUE, claims(), storage);
    expect(readJournal('', 1000, storage)).toBeNull();
    expect(readJournal(VENUE, 1000, null)).toBeNull();
    const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('blocked'); } };
    expect(readJournal(VENUE, 1000, blocked)).toBeNull();
    expect(() => writeJournal(VENUE, claims(), blocked)).not.toThrow();
    expect(() => writeJournal(VENUE, claims(), null)).not.toThrow();
  });

  test('storage full: the older note goes rather than stay and say something no longer true', () => {
    const storage = memory();
    writeJournal(VENUE, claims(), storage);
    const full = { ...storage, setItem() { throw new Error('quota'); } };
    writeJournal(VENUE, claims(6), full);
    expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  test('nothing to remember removes the note', () => {
    const storage = memory();
    writeJournal(VENUE, claims(), storage);
    writeJournal(VENUE, { at: 1000, entries: {}, days: {} }, storage);
    expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  test('dropNotedLine takes one line out and leaves the rest', () => {
    const storage = memory();
    const now = Date.now();
    writeJournal(VENUE, {
      at: now,
      entries: { flour: { row: { qty: 5 }, base: { qty: 0 } }, salt: { row: { qty: 2 }, base: { qty: 0 } } },
      days: {},
    }, storage);
    const before = storage.getItem(DRAFT_JOURNAL_KEY);
    dropNotedLine(VENUE, 'yeast', storage);
    expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBe(before);
    dropNotedLine(VENUE, 'flour', storage);
    expect(Object.keys(readJournal(VENUE, now, storage)?.entries ?? {})).toStrictEqual(['salt']);
    dropNotedLine(VENUE, 'salt', storage);
    expect(storage.getItem(DRAFT_JOURNAL_KEY)).toBeNull();
  });

  test('orderedSince reads each send, its time, and only what was really ordered', () => {
    const at = Date.parse('2026-11-01T10:00:00Z');
    const send = (iso: string, quantities: Record<string, number>) => ({ at: iso, quantities });
    const ids = orderedSince([
      { sends: { a: send('2026-11-01T09:00:00Z', { old: 3 }), b: send('2026-11-01T11:00:00Z', { late: 3, zero: 0 }) } },
      { sends: { c: send('2026-11-01T09:59:00Z', { skewed: 1 }) } },     // within the clocks' margin
      { sends: { f: { ...send('2026-11-01T15:00:00Z', { corrected: 2 }), kind: 'edit' } } },   // a History correction
      { createdAt: '2026-11-01T12:00:00Z', quantities: { oldShape: 2 } },   // from before `sends`
      { createdAt: '2026-10-01T12:00:00Z', quantities: { oldShapeOld: 2 } },
      { sends: { d: send('not a date', { broken: 1 }), e: {} } },
      null,
    ], at);
    expect([...ids].sort()).toStrictEqual(['late', 'oldShape', 'skewed']);
    expect(historyLookBackDay(at)).toBe('2026-10-25');
  });

  test('signing out or switching venue wipes the note (local-data)', () => {
    expect(portedLocalData.keysToClear([DRAFT_JOURNAL_KEY])).toStrictEqual([DRAFT_JOURNAL_KEY]);
    expect(legacyLocalData.keysToClear([DRAFT_JOURNAL_KEY])).toStrictEqual([DRAFT_JOURNAL_KEY]);
  });
});

describe('the two files read each other\'s notes', () => {
  test('what one writes the other reads, and the bytes are the same', () => {
    const a = memory();
    const b = memory();
    const note = {
      at: 1000,
      entries: { flour: { row: { qty: 5, unit: '', supplierId: '' }, base: { qty: 0, unit: '', supplierId: '' }, air: [{ qty: 3, unit: '', supplierId: '' }] } },
      days: { sup1: { day: DAY, base: '' } },
    };
    ported.writeJournal(VENUE, note, a);
    legacy.writeJournal(VENUE, note, b);
    expect(a.getItem(ported.DRAFT_JOURNAL_KEY)).toBe(b.getItem(ported.DRAFT_JOURNAL_KEY));
    expect(legacy.readJournal(VENUE, 1000, a)).toStrictEqual(note);
    expect(ported.readJournal(VENUE, 1000, b)).toStrictEqual(note);
  });
});
