// The note of draft writes the server refused after the person had left Orders (refusedNote.ts; item 6 of
// docs/mise2-port-owed.md). What it decides is draftSync.refused.spec.ts; here, only that it keeps one venue's and one
// person's note, for 24 hours, trusts nothing it reads, and is wiped by a sign-out or a venue switch.

import { describe, expect, it } from 'vitest';
import { DRAFT_JOURNAL_MAX_AGE_MS } from '@mise/shared/draft-journal';
import { KEEP_PREFIXES, keysToClear } from '@mise/shared/local-data';
import { readRefusedNote, REFUSED_NOTE_KEY, writeRefusedNote } from './refusedNote';
import type { RefusedNote } from './refusedNote';

const NOW = Date.parse('2026-11-12T10:00:00Z');

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, String(value)); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

const NOTE: RefusedNote = {
  at: NOW,
  told: false,
  entries: { flour: { row: { qty: 5, unit: '', supplierId: '' }, base: { qty: 0, unit: '', supplierId: '' } } },
  days: { mill: { day: '2026-11-13', base: '' } },
};

describe('refusedNote', () => {
  it('reads back what it wrote, for the same venue and person', () => {
    const storage = fakeStorage();
    writeRefusedNote('venue-a', 'u1', NOTE, storage);
    expect(readRefusedNote('venue-a', 'u1', NOW, storage)).toEqual(NOTE);
  });

  it('⚠️ another venue never reads it, and the note is thrown away', () => {
    const storage = fakeStorage();
    writeRefusedNote('venue-a', 'u1', NOTE, storage);
    expect(readRefusedNote('venue-b', 'u1', NOW, storage)).toBeNull();
    expect(storage.getItem(REFUSED_NOTE_KEY)).toBeNull();
  });

  it('⚠️ another person never reads it, and the note is thrown away', () => {
    const storage = fakeStorage();
    writeRefusedNote('venue-a', 'u1', NOTE, storage);
    expect(readRefusedNote('venue-a', 'u2', NOW, storage)).toBeNull();
    expect(storage.getItem(REFUSED_NOTE_KEY)).toBeNull();
  });

  it('no venue or no person: nothing is written or read', () => {
    const storage = fakeStorage();
    writeRefusedNote('', 'u1', NOTE, storage);
    writeRefusedNote('venue-a', '', NOTE, storage);
    expect(storage.map.size).toBe(0);
    expect(readRefusedNote('venue-a', '', NOW, storage)).toBeNull();
  });

  it('older than 24 hours, as the draft journal: gone', () => {
    const storage = fakeStorage();
    writeRefusedNote('venue-a', 'u1', NOTE, storage);
    expect(readRefusedNote('venue-a', 'u1', NOW + DRAFT_JOURNAL_MAX_AGE_MS, storage)).not.toBeNull();
    expect(readRefusedNote('venue-a', 'u1', NOW + DRAFT_JOURNAL_MAX_AGE_MS + 1, storage)).toBeNull();
    expect(storage.getItem(REFUSED_NOTE_KEY)).toBeNull();
  });

  it('trusts nothing it reads: junk, another version, odd fields', () => {
    const storage = fakeStorage();
    storage.setItem(REFUSED_NOTE_KEY, '{not json');
    expect(readRefusedNote('venue-a', 'u1', NOW, storage)).toBeNull();
    storage.setItem(REFUSED_NOTE_KEY, JSON.stringify({ v: 2, lid: 'venue-a', uid: 'u1', at: NOW, entries: NOTE.entries, days: {} }));
    expect(readRefusedNote('venue-a', 'u1', NOW, storage)).toBeNull();
    storage.setItem(REFUSED_NOTE_KEY, JSON.stringify({
      v: 1, lid: 'venue-a', uid: 'u1', at: NOW, told: 'yes',
      entries: { flour: { row: { qty: -1 }, base: { qty: 0 } }, salt: { row: { qty: 2 }, base: { qty: 0 } } },
      days: { mill: { day: 7, base: '' } },
    }));
    expect(readRefusedNote('venue-a', 'u1', NOW, storage)).toEqual({
      at: NOW, told: false, entries: { salt: { row: { qty: 2 }, base: { qty: 0 } } }, days: {},
    });
  });

  it('an empty note is no note', () => {
    const storage = fakeStorage();
    writeRefusedNote('venue-a', 'u1', NOTE, storage);
    writeRefusedNote('venue-a', 'u1', { at: NOW, told: false, entries: {}, days: {} }, storage);
    expect(storage.getItem(REFUSED_NOTE_KEY)).toBeNull();
  });

  it('a storage that throws never stops anybody', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(() => { writeRefusedNote('venue-a', 'u1', NOTE, broken); }).not.toThrow();
    expect(readRefusedNote('venue-a', 'u1', NOW, broken)).toBeNull();
    expect(readRefusedNote('venue-a', 'u1', NOW, null)).toBeNull();
  });

  it('⚠️ is NOT in the keep-list: a sign-out or a venue switch wipes it (both files: shared/src/local-data.spec.ts)', () => {
    expect(REFUSED_NOTE_KEY).toBe('orders-draft-refused');
    expect(KEEP_PREFIXES.some(prefix => REFUSED_NOTE_KEY.startsWith(prefix))).toBe(false);
    expect(keysToClear([REFUSED_NOTE_KEY])).toEqual([REFUSED_NOTE_KEY]);
  });
});
