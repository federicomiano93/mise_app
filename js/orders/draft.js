// draft.js — the persistent, real-time order in progress.
//
// One shared document, drafts/current, holds every supplier's quantities. Every
// change autosaves (debounced) so reopening the app restores the exact state, and
// a real-time listener keeps two phones in sync.
//
// It also remembers, per supplier, the DAY its rows are FOR
// (`days: { supplierId: 'YYYY-MM-DD' }`): normally the day they were typed, or — for
// next week's quantities typed early — the supplier's next order day (order-day.js).
// Without that the app cannot tell an order typed today from one typed on Sunday and
// never marked as placed — and it would file the Sunday order under today.
//
// Archiving is per supplier: it writes orders-history/{day}_{supplierId} and
// removes ONLY that supplier's keys from the draft. The other suppliers' work —
// including whatever someone else is typing right now — is left alone.

import {
  saveDoc, patchDoc, watchDoc, watchServerAnswer, getRecentHistoryFromServer, clearFields, transactDoc,
  replaceDoc, removeDoc, getDocOnce, currentBakery, COLLECTIONS,
} from './firebase-orders.js';
import {
  readJournal, writeJournal, dropNotedLine, orderedSince, historyLookBackDay, DRAFT_JOURNAL_MAX_AGE_MS,
} from './draft-journal.js';
import {
  buildSupplierArchive, mergeArchives, historyDocId, ingredientsOf, quantityPathsFor,
  changedEntries, changedDays, wholeNumber,
} from './archive.js';
import { cleanUnit, storedUnitFor } from '../order-unit.js';
import { draftEntryPath } from '../ingredient-edit-model.js';
import { cleanSupplierId, overrideOf } from './line-supplier.js';

const DRAFT_ID = 'current';
const SAVE_DELAY_MS = 800; // debounce to limit Firestore writes (cost control)
const ORDERS_RETRY_MS = 30000; // a tablet can stay open for days: «the next open» may be far away

let saveTimer = null;
let waiting = false;       // a change is waiting for the debounce, so it can be flushed
let reportSaveResult = null;   // (ok: boolean) => void — injected by orders-main.js

// The draft as this device last agreed on it with the server: what a snapshot
// reported, plus what we have since sent and had accepted. What this phone claims
// as its own is measured against this — see `pending`.
//
// It is deliberately NOT updated when a write fails: the change then still counts
// as unsent and goes out again with the next save, instead of being forgotten.
let known = { entries: {}, days: {} };

// What THIS phone has typed and the server has not confirmed yet, FIELD BY FIELD:
// `entries` holds per line only the fields that differ ({ stock: 2 }, or the
// quantity group — see GROUP), `days` the day stamps.
//
// ⚠️ WITHOUT THIS, A TYPED QUANTITY CAN VANISH. Every incoming snapshot replaces
// the whole local entries map, and a change is not sent for up to 800ms (the
// autosave debounce). So when another phone wrote anything at all in that window,
// its snapshot arrived and took the half-typed number with it — the field still
// showed it (a focused input is left alone on repaint), but the value was gone
// from memory and never saved. Reproduced against the emulator before fixing.
//
// Re-applying this over each snapshot keeps the two truths straight: the server
// owns every field this phone has not touched, and this phone owns the one it is
// typing into until the write lands.
//
// ⚠️ IT IS ALWAYS «WHAT DIFFERS FROM `known`» (OR FROM A WRITE IN THE AIR: `differences`),
// RECOMPUTED AT EVERY CHANGE, AND IT IS EXACTLY WHAT A SAVE SENDS. It used to only grow,
// hold whole rows and be sent together with the screen's days map as it was at the
// keystroke; each of these put
// back quantities of an order another phone had just placed (found building Mise 2's
// Orders, 28 Oct 2026 — app/src/orders/draftSync.ts is the reviewed twin):
//   • a line corrected back inside the pause, or typed to the value another phone had
//     just written, stayed claimed for ever, came back on screen once that order was
//     placed, and was written with the next keystroke;
//   • a stock count sent the whole row, re-asserting this phone's copy of a quantity
//     another phone had just cleared;
//   • the waiting save sent the days map it was armed with, putting back the day
//     stamp another phone's placing had just removed.
let pending = { entries: {}, days: {} };

// The writes in the air, as sent. A snapshot never releases their fields (it may be
// Firestore showing this phone's own write before the server answers), and a refused
// one hands them back.
const flights = [];

// QUANTITY, UNIT AND THE «THIS TIME» SUPPLIER ARE ONE MEANING («5 buste from Bruno this
// time») and always travel together, '' included; only the stock is independent. Sent
// apart, a colleague changing the unit (or moving the line) in the same second turned
// «5» into 5 of something else, or filed it under another supplier.
const GROUP = ['qty', 'unit', 'supplierId'];

// A line's fields as the comparison reads them (changedEntries' own rules): on THIS
// phone's side the override exists only while there is a quantity (overrideOf); on the
// server's side it is the stored value, raw.
function mine(entry) {
  return {
    qty: wholeNumber(entry?.qty), stock: wholeNumber(entry?.stock),
    unit: cleanUnit(entry?.unit), supplierId: overrideOf(entry),
  };
}
function stored(entry) {
  return {
    qty: wholeNumber(entry?.qty), stock: wholeNumber(entry?.stock),
    unit: cleanUnit(entry?.unit), supplierId: cleanSupplierId(entry?.supplierId),
  };
}
const blank = (field, value) => value === undefined || value === (field === 'qty' || field === 'stock' ? 0 : '');
const isEmpty = map => Object.keys(map).length === 0;

const inAir = (id, field) => flights.some(f => f.entries[id] !== undefined && field in f.entries[id]);
const dayInAir = id => flights.some(f => id in f.days);
// What the LATEST write in the air says for a field or a day: undefined when none carries it.
function carried(id, field) {
  for (let i = flights.length - 1; i >= 0; i -= 1) {
    const row = flights[i].entries[id];
    if (row !== undefined && field in row) return row[field];
  }
  return undefined;
}
function dayCarried(id) {
  for (let i = flights.length - 1; i >= 0; i -= 1) {
    if (id in flights[i].days) return flights[i].days[id];
  }
  return undefined;
}

// What this phone's screen holds that the server does not — or will not once the writes
// in the air have landed.
//
// ⚠️ A CORRECTION MADE WHILE THE WRITE IT CORRECTS IS IN THE AIR. Until a snapshot shows
// that write (about 5 s on the lab tablet, on a freshly opened page), «5 put back to 0»
// matches `known`, so measured against `known` alone it said nothing, and the 5 then
// landed and came back, on screen and on the server. So a field a write in the air says
// differently is claimed too. ONLY a line and a day still on the screen: one gone from it
// is an order placed, and a blank row written now would outlive its clear.
function differences(entries, days) {
  const rows = {};
  const ids = new Set(Object.keys(changedEntries(entries, known.entries)));
  flights.forEach(flight => {
    Object.keys(flight.entries).forEach(id => { if (entries?.[id]) ids.add(id); });
  });
  ids.forEach(id => {
    const here = mine(entries[id]);
    const there = stored(known.entries[id]);
    const row = {};
    const overtaken = field => inAir(id, field) && carried(id, field) !== here[field];
    // ⚠️ A LEFTOVER {qty: 0, supplierId: 'X'} IS NOT THIS PHONE'S TO CLEAN on an edit of
    // another field: harmless at zero, and cleaning it could erase a colleague typing a
    // quantity under X in the same second. The first quantity typed here sends the
    // override with it, which clears it.
    const overrideDiffers = here.supplierId !== there.supplierId && !(here.qty === 0 && there.qty === 0);
    if (here.qty !== there.qty || here.unit !== there.unit || overrideDiffers || GROUP.some(overtaken)) {
      GROUP.forEach(field => { row[field] = here[field]; });
    }
    // ⚠️ A LINE THE SERVER DOES NOT HAVE CARRIES ONLY WHAT IS IN IT: padded with stock 0,
    // it erased the shelf count a colleague put on the same line in the same second.
    if (here.stock !== there.stock || overtaken('stock')) row.stock = here.stock;
    if (!isEmpty(row)) rows[id] = row;
  });
  const claimedDays = changedDays(days, known.days);
  Object.entries(days || {}).forEach(([id, day]) => {
    if (dayInAir(id) && dayCarried(id) !== day) claimedDays[id] = day;
  });
  return { entries: rows, days: claimedDays };
}

// A DETACHED copy of an entries map: same numbers, none of the same objects.
//
// ⚠️ THIS IS LOAD-BEARING, AND ITS ABSENCE IS INVISIBLE TO EVERY UNIT TEST.
// orders-main's setEntries copies the snapshot's inner objects BY REFERENCE into
// the live state, and typing mutates one of those objects in place. Keeping the
// snapshot's own objects as the baseline therefore mutated the baseline too: the
// comparison could never see a difference, and after the first snapshot NOTHING
// typed would ever have been saved again. Found by driving the app; the tests,
// which build their own objects, were perfectly green throughout.
function detach(entries) {
  const out = {};
  Object.entries(entries || {}).forEach(([id, entry]) => {
    out[id] = { qty: entry?.qty, stock: entry?.stock };
    // Only when present, so an ordinary entry keeps its {qty, stock} shape.
    if (entry && entry.unit !== undefined) out[id].unit = entry.unit;
    // The supplier override travels the same way (line-supplier.js): without it the baseline
    // could never see that a line had been sent elsewhere, and moving it back would read as
    // «unchanged» and never be written.
    if (entry && entry.supplierId !== undefined) out[id].supplierId = entry.supplierId;
  });
  return out;
}

// ── What survives this page ───────────────────────────────────────────────────
//
// ⚠️ `pending` DIES WITH THE PAGE. Measured on the lab tablet: on a freshly opened page a write
// reaches Firestore's queue about 5 s after the keystroke, and a reload before that lost the
// number for good. So every claim is also noted on this device, in the same keystroke
// (draft-journal.js), until a snapshot shows it: Firestore only reports a write after storing it
// in the browser's database, so from then on the queue answers for it.
//
// ⚠️⚠️ THE NOTE IS NEVER SENT BLIND, AND NEVER ON THE WORD OF THE OFFLINE COPY. It can be hours old
// by the time the page opens, and the copy on this device may not know that a colleague has placed
// that order: sending it then would put back quantities of an order already placed, the very hole
// `pending` above was rebuilt to close. So what the last page left waits in `restored`, off the
// screen and out of every save, until the SERVER has answered (settleRestored).
let journalLid = '';      // the venue the note belongs to; empty until a page watches the draft
let openJournal = null;   // set by watchDraft: only a page that watches the draft owns the note
let journalAt = 0;        // when the note was last typed into: what its 24 hours count from
let restored = null;      // what the last page left, { at, entries, days }, while the server has not answered
const refused = [];       // writes the server said no to: see wasRefused

// A write the server refused is refused again on the next open, and every save would then carry
// it: a note that outlived the page would turn one bad line into an order that can never be saved
// again, for good. So it stays claimed in this page, as before, but is not noted: a reload is
// still the way out. A saved write proves the rules accept this device again, and clears the list.
function wasRefused(id, field, value) {
  return refused.some(write => write.entries[id] && write.entries[id][field] === value);
}

// Bring the note up to date. `typed` says this comes from a keystroke, which restarts its 24 hours:
// not while something from an earlier page is still in it, which keeps its own age, or a tablet
// used offline could carry a number past the day it is allowed.
function saveJournal(typed = false) {
  // ⚠️ A row can be drawn a frame before the draft lands (orders-main.js), and what is typed in that
  // frame needs its note as much as any other. Fornitori can clear a line too: it has no openJournal,
  // and must not rewrite Orders' note.
  if (!journalLid) openJournal?.();
  if (!journalLid) return;
  if ((typed && !restored) || !journalAt) journalAt = Date.now();
  const entries = {};
  const days = {};
  if (restored) {
    Object.entries(restored.entries).forEach(([id, left]) => {
      entries[id] = { row: { ...left.row }, base: { ...left.base } };
      if (left.air?.length) entries[id].air = left.air.map(seen => ({ ...seen }));
    });
    Object.assign(days, restored.days);
  }
  Object.entries(pending.entries).forEach(([id, held]) => {
    const there = stored(known.entries[id]);
    const row = {};
    const base = {};
    const air = [];
    const noteFields = (fields, corrected) => {
      fields.forEach(field => { row[field] = held[field]; base[field] = there[field]; });
      air.push(...corrected);
    };
    // ⚠️ «5 PUT BACK TO 0» MATCHES `known` UNTIL A SNAPSHOT SHOWS THE 5, BUT THE 5 MAY ALREADY BE IN
    // FIRESTORE'S QUEUE: with the page gone before the 0 left, it lands and comes back. So a claim
    // that corrects a write in the air is noted even when it matches `known`, and says what that
    // write said, because on the next open the line can read either way (stillOurs).
    const corrects = fields => flights.map(flight => flight.entries[id]).filter(sent => sent
      && fields.every(field => field in sent)
      && fields.some(field => sent[field] !== held[field])
      && fields.some(field => sent[field] !== there[field]))
      .map(sent => Object.fromEntries(fields.map(field => [field, sent[field]])));
    // What a snapshot already shows is in Firestore's queue. The group only as a whole.
    const group = GROUP.filter(field => field in held);
    const groupCorrects = group.length ? corrects(group) : [];
    if ((group.some(field => held[field] !== there[field]) || groupCorrects.length)
      && !group.every(field => wasRefused(id, field, held[field]))) noteFields(group, groupCorrects);
    const stockCorrects = 'stock' in held ? corrects(['stock']) : [];
    if ('stock' in held && (held.stock !== there.stock || stockCorrects.length)
      && !wasRefused(id, 'stock', held.stock)) noteFields(['stock'], stockCorrects);
    if (isEmpty(row)) return;
    const seen = [...(entries[id]?.air || []), ...air];
    entries[id] = { row: { ...entries[id]?.row, ...row }, base: { ...entries[id]?.base, ...base } };
    if (seen.length) entries[id].air = seen;
  });
  Object.entries(pending.days).forEach(([id, day]) => {
    if (day && known.days[id] !== day && !refused.some(write => write.days[id] === day)) {
      days[id] = { day, base: known.days[id] || '' };
    }
  });
  writeJournal(journalLid, { at: journalAt, entries, days });
}

// What the last page left that `doc` still reads as it did when it was typed, or as a write it had
// in the air and had corrected (`air`: that write reached the queue and landed). Already holding it
// means it arrived; holding anything else means somebody changed that line meanwhile, and their word
// wins. The quantity group and the stock are judged apart, as they are written: a colleague's shelf
// count says nothing about a quantity.
function stillOurs(left, doc) {
  const entries = {};
  Object.entries(left.entries).forEach(([id, { row, base, air = [] }]) => {
    const there = stored(doc?.entries?.[id]);
    const kept = {};
    [GROUP.filter(field => field in row), 'stock' in row ? ['stock'] : []].forEach(fields => {
      if (fields.length && [base, ...air].some(seen => fields.every(field => seen[field] === there[field]))
        && fields.some(field => row[field] !== there[field])) {
        fields.forEach(field => { kept[field] = row[field]; });
      }
    });
    if (!isEmpty(kept)) entries[id] = kept;
  });
  const days = {};
  Object.entries(left.days).forEach(([id, { day, base }]) => {
    const there = doc?.days?.[id] || '';
    if (there === base && there !== day) days[id] = day;
  });
  return { entries, days };
}

// The server has answered, so `known` is its word, and the listener has it first. Says whether any
// line came back, or null when the orders could not be read and the note goes on waiting.
//
// ⚠️⚠️ «STILL READS AS IT DID» CANNOT TELL AN UNTOUCHED LINE FROM ONE THAT WAS FILLED AND ORDERED: placing
// empties a line, and empty is what most lines were when typed on. Worse, the note may even be for a
// write that did get through, in the instant between Firestore storing it and telling this page, and
// any page of the app then sends it. So before anything comes back the server is asked about the
// orders themselves: a line some order has named since it was typed stays out. Read only when there
// is something to bring back, which is rare.
async function settleRestored() {
  // ⚠️ AGAIN HERE, not only when the note is read: a page can wait offline for days.
  const expired = Date.now() - restored.at > DRAFT_JOURNAL_MAX_AGE_MS;
  if (expired || isEmpty(stillOurs(restored, known).entries)) {
    restored = null;
    saveJournal();
    return false;
  }
  let ordered = null;
  try {
    ordered = orderedSince(await getRecentHistoryFromServer(historyLookBackDay(restored.at)), restored.at);
  } catch (err) {
    console.error('The orders could not be checked, the typed quantities wait:', err);
    return null;
  }
  // Time has passed: whatever was typed or cleared since has already been taken out of `restored`,
  // and `known` has moved on with every snapshot.
  const left = restored;
  const { entries, days } = stillOurs(left, known);
  restored = null;
  Object.keys(entries).forEach(id => {
    if (!ordered.has(id)) return;
    GROUP.forEach(field => { delete entries[id][field]; });
    if (isEmpty(entries[id])) delete entries[id];
  });
  const quantities = rows => Object.values(rows).filter(row => GROUP.some(field => field in row)).length;
  const typed = quantities(Object.values(left.entries).map(({ row }) => row));
  const back = quantities(entries);
  const anyLine = !isEmpty(entries);
  Object.entries(entries).forEach(([id, row]) => { pending.entries[id] = { ...row, ...pending.entries[id] }; });
  // ⚠️ A DAY STAMP MEANS NOTHING WITHOUT ITS LINES, and a line dropped here may be why: a stamp for next
  // week left on a supplier whose order has gone would date that supplier's next order too. This file
  // does not know whose line is whose, so the stamps come back only if every quantity did. A line with
  // none reads under the draft's own day, as it would anywhere, until the next keystroke stamps it.
  if (back && back === typed) {
    Object.entries(days).forEach(([id, day]) => { if (!(id in pending.days)) pending.days[id] = day; });
  }
  saveJournal();
  return anyLine;
}

// A line typed on this page beats what the last page left for it, whatever comes later.
function forgetRestored(id, fields) {
  const left = restored?.entries[id];
  if (!left) return;
  fields.forEach(field => { delete left.row[field]; delete left.base[field]; });
  if (left.air) left.air = left.air.filter(seen => !fields.some(field => field in seen));
  if (isEmpty(left.row)) delete restored.entries[id];
}

// Claim exactly what differs from the server now, and note it before anything else can happen.
function claim(entries, days) {
  if (!journalLid) openJournal?.();   // first, so that typing can take a line out of what it finds
  pending = differences(entries, days);
  if (restored) {
    Object.entries(pending.entries).forEach(([id, row]) => {
      if (GROUP.some(field => field in row)) forgetRestored(id, GROUP);
      if ('stock' in row) forgetRestored(id, ['stock']);
    });
    Object.keys(pending.days).forEach(id => { delete restored.days[id]; });
  }
  saveJournal(true);
}

// How the debounced autosave reports whether it landed. Injected one-way from
// orders-main.js rather than imported, so this module keeps knowing nothing about
// the page around it — and the user-facing wording stays in the UI layer.
export function setDraftSaveReporter(fn) {
  reportSaveResult = fn;
}

// Send what is waiting, reporting the result: there is no caller to hand a rejection to.
function autosave() {
  return sendPending()
    .then(() => reportSaveResult?.(true))
    .catch(err => {
      console.error('Draft autosave failed:', err);
      reportSaveResult?.(false);
    });
}

function armSave() {
  waiting = true;
  clearTimeout(saveTimer);
  // ⚠️ The timer sends `pending`, never the maps it was armed with: the page REPLACES
  // its days map on every snapshot, so the old one could carry a stamp another phone
  // has removed since.
  saveTimer = setTimeout(() => {
    if (waiting) autosave();
  }, SAVE_DELAY_MS);
}

// Autosave the draft a short moment after the last change.
//
// The timer is the ONE draft write with no caller to hand a rejection to, so it has
// to catch its own. Without this, a refused write (no network, or a Firestore rule
// rejecting the payload) was an unhandled promise rejection in the console and
// nothing else: the operator kept typing an order that was no longer being saved
// anywhere, and a reload would have thrown it all away.
//
// Success is reported too, not just failure: a transient blip must not leave a
// permanent alarm on screen once a later save has carried the same values through.
export function scheduleDraftSave(entries, days) {
  // Claim exactly what differs from the server now — so an incoming snapshot during
  // the debounce cannot quietly take the typing away, and a line put back to the
  // server's value is released at once.
  claim(entries, days);
  armSave();
}

// Save the page's draft RIGHT NOW (a re-order, a line moved to another supplier, a
// restamped day): the same claims a keystroke makes, sent without waiting.
export function saveDraftNow(entries, days) {
  claim(entries, days);
  return sendPending();
}

function sendPending() {
  clearTimeout(saveTimer);
  waiting = false;

  // Copies: a change typed while the write is in the air must not alter what this
  // write says it sent. ⚠️ LEFT OUT: what a write still in the air already says at the
  // same value (the group only whole). Sent again — leaving the section a moment after
  // the autosave went — it could land after a colleague's newer value and put this
  // phone's old one back.
  const sent = { entries: {}, days: {} };
  Object.entries(pending.entries).forEach(([id, held]) => {
    const row = { ...held };
    const group = GROUP.filter(field => field in row);
    if (group.length && group.every(field => carried(id, field) === row[field])) {
      group.forEach(field => { delete row[field]; });
    }
    if ('stock' in row && carried(id, 'stock') === row.stock) delete row.stock;
    if (!isEmpty(row)) sent.entries[id] = row;
  });
  Object.entries(pending.days).forEach(([id, day]) => {
    if (dayCarried(id) !== day) sent.days[id] = day;
  });

  // Nothing this device changed — so nothing to say. Staying quiet here also stops
  // an incoming snapshot from bouncing straight back as a write.
  if (isEmpty(sent.entries) && isEmpty(sent.days)) return Promise.resolve();

  const payload = { updatedAt: new Date().toISOString() };
  if (!isEmpty(sent.entries)) payload.entries = sent.entries;
  if (!isEmpty(sent.days)) payload.days = sent.days;

  flights.push(sent);
  const land = () => { flights.splice(flights.indexOf(sent), 1); };

  // setDoc(merge) with a PARTIAL map: Firestore merges key by key, so the rows and
  // fields not mentioned here keep whatever anyone else has put there. It also still
  // creates drafts/current on the very first order, which an updateDoc of dotted
  // paths could not.
  return saveDoc(COLLECTIONS.drafts, DRAFT_ID, payload).then(result => {
    land();
    refused.length = 0;
    // What landed joins the baseline — except a field a LATER write still in the air
    // also carries: the baseline already holds that newer value (Firestore showed it).
    const entries = { ...known.entries };
    Object.entries(sent.entries).forEach(([id, row]) => {
      const landed = {};
      Object.entries(row).forEach(([field, value]) => { if (!inAir(id, field)) landed[field] = value; });
      entries[id] = { ...(entries[id] || {}), ...landed };
    });
    const days = { ...known.days };
    Object.entries(sent.days).forEach(([id, day]) => { if (!dayInAir(id)) days[id] = day; });
    known = { entries, days };
    // Release only what was actually sent, and only if it has not been typed over in
    // the meantime — a value changed again while this write was in flight is still
    // this phone's, and must stay claimed. The group only as a whole.
    Object.entries(sent.entries).forEach(([id, row]) => {
      const held = pending.entries[id];
      if (!held) return;
      const group = GROUP.filter(field => field in held);
      if (group.length && group.every(field => held[field] === row[field])) {
        group.forEach(field => { delete held[field]; });
      }
      if ('stock' in held && held.stock === row.stock) delete held.stock;
      if (isEmpty(held)) delete pending.entries[id];
    });
    Object.entries(sent.days).forEach(([id, day]) => {
      if (pending.days[id] === day) delete pending.days[id];
    });
    saveJournal();
    return result;
  }, err => {
    land();
    // ⚠️ A REFUSED WRITE HANDS ITS TYPING BACK. A change made while it was in the air
    // may have dropped those fields from the claims — Firestore showed the write at
    // once, so they matched `known` — and the snapshot that takes the write back would
    // then erase them. Each group or stock goes back unless typed over since. The
    // baseline forgets those fields too (it may hold Firestore's showing of this very
    // write), so a keystroke before the take-back arrives still counts them as ours.
    const entries = { ...known.entries };
    Object.entries(sent.entries).forEach(([id, row]) => {
      const held = pending.entries[id] || {};
      const groupHeld = GROUP.some(field => field in held);
      const base = { ...(entries[id] || {}) };
      Object.keys(row).forEach(field => {
        const typedOver = field === 'stock' ? 'stock' in held : groupHeld;
        if (!typedOver) held[field] = row[field];
        delete base[field];
      });
      if (!isEmpty(held)) pending.entries[id] = held;
      if (entries[id] !== undefined) entries[id] = base;
    });
    const days = { ...known.days };
    Object.entries(sent.days).forEach(([id, day]) => {
      if (!(id in pending.days)) pending.days[id] = day;
      delete days[id];
    });
    known = { entries, days };
    refused.push(sent);
    saveJournal();
    throw err;
  });
}

// Write a pending debounced change RIGHT NOW. Always await this before archiving:
// otherwise a quantity typed for ANOTHER supplier less than 800ms earlier is still
// sitting in the timer, the archive's surgical clear does not carry it, and the
// next snapshot quietly reverts it on screen.
export function flushDraftSave() {
  if (!waiting) return Promise.resolve();
  return sendPending();
}

// ⚠️ THE PAGE GOING OUT OF SIGHT IS THE MOMENT TO SEND WHAT IS WAITING. Switching app or locking the
// screen hides the page while it is still alive, with time for the write to reach the browser's own
// database and for the snapshot that clears the note. NOT when the page is going away for good
// (pagehide comes first there): there is no time left, and a write that did get through would leave
// its note behind, to be read as unsent the next time, after a colleague may have placed that
// order. Going away for good is what the note is for.
export function flushDraftWhenHidden(doc = globalThis.document, win = globalThis.window) {
  let leaving = false;
  win.addEventListener('pagehide', () => { leaving = true; });
  win.addEventListener('pageshow', () => { leaving = false; });
  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState === 'hidden' && !leaving && waiting) autosave();
  });
}

// Real-time subscription. onChange receives { entries, days, updatedAt, exists }.
// onError is passed straight through: losing this stream means the order stops
// syncing between phones, which nothing on screen would otherwise reveal.
export function watchDraft(onChange, onError) {
  let updatedAt = '';
  let exists = false;
  const show = (doc, cameBack = false) => {
    // …but anything typed here and not yet written goes back ON TOP, field by
    // field, or the snapshot would erase it mid-keystroke. See `pending`.
    const storedEntries = doc?.entries || {};
    const entries = { ...storedEntries };
    Object.entries(pending.entries).forEach(([id, row]) => {
      entries[id] = { ...(storedEntries[id] || {}), ...row };
    });
    onChange({
      entries,
      days: { ...(doc?.days || {}), ...pending.days },
      updatedAt,
      exists,
      cameBack,
    });
  };
  // Read once, and not when the page starts: only from the first keystroke or snapshot is a venue
  // certainly open.
  openJournal = () => {
    journalLid = currentBakery() || '';
    const note = readJournal(journalLid);
    if (!note) return;
    journalAt = note.at;
    restored = note;
    const settle = () => {
      settleRestored().then(cameBack => {
        if (cameBack === null) setTimeout(settle, ORDERS_RETRY_MS);
        if (!cameBack) return;
        show({ entries: detach(known.entries), days: { ...known.days } }, true);
        armSave();
      });
    };
    // An error simply leaves the note for the next open.
    watchServerAnswer(COLLECTIONS.drafts, DRAFT_ID, settle);
  };
  return watchDoc(COLLECTIONS.drafts, DRAFT_ID, doc => {
    // The server's word on the draft becomes the baseline the next autosave
    // measures itself against, so a row someone else changed is not "changed
    // here" and never gets re-asserted at this phone's stale value…
    known = { entries: detach(doc?.entries), days: { ...(doc?.days || {}) } };
    releaseConfirmed();
    updatedAt = doc?.updatedAt || '';
    exists = Boolean(doc);
    saveJournal();
    show(doc);
  }, onError);
}

// What the server now holds at exactly this phone's value is no longer this phone's to
// send — otherwise it stays claimed, and comes back on screen (and into the next write)
// once another phone places that order. ⚠️ NEVER A FIELD OF A WRITE IN THE AIR: this
// snapshot may be Firestore showing this phone's own write before the server answers.
function releaseConfirmed() {
  Object.entries(pending.entries).forEach(([id, row]) => {
    const exists = known.entries[id] !== undefined;
    const there = stored(known.entries[id]);
    const group = GROUP.filter(field => field in row);
    // The group is released whole or not at all (on a line the server does not have:
    // when it is blank).
    if (group.length && !group.some(field => inAir(id, field))
      && (exists ? group.every(field => row[field] === there[field]) : group.every(field => blank(field, row[field])))) {
      group.forEach(field => { delete row[field]; });
    }
    if ('stock' in row && !inAir(id, 'stock') && row.stock === (exists ? there.stock : 0)) delete row.stock;
    if (isEmpty(row)) delete pending.entries[id];
  });
  Object.entries(pending.days).forEach(([id, day]) => {
    if (!dayInAir(id) && known.days[id] === day) delete pending.days[id];
  });
}

// Record one supplier's order under `date`, and return the stored record (or null
// when there was nothing to order).
//
// A second order to the same supplier on the same day ADDS to the first: the rows
// are cleared once archived, so the second payload only carries the items that
// were forgotten, and replacing would destroy the original order. The read and the
// write are one transaction, so two phones tapping at the same moment cannot lose
// one of the two orders.
//
// ⚠️ The same ingredient in a DIFFERENT unit from the day's first order is added up in
// PACKAGES when its card says how many one case holds (1 cartone of 4 + 2 buste = 6 buste),
// and refused otherwise (`orders/unit-conflict`, thrown inside the transaction, so nothing is
// written). `cardOf` hands the merge each ingredient's card: its unit (what a record from
// before the unit choice was placed in), its package and how many packages a case holds.
export function archiveSupplier({ supplier, ingredients, entries, date, now = new Date() }) {
  const incoming = buildSupplierArchive({ supplier, ingredients, entries, date, now });
  if (!incoming) return Promise.resolve(null);

  const cardById = {};
  (ingredients || []).forEach(ing => { cardById[ing.id] = ing; });

  return transactDoc(
    COLLECTIONS.history,
    historyDocId(date, supplier.id),
    existing => mergeArchives(existing, incoming, { cardOf: id => cardById[id] }),
  );
}

// Remove one supplier's rows (and its day stamp) from the shared draft.
//
// Clears with the UNFILTERED ingredient list on purpose: a quantity left on a
// since-deactivated product is invisible on screen but still in the document, and
// if it were not cleared it would be archived again on every future order.
export function clearSupplier(supplierId, ingredients) {
  const paths = ingredientsOf(supplierId, ingredients, { activeOnly: false })
    .map(ing => `entries.${ing.id}`);
  paths.push(`days.${supplierId}`);
  forgetRestoredPaths(paths);

  return clearFields(COLLECTIONS.drafts, DRAFT_ID, paths, {
    updatedAt: new Date().toISOString(),
  }).then(result => {
    forgetKnown(paths);
    return result;
  });
}

// Drop cleared fields from the baseline the autosave compares against.
//
// Without this there is a gap between the clear landing and its snapshot coming
// back in which `known` still holds the old quantity — so retyping that SAME
// number reads as "unchanged" and is never sent. The row would sit on screen
// looking saved while Firestore had nothing.
// ⚠️ It drops the claim from `pending` too, and that part is not optional: pending
// rows are re-applied on top of every snapshot, so a quantity left there after
// its order was archived would reappear on screen and be ordered a second time.
// A path that names a FIELD (`entries.<id>.qty`, «Azzera le quantità») forgets only
// that field — the quantity group whole — so a stock count typed while the clear
// was in the air is still claimed, and sent.
function forgetKnown(paths) {
  paths.forEach(path => {
    const [root, id, field] = path.split('.');
    if (root === 'entries' && id && field) {
      if (known.entries[id]) delete known.entries[id][field];
      const row = pending.entries[id];
      if (row) {
        (GROUP.includes(field) ? GROUP : [field]).forEach(name => { delete row[name]; });
        if (isEmpty(row)) delete pending.entries[id];
      }
    } else if (root === 'entries' && id) {
      delete known.entries[id];
      delete pending.entries[id];
    }
    if (root === 'days' && id) {
      delete known.days[id];
      delete pending.days[id];
    }
  });
  saveJournal();
}

// ⚠️ WHEN A CLEAR STARTS, NOT WHEN IT LANDS: on a weak connection the server's first answer can come
// while the clear is in the air, and what the last page left would then come back over it.
function forgetRestoredPaths(paths) {
  if (!restored) return;
  paths.forEach(path => {
    const [root, id, field] = path.split('.');
    if (root === 'entries' && id && field) forgetRestored(id, GROUP.includes(field) ? GROUP : [field]);
    else if (root === 'entries' && id) delete restored.entries[id];
    if (root === 'days' && id) delete restored.days[id];
  });
  saveJournal();
}

// Take ONE ingredient's row out of the shared draft — called when the ingredient is deleted.
//
// ⚠️ WITHOUT IT A DELETED PRODUCT LEAVES ITS LINE IN `drafts/current`: leftover data. No row
// draws it, and the archive and the totals only walk the ingredients that still exist, so it is
// never ordered nor counted — but it would sit in the document for ever. Only the named path is
// cleared, so whatever another phone is typing for other ingredients survives.
// A draft that does not exist yet has nothing to clear, and updateDoc refuses a missing
// document — that refusal is not a failure of the delete, so it is the caller's to log.
// ⚠️ NOT AWAITED BY THE CARD: the card closes the moment the delete batch has landed, and this
// runs after it. A failure is only logged — the ingredient is already gone, and reporting it as a
// failed delete would invite a second delete of something that no longer exists. One function for
// both screens that can delete (Orders and Fornitori), so neither can forget it.
export function dropDeletedIngredientFromDraft(ingredientId) {
  clearIngredientFromDraft(ingredientId).catch(err => {
    console.error('The draft still holds a deleted ingredient:', err);
  });
}

export function clearIngredientFromDraft(ingredientId) {
  const paths = [draftEntryPath(ingredientId)];
  forgetRestoredPaths(paths);
  // Fornitori deletes too, and no page there holds the note: a line that came back would be left in
  // the document for ever, with no row to draw it.
  if (!journalLid) dropNotedLine(currentBakery(), ingredientId);
  return clearFields(COLLECTIONS.drafts, DRAFT_ID, paths, {
    updatedAt: new Date().toISOString(),
  }).then(result => {
    forgetKnown(paths);
    return result;
  });
}

// An ingredient's ORDER UNIT was changed by its card (Cartone / Singola rewrite it): freeze the unit
// the open draft line was typed in, so «8 buste» stays 8 buste instead of reading 8 cartoni.
//
// ⚠️ A DRAFT LINE WITH NO UNIT OF ITS OWN MEANS «THE CARD'S UNIT, WHATEVER IT IS NOW» (storedUnitFor):
// changing the card's unit silently changes what every untouched line counts. So when the line has a
// quantity and no unit of its own, the OLD unit is written onto it — by the very rule Orders uses for
// a chosen unit (nothing when it is the card's unit still). The card's new unit is in `item`.
// ⚠️ ONLY THE DRAFT: a line already recorded in orders-history carries no frozen unit, and re-reading
// it with the new card unit reads the new word. That was already true whenever «Unità d'ordine» was
// edited, before this card existed — it is left alone, on purpose.
// One function for both screens that can edit an ingredient (Orders and Fornitori). It READS the
// draft once and then merges ONE field, so whatever another phone is typing survives. A failure is
// the caller's to log: the ingredient is already saved.
export async function freezeUnitInDraft({ id, from, item }) {
  const frozen = storedUnitFor(from, item);
  if (!frozen) return false;
  const draft = await getDocOnce(COLLECTIONS.drafts, DRAFT_ID);
  const entry = draft && draft.entries ? draft.entries[id] : null;
  if (!(Number(entry && entry.qty) > 0) || cleanUnit(entry.unit)) return false;
  await saveDoc(COLLECTIONS.drafts, DRAFT_ID, {
    updatedAt: new Date().toISOString(),
    entries: { [id]: { unit: frozen } },
  });
  return true;
}

// Throw away the quantities typed for one or more suppliers WITHOUT recording an
// order — the "start this order again" button.
//
// Deliberately NOT clearSupplier: that removes the whole row because the order has
// just been archived and the reading went with it. Here nothing is being recorded,
// so only `qty` goes and the STOCK reading stays: the shelves were counted, and
// that work should not have to be repeated.
//
// One write for every supplier chosen (see quantityPathsFor), so there is no moment
// where half the list is cleared — and clearFields only touches the named paths, so
// whatever another phone is typing for a supplier NOT in the list survives.
//
// ⚠️ orders-history is not touched. Nothing recorded is undone by this.
export function clearQuantities(supplierIds, ingredients) {
  const paths = quantityPathsFor(supplierIds, ingredients);
  if (!paths.length) return Promise.resolve();
  forgetRestoredPaths(paths);

  return clearFields(COLLECTIONS.drafts, DRAFT_ID, paths, {
    updatedAt: new Date().toISOString(),
  }).then(result => {
    // Field paths: the baseline and the claims lose the quantity, its unit and its
    // supplier, and keep the stock — the server still has that reading.
    forgetKnown(paths);
    return result;
  });
}

// Rewrite a history record whole (the History editor). Not a merge: the operator
// is correcting the record, so what they see is what it becomes.
export function saveHistoryRecord(id, record) {
  return replaceDoc(COLLECTIONS.history, id, record);
}

export function deleteHistoryRecord(id) {
  return removeDoc(COLLECTIONS.history, id);
}

// Say that an order arrived, and which of its rows did not.
//
// ⚠️⚠️ THREE FIELDS, NOT A REWRITE OF THE RECORD, AND THAT IS THE WHOLE POINT.
// `quantities` is the map the suggestion engine averages over; rewriting the record
// whole from a screen that only knows about the delivery would be one refactor away
// from carrying a stale copy of it back to the server. This write cannot touch what was
// ordered because it never sends it.
//
// ⚠️ AN EMPTY `deliveredAt` IS A REAL VALUE — "we looked and it has not arrived" —
// and it is how a confirmation is taken back after a mis-tap. It is written, not
// omitted: omitting it leaves the old stamp in place, so an un-confirm would silently
// do nothing.
//
// ⚠️ `missing` IS REPLACED WHOLE (patchDoc), never merged. A merge write adds the new
// marks to the stored ones, so a second answer could never say «the flour came after
// all»: the old mark stayed, and the flour stayed on the re-order list and out of the
// stocktake for ever. A second answer happens when a same-day order re-opens a delivery
// (js/orders/archive.js mergeArchives).
export function confirmDelivery(id, { deliveredAt, missing }) {
  return patchDoc(COLLECTIONS.history, id, {
    deliveredAt: deliveredAt || '',
    missing: missing || {},
    updatedAt: new Date().toISOString(),
  });
}

// «Risolto» on one missing line: bought elsewhere, so it leaves «Da riordinare» for good.
// ⚠️ A MERGE, on purpose: the map is ADDED to (one line at a time, maybe from two phones),
// and `missing` itself is never touched — the line still did not arrive, so the stocktake
// must still not count it as bought.
export function resolveMissing(recordId, ingredientId, at = new Date().toISOString()) {
  return saveDoc(COLLECTIONS.history, recordId, {
    missingResolved: { [ingredientId]: at },
    updatedAt: at,
  });
}
