// draft-journal.js — this device's own note of what was typed on Orders and has not yet reached
// Firestore's queue, so leaving the page at the wrong moment cannot lose it.
//
// WHY. A change waits 0.8 s (the autosave pause) and then for Firestore's queue, which on a freshly
// opened page is busy for about 5 s more (measured on the lab tablet, 302 ingredients: +4.5–5.5 s,
// against +0.95 s on a settled page). Until the write is in the browser's database it exists only
// in this page's memory: a reload, a tap on Home or Chrome closing threw it away for good. This
// note is written in the same keystroke, and localStorage is synchronous, so it is already safe
// when the next thing happens. js/orders/draft.js decides what it holds and when it may be sent.
//
// THE SHAPE. `entries[id] = { row, base }`, `days[supplierId] = { day, base }`: `row`/`day` is the
// claim, `base` what the server held for those same fields when this device last heard from it.
// The base is what makes it safe to send later: a line that no longer reads like the base was
// changed by somebody else meanwhile, and their word wins (draft.js settleRestored). An entry may
// also hold `air`: what writes in the air said that the claim has corrected. Each may be in
// Firestore's queue and so land after the page has gone, so reading like one of them is not a
// colleague's doing either.
//
// ⚠️ NOT IN KEEP_PREFIXES (js/local-data.js), ON PURPOSE: signing out or switching venue wipes it.
// It is one venue's order on a device that may be shared, and signing out already throws away
// Firestore's own queue of unsent writes (js/firebase.js), so the two go together.
//
// ⚠️ IT TRUSTS NOTHING IT READS. Storage can hold anything (another version of the app, a
// half-written value, another venue's note): every refusal reads as «nothing to bring back».

import { toISODate } from './day.js';

export const DRAFT_JOURNAL_KEY = 'orders-draft-claims';
export const DRAFT_JOURNAL_VERSION = 1;

// A number typed in the evening comes back in the morning; one typed before a weekend does not.
export const DRAFT_JOURNAL_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Two phones' clocks can disagree: an order placed this long BEFORE the note still counts as after.
// Wrong in the safe direction: a number is dropped, never ordered twice.
export const CLOCK_MARGIN_MS = 2 * 60 * 1000;
// An order is filed under the day its lines were FOR, which can be before the day it is placed.
export const HISTORY_LOOK_BACK_DAYS = 7;

function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

const isCount = value => Number.isInteger(value) && value >= 0;
const isText = value => typeof value === 'string';
const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

// Only the fields a draft line has, each of the right type; anything else makes the side unusable.
function cleanFields(source) {
  if (!isPlainObject(source)) return null;
  const out = {};
  for (const field of ['qty', 'stock']) {
    if (field in source) {
      if (!isCount(source[field])) return null;
      out[field] = source[field];
    }
  }
  for (const field of ['unit', 'supplierId']) {
    if (field in source) {
      if (!isText(source[field])) return null;
      out[field] = source[field];
    }
  }
  return Object.keys(out).length ? out : null;
}

// What this device noted, or null. A note that cannot be used is removed, not left to be read again.
export function readJournal(lid, now = Date.now(), storage = defaultStorage()) {
  if (!storage || !lid) return null;
  let raw = null;
  try { raw = storage.getItem(DRAFT_JOURNAL_KEY); } catch { return null; }
  if (!raw) return null;
  const drop = () => {
    try { storage.removeItem(DRAFT_JOURNAL_KEY); } catch { /* private mode / blocked */ }
    return null;
  };
  let note = null;
  try { note = JSON.parse(raw); } catch { return drop(); }
  if (!isPlainObject(note) || note.v !== DRAFT_JOURNAL_VERSION || note.lid !== lid) return drop();
  if (!Number.isFinite(note.at) || now - note.at > DRAFT_JOURNAL_MAX_AGE_MS) return drop();

  const entries = {};
  Object.entries(isPlainObject(note.entries) ? note.entries : {}).forEach(([id, claim]) => {
    const row = cleanFields(claim?.row);
    const base = cleanFields(claim?.base);
    if (!row || !base) return;
    entries[id] = { row, base };
    const air = (Array.isArray(claim.air) ? claim.air : []).map(cleanFields).filter(Boolean);
    if (air.length) entries[id].air = air;
  });
  const days = {};
  Object.entries(isPlainObject(note.days) ? note.days : {}).forEach(([id, claim]) => {
    if (isText(claim?.day) && claim.day && isText(claim?.base)) days[id] = { day: claim.day, base: claim.base };
  });
  if (!Object.keys(entries).length && !Object.keys(days).length) return drop();
  return { at: note.at, entries, days };
}

// Replace the note. Nothing to remember removes it. Never throws: a full or blocked storage must
// not stop anybody typing, the write to Firestore still goes.
export function writeJournal(lid, { at, entries, days }, storage = defaultStorage()) {
  if (!storage || !lid) return;
  try {
    if (!Object.keys(entries).length && !Object.keys(days).length) {
      storage.removeItem(DRAFT_JOURNAL_KEY);
      return;
    }
    storage.setItem(DRAFT_JOURNAL_KEY, JSON.stringify({ v: DRAFT_JOURNAL_VERSION, lid, at, entries, days }));
  } catch {
    // Quota or blocked: never log the data. The older note goes, it no longer says what is claimed.
    try { storage.removeItem(DRAFT_JOURNAL_KEY); } catch { /* blocked */ }
  }
}

// Take one line out of the note: its ingredient has been deleted. For a page that holds no note of
// its own (Fornitori), and only that line: the rest is still somebody's typing.
export function dropNotedLine(lid, id, storage = defaultStorage()) {
  const note = readJournal(lid, Date.now(), storage);
  if (!note || !(id in note.entries)) return;
  delete note.entries[id];
  writeJournal(lid, note, storage);
}

// The first day whose orders can have been placed after `at` (the `date` of orders-history).
export function historyLookBackDay(at) {
  return toISODate(new Date(at - HISTORY_LOOK_BACK_DAYS * 24 * 60 * 60 * 1000));
}

// The ingredients that some order placed since `at` names. From each send, not from the record's
// total, and not from its updatedAt: confirming a delivery next week orders nothing. Nor from a
// correction made in History (`kind: 'edit'`), which lists the WHOLE record and orders nothing either.
export function orderedSince(records, at) {
  const ids = new Set();
  (records || []).forEach(record => {
    // A record from before `sends` existed is one order, placed when it was created.
    const sends = record?.sends && typeof record.sends === 'object'
      ? Object.values(record.sends)
      : [{ at: record?.createdAt, quantities: record?.quantities }];
    sends.forEach(send => {
      const when = Date.parse(send?.at);
      if (send?.kind === 'edit' || !(when >= at - CLOCK_MARGIN_MS)) return;
      Object.entries(send?.quantities || {}).forEach(([id, qty]) => { if (Number(qty) > 0) ids.add(id); });
    });
  });
  return ids;
}
