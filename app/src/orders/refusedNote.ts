// refusedNote.ts — a draft write the SERVER refused after the person had already left Orders, kept on this device so the
// next opening of Orders can say so (item 6 of docs/mise2-port-owed.md, «STILL OPEN»; docs/parity/orders.md, «Refused after
// leaving Orders as built»).
//
// New in Mise 2, no original: the current app never meets this, because leaving its Orders page unloads it, and its one way
// out that waits for the server (Back to a recipe) asks «Quantità non salvata» on the spot. Mise 2 sends what waits when Orders
// closes (ordersStore.stop) and does not wait: a refusal then arrives when no screen is there to hear it.
//
// WHY A KEY OF ITS OWN and not a field of `orders-draft-claims`: that note is a FULL, paired port of the current app's
// js/orders/draft-journal.js (both apps read it while they live side by side), and its reader drops what it does not know.
// A refused value must also stay OUT of that note, or it would be replayed at every opening, for ever (draftSync.ts,
// wasRefused). So: one more key, with the same rules.
//
// THE SHAPE is the draft journal's own (`entries[id] = { row, base }`, `days[supplierId] = { day, base }`), so the same judge
// (draftSync.ts stillOurs) decides what may come back: `row` is what was refused, `base` what the server held for those
// fields when the write left. `told` says the next opening has already said it.
//
// ⚠️ NOT IN KEEP_PREFIXES (shared/src/local-data.ts, js/local-data.js), ON PURPOSE: signing out or switching venue wipes it, as
// it wipes the draft journal and Firestore's own queue of unsent writes. It is also stamped with the venue AND the person,
// and a note for anybody else is thrown away unread: one venue's order on a device that may be shared.
//
// ⚠️ IT TRUSTS NOTHING IT READS, and never throws: a full or blocked storage must not stop anybody leaving Orders.

import { DRAFT_JOURNAL_MAX_AGE_MS } from '@mise/shared/draft-journal';
import type { JournalStorage, NotedDay, NotedFields, NotedLine } from '@mise/shared/draft-journal';

export const REFUSED_NOTE_KEY = 'orders-draft-refused';
export const REFUSED_NOTE_VERSION = 1;

export interface RefusedNote {
  // When the first refusal in it was noted (ms): its 24 hours count from there, as the draft journal's do.
  at: number;
  // The next opening of Orders has said it already: a reopening does not say it again.
  told: boolean;
  entries: Record<string, NotedLine>;
  days: Record<string, NotedDay>;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

// Only the fields a draft line has, each of the right type (the draft journal's own rule).
function cleanFields(source: unknown): NotedFields | null {
  if (!isPlainObject(source)) return null;
  const out: NotedFields = {};
  for (const field of ['qty', 'stock'] as const) {
    if (!(field in source)) continue;
    const value = source[field];
    if (!isCount(value)) return null;
    out[field] = value;
  }
  for (const field of ['unit', 'supplierId'] as const) {
    if (!(field in source)) continue;
    const value = source[field];
    if (typeof value !== 'string') return null;
    out[field] = value;
  }
  return Object.keys(out).length ? out : null;
}

function remove(storage: JournalStorage) {
  try {
    storage.removeItem(REFUSED_NOTE_KEY);
  } catch {
    /* private mode / blocked */
  }
}

// What this device noted for this venue and this person, or null. A note that cannot be used, is too old, or belongs to
// another venue or another person is removed, never shown.
export function readRefusedNote(lid: string, uid: string, now: number, storage: JournalStorage | null): RefusedNote | null {
  if (!storage || !lid || !uid) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(REFUSED_NOTE_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let note: unknown = null;
  try {
    note = JSON.parse(raw);
  } catch {
    remove(storage);
    return null;
  }
  if (!isPlainObject(note) || note.v !== REFUSED_NOTE_VERSION || note.lid !== lid || note.uid !== uid) {
    remove(storage);
    return null;
  }
  const at = note.at;
  if (typeof at !== 'number' || !Number.isFinite(at) || now - at > DRAFT_JOURNAL_MAX_AGE_MS) {
    remove(storage);
    return null;
  }
  const entries: Record<string, NotedLine> = {};
  for (const [id, claim] of Object.entries(isPlainObject(note.entries) ? note.entries : {})) {
    const line = isPlainObject(claim) ? claim : {};
    const row = cleanFields(line.row);
    const base = cleanFields(line.base);
    if (row && base) entries[id] = { row, base };
  }
  const days: Record<string, NotedDay> = {};
  for (const [id, claim] of Object.entries(isPlainObject(note.days) ? note.days : {})) {
    const stamp = isPlainObject(claim) ? claim : {};
    if (typeof stamp.day === 'string' && stamp.day && typeof stamp.base === 'string') days[id] = { day: stamp.day, base: stamp.base };
  }
  if (!Object.keys(entries).length && !Object.keys(days).length) {
    remove(storage);
    return null;
  }
  return { at, told: note.told === true, entries, days };
}

// Replace the note. Nothing in it removes it.
export function writeRefusedNote(lid: string, uid: string, note: RefusedNote, storage: JournalStorage | null): void {
  if (!storage || !lid || !uid) return;
  if (!Object.keys(note.entries).length && !Object.keys(note.days).length) {
    remove(storage);
    return;
  }
  try {
    storage.setItem(REFUSED_NOTE_KEY, JSON.stringify({
      v: REFUSED_NOTE_VERSION, lid, uid, at: note.at, told: note.told, entries: note.entries, days: note.days,
    }));
  } catch {
    // Quota or blocked: never log the data. A half-written note must not be read back.
    remove(storage);
  }
}
