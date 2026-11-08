// The note of typed Orders quantities that outlives the page (F-15), run against BOTH implementations: the TypeScript port
// in shared/ and js/orders/draft-journal.js, which the live app uses today. A FULL port, so parity.spec.ts also compares
// the exports.
//
// PORTED: every pure test of tests/draft-journal.test.mjs (one venue's note, its 24 hours, it trusts nothing it reads, a
// full storage, orderedSince and historyLookBackDay, the key wiped at sign-out).
// ADDED: a blocked storage on every call, dropNotedLine, and a round trip of a note with days and a write in the air.
// NOT PORTED HERE: the cases that drive the draft itself (what is noted, when it comes back): they need the sync, and are
// re-stated against app/src/orders/draftSync.ts in draftSync.journal.spec.ts.

import { describe, expect, test } from 'vitest';
import * as ported from './draft-journal';
import * as legacyJs from '../../js/orders/draft-journal.js';
import { keysToClear } from './local-data';
import { keysToClear as legacyKeysToClear } from '../../js/local-data.js';

const legacy = legacyJs as unknown as typeof ported;
const VENUE = 'venue-a';
const DAY = '2026-11-01';

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key) ?? null : null),
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

describe.each([['port', ported], ['current app', legacy]] as const)('draft-journal (%s)', (_name, m) => {
  const KEY = m.DRAFT_JOURNAL_KEY;
  const claims = () => ({ at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} });

  test('the key, its version, its age and its margins', () => {
    expect(KEY).toBe('orders-draft-claims');
    expect(m.DRAFT_JOURNAL_VERSION).toBe(1);
    expect(m.DRAFT_JOURNAL_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    expect(m.CLOCK_MARGIN_MS).toBe(2 * 60 * 1000);
    expect(m.HISTORY_LOOK_BACK_DAYS).toBe(7);
  });

  test('a note written is read back, days and a write in the air included', () => {
    const storage = fakeStorage();
    const note = {
      at: 1000,
      entries: { flour: { row: { qty: 0, unit: '', supplierId: '' }, base: { qty: 0, unit: '', supplierId: '' }, air: [{ qty: 5, unit: '', supplierId: '' }] } },
      days: { aldo: { day: DAY, base: '' } },
    };
    m.writeJournal(VENUE, note, storage);
    expect(JSON.parse(storage.getItem(KEY) ?? 'null')).toEqual({ v: 1, lid: VENUE, ...note });
    expect(m.readJournal(VENUE, 1000, storage)).toEqual(note);
  });

  test('nothing to remember removes the note', () => {
    const storage = fakeStorage();
    m.writeJournal(VENUE, claims(), storage);
    m.writeJournal(VENUE, { at: 1000, entries: {}, days: {} }, storage);
    expect(storage.getItem(KEY)).toBeNull();
  });

  test('the note is one venue\'s: another venue neither reads it nor keeps it', () => {
    const storage = fakeStorage();
    m.writeJournal(VENUE, claims(), storage);
    expect(m.readJournal('venue-b', 1000, storage)).toBeNull();
    expect(storage.getItem(KEY)).toBeNull(); // removed, not left to be read again
  });

  test('no venue: nothing is read or written', () => {
    const storage = fakeStorage();
    m.writeJournal('', claims(), storage);
    expect(storage.getItem(KEY)).toBeNull();
    m.writeJournal(VENUE, claims(), storage);
    expect(m.readJournal('', 1000, storage)).toBeNull();
    expect(storage.getItem(KEY)).not.toBeNull();
  });

  test('the note is older than a day: dropped; a day old exactly: kept', () => {
    const storage = fakeStorage();
    m.writeJournal(VENUE, claims(), storage);
    expect(m.readJournal(VENUE, 1000 + m.DRAFT_JOURNAL_MAX_AGE_MS, storage)).not.toBeNull();
    expect(m.readJournal(VENUE, 1001 + m.DRAFT_JOURNAL_MAX_AGE_MS, storage)).toBeNull();
    expect(storage.getItem(KEY)).toBeNull();
  });

  test('it trusts nothing it reads', () => {
    const storage = fakeStorage();
    const put = (value: unknown) => storage.setItem(KEY, typeof value === 'string' ? value : JSON.stringify(value));
    const good = { v: 1, lid: VENUE, at: 1000, entries: { flour: { row: { qty: 5 }, base: { qty: 0 } } }, days: {} };

    for (const bad of ['not json', 'null', '[]', { ...good, v: 2 }, { ...good, at: 'yesterday' }, { ...good, entries: 7 }]) {
      put(bad);
      expect(m.readJournal(VENUE, 1000, storage), JSON.stringify(bad)).toBeNull();
      expect(storage.getItem(KEY)).toBeNull();
    }
    // A write in the air it cannot read counts as none: the line itself is still good.
    put({ ...good, entries: { flour: { ...good.entries.flour, air: 'nonsense' } } });
    expect(m.readJournal(VENUE, 1000, storage)?.entries.flour).toEqual(good.entries.flour);
    put({ ...good, entries: { flour: { ...good.entries.flour, air: [{ qty: -1 }, 7, { qty: 2 }] } } });
    expect(m.readJournal(VENUE, 1000, storage)?.entries.flour).toEqual({ ...good.entries.flour, air: [{ qty: 2 }] });
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
    const read = m.readJournal(VENUE, 1000, storage);
    expect(Object.keys(read?.entries ?? {})).toEqual(['flour']);
    expect(Object.keys(read?.days ?? {})).toEqual(['s1']);
    // A field nobody asked for does not travel.
    put({ ...good, entries: { flour: { row: { qty: 5, hacked: true }, base: { qty: 0 } } } });
    expect(m.readJournal(VENUE, 1000, storage)?.entries.flour?.row).toEqual({ qty: 5 });
  });

  test('storage full: the older note goes rather than stay and say something no longer true', () => {
    const storage = fakeStorage();
    m.writeJournal(VENUE, claims(), storage);
    const full = { ...storage, setItem() { throw new Error('quota'); } };
    m.writeJournal(VENUE, { at: 1000, entries: { flour: { row: { qty: 6 }, base: { qty: 0 } } }, days: {} }, full);
    expect(storage.getItem(KEY)).toBeNull();
  });

  test('a blocked storage never throws, on any call', () => {
    const blocked = {
      getItem(): string | null { throw new Error('blocked'); },
      setItem() { throw new Error('quota'); },
      removeItem() { throw new Error('blocked'); },
    };
    expect(() => m.writeJournal(VENUE, claims(), blocked)).not.toThrow();
    expect(m.readJournal(VENUE, 1000, blocked)).toBeNull();
    expect(() => m.dropNotedLine(VENUE, 'flour', blocked)).not.toThrow();
    expect(m.readJournal(VENUE, 1000, null)).toBeNull();
  });

  test('dropNotedLine takes that one line out and leaves the rest of the note alone', () => {
    const storage = fakeStorage();
    const now = Date.now();
    m.writeJournal(VENUE, {
      at: now,
      entries: { flour: { row: { qty: 5 }, base: { qty: 0 } }, salt: { row: { qty: 2 }, base: { qty: 0 } } },
      days: { aldo: { day: DAY, base: '' } },
    }, storage);
    m.dropNotedLine(VENUE, 'flour', storage);
    const read = m.readJournal(VENUE, now, storage);
    expect(Object.keys(read?.entries ?? {})).toEqual(['salt']);
    expect(read?.days).toEqual({ aldo: { day: DAY, base: '' } });
    m.dropNotedLine(VENUE, 'nothing-noted', storage);
    expect(Object.keys(m.readJournal(VENUE, now, storage)?.entries ?? {})).toEqual(['salt']);
  });

  test('orderedSince reads each send, its time, and only what was really ordered', () => {
    const at = Date.parse('2026-11-01T10:00:00Z');
    const send = (iso: string, quantities: Record<string, number>) => ({ at: iso, quantities });
    const ids = m.orderedSince([
      { sends: { a: send('2026-11-01T09:00:00Z', { old: 3 }), b: send('2026-11-01T11:00:00Z', { late: 3, zero: 0 }) } },
      { sends: { c: send('2026-11-01T09:59:00Z', { skewed: 1 }) } }, // within the clocks' margin
      { sends: { f: { ...send('2026-11-01T15:00:00Z', { corrected: 2 }), kind: 'edit' } } }, // a History correction
      { createdAt: '2026-11-01T12:00:00Z', quantities: { oldShape: 2 } }, // from before `sends`
      { createdAt: '2026-10-01T12:00:00Z', quantities: { oldShapeOld: 2 } },
      { sends: { d: send('not a date', { broken: 1 }), e: {} } },
      null,
    ], at);
    expect([...ids].sort()).toEqual(['late', 'oldShape', 'skewed']);
    expect(m.historyLookBackDay(at)).toBe('2026-10-25');
    expect([...m.orderedSince(null, at)]).toEqual([]);
  });
});

test('signing out or switching venue wipes the note (local-data, both files)', () => {
  expect(keysToClear([ported.DRAFT_JOURNAL_KEY])).toEqual([ported.DRAFT_JOURNAL_KEY]);
  expect(legacyKeysToClear([ported.DRAFT_JOURNAL_KEY])).toEqual([ported.DRAFT_JOURNAL_KEY]);
});
